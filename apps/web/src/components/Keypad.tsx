/**
 * Keypad entry, for when tapping the board is not wanted — a dart recorded this
 * way has a score but no position, and the statistics layer knows the
 * difference.
 */

import { BULL, MISS, OUTER_BULL, hit, type Hit } from '@oche/core';
import { useState } from 'react';

import { useStrings } from '../i18n/index.js';

export interface KeypadProps {
  onHit: (hit: Hit) => void;
  disabled?: boolean;
}

type Multiplier = 'single' | 'double' | 'treble';

const SECTOR_ORDER = [20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

export function Keypad({ onHit, disabled = false }: KeypadProps) {
  const t = useStrings();
  const [multiplier, setMultiplier] = useState<Multiplier>('single');

  const send = (h: Hit) => {
    onHit(h);
    setMultiplier('single');
  };

  return (
    <div className="keypad">
      <div className="keypad-multipliers">
        {(['single', 'double', 'treble'] as Multiplier[]).map((m) => (
          <button
            key={m}
            type="button"
            className={`chip${multiplier === m ? ' chip-on' : ''}`}
            onClick={() => setMultiplier(m)}
            disabled={disabled}
          >
            {m === 'single' ? t.game.single : m === 'double' ? t.game.double : t.game.treble}
          </button>
        ))}
      </div>

      <div className="keypad-grid">
        {SECTOR_ORDER.map((sector) => (
          <button
            key={sector}
            type="button"
            className={`key key-${multiplier}`}
            onClick={() => send(hit(sector, multiplier))}
            disabled={disabled}
          >
            {sector}
          </button>
        ))}
      </div>

      <div className="keypad-specials">
        <button type="button" className="key key-wide" onClick={() => send(OUTER_BULL)} disabled={disabled}>
          {t.game.outerBull}
        </button>
        <button type="button" className="key key-wide" onClick={() => send(BULL)} disabled={disabled}>
          {t.game.bull}
        </button>
        <button type="button" className="key key-wide key-miss" onClick={() => send(MISS)} disabled={disabled}>
          {t.game.miss}
        </button>
      </div>
    </div>
  );
}
