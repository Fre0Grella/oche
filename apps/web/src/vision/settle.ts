/**
 * The motion gate: decides when the board has stopped moving, which is the
 * moment worth photographing.
 *
 * Nothing here knows about cameras. It takes a small greyscale thumbnail per
 * frame and runs a state machine over the mean absolute difference between
 * consecutive thumbnails, which is cheap enough to run on every frame and is
 * the reason inference never has to.
 *
 *   idle ──motion──► moving ──still for `settleMs`──► settled ──► idle
 *
 * `settled` is emitted once per throw, not once per frame.
 */

export type SettleState = 'idle' | 'moving' | 'settled';

export interface SettleOptions {
  /** Mean abs difference (0–255) above which the scene counts as moving. */
  motionThreshold?: number;
  /** …and below which it counts as still. Hysteresis: keep it under the above. */
  stillThreshold?: number;
  /** How long the scene must stay still before a frame is worth taking. */
  settleMs?: number;
  /** Ignore motion for this long after a settle, while the dart still wobbles. */
  cooldownMs?: number;
}

const DEFAULTS: Required<SettleOptions> = {
  motionThreshold: 6,
  stillThreshold: 2.5,
  settleMs: 300,
  cooldownMs: 600,
};

export class SettleDetector {
  private readonly options: Required<SettleOptions>;
  private previous: Uint8Array | null = null;
  private state: SettleState = 'idle';
  private stillSince: number | null = null;
  private lastSettleAt = Number.NEGATIVE_INFINITY;
  private lastDifference = 0;

  constructor(options: SettleOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  get difference(): number {
    return this.lastDifference;
  }

  get current(): SettleState {
    return this.state;
  }

  reset(): void {
    this.previous = null;
    this.state = 'idle';
    this.stillSince = null;
    this.lastSettleAt = Number.NEGATIVE_INFINITY;
    this.lastDifference = 0;
  }

  /**
   * Feeds one greyscale thumbnail. Returns `'settled'` exactly once per throw,
   * on the frame where the scene has been still long enough to photograph.
   */
  push(thumbnail: Uint8Array, now: number): SettleState {
    const previous = this.previous;
    this.previous = thumbnail;

    if (!previous || previous.length !== thumbnail.length) {
      this.lastDifference = 0;
      return 'idle';
    }

    let total = 0;
    for (let i = 0; i < thumbnail.length; i += 1) {
      total += Math.abs(thumbnail[i]! - previous[i]!);
    }
    const difference = total / thumbnail.length;
    this.lastDifference = difference;

    if (difference >= this.options.motionThreshold) {
      if (now - this.lastSettleAt >= this.options.cooldownMs) {
        this.state = 'moving';
        this.stillSince = null;
      }
      return this.state === 'moving' ? 'moving' : 'idle';
    }

    if (this.state !== 'moving') return 'idle';

    if (difference <= this.options.stillThreshold) {
      if (this.stillSince === null) this.stillSince = now;
      if (now - this.stillSince >= this.options.settleMs) {
        this.state = 'idle';
        this.stillSince = null;
        this.lastSettleAt = now;
        return 'settled';
      }
      return 'moving';
    }

    // Between the two thresholds: still drifting, so the clock restarts.
    this.stillSince = null;
    return 'moving';
  }
}
