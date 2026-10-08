import type { Device, DeviceType, Floor, Layout } from "./schema";
import { roomAt, type StateOverlay } from "./render";
import { DEVICE_TYPE_LABELS } from "./icons";
import { nameFor } from "./active";
import { deviceCentre } from "./room-info";
import { pieceDevice } from "./solids";

/**
 * S24.1 (F1, U9): one search for the Studio and the card. An entry is a thing a host can go to: a floor, a room, a
 * device, or a command the host adds itself. It carries what going there needs (floor key, room index, device index
 * or furniture index for a linked piece, entity), so a pick never searches the layout again.
 */
export interface SearchEntry {
  kind: "floor" | "room" | "device" | "command";
  /** Stable key: the floor key, room id, device id, or the host's command id. */
  id: string;
  name: string;
  entity?: string;
  /** The layout's floor key and its title. */
  floor?: string;
  floorName?: string;
  /** For a room, its own index in `floors[floor].rooms`; for a device, the room it stands in (`roomAt`), if any. */
  room?: number;
  roomName?: string;
  /** Index in `floors[floor].devices`, or in `furniture` when `piece` is set (a linked tv, speaker or computer). */
  device?: number;
  piece?: true;
  type?: DeviceType;
  /** "Light", "Room", "Floor": the last part of an option's detail line. */
  typeLabel?: string;
}

/** Lower case, accents off, runs of white space as one: "Salle  à manger" and "salle a manger" are one query. */
export function normalize(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim().replace(/\s+/g, " ");
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;
const text = (x: unknown): string => (typeof x === "string" ? x : "");
const typeLabel = (t: unknown): string => (typeof t === "string" && Object.hasOwn(DEVICE_TYPE_LABELS, t) ? DEVICE_TYPE_LABELS[t as DeviceType] : "Device");

/**
 * Every floor, named room and device of `layout`, floors in the layout's key order, each floor's rooms then devices
 * then linked pieces in their own order. `state` supplies HA friendly names for devices without a plan name (`nameFor`).
 * The layout is untrusted (finding 1): a floor or row of the wrong shape is skipped, never thrown on.
 */
export function layoutEntries(layout: Layout, state: StateOverlay | undefined): SearchEntry[] {
  const out: SearchEntry[] = [];
  const floors = isObj(layout) && isObj(layout.floors) ? Object.entries(layout.floors) : [];
  for (const [key, f] of floors) {
    if (!isObj(f)) continue;
    const floorName = text(f.title) || key;
    const at = { floor: key, floorName };
    out.push({ kind: "floor", id: key, name: floorName, floor: key, typeLabel: "Floor" });
    const rooms = Array.isArray(f.rooms) ? f.rooms : [];
    rooms.forEach((r, i) => {
      if (isObj(r) && text(r.name)) out.push({ kind: "room", id: text(r.id) || `${key}:${i}`, name: r.name, ...at, room: i, typeLabel: "Room" });
    });
    // `roomAt` is the one rule for which room a point is in (render.ts); it skips a junk room itself.
    const safe = { ...f, rooms } as Floor;
    const roomOf = (d: Device) => {
      const c = deviceCentre(d), i = c && d.type !== "person" ? roomAt(safe, c) : -1; // a person moves: no stored room
      const n = i >= 0 ? text(rooms[i]?.name) : "";
      return n ? { room: i, roomName: n } : {};
    };
    const listed = new Set<string>();
    const add = (d: Device, i: number, piece: boolean) => {
      const entity = text(d.entity);
      const name = text(nameFor({ ...d, name: text(d.name) || undefined, entity }, state));
      if (!name) return;
      if (entity) listed.add(entity);
      out.push({ kind: "device", id: text(d.id) || `${key}:${piece ? "f" : "d"}${i}`, name, ...(entity ? { entity } : {}), ...at, ...roomOf(d), device: i, ...(piece ? { piece: true as const } : {}), type: d.type, typeLabel: typeLabel(d.type) });
    };
    (Array.isArray(f.devices) ? f.devices : []).forEach((d, i) => { if (isObj(d)) add(d as Device, i, false); });
    // A linked piece is the device of its type (active.ts does the same); an entity a device already lists is not repeated.
    (Array.isArray(f.furniture) ? f.furniture : []).forEach((m, i) => {
      const d = isObj(m) ? pieceDevice(m as never) : null;
      if (d && !listed.has(d.entity)) add(d, i, true);
    });
  }
  return out;
}

/** "room · floor · type" under an option's name, leaving out what an entry does not have. */
export function entryDetail(e: SearchEntry): string {
  if (e.kind === "command") return "Command";
  if (e.kind === "floor") return "Floor";
  return [e.roomName, e.floorName, e.typeLabel].filter(Boolean).join(" · ");
}

interface Prepared { e: SearchEntry; name: string; words: string[]; entity: string; hay: string; order: number }
/** Entries with their text normalized once, so a query only compares strings. */
export interface SearchIndex { items: Prepared[] }

export function buildSearchIndex(entries: readonly SearchEntry[]): SearchIndex {
  return {
    items: entries.map((e, order) => {
      const name = normalize(text(e.name)), entity = normalize(text(e.entity));
      return {
        e, name, entity, order,
        words: name.split(/[^\p{L}\p{N}]+/u).filter(Boolean),
        hay: [name, entity, normalize(text(e.roomName)), normalize(text(e.floorName)), normalize(text(e.typeLabel))].join(" "),
      };
    }),
  };
}

/** How well `p` matches: 0 exact name (or entity id), 1 name prefix, 2 every word a word prefix, 3 every word in the
 *  name, 4 every word in the entity id, 5 every word somewhere in name, entity, room, floor or type; -1 no match. */
function tier(p: Prepared, q: string, words: string[]): number {
  if (p.name === q || (p.entity && p.entity === q)) return 0;
  if (p.name.startsWith(q)) return 1;
  if (words.every((w) => p.words.some((n) => n.startsWith(w)))) return 2;
  if (words.every((w) => p.name.includes(w))) return 3;
  if (p.entity && words.every((w) => p.entity.includes(w))) return 4;
  if (words.every((w) => p.hay.includes(w))) return 5;
  return -1;
}

/** The entries matching `query`, best first (tier, then the shorter name, then entry order), at most `limit`. A blank
 *  query matches nothing: the box shows results only once something is typed. */
export function searchIndex(index: SearchIndex, query: string, limit = Infinity): SearchEntry[] {
  const q = normalize(typeof query === "string" ? query : "");
  if (!q) return [];
  const words = q.split(" ");
  const hits: { p: Prepared; t: number }[] = [];
  for (const p of index.items) {
    const t = tier(p, q, words);
    if (t >= 0) hits.push({ p, t });
  }
  hits.sort((a, b) => a.t - b.t || a.p.name.length - b.p.name.length || a.p.order - b.p.order);
  return hits.slice(0, Math.max(0, limit)).map((h) => h.p.e);
}
