// S37.5: which language file the card loads for `hass.language`, and the loading. English is not a file: it is the source text
// (src/core/i18n.ts). Each language below is a chunk beside the card, fetched by import() only when it is needed (like the 3D
// view), so the card file carries none of them (tests/card/size-budget.spec.ts).
import { setCatalogue, type Catalogue } from "../core/i18n";

type Load = () => Promise<{ default: Catalogue }>;
/** The codes are Home Assistant's own (home-assistant/frontend `src/translations/translationMetadata.json`): `pt` and `pt-BR`
 * are two files there, `zh-Hans` and `zh-Hant` are two, and `es-419` is a third Spanish. `zh-Hant` has no file yet. */
export const LANGUAGES: Record<string, Load> = {
  it: () => import("./i18n/it"),
  es: () => import("./i18n/es"),
  pt: () => import("./i18n/pt"),
  "pt-BR": () => import("./i18n/pt-BR"),
  fr: () => import("./i18n/fr"),
  de: () => import("./i18n/de"),
  nl: () => import("./i18n/nl"),
  "zh-Hans": () => import("./i18n/zh-Hans"),
  pl: () => import("./i18n/pl"),
};

/** The spellings HA's frontend maps to `zh-Hans` (`src/util/common-translation.ts`). The others (zh, zh-TW, zh-HK...) are Traditional there. */
const SIMPLIFIED = new Set(["zh-cn", "zh-sg", "zh-my"]);

/** The language file for a `hass.language` value: the exact code, then its base (`pt-PT` -> `pt`, `es-419` -> `es`), else null (English).
 * `zh-Hant` is English for now, not Simplified: a reader of Traditional Chinese reads English more easily than the other script. */
export function resolveLanguage(code: unknown): string | null {
  if (typeof code !== "string") return null;
  const raw = code.trim().replace(/_/g, "-");
  if (!raw) return null;
  if (SIMPLIFIED.has(raw.toLowerCase())) return "zh-Hans";
  const exact = Object.keys(LANGUAGES).find((k) => k.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;
  const base = raw.split("-")[0]!.toLowerCase();
  if (base === "zh") return null; // zh-Hant and every other Chinese locale: English
  return Object.hasOwn(LANGUAGES, base) ? base : null;
}

let current: string | null = null;
let pending: { code: string | null; done: Promise<boolean> } | null = null;

/** The language the words are in now (a file's code), or null for English. */
export const currentLanguage = (): string | null => current;

/**
 * Makes `code` the card's language. English is at once; another language is loaded first and the words switch when it is there,
 * so the card shows English for the moment the chunk takes, never a half-translated one. A failed load leaves the words as they
 * were. The next call does ask again, but Chromium keeps a failed dynamic import for the life of the page, so it fails the same
 * way: the card stays English until the page is reloaded. No retry is added for that reason. Resolves true when the words changed.
 */
export function useLanguage(code: unknown): Promise<boolean> {
  const want = resolveLanguage(code);
  if (want === current) { pending = null; return Promise.resolve(false); }
  if (want === null) { pending = null; current = null; setCatalogue(null); return Promise.resolve(true); }
  if (pending?.code === want) return pending.done;
  const done = LANGUAGES[want]!().then(
    (m) => {
      if (pending?.done !== done) return false; // a later call asked for another language while this one loaded
      pending = null;
      current = want;
      setCatalogue(m.default, want);
      return true;
    },
    () => { if (pending?.done === done) pending = null; return false; },
  );
  pending = { code: want, done };
  return done;
}
