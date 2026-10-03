import type { Matrix3 } from '@treblewise/core';
import { describe, expect, it } from 'vitest';

import { localChanges } from './changeGate.js';

const W = 400;
const H = 400;
/** Board millimetres to image pixels: 1 px per mm, bull at the centre of the frame. */
const TO_IMAGE: Matrix3 = [1, 0, 200, 0, 1, 200, 0, 0, 1];

/** A textured board, so the difference floor is not trivially zero. */
function board(): Float32Array {
  const out = new Float32Array(W * H);
  for (let i = 0; i < out.length; i += 1) out[i] = 100 + ((i * 7919) % 23);
  return out;
}

/** A dark dart-sized blob at board millimetres (x, y). */
function withDart(base: Float32Array, x: number, y: number): Float32Array {
  const out = base.slice();
  for (let dy = -3; dy <= 3; dy += 1) {
    for (let dx = -3; dx <= 3; dx += 1) out[(200 + y + dy) * W + (200 + x + dx)] = 20;
  }
  return out;
}

describe('localChanges', () => {
  it('sees a new dart where it landed, and nothing beside an old one', () => {
    const before = withDart(board(), 0, -100);
    const after = withDart(before, 30, 40);
    const [atNew, atOld, besideOld] = localChanges(before, after, W, H, TO_IMAGE, [
      { x: 30, y: 40 },
      { x: 0, y: -100 },
      { x: 6, y: -100 },
    ]);
    expect(atNew).toBeGreaterThan(20);
    expect(Math.abs(atOld!)).toBeLessThan(1);
    expect(Math.abs(besideOld!)).toBeLessThan(1);
  });

  it('takes a room getting brighter out before comparing', () => {
    const before = board();
    const after = before.map((value) => value * 1.15);
    const [anywhere] = localChanges(before, after, W, H, TO_IMAGE, [{ x: 50, y: 50 }]);
    expect(Math.abs(anywhere!)).toBeLessThan(2);
  });
});
