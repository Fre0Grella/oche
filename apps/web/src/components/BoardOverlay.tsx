/**
 * The board drawn over the camera image.
 *
 * Everything here works in image pixels, with the SVG's viewBox set to the
 * frame's own resolution, so a coordinate on screen is a coordinate in the
 * photograph regardless of how the video is scaled to fit the phone.
 *
 * Drawing the board's wires through the calibration is what makes a calibration
 * checkable by eye: if the drawn wires sit on the real ones, the homography is
 * right, and if they drift the person can see exactly where.
 */

import { applyHomography, boardWireframe, type Matrix3, type Point } from '@treblewise/core';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

export interface OverlayHandle {
  point: Point;
  label: string;
  hint: string;
}

export interface BoardOverlayProps {
  /** The frame's own resolution; the SVG viewBox. */
  width: number;
  height: number;
  /** Board millimetres → image pixels. Draws the wireframe when present. */
  toImage?: Matrix3 | null;
  /** Draggable calibration landmarks. */
  handles?: OverlayHandle[];
  onHandleMove?: (index: number, point: Point) => void;
  /**
   * Dart markers, already in image pixels. `kind` tells a person's marks
   * apart: carried from an earlier photograph (grey), placed on this one
   * (yellow), or proposed by the model and not yet confirmed (blue, dashed).
   */
  darts?: { img: Point; label: string; active?: boolean; kind?: 'carried' | 'new' | 'proposed' }[];
  onDartMove?: (index: number, point: Point) => void;
  /** Tapping empty space, in image pixels. */
  onTap?: (point: Point) => void;
  dim?: boolean;
}

const MARK_COLOUR = { carried: '#9aa4b2', new: '#ffd166', proposed: '#5ad1ff', plain: '#ffffff' } as const;

type Drag = { kind: 'handle' | 'dart'; index: number } | null;

