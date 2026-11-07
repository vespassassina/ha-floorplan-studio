import { dist, edgePoint, edgeRooms, worktopIndex, worktopPts, worktopShift, type Floor, insertPoint, nearestEdge, polys, type Pt, rotateAbout, snapped, snapPoint, stitch, type WallKind } from "../core";
import { type LooseRef, polyPts, ptOf, type PtRef, type Sel } from "./state";
import { type Drag, type Hit, HOST, mirrorOnWall, round } from "./editor-kit";
import { type Corner, furnitureNear, gridRound, looseEnds, movePointAll, pivotOnArc, pointsNear, scaleFurniture, segmentAt, snapRoomTo } from "./ops";
import { layerHides } from "../core/layers";
import { traceStep } from "./editor-trace";
import { drawClick, finishDraw, sameDouble, snapDraw } from "./editor-draw";
import { moveDevices } from "./bulk";
import { offerAreaMove } from "./editor-ha";
import { marqueeHits } from "./selection";
import { closeCtxMenu } from "./editor-popups";
import { ctxTargetFor } from "./ctx-menu";
import type { FloorplanStudioEditor } from "./editor-app";

// ---- the pointer: press, move, release, double-click, wheel, hit tests and the corner snap ---------------

/** Does this point reference a corner of a zone? A zone never joins another polygon. */
const isZoneRef = (f: Floor, ref: PtRef) => "poly" in ref && (worktopIndex(ref.poly) !== null || (ref.poly[0] === "r" && (f.rooms[+ref.poly.slice(1)]?.kind === "zone" || f.rooms[+ref.poly.slice(1)]?.free === true))); // a zone, a free room or a worktop is never stitched

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return dist(p, [a[0] + t * dx, a[1] + t * dy]);
}

/** What the pointer is over. `el` is the real top element under the pointer. */
function hitOf(el: Element | null): Hit {
  if (!el?.closest) return { k: "bg" };
  const dev = el.closest("g[data-x]"), bar = el.closest("[data-xbar]");
  if (dev) return { k: "dev", i: +(dev.getAttribute("data-x") ?? -1) };
  if (bar) return { k: "dev", i: +(bar.getAttribute("data-xbar") ?? -1) };
  const h = el.closest("[data-h]");
  if (h) { const [poly, j] = (h.getAttribute("data-h") ?? "").split(":"); return { k: "corner", poly, j: +j }; }
  const hp = el.closest("[data-hp]");
  if (hp) { const [k, i, end] = (hp.getAttribute("data-hp") ?? "").split(":"); return { k: "loose", ref: { k: k as LooseRef["k"], i: +i, end: end as "a" | "b" } }; }
  const dh = el.closest("[data-dh]");
  if (dh) { const [i, end] = (dh.getAttribute("data-dh") ?? "").split(":"); return { k: "dend", i: +i, end: end as "a" | "b" }; }
  const we = el.closest("[data-we]");
  if (we) { const [i, e] = (we.getAttribute("data-we") ?? "").split(":"); return { k: "wedge", i: +i, e: +e }; }
  const fh = el.closest("[data-fh]");
  if (fh) { const [i, corner] = (fh.getAttribute("data-fh") ?? "").split(":"); return { k: "fscale", i: +i, corner: corner as Corner }; }
  const d = el.closest("[data-d]");
  if (d) return { k: "door", i: +(d.getAttribute("data-d") ?? -1) };
  // An opening line has no data attribute (core draws it, the card must not change): it is the n-th `line.opening` of the plan.
  const op = el.closest("line.opening");
  if (op) return { k: "opening", i: Array.from(op.parentNode?.children ?? []).filter((c) => c.matches("line.opening")).indexOf(op) };
  const fu = el.closest("g[data-f]");
  if (fu) return { k: "furn", i: +(fu.getAttribute("data-f") ?? -1) };
  const un = el.closest("g[data-u]");
  if (un) return { k: "unl", i: +(un.getAttribute("data-u") ?? -1) };
  const e = el.closest("[data-e]");
  if (e) { const [poly, i] = (e.getAttribute("data-e") ?? "").split(":"); return { k: "edge", poly, i: +i }; }
  const w = el.closest("[data-w]");
  if (w) return { k: "wall", i: +(w.getAttribute("data-w") ?? -1) };
  const ex = el.closest("[data-ex]");
  if (ex) return { k: "extra", i: +(ex.getAttribute("data-ex") ?? -1) };
  const r = el.closest("[data-r]");
  if (r) return { k: "room", i: +(r.getAttribute("data-r") ?? -1) };
  const st = el.closest("[data-s]");
  if (st) return { k: "stairs", i: +(st.getAttribute("data-s") ?? -1) };
  return { k: "bg" };
}

/** S18.10: a small piece (a thin tv, a speaker) is picked from a padded box. It beats the room, the background and another
 *  piece under it; a handle, device, door or wall element really under the pointer still wins. */
