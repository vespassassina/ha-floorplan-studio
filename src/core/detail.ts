// S25.1: semantic zoom. How much of the plan is drawn depends on how far in the viewer is. Zoom is relative to the
// floor at fit (1 = the whole floor). The thresholds are constants, not settings (Diego, 2026-10-09).

export type DetailLevel = "far" | "mid" | "near";
/** `auto` follows the zoom, `full` is always near, `minimal` is always far. */
export type DetailMode = "auto" | "full" | "minimal";

/** Zoom at which device icons come back. Below it: far. */
export const DETAIL_MID_FROM = 1.6;
/** Zoom at which device labels and readings come back. Below it (and from `DETAIL_MID_FROM`): mid. */
export const DETAIL_NEAR_FROM = 3.2;

/** The three modes, in the order a menu lists them. */
export const DETAIL_MODES: readonly DetailMode[] = ["auto", "full", "minimal"];
/** What each mode is called on a button (S25.7, S25.8). */
export const DETAIL_LABELS: Record<DetailMode, string> = { auto: "Auto", full: "Full", minimal: "Minimal" };
const MODES = DETAIL_MODES;

/** A stored or configured mode is untrusted: anything that is not one of the three names is `auto`. */
export function parseDetailMode(raw: unknown): DetailMode {
  return typeof raw === "string" && (MODES as readonly string[]).includes(raw) ? (raw as DetailMode) : "auto";
}

/** The level for a zoom (1 = whole floor) and a mode. A zoom that is not a finite positive number reads as `near`: when we cannot tell, show everything. */
export function detailLevel(zoom: number, mode: DetailMode = "auto"): DetailLevel {
  const m = parseDetailMode(mode);
  if (m === "full") return "near";
  if (m === "minimal") return "far";
  if (typeof zoom !== "number" || !Number.isFinite(zoom) || zoom <= 0) return "near";
  return zoom >= DETAIL_NEAR_FROM ? "near" : zoom >= DETAIL_MID_FROM ? "mid" : "far";
}

/**
 * The one call the card and the Studio both make: the level for the box on show against the floor's fit box. The
 * smaller of the width and height ratios, as "Copy card view" takes it, so a window of another shape reads the same.
 */
export function detailFor(fit: { w: number; h: number }, shown: { w: number; h: number }, mode: DetailMode = "auto"): DetailLevel {
  const z = fit && shown ? Math.min(fit.w / shown.w, fit.h / shown.h) : NaN;
  return detailLevel(z, mode);
}
