import { DEVICE_ICONS, FURNITURE } from "./icons";
import { stairSteps } from "./geometry";
import { DEVICE_TYPES } from "./schema";
import type { Device, DeviceType, EdgeKind, Floor, Layout, Pt, Stairs } from "./schema";

export interface StateOverlay { [entityId: string]: { state: string; attributes: Record<string, unknown>; last_changed: string } }
export interface RenderOpts {
  scale: number; selection?: { t: string; i: number } | null; showNames?: boolean; filter?: DeviceType | "";
  state?: StateOverlay; now?: number; fade?: number; roomGlow?: boolean; editor?: boolean;
  /** Turns the whole drawing by `deg` (clockwise) about `pivot`; names, values and icons are turned back so they stay upright. */
  rotate?: { deg: number; pivot: Pt };
  /** `layout.colors`: a colour per device type, set as `--fp-dev-<type>` on a group round the drawing. */
  colors?: Layout["colors"];
}

/** The colour each device type has when `layout.colors` says nothing: the `--fp-dev-*` defaults below; types with none of their own use the idle grey. */
export const DEVICE_COLOURS: Record<DeviceType, string> = {
  heater: "#e8801a", light: "#e0a800", switch: "#8b8578", plug: "#2c7fb8", temp: "#8b8578", humidity: "#8b8578", motion: "#d64545",
  contact: "#d64545", camera: "#4a4a48", climate: "#e8801a", ac: "#2c7fb8", tv: "#2c7fb8", computer: "#2c7fb8", media: "#8b8578",
  cover: "#8b8578", other: "#8b8578",
};