export function padFurniture(ed: FloorplanStudioEditor, hit: Hit, p: Pt): Hit {
  if (hit.k !== "bg" && hit.k !== "room" && hit.k !== "stairs" && hit.k !== "furn") return hit;
  // S24.R8: the plan's own Layers rule, with the selection kept as renderFloor keeps it: hidden is not pickable.
  const st = ed.st, i = furnitureNear(st.f, p, ed.scale, (j) => layerHides(st.hidden, "furn", j, undefined, st.sel && "i" in st.sel ? st.sel : null));
  return i === null ? hit : { k: "furn", i };
}

export function edgeNear(ed: FloorplanStudioEditor, p: Pt): Hit | null {
  const th = 8 / ed.scale, f = ed.st.f;
  let best: { d: number; hit: Hit } | null = null;
  const ne = nearestEdge(f, p, th, { zones: true });
  if (ne) best = { d: ne.d, hit: { k: "edge", poly: ne.poly, i: ne.i } };
  f.walls.forEach((w, i) => { const d = segDist(p, w.a, w.b); if (d <= th && (!best || d < best.d)) best = { d, hit: { k: "wall", i } }; });
  return best ? (best as { hit: Hit }).hit : null;
}

/** The two neighbours of a dragged corner: never snap targets, landing on one would leave an edge of zero length. */
export function neighboursOf(ed: FloorplanStudioEditor, base: Floor, ref: PtRef): Pt[] {
  if (!("poly" in ref)) return [];
  const pts = polyPts(base, ref.poly) ?? [], n = pts.length;
  return [pts[(ref.j + 1) % n], pts[(ref.j + n - 1) % n]];
}

/** The loose end or polygon corner within reach of `p`, or null. Loose ends and corners compete in one list: the nearest wins. */
export function cornerHit(ed: FloorplanStudioEditor, base: Floor, p: Pt, from: Pt, ref: PtRef): Pt | null {
  const th = 14 / ed.scale, grp = pointsNear(base, from), neighbours = neighboursOf(ed, base, ref);
  const cands: Pt[] = looseEnds(base).map((r) => base[r.k][r.i][r.end]);
  for (const P of polys(base)) if (P.room?.kind !== "zone") cands.push(...P.pts); // a zone corner is never a target
  let best: Pt | null = null;
  for (const q of cands)
    if (!grp.includes(q) && !neighbours.some((m) => m[0] === q[0] && m[1] === q[1]) && dist(q, p) < th && (!best || dist(q, p) < dist(best, p))) best = q;
  return best ? [best[0], best[1]] : null;
}

/** `align`: extra points the result lines up with (the points of a shape being drawn).
 *  `zone`: the point belongs to a zone. One rule for draw and drag: it snaps to the grid and lines up with the other
 *  corners of its own zone, and to nothing else. A room, outline or stairs corner never attracts it. */
export function snapCorner(ed: FloorplanStudioEditor, base: Floor, p: Pt, from: Pt, ref: PtRef, alt: boolean, align: Pt[] = [], zone = false): Pt {
  if (alt) return round(p);
  if (zone) {
    const own = "poly" in ref ? (polyPts(base, ref.poly) ?? []).filter((q) => q !== from && !(q[0] === from[0] && q[1] === from[1])) : [];
    const none: Floor = { ...base, outline: [], rooms: [], stairs: [], walls: [], openings: [], extras: [] };
    return round(snapPoint(none, p, { threshold: 14 / ed.scale, grid: ed.st.snapGrid, exclude: [], neighbours: [...own, ...align] }));
  }
  const th = 14 / ed.scale, grp = pointsNear(base, from);
  const neighbours = neighboursOf(ed, base, ref);
  const isNeighbour = (q: Pt) => neighbours.some((m) => m[0] === q[0] && m[1] === q[1]);
  const hit = cornerHit(ed, base, p, from, ref);
  if (hit) return hit;
  const snapped = round(snapPoint(base, p, { threshold: th, grid: ed.st.snapGrid, exclude: grp, neighbours: [...neighbours, ...align] }));
  if (!isNeighbour(snapped)) return snapped;
  // snapPoint pulled it onto a neighbour (corner snap, or both axes lined up): keep it where the pointer is, on the grid if on
  const g = ed.st.snapGrid || 1;
  const free: Pt = [Math.round(p[0] / g) * g, Math.round(p[1] / g) * g];
  return isNeighbour(free) ? [from[0], from[1]] : free;
}

