import { describe, expect, it } from 'vitest';

import { parseHit } from '../board/notation.js';
import { dartEvent, reduceMatch, type MatchEvent, type X01Config } from '../game/x01.js';
import { matchStats } from './match.js';

const ann = { id: 'ann', name: 'Ann' };

const solo: X01Config = {
  startScore: 501,
  inRule: 'straight',
  outRule: 'double',
  legsPerSet: 1,
  setsToWin: 1,
  players: [ann],
};

function darts(...notation: string[]): MatchEvent[] {
  return notation.map((text, index) =>
    dartEvent(parseHit(text)!, { id: `d${index}`, ts: 1_700_000_000_000 + index * 1000 }),
  );
}

describe('matchStats', () => {
  it('scores a nine-darter as a 167 average and a 141 checkout', () => {
    const snapshot = reduceMatch(
      solo,
      darts('T20', 'T20', 'T20', 'T20', 'T20', 'T20', 'T20', 'T19', 'D12'),
    );
    const s = matchStats(snapshot).ann!;

    expect(s.dartsThrown).toBe(9);
    expect(s.points).toBe(501);
    expect(s.average).toBeCloseTo(167, 6);
    expect(s.first9Average).toBeCloseTo(167, 6);
    expect(s.oneEighties).toBe(2);
    expect(s.tons).toBe(3);
    expect(s.bestVisit).toBe(180);
    expect(s.legsWon).toBe(1);
    expect(s.bestLegDarts).toBe(9);
    expect(s.dartsPerLegWon).toBe(9);
    expect(s.highestCheckout).toBe(141);
    expect(s.checkoutAttempts).toBe(1); // only the last dart was at a double
    expect(s.checkoutHits).toBe(1);
    expect(s.checkoutPercent).toBe(100);
  });

  it('counts the darts of a busted visit against the average', () => {
    // 81 left: T20 leaves 21, then two darts that cannot finish, then a bust.
    const snapshot = reduceMatch({ ...solo, startScore: 81 }, darts('T20', 'S1', 'T20'));
    const s = matchStats(snapshot).ann!;

    expect(s.busts).toBe(1);
    expect(s.points).toBe(0); // the whole visit was taken back
    expect(s.dartsThrown).toBe(3);
    expect(s.average).toBe(0);
  });

  it('measures checkout percentage against darts at a double', () => {
    // 40 left: miss, miss, then hit. Three darts at a double, one hit.
    const snapshot = reduceMatch({ ...solo, startScore: 40 }, darts('MISS', 'MISS', 'D20'));
    const s = matchStats(snapshot).ann!;

    expect(s.checkoutAttempts).toBe(3);
    expect(s.checkoutHits).toBe(1);
    expect(s.checkoutPercent).toBeCloseTo(33.33, 1);
    expect(s.highestCheckout).toBe(40);
  });

  it('reports null rather than zero when nothing has been attempted', () => {
    const s = matchStats(reduceMatch(solo, [])).ann!;
    expect(s.checkoutPercent).toBeNull();
    expect(s.dartsPerLegWon).toBeNull();
    expect(s.bestLegDarts).toBeNull();
    expect(s.average).toBe(0);
  });
});
