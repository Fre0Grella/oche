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
 *
 * The darts are not pulled between throws, because a model has to learn the
 * second and third dart of a visit with the first ones in the way. So each
 * photograph opens with the darts already in the board marked where they were
 * (see `storage/visit.ts`), only the new one is left to tap, and nothing is
 * ever saved except by pressing Save: a frame with a visible dart unmarked, or
 * a model's guess nobody checked, would teach the model something wrong. A
 * settle — any moment the board goes still — never saves; a newer photograph
 * waits behind one that is being marked.
 */

import {
  CALIBRATION_BOARD_POINTS,
  assessBoardView,
  boardRegion,
  formatHit,
  type Hit,
  type Point,
} from '@treblewise/core';
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
import { carriedInto, inBoardAfter, newDarts, onNewPhoto, proposalsBeside, worthSaving } from '../storage/visit.js';
import { useMatchStore } from '../store/match.js';
import { THUMB_SIZE, cameraSupported, type GrabbedFrame } from '../vision/camera.js';
import { loadDetector, loadManifest, type Detector, type ModelManifest } from '../vision/detector.js';
import { squareAround } from '../vision/crop.js';
import { boardLooksEmpty } from '../vision/imageStats.js';
import { useCamera } from '../vision/useCamera.js';

type Mode = 'setup' | 'calibrate' | 'try';

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
  /** The darts carried from earlier photographs of the visit come first. */
  darts: LabelledDart[];
  carried: number;
  /** Anything tapped, dragged or removed: from then on it is worth saving. */
  edited: boolean;
  /** Darts the model proposed on this photograph, appended after the carried ones. */
  proposed: number;
  /** The model is still looking. */
  checking: boolean;
  /** The model looked and found no new dart: said on screen, so it is not mistaken for proposals being off. */
  missed: boolean;
  /** The model could not run on this photograph. */
  failed: boolean;
  /** Held back from the model on purpose, so a person marks it: see BLIND_SHARE. */
  blind: boolean;
  /** The model that proposed, for the record. */
  model?: string;
}

/**
 * With the autoscorer proposing, one visit in five is still left for a person
 * to mark from scratch. A visit where the model proposed anything can never be
 * in a test set (the model would be marking its own homework; see
 * ml/treblewise_ml/sources.py), so without these the test set would only grow when
 * proposals are switched off. It is decided per visit, not per photograph:
 * the three photographs of a visit are one unit to the split, and a visit is
 * only clean if the model was kept out of all of it.
 */
const BLIND_SHARE = 0.2;

