import { act, render } from '@testing-library/react';
import { CALIBRATION_BOARD_POINTS, type Hit, type Point } from '@treblewise/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMatchStore } from '../store/match.js';
import type { GrabbedFrame } from '../vision/camera.js';
import { GameCamera, type ReportableDart } from './GameCamera.js';

const WIDTH = 640;
const HEIGHT = 480;

const hooks = vi.hoisted(() => ({
  settle: undefined as ((frame: GrabbedFrame, thumbnail?: Uint8Array, before?: Uint8Array | null) => void) | undefined,
  /** What the model finds on the next photograph, in board millimetres. */
  found: [] as { x: number; y: number }[],
}));

vi.mock('../vision/useCamera.js', () => ({
  useCamera: (options: { onSettle?: typeof hooks.settle }) => {
    hooks.settle = options.onSettle;
    return {
      videoRef: { current: null },
      ready: true,
      error: null,
      width: WIDTH,
      height: HEIGHT,
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

vi.mock('../vision/detector.js', () => ({
  loadManifest: async () => ({ name: 'test-model', file: 'x.onnx', sha256: 'x' }),
  loadDetector: async () => ({
    manifest: { name: 'test-model', file: 'x.onnx', sha256: 'x' },
    detect: async () =>
      hooks.found.map((board) => ({
        img: { x: 320, y: 200 },
        board,
        hit: { sector: 20, ring: 'treble', value: 60 },
        confidence: 0.8,
      })),
  }),
}));

// Every candidate changed: the change gate is tested on its own.
vi.mock('../vision/changeGate.js', () => ({
  NEW_DART_CHANGE: 5,
  changesAt: async (...args: unknown[]) => (args[5] as unknown[]).map(() => 50),
}));

/** The board-region thumbnail of the empty board, as stored at calibration. */
const EMPTY = new Uint8Array(64 * 64).fill(120);
/** The same board with darts in it. */
const DARTS = EMPTY.map((value, index) => (index % 64 > 30 && index % 64 < 36 && index < 40 * 64 ? 40 : value));

const photo = (): GrabbedFrame => ({ jpeg: new Blob(['x'], { type: 'image/jpeg' }), width: WIDTH, height: HEIGHT });

async function settle(thumbnail: Uint8Array = DARTS) {
  await act(async () => {
    hooks.settle!(photo(), thumbnail, null);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const T20: Hit = { sector: 20, ring: 'treble', value: 60 };

describe('the autoscorer in a game', () => {
  const onAutoDart = vi.fn<(hit: Hit, pos: Point, confidence: number) => void>();

  function camera(props: { darts?: ReportableDart[]; visitComplete?: boolean; visitInProgress?: boolean }) {
    return (
      <GameCamera
        matchId="m"
        darts={props.darts ?? []}
        visitComplete={props.visitComplete ?? false}
        visitInProgress={props.visitInProgress ?? false}
        canThrow
        onCorrect={() => undefined}
        onAutoDart={onAutoDart}
      />
    );
  }

  beforeEach(async () => {
    onAutoDart.mockReset();
    hooks.found = [];
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
      settings: {
        ...state.settings,
        keepFrames: true,
        autoscoreGames: true,
        calibration: { ...calibration, ts: 1, reference: Array.from(EMPTY) },
      },
    }));
  });

  /** Renders, and waits for the model to load. */
  async function start(props: Parameters<typeof camera>[0] = {}) {
    const view = render(camera(props));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return view;
  }

  it('enters the dart it reads, with where it landed', async () => {
    await start();
    hooks.found = [{ x: 0, y: 103 }];
    await settle();
    expect(onAutoDart).toHaveBeenCalledTimes(1);
    expect(onAutoDart.mock.calls[0]![1]).toEqual({ x: 0, y: 103 });
  });

  it('reads the second dart beside the first, not the first again', async () => {
    const view = await start({ darts: [{ id: 'a', hit: T20, pos: { x: 0, y: 103 } }], visitInProgress: true });
    view.rerender(camera({ darts: [{ id: 'a', hit: T20, pos: { x: 0, y: 103 } }], visitInProgress: true }));
    hooks.found = [
      { x: 0.4, y: 103.1 },
      { x: 5, y: 103 },
    ];
    await settle();
    expect(onAutoDart).toHaveBeenCalledTimes(1);
    expect(onAutoDart.mock.calls[0]![1]).toEqual({ x: 5, y: 103 });
  });

  it('reads nothing while the last visit is being pulled out, and again once the board is empty', async () => {
    const thrown = [
      { id: 'a', hit: T20, pos: { x: 0, y: 103 } },
      { id: 'b', hit: T20, pos: { x: 5, y: 103 } },
      { id: 'c', hit: T20, pos: { x: -5, y: 103 } },
    ];
    await start({ darts: thrown, visitComplete: true });
    hooks.found = [{ x: 0, y: 103 }];
    await settle(); // a hand pulling the darts: all three still seen
    expect(onAutoDart).not.toHaveBeenCalled();

    await settle(EMPTY); // out
    expect(onAutoDart).not.toHaveBeenCalled();

    hooks.found = [{ x: 30, y: -50 }];
    await settle();
    expect(onAutoDart).toHaveBeenCalledTimes(1);
  });

  it('leaves the visit to the player once a dart was entered by number', async () => {
    await start({ darts: [{ id: 'a', hit: T20 }], visitInProgress: true });
    hooks.found = [
      { x: 0, y: 103 },
      { x: 30, y: -50 },
    ];
    await settle();
    expect(onAutoDart).not.toHaveBeenCalled();
  });
});
