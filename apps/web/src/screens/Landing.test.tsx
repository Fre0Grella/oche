import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useMatchStore } from '../store/match.js';
import { Landing } from './Landing.js';

describe('the landing page', () => {
  beforeEach(() => {
    useMatchStore.setState({ session: null, match: null, screen: 'landing' });
  });

  it('puts the board behind the page as decoration, not as something to use', () => {
    const { container } = render(<Landing />);
    const backdrop = container.querySelector('.landing-backdrop')!;
    expect(backdrop.getAttribute('aria-hidden')).toBe('true');

    const board = backdrop.querySelector('svg')!;
    expect(board.getAttribute('aria-hidden')).toBe('true');
    // Not the board you score on: no button role, no label to announce.
    expect(board.getAttribute('role')).toBeNull();
    expect(screen.queryByRole('button', { name: /dartboard/i })).toBeNull();
    expect(screen.queryByRole('img', { name: /dartboard/i })).toBeNull();
    // It turns, so it carries no numbers: they would go round upside down.
    expect(board.querySelectorAll('text')).toHaveLength(0);
  });

  it('gives the action that starts play the board button', () => {
    render(<Landing />);
    const play = screen.getByRole('button', { name: /play darts/i });
    expect(play.className).toContain('board-btn');
    expect(screen.getByRole('button', { name: /statistics/i }).className).not.toContain('board-btn');
  });

  it('moves the board button to the lobby when there is a session', () => {
    useMatchStore.setState({ session: 'solo' });
    render(<Landing />);
    expect(screen.getByRole('button', { name: /back to the lobby/i }).className).toContain('board-btn');
    expect(screen.getByRole('button', { name: /play darts/i }).className).not.toContain('board-btn');
  });
});
