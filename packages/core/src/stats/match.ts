/**
 * Match statistics, derived from a folded match. Tier 1 of
 * `docs/04-stats.md`: everything here works from scores alone, so it is
 * available in a fully manual game.
 *
 * Definitions follow the conventional ones, which are written next to the
 * numbers in the UI:
 *
 *  - the three-dart average counts every dart thrown, including the darts of a
 *    busted visit, which score nothing;
 *  - checkout percentage is doubles hit ÷ darts thrown at a double, where a
 *    dart is "at a double" when one dart could have closed the leg from the
 *    score in front of it;
 *  - the first-nine average covers the first three visits of each leg.
 */

import type { MatchSnapshot, Visit } from '../game/x01.js';

export interface PlayerStats {
  playerId: string;
  visits: number;
  dartsThrown: number;
  points: number;
  /** Points per three darts. 0 when no darts have been thrown. */
  average: number;
  /** Average over the first three visits of each leg. */
  first9Average: number;
  bestVisit: number;
  /** Visits of 100+, 140+ and exactly 180. */
  tons: number;
  oneForties: number;
  oneEighties: number;
  busts: number;
  checkoutAttempts: number;
  checkoutHits: number;
  /** 0–100, or null when no double has been thrown at. */
  checkoutPercent: number | null;
  highestCheckout: number;
  legsWon: number;
  /** Darts per leg won, or null when no leg has been won. */
  dartsPerLegWon: number | null;
  bestLegDarts: number | null;
}

function emptyStats(playerId: string): PlayerStats {
  return {
    playerId,
    visits: 0,
    dartsThrown: 0,
    points: 0,
    average: 0,
    first9Average: 0,
    bestVisit: 0,
    tons: 0,
    oneForties: 0,
    oneEighties: 0,
    busts: 0,
    checkoutAttempts: 0,
    checkoutHits: 0,
    checkoutPercent: null,
    highestCheckout: 0,
    legsWon: 0,
    dartsPerLegWon: null,
    bestLegDarts: null,
  };
}

export function visitTotal(visit: Visit): number {
  return visit.darts.reduce((sum, dart) => sum + dart.scored, 0);
}

export function matchStats(snapshot: MatchSnapshot): Record<string, PlayerStats> {
  const stats: Record<string, PlayerStats> = Object.fromEntries(
    snapshot.config.players.map((p) => [p.id, emptyStats(p.id)]),
  );

  const first9 = Object.fromEntries(
    snapshot.config.players.map((p) => [p.id, { points: 0, darts: 0 }]),
  ) as Record<string, { points: number; darts: number }>;

  const legDarts = Object.fromEntries(snapshot.config.players.map((p) => [p.id, 0])) as Record<
    string,
    number
  >;

  for (const leg of snapshot.legs) {
    const visitIndex: Record<string, number> = {};

    for (const visit of leg.visits) {
      const s = stats[visit.playerId];
      if (!s) continue;

      const index = (visitIndex[visit.playerId] = (visitIndex[visit.playerId] ?? -1) + 1);
      const total = visitTotal(visit);

      s.visits += 1;
      s.dartsThrown += visit.darts.length;
      s.points += total;
      if (total > s.bestVisit) s.bestVisit = total;
      if (total >= 100) s.tons += 1;
      if (total >= 140) s.oneForties += 1;
      if (total === 180) s.oneEighties += 1;
      if (visit.busted) s.busts += 1;

      if (index < 3) {
        const f = first9[visit.playerId]!;
        f.points += total;
        f.darts += visit.darts.length;
      }

      for (const dart of visit.darts) {
        if (dart.atFinish) s.checkoutAttempts += 1;
        if (dart.won) {
          s.checkoutHits += 1;
          if (visit.scoreBefore > s.highestCheckout) s.highestCheckout = visit.scoreBefore;
        }
      }
    }

    // Darts used in a leg, counted only for the player who won it: "darts per
    // leg" is a finishing statistic, and a leg you lost has no length.
    if (leg.winnerId) {
      const s = stats[leg.winnerId];
      if (s) {
        s.legsWon += 1;
        const darts = leg.dartsThrown[leg.winnerId] ?? 0;
        legDarts[leg.winnerId] = (legDarts[leg.winnerId] ?? 0) + darts;
        if (s.bestLegDarts === null || darts < s.bestLegDarts) s.bestLegDarts = darts;
      }
    }
  }

  for (const s of Object.values(stats)) {
    s.average = s.dartsThrown === 0 ? 0 : (s.points / s.dartsThrown) * 3;
    const f = first9[s.playerId]!;
    s.first9Average = f.darts === 0 ? 0 : (f.points / f.darts) * 3;
    s.checkoutPercent =
      s.checkoutAttempts === 0 ? null : (s.checkoutHits / s.checkoutAttempts) * 100;
    s.dartsPerLegWon = s.legsWon === 0 ? null : (legDarts[s.playerId] ?? 0) / s.legsWon;
  }

  return stats;
}
