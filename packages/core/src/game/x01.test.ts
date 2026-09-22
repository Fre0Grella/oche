import { describe, expect, it } from 'vitest';

import { parseHit } from '../board/notation.js';
import { formatRoute } from './checkout.js';
import {
  dartEvent,
  reduceMatch,
  type DartCorrectedEvent,
  type MatchEvent,
  type X01Config,
} from './x01.js';

const ann = { id: 'ann', name: 'Ann' };
const bob = { id: 'bob', name: 'Bob' };

function config(overrides: Partial<X01Config> = {}): X01Config {
  return {
    startScore: 501,
    inRule: 'straight',
    outRule: 'double',
    legsPerSet: 1,
    setsToWin: 1,
    players: [ann, bob],
    ...overrides,
  };
}

/** Throws the given darts in order, `T20 S5 MISS …`, one event each. */
function darts(...notation: string[]): MatchEvent[] {
  return notation.map((text, index) => {
    const hit = parseHit(text);
    if (!hit) throw new Error(`bad test notation: ${text}`);
    return dartEvent(hit, { id: `d${index}`, ts: 1_700_000_000_000 + index * 1000 });
  });
}

describe('a leg of 501', () => {
  it('subtracts, alternates the throw and reports the darts in hand', () => {
    const snapshot = reduceMatch(config(), darts('T20', 'T20', 'T20', 'T20', 'S1'));

    expect(snapshot.legs[0]!.remaining).toEqual({ ann: 321, bob: 440 });
    expect(snapshot.current).toMatchObject({ playerId: 'bob', dartInVisit: 2, remaining: 440 });
  });

  it('hands the throw over after three darts', () => {
    const snapshot = reduceMatch(config(), darts('S1', 'S1', 'S1'));
    expect(snapshot.current).toMatchObject({ playerId: 'bob', dartInVisit: 0, remaining: 501 });
  });

  it('shows a checkout only when the leg can be closed', () => {
    const toOneForty = darts('T20', 'T20', 'S60'.replace('S60', 'S20')); // 140 scored
    const snapshot = reduceMatch(config({ startScore: 281 }), toOneForty);
    expect(snapshot.legs[0]!.remaining.ann).toBe(141);
    // Ann is 141 away with three in hand next visit, but it is Bob's throw now.
    expect(snapshot.current!.playerId).toBe('bob');

    const onAFinish = reduceMatch(config({ startScore: 141 }), darts('T20'));
    expect(onAFinish.current!.remaining).toBe(81);
    expect(formatRoute(onAFinish.current!.checkout!)).toBe('T19 D12');

    const tooHigh = reduceMatch(config({ startScore: 501 }), []);
    expect(tooHigh.current!.checkout).toBeNull();
  });
});

describe('busts', () => {
  it('takes the whole visit back when a dart goes below zero', () => {
    const snapshot = reduceMatch(config({ startScore: 60 }), darts('S10', 'T20'));
    const leg = snapshot.legs[0]!;
    expect(leg.remaining.ann).toBe(60);
    const visit = leg.visits[0]!;
    expect(visit.busted).toBe(true);
    expect(visit.complete).toBe(true);
    expect(visit.darts.map((d) => d.scored)).toEqual([0, 0]);
    expect(leg.dartsThrown.ann).toBe(2);
    expect(snapshot.current).toMatchObject({ playerId: 'bob', dartInVisit: 0 });
  });

  it('busts on leaving 1 with double out', () => {
    const snapshot = reduceMatch(config({ startScore: 20 }), darts('S19'));
    expect(snapshot.legs[0]!.visits[0]!.busted).toBe(true);
    expect(snapshot.legs[0]!.remaining.ann).toBe(20);
  });

  it('busts on reaching zero without the out dart', () => {
    const snapshot = reduceMatch(config({ startScore: 20 }), darts('S20'));
    expect(snapshot.legs[0]!.visits[0]!.busted).toBe(true);
    expect(snapshot.legs[0]!.winnerId).toBeNull();
  });

  it('does not bust when zero is reached on a double, or on the bull', () => {
    expect(reduceMatch(config({ startScore: 40 }), darts('D20')).winnerId).toBe('ann');
    expect(reduceMatch(config({ startScore: 50 }), darts('BULL')).winnerId).toBe('ann');
  });

  it('allows a straight-out leg to finish on anything', () => {
    const snapshot = reduceMatch(config({ startScore: 20, outRule: 'straight' }), darts('S20'));
    expect(snapshot.winnerId).toBe('ann');
  });

  it('busts below three on a treble-out leg', () => {
    const snapshot = reduceMatch(config({ startScore: 5, outRule: 'treble' }), darts('S3'));
    expect(snapshot.legs[0]!.visits[0]!.busted).toBe(true);
  });
});

