import { describe, expect, it } from 'vitest';

import { SettleDetector, type SettleState } from './settle.js';

const W = 64;
const H = 64;

const board = (level = 120) => new Uint8Array(W * H).fill(level);

/** A dart: a small dark patch, about the size of one in a board-region thumbnail. */
function withDart(base: Uint8Array, cx: number, cy: number, size = 5, level = 40): Uint8Array {
  const next = base.slice();
  for (let y = cy; y < cy + size; y += 1) {
    for (let x = cx; x < cx + size; x += 1) {
      next[y * W + x] = level;
    }
  }
  return next;
}

/** A hand crossing the frame: most of the thumbnail changes at once. */
function withHand(base: Uint8Array): Uint8Array {
  return base.map((value, index) => (index % 3 === 0 ? 20 : value));
}

const mean = (a: Uint8Array, b: Uint8Array) =>
  a.reduce((sum, value, index) => sum + Math.abs(value - b[index]!), 0) / a.length;

/** Feeds still frames for `ms`, returning every state seen. */
function hold(detector: SettleDetector, frame: Uint8Array, from: number, ms: number): [SettleState[], number] {
  const states: SettleState[] = [];
  let at = from;
  for (let elapsed = 0; elapsed < ms; elapsed += 33) {
    at += 33;
    states.push(detector.push(frame, at));
  }
  return [states, at];
}

describe('SettleDetector', () => {
  it('sees a dart that a whole-frame average cannot', () => {
    // This is the number that makes the block metric necessary: one dart moves
    // the mean over the whole thumbnail by less than half a grey level, which
    // no sane motion threshold could distinguish from sensor noise.
    const empty = board();
    const landed = withDart(empty, 30, 30);
    expect(mean(landed, empty)).toBeLessThan(0.5);

    const detector = new SettleDetector();
    detector.push(empty, 0);
    detector.push(landed, 33);
    expect(detector.change).toBeGreaterThan(20);
  });

  it('says nothing about the first frame, or about a board nobody touches', () => {
    const detector = new SettleDetector();
    const empty = board();
    expect(detector.push(empty, 0)).toBe('idle');
    const [states] = hold(detector, empty, 0, 2000);
    expect(states.every((state) => state === 'idle')).toBe(true);
  });

  it('fires once when a dart lands, and again for the next dart', () => {
    const detector = new SettleDetector();
    const empty = board();
    let at = 0;

    detector.push(empty, at);
    [, at] = hold(detector, empty, at, 500);

    const one = withDart(empty, 30, 30);
    const [first, afterFirst] = hold(detector, one, at, 1500);
    expect(first.filter((state) => state === 'settled')).toHaveLength(1);

    const two = withDart(one, 20, 40);
    const [second] = hold(detector, two, afterFirst, 1500);
    expect(second.filter((state) => state === 'settled')).toHaveLength(1);
  });

  it('waits while a hand is in the way, then takes the frame', () => {
    const detector = new SettleDetector();
    const empty = board();
    let at = 0;
    detector.push(empty, at);

    const hand = withHand(empty);
    const moving: SettleState[] = [];
    for (let i = 0; i < 6; i += 1) {
      at += 33;
      moving.push(detector.push(i % 2 === 0 ? hand : empty, at));
    }
    expect(moving).toContain('moving');
    expect(moving).not.toContain('settled');

    // The hand leaves and a dart is in the board.
    const landed = withDart(empty, 30, 30);
    const [states] = hold(detector, landed, at, 1500);
    expect(states.filter((state) => state === 'settled')).toHaveLength(1);
  });

  it('does not fire when the scene is disturbed but the board is unchanged', () => {
    const detector = new SettleDetector();
    const empty = board();
    let at = 0;
    detector.push(empty, at);
    [, at] = hold(detector, empty, at, 600);

    // Someone walks past the camera: big motion, board identical afterwards.
    const hand = withHand(empty);
    for (let i = 0; i < 8; i += 1) {
      at += 33;
      detector.push(i % 2 === 0 ? hand : empty, at);
    }
    const [states] = hold(detector, empty, at, 1500);
    expect(states).not.toContain('settled');
  });

  it('ignores slow lighting drift', () => {
    const detector = new SettleDetector();
    let frame = board();
    let at = 0;
    detector.push(frame, at);

    let settled = false;
    for (let step = 0; step < 40; step += 1) {
      frame = frame.map((value) => Math.min(255, value + 1));
      [, at] = hold(detector, frame, at, 400);
      if (detector.current === 'settled') settled = true;
    }
    expect(settled).toBe(false);
  });

  it('notices the darts being pulled out, so the next throw is measured fresh', () => {
    const detector = new SettleDetector();
    const empty = board();
    let at = 0;
    detector.push(empty, at);

    const landed = withDart(empty, 30, 30);
    [, at] = hold(detector, landed, at, 1200);

    // Board cleared: that is a change too, and the reference has to follow it.
    const [states, afterClear] = hold(detector, empty, at, 1500);
    expect(states.filter((state) => state === 'settled')).toHaveLength(1);

    // A dart in the same place as before still registers.
    const again = withDart(empty, 30, 30);
    const [next] = hold(detector, again, afterClear, 1500);
    expect(next.filter((state) => state === 'settled')).toHaveLength(1);
  });

  it('exposes both readouts so the thresholds can be set from a real board', () => {
    const detector = new SettleDetector();
    const empty = board();
    detector.push(empty, 0);
    detector.push(withHand(empty), 33);
    expect(detector.motion).toBeGreaterThan(10);

    const settled = new SettleDetector();
    settled.push(empty, 0);
    settled.push(withDart(empty, 10, 10), 33);
    expect(settled.motion).toBeLessThan(1);
    expect(settled.change).toBeGreaterThan(20);
  });
});
