import { type DeviceType, FURNITURE, FURNITURE_SYMBOLS, furnitureForType, nearestEdge, type Pt, UNLINKED_TYPES, type WallKind } from "../core";
import { newId, type PtRef, type Sel, slug } from "./state";
import { applyShape, type AreaPreset, Draw, type DrawKind, rayPoint, snapRay } from "./draw";
import { closeAlign } from "./editor-align";
import { DRAW_HINT, hasOwn, HOST, mirrorOnWall, round } from "./editor-kit";
import { cornerHit, snapCorner } from "./editor-pointer";
import { centre, ensureVisible, middle, spawn, spawnDevice } from "./editor-actions";
import { segmentAt, spawnInView, squareAt, stairsAt } from "./ops";
import { counted, placedNote } from "./editor-search";
import { typeNoun } from "./panels";
import type { FloorplanStudioEditor } from "./editor-app";

// ---- draw mode and the Add menu's placements -------------------------------------------------------------

/** A stand-in for "no dragged point": nothing is within reach of it. */
const NOWHERE: Pt = [-1e9, -1e9];

const NO_REF: PtRef = { k: "walls", i: -1, end: "a" };

/** Enters draw mode. Whatever was being drawn is dropped; the selection is cleared so no shape looks selected while drawing. */
export function startDraw(ed: FloorplanStudioEditor, kind: DrawKind, wall: WallKind = "wall", area?: AreaPreset) {
  if (ed.st.planLocked) { ed.planFixed(); return; }
  closeAlign(ed, false); // review 29: a draw and Align never run together
  ed.traceMove = false; // S40 review: Move takes the press before Draw sees it, so Draw would be dead
  ed.draw = new Draw(kind, wall, area);
  ed.hover = ed.aim = ed.rayAim = null;
  ed.st.sel = null;
  ed.st.confirmDelete = false;
  ed.status = DRAW_HINT;
  ed.closeMenus();
  ed.requestUpdate();
}

/** Leaves draw mode and forgets the points and the rubber band. Nothing is written. */
export function stopDraw(ed: FloorplanStudioEditor, status = "Drawing cancelled") {
  if (!ed.draw) return;
  ed.draw = null; ed.hover = ed.aim = ed.rayAim = null;
  ed.status = status;
  ed.requestUpdate();
}

/** A snapped point for draw mode. A zone snaps to the grid only: its corners never join other shapes (S1.8). */
export function snapDraw(ed: FloorplanStudioEditor, d: Draw, p: Pt, alt: boolean): Pt {
  ed.rayAim = null;
  const s = snapCorner(ed, ed.st.f, p, NOWHERE, NO_REF, alt, d.points, d.kind === "zone");
  // S26.12: after a first point the segment goes on the nearest 15 degree ray, unless a corner caught the pointer (asked of the
  // corner search itself: a corner can sit on the plain grid point, so comparing coordinates cannot tell), an alignment with an
  // earlier point did (then the point is not the plain grid one), or Alt is held.
  const last = d.points[d.points.length - 1];
  if (alt || !last) return s;
  if (d.kind !== "zone" && cornerHit(ed, ed.st.f, p, NOWHERE, NO_REF)) return s;
  const g = ed.st.snapGrid || 1, free: Pt = [Math.round(p[0] / g) * g, Math.round(p[1] / g) * g];
  if (s[0] !== free[0] || s[1] !== free[1]) return s;
  ed.rayAim = rayPoint(last, p, 15, ed.st.snapGrid); // the typed length goes along this exact ray, not along the whole-cm point
  return snapRay(last, p, 15, ed.st.snapGrid);
}

/** S26.12: Enter with a typed length: the next point that far from the last, toward the pointer. */
export function placeTyped(ed: FloorplanStudioEditor) {
  const d = ed.draw;
  if (!d) return;
  const toward = ed.rayAim ?? ed.aim ?? ed.hover;
  const r = toward ? d.placeTyped(toward) : "ignore";
  if (r === "ignore") { ed.status = `"${d.typed}" does not fit: type a length over 0 and up to 10000 cm, with the pointer away from the last point`; ed.requestUpdate(); return; }
  ed.hover = ed.rayAim = null;
  if (r === "finish") finishDraw(ed); else ed.requestUpdate();
}

/** Is `ev` the second half of a double-click that began at the press that finished a shape? Within 500 ms and 10 px. */
export function sameDouble(ed: FloorplanStudioEditor, ev: { clientX: number; clientY: number }): boolean {
  const f = ed.finished;
  return !!f && performance.now() - f.t <= 500 && Math.hypot(ev.clientX - f.x, ev.clientY - f.y) <= 10;
}

export function drawClick(ed: FloorplanStudioEditor, raw: Pt, alt: boolean, ev: { clientX: number; clientY: number }) {
  const d = ed.draw;
  if (!d) return;
  const r = d.click(snapDraw(ed, d, raw, alt), 14 / ed.scale, raw);
  ed.hover = null; ed.rayAim = null;
  if (r === "finish") { finishDraw(ed); ed.finished = { t: performance.now(), x: ev.clientX, y: ev.clientY, presses: 0 }; } else ed.requestUpdate();
}

