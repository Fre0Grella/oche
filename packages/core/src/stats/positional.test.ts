import { describe, expect, it } from 'vitest';

import { BOARD, hit, scoreAt, targetPoint, type Point } from '../board/geometry.js';
import {
  biasFrom,
  classifyDoubleAttempt,
  densityGrid,
  expectedScoreMap,
  grouping,
  sampleGrid,
  sectorSplit,
} from './positional.js';

const T20 = targetPoint(hit(20, 'treble'));

/** Darts scattered around a point with a given spread, deterministically. */
function scatter(centre: Point, sigma: number, count = 60): Point[] {
  let seed = 7;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  // Box–Muller, so the cloud really is Gaussian.
  return Array.from({ length: count }, () => {
    const u = Math.max(random(), 1e-9);
    const v = random();
    const r = Math.sqrt(-2 * Math.log(u));
    return {
      x: centre.x + r * Math.cos(2 * Math.PI * v) * sigma,
      y: centre.y + r * Math.sin(2 * Math.PI * v) * sigma,
    };
  });
}

describe('grouping', () => {
  it('needs two darts to say anything', () => {
    expect(grouping([])).toBeNull();
    expect(grouping([{ x: 0, y: 0 }])).toBeNull();
  });

  it('measures a round cloud as roughly round', () => {
    const group = grouping(scatter(T20, 12, 400))!;
    // Sampling noise on 400 darts is about 0.6 mm, so a couple of millimetres
    // of slack is the honest tolerance here.
    expect(Math.abs(group.centroid.x - T20.x)).toBeLessThan(2);
    expect(Math.abs(group.centroid.y - T20.y)).toBeLessThan(2);
    expect(group.along).toBeGreaterThan(9);
    expect(group.along).toBeLessThan(15);
    expect(Math.abs(group.along - group.across)).toBeLessThan(3);
  });

  it('separates spread up-and-down the sector from spread across it', () => {
    // A player whose timing is off scatters along the sector, not across it.
    const points = scatter(T20, 1, 300).map((p, index) => ({
      x: p.x,
      y: p.y + (index % 2 === 0 ? 20 : -20),
    }));
    const group = grouping(points)!;

    expect(group.along).toBeGreaterThan(15);
    expect(group.across).toBeLessThan(5);
  });
});

describe('biasFrom', () => {
  it('reports how far the group sits from where it was aimed', () => {
    const low = scatter({ x: T20.x, y: T20.y - 8 }, 4, 200);
    const bias = biasFrom(low, T20)!;

    expect(bias.distance).toBeGreaterThan(5);
    // The 20 points up, so landing short is negative outward.
    expect(bias.outward).toBeLessThan(0);
    expect(Math.abs(bias.sideways)).toBeLessThan(3);
  });
});

describe('sectorSplit', () => {
  it('counts the treble, the single and the two neighbours of the 20', () => {
    const darts = [
      { pos: targetPoint(hit(20, 'treble')) },
      { pos: targetPoint(hit(20, 'treble')) },
      { pos: targetPoint(hit(20, 'single')) },
      { pos: targetPoint(hit(20, 'double')) },
      { pos: targetPoint(hit(1, 'single')) },
      { pos: targetPoint(hit(5, 'single')) },
      { pos: targetPoint(hit(3, 'single')) }, // the other side of the board
    ];

    const split = sectorSplit(darts, 20);

    expect(split.total).toBe(6); // the 3 is not a miss at the 20
    expect(split.treble).toBe(2);
    expect(split.single).toBe(1);
    expect(split.double).toBe(1);
    expect(split.clockwise).toEqual({ sector: 1, count: 1 });
    expect(split.anticlockwise).toEqual({ sector: 5, count: 1 });
  });
});

describe('classifyDoubleAttempt', () => {
  const d20 = targetPoint(hit(20, 'double'));

  it('knows a hit from a miss, and which kind of miss', () => {
    expect(classifyDoubleAttempt(d20, 20)).toBe('hit');
    // Short of the double, in the big 20 bed.
    expect(classifyDoubleAttempt({ x: 0, y: 140 }, 20)).toBe('inside');
    // Over the top, off the board.
    expect(classifyDoubleAttempt({ x: 0, y: 200 }, 20)).toBe('outside');
    // Into the 5 and the 1.
    expect(classifyDoubleAttempt(targetPoint(hit(5, 'double')), 20)).toBe('anticlockwise');
    expect(classifyDoubleAttempt(targetPoint(hit(1, 'double')), 20)).toBe('clockwise');
  });

  it('treats the bull as its own case', () => {
    expect(classifyDoubleAttempt({ x: 0, y: 0 }, 25)).toBe('hit');
    expect(classifyDoubleAttempt({ x: 0, y: 12 }, 25)).toBe('inside'); // the 25 ring
    expect(classifyDoubleAttempt({ x: 0, y: 60 }, 25)).toBe('outside');
  });
});

describe('the aiming map', () => {
  it('sends a tight player at the treble 20', () => {
    const map = expectedScoreMap(6, 6, 3);

    expect(scoreAt(map.best.point)).toMatchObject({ sector: 20, ring: 'treble' });
    // A 6 mm group hits the treble about half the time and the 20 bed the rest,
    // which is worth roughly 40 a dart — a professional three-dart average is
    // around 100, so anything far above this would mean the maths is wrong.
    expect(map.best.expected).toBeGreaterThan(35);
    expect(map.best.expected).toBeLessThan(50);
    expect(map.trebleTwenty).toBeCloseTo(map.best.expected, 0);
  });

  it('sends a wide player somewhere else entirely — the paper’s whole point', () => {
    const tight = expectedScoreMap(6, 6, 4);
    const wide = expectedScoreMap(45, 45, 4);

    expect(scoreAt(tight.best.point).sector).toBe(20);
    expect(scoreAt(wide.best.point).sector).not.toBe(20);
    // And the treble 20 is now worth measurably less than their best target.
    expect(wide.trebleTwenty).toBeLessThan(wide.best.expected);
    expect(wide.best.expected).toBeLessThan(tight.best.expected);
  });

  it('sends a beginner at the middle of the board', () => {
    const map = expectedScoreMap(90, 90, 5);
    expect(Math.hypot(map.best.point.x, map.best.point.y)).toBeLessThan(60);
  });

  it('never claims more than the board can give', () => {
    for (const sigma of [3, 12, 30, 60]) {
      const map = expectedScoreMap(sigma, sigma, 5);
      expect(map.best.expected).toBeLessThanOrEqual(60);
      expect(map.best.expected).toBeGreaterThan(0);
    }
  });
});

describe('densityGrid', () => {
  it('is empty with no darts, and peaks where the darts are', () => {
    expect([...densityGrid([]).values].every((value) => value === 0)).toBe(true);

    const grid = densityGrid(scatter(T20, 8, 200));
    expect(sampleGrid(grid, T20)).toBeGreaterThan(0.8);
    expect(sampleGrid(grid, { x: -T20.x, y: -T20.y })).toBeLessThan(0.05);
  });

  it('normalises to its own peak, so a quiet session still reads', () => {
    const busy = densityGrid(scatter(T20, 8, 500));
    const quiet = densityGrid(scatter(T20, 8, 12));
    expect(Math.max(...busy.values)).toBeCloseTo(1, 5);
    expect(Math.max(...quiet.values)).toBeCloseTo(1, 5);
  });

  it('covers the whole board', () => {
    const grid = densityGrid([{ x: 0, y: 0 }]);
    expect(grid.half).toBeGreaterThanOrEqual(BOARD.doubleOuterRadius);
  });
});
