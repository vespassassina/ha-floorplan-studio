import { ROOM_CORNERS, type Device, type DeviceType, type Floor, type Pt, type RoomCorner } from "./schema";
import { acMode, roomAt, classOf, inside, polyCentre, ROOM_OWNS, type RenderOpts, type StateOverlay } from "./render";
import { DEVICE_ICONS } from "./icons";
import { esc, num } from "./fmt";
import { stateOf } from "./readings";
import { meanText } from "./state-text";
import { plugThreshold, wattsOf } from "./power";
import { formatAge } from "./room-info";
import { t } from "./i18n";

/** B55.2 (docs/specs/batch-s52.md F33): a room's badges, left to right. */
export const BADGE_KINDS = ["lights", "climate", "motion", "energy"] as const;
export type BadgeKind = (typeof BADGE_KINDS)[number];

/**
 * Which badge a device of each type feeds, or null for none. A Record over `DeviceType`, so a new type does not compile until it is
 * decided here, and a test walks `DEVICE_TYPES` (finding 17). The energy badge reads the room's `power` and `water` lists, not devices.
 */
export const BADGE_OF: Record<DeviceType, BadgeKind | null> = {
  light: "lights",
  climate: "climate", heater: "climate", ac: "climate",
  motion: "motion", radar: "motion",
  switch: null, plug: null, temp: null, humidity: null, contact: null, camera: null, tv: null, computer: null, media: null, cover: null, battery: null,
  inverter: null, server: null, access_point: null, lock: null, vibration: null, other: null, boiler: null, car: null, ups: null, printer: null,
  speaker: null, person: null, vacuum: null, siren: null, alarm: null, fan: null, screen: null,
};

/** One icon's worth: lit or not, its colour tone (climate only) and the rows of its bubble. Plain text; whoever draws it escapes it. */
export interface BadgeInfo { kind: BadgeKind; title: string; on: boolean; tone: "" | "heat" | "cool"; rows: string[] }
export type BadgeOpts = Pick<RenderOpts, "state" | "now" | "plugWatts">;

const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : []);

/** The devices of kind `kind` whose icon sits in room `ri` (the room `roomAt` gives a tap, so the plan and the badge agree). */
function devicesOf(f: Floor, ri: number, kind: BadgeKind): Device[] {
  return (Array.isArray(f?.devices) ? f.devices : []).filter((d) => d && typeof d === "object" && BADGE_OF[d.type] === kind && "x" in d && roomAt(f, [d.x, d.y]) === ri);
}

/** The badges room `ri` has a source for, in drawing order. Needs no states, so the plan can place the icons before any state arrives. */
export function badgeKinds(f: Floor, ri: number): BadgeKind[] {
  const r = Array.isArray(f?.rooms) ? f.rooms[ri] : undefined;
  if (!r || typeof r !== "object") return [];
  const has: Record<BadgeKind, boolean> = {
    lights: devicesOf(f, ri, "lights").length > 0,
    climate: devicesOf(f, ri, "climate").length > 0,
    motion: ids(r.motion).length > 0 || devicesOf(f, ri, "motion").length > 0,
    energy: ids(r.power).length > 0 || ids(r.water).length > 0,
  };
  return BADGE_KINDS.filter((k) => has[k]);
}

const label = (d: Device) => (typeof d.name === "string" && d.name ? d.name : d.entity);
/** With several sources each row says whose it is; with one the title already does. */
const named = (many: boolean, who: string, text: string) => (many ? `${who}: ${text}` : text);
const NUMBER = /^-?\d+(\.\d+)?$/;
const degrees = (v: unknown): string | null => (typeof v === "number" && Number.isFinite(v) ? `${meanText(v)} °C` : null);

function lightsInfo(f: Floor, ri: number, o: RenderOpts): BadgeInfo {
  const all = devicesOf(f, ri, "lights"), on = all.filter((d) => classOf(d, o) === "on");
  return { kind: "lights", title: t("Lights"), on: on.length > 0, tone: "", rows: [t("{on} of {n} on", { on: on.length, n: all.length }), ...on.map(label)] };
}

