/**
 * Looking back over the labelled photographs.
 *
 * The capture lab and the game produce labels in a hurry; this is the second
 * look. What matters most is being able to find the photographs a model marked
 * (its guesses, let stand) and either fix them or throw them out together.
 */

import type { CapturedFrame } from './types.js';

/** True when at least one mark on the photograph was placed by a model. */
export function hasModelMarks(frame: Pick<CapturedFrame, 'darts'>): boolean {
  return frame.darts.some((dart) => dart.by === 'model');
}

/** The models that still have marks standing, with how many photographs each. */
export function modelsWithMarks(frames: readonly CapturedFrame[]): { model: string; frames: number }[] {
  const counts = new Map<string, number>();
  for (const frame of frames) {
    if (!hasModelMarks(frame)) continue;
    const model = frame.model ?? 'unknown';
    counts.set(model, (counts.get(model) ?? 0) + 1);
  }
  return [...counts].map(([model, count]) => ({ model, frames: count })).sort((a, b) => b.frames - a.frames);
}

/** The photographs whose standing model marks came from this model. */
export function markedBy(frames: readonly CapturedFrame[], model: string): CapturedFrame[] {
  return frames.filter((frame) => hasModelMarks(frame) && (frame.model ?? 'unknown') === model);
}

export type ReviewFilter = 'all' | 'model' | 'unreviewed';

export function filterFrames(frames: readonly CapturedFrame[], filter: ReviewFilter): CapturedFrame[] {
  if (filter === 'model') return frames.filter(hasModelMarks);
  if (filter === 'unreviewed') return frames.filter((frame) => !frame.reviewed);
  return [...frames];
}
