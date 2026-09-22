import { describe, expect, it } from 'vitest';

import { assessImage, driftFraction } from './imageStats.js';

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
