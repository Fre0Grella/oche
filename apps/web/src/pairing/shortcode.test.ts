import { describe, expect, it } from 'vitest';

import { ANSWER, OFFER } from './__fixtures__/handshake.js';
import {
  decodeShortCode,
  encodeShortCode,
  formatShortCode,
  normaliseShortCode,
  readAnswer,
  rebuildAnswer,
  shortCodeLength,
  ShortCodeError,
} from './shortcode.js';

const facts = readAnswer(ANSWER);

describe('reading a phone answer', () => {
  it('finds the parts a computer cannot guess', () => {
    expect(facts.ufrag).toMatch(/^\S{3,}$/);
    expect(facts.pwd.length).toBeGreaterThanOrEqual(20);
    expect(facts.fingerprint.split(':')).toHaveLength(32);
    expect(facts.setup).toBe('active');
    expect(facts.address?.ip).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
  });

  it('prefers a home address over a virtual adapter', () => {
    const sdp = [
      'a=ice-ufrag:abcd',
      'a=ice-pwd:0123456789012345678901',
      `a=fingerprint:sha-256 ${facts.fingerprint}`,
      'a=candidate:1 1 udp 1 100.108.140.111 5000 typ host',
      'a=candidate:2 1 udp 1 192.168.1.44 5001 typ host',
    ].join('\r\n');
    expect(readAnswer(sdp).address).toEqual({ ip: '192.168.1.44', port: 5001 });
  });
});

describe('the pairing code', () => {
  it('is short enough to type and survives the round trip', () => {
    const code = encodeShortCode(facts);
    // The whole point: a thousand characters of SDP become about a hundred.
    expect(code.length).toBeLessThan(110);
    expect(ANSWER.length).toBeGreaterThan(1000);
    expect(decodeShortCode(code)).toEqual(facts);
  });

  it('forgives how a person types it', () => {
    const code = encodeShortCode(facts);
    const asTyped = formatShortCode(code).toLowerCase().replace(/\n/g, '  ').replace(/ /g, '-');
    expect(decodeShortCode(asTyped)).toEqual(facts);
  });

  it('reads a letter O as a zero and an I or L as a one', () => {
    expect(normaliseShortCode('o0 iI lL')).toBe('001111');
  });

  it('catches a single wrong character before anything is tried', () => {
    const code = encodeShortCode(facts);
    const at = 20;
    const wrong = `${code.slice(0, at)}${code[at] === '7' ? '8' : '7'}${code.slice(at + 1)}`;
    expect(() => decodeShortCode(wrong)).toThrow(ShortCodeError);
    expect(() => decodeShortCode(wrong)).toThrow(/one of the characters is wrong/i);
  });

  it('says so plainly when the code is not a code at all', () => {
    expect(() => decodeShortCode('hello there')).toThrow(ShortCodeError);
    expect(() => decodeShortCode(encodeShortCode(facts).slice(0, 30))).toThrow(/too short|missing/i);
  });

  it('prints in groups of five, four to a line, and counts what is typed', () => {
    const printed = formatShortCode(encodeShortCode(facts));
    expect(printed.split('\n')[0]).toMatch(/^[0-9A-Z]{5} [0-9A-Z]{5} [0-9A-Z]{5} [0-9A-Z]{5}$/);
    expect(shortCodeLength(printed)).toBe(encodeShortCode(facts).length);
  });
});

describe('rebuilding the answer', () => {
  const rebuilt = rebuildAnswer(OFFER, decodeShortCode(encodeShortCode(facts)));

  it('carries the phone’s identity, not the computer’s', () => {
    expect(rebuilt).toContain(`a=ice-ufrag:${facts.ufrag}`);
    expect(rebuilt).toContain(`a=ice-pwd:${facts.pwd}`);
    expect(rebuilt.toUpperCase()).toContain(`A=FINGERPRINT:SHA-256 ${facts.fingerprint.toUpperCase()}`);
    expect(rebuilt).toContain(`${facts.address!.ip} ${facts.address!.port} typ host`);
    expect(rebuilt).not.toContain(OFFER.match(/a=ice-ufrag:(\S+)/)![1]!);
  });

  it('turns the offer round: the phone sends, the computer receives', () => {
    expect(OFFER).toContain('a=recvonly');
    expect(rebuilt).toContain('a=sendonly');
    expect(rebuilt).not.toContain('a=recvonly');
    expect(rebuilt).toContain('a=setup:active');
  });

  it('keeps the shape the offer asked for, so the browser accepts it', () => {
    const mids = (sdp: string) => sdp.match(/a=mid:\S+/g);
    const sections = (sdp: string) => sdp.match(/^m=\S+/gm)?.map((line) => line.split(' ')[0]);
    expect(mids(rebuilt)).toEqual(mids(OFFER));
    expect(sections(rebuilt)).toEqual(sections(OFFER));
    expect(rebuilt).toContain('a=group:BUNDLE');
    expect(rebuilt.endsWith('\r\n')).toBe(true);
  });

  it('holds only the phone’s address, once', () => {
    expect(rebuilt.match(/a=candidate:/g)).toHaveLength(1);
  });
});
