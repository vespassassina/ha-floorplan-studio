// S14.2 item 17: the one text a device's state is written in, for the plan's readouts, the tap popup and the hover tooltip.
// The plan's rule (render.ts) is the state Home Assistant sends plus its unit, with "–" for what is not a number; every
// other place calls this, so "48 %" is never "48.0 %" in one of them. Everything read here is untrusted (finding 1).

const DECIMAL = /^-?\d+(\.\d+)?$/;
const NO_STATE = "no state";

interface Reading { state?: unknown; attributes?: unknown }
const attrsOf = (s: Reading): Record<string, unknown> => (s.attributes && typeof s.attributes === "object" ? (s.attributes as Record<string, unknown>) : {});
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A reading the way the plan prints it: the state, then its unit when there is one. */
export function readingText(state: string, unit: unknown): string {
  return typeof unit === "string" && unit ? `${state.trim()} ${unit}` : state.trim();
}

/** A room's mean, rounded to 0.1 with no trailing zero: 48, not 48.0, as a single sensor's reading is printed. */
export const meanText = (n: number): string => String(Math.round(n * 10) / 10);

/**
 * What a device says about itself in one short line. A light on says its brightness (percent), a cover its position, a plug
 * its measured power (`extra`, already formatted by the caller); anything else is the state and its unit.
 */
export function stateText(type: string, st: Reading | undefined, extra?: string): string {
  if (!st || typeof st.state !== "string") return NO_STATE;
  const a = attrsOf(st), s = st.state;
  let text = DECIMAL.test(s.trim()) ? readingText(s, a.unit_of_measurement) : s;
  if ((type === "light" || num(a.brightness) !== null) && s === "on") {
    const b = num(a.brightness);
    if (b !== null) text = `${Math.max(0, Math.min(100, Math.round((b / 255) * 100)))} %`;
  } else if (type === "cover") {
    const p = num(a.current_position);
    if (p !== null) text = `${s} · ${Math.round(p)} %`;
  }
  return extra ? `${text} · ${extra}` : text;
}
