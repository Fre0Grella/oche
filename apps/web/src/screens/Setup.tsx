/**
 * Starting a match: who is playing, and under what rules.
 *
 * Players are **profiles** chosen from a list rather than names typed each
 * time, because a name typed each time is a different player every time as far
 * as the statistics are concerned. A profile's id is fixed when it is made, so
 * renaming one keeps its history.
 *
 * A friend who plays once is a **guest**: scored exactly like anyone else for
 * the length of the match, then gone. Guests are never written to the profile
 * list and never appear in the statistics, so the picker stays short.
 */

import type { InOutRule, PlayerConfig, X01Config } from '@oche/core';
import { useState } from 'react';

import { useStrings } from '../i18n/index.js';
import { useMatchStore } from '../store/match.js';

const START_SCORES = [301, 401, 501, 701, 1001];
const RULES: InOutRule[] = ['straight', 'double', 'treble', 'master'];
const MAX_PLAYERS = 8;

export function Setup() {
  const t = useStrings();
  const startMatch = useMatchStore((s) => s.startMatch);
  const setScreen = useMatchStore((s) => s.setScreen);
  const hasHistory = useMatchStore((s) => s.history.length > 0);
  const profiles = useMatchStore((s) => s.profiles);
  const createProfile = useMatchStore((s) => s.createProfile);
  const renameProfile = useMatchStore((s) => s.renameProfile);
  const removeProfile = useMatchStore((s) => s.removeProfile);

  /** Who is throwing, in order. Profiles and guests look the same here. */
  const [lineup, setLineup] = useState<PlayerConfig[]>([]);
  const [adding, setAdding] = useState<'profile' | 'guest' | null>(null);
  const [draftName, setDraftName] = useState('');
  const [managing, setManaging] = useState(false);

  const [startScore, setStartScore] = useState(501);
  const [inRule, setInRule] = useState<InOutRule>('straight');
  const [outRule, setOutRule] = useState<InOutRule>('double');
  const [legsPerSet, setLegsPerSet] = useState(3);
  const [setsToWin, setSetsToWin] = useState(1);

  const inLineup = (id: string) => lineup.some((player) => player.id === id);

  const addProfile = (id: string, name: string) => {
    if (inLineup(id) || lineup.length >= MAX_PLAYERS) return;
    setLineup((current) => [...current, { id, name }]);
  };

  const addGuest = (name: string) => {
    if (lineup.length >= MAX_PLAYERS) return;
    // A guest gets an id of their own, so two guests in one match stay apart,
    // and it is never written to the profile list.
    const id = `guest-${Math.random().toString(36).slice(2, 8)}`;
    setLineup((current) => [...current, { id, name: name.trim() || t.setup.guest, temporary: true }]);
  };

  const submitDraft = async () => {
    if (adding === 'profile') {
      const profile = await createProfile(draftName);
      addProfile(profile.id, profile.name);
    } else if (adding === 'guest') {
      addGuest(draftName);
    }
    setDraftName('');
    setAdding(null);
  };

  const start = () => {
    // Playing alone without making a profile first is allowed: it is a guest.
    const players =
      lineup.length > 0 ? lineup : [{ id: 'guest-solo', name: t.setup.guest, temporary: true }];
    const config: X01Config = { startScore, inRule, outRule, legsPerSet, setsToWin, players };
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

        {lineup.length === 0 ? (
          <p className="hint">{t.setup.noPlayers}</p>
        ) : (
          <ol className="lineup">
            {lineup.map((player, index) => (
              <li key={player.id}>
                <span className="lineup-order">{index + 1}</span>
                <span className="lineup-name">
                  {player.name}
                  {player.temporary && <small>{t.setup.guestTag}</small>}
                </span>
                <button
                  type="button"
                  className="chip"
                  aria-label={`${t.setup.removePlayer} ${player.name}`}
                  onClick={() => setLineup((current) => current.filter((p) => p.id !== player.id))}
                >
                  ✕
                </button>
              </li>
            ))}
          </ol>
        )}

        <div className="chip-row">
          {profiles
            .filter((profile) => !inLineup(profile.id))
            .map((profile) => (
              <button
                key={profile.id}
                type="button"
                className="chip"
                onClick={() => addProfile(profile.id, profile.name)}
              >
                + {profile.name}
              </button>
            ))}
          <button type="button" className="chip" onClick={() => setAdding('profile')}>
            {t.setup.newProfile}
          </button>
          <button type="button" className="chip" onClick={() => setAdding('guest')}>
            {t.setup.addGuest}
          </button>
        </div>

        {adding && (
          <div className="field-row">
            <input
              autoFocus
              aria-label={adding === 'profile' ? t.setup.newProfile : t.setup.addGuest}
              placeholder={adding === 'profile' ? t.setup.namePlaceholder : t.setup.guest}
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submitDraft();
              }}
            />
            <button type="button" className="chip chip-on" onClick={() => void submitDraft()}>
              {adding === 'profile' ? t.setup.createProfile : t.setup.addForSession}
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => {
                setAdding(null);
                setDraftName('');
              }}
            >
              {t.setup.cancel}
            </button>
          </div>
        )}

        <p className="hint">{adding === 'guest' ? t.setup.guestHelp : t.setup.profileHelp}</p>

        {profiles.length > 0 && (
          <>
            <button type="button" className="chip" onClick={() => setManaging((on) => !on)}>
              {managing ? t.setup.doneManaging : t.setup.manageProfiles}
            </button>

            {managing && (
              <>
                <ul className="player-list">
                  {profiles.map((profile) => (
                    <li key={profile.id}>
                      <input
                        aria-label={`${t.setup.playerName} ${profile.name}`}
                        value={profile.name}
                        onChange={(event) => void renameProfile(profile.id, event.target.value)}
                      />
                      <button
                        type="button"
                        className="chip"
                        onClick={() => {
                          void removeProfile(profile.id);
                          setLineup((current) => current.filter((p) => p.id !== profile.id));
                        }}
                      >
                        {t.setup.deleteProfile}
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="hint">{t.setup.manageHelp}</p>
              </>
            )}
          </>
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
