import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BoardOverlay } from './BoardOverlay.js';

const W = 400;
const H = 400;

/** Drags from one point to another, in image pixels (the overlay is drawn 1:1 here). */
function drag(svg: SVGSVGElement, from: { x: number; y: number }, to: { x: number; y: number }) {
  svg.dispatchEvent(new MouseEvent('pointerdown', { clientX: from.x, clientY: from.y, bubbles: true }));
  svg.dispatchEvent(new MouseEvent('pointermove', { clientX: to.x, clientY: to.y, bubbles: true }));
  svg.dispatchEvent(new MouseEvent('pointerup', { clientX: to.x, clientY: to.y, bubbles: true }));
}

function overlay(darts: { img: { x: number; y: number }; label: string; kind: 'carried' | 'new' | 'proposed' }[]) {
  const onDartMove = vi.fn();
  const { container } = render(<BoardOverlay width={W} height={H} darts={darts} onDartMove={onDartMove} />);
  const svg = container.querySelector('svg')!;
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: W, height: H, right: W, bottom: H, x: 0, y: 0, toJSON: () => ({}) });
  svg.setPointerCapture = () => undefined;
  return { svg, onDartMove };
}

describe('BoardOverlay', () => {
  it('picks the mark of this photograph over a carried one next to it', () => {
    // The carried dart is the nearer one to the finger, by a little.
    const { svg, onDartMove } = overlay([
      { img: { x: 200, y: 200 }, label: 'T20', kind: 'carried' },
      { img: { x: 210, y: 200 }, label: 'T20?', kind: 'proposed' },
    ]);
    drag(svg, { x: 203, y: 200 }, { x: 214, y: 204 });
    expect(onDartMove.mock.lastCall?.[0]).toBe(1);
  });

  it('still picks a carried mark when it is the only one under the finger', () => {
    const { svg, onDartMove } = overlay([
      { img: { x: 100, y: 100 }, label: 'S5', kind: 'carried' },
      { img: { x: 300, y: 300 }, label: 'T20', kind: 'new' },
    ]);
    drag(svg, { x: 102, y: 101 }, { x: 110, y: 104 });
    expect(onDartMove.mock.lastCall?.[0]).toBe(0);
  });

  it('picks the nearest of two marks of the same kind', () => {
    const { svg, onDartMove } = overlay([
      { img: { x: 200, y: 200 }, label: 'T20', kind: 'new' },
      { img: { x: 212, y: 200 }, label: 'T20', kind: 'new' },
    ]);
    drag(svg, { x: 210, y: 200 }, { x: 220, y: 200 });
    expect(onDartMove.mock.lastCall?.[0]).toBe(1);
  });
});
