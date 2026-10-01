/**
 * Which darts are in the board right now, across the photographs of one visit.
 *
 * A label is only a label if it is complete: every dart visible in the
 * photograph has to be marked, or the model is taught that a dart it can see is
 * background. So the second photograph of a visit opens with the first dart
 * already marked where it was, and only the new one is left to tap. The darts
 * stay put between throws, so the old marks are right unless a dart was knocked,
 * and a knocked one can be dragged.
 *
 * A visit is three darts. After the third is saved the board is assumed empty
 * again, because that is when the darts come out; pulling them earlier is what
 * "board cleared" is for.
 */

import type { LabelledDart } from './types.js';

export const DARTS_PER_VISIT = 3;

/** The marks a new photograph opens with: the darts already in the board. */
export function carriedInto(inBoard: readonly LabelledDart[]): LabelledDart[] {
  return inBoard.map((dart) => ({ ...dart, img: { ...dart.img }, board: { ...dart.board } }));
}

/** What is in the board once a photograph with these darts has been saved. */
export function inBoardAfter(saved: readonly LabelledDart[]): LabelledDart[] {
  return saved.length >= DARTS_PER_VISIT ? [] : [...saved];
}

/** The darts marked on this photograph that were not carried from the last one. */
export function newDarts(darts: readonly LabelledDart[], carried: number): LabelledDart[] {
  return darts.slice(Math.min(carried, darts.length));
}

/**
 * A dart the model found this close to a carried mark is that dart, already
 * marked by a person; only the rest are proposals for the new one.
 */
export const SAME_DART_MM = 10;

/**
 * The model's detections that are new darts. The carried marks stay as they
 * are: they were placed or confirmed by a person, and the model's reading of an
 * old dart must never move one.
 */
export function proposalsBeside<T extends { board: { x: number; y: number } }>(
  detections: readonly T[],
  carried: readonly LabelledDart[],
): T[] {
  return detections.filter((detection) =>
    carried.every(
      (dart) => Math.hypot(dart.board.x - detection.board.x, dart.board.y - detection.board.y) > SAME_DART_MM,
    ),
  );
}

/** A photograph is worth saving once someone marked it, or let a proposal stand. */
export function worthSaving(frame: { edited: boolean; proposed: number; darts: readonly unknown[] }): boolean {
  return frame.darts.length > 0 && (frame.edited || frame.proposed > 0);
}

/**
 * What a newly settled photograph does to the one on screen. A settle is any
 * moment the board goes still — an arm, a hand reaching for a dart — so it is
 * never a reason to save: a photograph someone has started on stays put and
 * the new one waits; an untouched one is simply replaced.
 */
export function onNewPhoto(open: { edited: boolean; proposed: number; darts: readonly unknown[] } | null): 'replace' | 'wait' {
  return open !== null && worthSaving(open) ? 'wait' : 'replace';
}
