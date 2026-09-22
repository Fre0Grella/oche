/**
 * What the caller says, derived by comparing the match before and after a dart.
 *
 * Kept separate from the speech engine and from the store so it can be tested
 * without a microphone, a browser or a game.
 */

import type { MatchSnapshot } from '@oche/core';

import { strings } from '../i18n/index.js';

function playerName(snapshot: MatchSnapshot, playerId: string): string {
  return snapshot.config.players.find((p) => p.id === playerId)?.name ?? playerId;
}

function completedVisits(snapshot: MatchSnapshot) {
  return snapshot.legs.flatMap((leg) => leg.visits).filter((visit) => visit.complete);
}

/**
 * The phrases to speak for the transition from `before` to `after`, in order.
 * Empty when nothing worth announcing happened: a dart in the middle of a visit
 * is not announced, because a caller waits until the visit is thrown.
 */
export function announce(before: MatchSnapshot | null, after: MatchSnapshot): string[] {
  const t = strings();

  if (after.winnerId !== null && (before === null || before.winnerId === null)) {
    return [t.caller.matchShot];
  }

  const done = completedVisits(after);
  const doneBefore = before === null ? 0 : completedVisits(before).length;
  if (done.length <= doneBefore) return [];

  const visit = done.at(-1);
  if (!visit) return [];

  if (visit.won) {
    const setWon = (after.setsWon[visit.playerId] ?? 0) > (before?.setsWon[visit.playerId] ?? 0);
    return [setWon ? t.caller.setShot : t.caller.gameShot];
  }

  const total = visit.darts.reduce((sum, dart) => sum + dart.scored, 0);
  const phrases = [visit.busted ? t.caller.bust : t.caller.visit(total)];

  // Then the score the next player is on, when they are within checkout range.
  const current = after.current;
  if (current !== null && current.dartInVisit === 0) {
    if (current.remaining <= 170) {
      phrases.push(t.caller.requires(playerName(after, current.playerId), current.remaining));
    } else if (after.config.players.length > 1) {
      phrases.push(t.caller.toThrow(playerName(after, current.playerId)));
    }
  }

  return phrases;
}
