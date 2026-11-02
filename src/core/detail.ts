// S25.1: semantic zoom. How much of the plan is drawn depends on how far in the viewer is. Zoom is relative to the
// floor at fit (1 = the whole floor). The thresholds are constants, not settings (Diego, 2026-10-09).

export type DetailLevel = "far" | "mid" | "near";
/** `auto` follows the zoom, `full` is always near, `minimal` is always far. */
export type DetailMode = "auto" | "full" | "minimal";

/** Zoom at which device icons come back. Below it: far. */
export const DETAIL_MID_FROM = 1.6;
/** Zoom at which device labels and readings come back. Below it (and from `DETAIL_MID_FROM`): mid. */
export const DETAIL_NEAR_FROM = 3.2;

/** S37.6: in `auto`, a plan at least this many screen px wide (the whole floor at fit, not the card or the window) draws device icons at fit; under it, dots. */
export const ICONS_MIN_PLAN_PX = 400;

/** S38.7: hysteresis on that bound. Icons from a plan this wide, dots at `ICONS_OFF_PLAN_PX` and under, the last level strictly between (a 380 px box makes a 380 px plan, and must read dots),
 *  so a plan resting at the bound (a scrollbar, a sheet, 1 px of layout) does not flip with every resize. */
export const ICONS_ON_PLAN_PX = 420;
export const ICONS_OFF_PLAN_PX = 380;

/** Whether icons are drawn at fit for a plan `planPx` wide, given whether they were (`was`). Not measured: icons. */
export function iconsHold(planPx: number, was: boolean): boolean {
  if (!Number.isFinite(planPx)) return true;
  return planPx >= ICONS_ON_PLAN_PX ? true : planPx <= ICONS_OFF_PLAN_PX ? false : was;
}

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
 * S37.6: `planPx` is the floor's rendered width at fit. In `auto`, a floor at least `ICONS_MIN_PLAN_PX` wide, or one not
 * measured yet (a number that is not finite: when we cannot tell, show), draws icons at fit (`mid`) where zoom alone says dots
 * (`far`). It reads the width at fit, not at the zoom on show, and the level changes no layout, so a switch cannot move the
 * width that decided it. `full` and `minimal` ignore it. Omitted (undefined), the width rule is off and only the zoom decides: the Studio passes none and starts on `full`.
 */
export function detailFor(fit: { w: number; h: number }, shown: { w: number; h: number }, mode: DetailMode = "auto", planPx?: number): DetailLevel {
  const z = fit && shown ? Math.min(fit.w / shown.w, fit.h / shown.h) : NaN;
  const level = detailLevel(z, mode);
  if (level !== "far" || parseDetailMode(mode) !== "auto") return level;
  if (typeof planPx !== "number") return level;
  return !Number.isFinite(planPx) || planPx >= ICONS_MIN_PLAN_PX ? "mid" : "far";
}
