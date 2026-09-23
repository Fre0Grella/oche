import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { Setup } from './Setup.js';
import {
  deleteMatch,
  deleteProfile,
  listMatches,
  listProfiles,
  putMatch,
  saveSetting,
} from '../storage/db.js';
import { useMatchStore } from '../store/match.js';

async function press(name: RegExp) {
  const button = await screen.findByRole('button', { name });
  await act(async () => {
    button.click();
  });
}

describe('starting a match', () => {
  beforeEach(async () => {
    for (const match of await listMatches(Number.MAX_SAFE_INTEGER)) await deleteMatch(match.id);
    for (const profile of await listProfiles()) await deleteProfile(profile.id);
    await saveSetting('profilesSeeded', true);
    useMatchStore.setState({ profiles: [], sessionGuests: [], history: [], screen: 'setup' });
  });

  it('keeps a guest around for the rest of the session', async () => {
    const first = render(<Setup />);
    await press(/\+ guest/i);
    fireEvent.change(screen.getByLabelText(/guest/i), { target: { value: 'Dave' } });
    await press(/add for this match/i);
    expect(screen.getByText('Dave')).toBeDefined();
    first.unmount();

    // Back at the setup screen after the leg: Dave is one tap away, not a name
    // to be typed again, and he is still not a profile.
    render(<Setup />);
    await press(/\+ dave/i);
    expect(screen.getByText('Dave')).toBeDefined();
    expect(useMatchStore.getState().profiles).toEqual([]);

    await press(/start match/i);
    const players = useMatchStore.getState().snapshot!.config.players;
    expect(players.map((player) => player.name)).toEqual(['Dave']);
    expect(players[0]!.temporary).toBe(true);
  });

  it('lets a profile be renamed to a name with a space in it', async () => {
    render(<Setup />);
    await press(/new profile/i);
    fireEvent.change(screen.getByLabelText(/new profile/i), { target: { value: 'Marco' } });
    await press(/^create$/i);
    await press(/manage profiles/i);

    const field = screen.getByLabelText(/^name marco$/i) as HTMLInputElement;
    // Typed one character at a time: the trailing space must survive, or the
    // second word can never be started.
    for (const value of ['Marco ', 'Marco G', 'Marco G.']) {
      fireEvent.change(field, { target: { value } });
      expect(field.value).toBe(value);
    }
    fireEvent.blur(field);

    await waitFor(() => expect(useMatchStore.getState().profiles[0]!.name).toBe('Marco G.'));
    // The id is the one made at creation, so the history follows the rename.
    expect(useMatchStore.getState().profiles[0]!.id).toBe('marco');

    // And the match is started under the new name, not the one picked earlier.
    await press(/done/i);
    await press(/start match/i);
    expect(useMatchStore.getState().snapshot!.config.players[0]!.name).toBe('Marco G.');
  });

  it('finds the players of matches played before profiles existed', async () => {
    await putMatch({
      id: 'old-match',
      createdAt: 1000,
      updatedAt: 2000,
      finished: true,
      events: [],
      config: {
        startScore: 501,
        inRule: 'straight',
        outRule: 'double',
        legsPerSet: 1,
        setsToWin: 1,
        players: [
          { id: 'marco', name: 'Marco' },
          { id: 'guest-old', name: 'Dave', temporary: true },
        ],
      },
    });
    await saveSetting('profilesSeeded', false);

    await act(async () => {
      await useMatchStore.getState().init('setup');
    });

    // Marco gets his history back; the guest he played stays forgotten.
    expect(useMatchStore.getState().profiles.map((profile) => profile.id)).toEqual(['marco']);
    expect(useMatchStore.getState().profiles[0]!.lastPlayedAt).toBe(2000);

    // Once only: deleting the profile on purpose must not undo the deletion.
    await act(async () => {
      await useMatchStore.getState().removeProfile('marco');
      await useMatchStore.getState().init('setup');
    });
    expect(useMatchStore.getState().profiles).toEqual([]);
  });
});
