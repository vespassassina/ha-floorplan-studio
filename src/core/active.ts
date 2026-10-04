import { DEVICE_TYPES } from "./schema";
import type { Device, DeviceType, Door, Layout } from "./schema";
import { acMode, classOf, type RenderOpts, type StateOverlay } from "./render";

/**
 * S9.5: one row the card's floating active-devices panel can show. `floor` is the layout's own floor key (not the
 * shown one — the panel lists every floor at once, CLAUDE.md domain: a card can switch floors, the list must not).
 * `colorVar` is the `--fp-*` custom property (CLAUDE.md finding 9: colours only through these) the row's icon
 * should take its `color` from, already resolved for a device (like `ac`) whose colour depends on its live state.
 */
export interface ActiveDevice {
  entity: string;
  name: string;
  type: DeviceType;
  floor: string;
  colorVar: string;
}

/**
 * Every `DeviceType` is a decision (CLAUDE.md finding 17), written down here rather than left to fall through a
 * catch-all:
 * - `"on"`: listed while `classOf` (the same function `renderFloor` uses to paint the plan) says "on" — light,
 *   motion, contact, heater, climate, ac, tv, media, plug, computer, person, and cover: only a garage door, gate or
 *   door is ever "on" (`coverActive`, Diego 2026-10-03), a curtain or blind is not. The list and the plan can
 *   never disagree about one of these.
 * - `"always"`: camera. A camera is a view, not an on/off thing (the maintainer's own words) — it is always
 *   worth a glance, "streaming" or not.
 * - `"cleaning"`: vacuum. `classOf` reads both "cleaning" and "returning" as one active colour on the plan (S7.10:
 *   `.dev-vacuum.on`), but the maintainer's brief for this list asks only for "vacuums that are cleaning" — a
 *   robot on its way back to the dock is winding down, not something to check. So vacuum is the one type whose
 *   list membership is narrower than its plan colour, not merely reused from it.
 * - `"never"`: every other type — a sensor with no on/off shape of its own (temp, humidity), a plain switch or
 *   lock (not asked for), or a type the card only ever watches through its own dialog (battery, inverter, server,
 *   access_point, boiler, car, ups, printer, other). A radar is "on" like a motion sensor (`MOTION_TYPES`).
 */
export const ACTIVE_LIST_RULE: Record<DeviceType, "on" | "always" | "cleaning" | "never"> = {
  light: "on", motion: "on", contact: "on", heater: "on", climate: "on", ac: "on", tv: "on", media: "on",
  plug: "on", computer: "on", person: "on", speaker: "on",
  camera: "always",
  vacuum: "cleaning",
  cover: "on", switch: "never", temp: "never", humidity: "never", battery: "never", inverter: "never", server: "never",
  access_point: "never", lock: "never", vibration: "never", other: "never", boiler: "never", car: "never",
  ups: "never", printer: "never",
  radar: "on", // a radar that sees someone is motion like any other (MOTION_TYPES); it was "never" until 0.12.24
};

/** The `--fp-dev-*` token each type's on colour comes from on the plan (render.ts's `FLOORPLAN_CSS`), so the list's
 *  icon is never a colour invented separately from the one the plan already draws. `ac` is resolved by `acMode`
 *  instead, since it alone carries two (cool/heat). A type with no entry here (every "never"/never-reached one)
 *  falls back to `--fp-idle`, the same grey the plan gives a device with no colour rule of its own.
 *
 *  Opus review finding 10: `camera` is deliberately not `--fp-dev-camera` here. On the plan, that token tints a
 *  camera icon against the room it sits in, and `theme-roles.ts` sets it to the same shade as `--fp-idle`
 *  (`rolesToTokens`'s `shades.idle`) for every generated theme. The panel row's own background is `--fp-room`
 *  (`.fp-active` in floorplan-studio-card.ts), and in blueprint (a dark navy base) `--fp-idle` sits close enough
 *  in lightness to `--fp-room` that the camera row read as a dark blue icon on navy - hard to make out. `--fp-ink`
 *  is the row's own text colour (`.fp-active{color:var(--fp-ink)}`), already relied on to read against
 *  `--fp-room` in every theme, so the camera row borrows it instead of a plan token never meant for this
 *  background. */
const COLOR_VAR: Partial<Record<DeviceType, string>> = {
  light: "--fp-dev-light", motion: "--fp-dev-motion", contact: "--fp-dev-contact", heater: "--fp-dev-heater",
  climate: "--fp-dev-climate", tv: "--fp-dev-tv", media: "--fp-dev-media",
  plug: "--fp-dev-plug", computer: "--fp-dev-computer", camera: "--fp-ink", person: "--fp-dev-person",
  vacuum: "--fp-dev-vacuum", speaker: "--fp-dev-speaker", radar: "--fp-dev-radar",
};

