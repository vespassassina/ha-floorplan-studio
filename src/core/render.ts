import { DEVICE_ICONS, FURNITURE } from "./icons";
import type { Device, DeviceType, Floor, Pt } from "./schema";

export interface StateOverlay { [entityId: string]: { state: string; attributes: Record<string, unknown>; last_changed: string } }
export interface RenderOpts {
  scale: number; selection?: { t: string; i: number } | null; showNames?: boolean; filter?: DeviceType | "";
  state?: StateOverlay; now?: number; fade?: number; roomGlow?: boolean; editor?: boolean;
}

/** Default colours. Hosts (card, editor) override the --fp-* variables. Kept out of the markup on purpose. */
export const FLOORPLAN_CSS = `
:host,.fp{--fp-ink:#2b2a27;--fp-bg:#f4f0e6;--fp-room:#e9e3d3;--fp-garden:#9db98a;--fp-terrace:#cdb094;--fp-pavement:#c9c6bf;--fp-wall:#2b2a27;--fp-idle:#8b8578;
--fp-on:#e0a800;--fp-open:#f28c28;--fp-motion:#d64545;--fp-heater:#e8801a;--fp-door:#a5601c;--fp-glass:#1b9e77;--fp-window:#2c7fb8;--fp-sealed:#9a8f80;--fp-water:#a9cfe3;--fp-fill:#c4c0b8;--fp-fill-line:#9a958b;
--fp-wall-external:#1a1917;--fp-wall-fence:#7a5c3a;--fp-wall-edge:#a29e94}
.room{fill:var(--fp-room)} .room-garden{fill:var(--fp-garden)} .room-terrace{fill:var(--fp-terrace)} .room-pavement{fill:var(--fp-pavement)} .room-fill{fill:url(#fp-hatch)} .room-zone{fill:none} .water{fill:var(--fp-water)}
.e{stroke:var(--fp-wall);stroke-width:3;stroke-linecap:round} .e.nw{stroke-dasharray:8 6;stroke-width:1.5}
.e.external{stroke:var(--fp-wall-external);stroke-width:6;stroke-linecap:square} .e.fence{stroke:var(--fp-wall-fence);stroke-width:1.5;stroke-dasharray:10 4 2 4;stroke-linecap:butt} .e.edge{stroke:var(--fp-wall-edge);stroke-width:1.5}
.e.se{stroke-width:1.5} .opening{stroke:var(--fp-room);stroke-width:9;pointer-events:none}
.extra{fill:none;stroke:var(--fp-idle);stroke-dasharray:6 4;stroke-width:1.2;vector-effect:non-scaling-stroke;pointer-events:none}
.door{stroke:var(--fp-door)} .door-glass{stroke:var(--fp-glass)} .door-window{stroke:var(--fp-window)} .door-sealed{stroke:var(--fp-sealed);stroke-dasharray:10 6}
.door.open{stroke:var(--fp-open)} .door.cover-open{stroke:var(--fp-open)}
.dev path{fill:var(--fp-idle)} .dev.on path{fill:var(--fp-on)} .dev-contact.on path{fill:var(--fp-open)}
.dev.unavailable{opacity:.45}
.dev-motion{--fp-fade:0} .dev-motion path{fill:color-mix(in srgb,var(--fp-motion) calc(var(--fp-fade) * 100%),var(--fp-idle))}
.heater{stroke:var(--fp-heater)} .val,.lbl{fill:var(--fp-ink);paint-order:stroke;stroke:var(--fp-bg);stroke-width:3} .lbl.zone{fill:var(--fp-idle);opacity:.75}
.sel{stroke:var(--fp-ink)} .h{fill:var(--fp-bg);stroke:var(--fp-ink);stroke-width:1.5}`;

/** Text for markup. A name that is not text (a layout that skipped `validate`) is shown as text, never thrown on. */
const esc = (t: unknown) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (n: number) => String(Math.round(n * 100) / 100);
const pts = (p: Pt[]) => p.map((q) => `${num(q[0])},${num(q[1])}`).join(" ");
const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

export function viewBoxFor(f: Floor, pad = 60): { x: number; y: number; w: number; h: number } {
  if (!f.outline.length) return { x: -pad, y: -pad, w: 1000 + 2 * pad, h: 1000 + 2 * pad };
  const xs = f.outline.map((p) => p[0]), ys = f.outline.map((p) => p[1]);
  const x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad;
  return { x: x0, y: y0, w: Math.max(...xs) + pad - x0, h: Math.max(...ys) + pad - y0 };
}

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

