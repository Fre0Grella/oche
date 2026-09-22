import { isDouble, isScoring, isTreble, type Hit } from '../board/geometry.js';

/** The in/out rules a leg can be played under. */
export type InOutRule = 'straight' | 'double' | 'treble' | 'master';

/**
 * Whether a hit opens or closes a leg under the given rule.
 *
 * `master` means a double or a treble, as it does everywhere else in darts.
 * The bull counts as a double (it is the double of the 25), so it closes a
 * double-out and a master-out leg but not a treble-out one.
 */
export function satisfiesRule(h: Hit, rule: InOutRule): boolean {
  switch (rule) {
    case 'straight':
      return isScoring(h);
    case 'double':
      return isDouble(h);
    case 'treble':
      return isTreble(h);
    case 'master':
      return isDouble(h) || isTreble(h);
  }
}

/**
 * The smallest score that can still be finished under a rule. Leaving less than
 * this is a bust — which is why leaving 1 on a double-out leg is a bust even
 * though the score is above zero.
 */
export function minimumFinish(rule: InOutRule): number {
  switch (rule) {
    case 'straight':
      return 1;
    case 'double':
    case 'master':
      return 2;
    case 'treble':
      return 3;
  }
}
