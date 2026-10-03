/**
 * The camera as a hook: a stream, a video element to attach it to, and a
 * per-frame motion gate that calls back when the board has settled.
 *
 * Only one component mounts this at a time — the capture lab or the game's
 * camera panel — because two of them would fight over the same camera.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  grabJpeg,
  keepAwake,
  startCamera,
  stopCamera,
  thumbnail,
  THUMB_SIZE,
  type GrabbedFrame,
  type Region,
} from './camera.js';
import { assessImage, type ImageQuality } from './imageStats.js';
import { SettleDetector } from './settle.js';

/** How long after a photograph from the phone arrives the video is still watched for movement. */
const REMOTE_PHOTO_GUARD_MS = 250;

export interface UseCameraOptions {
  active: boolean;
  deviceId?: string;
  /**
   * Video from somewhere else — in paired mode, the phone's camera arriving
   * over WebRTC. When set, this hook watches that stream instead of opening a
   * camera of its own, and everything downstream is identical.
   */
  stream?: MediaStream | null;
  /**
   * Where photographs come from, when not from the video on screen. In paired
   * mode that video is a compressed, downscaled copy, so the phone takes the
   * photograph itself (`pairing/photo.ts`). Sizes the hook reports, and the
   * region it is given, are then those of the photograph, not of the video. If
   * the first photograph never arrives — an older phone build — the video is
   * used after all.
   */
  grab?: (() => Promise<GrabbedFrame | null>) | null;
  /**
   * Keep the camera on but stop watching it: no thumbnails, no settle
   * detection. For screens where a still photograph is on top and a person is
   * dragging markers, and every bit of the phone should go to their finger.
   */
  paused?: boolean;
  /**
   * Called once per throw, with the frame taken when the board went still and
   * the board-region thumbnail that showed it still.
   */
  onSettle?: (frame: GrabbedFrame, thumbnail: Uint8Array, before: Uint8Array | null) => void;
  /** Set false to watch for motion without photographing anything. */
  captureOnSettle?: boolean;
  /**
   * The board's rectangle in the image. The capture trigger looks only inside
   * it — see `settle.ts` for why a whole-frame view cannot see a dart.
   */
  region?: Region | null;
  /**
   * The board as it looked when it was calibrated. Used to notice that the
   * camera has been moved since, which invalidates the calibration.
   */
  reference?: Uint8Array | null;
}

export interface CameraState {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  ready: boolean;
  error: string | null;
  width: number;
  height: number;
  moving: boolean;
  /** Frames captured since the camera started, for the UI's counter. */
  settles: number;
  /** The two numbers the capture trigger works on, for tuning on a real board. */
  motion: number;
  change: number;
  /**
   * The last photograph: how long from the settle to having it, and how many
   * have been dropped because the board changed while they were taken.
   */
  photo: { ms: number; dropped: number } | null;
  /** Light, glare, sharpness and drift, for the setup coach. */
  quality: ImageQuality | null;
  capture: () => Promise<GrabbedFrame | null>;
  /** The current board-region thumbnail, for storing as a calibration reference. */
  sampleThumbnail: (region?: Region | null) => Uint8Array | null;
}

