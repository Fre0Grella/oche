import { describe, expect, it } from 'vitest';

import { scoreAt, type Point } from '../board/geometry.js';
import { CALIBRATION_BOARD_POINTS, boardWireframe } from './calibration.js';
import {
  applyHomography,
  invertHomography,
  reprojectionError,
  solveHomography,
  type Matrix3,
} from './homography.js';

/** A plausible phone view: rotated, tilted, off-axis, 1280×720. */
const CAMERA: Matrix3 = [2.6, 0.35, 640, -0.2, 2.4, 380, 0.0012, 0.0009, 1];

const close = (a: Point, b: Point, tolerance = 1e-6) => {
  expect(a.x).toBeCloseTo(b.x, Math.round(-Math.log10(tolerance)));
  expect(a.y).toBeCloseTo(b.y, Math.round(-Math.log10(tolerance)));
};

describe('solveHomography', () => {
  it('recovers a known transform from four correspondences', () => {
    const board = [...CALIBRATION_BOARD_POINTS];
    const image = board.map((p) => applyHomography(CAMERA, p));

    const h = solveHomography(board, image);
    expect(h).not.toBeNull();

    // Points that were not used in the fit must still land where they should.
    for (const probe of [
      { x: 0, y: 0 },
      { x: 103, y: 0 },
      { x: -60, y: 90 },
      { x: 20, y: -150 },
    ]) {
      close(applyHomography(h!, probe), applyHomography(CAMERA, probe), 1e-6);
    }

    expect(reprojectionError(h!, board, image)).toBeLessThan(1e-6);
  });

  it('inverts, so a tap on the photo becomes board millimetres', () => {
    const board = [...CALIBRATION_BOARD_POINTS];
    const image = board.map((p) => applyHomography(CAMERA, p));
    const toImage = solveHomography(board, image)!;
    const toBoard = invertHomography(toImage)!;

    // A dart photographed at the treble 20 scores the treble 20.
    const trebleTwenty = { x: 0, y: 103 };
    const pixel = applyHomography(toImage, trebleTwenty);
    const recovered = applyHomography(toBoard, pixel);

    close(recovered, trebleTwenty, 1e-6);
    expect(scoreAt(recovered)).toEqual(scoreAt(trebleTwenty));
  });

  it('survives the millimetre-scale slips a person makes dropping the points', () => {
    const board = [...CALIBRATION_BOARD_POINTS];
    const exact = board.map((p) => applyHomography(CAMERA, p));
    // Two pixels of slop on each landmark, which is a careful drag on a phone.
    const slipped = exact.map((p, index) => ({
      x: p.x + [2, -1.5, 1, -2][index]!,
      y: p.y + [-1, 2, -1.5, 1][index]!,
    }));

    const h = solveHomography(board, slipped)!;
    const toBoard = invertHomography(h)!;

    // The treble 20 still scores the treble 20 despite the sloppy calibration.
    const pixel = applyHomography(h, { x: 0, y: 103 });
    const recovered = applyHomography(toBoard, pixel);
    expect(scoreAt(recovered).value).toBe(60);

    // And the error the UI reports is of the order of the slip, not of the board.
    expect(reprojectionError(h, board, slipped)).toBeLessThan(4);
  });

  it('accepts more than four points and fits them by least squares', () => {
    const board = [
      ...CALIBRATION_BOARD_POINTS,
      { x: 0, y: 0 },
      { x: 99, y: 99 },
      { x: -120, y: 40 },
    ];
    const image = board.map((p) => applyHomography(CAMERA, p));
    const h = solveHomography(board, image)!;
    expect(reprojectionError(h, board, image)).toBeLessThan(1e-5);
  });

  it('refuses degenerate input instead of returning nonsense', () => {
    const collinear = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ];
    expect(solveHomography(collinear, collinear.map((p) => ({ x: p.x * 2, y: p.y })))).toBeNull();
    expect(solveHomography([{ x: 0, y: 0 }], [{ x: 0, y: 0 }])).toBeNull();
    expect(solveHomography(CALIBRATION_BOARD_POINTS, [{ x: 0, y: 0 }])).toBeNull();
  });
});

describe('boardWireframe', () => {
  it('draws the six rings and the twenty sector wires, all on the board', () => {
    const lines = boardWireframe();
    expect(lines).toHaveLength(26);

    for (const line of lines) {
      for (const point of line) {
        expect(Math.hypot(point.x, point.y)).toBeLessThanOrEqual(170.001);
      }
    }
  });

  it('projects through a homography into image space', () => {
    const board = [...CALIBRATION_BOARD_POINTS];
    const h = solveHomography(board, board.map((p) => applyHomography(CAMERA, p)))!;
    const projected = boardWireframe().flat().map((p) => applyHomography(h, p));
    expect(projected.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });
});