/** Default colours. Hosts (card, editor) override the --fp-* variables. Kept out of the markup on purpose. */
export const FLOORPLAN_CSS = `
:host,.fp{--fp-ink:#2b2a27;--fp-bg:#f4f0e6;--fp-room:#e9e3d3;--fp-garden:#9db98a;--fp-terrace:#cdb094;--fp-pavement:#c9c6bf;--fp-wall:#2b2a27;--fp-idle:#8b8578;
--fp-on:#e0a800;--fp-open:#f28c28;--fp-motion:#d64545;--fp-heater:#e8801a;--fp-door:#a5601c;--fp-glass:#1b9e77;--fp-window:#2c7fb8;--fp-sealed:#9a8f80;--fp-water:#a9cfe3;--fp-fill:#c4c0b8;--fp-fill-line:#9a958b;
--fp-tread:#8b8578;--fp-dev-light:#e0a800;--fp-dev-motion:#d64545;--fp-dev-contact:#d64545;--fp-dev-heater:#e8801a;--fp-dev-climate:#e8801a;--fp-dev-ac-cool:#2c7fb8;--fp-dev-ac-heat:#e8801a;--fp-dev-tv:#2c7fb8;--fp-dev-plug:#2c7fb8;--fp-dev-computer:#2c7fb8;--fp-dev-camera:#4a4a48;--fp-dev-garden:#3f8f4f;--fp-halo:#8b8578;--fp-alpha:.25;--fp-disc:#fff;--fp-disc-alpha:.75;--fp-outline:#fff;--fp-text:#3a3a3a;--fp-warn:#f28c28;--fp-danger:#b02a2a;--fp-primary:#1f6699;--fp-wall-external:#1a1917;--fp-wall-fence:#7a5c3a;--fp-wall-edge:#a29e94}
/* A room with its own colour carries a fill attribute; the :not([fill]) rules let it show. The fill room keeps its hatch. */
.room:not([fill]){fill:var(--fp-room)} .room-garden:not([fill]){fill:var(--fp-garden)} .room-terrace:not([fill]){fill:var(--fp-terrace)} .room-pavement:not([fill]){fill:var(--fp-pavement)}
.room.room-fill{fill:url(#fp-hatch)} .room-zone:not([fill]){fill:none} .room-water:not([fill]){fill:var(--fp-water)}
.e{stroke:var(--fp-wall);stroke-width:3;stroke-linecap:round} .e.nw{stroke-dasharray:8 6;stroke-width:1.5}
.e.external{stroke:var(--fp-wall-external);stroke-width:6;stroke-linecap:square} .e.fence{stroke:var(--fp-wall-fence);stroke-width:1.5;stroke-dasharray:10 4 2 4;stroke-linecap:butt} .e.edge{stroke:var(--fp-wall-edge);stroke-width:1.5}
.eh{stroke:var(--fp-outline);stroke-width:5;stroke-linecap:round;pointer-events:none} .eh.nw{stroke-dasharray:8 6;stroke-width:3.5} .eh.external{stroke-width:8;stroke-linecap:square} .eh.fence{stroke-dasharray:10 4 2 4;stroke-width:3.5;stroke-linecap:butt} .eh.edge{stroke-width:3.5}
.e.none{stroke:var(--fp-idle);stroke-width:1;stroke-dasharray:2 5;opacity:.6} .e.se{stroke-width:1.5} .tread{stroke:var(--fp-tread);stroke-width:1.5;fill:none} .opening{stroke:var(--fp-room);stroke-width:9;pointer-events:none}
.extra{fill:none;stroke:var(--fp-idle);stroke-dasharray:6 4;stroke-width:1.2;vector-effect:non-scaling-stroke;pointer-events:none}
.door{stroke:var(--fp-door)} .door-glass{stroke:var(--fp-glass)} .door-window{stroke:var(--fp-window)} .door-sealed{stroke:var(--fp-sealed);stroke-dasharray:10 6}
.door.open{stroke:var(--fp-open)} .door.cover-open{stroke:var(--fp-open)}
.dev path{fill:var(--fp-idle)} .dev.on path{fill:var(--fp-on)} .dev-contact.on path{fill:var(--fp-open)}
.dev-camera path{fill:var(--fp-dev-camera)} .dev.dev-camera path.cone{fill:var(--fp-dev-camera);fill-opacity:var(--fp-alpha);pointer-events:none} .dev.outdoor path{fill:var(--fp-dev-garden)}
.dev .halo{fill:var(--fp-disc);fill-opacity:var(--fp-disc-alpha);stroke:var(--fp-halo);stroke-width:1;vector-effect:non-scaling-stroke}
.dev.unavailable{opacity:.45}
.dev-motion{--fp-fade:0} .dev.dev-motion path{fill:color-mix(in srgb,var(--fp-motion) calc(var(--fp-fade) * 100%),var(--fp-idle))}
.heater{stroke:var(--fp-heater)} .val,.lbl{fill:var(--fp-text);paint-order:stroke;stroke:var(--fp-outline);stroke-width:3;stroke-linejoin:round} .lbl.zone{opacity:.75}
.sel{stroke:var(--fp-ink)} .h{fill:var(--fp-bg);stroke:var(--fp-ink);stroke-width:1.5}`;

/** Text for markup. A name that is not text (a layout that skipped `validate`) is shown as text, never thrown on. */
const esc = (t: unknown) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const COLOR = /^#[0-9a-fA-F]{6}$/;
const num = (n: number) => String(Math.round(n * 100) / 100);
const pts = (p: Pt[]) => p.map((q) => `${num(q[0])},${num(q[1])}`).join(" ");
const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/** `p` turned clockwise by `deg` degrees about `pivot` (y points down, so this is the direction SVG's rotate() turns). */
export function rotateAbout(p: Pt, deg: number, pivot: Pt): Pt {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), dx = p[0] - pivot[0], dy = p[1] - pivot[1];
  return [pivot[0] + dx * c - dy * s, pivot[1] + dx * s + dy * c];
}

