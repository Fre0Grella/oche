import { hit } from '@oche/core';
import { render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it } from 'vitest';

import { App } from './App.js';
import { useMatchStore } from './store/match.js';

describe('the app', () => {
  it('opens on match setup, starts a match and shows the score falling', async () => {
    render(<App />);

    const start = await screen.findByRole('button', { name: /start match/i });
    await act(async () => {
      start.click();
    });

    await waitFor(() => expect(useMatchStore.getState().screen).toBe('game'));

    // Two players at 501 each.
    expect(screen.getAllByText('501')).toHaveLength(2);
    expect(screen.getByLabelText('Dartboard')).toBeDefined();

    await act(async () => {
      useMatchStore.getState().throwDart(hit(20, 'treble'), { pos: { x: 0, y: 103 } });
      useMatchStore.getState().throwDart(hit(20, 'treble'));
      useMatchStore.getState().throwDart(hit(20, 'treble'));
    });

    // 180 thrown: the thrower is on 321 and the throw has passed over.
    expect(screen.getByText('321')).toBeDefined();
    expect(screen.getByText(/Player 2 to throw/)).toBeDefined();
  });
});
