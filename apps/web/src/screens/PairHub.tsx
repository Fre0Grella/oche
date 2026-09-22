/**
 * The laptop's side of pairing: show a code, then read the phone's code back.
 *
 * Two QR codes and no server. The laptop's offer goes out as a picture the
 * phone reads; the phone's answer comes back as a picture the laptop's webcam
 * reads. After that the video is a direct connection across the local network.
 */

import { useEffect, useRef, useState } from 'react';

import { QrCode } from '../components/QrCode.js';
import { QrScanner } from '../components/QrScanner.js';
import { useStrings } from '../i18n/index.js';
import { PairingConnection } from '../pairing/session.js';
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
  const connection = useRef<PairingConnection | null>(paired);

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
          <p className="pair-instruction">{t.pair.holdUpPhone}</p>
          <QrScanner facing="user" onCode={(text) => void onPhoneCode(text)} hint={t.pair.scanningHint} />
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
        <button type="button" className="chip" onClick={() => setScreen('mode')}>
          {t.pair.back}
        </button>
      </div>
    </div>
  );
}
