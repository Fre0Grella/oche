/**
 * The two ends of pairing, with the radio taken out.
 *
 * A real handshake needs two peer connections, a camera and a network, and it
 * is checked in a browser rather than here. What these tests hold is the part
 * that can go quietly wrong without anybody noticing: that a computer with no
 * camera is offered the written code, that a whole code connects on its own,
 * and that the phone shows a code worth copying.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ANSWER } from '../pairing/__fixtures__/handshake.js';
import { encodeShortCode, formatShortCode, readAnswer } from '../pairing/shortcode.js';

const accepted: string[] = [];
const fakeConnection = {
  state: 'waiting',
  close: vi.fn(),
  accept: vi.fn(async (code: string) => {
    accepted.push(code);
  }),
  send: vi.fn(),
  onStream: null,
  onState: null,
};

const shortCode = encodeShortCode(readAnswer(ANSWER));

vi.mock('../pairing/session.js', () => ({
  PairingConnection: {
    host: vi.fn(async () => ({ connection: fakeConnection, code: 'oche1.h.z.ABC' })),
    join: vi.fn(async () => ({
      connection: fakeConnection,
      code: 'oche1.c.z.DEF',
      shortCode,
    })),
  },
}));

// The scanner owns a camera; here it is a button that produces a code.
vi.mock('../components/QrScanner.js', () => ({
  QrScanner: ({ onCode }: { onCode: (text: string) => void }) => (
    <button type="button" onClick={() => onCode('oche1.c.z.DEF')}>
      pretend to scan
    </button>
  ),
}));

vi.mock('../vision/camera.js', () => ({
  startCamera: vi.fn(async () => ({ getVideoTracks: () => [{}], getTracks: () => [] })),
  stopCamera: vi.fn(),
  keepAwake: vi.fn(async () => null),
}));

// jsdom has no media playback, and its play() returns undefined rather than a
// promise, which is not how any browser behaves.
HTMLMediaElement.prototype.play = async () => undefined;

const { PairHub } = await import('./PairHub.js');
const { CameraRole } = await import('./CameraRole.js');

async function press(name: RegExp) {
  const button = await screen.findByRole('button', { name });
  await act(async () => {
    button.click();
  });
}

describe('the computer half of pairing', () => {
  beforeEach(() => {
    accepted.length = 0;
    vi.clearAllMocks();
  });

  it('offers both ways of reading the phone back', async () => {
    render(<PairHub />);
    await press(/show the pairing code/i);
    await press(/now read the phone/i);

    expect(screen.getByRole('button', { name: /read it with the webcam/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /paste the written code/i })).toBeDefined();
  });

  it('connects as soon as a whole written code is in the box, with no submit button', async () => {
    render(<PairHub />);
    await press(/show the pairing code/i);
    await press(/now read the phone/i);
    await press(/paste the written code/i);

    const box = screen.getByLabelText(/paste the written code/i);

    // Half a code is not a code: nothing is tried, and nothing complains.
    await act(async () => {
      fireEvent.change(box, { target: { value: shortCode.slice(0, 40) } });
    });
    expect(accepted).toEqual([]);

    // The whole thing, as a person would paste it: in groups, lower case.
    const asTyped = formatShortCode(shortCode).toLowerCase();
    await act(async () => {
      fireEvent.change(box, { target: { value: asTyped } });
    });
    await waitFor(() => expect(accepted).toEqual([asTyped]));
  });

  it('counts what has been typed so far', async () => {
    render(<PairHub />);
    await press(/show the pairing code/i);
    await press(/now read the phone/i);
    await press(/paste the written code/i);

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/paste the written code/i), {
        target: { value: 'abcde fghij' },
      });
    });
    expect(screen.getByText(/10 characters/)).toBeDefined();
  });
});

describe('the phone half of pairing', () => {
  beforeEach(() => {
    accepted.length = 0;
    vi.clearAllMocks();
  });

  it('shows a code to copy as well as one to photograph', async () => {
    render(<CameraRole />);
    await press(/pretend to scan/i);

    await waitFor(() => expect(screen.getByText(/no camera on the computer/i)).toBeDefined());
    // Printed in groups, so it can be read off one screen and typed into
    // another. The line breaks are the point, so the text is compared as is.
    expect(document.querySelector('.pair-code')?.textContent).toBe(formatShortCode(shortCode));

    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await press(/copy the code/i);

    expect(writeText).toHaveBeenCalledWith(formatShortCode(shortCode));
    await waitFor(() => expect(screen.getByRole('button', { name: /copied/i })).toBeDefined());
  });
});
