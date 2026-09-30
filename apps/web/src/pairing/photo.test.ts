import { describe, expect, it } from 'vitest';

import { PhotoAssembler, chunks } from './photo.js';

function bytes(n: number): Uint8Array {
  return Uint8Array.from({ length: n }, (_, i) => i % 251);
}

describe('photographs over the data channel', () => {
  it('reassembles a photograph from its chunks', () => {
    const data = bytes(50_000);
    const assembler = new PhotoAssembler();
    assembler.start({ type: 'photo', id: 7, width: 1080, height: 1920, bytes: data.length });

    const parts = chunks(data, 16_384);
    expect(parts).toHaveLength(4);
    const results = parts.map((part) => assembler.push(part));

    expect(results.slice(0, -1)).toEqual([null, null, null]);
    expect(results.at(-1)).toEqual({ id: 7, width: 1080, height: 1920, data });
  });

  it('ignores bytes that arrive without a header', () => {
    expect(new PhotoAssembler().push(bytes(10))).toBeNull();
  });

  it('gives up on a photograph that overruns its header', () => {
    const assembler = new PhotoAssembler();
    assembler.start({ type: 'photo', id: 1, width: 1, height: 1, bytes: 5 });
    expect(assembler.push(bytes(6))).toBeNull();
    expect(assembler.push(bytes(5))).toBeNull(); // reset: no header any more
  });
});