export const onDown = (ed: FloorplanStudioEditor, ev: PointerEvent) => {
  const svg = ed.svgEl;
  if (!svg) return;
  const st = ed.st, f = st.f;
  st.confirmDelete = false;
  const capture = () => { try { svg.setPointerCapture(ev.pointerId); } catch { /* synthetic pointer */ } };
  if (ev.button === 1 || ev.button === 2 || ev.ctrlKey || ev.metaKey) {
    ev.preventDefault();
    ed.drag = { type: "pan", sx: ev.clientX, sy: ev.clientY, v: { ...st.view }, button: ev.button, moved: false };
    capture();
    return;
  }
  if (ev.button !== 0) return;
  ed.focus({ preventScroll: true });
  const p = ed.toSvg(ev);
  // S7.11: a Scale step takes the next two clicks as its points, raw (no snap: they sit on the image, not the plan), and nothing else.
  if (ed.traceScale) { if (ed.traceScale.length < 2) { ed.traceScale.push(p); traceStep(ed); } return; }
  // S40.2: with Move on, the press is the image's alone: no wall, room or device under it takes it.
  if (ed.moving) {
    const t = f.trace;
    if (st.planLocked) { ed.planFixed(); return; }
    if (t) { ed.drag = { type: "trace", start: p, from: [t.x, t.y], moved: false, before: null }; capture(); }
    return;
  }
  if (ed.draw) { drawClick(ed, p, ev.altKey, ev); return; }
  // Review 29: Align is read-only. A press on the plan only pans (the wheel still zooms); nothing is selected, dragged or marqueed, so no invisible selection can be deleted.
  if (ed.aligning) { ed.drag = { type: "pan", sx: ev.clientX, sy: ev.clientY, v: { ...st.view }, button: 0, moved: false }; capture(); return; }
  // A press elsewhere, or late, is not the second click of that pair; a third press means the user double-clicked on purpose.
  if (ed.finished) { if (sameDouble(ed, ev) && ed.finished.presses === 0) ed.finished.presses = 1; else ed.finished = null; }
  // The edge reach (8 px) goes first: a thin tv lying flush on a wall must not swallow it with its own padded box.
  let hit = hitOf(ev.target as Element);
  if (hit.k === "bg" || hit.k === "room" || hit.k === "stairs") hit = edgeNear(ed, p) ?? hit;
  hit = padFurniture(ed, hit, p);
  const base = structuredClone(f);
  ed.drag = null;
  // S26.10: Shift+drag from the plan (the background, a room, stairs, furniture) is a marquee. Shift on a corner, a wall or a device keeps its old meaning.
  if (ev.shiftKey && (hit.k === "bg" || hit.k === "room" || hit.k === "stairs" || hit.k === "furn")) {
    const click: Sel | undefined = hit.k === "bg" ? undefined : { t: hit.k, i: hit.i };
    ed.drag = { type: "marquee", a: [ev.clientX, ev.clientY], cur: [ev.clientX, ev.clientY], quad: null, click, moved: false };
    capture();
    ed.requestUpdate();
    return;
  }
  switch (hit.k) {
    case "corner": case "loose": {
      const ref: PtRef = hit.k === "corner" ? { poly: hit.poly, j: hit.j } : hit.ref;
      const from = ptOf(f, ref);
      if (!from) break;
      st.sel = { t: "v", ref };
      if ("poly" in ref && worktopIndex(ref.poly) !== null && f.furniture[worktopIndex(ref.poly)!]?.locked) break; // a locked worktop only selects
      ed.drag = { type: "corner", base, from: [from[0], from[1]], ref, moved: false, to: [from[0], from[1]] };
      break;
    }
    case "dend": st.sel = { t: "door", i: hit.i }; ed.drag = { type: "dend", base, i: hit.i, end: hit.end, moved: false }; break;
    case "door": {
      const d = f.doors[hit.i];
      if (!d) break;
      st.sel = { t: "door", i: hit.i };
      ed.drag = { type: "door", base, i: hit.i, off: [p[0] - (d.a[0] + d.b[0]) / 2, p[1] - (d.a[1] + d.b[1]) / 2], len: dist(d.a, d.b), moved: false };
      break;
    }
    case "dev": {
      const d = f.devices[hit.i];
      if (!d) break;
      // S26.10 (was S4.5, lights and motion sensors of one kind): Shift+click toggles any device in or out of the selection. No drag on a Shift+click.
      if (ev.shiftKey) {
        const prevIs = st.sel?.t === "devs" ? st.sel.is : st.sel?.t === "dev" ? [st.sel.i] : [];
        const is = prevIs.includes(hit.i) ? prevIs.filter((i) => i !== hit.i) : [...prevIs, hit.i];
        st.sel = is.length > 1 ? { t: "devs", is } : is.length === 1 ? { t: "dev", i: is[0] } : null;
        break;
      }
      // S26.11: a press on a member of a multi-selection keeps it, and a drag moves every unlocked member.
      if (st.sel?.t === "devs" && st.sel.is.includes(hit.i)) {
        const is = st.sel.is;
        ed.drag = { type: "devs", base, is: [...is], i: hit.i, start: p, movable: is.some((j) => f.devices[j] && !f.devices[j].locked), moved: false, before: null };
        break;
      }
      st.sel = { t: "dev", i: hit.i };
      const c: Pt = "a" in d ? [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2] : [d.x, d.y];
      if (!d.locked) ed.drag = { type: "dev", base, i: hit.i, off: [p[0] - c[0], p[1] - c[1]], moved: false }; // S26.20: a locked device only selects
      break;
    }
    case "furn": {
      const m = f.furniture[hit.i];
      if (!m) break;
      st.sel = { t: "furn", i: hit.i };
      if (!m.locked) ed.drag = { type: "furn", base, i: hit.i, off: [p[0] - m.x, p[1] - m.y], moved: false };
      break;
    }
    case "wedge": {
      // B54.3: a press on a selected worktop's edge adds a corner there and carries it, as ONE undo step: the snapshot is taken now and the drag that may follow is part of it.
      const m = f.furniture[hit.i], pts = m ? worktopPts(m) : null;
      if (!m || !pts) break;
      st.sel = { t: "furn", i: hit.i };
      if (m.locked) break;
      const q = edgePoint(pts[hit.e], pts[(hit.e + 1) % pts.length], p), g = insertPoint(f, `w${hit.i}`, hit.e, q);
      if (g === f) { ed.status = "No corner added there: a worktop holds 3 to 64 corners and may not cross itself"; break; }
      st.snapshot(); st.replaceFloor(g);
      const ref: PtRef = { poly: `w${hit.i}`, j: hit.e + 1 };
      st.sel = { t: "v", ref };
      ed.drag = { type: "corner", base: structuredClone(g), from: q, ref, moved: true, to: q };
      break;
    }
    case "fscale": {
      const m = f.furniture[hit.i];
      if (!m) break;
      st.sel = { t: "furn", i: hit.i };
      if (!m.locked) ed.drag = { type: "fscale", base, i: hit.i, corner: hit.corner, moved: false };
      break;
    }
    case "unl": {
      const u = f.unlinked[hit.i];
      if (!u) break;
      st.sel = { t: "unl", i: hit.i };
      if (!u.locked) ed.drag = { type: "unl", base, i: hit.i, off: [p[0] - u.x, p[1] - u.y], moved: false };
      break;
    }
    case "edge": case "wall": {
      let ends: { from: Pt; ref: PtRef }[];
      if (hit.k === "edge") {
        const pts = polyPts(f, hit.poly);
        if (!pts) break;
        const j = (hit.i + 1) % pts.length;
        st.sel = { t: "edge", poly: hit.poly, i: hit.i };
        ends = [{ from: [...pts[hit.i]], ref: { poly: hit.poly, j: hit.i } }, { from: [...pts[j]], ref: { poly: hit.poly, j } }];
      } else {
        const w = f.walls[hit.i];
        if (!w) break;
        st.sel = { t: "wall", i: hit.i };
        ends = [{ from: [...w.a], ref: { k: "walls", i: hit.i, end: "a" } }, { from: [...w.b], ref: { k: "walls", i: hit.i, end: "b" } }];
      }
      ed.drag = { type: "edge", base, ends, start: p, moved: false, to: [] };
      break;
    }
    case "extra": {
      const x = f.extras[hit.i];
      if (!x) break;
      st.sel = { t: "extra", i: hit.i };
      const ends = [
        { from: [...x.a] as Pt, ref: { k: "extras", i: hit.i, end: "a" } as PtRef },
        { from: [...x.b] as Pt, ref: { k: "extras", i: hit.i, end: "b" } as PtRef },
      ];
      ed.drag = { type: "edge", base, ends, start: p, moved: false, to: [] };
      break;
    }
    case "room": {
      st.sel = { t: "room", i: hit.i };
      const r = f.rooms[hit.i];
      if (r) {
        // A room snapped to a neighbour can't be dragged loose by accident: it must be unsnapped first. Dragging it pans instead.
        if (r.free !== true && snapped(f, `r${hit.i}`)) ed.drag = { type: "pan", sx: ev.clientX, sy: ev.clientY, v: { ...st.view }, button: ev.button, moved: false };
        else ed.drag = { type: "room", base, list: "rooms", i: hit.i, start: p, moved: false };
      }
      break;
    }
    case "stairs":
      st.sel = { t: "stairs", i: hit.i };
      if (f.stairs[hit.i]) ed.drag = { type: "room", base, list: "stairs", i: hit.i, start: p, moved: false };
      break;
    case "opening": {
      const o = f.openings[hit.i];
      if (!o) break;
      st.sel = { t: "opening", i: hit.i };
      // S4.9: locked keeps an opening's length fixed for endpoint drags; it does not stop a whole-body slide, matching a door.
      ed.drag = { type: "opening", base, i: hit.i, off: [p[0] - (o.a[0] + o.b[0]) / 2, p[1] - (o.a[1] + o.b[1]) / 2], len: dist(o.a, o.b), moved: false };
      break;
    }
    default:
      st.sel = null;
      ed.drag = { type: "pan", sx: ev.clientX, sy: ev.clientY, v: { ...st.view }, button: ev.button, moved: false };
  }
  // Fix plan: a press still selects, so a wall or a room can be looked at, but only a device (or the view) follows the pointer.
  if (st.planLocked && ed.drag && ed.drag.type !== "pan" && ed.drag.type !== "dev" && ed.drag.type !== "devs" && ed.drag.type !== "unl") { ed.drag = null; ed.planFixed(); }
  capture();
  ed.requestUpdate();
};

