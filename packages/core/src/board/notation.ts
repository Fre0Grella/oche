/**
 * Short notation for hits: `T20`, `D16`, `S5`, `25`, `BULL`, `MISS`.
 *
 * Used in the UI, in checkout routes, in test fixtures and in exports, so it is
 * the one place where a hit turns into a string and back.
 */

import { BULL, MISS, OUTER_BULL, hit, type Hit } from './geometry.js';

export function formatHit(h: Hit): string {
  switch (h.ring) {
    case 'miss':
      return 'MISS';
    case 'bull':
      return 'BULL';
    case 'outerBull':
      return '25';
    case 'single':
      return `S${h.sector}`;
    case 'double':
      return `D${h.sector}`;
    case 'treble':
      return `T${h.sector}`;
  }
}

/** Parses the notation above. Returns null for anything unrecognised. */
export function parseHit(text: string): Hit | null {
  const s = text.trim().toUpperCase();
  if (s === 'MISS' || s === '0' || s === 'S0') return MISS;
  if (s === 'BULL' || s === 'DB' || s === '50') return BULL;
  if (s === '25' || s === 'SB' || s === 'OB') return OUTER_BULL;

  const m = /^([SDT])\s*(\d{1,2})$/.exec(s) ?? /^(\d{1,2})$/.exec(s);
  if (!m) return null;

  if (m.length === 2) {
    const sector = Number(m[1]);
    return sector >= 1 && sector <= 20 ? hit(sector, 'single') : null;
  }

  const sector = Number(m[2]);
  if (sector < 1 || sector > 20) return null;
  const ring = m[1] === 'D' ? 'double' : m[1] === 'T' ? 'treble' : 'single';
  return hit(sector, ring);
}

/** Every hit a dart can score, once each: 20 singles, doubles, trebles + bulls. */
export function allScoringHits(): Hit[] {
  const hits: Hit[] = [];
  for (let sector = 1; sector <= 20; sector += 1) {
    hits.push(hit(sector, 'single'), hit(sector, 'double'), hit(sector, 'treble'));
  }
  hits.push(OUTER_BULL, BULL);
  return hits;
}