/** The one point every floor turns about: the centre of the box round all outlines together. With no outline anywhere, the origin. */
export function planPivot(l: Layout): Pt {
  const all = Object.values(l.floors).flatMap((f) => f.outline);
  if (!all.length) return [0, 0];
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

/** The box that fits the outline, in what the screen shows: turned by `rotate` when there is one. */
export function viewBoxFor(f: Floor, pad = 60, rotate?: { deg: number; pivot: Pt }): { x: number; y: number; w: number; h: number } {
  if (!f.outline.length) return { x: -pad, y: -pad, w: 1000 + 2 * pad, h: 1000 + 2 * pad };
  const shown = rotate && rotate.deg % 360 ? f.outline.map((p) => rotateAbout(p, rotate.deg, rotate.pivot)) : f.outline;
  const xs = shown.map((p) => p[0]), ys = shown.map((p) => p[1]);
  const x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad;
  return { x: x0, y: y0, w: Math.max(...xs) + pad - x0, h: Math.max(...ys) + pad - y0 };
}

/** Every point that makes up the floor: outline, rooms, stairs, walls, doors, openings, extras, furniture (its centre) and devices (a heater's two ends, else the centre). Only finite points; the editor's Re-center fits them all. */
export function contentPoints(f: Floor): Pt[] {
  const out: Pt[] = [];
  const add = (p: unknown) => { if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) out.push([p[0], p[1]]); };
  for (const p of f.outline ?? []) add(p);
  for (const r of f.rooms ?? []) for (const p of r.pts ?? []) add(p);
  for (const t of f.stairs ?? []) for (const p of t.pts ?? []) add(p);
  for (const k of ["walls", "doors", "openings", "extras"] as const) for (const o of f[k] ?? []) { add(o.a); add(o.b); }
  for (const m of f.furniture ?? []) add([m.x, m.y]);
  for (const d of f.devices ?? []) { if ("a" in d) { add(d.a); add(d.b); } else add([d.x, d.y]); }
  return out;
}

/** Class of a room edge or free wall: wall is plain, boundary is dotted, the rest carry their kind. */
const edgeClass = (kind: unknown) => `e${kind === "boundary" ? " nw" : kind === "wall" || kind === undefined ? "" : ` ${esc(String(kind))}`}`;
const at = (p: Pt) => `${num(p[0])} ${num(p[1])}`;
type Cls = "on" | "off" | "unavailable";

const dead = (s: string) => s === "unavailable" || s === "unknown";

/** A bound light is one lamp: on if either entity is on, unavailable only if every known state is dead. */
function boundClassOf(d: Device, o: RenderOpts): Cls {
  const seen = [o.state?.[d.entity], d.bound ? o.state?.[d.bound] : undefined].filter((s) => s !== undefined);
  if (seen.some((s) => s.state === "on")) return "on";
  if (seen.length && seen.every((s) => dead(s.state))) return "unavailable";
  return "off";
}

