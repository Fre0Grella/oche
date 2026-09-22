/**
 * Dartboard geometry.
 *
 * All lengths are millimetres and all coordinates are in the canonical board
 * frame: the origin is the centre of the bullseye, +x points right, +y points
 * up, and the board lies in the z = 0 plane. This is the frame the vision
 * pipeline rectifies into, so a dart's position is the same number whether it
 * came from a camera, a tap on the board, or a test fixture.
 *
 * The constants are measurements of a standardised object (WDF Playing Rules /
 * PDC board specification for a 451 mm steel-tip board):
 *
 *   - overall board diameter                              451 mm
 *   - centre bull to the outside of the double wire        170 mm
 *   - centre bull to the outside of the treble wire        107 mm
 *   - double and treble beds, between the wires              8 mm
 *   - inner bull (50) diameter                            12.7 mm
 *   - outer bull (25) diameter                            31.8 mm
 *   - 20 equal sectors                                       18°
 */

/** Radii, in millimetres from the centre of the bull. */
export const BOARD = {
  /** Inner bull, worth 50. */
  bullRadius: 6.35,
  /** Outer bull ("25"), worth 25. */
  outerBullRadius: 15.9,
  /** Inside wire of the treble bed. */
  trebleInnerRadius: 99,
  /** Outside wire of the treble bed. */
  trebleOuterRadius: 107,
  /** Inside wire of the double bed. */
  doubleInnerRadius: 162,
  /** Outside wire of the double bed; beyond this a dart scores nothing. */
  doubleOuterRadius: 170,
  /** Physical edge of the board, for drawing only. */
  boardRadius: 225.5,
} as const;

/** Sector numbers in clockwise order, starting from 20 at the top. */
export const SECTORS = [
  20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5,
] as const;

/** Angular width of one sector, in degrees. */
export const SECTOR_ARC = 360 / SECTORS.length;

export type Ring = 'miss' | 'single' | 'double' | 'treble' | 'outerBull' | 'bull';

