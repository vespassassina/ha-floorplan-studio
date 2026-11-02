import { dist, floorPivot, type Pt, type Stairs, wallWidthAt } from "../core";
import { num, planZero } from "./editor-kit";
import { polyPts, ptOf } from "./state";
import { type Corner, looseEnds } from "./ops";
import type { FloorplanStudioEditor } from "./editor-app";

// ---- drawing: the measure grid and the handles over the plan ---------------------------------------------

/** The transform attribute that turns a stairs highlight like renderFloor turns the stairs: `rot` about the centre of the box. */
function stairsTurn(t: Stairs): string {
  const xs = t.pts.map((p) => p[0]), ys = t.pts.map((p) => p[1]);
  return `transform="rotate(${num(t.rot)} ${num((Math.min(...xs) + Math.max(...xs)) / 2)} ${num((Math.min(...ys) + Math.max(...ys)) / 2)})"`;
}

/**
 * The measure grid drawn behind the plan: faint lines every 50 cm (more on a huge floor, so no axis ever needs more
 * than 400), over the whole area the editor shows, not just the plan. Zero is the plan's top-left corner, the
 * lowest x and y of the outline, so a metre marker reads the distance from that corner and not from the layout's
 * origin. Numbered at every whole metre along the top and left edges of the shown area. Off, this returns "". A
 * viewer preference, never in the layout, never an undo step.
 */
export function measureGrid(ed: FloorplanStudioEditor, k: number, box: { x: number; y: number; w: number; h: number }): string {
  const st = ed.st;
  if (!st.measure) return "";
  const zero = planZero(st.f);
  const perAxis = (s: number) => Math.max(Math.ceil(box.w / s), Math.ceil(box.h / s));
  let step = 50;
  if (perAxis(step) > 400) step = 100;
  if (perAxis(step) > 400) step = 500;
  const numStep = step === 50 ? 100 : step; // at 50 cm, number only the whole metres; else every line already is one
  const deg = st.turnDeg;
  const upright = (x: number, y: number) => (deg % 360 ? ` transform="rotate(${num(-deg)} ${num(x)} ${num(y)})"` : "");
  const x1 = box.x + box.w, y1 = box.y + box.h;
  const first = (from: number, z: number, s: number) => z + Math.ceil((from - z) / s) * s;
  const o: string[] = [];
  for (let x = first(box.x, zero[0], step); x <= x1; x += step) {
    const m = Math.round(x - zero[0]) % 100 === 0;
    o.push(`<line class="mg${m ? " m" : ""}" stroke-opacity="${m ? "0.22" : "0.12"}" x1="${num(x)}" y1="${num(box.y)}" x2="${num(x)}" y2="${num(y1)}"/>`);
  }
  for (let y = first(box.y, zero[1], step); y <= y1; y += step) {
    const m = Math.round(y - zero[1]) % 100 === 0;
    o.push(`<line class="mg${m ? " m" : ""}" stroke-opacity="${m ? "0.22" : "0.12"}" x1="${num(box.x)}" y1="${num(y)}" x2="${num(x1)}" y2="${num(y)}"/>`);
  }
  // The unit is stated once: only the x-axis origin reads "0 m"; the y-axis one, and every other number, is bare.
  for (let x = first(box.x, zero[0], numStep); x <= x1; x += numStep) {
    const v = Math.round((x - zero[0]) / 100), ly = box.y + 12 * k;
    o.push(`<text class="lbl mg-n" x="${num(x)}" y="${num(ly)}"${upright(x, ly)} text-anchor="middle" font-size="${num(10 * k)}">${v === 0 ? "0 m" : num(v)}</text>`);
  }
  for (let y = first(box.y, zero[1], numStep); y <= y1; y += numStep) {
    const v = Math.round((y - zero[1]) / 100), lx = box.x + 2 * k, ly = y + 3 * k;
    o.push(`<text class="lbl mg-n" x="${num(lx)}" y="${num(ly)}"${upright(lx, ly)} text-anchor="start" font-size="${num(10 * k)}">${num(v)}</text>`);
  }
  return o.join("");
}

