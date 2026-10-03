/**
 * Explanatory text that can be folded away once it has been read. Open until
 * someone closes it; this browser then remembers it closed, so a laptop that
 * needs the room keeps it.
 */

import { useState, type ReactNode } from 'react';

const KEY = 'treblewise.fold.';

function remembered(id: string): boolean {
  try {
    return localStorage.getItem(KEY + id) !== 'closed';
  } catch {
    return true;
  }
}

export function Fold({ id, summary, children }: { id: string; summary: string; children: ReactNode }) {
  const [open, setOpen] = useState(() => remembered(id));
  return (
    <details
      className="fold"
      open={open}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        setOpen(next);
        try {
          if (next) localStorage.removeItem(KEY + id);
          else localStorage.setItem(KEY + id, 'closed');
        } catch {
          // Private mode or storage switched off: it just opens again next time.
        }
      }}
    >
      <summary>{summary}</summary>
      {children}
    </details>
  );
}
