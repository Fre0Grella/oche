/**
 * Checkout routes: what to aim at, given a remaining score and darts in hand.
 *
 * Two sources, in this order:
 *
 * 1. **The conventional chart**, for double-out, which is what players expect to
 *    see and what every other scorer shows. It is reference data (route sums are
 *    verified by tests, not trusted), taken from the published chart at
 *    <https://darts501.com/Check.html>. Where several routes are equally valid,
 *    charts disagree with each other; this one is a defensible convention rather
 *    than a unique truth, and that is written on the screen next to it.
 *
 * 2. **A search**, for every other case: fewer than three darts in hand, the
 *    other out rules, or a score the chart does not cover. It minimises darts
 *    first, then prefers comfortable finishing doubles and 20/19 trebles as
 *    setup darts, which is roughly how a player thinks.
 */

import type { Hit } from '../board/geometry.js';
import { allScoringHits, formatHit, parseHit } from '../board/notation.js';
import { minimumFinish, satisfiesRule, type InOutRule } from './rules.js';

/** Conventional three-dart routes for double-out, keyed by remaining score. */
const CHART_DOUBLE_OUT: Record<number, string> = {
  170: 'T20 T20 BULL',
  167: 'T20 T19 BULL',
  164: 'T20 T18 BULL',
  161: 'T20 T17 BULL',
  160: 'T20 T20 D20',
  158: 'T20 T20 D19',
  157: 'T20 T19 D20',
  156: 'T20 T20 D18',
  155: 'T20 T19 D19',
  154: 'T20 T18 D20',
  153: 'T20 T19 D18',
  152: 'T20 T20 D16',
  151: 'T20 T17 D20',
  150: 'T20 T18 D18',
  149: 'T20 T19 D16',
  148: 'T20 T16 D20',
  147: 'T20 T17 D18',
  146: 'T20 T18 D16',
  145: 'T20 T15 D20',
  144: 'T20 T20 D12',
  143: 'T20 T17 D16',
  142: 'T20 T14 D20',
  141: 'T20 T19 D12',
  140: 'T20 T16 D16',
  139: 'T19 T14 D20',
  138: 'T20 T18 D12',
  137: 'T19 T16 D16',
  136: 'T20 T20 D8',
  135: 'T20 T17 D12',
  134: 'T20 T14 D16',
  133: 'T20 T19 D8',
  132: 'T20 T16 D12',
  131: 'T20 T13 D16',
  130: 'T20 T20 D5',
  129: 'T19 T16 D12',
  128: 'T18 T14 D16',
  127: 'T20 T17 D8',
  126: 'T19 T19 D6',
  125: '25 T20 D20',
  124: 'T20 T16 D8',
  123: 'T19 T16 D9',
  122: 'T18 T20 D4',
  121: 'T17 T10 D20',
  120: 'T20 S20 D20',
  119: 'T19 T10 D16',
  118: 'T20 S18 D20',
  117: 'T20 S17 D20',
  116: 'T20 S16 D20',
  115: 'T20 S15 D20',
  114: 'T20 S14 D20',
  113: 'T20 S13 D20',
  112: 'T20 S12 D20',
  111: 'T20 S19 D16',
  110: 'T20 S18 D16',
  109: 'T19 S20 D16',
  108: 'T20 S16 D16',
  107: 'T19 S18 D16',
  106: 'T20 S14 D16',
  105: 'T19 S16 D16',
  104: 'T18 S18 D16',
  103: 'T20 S3 D20',
  102: 'T20 S10 D16',
  101: 'T20 S1 D20',
  100: 'T20 D20',
  99: 'T19 S10 D16',
  98: 'T20 D19',
  97: 'T19 D20',
  96: 'T20 D18',
  95: 'T19 D19',
  94: 'T18 D20',
  93: 'T19 D18',
  92: 'T20 D16',
  91: 'T17 D20',
  90: 'T20 D15',
  89: 'T19 D16',
  88: 'T16 D20',
  87: 'T17 D18',
  86: 'T18 D16',
  85: 'T15 D20',
  84: 'T20 D12',
  83: 'T17 D16',
  82: 'T14 D20',
  81: 'T19 D12',
  80: 'T20 D10',
  79: 'T19 D11',
  78: 'T18 D12',
  77: 'T19 D10',
  76: 'T20 D8',
  75: 'T17 D12',
  74: 'T14 D16',
  73: 'T19 D8',
  72: 'T16 D12',
  71: 'T13 D16',
  70: 'T10 D20',
  69: 'T15 D12',
  68: 'T20 D4',
  67: 'T17 D8',
  66: 'T10 D18',
  65: 'T19 D4',
  64: 'T16 D8',
  63: 'T13 D12',
  62: 'T10 D16',
  61: 'T15 D8',
  60: 'S20 D20',
  59: 'S19 D20',
  58: 'S18 D20',
  57: 'S17 D20',
  56: 'S16 D20',
  55: 'S15 D20',
  54: 'S14 D20',
  53: 'S13 D20',
  52: 'S12 D20',
  51: 'S11 D20',
  50: 'S10 D20',
  49: 'S9 D20',
  48: 'S16 D16',
  47: 'S15 D16',
  46: 'S6 D20',
  45: 'S13 D16',
  44: 'S4 D20',
  43: 'S11 D16',
  42: 'S10 D16',
  41: 'S9 D16',
  40: 'D20',
  39: 'S7 D16',
  38: 'D19',
  37: 'S5 D16',
  36: 'D18',
  35: 'S3 D16',
  34: 'D17',
  33: 'S1 D16',
  32: 'D16',
  31: 'S15 D8',
  30: 'D15',
  29: 'S13 D8',
  28: 'D14',
  27: 'S11 D8',
  26: 'D13',
  25: 'S9 D8',
  24: 'D12',
  23: 'S7 D8',
  22: 'D11',
  21: 'S5 D8',
  20: 'D10',
  19: 'S3 D8',
  18: 'D9',
  17: 'S1 D8',
  16: 'D8',
  15: 'S7 D4',
  14: 'D7',
  13: 'S5 D4',
  12: 'D6',
  11: 'S3 D4',
  10: 'D5',
  9: 'S1 D4',
  8: 'D4',
  7: 'S3 D2',
  6: 'D3',
  5: 'S1 D2',
  4: 'D2',
  3: 'S1 D1',
  2: 'D1',
};

