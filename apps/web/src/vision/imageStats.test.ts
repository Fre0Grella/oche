import { describe, expect, it } from 'vitest';

import { assessImage, boardLooksEmpty, driftFraction } from './imageStats.js';

const W = 64;
const H = 64;

const flat = (level: number) => new Uint8Array(W * H).fill(level);

/** A board's worth of edges: wires every few pixels. */
const wires = (level = 120) =>
  new Uint8Array(W * H).map((_, index) => {
    const x = index % W;
    const y = Math.floor(index / W);
    return x % 4 === 0 || y % 4 === 0 ? level + 70 : level;
  });

describe('assessImage', () => {
  it('passes a well-lit, sharp board', () => {
    const quality = assessImage(wires(), W, H);
    expect(quality.issues).toEqual([]);
    expect(quality.brightness).toBeGreaterThan(45);
    expect(quality.sharpness).toBeGreaterThan(25);
  });

  it('calls a dark room dark, and a blown-out one washed out', () => {
    expect(assessImage(wires(10), W, H).issues).toContain('dark');
    expect(assessImage(flat(240), W, H).issues).toContain('washedOut');
  });

  it('spots a reflection on the board', () => {
    const glary = wires();
    // A lamp reflecting off the wires: a bright patch, ~6% of the board.
    for (let y = 10; y < 26; y += 1) {
      for (let x = 10; x < 26; x += 1) glary[y * W + x] = 255;
    }
    expect(assessImage(glary, W, H).issues).toContain('glare');
    expect(assessImage(glary, W, H).glare).toBeGreaterThan(0.04);
  });

  it('spots a blurred picture, where a flat one has no edges at all', () => {
    expect(assessImage(flat(120), W, H).issues).toContain('blurry');
    expect(assessImage(flat(120), W, H).sharpness).toBeCloseTo(0, 6);
  });
});

describe('driftFraction', () => {
  it('is near zero for a board with one dart in it', () => {
    const before = wires();
    const after = before.slice();
    for (let y = 30; y < 35; y += 1) {
      for (let x = 30; x < 35; x += 1) after[y * W + x] = 30;
    }
    const drift = driftFraction(after, before, W, H);
    expect(drift).toBeLessThan(0.1);
    expect(assessImage(after, W, H, before).issues).not.toContain('moved');
  });

  it('is large when the camera has been knocked', () => {
    const before = wires();
    // The whole view shifts by two pixels: every block changes.
    const after = before.map((_, index) => before[(index + 2 * W + 2) % before.length]!);
    expect(driftFraction(after, before, W, H)).toBeGreaterThan(0.35);
    expect(assessImage(after, W, H, before).issues).toContain('moved');
  });

  it('ignores a reference of the wrong size instead of guessing', () => {
    expect(driftFraction(flat(100), new Uint8Array(16), W, H)).toBe(0);
  });
});

describe('boardLooksEmpty', () => {
  /** The board with a dart in it: one small, dense patch. */
  const withDart = (base: Uint8Array) =>
    base.map((value, index) => {
      const x = index % W;
      const y = Math.floor(index / W);
      return x >= 30 && x < 36 && y >= 20 && y < 26 ? value - 60 : value;
    });

  it('sees the calibrated board again once the darts are out', () => {
    expect(boardLooksEmpty(wires(), wires(), W, H)).toBe(true);
  });

  it('is not fooled by the room getting darker since calibration', () => {
    expect(boardLooksEmpty(wires(100), wires(120), W, H)).toBe(true);
  });

  it('sees one dart still in the board', () => {
    expect(boardLooksEmpty(withDart(wires()), wires(), W, H)).toBe(false);
  });

  /** The same board, nudged on its bracket by (dx, dy) thumbnail pixels. */
  const nudged = (base: Uint8Array, dx: number, dy: number) =>
    base.map((value, index) => {
      const x = (index % W) - dx;
      const y = Math.floor(index / W) - dy;
      return x >= 0 && y >= 0 && x < W && y < H ? base[y * W + x]! : value;
    });

  it('sees the board empty after pulling the darts out nudged it', () => {
    const empty = wires();
    expect(boardLooksEmpty(nudged(empty, 1, 0), empty, W, H)).toBe(true);
    expect(boardLooksEmpty(nudged(empty, 2, -1), empty, W, H)).toBe(true);
  });

  it('still sees a dart in a board that was nudged', () => {
    expect(boardLooksEmpty(withDart(nudged(wires(), 1, 1)), wires(), W, H)).toBe(false);
  });

  it('cannot tell without a reference of the same size', () => {
    expect(boardLooksEmpty(wires(), new Uint8Array(16), W, H)).toBe(false);
  });
});
