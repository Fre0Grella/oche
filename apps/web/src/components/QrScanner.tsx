/**
 * The other half of pairing: pointing a camera at the other device's screen.
 *
 * It keeps its own camera rather than sharing the game's, because the two want
 * opposite things — the scanner wants the front camera on a laptop and a close
 * focus, the scorer wants the back camera pointed at a board across the room.
 */

import { useEffect, useRef, useState } from 'react';

import { useStrings } from '../i18n/index.js';
import { stopCamera } from '../vision/camera.js';
import { scanFrame } from '../pairing/qr.js';

export interface QrScannerProps {
  /** Called with the first code that scans. The scanner then stops. */
  onCode: (text: string) => void;
  /** 'user' for a laptop webcam, 'environment' for a phone's back camera. */
  facing?: 'user' | 'environment';
  hint?: string;
}

export function QrScanner({ onCode, facing = 'user', hint }: QrScannerProps) {
  const t = useStrings();
  const videoRef = useRef<HTMLVideoElement>(null);
  const handler = useRef(onCode);
  handler.current = onCode;

  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let timer = 0;

    const run = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (cancelled) {
          stopCamera(stream);
          return;
        }

        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        video.playsInline = true;
        video.muted = true;
        await video.play().catch(() => undefined);
        setScanning(true);

        const look = async () => {
          if (cancelled) return;
          const element = videoRef.current;
          if (element) {
            try {
              const code = await scanFrame(element);
              if (code && !cancelled) {
                handler.current(code);
                return; // one code is all we need
              }
            } catch {
              // A frame that fails to decode is the normal case, not an error.
            }
          }
          // Several looks a second: fast enough to feel instant, slow enough to
          // leave the phone's CPU alone.
          timer = window.setTimeout(look, 150);
        };

        void look();
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      }
    };

    void run();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      stopCamera(stream);
      setScanning(false);
    };
  }, [facing]);

  return (
    <div className="scanner">
      <div className="scanner-frame">
        <video ref={videoRef} className="scanner-video" playsInline muted />
        <div className="scanner-reticle" aria-hidden="true" />
      </div>
      <p className="hint">{error ?? hint ?? (scanning ? t.pair.scanning : t.pair.startingCamera)}</p>
    </div>
  );
}
