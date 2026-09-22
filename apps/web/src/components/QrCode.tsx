/**
 * A pairing code, drawn big.
 *
 * White on black would be prettier next to the rest of the app, and would also
 * stop half the QR readers in the world working — the quiet zone and the
 * light-on-dark convention are part of the format, not decoration.
 */

import { useMemo } from 'react';

import { qrMatrix, qrPath } from '../pairing/qr.js';

export interface QrCodeProps {
  text: string;
  /** Alt text, because a QR is an image with meaning. */
  label: string;
}

const QUIET_ZONE = 4;

export function QrCode({ text, label }: QrCodeProps) {
  const { path, extent } = useMemo(() => {
    const matrix = qrMatrix(text);
    return { path: qrPath(matrix), extent: matrix.size + QUIET_ZONE * 2 };
  }, [text]);

  return (
    <svg
      className="qr"
      viewBox={`0 0 ${extent} ${extent}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={extent} height={extent} fill="#ffffff" />
      <g transform={`translate(${QUIET_ZONE} ${QUIET_ZONE})`}>
        <path d={path} fill="#000000" />
      </g>
    </svg>
  );
}
