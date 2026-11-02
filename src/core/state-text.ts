// S14.2 item 17: the one text a device's state is written in, for the plan's readouts, the tap popup and the hover tooltip.
// The plan's rule (render.ts) is the state Home Assistant sends plus its unit, with "–" for what is not a number; every
// other place calls this, so "48 %" is never "48.0 %" in one of them. Everything read here is untrusted (finding 1).

import { carStatus, carText } from "./car-status";
import { mark, t } from "./i18n";

/** G9: the host's text for an entity's state ("21.5 °C", "Heat/Cool"), or undefined to fall back to the raw state. The card wraps `hass.formatEntityState`; core never sees hass. */
export type StateFormatter = (entity: string) => string | undefined;

const DECIMAL =/^-?\d+(\.\d+)?$/;
const NO_STATE = mark("no state");

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
export function stateText(type: string, st: Reading | undefined, extra?: string, entity?: string, format?: StateFormatter): string {
  // S35.3: a car's line is the car text. Given the reading's entity id (its domain says whether it is the tracker); else as any state.
  if (type === "car" && entity && st && typeof st.state === "string") {
    const line = carText(carStatus({ entity }, { [entity]: st }));
    if (line) return extra ? `${line} · ${extra}` : line;
  }
  if (!st || typeof st.state !== "string") return t(NO_STATE);
  const a = attrsOf(st), s = st.state;
  let text = DECIMAL.test(s.trim()) ? readingText(s, a.unit_of_measurement) : s;
  // G9: the host's own wording (display precision, translated enum states) wins over the raw state; the light and cover lines below still win over it.
  const formatted = entity && format ? format(entity) : undefined;
  if (formatted) text = formatted;
  if ((type === "light" || num(a.brightness) !== null) && s === "on") {
    const b = num(a.brightness);
    if (b !== null) text = `${Math.max(0, Math.min(100, Math.round((b / 255) * 100)))} %`;
  } else if (type === "cover") {
    const p = num(a.current_position);
    if (p !== null) text = `${s} · ${Math.round(p)} %`;
  }
  return extra ? `${text} · ${extra}` : text;
}
