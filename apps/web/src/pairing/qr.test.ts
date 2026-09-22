import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';

import { encodePayload } from './payload.js';
import { qrMatrix, qrPath } from './qr.js';

/**
 * Paints a matrix into RGBA pixels the way the SVG paints it on screen, so the
 * decoder sees what a camera would: dark modules on white, with a quiet zone.
 */
function rasterise(matrix: ReturnType<typeof qrMatrix>, scale = 4, quiet = 4) {
  const extent = (matrix.size + quiet * 2) * scale;
  const pixels = new Uint8ClampedArray(extent * extent * 4).fill(255);

  for (let y = 0; y < matrix.size; y += 1) {
    for (let x = 0; x < matrix.size; x += 1) {
      if (!matrix.dark[y * matrix.size + x]) continue;
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const px = (x + quiet) * scale + dx;
          const py = (y + quiet) * scale + dy;
          const at = (py * extent + px) * 4;
          pixels[at] = 0;
          pixels[at + 1] = 0;
          pixels[at + 2] = 0;
        }
      }
    }
  }

  return { pixels, extent };
}

const SDP = [
  'v=0',
  'o=- 1 1 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0 1',
  'm=video 51263 UDP/TLS/RTP/SAVPF 108 109 96 97',
  'c=IN IP4 192.168.1.13',
  'a=candidate:1 1 udp 2122063615 192.168.1.13 51265 typ host',
  'a=ice-ufrag:Xeim',
  'a=ice-pwd:yzm1mJ0lQ227Y39TIWHmFTCh',
  'a=fingerprint:sha-256 B3:32:AF:D6:A4:7E:10:2E:F8:28:01:00:87:4C:CE:70:D7:73:17:BD:5D:CF:ED:7E:15:04:3F:92:E4:3C:70:71',
  'a=setup:actpass',
  'a=mid:0',
  'a=recvonly',
  'a=rtcp-mux',
  'a=rtpmap:108 H264/90000',
  'a=fmtp:108 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f',
  'a=rtpmap:96 VP8/90000',
  '',
].join('\r\n');

describe('the pairing picture', () => {
  it('survives being drawn and read back', async () => {
    const code = await encodePayload({ v: 1, role: 'hub', sdp: SDP });
    const matrix = qrMatrix(code);
    const { pixels, extent } = rasterise(matrix);

    const decoded = jsQR(pixels, extent, extent, { inversionAttempts: 'dontInvert' });

    expect(decoded).not.toBeNull();
    expect(decoded!.data).toBe(code);
  });

  it('stays inside the size a camera can resolve', async () => {
    const code = await encodePayload({ v: 1, role: 'hub', sdp: SDP });
    const matrix = qrMatrix(code);

    // Version 25 is 117 modules. Rendered 420 px wide that is 3.6 px a module,
    // which a phone camera reads comfortably and a laptop webcam reads held
    // close. Beyond that, pairing starts failing in rooms with poor light.
    expect(matrix.size).toBeLessThanOrEqual(117);
  });

  it('draws every dark module exactly once, as merged runs', () => {
    const matrix = qrMatrix('oche1.h.z.AAAA');
    const path = qrPath(matrix);

    const darkCount = matrix.dark.filter(Boolean).length;
    const covered = [...path.matchAll(/M(\d+) (\d+)h(\d+)/g)].reduce(
      (total, match) => total + Number(match[3]),
      0,
    );

    expect(covered).toBe(darkCount);
  });
});
