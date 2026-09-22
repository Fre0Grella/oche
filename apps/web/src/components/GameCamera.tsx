/**
 * The camera during a game, and the report flow.
 *
 * With the camera on, every settled throw is photographed and the latest frame
 * is held in memory. When a score is wrong — today because a finger slipped,
 * later because the autoscorer read it wrong — "Report" opens that photograph
 * and asks the one question worth asking: where did the dart actually land?
 *
 * The answer corrects the score *and* becomes a labelled training example from
 * exactly the setup and lighting that caused the mistake, which is the flywheel
 * `docs/03` is built around.
 */

import { formatHit, type Hit, type Point } from '@oche/core';
import { useCallback, useEffect, useRef, useState } from 'react';

import { fill, useStrings } from '../i18n/index.js';
import {
  projectToImage,
  putFrame,
  readDart,
  type CapturedFrame,
  type LabelledDart,
} from '../storage/frames.js';
import { useMatchStore } from '../store/match.js';
import { cameraSupported, type GrabbedFrame } from '../vision/camera.js';
import { useCamera } from '../vision/useCamera.js';
import { BoardOverlay } from './BoardOverlay.js';

export interface ReportableDart {
  id: string;
  hit: Hit;
  pos?: Point;
}

export interface GameCameraProps {
  matchId: string;
  /** The darts of the visit on the board right now. */
  darts: ReportableDart[];
  onCorrect: (dartId: string, hit: Hit, pos: Point) => void;
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `frame-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

export function GameCamera({ matchId, darts, onCorrect }: GameCameraProps) {
  const t = useStrings();
  const keepFrames = useMatchStore((s) => s.settings.keepFrames);
  const setKeepFrames = useMatchStore((s) => s.setKeepFrames);
  const calibration = useMatchStore((s) => s.settings.calibration);
  const setScreen = useMatchStore((s) => s.setScreen);

  const [latest, setLatest] = useState<GrabbedFrame | null>(null);
  const [reporting, setReporting] = useState(false);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [marks, setMarks] = useState<(LabelledDart | null)[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const latestRef = useRef<GrabbedFrame | null>(null);

  const onSettle = useCallback((frame: GrabbedFrame) => {
    latestRef.current = frame;
    setLatest(frame);
  }, []);

  const camera = useCamera({ active: keepFrames, onSettle, captureOnSettle: true });

  const usable =
    calibration !== null &&
    latest !== null &&
    calibration.width === latest.width &&
    calibration.height === latest.height;

  const openReport = () => {
    if (!latest || !calibration) return;
    const url = URL.createObjectURL(latest.jpeg);
    setFrameUrl(url);
    // Pre-place a marker wherever a dart already has a position: correcting a
    // marker that is nearly right is much faster than placing three.
    setMarks(
      darts.map((dart) =>
        dart.pos && usable
          ? { img: projectToImage(calibration, dart.pos), board: dart.pos, hit: dart.hit }
          : null,
      ),
    );
    setReporting(true);
  };

  const closeReport = () => {
    if (frameUrl) URL.revokeObjectURL(frameUrl);
    setFrameUrl(null);
    setReporting(false);
    setMarks([]);
  };

  const saveReport = async () => {
    if (!latest || !calibration) return;

    const labelled = marks.filter((mark): mark is LabelledDart => mark !== null);
    const frame: CapturedFrame = {
      id: newId(),
      ts: Date.now(),
      source: 'game',
      matchId,
      width: latest.width,
      height: latest.height,
      jpeg: latest.jpeg,
      calibration: {
        imagePoints: calibration.imagePoints,
        toImage: calibration.toImage,
        toBoard: calibration.toBoard,
        error: calibration.error,
        width: calibration.width,
        height: calibration.height,
      },
      darts: labelled,
      labelled: labelled.length > 0,
      reported: {
        hits: darts.map((dart) => formatHit(dart.hit)),
        source: 'manual',
      },
    };
    await putFrame(frame);

    // Anything whose score moved is corrected in the match as well.
    let corrections = 0;
    marks.forEach((mark, index) => {
      const dart = darts[index];
      if (!mark || !dart) return;
      if (mark.hit.value === dart.hit.value && mark.hit.ring === dart.hit.ring) return;
      onCorrect(dart.id, mark.hit, mark.board);
      corrections += 1;
    });

    setSaved(
      corrections > 0
        ? fill(t.report.scoreChanged, {
            score: marks
              .filter((mark): mark is LabelledDart => mark !== null)
              .map((mark) => formatHit(mark.hit))
              .join(' '),
          })
        : t.report.save,
    );
    setTimeout(() => setSaved(null), 4000);
    closeReport();
  };

  useEffect(() => () => {
    if (frameUrl) URL.revokeObjectURL(frameUrl);
  }, [frameUrl]);

  if (!cameraSupported()) return null;

  const size = { width: camera.width || 1280, height: camera.height || 720 };

  return (
    <div className="game-camera">
      <div className="controls">
        <button
          type="button"
          className={`chip${keepFrames ? ' chip-on' : ''}`}
          onClick={() => setKeepFrames(!keepFrames)}
        >
          {keepFrames ? t.report.cameraOn : t.report.cameraOff}
        </button>
        {keepFrames && (
          <button type="button" className="chip" onClick={openReport} disabled={!usable || darts.length === 0}>
            {t.report.button}
          </button>
        )}
        {keepFrames && !calibration && (
          <button type="button" className="chip" onClick={() => setScreen('capture')}>
            {t.capture.calibrate}
          </button>
        )}
      </div>

      {saved && <p className="hint">{saved}</p>}

      {keepFrames && (
        <div className="game-camera-preview" style={{ aspectRatio: `${size.width} / ${size.height}` }}>
          <video ref={camera.videoRef} className="stage-video" playsInline muted />
          <BoardOverlay
            width={size.width}
            height={size.height}
            toImage={
              calibration && calibration.width === camera.width && calibration.height === camera.height
                ? calibration.toImage
                : null
            }
          />
          <div className="stage-badge">
            {camera.moving ? t.capture.moving : t.capture.waiting}
            {latest ? ` · ${t.capture.captured}` : ''}
          </div>
        </div>
      )}

      {keepFrames && !usable && latest !== null && <p className="hint">{t.capture.noCalibration}</p>}
      {keepFrames && latest === null && <p className="hint">{t.report.noFrame}</p>}

      {reporting && frameUrl && latest && (
        <div className="overlay">
          <div className="overlay-card overlay-card-wide">
            <h2>{t.report.title}</h2>
            <p className="hint">{t.report.help}</p>

            <div className="stage" style={{ aspectRatio: `${latest.width} / ${latest.height}` }}>
              <img className="stage-frozen" src={frameUrl} alt="" />
              <BoardOverlay
                width={latest.width}
                height={latest.height}
                toImage={calibration?.toImage ?? null}
                darts={marks
                  .map((mark, index) => ({ mark, index }))
                  .filter(({ mark }) => mark !== null)
                  .map(({ mark, index }) => ({
                    img: mark!.img,
                    label: `${index + 1} · ${formatHit(mark!.hit)}`,
                  }))}
                onDartMove={(visibleIndex, point) => {
                  if (!calibration) return;
                  const indices = marks.map((mark, index) => (mark ? index : -1)).filter((index) => index >= 0);
                  const target = indices[visibleIndex];
                  if (target === undefined) return;
                  setMarks((current) =>
                    current.map((mark, index) => (index === target ? readDart(calibration, point) : mark)),
                  );
                }}
                onTap={(point) => {
                  if (!calibration) return;
                  const next = marks.findIndex((mark) => mark === null);
                  if (next < 0) return;
                  setMarks((current) =>
                    current.map((mark, index) => (index === next ? readDart(calibration, point) : mark)),
                  );
                }}
              />
            </div>

            <div className="chip-row">
              {darts.map((dart, index) => {
                const mark = marks[index];
                return (
                  <button
                    key={dart.id}
                    type="button"
                    className="chip"
                    onClick={() => setMarks((current) => current.map((m, i) => (i === index ? null : m)))}
                  >
                    {index + 1}: {formatHit(dart.hit)}
                    {mark && mark.hit.value !== dart.hit.value ? ` → ${formatHit(mark.hit)}` : ''}
                  </button>
                );
              })}
            </div>

            <div className="controls">
              <button type="button" className="primary" onClick={() => void saveReport()}>
                {t.report.save}
              </button>
              <button type="button" className="chip" onClick={closeReport}>
                {t.report.cancel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
