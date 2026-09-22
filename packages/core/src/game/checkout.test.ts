import { describe, expect, it } from 'vitest';

import { formatHit } from '../board/notation.js';
import {
  BOGEY_SCORES,
  CHECKOUT_CHART,
  canCheckout,
  checkoutRoute,
  finishingDart,
  formatRoute,
  isFinishableWithOneDart,
} from './checkout.js';
import { satisfiesRule, type InOutRule } from './rules.js';

const RULES: InOutRule[] = ['straight', 'double', 'treble', 'master'];

describe('the conventional chart', () => {
  it('has an entry for every score that can be finished in three darts', () => {
    for (let remaining = 2; remaining <= 170; remaining += 1) {
      const expected = !(BOGEY_SCORES as readonly number[]).includes(remaining);
      expect(remaining in CHECKOUT_CHART, `chart entry for ${remaining}`).toBe(expected);
    }
    expect(Object.keys(CHECKOUT_CHART)).toHaveLength(169 - BOGEY_SCORES.length);
  });

  it('adds up, uses at most three darts and finishes on a double', () => {
    for (const [score, notation] of Object.entries(CHECKOUT_CHART)) {
      const route = checkoutRoute(Number(score), 3, 'double');
      expect(route, notation).not.toBeNull();
      const darts = route!;
      expect(formatRoute(darts), `route for ${score}`).toBe(notation);
      expect(darts.length, `dart count for ${score}`).toBeLessThanOrEqual(3);
      expect(
        darts.reduce((sum, d) => sum + d.value, 0),
        `sum for ${score}`,
      ).toBe(Number(score));
      expect(satisfiesRule(darts[darts.length - 1]!, 'double'), `finish for ${score}`).toBe(true);
    }
  });

  it('never suggests a route that would bust or strand the player', () => {
    for (const [score, notation] of Object.entries(CHECKOUT_CHART)) {
      let remaining = Number(score);
      const darts = checkoutRoute(remaining, 3, 'double')!;
      for (const [index, dart] of darts.entries()) {
        remaining -= dart.value;
        const isLast = index === darts.length - 1;
        expect(remaining >= 0, `${notation} went below zero`).toBe(true);
        if (!isLast) expect(remaining, `${notation} stranded on 1`).not.toBe(1);
      }
      expect(remaining, `${notation} did not finish`).toBe(0);
    }
  });

  it('matches the finishes every player knows', () => {
    const known: Record<number, string> = {
      170: 'T20 T20 BULL',
      167: 'T20 T19 BULL',
      164: 'T20 T18 BULL',
      161: 'T20 T17 BULL',
      160: 'T20 T20 D20',
      141: 'T20 T19 D12',
      100: 'T20 D20',
      98: 'T20 D19',
      92: 'T20 D16',
      84: 'T20 D12',
      81: 'T19 D12',
      80: 'T20 D10',
      60: 'S20 D20',
      40: 'D20',
      32: 'D16',
      2: 'D1',
    };
    for (const [score, expected] of Object.entries(known)) {
      expect(formatRoute(checkoutRoute(Number(score), 3, 'double')!), `finish for ${score}`).toBe(expected);
    }
  });
});

describe('checkoutRoute', () => {
  it('returns nothing for the bogey scores and anything above 170', () => {
    for (const score of BOGEY_SCORES) {
      expect(checkoutRoute(score, 3, 'double'), `bogey ${score}`).toBeNull();
    }
    for (const score of [171, 172, 180, 501]) {
      expect(checkoutRoute(score, 3, 'double'), `unreachable ${score}`).toBeNull();
    }
    expect(checkoutRoute(1, 3, 'double')).toBeNull();
  });

  it('respects the darts in hand', () => {
    expect(checkoutRoute(170, 2, 'double')).toBeNull();
    expect(checkoutRoute(110, 2, 'double')).not.toBeNull(); // T20 BULL
    expect(formatRoute(checkoutRoute(110, 2, 'double')!)).toBe('T20 BULL');
    expect(checkoutRoute(50, 1, 'double')).not.toBeNull(); // the bull
    expect(checkoutRoute(60, 1, 'double')).toBeNull(); // no single dart closes 60
    expect(formatRoute(checkoutRoute(40, 1, 'double')!)).toBe('D20');
  });

  it('produces valid routes under every out rule', () => {
    for (const rule of RULES) {
      for (let remaining = 1; remaining <= 180; remaining += 1) {
        for (let dartsLeft = 1; dartsLeft <= 3; dartsLeft += 1) {
          const route = checkoutRoute(remaining, dartsLeft, rule);
          if (route === null) continue;
          expect(route.length, `${rule} ${remaining} in ${dartsLeft}`).toBeLessThanOrEqual(dartsLeft);
          expect(
            route.reduce((sum, d) => sum + d.value, 0),
            `${rule} ${remaining} sums`,
          ).toBe(remaining);
          expect(satisfiesRule(route[route.length - 1]!, rule), `${rule} ${remaining} finish`).toBe(true);
          let left = remaining;
          for (const [index, dart] of route.entries()) {
            left -= dart.value;
            if (index < route.length - 1) {
              expect(canCheckout(left, dartsLeft - index - 1, rule), `${rule} ${remaining} stays finishable`).toBe(true);
            }
          }
        }
      }
    }
  });

  it('finds the highest three-dart finishes under treble-out', () => {
    // 180 can only be closed on a treble with three trebles of 20.
    expect(formatRoute(checkoutRoute(180, 3, 'treble')!)).toBe('T20 T20 T20');
    expect(checkoutRoute(181, 3, 'treble')).toBeNull();
    // 1 and 2 cannot be finished at all when the out dart must be a treble.
    expect(checkoutRoute(1, 3, 'treble')).toBeNull();
    expect(checkoutRoute(2, 3, 'treble')).toBeNull();
    expect(formatRoute(checkoutRoute(3, 3, 'treble')!)).toBe('T1');
  });

  it('lets straight-out finish on anything', () => {
    expect(formatRoute(checkoutRoute(1, 1, 'straight')!)).toBe('S1');
    // 170 needs the bull whatever the out rule; the order is the search's choice.
    const route = checkoutRoute(170, 3, 'straight')!;
    expect(route.map((d) => d.value).sort((a, b) => b - a)).toEqual([60, 60, 50]);
  });
});

describe('darts at a double', () => {
  it('knows which scores one dart can close', () => {
    expect(isFinishableWithOneDart(40, 'double')).toBe(true);
    expect(isFinishableWithOneDart(50, 'double')).toBe(true);
    expect(isFinishableWithOneDart(41, 'double')).toBe(false);
    expect(isFinishableWithOneDart(39, 'double')).toBe(false);
    expect(isFinishableWithOneDart(60, 'double')).toBe(false);
    expect(isFinishableWithOneDart(60, 'treble')).toBe(true);
    expect(isFinishableWithOneDart(17, 'straight')).toBe(true);
  });

  it('picks a comfortable double when there is a choice', () => {
    expect(formatHit(finishingDart(32, 'double')!)).toBe('D16');
    expect(formatHit(finishingDart(50, 'double')!)).toBe('BULL');
    expect(finishingDart(41, 'double')).toBeNull();
  });
});
