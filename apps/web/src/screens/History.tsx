import { matchStats, reduceMatch } from '@oche/core';

import { useStrings } from '../i18n/index.js';
import { useMatchStore } from '../store/match.js';

export function History() {
  const t = useStrings();
  const history = useMatchStore((s) => s.history);
  const resume = useMatchStore((s) => s.resumeMatch);
  const remove = useMatchStore((s) => s.removeMatch);
  const setScreen = useMatchStore((s) => s.setScreen);

  return (
    <div className="screen screen-history">
      <header className="screen-head">
        <h1>{t.history.title}</h1>
      </header>

      {history.length === 0 && <p className="hint">{t.history.empty}</p>}

      <ul className="match-list">
        {history.map((match) => {
          const snapshot = reduceMatch(match.config, match.events);
          const stats = matchStats(snapshot);
          const winner = snapshot.config.players.find((p) => p.id === snapshot.winnerId);

          return (
            <li key={match.id} className="match-row">
              <div>
                <div className="match-title">
                  {match.config.startScore} · {match.config.players.map((p) => p.name).join(' v ')}
                </div>
                <div className="match-meta">
                  {new Date(match.createdAt).toLocaleString()} ·{' '}
                  {match.finished ? t.history.finished : t.history.inProgress}
                  {winner ? ` · ${winner.name}` : ''}
                </div>
                <div className="match-meta">
                  {match.config.players.map((p) => (
                    <span key={p.id}>
                      {p.name} {stats[p.id]!.average.toFixed(1)}
                      {'  '}
                    </span>
                  ))}
                </div>
              </div>
              <div className="match-actions">
                {!match.finished && (
                  <button type="button" className="chip" onClick={() => void resume(match.id)}>
                    {t.history.resume}
                  </button>
                )}
                <button type="button" className="chip" onClick={() => void remove(match.id)}>
                  {t.history.delete}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="screen-actions">
        <button type="button" className="chip" onClick={() => setScreen('setup')}>
          {t.history.back}
        </button>
      </div>
    </div>
  );
}
