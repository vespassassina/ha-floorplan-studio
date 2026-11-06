import { stopDraw } from "./editor-draw";
import type { Floor } from "../core";
import type { FloorplanStudioEditor } from "./editor-app";

// ---- edits that touch one thing on the plan: attach an entity, lock the plan, texture and item turns -----

/** The one reply to a change the plan lock refused (Lock plan is on). */
export function planFixed(ed: FloorplanStudioEditor): boolean {
  ed.status = "The plan is locked. Devices and objects stay editable";
  ed.notify(ed.status, "error", { id: "bannerUnfix", label: "Unlock", run: () => setPlanLocked(ed, false) });
  ed.requestUpdate();
  return true;
}

/** The toolbar's Lock plan box and the banner's Unlock button both come here. */
export function setPlanLocked(ed: FloorplanStudioEditor, on: boolean) {
  ed.st.planLocked = on;
  ed.st.planBlocked = false; // a refusal from before belongs to the old setting
  if (on) stopDraw(ed);
  ed.status = on ? "Plan locked: only devices and objects can change" : "Plan unlocked";
  ed.requestUpdate();
}

/** S10.2: `PanelCtx.attachEntity` — names the entity (its catalog name, escaped by lit's own text interpolation)
 *  and `label` (the door/device/item) in the status line only when an icon was actually pulled off the plan. */
export const attachEntity = (ed: FloorplanStudioEditor, entity: string | string[], apply: (f: Floor) => void, label: string, keepDeviceId?: string) => {
  const r = ed.st.attachEntity(entity, apply, keepDeviceId);
  if (!r.changed) return;
  if (r.pulled) {
    const one = Array.isArray(entity) ? (entity.length === 1 ? entity[0] : "") : entity;
    const name = one ? ed.st.layout.catalog.find((c) => c.entity === one)?.name ?? one : "Some entities";
    ed.changed(`${name} attached to ${label}; its icon left the plan.`);
  } else ed.changed();
};

/** S11.2: `PanelCtx.attachToRoom` — one undo step, and the status line says where the sensor went. */
export const attachToRoom = (ed: FloorplanStudioEditor, i: number) => {
  const d = ed.st.f.devices[i], a = ed.st.roomAttach(i);
  if (!d || !a.ok) return;
  const room = ed.st.f.rooms[a.room].name || "the room", name = ed.st.layout.catalog.find((x) => x.entity === d.entity)?.name ?? d.entity;
  if (ed.st.attachToRoom(i)) ed.changed(`${name} attached to ${room}; its icon left the plan.`);
};

/** S4.22: the paint panel's rotation slider. `live` previews every tick via `replaceFloor` (no undo step, the same
 * pattern a mouse drag uses); `commit`, once at release, records the whole drag as one step — none if it ended back
 * where it started (mirrors `begin()`/`onUp` for a pointer drag). */
export const rotateTexture = (ed: FloorplanStudioEditor, on: "rooms" | "stairs" | "furniture", i: number, rot: number, phase: "live" | "commit") => {
  if (ed.st.planLocked) { ed.slideRefused(); return; } // a texture is the plan; the slider snaps back on the redraw
  // A commit with no prior live tick (a click on the track, or an arrow key) still needs a "before": take it now,
  // before the value below is applied.
  if (!ed.textureRotGesture) ed.textureRotGesture = structuredClone(ed.st.layout);
  const g = structuredClone(ed.st.f);
  const shape = g[on][i];
  const n = ((Math.trunc(rot) % 360) + 360) % 360; // 0 is never stored (matches paint()'s convention)
  if (shape) { if (n === 0) delete shape.textureRot; else shape.textureRot = n; }
  ed.st.replaceFloor(g);
  if (phase === "live") { ed.requestUpdate(); return; }
  const before = ed.textureRotGesture;
  ed.textureRotGesture = null;
  if (ed.st.commitLiveEdit(before)) ed.changed("Texture rotated");
  else ed.requestUpdate();
};

/** The furniture and unlinked panels' rotation slider. Same live/commit gesture as `rotateTexture`. */
export const rotateItem = (ed: FloorplanStudioEditor, on: "furniture" | "unlinked", i: number, rot: number, phase: "live" | "commit") => {
  if (on === "furniture" && ed.st.planLocked) { ed.slideRefused(); return; } // furniture is the plan; an object is not
  if (!ed.itemRotGesture) ed.itemRotGesture = structuredClone(ed.st.layout);
  const g = structuredClone(ed.st.f);
  const o = g[on][i];
  if (o) o.rot = ((Math.trunc(rot) % 360) + 360) % 360;
  ed.st.replaceFloor(g);
  if (phase === "live") { ed.requestUpdate(); return; }
  const before = ed.itemRotGesture;
  ed.itemRotGesture = null;
  if (ed.st.commitLiveEdit(before)) ed.changed("Rotated");
  else ed.requestUpdate();
};

/** S4.19: the paint panel's scale slider. Same live/commit gesture as `rotateTexture`. */
export const scaleTexture = (ed: FloorplanStudioEditor, on: "rooms" | "stairs" | "furniture", i: number, scale: number, phase: "live" | "commit") => {
  if (ed.st.planLocked) { ed.slideRefused(); return; }
  if (!ed.textureScaleGesture) ed.textureScaleGesture = structuredClone(ed.st.layout);
  const g = structuredClone(ed.st.f);
  const shape = g[on][i];
  const n = Math.min(2, Math.max(0.25, scale)); // matches paint()'s clamp; 1 is never stored
  if (shape) { if (n === 1) delete shape.textureScale; else shape.textureScale = n; }
  ed.st.replaceFloor(g);
  if (phase === "live") { ed.requestUpdate(); return; }
  const before = ed.textureScaleGesture;
  ed.textureScaleGesture = null;
  if (ed.st.commitLiveEdit(before)) ed.changed("Texture scale changed");
  else ed.requestUpdate();
};
