import { roomAt, viewBoxFor } from "../core";
import type { Pt } from "../core";
import type { EditorState } from "./state";

/** What the host knows that the state does not: Alt is held, a shape is being drawn. */
export interface StatusView { alt: boolean; drawing: boolean }

export interface StatusFacts {
  /** The facts in order, without the lock. */
  parts: string[];
  locked: boolean;
  /** `parts` joined by " · ", then "Plan locked" while locked. */
  text: string;
}

const SEP = " · ";
const KIND_NAMES: Record<string, string> = { v: "Corner", edge: "Edge", wall: "Wall", door: "Door", opening: "Opening", dev: "Device", room: "Room", furn: "Furniture", stairs: "Stairs", extra: "Line", unl: "Object" };

const centreOf = (d: { x: number; y: number } | { a: Pt; b: Pt }): Pt => ("a" in d ? [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2] : [d.x, d.y]);

/** S26.22: the status bar's facts. Pure: the same state gives the same words. Never throws on a stale or junk selection. */
export function statusFacts(st: EditorState, v: StatusView): StatusFacts {
  const f = st.f, s = st.sel, parts: string[] = [];
  const roomName = (i: number): string => (i >= 0 && typeof f.rooms[i]?.name === "string" ? f.rooms[i].name : "");
  const roomOf = (idx: number[]): string => {
    const names = idx.map((i) => { const d = f.devices[i]; return d ? roomName(roomAt(f, centreOf(d))) : ""; });
    return names.length && names.every((n) => n && n === names[0]) ? names[0] : "";
  };
  if (s?.t === "devs") {
    const is = s.is.filter((i) => Number.isInteger(i) && !!f.devices[i]);
    parts.push(`${is.length} selected`);
    const r = roomOf(is);
    if (r) parts.push(r);
  } else if (s?.t === "dev") {
    const d = f.devices[s.i];
    if (d) { parts.push(d.name || d.type); const r = roomOf([s.i]); if (r) parts.push(r); }
  } else if (s?.t === "room") {
    const r = roomName(s.i);
    parts.push(r || KIND_NAMES.room);
  } else if (s) {
    parts.push(KIND_NAMES[s.t] ?? "Selected");
  }
  parts.push(v.alt || !st.snapGrid ? "Snap off" : `Snap ${st.snapGrid} cm`);
  if (v.drawing && !v.alt) parts.push("15°");
  const turn = ((Math.round(st.turnDeg) % 360) + 360) % 360;
  if (turn) parts.push(`Turned ${turn}°`);
  parts.push(f.title || st.floor);
  const fit = viewBoxFor(f, 80, st.rotation), w = st.view.w;
  const zoom = Number.isFinite(w) && w > 0 && Number.isFinite(fit.w) ? Math.round((fit.w / w) * 100) : 100;
  parts.push(`${zoom} %`);
  const locked = st.planLocked;
  return { parts, locked, text: (locked ? [...parts, "Plan locked"] : parts).join(SEP) };
}
