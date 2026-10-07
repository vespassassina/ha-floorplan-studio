import type { CatalogEntry, Device, Floor, Layout } from "./schema";

/** Every entity that has an icon of its own on the plan, or a furniture piece tracking it (S18.11). A light's `bound` switch has none unless it is a device too. */
export function placedEntities(l: Layout): Set<string> {
  const out = new Set<string>();
  for (const f of Object.values(l.floors))
    for (const d of f.devices) {
      if (d.entity) out.add(d.entity);
    }
  for (const f of Object.values(l.floors))
    for (const m of f.furniture ?? []) if (typeof m?.entity === "string" && m.entity) out.add(m.entity);
  return out;
}

/** Adds `v` to `out` when it is a non-empty string — a door's single-entity `cover` field. Untrusted input
 *  (finding 1): anything else (a number, an object, a stray array where a string was expected) is skipped. */
function pushEntity(v: unknown, out: Set<string>): void {
  if (typeof v === "string" && v) out.add(v);
}

/** Adds every string member of `v` to `out` — a list field (`sensors`, `vibration`, `locks`, `trvs`, `tempSensors`,
 *  `linked`, `attached`). Untrusted input (finding 1): `v` not being an array (a stray string, say, where a list
 *  was expected) and any non-string member are both silently skipped, never thrown on. */
function pushEntityList(v: unknown, out: Set<string>): void {
  if (!Array.isArray(v)) return;
  for (const x of v) if (typeof x === "string" && x) out.add(x);
}

/**
 * S10.5: every entity attached to something else on the plan — a door's `sensors`/`vibration`/`locks`/`cover`, a
 * heater's `trvs`/`tempSensors`, an ac's `linked` climates, and an unlinked item's `attached` list. Each of these
 * loses its own device icon the moment it is attached (`EditorState.attachEntity` pulls it off every floor), so an
 * attached entity must never be offered to place again while it stays attached: it is "in use", not "unplaced".
 *
 * A light's `bound` switch and `motion` link, a person's `room` sensor and a radar's `targets` pairs are NOT
 * attachments here — none of those fields goes through `attachEntity`, none of them ever removes an icon, so each
 * one stays independently placeable the way it always has (a switch may keep its own icon, CLAUDE.md domain notes).
 *
 * Layout files are untrusted input (finding 1): a malformed floor, a `sensors` that is not an array, a non-string
 * member — none of it throws, it is simply not counted as attached.
 */
export function attachedEntities(l: Layout): Set<string> {
  const out = new Set<string>();
  if (!l || typeof l !== "object" || !l.floors || typeof l.floors !== "object") return out;
  for (const f of Object.values(l.floors)) {
    if (!f || typeof f !== "object") continue;
    if (Array.isArray((f as Partial<Floor>).doors)) {
      for (const d of (f as Floor).doors) {
        if (!d || typeof d !== "object") continue;
        pushEntityList((d as any).sensors, out);
        pushEntityList((d as any).vibration, out);
        pushEntityList((d as any).locks, out);
        pushEntity((d as any).cover, out);
      }
    }
    if (Array.isArray((f as Partial<Floor>).rooms)) {
      for (const r of (f as Floor).rooms) {
        if (!r || typeof r !== "object") continue;
        pushEntityList((r as any).temps, out);
        pushEntityList((r as any).humidity, out);
        pushEntityList((r as any).motion, out);
      }
    }
    if (Array.isArray((f as Partial<Floor>).devices)) {
      for (const d of (f as Floor).devices) {
        if (!d || typeof d !== "object") continue;
        pushEntityList((d as any).trvs, out);
        pushEntityList((d as any).tempSensors, out);
        pushEntityList((d as any).linked, out);
      }
    }
    if (Array.isArray((f as Partial<Floor>).unlinked)) {
      for (const u of (f as Floor).unlinked) {
        if (!u || typeof u !== "object") continue;
        pushEntityList((u as any).attached, out);
      }
    }
  }
  return out;
}

/** Catalog entries not on the plan yet and not attached to anything else. A bound switch stays offered until it is
 *  placed as its own icon (`bound` is not an attachment, see `attachedEntities`); an attached sensor is not offered
 *  again until it is detached. */
export function unplacedCatalog(l: Layout): CatalogEntry[] {
  const placed = placedEntities(l), attached = attachedEntities(l);
  return l.catalog.filter((c) => !placed.has(c.entity) && !attached.has(c.entity));
}

/**
 * S4.5: the shared kind of a multi-device selection, when every one is a placed, entity-bound light, or every one is a
 * placed motion sensor — two or more, all the same kind. Anything else (a mix, a single device, an unbound one, any
 * other type) has no shared kind, which is exactly when "Create group" has nothing to offer.
 */
export function groupKind(f: Floor, is: number[]): "light" | "motion" | undefined {
  const devs = is.map((i) => f.devices[i]).filter((d): d is Device => !!d && !("a" in d) && !!d.entity);
  if (devs.length < 2 || devs.length !== is.length) return undefined;
  const kind = devs[0].type;
  if (kind !== "light" && kind !== "motion") return undefined;
  return devs.every((d) => d.type === kind) ? kind : undefined;
}
