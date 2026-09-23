/**
 * The statistics page.
 *
 * Two halves, as `docs/04-stats.md` sets out. The classical numbers work from
 * scores alone, so they are there from the first leg. The positional ones need
 * to know where each dart landed — heatmap, grouping, and the aiming map that
 * is the reason this project stores coordinates at all.
 *
 * Every number carries its sample size, and every contested definition says
 * what it means next to itself rather than in a help page nobody opens.
 */

import {
  BOARD,
  careerStats,
  densityGrid,
  estimateSpread,
  expectedScoreMap,
  formatHit,
  hit as makeHit,
  positionedDarts,
  reduceMatch,
  scoreAt,
  sectorAngle,
  sectorAtAngle,
  sectorSplit,
  targetPoint,
  type MatchSnapshot,
  type PositionedDart,
} from '@oche/core';
import { useEffect, useMemo, useState } from 'react';

import { BandBars } from '../components/charts/BandBars.js';
import { BoardMap, rampStops } from '../components/charts/BoardMap.js';
import { StatTile } from '../components/charts/StatTile.js';
import { TrendChart } from '../components/charts/TrendChart.js';
import { fill, useStrings } from '../i18n/index.js';
import { useMatchStore } from '../store/match.js';

type Range = 'session' | 'month' | 'all';

/** Darts needed before the spread is worth estimating, per the paper: ~50. */
const AIM_MAP_MINIMUM = 50;

function lastDartAt(snapshot: MatchSnapshot): number {
  let latest = 0;
  for (const leg of snapshot.legs) {
    for (const visit of leg.visits) {
      for (const dart of visit.darts) latest = Math.max(latest, dart.ts);
    }
  }
  return latest;
}

function number(value: number, digits = 1): string {
  return value.toFixed(digits);
}