export function useCamera({
  active,
  deviceId,
  onSettle,
  captureOnSettle = true,
  region = null,
  reference = null,
  stream: externalStream = null,
  grab = null,
  paused = false,
}: UseCameraOptions): CameraState {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detector = useRef(new SettleDetector({ width: THUMB_SIZE, height: THUMB_SIZE }));
  const settleHandler = useRef(onSettle);
  const capturing = useRef(false);
  const dropped = useRef(0);
  const regionRef = useRef(region);
  regionRef.current = region;
  const referenceRef = useRef(reference);
  referenceRef.current = reference;

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [moving, setMoving] = useState(false);
  const [settles, setSettles] = useState(0);
  const [readout, setReadout] = useState({ motion: 0, change: 0 });
  const [photoStats, setPhotoStats] = useState<{ ms: number; dropped: number } | null>(null);
  const [quality, setQuality] = useState<ImageQuality | null>(null);

  settleHandler.current = onSettle;
  const grabRef = useRef(grab);
  grabRef.current = grab;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  /** The photograph's size when it is not the video's; null while it is. */
  const photoSize = useRef<{ width: number; height: number } | null>(null);

  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return null;
    if (photoSize.current && grabRef.current) return grabRef.current();
    return grabJpeg(video);
  }, []);

  const sampleThumbnail = useCallback((sampleRegion?: Region | null) => {
    const video = videoRef.current;
    if (!video) return null;
    return thumbnail(video, toVideo(video, sampleRegion === undefined ? regionRef.current : sampleRegion));
  }, []);

  /** A region in photograph pixels, in the video's pixels instead. */
  function toVideo(video: HTMLVideoElement, area: Region | null): Region | null {
    const photo = photoSize.current;
    if (!area || !photo || video.videoWidth === 0) return area;
    const sx = video.videoWidth / photo.width;
    const sy = video.videoHeight / photo.height;
    return { x: area.x * sx, y: area.y * sy, width: area.width * sx, height: area.height * sy };
  }

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    let frame = 0;
    let lastReadoutAt = 0;
    let wakeLock: WakeLockSentinel | null = null;

    const run = async () => {
      try {
        const stream = externalStream ?? (await startCamera(deviceId));
        if (cancelled) {
          if (!externalStream) stopCamera(stream);
          return;
        }
        // A stream we were handed belongs to whoever handed it over: it is not
        // ours to stop when this component unmounts.
        streamRef.current = externalStream ? null : stream;
        const video = videoRef.current;
        if (!video) return;

        video.srcObject = stream;
        video.playsInline = true;
        video.muted = true;
        await video.play().catch(() => undefined);

        // One photograph up front, to learn its size: calibration, the overlay
        // and the stale-calibration check all work in photograph pixels.
        photoSize.current = null;
        const probe = grabRef.current ? await grabRef.current() : null;
        if (cancelled) return;
        if (probe) photoSize.current = { width: probe.width, height: probe.height };

        setSize(photoSize.current ?? { width: video.videoWidth, height: video.videoHeight });
        setReady(true);
        setError(null);
        detector.current.reset();
        // The phone holds its own wake lock in paired mode.
        if (!externalStream) wakeLock = await keepAwake();

        const tick = () => {
          if (cancelled) return;
          frame = requestAnimationFrame(tick);

          const element = videoRef.current;
          if (!element) return;
          // The received video changes size with the bandwidth; the photograph
          // does not, so only a local camera's size is tracked here.
          if (!photoSize.current && element.videoWidth !== 0 && element.videoWidth !== size.width) {
            setSize({ width: element.videoWidth, height: element.videoHeight });
          }

          if (pausedRef.current) return;

          const thumb = thumbnail(element, toVideo(element, regionRef.current));
          if (!thumb) return;

          const now = performance.now();
          const state = detector.current.push(thumb, now);
          setMoving(state === 'moving');

          // Re-rendering on every frame to show two numbers would cost more
          // than the detector does, so the readout updates a few times a second.
          if (now - lastReadoutAt > 250) {
            lastReadoutAt = now;
            setReadout({ motion: detector.current.motion, change: detector.current.change });
            setQuality(assessImage(thumb, THUMB_SIZE, THUMB_SIZE, referenceRef.current));
          }

          if (state === 'settled' && captureOnSettle && !capturing.current) {
            capturing.current = true;
            const remote = photoSize.current !== null && grabRef.current !== null;
            const before = detector.current.previousReference;
            const photograph = remote ? grabRef.current!() : grabJpeg(element);
            void photograph
              .then(async (grabbed) => {
                const took = Math.round(performance.now() - now);
                // A frame of the video on screen is the still frame the settle
                // saw. A photograph from the phone is taken some time later,
                // after a round trip, and the next dart can be in the air by
                // then. The video showing that moment arrives a little after
                // the photograph, hence the wait before looking.
                if (grabbed && remote) {
                  await new Promise((resolve) => setTimeout(resolve, REMOTE_PHOTO_GUARD_MS));
                  if (detector.current.changedSince(thumb)) {
                    detector.current.rewind();
                    dropped.current += 1;
                    setPhotoStats({ ms: took, dropped: dropped.current });
                    console.info(`[treblewise] photo dropped: the board changed while it was taken (${took} ms)`);
                    return;
                  }
                }
                setPhotoStats({ ms: took, dropped: dropped.current });
                if (grabbed && !cancelled) {
                  setSettles((count) => count + 1);
                  settleHandler.current?.(grabbed, thumb, before);
                }
              })
              .finally(() => {
                capturing.current = false;
              });
          }
        };

        frame = requestAnimationFrame(tick);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
          setReady(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      stopCamera(streamRef.current);
      streamRef.current = null;
      void wakeLock?.release().catch(() => undefined);
      setReady(false);
      setMoving(false);
    };
    // `size` is only read to notice a resolution change; re-running on it would
    // restart the camera every time the video element reports a new size.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, deviceId, captureOnSettle, externalStream]);

  return {
    videoRef,
    ready,
    error,
    width: size.width,
    height: size.height,
    moving,
    settles,
    motion: readout.motion,
    change: readout.change,
    photo: photoStats,
    quality,
    capture,
    sampleThumbnail,
  };
}
