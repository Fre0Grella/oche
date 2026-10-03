import { describe, expect, it } from 'vitest';

import { squareAround } from './crop.js';

const FRAME = { width: 1920, height: 1080 };

describe('squareAround', () => {
  it('centres a square on the board, as large as its longer side', () => {
    expect(squareAround({ x: 700, y: 300, width: 500, height: 400 }, FRAME)).toEqual({
      x: 700,
      y: 250,
      width: 500,
      height: 500,
    });
  });

  it('moves the square back inside the frame instead of cutting it', () => {
    expect(squareAround({ x: 1600, y: 0, width: 320, height: 500 }, FRAME)).toEqual({
      x: 1420,
      y: 0,
      width: 500,
      height: 500,
    });
  });

  it('never grows past the frame, for a board that fills it', () => {
    expect(squareAround({ x: 300, y: 0, width: 1200, height: 1080 }, FRAME)).toEqual({
      x: 360,
      y: 0,
      width: 1080,
      height: 1080,
    });
  });
});
