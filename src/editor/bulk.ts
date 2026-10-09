import { COORD_LIMIT, roomAt } from "../core";
import type { Device, Floor } from "../core";
import type { EditorState, Sel } from "./state";

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

/** What Link lights looks at (S26.23): the selected devices, else the selected room, else the whole floor. */
export type LinkScope = { t: "devs"; is: number[] } | { t: "room"; i: number } | { t: "floor" };

/** The scope the current selection gives: devices, else a room, else the floor. Any other selection (a wall, a corner) is the floor. */
export function linkScopeFor(sel: Sel): LinkScope {
  if (sel && sel.t === "devs") return { t: "devs", is: [...sel.is] };
  if (sel && sel.t === "dev") return { t: "devs", is: [sel.i] };
  if (sel && sel.t === "room") return { t: "room", i: sel.i };
  return { t: "floor" };
}

/** One row of the Link preview: light `i` (named `name`, standing in `room`) and the switch `entity` (`switchName`) it would be bound to. */
export interface LinkSuggestion { i: number; name: string; entity: string; switchName: string; room?: string }

/**
 * S26.23: the (light, suggested switch) pairs inside `scope` on the current floor, by the rule `switchChoicesForLight`
 * scores with (the one `autoLinkLights` uses): an unbound light, not a switch wrapped as a light, with a uniquely
 * suggested switch. Ascending by device index. Junk (a bad scope, indices that are not devices, a room that is not there)
 * gives fewer pairs, never a throw; with no Home Assistant data there is nothing to suggest.
 */
export function linkSuggestions(st: EditorState, scope: LinkScope): LinkSuggestion[] {
  const f = st.f, ha = st.ha;
  if (!scope || !ha) return [];
  const wrapped = new Set(ha.entities.filter((e) => e?.domain === "light" && e.platform === "switch_as_x").map((e) => e.id));
  const roomOf = (d: Device) => ("x" in d ? roomAt(f, [d.x, d.y]) : -1);
  const wanted = (d: Device, i: number): boolean => {
    if (scope.t === "floor") return true;
    if (scope.t === "room") return Number.isInteger(scope.i) && scope.i >= 0 && roomOf(d) === scope.i;
    return Array.isArray(scope.is) && scope.is.includes(i);
  };
  const out: LinkSuggestion[] = [];
  f.devices.forEach((d, i) => {
    if (d.type !== "light" || d.bound || wrapped.has(d.entity) || !wanted(d, i)) return;
    const s = st.switchChoicesForLight(i).find((c) => c.suggested);
    if (!s) return;
    const r = roomOf(d);
    out.push({ i, name: d.name || d.entity, entity: s.entity, switchName: s.name, ...(r >= 0 ? { room: f.rooms[r].name } : {}) });
  });
  return out;
}

/** Binds each listed light to its switch. A light that is already bound, a device that is not a light, an index out of range or an entity that is no id is left alone. */
export function applyLinks(f: Floor, links: { i: number; entity: string }[]): Floor {
  const g = structuredClone(f);
  for (const l of Array.isArray(links) ? links : []) {
    const d = l && Number.isInteger(l.i) ? g.devices[l.i] : undefined;
    if (!d || d.type !== "light" || d.bound || typeof l.entity !== "string" || !l.entity.includes(".") || l.entity === d.entity) continue;
    d.bound = l.entity;
  }
  return g;
}
