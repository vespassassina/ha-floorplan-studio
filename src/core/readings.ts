import type { StateOverlay } from "./render";

/** One entity's state, or `undefined` when there is none. State is untrusted: only an own key holding text counts
 *  (finding 1), so an entity named `__proto__` or a half-built overlay reads as no state, never a throw. */
export function stateOf(state: StateOverlay | undefined, entity: string): StateOverlay[string] | undefined {
  return state && Object.prototype.hasOwnProperty.call(state, entity) && typeof state[entity]?.state === "string" ? state[entity] : undefined;
}

/** Mean of the readable states of `list`, rounded to 0.1, with the first unit seen; "" when none is readable.
 *  The one function behind a room's readout on the plan (`renderFloor`) and in the card's left panel, so the two
 *  can never show different numbers. */
export function meanReading(list: string[], state: StateOverlay | undefined): string {
  const rs = list.flatMap((e) => {
    const s = stateOf(state, e), t = s?.state.trim() ?? "";
    return s && /^-?\d+(\.\d+)?$/.test(t) && Number.isFinite(Number(t)) ? [{ n: Number(t), unit: typeof s.attributes?.unit_of_measurement === "string" ? s.attributes.unit_of_measurement : "" }] : [];
  });
  if (!rs.length) return "";
  const unit = rs.find((r) => r.unit)?.unit;
  return `${(Math.round((rs.reduce((n, r) => n + r.n, 0) / rs.length) * 10) / 10).toFixed(1)}${unit ? ` ${unit}` : ""}`;
}
