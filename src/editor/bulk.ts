import { COORD_LIMIT } from "../core";
import type { Device, Floor } from "../core";

// Bulk device edits (S26.2). Pure like ops.ts: each takes a floor and returns a new one, never touches its input, and
// returns an equal floor when nothing changes, so `EditorState.edit` records no undo step. Junk, duplicate and
// out-of-range indices are ignored. Every result passes `validate`.

/** The distinct, valid indices of `is` into `f.devices`, ascending. Anything else (NaN, a fraction, a negative, past the end, not a list) is dropped. */
function valid(f: Floor, is: unknown): number[] {
  if (!Array.isArray(is)) return [];
  const set = new Set<number>();
  for (const i of is) if (Number.isInteger(i) && i >= 0 && i < f.devices.length) set.add(i);
  return [...set].sort((a, b) => a - b);
}

/**
 * Sets `bound` (the switch that powers the light) on every light in `is`; `""` clears it. Only lights can be bound, so
 * `skipped` counts the listed devices it left alone: non-lights, and a light whose own entity is the one asked for
 * (`validate` refuses that). An entity that is neither `""` nor an entity id like `switch.name` changes nothing.
 */
export function bindLights(f: Floor, is: number[], entity: string): { floor: Floor; skipped: number } {
  const g = structuredClone(f), idx = valid(f, is);
  const clear = entity === "";
  const usable = clear || (typeof entity === "string" && entity.includes("."));
  let skipped = 0;
  for (const i of idx) {
    const d = g.devices[i];
    if (d.type !== "light" || (!clear && d.entity === entity)) { skipped++; continue; }
    if (!usable) continue;
    if (clear) delete d.bound; else d.bound = entity;
  }
  return { floor: g, skipped };
}

/** Removes the devices in `is`. */
export function removeDevices(f: Floor, is: number[]): Floor {
  const g = structuredClone(f), drop = new Set(valid(f, is));
  g.devices = g.devices.filter((_, i) => !drop.has(i));
  return g;
}

const fine = (n: number) => Number.isFinite(n) && Math.abs(n) <= COORD_LIMIT;

/** Moves the devices in `is` by (dx, dy) cm. A locked device stays put; so does one the move would carry past the coordinate limit. A delta that is not finite, or is zero, moves nothing. */
export function moveDevices(f: Floor, is: number[], dx: number, dy: number): Floor {
  const g = structuredClone(f);
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return g;
  for (const i of valid(f, is)) {
    const d: Device = g.devices[i];
    if (d.locked) continue;
    if ("x" in d) {
      if (fine(d.x + dx) && fine(d.y + dy)) { d.x += dx; d.y += dy; }
    } else if (fine(d.a[0] + dx) && fine(d.a[1] + dy) && fine(d.b[0] + dx) && fine(d.b[1] + dy)) {
      d.a = [d.a[0] + dx, d.a[1] + dy];
      d.b = [d.b[0] + dx, d.b[1] + dy];
    }
  }
  return g;
}

/** Locks (`on`) or unlocks the devices in `is`. Unlocking removes the key when it is `true`; a stored `false` is left as written. */
export function lockDevices(f: Floor, is: number[], on: boolean): Floor {
  const g = structuredClone(f);
  for (const i of valid(f, is)) {
    const d = g.devices[i];
    if (on) { if (d.locked !== true) d.locked = true; } else if (d.locked === true) delete d.locked;
  }
  return g;
}

/** The selection after `removed` left `f.devices`: members that were removed are dropped, the rest shift down by how many removed indices lay below them. Ascending, no duplicates; junk is ignored. */
export function reindexAfterRemove(is: number[], removed: number[]): number[] {
  const ok = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0;
  const gone = [...new Set((Array.isArray(removed) ? removed : []).filter(ok))].sort((a, b) => a - b);
  const keep = [...new Set((Array.isArray(is) ? is : []).filter(ok))].filter((i) => !gone.includes(i)).sort((a, b) => a - b);
  return keep.map((i) => i - gone.filter((r) => r < i).length);
}
