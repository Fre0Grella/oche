import { describe, expect, it } from 'vitest';

import { SettleDetector, type SettleState } from './settle.js';

const SIZE = 64;

const flat = (value: number) => new Uint8Array(SIZE).fill(value);

/** A frame that differs from `value` by `delta` on average. */
const noisy = (value: number, delta: number) =>
  new Uint8Array(SIZE).map((_, index) => (index % 2 === 0 ? value + delta * 2 : value));

function feed(detector: SettleDetector, frames: { frame: Uint8Array; at: number }[]): SettleState[] {
  return frames.map(({ frame, at }) => detector.push(frame, at));
}

describe('SettleDetector', () => {
  it('says nothing about the very first frame', () => {
    const detector = new SettleDetector();
    expect(detector.push(flat(100), 0)).toBe('idle');
  });

  it('ignores a scene that never moves', () => {
    const detector = new SettleDetector();
    const states = feed(
      detector,
      Array.from({ length: 30 }, (_, i) => ({ frame: flat(100), at: i * 33 })),
    );
    expect(states.every((state) => state === 'idle')).toBe(true);
  });

  it('settles once, a beat after the movement stops', () => {
    const detector = new SettleDetector();
    let at = 0;
    const states: SettleState[] = [];

    states.push(detector.push(flat(100), at));
    // An arm and a dart cross the frame.
    for (let i = 0; i < 5; i += 1) {
      at += 33;
      states.push(detector.push(noisy(100, 20 + i), at));
    }
    // Then the board is still.
    for (let i = 0; i < 20; i += 1) {
      at += 33;
      states.push(detector.push(flat(140), at));
    }

    expect(states.filter((state) => state === 'settled')).toHaveLength(1);
    const settledIndex = states.indexOf('settled');
    expect(states[settledIndex - 1]).toBe('moving');
    // Still for ~300 ms at 33 ms a frame: about ten frames after the movement.
    expect(settledIndex).toBeGreaterThanOrEqual(6);
    expect(settledIndex).toBeLessThanOrEqual(20);
  });

  it('settles again for the next dart, but not twice for one', () => {
    const detector = new SettleDetector();
    let at = 0;
    let settles = 0;

    // A throw, then a realistic pause: the ~1.5 s it takes to line up the next
    // dart. Anything inside the cooldown is the same dart still wobbling.
    const throwOne = () => {
      for (let i = 0; i < 4; i += 1) {
        at += 33;
        if (detector.push(noisy(100, 30), at) === 'settled') settles += 1;
      }
      for (let i = 0; i < 45; i += 1) {
        at += 33;
        if (detector.push(flat(100), at) === 'settled') settles += 1;
      }
    };

    detector.push(flat(100), at);
    throwOne();
    throwOne();
    throwOne();

    expect(settles).toBe(3);
  });

  it('does not fire on the dart still wobbling in the board', () => {
    const detector = new SettleDetector();
    let at = 0;
    detector.push(flat(100), at);

    // Big motion, then a long tail of small movement below the motion
    // threshold but above the still threshold: the settle clock keeps resetting.
    at += 33;
    detector.push(noisy(100, 30), at);

    let settled = false;
    for (let i = 0; i < 15; i += 1) {
      at += 33;
      // Mean difference of about 4: drifting, neither moving nor still.
      const frame = i % 2 === 0 ? noisy(100, 4) : flat(100);
      if (detector.push(frame, at) === 'settled') settled = true;
    }
    expect(settled).toBe(false);

    // Once it is genuinely still, it fires.
    for (let i = 0; i < 15; i += 1) {
      at += 33;
      if (detector.push(flat(100), at) === 'settled') settled = true;
    }
    expect(settled).toBe(true);
  });

  it('reports the difference it measured, for the setup coach', () => {
    const detector = new SettleDetector();
    detector.push(flat(100), 0);
    detector.push(flat(110), 33);
    expect(detector.difference).toBeCloseTo(10, 6);
  });
});
