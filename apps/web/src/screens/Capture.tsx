/**
 * Camera setup, and the practice round that proves it works.
 *
 * Three steps, once: point the camera, find the board, then **try it**. Try-it
 * is the heart of this screen. You throw a dart, the app photographs the board
 * the moment it settles, you tap the dart in the picture, and it calls the
 * score back at you. That single loop does three jobs at once:
 *
 *  - it shows you whether the camera is set up properly, because a wrong
 *    calibration gives a wrong score and you will hear it;
 *  - it is the least tedious way anyone has found to label training data, since
 *    a dart you have just thrown is a dart you can still see; and
 *  - one throw is one labelled sample, so the count going up is the training
 *    set being built.
 *
 * An earlier version photographed everything and queued it for labelling later.
 * A queue of forty near-identical photographs of a board is a chore nobody
 * finishes, and it was not obvious what it was for. Nothing is stored now
 * unless it has been marked.
 */

import {
  CALIBRATION_BOARD_POINTS,
  assessBoardView,
  boardRegion,
  formatHit,
  type Hit,
  type Point,
} from '@oche/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { BoardOverlay, type OverlayHandle } from '../components/BoardOverlay.js';
import { SetupCoach } from '../components/SetupCoach.js';
import { caller, unlockCaller } from '../caller/caller.js';
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

type Mode = 'setup' | 'calibrate' | 'try';

/**
 * How long a marked frame stays open before it saves itself. Long enough to
 * tap a second dart if two went in together, short enough that the rhythm of
 * throw-tap-throw is not interrupted.
 */
const SAVE_DELAY_MS = 2200;

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

interface PendingFrame {
  grabbed: GrabbedFrame;
  url: string;
  darts: LabelledDart[];
}

