import { describe, expect, it } from 'vitest';

import {
  BOARD,
  BULL,
  MISS,
  OUTER_BULL,
  SECTORS,
  hit,
  scoreAt,
  sectorAngle,
  sectorAtAngle,
  targetPoint,
  wireMargin,
} from './geometry.js';
import { allScoringHits, formatHit, parseHit } from './notation.js';

const mm = (x: number, y: number) => ({ x, y });

describe('sector layout', () => {
  it('puts 20 at the top and 3 at the bottom', () => {
    expect(sectorAtAngle(90)).toBe(20);
    expect(sectorAtAngle(270)).toBe(3);
    expect(sectorAngle(20)).toBe(90);
    expect(sectorAngle(3)).toBe(270);
  });

  it('puts 6 to the right and 11 to the left', () => {
    expect(sectorAtAngle(0)).toBe(6);
    expect(sectorAtAngle(180)).toBe(11);
  });

  it('has every sector exactly once and opposite pairs 10 apart', () => {
    expect(new Set(SECTORS).size).toBe(20);
    // Every pair of opposite sectors on a real board: 20/3, 1/19, 18/7, …
    const pairs: [number, number][] = [
      [20, 3],
      [1, 19],
      [18, 7],
      [4, 16],
      [13, 8],
      [6, 11],
      [10, 14],
      [15, 9],
      [2, 12],
      [17, 5],
    ];
    for (const [a, b] of pairs) {
      expect(Math.abs(sectorAngle(a) - sectorAngle(b))).toBeCloseTo(180, 6);
    }
  });
});

describe('scoreAt', () => {
  it('scores the bulls', () => {
    expect(scoreAt(mm(0, 0))).toEqual(BULL);
    expect(scoreAt(mm(0, 5))).toEqual(BULL);
    expect(scoreAt(mm(0, 12))).toEqual(OUTER_BULL);
    // 14.1 mm from the centre: still the outer bull, whatever the angle.
    expect(scoreAt(mm(10, 10))).toEqual(OUTER_BULL);
  });

  it('scores nothing outside the double wire', () => {
    expect(scoreAt(mm(0, BOARD.doubleOuterRadius + 1))).toEqual(MISS);
    expect(scoreAt(mm(300, 0))).toEqual(MISS);
  });

  it('scores the treble 20 and the double 20 straight up', () => {
    expect(scoreAt(mm(0, 103))).toEqual(hit(20, 'treble'));
    expect(scoreAt(mm(0, 166))).toEqual(hit(20, 'double'));
    expect(scoreAt(mm(0, 60))).toEqual(hit(20, 'single'));
    expect(scoreAt(mm(0, 140))).toEqual(hit(20, 'single'));
  });

  it('agrees with targetPoint for every hit on the board', () => {
    for (const h of allScoringHits()) {
      expect(scoreAt(targetPoint(h))).toEqual(h);
      if (h.ring === 'single') expect(scoreAt(targetPoint(h, 'inner'))).toEqual(h);
    }
  });

  it('puts the 1 and the 5 either side of the 20', () => {
    // Just inside the 20/1 wire is the 1; just the other side of the 20 is the 5.
    const r = 130;
    const at = (deg: number) => scoreAt(mm(r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180)));
    expect(at(80).sector).toBe(1);
    expect(at(100).sector).toBe(5);
  });
});

describe('wireMargin', () => {
  it('is zero on a wire and largest in the middle of a bed', () => {
    expect(wireMargin(mm(0, BOARD.trebleOuterRadius))).toBeCloseTo(0, 6);
    expect(wireMargin(mm(0, BOARD.doubleInnerRadius))).toBeCloseTo(0, 6);
    expect(wireMargin(targetPoint(hit(20, 'treble')))).toBeCloseTo(4, 1);
  });

  it('measures the distance to a sector wire as an arc length', () => {
    // 9° off the centre of the 20 at 100 mm is exactly on the sector wire.
    const deg = 90 - 9;
    const p = mm(100 * Math.cos((deg * Math.PI) / 180), 100 * Math.sin((deg * Math.PI) / 180));
    expect(wireMargin(p)).toBeCloseTo(0, 6);
  });
});

describe('notation', () => {
  it('round-trips every hit', () => {
    for (const h of allScoringHits()) {
      expect(parseHit(formatHit(h))).toEqual(h);
    }
    expect(parseHit('MISS')).toEqual(MISS);
  });

  it('accepts the shapes a person would type', () => {
    expect(parseHit('t20')).toEqual(hit(20, 'treble'));
    expect(parseHit('D 16')).toEqual(hit(16, 'double'));
    expect(parseHit('7')).toEqual(hit(7, 'single'));
    expect(parseHit('50')).toEqual(BULL);
    expect(parseHit('25')).toEqual(OUTER_BULL);
    expect(parseHit('D21')).toBeNull();
    expect(parseHit('banana')).toBeNull();
  });
});
