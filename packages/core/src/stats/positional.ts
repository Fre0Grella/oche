/**
 * The statistics that need to know *where* a dart landed, not just what it
 * scored — the half of `docs/04-stats.md` that this project exists for.
 *
 * Everything here works on board millimetres, so it does not care whether the
 * position came from a finger on the board or from the camera.
 */

import { BOARD, scoreAt, sectorAngle, sectorAtAngle, type Hit, type Point } from '../board/geometry.js';
import type { DartSource, MatchSnapshot } from '../game/x01.js';

export interface PositionedDart {
  playerId: string;
  pos: Point;
  hit: Hit;
  source: DartSource;
  ts: number;
  atFinish: boolean;
  remainingBefore: number;
}

export interface PositionedFilter {
  playerId?: string;
  /** Which entry methods count. Tapped positions are coarser than camera ones. */
  sources?: readonly DartSource[];
  since?: number;
}

export function positionedDarts(
  snapshots: readonly MatchSnapshot[],
  filter: PositionedFilter = {},
): PositionedDart[] {
  const darts: PositionedDart[] = [];

  for (const snapshot of snapshots) {
    for (const leg of snapshot.legs) {
      for (const visit of leg.visits) {
        if (filter.playerId && visit.playerId !== filter.playerId) continue;
        for (const dart of visit.darts) {
          if (!dart.pos) continue;
          if (filter.sources && !filter.sources.includes(dart.source)) continue;
          if (filter.since !== undefined && dart.ts < filter.since) continue;
          darts.push({
            playerId: visit.playerId,
            pos: dart.pos,
            hit: dart.hit,
            source: dart.source,
            ts: dart.ts,
            atFinish: dart.atFinish,
            remainingBefore: dart.remainingBefore,
          });
        }
      }
    }
  }

  return darts;
}

export interface Grouping {
  count: number;
  centroid: Point;
  /** Spread along the line from the bull outwards: release timing. */
  along: number;
  /** Spread across it: alignment. */
  across: number;
  /** Mean distance from the centroid — the number to quote as "group size". */
  spread: number;
}

/**
 * How tightly a set of darts sits together, split into the two directions that
 * have different causes: up and down the sector (release timing) versus side to
 * side (alignment).
 */
export function grouping(points: readonly Point[]): Grouping | null {
  if (points.length < 2) return null;

  const centroid = {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  };

  // "Along" is radially outward from the bull through the centroid; if the
  // centroid is the bull itself, any axis will do.
  const radius = Math.hypot(centroid.x, centroid.y);
  const ux = radius > 1 ? centroid.x / radius : 0;
  const uy = radius > 1 ? centroid.y / radius : 1;

  let alongSum = 0;
  let acrossSum = 0;
  let spread = 0;

  for (const point of points) {
    const dx = point.x - centroid.x;
    const dy = point.y - centroid.y;
    const along = dx * ux + dy * uy;
    const across = -dx * uy + dy * ux;
    alongSum += along * along;
    acrossSum += across * across;
    spread += Math.hypot(dx, dy);
  }

  return {
    count: points.length,
    centroid,
    along: Math.sqrt(alongSum / points.length),
    across: Math.sqrt(acrossSum / points.length),
    spread: spread / points.length,
  };
}

export interface Bias {
  /** Offset of the group's centre from where it was aimed, in millimetres. */
  dx: number;
  dy: number;
  distance: number;
  /** The same offset in the target's own frame: outward, and to its right. */
  outward: number;
  sideways: number;
}

export function biasFrom(points: readonly Point[], target: Point): Bias | null {
  const group = grouping(points);
  if (!group) return null;

  const dx = group.centroid.x - target.x;
  const dy = group.centroid.y - target.y;

  const radius = Math.hypot(target.x, target.y);
  const ux = radius > 1 ? target.x / radius : 0;
  const uy = radius > 1 ? target.y / radius : 1;

  return {
    dx,
    dy,
    distance: Math.hypot(dx, dy),
    outward: dx * ux + dy * uy,
    sideways: -dx * uy + dy * ux,
  };
}

export interface SectorSplit {
  sector: number;
  /** Darts judged to have been aimed at this sector. */
  total: number;
  treble: number;
  single: number;
  double: number;
  /** Landed in the sector clockwise / anticlockwise of the target. */
  clockwise: { sector: number; count: number };
  anticlockwise: { sector: number; count: number };
  /** Off the scoring area altogether. */
  off: number;
}

/**
 * What happens when a player goes at one number: the treble, the big single,
 * or one of its neighbours. For the 20 those neighbours are the 1 and the 5,
 * which is why a wide player loses so much more than the geometry suggests.
 *
 * A dart counts as aimed here if it landed in this sector or the one either
 * side of it, which is the usual convention and is stated next to the number.
 */
