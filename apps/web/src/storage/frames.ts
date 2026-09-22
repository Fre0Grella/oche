/**
 * Captured frames and their labels: the training set.
 *
 * A frame is a photograph of the board plus, for each dart in it, where the tip
 * is — in image pixels (what a model is trained on) and in board millimetres
 * (what it means). Frames come from two places, the capture lab and a report
 * during a game, and they are the same record either way.
 *
 * Everything stays on the device until it is exported. `docs/08` says so to the
 * user, not just here.
 */

import {
  applyHomography,
  invertHomography,
  scoreAt,
  solveHomography,
  type Hit,
  type Matrix3,
  type Point,
} from '@oche/core';

import { zip } from '../lib/zip.js';
import { framesDb } from './db.js';
import type { Calibration, CapturedFrame, LabelledDart } from './types.js';

export type { Calibration, CapturedFrame, LabelledDart } from './types.js';

/** Builds a calibration from the four tapped points. */
export function calibrate(
  imagePoints: readonly Point[],
  boardPoints: readonly Point[],
  size: { width: number; height: number },
): Omit<Calibration, 'ts' | 'deviceId'> | null {
  const toImage = solveHomography(boardPoints, imagePoints);
  if (!toImage) return null;
  const toBoard = invertHomography(toImage);
  if (!toBoard) return null;

  const error = Math.sqrt(
    boardPoints.reduce((sum, board, index) => {
      const projected = applyHomography(toImage, board);
      const tapped = imagePoints[index]!;
      return sum + (projected.x - tapped.x) ** 2 + (projected.y - tapped.y) ** 2;
    }, 0) / boardPoints.length,
  );

  return { imagePoints: [...imagePoints], toImage, toBoard, error, width: size.width, height: size.height };
}

/** What a tap on the photograph scored. */
export function readDart(calibration: Pick<Calibration, 'toBoard'>, img: Point): LabelledDart {
  const board = applyHomography(calibration.toBoard, img);
  return { img, board, hit: scoreAt(board) };
}

/** Where a known board position appears in the photograph. */
export function projectToImage(calibration: Pick<Calibration, 'toImage'>, board: Point): Point {
  return applyHomography(calibration.toImage, board);
}

export async function putFrame(frame: CapturedFrame): Promise<void> {
  const db = await framesDb();
  if (!db) return;
  await db.put('frames', frame);
}

export async function listFrames(limit = 500): Promise<CapturedFrame[]> {
  const db = await framesDb();
  if (!db) return [];
  const all = await db.getAllFromIndex('frames', 'by-ts');
  return all.reverse().slice(0, limit);
}

export async function deleteFrame(id: string): Promise<void> {
  const db = await framesDb();
  if (!db) return;
  await db.delete('frames', id);
}

export async function countFrames(): Promise<{ total: number; labelled: number; bytes: number }> {
  const frames = await listFrames(Number.MAX_SAFE_INTEGER);
  return {
    total: frames.length,
    labelled: frames.filter((frame) => frame.labelled).length,
    bytes: frames.reduce((sum, frame) => sum + frame.jpeg.size, 0),
  };
}

const EXPORT_README = `# oche capture export

Photographs of a dartboard with the tip of each dart labelled, produced by the
capture lab in https://github.com/Fre0Grella/oche

- frames/<id>.jpg   the photograph, straight from the camera, unmodified
- labels.json       one entry per frame

Each label entry holds:

  id, ts, source      where it came from: the capture lab, or a report during a game
  width, height       the image size the coordinates refer to
  calibration         the four board landmarks as tapped, in image pixels, and the
                      homography between board millimetres and image pixels
  darts[]             per dart: img {x,y} in pixels, board {x,y} in millimetres
                      from the centre of the bull (+x right, +y up), and the hit
                      it scores
  reported            what the app believed when the frame was reported as wrong

Board millimetres follow the standard steel-tip board: the outer edge of the
double ring is at 170 mm, the treble ring at 107 mm, the outer bull at 15.9 mm.
`;

interface ExportedFrame {
  id: string;
  ts: number;
  source: string;
  matchId?: string;
  file: string;
  width: number;
  height: number;
  calibration: {
    imagePoints: Point[];
    toImage: Matrix3;
    toBoard: Matrix3;
    error: number;
  };
  darts: { img: Point; board: Point; hit: Hit }[];
  reported?: { hits: string[]; source: string };
  note?: string;
}

/** A zip of the labelled frames, in the format the training scripts read. */
export async function exportFrames(frames: readonly CapturedFrame[]): Promise<Blob> {
  const entries: { name: string; data: Uint8Array }[] = [];
  const manifest: ExportedFrame[] = [];

  for (const frame of frames) {
    const file = `frames/${frame.id}.jpg`;
    entries.push({ name: file, data: new Uint8Array(await frame.jpeg.arrayBuffer()) });
    manifest.push({
      id: frame.id,
      ts: frame.ts,
      source: frame.source,
      ...(frame.matchId ? { matchId: frame.matchId } : {}),
      file,
      width: frame.width,
      height: frame.height,
      calibration: {
        imagePoints: frame.calibration.imagePoints,
        toImage: frame.calibration.toImage,
        toBoard: frame.calibration.toBoard,
        error: frame.calibration.error,
      },
      darts: frame.darts,
      ...(frame.reported ? { reported: frame.reported } : {}),
      ...(frame.note ? { note: frame.note } : {}),
    });
  }

  const encoder = new TextEncoder();
  entries.push({
    name: 'labels.json',
    data: encoder.encode(JSON.stringify({ version: 1, exportedAt: Date.now(), frames: manifest }, null, 2)),
  });
  entries.push({ name: 'README.md', data: encoder.encode(EXPORT_README) });

  return zip(entries);
}
