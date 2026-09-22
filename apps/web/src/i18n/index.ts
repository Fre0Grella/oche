/**
 * A very small i18n layer: one module per locale, a hook to read it.
 *
 * English is the only locale shipped today, but nothing in the app builds a
 * sentence out of fragments, so adding Italian is a file rather than a refactor
 * (see `docs/01-product.md`).
 */

import { en, type Strings } from './en.js';

const LOCALES: Record<string, Strings> = { en };

let current: Strings = en;

export function setLocale(locale: string): void {
  current = LOCALES[locale] ?? en;
}

export function availableLocales(): string[] {
  return Object.keys(LOCALES);
}

/** The active locale's strings. */
export function useStrings(): Strings {
  return current;
}

export function strings(): Strings {
  return current;
}

/** Fills `{name}`-style placeholders. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`));
}

export { numberToWords } from './en.js';
