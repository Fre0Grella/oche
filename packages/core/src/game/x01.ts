/**
 * The X01 engine.
 *
 * The event log is the truth: a match is a list of darts (plus corrections),
 * and everything else — whose throw it is, the remaining scores, busts, legs,
 * sets, the winner — is derived by folding that list. Nothing is stored twice,
 * so nothing can disagree with itself, and a bug fixed here retroactively fixes
 * every match in the history.
 *
 * A correction does not mutate the dart it corrects; it replaces its effect when
 * the log is folded, and both readings stay on the record. That is what lets the
 * app measure how often the autoscorer was wrong, and turn each mistake into a
 * labelled training example.
 */

import type { Hit, Point } from '../board/geometry.js';
import { canCheckout, checkoutRoute, isFinishableWithOneDart } from './checkout.js';
import { minimumFinish, satisfiesRule, type InOutRule } from './rules.js';

export type DartSource = 'manual' | 'voice' | 'auto';

export interface PlayerConfig {
  id: string;
  name: string;
}

export interface X01Config {
  /** 301, 501, 701, … */
  startScore: number;
  inRule: InOutRule;
  outRule: InOutRule;
  /** Legs needed to win a set. */
  legsPerSet: number;
  /** Sets needed to win the match. 1 means a single set of legs. */
  setsToWin: number;
  /** Throwing order. */
  players: PlayerConfig[];
  /** Index into `players` of whoever throws first in the match. */
  startingPlayerIndex?: number;
}

export interface DartThrownEvent {
  type: 'dart.thrown';
  id: string;
  ts: number;
  hit: Hit;
  /** Where the dart landed, in board millimetres. Absent for keypad totals. */
  pos?: Point;
  source: DartSource;
  /** Autoscorer confidence, 0–1. */
  confidence?: number;
  /** Key of the stored camera frame, when frame keeping is enabled. */
  frameRef?: string;
}

export interface DartCorrectedEvent {
  type: 'dart.corrected';
  id: string;
  ts: number;
  /** id of the `dart.thrown` event being corrected. */
  target: string;
  hit: Hit;
  pos?: Point;
  source: Exclude<DartSource, 'auto'>;
}

export type MatchEvent = DartThrownEvent | DartCorrectedEvent;

/** One dart as the rest of the app sees it, after corrections are applied. */
export interface Dart {
  id: string;
  ts: number;
  playerId: string;
  /** The reading in force now. */
  hit: Hit;
  pos?: Point;
  source: DartSource;
  confidence?: number;
  /** The original reading, kept when this dart was corrected. */
  original?: { hit: Hit; pos?: Point; source: DartSource; confidence?: number };
  /** Score credited: 0 when the dart busted the visit or the player was not in. */
  scored: number;
  /** True when the dart was thrown at a score one dart could have closed. */
  atFinish: boolean;
  /** True when this dart closed the leg. */
  won: boolean;
}

export interface Visit {
  playerId: string;
  setIndex: number;
  legIndex: number;
  darts: Dart[];
  /** Remaining score at the start of the visit. */
  scoreBefore: number;
  /** Remaining score after the visit; equals `scoreBefore` on a bust. */
  scoreAfter: number;
  busted: boolean;
  won: boolean;
  /** True once the visit can take no more darts. */
  complete: boolean;
}

export interface Leg {
  setIndex: number;
  legIndex: number;
  startingPlayerId: string;
  visits: Visit[];
  remaining: Record<string, number>;
  /** Whether each player has satisfied the in rule in this leg. */
  open: Record<string, boolean>;
  dartsThrown: Record<string, number>;
  winnerId: string | null;
}

export interface CurrentState {
  setIndex: number;
  legIndex: number;
  playerId: string;
  /** Darts already thrown in this visit: 0, 1 or 2. */
  dartInVisit: number;
  remaining: number;
  /** Suggested route with the darts in hand, or null if it cannot be closed. */
  checkout: Hit[] | null;
}

export interface MatchSnapshot {
  config: X01Config;
  legs: Leg[];
  /** Legs won per player within the current set. */
  legsWon: Record<string, number>;
  setsWon: Record<string, number>;
  winnerId: string | null;
  /** Null once the match is over. */
  current: CurrentState | null;
}

