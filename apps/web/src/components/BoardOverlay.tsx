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

import { applyHomography, boardWireframe, type Matrix3, type Point } from '@oche/core';
import { useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react';

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
  /** Dart markers, already in image pixels. */
  darts?: { img: Point; label: string; active?: boolean }[];
  onDartMove?: (index: number, point: Point) => void;
  /** Tapping empty space, in image pixels. */
  onTap?: (point: Point) => void;
  dim?: boolean;
}

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

  // Marker sizes are in image pixels, so they have to scale with the frame.
  const unit = Math.max(width, height) / 100;

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

    // Grab whichever marker is under the finger, if any.
    const near = (candidates: { img: Point }[]) =>
      candidates.findIndex((c) => Math.hypot(c.img.x - point.x, c.img.y - point.y) < unit * 4);

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
    if (drag.current.kind === 'handle') onHandleMove?.(drag.current.index, point);
    else onDartMove?.(drag.current.index, point);
  };

  const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    const wasDragging = drag.current !== null;
    drag.current = null;
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
      <g fill="none" stroke="#3ddc84" strokeWidth={unit * 0.22} opacity={0.85}>
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

      {darts.map((dart, index) => (
        <g key={index}>
          <line
            x1={dart.img.x - unit * 1.6}
            y1={dart.img.y}
            x2={dart.img.x + unit * 1.6}
            y2={dart.img.y}
            stroke="#ffffff"
            strokeWidth={unit * 0.22}
          />
          <line
            x1={dart.img.x}
            y1={dart.img.y - unit * 1.6}
            x2={dart.img.x}
            y2={dart.img.y + unit * 1.6}
            stroke="#ffffff"
            strokeWidth={unit * 0.22}
          />
          <circle
            cx={dart.img.x}
            cy={dart.img.y}
            r={unit * 1.9}
            fill="none"
            stroke={dart.active ? '#ffd166' : '#ffffff'}
            strokeWidth={unit * 0.3}
          />
          <text
            x={dart.img.x}
            y={dart.img.y - unit * 2.6}
            fill="#ffffff"
            fontSize={unit * 2.6}
            fontWeight={700}
            textAnchor="middle"
            paintOrder="stroke"
            stroke="rgb(1 4 9 / 80%)"
            strokeWidth={unit * 0.6}
          >
            {dart.label}
          </text>
        </g>
      ))}
    </svg>
  );
}
