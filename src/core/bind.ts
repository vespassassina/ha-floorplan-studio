import type { CatalogEntry, Device, Floor, Layout } from "./schema";

/** Every entity that has an icon of its own on the plan. A light's `bound` switch has none unless it is a device too. */
export function placedEntities(l: Layout): Set<string> {
  const out = new Set<string>();
  for (const f of Object.values(l.floors))
    for (const d of f.devices) {
      if (d.entity) out.add(d.entity);
    }
  return out;
}

/** Catalog entries not on the plan yet. A bound switch stays on it until it is placed as its own icon. */
export function unplacedCatalog(l: Layout): CatalogEntry[] {
  const placed = placedEntities(l);
  return l.catalog.filter((c) => !placed.has(c.entity));
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
