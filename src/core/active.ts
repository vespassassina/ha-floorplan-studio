import { DEVICE_TYPES } from "./schema";
import type { Device, DeviceType, Layout } from "./schema";
import { acMode, classOf, type StateOverlay } from "./render";

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
 *   motion, contact, heater, climate, ac, tv, media, cover, plug, computer, person. The list and the plan can
 *   never disagree about one of these.
 * - `"always"`: camera. A camera is a view, not an on/off thing (the maintainer's own words) — it is always
 *   worth a glance, "streaming" or not.
 * - `"cleaning"`: vacuum. `classOf` reads both "cleaning" and "returning" as one active colour on the plan (S7.10:
 *   `.dev-vacuum.on`), but the maintainer's brief for this list asks only for "vacuums that are cleaning" — a
 *   robot on its way back to the dock is winding down, not something to check. So vacuum is the one type whose
 *   list membership is narrower than its plan colour, not merely reused from it.
 * - `"never"`: every other type — a sensor with no on/off shape of its own (temp, humidity), a plain switch or
 *   lock (not asked for), or a type the card only ever watches through its own dialog (battery, inverter, server,
 *   access_point, boiler, car, ups, printer, radar, other).
 */
export const ACTIVE_LIST_RULE: Record<DeviceType, "on" | "always" | "cleaning" | "never"> = {
  light: "on", motion: "on", contact: "on", heater: "on", climate: "on", ac: "on", tv: "on", media: "on",
  cover: "on", plug: "on", computer: "on", person: "on", speaker: "on",
  camera: "always",
  vacuum: "cleaning",
  switch: "never", temp: "never", humidity: "never", battery: "never", inverter: "never", server: "never",
  access_point: "never", lock: "never", vibration: "never", other: "never", boiler: "never", car: "never",
  ups: "never", printer: "never", radar: "never",
};

/** The `--fp-dev-*` token each type's on colour comes from on the plan (render.ts's `FLOORPLAN_CSS`), so the list's
 *  icon is never a colour invented separately from the one the plan already draws. `ac` is resolved by `acMode`
 *  instead, since it alone carries two (cool/heat). A type with no entry here (every "never"/never-reached one)
 *  falls back to `--fp-idle`, the same grey the plan gives a device with no colour rule of its own. */
const COLOR_VAR: Partial<Record<DeviceType, string>> = {
  light: "--fp-dev-light", motion: "--fp-dev-motion", contact: "--fp-dev-contact", heater: "--fp-dev-heater",
  climate: "--fp-dev-climate", tv: "--fp-dev-tv", media: "--fp-dev-media", cover: "--fp-dev-cover",
  plug: "--fp-dev-plug", computer: "--fp-dev-computer", camera: "--fp-dev-camera", person: "--fp-dev-person",
  vacuum: "--fp-dev-vacuum", speaker: "--fp-dev-speaker",
};

function colorVarFor(d: Device, state: StateOverlay | undefined): string {
  if (d.type === "ac") {
    const mode = acMode(d, { scale: 1, state });
    return mode === "cool" ? "--fp-dev-ac-cool" : "--fp-dev-ac-heat";
  }
  return COLOR_VAR[d.type] ?? "--fp-idle";
}

/** Whether `d` belongs on the active list right now, per `ACTIVE_LIST_RULE`. Untrusted state (CLAUDE.md finding 1):
 *  a missing or malformed entry just reads as off, never thrown on — the same contract `classOf` already keeps. */
function isActive(d: Device, state: StateOverlay | undefined): boolean {
  const rule = ACTIVE_LIST_RULE[d.type];
  if (rule === "always") return true;
  if (rule === "never") return false;
  if (rule === "cleaning") return state?.[d.entity]?.state === "cleaning";
  return classOf(d, { scale: 1, state }) === "on";
}

/** A device's name for the list: its own plan name, else HA's `friendly_name`, else its entity id — the same
 *  fallback order the task asked for, and the only one that can never come up empty. Untrusted state: anything
 *  that is not text is skipped. */
function nameFor(d: Device, state: StateOverlay | undefined): string {
  const friendly = state?.[d.entity]?.attributes?.friendly_name;
  return d.name ?? (typeof friendly === "string" && friendly ? friendly : d.entity);
}

/** Every active device across every floor of `layout` (not only one shown floor: the card can switch floors, this
 *  list must not — CLAUDE.md domain notes). Order follows each floor's own device order, floors in the layout's
 *  own key order; `groupActiveByType` is what the panel actually renders from, in `DEVICE_TYPES` order. */
export function activeDevices(layout: Layout, state: StateOverlay | undefined): ActiveDevice[] {
  const out: ActiveDevice[] = [];
  for (const [floorKey, floor] of Object.entries(layout.floors)) {
    for (const d of floor.devices) {
      if (!isActive(d, state)) continue;
      out.push({ entity: d.entity, name: nameFor(d, state), type: d.type, floor: floorKey, colorVar: colorVarFor(d, state) });
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
