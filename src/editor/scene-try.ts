import { customCalls } from "../core/room-scenes";
import type { SceneCall } from "../core/room-scenes";
import type { SceneItem } from "../core";

// S17.7: Try and Restore in the scene designer. Try sends the draft to the real devices; before it does, it keeps what each device was
// doing, as a scene item, so Restore is the same `customCalls` with the old items. Pure over a writer with one method.

export interface CallWriter { callService(call: SceneCall): Promise<void> }
type State = { state?: unknown; attributes?: Record<string, unknown> } | null | undefined;

const num = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** What `entity` is doing now, as a scene item; null when it is unknown, unavailable, missing or of a type scenes do not cover. */
export function itemFromState(entity: string, s: State): SceneItem | null {
  if (!s || typeof s !== "object" || typeof s.state !== "string" || s.state === "unavailable" || s.state === "unknown") return null;
  const a = s.attributes && typeof s.attributes === "object" ? s.attributes : {};
  const domain = entity.split(".")[0], state = s.state;
  const off: SceneItem = { entity, on: false };
  switch (domain) {
    case "light": case "switch": case "fan": case "media_player":
      if (state === "off") return off;
      break;
    case "cover": if (state === "closed" || state === "closing") return off; break;
    case "climate": if (state === "off") return off; break;
    default: return null;
  }
  const it: SceneItem = { entity, on: true };
  if (domain === "light") {
    if (num(a.brightness)) it.brightness = Math.min(100, Math.max(1, Math.round((a.brightness / 255) * 100)));
    if (a.color_mode === "color_temp") { if (num(a.color_temp_kelvin)) it.kelvin = a.color_temp_kelvin; }
    else if (Array.isArray(a.hs_color) && num(a.hs_color[0]) && num(a.hs_color[1])) it.hs = [a.hs_color[0], a.hs_color[1]];
  } else if (domain === "fan") { if (num(a.percentage)) it.percentage = a.percentage; }
  else if (domain === "cover") { if (num(a.current_position)) it.position = a.current_position; }
  else if (domain === "climate") { it.hvac = state; if (num(a.temperature)) it.temperature = a.temperature; }
  else if (domain === "media_player") {
    if (num(a.volume_level)) it.volume = Math.round(a.volume_level * 100);
    if (typeof a.source === "string" && a.source) it.source = a.source;
  }
  return it;
}

/** Sends every call; a failing one is noted and the rest still go. Resolves to the entities that failed. */
async function send(w: CallWriter, items: SceneItem[]): Promise<string[]> {
  const failed: string[] = [];
  for (const c of customCalls({ id: "try", name: "try", items })) {
    try { await w.callService(c); } catch { const e = String(c.data.entity_id); if (!failed.includes(e)) failed.push(e); }
  }
  return failed;
}

export interface TryResult {
  /** What to put back: the first state seen for each entity since the first Try. */
  backup: SceneItem[];
  /** Entities with a call that Home Assistant refused. */
  failed: string[];
  /** Entities that were tried but whose old state is unknown, so Restore cannot put them back. */
  unrestorable: string[];
}

/** Keeps the old state of every entity of `items` not already in `backup`, then sends `items`. */
export async function tryScene(w: CallWriter, items: SceneItem[], states: Record<string, State>, backup: SceneItem[]): Promise<TryResult> {
  const kept = [...backup], unrestorable: string[] = [];
  for (const it of items) {
    if (kept.some((b) => b.entity === it.entity)) continue;
    const old = itemFromState(it.entity, states[it.entity]);
    if (old) kept.push(old); else unrestorable.push(it.entity);
  }
  return { backup: kept, failed: await send(w, items), unrestorable };
}

/** Puts back what Try kept. Resolves to the entities that could not be put back. */
export const restoreScene = (w: CallWriter, backup: SceneItem[]): Promise<string[]> => send(w, backup);
