/**
 * The handshake, squeezed down to something a person can carry across a desk.
 *
 * A computer without a webcam cannot read the phone's answer as a picture, and
 * the answer is nearly a thousand characters — nobody is typing that. But the
 * computer already *has* almost all of it: the answer is a mirror of the offer
 * it wrote itself a moment ago, so everything except a few unguessable fields
 * can be rebuilt locally rather than transmitted.
 *
 * What genuinely cannot be guessed is the phone's DTLS fingerprint, its ICE
 * credentials, and the address it is listening on. That is 64 bytes, which is
 * 103 characters — a minute of typing, once, with nothing hosted anywhere. The
 * phone offers to copy it, so most people will paste it instead.
 *
 * This is a fallback: the QR path is faster and stays the recommended one.
 */

import { compactSdp } from './payload.js';

export interface AnswerFacts {
  ufrag: string;
  pwd: string;
  /** 32 bytes of SHA-256, as the colon-separated hex an SDP carries. */
  fingerprint: string;
  setup: 'active' | 'passive';
  /** The phone's best local address, so the computer can call it directly. */
  address: { ip: string; port: number } | null;
}

export class ShortCodeError extends Error {}

/* -------------------------------------------------------------------------- */
/* Reading an answer                                                          */
/* -------------------------------------------------------------------------- */

/**
 * How likely a local address is to be the one that reaches the other device —
 * the same ranking the QR path uses, because it is the same question.
 */
function rank(ip: string): number {
  if (/^192\.168\./.test(ip) || /^10\./.test(ip)) return 0;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 1;
  return 2;
}

export function readAnswer(sdp: string): AnswerFacts {
  const first = (pattern: RegExp): string => {
    const found = pattern.exec(sdp)?.[1];
    if (!found) throw new ShortCodeError(`the answer has no ${pattern.source}`);
    return found;
  };

  // Only IPv4: an IPv6 address is 16 bytes and would add 20 characters to a
  // code that is already long, and a v6-only local network is not a thing the
  // two devices in one room have.
  const addresses = sdp
    .split(/\r?\n/)
    .filter((line) => /^a=candidate:.* udp .* typ host/i.test(line))
    .map((line) => /(\d+\.\d+\.\d+\.\d+) (\d+) typ host/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ ip: match[1]!, port: Number(match[2]) }))
    .sort((a, b) => rank(a.ip) - rank(b.ip));

  return {
    ufrag: first(/a=ice-ufrag:(\S+)/),
    pwd: first(/a=ice-pwd:(\S+)/),
    fingerprint: first(/a=fingerprint:sha-256 (\S+)/i),
    setup: /a=setup:passive/.test(sdp) ? 'passive' : 'active',
    address: addresses[0] ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/* Rebuilding it                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The answer, reconstructed from the offer the computer made plus the facts
 * that travelled in the code.
 *
 * The template is the *compacted* offer, which is exactly what the phone was
 * answering, so the media sections, their mids, their payload types and the
 * bundle all line up with what the phone agreed to. The rebuilt answer may list
 * a codec the phone quietly dropped; that costs nothing, because the payload
 * type numbers come from the offer both sides share, so whatever arrives is
 * still the codec the computer thinks it is.
 */
export function rebuildAnswer(offerSdp: string, facts: AnswerFacts): string {
  const lines: string[] = [];
  let section = 0;

  for (const raw of compactSdp(offerSdp).split(/\r?\n/)) {
    if (raw.length === 0) continue;
    if (raw.startsWith('m=')) section += 1;

    // The computer's own addresses have no business in the phone's answer.
    if (raw.startsWith('a=candidate:')) continue;

    let line = raw;
    if (line.startsWith('a=ice-ufrag:')) line = `a=ice-ufrag:${facts.ufrag}`;
    else if (line.startsWith('a=ice-pwd:')) line = `a=ice-pwd:${facts.pwd}`;
    else if (line.startsWith('a=fingerprint:')) line = `a=fingerprint:sha-256 ${facts.fingerprint}`;
    else if (line.startsWith('a=setup:')) line = `a=setup:${facts.setup}`;
    // The offer asked to receive video, so the answer offers to send it.
    else if (line === 'a=recvonly') line = 'a=sendonly';

    lines.push(line);

    // One address, in the section that carries the bundle. Without it the
    // connection can still form — the phone's own checks arrive and are
    // learned as peer-reflexive — but only if the phone could reach the
    // computer first, and a computer that never opened a camera advertises
    // itself as an mDNS name that not every network resolves.
    if (line.startsWith('c=') && section === 1 && facts.address) {
      lines.push(
        `a=candidate:1 1 udp 2122260223 ${facts.address.ip} ${facts.address.port} typ host generation 0`,
      );
    }
  }

  return `${lines.join('\r\n')}\r\n`;
}

/* -------------------------------------------------------------------------- */
/* The code itself                                                            */
/* -------------------------------------------------------------------------- */

/** Crockford's base32: no I, L, O or U, so nothing reads as something else. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** RFC 8839's `ice-char`, which is exactly 64 symbols — six bits each. */
const ICE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const VERSION = 1;
const FLAG_ACTIVE = 1 << 4;
const FLAG_ADDRESS = 1 << 5;
const FLAG_PACKED = 1 << 6;

function packSix(text: string): Uint8Array {
  const bytes = new Uint8Array(Math.ceil((text.length * 6) / 8));
  let bits = 0;
  let value = 0;
  let at = 0;
  for (const char of text) {
    value = (value << 6) | ICE_CHARS.indexOf(char);
    bits += 6;
    while (bits >= 8) {
      bits -= 8;
      bytes[at++] = (value >> bits) & 0xff;
    }
  }
  if (bits > 0) bytes[at] = (value << (8 - bits)) & 0xff;
  return bytes;
}

function unpackSix(bytes: Uint8Array, count: number): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 6 && out.length < count) {
      bits -= 6;
      out += ICE_CHARS[(value >> bits) & 0x3f];
    }
  }
  return out;
}

