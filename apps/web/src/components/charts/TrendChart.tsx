/**
 * One line: how the three-dart average has moved, session by session.
 *
 * One series, so no legend — the heading names it. Labels go on the points
 * worth naming (the best and the latest) rather than on all of them, and the
 * grid is recessive enough to read past.
 */

import { useId } from 'react';

export interface TrendPoint {
  label: string;
  value: number;
  /** Shown under the point when it is labelled. */
  note?: string;
}

export interface TrendChartProps {
  points: TrendPoint[];
  /** Drawn as a dashed line across the chart, e.g. the career average. */
  reference?: { value: number; label: string } | null;
  unit?: string;
}

const W = 320;
const H = 130;
const PAD = { left: 30, right: 12, top: 12, bottom: 20 };

export function TrendChart({ points, reference = null, unit = '' }: TrendChartProps) {
  const uid = useId().replace(/:/g, '');

  if (points.length === 0) return null;

  const values = points.map((point) => point.value);
  const max = Math.max(...values, reference?.value ?? 0) * 1.08 || 1;
  const min = 0;

  const x = (index: number) =>
    points.length === 1
      ? PAD.left + (W - PAD.left - PAD.right) / 2
      : PAD.left + (index / (points.length - 1)) * (W - PAD.left - PAD.right);
  const y = (value: number) => H - PAD.bottom - ((value - min) / (max - min)) * (H - PAD.top - PAD.bottom);

  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index)} ${y(point.value)}`).join(' ');

  const bestIndex = values.indexOf(Math.max(...values));
  const lastIndex = points.length - 1;
  const labelled = new Set([bestIndex, lastIndex]);

  const ticks = [0, max / 2, max];

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Average by session">
      <defs>
        <linearGradient id={`fill-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.22} />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
        </linearGradient>
      </defs>

      <g className="chart-grid">
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={PAD.left} y1={y(tick)} x2={W - PAD.right} y2={y(tick)} />
            <text x={PAD.left - 6} y={y(tick) + 3} textAnchor="end">
              {Math.round(tick)}
            </text>
          </g>
        ))}
      </g>

      {reference && (
        <g className="chart-reference">
          <line x1={PAD.left} y1={y(reference.value)} x2={W - PAD.right} y2={y(reference.value)} />
          <text x={W - PAD.right} y={y(reference.value) - 4} textAnchor="end">
            {reference.label}
          </text>
        </g>
      )}

      <path d={`${path} L${x(lastIndex)} ${H - PAD.bottom} L${x(0)} ${H - PAD.bottom} Z`} fill={`url(#fill-${uid})`} />
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

      {points.map((point, index) =>
        labelled.has(index) ? (
          <g key={point.label}>
            <circle cx={x(index)} cy={y(point.value)} r={4.5} fill="var(--bg)" stroke="var(--accent)" strokeWidth={2} />
            <text className="chart-point-label" x={x(index)} y={y(point.value) - 9} textAnchor="middle">
              {point.value.toFixed(1)}
              {unit}
            </text>
          </g>
        ) : (
          <circle key={point.label} cx={x(index)} cy={y(point.value)} r={2} fill="var(--accent)" opacity={0.65} />
        ),
      )}

      <text className="chart-axis-label" x={PAD.left} y={H - 6}>
        {points[0]!.label}
      </text>
      {points.length > 1 && (
        <text className="chart-axis-label" x={W - PAD.right} y={H - 6} textAnchor="end">
          {points[lastIndex]!.label}
        </text>
      )}
    </svg>
  );
}