/** A scoring outcome: which sector, which ring, and what it is worth. */
export interface Hit {
  /** 1–20, or 0 for the bull rings and for a miss. */
  readonly sector: number;
  readonly ring: Ring;
  readonly value: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export const MISS: Hit = { sector: 0, ring: 'miss', value: 0 };
export const OUTER_BULL: Hit = { sector: 0, ring: 'outerBull', value: 25 };
export const BULL: Hit = { sector: 0, ring: 'bull', value: 50 };

const RING_MULTIPLIER: Record<'single' | 'double' | 'treble', number> = {
  single: 1,
  double: 2,
  treble: 3,
};

/** Builds a hit on a numbered sector. Throws on an impossible combination. */
export function hit(sector: number, ring: 'single' | 'double' | 'treble'): Hit {
  if (!Number.isInteger(sector) || sector < 1 || sector > 20) {
    throw new RangeError(`sector must be an integer 1–20, got ${sector}`);
  }
  return { sector, ring, value: sector * RING_MULTIPLIER[ring] };
}

/** True when the hit counts as a double for in/out rules (the bull is a double). */
export function isDouble(h: Hit): boolean {
  return h.ring === 'double' || h.ring === 'bull';
}

/** True when the hit counts as a treble. The bull is not a treble. */
export function isTreble(h: Hit): boolean {
  return h.ring === 'treble';
}

/** Anything that adds to the score, i.e. not a miss. */
export function isScoring(h: Hit): boolean {
  return h.ring !== 'miss';
}

/** Normalises an angle to [0, 360). */
function normaliseAngle(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Centre angle of a sector, in degrees, measured anticlockwise from +x. */
export function sectorAngle(sector: number): number {
  const index = SECTORS.indexOf(sector as (typeof SECTORS)[number]);
  if (index < 0) throw new RangeError(`not a sector number: ${sector}`);
  return normaliseAngle(90 - index * SECTOR_ARC);
}

/** The sector a given angle falls in. Sector 20 is centred on +y (90°). */
export function sectorAtAngle(deg: number): number {
  const index = Math.round(normaliseAngle(90 - deg) / SECTOR_ARC) % SECTORS.length;
  return SECTORS[index]!;
}

/** What a dart landing at `p` scores. */
export function scoreAt(p: Point): Hit {
  const r = Math.hypot(p.x, p.y);
  if (r <= BOARD.bullRadius) return BULL;
  if (r <= BOARD.outerBullRadius) return OUTER_BULL;
  if (r > BOARD.doubleOuterRadius) return MISS;

  const sector = sectorAtAngle((Math.atan2(p.y, p.x) * 180) / Math.PI);
  if (r >= BOARD.trebleInnerRadius && r <= BOARD.trebleOuterRadius) {
    return hit(sector, 'treble');
  }
  if (r >= BOARD.doubleInnerRadius) return hit(sector, 'double');
  return hit(sector, 'single');
}

/** Mid-bed radius of a ring, used to place aim points. */
function ringRadius(ring: Ring, band: 'inner' | 'outer'): number {
  switch (ring) {
    case 'bull':
      return 0;
    case 'outerBull':
      return (BOARD.bullRadius + BOARD.outerBullRadius) / 2;
    case 'treble':
      return (BOARD.trebleInnerRadius + BOARD.trebleOuterRadius) / 2;
    case 'double':
      return (BOARD.doubleInnerRadius + BOARD.doubleOuterRadius) / 2;
    case 'single':
      return band === 'inner'
        ? (BOARD.outerBullRadius + BOARD.trebleInnerRadius) / 2
        : (BOARD.trebleOuterRadius + BOARD.doubleInnerRadius) / 2;
    case 'miss':
      return BOARD.boardRadius;
  }
}

/**
 * The centre of the bed a hit refers to — where a player aiming for it aims.
 * `band` picks which of the two single beds is meant; the big outer one is the
 * default because that is what "aim for the 20" normally means.
 */
export function targetPoint(h: Hit, band: 'inner' | 'outer' = 'outer'): Point {
  const r = ringRadius(h.ring, band);
  if (r === 0) return { x: 0, y: 0 };
  const angle = h.sector === 0 ? 90 : sectorAngle(h.sector);
  const rad = (angle * Math.PI) / 180;
  return { x: r * Math.cos(rad), y: r * Math.sin(rad) };
}

/** Every radius at which the score changes, for wire-margin calculations. */
const RING_BOUNDARIES = [
  BOARD.bullRadius,
  BOARD.outerBullRadius,
  BOARD.trebleInnerRadius,
  BOARD.trebleOuterRadius,
  BOARD.doubleInnerRadius,
  BOARD.doubleOuterRadius,
];

/**
 * Distance in millimetres from `p` to the nearest boundary where the score
 * would change: a ring wire or, outside the bull, a sector wire.
 *
 * The autoscorer uses this as half of its confidence: a tip 1 mm from the
 * treble wire is a coin flip however sharp the model's heatmap peak was, and
 * the app should ask rather than assert. The statistics layer uses it for the
 * wire rate.
 */
export function wireMargin(p: Point): number {
  const r = Math.hypot(p.x, p.y);
  let margin = Math.min(...RING_BOUNDARIES.map((b) => Math.abs(r - b)));

  if (r > BOARD.outerBullRadius) {
    const deg = normaliseAngle((Math.atan2(p.y, p.x) * 180) / Math.PI);
    // Sector wires sit half a sector either side of each sector centre.
    const offset = normaliseAngle(deg - 90 + SECTOR_ARC / 2) % SECTOR_ARC;
    const toWire = Math.min(offset, SECTOR_ARC - offset);
    margin = Math.min(margin, r * Math.sin((toWire * Math.PI) / 180));
  }

  return margin;
}
