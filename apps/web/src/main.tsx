import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import './styles/global.css';

if (import.meta.env.DEV) {
  // Pairing is the one feature that cannot be exercised from a unit test: it
  // needs two real peer connections and a camera. Exposing it on the dev build
  // lets an automated browser run the whole handshake end to end. Not shipped.
  void Promise.all([import('./pairing/session.js'), import('./pairing/payload.js')]).then(
    ([session, payload]) => {
      (window as unknown as { __ochePairing?: unknown }).__ochePairing = {
        PairingConnection: session.PairingConnection,
        compactSdp: payload.compactSdp,
      };
    },
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('no #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
