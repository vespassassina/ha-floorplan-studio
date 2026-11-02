// S37.5: the card's own words, in the language Home Assistant is set to. English is the source and the fallback, written inline
// at each call: `t("Cancel")` is the key AND the English text, so a missing translation is English, never a hole, and the card
// file carries no English table. Another language is a catalogue of English key -> text, loaded on demand (src/card/i18n.ts).
// Placeholders are `{name}`. A count goes through `tn`, whose entry may hold one text per plural category.
// One English word can mean two things (a Light theme, a light; the Open button, the list of open doors). The second gets a
// context after a bar: `t("Open|openings")` is keyed on the whole text and reads "Open" in English. No UI text holds a bar.

/** A translation: one text, or one per plural category (`one`, `few`, `many`, `other`, ...). */
export type Entry = string | Partial<Record<Intl.LDMLPluralRule, string>>;
export type Catalogue = Record<string, Entry>;
type Vars = Record<string, string | number>;

let catalogue: Catalogue | null = null;
let rules: Intl.PluralRules | null = null;

/** Switches the words. `null` is English. A language code the browser does not know falls back to English plurals. */
export function setCatalogue(next: Catalogue | null, language = "en"): void {
  catalogue = next;
  try { rules = next ? new Intl.PluralRules(language) : null; } catch { rules = null; }
}

/** One pass, so a value that itself holds `{x}` is never expanded again. A placeholder with no value stays as written. */
const fill = (text: string, vars?: Vars): string => (vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (Object.hasOwn(vars, k) ? String(vars[k]) : m)) : text);
/** The English text of a key: without its context. */
const plain = (key: string): string => key.replace(/\|.*$/, "");
const own = (key: string): Entry | undefined => (catalogue && Object.hasOwn(catalogue, key) ? catalogue[key] : undefined);

/** The text for `en` in the current language, placeholders filled. Plain text: lit escapes it where it is markup (finding 2). */
export function t(en: string, vars?: Vars): string {
  const e = own(en);
  return fill(typeof e === "string" ? e : plain(en), vars);
}

/** A count: `one` is the English singular and the catalogue's key, `other` its English plural. `{n}` is `n`. */
export function tn(one: string, other: string, n: number, vars?: Vars): string {
  const e = own(one);
  let text = plain(n === 1 ? one : other);
  if (typeof e === "string") text = e;
  else if (e) text = e[rules?.select(n) ?? "other"] ?? e.other ?? text;
  return fill(text, { n, ...vars });
}

/** Marks an English text as a key without translating it now: for a constant shown later through `t(CONST)`. */
export const mark = (en: string): string => en;
