/**
 * A minimal ZIP writer, store-only (no compression).
 *
 * The export is mostly JPEGs, which are already compressed, so deflate would
 * buy a couple of per cent for a dependency and a worker. Everything here is
 * the format's own bookkeeping.
 *
 * `zipBytes` does the work and returns bytes, which is what makes it testable;
 * `zip` is the one-line wrapper that hands the browser a Blob to download.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/** MS-DOS date and time, which is what the format stores. */
function dosDateTime(date: Date): { time: number; date: number } {
  const time =
    (Math.floor(date.getSeconds() / 2) & 0x1f) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((date.getHours() & 0x1f) << 11);
  const day =
    (date.getDate() & 0x1f) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    ((Math.max(0, date.getFullYear() - 1980) & 0x7f) << 9);
  return { time, date: day };
}

export function zipBytes(entries: readonly ZipEntry[], now = new Date()): Uint8Array {
  const encoder = new TextEncoder();
  const { time, date } = dosDateTime(now);

  const names = entries.map((entry) => encoder.encode(entry.name));
  const localSize = entries.reduce((sum, entry, i) => sum + 30 + names[i]!.length + entry.data.length, 0);
  const centralSize = names.reduce((sum, name) => sum + 46 + name.length, 0);

  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);

  const offsets: number[] = [];
  let at = 0;

  entries.forEach((entry, index) => {
    const name = names[index]!;
    const sum = crc32(entry.data);
    offsets.push(at);

    view.setUint32(at, 0x04034b50, true);
    view.setUint16(at + 4, 20, true); // version needed
    view.setUint16(at + 6, 0x0800, true); // UTF-8 names
    view.setUint16(at + 8, 0, true); // stored, not deflated
    view.setUint16(at + 10, time, true);
    view.setUint16(at + 12, date, true);
    view.setUint32(at + 14, sum, true);
    view.setUint32(at + 18, entry.data.length, true);
    view.setUint32(at + 22, entry.data.length, true);
    view.setUint16(at + 26, name.length, true);
    view.setUint16(at + 28, 0, true);
    out.set(name, at + 30);
    out.set(entry.data, at + 30 + name.length);
    at += 30 + name.length + entry.data.length;
  });

  const centralStart = at;

  entries.forEach((entry, index) => {
    const name = names[index]!;
    view.setUint32(at, 0x02014b50, true);
    view.setUint16(at + 4, 20, true); // version made by
    view.setUint16(at + 6, 20, true); // version needed
    view.setUint16(at + 8, 0x0800, true);
    view.setUint16(at + 10, 0, true);
    view.setUint16(at + 12, time, true);
    view.setUint16(at + 14, date, true);
    view.setUint32(at + 16, crc32(entry.data), true);
    view.setUint32(at + 20, entry.data.length, true);
    view.setUint32(at + 24, entry.data.length, true);
    view.setUint16(at + 28, name.length, true);
    view.setUint32(at + 42, offsets[index]!, true);
    out.set(name, at + 46);
    at += 46 + name.length;
  });

  view.setUint32(at, 0x06054b50, true);
  view.setUint16(at + 8, entries.length, true);
  view.setUint16(at + 10, entries.length, true);
  view.setUint32(at + 12, centralSize, true);
  view.setUint32(at + 16, centralStart, true);

  return out;
}

export function zip(entries: readonly ZipEntry[], now = new Date()): Blob {
  return new Blob([zipBytes(entries, now) as unknown as BlobPart], { type: 'application/zip' });
}
