import { describe, expect, it } from 'vitest';

import { parseHit } from '../board/notation.js';
import { dartEvent, reduceMatch, type MatchEvent, type X01Config } from '../game/x01.js';
import { allDoubleTargets, careerStats } from './career.js';

const ann = { id: 'ann', name: 'Ann' };
const bob = { id: 'bob', name: 'Bob' };

const solo: X01Config = {
  startScore: 501,
  inRule: 'straight',
  outRule: 'double',
  legsPerSet: 1,
  setsToWin: 1,
  players: [ann],
};

/** Darts thrown on a given day, so sessions can be told apart. */
function darts(day: string, ...notation: string[]): MatchEvent[] {
  const base = new Date(`${day}T20:00:00`).getTime();
  return notation.map((text, index) =>
    dartEvent(parseHit(text)!, { id: `${day}-${index}`, ts: base + index * 20_000 }),
  );
}

const NINE_DARTER = ['T20', 'T20', 'T20', 'T20', 'T20', 'T20', 'T20', 'T19', 'D12'];

describe('careerStats', () => {
  it('adds up matches without double-counting anything', () => {
    const one = reduceMatch(solo, darts('2026-09-01', ...NINE_DARTER));
    const two = reduceMatch(solo, darts('2026-09-02', ...NINE_DARTER));

    const career = careerStats([one, two], 'ann');

    expect(career.matches).toBe(2);
    expect(career.legs).toBe(2);
    expect(career.dartsThrown).toBe(18);
    expect(career.points).toBe(1002);
    expect(career.average).toBeCloseTo(167, 6);
    expect(career.first9Average).toBeCloseTo(167, 6);
    expect(career.oneEighties).toBe(4);
    expect(career.legsWon).toBe(2);
    expect(career.dartsPerLegWon).toBe(9);
    expect(career.bestLegDarts).toBe(9);
    expect(career.highestCheckout).toBe(141);
  });

  it('splits the record into sessions, oldest first', () => {
    const career = careerStats(
      [
        reduceMatch(solo, darts('2026-09-02', ...NINE_DARTER)),
        reduceMatch(solo, darts('2026-09-01', ...NINE_DARTER)),
      ],
      'ann',
    );

    expect(career.sessions.map((session) => session.day)).toEqual(['2026-09-01', '2026-09-02']);
    expect(career.sessions[0]!.darts).toBe(9);
    expect(career.sessions[0]!.average).toBeCloseTo(167, 6);
    expect(career.sessions[0]!.legsWon).toBe(1);
  });

  it('counts darts at each double, and which ones went in', () => {
    // 40 left: two misses and a hit, all three thrown at the same double.
    const atDouble20 = reduceMatch(
      { ...solo, startScore: 40 },
      darts('2026-09-03', 'MISS', 'MISS', 'D20'),
    );
    // 20 left: the double in front of this player is D10, not D20.
    const atDouble10 = reduceMatch({ ...solo, startScore: 20 }, darts('2026-09-03', 'S1', 'MISS'));

    const career = careerStats([atDouble20, atDouble10], 'ann');

    const d20 = career.doubles.find((entry) => entry.target === 20)!;
    expect(d20).toMatchObject({ attempts: 3, hits: 1 });
    expect(d20.percent).toBeCloseTo(33.33, 1);

    const d10 = career.doubles.find((entry) => entry.target === 10)!;
    expect(d10).toMatchObject({ attempts: 1, hits: 0 });

    // The second dart of that leg left 19, which one dart cannot close, so it
    // is not a dart at a double at all.
    expect(career.checkoutAttempts).toBe(4);
    expect(career.checkoutHits).toBe(1);
  });

  it('bands the visits the way a player talks about them', () => {
    const career = careerStats([reduceMatch(solo, darts('2026-09-04', ...NINE_DARTER))], 'ann');
    const band = (label: string) => career.bands.find((entry) => entry.label === label)!.count;

    expect(band('180')).toBe(2);
    expect(band('140+')).toBe(1); // the 141 finish
    expect(band('100+')).toBe(0);
  });

  it('knows who threw first, and whether it mattered', () => {
    const pair: X01Config = { ...solo, players: [ann, bob], startScore: 40 };
    const career = careerStats([reduceMatch(pair, darts('2026-09-05', 'D20'))], 'ann');

    expect(career.firstThrowLegs).toBe(1);
    expect(career.firstThrowLegsWon).toBe(1);
  });

  it('ignores matches the player was not in', () => {
    const others: X01Config = { ...solo, players: [bob] };
    const career = careerStats([reduceMatch(others, darts('2026-09-06', ...NINE_DARTER))], 'ann');

    expect(career.matches).toBe(0);
    expect(career.dartsThrown).toBe(0);
    expect(career.average).toBe(0);
    expect(career.checkoutPercent).toBeNull();
  });
});

describe('allDoubleTargets', () => {
  it('lists every double plus the bull, highest first', () => {
    const targets = allDoubleTargets();
    expect(targets).toHaveLength(21);
    expect(targets[0]).toBe(20);
    expect(targets.at(-1)).toBe(25);
  });
});
