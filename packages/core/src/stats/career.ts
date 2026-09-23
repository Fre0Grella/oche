/**
 * Statistics across many matches: the numbers a player actually asks for.
 *
 * `match.ts` folds one match. This folds a season. Everything is derived from
 * the same dart events, so a fixed bug retroactively fixes the history, and no
 * aggregate is ever stored.
 */

import { finishingDart, isFinishableWithOneDart } from '../game/checkout.js';
import type { Dart, MatchSnapshot, Visit } from '../game/x01.js';
import { matchStats, visitTotal, type PlayerStats } from './match.js';

export interface SessionStat {
  /** Local calendar day, `YYYY-MM-DD`, from the first dart of the session. */
  day: string;
  at: number;
  darts: number;
  points: number;
  average: number;
  legsWon: number;
  checkoutAttempts: number;
  checkoutHits: number;
}

export interface DoubleStat {
  /** The double's number, or 25 for the bull. */
  target: number;
  attempts: number;
  hits: number;
  percent: number | null;
}

export interface VisitBand {
  /** Inclusive lower bound of the band. */
  from: number;
  to: number;
  label: string;
  count: number;
}

export interface CareerStats extends PlayerStats {
  matches: number;
  legs: number;
  sessions: SessionStat[];
  doubles: DoubleStat[];
  bands: VisitBand[];
  /** Best three-dart visit average over a single leg won. */
  bestLegAverage: number | null;
  firstThrowLegsWon: number;
  firstThrowLegs: number;
}

const BANDS: { from: number; to: number; label: string }[] = [
  { from: 180, to: 180, label: '180' },
  { from: 140, to: 179, label: '140+' },
  { from: 100, to: 139, label: '100+' },
  { from: 60, to: 99, label: '60+' },
  { from: 26, to: 59, label: '26+' },
  { from: 1, to: 25, label: '1–25' },
  { from: 0, to: 0, label: 'No score' },
];

