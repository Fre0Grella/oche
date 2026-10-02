/**
 * The tip model, running in the browser.
 *
 * The model ships with the site: the deploy puts the newest published model
 * release in `models/`, with a manifest naming the file and its SHA-256
 * (.github/workflows/deploy.yml). A site deployed before any model was
 * published has no manifest, and then there is simply no detector.
 *
 * The bytes are checked against the manifest's hash before they are used, so
 * the app runs exactly the file that was evaluated, or nothing.
 *
 * ONNX Runtime runs on WebAssembly, single-threaded: threads need
 * cross-origin isolation, which GitHub Pages cannot switch on. Its .wasm file
 * is part of the build, not fetched from a CDN. Everything is loaded on first
 * use, so nobody pays for it until they ask for a proposal.
 */

import {
  RECT_SIZE,
  applyHomography,
  decodeTips,
  imageToRect,
  multiply3,
  prescale,
  warpToTensor,
  type Hit,
  type Matrix3,
  type Point,
} from '@oche/core';
import type { InferenceSession, Tensor } from 'onnxruntime-web';

import type { Calibration } from '../storage/types.js';
import type { GrabbedFrame } from './camera.js';

export interface ModelManifest {
  name: string;
  file: string;
  sha256: string;
  /** Trained on DeepDarts, which has to be credited wherever it is used. */
  deepdarts?: boolean;
  /** Trained on dartscribe: CC BY-SA, so credited the same way. */
  dartscribe?: boolean;
}

export interface Detection {
  img: Point;
  board: Point;
  hit: Hit;
  confidence: number;
}

export interface Detector {
  manifest: ModelManifest;
  detect: (frame: GrabbedFrame, calibration: Pick<Calibration, 'toBoard' | 'toImage'>) => Promise<Detection[]>;
}

let loading: Promise<Detector | null> | null = null;

/** The shipped model, loaded once; null when the site has none or it cannot run here. */
export function loadDetector(): Promise<Detector | null> {
  loading ??= load().catch((cause: unknown) => {
    console.warn('[oche] no tip model:', cause);
    return null;
  });
  return loading;
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function load(): Promise<Detector | null> {
  const response = await fetch('./models/manifest.json', { cache: 'no-cache' });
  if (!response.ok) return null;
  const manifest = (await response.json()) as ModelManifest;

  const bytes = await (await fetch(`./models/${manifest.file}`)).arrayBuffer();
  const actual = await sha256(bytes);
  if (actual !== manifest.sha256) throw new Error(`${manifest.file}: SHA-256 ${actual}, manifest says ${manifest.sha256}`);

  const [ort, { default: wasmUrl }] = await Promise.all([
    import('onnxruntime-web/wasm'),
    import('onnxruntime-web/ort-wasm-simd-threaded.wasm?url'),
  ]);
  ort.env.wasm.wasmPaths = { wasm: wasmUrl };
  ort.env.wasm.numThreads = 1;
  const session: InferenceSession = await ort.InferenceSession.create(new Uint8Array(bytes), {
    executionProviders: ['wasm'],
  });

  return {
    manifest,
    detect: async (frame, calibration) => {
      const { pixels, warp } = await rectifiable(frame, calibration.toBoard);
      const input = new ort.Tensor('float32', warpToTensor(pixels, warp), [1, 3, RECT_SIZE, RECT_SIZE]);
      const output = await session.run({ image: input });
      const heat = (output.heatmap as Tensor).data as Float32Array;
      const offset = (output.offset as Tensor).data as Float32Array;
      return decodeTips(heat, offset).map((tip) => ({
        img: applyHomography(calibration.toImage, tip.board),
        board: tip.board,
        hit: tip.hit,
        confidence: tip.confidence,
      }));
    },
  };
}

/**
 * The photograph's pixels, shrunk first if the warp would skip pixels (the
 * browser's high-quality resampling standing in for OpenCV's area filter),
 * with the warp adjusted to match.
 */
async function rectifiable(
  frame: GrabbedFrame,
  toBoard: Matrix3,
): Promise<{ pixels: ImageData; warp: Matrix3 }> {
  const warp = imageToRect(toBoard);
  const { factor } = prescale(warp);
  const width = Math.max(1, Math.round(frame.width * factor));
  const height = Math.max(1, Math.round(frame.height * factor));

  const bitmap = await createImageBitmap(frame.jpeg);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  // The exact scale the rounding produced, not the one asked for.
  const shrink: Matrix3 = [frame.width / width, 0, 0, 0, frame.height / height, 0, 0, 0, 1];
  return { pixels: context.getImageData(0, 0, width, height), warp: multiply3(warp, shrink) };
}