export function sectorSplit(darts: readonly { pos: Point }[], sector: number): SectorSplit {
  const centre = sectorAngle(sector);
  const clockwiseSector = sectorAtAngle(centre - 18);
  const anticlockwiseSector = sectorAtAngle(centre + 18);

  const split: SectorSplit = {
    sector,
    total: 0,
    treble: 0,
    single: 0,
    double: 0,
    clockwise: { sector: clockwiseSector, count: 0 },
    anticlockwise: { sector: anticlockwiseSector, count: 0 },
    off: 0,
  };

  for (const dart of darts) {
    const hit = scoreAt(dart.pos);
    const radius = Math.hypot(dart.pos.x, dart.pos.y);
    const angle = (Math.atan2(dart.pos.y, dart.pos.x) * 180) / Math.PI;
    const delta = ((((angle - centre) % 360) + 540) % 360) - 180;

    // Within one sector either side, and not in the bull, which is nobody's
    // miss when they are going at a treble.
    const nearby = Math.abs(delta) <= 27 && radius > BOARD.outerBullRadius;
    if (!nearby) continue;

    split.total += 1;

    if (hit.ring === 'miss') {
      split.off += 1;
      continue;
    }
    if (hit.sector === sector) {
      if (hit.ring === 'treble') split.treble += 1;
      else if (hit.ring === 'double') split.double += 1;
      else split.single += 1;
      continue;
    }
    if (hit.sector === clockwiseSector) split.clockwise.count += 1;
    else if (hit.sector === anticlockwiseSector) split.anticlockwise.count += 1;
    else split.off += 1;
  }

  return split;
}

export type DoubleMiss = 'hit' | 'inside' | 'outside' | 'clockwise' | 'anticlockwise';

/**
 * Where a dart at a double went. Missing D20 *high* and missing it *left* need
 * opposite fixes, and the scoreboard cannot tell them apart.
 */
export function classifyDoubleAttempt(pos: Point, target: number): DoubleMiss {
  const hit = scoreAt(pos);
  const radius = Math.hypot(pos.x, pos.y);

  if (target === 25) {
    if (hit.ring === 'bull') return 'hit';
    return radius <= BOARD.outerBullRadius ? 'inside' : 'outside';
  }

  if (hit.ring === 'double' && hit.sector === target) return 'hit';

  const centre = sectorAngle(target);
  const angle = (Math.atan2(pos.y, pos.x) * 180) / Math.PI;
  const delta = ((((angle - centre) % 360) + 540) % 360) - 180;

  if (Math.abs(delta) <= 9) {
    return radius < BOARD.doubleInnerRadius ? 'inside' : 'outside';
  }
  return delta < 0 ? 'clockwise' : 'anticlockwise';
}

/** A square grid of values over the board, in millimetres. */
export interface BoardGrid {
  /** Millimetres per cell. */
  step: number;
  /** Half-width of the grid, in millimetres. */
  half: number;
  /** Cells per side. */
  size: number;
  values: Float32Array;
}

function gridIndex(grid: BoardGrid, ix: number, iy: number): number {
  return iy * grid.size + ix;
}

export function gridPoint(grid: BoardGrid, ix: number, iy: number): Point {
  return { x: -grid.half + ix * grid.step, y: -grid.half + iy * grid.step };
}

function emptyGrid(step: number, half: number): BoardGrid {
  const size = Math.round((half * 2) / step) + 1;
  return { step, half, size, values: new Float32Array(size * size) };
}

/**
 * A separable Gaussian blur over the grid, with zero outside it.
 *
 * Zero padding is not a convenience here, it is the physics: a dart that lands
 * off the grid has landed off the board, and scores nothing.
 */
function blur(grid: BoardGrid, sigmaX: number, sigmaY: number): BoardGrid {
  const kernelFor = (sigma: number) => {
    const radius = Math.max(1, Math.ceil((3 * sigma) / grid.step));
    const weights: number[] = [];
    let total = 0;
    for (let i = -radius; i <= radius; i += 1) {
      const d = (i * grid.step) / Math.max(sigma, 1e-6);
      const w = Math.exp(-0.5 * d * d);
      weights.push(w);
      total += w;
    }
    return { radius, weights: weights.map((w) => w / total) };
  };

  const horizontal = kernelFor(sigmaX);
  const vertical = kernelFor(sigmaY);

  const pass1 = new Float32Array(grid.values.length);
  for (let iy = 0; iy < grid.size; iy += 1) {
    for (let ix = 0; ix < grid.size; ix += 1) {
      let sum = 0;
      for (let k = -horizontal.radius; k <= horizontal.radius; k += 1) {
        const sx = ix + k;
        if (sx < 0 || sx >= grid.size) continue;
        sum += grid.values[gridIndex(grid, sx, iy)]! * horizontal.weights[k + horizontal.radius]!;
      }
      pass1[gridIndex(grid, ix, iy)] = sum;
    }
  }

  const out = new Float32Array(grid.values.length);
  for (let iy = 0; iy < grid.size; iy += 1) {
    for (let ix = 0; ix < grid.size; ix += 1) {
      let sum = 0;
      for (let k = -vertical.radius; k <= vertical.radius; k += 1) {
        const sy = iy + k;
        if (sy < 0 || sy >= grid.size) continue;
        sum += pass1[gridIndex(grid, ix, sy)]! * vertical.weights[k + vertical.radius]!;
      }
      out[gridIndex(grid, ix, iy)] = sum;
    }
  }

  return { ...grid, values: out };
}

