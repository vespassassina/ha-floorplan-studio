import type { CatalogEntry, Layout } from "../core/schema";

/** One option of the room's sensor picker: the entry and the heading it sits under. */
export interface GroupedChoice { entry: CatalogEntry; group: string }

/**
 * The room panel's add menu, ordered: the room being edited first, then the other rooms of its floor, then the other
 * floors in layout order, each floor's rooms in the floor's own room order, its roomless entries last. An entry with
 * no known floor (an HA entity not yet catalogued, `unattachedHaChoices`) goes at the very end, under its room name or
 * "Elsewhere". Inside a group the incoming order is kept. Heading: "<floor title> · <room>". Never throws on a
 * catalog entry whose floor or room the layout does not know.
 */
export function groupSensorChoices(layout: Layout, choices: readonly CatalogEntry[], floorKey: string, roomName: string): GroupedChoice[] {
  const floorKeys = Object.keys(layout.floors);
  const rank = (e: CatalogEntry): [number, number, number] => {
    const fl = layout.floors[e.floor];
    if (!fl) return [3, 0, 0];
    const rooms = Array.isArray(fl.rooms) ? fl.rooms : [];
    const ri = e.room ? rooms.findIndex((r) => r.name === e.room) : -1;
    const roomRank = e.room ? (ri < 0 ? rooms.length : ri) : rooms.length + 1; // roomless last, unknown rooms just before
    if (e.floor === floorKey) return [e.room === roomName && e.room !== "" ? 0 : 1, 0, roomRank];
    return [2, floorKeys.indexOf(e.floor), roomRank];
  };
  const label = (e: CatalogEntry) => {
    const fl = layout.floors[e.floor];
    if (!fl) return e.room || "Elsewhere";
    return `${fl.title || e.floor} · ${e.room || "No room"}`;
  };
  return choices
    .map((entry, i) => ({ entry, group: label(entry), r: rank(entry), i }))
    .sort((a, b) => a.r[0] - b.r[0] || a.r[1] - b.r[1] || a.r[2] - b.r[2] || (a.group < b.group ? -1 : a.group > b.group ? 1 : 0) || a.i - b.i)
    .map(({ entry, group }) => ({ entry, group }));
}
