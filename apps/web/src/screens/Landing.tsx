import { useStrings } from '../i18n/index.js';
import { useMatchStore } from '../store/match.js';

export function Landing() {
  const t = useStrings();
  const setScreen = useMatchStore((s) => s.setScreen);
  const match = useMatchStore((s) => s.match);
  const inProgress = match !== null && !match.finished && match.events.length > 0;

  return (
    <div className="screen screen-landing">
      <header className="landing-hero">
        <h1 className="landing-mark">{t.app.name}</h1>
        <p className="landing-lede">{t.landing.lede}</p>
      </header>

      <div className="landing-cta">
        {inProgress && (
          <button type="button" className="primary" onClick={() => setScreen('game')}>
            {t.landing.resume}
          </button>
        )}
        <button
          type="button"
          className={inProgress ? 'chip' : 'primary'}
          onClick={() => setScreen('mode')}
        >
          {t.landing.cta}
        </button>
      </div>

      <ul className="landing-points">
        {t.landing.points.map((point) => (
          <li key={point.title}>
            <b>{point.title}</b>
            <span>{point.body}</span>
          </li>
        ))}
      </ul>

      <section className="panel landing-honest">
        <h2>{t.landing.statusTitle}</h2>
        <p>{t.landing.status}</p>
      </section>

      <footer className="landing-foot">
        <span>{t.landing.foot}</span>
        <a href="https://github.com/Fre0Grella/oche" target="_blank" rel="noreferrer">
          {t.landing.source}
        </a>
      </footer>
    </div>
  );
}
