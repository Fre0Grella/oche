import type { InOutRule, PlayerConfig, X01Config } from '@oche/core';
import { useState } from 'react';

import { useStrings } from '../i18n/index.js';
import { useMatchStore } from '../store/match.js';

const START_SCORES = [301, 401, 501, 701, 1001];
const RULES: InOutRule[] = ['straight', 'double', 'treble', 'master'];

function newPlayer(index: number): PlayerConfig {
  return { id: `p${index}-${Math.random().toString(36).slice(2, 7)}`, name: `Player ${index + 1}` };
}

export function Setup() {
  const t = useStrings();
  const startMatch = useMatchStore((s) => s.startMatch);
  const setScreen = useMatchStore((s) => s.setScreen);
  const hasHistory = useMatchStore((s) => s.history.length > 0);

  const [players, setPlayers] = useState<PlayerConfig[]>([newPlayer(0), newPlayer(1)]);
  const [startScore, setStartScore] = useState(501);
  const [inRule, setInRule] = useState<InOutRule>('straight');
  const [outRule, setOutRule] = useState<InOutRule>('double');
  const [legsPerSet, setLegsPerSet] = useState(3);
  const [setsToWin, setSetsToWin] = useState(1);

  const start = () => {
    // A player's id comes from their name, so the same person's matches add up
    // across weeks. Random per-match ids would make career statistics
    // impossible — every match would look like a different player.
    const used = new Set<string>();
    const identify = (name: string) => {
      const base = name.toLowerCase().replace(/\s+/g, ' ').trim() || 'player';
      let id = base;
      let suffix = 2;
      while (used.has(id)) id = `${base} ${suffix++}`;
      used.add(id);
      return id;
    };

    const config: X01Config = {
      startScore,
      inRule,
      outRule,
      legsPerSet,
      setsToWin,
      players: players.map((p, index) => {
        const name = p.name.trim() || `Player ${index + 1}`;
        return { id: identify(name), name };
      }),
    };
    startMatch(config);
  };

  return (
    <div className="screen screen-setup">
      <header className="screen-head">
        <h1>{t.app.name}</h1>
        <p>{t.app.tagline}</p>
      </header>

      <section className="panel">
        <h2>{t.setup.players}</h2>
        <ul className="player-list">
          {players.map((player, index) => (
            <li key={player.id}>
              <input
                aria-label={`${t.setup.playerName} ${index + 1}`}
                value={player.name}
                onChange={(e) =>
                  setPlayers((current) =>
                    current.map((p) => (p.id === player.id ? { ...p, name: e.target.value } : p)),
                  )
                }
              />
              {players.length > 1 && (
                <button
                  type="button"
                  className="chip"
                  onClick={() => setPlayers((current) => current.filter((p) => p.id !== player.id))}
                >
                  {t.setup.removePlayer}
                </button>
              )}
            </li>
          ))}
        </ul>
        {players.length < 8 && (
          <button type="button" className="chip" onClick={() => setPlayers((c) => [...c, newPlayer(c.length)])}>
            {t.setup.addPlayer}
          </button>
        )}
      </section>

      <section className="panel">
        <h2>{t.setup.startScore}</h2>
        <div className="chip-row">
          {START_SCORES.map((score) => (
            <button
              key={score}
              type="button"
              className={`chip${startScore === score ? ' chip-on' : ''}`}
              onClick={() => setStartScore(score)}
            >
              {score}
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>{t.setup.inRule}</h2>
        <div className="chip-row">
          {RULES.map((rule) => (
            <button
              key={rule}
              type="button"
              className={`chip${inRule === rule ? ' chip-on' : ''}`}
              onClick={() => setInRule(rule)}
            >
              {t.setup.rules[rule]}
            </button>
          ))}
        </div>

        <h2>{t.setup.outRule}</h2>
        <div className="chip-row">
          {RULES.map((rule) => (
            <button
              key={rule}
              type="button"
              className={`chip${outRule === rule ? ' chip-on' : ''}`}
              onClick={() => setOutRule(rule)}
            >
              {t.setup.rules[rule]}
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="field-row">
          <label>
            {t.setup.legsPerSet}
            <input
              type="number"
              min={1}
              max={21}
              value={legsPerSet}
              onChange={(e) => setLegsPerSet(Math.max(1, Number(e.target.value) || 1))}
            />
          </label>
          <label>
            {t.setup.setsToWin}
            <input
              type="number"
              min={1}
              max={13}
              value={setsToWin}
              onChange={(e) => setSetsToWin(Math.max(1, Number(e.target.value) || 1))}
            />
          </label>
        </div>
      </section>

      <div className="screen-actions">
        <button type="button" className="primary" onClick={start}>
          {t.setup.start}
        </button>
        {hasHistory && (
          <button type="button" className="chip" onClick={() => setScreen('history')}>
            {t.setup.history}
          </button>
        )}
        <button type="button" className="chip" onClick={() => setScreen('stats')}>
          {t.stats.title}
        </button>
        <button type="button" className="chip" onClick={() => setScreen('capture')}>
          {t.capture.title}
        </button>
      </div>
    </div>
  );
}
