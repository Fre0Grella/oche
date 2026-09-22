/**
 * The handshake, squeezed small enough to travel as a picture.
 *
 * Pairing is deliberately offline: the phone and the laptop exchange their
 * WebRTC connection details by showing each other QR codes, so nothing about
 * this feature needs the internet, an account or a server. That only works if
 * the payload is small — a QR with a thousand characters in it is a wall of
 * noise that a webcam across a desk cannot read.
 *
 * So an SDP is trimmed to what a local connection actually needs, gzipped, and
 * base64url'd. Both ends run this same code, so the trimming is symmetric and
 * nothing is lost that the other side was relying on.
 */

export type PairingRole = 'hub' | 'camera';

export interface PairingPayload {
  /** Payload format version, so a newer phone can refuse an older laptop. */
  v: 1;
  role: PairingRole;
  sdp: string;
}

const PREFIX = 'oche1';

/**
 * Lines that cost bytes and buy nothing on a one-hop local link.
 *
 * - `a=extmap` header extensions are negotiable; dropping them from the offer
 *   means neither side uses them.
 * - Non-host ICE candidates cannot exist here (no STUN or TURN is configured),
 *   and if one appears it is not a route we want.
 */
function droppable(line: string): boolean {
  // Header extensions: negotiable, so dropping them from the offer means
  // neither side uses them.
  if (line.startsWith('a=extmap:') || line === 'a=extmap-allow-mixed') return true;

  if (line.startsWith('a=candidate:')) {
    // Only local addresses can work here: no STUN or TURN is configured.
    if (!line.includes('typ host')) return true;
    // TCP candidates are for getting out through firewalls, which is the
    // opposite of this feature. On a Wi-Fi network UDP is what connects, and
    // the TCP ones are a third of the offer.
    if (line.includes(' tcp ')) return true;
  }

  // RTCP is multiplexed onto the media port, so the separate address is dead
  // weight, and nothing trickles when the whole offer travels as one picture.
  if (line.startsWith('a=rtcp:')) return true;
  if (line.startsWith('a=ice-options:')) return true;
  if (line.startsWith('a=rtcp-xr:')) return true;

  // Feedback worth keeping on a one-hop link: retransmission and keyframe
  // requests. The bandwidth estimators are for the open internet.
  if (line.startsWith('a=rtcp-fb:') && (line.endsWith('goog-remb') || line.endsWith('ccm fir'))) {
    return true;
  }

  return false;
}

/**
 * Stream and track ids are opaque strings that only have to be consistent
 * *within* one session description — they are not names anything else knows.
 * Browsers put UUIDs there and then repeat them in every `a=ssrc` line, which
 * is a third of a real SDP. Renumbering them to `i1`, `i2` keeps the meaning
 * and saves a QR version or two.
 */
function shortenIds(sdp: string): string {
  const seen = new Map<string, string>();
  return sdp.replace(/[0-9a-zA-Z]{8}-[0-9a-zA-Z-]{20,}/g, (token) => {
    const existing = seen.get(token);
    if (existing) return existing;
    const short = `i${seen.size + 1}`;
    seen.set(token, short);
    return short;
  });
}

/**
 * How likely a local address is to be the one that reaches the other device.
 * Home Wi-Fi first; a VPN overlay or a container bridge last.
 */
function candidateRank(line: string): number {
  const address = /\d+ (?:udp|UDP) \d+ (\S+)/.exec(line)?.[1] ?? '';
  if (/^192\.168\./.test(address) || /^10\./.test(address)) return 0;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 1;
  if (/^fd|^fe80/i.test(address)) return 2;
  if (address.includes(':')) return 4; // other IPv6
  return 3; // carrier-grade NAT, VPN overlays, virtual adapters
}

/**
 * Candidate lines carry a pile of things ICE does not need to connect two
 * devices across a room: a ten-digit foundation, `generation 0`, `network-id`,
 * `network-cost`. Rewriting each as the six fields that matter saves about a
 * third of every line — and these are the lines gzip compresses worst, because
 * addresses and ports are close to random.
 */
