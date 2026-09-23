/**
 * The board, drawn from the same millimetre geometry the autoscorer uses.
 *
 * Tapping it records where the dart landed, not just what it scored, which is
 * what the positional statistics in `docs/04-stats.md` are built on. The SVG
 * user space *is* board space (millimetres, origin at the bull, y flipped for
 * the screen), so a tap converts to a position with no magic numbers.
 *
 * Precision on a phone is the whole problem here. A treble bed is 8 mm wide —
 * about six pixels on a phone, and entirely hidden under a fingertip. So the
 * board works like a text cursor on a touchscreen: press, and a magnifying lens
 * appears *offset from the finger* showing the board underneath at three times
 * the size with a crosshair on the exact point; drag to adjust; lift to score.
 */

import {
  BOARD,
  SECTORS,
  formatHit,
  scoreAt,
  sectorAngle,
  targetPoint,
  type Hit,
  type Point,
} from '@oche/core';
import { useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

const R = BOARD.boardRadius;
const HALF_SECTOR = 9;

/** Lens geometry, in board millimetres. */
const LENS = {
  radius: 58,
  magnification: 3.2,
  /** How far the lens sits from the finger: clear of a fingertip, still close. */
  offset: 96,
};

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

export interface LensPlacement {
  cx: number;
  cy: number;
  /** Where it ended up relative to the finger. */
  side: 'above' | 'left' | 'right' | 'below';
}

/**
 * Where to put the lens so that it never covers the finger, never leaves the
 * board's frame, and — as far as possible — is not where the hand is.
 *
 * Above by default, because a hand comes from below. Near the top of the board,
 * which is exactly where the 20 is and so where this matters most, it goes
 * *sideways* rather than below: a lens under the finger is a lens under the
 * hand holding the phone. Below is the last resort.
 *
 * Works in SVG coordinates, so "above" means a smaller y.
 */
export function placeLens(
  point: { x: number; y: number },
  view = R,
  radius = LENS.radius,
  offset = LENS.offset,
): LensPlacement {
  const limit = view - radius - 2;
  const clamp = (value: number) => Math.max(-limit, Math.min(limit, value));
  // Enough that the fingertip and the lens never touch.
  const clearance = radius + 14;
  const clear = (cx: number, cy: number) => Math.hypot(cx - point.x, cy - point.y) >= clearance;

  const above = point.y - offset;
  if (above - radius >= -view) return { cx: clamp(point.x), cy: above, side: 'above' };

  // Squeezed against the top edge: keep it above if it still clears the finger.
  const squeezed = clamp(above);
  if (clear(clamp(point.x), squeezed)) return { cx: clamp(point.x), cy: squeezed, side: 'above' };

  // Otherwise sideways, on whichever side has more room.
  const toLeft = point.x > 0;
  const sideways = clamp(point.x + (toLeft ? -offset : offset));
  if (clear(sideways, clamp(point.y))) {
    return { cx: sideways, cy: clamp(point.y), side: toLeft ? 'left' : 'right' };
  }

  return { cx: clamp(point.x), cy: clamp(point.y + offset), side: 'below' };
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

  // Ids have to be unique per instance: two boards on one page would otherwise
  // share a lens clip and magnify each other.
  const uid = useId().replace(/:/g, '');
  const artId = `board-${uid}`;
  const dartsId = `darts-${uid}`;
  const clipId = `lens-${uid}`;

  const svgRef = useRef<SVGSVGElement>(null);
  const [preview, setPreview] = useState<{ pos: Point; hit: Hit } | null>(null);

  const positionOf = (event: ReactPointerEvent<SVGSVGElement>): Point | null => {
    const svg = svgRef.current;
    if (!svg) return null;

    const rect = svg.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height);
    if (size === 0) return null;

    // The viewBox is square and centred on the bull, so screen → board is a
    // scale and a y flip.
    const originX = rect.left + (rect.width - size) / 2;
    const originY = rect.top + (rect.height - size) / 2;
    return {
      x: ((event.clientX - originX) / size) * 2 * R - R,
      y: -(((event.clientY - originY) / size) * 2 * R - R),
    };
  };

  const track = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (disabled || !onHit) return;
    const pos = positionOf(event);
    if (!pos) return;

    const hit = scoreAt(pos);
    setPreview((current) => {
      // A short tick whenever the score under the finger changes: on a phone
      // that lands before the eye has read the lens.
      const changed =
        current === null || current.hit.value !== hit.value || current.hit.ring !== hit.ring;
      if (changed) navigator.vibrate?.(6);
      return { pos, hit };
    });
  };

  const commit = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (disabled || !onHit) return;
    const pos = positionOf(event) ?? preview?.pos;
    setPreview(null);
    if (!pos) return;
    onHit(scoreAt(pos), pos);
  };

  const targetPos = target && target.ring !== 'miss' ? targetPoint(target) : null;

  const dartMarkers = darts.map((dart, index) =>
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
  );

  // The finger's point and the lens, both in SVG coordinates.
  const finger = preview ? { x: preview.pos.x, y: -preview.pos.y } : null;
  const lens = finger ? placeLens(finger) : null;
  const lensTransform =
    finger && lens
      ? `translate(${lens.cx} ${lens.cy}) scale(${LENS.magnification}) translate(${-finger.x} ${-finger.y})`
      : '';

  return (
    <svg
      ref={svgRef}
      className="dartboard"
      viewBox={`${-R} ${-R} ${2 * R} ${2 * R}`}
      role={onHit ? 'button' : 'img'}
      aria-label="Dartboard"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        track(event);
      }}
      onPointerMove={(event) => {
        if (preview) track(event);
      }}
      onPointerUp={commit}
      onPointerCancel={() => setPreview(null)}
    >
      <defs>
        <g id={artId}>
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
        </g>

        <g id={dartsId}>{dartMarkers}</g>

        {lens && (
          <clipPath id={clipId}>
            <circle cx={lens.cx} cy={lens.cy} r={LENS.radius} />
          </clipPath>
        )}
      </defs>

      <use href={`#${artId}`} />

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

      <use href={`#${dartsId}`} />

      {preview && finger && lens && (
        <g className="dartboard-lens" pointerEvents="none">
          {/* Where the finger actually is, left visible under the lens. */}
          <circle cx={finger.x} cy={finger.y} r={12} fill="none" stroke="#ffffff" strokeWidth={1.6} opacity={0.9} />
          <circle cx={finger.x} cy={finger.y} r={2} fill="#ffffff" />

          <circle
            cx={lens.cx}
            cy={lens.cy}
            r={LENS.radius + 3}
            fill={COLOURS.surround}
            stroke="#ffffff"
            strokeWidth={3}
          />

          <g clipPath={`url(#${clipId})`}>
            <use href={`#${artId}`} transform={lensTransform} />
            <use href={`#${dartsId}`} transform={lensTransform} />

            {/* The crosshair sits at the lens centre, which is the finger's
                exact point magnified — the whole purpose of the thing. */}
            <g stroke="#ffffff" strokeWidth={1.8} opacity={0.95}>
              <line x1={lens.cx - LENS.radius} y1={lens.cy} x2={lens.cx - 9} y2={lens.cy} />
              <line x1={lens.cx + 9} y1={lens.cy} x2={lens.cx + LENS.radius} y2={lens.cy} />
              <line x1={lens.cx} y1={lens.cy - LENS.radius} x2={lens.cx} y2={lens.cy - 9} />
              <line x1={lens.cx} y1={lens.cy + 9} x2={lens.cx} y2={lens.cy + LENS.radius} />
            </g>
            <circle cx={lens.cx} cy={lens.cy} r={3.5} fill="none" stroke="#ffffff" strokeWidth={1.8} />

            <rect
              x={lens.cx - 34}
              y={lens.cy + LENS.radius - 30}
              width={68}
              height={26}
              rx={8}
              fill="rgb(1 4 9 / 85%)"
            />
            <text
              x={lens.cx}
              y={lens.cy + LENS.radius - 11}
              fill="#ffffff"
              fontSize={19}
              fontWeight={700}
              textAnchor="middle"
            >
              {formatHit(preview.hit)}
            </text>
          </g>
        </g>
      )}
    </svg>
  );
}
