/**
 * The laptop's side of pairing: show a code, then read the phone's code back.
 *
 * Two codes and no server. The laptop's offer goes out as a picture the phone
 * reads; the phone's answer comes back either as a picture the laptop's webcam
 * reads, or — for a desktop with no camera — as a hundred characters pasted or
 * typed in. After that the video is a direct connection across the network.
 */

import { useEffect, useRef, useState } from 'react';

import { QrCode } from '../components/QrCode.js';
import { QrScanner } from '../components/QrScanner.js';
import { useStrings } from '../i18n/index.js';
import { PairingConnection } from '../pairing/session.js';
import { decodeShortCode, shortCodeLength } from '../pairing/shortcode.js';
import { useMatchStore } from '../store/match.js';

type Step = 'intro' | 'offer' | 'scanning' | 'connecting' | 'connected' | 'failed';

export function PairHub() {
  const t = useStrings();
  const setScreen = useMatchStore((s) => s.setScreen);
  const setPairing = useMatchStore((s) => s.setPairing);
  const paired = useMatchStore((s) => s.pairing);

  const [step, setStep] = useState<Step>(paired ? 'connected' : 'intro');
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** How the phone's answer gets here: read by the webcam, or as text. */
  const [reading, setReading] = useState<'scan' | 'code'>('scan');
  const [typed, setTyped] = useState('');
  const connection = useRef<PairingConnection | null>(paired);

  // A computer with no camera cannot scan anything, so it should not be shown a
  // scanner first. The kinds are listed before any permission is granted.
  useEffect(() => {
    void navigator.mediaDevices
      ?.enumerateDevices()
      .then((devices) => {
        if (!devices.some((device) => device.kind === 'videoinput')) setReading('code');
      })
      .catch(() => undefined);
  }, []);

  useEffect(
    () => () => {
      // Leaving mid-handshake should not leave a half-open connection behind;
      // a finished one belongs to the store and stays alive.
      if (connection.current && connection.current.state !== 'connected') {
        connection.current.close();
        connection.current = null;
      }
    },
    [],
  );

  const start = async () => {
    setError(null);
    try {
      const hosted = await PairingConnection.host();
      connection.current = hosted.connection;
      setCode(hosted.code);
      setStep('offer');

      hosted.connection.onStream = (stream) => {
        setPairing(hosted.connection, stream);
        setStep('connected');
      };
      hosted.connection.onState = (state) => {
        if (state === 'failed') setStep('failed');
        if (state === 'connected') setStep((current) => (current === 'connected' ? current : 'connecting'));
      };
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStep('failed');
    }
  };

  const onPhoneCode = async (text: string) => {
    if (!connection.current) return;
    setStep('connecting');
    try {
      await connection.current.accept(text);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStep('failed');
    }
  };

  return (
    <div className="screen screen-pair">
      <header className="screen-head">
        <h1>{t.pair.title}</h1>
        <p>{t.pair.subtitle}</p>
      </header>

      {step === 'intro' && (
        <>
          <ol className="steps">
            {t.pair.steps.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
          <div className="controls">
            <button type="button" className="primary" onClick={() => void start()}>
              {t.pair.start}
            </button>
          </div>
        </>
      )}

      {step === 'offer' && code && (
        <>
          <p className="pair-instruction">{t.pair.showToPhone}</p>
          <QrCode text={code} label={t.pair.qrLabelHub} />
          <div className="controls">
            <button type="button" className="primary" onClick={() => setStep('scanning')}>
              {t.pair.scannedIt}
            </button>
          </div>
        </>
      )}

      {step === 'scanning' && (
        <>
          <div className="chip-row">
            <button
              type="button"
              className={`chip${reading === 'scan' ? ' chip-on' : ''}`}
              onClick={() => setReading('scan')}
            >
              {t.pair.useScanner}
            </button>
            <button
              type="button"
              className={`chip${reading === 'code' ? ' chip-on' : ''}`}
              onClick={() => setReading('code')}
            >
              {t.pair.useCode}
            </button>
          </div>

          {reading === 'scan' ? (
            <>
              <p className="pair-instruction">{t.pair.holdUpPhone}</p>
              <QrScanner facing="user" onCode={(text) => void onPhoneCode(text)} hint={t.pair.scanningHint} />
            </>
          ) : (
            <>
              <p className="pair-instruction">{t.pair.typeTheCode}</p>
              <textarea
                className="pair-code-input"
                autoFocus
                rows={6}
                spellCheck={false}
                autoCapitalize="characters"
                aria-label={t.pair.useCode}
                placeholder={t.pair.codePlaceholder}
                value={typed}
                onChange={(event) => {
                  const text = event.target.value;
                  setTyped(text);
                  // No submit button: the moment the code is whole and its
                  // checksum agrees, there is nothing left to ask.
                  try {
                    decodeShortCode(text);
                  } catch {
                    return;
                  }
                  void onPhoneCode(text);
                }}
              />
              <p className="hint">
                {t.pair.codeCounter(shortCodeLength(typed))} — {t.pair.codeWaiting}
              </p>
            </>
          )}

          <div className="controls">
            <button type="button" className="chip" onClick={() => setStep('offer')}>
              {t.pair.backToCode}
            </button>
          </div>
        </>
      )}

      {step === 'connecting' && <p className="pair-instruction">{t.pair.connecting}</p>}

      {step === 'connected' && (
        <>
          <div className="coach coach-ready">
            <span className="coach-dot" aria-hidden="true" />
            <span className="coach-message">{t.pair.connected}</span>
          </div>
          <div className="controls">
            <button type="button" className="primary" onClick={() => setScreen('capture')}>
              {t.pair.setUpCamera}
            </button>
            <button type="button" className="chip" onClick={() => setScreen('setup')}>
              {t.pair.straightToGame}
            </button>
          </div>
        </>
      )}

      {step === 'failed' && (
        <>
          <p className="warning">{error ?? t.pair.failed}</p>
          <div className="controls">
            <button type="button" className="primary" onClick={() => void start()}>
              {t.pair.retry}
            </button>
          </div>
        </>
      )}

      <div className="screen-actions">
        <button type="button" className="chip" onClick={() => setScreen('pairRole')}>
          {t.pair.back}
        </button>
      </div>
    </div>
  );
}