export interface AimMap extends BoardGrid {
  /** Where to aim, and what it is worth per dart. */
  best: { point: Point; expected: number };
  /** What aiming at the treble 20 is worth, for comparison. */
  trebleTwenty: number;
  sigma: { along: number; across: number };
}

/**
 * The personalised aiming map from Tibshirani, Price & Taylor, *A statistician
 * plays darts* (JRSS-A, 2011): model a throw as a Gaussian around the intended
 * point, and the expected score of aiming anywhere is the board's score
 * function convolved with that Gaussian.
 *
 * Its maximum is where *this* player should aim. The paper's headline is that
 * the treble 20 is only optimal for a tight group: widen the spread and the
 * best target moves to the 19s, and wider still, to the middle of the board —
 * because the neighbours of the 20 (1 and 5) punish a miss far harder than the
 * neighbours of the 19 (7 and 3) do.
 */
export function expectedScoreMap(sigmaX: number, sigmaY: number, step = 4, half = 180): AimMap {
  const grid = emptyGrid(step, half);

  for (let iy = 0; iy < grid.size; iy += 1) {
    for (let ix = 0; ix < grid.size; ix += 1) {
      grid.values[gridIndex(grid, ix, iy)] = scoreAt(gridPoint(grid, ix, iy)).value;
    }
  }

  const expected = blur(grid, Math.max(sigmaX, 0.5), Math.max(sigmaY, 0.5));

  let best = { point: { x: 0, y: 0 }, expected: -1 };
  for (let iy = 0; iy < expected.size; iy += 1) {
    for (let ix = 0; ix < expected.size; ix += 1) {
      const value = expected.values[gridIndex(expected, ix, iy)]!;
      if (value > best.expected) best = { point: gridPoint(expected, ix, iy), expected: value };
    }
  }

  return {
    ...expected,
    best,
    trebleTwenty: sampleGrid(expected, { x: 0, y: 103 }),
    sigma: { along: sigmaX, across: sigmaY },
  };
}

/** The grid's value at a board position, nearest cell. */
export function sampleGrid(grid: BoardGrid, point: Point): number {
  const ix = Math.round((point.x + grid.half) / grid.step);
  const iy = Math.round((point.y + grid.half) / grid.step);
  if (ix < 0 || iy < 0 || ix >= grid.size || iy >= grid.size) return 0;
  return grid.values[gridIndex(grid, ix, iy)] ?? 0;
}

/**
 * Where the darts went, as a smooth density for drawing over the board.
 * Values are normalised so the busiest cell is 1.
 */
export function densityGrid(
  points: readonly Point[],
  step = 4,
  half = 180,
  bandwidth = 9,
): BoardGrid {
  const grid = emptyGrid(step, half);
  if (points.length === 0) return grid;

  for (const point of points) {
    const ix = Math.round((point.x + half) / step);
    const iy = Math.round((point.y + half) / step);
    if (ix < 0 || iy < 0 || ix >= grid.size || iy >= grid.size) continue;
    grid.values[gridIndex(grid, ix, iy)] += 1;
  }

  const smooth = blur(grid, bandwidth, bandwidth);
  let peak = 0;
  for (const value of smooth.values) peak = Math.max(peak, value);
  if (peak > 0) {
    for (let i = 0; i < smooth.values.length; i += 1) smooth.values[i]! /= peak;
  }
  return smooth;
}

/**
 * The spread to feed the aiming map, estimated from the darts a player threw at
 * their most-used number.
 *
 * The paper estimates the covariance by EM, because it does not know what the
 * player was aiming at. Here the aim is inferred instead: scoring darts (not
 * finishing ones) cluster on one number, so the busiest sector is taken as the
 * intended target and the spread is measured around that cluster's own centre.
 * The assumption is stated in the UI next to the result.
 */
export function estimateSpread(darts: readonly PositionedDart[]): Grouping | null {
  const scoring = darts.filter((dart) => !dart.atFinish);
  if (scoring.length < 10) return null;

  const counts = new Map<number, PositionedDart[]>();
  for (const dart of scoring) {
    const angle = (Math.atan2(dart.pos.y, dart.pos.x) * 180) / Math.PI;
    const sector = sectorAtAngle(angle);
    const list = counts.get(sector) ?? [];
    list.push(dart);
    counts.set(sector, list);
  }

  const busiest = [...counts.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (!busiest) return null;

  // Include the neighbours: a wide player's misses are part of their spread,
  // and leaving them out would flatter the estimate.
  const centre = sectorAngle(busiest[0]);
  const cluster = scoring.filter((dart) => {
    const angle = (Math.atan2(dart.pos.y, dart.pos.x) * 180) / Math.PI;
    const delta = ((((angle - centre) % 360) + 540) % 360) - 180;
    return Math.abs(delta) <= 27;
  });

  return grouping(cluster.map((dart) => dart.pos));
}