function dayOf(ts: number): string {
  const date = new Date(ts);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function playerVisits(snapshot: MatchSnapshot, playerId: string): Visit[] {
  return snapshot.legs.flatMap((leg) => leg.visits).filter((visit) => visit.playerId === playerId);
}

/**
 * Which double a dart was thrown at.
 *
 * The player's intention is not recorded — nor should it be, mid-throw — so the
 * double implied by the score in front of them is used: 32 means D16. It is the
 * same assumption every scoring app makes, and it is stated next to the number.
 */
function intendedDouble(dart: Dart, outRule: MatchSnapshot['config']['outRule']): number | null {
  if (!dart.atFinish) return null;
  const finisher = finishingDart(dart.remainingBefore, outRule);
  if (!finisher) return null;
  if (finisher.ring === 'bull') return 25;
  if (finisher.ring !== 'double') return null;
  return finisher.sector;
}

export function careerStats(snapshots: readonly MatchSnapshot[], playerId: string): CareerStats {
  const mine = snapshots.filter((snapshot) =>
    snapshot.config.players.some((player) => player.id === playerId),
  );

  const totals: PlayerStats = {
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

  const sessions = new Map<string, SessionStat>();
  const doubles = new Map<number, DoubleStat>();
  const bands = BANDS.map((band) => ({ ...band, count: 0 }));

  let first9Points = 0;
  let first9Darts = 0;
  let legDartsWon = 0;
  let legs = 0;
  let bestLegAverage: number | null = null;
  let firstThrowLegs = 0;
  let firstThrowLegsWon = 0;

  for (const snapshot of mine) {
    const perMatch = matchStats(snapshot)[playerId];
    if (!perMatch) continue;

    totals.visits += perMatch.visits;
    totals.dartsThrown += perMatch.dartsThrown;
    totals.points += perMatch.points;
    totals.tons += perMatch.tons;
    totals.oneForties += perMatch.oneForties;
    totals.oneEighties += perMatch.oneEighties;
    totals.busts += perMatch.busts;
    totals.checkoutAttempts += perMatch.checkoutAttempts;
    totals.checkoutHits += perMatch.checkoutHits;
    totals.legsWon += perMatch.legsWon;
    totals.bestVisit = Math.max(totals.bestVisit, perMatch.bestVisit);
    totals.highestCheckout = Math.max(totals.highestCheckout, perMatch.highestCheckout);
    if (perMatch.bestLegDarts !== null) {
      totals.bestLegDarts =
        totals.bestLegDarts === null
          ? perMatch.bestLegDarts
          : Math.min(totals.bestLegDarts, perMatch.bestLegDarts);
    }

    // The first-nine average has to be re-derived: it is a ratio, not a sum.
    for (const leg of snapshot.legs) {
      legs += 1;
      if (leg.startingPlayerId === playerId) {
        firstThrowLegs += 1;
        if (leg.winnerId === playerId) firstThrowLegsWon += 1;
      }
      if (leg.winnerId === playerId) legDartsWon += leg.dartsThrown[playerId] ?? 0;

      const visits = leg.visits.filter((visit) => visit.playerId === playerId);
      visits.slice(0, 3).forEach((visit) => {
        first9Points += visitTotal(visit);
        first9Darts += visit.darts.length;
      });

      if (leg.winnerId === playerId) {
        const darts = leg.dartsThrown[playerId] ?? 0;
        if (darts > 0) {
          const average = (snapshot.config.startScore / darts) * 3;
          bestLegAverage = bestLegAverage === null ? average : Math.max(bestLegAverage, average);
        }
      }
    }

    for (const visit of playerVisits(snapshot, playerId)) {
      const total = visitTotal(visit);
      const band = bands.find((candidate) => total >= candidate.from && total <= candidate.to);
      if (band) band.count += 1;

      for (const dart of visit.darts) {
        const day = dayOf(dart.ts);
        const session = sessions.get(day) ?? {
          day,
          at: dart.ts,
          darts: 0,
          points: 0,
          average: 0,
          legsWon: 0,
          checkoutAttempts: 0,
          checkoutHits: 0,
        };
        session.darts += 1;
        session.points += dart.scored;
        if (dart.won) session.legsWon += 1;
        if (dart.atFinish) session.checkoutAttempts += 1;
        if (dart.won) session.checkoutHits += 1;
        sessions.set(day, session);

        const target = intendedDouble(dart, snapshot.config.outRule);
        if (target !== null) {
          const entry = doubles.get(target) ?? { target, attempts: 0, hits: 0, percent: null };
          entry.attempts += 1;
          if (dart.won) entry.hits += 1;
          doubles.set(target, entry);
        }
      }
    }
  }

  totals.average = totals.dartsThrown === 0 ? 0 : (totals.points / totals.dartsThrown) * 3;
  totals.first9Average = first9Darts === 0 ? 0 : (first9Points / first9Darts) * 3;
  totals.checkoutPercent =
    totals.checkoutAttempts === 0 ? null : (totals.checkoutHits / totals.checkoutAttempts) * 100;
  totals.dartsPerLegWon = totals.legsWon === 0 ? null : legDartsWon / totals.legsWon;

  for (const session of sessions.values()) {
    session.average = session.darts === 0 ? 0 : (session.points / session.darts) * 3;
  }

  for (const entry of doubles.values()) {
    entry.percent = entry.attempts === 0 ? null : (entry.hits / entry.attempts) * 100;
  }

  return {
    ...totals,
    matches: mine.length,
    legs,
    sessions: [...sessions.values()].sort((a, b) => a.at - b.at),
    doubles: [...doubles.values()].sort((a, b) => b.attempts - a.attempts),
    bands,
    bestLegAverage,
    firstThrowLegs,
    firstThrowLegsWon,
  };
}

/**
 * Scores a single dart can close, so the doubles table can show the ones never
 * yet attempted rather than silently omitting them.
 */
export function allDoubleTargets(): number[] {
  const targets: number[] = [];
  for (let sector = 20; sector >= 1; sector -= 1) {
    if (isFinishableWithOneDart(sector * 2, 'double')) targets.push(sector);
  }
  targets.push(25);
  return targets;
}
