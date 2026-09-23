import { hit, targetPoint, type Point } from '@oche/core';
import { render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { Stats } from './Stats.js';
import { deleteMatch, listMatches } from '../storage/db.js';
import { useMatchStore } from '../store/match.js';

const marco = { id: 'marco', name: 'Marco' };

const config = {
  startScore: 501,
  inRule: 'straight' as const,
  outRule: 'double' as const,
  legsPerSet: 1,
  setsToWin: 1,
  players: [marco],
};

const T20 = targetPoint(hit(20, 'treble'));

/** A deterministic thrower, so the numbers in the assertions are stable. */
function scatter(index: number, sigma: number): Point {
  const angle = (index * 2.399) % (Math.PI * 2);
  const radius = ((index * 37) % 100) / 100;
  return { x: T20.x + Math.cos(angle) * radius * sigma, y: T20.y + Math.sin(angle) * radius * sigma };
}

async function throwDarts(count: number, sigma = 12) {
  await act(async () => {
    useMatchStore.getState().startMatch(config);
  });
  for (let index = 0; index < count; index += 1) {
    const pos = scatter(index, sigma);
    const state = useMatchStore.getState();
    if (!state.snapshot?.current) break;
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      state.throwDart(hit(20, 'treble'), { pos });
    });
  }
}

describe('the statistics page', () => {
  beforeEach(async () => {
    // The page reads every match ever stored, so each test starts from nothing.
    for (const match of await listMatches(Number.MAX_SAFE_INTEGER)) await deleteMatch(match.id);
    useMatchStore.setState({ history: [], match: null, snapshot: null, screen: 'stats' });
  });

  it('says so plainly when there is nothing to show', async () => {
    render(<Stats />);
    expect(await screen.findByText(/play a leg and this fills up/i)).toBeDefined();
  });

  /** What the engine actually recorded — busts make the count its own business. */
  function dartsRecorded(): number {
    const snapshot = useMatchStore.getState().snapshot!;
    return snapshot.legs.reduce((sum, leg) => sum + (leg.dartsThrown.marco ?? 0), 0);
  }

  it('shows the headline numbers once darts have been thrown', async () => {
    await throwDarts(12);
    const thrown = dartsRecorded();
    render(<Stats />);

    await waitFor(() => expect(screen.getByText(/3-dart average/i)).toBeDefined());
    expect(screen.getByText(new RegExp(`from ${thrown} darts`, 'i'))).toBeDefined();
    expect(screen.getByText(/shape of your scoring/i)).toBeDefined();
    // Treble 20s only — busts pull it down, but it is still a scoring average.
    const average = Number(screen.getByText(/3-dart average/i).parentElement!.children[1]!.textContent);
    expect(average).toBeGreaterThan(60);
  });

  it('holds the aiming map back until there are enough darts to estimate a spread', async () => {
    await throwDarts(12);
    const thrown = dartsRecorded();
    render(<Stats />);

    await waitFor(() => expect(screen.getByText(/where you should aim/i)).toBeDefined());
    expect(
      screen.getByText(new RegExp(`needs 50 darts with a position; there are ${thrown}`, 'i')),
    ).toBeDefined();
  });

  it('draws the heatmap and names the spread once positions exist', async () => {
    await throwDarts(30);
    render(<Stats />);

    await waitFor(() => expect(screen.getByText(/where your darts land/i)).toBeDefined());
    expect(screen.getByLabelText(/heatmap of where the darts landed/i)).toBeDefined();
    expect(screen.getByText(/your group measures about/i)).toBeDefined();
    // The caveat about tapped positions is not buried in a help page.
    expect(screen.getByText(/tapped on the board rather than read by a camera/i)).toBeDefined();
  });

  it('explains what its contested definitions mean, next to them', async () => {
    await throwDarts(12);
    render(<Stats />);

    await waitFor(() => expect(screen.getByText(/checkout/i)).toBeDefined());
    const checkout = screen.getByTitle(/doubles hit ÷ darts thrown at a double/i);
    expect(checkout).toBeDefined();
  });
});