/** First real change of a drag records the undo step. */
/** Escape in a drag of one device or a group: put them back and drop the drag. A group's history was never touched; a single drag's snapshot is taken back. The selection stays. */
export function cancelDeviceDrag(ed: FloorplanStudioEditor) {
  const d = ed.drag;
  if (d?.type !== "devs" && d?.type !== "dev") return;
  ed.st.replaceFloor(d.base);
  if (d.type === "dev" && d.moved) ed.st.dropSnapshot();
  ed.drag = null;
  ed.requestUpdate();
}

/** S40 review: Escape in a Move drag puts the image back where the press found it, writes no undo step and ends Move. */
export function cancelTraceDrag(ed: FloorplanStudioEditor) {
  const d = ed.drag, t = ed.st.f.trace;
  if (d?.type !== "trace") return;
  if (t && d.moved) ed.st.replaceFloor({ ...ed.st.f, trace: { ...t, x: d.from[0], y: d.from[1] } });
  ed.drag = null;
  ed.traceMove = false;
  ed.requestUpdate();
}

export function begin(ed: FloorplanStudioEditor, d: { moved: boolean }) {
  if (!d.moved) { d.moved = true; ed.st.snapshot(); }
}

export const onMove = (ed: FloorplanStudioEditor, ev: PointerEvent) => {
  const d = ed.drag, st = ed.st;
  if (!d && ed.draw) { ed.hover = ed.aim = snapDraw(ed, ed.draw, ed.toSvg(ev), ev.altKey); ed.requestUpdate(); return; }
  if (!d) return;
  if (d.type === "pan") {
    // Screen movement past a few pixels means this is a drag, not a (possibly right-button) click — same threshold "room" uses.
    if (!d.moved && Math.hypot(ev.clientX - d.sx, ev.clientY - d.sy) >= 4) d.moved = true;
    // The drag is on the screen; the view is in plan coordinates, so turn the shift back by the plan's rotation.
    const s = ed.scale, r = st.rotation, shift: Pt = [(ev.clientX - d.sx) / s, (ev.clientY - d.sy) / s];
    const [dx, dy] = r ? rotateAbout(shift, -r.deg, [0, 0]) : shift;
    st.views[st.floor] = { x: d.v.x - dx, y: d.v.y - dy, w: d.v.w, h: d.v.h };
    ed.requestUpdate();
    return;
  }
  if (d.type === "marquee") {
    d.cur = [ev.clientX, ev.clientY];
    if (!d.moved && Math.hypot(d.cur[0] - d.a[0], d.cur[1] - d.a[1]) >= 4) d.moved = true;
    if (d.moved) d.quad = marqueeQuad(ed, d.a, d.cur);
    ed.requestUpdate();
    return;
  }
  if (d.type === "trace") {
    const t = st.f.trace;
    if (!t) return;
    const p = ed.toSvg(ev), tenth = (n: number) => Math.round(n * 10) / 10;
    const x = tenth(d.from[0] + p[0] - d.start[0]), y = tenth(d.from[1] + p[1] - d.start[1]);
    if (!d.before) { if (x === t.x && y === t.y) return; d.before = structuredClone(st.layout); }
    d.moved = true;
    st.replaceFloor({ ...st.f, trace: { ...t, x, y } });
    ed.requestUpdate();
    return;
  }
  const p = ed.toSvg(ev), alt = ev.altKey, gs = alt ? 0 : st.snapGrid; // Alt: no grid for this gesture
  const g5 = (n: number) => gridRound(n, gs);
  let g: Floor | null = null;
  switch (d.type) {
    case "devs": {
      let dx = p[0] - d.start[0], dy = p[1] - d.start[1];
      if (!d.movable || (!d.moved && Math.hypot(dx, dy) * ed.scale < 4)) return;
      dx = gridRound(dx, gs); dy = gridRound(dy, gs);
      if (!d.before) { if (dx === 0 && dy === 0) return; d.before = structuredClone(st.layout); }
      d.moved = true;
      g = moveDevices(d.base, d.is, dx, dy);
      break;
    }
    case "corner": {
      let to = snapCorner(ed, d.base, p, d.from, d.ref, alt, [], isZoneRef(d.base, d.ref));
      // S4.9: a locked wall or opening keeps its length; the dragged end only pivots around the other, fixed end.
      if (!("poly" in d.ref) && (d.ref.k === "walls" || d.ref.k === "openings")) {
        const seg = d.base[d.ref.k][d.ref.i];
        if (seg?.locked) to = pivotOnArc(seg[d.ref.end === "a" ? "b" : "a"], to, dist(seg.a, seg.b), d.from);
      }
      if (!d.moved && dist(to, d.from) === 0) return;
      if (!d.moved) d.snapped = true;
      begin(ed, d); d.to = to;
      // Shift: only the grabbed corner moves and leaves the others behind
      g = movePointAll(d.base, d.from, to, ev.shiftKey, d.ref);
      break;
    }
    case "edge": {
      let dx = p[0] - d.start[0], dy = p[1] - d.start[1];
      if (!d.moved && Math.hypot(dx, dy) * ed.scale < 4) return;
      begin(ed, d);
      if (gs) { dx = gridRound(dx, gs); dy = gridRound(dy, gs); }
      g = d.base; d.to = [];
      for (const e of d.ends) {
        const to = round([e.from[0] + dx, e.from[1] + dy]);
        d.to.push(to);
        g = movePointAll(g, e.from, to, ev.shiftKey, e.ref);
      }
      break;
    }
    case "dend": {
      const door = d.base.doors[d.i], other = door[d.end === "a" ? "b" : "a"], cur = door[d.end];
      begin(ed, d);
      g = structuredClone(d.base);
      // S4.9: a locked door keeps its length; the dragged end only pivots around the other, fixed end.
      if (door.locked) g.doors[d.i][d.end] = pivotOnArc(other, p, dist(door.a, door.b), cur);
      else {
        const l = dist(cur, other) || 1, ux = (cur[0] - other[0]) / l, uy = (cur[1] - other[1]) / l;
        const t = Math.max(20, g5((p[0] - other[0]) * ux + (p[1] - other[1]) * uy));
        g.doors[d.i][d.end] = round([other[0] + ux * t, other[1] + uy * t]);
      }
      break;
    }
    case "door": {
      const c: Pt = [p[0] - d.off[0], p[1] - d.off[1]], e = nearestEdge(d.base, c, 60, HOST);
      if (!e) return;
      begin(ed, d);
      g = structuredClone(d.base);
      Object.assign(g.doors[d.i], segmentAt(e.q, e.u, d.len));
      break;
    }
    case "opening": {
      const c: Pt = [p[0] - d.off[0], p[1] - d.off[1]], e = nearestEdge(d.base, c, 60, HOST);
      if (!e) return;
      begin(ed, d);
      g = structuredClone(d.base);
      Object.assign(g.openings[d.i], segmentAt(e.q, e.u, d.len));
      break;
    }
    case "dev": {
      const dv = d.base.devices[d.i], c: Pt = [p[0] - d.off[0], p[1] - d.off[1]];
      begin(ed, d);
      g = structuredClone(d.base);
      const t = g.devices[d.i];
      if ("a" in dv && "a" in t) {
        const len = dist(dv.a, dv.b), e = nearestEdge(d.base, c, 80, HOST);
        if (e) {
          // sit 16 cm beside the nearest wall, parallel to it, on the side of the pointer
          const nx = -e.u[1], ny = e.u[0], sd = (c[0] - e.q[0]) * nx + (c[1] - e.q[1]) * ny >= 0 ? 1 : -1;
          Object.assign(t, segmentAt([e.q[0] + nx * sd * 16, e.q[1] + ny * sd * 16], e.u, len));
        } else Object.assign(t, segmentAt(c, [(dv.b[0] - dv.a[0]) / (len || 1), (dv.b[1] - dv.a[1]) / (len || 1)], len));
      } else if ("x" in t) { t.x = g5(c[0]); t.y = g5(c[1]); }
      break;
    }
    case "furn": {
      begin(ed, d);
      if (worktopPts(d.base.furniture[d.i])) {
        // B54.3: a worktop moves by its points; x and y follow as the box centre. Whole cm, so the points stay whole.
        const m = d.base.furniture[d.i];
        g = worktopShift(d.base, d.i, Math.round(g5(p[0] - d.off[0]) - m.x), Math.round(g5(p[1] - d.off[1]) - m.y));
        break;
      }
      g = structuredClone(d.base);
      g.furniture[d.i].x = g5(p[0] - d.off[0]);
      g.furniture[d.i].y = g5(p[1] - d.off[1]);
      // B53.12: a wall mirror snaps to the nearest wall and turns with it.
      if (g.furniture[d.i].symbol === "mirror") Object.assign(g.furniture[d.i], mirrorOnWall(d.base, [p[0] - d.off[0], p[1] - d.off[1]], g.furniture[d.i].h) ?? {});
      break;
    }
    case "unl": {
      begin(ed, d);
      g = structuredClone(d.base);
      g.unlinked[d.i].x = g5(p[0] - d.off[0]);
      g.unlinked[d.i].y = g5(p[1] - d.off[1]);
      break;
    }
    case "fscale": {
      const m0 = d.base.furniture[d.i];
      if (!m0) break;
      const to: Pt = [g5(p[0]), g5(p[1])]; // the snap grid applies to the moving corner, like every other handle
      const next = scaleFurniture(m0, d.corner, to, { shift: ev.shiftKey });
      if (!d.moved && next.w === m0.w && next.h === m0.h && next.x === m0.x && next.y === m0.y) return;
      begin(ed, d);
      g = structuredClone(d.base);
      g.furniture[d.i] = next;
      break;
    }
    case "room": {
      const dx = Math.round(p[0] - d.start[0]), dy = Math.round(p[1] - d.start[1]);
      if (!d.moved && Math.hypot(dx, dy) * ed.scale < 4) return;
      begin(ed, d);
      d.alt = alt;
      g = structuredClone(d.base);
      g[d.list][d.i].pts = d.base[d.list][d.i].pts.map((q): Pt => [q[0] + dx, q[1] + dy]);
      break;
    }
  }
  if (g) { st.replaceFloor(g); ed.requestUpdate(); }
};

