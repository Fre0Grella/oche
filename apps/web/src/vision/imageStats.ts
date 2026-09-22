/**
 * What the picture itself looks like: bright enough, sharp enough, and still
 * the same view it was calibrated for.
 *
 * The geometry half of the setup coach lives in `@oche/core` (where the board
 * is, which way to move). This half is about the pixels, and runs on the same
 * 64×64 greyscale crop of the board that the capture trigger uses.
 *
 * The thresholds are starting points. Every number is returned as well as
 * judged, and the app shows them, so a real session can correct them.
 */

export type ImageIssueCode = 'dark' | 'washedOut' | 'glare' | 'blurry' | 'moved';

export interface ImageQuality {
  /** Mean brightness, 0–255. */
  brightness: number;
  /** Fraction of the board that is blown out, 0–1. */
  glare: number;
  /** Variance of the Laplacian: high on a board full of wires, low on mush. */
  sharpness: number;
  /** Fraction of blocks that differ from the calibration reference, 0–1. */
  drift: number;
  issues: ImageIssueCode[];
}

export const IMAGE_THRESHOLDS = {
  dark: 45,
  washedOut: 215,
  glare: 0.04,
  sharpness: 25,
  drift: 0.35,
  blockDifference: 14,
};

function laplacianVariance(pixels: Uint8Array, width: number, height: number): number {
  let sum = 0;
  let sumSquares = 0;
  let count = 0;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const value =
        4 * pixels[i]! - pixels[i - 1]! - pixels[i + 1]! - pixels[i - width]! - pixels[i + width]!;
      sum += value;
      sumSquares += value * value;
      count += 1;
    }
  }

  if (count === 0) return 0;
  const mean = sum / count;
  return sumSquares / count - mean * mean;
}

/**
 * How much of the view has changed since calibration, measured in blocks. One
 * dart moves a block or two; a knocked camera moves most of them, which is the
 * difference between "something landed" and "this calibration is now wrong".
 */
export function driftFraction(
  current: Uint8Array,
  reference: Uint8Array,
  width: number,
  height: number,
  blockSize = 8,
): number {
  if (current.length !== reference.length || current.length !== width * height) return 0;

  let moved = 0;
  let blocks = 0;

  for (let by = 0; by < height; by += blockSize) {
    for (let bx = 0; bx < width; bx += blockSize) {
      let total = 0;
      let count = 0;
      for (let y = by; y < Math.min(by + blockSize, height); y += 1) {
        for (let x = bx; x < Math.min(bx + blockSize, width); x += 1) {
          const i = y * width + x;
          total += Math.abs(current[i]! - reference[i]!);
          count += 1;
        }
      }
      if (count === 0) continue;
      blocks += 1;
      if (total / count > IMAGE_THRESHOLDS.blockDifference) moved += 1;
    }
  }

  return blocks === 0 ? 0 : moved / blocks;
}

export function assessImage(
  pixels: Uint8Array,
  width: number,
  height: number,
  reference?: Uint8Array | null,
): ImageQuality {
  let total = 0;
  let blown = 0;
  for (const value of pixels) {
    total += value;
    if (value > 245) blown += 1;
  }

  const brightness = pixels.length === 0 ? 0 : total / pixels.length;
  const glare = pixels.length === 0 ? 0 : blown / pixels.length;
  const sharpness = laplacianVariance(pixels, width, height);
  const drift = reference ? driftFraction(pixels, reference, width, height) : 0;

  const issues: ImageIssueCode[] = [];
  if (brightness < IMAGE_THRESHOLDS.dark) issues.push('dark');
  else if (brightness > IMAGE_THRESHOLDS.washedOut) issues.push('washedOut');
  if (glare > IMAGE_THRESHOLDS.glare) issues.push('glare');
  if (sharpness < IMAGE_THRESHOLDS.sharpness) issues.push('blurry');
  if (drift > IMAGE_THRESHOLDS.drift) issues.push('moved');

  return { brightness, glare, sharpness, drift, issues };
}
