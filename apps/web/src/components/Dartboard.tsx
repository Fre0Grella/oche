/**
 * The board, drawn from the same millimetre geometry the autoscorer uses.
 *
 * Tapping it records where the dart landed, not just what it scored, which is
 * what the positional statistics in `docs/04-stats.md` are built on. The SVG
 * user space *is* board space (millimetres, origin at the bull, y flipped for
 * the screen), so a tap converts to a position with no magic numbers.
 */

import { BOARD, SECTORS, scoreAt, sectorAngle, targetPoint, type Hit, type Point } from '@oche/core';
import { useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react';

const R = BOARD.boardRadius;
const HALF_SECTOR = 9;

const COLOURS = {
  surround: '#141414',
  dark: '#15130f',
  light: '#e5d3a8',
  red: '#c0182f',
  green: '#00713c',
  wire: '#9aa0a6',
  number: '#f2f2f2',
};

const rad = (deg: number) => (deg * Math.PI) / 180;

/** A point in SVG space: board millimetres with the y axis flipped. */
function svgPoint(r: number, deg: number): string {
  return `${(r * Math.cos(rad(deg))).toFixed(2)},${(-r * Math.sin(rad(deg))).toFixed(2)}`;
}

/** The ring segment between two radii and two angles (angles anticlockwise). */
function bed(r1: number, r2: number, from: number, to: number): string {
  return [
    `M ${svgPoint(r2, from)}`,
    `A ${r2} ${r2} 0 0 0 ${svgPoint(r2, to)}`,
    `L ${svgPoint(r1, to)}`,
    `A ${r1} ${r1} 0 0 1 ${svgPoint(r1, from)}`,
    'Z',
  ].join(' ');
}

interface Bed {
  key: string;
  d: string;
  fill: string;
}

function buildBeds(): Bed[] {
  const beds: Bed[] = [];

  SECTORS.forEach((sector, index) => {
    const centre = sectorAngle(sector);
    const from = centre - HALF_SECTOR;
    const to = centre + HALF_SECTOR;
    const isDark = index % 2 === 0;
    const single = isDark ? COLOURS.dark : COLOURS.light;
    const ring = isDark ? COLOURS.red : COLOURS.green;

    beds.push(
      { key: `s-in-${sector}`, d: bed(BOARD.outerBullRadius, BOARD.trebleInnerRadius, from, to), fill: single },
      { key: `t-${sector}`, d: bed(BOARD.trebleInnerRadius, BOARD.trebleOuterRadius, from, to), fill: ring },
      { key: `s-out-${sector}`, d: bed(BOARD.trebleOuterRadius, BOARD.doubleInnerRadius, from, to), fill: single },
      { key: `d-${sector}`, d: bed(BOARD.doubleInnerRadius, BOARD.doubleOuterRadius, from, to), fill: ring },
    );
  });

  return beds;
}

export interface BoardDart {
  id: string;
  hit: Hit;
  pos?: Point;
  /** Dimmed, for darts from earlier visits. */
  past?: boolean;
}

export interface DartboardProps {
  onHit?: (hit: Hit, pos: Point) => void;
  darts?: BoardDart[];
  /** Drawn as a ring, to show where a checkout route says to aim. */
  target?: Hit | null;
  disabled?: boolean;
}

export function Dartboard({ onHit, darts = [], target = null, disabled = false }: DartboardProps) {
  const beds = useMemo(buildBeds, []);
  const numbers = useMemo(
    () =>
      SECTORS.map((sector) => {
        const angle = rad(sectorAngle(sector));
        const r = (BOARD.doubleOuterRadius + BOARD.boardRadius) / 2;
        return {
          sector,
          x: r * Math.cos(angle),
          y: -r * Math.sin(angle),
        };
      }),
    [],
  );

  const svgRef = useRef<SVGSVGElement>(null);

  const handlePointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (disabled || !onHit) return;
    const svg = svgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height);
    if (size === 0) return;

    // The viewBox is square and centred on the bull, so screen → board is a
    // scale and a y flip.
    const originX = rect.left + (rect.width - size) / 2;
    const originY = rect.top + (rect.height - size) / 2;
    const x = ((event.clientX - originX) / size) * 2 * R - R;
    const y = -(((event.clientY - originY) / size) * 2 * R - R);

    const pos = { x, y };
    onHit(scoreAt(pos), pos);
  };

  const targetPos = target && target.ring !== 'miss' ? targetPoint(target) : null;

  return (
    <svg
      ref={svgRef}
      className="dartboard"
      viewBox={`${-R} ${-R} ${2 * R} ${2 * R}`}
      role={onHit ? 'button' : 'img'}
      aria-label="Dartboard"
      onPointerDown={handlePointer}
    >
      <circle cx={0} cy={0} r={R} fill={COLOURS.surround} />
      <g stroke={COLOURS.wire} strokeWidth={0.8}>
        {beds.map((b) => (
          <path key={b.key} d={b.d} fill={b.fill} />
        ))}
        <circle cx={0} cy={0} r={BOARD.outerBullRadius} fill={COLOURS.green} />
        <circle cx={0} cy={0} r={BOARD.bullRadius} fill={COLOURS.red} />
      </g>

      <g fill={COLOURS.number} fontSize={26} fontWeight={600} textAnchor="middle">
        {numbers.map((n) => (
          <text key={n.sector} x={n.x} y={n.y + 9}>
            {n.sector}
          </text>
        ))}
      </g>

      {targetPos && (
        <circle
          className="dartboard-target"
          cx={targetPos.x}
          cy={-targetPos.y}
          r={9}
          fill="none"
          stroke="#ffd166"
          strokeWidth={2.5}
        />
      )}

      {darts.map((dart, index) =>
        dart.pos ? (
          <g key={dart.id} opacity={dart.past ? 0.35 : 1}>
            <circle cx={dart.pos.x} cy={-dart.pos.y} r={7} fill="#0b0b0b" stroke="#ffffff" strokeWidth={2} />
            <text
              x={dart.pos.x}
              y={-dart.pos.y + 4}
              fill="#ffffff"
              fontSize={11}
              fontWeight={700}
              textAnchor="middle"
            >
              {index + 1}
            </text>
          </g>
        ) : null,
      )}
    </svg>
  );
}