export const onUp = (ed: FloorplanStudioEditor, ev: PointerEvent) => {
  const d = ed.drag, st = ed.st;
  ed.drag = null;
  if (!d) return;
  if (d.type === "pan") {
    // A right button pressed and released without a drag: not a pan, the context menu on whatever is under it.
    // (`ev.type === "pointercancel"` carries no useful position and is never this case.)
    if (d.button === 2 && !d.moved && ev.type === "pointerup") openCtxMenuAt(ed, ev.clientX, ev.clientY);
    return;
  }
  if (d.type === "marquee") { endMarquee(ed, d, ev); return; }
  if (d.type === "trace") {
    if (d.before && st.commitLiveEdit(d.before)) ed.changed("Image moved");
    else ed.requestUpdate();
    return;
  }
  if (d.type === "devs") {
    if (!d.moved) { st.sel = { t: "dev", i: d.i }; ed.requestUpdate(); } // a click, not a drag: the group gives way to the one pressed
    else if (d.before && st.commitLiveEdit(d.before)) ed.changed(`Moved ${d.is.length} devices`);
    else ed.requestUpdate();
    return;
  }
  if (d.type === "corner" && d.snapped && "poly" in d.ref && worktopIndex(d.ref.poly) !== null && JSON.stringify(st.f) === JSON.stringify(d.base)) {
    // Every move was refused (a worktop corner may not cross itself): the snapshot of the first move holds no change, so take it back.
    st.dropSnapshot();
    ed.status = "Corner not moved: a worktop may not cross itself";
    ed.requestUpdate();
    return;
  }
  if (d.moved) {
    // a corner dropped on another polygon's edge becomes a point of that polygon
    let f = st.f;
    // a zone corner is never stitched into a wall, even where another polygon has a corner at the same spot
    if (d.type === "corner") { if (!isZoneRef(d.base, d.ref)) f = stitch(f, d.to); }
    else if (d.type === "edge") { if (!d.ends.some((e) => isZoneRef(d.base, e.ref))) for (const q of d.to) f = stitch(f, q); }
    // a room dropped near where it belongs lands corner on corner and joins its neighbours again; Alt drops it as it is
    if (d.type === "room" && d.list === "rooms" && !d.alt) f = snapRoomTo(f, d.i, 14 / ed.scale);
    st.replaceFloor(f);
    if (d.type === "fscale") { const m = f.furniture[d.i]; ed.changed(`Scaled the ${m?.name || m?.symbol || "furniture"}`); }
    else ed.changed();
    if (d.type === "dev") void offerAreaMove(ed, d.i);
  } else ed.requestUpdate();
};