export function Stats() {
  const t = useStrings();
  const setScreen = useMatchStore((s) => s.setScreen);
  const history = useMatchStore((s) => s.history);
  const refreshHistory = useMatchStore((s) => s.refreshHistory);
  const profiles = useMatchStore((s) => s.profiles);

  const [playerId, setPlayerId] = useState<string | null>(null);
  const [range, setRange] = useState<Range>('all');

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  const snapshots = useMemo(
    () => history.map((match) => reduceMatch(match.config, match.events)),
    [history],
  );

  const players = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; darts: number }>();
    for (const snapshot of snapshots) {
      for (const player of snapshot.config.players) {
        // Guests are scored like anyone else and then forgotten: they are here
        // to play, not to be measured, and they would fill this list up.
        if (player.temporary) continue;
        // The profile's current name wins over the one stored with the match:
        // a rename is meant to be visible everywhere, not only from now on.
        const name = profiles.find((profile) => profile.id === player.id)?.name ?? player.name;
        const entry = seen.get(player.id) ?? { id: player.id, name, darts: 0 };
        entry.name = name;
        entry.darts += snapshot.legs.reduce((sum, leg) => sum + (leg.dartsThrown[player.id] ?? 0), 0);
        seen.set(player.id, entry);
      }
    }
    return [...seen.values()].sort((a, b) => b.darts - a.darts);
  }, [snapshots, profiles]);

  const active = playerId ?? players[0]?.id ?? null;

  const inRange = useMemo(() => {
    if (range === 'all') return snapshots;
    const now = Date.now();
    const cutoff = range === 'month' ? now - 30 * 24 * 3600_000 : now - 12 * 3600_000;
    return snapshots.filter((snapshot) => lastDartAt(snapshot) >= cutoff);
  }, [snapshots, range]);

  const career = useMemo(
    () => (active ? careerStats(inRange, active) : null),
    [inRange, active],
  );

  const darts: PositionedDart[] = useMemo(
    () => (active ? positionedDarts(inRange, { playerId: active }) : []),
    [inRange, active],
  );

  const density = useMemo(() => densityGrid(darts.map((dart) => dart.pos), 4, 180, 9), [darts]);

  const spread = useMemo(() => estimateSpread(darts), [darts]);

  /** The busiest sector, which is what the player was going at. */
  const busiestSector = useMemo(() => {
    const counts = new Map<number, number>();
    for (const dart of darts) {
      if (dart.atFinish) continue;
      const sector = sectorAtAngle((Math.atan2(dart.pos.y, dart.pos.x) * 180) / Math.PI);
      counts.set(sector, (counts.get(sector) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 20;
  }, [darts]);

  const split = useMemo(
    () => sectorSplit(darts.filter((dart) => !dart.atFinish), busiestSector),
    [darts, busiestSector],
  );

  const aim = useMemo(() => {
    if (!spread || darts.length < AIM_MAP_MINIMUM) return null;
    // One symmetric spread rather than pretending to know how the group's own
    // axes line up with the board's.
    const sigma = Math.sqrt(Math.max(spread.along, 1) * Math.max(spread.across, 1));
    return expectedScoreMap(sigma, sigma, 4);
  }, [spread, darts.length]);

  if (players.length === 0 || !career || !active) {
    return (
      <div className="screen screen-stats">
        <header className="screen-head">
          <h1>{t.stats.title}</h1>
          <p>{t.stats.empty}</p>
        </header>
        <div className="screen-actions">
          <button type="button" className="chip" onClick={() => setScreen('landing')}>
            {t.stats.back}
          </button>
        </div>
      </div>
    );
  }

  const bestDouble = [...career.doubles]
    .filter((entry) => entry.attempts >= 5)
    .sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0))[0];
  const worstDouble = [...career.doubles]
    .filter((entry) => entry.attempts >= 5)
    .sort((a, b) => (a.percent ?? 0) - (b.percent ?? 0))[0];

  const doubleName = (target: number) => (target === 25 ? t.stats.bull : `D${target}`);
  const tapped = darts.filter((dart) => dart.source === 'manual').length;
  const aimTarget = aim ? scoreAt(aim.best.point) : null;
  const t20Point = targetPoint(makeHit(20, 'treble'));
  // Within a bed's width of the treble 20 is the treble 20.
  const aimIsTrebleTwenty =
    aim !== null && Math.hypot(aim.best.point.x - t20Point.x, aim.best.point.y - t20Point.y) < 15;
  const aimPeak = aim ? Math.max(...aim.values) : 0;

  return (
    <div className="screen screen-stats">
      <header className="screen-head">
        <h1>{t.stats.title}</h1>
        <p>
          {fill(t.stats.subtitle, {
            matches: career.matches,
            darts: career.dartsThrown,
          })}
        </p>
      </header>

      <div className="chip-row">
        {players.map((player) => (
          <button
            key={player.id}
            type="button"
            className={`chip${player.id === active ? ' chip-on' : ''}`}
            onClick={() => setPlayerId(player.id)}
          >
            {player.name}
          </button>
        ))}
      </div>

      <div className="chip-row">
        {(['session', 'month', 'all'] as Range[]).map((option) => (
          <button
            key={option}
            type="button"
            className={`chip${range === option ? ' chip-on' : ''}`}
            onClick={() => setRange(option)}
          >
            {t.stats.ranges[option]}
          </button>
        ))}
      </div>

      {career.dartsThrown === 0 ? (
        <p className="hint">{t.stats.nothingInRange}</p>
      ) : (
        <>
          <section className="panel">
            <h2>{t.stats.scoring}</h2>
            <div className="tiles">
              <StatTile
                label={t.stats.average}
                value={number(career.average)}
                note={fill(t.stats.fromDarts, { n: career.dartsThrown })}
                title={t.stats.averageNote}
              />
              <StatTile
                label={t.stats.first9}
                value={number(career.first9Average)}
                note={fill(t.stats.fromLegs, { n: career.legs })}
                title={t.stats.first9Note}
              />
              <StatTile
                label={t.stats.checkout}
                value={career.checkoutPercent === null ? '—' : `${number(career.checkoutPercent, 0)}%`}
                note={fill(t.stats.ofAttempts, { hits: career.checkoutHits, n: career.checkoutAttempts })}
                title={t.stats.checkoutNote}
              />
              <StatTile
                label={t.stats.dartsPerLeg}
                value={career.dartsPerLegWon === null ? '—' : number(career.dartsPerLegWon)}
                note={fill(t.stats.legsWon, { n: career.legsWon })}
                title={t.stats.dartsPerLegNote}
              />
            </div>

            <div className="tiles">
              <StatTile small label={t.stats.bestLeg} value={career.bestLegDarts === null ? '—' : `${career.bestLegDarts}`} />
              <StatTile small label={t.stats.highestOut} value={career.highestCheckout === 0 ? '—' : `${career.highestCheckout}`} />
              <StatTile small label="180s" value={`${career.oneEighties}`} />
              <StatTile small label={t.stats.tons} value={`${career.tons}`} />
              <StatTile small label={t.stats.bestVisit} value={`${career.bestVisit}`} />
              <StatTile small label={t.stats.busts} value={`${career.busts}`} />
            </div>
          </section>

          {career.sessions.length >= 2 && (
            <section className="panel">
              <h2>{t.stats.form}</h2>
              <TrendChart
                points={career.sessions.map((session) => ({
                  label: session.day.slice(5),
                  value: session.average,
                }))}
                reference={{ value: career.average, label: t.stats.careerAverage }}
              />
              <p className="hint">{fill(t.stats.formNote, { n: career.sessions.length })}</p>
            </section>
          )}

          <section className="panel">
            <h2>{t.stats.shape}</h2>
            <BandBars
              bands={career.bands.map((band) => ({
                label: band.label,
                count: band.count,
                strong: band.from >= 100,
              }))}
              total={career.visits}
            />
          </section>

          <section className="panel">
            <h2>{t.stats.doubles}</h2>
            {career.doubles.length === 0 ? (
              <p className="hint">{t.stats.noDoubles}</p>
            ) : (
              <>
                {bestDouble && worstDouble && bestDouble !== worstDouble && (
                  <p className="hint">
                    {fill(t.stats.doublesSummary, {
                      best: doubleName(bestDouble.target),
                      bestPercent: number(bestDouble.percent ?? 0, 0),
                      worst: doubleName(worstDouble.target),
                      worstPercent: number(worstDouble.percent ?? 0, 0),
                    })}
                  </p>
                )}
                <ul className="bars">
                  {career.doubles.slice(0, 10).map((entry) => (
                    <li key={entry.target}>
                      <span className="bars-label">{doubleName(entry.target)}</span>
                      <span className="bars-track">
                        <span className="bars-fill" style={{ width: `${entry.percent ?? 0}%` }} />
                      </span>
                      <span className="bars-value">
                        {entry.percent === null ? '—' : `${number(entry.percent, 0)}%`}
                        <small>
                          {entry.hits}/{entry.attempts}
                        </small>
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="hint">{t.stats.doublesNote}</p>
              </>
            )}
          </section>

          {darts.length > 0 && (
            <section className="panel">
              <h2>{t.stats.where}</h2>
              <BoardMap grid={density} label={t.stats.whereLabel} />
              <div className="legend">
                <span>{t.stats.fewer}</span>
                <span className="legend-ramp" style={{ background: `linear-gradient(90deg, ${rampStops()})` }} />
                <span>{t.stats.more}</span>
              </div>

              {spread && (
                <p className="stat-sentence">
                  {fill(t.stats.groupSentence, {
                    along: number(spread.along, 0),
                    across: number(spread.across, 0),
                    n: spread.count,
                  })}
                </p>
              )}

              {split.total >= 10 && (
                <>
                  <h2>{fill(t.stats.goingAt, { sector: split.sector })}</h2>
                  <BandBars
                    bands={[
                      { label: `T${split.sector}`, count: split.treble, strong: true },
                      { label: `S${split.sector}`, count: split.single },
                      { label: `D${split.sector}`, count: split.double },
                      { label: `${split.clockwise.sector}`, count: split.clockwise.count },
                      { label: `${split.anticlockwise.sector}`, count: split.anticlockwise.count },
                      { label: t.stats.offBoard, count: split.off },
                    ]}
                    total={split.total}
                  />
                </>
              )}

              {tapped > 0 && <p className="hint">{fill(t.stats.tappedNote, { n: tapped })}</p>}
            </section>
          )}

          <section className="panel">
            <h2>{t.stats.aim}</h2>
            {aim && aimTarget ? (
              <>
                <BoardMap
                  grid={aim}
                  floor={0.02}
                  label={t.stats.aimLabel}
                  markers={[
                    { point: aim.best.point, label: formatHit(aimTarget), kind: 'best' },
                    ...(aimIsTrebleTwenty ? [] : [{ point: t20Point, label: 'T20', kind: 'plain' as const }]),
                  ]}
                />
                <div className="legend">
                  <span>0</span>
                  <span className="legend-ramp" style={{ background: `linear-gradient(90deg, ${rampStops()})` }} />
                  <span>{fill(t.stats.perDart, { max: number(aimPeak) })}</span>
                </div>
                <p className="stat-sentence">
                  {aimIsTrebleTwenty
                    ? fill(t.stats.aimSentenceSame, {
                        expected: number(aim.best.expected),
                        average: number(aim.best.expected * 3),
                      })
                    : fill(t.stats.aimSentenceOther, {
                        target: formatHit(aimTarget),
                        expected: number(aim.best.expected),
                        treble: number(aim.trebleTwenty),
                        gain: number(aim.best.expected - aim.trebleTwenty),
                        perThree: number((aim.best.expected - aim.trebleTwenty) * 3),
                      })}
                </p>
                <p className="hint">{t.stats.aimNote}</p>
              </>
            ) : (
              <p className="hint">
                {fill(t.stats.aimPending, { have: darts.length, need: AIM_MAP_MINIMUM })}
              </p>
            )}
          </section>
        </>
      )}

      <div className="screen-actions">
        <button type="button" className="chip" onClick={() => setScreen('landing')}>
          {t.stats.back}
        </button>
      </div>
    </div>
  );
}

/** Exported for the tests: the board position a sector's treble sits at. */
export function trebleOf(sector: number) {
  const angle = sectorAngle(sector);
  const r = (BOARD.trebleInnerRadius + BOARD.trebleOuterRadius) / 2;
  return { x: r * Math.cos((angle * Math.PI) / 180), y: r * Math.sin((angle * Math.PI) / 180) };
}
