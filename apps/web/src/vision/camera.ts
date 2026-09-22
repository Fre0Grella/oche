/**
 * Camera access and frame grabbing.
 *
 * Deliberately thin: everything with a decision in it (when to photograph, what
 * the pixels mean) lives in modules that can be tested without a camera. This
 * file is the part that only a browser can do.
 */

const CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 30 },
  },
};

export function cameraSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

/**
 * Browsers only reveal camera labels once permission has been granted, so this
 * is worth calling again after the stream starts.
 */
export async function listCameras(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === 'videoinput');
}

export async function startCamera(deviceId?: string): Promise<MediaStream> {
  if (!cameraSupported()) {
    throw new Error('This browser will not give a page camera access.');
  }
  const constraints: MediaStreamConstraints = deviceId
    ? { audio: false, video: { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } } }
    : CONSTRAINTS;

  return navigator.mediaDevices.getUserMedia(constraints);
}

export function stopCamera(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

/** Keeps the screen awake while the camera is watching the board. */
export async function keepAwake(): Promise<WakeLockSentinel | null> {
  try {
    return await navigator.wakeLock?.request('screen') ?? null;
  } catch {
    return null; // not supported, or denied because the tab is hidden
  }
}

let thumbCanvas: HTMLCanvasElement | null = null;

/**
 * A small greyscale thumbnail of the current frame, for the motion gate. 48×27
 * is about 1300 samples: enough to see an arm cross the frame, cheap enough to
 * run on every frame of video without warming the phone.
 */
export function thumbnail(video: HTMLVideoElement, width = 48, height = 27): Uint8Array | null {
  if (video.readyState < 2 || video.videoWidth === 0) return null;

  if (!thumbCanvas) thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = width;
  thumbCanvas.height = height;

  const context = thumbCanvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;

  context.drawImage(video, 0, 0, width, height);
  const { data } = context.getImageData(0, 0, width, height);

  const grey = new Uint8Array(width * height);
  for (let i = 0; i < grey.length; i += 1) {
    const p = i * 4;
    // Rec. 601 luma, the usual cheap approximation.
    grey[i] = (data[p]! * 77 + data[p + 1]! * 150 + data[p + 2]! * 29) >> 8;
  }
  return grey;
}

export interface GrabbedFrame {
  jpeg: Blob;
  width: number;
  height: number;
}

/** The current video frame, full resolution, as a JPEG. */
export async function grabJpeg(video: HTMLVideoElement, quality = 0.86): Promise<GrabbedFrame | null> {
  if (video.readyState < 2 || video.videoWidth === 0) return null;

  const width = video.videoWidth;
  const height = video.videoHeight;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(video, 0, 0, width, height);

  const jpeg = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', quality);
  });

  return jpeg ? { jpeg, width, height } : null;
}
