import { DEVICE_ICONS, FURNITURE } from "./icons";
import type { Device, DeviceType, Floor, Pt, Stairs, WallKind } from "./schema";

export interface StateOverlay { [entityId: string]: { state: string; attributes: Record<string, unknown>; last_changed: string } }
export interface RenderOpts {
  scale: number; selection?: { t: string; i: number } | null; showNames?: boolean; filter?: DeviceType | "";
  state?: StateOverlay; now?: number; fade?: number; roomGlow?: boolean; editor?: boolean;
}

/** Default colours. Hosts (card, editor) override the --fp-* variables. Kept out of the markup on purpose. */
export const FLOORPLAN_CSS = `
:host,.fp{--fp-ink:#2b2a27;--fp-bg:#f4f0e6;--fp-room:#e9e3d3;--fp-garden:#9db98a;--fp-terrace:#cdb094;--fp-pavement:#c9c6bf;--fp-wall:#2b2a27;--fp-idle:#8b8578;
--fp-on:#e0a800;--fp-open:#f28c28;--fp-motion:#d64545;--fp-heater:#e8801a;--fp-door:#a5601c;--fp-glass:#1b9e77;--fp-window:#2c7fb8;--fp-sealed:#9a8f80;--fp-water:#a9cfe3;--fp-fill:#c4c0b8;--fp-fill-line:#9a958b;
--fp-tread:#8b8578;--fp-dev-light:#e0a800;--fp-dev-motion:#d64545;--fp-dev-contact:#d64545;--fp-dev-heater:#e8801a;--fp-dev-climate:#e8801a;--fp-dev-ac-cool:#2c7fb8;--fp-dev-ac-heat:#e8801a;--fp-dev-tv:#2c7fb8;--fp-dev-plug:#2c7fb8;--fp-dev-computer:#2c7fb8;--fp-dev-camera:#4a4a48;--fp-dev-garden:#3f8f4f;--fp-halo:#8b8578;--fp-wall-external:#1a1917;--fp-wall-fence:#7a5c3a;--fp-wall-edge:#a29e94}
/* A room with its own colour carries a fill attribute; the :not([fill]) rules let it show. The fill room keeps its hatch. */
.room:not([fill]){fill:var(--fp-room)} .room-garden:not([fill]){fill:var(--fp-garden)} .room-terrace:not([fill]){fill:var(--fp-terrace)} .room-pavement:not([fill]){fill:var(--fp-pavement)}
.room.room-fill{fill:url(#fp-hatch)} .room-zone:not([fill]){fill:none} .room-water:not([fill]){fill:var(--fp-water)}
.e{stroke:var(--fp-wall);stroke-width:3;stroke-linecap:round} .e.nw{stroke-dasharray:8 6;stroke-width:1.5}
.e.external{stroke:var(--fp-wall-external);stroke-width:6;stroke-linecap:square} .e.fence{stroke:var(--fp-wall-fence);stroke-width:1.5;stroke-dasharray:10 4 2 4;stroke-linecap:butt} .e.edge{stroke:var(--fp-wall-edge);stroke-width:1.5}
.e.se{stroke-width:1.5} .tread{stroke:var(--fp-tread);stroke-width:1.5;fill:none} .opening{stroke:var(--fp-room);stroke-width:9;pointer-events:none}
.extra{fill:none;stroke:var(--fp-idle);stroke-dasharray:6 4;stroke-width:1.2;vector-effect:non-scaling-stroke;pointer-events:none}
.door{stroke:var(--fp-door)} .door-glass{stroke:var(--fp-glass)} .door-window{stroke:var(--fp-window)} .door-sealed{stroke:var(--fp-sealed);stroke-dasharray:10 6}
.door.open{stroke:var(--fp-open)} .door.cover-open{stroke:var(--fp-open)}
.dev path{fill:var(--fp-idle)} .dev.on path{fill:var(--fp-on)} .dev-contact.on path{fill:var(--fp-open)}
.dev-camera path{fill:var(--fp-dev-camera)} .dev.outdoor path{fill:var(--fp-dev-garden)}
.dev .halo{fill:var(--fp-halo);fill-opacity:.5}
.dev.unavailable{opacity:.45}
.dev-motion{--fp-fade:0} .dev-motion path{fill:color-mix(in srgb,var(--fp-motion) calc(var(--fp-fade) * 100%),var(--fp-idle))}
.heater{stroke:var(--fp-heater)} .val,.lbl{fill:var(--fp-ink);paint-order:stroke;stroke:var(--fp-bg);stroke-width:3} .lbl.zone{fill:var(--fp-idle);opacity:.75}
.sel{stroke:var(--fp-ink)} .h{fill:var(--fp-bg);stroke:var(--fp-ink);stroke-width:1.5}`;

/** Text for markup. A name that is not text (a layout that skipped `validate`) is shown as text, never thrown on. */
const esc = (t: unknown) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const COLOR = /^#[0-9a-fA-F]{6}$/;
const num = (n: number) => String(Math.round(n * 100) / 100);
const pts = (p: Pt[]) => p.map((q) => `${num(q[0])},${num(q[1])}`).join(" ");
const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

