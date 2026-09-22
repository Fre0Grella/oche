/**
 * The capture lab: photograph the board, mark where the darts landed, export.
 *
 * This screen is the unlock for the whole vision track (`docs/07`), so it is
 * built to be used during an ordinary practice session rather than as a chore:
 * calibrate once, then every throw that settles is photographed automatically,
 * and labelling is three taps on a picture.
 */

import { CALIBRATION_BOARD_POINTS, boardRegion, formatHit, type Point } from '@oche/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { BoardOverlay, type OverlayHandle } from '../components/BoardOverlay.js';
import { fill, useStrings } from '../i18n/index.js';
import {
  calibrate,
  countFrames,
  deleteFrame,
  exportFrames,
  listFrames,
  putFrame,
  readDart,
  type CapturedFrame,
  type LabelledDart,
} from '../storage/frames.js';
import { storageEstimate } from '../storage/db.js';
import { useMatchStore } from '../store/match.js';
import { cameraSupported, type GrabbedFrame } from '../vision/camera.js';
import { useCamera } from '../vision/useCamera.js';

type Mode = 'live' | 'calibrate' | 'label';

/**
 * How many unlabelled frames may pile up before automatic capture pauses.
 * Photographs are cheap to take and slow to label, and a session that fills the
 * phone with frames nobody will ever mark up is worse than one that stops.
 */
