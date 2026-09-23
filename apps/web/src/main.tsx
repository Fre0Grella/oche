import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import './styles/global.css';

if (import.meta.env.DEV) {
  // Pairing is the one feature that cannot be exercised from a unit test: it
  // needs two real peer connections and a camera. Exposing it on the dev build
  // lets an automated browser run the whole handshake end to end. Not shipped.
  void Promise.all([
    import('./pairing/session.js'),
    import('./pairing/payload.js'),
    import('@oche/core'),
    import('./store/match.js'),
  ]).then(([session, payload, core, store]) => {
    const dev = window as unknown as { __oche?: unknown };
    dev.__oche = {
      PairingConnection: session.PairingConnection,
      compactSdp: payload.compactSdp,
      core,
      store: store.useMatchStore,
    };
  });
}

const root = document.getElementById('root');
if (!root) throw new Error('no #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
