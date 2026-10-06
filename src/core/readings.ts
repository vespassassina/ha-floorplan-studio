import type { StateOverlay } from "./render";
import { meanText } from "./state-text";

/** One entity's state, or `undefined` when there is none. State is untrusted: only an own key holding text counts
 *  (finding 1), so an entity named `__proto__` or a half-built overlay reads as no state, never a throw. */
export function stateOf(state: StateOverlay | undefined, entity: string): StateOverlay[string] | undefined {
  return state && Object.prototype.hasOwnProperty.call(state, entity) && typeof state[entity]?.state === "string" ? state[entity] : undefined;
}

/** Mean of the readable states of `list`, rounded to 0.1 without a trailing zero (`meanText`, so 48 reads "48 %" like a single sensor), in the unit of the first one read; "" when none is readable.
 *  Readings in any other unit are left out, not converted: a mean of 21 °C and 70 °F (45.5) means nothing. The one
 *  function behind a room's readout on the plan (`renderFloor`) and in the card's left panel, so the two can never
 *  show different numbers. */
export function meanReading(list: string[], state: StateOverlay | undefined): string {
  const all = list.flatMap((e) => {
    const s = stateOf(state, e), t = s?.state.trim() ?? "";
    return s && /^-?\d+(\.\d+)?$/.test(t) && Number.isFinite(Number(t)) ? [{ n: Number(t), unit: typeof s.attributes?.unit_of_measurement === "string" ? s.attributes.unit_of_measurement : "" }] : [];
  });
  if (!all.length) return "";
  const unit = all[0].unit, rs = all.filter((r) => r.unit === unit);
  return `${meanText(rs.reduce((n, r) => n + r.n, 0) / rs.length)}${unit ? ` ${unit}` : ""}`;
}
