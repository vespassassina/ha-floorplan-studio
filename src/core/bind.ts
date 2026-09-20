import type { CatalogEntry, Layout } from "./schema";

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
