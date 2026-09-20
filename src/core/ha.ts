import type { Layout } from "./schema";

/** What the host (the HA panel) knows about Home Assistant and hands to the editor. Standalone there is none. */
export interface HaData {
  floors: { id: string; name: string }[];
  areas: { id: string; name: string; floor_id?: string }[];
  entities: { id: string; name: string; domain: string }[];
}

const nameIn = (list: { id: string; name: string }[] | undefined, id: unknown): string | undefined => {
  const hit = Array.isArray(list) && typeof id === "string" && id ? list.find((x) => x?.id === id) : undefined;
  return typeof hit?.name === "string" && hit.name ? hit.name : undefined;
};

/**
 * Copies the layout with every linked name refreshed from HA: `floor.title` from the floor `floor.ha` names, `room.name` from
 * the area `room.area` names. A floor with no `ha`, a room with an empty or unknown `area`, and every other field stay as they were.
 * `changed` counts the names that differed. The input is never mutated.
 */
export function applyHaNames(l: Layout, ha: HaData): { layout: Layout; changed: number } {
  const layout = structuredClone(l);
  let changed = 0;
  for (const f of Object.values(layout.floors)) {
    const t = nameIn(ha.floors, f.ha);
    if (t !== undefined && t !== f.title) { f.title = t; changed++; }
    for (const r of f.rooms) {
      const n = nameIn(ha.areas, r.area);
      if (n !== undefined && n !== r.name) { r.name = n; changed++; }
    }
  }
  return { layout, changed };
}