/** Writes the shape as one undo step, or drops it when it has too few points. */
export function finishDraw(ed: FloorplanStudioEditor) {
  const d = ed.draw;
  if (!d) return;
  const shape = d.finish(), floor = ed.st.floor;
  ed.draw = null; ed.hover = ed.aim = ed.rayAim = null;
  if (!shape) { ed.status = "Drawing cancelled: too few points"; ed.requestUpdate(); return; }
  let sel: Sel = null, note = "";
  if (ed.st.edit((f) => { const r = applyShape(f, floor, shape); sel = r.sel; note = r.note ?? ""; return r.floor; })) {
    ed.st.sel = sel;
    ed.changed(note || "Added the shape");
    // A room made from walls asks for its name at once. The press that closed it still has its default focus move to come, so wait it out.
    if (note) void ed.updateComplete.then(() => setTimeout(() => ed.renderRoot.querySelector<HTMLInputElement>("#rn")?.focus(), 0));
  } else ed.requestUpdate();
}

export function addDoor(ed: FloorplanStudioEditor, kind: "door" | "window" | "slit" | "open", len: number, at?: Pt) {
  stopDraw(ed);
  const c = at ?? middle(ed) ?? centre(ed), e = nearestEdge(ed.st.f, c, Infinity, HOST), floor = ed.st.floor;
  ed.commit((f) => { f.doors.push({ id: newId(f, floor, "door"), name: `new ${kind === "slit" ? "slit window" : kind === "open" ? "open doorway" : kind}`, kind, ...segmentAt(e ? e.q : c, e ? e.u : [1, 0], len) }); });
  ed.st.sel = { t: "door", i: ed.st.f.doors.length - 1 };
  ed.requestUpdate();
}

/** An opening: a gap in a wall. Placed like a door on the edge nearest `at`, or the view centre when it is not given, else at that point. S4.27's wall context menu passes the right-click point. */
export function addOpeningGap(ed: FloorplanStudioEditor, len = 120, at?: Pt) {
  stopDraw(ed);
  const c = at ?? middle(ed) ?? centre(ed), e = nearestEdge(ed.st.f, c, Infinity, HOST), floor = ed.st.floor;
  ed.commit((f) => { f.openings.push({ id: newId(f, floor, "opening"), ...segmentAt(e ? e.q : c, e ? e.u : [1, 0], len) }); });
  ed.st.sel = { t: "opening", i: ed.st.f.openings.length - 1 };
  ed.requestUpdate();
}

export function addWall(ed: FloorplanStudioEditor, kind: WallKind) {
  stopDraw(ed);
  const p = spawn(ed), [x, y] = p, floor = ed.st.floor;
  ed.commit((f) => { f.walls.push({ id: newId(f, floor, "wall"), a: [x - 100, y], b: [x + 100, y], kind }); });
  ensureVisible(ed, [x - 100, y], [x + 100, y]);
  ed.st.sel = { t: "wall", i: ed.st.f.walls.length - 1 };
  ed.requestUpdate();
}

export function addStructure(ed: FloorplanStudioEditor) {
  stopDraw(ed);
  const p = spawn(ed), [x, y] = p, floor = ed.st.floor; // top-left corner: 400 cm centred on the spawn point would reach into the house
  ed.commit((f) => { f.rooms.push({ id: newId(f, floor, "room"), name: "New structure", area: slug("New structure"), kind: "structure", pts: [[x, y], [x + 400, y], [x + 400, y + 300], [x, y + 300]], wk: ["wall", "wall", "wall", "wall"] }); });
  ensureVisible(ed, [x, y], [x + 400, y + 300]);
  ed.st.sel = { t: "room", i: ed.st.f.rooms.length - 1 };
  ed.requestUpdate();
}

export function addArea(ed: FloorplanStudioEditor, kind: "zone") {
  stopDraw(ed);
  const p = spawn(ed, true), pts = squareAt(p, ed.st.snapGrid), floor = ed.st.floor, name = "New zone";
  ed.commit((f) => { f.rooms.push({ id: newId(f, floor, "room"), name, area: slug(name), kind, pts, wk: pts.map((): WallKind => "boundary") }); });
  ensureVisible(ed, ...pts);
  ed.st.sel = { t: "room", i: ed.st.f.rooms.length - 1 };
  ed.requestUpdate();
}

export function addStairs(ed: FloorplanStudioEditor) {
  stopDraw(ed);
  const t = stairsAt(spawn(ed, true), ed.st.snapGrid);
  if (!ed.st.addStairsEverywhere(t)) { ed.refused(); return; }
  ed.changed("Added stairs to every floor");
  ensureVisible(ed, ...t.pts);
}