function compactCandidate(line: string, index: number): string {
  const match = /^a=candidate:\S+ (\d+) (\S+) (\d+) (\S+) (\d+) typ host/.exec(line);
  if (!match) return line;
  const [, component, transport, priority, address, port] = match;
  return `a=candidate:${index} ${component} ${transport} ${priority} ${address} ${port} typ host`;
}

/**
 * At most this many addresses per media section travel in the code. Ranked as
 * above, the first is nearly always the one that connects; the second is there
 * for the machine whose Wi-Fi and Ethernet are both up.
 */
const MAX_CANDIDATES = 2;

export function compactSdp(sdp: string): string {
  const kept: string[] = [];
  let candidates: string[] = [];

  const flush = () => {
    candidates
      .map((line, index) => ({ line, index, rank: candidateRank(line) }))
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .slice(0, MAX_CANDIDATES)
      .sort((a, b) => a.index - b.index)
      .forEach((entry, position) => kept.push(compactCandidate(entry.line, position + 1)));
    candidates = [];
  };

  for (const raw of sdp.split(/\r?\n/)) {
    if (raw.length === 0 || droppable(raw)) continue;
    // The origin line matters only for renegotiating a session, which a pairing
    // code never does, so its random session id is dead weight.
    const line = raw.startsWith('o=') ? 'o=- 1 1 IN IP4 127.0.0.1' : raw;

    if (line.startsWith('a=candidate:')) {
      candidates.push(line);
      continue;
    }
    // Candidates belong to the section they were listed in, so they are emitted
    // before the next one starts.
    if (line.startsWith('m=')) flush();
    kept.push(line);
  }
  flush();

  return shortenIds(kept.join('\r\n')).concat('\r\n');
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

interface ByteTransform {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<BufferSource>;
}

async function pump(stream: ByteTransform, input: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  void writer.write(input);
  void writer.close();

  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }

  const out = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

export function compressionAvailable(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
}

async function gzip(text: string): Promise<Uint8Array | null> {
  if (!compressionAvailable()) return null;
  return pump(new CompressionStream('gzip'), new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>);
}

async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const out = await pump(new DecompressionStream('gzip'), bytes);
  return new TextDecoder().decode(out);
}

/**
 * `oche1.<role>.<z|r>.<data>` — short, all QR alphanumeric-friendly except the
 * payload itself, and self-describing enough to reject a stale or foreign code
 * with a sensible message instead of a WebRTC error.
 */
export async function encodePayload(payload: PairingPayload): Promise<string> {
  // The SDP travels as itself: the version lives in the prefix and the role in
  // its own field, so a JSON wrapper would only add braces and turn every line
  // ending into an escape sequence.
  const body = compactSdp(payload.sdp);
  const compressed = await gzip(body);
  const role = payload.role === 'hub' ? 'h' : 'c';

  if (compressed) return `${PREFIX}.${role}.z.${toBase64Url(compressed)}`;

  const raw = new TextEncoder().encode(body);
  return `${PREFIX}.${role}.r.${toBase64Url(raw)}`;
}

export class PairingPayloadError extends Error {}

export async function decodePayload(text: string): Promise<PairingPayload> {
  const trimmed = text.trim();
  const parts = trimmed.split('.');
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new PairingPayloadError('not an oche pairing code');
  }

  const [, roleTag, encoding, data] = parts;
  const role: PairingRole = roleTag === 'h' ? 'hub' : 'camera';
  if (roleTag !== 'h' && roleTag !== 'c') throw new PairingPayloadError('unknown pairing role');

  let sdp: string;
  try {
    const bytes = fromBase64Url(data!);
    sdp = encoding === 'z' ? await gunzip(bytes) : new TextDecoder().decode(bytes);
  } catch {
    throw new PairingPayloadError('pairing code is damaged');
  }

  if (!sdp.startsWith('v=0')) throw new PairingPayloadError('pairing code has no connection details');

  return { v: 1, role, sdp };
}

/** True when the role in a code is the one we were waiting for. */
export function expectRole(payload: PairingPayload, role: PairingRole): void {
  if (payload.role !== role) {
    throw new PairingPayloadError(
      role === 'camera' ? 'that is the laptop code, not the phone code' : 'that is the phone code',
    );
  }
}