/** S26.10: the screen rectangle between two client points, as four corners in plan space (taken back through the view's turn). */
export function marqueeQuad(ed: FloorplanStudioEditor, a: [number, number], b: [number, number]): [Pt, Pt, Pt, Pt] {
  const at = (x: number, y: number) => ed.toSvg({ clientX: x, clientY: y });
  return [at(a[0], a[1]), at(b[0], a[1]), at(b[0], b[1]), at(a[0], b[1])];
}

/** S26.10: does the plan draw device `i` right now? A Layers family left off, or a detail level that drops it, leaves no element, or a hidden one. */
export function drawnDevice(ed: FloorplanStudioEditor, i: number): boolean {
  const el = ed.svgEl?.querySelector(`g.dev[data-x="${i}"], [data-xbar="${i}"]`);
  return !!el && getComputedStyle(el).display !== "none";
}

/** S26.10: every drawn device of the floor. */
export function drawnDevices(ed: FloorplanStudioEditor): number[] {
  return ed.st.f.devices.flatMap((_, i) => (drawnDevice(ed, i) ? [i] : []));
}

export function selectDevices(ed: FloorplanStudioEditor, is: number[]) {
  ed.st.sel = is.length > 1 ? { t: "devs", is } : is.length === 1 ? { t: "dev", i: is[0] } : null;
}