export function viewBoxFor(f: Floor, pad = 60): { x: number; y: number; w: number; h: number } {
  if (!f.outline.length) return { x: -pad, y: -pad, w: 1000 + 2 * pad, h: 1000 + 2 * pad };
  const xs = f.outline.map((p) => p[0]), ys = f.outline.map((p) => p[1]);
  const x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad;
  return { x: x0, y: y0, w: Math.max(...xs) + pad - x0, h: Math.max(...ys) + pad - y0 };
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
  const steps = Number.isInteger(t.steps) && t.steps >= 2 ? t.steps : 12;
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

  const polys: { id: string; pts: Pt[]; wk?: WallKind[]; zone?: boolean }[] = [{ id: "o", pts: f.outline }, ...f.rooms.map((r, i) => ({ id: `r${i}`, pts: r.pts, wk: r.wk, zone: r.kind === "zone" }))];
  for (const P of polys)
    P.pts.forEach((a, i) => {
      const b = P.pts[(i + 1) % P.pts.length], kind = P.zone ? "boundary" : P.wk ? P.wk[i] : "wall";
      out.push(`<line class="${edgeClass(kind)}" data-e="${P.id}:${i}" x1="${num(a[0])}" y1="${num(a[1])}" x2="${num(b[0])}" y2="${num(b[1])}"/>`);
    });
  f.walls.forEach((w, i) =>
    out.push(`<line class="${edgeClass(w.kind)}" data-w="${i}" x1="${num(w.a[0])}" y1="${num(w.a[1])}" x2="${num(w.b[0])}" y2="${num(w.b[1])}"/>`));

  // Openings erase the wall under them; extras are dashed outlines with a name. Both sit under devices and names.
  f.openings.forEach((op) => out.push(`<line class="opening" x1="${num(op.a[0])}" y1="${num(op.a[1])}" x2="${num(op.b[0])}" y2="${num(op.b[1])}"/>`));
  f.extras.forEach((x) => {
    const mx = Math.min(x.a[0], x.b[0]), my = Math.min(x.a[1], x.b[1]), w = Math.abs(x.a[0] - x.b[0]), h = Math.abs(x.a[1] - x.b[1]);
    out.push(w && h
      ? `<rect class="extra" x="${num(mx)}" y="${num(my)}" width="${num(w)}" height="${num(h)}"/>`
      : `<line class="extra" x1="${num(x.a[0])}" y1="${num(x.a[1])}" x2="${num(x.b[0])}" y2="${num(x.b[1])}"/>`);
    out.push(`<text class="lbl" x="${num(mx + w / 2)}" y="${num(my + h / 2)}" text-anchor="middle" font-size="${num(11 * k)}" fill="var(--fp-idle)">${esc(x.name)}</text>`);
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

  // Room names first, then devices: nothing may hide a device icon.
  f.rooms.forEach((r) => {
    if (!r.name || r.kind === "fill") return;
    const cx = r.pts.reduce((s, p) => s + p[0], 0) / r.pts.length, cy = r.pts.reduce((s, p) => s + p[1], 0) / r.pts.length;
    if (r.kind === "zone") { out.push(`<text class="lbl zone" x="${num(cx)}" y="${num(cy)}" text-anchor="middle" font-size="${num(10 * k)}">${esc(r.name)}</text>`); return; }
    out.push(`<text class="lbl" x="${num(cx)}" y="${num(cy)}" text-anchor="middle" font-size="${num(14 * k)}" font-weight="600">${esc(r.name)}</text>`);
    if (r.label) out.push(`<text class="lbl" x="${num(cx)}" y="${num(cy + 16 * k)}" text-anchor="middle" font-size="${num(11 * k)}">${esc(r.label)}</text>`);
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
    const icon = `<circle class="halo" cx="12" cy="12" r="13"/><path d="${DEVICE_ICONS[d.type] ?? DEVICE_ICONS.other}"/>`;
    out.push(`<g data-x="${i}" class="dev dev-${esc(String(d.type))}${bound ? " bound" : ""} ${cls}${sel ? " sel" : ""}"${style} transform="translate(${at([c[0] - 12 * k, c[1] - 12 * k])}) scale(${num(k)})${rot ? ` rotate(${num(rot)} 12 12)` : ""}"><title>${title}</title>${rot ? `<g transform="rotate(${num(-rot)} 12 12)">${icon}</g>` : icon}</g>`);
    if ("a" in d) out.push(`<line data-xbar="${i}" class="heater${sel ? " sel" : ""}" x1="${num(d.a[0])}" y1="${num(d.a[1])}" x2="${num(d.b[0])}" y2="${num(d.b[1])}" stroke-width="${sel ? 12 : 8}"/>`);
    if ((d.type === "temp" || d.type === "humidity") && s) {
      const bad = s.state === "unknown" || s.state === "unavailable";
      const unit = typeof s.attributes.unit_of_measurement === "string" ? ` ${s.attributes.unit_of_measurement}` : "";
      out.push(`<text class="val" x="${num(c[0])}" y="${num(c[1] + 24 * k)}" text-anchor="middle" font-size="${num(11 * k)}">${bad ? "–" : esc(s.state + unit)}</text>`);
    }
    if (o.showNames || sel) out.push(`<text class="lbl" x="${num(c[0])}" y="${num(c[1] - 16 * k)}" text-anchor="middle" font-size="${num(9 * k)}">${esc(label)}</text>`);
  });

  if (o.editor)
    for (const P of polys) P.pts.forEach((p, j) => out.push(`<circle class="h" data-h="${P.id}:${j}" cx="${num(p[0])}" cy="${num(p[1])}" r="${num(5 * k)}"/>`));
  return out.join("\n");
}
