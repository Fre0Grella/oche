/**
 * The phone's side of pairing: be a camera, and nothing else.
 *
 * No inference, no scoring, no bright screen. The phone reads the laptop's
 * code, starts its back camera, shows its answer for the laptop to read, and
 * then sits there sending video with the screen dimmed and the wake lock held.
 *
 * The answer goes up as a picture *and* as a hundred characters of text, because
 * a desktop computer often has no camera to read a picture with. The text can be
 * copied and sent across by any means at hand, or typed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { QrCode } from '../components/QrCode.js';
import { QrScanner } from '../components/QrScanner.js';
import { useStrings } from '../i18n/index.js';
import { PairingConnection } from '../pairing/session.js';
import { formatShortCode } from '../pairing/shortcode.js';
import { useMatchStore } from '../store/match.js';
import { keepAwake, startCamera, stopCamera } from '../vision/camera.js';

type Step = 'scan' | 'answer' | 'live' | 'failed';

export function CameraRole() {
  const t = useStrings();
  const setScreen = useMatchStore((s) => s.setScreen);

  const [step, setStep] = useState<Step>('scan');
  const [answer, setAnswer] = useState<string | null>(null);
  const [shortCode, setShortCode] = useState<string | null>(null);
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [battery, setBattery] = useState<number | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const connection = useRef<PairingConnection | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const wakeLock = useRef<WakeLockSentinel | null>(null);

  const teardown = useCallback(() => {
    connection.current?.close();
    connection.current = null;
    stopCamera(stream.current);
    stream.current = null;
    void wakeLock.current?.release().catch(() => undefined);
    wakeLock.current = null;
  }, []);

  useEffect(() => teardown, [teardown]);

  const onHubCode = async (text: string) => {
    setError(null);
    try {
      const media = await startCamera();
      stream.current = media;

      const joined = await PairingConnection.join(text, media);
      connection.current = joined.connection;
      setAnswer(joined.code);
      setShortCode(joined.shortCode);
      setStep('answer');

      joined.connection.onState = (state) => {
        if (state === 'connected') setStep('live');
        if (state === 'failed') setStep('failed');
      };

      const video = videoRef.current;
      if (video) {
        video.srcObject = media;
        video.playsInline = true;
        video.muted = true;
        await video.play().catch(() => undefined);
      }

      wakeLock.current = await keepAwake();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStep('failed');
      stopCamera(stream.current);
      stream.current = null;
    }
  };

  // Tell the laptop how the phone is doing, so the hub can warn before the
  // battery dies mid-match.
  useEffect(() => {
    if (step !== 'live') return;

    let cancelled = false;
    const report = async () => {
      const navigatorWithBattery = navigator as Navigator & {
        getBattery?: () => Promise<{ level: number; charging: boolean }>;
      };
      const info = await navigatorWithBattery.getBattery?.().catch(() => null);
      if (cancelled) return;

      if (info) setBattery(Math.round(info.level * 100));
      const track = stream.current?.getVideoTracks()[0]?.getSettings();
      connection.current?.send({
        type: 'status',
        ...(info ? { battery: Math.round(info.level * 100), charging: info.charging } : {}),
        ...(track?.width ? { width: track.width, height: track.height } : {}),
      });
    };

    void report();
    const timer = setInterval(() => void report(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [step]);

  return (
    <div className={`screen screen-camera-role${step === 'live' ? ' screen-dim' : ''}`}>
      <header className="screen-head">
        <h1>{t.camera.title}</h1>
        <p>{step === 'live' ? t.camera.liveSubtitle : t.camera.subtitle}</p>
      </header>

      {step === 'scan' && (
        <QrScanner facing="environment" onCode={(text) => void onHubCode(text)} hint={t.camera.scanHint} />
      )}

      {step === 'answer' && answer && (
        <>
          <p className="pair-instruction">{t.camera.showToLaptop}</p>
          <QrCode text={answer} label={t.camera.qrLabel} />
          <p className="hint">{t.camera.waiting}</p>

          {shortCode && (
            <details className="pair-fallback">
              <summary>{t.camera.noCameraThere}</summary>
              <p className="hint">{t.camera.codeHelp}</p>
              <pre className="pair-code">{formatShortCode(shortCode)}</pre>
              <div className="controls">
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    // Copying is the point: nobody should have to type this if
                    // they have any way of sending text to the other machine.
                    navigator.clipboard
                      ?.writeText(formatShortCode(shortCode))
                      .then(() => setCopied('yes'))
                      .catch(() => setCopied('no'));
                  }}
                >
                  {copied === 'yes' ? t.camera.copied : t.camera.copyCode}
                </button>
              </div>
              {copied === 'no' && <p className="warning">{t.camera.copyFailed}</p>}
            </details>
          )}
        </>
      )}

      {step === 'failed' && (
        <>
          <p className="warning">{error ?? t.camera.failed}</p>
          <div className="controls">
            <button
              type="button"
              className="primary"
              onClick={() => {
                teardown();
                setStep('scan');
              }}
            >
              {t.camera.retry}
            </button>
          </div>
        </>
      )}

      <div className={step === 'live' ? 'camera-live' : 'camera-live camera-live-hidden'}>
        <div className="coach coach-ready">
          <span className="coach-dot" aria-hidden="true" />
          <span className="coach-message">{t.camera.connected}</span>
          {battery !== null && <span className="coach-numbers">{t.camera.battery}: {battery}%</span>}
        </div>
        <video ref={videoRef} className="camera-role-preview" playsInline muted />
        <p className="hint">{t.camera.keepHere}</p>
      </div>

      <div className="screen-actions">
        <button
          type="button"
          className="chip"
          onClick={() => {
            teardown();
            setScreen('pairRole');
          }}
        >
          {step === 'live' ? t.camera.stop : t.camera.back}
        </button>
      </div>
    </div>
  );
}