/** What one climate device is doing: heating or cooling by `acMode` (the rule the plan's air icon uses), else idle, off or unavailable. */
function climateRow(d: Device, o: RenderOpts): { tone: "" | "heat" | "cool"; text: string } {
  const s = stateOf(o.state, d.entity);
  if (!s || s.state === "unavailable" || s.state === "unknown") return { tone: "", text: t("Unavailable") };
  if (s.state === "off") return { tone: "", text: t("Off") };
  const mode = acMode(d, o), a = s.attributes ?? {};
  const to = degrees(a.temperature), now = degrees(a.current_temperature);
  const action = mode === "heat" ? t("Heating") : mode === "cool" ? t("Cooling") : t("Idle");
  const text = to && now ? t("{action} to {to}, now {now}", { action, to, now }) : to ? t("{action} to {to}", { action, to }) : now ? t("{action}, now {now}", { action, now }) : action;
  return { tone: mode === "heat" ? "heat" : mode === "cool" ? "cool" : "", text };
}

function climateInfo(f: Floor, ri: number, o: RenderOpts): BadgeInfo {
  const all = devicesOf(f, ri, "climate"), rows = all.map((d) => ({ d, ...climateRow(d, o) }));
  const tone = rows.some((r) => r.tone === "heat") ? "heat" : rows.some((r) => r.tone === "cool") ? "cool" : "";
  return { kind: "climate", title: t("Climate"), on: tone !== "", tone, rows: rows.map((r) => named(all.length > 1, label(r.d), r.text)) };
}

function motionInfo(f: Floor, ri: number, o: RenderOpts, now: number): BadgeInfo {
  const sources = [...new Set([...ids(f.rooms[ri].motion), ...devicesOf(f, ri, "motion").map((d) => d.entity).filter((e) => typeof e === "string" && e !== "")])];
  const live = sources.map((e) => stateOf(o.state, e)).filter((s): s is NonNullable<typeof s> => !!s && s.state !== "unavailable" && s.state !== "unknown");
  const title = t("Motion");
  if (live.some((s) => s.state === "on")) return { kind: "motion", title, on: true, tone: "", rows: [t("Motion now")] };
  // An off sensor's last_changed is when its motion ended. In a replay `now` is the replay time, so the age counts back from there.
  const last = Math.max(...live.map((s) => Date.parse(s.last_changed)).filter((n) => Number.isFinite(n)), -Infinity);
  if (last === -Infinity) return { kind: "motion", title, on: false, tone: "", rows: [t("No motion recorded")] };
  const age = formatAge(new Date(Math.min(last, now)).toISOString(), now); // a change stamped after `now` (clock skew) reads as just now, never a negative age
  return { kind: "motion", title, on: false, tone: "", rows: [age === t("now") ? t("Just now") : t("{age} ago", { age })] };
}

function energyInfo(f: Floor, ri: number, o: RenderOpts): BadgeInfo {
  const r = f.rooms[ri];
  const watts = ids(r.power).map((e) => wattsOf(stateOf(o.state, e))).filter((w): w is number => w !== null);
  const rows: string[] = [];
  if (watts.length) rows.push(t("{n} kW", { n: (watts.reduce((a, b) => a + b, 0) / 1000).toFixed(2) }));
  const water = ids(r.water).flatMap((e) => {
    const s = stateOf(o.state, e), v = s?.state.trim() ?? "";
    if (!s || !NUMBER.test(v)) return [];
    const unit = typeof s.attributes?.unit_of_measurement === "string" ? s.attributes.unit_of_measurement : "";
    const who = typeof s.attributes?.friendly_name === "string" && s.attributes.friendly_name ? s.attributes.friendly_name : e;
    return [{ who, text: unit ? `${v} ${unit}` : v }];
  });
  for (const w of water) rows.push(named(water.length > 1, w.who, w.text));
  return {
    kind: "energy", title: t("Energy"), tone: "", rows: rows.length ? rows : [t("No reading")],
    on: watts.length > 0 && watts.reduce((a, b) => a + b, 0) > plugThreshold(o.plugWatts), // "more than", unlike a plug's "at least": the room is drawing, not just switched on
  };
}

/**
 * B55.2 (F35, F38): the badges of room `ri` and what each bubble says, for the states in `opts.state`. `opts.now` is the clock, or the
 * replay time in a replay, so "last motion" counts back from the moment on show. Never throws on a bad layout or state (finding 1).
 */
export function badgeInfo(f: Floor, ri: number, opts: BadgeOpts): BadgeInfo[] {
  const kinds = badgeKinds(f, ri);
  if (!kinds.length) return [];
  const now = typeof opts.now === "number" && Number.isFinite(opts.now) ? opts.now : Date.now();
  const state = opts.state && typeof opts.state === "object" ? (opts.state as StateOverlay) : undefined;
  const o = { ...opts, state, now } as RenderOpts;
  return kinds.map((k) => (k === "lights" ? lightsInfo(f, ri, o) : k === "climate" ? climateInfo(f, ri, o) : k === "motion" ? motionInfo(f, ri, o, now) : energyInfo(f, ri, o)));
}

