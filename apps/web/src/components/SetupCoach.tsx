/**
 * The setup coach: one line telling you whether the camera is looking at the
 * board properly, and if not, what to do about it.
 *
 * A preview alone does not answer "has it found the board?", and "point it at
 * the board from a metre away" is not advice anyone can act on while holding a
 * phone. So this says exactly one thing at a time, in the order that matters,
 * with a colour you can read from the oche.
 */

import type { Direction, ViewAssessment, ViewIssueCode } from '@oche/core';

import { useStrings } from '../i18n/index.js';
import type { ImageIssueCode, ImageQuality } from '../vision/imageStats.js';

export interface SetupCoachProps {
  calibrated: boolean;
  view: ViewAssessment | null;
  quality: ImageQuality | null;
  /** Shows the underlying numbers, for setting thresholds on a real board. */
  showNumbers?: boolean;
}

type Status = 'ready' | 'warn' | 'error';

export function SetupCoach({ calibrated, view, quality, showNumbers = false }: SetupCoachProps) {
  const t = useStrings();

  const direction = (value?: Direction) => (value ? t.coach.directions[value] : '');

  /** The one thing worth saying, and how loudly. */
  let status: Status = 'ready';
  let message: string = t.coach.ready;

  const imageIssue = (code: ImageIssueCode) => quality?.issues.includes(code) ?? false;
  const viewIssue = (code: ViewIssueCode) => view?.issues.find((issue) => issue.code === code);

  if (!calibrated) {
    status = 'error';
    message = t.coach.notCalibrated;
  } else if (imageIssue('moved')) {
    status = 'error';
    message = t.coach.moved;
  } else if (viewIssue('offFrame')) {
    status = 'error';
    message = `${t.coach.offFrame} ${direction(viewIssue('offFrame')!.direction)}`;
  } else if (imageIssue('dark')) {
    status = 'warn';
    message = t.coach.dark;
  } else if (imageIssue('glare')) {
    status = 'warn';
    message = t.coach.glare;
  } else if (imageIssue('blurry')) {
    status = 'warn';
    message = t.coach.blurry;
  } else if (viewIssue('tooSmall')) {
    status = 'warn';
    message = t.coach.tooSmall;
  } else if (viewIssue('tooClose')) {
    status = 'warn';
    message = t.coach.tooClose;
  } else if (viewIssue('tooFlat')) {
    status = 'warn';
    message = t.coach.tooFlat;
  } else if (viewIssue('tooSteep')) {
    status = 'warn';
    message = t.coach.tooSteep;
  } else if (viewIssue('offCentre')) {
    status = 'warn';
    message = `${t.coach.offCentre} ${direction(viewIssue('offCentre')!.direction)}`;
  } else if (imageIssue('washedOut')) {
    status = 'warn';
    message = t.coach.washedOut;
  }

  return (
    <div className={`coach coach-${status}`} role="status">
      <span className="coach-dot" aria-hidden="true" />
      <span className="coach-message">{message}</span>
      {showNumbers && view && quality && (
        <span className="coach-numbers">
          {t.coach.fill} {Math.round(view.coverage * 100)}% · {t.coach.angle}{' '}
          {Math.round(view.tilt)}° · {t.coach.light} {Math.round(quality.brightness)} ·{' '}
          {t.coach.detail} {Math.round(quality.sharpness)}
        </span>
      )}
    </div>
  );
}
