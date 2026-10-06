import type { Device, DeviceType, Door } from "./schema";

/** Only string, non-empty entries; anything else (untrusted layout, CLAUDE.md finding 1) is silently skipped
 *  rather than thrown on. */
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((e): e is string => typeof e === "string" && e.length > 0) : []);

/**
 * A speaker or TV object stands in for the media player attached to it: the first attached `media_player.*`. Any other
 * type, or one with no player attached, has none. Never throws on a hostile `attached`.
 */
export function playerOf(u: { type: DeviceType; attached?: unknown }): string | undefined {
  if (u.type !== "speaker" && u.type !== "tv") return undefined;
  return strings(u.attached).find((e) => e.startsWith("media_player."));
}

/**
 * S10.4: every entity a tap on this device's icon should offer — more-info directly when this is the only one,
 * a chooser dialog listing all of them otherwise. The device's own `entity` comes first (an Unlinked appliance,
 * S4.25, has none of its own: its `attached` list alone fills this), then its type's own attachments, in the
 * order below; a repeat (the same entity attached twice, or attached but equal to the device's own) is kept once.
 *
 * Every `DeviceType` is a decision (finding 17), not a default:
 * - `light`: neither `bound` nor `motion` is listed. `motion` names the sensor an automation reacts to, not a
 *   second entity this lamp *is* — that sensor is a different real-world device, normally already its own icon
 *   on the plan. `bound` already has its own, different path, documented in docs/SPEC.md: a hold opens more-info
 *   for the light itself, and the bound switch is reachable from inside that dialog (Home Assistant's own
 *   more-info shows related entities) — offering it again here would be a second, competing route to the same
 *   place. See docs/DECISIONS.md.
 * - `heater`: `trvs` then `tempSensors` (S4.24), in that order — the valve(s) before the sensor(s) reading them.
 * - `ac`: `linked`, every climate/TRV entity this unit shares its state with (S4.24).
 * - `radar`: each `targets` pair's `x` then `y` entity, target order preserved (S7.9).
 * - `person`: `room` is left out for the same reason as a light's `motion` — it names the sensor that says
 *   which room the person is in, a different device from the person themselves.
 * - every other type (`switch`, `plug`, `temp`, `humidity`, `motion`, `contact`, `camera`, `climate`, `tv`,
 *   `computer`, `media`, `cover`, `battery`, `inverter`, `server`, `access_point`, `lock`, `vibration`, `other`,
 *   `boiler`, `car`, `ups`, `printer`, `speaker`, `vacuum`): no attachment field of its own, so just its own
 *   `entity`.
 *
 * `attached` (Unlinked, S4.25) is appended for every type, after any type-specific attachment above, since an
 * appliance placed by type rather than by entity can still name reference entities regardless of which type it is.
 */
export function entitiesOfDevice(d: { type: DeviceType; entity?: string } & Partial<Device>): string[] {
  const out: string[] = [];
  const add = (e: string | undefined | null) => { if (e && !out.includes(e)) out.push(e); };
  add(d.entity);
  switch (d.type) {
    case "heater":
      strings(d.trvs).forEach(add);
      strings(d.tempSensors).forEach(add);
      break;
    case "ac":
      strings(d.linked).forEach(add);
      break;
    case "radar":
      for (const t of Array.isArray(d.targets) ? d.targets : []) {
        if (t && typeof t === "object") {
          add(typeof (t as any).x === "string" ? (t as any).x : undefined);
          add(typeof (t as any).y === "string" ? (t as any).y : undefined);
        }
      }
      break;
    default:
      break;
  }
  strings((d as { attached?: unknown }).attached).forEach(add);
  return out;
}

/**
 * S10.4/S10.3-fix: every entity a hold on a door should offer in its chooser, and (a non-cover door only) what a
 * plain tap should offer too — one entity opens more-info directly, more than one the chooser. `cover` comes
 * first when present, then `sensors` (contact), then `vibration`, then `locks` (S4.24 order).
 *
 * A door with a `cover` always opens the confirm dialog on tap (an existing, unrelated rule, S2.7) whatever else
 * is attached, so this list is never consulted for a cover door's tap. It is consulted for that door's *hold*:
 * the maintainer's call is that a hold should reach every entity a door names, the cover included, rather than
 * leaving it reachable only through the tap's own dialog. Earlier the cover was deliberately left out of this
 * list because only tap read it; now that hold reads it too, `cover` belongs in the list it feeds. See
 * docs/DECISIONS.md.
 */
export function entitiesOfDoor(door: Partial<Door>): string[] {
  const out: string[] = [];
  const add = (e: string) => { if (!out.includes(e)) out.push(e); };
  if (typeof door.cover === "string" && door.cover.length > 0) add(door.cover);
  strings(door.sensors).forEach(add);
  strings(door.vibration).forEach(add);
  strings(door.locks).forEach(add);
  return out;
}
