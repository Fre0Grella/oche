/**
 * The square of the photograph worth showing once the board is calibrated:
 * the board and a little around it. Everything else is wall, and on a laptop
 * a 16:9 picture of mostly wall pushes the controls off the screen.
 */

import type { Region } from './camera.js';

/**
 * A square around `region`, as large as its longer side, moved (never shrunk
 * below the frame's shorter side) so that it stays inside the frame.
 */
export function squareAround(region: Region, frame: { width: number; height: number }): Region {
  const side = Math.min(Math.max(region.width, region.height), frame.width, frame.height);
  const cx = region.x + region.width / 2;
  const cy = region.y + region.height / 2;
  const x = Math.min(Math.max(cx - side / 2, 0), frame.width - side);
  const y = Math.min(Math.max(cy - side / 2, 0), frame.height - side);
  return { x, y, width: side, height: side };
}
