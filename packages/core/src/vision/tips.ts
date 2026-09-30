/**
 * The tip model's side of the pipeline that is plain arithmetic: the rectified
 * view it is shown, the warp into it, and turning its two output arrays into
 * darts. The model itself runs in the web app; everything here is testable
 * without a browser, and `__fixtures__/tips-parity.json` holds it to the Python
 * that trained the model (`ml/oche_ml/board.py`, `dataset.py`, `decode.py`).
 *
 * The spec is written down in docs/03-autoscorer.md, "The rectified view,
 * exactly". Change it there, in Python and here, or not at all.
 */

import { scoreAt, type Hit, type Point } from '../board/geometry.js';
import { applyHomography, invertHomography, multiply3, type Matrix3 } from './homography.js';

export const RECT_SIZE = 512;
export const RECT_HALF_MM = 230;
export const TIP_STRIDE = 4;
export const TIP_GRID = RECT_SIZE / TIP_STRIDE;
export const TIP_THRESHOLD = 0.3;
export const MAX_TIPS = 6;

const SCALE = RECT_SIZE / (2 * RECT_HALF_MM);

/** Board millimetres → rectified pixels: bull in the middle, the 20 up. */
export const BOARD_TO_RECT: Matrix3 = [SCALE, 0, RECT_SIZE / 2, 0, -SCALE, RECT_SIZE / 2, 0, 0, 1];
export const RECT_TO_BOARD: Matrix3 = invertHomography(BOARD_TO_RECT)!;

/** Photograph pixels → rectified pixels, given the calibration's photograph → board. */
export function imageToRect(toBoard: Matrix3): Matrix3 {
  return multiply3(BOARD_TO_RECT, toBoard);
}

/**
 * How much to shrink the photograph before warping, so bilinear sampling does
 * not skip pixels: a factor ≤ 1 and the warp to use on the shrunk photograph.
 * Same rule as `warp_to_rect` in Python.
 */
export function prescale(warp: Matrix3): { factor: number; warp: Matrix3 } {
  const inverse = invertHomography(warp);
  if (!inverse) return { factor: 1, warp };
  const bull = applyHomography(inverse, { x: RECT_SIZE / 2, y: RECT_SIZE / 2 });
  const a = applyHomography(warp, bull);
  const b = applyHomography(warp, { x: bull.x + 1, y: bull.y });
  const c = applyHomography(warp, { x: bull.x, y: bull.y + 1 });
  const scale = Math.sqrt(Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)));
  if (scale >= 0.66) return { factor: 1, warp };
  const factor = Math.min(1, scale * 1.5);
  return { factor, warp: multiply3(warp, [1 / factor, 0, 0, 0, 1 / factor, 0, 0, 0, 1]) };
}

export interface Pixels {
  /** RGBA, row-major, as ImageData holds it. */
  readonly data: Uint8ClampedArray | Uint8Array;
  readonly width: number;
  readonly height: number;
}

/**
 * Samples `pixels` through `warp` (source → destination) into a destination of
 * the given size, bilinearly, black outside the source — what OpenCV's
 * warpPerspective does. Returns RGB channel-first floats in 0–1, the model's
 * input layout.
 */
export function warpToTensor(pixels: Pixels, warp: Matrix3, width = RECT_SIZE, height = RECT_SIZE): Float32Array {
  const inverse = invertHomography(warp);
  const out = new Float32Array(3 * width * height);
  if (!inverse) return out;

  const [a, b, c, d, e, f, g, h, i] = inverse;
  const { data, width: sw, height: sh } = pixels;
  const plane = width * height;
  const at = (x: number, y: number, channel: number) =>
    x < 0 || y < 0 || x >= sw || y >= sh ? 0 : data[(y * sw + x) * 4 + channel]!;

  for (let v = 0; v < height; v += 1) {
    for (let u = 0; u < width; u += 1) {
      const w = g * u + h * v + i;
      const sx = (a * u + b * v + c) / w;
      const sy = (d * u + e * v + f) / w;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      if (x0 < -1 || y0 < -1 || x0 >= sw || y0 >= sh) continue;
      const fx = sx - x0;
      const fy = sy - y0;
      const index = v * width + u;
      for (let channel = 0; channel < 3; channel += 1) {
        const top = at(x0, y0, channel) * (1 - fx) + at(x0 + 1, y0, channel) * fx;
        const bottom = at(x0, y0 + 1, channel) * (1 - fx) + at(x0 + 1, y0 + 1, channel) * fx;
        out[channel * plane + index] = (top * (1 - fy) + bottom * fy) / 255;
      }
    }
  }
  return out;
}

export interface Tip {
  /** Rectified pixels. */
  rect: Point;
  /** Board millimetres. */
  board: Point;
  hit: Hit;
  /** The heatmap's peak, 0–1. */
  confidence: number;
}

/**
 * The model's two outputs → tips, strongest first. `heat` is TIP_GRID² values
 * after the sigmoid; `offset` is two such planes, x then y, each 0–1 within
 * its cell. A tip is a cell at least as high as its eight neighbours and above
 * the threshold.
 */
export function decodeTips(
  heat: ArrayLike<number>,
  offset: ArrayLike<number>,
  threshold = TIP_THRESHOLD,
  max = MAX_TIPS,
): Tip[] {
  const n = TIP_GRID;
  const peaks: { x: number; y: number; value: number }[] = [];
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const value = heat[y * n + x]!;
      if (value < threshold) continue;
      let peak = true;
      for (let dy = -1; dy <= 1 && peak; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
          if (heat[ny * n + nx]! > value) {
            peak = false;
            break;
          }
        }
      }
      if (peak) peaks.push({ x, y, value });
    }
  }
  peaks.sort((p, q) => q.value - p.value);

  return peaks.slice(0, max).map(({ x, y, value }) => {
    const rect = {
      x: (x + offset[y * n + x]!) * TIP_STRIDE,
      y: (y + offset[n * n + y * n + x]!) * TIP_STRIDE,
    };
    const board = applyHomography(RECT_TO_BOARD, rect);
    return { rect, board, hit: scoreAt(board), confidence: value };
  });
}
