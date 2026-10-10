import { COORD_LIMIT, type Layout, type Pt } from "./schema";

/** S27.3: the order of the floors, lowest first: the order of `floors`, as `floorElevation` stacks them. Never throws; junk is no floors. */
function keys(layout: Layout): string[] {
  const f = (layout as any)?.floors;
  return typeof f === "object" && f !== null && !Array.isArray(f) ? Object.keys(f) : [];
}

/** The key of the floor under this one, or null for the lowest floor and for an unknown key. */
export function floorBelow(layout: Layout, key: string): string | null {
  const ks = keys(layout), i = ks.indexOf(key);
  return i > 0 ? ks[i - 1] : null;
}

/** Every key under this one, nearest first. Empty for the lowest floor and for an unknown key. */
export function floorsBelow(layout: Layout, key: string): string[] {
  const ks = keys(layout), i = ks.indexOf(key);
  return i > 0 ? ks.slice(0, i).reverse() : [];
}

/** A floor's offset as two finite numbers within COORD_LIMIT; anything else, and an unknown key, is [0, 0]. */
function offsetOf(layout: Layout, key: string): Pt {
  const floors = (layout as any)?.floors;
  if (!keys(layout).includes(key)) return [0, 0];
  const o = floors[key]?.offset;
  return Array.isArray(o) && o.length === 2 && o.every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= COORD_LIMIT) ? [o[0], o[1]] : [0, 0];
}

/** Centimetres to add to a point of floor `from` to draw it on floor `to`: `from.offset - to.offset`. */
export function floorShift(layout: Layout, from: string, to: string): Pt {
  const a = offsetOf(layout, from), b = offsetOf(layout, to);
  return [a[0] - b[0], a[1] - b[1]];
}