/** CRC-16/CCITT-FALSE: enough to catch a typo before a connection is tried. */
function crc16(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(':');
}

function toBase32(bytes: Uint8Array): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(value >> bits) & 31];
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function fromBase32(text: string): Uint8Array {
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of text) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new ShortCodeError(`"${char}" is not part of a pairing code`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

/**
 * Typed codes arrive with the mistakes people make: lower case, the spaces and
 * newlines we printed, a letter O where a zero was meant. All of that is fixed
 * here rather than thrown back at the person.
 */
export function normaliseShortCode(text: string): string {
  // O for zero and I or L for one are Crockford's own substitutions: those
  // letters are not in the alphabet, so reading them as digits is safe. A U is
  // not in it either, but it stands for nothing, so it is left to fail loudly.
  return text
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/[^0-9A-Z]/g, '');
}

/** Five-character groups, four to a line: short enough to hold in your eye. */
export function formatShortCode(code: string): string {
  const groups = normaliseShortCode(code).match(/.{1,5}/g) ?? [];
  const lines: string[] = [];
  for (let at = 0; at < groups.length; at += 4) lines.push(groups.slice(at, at + 4).join(' '));
  return lines.join('\n');
}

export function encodeShortCode(facts: AnswerFacts): string {
  const fingerprint = hexToBytes(facts.fingerprint);
  if (fingerprint.length !== 32) throw new ShortCodeError('the fingerprint is not a SHA-256');

  const packable = [...facts.ufrag, ...facts.pwd].every((char) => ICE_CHARS.includes(char));
  const credentials = packable
    ? [packSix(facts.ufrag), packSix(facts.pwd)]
    : [new TextEncoder().encode(facts.ufrag), new TextEncoder().encode(facts.pwd)];

  const header = new Uint8Array([
    VERSION |
      (facts.setup === 'active' ? FLAG_ACTIVE : 0) |
      (facts.address ? FLAG_ADDRESS : 0) |
      (packable ? FLAG_PACKED : 0),
    facts.ufrag.length,
    facts.pwd.length,
  ]);

  const address = facts.address
    ? new Uint8Array([
        ...facts.address.ip.split('.').map(Number),
        (facts.address.port >> 8) & 0xff,
        facts.address.port & 0xff,
      ])
    : new Uint8Array(0);

  const body = new Uint8Array([...header, ...fingerprint, ...credentials[0]!, ...credentials[1]!, ...address]);
  const check = crc16(body);
  return toBase32(new Uint8Array([...body, (check >> 8) & 0xff, check & 0xff]));
}

export function decodeShortCode(text: string): AnswerFacts {
  const bytes = fromBase32(normaliseShortCode(text));
  if (bytes.length < 38) throw new ShortCodeError('that code is too short to be a pairing code');

  const flags = bytes[0]!;
  if ((flags & 0x0f) !== VERSION) throw new ShortCodeError('that code came from a different version of oche');

  const ufragLength = bytes[1]!;
  const pwdLength = bytes[2]!;
  const packed = (flags & FLAG_PACKED) !== 0;
  const size = (length: number) => (packed ? Math.ceil((length * 6) / 8) : length);

  const fingerprintEnd = 3 + 32;
  const ufragEnd = fingerprintEnd + size(ufragLength);
  const pwdEnd = ufragEnd + size(pwdLength);
  const hasAddress = (flags & FLAG_ADDRESS) !== 0;
  const end = pwdEnd + (hasAddress ? 6 : 0);

  if (bytes.length < end + 2) throw new ShortCodeError('that code is missing some characters');

  // Trailing characters are allowed: the code is self-describing, and a person
  // who typed one group too many should not be told to start again.
  const body = bytes.slice(0, end);
  const check = (bytes[end]! << 8) | bytes[end + 1]!;
  if (crc16(body) !== check) {
    throw new ShortCodeError('one of the characters is wrong — check the code against the phone');
  }

  const credentials = (from: number, to: number, length: number): string =>
    packed ? unpackSix(bytes.slice(from, to), length) : new TextDecoder().decode(bytes.slice(from, to));

  return {
    ufrag: credentials(fingerprintEnd, ufragEnd, ufragLength),
    pwd: credentials(ufragEnd, pwdEnd, pwdLength),
    fingerprint: bytesToHex(bytes.slice(3, fingerprintEnd)),
    setup: flags & FLAG_ACTIVE ? 'active' : 'passive',
    address: hasAddress
      ? {
          ip: [...bytes.slice(pwdEnd, pwdEnd + 4)].join('.'),
          port: (bytes[pwdEnd + 4]! << 8) | bytes[pwdEnd + 5]!,
        }
      : null,
  };
}

/** How many characters a finished code has, for the "17 of 103" counter. */
export function shortCodeLength(code: string): number {
  return normaliseShortCode(code).length;
}
