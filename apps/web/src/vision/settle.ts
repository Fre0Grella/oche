/**
 * The capture trigger: decides when the board has changed and gone still,
 * which is the moment worth photographing.
 *
 * The obvious design — "wait for movement, then for stillness" — does not work
 * on a real board, and it is worth writing down why. The camera looks at the
 * board from a metre away; the player throws from 2.37 m *behind* it. Their arm
 * never crosses the frame. The dart is in view for two or three motion-blurred
 * frames and then occupies a few per cent of the board. Averaged over a whole
 * video frame, a dart landing in the treble 20 is a rounding error, so a gate
 * that waits for "movement" waits forever.
 *
 * So this works on two signals instead, both measured on a small greyscale
 * thumbnail of the board region only:
 *
 *   motion  mean |current − previous|, over the whole thumbnail.
 *           Answers "is something happening right now?" — a hand reaching in,
 *           a dart in flight, the camera being knocked.
 *
 *   change  the largest per-block mean of |current − reference|, where the
 *           reference is the board as it was when we last photographed it.
 *           Answers "is there something on the board that was not there
 *           before?" A dart is small but *locally* dense, so a block metric
 *           sees it clearly while a whole-frame mean does not.
 *
 * A frame is worth taking when the scene is still and the board has changed.
 *
 * The thresholds below are starting points, not measurements. `motion` and
 * `change` are exposed so the capture lab can show them while someone throws at
 * a real board, and they should be set from what that shows.
 */

export type SettleState = 'idle' | 'moving' | 'settled';

export interface SettleOptions {
  /** Mean abs difference (0–255) between frames above which the scene is moving. */
  motionThreshold?: number;
  /** Block mean abs difference against the reference that counts as a change. */
  changeThreshold?: number;
  /** How long the scene must be still before a frame is worth taking. */
  settleMs?: number;
  /** Ignore everything for this long after a capture, while a dart wobbles. */
  cooldownMs?: number;
  /** Block size in cells for the change metric. */
  blockSize?: number;
  /** Thumbnail dimensions, needed to interpret it as a grid. */
  width?: number;
  height?: number;
}

const DEFAULTS: Required<SettleOptions> = {
  motionThreshold: 4,
  changeThreshold: 8,
  settleMs: 350,
  cooldownMs: 600,
  blockSize: 8,
  width: 64,
  height: 64,
};

export class SettleDetector {
  private readonly options: Required<SettleOptions>;
  private previous: Uint8Array | null = null;
  private reference: Uint8Array | null = null;
  private lastMotionAt = Number.NEGATIVE_INFINITY;
  private lastCaptureAt = Number.NEGATIVE_INFINITY;
  private state: SettleState = 'idle';
  private lastMotion = 0;
  private lastChange = 0;

  constructor(options: SettleOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  /** Mean frame-to-frame difference, for the capture lab's readout. */
  get motion(): number {
    return this.lastMotion;
  }

  /** Strongest local difference against the reference board. */
  get change(): number {
    return this.lastChange;
  }

  get current(): SettleState {
    return this.state;
  }

  reset(): void {
    this.previous = null;
    this.reference = null;
    this.lastMotionAt = Number.NEGATIVE_INFINITY;
    this.lastCaptureAt = Number.NEGATIVE_INFINITY;
    this.state = 'idle';
    this.lastMotion = 0;
    this.lastChange = 0;
  }

  /**
   * Forgets the board it was comparing against — after the darts are pulled
   * out, or when the camera has been moved.
   */
  resetReference(): void {
    this.reference = this.previous;
    this.lastChange = 0;
  }

  private meanDifference(a: Uint8Array, b: Uint8Array): number {
    let total = 0;
    for (let i = 0; i < a.length; i += 1) total += Math.abs(a[i]! - b[i]!);
    return total / a.length;
  }

  /**
   * The largest mean difference over any block. A dart covers a small part of
   * the board but nearly all of one block, so this sees it where an average
   * over everything would not.
   *
   * The blocks overlap, stepping half a block at a time: with a fixed grid a
   * dart that straddles a boundary is split across four blocks and loses most
   * of its signal, which is exactly the case that would make it invisible.
   */
  private blockDifference(a: Uint8Array, b: Uint8Array): number {
    const { width, height, blockSize } = this.options;
    if (a.length !== width * height) return this.meanDifference(a, b);

    const step = Math.max(1, Math.floor(blockSize / 2));
    let worst = 0;
    for (let by = 0; by + 1 < height; by += step) {
      for (let bx = 0; bx + 1 < width; bx += step) {
        let total = 0;
        let count = 0;
        for (let y = by; y < Math.min(by + blockSize, height); y += 1) {
          for (let x = bx; x < Math.min(bx + blockSize, width); x += 1) {
            const i = y * width + x;
            total += Math.abs(a[i]! - b[i]!);
            count += 1;
          }
        }
        if (count > 0) worst = Math.max(worst, total / count);
      }
    }
    return worst;
  }

  /**
   * Feeds one greyscale thumbnail of the board region. Returns `'settled'` on
   * the frame where the board has changed and then held still — once per
   * change, not once per frame.
   */
  push(thumbnail: Uint8Array, now: number): SettleState {
    const previous = this.previous;
    this.previous = thumbnail;

    if (!previous || previous.length !== thumbnail.length) {
      this.reference ??= thumbnail;
      this.lastMotion = 0;
      this.state = 'idle';
      return 'idle';
    }

    this.reference ??= previous;

    this.lastMotion = this.meanDifference(thumbnail, previous);
    if (this.lastMotion >= this.options.motionThreshold) {
      this.lastMotionAt = now;
      this.state = 'moving';
      return 'moving';
    }

    if (now - this.lastMotionAt < this.options.settleMs) {
      this.state = 'moving';
      return 'moving';
    }

    this.lastChange = this.blockDifference(thumbnail, this.reference!);
    this.state = 'idle';

    if (this.lastChange < this.options.changeThreshold) return 'idle';
    if (now - this.lastCaptureAt < this.options.cooldownMs) return 'idle';

    // The board is still and no longer looks the way it did when we last
    // photographed it: something landed, or something was taken out.
    this.reference = thumbnail;
    this.lastCaptureAt = now;
    return 'settled';
  }
}