/** Scores that cannot be finished in three darts at all, under double-out. */
export const BOGEY_SCORES = [169, 168, 166, 165, 163, 162, 159] as const;

const TARGETS = allScoringHits();

/** How much a finishing dart is disliked: lower is a more comfortable double. */
const DOUBLE_PREFERENCE = [16, 20, 8, 10, 12, 4, 18, 2, 14, 6, 11, 19, 17, 13, 15, 9, 7, 5, 3, 1];

function finishCost(h: Hit): number {
  if (h.ring === 'bull') return 6;
  if (h.ring === 'double') {
    const rank = DOUBLE_PREFERENCE.indexOf(h.sector);
    return (rank < 0 ? DOUBLE_PREFERENCE.length : rank) * 0.5;
  }
  // Treble or straight finishes: prefer the big numbers, which are where the
  // player is already looking.
  return 1 + (20 - h.sector) * 0.05;
}

function setupCost(h: Hit): number {
  switch (h.ring) {
    case 'treble':
      if (h.sector === 20) return 0;
      if (h.sector === 19) return 0.3;
      return 1 + (20 - h.sector) * 0.05;
    case 'single':
      return 2 + (20 - h.sector) * 0.05;
    case 'double':
      return 3 + (20 - h.sector) * 0.05;
    case 'outerBull':
      return 2.5;
    case 'bull':
      return 3;
    case 'miss':
      return Infinity;
  }
}

interface Candidate {
  cost: number;
  route: Hit[];
}

const searchCache = new Map<string, Candidate | null>();

function search(remaining: number, dartsLeft: number, rule: InOutRule): Candidate | null {
  if (dartsLeft <= 0 || remaining <= 0) return null;
  if (remaining < minimumFinish(rule)) return null;

  const key = `${remaining}:${dartsLeft}:${rule}`;
  const cached = searchCache.get(key);
  if (cached !== undefined) return cached;

  let best: Candidate | null = null;

  for (const target of TARGETS) {
    let candidate: Candidate | null = null;

    if (target.value === remaining) {
      if (satisfiesRule(target, rule)) {
        candidate = { cost: finishCost(target), route: [target] };
      }
    } else if (target.value < remaining && dartsLeft > 1) {
      const rest = search(remaining - target.value, dartsLeft - 1, rule);
      if (rest) {
        // Each extra dart costs far more than any preference, so the shortest
        // route always wins.
        candidate = { cost: 100 + setupCost(target) + rest.cost, route: [target, ...rest.route] };
      }
    }

    if (candidate !== null && (best === null || candidate.cost < best.cost)) best = candidate;
  }

  searchCache.set(key, best);
  return best;
}

function chartRoute(remaining: number): Hit[] | null {
  const notation = CHART_DOUBLE_OUT[remaining];
  if (!notation) return null;
  const route = notation.split(' ').map((token) => {
    const h = parseHit(token);
    if (!h) throw new Error(`bad chart entry for ${remaining}: ${notation}`);
    return h;
  });
  return route;
}

/**
 * The suggested route for `remaining` with `dartsLeft` darts in hand, or null
 * when the score cannot be finished with those darts.
 */
export function checkoutRoute(
  remaining: number,
  dartsLeft: number,
  rule: InOutRule = 'double',
): Hit[] | null {
  if (dartsLeft <= 0 || remaining <= 0) return null;

  if (rule === 'double') {
    const chart = chartRoute(remaining);
    if (chart && chart.length <= dartsLeft) return chart;
  }

  return search(remaining, dartsLeft, rule)?.route ?? null;
}

/** Whether the leg can be closed from here with the darts in hand. */
export function canCheckout(
  remaining: number,
  dartsLeft: number,
  rule: InOutRule = 'double',
): boolean {
  return checkoutRoute(remaining, dartsLeft, rule) !== null;
}

/**
 * Whether a single dart can close the leg from `remaining` — the definition of
 * "a dart at a double", which is what checkout percentage is measured against.
 */
export function isFinishableWithOneDart(remaining: number, rule: InOutRule = 'double'): boolean {
  return TARGETS.some((t) => t.value === remaining && satisfiesRule(t, rule));
}

/** The one dart that would close the leg, if there is a choice, the best one. */
export function finishingDart(remaining: number, rule: InOutRule = 'double'): Hit | null {
  const options = TARGETS.filter((t) => t.value === remaining && satisfiesRule(t, rule));
  if (options.length === 0) return null;
  return options.reduce((a, b) => (finishCost(a) <= finishCost(b) ? a : b));
}

/** Formats a route the way it is spoken: `T20 T19 D12`. */
export function formatRoute(route: readonly Hit[]): string {
  return route.map(formatHit).join(' ');
}

/** Exposed for tests: the raw chart, so its arithmetic can be verified. */
export const CHECKOUT_CHART = CHART_DOUBLE_OUT;
