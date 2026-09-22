import { describe, expect, it } from 'vitest';

import {
  PairingPayloadError,
  compressionAvailable,
  compactSdp,
  decodePayload,
  encodePayload,
  expectRole,
} from './payload.js';

/** A realistic Chrome offer for one video track on a local network. */
const SDP = [
  'v=0',
  'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=extmap-allow-mixed',
  'a=msid-semantic: WMS',
  'm=video 9 UDP/TLS/RTP/SAVPF 102 103',
  'c=IN IP4 0.0.0.0',
  'a=rtcp:9 IN IP4 0.0.0.0',
  'a=candidate:1 1 udp 2113937151 192.168.1.42 54321 typ host generation 0',
  'a=candidate:2 1 udp 1677729535 203.0.113.9 41234 typ srflx raddr 192.168.1.42 rport 54321',
  'a=ice-ufrag:9Xy1',
  'a=ice-pwd:TW8mZ7xQqLk0vRtYuIoP2aSd',
  'a=ice-options:trickle',
  'a=fingerprint:sha-256 4A:AD:B9:B1:3F:82:18:3B:54:02:12:DF:3E:5D:49:6B:19:E5:7C:AB:3E:2D:B5:C9:00:16:3F:E1:11:6C:9C:1E',
  'a=setup:actpass',
  'a=mid:0',
  'a=extmap:1 urn:ietf:params:rtp-hdrext:toffset',
  'a=extmap:2 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time',
  'a=extmap:3 urn:3gpp:video-orientation',
  'a=recvonly',
  'a=rtcp-mux',
  'a=rtpmap:102 H264/90000',
  'a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f',
  'a=rtpmap:103 rtx/90000',
  'a=fmtp:103 apt=102',
  'a=msid:4d0a8b1c-6f1e-4a9b-9f0c-2c8d7e5a1b33 9e2f7a6b-0c4d-4e8a-b1f2-6a3c9d5e7f01',
  'a=ssrc-group:FID 1111111111 2222222222',
  'a=ssrc:1111111111 cname:kQ2pXr7',
  'a=ssrc:1111111111 msid:4d0a8b1c-6f1e-4a9b-9f0c-2c8d7e5a1b33 9e2f7a6b-0c4d-4e8a-b1f2-6a3c9d5e7f01',
  'a=ssrc:2222222222 cname:kQ2pXr7',
  'a=ssrc:2222222222 msid:4d0a8b1c-6f1e-4a9b-9f0c-2c8d7e5a1b33 9e2f7a6b-0c4d-4e8a-b1f2-6a3c9d5e7f01',
  '',
].join('\r\n');

describe('compactSdp', () => {
  it('drops header extensions and anything that is not a local candidate', () => {
    const compact = compactSdp(SDP);

    expect(compact).not.toContain('a=extmap:1');
    expect(compact).not.toContain('a=extmap-allow-mixed');
    expect(compact).not.toContain('a=rtcp:9');
    expect(compact).not.toContain('typ srflx');
    expect(compact).toContain('typ host');
    // Everything that matters for a connection survives.
    expect(compact).toContain('a=ice-ufrag:9Xy1');
    expect(compact).toContain('a=fingerprint:sha-256');
    expect(compact).toContain('a=rtpmap:102 H264/90000');
    expect(compact).toContain('m=video');
  });

  it('renumbers stream ids consistently, keeping them matched across lines', () => {
    const compact = compactSdp(SDP);
    const msid = /a=msid:(\S+) (\S+)/.exec(compact);

    expect(msid).not.toBeNull();
    expect(msid![1]!.length).toBeLessThan(6);
    // Every later mention of the same stream uses the same short id.
    expect(compact).toContain(`a=ssrc:1111111111 msid:${msid![1]!} ${msid![2]!}`);
    expect(compact).toContain(`a=ssrc:2222222222 msid:${msid![1]!} ${msid![2]!}`);
    expect(compact).toContain('o=- 1 1 IN IP4 127.0.0.1');
  });

  it('leaves no blank lines, which some parsers dislike', () => {
    expect(compactSdp(SDP).split('\r\n').slice(0, -1).every((line) => line.length > 0)).toBe(true);
  });
});

describe('pairing payloads', () => {
  it('round-trips an offer', async () => {
    const text = await encodePayload({ v: 1, role: 'hub', sdp: SDP });
    const decoded = await decodePayload(text);

    expect(decoded.role).toBe('hub');
    expect(decoded.sdp).toContain('a=ice-ufrag:9Xy1');
    expect(decoded.sdp).toContain('typ host');
  });

  it('round-trips an answer and keeps the roles apart', async () => {
    const text = await encodePayload({ v: 1, role: 'camera', sdp: SDP });
    const decoded = await decodePayload(text);

    expect(decoded.role).toBe('camera');
    expect(() => expectRole(decoded, 'camera')).not.toThrow();
    expect(() => expectRole(decoded, 'hub')).toThrow(PairingPayloadError);
  });

  it('stays small enough to scan across a desk', async () => {
    // Every browser oche runs on has CompressionStream; the raw path exists
    // only so an old one degrades to a bigger QR rather than no pairing.
    expect(compressionAvailable()).toBe(true);

    const text = await encodePayload({ v: 1, role: 'hub', sdp: SDP });
    // Measured against real Chrome offers, not this fixture: 801 characters for
    // an offer and 878 for an answer on a machine with four network interfaces,
    // which is a version-24 QR at the lowest error correction — about 113
    // modules, readable from a phone screen held near a webcam. A device with
    // one Wi-Fi interface produces less. This is the budget, and it fails
    // loudly if the payload grows past what a camera can resolve.
    expect(text.length).toBeLessThan(900);
  });

  it('refuses anything that is not one of ours, with a message a person can act on', async () => {
    await expect(decodePayload('https://example.com')).rejects.toBeInstanceOf(PairingPayloadError);
    await expect(decodePayload('oche1.h.z.@@@@')).rejects.toBeInstanceOf(Error);
    await expect(decodePayload('oche9.h.z.AAAA')).rejects.toThrow(/not an oche pairing code/);
  });

  it('refuses a code that decodes to something that is not an SDP', async () => {
    const bytes = new TextEncoder().encode('hello from somewhere else');
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const base64 = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    await expect(decodePayload(`oche1.h.r.${base64}`)).rejects.toThrow(/no connection details/);
  });
});