/** What `renderFloor` takes besides state, so the list reads a plug exactly as the plan does. */
export type ActiveOpts = Pick<RenderOpts, "plugWatts" | "powerLinks">;

export function colorVarFor(d: Device, state: StateOverlay | undefined): string {
  if (d.type === "ac") {
    const mode = acMode(d, { scale: 1, state });
    return mode === "cool" ? "--fp-dev-ac-cool" : "--fp-dev-ac-heat";
  }
  return COLOR_VAR[d.type] ?? "--fp-idle";
}

/** Whether `d` belongs on the active list right now, per `ACTIVE_LIST_RULE`. Untrusted state (CLAUDE.md finding 1):
 *  a missing or malformed entry just reads as off, never thrown on — the same contract `classOf` already keeps. */
function isActive(d: Device, state: StateOverlay | undefined, opts: ActiveOpts): boolean {
  // Opus review finding 9: an empty entity has nothing to open more-info on and nothing HA reports state for —
  // never list it, whatever ACTIVE_LIST_RULE says for its type.
  if (typeof d.entity !== "string" || !d.entity) return false;
  const rule = ACTIVE_LIST_RULE[d.type];
  const s = state?.[d.entity]?.state;
  if (s === "unavailable" || s === "unknown") return false;
  if (rule === "always") return true;
  if (rule === "never") return false;
  if (rule === "cleaning") return s === "cleaning";
  return classOf(d, { scale: 1, state, ...opts }) === "on";
}

/** A device's name for the list: its own plan name, else HA's `friendly_name`, else its entity id — the same
 *  fallback order the task asked for, and the only one that can never come up empty. Untrusted state: anything
 *  that is not text is skipped. */
export function nameFor(d: Device, state: StateOverlay | undefined): string {
  const friendly = state?.[d.entity]?.attributes?.friendly_name;
  return d.name ?? (typeof friendly === "string" && friendly ? friendly : d.entity);
}

/** S10.3: a contact or vibration sensor attached to a door (not placed as its own device icon) still belongs on
 *  the list when it is on, under the door's own name, so pulling a sensor off the plan into a door (S10.3's other
 *  half) never makes it vanish from here. `field` picks which of the door's own entity lists to read; `placed` is
 *  every entity that already has a device icon somewhere in the layout, so that one is never listed twice. */
function doorAttachedRows(door: Door, field: "sensors" | "vibration", state: StateOverlay | undefined, placed: ReadonlySet<string>, floorKey: string): ActiveDevice[] {
  const type: DeviceType = field === "sensors" ? "contact" : "vibration";
  const list = door[field];
  if (!Array.isArray(list)) return [];
  const out: ActiveDevice[] = [];
  for (const e of list) {
    if (typeof e !== "string" || !e || placed.has(e)) continue;
    if (state?.[e]?.state !== "on") continue;
    out.push({ entity: e, name: door.name ?? e, type, floor: floorKey, colorVar: "--fp-open-door" });
  }
  return out;
}

/** Every active device across every floor of `layout` (not only one shown floor: the card can switch floors, this
 *  list must not — CLAUDE.md domain notes). Order follows each floor's own device order, floors in the layout's
 *  own key order; `groupActiveByType` is what the panel actually renders from, in `DEVICE_TYPES` order. */
export function activeDevices(layout: Layout, state: StateOverlay | undefined, opts: ActiveOpts = {}): ActiveDevice[] {
  const out: ActiveDevice[] = [];
  // S10.3: an entity already drawn as its own device icon is never repeated as a door row, whichever floor either
  // one is on - built once, over every floor, before the per-floor loop below reads it.
  const placed = new Set<string>();
  for (const floor of Object.values(layout.floors)) {
    for (const d of floor.devices) if (typeof d.entity === "string" && d.entity) placed.add(d.entity);
  }
  for (const [floorKey, floor] of Object.entries(layout.floors)) {
    for (const d of floor.devices) {
      if (!isActive(d, state, opts)) continue;
      out.push({ entity: d.entity, name: nameFor(d, state), type: d.type, floor: floorKey, colorVar: colorVarFor(d, state) });
    }
    for (const door of floor.doors ?? []) {
      out.push(...doorAttachedRows(door, "sensors", state, placed, floorKey));
      out.push(...doorAttachedRows(door, "vibration", state, placed, floorKey));
    }
  }
  return out;
}

/** `items` grouped by type, in `DEVICE_TYPES`' own fixed order, dropping any type with nothing active — the panel's
 *  "grouped by type, with a small type heading" (S9.5). */
export function groupActiveByType(items: ActiveDevice[]): [DeviceType, ActiveDevice[]][] {
  const byType = new Map<DeviceType, ActiveDevice[]>();
  for (const it of items) {
    const arr = byType.get(it.type);
    if (arr) arr.push(it);
    else byType.set(it.type, [it]);
  }
  return DEVICE_TYPES.filter((t) => byType.has(t)).map((t) => [t, byType.get(t)!]);
}
