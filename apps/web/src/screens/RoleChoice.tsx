/**
 * Two devices, two jobs: which one is this?
 *
 * Pairing used to hide this behind a small link under the mode chooser, which
 * put the phone's half of the feature somewhere nobody looks. It is a choice of
 * the same size as "one device or two", so it gets the same illustrated cards —
 * the same drawing as the step before, with the end you are holding lit up.
 */

import { PairedModeArt } from '../components/ModeArt.js';
import { useStrings } from '../i18n/index.js';
import { useMatchStore } from '../store/match.js';

export function RoleChoice() {
  const t = useStrings();
  const setScreen = useMatchStore((s) => s.setScreen);
  const setMode = useMatchStore((s) => s.setMode);

  return (
    <div className="screen screen-mode">
      <header className="screen-head">
        <h1>{t.role.title}</h1>
        <p>{t.role.subtitle}</p>
      </header>

      <div className="mode-cards">
        <button
          type="button"
          className="mode-card"
          onClick={() => {
            setMode('paired');
            setScreen('pair');
          }}
        >
          <PairedModeArt focus="computer" />
          <h2>{t.role.computer.title}</h2>
          <p>{t.role.computer.body}</p>
          <ul>
            {t.role.computer.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          <span className="mode-go">{t.role.computer.action}</span>
        </button>

        <button
          type="button"
          className="mode-card"
          // The phone never becomes the scoreboard: it is a camera with a
          // dimmed screen, so it does not take the match's mode with it.
          onClick={() => setScreen('camera')}
        >
          <PairedModeArt focus="phone" />
          <h2>{t.role.phone.title}</h2>
          <p>{t.role.phone.body}</p>
          <ul>
            {t.role.phone.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          <span className="mode-go">{t.role.phone.action}</span>
        </button>
      </div>

      <div className="screen-actions">
        <button type="button" className="chip" onClick={() => setScreen('mode')}>
          {t.role.back}
        </button>
      </div>
    </div>
  );
}
