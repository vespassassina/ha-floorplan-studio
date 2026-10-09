import type { Device, Floor, Layout, Pt } from "./schema";
import { MOTION_TYPES } from "./schema";
import { classOf, roomAt, roomList, roomReadout, type StateOverlay } from "./render";
import { attention, attentionItemsOf, type AttentionSource } from "./attention";
import { doorRoomIndex } from "./active";
import { deviceCentre } from "./room-info";
import { stateOf } from "./readings";
import { DEVICE_ICONS } from "./icons";
import { esc, num } from "./fmt";

/**
 * S25.3: what a room's badge counts. `lights` are lamps the plan draws on (`classOf`, so an unavailable lamp is not on,
 * a bound lamp counts through its relay); `motion` are motion sensors and radars that are on, placed or listed in the
 * room, once each; `open` and `alerts` come from `attention` (the card's Overview rule, not copied): `open` is a contact
 * sensor, door or window, or a garage door that stands open, `alerts` is everything else it raises (an alarm, a lock
 * unlocked or jammed, a leak, smoke, a low battery). Unavailable things are neither: they have their own row there.
 * A thing counts once, in the one room it stands in (`roomAt`), a door in the first room it borders.
 */
export interface Rollup { lights: number; alerts: number; open: number; motion: number }

const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** One rollup per room of `f`, by index. Layout and state are untrusted (CLAUDE.md finding 1): junk reads as zero. */
export function floorRollups(f: Floor, state: StateOverlay | undefined, src?: AttentionSource): Rollup[] {
  const rooms = list<Floor["rooms"][number]>(f?.rooms);
  const out: Rollup[] = rooms.map(() => ({ lights: 0, alerts: 0, open: 0, motion: 0 }));
  if (!out.length) return out;
  const safe: Floor = { ...f, rooms, devices: list<Device>(f.devices), doors: list(f.doors), furniture: list(f.furniture) } as Floor;
  const roomOf = (p: Pt | null) => (p ? roomAt(safe, p) : -1);
  const devices = safe.devices;
  const motion = out.map(() => new Set<string>());
  devices.forEach((d) => {
    if (!d || typeof d !== "object") return;
    const i = roomOf(deviceCentre(d));
    if (i < 0 || classOf(d, { scale: 1, state }) !== "on") return;
    if (d.type === "light") out[i]!.lights++;
    else if (MOTION_TYPES.includes(d.type) && !("a" in d) && typeof d.entity === "string") motion[i]!.add(d.entity);
  });
  rooms.forEach((r, i) => { if (r && typeof r === "object") for (const e of roomList(r, "motion")) if (stateOf(state, e)?.state === "on") motion[i]!.add(e); });
  motion.forEach((m, i) => { out[i]!.motion = m.size; });

  // The attention rules, run over this floor alone; each item is placed in a room by the thing it names.
  // With the card's result (run with the entity registry) the badge counts what the Overview lists; without, this floor alone.
  const items = attentionItemsOf(src) ?? attention({ floors: { f: safe } } as unknown as Layout, state).items;
  const seen = new Set<string>();
  for (const it of items) {
    const i = it.at.what === "door" ? doorRoomIndex(safe, it.at.index)
      : it.at.what === "device" ? roomOf(safe.devices[it.at.index] ? deviceCentre(safe.devices[it.at.index]!) : null)
        : roomOf((() => { const m = safe.furniture[it.at.index]; return m && Number.isFinite(m.x) && Number.isFinite(m.y) ? ([m.x, m.y] as Pt) : null; })());
    const key = `${it.at.what}:${it.at.index}:${it.kind === "open" ? "open" : "alert"}`;
    if (i < 0 || seen.has(key)) continue;
    seen.add(key);
    if (it.kind === "open") out[i]!.open++;
    else out[i]!.alerts++;
  }
  return out;
}

/** The rollup of `f.rooms[index]`; zeros when there is no such room. */
export function roomRollup(f: Floor, index: number, state: StateOverlay | undefined): Rollup {
  return floorRollups(f, state)[index] ?? { lights: 0, alerts: 0, open: 0, motion: 0 };
}

/** The chips a badge shows, in order, each with the icon it takes from `icons.ts` and the class the CSS colours it by. */
const CHIPS: { key: keyof Rollup; cls: string; icon: string }[] = [
  { key: "alerts", cls: "rb-alert", icon: DEVICE_ICONS.siren },
  { key: "open", cls: "rb-open", icon: DEVICE_ICONS.contact },
  { key: "lights", cls: "rb-light", icon: DEVICE_ICONS.light },
  { key: "motion", cls: "rb-motion", icon: DEVICE_ICONS.motion },
];

/** What `badges` needs from `renderFloor`: its state and options, its text-size factor `k`, and the room names' placement. */
export interface BadgeCtx {
  f: Floor; state: StateOverlay | undefined; k: number;
  /** The card's attention result, when it has one (`RenderOpts.attention`). */
  attn?: AttentionSource;
  /** Where room `i`'s name sits (baseline anchor and font size), or the room's centroid with size 0 when it has none. */
  anchor: (i: number) => { at: Pt; size: number };
  /** A point `dx`, `dy` on the screen from `a` (the plan may be turned). */
  screenOff: (a: Pt, dx: number, dy: number) => Pt;
  /** The attribute that keeps a thing upright in a turned plan. */
  up: (x: number, y: number) => string;
}

/**
 * S25.3: one compact badge per room that has a non-zero count: a plate with an icon and a number per kind, just under the
 * room's name (and its sensor readout). Drawn by the one draw path, so the editor and the card cannot differ; shown by
 * CSS only at the far and mid detail levels (`[data-detail]`), hidden at near and when the level is not set. Draws no
 * text of a name, so it needs no escape of one; the numbers are ours.
 */
export function badges(c: BadgeCtx): string[] {
  const { k } = c, s = 10 * k, icon = 1.1 * s, pad = 2 * k, gap = 3 * k;
  const out: string[] = [];
  floorRollups(c.f, c.state, c.attn).forEach((r, i) => {
    const chips = CHIPS.filter((h) => r[h.key] > 0);
    if (!chips.length) return;
    const room = c.f.rooms[i]!, { at, size } = c.anchor(i);
    const below = roomReadout(room, c.state) ? 0.25 * size + k + s + 2 * k : 0.25 * size + 2 * k;
    const h = 1.5 * s, [cx, cy] = c.screenOff(at, 0, below + h / 2);
    const label = (n: number) => (n > 99 ? "99+" : String(n));
    const widths = chips.map((h2) => icon + k + label(r[h2.key]).length * 0.6 * s);
    const total = widths.reduce((a, b) => a + b, 0) + gap * (chips.length - 1) + 2 * pad;
    let x = cx - total / 2 + pad;
    const parts = [`<rect class="rb-plate" x="${num(cx - total / 2)}" y="${num(cy - h / 2)}" width="${num(total)}" height="${num(h)}" rx="${num(h / 3)}"/>`];
    chips.forEach((chip, j) => {
      const sc = icon / 24;
      parts.push(`<path class="${chip.cls}" d="${chip.icon}" transform="translate(${num(x)} ${num(cy - icon / 2)}) scale(${num(sc)})"/>`,
        `<text class="rb-t" x="${num(x + icon + k)}" y="${num(cy + 0.35 * s)}" font-size="${num(s)}">${esc(label(r[chip.key]))}</text>`);
      x += widths[j]! + gap;
    });
    out.push(`<g data-rb="${i}" class="room-badge"${c.up(cx, cy)}>${parts.join("")}</g>`);
  });
  return out;
}
