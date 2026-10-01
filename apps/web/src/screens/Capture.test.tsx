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
  settle: undefined as ((frame: GrabbedFrame) => void) | undefined,
  stored: [] as CapturedFrame[],
}));

vi.mock('../vision/useCamera.js', () => ({
  useCamera: (options: { onSettle?: (frame: GrabbedFrame) => void }) => {
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

vi.mock('../vision/camera.js', () => ({ cameraSupported: () => true }));

// A model that always proposes one dart, in the treble 20.
vi.mock('../vision/detector.js', () => ({
  loadDetector: async () => ({
    manifest: { name: 'test-model', file: 'x.onnx', sha256: 'x' },
    detect: async () => [
      { img: { x: 320, y: 200 }, board: { x: 0, y: 103 }, hit: { sector: 20, ring: 'treble', value: 60 }, confidence: 0.9 },
    ],
  }),
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

async function settle() {
  await act(async () => {
    hooks.settle!(photo());
    await new Promise((resolve) => setTimeout(resolve, 0)); // let the proposal land
  });
}

describe('the capture lab saves only what a person confirmed', () => {
  beforeEach(async () => {
    hooks.stored = [];
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
      settings: { ...state.settings, calibration: { ...calibration, ts: 1 } },
    }));

    render(<Capture />);
    await press(/start camera/i);
    await press(/try it/i);
    await press(/autoscorer proposes.*off/i);
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

  it('asks before leaving with marks that are not saved', async () => {
    await settle();
    await press(/^done$/i);
    expect(screen.getByRole('alertdialog')).toBeDefined();
    await press(/throw it away/i);
    expect(hooks.stored).toEqual([]);
  });
});
