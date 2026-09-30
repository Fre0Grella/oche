/**
 * Full-resolution photographs from the paired phone.
 *
 * The video that arrives over WebRTC is for watching, not for training: the
 * encoder picks its own resolution from the bandwidth it thinks it has, the
 * H.264 profile the pairing offers stops at 720p, and every frame is lossy
 * twice. A dart tip is a few pixels wide, so the photograph that gets labelled
 * is taken on the phone, from its own camera at full size, and sent across as a
 * file on a channel of its own — a 2 MB JPEG on the control channel would hold
 * every control message up behind it.
 *
 * The protocol is three messages: the laptop asks (`request`), the phone
 * answers with a header (`photo`) and then the bytes in chunks, or with
 * `failed`. Chunks are small because some browsers still refuse data-channel
 * messages over 16 KB.
 */

export const PHOTO_CHUNK_BYTES = 16 * 1024;

export type PhotoMessage =
  | { type: 'request'; id: number }
  | { type: 'photo'; id: number; width: number; height: number; bytes: number }
  | { type: 'failed'; id: number };

export function chunks(data: Uint8Array, size = PHOTO_CHUNK_BYTES): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let offset = 0; offset < data.length; offset += size) out.push(data.subarray(offset, offset + size));
  return out;
}

export interface AssembledPhoto {
  id: number;
  width: number;
  height: number;
  data: Uint8Array;
}

/** Puts a photograph back together from its header and chunks, in order. */
export class PhotoAssembler {
  private header: Extract<PhotoMessage, { type: 'photo' }> | null = null;
  private buffer: Uint8Array | null = null;
  private received = 0;

  start(header: Extract<PhotoMessage, { type: 'photo' }>): void {
    this.header = header;
    this.buffer = new Uint8Array(header.bytes);
    this.received = 0;
  }

  /** Returns the photograph once the last chunk is in, otherwise null. */
  push(chunk: Uint8Array): AssembledPhoto | null {
    if (!this.header || !this.buffer) return null; // bytes with no header: drop them
    if (this.received + chunk.length > this.buffer.length) {
      this.reset();
      return null;
    }
    this.buffer.set(chunk, this.received);
    this.received += chunk.length;
    if (this.received < this.buffer.length) return null;

    const { id, width, height } = this.header;
    const data = this.buffer;
    this.reset();
    return { id, width, height, data };
  }

  reset(): void {
    this.header = null;
    this.buffer = null;
    this.received = 0;
  }
}
