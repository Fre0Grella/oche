import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ControlMessage, PairState, PairingConnection } from '../pairing/session.js';
import { useMatchStore } from '../store/match.js';
import { Lobby } from './Lobby.js';
import { Setup } from './Setup.js';

/** Enough of a connection for the store: its state, its callbacks, and close(). */
function fakePhone() {
  const phone = {
    state: 'connected' as PairState,
    onState: null as ((state: PairState) => void) | null,
    onMessage: null as ((message: ControlMessage) => void) | null,
    close: vi.fn(),
  };
  return phone;
}

async function press(name: RegExp) {
  const button = await screen.findByRole('button', { name });
  await act(async () => {
    button.click();
  });
}

function pairWith(phone: ReturnType<typeof fakePhone>) {
  act(() => {
    useMatchStore.getState().setPairing(phone as unknown as PairingConnection, {} as MediaStream);
    useMatchStore.getState().enterLobby('paired');
  });
}

describe('the lobby', () => {
  beforeEach(() => {
    useMatchStore.setState({
      session: null,
      mode: 'solo',
      pairing: null,
      remoteStream: null,
      pairState: null,
      phone: null,
      screen: 'landing',
      match: null,
    });
  });

  it('keeps the pairing when you go to camera setup and come back', () => {
    const phone = fakePhone();
    pairWith(phone);
    expect(useMatchStore.getState().screen).toBe('lobby');

    // Camera setup, Done, Back: the path that used to drop you on the landing page.
    act(() => useMatchStore.getState().setScreen('capture'));
    act(() => useMatchStore.getState().goHome());

    expect(useMatchStore.getState().screen).toBe('lobby');
    expect(useMatchStore.getState().pairing).toBe(phone);
    expect(phone.close).not.toHaveBeenCalled();
  });

  it('brings every screen back to the lobby, not the landing page', async () => {
    act(() => useMatchStore.getState().enterLobby('solo'));
    render(<Setup />);
    await press(/back to the lobby/i);
    expect(useMatchStore.getState().screen).toBe('lobby');
  });

  it("shows the phone's battery and resolution", () => {
    const phone = fakePhone();
    pairWith(phone);
    render(<Lobby />);
    act(() => phone.onMessage?.({ type: 'status', battery: 64, charging: true, width: 1920, height: 1080 }));
    expect(screen.getByText(/battery 64%, charging · 1920×1080/i)).toBeDefined();
  });

  it('asks before leaving with the phone paired, and only then ends the pairing', async () => {
    const phone = fakePhone();
    pairWith(phone);
    render(<Lobby />);

    await press(/leave the lobby/i);
    expect(screen.getByRole('alertdialog')).toBeDefined();
    expect(phone.close).not.toHaveBeenCalled();

    await press(/stay in the lobby/i);
    expect(phone.close).not.toHaveBeenCalled();

    await press(/leave the lobby/i);
    await press(/leave and end the pairing/i);
    expect(phone.close).toHaveBeenCalledOnce();
    expect(useMatchStore.getState().session).toBeNull();
    expect(useMatchStore.getState().screen).toBe('landing');
  });

  it('leaves a solo lobby without asking', async () => {
    act(() => useMatchStore.getState().enterLobby('solo'));
    render(<Lobby />);
    await press(/leave the lobby/i);
    expect(useMatchStore.getState().screen).toBe('landing');
  });

  it('says when the phone drops, and offers to pair again', async () => {
    const phone = fakePhone();
    pairWith(phone);
    render(<Lobby />);

    act(() => phone.onState?.('failed'));
    expect(screen.getByText(/the phone has disconnected/i)).toBeDefined();
    expect(useMatchStore.getState().screen).toBe('lobby');

    await press(/pair the phone again/i);
    expect(useMatchStore.getState().screen).toBe('pair');
    expect(useMatchStore.getState().pairing).toBeNull();
    // Still in the session: once the new pairing connects, it is the lobby again.
    expect(useMatchStore.getState().session).toBe('paired');
  });

  it('names the selected entry, and follows the pointer and the keyboard', async () => {
    act(() => useMatchStore.getState().enterLobby('solo'));
    const { container } = render(<Lobby />);
    const title = () => container.querySelector('.lobby-title')!.textContent;
    const art = () => container.querySelector('.lobby-art-frame')!.className;

    // The first entry leads: with no match in progress, a new game.
    expect(title()).toBe('New game');
    expect(screen.getByRole('button', { name: /new game/i }).getAttribute('aria-current')).toBe('true');
    expect(art()).toContain('lobby-art-newGame');

    fireEvent.pointerMove(screen.getByRole('button', { name: /statistics/i }));
    expect(title()).toBe('Statistics');
    expect(art()).toContain('lobby-art-stats');
    expect(screen.getByRole('button', { name: /statistics/i }).getAttribute('aria-describedby')).toBe('lobby-desc');

    // Arrow keys move the selection and the focus together, and wrap.
    const list = container.querySelector('.lobby-menu ul')!;
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(title()).toBe('Leave the lobby');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /leave the lobby/i }));
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(title()).toBe('New game');
    fireEvent.keyDown(list, { key: 'End' });
    expect(title()).toBe('Leave the lobby');
  });

  it('leads with resuming when a match is in progress', () => {
    act(() => useMatchStore.getState().enterLobby('solo'));
    useMatchStore.setState({
      match: { id: 'm', createdAt: 0, updatedAt: 0, finished: false, events: [{} as never], config: {} as never },
    });
    const { container } = render(<Lobby />);
    expect(container.querySelector('.lobby-title')!.textContent).toBe('Resume the match');
  });
});
