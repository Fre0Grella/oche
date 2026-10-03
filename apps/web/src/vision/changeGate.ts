/**
 * Did anything change where the model sees a new dart?
 *
 * The model looks at one photograph. Next to a dart already in the board it
 * sometimes sees a second tip that is not there (a black dart, a shadow, the
 * old dart's own barrel), and with nothing to compare it proposes that phantom
 * as the new dart. The app has something to compare: the previous photograph
 * of the same visit, taken before the new dart was thrown. A real new dart
 * changes the pixels where it landed; a phantom sits on pixels that look
 * exactly as they did.
 *
 * Measured on the 124 photographs of 2026-10-03 with tips-v3, on photographs
 * with a dart carried from the one before: right proposals changed by 5.8 grey
 * levels and more (one exception), phantoms beside an old dart by 5.1 at most.
 * Dropping candidates under NEW_DART_CHANGE and proposing the strongest of the
 * rest took right proposals from 85 to 88 and phantoms beside an old dart from
 * 9 to 1 (a Python replay of the app's proposal rule with this measure).
 */

import { applyHomography, type Matrix3, type Point } from '@treblewise/core';

/** Grey levels, after brightness drift is taken out: under this, nothing landed. */
export const NEW_DART_CHANGE = 5;
/** The patch around a candidate tip that is compared, in board millimetres. */
const PATCH_MM = 5;
/** The board's playing area plus the number ring, in board millimetres. */
const BOARD_MM = 170;

/**
 * For each point (board millimetres), the mean absolute difference between the
 * two greyscale photographs in a small disc around it, less the typical
 * difference over the whole board. The earlier photograph is scaled to the
 * later one's brightness first, so a room getting lighter is not a change.
 */
export function localChanges(
  before: ArrayLike<number>,
  after: ArrayLike<number>,
  width: number,
  height: number,
  toImage: Matrix3,
  points: readonly Point[],
): number[] {
  const centre = applyHomography(toImage, { x: 0, y: 0 });
  const edge = applyHomography(toImage, { x: BOARD_MM, y: 0 });
  const radius = Math.hypot(edge.x - centre.x, edge.y - centre.y);
  const x0 = Math.max(0, Math.floor(centre.x - radius));
  const x1 = Math.min(width - 1, Math.ceil(centre.x + radius));
  const y0 = Math.max(0, Math.floor(centre.y - radius));
  const y1 = Math.min(height - 1, Math.ceil(centre.y + radius));

  let sumBefore = 0;
  let sumAfter = 0;
  let count = 0;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if ((x - centre.x) ** 2 + (y - centre.y) ** 2 > radius * radius) continue;
      const i = y * width + x;
      sumBefore += before[i]!;
      sumAfter += after[i]!;
      count += 1;
    }
  }
  if (count === 0) return points.map(() => 0);
  const scale = sumAfter / count / Math.max(sumBefore / count, 1);

  const diffs = new Float32Array(count);
  let k = 0;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if ((x - centre.x) ** 2 + (y - centre.y) ** 2 > radius * radius) continue;
      const i = y * width + x;
      diffs[k] = Math.abs(after[i]! - before[i]! * scale);
      k += 1;
    }
  }
  diffs.sort();
  const floor = diffs[Math.floor(count / 2)]!;

  return points.map((point) => {
    const p = applyHomography(toImage, point);
    const q = applyHomography(toImage, { x: point.x + 1, y: point.y });
    const r = PATCH_MM * Math.hypot(q.x - p.x, q.y - p.y);
    let total = 0;
    let n = 0;
    for (let y = Math.max(0, Math.floor(p.y - r)); y <= Math.min(height - 1, Math.ceil(p.y + r)); y += 1) {
      for (let x = Math.max(0, Math.floor(p.x - r)); x <= Math.min(width - 1, Math.ceil(p.x + r)); x += 1) {
        if ((x - p.x) ** 2 + (y - p.y) ** 2 > r * r) continue;
        const i = y * width + x;
        total += Math.abs(after[i]! - before[i]! * scale);
        n += 1;
      }
    }
    return n === 0 ? 0 : total / n - floor;
  });
}

/** A photograph as greyscale, at its own resolution. */
async function grey(jpeg: Blob, width: number, height: number): Promise<Float32Array> {
  const bitmap = await createImageBitmap(jpeg);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const { data } = context.getImageData(0, 0, width, height);
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = 0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!;
  }
  return out;
}

/** `localChanges` between two photographs of the same size. */
export async function changesAt(
  before: Blob,
  after: Blob,
  width: number,
  height: number,
  toImage: Matrix3,
  points: readonly Point[],
): Promise<number[]> {
  const [a, b] = await Promise.all([grey(before, width, height), grey(after, width, height)]);
  return localChanges(a, b, width, height, toImage, points);
}