function inside(p: Pt, poly: Pt[]): boolean {
  let in_ = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
    if ((poly[i][1] > p[1]) !== (poly[j][1] > p[1]) && p[0] < ((poly[j][0] - poly[i][0]) * (p[1] - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) in_ = !in_;
  return in_;
}

function classOf(d: Device, o: RenderOpts): Cls {
  if (d.type === "light" && d.bound) return boundClassOf(d, o);
  const s = o.state?.[d.entity];
  if (!s) return "off";
  if (s.state === "unavailable" || s.state === "unknown") return "unavailable";
  if (d.type === "climate" || d.type === "heater") return s.attributes.hvac_action === "heating" ? "on" : "off";
  if (d.type === "media") return s.state === "playing" ? "on" : "off";
  return s.state === "on" || s.state === "open" ? "on" : "off";
}

/**
 * One stairs object: the polygon (or, round, an even-odd path with the well cut out), its treads and its edges, turned
 * together by `rot` about the centre of the polygon's box. Only an unturned straight flight has edge lines a click can
 * pick (`data-e`): the stored corners are those of the unturned polygon, so for any other stairs they are not where the
 * lines are drawn. The whole group is `data-s`.
 */
function stairsGroup(t: Stairs, i: number): string {
  const xs = t.pts.map((p) => p[0]), ys = t.pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const rot = typeof t.rot === "number" && Number.isFinite(t.rot) ? t.rot : 0;
  const steps = stairSteps(t);
  const round = t.shape === "round" && typeof t.dia === "number" && t.dia > 0;
  const inner = round && typeof t.inner === "number" && t.inner > 0 ? t.inner / 2 : 0;
  const g: string[] = [];
  if (round) {
    const R = t.dia! / 2;
    const hole = inner ? ` M${num(cx + inner)} ${num(cy)}A${num(inner)} ${num(inner)} 0 1 0 ${num(cx - inner)} ${num(cy)}A${num(inner)} ${num(inner)} 0 1 0 ${num(cx + inner)} ${num(cy)}Z` : "";
    g.push(`<path class="stairs room" fill-rule="evenodd" d="M${t.pts.map((p) => `${num(p[0])} ${num(p[1])}`).join("L")}Z${hole}"/>`);
    for (let n = 1; n < steps; n++) {
      const a = (n * 2 * Math.PI) / steps;
      g.push(`<line class="tread" x1="${num(cx + inner * Math.cos(a))}" y1="${num(cy + inner * Math.sin(a))}" x2="${num(cx + R * Math.cos(a))}" y2="${num(cy + R * Math.sin(a))}"/>`);
    }
  } else {
    g.push(`<polygon class="stairs room" points="${pts(t.pts)}"/>`);
    // Treads run across the short side of the box, one every (long side / steps).
    const along = x1 - x0 > y1 - y0;
    for (let n = 1; n < steps; n++) {
      if (along) { const x = x0 + ((x1 - x0) * n) / steps; g.push(`<line class="tread" x1="${num(x)}" y1="${num(y0)}" x2="${num(x)}" y2="${num(y1)}"/>`); }
      else { const y = y0 + ((y1 - y0) * n) / steps; g.push(`<line class="tread" x1="${num(x0)}" y1="${num(y)}" x2="${num(x1)}" y2="${num(y)}"/>`); }
    }
  }
  t.pts.forEach((a, j) => {
    const b = t.pts[(j + 1) % t.pts.length], e = !round && !rot ? ` data-e="s${i}:${j}"` : "";
    g.push(`<line class="e se"${e} x1="${num(a[0])}" y1="${num(a[1])}" x2="${num(b[0])}" y2="${num(b[1])}"/>`);
  });
  return `<g data-s="${i}" transform="rotate(${num(rot)} ${num(cx)} ${num(cy)})">${g.join("")}</g>`;
}

export function renderFloor(f: Floor, o: RenderOpts): string {
  const k = 1 / (o.scale || 1);
  const turn = o.rotate && o.rotate.deg % 360 ? o.rotate : null, planDeg = turn ? turn.deg : 0;
  /** Attribute that keeps a text upright in a turned plan: turns it back about its own anchor. */
  const up = (x: number, y: number) => (turn ? ` transform="rotate(${num(-planDeg)} ${num(x)} ${num(y)})"` : "");
  const out: string[] = [];
  const now = o.now ?? Date.now();

  // One fixed id: two cards on a page declare the same pattern twice, and both are identical (see DECISIONS).
  if (f.rooms.some((r) => r.kind === "fill"))
    out.push('<defs><pattern id="fp-hatch" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="12" height="12" fill="var(--fp-fill)"/><line x1="0" y1="0" x2="0" y2="12" stroke="var(--fp-fill-line)" stroke-width="2"/></pattern></defs>');
  // Zones are painted after every other room so they sit on top whatever the array order (the editor picks the top polygon).
  [...f.rooms.keys()].sort((a, b) => +(f.rooms[a].kind === "zone") - +(f.rooms[b].kind === "zone")).forEach((i) => {
    const r = f.rooms[i];
    if (r.kind === "fill" && !r.name) return;
    const own = typeof r.color === "string" && COLOR.test(r.color) ? ` fill="${r.color}"` : ""; // strict pattern: the value goes into an attribute
    out.push(`<polygon data-r="${i}" class="room room-${esc(String(r.kind))}${r.kind === "water" ? " water" : ""}"${own} points="${pts(r.pts)}"/>`);
  });

  f.stairs.forEach((t, i) => out.push(stairsGroup(t, i)));

  const polys: { id: string; pts: Pt[]; wk?: EdgeKind[]; zone?: boolean }[] = [{ id: "o", pts: f.outline }, ...f.rooms.map((r, i) => ({ id: `r${i}`, pts: r.pts, wk: r.wk, zone: r.kind === "zone" }))];
  // Every edge has a white twin drawn first (the line version of the text outline), so a dark line stays visible on a dark floor.
  const edgeLines: { cls: string; attr: string; a: Pt; b: Pt }[] = [], guides: typeof edgeLines = [];
  for (const P of polys)
    P.pts.forEach((a, i) => {
      const b = P.pts[(i + 1) % P.pts.length], kind = P.zone ? "boundary" : P.wk ? P.wk[i] : "wall";
      if (kind === "none") { if (o.editor) guides.push({ cls: "e none", attr: ` data-e="${P.id}:${i}"`, a, b }); return; } // not drawn: the editor keeps a faint guide so it can be picked again
      edgeLines.push({ cls: edgeClass(kind), attr: ` data-e="${P.id}:${i}"`, a, b });
    });
  f.walls.forEach((w, i) => edgeLines.push({ cls: edgeClass(w.kind), attr: ` data-w="${i}"`, a: w.a, b: w.b }));
  const seg = (a: Pt, b: Pt) => `x1="${num(a[0])}" y1="${num(a[1])}" x2="${num(b[0])}" y2="${num(b[1])}"`;
  for (const l of edgeLines) out.push(`<line class="eh${l.cls.slice(1)}" ${seg(l.a, l.b)}/>`);
  for (const l of [...guides, ...edgeLines]) out.push(`<line class="${l.cls}"${l.attr} ${seg(l.a, l.b)}/>`);

  // Openings erase the wall under them; extras are dashed outlines with a name. Both sit under devices and names.
  f.openings.forEach((op) => out.push(`<line class="opening" x1="${num(op.a[0])}" y1="${num(op.a[1])}" x2="${num(op.b[0])}" y2="${num(op.b[1])}"/>`));
  f.extras.forEach((x) => {
    const mx = Math.min(x.a[0], x.b[0]), my = Math.min(x.a[1], x.b[1]), w = Math.abs(x.a[0] - x.b[0]), h = Math.abs(x.a[1] - x.b[1]);
    out.push(w && h
      ? `<rect class="extra" x="${num(mx)}" y="${num(my)}" width="${num(w)}" height="${num(h)}"/>`
      : `<line class="extra" x1="${num(x.a[0])}" y1="${num(x.a[1])}" x2="${num(x.b[0])}" y2="${num(x.b[1])}"/>`);
    out.push(`<text class="lbl" x="${num(mx + w / 2)}" y="${num(my + h / 2)}"${up(mx + w / 2, my + h / 2)} text-anchor="middle" font-size="${num(11 * k)}">${esc(x.name)}</text>`);
  });

  f.furniture.forEach((m, i) => {
    const sym = FURNITURE[m.symbol];
    if (!sym) return;
    out.push(`<g data-f="${i}" class="furn" transform="translate(${num(m.x)} ${num(m.y)}) rotate(${num(m.rot)}) scale(${num(m.w / 100)} ${num(m.h / 100)}) translate(-50 -50)" color="var(--fp-idle)">${sym.svg}</g>`);
  });

  f.doors.forEach((d, i) => {
    const sensor = d.sensor ? o.state?.[d.sensor] : undefined, cover = d.cover ? o.state?.[d.cover] : undefined;
    const cls = ["door", `door-${esc(String(d.kind))}`, sensor?.state === "on" ? "open" : "", cover?.state === "open" ? "cover-open" : ""].filter(Boolean).join(" ");
    const sel = o.selection?.t === "door" && o.selection.i === i;
    out.push(`<line data-d="${i}" class="${cls}${sel ? " sel" : ""}" x1="${num(d.a[0])}" y1="${num(d.a[1])}" x2="${num(d.b[0])}" y2="${num(d.b[1])}" stroke-width="${sel ? 30 : 22}"><title>${esc(d.name ?? "")}</title></line>`);
  });

  // Room names first, then devices: nothing may hide a device icon, so a name that would sit under one moves down, then up.
  const spots: Pt[] = [];
  f.devices.forEach((d, i) => {
    const sel = o.selection?.t === "dev" && o.selection.i === i;
    if (o.filter && o.filter !== d.type && !sel) return;
    const c = "a" in d ? mid(d.a, d.b) : ([d.x, d.y] as Pt);
    if (c.every(Number.isFinite)) spots.push(c);
  });
  // A name is drawn upright on the screen, so a collision is tested in the screen frame: the plan turns by planDeg, a plan vector
  // (anchor to device) turns with it, and "down one line" is screen-down, which in plan units is the vector turned back.
  // The text y is the baseline: the box runs about 0.95 of the size above it and 0.25 below. 32k clears a 16k disc either way.
  const cs = Math.cos((planDeg * Math.PI) / 180), sn = Math.sin((planDeg * Math.PI) / 180);
  const screenDown = (a: Pt, d: number): Pt => (planDeg ? [a[0] + d * sn, a[1] + d * cs] : [a[0], a[1] + d]); // a plan point d units below a, on the screen
  const hit = (a: Pt, size: number, len: number) => spots.some((p) => {
    const vx = p[0] - a[0], vy = p[1] - a[1];
    const sx = planDeg ? vx * cs - vy * sn : vx, sy = planDeg ? vx * sn + vy * cs : vy; // the same vector on the screen
    return Math.abs(sy + 0.35 * size) < 16 * k + 0.6 * size && Math.abs(sx) < 16 * k + 0.3 * size * len;
  });
  const nameAt = (a: Pt, size: number, len: number): Pt => [a, screenDown(a, 32 * k), screenDown(a, -32 * k)].find((v) => !hit(v, size, len)) ?? a;
  f.rooms.forEach((r) => {
    if (!r.name || r.kind === "fill") return;
    const c: Pt = [r.pts.reduce((s, p) => s + p[0], 0) / r.pts.length, r.pts.reduce((s, p) => s + p[1], 0) / r.pts.length];
    if (r.kind === "zone") { const [x, y] = nameAt(c, 10 * k, r.name.length); out.push(`<text class="lbl zone" x="${num(x)}" y="${num(y)}"${up(x, y)} text-anchor="middle" font-size="${num(10 * k)}">${esc(r.name)}</text>`); return; }
    const [x, y] = nameAt(c, 14 * k, r.name.length);
    out.push(`<text class="lbl" x="${num(x)}" y="${num(y)}"${up(x, y)} text-anchor="middle" font-size="${num(14 * k)}" font-weight="600">${esc(r.name)}</text>`);
    if (r.label) { const [lx, ly] = screenDown([x, y], 16 * k); out.push(`<text class="lbl" x="${num(lx)}" y="${num(ly)}"${up(lx, ly)} text-anchor="middle" font-size="${num(11 * k)}">${esc(r.label)}</text>`); }
  });

  f.devices.forEach((d, i) => {
    const sel = o.selection?.t === "dev" && o.selection.i === i;
    if (o.filter && o.filter !== d.type && !sel) return;
    const c = "a" in d ? mid(d.a, d.b) : ([d.x, d.y] as Pt);
    if (!c.every(Number.isFinite)) return;
    // Value sensors in a garden room are outdoor sensors. Motion and contact keep their own state colours.
    const outdoor = (d.type === "temp" || d.type === "humidity") && f.rooms.some((r) => r.kind === "garden" && inside(c, r.pts));
    const cls = classOf(d, o) + (outdoor ? " outdoor" : "");
    const s = o.state?.[d.entity];
    let style = "";
    if (d.type === "motion" && s) {
      const fade = o.fade ?? 300;
      const t = Date.parse(s.last_changed);
      const age = Number.isNaN(t) ? 0 : now - t; // unreadable time: treat as just changed
      const v = fade > 0 ? Math.max(0, Math.min(1, 1 - age / (fade * 1000))) : cls === "on" ? 1 : 0;
      style = ` style="--fp-fade:${num(v)}"`;
    }
    const label = d.name ?? d.id;
    const bound = d.type === "light" && d.bound ? d.bound : "";
    const bname = bound ? o.state?.[bound]?.attributes.friendly_name : undefined;
    const title = `${esc(d.type)}: ${esc(label)}${bound ? ` + ${esc(typeof bname === "string" && bname ? bname : bound)}` : ""}`;
    // The group turns by `rot` about the icon's centre; the icon turns back so the glyph stays upright (only what else is drawn in the group turns).
    const rot = typeof d.rot === "number" && Number.isFinite(d.rot) && d.rot !== 0 ? d.rot : 0;
    // A turned plan turns the group again from outside; the icon takes that back too, the cone (in the group's frame) does not.
    const back = (rot + planDeg) % 360 ? rot + planDeg : 0;
    // Camera: a 120 degree, 100 cm cone about "up" (-90 degrees), in plan units (the group is scaled by k). It comes first, so the icon covers its tip.
    let cone = "";
    if (d.type === "camera") {
      const R = 100 / k, p = (deg: number) => at([12 + R * Math.cos((deg * Math.PI) / 180), 12 + R * Math.sin((deg * Math.PI) / 180)]);
      cone = `<path class="cone" d="M12 12L${p(-150)}A${num(R)} ${num(R)} 0 0 1 ${p(-30)}Z"/>`;
    }
    const icon = `<circle class="halo" cx="12" cy="12" r="16"/><path d="${DEVICE_ICONS[d.type] ?? DEVICE_ICONS.other}"/>`;
    out.push(`<g data-x="${i}" class="dev dev-${esc(String(d.type))}${bound ? " bound" : ""} ${cls}${sel ? " sel" : ""}"${style} transform="translate(${at([c[0] - 12 * k, c[1] - 12 * k])}) scale(${num(k)})${rot ? ` rotate(${num(rot)} 12 12)` : ""}"><title>${title}</title>${cone}${back ? `<g transform="rotate(${num(-back)} 12 12)">${icon}</g>` : icon}</g>`);
    if ("a" in d) out.push(`<line data-xbar="${i}" class="heater${sel ? " sel" : ""}" x1="${num(d.a[0])}" y1="${num(d.a[1])}" x2="${num(d.b[0])}" y2="${num(d.b[1])}" stroke-width="${sel ? 12 : 8}"/>`);
    if ((d.type === "temp" || d.type === "humidity") && s) {
      const bad = s.state === "unknown" || s.state === "unavailable";
      const unit = typeof s.attributes.unit_of_measurement === "string" ? ` ${s.attributes.unit_of_measurement}` : "";
      out.push(`<text class="val" x="${num(c[0])}" y="${num(c[1] + 24 * k)}"${up(c[0], c[1] + 24 * k)} text-anchor="middle" font-size="${num(11 * k)}">${bad ? "–" : esc(s.state + unit)}</text>`);
    }
    if (o.showNames || sel) out.push(`<text class="lbl" x="${num(c[0])}" y="${num(c[1] - 16 * k)}"${up(c[0], c[1] - 16 * k)} text-anchor="middle" font-size="${num(9 * k)}">${esc(label)}</text>`);
  });

  if (o.editor)
    for (const P of polys) P.pts.forEach((p, j) => out.push(`<circle class="h" data-h="${P.id}:${j}" cx="${num(p[0])}" cy="${num(p[1])}" r="${num(5 * k)}"/>`));
  const body = out.join("\n");
  const turned = turn ? `<g class="plan-turn" transform="rotate(${num(turn.deg)} ${num(turn.pivot[0])} ${num(turn.pivot[1])})">${body}</g>` : body;
  // Custom properties inherit, so one style on a group reaches every device. Only known types and strict #rrggbb go in: the value ends up in an attribute.
  const vars = Object.entries(o.colors ?? {}).filter(([t, v]) => (DEVICE_TYPES as readonly string[]).includes(t) && typeof v === "string" && COLOR.test(v)).map(([t, v]) => `--fp-dev-${t}:${v}`);
  return vars.length ? `<g class="dev-colours" style="${vars.join(";")}">${turned}</g>` : turned;
}
