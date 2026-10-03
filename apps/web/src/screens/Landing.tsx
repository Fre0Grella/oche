import { Dartboard } from '../components/Dartboard.js';
import { useStrings } from '../i18n/index.js';
import { useMatchStore } from '../store/match.js';

export function Landing() {
  const t = useStrings();
  const setScreen = useMatchStore((s) => s.setScreen);
  const match = useMatchStore((s) => s.match);
  const session = useMatchStore((s) => s.session);
  const inProgress = match !== null && !match.finished && match.events.length > 0;

  return (
    <div className="landing-wrap">
      {/* The board the app scores on, huge and faint behind the page, turning
          once every three minutes. Decoration only. */}
      <div className="landing-backdrop" aria-hidden="true">
        <div className="landing-backdrop-board">
          <Dartboard decorative />
        </div>
      </div>
      <div className="screen screen-landing">
        <header className="landing-hero">
          <h1 className="landing-mark">{t.app.name}</h1>
          <p className="landing-lede">{t.landing.lede}</p>
        </header>

        <div className="landing-cta">
          {session && (
            <button type="button" className="primary board-btn" onClick={() => setScreen('lobby')}>
              {t.lobby.back}
            </button>
          )}
          {inProgress && (
            <button type="button" className={session ? 'chip' : 'primary board-btn'} onClick={() => setScreen('game')}>
              {t.landing.resume}
            </button>
          )}
          <button
            type="button"
            className={inProgress || session ? 'chip' : 'primary board-btn'}
            onClick={() => setScreen('mode')}
          >
            {t.landing.cta}
          </button>
          <button type="button" className="chip" onClick={() => setScreen('stats')}>
            {t.stats.title}
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
          <a href="https://github.com/Fre0Grella/treblewise" target="_blank" rel="noreferrer">
            {t.landing.source}
          </a>
        </footer>
      </div>
    </div>
  );
}
