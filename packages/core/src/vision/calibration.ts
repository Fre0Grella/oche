/**
 * Calibration landmarks and the board wireframe.
 *
 * Calibration means: which four points on the photo are which four points on a
 * real board. They have to be landmarks a person can find without a diagram and
 * hit within a millimetre or two, which rules out anything described as "the
 * corner of the 20 segment" — on a phone screen at arm's length that is a
 * guess. The four cardinal points of the double ring are unambiguous, easy to
 * name, and as far apart as points on a board can be, which is what keeps the
 * homography well conditioned.
 */

import { BOARD, type Point } from '../board/geometry.js';

export interface CalibrationLandmark {
  id: 'top' | 'right' | 'bottom' | 'left';
  /** Where it is in board millimetres. */
  board: Point;
  /** The sector whose centre line it sits on. */
  sector: number;
}

/**
 * The outer edge of the double ring, on the centre line of the 20 (top), the 6
 * (right), the 3 (bottom) and the 11 (left).
 */
export const CALIBRATION_LANDMARKS: readonly CalibrationLandmark[] = [
  { id: 'top', board: { x: 0, y: BOARD.doubleOuterRadius }, sector: 20 },
  { id: 'right', board: { x: BOARD.doubleOuterRadius, y: 0 }, sector: 6 },
  { id: 'bottom', board: { x: 0, y: -BOARD.doubleOuterRadius }, sector: 3 },
  { id: 'left', board: { x: -BOARD.doubleOuterRadius, y: 0 }, sector: 11 },
];

export const CALIBRATION_BOARD_POINTS: readonly Point[] = CALIBRATION_LANDMARKS.map((l) => l.board);

function circle(radius: number, step = 3): Point[] {
  const points: Point[] = [];
  for (let angle = 0; angle <= 360; angle += step) {
    const rad = (angle * Math.PI) / 180;
    points.push({ x: radius * Math.cos(rad), y: radius * Math.sin(rad) });
  }
  return points;
}

/**
 * The board's wires as polylines in board millimetres. Projected through the
 * calibration homography they draw the board over the camera image, which is
 * how a person can see that a calibration is right: the drawn wires sit on the
 * real ones, or they do not.
 */
export function boardWireframe(): Point[][] {
  const lines: Point[][] = [
    circle(BOARD.bullRadius),
    circle(BOARD.outerBullRadius),
    circle(BOARD.trebleInnerRadius),
    circle(BOARD.trebleOuterRadius),
    circle(BOARD.doubleInnerRadius),
    circle(BOARD.doubleOuterRadius),
  ];

  // The 20 wires between the sectors, from the outer bull to the double ring.
  for (let i = 0; i < 20; i += 1) {
    const rad = ((9 + i * 18) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    lines.push([
      { x: BOARD.outerBullRadius * cos, y: BOARD.outerBullRadius * sin },
      { x: BOARD.doubleOuterRadius * cos, y: BOARD.doubleOuterRadius * sin },
    ]);
  }

  return lines;
}
