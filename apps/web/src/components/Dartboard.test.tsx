import { BOARD } from '@oche/core';
import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Dartboard, placeLens } from './Dartboard.js';

const R = BOARD.boardRadius;

describe('placeLens', () => {
  it('puts the lens above the finger, where a hand is not', () => {
    const lens = placeLens({ x: 0, y: 0 });
    expect(lens.cy).toBeLessThan(0); // smaller y is higher on screen
    expect(lens.side).toBe('above');
    expect(lens.cx).toBe(0);
  });

  it('goes sideways near the top rather than under the hand', () => {
    // The 20 is at the top of the board, so this is the common case.
    const lens = placeLens({ x: 0, y: -R + 60 });
    expect(lens.side === 'left' || lens.side === 'right' || lens.side === 'above').toBe(true);
    expect(lens.side).not.toBe('below');
  });

  it('picks the side with more room', () => {
    expect(placeLens({ x: 120, y: -R + 60 }).side).toBe('left');
    expect(placeLens({ x: -120, y: -R + 60 }).side).toBe('right');
  });

  it('never lets the lens leave the board frame', () => {
    for (const point of [
      { x: -R, y: -R },
      { x: R, y: R },
      { x: R, y: -R },
      { x: 0, y: R },
    ]) {
      const lens = placeLens(point);
      expect(Math.abs(lens.cx)).toBeLessThanOrEqual(R);
      expect(Math.abs(lens.cy)).toBeLessThanOrEqual(R);
    }
  });

  it('never covers the point it is magnifying, wherever the finger is', () => {
    for (let x = -R; x <= R; x += 25) {
      for (let y = -R; y <= R; y += 25) {
        const lens = placeLens({ x, y });
        const gap = Math.hypot(lens.cx - x, lens.cy - y);
        expect(gap, `finger at ${x},${y} (${lens.side})`).toBeGreaterThan(58);
      }
    }
  });
});

/** jsdom gives every element a zero-sized box, so the board needs one. */
function sizeTheBoard(element: Element, size = 400) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: size,
    bottom: size,
    width: size,
    height: size,
    toJSON: () => ({}),
  });
}

describe('the board', () => {
  it('shows a magnified lens while a finger is down, and scores on release', async () => {
    const onHit = vi.fn();
    const { container } = render(<Dartboard onHit={onHit} />);

    const svg = screen.getByRole('button', { name: /dartboard/i });
    sizeTheBoard(svg);
    // jsdom has no pointer capture.
    (svg as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};

    expect(container.querySelector('.dartboard-lens')).toBeNull();

    // The centre of a 400 px board is the bull.
    await act(async () => {
      svg.dispatchEvent(
        new MouseEvent('pointerdown', { clientX: 200, clientY: 200, bubbles: true }),
      );
    });

    const lens = container.querySelector('.dartboard-lens');
    expect(lens).not.toBeNull();
    expect(lens!.textContent).toContain('BULL');
    // The lens magnifies: the board is drawn again, scaled.
    expect(lens!.innerHTML).toContain('scale(3.2)');

    await act(async () => {
      svg.dispatchEvent(new MouseEvent('pointerup', { clientX: 200, clientY: 200, bubbles: true }));
    });

    expect(onHit).toHaveBeenCalledTimes(1);
    expect(onHit.mock.calls[0]![0]).toMatchObject({ ring: 'bull', value: 50 });
    expect(container.querySelector('.dartboard-lens')).toBeNull();
  });

  it('does nothing at all when disabled', async () => {
    const onHit = vi.fn();
    const { container } = render(<Dartboard onHit={onHit} disabled />);
    const svg = screen.getByRole('button', { name: /dartboard/i });
    sizeTheBoard(svg);
    (svg as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};

    await act(async () => {
      svg.dispatchEvent(new MouseEvent('pointerdown', { clientX: 200, clientY: 200, bubbles: true }));
      svg.dispatchEvent(new MouseEvent('pointerup', { clientX: 200, clientY: 200, bubbles: true }));
    });

    expect(container.querySelector('.dartboard-lens')).toBeNull();
    expect(onHit).not.toHaveBeenCalled();
  });
});
