import { describe, expect, it } from 'vitest';

import { crc32, zipBytes } from './zip.js';

const bytes = (text: string) => new TextEncoder().encode(text);

const read = (archive: Uint8Array) => new DataView(archive.buffer, archive.byteOffset, archive.byteLength);

describe('crc32', () => {
  it('matches the known checksums', () => {
    expect(crc32(bytes('hello')).toString(16)).toBe('3610a686');
    expect(crc32(bytes('')).toString(16)).toBe('0');
    expect(crc32(bytes('The quick brown fox jumps over the lazy dog')).toString(16)).toBe('414fa339');
  });
});

describe('zip', () => {
  it('writes a readable archive with correct offsets', () => {
    const entries = [
      { name: 'labels.json', data: bytes('{"frames":[]}') },
      { name: 'frames/0001.jpg', data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) },
    ];
    const view = read(zipBytes(entries, new Date('2026-09-22T20:00:00Z')));

    expect(view.getUint32(0, true)).toBe(0x04034b50); // first local header

    // The end-of-central-directory record is the last 22 bytes.
    const eocd = view.byteLength - 22;
    expect(view.getUint32(eocd, true)).toBe(0x06054b50);
    expect(view.getUint16(eocd + 8, true)).toBe(2); // entries on this disk
    expect(view.getUint16(eocd + 10, true)).toBe(2);

    const centralSize = view.getUint32(eocd + 12, true);
    const centralOffset = view.getUint32(eocd + 16, true);
    expect(centralOffset + centralSize).toBe(eocd);
    expect(view.getUint32(centralOffset, true)).toBe(0x02014b50);

    // Each central header points at a real local header, and the sizes agree.
    let cursor = centralOffset;
    for (const entry of entries) {
      expect(view.getUint32(cursor, true)).toBe(0x02014b50);
      expect(view.getUint32(cursor + 16, true)).toBe(crc32(entry.data));
      expect(view.getUint32(cursor + 24, true)).toBe(entry.data.length);
      const nameLength = view.getUint16(cursor + 28, true);
      const localOffset = view.getUint32(cursor + 42, true);
      expect(view.getUint32(localOffset, true)).toBe(0x04034b50);
      expect(view.getUint16(localOffset + 6, true) & 0x0800).toBe(0x0800); // UTF-8 flag
      cursor += 46 + nameLength;
    }
  });

  it('writes an empty archive', () => {
    const view = read(zipBytes([]));
    expect(view.byteLength).toBe(22);
    expect(view.getUint32(0, true)).toBe(0x06054b50);
  });
});