export function Capture() {
  const t = useStrings();
  const goHome = useMatchStore((s) => s.goHome);
  const setScreen = useMatchStore((s) => s.setScreen);
  const calibration = useMatchStore((s) => s.settings.calibration);
  const saveCalibration = useMatchStore((s) => s.saveCalibration);
  const callerEnabled = useMatchStore((s) => s.settings.callerEnabled);
  const playMode = useMatchStore((s) => s.mode);
  const remoteStream = useMatchStore((s) => s.remoteStream);
  const pairing = useMatchStore((s) => s.pairing);

  const [cameraOn, setCameraOn] = useState(false);
  const [mode, setMode] = useState<Mode>('setup');
  const [draft, setDraft] = useState<Point[]>([]);
  const [frozen, setFrozen] = useState<{ url: string; width: number; height: number } | null>(null);

  const [pending, setPending] = useState<PendingFrame | null>(null);
  const [marked, setMarked] = useState<{ hit: Hit; id: string }[]>([]);
  const [lastSaved, setLastSaved] = useState<{ id: string; added: number; inBoardBefore: LabelledDart[] } | null>(
    null,
  );
  /** The darts in the board as of the last saved photograph. */
  const [inBoard, setInBoard] = useState<LabelledDart[]>([]);
  /** The model the site ships, known from its manifest; the model itself loads only when asked for. */
  const [modelInfo, setModelInfo] = useState<ModelManifest | null>(null);
  const [detector, setDetector] = useState<Detector | null>(null);
  // Off until a model has been tested on this board (issue #5): a proposal
  // from one that has not marks flights as often as tips.
  const [proposing, setProposing] = useState(false);
  /** The newest photograph, held back while the one on screen is being marked. */
  const [waiting, setWaiting] = useState<GrabbedFrame | null>(null);
  /** Leaving with marks on screen that are not saved: ask first. */
  const [leaving, setLeaving] = useState<'done' | 'back' | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  /** Photographs where the model proposed: let stand, or corrected. */
  const [verdicts, setVerdicts] = useState({ right: 0, corrected: 0 });

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
  const inBoardRef = useRef(inBoard);
  inBoardRef.current = inBoard;
  const waitingRef = useRef(waiting);
  waitingRef.current = waiting;
  const detectorRef = useRef(detector);
  detectorRef.current = proposing ? detector : null;
  /**
   * Whether the model is kept out of the current visit. Rolled when a visit
   * starts, and only then: rolled on every photograph of an empty board, a
   * blind one (nothing proposed, so nothing to keep it on screen) was replaced
   * by the next settle and rolled again, until a proposal stuck. Visits were
   * almost never blind, and the test set never grew.
   */
  const [firstVisitBlind] = useState(() => Math.random() < BLIND_SHARE);
  const blindVisitRef = useRef(firstVisitBlind);
  const startVisit = () => {
    blindVisitRef.current = Math.random() < BLIND_SHARE;
  };
  /**
   * A full visit was saved and its darts are still in the board until someone
   * pulls them: the pull-out phase. The photographs taken meanwhile show a
   * hand reaching in, or darts half out; opened, they asked for a dart to be
   * tapped and the model proposed the old darts as new ones. So during this
   * phase no photograph is opened at all, and the coach says to pull the darts
   * out. It ends when the board looks as it did at calibration again, or when
   * a person says the darts are out.
   */
  const awaitingEmptyRef = useRef(false);
  const [pullingOut, setPullingOut] = useState(false);
  const setAwaitingEmpty = (awaiting: boolean) => {
    awaitingEmptyRef.current = awaiting;
    setPullingOut(awaiting);
  };
  /** What each settled photograph looked like to the empty-board check. */
  const emptyFrames = useRef(new WeakMap<GrabbedFrame, boolean>());
  const emptyReferenceRef = useRef<Uint8Array | null>(null);
  const callerRef = useRef(callerEnabled);
  callerRef.current = callerEnabled;

  const paired = playMode === 'paired' && remoteStream !== null;

  const refreshStats = useCallback(async () => {
    setStats(await countFrames());
    setUsage(await storageEstimate());
  }, []);

  useEffect(() => {
    void refreshStats();
  }, [refreshStats]);

  /**
   * Writes the marked frame away. Deliberately not done inside a state updater:
   * React calls those twice in development, and a training set with every
   * sample duplicated would be worse than no training set.
   */
  const savePending = useCallback(async () => {
    const frame = pendingRef.current;
    setLeaving(null);
    const current = calibrationRef.current;
    pendingRef.current = null;
    setPending(null);

    if (!frame) return;
    if (!current || !worthSaving(frame)) {
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
      ...(frame.proposed > 0 && frame.model ? { model: frame.model } : {}),
    };
    if (frame.proposed > 0) {
      const letStand = !frame.edited;
      setVerdicts((v) => (letStand ? { ...v, right: v.right + 1 } : { ...v, corrected: v.corrected + 1 }));
    }

    // The next photograph opens with these marks, so the ref moves now rather
    // than whenever React re-renders.
    const before = inBoardRef.current;
    const after = inBoardAfter(frame.darts);
    inBoardRef.current = after;
    setInBoard(after);
    setAwaitingEmpty(after.length === 0);
    if (after.length === 0) startVisit();

    URL.revokeObjectURL(frame.url);
    await putFrame(stored);
    setLastSaved({ id: stored.id, added: newDarts(frame.darts, frame.carried).length, inBoardBefore: before });
    setSavedNote(
      fill(t.capture.savedNote, {
        n: frame.darts.length,
        hits: frame.darts.map((dart) => formatHit(dart.hit)).join(', '),
      }),
    );
    void refreshStats();
    openWaiting();
  }, [refreshStats, t]);

  /** Drops the photograph on screen without saving it. */
  const discardPending = useCallback(() => {
    const frame = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    setLeaving(null);
    if (frame) URL.revokeObjectURL(frame.url);
    openWaiting();
  }, []);

  /** The photograph that waited behind the last one, now that it is done with. */
  function openWaiting() {
    const next = waitingRef.current;
    waitingRef.current = null;
    setWaiting(null);
    if (next) openFrameRef.current(next);
  }

  const openFrame = useCallback((grabbed: GrabbedFrame) => {
    const carried = carriedInto(inBoardRef.current);
    const model = detectorRef.current;
    const current = calibrationRef.current;
    const empty = emptyFrames.current.get(grabbed) === true;
    // Pulling the darts out: nothing to mark until the board is empty, and an
    // empty board with no darts carried is nothing to mark either. Either way
    // the photograph on screen, if nobody has started on it, goes too.
    if (awaitingEmptyRef.current || (empty && carried.length === 0)) {
      if (empty) setAwaitingEmpty(false);
      const previous = pendingRef.current;
      if (previous && onNewPhoto(previous) === 'replace') {
        URL.revokeObjectURL(previous.url);
        pendingRef.current = null;
        setPending(null);
      }
      return;
    }
    const blind = model !== null && blindVisitRef.current;
    const checking = model !== null && current !== null && !blind;
    const previous = pendingRef.current;
    if (previous) URL.revokeObjectURL(previous.url);
    const opened: PendingFrame = {
      grabbed,
      url: URL.createObjectURL(grabbed.jpeg),
      darts: carried,
      carried: carried.length,
      edited: false,
      proposed: 0,
      checking,
      missed: false,
      failed: false,
      blind,
      ...(model ? { model: model.manifest.name } : {}),
    };
    // The ref moves now, not on the next render: a fast model can answer
    // before React has drawn the photograph, and its answer must still find it.
    pendingRef.current = opened;
    setPending(opened);
    if (!checking || !model || !current) return;

    let failed = false;
    void model
      .detect(grabbed, current)
      .catch((cause: unknown) => {
        console.warn('[treblewise] the autoscorer failed on a photograph:', cause);
        failed = true;
        return [];
      })
      .then((detections) => {
        // Only onto the same photograph, and only if nobody has started on it.
        const frame = pendingRef.current;
        if (!frame || frame.grabbed !== grabbed) return;
        // One new dart per photograph is the normal case; a second is rarer than
        // a phantom from a model that has not seen this board, so the strongest
        // one is proposed and a genuine second dart is tapped by hand.
        const fresh = frame.edited ? [] : proposalsBeside(detections, frame.darts).slice(0, 1);
        const marks: LabelledDart[] = fresh.map((d) => ({ img: d.img, board: d.board, hit: d.hit, by: 'model' }));
        const next = {
          ...frame,
          darts: [...frame.darts, ...marks],
          proposed: marks.length,
          checking: false,
          missed: !failed && marks.length === 0,
          failed,
        };
        pendingRef.current = next;
        setPending((p) => (p && p.grabbed === grabbed ? next : p));
        if (marks.length > 0 && callerRef.current) {
          unlockCaller();
          marks.forEach((mark) => caller().say(t.caller.hit(mark.hit)));
        }
      });
  }, [t]);
  const openFrameRef = useRef(openFrame);
  openFrameRef.current = openFrame;

  /**
   * A settled frame becomes the one on screen to mark, unless someone is
   * marking the one there now: then it waits, and opens after Save or Skip.
   * Nothing is ever saved here (issue #3).
   */
  const onSettle = useCallback(
    (grabbed: GrabbedFrame, thumbnail?: Uint8Array) => {
      if (modeRef.current !== 'try') return;
      const current = calibrationRef.current;
      if (!current) return;
      if (current.width !== grabbed.width || current.height !== grabbed.height) return;
      const reference = emptyReferenceRef.current;
      if (thumbnail && reference) {
        emptyFrames.current.set(grabbed, boardLooksEmpty(thumbnail, reference, THUMB_SIZE, THUMB_SIZE));
      }

      if (onNewPhoto(pendingRef.current) === 'wait') {
        waitingRef.current = grabbed;
        setWaiting(grabbed);
        return;
      }
      openFrame(grabbed);
    },
    [openFrame],
  );

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
  emptyReferenceRef.current = reference;

  const camera = useCamera({
    active: cameraOn || paired,
    onSettle,
    captureOnSettle: mode === 'try' && calibration !== null,
    region,
    reference,
    stream: paired ? remoteStream : null,
    grab: paired && pairing ? () => pairing.requestPhoto() : null,
    // Aligning the board is done on a still photograph: nothing to watch for.
    paused: mode === 'calibrate',
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

  // Marking darts needs the board, not the wall around it: once calibrated,
  // only the square around the board is shown. Calibrating needs the lot.
  const crop =
    mode === 'try' && region && !staleCalibration && calibration?.width === frameSize.width
      ? squareAround(region, frameSize)
      : null;

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

  /** Tapping the dart in the photograph: the score comes back out loud. */
  const markDart = (point: Point) => {
    const current = calibrationRef.current;
    if (!pending || !current) return;

    const dart = readDart(current, point);
    unlockCaller();
    if (callerEnabled) caller().say(t.caller.hit(dart.hit));

    setMarked((list) => [...list, { hit: dart.hit, id: newId() }]);
    setPending((frame) => (frame ? { ...frame, darts: [...frame.darts, dart], edited: true } : frame));
    setSavedNote(null);
  };

  /**
   * Takes the last mark off the photograph on screen: the dart just tapped, or,
   * once those are gone, a carried one, which is how a dart that fell out is
   * removed. With nothing on screen it deletes the last saved photograph.
   */
  const undoLast = async () => {
    if (pending && pending.darts.length > 0) {
      const wasNew = pending.darts.length > pending.carried;
      setPending((frame) =>
        frame
          ? {
              ...frame,
              darts: frame.darts.slice(0, -1),
              carried: Math.min(frame.carried, frame.darts.length - 1),
              edited: true,
            }
          : frame,
      );
      if (wasNew) setMarked((list) => list.slice(0, -1));
      return;
    }
    if (lastSaved) {
      await deleteFrame(lastSaved.id);
      inBoardRef.current = lastSaved.inBoardBefore;
      setInBoard(lastSaved.inBoardBefore);
      setAwaitingEmpty(false);
      setMarked((list) => list.slice(0, list.length - lastSaved.added));
      setLastSaved(null);
      void refreshStats();
    }
  };

  /**
   * The darts came out, before the third or after it: forget them, here and on
   * screen, and let the model propose again.
   */
  const boardCleared = () => {
    inBoardRef.current = [];
    setInBoard([]);
    setAwaitingEmpty(false);
    startVisit();
    setPending((frame) =>
      frame
        ? {
            ...frame,
            darts: frame.darts.slice(frame.carried),
            carried: 0,
            edited: frame.darts.length > frame.carried,
          }
        : frame,
    );
  };

  // Unmounting cannot ask, so it saves nothing: Back asks first (see leave()).
  useEffect(
    () => () => {
      if (pendingRef.current) URL.revokeObjectURL(pendingRef.current.url);
    },
    [],
  );

  useEffect(() => {
    if (mode !== 'try') return;
    let cancelled = false;
    void loadManifest().then((loaded) => {
      if (!cancelled) setModelInfo(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  // The runtime and the model are only fetched once proposals are switched on.
  useEffect(() => {
    if (!proposing || !modelInfo || detector) return;
    let cancelled = false;
    void loadDetector().then((loaded) => {
      if (cancelled) return;
      setDetector(loaded);
      if (!loaded) setProposing(false); // it could not be loaded here: say so by switching back off
    });
    return () => {
      cancelled = true;
    };
  }, [proposing, modelInfo, detector]);

  // Leaving try-it ends the visit: by the time anyone comes back the darts may
  // be out, or the camera recalibrated, and a carried mark would be a ghost.
  useEffect(() => {
    if (mode === 'try') return;
    if (pendingRef.current) discardPending();
    waitingRef.current = null;
    setWaiting(null);
    inBoardRef.current = [];
    setInBoard([]);
    setAwaitingEmpty(false);
    startVisit();
  }, [mode, discardPending]);

  /** Done or Back: straight away, unless there are marks nobody saved. */
  const leave = (where: 'done' | 'back') => {
    if (pendingRef.current && worthSaving(pendingRef.current)) {
      setLeaving(where);
      return;
    }
    setLeaving(null);
    if (where === 'done') setMode('setup');
    else goHome();
  };

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
      download(blob, `treblewise-captures-${new Date().toISOString().slice(0, 10)}.zip`);
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

  function coachMessage(): string {
    if (!pending && pullingOut) return t.capture.pullOut;
    if (!pending) return inBoard.length > 0 ? fill(t.capture.throwNext, { n: inBoard.length }) : t.capture.throwOne;
    if (pending.checking) return t.capture.looking;
    if (pending.proposed > 0 && !pending.edited) {
      const hits = pending.darts.slice(-pending.proposed).map((dart) => formatHit(dart.hit));
      return fill(t.capture.proposal, { hits: hits.join(', ') });
    }
    const fresh = pending.darts.length - pending.carried;
    if (fresh === 0 && pending.failed) return t.capture.modelFailed;
    if (fresh === 0 && pending.missed) return t.capture.modelSawNothing;
    if (fresh > 0) {
      return fill(t.capture.markedSoFar, { carried: pending.carried, fresh, total: pending.darts.length });
    }
    return pending.carried > 0 ? fill(t.capture.tapTheNewDart, { n: pending.carried }) : t.capture.tapTheDart;
  }

  return (
    <div className={`screen screen-capture${mode === 'try' ? ' screen-capture-try' : ''}`}>
      {/* One tree in every mode, so the video element is never remounted (it
          would lose its stream). The layout changes in CSS: in try-it on a wide
          screen the side column holds everything to read and press, and the
          board sits beside it; elsewhere it all stacks, board under the coach. */}
      <div className={`capture-work${mode === 'try' ? ' capture-work-split' : ''}`}>
        <div className="capture-side">
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
            <div className={`coach ${pending || pullingOut ? 'coach-warn' : 'coach-ready'}`} role="status">
              <span className="coach-dot" aria-hidden="true" />
              <span className="coach-message">{coachMessage()}</span>
            </div>
          )}

          {mode === 'try' && (cameraOn || paired) && (
            <p className="capture-status">
              {camera.moving ? t.capture.moving : t.capture.waiting} · {camera.motion.toFixed(1)} /{' '}
              {camera.change.toFixed(1)} · {fill(t.capture.photoSize, { size: `${camera.width}×${camera.height}` })}
            </p>
          )}

          {mode === 'try' && (
            <div className="capture-actions">
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

              <p className="hint">
                <b>{t.capture.markEveryDart}</b> {t.capture.tryHelp}
              </p>
              {savedNote && <p className="hint">{savedNote}</p>}
              {waiting && <p className="warning">{t.capture.photoWaiting}</p>}
              {leaving && (
                <div className="panel" role="alertdialog" aria-label={t.capture.unsavedTitle}>
                  <p>{t.capture.unsavedTitle}</p>
                  <div className="controls">
                    <button
                      type="button"
                      className="primary"
                      onClick={async () => {
                        const where = leaving;
                        await savePending();
                        leave(where);
                      }}
                    >
                      {t.capture.unsavedSave}
                    </button>
                    <button
                      type="button"
                      className="chip"
                      onClick={() => {
                        const where = leaving;
                        discardPending();
                        leave(where);
                      }}
                    >
                      {t.capture.unsavedDiscard}
                    </button>
                    <button type="button" className="chip" onClick={() => setLeaving(null)}>
                      {t.capture.unsavedStay}
                    </button>
                  </div>
                </div>
              )}

              {modelInfo && (
                <section className="panel">
                  <div className="controls">
                    <button
                      type="button"
                      className={`chip${proposing ? ' chip-on' : ''}`}
                      onClick={() => setProposing((on) => !on)}
                    >
                      {proposing ? (detector ? t.capture.proposingOn : t.capture.proposingLoading) : t.capture.proposingOff}
                    </button>
                  </div>
                  <p className="hint">
                    {proposing ? t.capture.proposingHelp : t.capture.proposingOffHelp}
                    {pending?.blind && ` ${t.capture.blindFrame}`}
                  </p>
                  {verdicts.right + verdicts.corrected > 0 && (
                    <p className="hint">
                      {fill(t.capture.verdicts, { right: verdicts.right, n: verdicts.right + verdicts.corrected })}
                    </p>
                  )}
                  <p className="hint">
                    {fill(t.capture.modelName, { name: modelInfo.name })}
                    {modelInfo.deepdarts && ` ${t.capture.deepdartsCredit}`}
                    {modelInfo.dartscribe && ` ${t.capture.dartscribeCredit}`}
                  </p>
                </section>
              )}

              <div className="controls">
                <button
                  type="button"
                  className="primary"
                  onClick={() => void savePending()}
                  disabled={!pending || !worthSaving(pending)}
                >
                  {pending && pending.proposed > 0 && !pending.edited
                    ? t.capture.saveProposal
                    : pending && pending.darts.length > 0
                      ? fill(t.capture.saveFrame, { n: pending.darts.length })
                      : t.capture.saveFrameEmpty}
                </button>
                <button type="button" className="chip" onClick={discardPending} disabled={!pending}>
                  {t.capture.skipPhoto}
                </button>
                <button
                  type="button"
                  className="chip"
                  onClick={boardCleared}
                  // Also the way out when the empty-board check cannot see the
                  // darts are gone (a shadow that was not there at calibration).
                  disabled={inBoard.length === 0 && (!pending || pending.carried === 0) && !pullingOut}
                >
                  {t.capture.boardCleared}
                </button>
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
                  disabled={(pending?.darts.length ?? 0) === 0 && !lastSaved}
                >
                  {t.capture.undo}
                </button>
                <button type="button" className="chip" onClick={() => leave('done')}>
                  {t.capture.doneTrying}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="stage" style={{ aspectRatio: crop ? '1 / 1' : `${frameSize.width} / ${frameSize.height}` }}>
          <div
            className="stage-frame"
            style={
              crop
                ? {
                    inset: 'auto',
                    left: `${(-crop.x / crop.width) * 100}%`,
                    top: `${(-crop.y / crop.height) * 100}%`,
                    width: `${(frameSize.width / crop.width) * 100}%`,
                    height: `${(frameSize.height / crop.height) * 100}%`,
                  }
                : undefined
            }
          >
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
                  ? pending.darts.map((dart, index) => ({
                      img: dart.img,
                      label: dart.by === 'model' ? `${formatHit(dart.hit)}?` : formatHit(dart.hit),
                      kind: index < pending.carried ? ('carried' as const) : dart.by === 'model' ? ('proposed' as const) : ('new' as const),
                    }))
                  : []
              }
              onDartMove={(index, point) => {
                const current = calibrationRef.current;
                if (!current) return;
                setPending((frame) =>
                  frame
                    ? {
                        ...frame,
                        darts: frame.darts.map((dart, i) => (i === index ? readDart(current, point) : dart)),
                        edited: true,
                      }
                    : frame,
                );
              }}
              onTap={(point) => {
                if (mode === 'try' && pending) markDart(point);
              }}
            />
          </div>
        </div>
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
          <button type="button" className="chip" onClick={() => setScreen('review')} disabled={stats.total === 0}>
            {t.review.open}
          </button>
          <button type="button" className="chip" onClick={() => void deleteAll()} disabled={stats.total === 0}>
            {confirmDelete ? t.capture.deleteAllConfirm : t.capture.deleteAll}
          </button>
        </div>
      </section>

      <div className="screen-actions">
        <button type="button" className="chip" onClick={() => leave('back')}>
          {t.capture.back}
        </button>
      </div>
    </div>
  );
}
