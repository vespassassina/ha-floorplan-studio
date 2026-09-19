import type { CatalogEntry, Layout } from "./schema";

/** Every entity that has an icon on the plan: `entity` and, for a bound light, `bound`. */
export function placedEntities(l: Layout): Set<string> {
  const out = new Set<string>();
  for (const f of Object.values(l.floors))
    for (const d of f.devices) {
      if (d.entity) out.add(d.entity);
      if (d.bound) out.add(d.bound);
    }
  return out;
}

/** Catalog entries not on the plan yet. A bound pair leaves this list together. */
export function unplacedCatalog(l: Layout): CatalogEntry[] {
  const placed = placedEntities(l);
  return l.catalog.filter((c) => !placed.has(c.entity));
}