function effectiveReading(
  event: DartThrownEvent,
  correction: DartCorrectedEvent | undefined,
): { hit: Hit; pos?: Point; source: DartSource } {
  const from = correction ?? event;
  return from.pos ? { hit: from.hit, pos: from.pos, source: from.source } : { hit: from.hit, source: from.source };
}

/**
 * Who throws first in the n-th leg of the match. The throw alternates every leg,
 * which is how X01 is played; with more than two players it rotates.
 */
function startingPlayerFor(config: X01Config, legNumber: number): string {
  const start = config.startingPlayerIndex ?? 0;
  return config.players[(start + legNumber) % config.players.length]!.id;
}

/**
 * Folds the event log into everything the UI needs.
 *
 * `events` must be in throwing order; corrections may appear anywhere after the
 * dart they correct, and the last correction for a dart wins.
 */
export function reduceMatch(config: X01Config, events: readonly MatchEvent[]): MatchSnapshot {
  if (config.players.length === 0) throw new Error('a match needs at least one player');

  const corrections = new Map<string, DartCorrectedEvent>();
  for (const event of events) {
    if (event.type === 'dart.corrected') corrections.set(event.target, event);
  }

  const ids = config.players.map((p) => p.id);
  const counters = () => Object.fromEntries(ids.map((id) => [id, 0])) as Record<string, number>;

  const legs: Leg[] = [];
  const legsWon = counters();
  const setsWon = counters();

  let setIndex = 0;
  let legNumber = 0;
  let winnerId: string | null = null;
  let setPending = false;

  const createLeg = (): Leg => {
    const leg: Leg = {
      setIndex,
      legIndex: legs.filter((l) => l.setIndex === setIndex).length,
      startingPlayerId: startingPlayerFor(config, legNumber),
      visits: [],
      remaining: Object.fromEntries(ids.map((id) => [id, config.startScore])),
      open: Object.fromEntries(ids.map((id) => [id, config.inRule === 'straight'])),
      dartsThrown: counters(),
      winnerId: null,
    };
    legs.push(leg);
    return leg;
  };

  const nextPlayer = (playerId: string): string => ids[(ids.indexOf(playerId) + 1) % ids.length]!;

  let leg = createLeg();

  const createVisit = (playerId: string): Visit => {
    const visit: Visit = {
      playerId,
      setIndex: leg.setIndex,
      legIndex: leg.legIndex,
      darts: [],
      scoreBefore: leg.remaining[playerId]!,
      scoreAfter: leg.remaining[playerId]!,
      busted: false,
      won: false,
      complete: false,
    };
    leg.visits.push(visit);
    return visit;
  };

  let visit = createVisit(leg.startingPlayerId);

  for (const event of events) {
    if (event.type !== 'dart.thrown') continue;
    if (winnerId !== null) break; // darts thrown after the match ended are ignored

    if (visit.complete) {
      if (leg.winnerId !== null) {
        legNumber += 1;
        if (setPending) {
          setIndex += 1;
          setPending = false;
        }
        leg = createLeg();
        visit = createVisit(leg.startingPlayerId);
      } else {
        visit = createVisit(nextPlayer(visit.playerId));
      }
    }

    const reading = effectiveReading(event, corrections.get(event.id));
    const playerId = visit.playerId;
    const before = leg.remaining[playerId]!;

    const dart: Dart = {
      id: event.id,
      ts: event.ts,
      playerId,
      hit: reading.hit,
      source: reading.source,
      scored: 0,
      atFinish: leg.open[playerId] === true && isFinishableWithOneDart(before, config.outRule),
      won: false,
    };
    if (reading.pos) dart.pos = reading.pos;
    if (event.confidence !== undefined) dart.confidence = event.confidence;
    if (corrections.has(event.id)) {
      dart.original = { hit: event.hit, source: event.source };
      if (event.pos) dart.original.pos = event.pos;
      if (event.confidence !== undefined) dart.original.confidence = event.confidence;
    }

    leg.dartsThrown[playerId] = (leg.dartsThrown[playerId] ?? 0) + 1;
    visit.darts.push(dart);

    // Not in yet: only a dart satisfying the in rule opens the leg, and it
    // scores. Anything else is a thrown dart worth nothing.
    if (leg.open[playerId] !== true) {
      if (satisfiesRule(reading.hit, config.inRule)) {
        leg.open[playerId] = true;
      } else {
        visit.complete = visit.darts.length === 3;
        continue;
      }
    }

    const after = before - reading.hit.value;
    const busted =
      after < 0 ||
      (after === 0 && !satisfiesRule(reading.hit, config.outRule)) ||
      (after > 0 && after < minimumFinish(config.outRule));

    if (busted) {
      visit.busted = true;
      visit.complete = true;
      visit.scoreAfter = visit.scoreBefore;
      leg.remaining[playerId] = visit.scoreBefore;
      for (const d of visit.darts) d.scored = 0; // the whole visit is taken back
      continue;
    }

    dart.scored = reading.hit.value;
    leg.remaining[playerId] = after;
    visit.scoreAfter = after;

    if (after === 0) {
      dart.won = true;
      visit.won = true;
      visit.complete = true;
      leg.winnerId = playerId;
      legsWon[playerId] = (legsWon[playerId] ?? 0) + 1;
      if (legsWon[playerId]! >= config.legsPerSet) {
        setsWon[playerId] = (setsWon[playerId] ?? 0) + 1;
        if (setsWon[playerId]! >= config.setsToWin) {
          winnerId = playerId;
        } else {
          // The set is over: `legsWon` counts legs in the set now being played.
          setPending = true;
          for (const id of ids) legsWon[id] = 0;
        }
      }
      continue;
    }

    visit.complete = visit.darts.length === 3;
  }

  return {
    config,
    legs,
    legsWon,
    setsWon,
    winnerId,
    current: winnerId !== null ? null : describeCurrent(config, leg, visit, legNumber, setIndex, setPending, nextPlayer),
  };
}