describe('in rules', () => {
  it('scores nothing until a double-in leg is opened', () => {
    const snapshot = reduceMatch(config({ startScore: 301, inRule: 'double' }), darts('T20', 'S20', 'D20'));
    const leg = snapshot.legs[0]!;
    expect(leg.remaining.ann).toBe(261);
    expect(leg.open.ann).toBe(true);
    expect(leg.visits[0]!.darts.map((d) => d.scored)).toEqual([0, 0, 40]);
    expect(leg.dartsThrown.ann).toBe(3);
  });

  it('hides the checkout until the player is in', () => {
    const snapshot = reduceMatch(config({ startScore: 40, inRule: 'double' }), []);
    expect(snapshot.current!.checkout).toBeNull();
  });

  it('opens a master-in leg on a treble', () => {
    const snapshot = reduceMatch(config({ startScore: 301, inRule: 'master' }), darts('T20'));
    expect(snapshot.legs[0]!.remaining.ann).toBe(241);
  });
});

describe('a nine-dart leg', () => {
  const solo = config({ players: [ann] });

  it('is scored, won, and ends the match', () => {
    const nine = darts('T20', 'T20', 'T20', 'T20', 'T20', 'T20', 'T20', 'T19', 'D12');
    const snapshot = reduceMatch(solo, nine);

    expect(snapshot.winnerId).toBe('ann');
    expect(snapshot.legsWon).toEqual({ ann: 1 });
    expect(snapshot.setsWon).toEqual({ ann: 1 });
    expect(snapshot.current).toBeNull();
    expect(snapshot.legs[0]!.dartsThrown.ann).toBe(9);
    expect(snapshot.legs[0]!.visits.at(-1)!.won).toBe(true);
    expect(snapshot.legs[0]!.visits.at(-1)!.darts.at(-1)!.won).toBe(true);
  });

  it('ignores darts thrown after the match is over', () => {
    const nine = darts('T20', 'T20', 'T20', 'T20', 'T20', 'T20', 'T20', 'T19', 'D12', 'T20');
    const snapshot = reduceMatch(solo, nine);
    expect(snapshot.legs).toHaveLength(1);
    expect(snapshot.legs[0]!.dartsThrown.ann).toBe(9);
  });
});

describe('legs and sets', () => {
  it('starts a new leg with the other player throwing first', () => {
    const events = [...darts('T20', 'T20', 'T20'), ...darts('D20')];
    // Ann needs 501; give her a short leg instead.
    const short = reduceMatch(config({ startScore: 40, legsPerSet: 2 }), darts('D20'));
    expect(short.legs[0]!.winnerId).toBe('ann');
    expect(short.legsWon).toEqual({ ann: 1, bob: 0 });
    expect(short.current).toMatchObject({ legIndex: 1, playerId: 'bob', remaining: 40 });
    expect(events).toHaveLength(4); // guard against the helper changing shape
  });

  it('counts a set and resets the legs', () => {
    // First to two legs takes a set; first to two sets takes the match.
    const cfg = config({ startScore: 40, legsPerSet: 2, setsToWin: 2 });
    // Ann, Bob, Ann, Bob… each leg is one dart, so the throw alternates each leg.
    const snapshot = reduceMatch(cfg, darts('D20', 'D20', 'D20'));
    // Leg 1 Ann, leg 2 Bob, leg 3 Ann → Ann 2 legs, Bob 1: Ann takes the set.
    expect(snapshot.setsWon).toEqual({ ann: 1, bob: 0 });
    expect(snapshot.legsWon).toEqual({ ann: 0, bob: 0 });
    expect(snapshot.winnerId).toBeNull();
    expect(snapshot.current).toMatchObject({ setIndex: 1, legIndex: 0, playerId: 'bob' });
  });

  it('ends the match when the last set is won', () => {
    const cfg = config({ startScore: 40, legsPerSet: 1, setsToWin: 2 });
    const snapshot = reduceMatch(cfg, darts('D20', 'D20'));
    expect(snapshot.setsWon).toEqual({ ann: 1, bob: 1 });
    expect(snapshot.winnerId).toBeNull();

    const finished = reduceMatch(cfg, darts('D20', 'D20', 'D20'));
    expect(finished.winnerId).toBe('ann');
    expect(finished.current).toBeNull();
  });
});

