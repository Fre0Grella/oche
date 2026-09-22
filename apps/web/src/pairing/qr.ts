/**
 * QR codes, in both directions.
 *
 * Drawing uses the lowest error-correction level on purpose: a pairing code is
 * shown on a clean screen a few centimetres from a camera, so the redundancy
 * that protects a printed label against coffee stains would only make the
 * modules smaller and harder to resolve.
 */

import QRCode from 'qrcode';

export interface QrMatrix {
  size: number;
  /** Row-major, true where the module is dark. */
  dark: boolean[];
}

export function qrMatrix(text: string): QrMatrix {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'L' });
  const { size, data } = qr.modules;
  return { size, dark: Array.from(data, (value) => value === 1) };
}

/**
 * The matrix as an SVG path, with horizontal runs merged into single
 * rectangles: a hundred-module code is a few hundred path commands instead of
 * ten thousand elements.
 */
export function qrPath(matrix: QrMatrix): string {
  const parts: string[] = [];

  for (let y = 0; y < matrix.size; y += 1) {
    let runStart = -1;
    for (let x = 0; x <= matrix.size; x += 1) {
      const dark = x < matrix.size && matrix.dark[y * matrix.size + x] === true;
      if (dark && runStart < 0) runStart = x;
      if (!dark && runStart >= 0) {
        parts.push(`M${runStart} ${y}h${x - runStart}v1h-${x - runStart}z`);
        runStart = -1;
      }
    }
  }

  return parts.join('');
}

type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
};

let detector: BarcodeDetectorLike | null | undefined;
let jsQrLoader: Promise<typeof import('jsqr')> | null = null;

function getDetector(): BarcodeDetectorLike | null {
  if (detector !== undefined) return detector;

  const Ctor = (globalThis as { BarcodeDetector?: new (options: { formats: string[] }) => BarcodeDetectorLike })
    .BarcodeDetector;
  detector = Ctor ? new Ctor({ formats: ['qr_code'] }) : null;
  return detector;
}

let scratch: HTMLCanvasElement | null = null;

/**
 * Looks for a QR code in the current video frame. Uses the browser's own
 * detector where there is one (Chrome, Android) and falls back to a decoder
 * loaded on demand, so Safari can pair too without everyone paying for the
 * download.
 */
export async function scanFrame(video: HTMLVideoElement): Promise<string | null> {
  if (video.readyState < 2 || video.videoWidth === 0) return null;

  const native = getDetector();
  if (native) {
    try {
      const codes = await native.detect(video);
      return codes[0]?.rawValue ?? null;
    } catch {
      detector = null; // a detector that throws is worse than none
    }
  }

  if (!scratch) scratch = document.createElement('canvas');
  // Half resolution is plenty for a code filling much of the frame, and keeps
  // the fallback decoder fast enough to run several times a second.
  const width = Math.round(video.videoWidth / 2);
  const height = Math.round(video.videoHeight / 2);
  scratch.width = width;
  scratch.height = height;

  const context = scratch.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(video, 0, 0, width, height);
  const image = context.getImageData(0, 0, width, height);

  jsQrLoader ??= import('jsqr');
  const { default: jsQR } = await jsQrLoader;
  const found = jsQR(image.data, width, height, { inversionAttempts: 'dontInvert' });
  return found?.data ?? null;
}