export function addFurniture(ed: FloorplanStudioEditor, symbol: string) {
  if (!(FURNITURE_SYMBOLS as readonly string[]).includes(symbol)) return;
  if (ed.st.planLocked) { ed.planFixed(); return; }
  stopDraw(ed);
  const sym = symbol as keyof typeof FURNITURE, p = middle(ed) ? spawnDevice(ed) : spawn(ed), [x, y] = p, floor = ed.st.floor, before = counted(ed);
  // B53.12: a mirror lands on the nearest wall, turned with it (the same hosts a heater has).
  const hung = sym === "mirror" ? mirrorOnWall(ed.st.f, p, FURNITURE[sym].h) : null;
  const at = hung ?? { x, y, rot: 0 };
  if (!ed.st.edit((f) => { f.furniture.push({ id: newId(f, floor, "furniture"), symbol: sym, x: at.x, y: at.y, rot: at.rot, w: FURNITURE[sym].w, h: FURNITURE[sym].h }); })) { ed.refused(); return; }
  // Frame the piece where it landed (a hung mirror snaps up to 80 cm from the spawn point), turned: half its extent on each axis.
  const a = (at.rot * Math.PI) / 180, hx = (Math.abs(Math.cos(a)) * FURNITURE[sym].w + Math.abs(Math.sin(a)) * FURNITURE[sym].h) / 2, hy = (Math.abs(Math.sin(a)) * FURNITURE[sym].w + Math.abs(Math.cos(a)) * FURNITURE[sym].h) / 2;
  ensureVisible(ed, [at.x - hx, at.y - hy], [at.x + hx, at.y + hy]);
  ed.st.sel = { t: "furn", i: ed.st.f.furniture.length - 1 };
  placedNote(ed, before, "Edited", `Added ${sym}`);
}

/** S4.25: places an unlinked appliance (a fixed icon by type, not tied to one entity's state). */
export function addUnlinked(ed: FloorplanStudioEditor, type: string) {
  if (!(UNLINKED_TYPES as readonly string[]).includes(type)) return;
  stopDraw(ed);
  const t = type as DeviceType, p = spawnDevice(ed), [x, y] = p, floor = ed.st.floor, before = counted(ed);
  if (!ed.st.edit((f) => { f.unlinked.push({ id: newId(f, floor, "unl"), type: t, x, y, rot: 0, scale: 1 }); })) { ed.refused(); return; }
  ensureVisible(ed, [x - 30, y - 30], [x + 30, y + 30]);
  ed.st.sel = { t: "unl", i: ed.st.f.unlinked.length - 1 };
  placedNote(ed, before, "Edited", `Added ${typeNoun(t)}`);
}

export function placeDevice(ed: FloorplanStudioEditor, id: string) {
  const st = ed.st, c = st.layout.catalog.find((x) => x.id === id), before = counted(ed);
  if (!c) return;
  // The clicked item leaves the list on the next render; take focus first or the focus-out clears the new selection.
  ed.focus({ preventScroll: true });
  stopDraw(ed);
  const target = hasOwn(st.layout.floors, c.floor) ? c.floor : st.floor;
  st.snapshot();
  st.setFloor(target);
  ed.floor = target;
  const room = st.f.rooms.find((r) => r.name === c.room);
  let ctr = spawnInView(st.f, ed.addAt ?? centre(ed), st.snapGrid);
  if (room) ctr = round([room.pts.reduce((s, p) => s + p[0], 0) / room.pts.length, room.pts.reduce((s, p) => s + p[1], 0) / room.pts.length]);
  const f = structuredClone(st.f);
  // Opus re-check of S8.9: `c.id` survived a delete from the plan and `newId` could since have handed that same
  // id to an unrelated device (the bug placeArea's own fix, above, is against). Reuse it only when no floor's
  // device currently carries it; otherwise mint a fresh id and update the catalog entry in this same undo step
  // (already open: `st.snapshot()` ran before this method touched anything).
  const symbol = furnitureForType(c.type);
  const claimed = Object.values(st.layout.floors).some((fl) => [...fl.devices, ...fl.furniture].some((d) => d.id === c.id));
  const devId = claimed ? newId(f, target, symbol ? "furniture" : "device", st.layout) : c.id;
  if (claimed) c.id = devId;
  if (symbol) {
    // S18.11: a tv, speaker or computer is placed as the piece itself, tracking the entity (same default size as Add > Furniture).
    f.furniture.push({ id: devId, symbol, x: ctr[0], y: ctr[1], rot: 0, w: FURNITURE[symbol].w, h: FURNITURE[symbol].h, name: c.name, entity: c.entity });
  } else f.devices.push(c.type === "heater"
    ? { id: devId, name: c.name, type: c.type, entity: c.entity, a: [ctr[0] - 50, ctr[1]], b: [ctr[0] + 50, ctr[1]] }
    : { id: devId, name: c.name, type: c.type, entity: c.entity, x: ctr[0], y: ctr[1], ...st.powerFor(c.type, c.entity) });
  st.replaceFloor(f);
  st.sel = symbol ? { t: "furn", i: f.furniture.length - 1 } : { t: "dev", i: f.devices.length - 1 };
  const v = st.view;
  st.views[st.floor] = { ...v, x: ctr[0] - v.w / 2, y: ctr[1] - v.h / 2 };
  placedNote(ed, before, `Placed ${c.name}${room ? ` in ${room.name}` : ""}. Drag it to its spot.`, `Placed ${c.name}`);
}
