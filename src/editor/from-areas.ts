import { placeableDevicesInArea, type HaData } from "../core";
import type { EdgeKind, Layout, Pt, Room } from "../core/schema";
import { EditorState, emptyLayout } from "./state";

/** S37.2: the side of the room drawn for each area, in cm. Four metres: a lamp, a switch and a sensor fit, and the corners are there to be dragged. */
export const AREA_ROOM_CM = 400;

/**
 * S38.9: two areas may share a name, but the rooms must be told apart (`catalog.room` is the room's name). The first keeps
 * it, the next become "Office 2", "Office 3". Case-insensitive, as the renderer matches room names (`render.ts`). A real
 * area named "Office 2" is never renamed and a generated name never takes it: the next free number is used.
 */
function uniqueRoomNames(names: string[]): string[] {
  const key = (n: string) => n.toLowerCase(), real = new Set(names.map(key)), used = new Set<string>();
  return names.map((name) => {
    let out = name;
    for (let n = 2; used.has(key(out)) || (out !== name && real.has(key(out))); n++) out = `${name} ${n}`;
    used.add(key(out));
    return out;
  });
}

/**
 * S37.2: a first plan from Home Assistant's areas. One AREA_ROOM_CM square per area that has something the plan can draw,
 * on a grid that wraps (as square as it can be, areas by name), a wall on every edge once, linked to the area by its id the way
 * a drawn room is. Each room gets the entities Place would give it (`placeableDevicesInArea`, so one icon per HA device,
 * noise such as a power reading left out, an entity in its own area before its device's): the same code runs, on a scratch
 * state, so the two cannot disagree. The outline is the union of the cells.
 *
 * Returns null when no area has a drawable entity (0 areas included): there is nothing to draw, and a layout with no
 * rooms is not a valid one. The caller still runs the result through `validate`; this never throws.
 */
export function layoutFromAreas(ha: HaData | undefined): Layout | null {
  if (!ha || !Array.isArray(ha.areas) || !Array.isArray(ha.entities)) return null;
  const seen = new Set<string>();
  const areas: { id: string; name: string }[] = [];
  for (const a of ha.areas) {
    if (!a || typeof a.id !== "string" || !a.id || seen.has(a.id)) continue;
    seen.add(a.id);
    areas.push({ id: a.id, name: typeof a.name === "string" && a.name ? a.name : a.id });
  }
  areas.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const blank = emptyLayout();
  const drawn = areas.filter((a) => placeableDevicesInArea(blank, ha, a.id).length > 0);
  if (!drawn.length) return null;
  const names = uniqueRoomNames(drawn.map((a) => a.name));

  const cols = Math.ceil(Math.sqrt(drawn.length)), rows = Math.ceil(drawn.length / cols), S = AREA_ROOM_CM;
  const layout = emptyLayout();
  const floor = layout.floors.ground;
  // The outline is the union of the cells: a rectangle, or an L when the last row is short. Never the box round them,
  // which would wall in the empty corner.
  const last = drawn.length - (rows - 1) * cols; // cells in the short last row, 1..cols
  floor.outline = last === cols
    ? [[0, 0], [cols * S, 0], [cols * S, rows * S], [0, rows * S]]
    : [[0, 0], [cols * S, 0], [cols * S, (rows - 1) * S], [last * S, (rows - 1) * S], [last * S, rows * S], [0, rows * S]];
  floor.owk = floor.outline.map((): EdgeKind => "external");
  // Each wall once: a perimeter edge is "external" (as the outline), a shared edge is a "wall" on the earlier room and
  // "none" on the later one, which stays closed but draws nothing.
  const at = (c: number, r: number) => (c < 0 || r < 0 || c >= cols ? -1 : r * cols + c < drawn.length ? r * cols + c : -1);
  floor.rooms = drawn.map((a, i): Room => {
    const c = i % cols, r = Math.floor(i / cols), x = c * S, y = r * S;
    const pts: Pt[] = [[x, y], [x + S, y], [x + S, y + S], [x, y + S]];
    const across = [at(c, r - 1), at(c + 1, r), at(c, r + 1), at(c - 1, r)]; // the cell over each edge: top, right, bottom, left
    const wk = across.map((j): EdgeKind => (j < 0 ? "external" : j > i ? "wall" : "none"));
    return { id: `room-ground-${i + 1}`, name: names[i], area: a.id, kind: "room", pts, wk };
  });

  // Place's own spreading, on a scratch state that knows HA, one room at a time.
  const st = new EditorState(layout, "ground");
  st.ha = ha;
  drawn.forEach((_, i) => st.placeArea(i));
  return st.layout;
}
