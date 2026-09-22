import { describe, expect, it } from 'vitest';

import { assessBoardView, type ViewIssueCode } from './quality.js';
import { multiply3, type Matrix3 } from './homography.js';

const FRAME = { width: 1280, height: 720 };

/**
 * A synthetic camera: the board plane tilted by `tilt` degrees about the
 * horizontal axis, seen from distance `d`, scaled so the board is `scale`
 * pixels per millimetre at the bull, and centred at (cx, cy) in the image.
 * Image y points down, as it does in a real frame.
 */
function view(tilt: number, scale: number, cx = FRAME.width / 2, cy = FRAME.height / 2): Matrix3 {
  const theta = (tilt * Math.PI) / 180;
  const d = 1000;
  const f = d * scale;
  const camera: Matrix3 = [f, 0, 0, 0, -f * Math.cos(theta), 0, 0, -Math.sin(theta), d];
  const translate: Matrix3 = [1, 0, cx, 0, 1, cy, 0, 0, 1];
  return multiply3(translate, camera);
}

const codes = (issues: { code: ViewIssueCode }[]) => issues.map((issue) => issue.code);

describe('assessBoardView', () => {
  it('is happy with a board filling half the frame, seen from a little off-axis', () => {
    const assessment = assessBoardView(view(25, 1.2), FRAME);

    expect(assessment.ok).toBe(true);
    expect(codes(assessment.issues)).toEqual([]);
    expect(assessment.coverage).toBeGreaterThan(0.4);
    expect(assessment.coverage).toBeLessThan(1);
    expect(assessment.tilt).toBeGreaterThan(15);
    expect(assessment.tilt).toBeLessThan(40);
  });

  it('notices a face-on view, where a dart hides behind itself', () => {
    const assessment = assessBoardView(view(0, 1.2), FRAME);
    expect(codes(assessment.issues)).toContain('tooFlat');
    expect(assessment.tilt).toBeLessThan(5);
    expect(assessment.cameraSide).toBeNull();
  });

  it('notices a view so oblique the board is a slot', () => {
    expect(codes(assessBoardView(view(65, 1.2), FRAME).issues)).toContain('tooSteep');
  });

  it('says which way to turn when the board runs off the picture', () => {
    const offLeft = assessBoardView(view(25, 1.2, 60), FRAME);
    expect(offLeft.ok).toBe(false);
    const issue = offLeft.issues.find((candidate) => candidate.code === 'offFrame');
    expect(issue?.direction).toBe('left');

    const offRight = assessBoardView(view(25, 1.2, FRAME.width - 60), FRAME);
    expect(offRight.issues.find((c) => c.code === 'offFrame')?.direction).toBe('right');

    const offTop = assessBoardView(view(25, 1.2, FRAME.width / 2, 40), FRAME);
    expect(offTop.issues.find((c) => c.code === 'offFrame')?.direction).toBe('up');
  });

  it('asks for the camera to come closer, or back off', () => {
    expect(codes(assessBoardView(view(25, 0.4), FRAME).issues)).toContain('tooSmall');
    expect(codes(assessBoardView(view(25, 2.0), FRAME).issues)).toContain('tooClose');
  });

  it('nudges a board that is in frame but off to one side', () => {
    const assessment = assessBoardView(view(25, 0.9, FRAME.width / 2 - 260), FRAME);
    const issue = assessment.issues.find((candidate) => candidate.code === 'offCentre');
    expect(issue?.direction).toBe('left');
    expect(assessment.ok).toBe(true); // worth saying, not worth stopping for
  });

  it('works out which side of the board the camera is on', () => {
    // Tilted about the horizontal axis with the camera above the board.
    expect(assessBoardView(view(30, 1.2), FRAME).cameraSide).toBe('up');
  });

  it('refuses a degenerate homography instead of reporting nonsense', () => {
    const broken: Matrix3 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    const assessment = assessBoardView(broken, FRAME);
    expect(assessment.ok).toBe(false);
    expect(codes(assessment.issues)).toContain('offFrame');
  });
});
