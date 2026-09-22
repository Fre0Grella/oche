/**
 * Plane-to-plane homography: the one piece of maths that turns "a photo of a
 * board from wherever the phone happens to be" into board millimetres.
 *
 * A dartboard is flat, so any camera view of it is related to the canonical
 * board frame by a 3×3 projective transform. Four point correspondences
 * determine it; more than four are solved by least squares. Nothing here
 * assumes the camera is square-on — the phone sits on a stand a metre away and
 * slightly off-axis, exactly as it should, and the warp is done in software.
 */

import type { Point } from '../board/geometry.js';

/** Row-major 3×3, with h[8] normalised to 1 where possible. */
export type Matrix3 = readonly [number, number, number, number, number, number, number, number, number];

export const IDENTITY_3: Matrix3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function applyHomography(h: Matrix3, p: Point): Point {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  if (w === 0) return { x: Number.NaN, y: Number.NaN };
  return {
    x: (h[0] * p.x + h[1] * p.y + h[2]) / w,
    y: (h[3] * p.x + h[4] * p.y + h[5]) / w,
  };
}

export function multiply3(a: Matrix3, b: Matrix3): Matrix3 {
  const out = new Array<number>(9).fill(0);
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      let sum = 0;
      for (let k = 0; k < 3; k += 1) sum += a[row * 3 + k]! * b[k * 3 + col]!;
      out[row * 3 + col] = sum;
    }
  }
  return out as unknown as Matrix3;
}

export function invertHomography(h: Matrix3): Matrix3 | null {
  const [a, b, c, d, e, f, g, i, j] = h;
  const det = a * (e * j - f * i) - b * (d * j - f * g) + c * (d * i - e * g);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;

  const inv: number[] = [
    e * j - f * i,
    c * i - b * j,
    b * f - c * e,
    f * g - d * j,
    a * j - c * g,
    c * d - a * f,
    d * i - e * g,
    b * g - a * i,
    a * e - b * d,
  ];

  return inv.map((value) => value / det) as unknown as Matrix3;
}

/** Solves `A x = b` by Gaussian elimination with partial pivoting. */
function solveLinear(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, index) => [...row, b[index]!]);

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(m[row]![col]!) > Math.abs(m[pivot]![col]!)) pivot = row;
    }
    if (Math.abs(m[pivot]![col]!) < 1e-12) return null;
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];

    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = m[row]![col]! / m[col]![col]!;
      if (factor === 0) continue;
      for (let k = col; k <= n; k += 1) m[row]![k]! -= factor * m[col]![k]!;
    }
  }

  return m.map((row, index) => row[n]! / row[index]!);
}

interface Normalisation {
  transform: Matrix3;
  points: Point[];
}

/**
 * Hartley normalisation: centre the points and scale them to an average
 * distance of √2 from the origin. Board millimetres (≈±170) and image pixels
 * (≈±1920) differ by an order of magnitude, and without this the least-squares
 * system is badly conditioned enough to show up as visible drift in the overlay.
 */
function normalise(points: readonly Point[]): Normalisation {
  const n = points.length;
  const cx = points.reduce((sum, p) => sum + p.x, 0) / n;
  const cy = points.reduce((sum, p) => sum + p.y, 0) / n;
  const meanDistance =
    points.reduce((sum, p) => sum + Math.hypot(p.x - cx, p.y - cy), 0) / n || 1;
  const scale = Math.SQRT2 / meanDistance;

  return {
    transform: [scale, 0, -scale * cx, 0, scale, -scale * cy, 0, 0, 1],
    points: points.map((p) => ({ x: (p.x - cx) * scale, y: (p.y - cy) * scale })),
  };
}

/**
 * The homography mapping `from[i]` onto `to[i]`, or null when the points are
 * degenerate (three of them collinear, duplicates, fewer than four).
 */
export function solveHomography(from: readonly Point[], to: readonly Point[]): Matrix3 | null {
  if (from.length < 4 || from.length !== to.length) return null;
  if (from.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  if (to.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;

  const src = normalise(from);
  const dst = normalise(to);

  // Two rows per correspondence, eight unknowns (h33 is fixed at 1).
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < src.points.length; i += 1) {
    const { x, y } = src.points[i]!;
    const { x: u, y: v } = dst.points[i]!;
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }

  let solution: number[] | null;
  if (a.length === 8) {
    solution = solveLinear(a, b);
  } else {
    // Least squares through the normal equations: AᵀA x = Aᵀb.
    const ata: number[][] = Array.from({ length: 8 }, () => new Array<number>(8).fill(0));
    const atb = new Array<number>(8).fill(0);
    for (let row = 0; row < a.length; row += 1) {
      for (let i = 0; i < 8; i += 1) {
        for (let j = 0; j < 8; j += 1) ata[i]![j]! += a[row]![i]! * a[row]![j]!;
        atb[i]! += a[row]![i]! * b[row]!;
      }
    }
    solution = solveLinear(ata, atb);
  }

  if (!solution || solution.some((value) => !Number.isFinite(value))) return null;

  const normalised = [...solution, 1] as unknown as Matrix3;
  const dstInverse = invertHomography(dst.transform);
  if (!dstInverse) return null;

  const h = multiply3(dstInverse, multiply3(normalised, src.transform));
  // Fix the scale so two homographies for the same mapping compare equal.
  const scale = h[8];
  if (!Number.isFinite(scale) || scale === 0) return null;
  return h.map((value) => value / scale) as unknown as Matrix3;
}

/**
 * Root-mean-square error, in the units of `to`, of a homography over the
 * correspondences it was built from. The calibration UI shows this so a
 * mis-dropped point is visible as a number as well as a crooked overlay.
 */
export function reprojectionError(h: Matrix3, from: readonly Point[], to: readonly Point[]): number {
  if (from.length === 0 || from.length !== to.length) return Number.NaN;
  const total = from.reduce((sum, p, index) => {
    const projected = applyHomography(h, p);
    const target = to[index]!;
    return sum + (projected.x - target.x) ** 2 + (projected.y - target.y) ** 2;
  }, 0);
  return Math.sqrt(total / from.length);
}