// ---- B55.3 (F34, F36): the badges on the plan. Sizes are screen px; `kt` turns them into plan cm.
const R_PX = 9, GAP_PX = 4, INSET_PX = 8, SLIDE_STEPS = 32;
const BOLT = "M7,2V13H10V22L17,10H13L17,2H7Z"; // MDI "flash": DEVICE_ICONS has no energy glyph and the card imports no icon set at runtime
const ICON_PATH: Record<BadgeKind, string> = { lights: DEVICE_ICONS.light, climate: DEVICE_ICONS.climate, motion: DEVICE_ICONS.motion, energy: BOLT };

export interface BadgeDraw { f: Floor; o: RenderOpts; kt: number; up: (x: number, y: number) => string; editor: boolean }

/** Centres of `n` icons in a corner of the box, left to right in plan axes. */
function rowAt(box: [number, number, number, number], corner: RoomCorner, n: number, kt: number): Pt[] {
  const [x0, y0, x1, y1] = box, edge = (INSET_PX + R_PX) * kt, pitch = (2 * R_PX + GAP_PX) * kt;
  const y = corner[0] === "n" ? y0 + edge : y1 - edge;
  const first = corner[1] === "w" ? x0 + edge : x1 - edge - (n - 1) * pitch;
  return Array.from({ length: n }, (_, i) => [first + i * pitch, y] as Pt);
}

/** The row, slid along the line to the label point just far enough that every icon is inside the room (an L-room's empty corner). */
function placed(pts: Pt[], row: Pt[], kt: number): Pt[] {
  // "Inside" means the whole disc: the centre and its four sides, so an icon never sits on a wall.
  const reach = R_PX * kt, clear = (c: Pt) => ([[0, 0], [reach, 0], [-reach, 0], [0, reach], [0, -reach]] as Pt[]).every(([dx, dy]) => inside([c[0] + dx, c[1] + dy], pts));
  if (row.every(clear)) return row;
  const mid: Pt = [row.reduce((s, c) => s + c[0], 0) / row.length, row[0][1]], to = polyCentre(pts);
  const slid = (t: number) => row.map((c) => [c[0] + (to[0] - mid[0]) * t, c[1] + (to[1] - mid[1]) * t] as Pt);
  for (let s = 1; s < SLIDE_STEPS; s++) if (slid(s / SLIDE_STEPS).every(clear)) return slid(s / SLIDE_STEPS);
  return slid(1);
}

/** SVG for the badges of every room that asks for them. The card and the editor both come here (finding 8). Never throws on junk (finding 1). */
export function roomBadges(d: BadgeDraw): string[] {
  const out: string[] = [], rooms = Array.isArray(d.f?.rooms) ? d.f.rooms : [];
  rooms.forEach((room, ri) => {
    const corner = room?.badges?.corner;
    if (!room || !ROOM_OWNS[room.kind] || !(ROOM_CORNERS as readonly unknown[]).includes(corner)) return;
    const p = room.pts;
    if (!Array.isArray(p) || p.length < 3 || !p.every((q) => Array.isArray(q) && Number.isFinite(q[0]) && Number.isFinite(q[1]))) return;
    const infos = badgeInfo(d.f, ri, d.o);
    if (!infos.length) return;
    const box: [number, number, number, number] = [Math.min(...p.map((q) => q[0])), Math.min(...p.map((q) => q[1])), Math.max(...p.map((q) => q[0])), Math.max(...p.map((q) => q[1]))];
    const centres = placed(p, rowAt(box, corner as RoomCorner, infos.length, d.kt), d.kt);
    infos.forEach((b, i) => {
      const [cx, cy] = centres[i], r = R_PX * d.kt, s = (r * 1.3) / 24; // the glyph is a 24-unit box; 1.3 radii across leaves a margin inside the disc
      const cls = ["cb", `cb-${b.kind}`, b.on ? "on" : "", b.tone ? `cb-${b.tone}` : "", d.editor ? "cb-ed" : ""].filter(Boolean).join(" ");
      out.push(`<g class="${cls}" data-cb="${ri}:${b.kind}" role="img" aria-label="${esc(b.title)}"${d.up(cx, cy)}><circle class="cb-bg" cx="${num(cx)}" cy="${num(cy)}" r="${num(r)}"/><path class="cb-i" d="${ICON_PATH[b.kind]}" transform="translate(${num(cx - 12 * s)} ${num(cy - 12 * s)}) scale(${num(s)})"/></g>`);
    });
  });
  return out;
}
