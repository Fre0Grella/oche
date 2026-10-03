import { CALIBRATION_BOARD_POINTS } from '@oche/core';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CapturedFrame } from '../storage/frames.js';
import { useMatchStore } from '../store/match.js';
import type { GrabbedFrame } from '../vision/camera.js';
import { Capture } from './Capture.js';

const WIDTH = 640;
const HEIGHT = 480;

/** What the mocks expose to the test: the settle callback, and what was stored. */
const hooks = vi.hoisted(() => ({
  settle: undefined as ((frame: GrabbedFrame, thumbnail?: Uint8Array) => void) | undefined,
  stored: [] as CapturedFrame[],
  detectorLoads: 0,
  /** What the model finds on the next photograph, in board millimetres. */
  found: [{ x: 0, y: 103 }] as { x: number; y: number }[],
}));

vi.mock('../vision/useCamera.js', () => ({
  useCamera: (options: { onSettle?: (frame: GrabbedFrame, thumbnail?: Uint8Array) => void }) => {
    hooks.settle = options.onSettle;
    return {
      videoRef: { current: null },
      ready: true,
      error: null,
      width: 640,
      height: 480,
      moving: false,
      settles: 0,
      motion: 0,
      change: 0,
      quality: null,
      capture: async () => null,
      sampleThumbnail: () => null,
    };
  },
}));

vi.mock('../vision/camera.js', () => ({ cameraSupported: () => true, THUMB_SIZE: 64 }));

// A model that finds whatever `hooks.found` says: one dart in the treble 20 unless a test changes it.
vi.mock('../vision/detector.js', () => ({
  loadManifest: async () => ({ name: 'test-model', file: 'x.onnx', sha256: 'x' }),
  loadDetector: async () => {
    hooks.detectorLoads += 1;
    return {
    manifest: { name: 'test-model', file: 'x.onnx', sha256: 'x' },
    detect: async () =>
      hooks.found.map((board) => ({
        img: { x: 320, y: 200 },
        board,
        hit: { sector: 20, ring: 'treble', value: 60 },
        confidence: 0.9,
      })),
    };
  },
}));

vi.mock('../caller/caller.js', () => ({ caller: () => ({ say: () => undefined }), unlockCaller: () => undefined }));

vi.mock('../storage/frames.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../storage/frames.js')>()),
  putFrame: async (frame: CapturedFrame) => {
    hooks.stored.push(frame);
  },
  countFrames: async () => ({ total: 0, labelled: 0, bytes: 0 }),
}));

function photo(): GrabbedFrame {
  return { jpeg: new Blob(['x'], { type: 'image/jpeg' }), width: WIDTH, height: HEIGHT };
}

async function press(name: RegExp) {
  const button = await screen.findByRole('button', { name });
  await act(async () => {
    button.click();
  });
}

/** The board-region thumbnail of the empty board, as stored at calibration. */
const EMPTY = new Uint8Array(64 * 64).fill(120);
/** The same board with darts in it. */
const DARTS = EMPTY.map((value, index) => (index % 64 > 30 && index % 64 < 36 && index < 40 * 64 ? 40 : value));

async function settle(thumbnail: Uint8Array = DARTS) {
  await act(async () => {
    hooks.settle!(photo(), thumbnail);
    await new Promise((resolve) => setTimeout(resolve, 0)); // let the proposal land
  });
}