function classOf(d: Device, o: RenderOpts): Cls {
  if (d.type === "light" && d.bound) return boundClassOf(d, o);
  const s = o.state?.[d.entity];
  if (!s) return "off";
  if (s.state === "unavailable" || s.state === "unknown") return "unavailable";
  if (d.type === "climate" || d.type === "heater") return s.attributes.hvac_action === "heating" ? "on" : "off";
  if (d.type === "media") return s.state === "playing" ? "on" : "off";
  return s.state === "on" || s.state === "open" ? "on" : "off";
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
    out.push(`<polygon data-r="${i}" class="room room-${esc(String(r.kind))}${r.kind === "water" ? " water" : ""}" points="${pts(r.pts)}"/>`);
  });
  f.stairs.forEach((s, i) => out.push(`<polygon data-s="${i}" class="stairs room" points="${pts(s.pts)}"/>`));

  const polys: { id: string; pts: Pt[]; w?: boolean[]; zone?: boolean }[] = [{ id: "o", pts: f.outline }, ...f.rooms.map((r, i) => ({ id: `r${i}`, pts: r.pts, w: r.w, zone: r.kind === "zone" }))];
  for (const P of polys)
    P.pts.forEach((a, i) => {
      const b = P.pts[(i + 1) % P.pts.length], wall = P.zone ? false : P.w ? P.w[i] : true;
      out.push(`<line class="e${wall ? "" : " nw"}" data-e="${P.id}:${i}" x1="${num(a[0])}" y1="${num(a[1])}" x2="${num(b[0])}" y2="${num(b[1])}"/>`);
    });
  f.walls.forEach((w, i) =>
    out.push(`<line class="e${w.kind === "boundary" ? " nw" : w.kind === "wall" ? "" : ` ${esc(String(w.kind))}`}" data-w="${i}" x1="${num(w.a[0])}" y1="${num(w.a[1])}" x2="${num(w.b[0])}" y2="${num(w.b[1])}"/>`));

  f.stairs.forEach((t, i) => t.pts.forEach((a, j) => {
    const b = t.pts[(j + 1) % t.pts.length];
    out.push(`<line class="e se" data-e="s${i}:${j}" x1="${num(a[0])}" y1="${num(a[1])}" x2="${num(b[0])}" y2="${num(b[1])}"/>`);
  }));
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

  f.devices.forEach((d, i) => {
    const sel = o.selection?.t === "dev" && o.selection.i === i;
    if (o.filter && o.filter !== d.type && !sel) return;
    const c = "a" in d ? mid(d.a, d.b) : ([d.x, d.y] as Pt);
    if (!c.every(Number.isFinite)) return;
    const cls = classOf(d, o);
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
    out.push(`<g data-x="${i}" class="dev dev-${esc(String(d.type))}${bound ? " bound" : ""} ${cls}${sel ? " sel" : ""}"${style} transform="translate(${at([c[0] - 12 * k, c[1] - 12 * k])}) scale(${num(k)})"><title>${title}</title><circle cx="12" cy="12" r="13" fill="var(--fp-bg)" fill-opacity=".85"/><path d="${DEVICE_ICONS[d.type] ?? DEVICE_ICONS.other}"/></g>`);
    if ("a" in d) out.push(`<line data-xbar="${i}" class="heater${sel ? " sel" : ""}" x1="${num(d.a[0])}" y1="${num(d.a[1])}" x2="${num(d.b[0])}" y2="${num(d.b[1])}" stroke-width="${sel ? 12 : 8}"/>`);
    if ((d.type === "temp" || d.type === "humidity") && s) {
      const bad = s.state === "unknown" || s.state === "unavailable";
      const unit = typeof s.attributes.unit_of_measurement === "string" ? ` ${s.attributes.unit_of_measurement}` : "";
      out.push(`<text class="val" x="${num(c[0])}" y="${num(c[1] + 24 * k)}" text-anchor="middle" font-size="${num(11 * k)}">${bad ? "–" : esc(s.state + unit)}</text>`);
    }
    if (o.showNames || sel) out.push(`<text class="lbl" x="${num(c[0])}" y="${num(c[1] - 16 * k)}" text-anchor="middle" font-size="${num(9 * k)}">${esc(label)}</text>`);
  });

  f.rooms.forEach((r) => {
    if (!r.name || r.kind === "fill") return;
    const cx = r.pts.reduce((s, p) => s + p[0], 0) / r.pts.length, cy = r.pts.reduce((s, p) => s + p[1], 0) / r.pts.length;
    if (r.kind === "zone") { out.push(`<text class="lbl zone" x="${num(cx)}" y="${num(cy)}" text-anchor="middle" font-size="${num(10 * k)}">${esc(r.name)}</text>`); return; }
    out.push(`<text class="lbl" x="${num(cx)}" y="${num(cy)}" text-anchor="middle" font-size="${num(14 * k)}" font-weight="600">${esc(r.name)}</text>`);
    if (r.label) out.push(`<text class="lbl" x="${num(cx)}" y="${num(cy + 16 * k)}" text-anchor="middle" font-size="${num(11 * k)}">${esc(r.label)}</text>`);
  });

  if (o.editor)
    for (const P of polys) P.pts.forEach((p, j) => out.push(`<circle class="h" data-h="${P.id}:${j}" cx="${num(p[0])}" cy="${num(p[1])}" r="${num(5 * k)}"/>`));
  return out.join("\n");
}
