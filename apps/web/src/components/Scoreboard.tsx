/**
 * The scoreboard. Read from two or three metres away in bad light, so the
 * remaining score is the biggest thing on the screen and everything else is
 * deliberately quiet.
 */

import { formatRoute, matchStats, type MatchSnapshot } from '@oche/core';

import { useStrings } from '../i18n/index.js';

export interface ScoreboardProps {
  snapshot: MatchSnapshot;
}

export function Scoreboard({ snapshot }: ScoreboardProps) {
  const t = useStrings();
  const stats = matchStats(snapshot);
  const current = snapshot.current;
  const leg = snapshot.legs.at(-1);
  const showSets = snapshot.config.setsToWin > 1;

  return (
    <div className="scoreboard">
      {snapshot.config.players.map((player) => {
        const isCurrent = current?.playerId === player.id;
        // Once a leg is won, every card shows the next leg's start score: the
        // won leg's zero (and the loser's remainder) belongs to the history,
        // not to the board everyone is about to throw at.
        const legOver = leg?.winnerId != null;
        const remaining = isCurrent
          ? current.remaining
          : legOver
            ? snapshot.config.startScore
            : leg?.remaining[player.id] ?? snapshot.config.startScore;
        const playerStats = stats[player.id]!;
        const visit = [...(leg?.visits ?? [])].reverse().find((v) => v.playerId === player.id);

        return (
          <div key={player.id} className={`player${isCurrent ? ' player-current' : ''}`}>
            <div className="player-head">
              <span className="player-name">{player.name}</span>
              <span className="player-counts">
                {showSets && (
                  <span title={t.game.sets}>
                    {t.game.sets} {snapshot.setsWon[player.id] ?? 0}
                  </span>
                )}
                <span title={t.game.legs}>
                  {t.game.legs} {snapshot.legsWon[player.id] ?? 0}
                </span>
              </span>
            </div>

            <div className="player-remaining">{remaining}</div>

            {isCurrent && current.checkout && (
              <div className="player-checkout" title={t.game.chartNote}>
                {formatRoute(current.checkout)}
              </div>
            )}

            <div className="player-meta">
              <span>
                {t.game.average} <b>{playerStats.average.toFixed(1)}</b>
              </span>
              <span>
                {t.game.darts} <b>{playerStats.dartsThrown}</b>
              </span>
              {playerStats.checkoutPercent !== null && (
                <span>
                  {t.game.checkoutPercent} <b>{playerStats.checkoutPercent.toFixed(0)}%</b>
                </span>
              )}
            </div>

            <div className="player-visit">
              {visit
                ? visit.busted
                  ? t.game.busted
                  : visit.darts.map((d) => d.hit.value).join(' · ')
                : ' '}
            </div>
          </div>
        );
      })}
    </div>
  );
}