/** S26.10: the marquee is over. Without a drag it was a click (a room, stairs or furniture is selected, the background changes nothing); with one it adds the drawn devices inside to the selection. No undo step. */
export function endMarquee(ed: FloorplanStudioEditor, d: Extract<Drag, { type: "marquee" }>, ev: PointerEvent) {
  const st = ed.st;
  if (ev.type === "pointercancel") { ed.requestUpdate(); return; }
  if (!d.moved) { if (d.click) st.sel = d.click; ed.requestUpdate(); return; }
  const quad = marqueeQuad(ed, d.a, [ev.clientX, ev.clientY]);
  const hits = marqueeHits(st.f, quad, (i) => !drawnDevice(ed, i));
  const prev = st.sel?.t === "devs" ? st.sel.is : st.sel?.t === "dev" ? [st.sel.i] : [];
  const is = [...new Set([...prev, ...hits])];
  if (is.length) selectDevices(ed, is);
  ed.requestUpdate();
}

export const onDblClick = (ed: FloorplanStudioEditor, ev: MouseEvent) => {
  if (ed.aligning) return; // Review 29: Align is read-only
  if (ed.draw) { finishDraw(ed); return; }
  // The click that finished a shape already did its work; Firefox and Safari still send the dblclick for the pair.
  // The phantom pair is the finishing press plus exactly one more; a deliberate double-click is that press plus two.
  if (ed.finished) { const phantom = sameDouble(ed, ev) && ed.finished.presses === 1; ed.finished = null; if (phantom) return; }
  const p = ed.toSvg(ev);
  let hit = hitOf(ev.target as Element);
  if (hit.k !== "edge") hit = edgeNear(ed, p) ?? hit;
  if (hit.k !== "edge") return;
  const pts = polyPts(ed.st.f, hit.poly);
  if (!pts) return;
  const a = pts[hit.i], b = pts[(hit.i + 1) % pts.length], { poly, i } = hit, q = edgePoint(a, b, p);
  ed.commit((f) => insertPoint(f, poly, i, q));
  ed.st.sel = null;
  ed.requestUpdate();
};