export function BoardOverlay({
  width,
  height,
  toImage = null,
  handles = [],
  onHandleMove,
  darts = [],
  onDartMove,
  onTap,
  dim = false,
}: BoardOverlayProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag>(null);
  const moved = useRef(false);

  // A phone reports a finger a hundred and more times a second, and every
  // report re-renders the screen that owns the markers. Only the latest
  // position matters, so moves are handed on once per frame.
  const moveHandlers = useRef({ onHandleMove, onDartMove });
  moveHandlers.current = { onHandleMove, onDartMove };
  const pendingMove = useRef<{ kind: 'handle' | 'dart'; index: number; point: Point } | null>(null);
  const moveFrame = useRef(0);
  const flushMove = () => {
    if (moveFrame.current) cancelAnimationFrame(moveFrame.current);
    moveFrame.current = 0;
    const move = pendingMove.current;
    pendingMove.current = null;
    if (!move) return;
    if (move.kind === 'handle') moveHandlers.current.onHandleMove?.(move.index, move.point);
    else moveHandlers.current.onDartMove?.(move.index, move.point);
  };
  useEffect(() => () => cancelAnimationFrame(moveFrame.current), []);

  // The board's wires, projected into the photograph.
  const wires = useMemo(() => {
    if (!toImage) return [];
    return boardWireframe().map((line) =>
      line
        .map((p) => applyHomography(toImage, p))
        .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
        .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
        .join(' '),
    );
  }, [toImage]);

  // Markers are drawn at a fixed size on screen, not in image pixels: the
  // picture is shown at very different scales (a whole phone frame, or the
  // board's square magnified on a laptop), and a marker that grew with it hid
  // the very tip it was meant to sit on. `screen` is screen pixels per image
  // pixel; until the overlay has been measured, a hundredth of the frame
  // stands in for six screen pixels.
  const [screen, setScreen] = useState(0);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const rect = svg.getBoundingClientRect();
      if (rect.width > 0 && width > 0) setScreen(rect.width / width);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [width]);
  /** A length in screen pixels, as image pixels. */
  const px = (n: number) => (screen > 0 ? n / screen : (n * Math.max(width, height)) / 600);
  const unit = px(6);

  const toImageSpace = (event: ReactPointerEvent): Point | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      x: ((event.clientX - rect.left) / rect.width) * width,
      y: ((event.clientY - rect.top) / rect.height) * height,
    };
  };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    const point = toImageSpace(event);
    if (!point) return;
    moved.current = false;

    // Grab the marker under the finger, if any: the nearest one, except that
    // a mark of this photograph (new or proposed) wins over one carried from
    // an earlier photograph. Two darts in a tight group sit within a finger
    // of each other, and the one being placed is the one that needs moving.
    const reach = px(24);
    const near = (candidates: { img: Point; kind?: string }[]) => {
      let best = -1;
      let bestRank = Infinity;
      candidates.forEach((c, index) => {
        const distance = Math.hypot(c.img.x - point.x, c.img.y - point.y);
        if (distance >= reach) return;
        const rank = (c.kind === 'carried' ? reach : 0) + distance;
        if (rank < bestRank) {
          best = index;
          bestRank = rank;
        }
      });
      return best;
    };

    const handleIndex = near(handles.map((h) => ({ img: h.point })));
    if (handleIndex >= 0 && onHandleMove) {
      drag.current = { kind: 'handle', index: handleIndex };
    } else {
      const dartIndex = near(darts);
      drag.current = dartIndex >= 0 && onDartMove ? { kind: 'dart', index: dartIndex } : null;
    }

    if (drag.current) event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!drag.current) return;
    const point = toImageSpace(event);
    if (!point) return;
    moved.current = true;
    pendingMove.current = { kind: drag.current.kind, index: drag.current.index, point };
    if (!moveFrame.current) moveFrame.current = requestAnimationFrame(flushMove);
  };

  const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    const wasDragging = drag.current !== null;
    drag.current = null;
    flushMove(); // the marker ends where the finger left it, not one frame short
    if (wasDragging) return;

    const point = toImageSpace(event);
    if (point && onTap) onTap(point);
  };

  return (
    <svg
      ref={svgRef}
      className={`board-overlay${dim ? ' board-overlay-dim' : ''}`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        drag.current = null;
      }}
    >
      <g fill="none" stroke="#3ddc84" strokeWidth={px(1)} opacity={0.85}>
        {wires.map((points, index) => (
          <polyline key={index} points={points} />
        ))}
      </g>

      {handles.map((handle) => (
        <g key={handle.label}>
          <circle
            cx={handle.point.x}
            cy={handle.point.y}
            r={unit * 2.4}
            fill="rgb(255 209 102 / 25%)"
            stroke="#ffd166"
            strokeWidth={unit * 0.3}
          />
          <circle cx={handle.point.x} cy={handle.point.y} r={unit * 0.35} fill="#ffd166" />
          <text
            x={handle.point.x}
            y={handle.point.y - unit * 3}
            fill="#ffd166"
            fontSize={unit * 2.4}
            fontWeight={700}
            textAnchor="middle"
            paintOrder="stroke"
            stroke="rgb(1 4 9 / 80%)"
            strokeWidth={unit * 0.5}
          >
            {handle.label}
          </text>
        </g>
      ))}

      {darts.map((dart, index) => {
        const { x, y } = dart.img;
        // A thin cross with a gap in the middle, so the tip itself stays
        // visible under the mark: placing it is lining the gap up on the tip.
        const ticks = [
          [x - px(12), y, x - px(3), y],
          [x + px(3), y, x + px(12), y],
          [x, y - px(12), x, y - px(3)],
          [x, y + px(3), x, y + px(12)],
        ];
        return (
          <g key={index}>
            {ticks.map(([x1, y1, x2, y2], tick) => (
              <line key={`halo-${tick}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgb(1 4 9 / 70%)" strokeWidth={px(2.5)} />
            ))}
            {ticks.map(([x1, y1, x2, y2], tick) => (
              <line key={tick} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#ffffff" strokeWidth={px(1)} />
            ))}
            <circle
              cx={x}
              cy={y}
              r={px(8)}
              fill="none"
              stroke={MARK_COLOUR[dart.kind ?? (dart.active ? 'new' : 'plain')]}
              strokeWidth={px(1.5)}
              strokeDasharray={dart.kind === 'proposed' ? `${px(3)} ${px(2)}` : undefined}
            />
            <text
              x={x}
              /* Staggered, because three darts in a cluster put their labels on
                 top of each other otherwise. */
              y={y - px(15) - index * px(13)}
              fill="#ffffff"
              fontSize={px(12)}
              fontWeight={700}
              textAnchor="middle"
              paintOrder="stroke"
              stroke="rgb(1 4 9 / 80%)"
              strokeWidth={px(3)}
            >
              {dart.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
