/**
 * The caller: says the score out loud so nobody has to look at the screen.
 *
 * `CallerVoice` is deliberately an interface. Today the only implementation uses
 * `speechSynthesis`, which is free and offline but sounds different on every
 * device; a recorded clip pack with a real caller's cadence is planned and slots
 * in behind the same interface (see `docs/06-voice.md`).
 */

export interface CallerVoice {
  /** Says a phrase, interrupting whatever was being said. */
  say(phrase: string): void;
  /** Says a sequence with natural gaps, as a caller does. */
  sequence(phrases: string[]): void;
  cancel(): void;
  readonly available: boolean;
}

class SpeechSynthesisCaller implements CallerVoice {
  readonly available: boolean;
  private voice: SpeechSynthesisVoice | null = null;

  constructor(private readonly locale = 'en') {
    this.available = typeof window !== 'undefined' && 'speechSynthesis' in window;
    if (this.available) {
      const pick = () => {
        const voices = window.speechSynthesis.getVoices();
        this.voice =
          voices.find((v) => v.lang.toLowerCase().startsWith(this.locale) && v.localService) ??
          voices.find((v) => v.lang.toLowerCase().startsWith(this.locale)) ??
          null;
      };
      pick();
      window.speechSynthesis.addEventListener('voiceschanged', pick);
    }
  }

  say(phrase: string): void {
    if (!this.available) return;
    window.speechSynthesis.cancel();
    this.enqueue(phrase);
  }

  sequence(phrases: string[]): void {
    if (!this.available) return;
    window.speechSynthesis.cancel();
    for (const phrase of phrases) this.enqueue(phrase);
  }

  cancel(): void {
    if (this.available) window.speechSynthesis.cancel();
  }

  private enqueue(phrase: string): void {
    const utterance = new SpeechSynthesisUtterance(phrase);
    // A caller is loud, clear and slightly slower than conversational speech.
    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.volume = 1;
    if (this.voice) utterance.voice = this.voice;
    window.speechSynthesis.speak(utterance);
  }
}

class SilentCaller implements CallerVoice {
  readonly available = false;
  say(): void {}
  sequence(): void {}
  cancel(): void {}
}

let instance: CallerVoice | null = null;

export function caller(): CallerVoice {
  if (!instance) {
    instance =
      typeof window !== 'undefined' && 'speechSynthesis' in window
        ? new SpeechSynthesisCaller()
        : new SilentCaller();
  }
  return instance;
}

/**
 * Some browsers refuse to speak until the page has had a real user gesture.
 * Calling this from the first tap makes the first announcement work.
 */
export function unlockCaller(): void {
  const voice = caller();
  if (!voice.available) return;
  const utterance = new SpeechSynthesisUtterance('');
  utterance.volume = 0;
  window.speechSynthesis.speak(utterance);
}