export function Capture() {
  const t = useStrings();
  const setScreen = useMatchStore((s) => s.setScreen);
  const calibration = useMatchStore((s) => s.settings.calibration);
  const saveCalibration = useMatchStore((s) => s.saveCalibration);
  const callerEnabled = useMatchStore((s) => s.settings.callerEnabled);
  const playMode = useMatchStore((s) => s.mode);
  const remoteStream = useMatchStore((s) => s.remoteStream);

  const [cameraOn, setCameraOn] = useState(false);
  const [mode, setMode] = useState<Mode>('setup');
  const [draft, setDraft] = useState<Point[]>([]);
  const [frozen, setFrozen] = useState<{ url: string; width: number; height: number } | null>(null);

  const [pending, setPending] = useState<PendingFrame | null>(null);
  const [marked, setMarked] = useState<{ hit: Hit; id: string }[]>([]);
  const [lastSaved, setLastSaved] = useState<{ id: string; hit: Hit } | null>(null);

  const [stats, setStats] = useState({ total: 0, labelled: 0, bytes: 0 });
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const calibrationRef = useRef(calibration);
  calibrationRef.current = calibration;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const pendingRef = useRef<PendingFrame | null>(null);
  pendingRef.current = pending;
  const saveTimer = useRef(0);

  const paired = playMode === 'paired' && remoteStream !== null;

  const refreshStats = useCallback(async () => {
    setStats(await countFrames());
    setUsage(await storageEstimate());
  }, []);

  useEffect(() => {
    void refreshStats();
  }, [refreshStats]);

  /**
   * A settled frame becomes the one on screen to mark. Anything already on
   * screen and unmarked is dropped: the newest photograph of the board is the
   * one with the dart you just threw in it.
   */
  const onSettle = useCallback((grabbed: GrabbedFrame) => {
    if (modeRef.current !== 'try') return;
    const current = calibrationRef.current;
    if (!current) return;
    if (current.width !== grabbed.width || current.height !== grabbed.height) return;

    setPending((previous) => {
      if (previous && previous.darts.length > 0) return previous; // mid-marking
      if (previous) URL.revokeObjectURL(previous.url);
      return { grabbed, url: URL.createObjectURL(grabbed.jpeg), darts: [] };
    });
  }, []);

  const region = useMemo(
    () =>
      calibration && calibration.width > 0
        ? boardRegion(calibration.toImage, { width: calibration.width, height: calibration.height })
        : null,
    [calibration],
  );

  const reference = useMemo(
    () => (calibration?.reference ? Uint8Array.from(calibration.reference) : null),
    [calibration],
  );

  const camera = useCamera({
    active: cameraOn || paired,
    onSettle,
    captureOnSettle: mode === 'try' && calibration !== null,
    region,
    reference,
    stream: paired ? remoteStream : null,
  });

  const frameSize =
    pending && mode === 'try'
      ? { width: pending.grabbed.width, height: pending.grabbed.height }
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

  const [draftTick, setDraftTick] = useState(0);
  const draftCalibrationRef = useRef(draftCalibration);
  draftCalibrationRef.current = draftCalibration;

  useEffect(() => {
    if (mode !== 'calibrate') return;
    const timer = setInterval(() => setDraftTick((tick) => tick + 1), 300);
    return () => clearInterval(timer);
  }, [mode]);

  const view = useMemo(() => {
    const source = mode === 'calibrate' ? draftCalibrationRef.current : calibration;
    if (!source) return null;
    return assessBoardView(source.toImage, { width: source.width, height: source.height });
  }, [calibration, mode, draftTick]);

  const startCalibration = async () => {
    const grabbed = await camera.capture();
    if (!grabbed) return;
    if (frozen) URL.revokeObjectURL(frozen.url);
    setFrozen({ url: URL.createObjectURL(grabbed.jpeg), width: grabbed.width, height: grabbed.height });
    setDraft(
      calibration && !staleCalibration ? calibration.imagePoints : defaultHandles(grabbed.width, grabbed.height),
    );
    setMode('calibrate');
  };

  const finishCalibration = (save: boolean) => {
    if (save && draftCalibration) {
      const boardRect = boardRegion(draftCalibration.toImage, {
        width: draftCalibration.width,
        height: draftCalibration.height,
      });
      const thumb = camera.sampleThumbnail(boardRect);
      saveCalibration({
        ...draftCalibration,
        ts: Date.now(),
        ...(thumb ? { reference: Array.from(thumb) } : {}),
      });
    }
    if (frozen) URL.revokeObjectURL(frozen.url);
    setFrozen(null);
    setDraft([]);
    setMode(save ? 'try' : 'setup');
  };

  const handles: OverlayHandle[] = [
    { label: t.capture.landmarkTop, hint: t.capture.landmarkHintTop, point: draft[0] ?? { x: 0, y: 0 } },
    { label: t.capture.landmarkRight, hint: t.capture.landmarkHintRight, point: draft[1] ?? { x: 0, y: 0 } },
    { label: t.capture.landmarkBottom, hint: t.capture.landmarkHintBottom, point: draft[2] ?? { x: 0, y: 0 } },
    { label: t.capture.landmarkLeft, hint: t.capture.landmarkHintLeft, point: draft[3] ?? { x: 0, y: 0 } },
  ];

  // ---- try it ------------------------------------------------------------

  /**
   * Writes the marked frame away. Deliberately not done inside a state updater:
   * React calls those twice in development, and a training set with every
   * sample duplicated would be worse than no training set.
   */
  const savePending = useCallback(async () => {
    window.clearTimeout(saveTimer.current);

    const frame = pendingRef.current;
    const current = calibrationRef.current;
    pendingRef.current = null;
    setPending(null);

    if (!frame) return;
    if (!current || frame.darts.length === 0) {
      URL.revokeObjectURL(frame.url);
      return;
    }

    const stored: CapturedFrame = {
      id: newId(),
      ts: Date.now(),
      source: 'lab',
      width: frame.grabbed.width,
      height: frame.grabbed.height,
      jpeg: frame.grabbed.jpeg,
      calibration: {
        imagePoints: current.imagePoints,
        toImage: current.toImage,
        toBoard: current.toBoard,
        error: current.error,
        width: current.width,
        height: current.height,
      },
      darts: frame.darts,
      labelled: true,
    };

    URL.revokeObjectURL(frame.url);
    await putFrame(stored);
    setLastSaved({ id: stored.id, hit: frame.darts[frame.darts.length - 1]!.hit });
    void refreshStats();
  }, [refreshStats]);

  /** Tapping the dart in the photograph: the score comes back out loud. */
  const markDart = (point: Point) => {
    const current = calibrationRef.current;
    if (!pending || !current) return;

    const dart = readDart(current, point);
    unlockCaller();
    if (callerEnabled) caller().say(t.caller.hit(dart.hit));

    setMarked((list) => [...list, { hit: dart.hit, id: newId() }]);
    setPending((frame) => (frame ? { ...frame, darts: [...frame.darts, dart] } : frame));

    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void savePending(), SAVE_DELAY_MS);
  };

  const undoLast = async () => {
    if (pending && pending.darts.length > 0) {
      setPending((frame) => (frame ? { ...frame, darts: frame.darts.slice(0, -1) } : frame));
      setMarked((list) => list.slice(0, -1));
      return;
    }
    if (lastSaved) {
      await deleteFrame(lastSaved.id);
      setLastSaved(null);
      setMarked((list) => list.slice(0, -1));
      void refreshStats();
    }
  };

  // Leaving the screen, or the mode, must not lose a dart already marked.
  useEffect(
    () => () => {
      window.clearTimeout(saveTimer.current);
      if (pendingRef.current && pendingRef.current.darts.length > 0) void savePending();
    },
    [savePending],
  );

  useEffect(() => {
    if (mode !== 'try' && pendingRef.current) void savePending();
  }, [mode, savePending]);

  useEffect(
    () => () => {
      if (frozen) URL.revokeObjectURL(frozen.url);
    },
    [frozen],
  );

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
    void refreshStats();
  };

  const overlayToImage =
    mode === 'calibrate'
      ? draftCalibration?.toImage ?? null
      : staleCalibration
        ? null
        : calibration?.toImage ?? null;

  const ready = (cameraOn || paired) && calibration !== null && !staleCalibration;

  return (
    <div className="screen screen-capture">
      <header className="screen-head">
        <h1>{t.capture.title}</h1>
        <p>{mode === 'try' ? t.capture.trySubtitle : t.capture.subtitle}</p>
      </header>

      {!cameraSupported() && <p className="warning">{t.capture.noCamera}</p>}
      {camera.error && <p className="warning">{camera.error}</p>}
      {staleCalibration && mode !== 'calibrate' && (
        <p className="warning">
          {fill(t.capture.calibrateStale, {
            old: `${calibration!.width}×${calibration!.height}`,
            now: `${camera.width}×${camera.height}`,
          })}
        </p>
      )}

      {(cameraOn || paired) && mode !== 'try' && (
        <SetupCoach
          calibrated={mode === 'calibrate' ? draftCalibration !== null : calibration !== null}
          view={view}
          quality={camera.quality}
          showNumbers
        />
      )}

      {mode === 'try' && (
        <div className={`coach ${pending ? 'coach-warn' : 'coach-ready'}`} role="status">
          <span className="coach-dot" aria-hidden="true" />
          <span className="coach-message">
            {pending
              ? pending.darts.length === 0
                ? t.capture.tapTheDart
                : t.capture.tapAnother
              : t.capture.throwOne}
          </span>
        </div>
      )}

      <div className="stage" style={{ aspectRatio: `${frameSize.width} / ${frameSize.height}` }}>
        <video ref={camera.videoRef} className="stage-video" playsInline muted />
        {mode === 'calibrate' && frozen && <img className="stage-frozen" src={frozen.url} alt="" />}
        {mode === 'try' && pending && <img className="stage-frozen" src={pending.url} alt="" />}

        <BoardOverlay
          width={frameSize.width}
          height={frameSize.height}
          toImage={overlayToImage}
          handles={mode === 'calibrate' ? handles : []}
          onHandleMove={(index, point) =>
            setDraft((points) => points.map((p, i) => (i === index ? point : p)))
          }
          darts={
            mode === 'try' && pending
              ? pending.darts.map((dart) => ({ img: dart.img, label: formatHit(dart.hit) }))
              : []
          }
          onDartMove={(index, point) => {
            const current = calibrationRef.current;
            if (!current) return;
            setPending((frame) =>
              frame
                ? { ...frame, darts: frame.darts.map((dart, i) => (i === index ? readDart(current, point) : dart)) }
                : frame,
            );
          }}
          onTap={(point) => {
            if (mode === 'try' && pending) markDart(point);
          }}
        />

        {mode === 'try' && !pending && (cameraOn || paired) && (
          <div className="stage-badge">
            {camera.moving ? t.capture.moving : t.capture.waiting} · {camera.motion.toFixed(1)} /{' '}
            {camera.change.toFixed(1)}
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
            <button
              type="button"
              className="primary"
              onClick={() => finishCalibration(true)}
              disabled={!draftCalibration}
            >
              {t.capture.calibrateSave}
            </button>
            <button type="button" className="chip" onClick={() => finishCalibration(false)}>
              {t.capture.calibrateCancel}
            </button>
          </div>
        </section>
      )}

      {mode === 'try' && (
        <>
          {marked.length > 0 && (
            <div className="throw-strip">
              <span className="throw-who">{fill(t.capture.markedCount, { n: marked.length })}</span>
              <span className="throw-darts">
                {marked.slice(-4).map((entry) => (
                  <span key={entry.id} className="dart-chip">
                    {formatHit(entry.hit)}
                  </span>
                ))}
              </span>
            </div>
          )}

          <p className="hint">{t.capture.tryHelp}</p>

          <div className="controls">
            <button
              type="button"
              className="chip"
              onClick={async () => {
                const grabbed = await camera.capture();
                if (grabbed) onSettle(grabbed);
              }}
              disabled={!camera.ready}
            >
              {t.capture.captureNow}
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => void undoLast()}
              disabled={marked.length === 0}
            >
              {t.capture.undo}
            </button>
            <button type="button" className="chip" onClick={() => setMode('setup')}>
              {t.capture.doneTrying}
            </button>
          </div>
        </>
      )}

      {mode === 'setup' && (
        <>
          <div className="controls">
            {paired ? (
              <span className="chip chip-on">{t.capture.phoneCamera}</span>
            ) : (
              <button
                type="button"
                className={`chip${cameraOn ? ' chip-on' : ''}`}
                onClick={() => setCameraOn((on) => !on)}
              >
                {cameraOn ? t.capture.stop : t.capture.start}
              </button>
            )}
            <button type="button" className="chip" onClick={() => void startCalibration()} disabled={!camera.ready}>
              {calibration ? t.capture.recalibrate : t.capture.calibrate}
            </button>
          </div>

          <button
            type="button"
            className="primary"
            onClick={() => {
              unlockCaller();
              setMode('try');
            }}
            disabled={!ready}
          >
            {t.capture.tryIt}
          </button>

          <section className="panel">
            <h2>{t.capture.stepsTitle}</h2>
            <ol className="steps">
              {t.capture.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </section>
        </>
      )}

      <section className="panel">
        <h2>{t.capture.frames}</h2>
        <p>
          <b>{stats.labelled}</b> {t.capture.labelled} ·{' '}
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
        <button type="button" className="chip" onClick={() => setScreen('landing')}>
          {t.capture.back}
        </button>
      </div>
    </div>
  );
}
