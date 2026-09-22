/**
 * The setup coach: is the camera looking at the board properly, and if not,
 * which way should it move?
 *
 * Everything here is derived from the calibration homography, which is to say
 * from where the board actually is in the picture — no model, no guessing. The
 * app can therefore tell someone "the board is cut off on the left, turn the
 * camera right" instead of leaving them to work it out from a preview.
 *
 * Messages live in the app's locale files; this returns codes and directions.
 */

import { BOARD, type Point } from '../board/geometry.js';
import { applyHomography, type Matrix3 } from './homography.js';

export type Direction = 'left' | 'right' | 'up' | 'down';

export type ViewIssueCode =
  | 'offFrame' // part of the board is outside the picture
  | 'tooSmall' // the board occupies too little of the frame to read a tip
  | 'tooClose' // it nearly fills the frame, so a stray dart lands out of shot
  | 'offCentre'
  | 'tooFlat' // nearly face-on: a dart sticking out is hidden behind itself
  | 'tooSteep'; // so oblique the far side of the board is badly foreshortened

export interface ViewIssue {
  code: ViewIssueCode;
  severity: 'error' | 'warn';
  /** Which way to move the camera, where that makes sense. */
  direction?: Direction;
}

export interface ViewAssessment {
  /** True when nothing is wrong enough to stop play. */
  ok: boolean;
  issues: ViewIssue[];
  /** Board width in the picture ÷ the shorter side of the frame. */
  coverage: number;
  /** Degrees away from face-on, estimated from how elliptical the board looks. */
  tilt: number;
  /** Distance of the bull from the centre of the frame, as a fraction of it. */
  centreOffset: number;
  /** Which side of the board the camera is on, when there is enough tilt. */
  cameraSide: Direction | null;
}

function ring(toImage: Matrix3, radius: number, step = 10): Point[] {
  const points: Point[] = [];
  for (let angle = 0; angle < 360; angle += step) {
    const rad = (angle * Math.PI) / 180;
    points.push(applyHomography(toImage, { x: radius * Math.cos(rad), y: radius * Math.sin(rad) }));
  }
  return points;
}

/** Principal axes of a set of points, longest first. */
function principalAxes(points: readonly Point[], centre: Point): { major: number; minor: number } {
  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (const p of points) {
    const dx = p.x - centre.x;
    const dy = p.y - centre.y;
    xx += dx * dx;
    yy += dy * dy;
    xy += dx * dy;
  }
  const n = points.length || 1;
  xx /= n;
  yy /= n;
  xy /= n;

  const mean = (xx + yy) / 2;
  const diff = Math.sqrt(((xx - yy) / 2) ** 2 + xy * xy);
  return { major: Math.sqrt(Math.max(0, mean + diff)), minor: Math.sqrt(Math.max(0, mean - diff)) };
}

/**
 * How the camera is placed, judged from the board's outline in the picture.
 *
 * The thresholds encode a playing setup rather than a photographic ideal: a
 * board that fills about half the frame, seen from far enough off-axis that a
 * dart sticking out of it is visible, with room around it for a dart that
 * misses.
 */
export function assessBoardView(
  toImage: Matrix3,
  frame: { width: number; height: number },
): ViewAssessment {
  const outline = ring(toImage, BOARD.doubleOuterRadius);
  const centre = applyHomography(toImage, { x: 0, y: 0 });
  const issues: ViewIssue[] = [];

  if (
    !Number.isFinite(centre.x) ||
    !Number.isFinite(centre.y) ||
    outline.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))
  ) {
    return {
      ok: false,
      issues: [{ code: 'offFrame', severity: 'error' }],
      coverage: 0,
      tilt: 0,
      centreOffset: 1,
      cameraSide: null,
    };
  }

  const xs = outline.map((p) => p.x);
  const ys = outline.map((p) => p.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);

  // Off the edge of the picture: name the side, and the way to turn the camera
  // to bring it back. A board off the left edge needs the camera turned left.
  const overflow = (
    [
      { direction: 'left', amount: -left },
      { direction: 'right', amount: right - frame.width },
      { direction: 'up', amount: -top },
      { direction: 'down', amount: bottom - frame.height },
    ] as { direction: Direction; amount: number }[]
  ).filter((candidate) => candidate.amount > 0);

  if (overflow.length > 0) {
    const worst = overflow.reduce((a, b) => (a.amount >= b.amount ? a : b));
    issues.push({ code: 'offFrame', severity: 'error', direction: worst.direction });
  }

  const boardWidth = Math.max(right - left, bottom - top);
  const shortSide = Math.min(frame.width, frame.height);
  const coverage = shortSide > 0 ? boardWidth / shortSide : 0;

  // Above ~0.85 the board fills the frame, which sounds good and is not: a
  // dart that misses the board lands outside the picture, and so does the hand
  // that comes to pull them out, which the capture trigger relies on seeing.
  if (coverage < 0.4) issues.push({ code: 'tooSmall', severity: 'warn' });
  else if (coverage > 0.85) issues.push({ code: 'tooClose', severity: 'warn' });

  const centreOffset = shortSide > 0
    ? Math.hypot(centre.x - frame.width / 2, centre.y - frame.height / 2) / shortSide
    : 1;

  if (centreOffset > 0.25 && overflow.length === 0) {
    const dx = centre.x - frame.width / 2;
    const dy = centre.y - frame.height / 2;
    // The board sits left of centre → turn the camera left to centre it.
    const direction: Direction =
      Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
    issues.push({ code: 'offCentre', severity: 'warn', direction });
  }

  // A circle seen face-on stays a circle; the more oblique the view, the
  // flatter the ellipse. acos of the axis ratio is a good enough tilt estimate
  // for telling someone to move.
  const { major, minor } = principalAxes(outline, centre);
  const ratio = major > 0 ? Math.min(1, minor / major) : 1;
  const tilt = (Math.acos(ratio) * 180) / Math.PI;

  if (tilt < 8) issues.push({ code: 'tooFlat', severity: 'warn' });
  else if (tilt > 55) issues.push({ code: 'tooSteep', severity: 'warn' });

  // Which side is nearer the camera: that half of the board is drawn larger.
  let cameraSide: Direction | null = null;
  if (tilt >= 8) {
    const leftEdge = applyHomography(toImage, { x: -BOARD.doubleOuterRadius, y: 0 });
    const rightEdge = applyHomography(toImage, { x: BOARD.doubleOuterRadius, y: 0 });
    const topEdge = applyHomography(toImage, { x: 0, y: BOARD.doubleOuterRadius });
    const bottomEdge = applyHomography(toImage, { x: 0, y: -BOARD.doubleOuterRadius });

    const horizontal = Math.hypot(rightEdge.x - centre.x, rightEdge.y - centre.y) -
      Math.hypot(leftEdge.x - centre.x, leftEdge.y - centre.y);
    const vertical = Math.hypot(bottomEdge.x - centre.x, bottomEdge.y - centre.y) -
      Math.hypot(topEdge.x - centre.x, topEdge.y - centre.y);

    cameraSide =
      Math.abs(horizontal) > Math.abs(vertical)
        ? horizontal > 0
          ? 'right'
          : 'left'
        : vertical > 0
          ? 'down'
          : 'up';
  }

  return {
    ok: !issues.some((issue) => issue.severity === 'error'),
    issues,
    coverage,
    tilt,
    centreOffset,
    cameraSide,
  };
}