export const onWheel = (ed: FloorplanStudioEditor, ev: WheelEvent) => {
  ev.preventDefault();
  closeCtxMenu(ed);
  const st = ed.st, v = st.view, k = ev.deltaY > 0 ? 1.12 : 1 / 1.12, p = ed.toSvg(ev);
  const cx = v.x + v.w / 2, cy = v.y + v.h / 2, nx = p[0] + (cx - p[0]) * k, ny = p[1] + (cy - p[1]) * k;
  st.views[st.floor] = { x: nx - (v.w * k) / 2, y: ny - (v.h * k) / 2, w: v.w * k, h: v.h * k };
  ed.requestUpdate();
};

/** The kind a room/outline edge shows in its own panel: the first room's, or the outline's own, "wall" with no room and no outline. */
export function edgeKind(ed: FloorplanStudioEditor, poly: string, i: number): WallKind | "none" {
  const rooms = edgeRooms(ed.st.f, poly, i);
  if (rooms.length) return rooms[0].room.wk[rooms[0].i];
  return poly === "o" ? (ed.st.f.owk?.[i] ?? "external") : "wall";
}

/**
 * S4.18/S26.20: a right-click opens the menu of whatever is under the pointer: a room, wall, door, opening, piece
 * of furniture, unlinked object, stairs, line, device or multi-selection, else the canvas (`ctxTargetFor` in
 * `ctx-menu.ts` decides, and selects the target). Called from `onUp`, not the `contextmenu` DOM event: `onDown`
 * already calls `preventDefault()` on every right-button pointerdown (so a right-drag pans the canvas), and that
 * suppresses the browser's own `contextmenu` event along with it. A stationary right-button press and release is
 * the signal instead, exactly how a left-button "room" drag already tells a click from a drag (`onUp`'s `d.moved`).
 */
export function openCtxMenuAt(ed: FloorplanStudioEditor, clientX: number, clientY: number) {
  if (ed.aligning) return; // Review 29: the menu selects and deletes; Align is read-only
  const el = (ed.renderRoot as unknown as DocumentOrShadowRoot).elementFromPoint(clientX, clientY);
  let hit = hitOf(el);
  if (hit.k === "bg" || hit.k === "room" || hit.k === "stairs") hit = edgeNear(ed, ed.toSvg({ clientX, clientY })) ?? hit;
  const target = ctxTargetFor(ed, hit);
  if (!target) { closeCtxMenu(ed); return; }
  ed.ctxMenu = { x: clientX, y: clientY, target };
  ed.focus({ preventScroll: true }); // a right click never focuses the host on its own; Escape needs it to
  ed.requestUpdate();
}
