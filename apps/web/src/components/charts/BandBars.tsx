/**
 * How often a visit lands in each band — the shape of a player's scoring, which
 * an average alone hides: two players averaging 60 can be a metronome or a
 * 180-and-nothing.
 *
 * Horizontal bars because the labels are words, and direct labels because there
 * are seven of them and a hover tooltip on a phone is a fiction.
 */

export interface Band {
  label: string;
  count: number;
  /** Highlighted: the bands worth being proud of. */
  strong?: boolean;
}

export interface BandBarsProps {
  bands: Band[];
  total: number;
}

export function BandBars({ bands, total }: BandBarsProps) {
  const peak = Math.max(1, ...bands.map((band) => band.count));

  return (
    <ul className="bars">
      {bands.map((band) => {
        const share = total === 0 ? 0 : (band.count / total) * 100;
        return (
          <li key={band.label}>
            <span className="bars-label">{band.label}</span>
            <span className="bars-track">
              <span
                className={`bars-fill${band.strong ? ' bars-fill-strong' : ''}`}
                style={{ width: `${(band.count / peak) * 100}%` }}
              />
            </span>
            <span className="bars-value">
              {band.count}
              <small>{share.toFixed(0)}%</small>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
