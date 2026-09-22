import { formatHit, formatRoute, type Hit, type Point } from '@oche/core';
import { useState } from 'react';

import { Dartboard, type BoardDart } from '../components/Dartboard.js';
import { Keypad } from '../components/Keypad.js';
import { Scoreboard } from '../components/Scoreboard.js';
import { unlockCaller } from '../caller/caller.js';
import { fill, useStrings } from '../i18n/index.js';
import { useMatchStore } from '../store/match.js';

export function Game() {
  const t = useStrings();
  const snapshot = useMatchStore((s) => s.snapshot);
  const settings = useMatchStore((s) => s.settings);
  const throwDart = useMatchStore((s) => s.throwDart);
  const correctDart = useMatchStore((s) => s.correctDart);
  const undo = useMatchStore((s) => s.undo);
  const toggleCaller = useMatchStore((s) => s.toggleCaller);
  const setEntryMode = useMatchStore((s) => s.setEntryMode);
  const setScreen = useMatchStore((s) => s.setScreen);

  /** id of the dart being corrected, if any. */
  const [correcting, setCorrecting] = useState<string | null>(null);

  if (!snapshot) return null;

  const leg = snapshot.legs.at(-1);
  const current = snapshot.current;
  const finished = snapshot.winnerId !== null;

  // The visit in progress. Between visits this is the one just thrown, so the
  // darts stay on the board until the next player throws — a player walking
  // back from the board should still see where their darts landed.
  const visit = leg?.visits.at(-1) ?? null;
  const visitIsCurrent = current !== null && visit?.playerId === current.playerId && !visit.complete;

  const visitDarts: BoardDart[] = (visit?.darts ?? []).map((dart) => ({
    id: dart.id,
    hit: dart.hit,
    ...(dart.pos ? { pos: dart.pos } : {}),
    past: !visitIsCurrent,
  }));

  const record = (hit: Hit, pos?: Point) => {
    unlockCaller();
    if (correcting) {
      correctDart(correcting, hit, pos);
      setCorrecting(null);
      return;
    }
    throwDart(hit, pos ? { pos } : {});
  };

  const winnerName =
    snapshot.config.players.find((p) => p.id === snapshot.winnerId)?.name ?? snapshot.winnerId ?? '';

  return (
    <div className="screen screen-game">
      <Scoreboard snapshot={snapshot} />

      {current && (
        <div className="throw-strip">
          <span className="throw-who">
            {snapshot.config.players.find((p) => p.id === current.playerId)?.name} {t.game.toThrow}
          </span>
          <span className="throw-darts">
            {(visitIsCurrent ? visit?.darts ?? [] : []).map((dart) => (
              <button
                key={dart.id}
                type="button"
                className={`dart-chip${correcting === dart.id ? ' dart-chip-correcting' : ''}${
                  dart.source === 'auto' ? ' dart-chip-auto' : ''
                }`}
                onClick={() => setCorrecting((id) => (id === dart.id ? null : dart.id))}
                title="Tap, then enter the right score to correct this dart"
              >
                {formatHit(dart.hit)}
              </button>
            ))}
            {Array.from({ length: visitIsCurrent ? Math.max(0, 3 - (visit?.darts.length ?? 0)) : 3 }).map((_, index) => (
              <span key={`empty-${index}`} className="dart-chip dart-chip-empty">
                ·
              </span>
            ))}
          </span>
        </div>
      )}

      <div className="entry">
        {settings.entryMode === 'board' ? (
          <Dartboard
            onHit={record}
            darts={visitDarts}
            target={current?.checkout?.[visitIsCurrent ? visit?.darts.length ?? 0 : 0] ?? null}
            disabled={finished}
          />
        ) : (
          <Keypad onHit={(hit) => record(hit)} disabled={finished} />
        )}
      </div>

      {current?.checkout && (
        <p className="checkout-line" title={t.game.chartNote}>
          {t.game.checkout}: <b>{formatRoute(current.checkout)}</b>
        </p>
      )}

      <div className="controls">
        <button type="button" className="chip" onClick={undo}>
          {t.game.undo}
        </button>
        <button
          type="button"
          className={`chip${settings.callerEnabled ? ' chip-on' : ''}`}
          onClick={toggleCaller}
        >
          {settings.callerEnabled ? t.game.callerOn : t.game.callerOff}
        </button>
        <button
          type="button"
          className="chip"
          onClick={() => setEntryMode(settings.entryMode === 'board' ? 'keypad' : 'board')}
        >
          {settings.entryMode === 'board' ? t.game.keypad : t.game.board}
        </button>
        <button type="button" className="chip" onClick={() => setScreen('setup')}>
          {t.game.newMatch}
        </button>
      </div>

      {settings.entryMode === 'board' && !finished && <p className="hint">{t.game.sourceNote}</p>}

      {finished && (
        <div className="overlay">
          <div className="overlay-card">
            <h2>{fill(t.game.matchWon, { name: winnerName })}</h2>
            <button type="button" className="primary" onClick={() => setScreen('setup')}>
              {t.game.newMatch}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