const BACKLOG_LIMIT = 40;

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `frame-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Four sensible starting positions, spread over the middle of the frame. */
function defaultHandles(width: number, height: number): Point[] {
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) * 0.34;
  return [
    { x: cx, y: cy - r },
    { x: cx + r, y: cy },
    { x: cx, y: cy + r },
    { x: cx - r, y: cy },
  ];
}

export function Capture() {
  const t = useStrings();
  const setScreen = useMatchStore((s) => s.setScreen);
  const calibration = useMatchStore((s) => s.settings.calibration);
  const saveCalibration = useMatchStore((s) => s.saveCalibration);

  const [cameraOn, setCameraOn] = useState(false);
  const [autoCapture, setAutoCapture] = useState(true);
  const [mode, setMode] = useState<Mode>('live');
  const [draft, setDraft] = useState<Point[]>([]);
  const [frozen, setFrozen] = useState<{ url: string; width: number; height: number } | null>(null);
  const [queue, setQueue] = useState<CapturedFrame[]>([]);
  const [labelling, setLabelling] = useState<CapturedFrame | null>(null);
  const [labelDarts, setLabelDarts] = useState<LabelledDart[]>([]);
  const [stats, setStats] = useState({ total: 0, labelled: 0, bytes: 0 });
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const calibrationRef = useRef(calibration);
  calibrationRef.current = calibration;

  const backlogRef = useRef(0);
  backlogRef.current = queue.length;

  const refreshStats = useCallback(async () => {
    setStats(await countFrames());
    setUsage(await storageEstimate());
  }, []);

  useEffect(() => {
    void refreshStats();
  }, [refreshStats]);

  /** A settled frame becomes an unlabelled capture, if we know where the board is. */
  const onSettle = useCallback(async (grabbed: GrabbedFrame) => {
    const current = calibrationRef.current;
    if (!current) return;
    if (current.width !== grabbed.width || current.height !== grabbed.height) return;
    if (backlogRef.current >= BACKLOG_LIMIT) return;

    const frame: CapturedFrame = {
      id: newId(),
      ts: Date.now(),
      source: 'lab',
      width: grabbed.width,
      height: grabbed.height,
      jpeg: grabbed.jpeg,
      calibration: {
        imagePoints: current.imagePoints,
        toImage: current.toImage,
        toBoard: current.toBoard,
        error: current.error,
        width: current.width,
        height: current.height,
      },
      darts: [],
      labelled: false,
    };

    await putFrame(frame);
    setQueue((pending) => [...pending, frame]);
    void refreshStats();
  }, [refreshStats]);

  // The capture trigger looks only at the board, so it has to know where it is.
  const region = useMemo(
    () =>
      calibration && calibration.width > 0
        ? boardRegion(calibration.toImage, { width: calibration.width, height: calibration.height })
        : null,
    [calibration],
  );

  const camera = useCamera({
    active: cameraOn,
    onSettle,
    captureOnSettle: autoCapture && mode === 'live' && calibration !== null,
    region,
  });

  // Whatever is on screen owns the coordinate space: the frozen grab during
  // calibration, the stored frame while labelling, the live camera otherwise.
  // Reading the live size during calibration would silently mis-stamp the
  // landmarks if the track renegotiated its resolution mid-drag.
  const frameSize =
    mode === 'label' && labelling
      ? { width: labelling.width, height: labelling.height }
      : mode === 'calibrate' && frozen
        ? { width: frozen.width, height: frozen.height }
        : { width: camera.width || 1280, height: camera.height || 720 };

  const staleCalibration =
    calibration !== null &&
    camera.width > 0 &&
    (calibration.width !== camera.width || calibration.height !== camera.height);

  // ---- calibration -------------------------------------------------------

  const draftCalibration =
    mode === 'calibrate' && draft.length === 4
      ? calibrate(draft, CALIBRATION_BOARD_POINTS, frameSize)
      : null;

  const startCalibration = async () => {
    const grabbed = await camera.capture();
    if (!grabbed) return;
    if (frozen) URL.revokeObjectURL(frozen.url);
    setFrozen({ url: URL.createObjectURL(grabbed.jpeg), width: grabbed.width, height: grabbed.height });
    setDraft(calibration && !staleCalibration ? calibration.imagePoints : defaultHandles(grabbed.width, grabbed.height));
    setMode('calibrate');
  };

  const finishCalibration = (save: boolean) => {
    if (save && draftCalibration) {
      saveCalibration({ ...draftCalibration, ts: Date.now() });
    }
    if (frozen) URL.revokeObjectURL(frozen.url);
    setFrozen(null);
    setDraft([]);
    setMode('live');
  };

  const handles: OverlayHandle[] = [
    { label: t.capture.landmarkTop, hint: t.capture.landmarkHintTop, point: draft[0] ?? { x: 0, y: 0 } },
    { label: t.capture.landmarkRight, hint: t.capture.landmarkHintRight, point: draft[1] ?? { x: 0, y: 0 } },
    { label: t.capture.landmarkBottom, hint: t.capture.landmarkHintBottom, point: draft[2] ?? { x: 0, y: 0 } },
    { label: t.capture.landmarkLeft, hint: t.capture.landmarkHintLeft, point: draft[3] ?? { x: 0, y: 0 } },
  ];

  // ---- labelling ---------------------------------------------------------

  const openLabeller = (frame: CapturedFrame) => {
    if (frozen) URL.revokeObjectURL(frozen.url);
    setFrozen({ url: URL.createObjectURL(frame.jpeg), width: frame.width, height: frame.height });
    setLabelling(frame);
    setLabelDarts(frame.darts);
    setMode('label');
  };

  const closeLabeller = () => {
    if (frozen) URL.revokeObjectURL(frozen.url);
    setFrozen(null);
    setLabelling(null);
    setLabelDarts([]);
    setMode('live');
  };

  const nextInQueue = (skipId: string) => {
    const remaining = queue.filter((frame) => frame.id !== skipId);
    setQueue(remaining);
    const next = remaining[0];
    if (next) openLabeller(next);
    else closeLabeller();
  };

  const saveLabels = async () => {
    if (!labelling) return;
    await putFrame({ ...labelling, darts: labelDarts, labelled: true });
    void refreshStats();
    nextInQueue(labelling.id);
  };

  const dropFrame = async () => {
    if (!labelling) return;
    await deleteFrame(labelling.id);
    void refreshStats();
    nextInQueue(labelling.id);
  };

  // ---- export ------------------------------------------------------------

  const exportAll = async () => {
    setBusy(true);
    try {
      const frames = await listFrames(Number.MAX_SAFE_INTEGER);
      const blob = await exportFrames(frames);
      download(blob, `oche-captures-${new Date().toISOString().slice(0, 10)}.zip`);
    } finally {
      setBusy(false);
    }
  };

  const deleteAll = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 4000);
      return;
    }
    setConfirmDelete(false);
    const frames = await listFrames(Number.MAX_SAFE_INTEGER);
    await Promise.all(frames.map((frame) => deleteFrame(frame.id)));
    setQueue([]);
    void refreshStats();
  };

  useEffect(() => () => {
    if (frozen) URL.revokeObjectURL(frozen.url);
  }, [frozen]);

  const overlayToImage =
    mode === 'calibrate'
      ? draftCalibration?.toImage ?? null
      : mode === 'label'
        ? labelling?.calibration.toImage ?? null
        : staleCalibration
          ? null
          : calibration?.toImage ?? null;

  return (
    <div className="screen screen-capture">
      <header className="screen-head">
        <h1>{t.capture.title}</h1>
        <p>{t.capture.subtitle}</p>
      </header>

      {!cameraSupported() && <p className="warning">{t.capture.noCamera}</p>}
      {camera.error && <p className="warning">{camera.error}</p>}
      {staleCalibration && mode === 'live' && (
        <p className="warning">
          {fill(t.capture.calibrateStale, {
            old: `${calibration!.width}×${calibration!.height}`,
            now: `${camera.width}×${camera.height}`,
          })}
        </p>
      )}

      <div className="stage" style={{ aspectRatio: `${frameSize.width} / ${frameSize.height}` }}>
        <video ref={camera.videoRef} className="stage-video" playsInline muted />
        {frozen && <img className="stage-frozen" src={frozen.url} alt="" />}
        <BoardOverlay
          width={frameSize.width}
          height={frameSize.height}
          toImage={overlayToImage}
          handles={mode === 'calibrate' ? handles : []}
          onHandleMove={(index, point) =>
            setDraft((points) => points.map((p, i) => (i === index ? point : p)))
          }
          darts={
            mode === 'label'
              ? labelDarts.map((dart) => ({ img: dart.img, label: formatHit(dart.hit) }))
              : []
          }
          onDartMove={(index, point) =>
            setLabelDarts((darts) =>
              darts.map((dart, i) =>
                i === index && labelling ? readDart(labelling.calibration, point) : dart,
              ),
            )
          }
          onTap={(point) => {
            if (mode !== 'label' || !labelling || labelDarts.length >= 3) return;
            setLabelDarts((darts) => [...darts, readDart(labelling.calibration, point)]);
          }}
        />
        {mode === 'live' && cameraOn && (
          <div className="stage-badge">
            {camera.moving ? t.capture.moving : t.capture.waiting} · {t.capture.captured} {camera.settles}
            {' · '}
            {t.capture.readout}: {camera.motion.toFixed(1)} / {camera.change.toFixed(1)}
          </div>
        )}
      </div>

      {mode === 'calibrate' && (
        <section className="panel">
          <h2>{t.capture.calibrateTitle}</h2>
          <p className="hint">{t.capture.calibrateHelp}</p>
          <ul className="landmark-list">
            {handles.map((handle) => (
              <li key={handle.label}>
                <b>{handle.label}</b> {handle.hint}
              </li>
            ))}
          </ul>
          <p className="hint">
            {t.capture.calibrateError}:{' '}
            <b>{draftCalibration ? `${draftCalibration.error.toFixed(1)} px` : '—'}</b>
          </p>
          <div className="controls">
            <button type="button" className="primary" onClick={() => finishCalibration(true)} disabled={!draftCalibration}>
              {t.capture.calibrateSave}
            </button>
            <button type="button" className="chip" onClick={() => finishCalibration(false)}>
              {t.capture.calibrateCancel}
            </button>
          </div>
        </section>
      )}

      {mode === 'label' && labelling && (
        <section className="panel">
          <h2>{t.capture.label}</h2>
          <p className="hint">{t.capture.labelHelp}</p>
          <div className="chip-row">
            {labelDarts.length === 0 && <span className="hint">{t.capture.labelEmpty}</span>}
            {labelDarts.map((dart, index) => (
              <button
                key={index}
                type="button"
                className="chip"
                onClick={() => setLabelDarts((darts) => darts.filter((_, i) => i !== index))}
              >
                {formatHit(dart.hit)} ✕
              </button>
            ))}
          </div>
          <div className="controls">
            <button type="button" className="primary" onClick={() => void saveLabels()}>
              {t.capture.labelSave}
            </button>
            <button type="button" className="chip" onClick={() => nextInQueue(labelling.id)}>
              {t.capture.labelSkip}
            </button>
            <button type="button" className="chip" onClick={() => void dropFrame()}>
              {t.capture.labelDelete}
            </button>
          </div>
        </section>
      )}

      {mode === 'live' && (
        <div className="controls">
          <button type="button" className={`chip${cameraOn ? ' chip-on' : ''}`} onClick={() => setCameraOn((on) => !on)}>
            {cameraOn ? t.capture.stop : t.capture.start}
          </button>
          <button type="button" className="chip" onClick={() => void startCalibration()} disabled={!camera.ready}>
            {calibration ? t.capture.recalibrate : t.capture.calibrate}
          </button>
          <button
            type="button"
            className={`chip${autoCapture ? ' chip-on' : ''}`}
            onClick={() => setAutoCapture((on) => !on)}
            disabled={!calibration}
          >
            {t.capture.autoCapture}
          </button>
          <button
            type="button"
            className="chip"
            disabled={!camera.ready || !calibration}
            onClick={async () => {
              const grabbed = await camera.capture();
              if (grabbed) await onSettle(grabbed);
            }}
          >
            {t.capture.captureNow}
          </button>
        </div>
      )}

      {mode === 'live' && !calibration && cameraOn && <p className="hint">{t.capture.noCalibration}</p>}
      {mode === 'live' && cameraOn && calibration && autoCapture && (
        <p className="hint">{t.capture.autoNote}</p>
      )}
      {mode === 'live' && queue.length >= BACKLOG_LIMIT && <p className="warning">{t.capture.backlog}</p>}

      {mode === 'live' && queue.length > 0 && (
        <button type="button" className="primary" onClick={() => openLabeller(queue[0]!)}>
          {fill(t.capture.queue, { n: queue.length })}
        </button>
      )}

      <section className="panel">
        <h2>{t.capture.frames}</h2>
        <p>
          <b>{stats.total}</b> · {stats.labelled} {t.capture.labelled} ·{' '}
          {stats.bytes < 1_000_000
            ? `${Math.round(stats.bytes / 1000)} kB`
            : fill(t.capture.storage, { mb: (stats.bytes / 1_000_000).toFixed(1) })}
          {usage && usage.quota > 0 && ` / ${(usage.quota / 1_000_000_000).toFixed(1)} GB`}
        </p>
        <p className="hint">{t.capture.privacy}</p>
        <div className="controls">
          <button type="button" className="chip" onClick={() => void exportAll()} disabled={busy || stats.total === 0}>
            {stats.total === 0 ? t.capture.exportEmpty : t.capture.export}
          </button>
          <button type="button" className="chip" onClick={() => void deleteAll()} disabled={stats.total === 0}>
            {confirmDelete ? t.capture.deleteAllConfirm : t.capture.deleteAll}
          </button>
        </div>
      </section>

      <div className="screen-actions">
        <button type="button" className="chip" onClick={() => setScreen('setup')}>
          {t.capture.back}
        </button>
      </div>
    </div>
  );
}
