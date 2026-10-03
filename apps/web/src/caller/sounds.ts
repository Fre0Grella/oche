/**
 * Two sounds, synthesised with Web Audio rather than recorded, so there is no
 * sample to license or download: a dart going into the board, and the turn
 * passing to the next player.
 *
 * Browsers keep audio silent until the page has had a real user gesture, so
 * `unlockSounds` is called from taps, the way `unlockCaller` is.
 */

let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return null;
  context ??= new Context();
  return context;
}

export function unlockSounds(): void {
  const ctx = audio();
  if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
}

/** A short burst of white noise, the raw material of the impact. */
function noise(ctx: AudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/**
 * A dart landing in sisal: a sharp, papery tick (filtered noise, a few
 * milliseconds) over a short, dull thump (a falling low tone).
 */
export function playThud(): void {
  const ctx = audio();
  if (!ctx || ctx.state !== 'running') return;
  const now = ctx.currentTime;

  const tick = ctx.createBufferSource();
  tick.buffer = noise(ctx, 0.05);
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 2400;
  band.Q.value = 0.9;
  const tickGain = ctx.createGain();
  tickGain.gain.setValueAtTime(0.9, now);
  tickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
  tick.connect(band).connect(tickGain).connect(ctx.destination);
  tick.start(now);
  tick.stop(now + 0.05);

  const thump = ctx.createOscillator();
  thump.type = 'sine';
  thump.frequency.setValueAtTime(150, now);
  thump.frequency.exponentialRampToValueAtTime(55, now + 0.12);
  const thumpGain = ctx.createGain();
  thumpGain.gain.setValueAtTime(0.7, now);
  thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
  thump.connect(thumpGain).connect(ctx.destination);
  thump.start(now);
  thump.stop(now + 0.17);
}

/** The turn passing: two soft rising notes, unmistakable and not a dart. */
export function playTurn(): void {
  const ctx = audio();
  if (!ctx || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  [
    { at: 0, frequency: 660 },
    { at: 0.14, frequency: 990 },
  ].forEach(({ at, frequency }) => {
    const tone = ctx.createOscillator();
    tone.type = 'triangle';
    tone.frequency.value = frequency;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now + at);
    gain.gain.exponentialRampToValueAtTime(0.35, now + at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.32);
    tone.connect(gain).connect(ctx.destination);
    tone.start(now + at);
    tone.stop(now + at + 0.34);
  });
}
