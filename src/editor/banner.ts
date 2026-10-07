/** The editor's messages as top banners: what the status line used to say, now with a colour for the situation.
 * Pure decisions only; the host owns the timer and the markup. */

export type BannerLevel = "info" | "warning" | "error";

/** Seconds a banner stays before it closes itself. Diego, 2026-10-07: 20. */
export const BANNER_MS = 20_000;

/** The messages that are only the editor idling: no banner. */
export function isQuiet(text: string): boolean {
  return !text.trim() || text === "Ready";
}

/** Error: something was refused or failed. Warning: it worked, with a catch or a cancel. Else info. */
export function bannerLevel(text: string): BannerLevel {
  if (/\b(could not|cannot|can't|failed|refused|error|is fixed|not allowed|unavailable)\b/i.test(text)) return "error";
  if (/\b(but|meanwhile|cancel(led)?|too few|nothing to save|no light|out of range|type a|same point|changed while)\b/i.test(text)) return "warning";
  return "info";
}
