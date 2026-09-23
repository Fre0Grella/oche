/**
 * Screens and the address bar, kept in step.
 *
 * Not a router library: there are eight screens and no nested routes. What the
 * hash buys is a reload that lands you where you were, a back button that does
 * something sensible, and a link the phone can be sent to.
 */

export type Screen =
  | 'landing'
  | 'mode'
  | 'setup'
  | 'game'
  | 'history'
  | 'capture'
  | 'pair'
  | 'camera'
  | 'stats';

const HASHES: Record<Screen, string> = {
  landing: '#/',
  mode: '#/play',
  setup: '#/new',
  game: '#/game',
  history: '#/history',
  capture: '#/camera',
  pair: '#/pair',
  camera: '#/phone',
  stats: '#/stats',
};

const SCREENS = Object.fromEntries(
  Object.entries(HASHES).map(([screen, hash]) => [hash, screen as Screen]),
) as Record<string, Screen>;

export function hashForScreen(screen: Screen): string {
  return HASHES[screen];
}

export function screenFromHash(hash: string): Screen | null {
  const normalised = hash === '' || hash === '#' ? '#/' : hash;
  return SCREENS[normalised] ?? null;
}
