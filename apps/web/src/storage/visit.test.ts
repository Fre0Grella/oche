import { describe, expect, it } from 'vitest';

import type { LabelledDart } from './types.js';
import { DARTS_PER_VISIT, carriedInto, inBoardAfter, newDarts, onNewPhoto, proposalsBeside, worthSaving } from './visit.js';

function dart(x: number): LabelledDart {
  return { img: { x, y: x }, board: { x: x / 10, y: 0 }, hit: { sector: 20, ring: 'single', value: 20 } };
}

describe('a visit across photographs', () => {
  it('opens the second photograph with the first dart already marked', () => {
    const afterFirst = inBoardAfter([dart(1)]);
    expect(carriedInto(afterFirst)).toEqual([dart(1)]);
  });

  it('copies the carried marks, so dragging one does not move the saved frame', () => {
    const saved = [dart(1)];
    const carried = carriedInto(inBoardAfter(saved));
    expect(carried[0]).not.toBe(saved[0]);
    expect(carried[0]!.img).not.toBe(saved[0]!.img);
  });

  it('empties the board once a full visit is saved', () => {
    const full = Array.from({ length: DARTS_PER_VISIT }, (_, i) => dart(i));
    expect(inBoardAfter(full)).toEqual([]);
  });

  it('keeps two darts in the board after the second photograph', () => {
    expect(inBoardAfter([dart(1), dart(2)])).toHaveLength(2);
  });

  it('counts only the darts tapped on this photograph as new', () => {
    expect(newDarts([dart(1), dart(2), dart(3)], 2)).toEqual([dart(3)]);
    expect(newDarts([dart(1)], 2)).toEqual([]);
  });
});

describe('proposals from the model', () => {
  const at = (x: number, y: number) => ({ board: { x, y } });

  it('drops detections of darts that are already marked', () => {
    const carried = [dart(10)]; // board (1, 0)
    expect(proposalsBeside([at(3, 0), at(60, 40)], carried)).toEqual([at(60, 40)]);
  });

  it('lets each marked dart claim only one detection, the nearest', () => {
    const carried = [dart(10)]; // board (1, 0)
    expect(proposalsBeside([at(1.5, 0), at(5, 0)], carried)).toEqual([at(5, 0)]);
  });

  it('finds the third dart of a tight treble 20, a few millimetres from the other two', () => {
    const t20 = (x: number): LabelledDart => ({ ...dart(0), board: { x, y: 103 } });
    const carried = [t20(-4), t20(1)];
    const found = [at(-3.6, 103.4), at(1.3, 102.8), at(5, 103.5)];
    expect(proposalsBeside(found, carried)).toEqual([at(5, 103.5)]);
  });

  it('keeps everything when nothing is carried', () => {
    expect(proposalsBeside([at(0, 100)], [])).toHaveLength(1);
  });

  it('saves an untouched photograph only if the model proposed a dart on it', () => {
    expect(worthSaving({ edited: false, proposed: 1, darts: [1] })).toBe(true);
    expect(worthSaving({ edited: false, proposed: 0, darts: [1] })).toBe(false);
    expect(worthSaving({ edited: true, proposed: 0, darts: [] })).toBe(false);
  });
});

describe('a new photograph while one is open', () => {
  it('replaces a photograph nobody has touched', () => {
    expect(onNewPhoto(null)).toBe('replace');
    expect(onNewPhoto({ edited: false, proposed: 0, darts: [1] })).toBe('replace');
  });

  it('waits behind one that has marks, instead of saving it', () => {
    expect(onNewPhoto({ edited: true, proposed: 0, darts: [1] })).toBe('wait');
    expect(onNewPhoto({ edited: false, proposed: 1, darts: [1] })).toBe('wait');
  });
});