describe('the capture lab saves only what a person confirmed', () => {
  beforeEach(async () => {
    hooks.stored = [];
    hooks.found = [{ x: 0, y: 103 }];
    URL.createObjectURL = () => 'blob:test';
    URL.revokeObjectURL = () => undefined;
    // Never a blind visit: the model proposes on every photograph here.
    vi.spyOn(Math, 'random').mockReturnValue(0.99);

    const { calibrate } = await import('../storage/frames.js');
    const imagePoints = [
      { x: 320, y: 60 },
      { x: 500, y: 240 },
      { x: 320, y: 420 },
      { x: 140, y: 240 },
    ];
    const calibration = calibrate(imagePoints, CALIBRATION_BOARD_POINTS, { width: WIDTH, height: HEIGHT })!;
    useMatchStore.setState((state) => ({
      mode: 'solo',
      remoteStream: null,
      settings: { ...state.settings, calibration: { ...calibration, ts: 1, reference: Array.from(EMPTY) } },
    }));

    hooks.detectorLoads = 0;
    render(<Capture />);
    await press(/start camera/i);
    await press(/try it/i);
    // Nothing heavy is loaded until proposals are asked for.
    expect(hooks.detectorLoads).toBe(0);
    await press(/autoscorer proposes.*off/i);
    await screen.findByRole('button', { name: /autoscorer proposes.*: on/i });
    expect(hooks.detectorLoads).toBe(1);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never saves on a settle, even with a proposal on screen', async () => {
    await settle();
    expect(screen.getByRole('button', { name: /right — save it/i })).toBeDefined();

    // The board settles again (an arm, a hand reaching for a dart): nothing is
    // saved, and the new photograph waits.
    await settle();
    await settle();
    expect(hooks.stored).toEqual([]);
    expect(screen.getByText(/a newer photo is waiting/i)).toBeDefined();
  });

  it('throws an unconfirmed proposal away when the photo is skipped', async () => {
    await settle();
    await press(/skip this photo/i);
    expect(hooks.stored).toEqual([]);
  });

  it('saves a proposal once a person says it is right, and marks it as the model’s', async () => {
    await settle();
    await press(/right — save it/i);

    expect(hooks.stored).toHaveLength(1);
    const [frame] = hooks.stored;
    expect(frame!.darts).toHaveLength(1);
    expect(frame!.darts[0]!.by).toBe('model');
    expect(frame!.model).toBe('test-model');
    expect(screen.getByText(/saved: 1 darts/i)).toBeDefined();
  });

  it('proposes the second dart of a tight treble 20, right beside the first', async () => {
    await settle();
    await press(/right — save it/i);
    hooks.found = [
      { x: 0.3, y: 103.2 },
      { x: 4, y: 103 },
    ];
    await settle();
    await press(/right — save it/i);
    expect(hooks.stored[1]!.darts.map((dart) => dart.board)).toEqual([
      { x: 0, y: 103 },
      { x: 4, y: 103 },
    ]);
  });

  it('proposes nothing after a full visit until the darts are out', async () => {
    const visit = [
      { x: 0, y: 103 },
      { x: 4, y: 103 },
      { x: -4, y: 103 },
    ];
    for (let n = 1; n <= 3; n += 1) {
      hooks.found = visit.slice(0, n);
      await settle();
      await press(/right — save it/i);
    }
    expect(hooks.stored).toHaveLength(3);

    // A hand reaching for the darts: all three still in, none carried.
    await settle();
    expect(screen.queryByRole('button', { name: /right — save it/i })).toBeNull();
    expect(screen.getByText(/waits until they are out/i)).toBeDefined();

    // The darts are out; the next one thrown is proposed again.
    hooks.found = [];
    await settle(EMPTY);
    hooks.found = [{ x: 20, y: -40 }];
    await settle();
    expect(screen.getByRole('button', { name: /right — save it/i })).toBeDefined();
  });

  it('lets a person say the darts are out when the board does not look empty', async () => {
    for (const n of [1, 2, 3]) {
      hooks.found = [1, 2, 3].slice(0, n).map((k) => ({ x: k * 5, y: 103 }));
      await settle();
      await press(/right — save it/i);
    }
    await settle();
    await press(/i pulled the darts out/i);
    hooks.found = [{ x: 20, y: -40 }];
    await settle();
    expect(screen.getByRole('button', { name: /right — save it/i })).toBeDefined();
  });

  it('keeps a blind visit blind when its photograph is replaced', async () => {
    for (const n of [1, 2, 3]) {
      hooks.found = [1, 2, 3].slice(0, n).map((k) => ({ x: k * 5, y: 103 }));
      await settle();
      // Saving the third dart starts the next visit, which rolls blind...
      if (n === 3) vi.mocked(Math.random).mockReturnValue(0.1);
      await press(/right — save it/i);
    }
    hooks.found = [];
    await settle(EMPTY);
    // ...and stays blind through photographs that replace each other, however
    // the dice would fall now.
    vi.mocked(Math.random).mockReturnValue(0.99);
    hooks.found = [{ x: 20, y: -40 }];
    await settle();
    await settle();
    expect(screen.queryByRole('button', { name: /right — save it/i })).toBeNull();
    expect(screen.getByText(/this visit is yours to mark/i)).toBeDefined();
  });

  it('asks before leaving with marks that are not saved', async () => {
    await settle();
    await press(/^done$/i);
    expect(screen.getByRole('alertdialog')).toBeDefined();
    await press(/throw it away/i);
    expect(hooks.stored).toEqual([]);
  });
});
