/**
 * A single number, big, with what it is and how much it is worth trusting.
 *
 * Every statistic on the page carries its sample size, because "100%" from two
 * darts and "38%" from four hundred are different kinds of fact and should not
 * look the same.
 */

export interface StatTileProps {
  label: string;
  value: string;
  /** Sample size, or whatever qualifies the number. */
  note?: string;
  /** Smaller tile, for the second rank of numbers. */
  small?: boolean;
  /** Explains a contested definition, shown on hover and long-press. */
  title?: string;
}

export function StatTile({ label, value, note, small = false, title }: StatTileProps) {
  return (
    <div className={`tile${small ? ' tile-small' : ''}`} title={title}>
      <span className="tile-label">{label}</span>
      <span className="tile-value">{value}</span>
      {note && <span className="tile-note">{note}</span>}
    </div>
  );
}
