// Typed view of the shared, plain-JavaScript i18n core (a synced copy of public/i18n/core.js: see scripts/sync-i18n.js).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const core = require("./shared/core.js") as Core;

export interface Lang { code: string; name: string; script: string }
export type Messages = Record<string, string | Record<string, string>>;
export type Translator = ((key: string, params?: Record<string, string | number>) => string) & { lang: string };
export interface Core {
  LANGS: Lang[];
  CODES: string[];
  DEFAULT_LANG: string;
  STORAGE_KEY: string;
  normalizeChoice(v: unknown): string | null;
  negotiate(input: string | string[]): string;
  createTranslator(o: { lang: string; messages: Messages; fallback?: Messages }): Translator;
  formatNumber(lang: string, n: number): string;
  formatRupees(lang: string, n: number): string;
  formatDateTime(lang: string, v: string | number | Date, opts?: Intl.DateTimeFormatOptions): string;
  collator(lang: string): { compare(a: string, b: string): number };
  nfc(s: string): string;
  countGraphemes(s: string): number;
  truncateGraphemes(s: string, max: number): string;
  langHint(text: string, uiLang: string): string | null;
}
export default core;