function routeFor(
  leg: Leg,
  playerId: string,
  remaining: number,
  dartsInHand: number,
  outRule: InOutRule,
): Hit[] | null {
  if (leg.open[playerId] !== true) return null;
  return canCheckout(remaining, dartsInHand, outRule) ? checkoutRoute(remaining, dartsInHand, outRule) : null;
}

function describeCurrent(
  config: X01Config,
  leg: Leg,
  visit: Visit,
  legNumber: number,
  setIndex: number,
  setPending: boolean,
  nextPlayer: (playerId: string) => string,
): CurrentState {
  if (!visit.complete) {
    const remaining = leg.remaining[visit.playerId]!;
    return {
      setIndex: leg.setIndex,
      legIndex: leg.legIndex,
      playerId: visit.playerId,
      dartInVisit: visit.darts.length,
      remaining,
      checkout: routeFor(leg, visit.playerId, remaining, 3 - visit.darts.length, config.outRule),
    };
  }

  // The visit is over and the next one has not started, because no dart has
  // been thrown into it yet. Report where the next dart will land.
  if (leg.winnerId !== null) {
    return {
      setIndex: setPending ? setIndex + 1 : setIndex,
      legIndex: setPending ? 0 : leg.legIndex + 1,
      playerId: startingPlayerFor(config, legNumber + 1),
      dartInVisit: 0,
      remaining: config.startScore,
      checkout:
        config.inRule === 'straight' ? checkoutRoute(config.startScore, 3, config.outRule) : null,
    };
  }

  const playerId = nextPlayer(visit.playerId);
  const remaining = leg.remaining[playerId]!;
  return {
    setIndex: leg.setIndex,
    legIndex: leg.legIndex,
    playerId,
    dartInVisit: 0,
    remaining,
    checkout: routeFor(leg, playerId, remaining, 3, config.outRule),
  };
}

let fallbackId = 0;

/** A dart event with sensible defaults, for the UI and for tests. */
export function dartEvent(
  hit: Hit,
  options: {
    id?: string;
    ts?: number;
    pos?: Point;
    source?: DartSource;
    confidence?: number;
    frameRef?: string;
  } = {},
): DartThrownEvent {
  const id =
    options.id ??
    (typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `dart-${(fallbackId += 1)}`);

  const event: DartThrownEvent = {
    type: 'dart.thrown',
    id,
    ts: options.ts ?? Date.now(),
    hit,
    source: options.source ?? 'manual',
  };
  if (options.pos) event.pos = options.pos;
  if (options.confidence !== undefined) event.confidence = options.confidence;
  if (options.frameRef) event.frameRef = options.frameRef;
  return event;
}