describe('corrections', () => {
  it('rescores the leg and keeps the original reading', () => {
    const thrown = dartEvent(parseHit('T20')!, { id: 'x1', ts: 1, source: 'auto', confidence: 0.42 });
    const correction: DartCorrectedEvent = {
      type: 'dart.corrected',
      id: 'c1',
      ts: 2,
      target: 'x1',
      hit: parseHit('S20')!,
      source: 'manual',
    };

    const snapshot = reduceMatch(config({ startScore: 501 }), [thrown, correction]);
    const dart = snapshot.legs[0]!.visits[0]!.darts[0]!;

    expect(snapshot.legs[0]!.remaining.ann).toBe(481);
    expect(dart.hit.value).toBe(20);
    expect(dart.source).toBe('manual');
    expect(dart.original).toMatchObject({ source: 'auto', confidence: 0.42 });
    expect(dart.original!.hit.value).toBe(60);
  });

  it('can turn a bust into a win', () => {
    // 20 left: a single 20 reaches zero without a double, which is a bust.
    const thrown = dartEvent(parseHit('S20')!, { id: 'x1', ts: 1, source: 'auto' });
    const busted = reduceMatch(config({ startScore: 20 }), [thrown]);
    expect(busted.legs[0]!.visits[0]!.busted).toBe(true);

    const corrected = reduceMatch(config({ startScore: 20 }), [
      thrown,
      { type: 'dart.corrected', id: 'c1', ts: 2, target: 'x1', hit: parseHit('D10')!, source: 'manual' },
    ]);
    expect(corrected.winnerId).toBe('ann');
  });

  it('applies only the last correction for a dart', () => {
    const thrown = dartEvent(parseHit('T20')!, { id: 'x1', ts: 1, source: 'auto' });
    const snapshot = reduceMatch(config({ startScore: 501 }), [
      thrown,
      { type: 'dart.corrected', id: 'c1', ts: 2, target: 'x1', hit: parseHit('S20')!, source: 'manual' },
      { type: 'dart.corrected', id: 'c2', ts: 3, target: 'x1', hit: parseHit('S5')!, source: 'voice' },
    ]);
    expect(snapshot.legs[0]!.remaining.ann).toBe(496);
    expect(snapshot.legs[0]!.visits[0]!.darts[0]!.source).toBe('voice');
  });
});

describe('darts at a finish', () => {
  it('marks the darts thrown at a closable score', () => {
    const snapshot = reduceMatch(config({ startScore: 60 }), darts('S20', 'S20', 'D10'));
    const [first, second, third] = snapshot.legs[0]!.visits[0]!.darts;
    expect(first!.atFinish).toBe(false); // 60 cannot be closed with one dart
    expect(second!.atFinish).toBe(true); // 40 can
    expect(third!.atFinish).toBe(true); // 20 can
    expect(snapshot.winnerId).toBe('ann');
  });

  it('counts a dart at the bull as a dart at a finish', () => {
    const snapshot = reduceMatch(config({ startScore: 50 }), darts('MISS'));
    expect(snapshot.legs[0]!.visits[0]!.darts[0]!.atFinish).toBe(true);
  });
});

describe('solo play', () => {
  it('keeps the throw with the only player', () => {
    const snapshot = reduceMatch(config({ players: [ann], startScore: 501 }), darts('S1', 'S1', 'S1'));
    expect(snapshot.current).toMatchObject({ playerId: 'ann', dartInVisit: 0, remaining: 498 });
    expect(snapshot.legs[0]!.visits).toHaveLength(1);
  });
});
