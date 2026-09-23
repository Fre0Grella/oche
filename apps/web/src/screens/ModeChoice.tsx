import { PairedModeArt, SoloModeArt } from '../components/ModeArt.js';
import { useStrings } from '../i18n/index.js';
import { useMatchStore } from '../store/match.js';

export function ModeChoice() {
  const t = useStrings();
  const setScreen = useMatchStore((s) => s.setScreen);
  const setMode = useMatchStore((s) => s.setMode);

  const choose = (mode: 'solo' | 'paired') => {
    setMode(mode);
    // Two devices means one more question — which one is this? — and it is
    // asked on its own screen, with pictures, rather than in a link nobody sees.
    setScreen(mode === 'solo' ? 'setup' : 'pairRole');
  };

  return (
    <div className="screen screen-mode">
      <header className="screen-head">
        <h1>{t.mode.title}</h1>
        <p>{t.mode.subtitle}</p>
      </header>

      <div className="mode-cards">
        <button type="button" className="mode-card" onClick={() => choose('solo')}>
          <SoloModeArt />
          <h2>{t.mode.solo.title}</h2>
          <p>{t.mode.solo.body}</p>
          <ul>
            {t.mode.solo.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          <span className="mode-go">{t.mode.solo.action}</span>
        </button>

        <button type="button" className="mode-card" onClick={() => choose('paired')}>
          <PairedModeArt />
          <h2>{t.mode.paired.title}</h2>
          <p>{t.mode.paired.body}</p>
          <ul>
            {t.mode.paired.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          <span className="mode-go">{t.mode.paired.action}</span>
        </button>
      </div>

      <div className="screen-actions">
        <button type="button" className="chip" onClick={() => setScreen('landing')}>
          {t.mode.back}
        </button>
      </div>
    </div>
  );
}