export function planOverlay(ed: FloorplanStudioEditor, k: number): string {
  const st = ed.st, f = st.f, s = st.sel, o: string[] = [];
  // S29.9: while Align is open the plan is read-only: no handle, no highlight, only the cross at the pivot the Turn buttons turn about.
  if (ed.asideMode === "align" && ed.alignKey === st.floor) {
    const c = floorPivot(f), r = 9 * k;
    return `<g class="align-pivot"><line x1="${num(c[0] - r)}" y1="${num(c[1])}" x2="${num(c[0] + r)}" y2="${num(c[1])}"/><line x1="${num(c[0])}" y1="${num(c[1] - r)}" x2="${num(c[0])}" y2="${num(c[1] + r)}"/></g>`;
  }
  const line = (a: Pt, b: Pt, cls: string, extra = "") => `<line class="${cls}" x1="${num(a[0])}" y1="${num(a[1])}" x2="${num(b[0])}" y2="${num(b[1])}" ${extra}/>`;
  const deg = st.turnDeg, upright = (x: number, y: number) => (deg % 360 ? ` transform="rotate(${num(-deg)} ${num(x)} ${num(y)})"` : "");
  // S37.7: the length labels are written last among the handles (see below): a short wall puts its two end dots on its own label.
  const lens: string[] = [];
  const len = (a: Pt, b: Pt) => `<text class="len" x="${num((a[0] + b[0]) / 2)}" y="${num((a[1] + b[1]) / 2)}"${upright((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)} text-anchor="middle" font-size="${num(10 * k)}">${(dist(a, b) / 100).toFixed(2)} m</text>`;
  if (s?.t === "edge") { const pts = polyPts(f, s.poly); if (pts) { const a = pts[s.i], b = pts[(s.i + 1) % pts.length]; o.push(line(a, b, "hl", 'stroke-width="4"')); lens.push(len(a, b)); } }
  if (s?.t === "opening" && f.openings[s.i]) o.push(line(f.openings[s.i].a, f.openings[s.i].b, "hl", 'stroke-width="4"'));
  if (s?.t === "wall" && f.walls[s.i]) o.push(line(f.walls[s.i].a, f.walls[s.i].b, "hl", 'stroke-width="4"'));
  if (s?.t === "extra" && f.extras[s.i]) o.push(line(f.extras[s.i].a, f.extras[s.i].b, "hl", 'stroke-width="4"'));
  if (s?.t === "room" && f.rooms[s.i]) o.push(`<polygon class="hl${f.rooms[s.i].kind === "zone" ? " hl-zone" : ""}" points="${f.rooms[s.i].pts.map((p) => `${num(p[0])},${num(p[1])}`).join(" ")}"/>`);
  if (s?.t === "stairs" && f.stairs[s.i]) o.push(`<polygon class="hl" ${stairsTurn(f.stairs[s.i])} points="${f.stairs[s.i].pts.map((p) => `${num(p[0])},${num(p[1])}`).join(" ")}"/>`);
  if (s?.t === "furn" && f.furniture[s.i]) {
    const m = f.furniture[s.i];
    o.push(`<rect class="hl" x="-50" y="-50" width="100" height="100" transform="translate(${num(m.x)} ${num(m.y)}) rotate(${num(m.rot)}) scale(${num(m.w / 100)} ${num(m.h / 100)})"/>`);
    // S1.51: a corner handle at each of the box's four corners, turned by the piece's own rot like the highlight rect.
    const hw = m.w / 2, hh = m.h / 2, rad = (m.rot * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
    const CORNERS: { c: Corner; lx: number; ly: number }[] = [
      { c: "nw", lx: -hw, ly: -hh }, { c: "ne", lx: hw, ly: -hh }, { c: "se", lx: hw, ly: hh }, { c: "sw", lx: -hw, ly: hh },
    ];
    for (const { c, lx, ly } of CORNERS) {
      const wx = m.x + lx * cos - ly * sin, wy = m.y + lx * sin + ly * cos;
      o.push(`<circle class="h" data-fh="${s.i}:${c}" cx="${num(wx)}" cy="${num(wy)}" r="${num(5 * k)}"/>`);
    }
  }
  if (st.showLen) {
    const P = f.outline;
    P.forEach((a, i) => lens.push(len(a, P[(i + 1) % P.length])));
    f.walls.forEach((w) => lens.push(len(w.a, w.b)));
  }
  f.stairs.forEach((t, i) => { if (t.shape === "straight" && !t.rot) t.pts.forEach((p, j) => o.push(`<circle class="h" data-h="s${i}:${j}" cx="${num(p[0])}" cy="${num(p[1])}" r="${num(5 * k)}"/>`)); });
  const open = st.openDoor && f.doors.find((d) => d.id === st.openDoor);
  if (open) o.push(line(open.a, open.b, "door open", `stroke-width="${wallWidthAt(f, open.a, open.b)}" pointer-events="none"`));
  for (const r of looseEnds(f)) { const p = f[r.k][r.i][r.end]; o.push(`<circle class="h" data-hp="${r.k}:${r.i}:${r.end}" cx="${num(p[0])}" cy="${num(p[1])}" r="${num(4.5 * k)}"/>`); }
  if (s?.t === "door" && f.doors[s.i]) for (const end of ["a", "b"] as const) { const p = f.doors[s.i][end]; o.push(`<circle class="h" data-dh="${s.i}:${end}" cx="${num(p[0])}" cy="${num(p[1])}" r="${num(5 * k)}"/>`); }
  if (s?.t === "v") { const p = ptOf(f, s.ref); if (p) o.push(`<circle class="h on" pointer-events="none" cx="${num(p[0])}" cy="${num(p[1])}" r="${num(5 * k)}"/>`); }
  o.push(...lens); // over every handle dot; a label takes no pointer, so the dots under it stay grabbable
  // Draw mode: the placed points and a dashed rubber band. Only the editor draws these; the card never sees them.
  const dr = ed.draw;
  if (dr?.points.length) {
    const pt = (p: Pt) => `${num(p[0])},${num(p[1])}`, path = dr.rubber(ed.hover ?? dr.points[dr.points.length - 1]) ?? [];
    o.push(`<polyline class="dr" data-draw="path" points="${path.map(pt).join(" ")}"/>`);
    if (dr.polygon && dr.points.length >= 2 && ed.hover) o.push(`<line class="dr" data-draw="close" x1="${num(ed.hover[0])}" y1="${num(ed.hover[1])}" x2="${num(dr.points[0][0])}" y2="${num(dr.points[0][1])}"/>`);
    if (dr.typed) {
      // S26.12: the typed length, upright at the pointer; "350" reads as cm, "3.5m" as it was typed.
      const at = ed.hover ?? ed.aim ?? dr.points[dr.points.length - 1], shown = dr.typed.endsWith("m") ? dr.typed : `${dr.typed} cm`; // typed holds digits, a dot and an m only
      o.push(`<text class="dr-typed" x="${num(at[0] + 10 * k)}" y="${num(at[1] - 10 * k)}"${upright(at[0], at[1])} font-size="${num(14 * k)}">${shown}</text>`);
    }
    dr.points.forEach((p, i) => o.push(`<circle class="dp${i === 0 ? " first" : ""}" data-dp="${i}" cx="${num(p[0])}" cy="${num(p[1])}" r="${num((i === 0 ? 6 : 4) * k)}"/>`));
  }
  // S26.10: the marquee, as the four plan-space corners of the screen rectangle; the turned plan turns it back upright.
  const mq = ed.drag?.type === "marquee" ? ed.drag.quad : null;
  if (mq) o.push(`<polygon class="marquee" points="${mq.map((q) => `${num(q[0])},${num(q[1])}`).join(" ")}"/>`);
  // S7.11: the points of a trace Scale step, and the line between them.
  const ts = ed.traceScale;
  if (ts?.length === 2) o.push(`<line class="dr" x1="${num(ts[0][0])}" y1="${num(ts[0][1])}" x2="${num(ts[1][0])}" y2="${num(ts[1][1])}"/>`);
  ts?.forEach((p) => o.push(`<circle class="dp first" cx="${num(p[0])}" cy="${num(p[1])}" r="${num(5 * k)}"/>`));
  return o.join("");
}
