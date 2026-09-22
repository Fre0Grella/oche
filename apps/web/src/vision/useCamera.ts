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
import { SettleDetector } from './settle.js';

export interface UseCameraOptions {
  active: boolean;
  deviceId?: string;
  /** Called once per throw, with the frame taken when the board went still. */
  onSettle?: (frame: GrabbedFrame) => void;
  /** Set false to watch for motion without photographing anything. */
  captureOnSettle?: boolean;
  /**
   * The board's rectangle in the image. The capture trigger looks only inside
   * it — see `settle.ts` for why a whole-frame view cannot see a dart.
   */
  region?: Region | null;
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
  capture: () => Promise<GrabbedFrame | null>;
}

export function useCamera({
  active,
  deviceId,
  onSettle,
  captureOnSettle = true,
  region = null,
}: UseCameraOptions): CameraState {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detector = useRef(new SettleDetector({ width: THUMB_SIZE, height: THUMB_SIZE }));
  const settleHandler = useRef(onSettle);
  const capturing = useRef(false);
  const regionRef = useRef(region);
  regionRef.current = region;

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [moving, setMoving] = useState(false);
  const [settles, setSettles] = useState(0);
  const [readout, setReadout] = useState({ motion: 0, change: 0 });

  settleHandler.current = onSettle;

  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return null;
    return grabJpeg(video);
  }, []);

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    let frame = 0;
    let lastReadoutAt = 0;
    let wakeLock: WakeLockSentinel | null = null;

    const run = async () => {
      try {
        const stream = await startCamera(deviceId);
        if (cancelled) {
          stopCamera(stream);
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;

        video.srcObject = stream;
        video.playsInline = true;
        video.muted = true;
        await video.play().catch(() => undefined);

        setSize({ width: video.videoWidth, height: video.videoHeight });
        setReady(true);
        setError(null);
        detector.current.reset();
        wakeLock = await keepAwake();

        const tick = () => {
          if (cancelled) return;
          frame = requestAnimationFrame(tick);

          const element = videoRef.current;
          if (!element) return;
          if (element.videoWidth !== 0 && element.videoWidth !== size.width) {
            setSize({ width: element.videoWidth, height: element.videoHeight });
          }

          const thumb = thumbnail(element, regionRef.current);
          if (!thumb) return;

          const now = performance.now();
          const state = detector.current.push(thumb, now);
          setMoving(state === 'moving');

          // Re-rendering on every frame to show two numbers would cost more
          // than the detector does, so the readout updates a few times a second.
          if (now - lastReadoutAt > 250) {
            lastReadoutAt = now;
            setReadout({ motion: detector.current.motion, change: detector.current.change });
          }

          if (state === 'settled' && captureOnSettle && !capturing.current) {
            capturing.current = true;
            void grabJpeg(element)
              .then((grabbed) => {
                if (grabbed && !cancelled) {
                  setSettles((count) => count + 1);
                  settleHandler.current?.(grabbed);
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
  }, [active, deviceId, captureOnSettle]);

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
    capture,
  };
}
