/**
 * The new darts in a photograph, the way the capture lab and a game both read
 * them: what the model sees, less the darts already in the board, less what
 * sits where nothing changed since the previous photograph.
 */

import type { Point } from '@treblewise/core';

import type { Calibration } from '../storage/types.js';
import { proposalsBeside } from '../storage/visit.js';
import type { GrabbedFrame } from './camera.js';
import { NEW_DART_CHANGE, changesAt } from './changeGate.js';
import type { Detection, Detector } from './detector.js';

/**
 * Candidates for the new dart, strongest first.
 *
 * `carried` are the darts already in the board, in board millimetres: each
 * claims the detection nearest to it. `previous` is a photograph of the board
 * with just those darts in it; beside them, a candidate only counts where the
 * photograph changed since (changeGate.ts). Without one, or if the comparison
 * cannot run, every unclaimed detection is a candidate.
 *
 * Throws if the model itself fails.
 */
export async function newDarts(
  detector: Detector,
  frame: GrabbedFrame,
  calibration: Pick<Calibration, 'toBoard' | 'toImage'>,
  carried: readonly { board: Point }[],
  previous: GrabbedFrame | null,
): Promise<Detection[]> {
  const detections = await detector.detect(frame, calibration);
  const candidates = proposalsBeside(detections, carried);
  if (!previous || carried.length === 0 || candidates.length === 0) return candidates;
  if (previous.width !== frame.width || previous.height !== frame.height) return candidates;
  try {
    const changes = await changesAt(
      previous.jpeg,
      frame.jpeg,
      frame.width,
      frame.height,
      calibration.toImage,
      candidates.map((candidate) => candidate.board),
    );
    return candidates.filter((_, index) => changes[index]! >= NEW_DART_CHANGE);
  } catch (cause) {
    // The comparison is a filter on top: without it, read as before.
    console.warn('[treblewise] could not compare with the previous photo:', cause);
    return candidates;
  }
}
