/**
 * The lobby: where you are between everything else once a way of playing is
 * chosen.
 *
 * Before it existed every screen had its own idea of "back" — the landing page,
 * the setup, the pairing — and going back from the camera setup after pairing
 * dropped you on the landing page with the phone still connected and no way to
 * reach it. Choosing two devices again paired a second time. Now choosing a
 * mode (and, for two devices, connecting the phone) opens the lobby, every
 * screen comes back here, and the pairing only ends when you leave the lobby
 * and say so.
 */

import { useState } from 'react';

import { fill, useStrings } from '../i18n/index.js';
import { useMatchStore } from '../store/match.js';

export function Lobby() {
  const t = useStrings();
  const session = useMatchStore((s) => s.session);
  const pairing = useMatchStore((s) => s.pairing);
  const pairState = useMatchStore((s) => s.pairState);
  const phone = useMatchStore((s) => s.phone);
  const match = useMatchStore((s) => s.match);
  const calibration = useMatchStore((s) => s.settings.calibration);
  const setScreen = useMatchStore((s) => s.setScreen);
  const leaveLobby = useMatchStore((s) => s.leaveLobby);
  const clearPairing = useMatchStore((s) => s.clearPairing);
  const [confirmLeave, setConfirmLeave] = useState(false);

  // An address that points here with no session behind it (a bookmark, a new
  // tab): there is nothing to show until a mode is chosen.
  if (!session) {
    return (
      <div className="screen screen-lobby">
        <header className="screen-head">
          <h1>{t.lobby.title}</h1>
          <p>{t.lobby.noSession}</p>
        </header>
        <div className="screen-actions">
          <button type="button" className="primary" onClick={() => setScreen('mode')}>
            {t.lobby.chooseMode}
          </button>
        </div>
      </div>
    );
  }

  const paired = session === 'paired';
  const phoneLive = paired && pairing !== null && (pairState === 'connected' || pairState === 'connecting');
  const inProgress = match !== null && !match.finished && match.events.length > 0;

  return (
    <div className="screen screen-lobby">
      <header className="screen-head">
        <h1>{t.lobby.title}</h1>
        <p>{paired ? t.lobby.pairedMode : t.lobby.soloMode}</p>
      </header>

      {paired && (
        <div className={`coach ${phoneLive ? 'coach-ready' : 'coach-warn'}`} role="status">
          <span className="coach-dot" aria-hidden="true" />
          <span className="coach-message">
            {phoneLive
              ? pairState === 'connecting'
                ? t.lobby.phoneReconnecting
                : t.lobby.phoneConnected
              : pairing
                ? t.lobby.phoneLost
                : t.lobby.phoneGoneAfterReload}
          </span>
          {phoneLive && phone && (
            <span className="coach-numbers">
              {phone.battery !== undefined &&
                fill(t.lobby.battery, { n: phone.battery, charging: phone.charging ? t.lobby.charging : '' })}
              {phone.width && phone.height ? ` · ${phone.width}×${phone.height}` : ''}
            </span>
          )}
        </div>
      )}

      {paired && !phoneLive && (
        <div className="controls">
          <button
            type="button"
            className="primary"
            onClick={() => {
              clearPairing();
              setScreen('pair');
            }}
          >
            {t.lobby.pairAgain}
          </button>
        </div>
      )}

      <nav className="lobby-menu" aria-label={t.lobby.title}>
        {inProgress && (
          <button type="button" className="primary" onClick={() => setScreen('game')}>
            {t.lobby.resume}
          </button>
        )}
        <button
          type="button"
          // One main action at a time: with the phone gone, pairing it again is it.
          className={inProgress || (paired && !phoneLive) ? 'chip' : 'primary'}
          onClick={() => setScreen('setup')}
        >
          {t.lobby.newGame}
        </button>
        <button type="button" className="chip" onClick={() => setScreen('capture')}>
          {calibration ? t.lobby.camera : t.lobby.cameraFirst}
        </button>
        <button type="button" className="chip" onClick={() => setScreen('history')}>
          {t.lobby.history}
        </button>
        <button type="button" className="chip" onClick={() => setScreen('stats')}>
          {t.lobby.stats}
        </button>
      </nav>

      <div className="screen-actions">
        {confirmLeave ? (
          <div className="panel" role="alertdialog" aria-label={t.lobby.leaveTitle}>
            <p>{t.lobby.leavePaired}</p>
            <div className="controls">
              <button type="button" className="primary" onClick={leaveLobby}>
                {t.lobby.leaveConfirm}
              </button>
              <button type="button" className="chip" onClick={() => setConfirmLeave(false)}>
                {t.lobby.stay}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="chip"
            // Leaving solo costs nothing; leaving two devices ends the pairing,
            // which is the one thing this screen exists to protect.
            onClick={() => (paired && pairing ? setConfirmLeave(true) : leaveLobby())}
          >
            {t.lobby.leave}
          </button>
        )}
      </div>
    </div>
  );
}
