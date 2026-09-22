/**
 * The shapes that live in IndexedDB. Kept in their own module so the database
 * and the code that fills it can both refer to them without importing each
 * other.
 */

import type { Hit, Matrix3, Point, X01Config, MatchEvent } from '@oche/core';

export interface StoredMatch {
  id: string;
  createdAt: number;
  updatedAt: number;
  config: X01Config;
  /** The append-only log. The match state is derived from it, never stored. */
  events: MatchEvent[];
  finished: boolean;
}

export interface Calibration {
  /** The four landmarks as tapped, in image pixels. */
  imagePoints: Point[];
  /** Board millimetres → image pixels. */
  toImage: Matrix3;
  /** Image pixels → board millimetres. */
  toBoard: Matrix3;
  /** RMS reprojection error in pixels: how well the four taps agree. */
  error: number;
  /** The resolution it was made at; it is only valid for that resolution. */
  width: number;
  height: number;
  ts: number;
  deviceId?: string;
}

export interface LabelledDart {
  /** Tip position in image pixels. */
  img: Point;
  /** The same point in board millimetres. */
  board: Point;
  hit: Hit;
}

export interface CapturedFrame {
  id: string;
  ts: number;
  source: 'lab' | 'game';
  matchId?: string;
  width: number;
  height: number;
  jpeg: Blob;
  calibration: Omit<Calibration, 'ts' | 'deviceId'>;
  darts: LabelledDart[];
  /** False until someone has confirmed where every dart in it landed. */
  labelled: boolean;
  /** What the app believed at the time — the reading being reported as wrong. */
  reported?: { hits: string[]; source: string };
  note?: string;
}

export interface Settings {
  callerEnabled: boolean;
  entryMode: 'board' | 'keypad';
  locale: string;
  /** Keep camera frames during a game, so a wrong score can be reported. */
  keepFrames: boolean;
  /** The last calibration, so a session survives a reload. */
  calibration: Calibration | null;
}

export const DEFAULT_SETTINGS: Settings = {
  callerEnabled: true,
  entryMode: 'board',
  locale: 'en',
  keepFrames: false,
  calibration: null,
};
