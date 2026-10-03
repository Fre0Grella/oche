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
 *
 * Laid out like a console game's lobby (issue #7): the menu in the bottom left,
 * the entry you are on named large in the top left with a line on what it
 * does, and its picture filling the right. On a phone the menu takes the whole
 * screen and the picture sits behind it, faint. One entry is always the
 * selected one — by pointer, focus or the arrow keys — and the menu is a list
 * of real buttons, so a screen reader and a keyboard get the same menu.
 */

import { useRef, useState, type KeyboardEvent } from 'react';

import { LobbyArt, type LobbyArtKind } from '../components/LobbyArt.js';
import { fill, useStrings } from '../i18n/index.js';
import { useMatchStore } from '../store/match.js';

interface Entry {
  id: LobbyArtKind;
  label: string;
  description: string;
  run: () => void;
}

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
  const [selectedId, setSelectedId] = useState<LobbyArtKind | null>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

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

  // The menu, first entry first: whatever matters most right now leads.
  const entries: Entry[] = [
    ...(paired && !phoneLive
      ? [
          {
            id: 'pairAgain' as const,
            label: t.lobby.pairAgain,
            description: t.lobby.describe.pairAgain,
            run: () => {
              clearPairing();
              setScreen('pair');
            },
          },
        ]
      : []),
    ...(inProgress
      ? [{ id: 'resume' as const, label: t.lobby.resume, description: t.lobby.describe.resume, run: () => setScreen('game') }]
      : []),
    { id: 'newGame', label: t.lobby.newGame, description: t.lobby.describe.newGame, run: () => setScreen('setup') },
    {
      id: 'camera',
      label: calibration ? t.lobby.camera : t.lobby.cameraFirst,
      description: t.lobby.describe.camera,
      run: () => setScreen('capture'),
    },
    { id: 'review', label: t.review.open, description: t.lobby.describe.review, run: () => setScreen('review') },
    { id: 'history', label: t.lobby.history, description: t.lobby.describe.history, run: () => setScreen('history') },
    { id: 'stats', label: t.lobby.stats, description: t.lobby.describe.stats, run: () => setScreen('stats') },
    {
      id: 'leave',
      label: t.lobby.leave,
      description: paired && pairing ? t.lobby.describe.leavePaired : t.lobby.describe.leave,
      // Leaving solo costs nothing; leaving two devices ends the pairing,
      // which is the one thing this screen exists to protect.
      run: () => (paired && pairing ? setConfirmLeave(true) : leaveLobby()),
    },
  ];
  const selected = entries.find((entry) => entry.id === selectedId) ?? entries[0]!;

  /** Up and down move through the menu, wrapping; Home and End jump to its ends. */
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const at = entries.findIndex((entry) => entry.id === selected.id);
    const to =
      event.key === 'ArrowDown'
        ? (at + 1) % entries.length
        : event.key === 'ArrowUp'
          ? (at - 1 + entries.length) % entries.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? entries.length - 1
              : -1;
    if (to < 0) return;
    event.preventDefault();
    setSelectedId(entries[to]!.id);
    buttons.current[to]?.focus();
  };

  return (
    <div className="lobby">
      {/* The selected entry's picture; keyed so a new one fades in. */}
      <div className="lobby-art" aria-hidden="true">
        <div key={selected.id} className={`lobby-art-frame lobby-art-${selected.id}`}>
          <LobbyArt kind={selected.id} />
        </div>
      </div>

      <div className="lobby-content">
        <header className="lobby-head">
          <h1 className="lobby-kicker">
            {t.lobby.title} · {paired ? t.lobby.pairedShort : t.lobby.soloShort}
          </h1>

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

          <p className="lobby-title" aria-hidden="true">
            {selected.label}
          </p>
          <p className="lobby-desc" id="lobby-desc">
            {selected.description}
          </p>
        </header>

        {confirmLeave && (
          <div className="panel lobby-confirm" role="alertdialog" aria-label={t.lobby.leaveTitle}>
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
        )}

        <nav className="lobby-menu" aria-label={t.lobby.title}>
          <ul onKeyDown={onKeyDown}>
            {entries.map((entry, index) => {
              const isSelected = entry.id === selected.id;
              return (
                <li key={entry.id}>
                  <button
                    ref={(element) => {
                      buttons.current[index] = element;
                    }}
                    type="button"
                    className={`lobby-item${isSelected ? ' lobby-item-on' : ''}${entry.id === 'leave' ? ' lobby-item-leave' : ''}`}
                    aria-current={isSelected ? 'true' : undefined}
                    aria-describedby={isSelected ? 'lobby-desc' : undefined}
                    onPointerEnter={() => setSelectedId(entry.id)}
                    onFocus={() => setSelectedId(entry.id)}
                    onClick={entry.run}
                  >
                    {entry.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </div>
  );
}
