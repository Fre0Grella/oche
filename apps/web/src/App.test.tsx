import { hit } from '@oche/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { App } from './App.js';
import { useMatchStore } from './store/match.js';

/** Clicks a button by its visible name and lets React settle. */
async function press(name: RegExp) {
  const button = await screen.findByRole('button', { name });
  await act(async () => {
    button.click();
  });
}

describe('the app', () => {
  beforeEach(() => {
    // Each test arrives as a first-time visitor would: at the front door.
    history.replaceState(null, '', '#/');
    useMatchStore.setState({ ready: false, screen: 'landing' });
  });

  it('goes landing → mode → setup → game, and scores', async () => {
    render(<App />);

    // It opens by explaining what it is, not by dropping you into a leg.
    await press(/play darts/i);
    await waitFor(() => expect(useMatchStore.getState().screen).toBe('mode'));

    // Both modes are offered, with a picture each.
    expect(screen.getByLabelText(/one phone, watching the board/i)).toBeDefined();
    expect(screen.getByLabelText(/phone as the camera/i)).toBeDefined();

    await press(/use one device/i);
    await waitFor(() => expect(useMatchStore.getState().screen).toBe('setup'));
    expect(useMatchStore.getState().mode).toBe('solo');

    // A profile, which keeps its statistics…
    await press(/new profile/i);
    fireEvent.change(screen.getByLabelText(/new profile/i), { target: { value: 'Marco' } });
    await press(/^create$/i);

    // …and a guest, who does not.
    await press(/\+ guest/i);
    await press(/add for this match/i);

    expect(screen.getByText(/marco/i)).toBeDefined();
    expect(useMatchStore.getState().profiles.map((profile) => profile.id)).toEqual(['marco']);

    await press(/start match/i);
    await waitFor(() => expect(useMatchStore.getState().screen).toBe('game'));
    expect(screen.getAllByText('501')).toHaveLength(2);

    await act(async () => {
      useMatchStore.getState().throwDart(hit(20, 'treble'), { pos: { x: 0, y: 103 } });
      useMatchStore.getState().throwDart(hit(20, 'treble'));
      useMatchStore.getState().throwDart(hit(20, 'treble'));
    });

    expect(screen.getByText('321')).toBeDefined();
    // The throw passes to the guest, who is named on the scoreboard like anyone.
    expect(screen.getByText(/guest to throw/i)).toBeDefined();
  });

  it('offers the pairing route from the same chooser', async () => {
    render(<App />);

    // A match may be in progress from the previous test; the landing page
    // offers to carry on with it, but "Play darts" still starts a new one.
    await press(/play darts/i);
    await waitFor(() => expect(useMatchStore.getState().screen).toBe('mode'));

    await press(/pair two devices/i);
    // Which device is this? — asked with the same illustrated cards, not a
    // small link under the chooser.
    await waitFor(() => expect(useMatchStore.getState().screen).toBe('pairRole'));
    expect(screen.getByLabelText(/the computer end/i)).toBeDefined();
    expect(screen.getByLabelText(/the phone end/i)).toBeDefined();

    await press(/i'm on the phone/i);
    await waitFor(() => expect(useMatchStore.getState().screen).toBe('camera'));

    // Back to the pair of cards, and the other one goes to the scoreboard side.
    await press(/back/i);
    await waitFor(() => expect(useMatchStore.getState().screen).toBe('pairRole'));
    await press(/i'm on the computer/i);
    await waitFor(() => expect(useMatchStore.getState().screen).toBe('pair'));
    expect(useMatchStore.getState().mode).toBe('paired');
    expect(screen.getByText(/no accounts, no internet/i)).toBeDefined();
  });
});
