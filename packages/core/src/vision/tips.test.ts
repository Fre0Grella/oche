import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { Hit } from '../board/geometry.js';
import type { Matrix3 } from './homography.js';
import { BOARD_TO_RECT, TIP_GRID, decodeTips, imageToRect, prescale, warpToTensor } from './tips.js';

/** Written by `python -m oche_ml.parity_fixture`; see that file. */
interface ParityFixture {
  rect: { size: number; boardToRect: number[] };
  toBoard: number[];
  imageToRect: number[];
  sampling: {
    width: number;
    height: number;
    rgb: number[];
    warp: number[];
    outWidth: number;
    outHeight: number;
    expected: number[];
  };
  decode: {
    heat: [number, number, number][];
    offset: [number, number, number, number][];
    expected: { x: number; y: number; confidence: number; board: [number, number]; label: string }[];
  };
}

const fixture = JSON.parse(
  readFileSync(new URL('./__fixtures__/tips-parity.json', import.meta.url), 'utf8'),
) as ParityFixture;

describe('the tip model pipeline matches the Python that trained it', () => {
  it('uses the same rectified view', () => {
    expect([...BOARD_TO_RECT]).toEqual(fixture.rect.boardToRect);
  });

  it('builds the same warp from a calibration', () => {
    const warp = imageToRect(fixture.toBoard as unknown as Matrix3);
    warp.forEach((value, i) => expect(value).toBeCloseTo(fixture.imageToRect[i]!, 9));
  });

  it('samples pixels as OpenCV does, within rounding', () => {
    const s = fixture.sampling;
    // The fixture holds OpenCV's BGR; the tensor is RGB. Rebuild RGBA from it.
    const rgba = new Uint8ClampedArray(s.width * s.height * 4);
    for (let p = 0; p < s.width * s.height; p += 1) {
      rgba[p * 4] = s.rgb[p * 3 + 2]!;
      rgba[p * 4 + 1] = s.rgb[p * 3 + 1]!;
      rgba[p * 4 + 2] = s.rgb[p * 3]!;
      rgba[p * 4 + 3] = 255;
    }
    const tensor = warpToTensor({ data: rgba, width: s.width, height: s.height }, s.warp as unknown as Matrix3, s.outWidth, s.outHeight);
    const plane = s.outWidth * s.outHeight;
    let worst = 0;
    for (let p = 0; p < plane; p += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        const expected = s.expected[p * 3 + (2 - channel)]!; // BGR → RGB
        worst = Math.max(worst, Math.abs(tensor[channel * plane + p]! * 255 - expected));
      }
    }
    // OpenCV interpolates in fixed point (1/32 of a pixel), so a level or two apart is expected.
    expect(worst).toBeLessThanOrEqual(3);
  });

  it('decodes the same tips, in the same order, with the same scores', () => {
    const heat = new Float32Array(TIP_GRID * TIP_GRID);
    const offset = new Float32Array(2 * TIP_GRID * TIP_GRID);
    for (const [y, x, value] of fixture.decode.heat) heat[y * TIP_GRID + x] = value;
    for (const [y, x, dx, dy] of fixture.decode.offset) {
      offset[y * TIP_GRID + x] = dx;
      offset[TIP_GRID * TIP_GRID + y * TIP_GRID + x] = dy;
    }

    const tips = decodeTips(heat, offset);
    expect(tips).toHaveLength(fixture.decode.expected.length);
    tips.forEach((tip, i) => {
      const expected = fixture.decode.expected[i]!;
      expect(tip.rect.x).toBeCloseTo(expected.x, 4);
      expect(tip.rect.y).toBeCloseTo(expected.y, 4);
      expect(tip.board.x).toBeCloseTo(expected.board[0]!, 4);
      expect(tip.board.y).toBeCloseTo(expected.board[1]!, 4);
      expect(tip.confidence).toBeCloseTo(expected.confidence, 6);
      expect(pythonLabel(tip.hit)).toBe(expected.label);
    });
  });
});

describe('prescale', () => {
  it('leaves a warp that barely shrinks alone', () => {
    expect(prescale([1, 0, 0, 0, 1, 0, 0, 0, 1]).factor).toBe(1);
  });

  it('shrinks the photograph first when the warp would skip pixels', () => {
    const { factor, warp } = prescale([0.2, 0, 0, 0, 0.2, 0, 0, 0, 1]);
    expect(factor).toBeCloseTo(0.3);
    expect(warp[0]).toBeCloseTo(0.2 / 0.3);
  });
});

/** The label format the Python writes: T20, D5, 20, 25, BULL, 0. */
function pythonLabel(hit: Hit): string {
  if (hit.ring === 'miss') return '0';
  if (hit.ring === 'bull') return 'BULL';
  if (hit.ring === 'outerBull') return '25';
  return `${hit.ring === 'double' ? 'D' : hit.ring === 'treble' ? 'T' : ''}${hit.sector}`;
}
