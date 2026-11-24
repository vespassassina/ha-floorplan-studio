// S50: Shared lazy WYSIWYG scene editor popup for both the dashboard card and Studio.
// Zero runtime imports so Rollup isolates this into floorplan-studio-scene-<hash>.js.
import type { html as Html } from "lit";
import type { Floor, RoomScene, SceneItem, StateOverlay, RenderOpts, Theme, Layout } from "../../core";
import type { SceneCall } from "../../core/room-scenes";

export const SCENE_EDITOR_CHUNK = "fp-scene-v1";

export interface SceneEditorTools {
  html: typeof Html;
  nothing: unknown;
  svgAttr?: (value: string) => unknown;
  svgBody?: (value: string) => unknown;
  renderFloor: (f: Floor, o: RenderOpts) => string;
  customCalls: (scene: RoomScene) => SceneCall[];
  live?: <T>(value: T) => unknown;
  readImageColours?: (file: File, max: number) => Promise<string[]>;
}

export interface SceneTarget {
  entity: string;
  name: string;
  domain: string;
  devIndex?: number;
  doorIndex?: number;
}

export interface DynamicStep {
  items: Map<string, SceneItem>;
  duration: number;
  transition?: number;
}

export interface DynamicStepData {
  items: SceneItem[];
  duration: number;
  transition?: number;
}

/** S63: existing Home Assistant scene, dynamic script, or Hue scene discovered in a room's area. */
export interface RoomHaSceneItem {
  entityId: string;
  configId: string;
  name: string;
  kind: "scene" | "dynamic" | "hue";
  platform?: string;
}

export interface SceneEditorDraft {
  roomId: string;
  roomIndex: number;
  id: string | null;
  haSceneId: string | null;
  name: string;
  items: Map<string, SceneItem>;
  selected: string | null;
  palette: string[];
  error: string;
  note: string;
  trying: string;
  busy: boolean;
  migrating: boolean;
  backup: SceneItem[];
  origin: SceneItem[];
  /** S51: dynamic multi-step scene fields (`script.*`). */
  mode?: "static" | "dynamic";
  steps?: DynamicStep[];
  activeStep?: number;
  loop?: boolean;
  /** S63: existing HA/Hue scenes discovered for this room + active Hue migration target. */
  haList?: RoomHaSceneItem[];
  haLoaded?: boolean;
  replaceHueEntity?: string | null;
  disableHueOnSave?: boolean;
}

export interface SceneEditorHass {
  states?: Record<string, { state?: string; attributes?: Record<string, unknown>; last_changed?: string } | undefined>;
  user?: { is_admin?: boolean };
  callService?: (domain: string, service: string, data?: Record<string, unknown>) => Promise<unknown> | void;
  callApi?: <T = unknown>(method: "GET" | "POST" | "DELETE", path: string, params?: Record<string, unknown>) => Promise<T>;
  callWS?: <T = unknown>(msg: { type: string; [k: string]: unknown }) => Promise<T>;
}

export interface SceneEditorModel {
  host: "card" | "studio";
  floor: Floor;
  roomIndex: number;
  roomName: string;
  roomArea: string;
  draft: SceneEditorDraft;
  targets: SceneTarget[];
  liveStates: StateOverlay;
  theme?: Theme;
  dark?: boolean;
  colors?: Layout["colors"];
  wallColors?: Layout["wallColors"];
  closeIcon?: string;
  pos?: { x: number; y: number };
  head?: { down: (e: PointerEvent) => void; move: (e: PointerEvent) => void; up: () => void };
  canWriteHa: boolean;
  canSaveLocal: boolean;
  canTry: boolean;
  legacyScenes: RoomScene[];
  refresh: () => void;
  close: () => void;
  save: () => void;
  tryRun: () => void;
  tryRestore: () => void;
  capture: () => void;
  migrateLegacy?: () => void;
  /** S63: load an existing HA scene/script into the editor, or migrate a Hue scene. */
  loadExisting?: (item: RoomHaSceneItem) => void;
  migrateHue?: (item: RoomHaSceneItem) => void;
}

export const MIN_LOOP_SEC_PER_LIGHT = 2;
export const MAX_CALLS_PER_MIN = 30;
export const MAX_DYNAMIC_STEPS = 20;

const DOMAINS = new Set(["light", "switch", "fan", "cover", "climate", "media_player"]);
const FIELDS: Record<string, readonly string[]> = {
  light: ["brightness", "kelvin", "hs", "transition", "effect"],
  switch: [],
  fan: ["percentage"],
  cover: ["position", "tilt"],
  climate: ["hvac", "temperature", "fan_mode"],
  media_player: ["volume", "source"],
};
const LABEL: Record<string, string> = {
  brightness: "brightness %", kelvin: "kelvin", transition: "transition s", effect: "effect",
  percentage: "speed %", position: "position %", tilt: "tilt %",
  temperature: "temp °C", volume: "volume %", hvac: "mode", source: "source", fan_mode: "fan mode",
};
const NUMERIC = new Set(["brightness", "kelvin", "transition", "percentage", "position", "tilt", "temperature", "volume"]);
const STEP: Record<string, string> = { temperature: "0.5", transition: "0.5" };
const RANGE: Record<string, [number, number]> = {
  brightness: [1, 100], kelvin: [1000, 10000], transition: [0, 300],
  percentage: [0, 100], position: [0, 100], tilt: [0, 100], temperature: [5, 35], volume: [0, 100],
};
export const DEFAULT_SCENE_PALETTE = ["#ff8a3d", "#ffd23d", "#3d7bff"];
const MAX_PALETTE = 6;
const fin = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

export function createSceneDraft(
  roomId: string,
  roomIndex: number,
  id: string | null,
  name: string,
  items: SceneItem[],
  haSceneId: string | null = null,
): SceneEditorDraft {
  return {
    roomId, roomIndex, id, haSceneId, name,
    items: new Map(items.map((it) => [it.entity, { ...it, ...(it.hs ? { hs: [it.hs[0], it.hs[1]] as [number, number] } : {}) }])),
    selected: items[0]?.entity ?? null,
    palette: [...DEFAULT_SCENE_PALETTE],
    error: "", note: "", trying: "", busy: false, migrating: false, backup: [], origin: [],
  };
}

function insidePoly(p: [number, number], poly: [number, number][]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function ptNearPoly(p: [number, number], poly: [number, number][], tol = 35): boolean {
  if (insidePoly(p, poly)) return true;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    if (Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)) <= tol) return true;
  }
  return false;
}

/** Bounding box of `floor.rooms[roomIndex]` padded by `pad` cm for the magnified WYSIWYG room view. */
export function roomCropBox(floor: Floor, roomIndex: number, pad = 45): { x: number; y: number; w: number; h: number } {
  const pts = floor?.rooms?.[roomIndex]?.pts;
  if (!Array.isArray(pts) || pts.length < 3) return { x: 0, y: 0, w: 400, h: 300 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (!Array.isArray(p) || !fin(p[0]) || !fin(p[1])) continue;
    if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 400, h: 300 };
  return { x: x0 - pad, y: y0 - pad, w: Math.max(80, x1 - x0 + pad * 2), h: Math.max(80, y1 - y0 + pad * 2) };
}

/** Every controllable device in `floor.rooms[roomIndex]` (light, switch, fan, cover, climate, media_player) plus door covers. */
export function sceneTargets(floor: Floor, roomIndex: number): SceneTarget[] {
  const r = floor?.rooms?.[roomIndex];
  if (!r || !Array.isArray(r.pts) || r.pts.length < 3) return [];
  const seen = new Set<string>(), out: SceneTarget[] = [];
  (floor.devices ?? []).forEach((d, devIndex) => {
    if (typeof d?.entity !== "string") return;
    const domain = d.entity.split(".")[0] ?? "";
    if (!DOMAINS.has(domain) || seen.has(d.entity)) return;
    const pt: [number, number] = "a" in d ? [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2] : [d.x, d.y];
    if (!fin(pt[0]) || !fin(pt[1]) || !insidePoly(pt, r.pts)) return;
    seen.add(d.entity);
    out.push({ entity: d.entity, name: d.name || d.id || d.entity, domain, devIndex });
  });
  (floor.doors ?? []).forEach((d, doorIndex) => {
    if (typeof d?.cover !== "string" || !d.cover.startsWith("cover.") || seen.has(d.cover)) return;
    const mid: [number, number] = [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2];
    if (!ptNearPoly(mid, r.pts)) return;
    seen.add(d.cover);
    out.push({ entity: d.cover, name: d.name || d.cover, domain: "cover", doorIndex });
  });
  return out;
}

export function hsToRgb(h: number, s: number): [number, number, number] {
  const sn = Math.max(0, Math.min(100, s)) / 100, c = sn, hp = (((h % 360) + 360) % 360) / 60, x = c * (1 - Math.abs((hp % 2) - 1)), m = 1 - c;
  const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

export function kelvinToRgb(k: number): [number, number, number] {
  const t = Math.max(1000, Math.min(10000, k)) / 100;
  const r = t <= 66 ? 255 : Math.min(255, Math.max(0, Math.round(329.698727446 * Math.pow(t - 60, -0.1332047592))));
  const g = t <= 66
    ? Math.min(255, Math.max(0, Math.round(99.4708025861 * Math.log(t) - 161.1195681661)))
    : Math.min(255, Math.max(0, Math.round(288.1221695283 * Math.pow(t - 60, -0.0755148492))));
  const b = t >= 66 ? 255 : t <= 19 ? 0 : Math.min(255, Math.max(0, Math.round(138.5177312231 * Math.log(t - 10) - 305.0447927307)));
  return [r, g, b];
}

export function hsToHex(h: number, s: number): string {
  return "#" + hsToRgb(h, s).map((n) => n.toString(16).padStart(2, "0")).join("");
}

export function hexToHs(hex: string): [number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const r = parseInt(m[1]!.slice(0, 2), 16) / 255, g = parseInt(m[1]!.slice(2, 4), 16) / 255, b = parseInt(m[1]!.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const s = max === 0 ? 0 : (d / max) * 100;
  let h = 0;
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    if (h < 0) h += 360;
  }
  return [Math.round(h), Math.round(s)];
}

function spreadColours(palette: string[], count: number): [number, number][] {
  const cols = palette
    .map((hex) => {
      const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
      if (!m) return null;
      const r = parseInt(m[1]!.slice(0, 2), 16), g = parseInt(m[1]!.slice(2, 4), 16), b = parseInt(m[1]!.slice(4, 6), 16);
      const hs = hexToHs(hex);
      return hs ? { hs, lum: 0.2126 * r + 0.7152 * g + 0.0722 * b } : null;
    })
    .filter((x): x is { hs: [number, number]; lum: number } => x !== null)
    .sort((a, b) => b.lum - a.lum);
  if (!cols.length || count <= 0) return [];
  return Array.from({ length: count }, (_, i) => cols[i % cols.length]!.hs);
}

/** Synthesizes a `StateOverlay` for WYSIWYG `renderFloor` preview without touching any real device. */
export function scenePreviewStates(items: Iterable<SceneItem>, liveStates: StateOverlay): StateOverlay {
  const out: StateOverlay = { ...liveStates };
  const now = new Date().toISOString();
  for (const it of items) {
    const domain = it.entity.split(".")[0] ?? "";
    if (!DOMAINS.has(domain)) continue;
    const prev = liveStates[it.entity];
    const attrs: Record<string, unknown> = { ...(prev?.attributes ?? {}) };
    if (!it.on) {
      out[it.entity] = { state: domain === "cover" ? "closed" : "off", attributes: attrs, last_changed: now };
      continue;
    }
    let state = "on";
    if (domain === "light") {
      if (fin(it.brightness)) attrs.brightness = Math.round((it.brightness / 100) * 255);
      if (Array.isArray(it.hs)) { attrs.hs_color = it.hs; attrs.rgb_color = hsToRgb(it.hs[0], it.hs[1]); delete attrs.color_temp_kelvin; }
      else if (fin(it.kelvin)) { attrs.color_temp_kelvin = it.kelvin; attrs.rgb_color = kelvinToRgb(it.kelvin); delete attrs.hs_color; }
    } else if (domain === "cover") {
      state = fin(it.position) && it.position <= 0 ? "closed" : "open";
      if (fin(it.position)) attrs.current_position = it.position;
      if (fin(it.tilt)) attrs.current_tilt_position = it.tilt;
    } else if (domain === "climate") {
      state = it.hvac || "heat";
      if (fin(it.temperature)) attrs.temperature = it.temperature;
      if (it.fan_mode) attrs.fan_mode = it.fan_mode;
    } else if (domain === "media_player") {
      state = "playing";
      if (fin(it.volume)) attrs.volume_level = it.volume / 100;
      if (it.source) attrs.source = it.source;
    } else if (domain === "fan") {
      if (fin(it.percentage)) attrs.percentage = it.percentage;
    }
    out[it.entity] = { state, attributes: attrs, last_changed: now };
  }
  return out;
}

/** Captures current live HA states for every target in the room into a `Map<string, SceneItem>`. */
export function captureRoomItems(
  targets: readonly SceneTarget[],
  liveStates: Record<string, { state?: unknown; attributes?: Record<string, unknown> } | undefined>,
): Map<string, SceneItem> {
  const out = new Map<string, SceneItem>();
  for (const t of targets) {
    const s = liveStates[t.entity];
    if (!s || typeof s.state !== "string" || s.state === "unavailable" || s.state === "unknown") continue;
    const a = s.attributes && typeof s.attributes === "object" ? s.attributes : {};
    const off = t.domain === "cover" ? (s.state === "closed" || s.state === "closing") : s.state === "off";
    if (off) { out.set(t.entity, { entity: t.entity, on: false }); continue; }
    const it: SceneItem = { entity: t.entity, on: true };
    if (t.domain === "light") {
      if (fin(a.brightness)) it.brightness = Math.min(100, Math.max(1, Math.round((a.brightness / 255) * 100)));
      if (a.color_mode === "color_temp") { if (fin(a.color_temp_kelvin)) it.kelvin = a.color_temp_kelvin; }
      else if (Array.isArray(a.hs_color) && fin(a.hs_color[0]) && fin(a.hs_color[1])) it.hs = [a.hs_color[0], a.hs_color[1]];
    } else if (t.domain === "fan") { if (fin(a.percentage)) it.percentage = a.percentage; }
    else if (t.domain === "cover") {
      if (fin(a.current_position)) it.position = a.current_position;
      if (fin(a.current_tilt_position)) it.tilt = a.current_tilt_position;
    } else if (t.domain === "climate") {
      it.hvac = s.state;
      if (fin(a.temperature)) it.temperature = a.temperature;
      if (typeof a.fan_mode === "string" && a.fan_mode) it.fan_mode = a.fan_mode;
    } else if (t.domain === "media_player") {
      if (fin(a.volume_level)) it.volume = Math.round(a.volume_level * 100);
      if (typeof a.source === "string" && a.source) it.source = a.source;
    }
    out.set(t.entity, it);
  }
  return out;
}

/** Builds Home Assistant's `POST /api/config/scene/config/<id>` payload for a list of `SceneItem`s. */
export function haScenePayload(id: string, name: string, items: readonly SceneItem[]): { id: string; name: string; entities: Record<string, Record<string, unknown>> } {
  const entities: Record<string, Record<string, unknown>> = {};
  for (const it of items) {
    const domain = it.entity.split(".")[0] ?? "";
    if (!DOMAINS.has(domain)) continue;
    if (!it.on) {
      entities[it.entity] = { state: domain === "cover" ? "closed" : "off", ...(domain === "light" && fin(it.transition) ? { transition: it.transition } : {}) };
      continue;
    }
    const e: Record<string, unknown> = { state: domain === "cover" ? (fin(it.position) && it.position <= 0 ? "closed" : "open") : domain === "climate" ? (it.hvac || "heat") : "on" };
    if (domain === "light") {
      if (fin(it.brightness)) e.brightness = Math.round((it.brightness / 100) * 255);
      if (Array.isArray(it.hs)) e.hs_color = [it.hs[0], it.hs[1]];
      else if (fin(it.kelvin)) e.color_temp_kelvin = it.kelvin;
      if (fin(it.transition)) e.transition = it.transition;
      if (it.effect) e.effect = it.effect;
    } else if (domain === "cover") {
      if (fin(it.position)) e.current_position = it.position;
      if (fin(it.tilt)) e.current_tilt_position = it.tilt;
    } else if (domain === "climate") {
      if (fin(it.temperature)) e.temperature = it.temperature;
      if (it.fan_mode) e.fan_mode = it.fan_mode;
    } else if (domain === "media_player") {
      if (fin(it.volume)) e.volume_level = it.volume / 100;
      if (it.source) e.source = it.source;
    } else if (domain === "fan") {
      if (fin(it.percentage)) e.percentage = it.percentage;
    }
    entities[it.entity] = e;
  }
  return { id, name: name.trim(), entities };
}

/** Writes a Home Assistant `scene.*` via `/api/config/scene/config/<id>` and assigns it to `areaId` + `floorplan-studio` label. */
export async function saveHaScene(
  hass: SceneEditorHass,
  opts: { id?: string | null; name: string; areaId?: string; items: readonly SceneItem[]; tries?: number; retryMs?: number },
): Promise<{ id: string; entityId: string | null }> {
  const name = opts.name.trim();
  if (!name) throw new Error("Give the scene a name.");
  if (!opts.items.length) throw new Error("Pick at least one device.");
  if (hass.user?.is_admin === false) throw new Error("Only a Home Assistant administrator can save scenes.");
  if (!hass.callApi) throw new Error("Saving Home Assistant scenes requires a Home Assistant connection.");
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24) || "scene";
  const id = opts.id || `fp_${slug}_${Math.random().toString(36).slice(2, 7)}`;
  const payload = haScenePayload(id, name, opts.items);
  try {
    await hass.callApi("POST", `config/scene/config/${id}`, payload as unknown as Record<string, unknown>);
  } catch (err) {
    const status = (err as { status_code?: number; status?: number })?.status_code ?? (err as { status?: number })?.status;
    const msg = err instanceof Error ? err.message : String((err as { message?: unknown })?.message ?? err);
    if (status === 404 || status === 405 || status === 501 || /not found|scenes\.yaml|unsupported/i.test(msg)) {
      throw new Error("Home Assistant could not save to scenes.yaml. Add `scene: !include scenes.yaml` to configuration.yaml and reload scenes.");
    }
    throw new Error(`Could not save Home Assistant scene: ${msg}`);
  }
  let entityId: string | null = null;
  if (hass.callWS) {
    let labelId: string | null = null;
    try {
      const labels = await hass.callWS<{ label_id: string; name: string }[]>({ type: "config/label_registry/list" });
      labelId = labels.find((l) => l.name === "floorplan-studio")?.label_id ?? null;
      if (!labelId) {
        const created = await hass.callWS<{ label_id: string }>({ type: "config/label_registry/create", name: "floorplan-studio" });
        labelId = created.label_id;
      }
    } catch { /* label optional */ }
    const tries = opts.tries ?? 8, ms = opts.retryMs ?? 300;
    for (let n = 0; n < tries; n++) {
      try {
        const all = await hass.callWS<{ entity_id: string; unique_id?: string; labels?: string[] }[]>({ type: "config/entity_registry/list" });
        const hit = all.find((e) => e.unique_id === id && e.entity_id.startsWith("scene."));
        if (hit) {
          entityId = hit.entity_id;
          const upd: Record<string, unknown> = { type: "config/entity_registry/update", entity_id: hit.entity_id };
          if (opts.areaId) upd.area_id = opts.areaId;
          if (labelId) upd.labels = [...new Set([...(hit.labels ?? []), labelId])];
          if (opts.areaId || labelId) await hass.callWS(upd as { type: string; [k: string]: unknown });
          break;
        }
      } catch { break; }
      if (n < tries - 1) await new Promise((r) => setTimeout(r, ms));
    }
  }
  return { id, entityId };
}

/** S51: collects native `effect_list` effects offered by lights in the room (zero Zigbee loop traffic). */
export function lightEffectsFor(
  targets: readonly SceneTarget[],
  liveStates: Record<string, { attributes?: Record<string, unknown> } | undefined>,
): { effect: string; entities: string[] }[] {
  const map = new Map<string, string[]>();
  for (const t of targets) {
    if (t.domain !== "light") continue;
    const list = liveStates[t.entity]?.attributes?.effect_list;
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      if (typeof raw !== "string") continue;
      const eff = raw.trim();
      if (!eff || eff.toLowerCase() === "none" || eff.toLowerCase() === "off") continue;
      const arr = map.get(eff) ?? [];
      if (!arr.includes(t.entity)) arr.push(t.entity);
      map.set(eff, arr);
    }
  }
  return [...map.entries()].map(([effect, entities]) => ({ effect, entities })).sort((a, b) => a.effect.localeCompare(b.effect));
}

/** S51: enforces the Zigbee traffic budget before saving a dynamic scene (`script.*`). */
export function checkDynamicBudget(
  steps: readonly DynamicStepData[],
  loop: boolean,
  customCalls: (scene: RoomScene) => SceneCall[],
): { ok: true; callsPerMin: number; totalCalls: number } | { ok: false; reason: string } {
  if (!steps.length) return { ok: false, reason: "Add at least one step." };
  if (steps.length > MAX_DYNAMIC_STEPS) return { ok: false, reason: `At most ${MAX_DYNAMIC_STEPS} steps are allowed.` };
  let totalCalls = 0, totalSec = 0;
  for (let i = 0; i < steps.length; i++) {
    const st = steps[i]!;
    if (!st.items.length) return { ok: false, reason: `Step ${i + 1} needs at least one device.` };
    if (!fin(st.duration) || st.duration < 0) return { ok: false, reason: `Step ${i + 1} duration must be 0 seconds or more.` };
    const lights = st.items.filter((it) => it.entity.startsWith("light.")).length;
    if (loop && lights > 0 && st.duration < MIN_LOOP_SEC_PER_LIGHT * lights) {
      return { ok: false, reason: `Step ${i + 1} is too fast for a loop: ${lights} light${lights === 1 ? "" : "s"} need at least ${MIN_LOOP_SEC_PER_LIGHT * lights} s (${MIN_LOOP_SEC_PER_LIGHT} s per light) to protect Zigbee.` };
    }
    totalCalls += customCalls({ id: `s${i}`, name: `s${i}`, items: st.items }).length;
    totalSec += st.duration;
  }
  if (loop && totalSec <= 0) return { ok: false, reason: "A looping scene needs a positive step duration." };
  const callsPerMin = totalSec > 0 ? Math.round((totalCalls / totalSec) * 600) / 10 : totalCalls;
  if (loop && callsPerMin > MAX_CALLS_PER_MIN) {
    return { ok: false, reason: `Too many calls per minute (${callsPerMin}/min; limit is ${MAX_CALLS_PER_MIN}/min) to avoid flooding Zigbee.` };
  }
  if (!loop && totalSec > 0 && totalCalls > MAX_CALLS_PER_MIN && callsPerMin > MAX_CALLS_PER_MIN) {
    return { ok: false, reason: `Too many calls per minute (${callsPerMin}/min; limit is ${MAX_CALLS_PER_MIN}/min) to avoid flooding Zigbee.` };
  }
  return { ok: true, callsPerMin, totalCalls };
}

/** S51: builds Home Assistant's `POST /api/config/script/config/<id>` payload for a dynamic scene. */
export function haDynamicScriptPayload(
  name: string,
  steps: readonly DynamicStepData[],
  loop: boolean,
  customCalls: (scene: RoomScene) => SceneCall[],
): { alias: string; mode: "restart"; sequence: Record<string, unknown>[] } {
  const body: Record<string, unknown>[] = [];
  for (let i = 0; i < steps.length; i++) {
    const st = steps[i]!;
    const tr = fin(st.transition) && st.transition >= 0 ? st.transition : undefined;
    const items = tr !== undefined ? st.items.map((it) => (it.entity.startsWith("light.") && it.transition === undefined ? { ...it, transition: tr } : it)) : st.items;
    for (const c of customCalls({ id: `s${i}`, name: `s${i}`, items })) {
      const { entity_id, ...rest } = c.data;
      body.push({ action: `${c.domain}.${c.service}`, target: { entity_id }, ...(Object.keys(rest).length ? { data: rest } : {}) });
    }
    if (fin(st.duration) && st.duration > 0) body.push({ delay: { seconds: st.duration } });
  }
  const sequence: Record<string, unknown>[] = loop
    ? [{ repeat: { while: [{ condition: "template", value_template: "{{ true }}" }], sequence: body } }]
    : body;
  return { alias: name.trim(), mode: "restart", sequence };
}

/** S51: saves a dynamic scene as a Home Assistant `script.fp_dyn_*` in the room's area. */
export async function saveHaDynamicScene(
  hass: SceneEditorHass,
  opts: { id?: string | null; name: string; areaId?: string; steps: readonly DynamicStepData[]; loop: boolean; customCalls: (s: RoomScene) => SceneCall[]; tries?: number; retryMs?: number },
): Promise<{ id: string; entityId: string | null }> {
  const name = opts.name.trim();
  if (!name) throw new Error("Give the scene a name.");
  const check = checkDynamicBudget(opts.steps, opts.loop, opts.customCalls);
  if (!check.ok) throw new Error(check.reason);
  if (hass.user?.is_admin === false) throw new Error("Only a Home Assistant administrator can save dynamic scenes.");
  if (!hass.callApi) throw new Error("Saving dynamic scenes requires a Home Assistant connection.");
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 20) || "scene";
  const id = opts.id || `fp_dyn_${slug}_${Math.random().toString(36).slice(2, 6)}`;
  const payload = haDynamicScriptPayload(name, opts.steps, opts.loop, opts.customCalls);
  try {
    await hass.callApi("POST", `config/script/config/${id}`, payload as unknown as Record<string, unknown>);
  } catch (err) {
    const status = (err as { status_code?: number; status?: number })?.status_code ?? (err as { status?: number })?.status;
    const msg = err instanceof Error ? err.message : String((err as { message?: unknown })?.message ?? err);
    if (status === 404 || status === 405 || status === 501 || /not found|scripts\.yaml|unsupported/i.test(msg)) {
      throw new Error("Home Assistant could not save to scripts.yaml. Add `script: !include scripts.yaml` to configuration.yaml and reload scripts.");
    }
    throw new Error(`Could not save dynamic scene: ${msg}`);
  }
  let entityId: string | null = null;
  if (hass.callWS) {
    let labelId: string | null = null;
    try {
      const labels = await hass.callWS<{ label_id: string; name: string }[]>({ type: "config/label_registry/list" });
      labelId = labels.find((l) => l.name === "floorplan-studio")?.label_id ?? null;
      if (!labelId) {
        const created = await hass.callWS<{ label_id: string }>({ type: "config/label_registry/create", name: "floorplan-studio" });
        labelId = created.label_id;
      }
    } catch { /* label optional */ }
    const tries = opts.tries ?? 8, ms = opts.retryMs ?? 300;
    for (let n = 0; n < tries; n++) {
      try {
        const all = await hass.callWS<{ entity_id: string; unique_id?: string; labels?: string[] }[]>({ type: "config/entity_registry/list" });
        const hit = all.find((e) => (e.unique_id === id || e.entity_id === `script.${id}`) && e.entity_id.startsWith("script."));
        if (hit) {
          entityId = hit.entity_id;
          const upd: Record<string, unknown> = { type: "config/entity_registry/update", entity_id: hit.entity_id };
          if (opts.areaId) upd.area_id = opts.areaId;
          if (labelId) upd.labels = [...new Set([...(hit.labels ?? []), labelId])];
          if (opts.areaId || labelId) await hass.callWS(upd as { type: string; [k: string]: unknown });
          break;
        }
      } catch { break; }
      if (n < tries - 1) await new Promise((r) => setTimeout(r, ms));
    }
  }
  return { id, entityId };
}

function rgbToHs(r: number, g: number, b: number): [number, number] {
  const rn = Math.max(0, Math.min(255, r)) / 255, gn = Math.max(0, Math.min(255, g)) / 255, bn = Math.max(0, Math.min(255, b)) / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn), d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === rn) h = 60 * (((gn - bn) / d) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / d + 2);
    else h = 60 * ((rn - gn) / d + 4);
    if (h < 0) h += 360;
  }
  return [Math.round(h), Math.round(max === 0 ? 0 : (d / max) * 100)];
}

/** S63: parses an HA `GET config/scene/config/<id>` response back into `{ name, items }` without throwing on bad data. */
export function parseHaSceneConfig(cfg: unknown): { name: string; items: SceneItem[] } {
  const c = cfg && typeof cfg === "object" ? (cfg as Record<string, unknown>) : {};
  const name = typeof c.name === "string" ? c.name : "";
  const ents = c.entities && typeof c.entities === "object" ? (c.entities as Record<string, unknown>) : {};
  const items: SceneItem[] = [];
  for (const [entity, raw] of Object.entries(ents)) {
    const domain = entity.split(".")[0] ?? "";
    if (!DOMAINS.has(domain)) continue;
    const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : (typeof raw === "string" ? { state: raw } : null);
    if (!obj) continue;
    const st = typeof obj.state === "string" ? obj.state : "on";
    const off = domain === "cover" ? (st === "closed" || st === "closing") : st === "off";
    const it: SceneItem = { entity, on: !off };
    if (domain === "light") {
      if (fin(obj.transition) && obj.transition >= 0 && obj.transition <= 300) it.transition = obj.transition;
      if (!off) {
        if (fin(obj.brightness)) it.brightness = Math.min(100, Math.max(1, Math.round((obj.brightness / 255) * 100)));
        if (Array.isArray(obj.hs_color) && fin(obj.hs_color[0]) && fin(obj.hs_color[1])) it.hs = [Math.round(obj.hs_color[0]), Math.round(obj.hs_color[1])];
        else if (Array.isArray(obj.rgb_color) && fin(obj.rgb_color[0]) && fin(obj.rgb_color[1]) && fin(obj.rgb_color[2])) it.hs = rgbToHs(obj.rgb_color[0], obj.rgb_color[1], obj.rgb_color[2]);
        else if (fin(obj.color_temp_kelvin)) it.kelvin = Math.round(obj.color_temp_kelvin);
        if (typeof obj.effect === "string" && obj.effect.trim()) it.effect = obj.effect.trim().slice(0, 80);
      }
    } else if (!off && domain === "fan") {
      if (fin(obj.percentage)) it.percentage = Math.min(100, Math.max(0, Math.round(obj.percentage)));
    } else if (!off && domain === "cover") {
      const pos = fin(obj.position) ? obj.position : fin(obj.current_position) ? obj.current_position : undefined;
      const tilt = fin(obj.tilt) ? obj.tilt : fin(obj.current_tilt_position) ? obj.current_tilt_position : undefined;
      if (pos !== undefined) it.position = Math.min(100, Math.max(0, Math.round(pos)));
      if (tilt !== undefined) it.tilt = Math.min(100, Math.max(0, Math.round(tilt)));
    } else if (!off && domain === "climate") {
      if (st && st !== "on") it.hvac = st;
      if (fin(obj.temperature)) it.temperature = obj.temperature;
      if (typeof obj.fan_mode === "string" && obj.fan_mode.trim()) it.fan_mode = obj.fan_mode.trim().slice(0, 80);
    } else if (!off && domain === "media_player") {
      if (fin(obj.volume_level)) it.volume = Math.min(100, Math.max(0, Math.round(obj.volume_level * 100)));
      if (typeof obj.source === "string" && obj.source.trim()) it.source = obj.source.trim().slice(0, 80);
    }
    items.push(it);
  }
  return { name, items };
}

/** S63: parses an HA `GET config/script/config/<id>` dynamic script back into `{ name, steps, loop }`. */
export function parseHaDynamicScript(cfg: unknown): { name: string; steps: DynamicStepData[]; loop: boolean } {
  const c = cfg && typeof cfg === "object" ? (cfg as Record<string, unknown>) : {};
  const name = typeof c.alias === "string" ? c.alias : typeof c.name === "string" ? c.name : "";
  let seq = Array.isArray(c.sequence) ? c.sequence : [];
  let loop = false;
  if (seq.length === 1 && seq[0] && typeof seq[0] === "object" && "repeat" in seq[0]) {
    const rep = (seq[0] as { repeat?: { sequence?: unknown } }).repeat;
    if (rep && Array.isArray(rep.sequence)) { loop = true; seq = rep.sequence; }
  }
  const steps: DynamicStepData[] = [];
  let cur = new Map<string, SceneItem>();
  let curTrans: number | undefined;
  const flush = (duration: number) => {
    if (!cur.size && duration <= 0) return;
    steps.push({ items: [...cur.values()], duration, ...(curTrans !== undefined ? { transition: curTrans } : {}) });
    cur = new Map(); curTrans = undefined;
  };
  for (const act of seq) {
    if (!act || typeof act !== "object") continue;
    const a = act as Record<string, unknown>;
    if ("delay" in a) {
      const d = a.delay;
      const sec = fin(d) ? d : (d && typeof d === "object" && fin((d as Record<string, unknown>).seconds) ? ((d as Record<string, unknown>).seconds as number) : 0);
      flush(Math.max(0, sec));
      continue;
    }
    const call = typeof a.action === "string" ? a.action : typeof a.service === "string" ? a.service : "";
    const [domain, service] = call.split(".");
    if (!domain || !service || !DOMAINS.has(domain)) continue;
    const data = a.data && typeof a.data === "object" ? (a.data as Record<string, unknown>) : {};
    const tgt = a.target && typeof a.target === "object" ? (a.target as Record<string, unknown>) : {};
    const rawEnt = tgt.entity_id ?? data.entity_id;
    const ents = Array.isArray(rawEnt) ? rawEnt.filter((x): x is string => typeof x === "string") : (typeof rawEnt === "string" ? [rawEnt] : []);
    if (fin(data.transition) && curTrans === undefined) curTrans = Math.max(0, Math.min(300, data.transition));
    for (const entity of ents) {
      const prev = cur.get(entity) ?? { entity, on: true };
      const off = service === "turn_off" || service === "close_cover";
      prev.on = !off;
      if (domain === "light") {
        if (fin(data.transition)) prev.transition = data.transition;
        if (!off) {
          if (fin(data.brightness_pct)) prev.brightness = Math.min(100, Math.max(1, Math.round(data.brightness_pct)));
          else if (fin(data.brightness)) prev.brightness = Math.min(100, Math.max(1, Math.round((data.brightness / 255) * 100)));
          if (Array.isArray(data.hs_color) && fin(data.hs_color[0]) && fin(data.hs_color[1])) prev.hs = [Math.round(data.hs_color[0]), Math.round(data.hs_color[1])];
          else if (Array.isArray(data.rgb_color) && fin(data.rgb_color[0]) && fin(data.rgb_color[1]) && fin(data.rgb_color[2])) prev.hs = rgbToHs(data.rgb_color[0], data.rgb_color[1], data.rgb_color[2]);
          else if (fin(data.color_temp_kelvin)) prev.kelvin = Math.round(data.color_temp_kelvin);
          if (typeof data.effect === "string" && data.effect.trim()) prev.effect = data.effect.trim().slice(0, 80);
        }
      } else if (!off && domain === "fan" && fin(data.percentage)) prev.percentage = Math.min(100, Math.max(0, Math.round(data.percentage)));
      else if (!off && domain === "cover") {
        if (fin(data.position)) prev.position = Math.min(100, Math.max(0, Math.round(data.position)));
        if (fin(data.tilt_position)) prev.tilt = Math.min(100, Math.max(0, Math.round(data.tilt_position)));
      } else if (!off && domain === "climate") {
        if (typeof data.hvac_mode === "string" && data.hvac_mode) prev.hvac = data.hvac_mode;
        if (fin(data.temperature)) prev.temperature = data.temperature;
        if (typeof data.fan_mode === "string" && data.fan_mode) prev.fan_mode = data.fan_mode;
      } else if (!off && domain === "media_player") {
        if (fin(data.volume_level)) prev.volume = Math.min(100, Math.max(0, Math.round(data.volume_level * 100)));
        if (typeof data.source === "string" && data.source) prev.source = data.source;
      }
      cur.set(entity, prev);
    }
  }
  if (cur.size) flush(0);
  if (!steps.length) steps.push({ items: [], duration: 10 });
  return { name, steps, loop };
}

/** S63: lists enabled HA scenes, Hue scenes (`platform === "hue"`), and `script.fp_dyn_*` dynamic scripts in `areaId`. */
export async function listRoomHaScenes(hass: SceneEditorHass, areaId: string): Promise<RoomHaSceneItem[]> {
  if (!areaId || !hass.callWS) return [];
  try {
    const all = await hass.callWS<{ entity_id: string; area_id?: string | null; platform?: string; unique_id?: string; name?: string | null; original_name?: string | null; disabled_by?: string | null }[]>({
      type: "config/entity_registry/list",
    });
    if (!Array.isArray(all)) return [];
    const out: RoomHaSceneItem[] = [];
    for (const e of all) {
      if (!e || e.disabled_by || e.area_id !== areaId || typeof e.entity_id !== "string") continue;
      const stName = hass.states?.[e.entity_id]?.attributes?.friendly_name;
      const name = (typeof e.name === "string" && e.name) || (typeof e.original_name === "string" && e.original_name) || (typeof stName === "string" && stName) || e.entity_id;
      if (e.entity_id.startsWith("scene.")) {
        const isHue = e.platform === "hue";
        out.push({ entityId: e.entity_id, configId: e.unique_id || e.entity_id.slice(6), name, kind: isHue ? "hue" : "scene", platform: e.platform });
      } else if (e.entity_id.startsWith("script.fp_dyn_")) {
        out.push({ entityId: e.entity_id, configId: e.unique_id || e.entity_id.slice(7), name, kind: "dynamic", platform: e.platform });
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** S63: loads an existing HA YAML scene (`GET config/scene/config/<id>`). */
export async function loadHaScene(hass: SceneEditorHass, configId: string): Promise<{ name: string; items: SceneItem[] }> {
  if (!hass.callApi) throw new Error("Loading scenes requires a Home Assistant connection.");
  const cfg = await hass.callApi("GET", `config/scene/config/${configId}`);
  return parseHaSceneConfig(cfg);
}

/** S63: loads an existing HA dynamic script (`GET config/script/config/<id>`). */
export async function loadHaDynamicScene(hass: SceneEditorHass, configId: string): Promise<{ name: string; steps: DynamicStepData[]; loop: boolean }> {
  if (!hass.callApi) throw new Error("Loading dynamic scenes requires a Home Assistant connection.");
  const cfg = await hass.callApi("GET", `config/script/config/${configId}`);
  return parseHaDynamicScript(cfg);
}

/** S63: disconnects (disables) a Hue scene entity in HA's entity registry without touching the Hue bridge. */
export async function disableHaEntity(hass: SceneEditorHass, entityId: string): Promise<void> {
  if (hass.user?.is_admin === false) throw new Error("Only a Home Assistant administrator can disable entities.");
  if (!hass.callWS) throw new Error("Disabling entities requires a Home Assistant connection.");
  await hass.callWS({ type: "config/entity_registry/update", entity_id: entityId, disabled_by: "user" });
}

/** S63: activates a Hue scene, waits briefly for lights to report live states, and captures the room into `Map<string, SceneItem>`. */
export async function migrateHueScene(
  hass: SceneEditorHass,
  hueEntityId: string,
  targets: readonly SceneTarget[],
  settleMs = 900,
): Promise<Map<string, SceneItem>> {
  if (!hass.callService) throw new Error("Migrating a Hue scene requires a Home Assistant connection.");
  await hass.callService("scene", "turn_on", { entity_id: hueEntityId });
  if (settleMs > 0) await new Promise((r) => setTimeout(r, settleMs));
  return captureRoomItems(targets, hass.states ?? {});
}

/** Card-side action handlers bundled inside the lazy scene chunk so the main card pays zero orchestration bytes. */
export function makeCardSceneHandlers(
  tools: SceneEditorTools,
  draft: SceneEditorDraft,
  hass: SceneEditorHass | undefined,
  room: { area?: string; scenes?: RoomScene[] },
  targets: readonly SceneTarget[],
  refresh: () => void,
  close: () => void,
) {
  const sendAll = async (items: readonly SceneItem[]): Promise<string[]> => {
    const failed: string[] = [];
    if (!hass?.callService) return failed;
    for (const c of tools.customCalls({ id: "try", name: "try", items: [...items] })) {
      try { await hass.callService(c.domain, c.service, c.data); } catch { const e = String(c.data.entity_id); if (!failed.includes(e)) failed.push(e); }
    }
    return failed;
  };
  return {
    capture() {
      const got = captureRoomItems(targets, hass?.states ?? {});
      if (!got.size) { draft.note = "No live device states available to capture."; refresh(); return; }
      draft.items = got;
      draft.note = `Captured ${got.size} device${got.size === 1 ? "" : "s"} from the room.`;
      refresh();
    },
    async tryRun() {
      const items = [...draft.items.values()];
      if (!items.length) { draft.trying = "Pick at least one device to try."; refresh(); return; }
      draft.busy = true; draft.trying = "Sending…"; refresh();
      const live = captureRoomItems(targets.filter((t) => items.some((it) => it.entity === t.entity)), hass?.states ?? {});
      for (const it of items) {
        if (draft.origin.some((b) => b.entity === it.entity)) continue;
        const old = live.get(it.entity);
        if (old) draft.origin.push(old);
      }
      draft.backup = [...draft.origin];
      const failed = await sendAll(items);
      draft.busy = false;
      draft.trying = failed.length ? `Home Assistant refused ${failed.join(", ")}.` : "Sent. Restore puts the devices back.";
      refresh();
    },
    async tryRestore() {
      if (!draft.backup.length) return;
      draft.busy = true; refresh();
      const failed = await sendAll(draft.backup);
      draft.backup = []; draft.busy = false;
      draft.trying = failed.length ? `Could not put back ${failed.join(", ")}.` : "Put back.";
      refresh();
    },
    async save() {
      draft.error = ""; draft.busy = true; refresh();
      try {
        if (draft.mode === "dynamic") {
          const steps = (draft.steps ?? [{ items: draft.items, duration: 10 }]).map((s) => ({ items: [...s.items.values()], duration: s.duration, transition: s.transition }));
          await saveHaDynamicScene(hass ?? {}, { id: draft.haSceneId, name: draft.name, areaId: room.area, steps, loop: draft.loop === true, customCalls: tools.customCalls });
        } else {
          await saveHaScene(hass ?? {}, { id: draft.haSceneId, name: draft.name, areaId: room.area, items: [...draft.items.values()] });
          if (draft.replaceHueEntity && draft.disableHueOnSave) {
            try { await disableHaEntity(hass ?? {}, draft.replaceHueEntity); }
            catch (err) {
              draft.busy = false;
              draft.replaceHueEntity = null;
              draft.error = `Saved new HA scene, but could not disable Hue scene: ${err instanceof Error ? err.message : String(err)}`;
              refresh();
              return;
            }
          }
        }
        draft.backup = []; draft.origin = []; draft.busy = false;
        close();
      } catch (err) {
        draft.busy = false;
        draft.error = err instanceof Error ? err.message : String(err);
        refresh();
      }
    },
    async loadExisting(item: RoomHaSceneItem) {
      if (draft.busy) return;
      draft.busy = true; draft.error = ""; draft.note = `Loading ${item.name}…`; refresh();
      try {
        if (item.kind === "dynamic") {
          const loaded = await loadHaDynamicScene(hass ?? {}, item.configId);
          draft.mode = "dynamic";
          draft.haSceneId = item.configId;
          draft.name = loaded.name || item.name;
          draft.loop = loaded.loop;
          draft.steps = loaded.steps.map((s) => ({ items: new Map(s.items.map((it) => [it.entity, it])), duration: s.duration, transition: s.transition }));
          draft.activeStep = 0;
          draft.items = draft.steps[0]!.items;
        } else {
          const loaded = await loadHaScene(hass ?? {}, item.configId);
          draft.mode = "static";
          draft.haSceneId = item.configId;
          draft.name = loaded.name || item.name;
          draft.items = new Map(loaded.items.map((it) => [it.entity, it]));
        }
        draft.replaceHueEntity = null;
        draft.selected = [...draft.items.keys()][0] ?? null;
        draft.note = `Loaded "${draft.name}" for editing.`;
      } catch (err) {
        draft.error = `Could not load "${item.name}": ${err instanceof Error ? err.message : String(err)}`;
        draft.note = "";
      }
      draft.busy = false;
      refresh();
    },
    async migrateHue(item: RoomHaSceneItem) {
      if (draft.busy) return;
      draft.busy = true; draft.error = ""; draft.note = `Activating Hue scene "${item.name}" and capturing lights…`; refresh();
      try {
        const captured = await migrateHueScene(hass ?? {}, item.entityId, targets);
        draft.mode = "static";
        draft.haSceneId = null;
        draft.name = item.name;
        draft.items = captured;
        draft.selected = [...captured.keys()][0] ?? null;
        draft.replaceHueEntity = item.entityId;
        draft.disableHueOnSave = true;
        draft.note = captured.size
          ? `Captured ${captured.size} device${captured.size === 1 ? "" : "s"} from Hue "${item.name}". Review and Save to replace.`
          : `Activated Hue "${item.name}". Tap "Capture the room now" once lights settle, then Save.`;
      } catch (err) {
        draft.error = err instanceof Error ? err.message : String(err);
        draft.note = "";
      }
      draft.busy = false;
      refresh();
    },
    async migrateLegacy() {
      const legacy = room.scenes ?? [];
      if (!legacy.length || draft.migrating) return;
      draft.migrating = true; draft.error = ""; refresh();
      let moved = 0;
      try {
        for (const sc of legacy) {
          await saveHaScene(hass ?? {}, { name: sc.name, areaId: room.area, items: sc.items });
          moved++;
        }
        draft.note = `Created ${moved} Home Assistant scene${moved === 1 ? "" : "s"} in this room's area.`;
      } catch (err) {
        draft.error = err instanceof Error ? err.message : String(err);
      }
      draft.migrating = false;
      refresh();
    },
    restoreOnClose() {
      if (draft.backup.length) void sendAll(draft.backup);
    },
  };
}

export interface CardSceneHost {
  _sceneEd: SceneEditorDraft | null;
  _hass?: SceneEditorHass;
  _layout?: { colors?: Layout["colors"]; wallColors?: Layout["wallColors"] } | null;
  _floor(): Floor | null;
  _theme(): Theme;
  _haDark(): boolean;
  requestUpdate(): void;
}

/** Opens a fresh scene draft on `c` inside the lazy chunk. */
export function openCardScene(c: CardSceneHost, i: number): void {
  const r = c._floor()?.rooms[i];
  if (!r) return;
  const d = createSceneDraft(r.id, i, null, "", []);
  c._sceneEd = d;
  if (r.area && c._hass?.callWS) {
    d.haLoaded = true;
    void listRoomHaScenes(c._hass, r.area).then((list) => {
      if (c._sceneEd === d) { d.haList = list; c.requestUpdate(); }
    });
  }
  c.requestUpdate();
}

/** Renders the card's WYSIWYG scene editor overlay inside the lazy chunk so the main card pays only the loader bytes. */
export function renderCardScene(tools: SceneEditorTools, c: CardSceneHost): unknown {
  const d = c._sceneEd, f = d ? c._floor() : null, r = f?.rooms[d?.roomIndex ?? -1];
  if (!d || !f || !r) return tools.nothing;
  const targets = sceneTargets(f, d.roomIndex);
  const close = (keep = false) => {
    const cur = c._sceneEd;
    if (!cur) return;
    c._sceneEd = null;
    if (!keep && cur.backup.length) h.restoreOnClose();
    c.requestUpdate();
  };
  const h = makeCardSceneHandlers(tools, d, c._hass, r, targets, () => c.requestUpdate(), () => close(true));
  const hass = c._hass;
  return sceneEditorView(tools, {
    host: "card",
    floor: f,
    roomIndex: d.roomIndex,
    roomName: r.name || r.id,
    roomArea: r.area,
    draft: d,
    targets,
    liveStates: (hass?.states as StateOverlay | undefined) ?? {},
    theme: c._theme(),
    dark: c._haDark(),
    colors: c._layout?.colors,
    wallColors: c._layout?.wallColors,
    canWriteHa: Boolean(hass?.callApi && hass?.user?.is_admin === true),
    canSaveLocal: false,
    canTry: Boolean(hass?.callService),
    legacyScenes: r.scenes ?? [],
    refresh: () => c.requestUpdate(),
    close: () => close(false),
    save: () => void h.save(),
    tryRun: () => void h.tryRun(),
    tryRestore: () => void h.tryRestore(),
    capture: () => h.capture(),
    migrateLegacy: () => void h.migrateLegacy(),
    loadExisting: (item) => void h.loadExisting(item),
    migrateHue: (item) => void h.migrateHue(item),
  });
}

export const SCENE_EDITOR_CSS = `
.fp-se-ov{position:absolute;inset:10px;margin:auto;width:min(760px,calc(100% - 20px));max-height:calc(100% - 20px);z-index:6;display:flex;flex-direction:column;background:color-mix(in srgb,var(--fp-room) 96%,transparent);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:1px solid var(--fp-idle);border-radius:12px;color:var(--fp-ink);font:12px/1.35 var(--fp-font,system-ui,sans-serif);box-shadow:0 10px 28px rgba(0,0,0,.4);overflow:hidden}
.fp-se-hd{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;border-bottom:1px solid var(--fp-idle);font-weight:600}
.fp-se-bd{padding:10px 12px;overflow:auto;display:flex;flex-direction:column;gap:8px}
.fp-se-top{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.fp-se-top input[type=text]{flex:1;min-width:140px;padding:4px 8px;border:1px solid var(--fp-idle);border-radius:6px;background:var(--fp-bg);color:var(--fp-ink);font:inherit}
.fp-se-grid{display:grid;grid-template-columns:minmax(220px,1fr) minmax(240px,1.2fr);gap:10px;align-items:start}
@media (max-width:620px){.fp-se-grid{grid-template-columns:1fr}}
.fp-se-map{position:relative;border:1px solid var(--fp-idle);border-radius:8px;background:var(--fp-bg);overflow:hidden;aspect-ratio:4/3}
.fp-se-map svg{width:100%;height:100%;display:block;cursor:pointer}
.fp-se-map svg g[data-x],.fp-se-map svg line[data-d]{cursor:pointer}
.fp-se-map-cap{position:absolute;left:6px;bottom:4px;font-size:10px;opacity:.75;pointer-events:none;background:color-mix(in srgb,var(--fp-bg) 80%,transparent);padding:1px 5px;border-radius:4px}
.fp-se-rows{display:flex;flex-direction:column;gap:5px;max-height:240px;overflow:auto}
.sd-row{display:flex;flex-wrap:wrap;align-items:center;gap:5px;padding:4px 6px;border:1px solid color-mix(in srgb,var(--fp-idle) 55%,transparent);border-radius:6px;background:var(--fp-bg)}
.sd-row.sd-sel{border-color:var(--fp-primary);box-shadow:0 0 0 1px var(--fp-primary)}
.sd-row input[type=number]{width:66px;padding:2px 5px;border:1px solid var(--fp-idle);border-radius:4px;background:var(--fp-room);color:var(--fp-ink);font:inherit}
.sd-row input[type=text]{width:92px;padding:2px 5px;border:1px solid var(--fp-idle);border-radius:4px;background:var(--fp-room);color:var(--fp-ink);font:inherit}
.sd-row select{padding:2px 4px;border:1px solid var(--fp-idle);border-radius:4px;background:var(--fp-room);color:var(--fp-ink);font:inherit}
.sd-dev{display:inline-flex;align-items:center;gap:5px;cursor:pointer;font-weight:500}
.sd-palette{display:flex;flex-wrap:wrap;align-items:center;gap:5px;padding:5px 8px;border:1px solid color-mix(in srgb,var(--fp-idle) 55%,transparent);border-radius:6px;background:var(--fp-bg)}
.sd-try,.sd-actions,.fp-se-mig{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.fp-se-mig{padding:6px 8px;border:1px dashed var(--fp-primary);border-radius:6px;background:color-mix(in srgb,var(--fp-primary) 10%,transparent)}
.fp-se-btn{padding:4px 10px;border:1px solid var(--fp-idle);border-radius:6px;background:var(--fp-bg);color:var(--fp-ink);cursor:pointer;font:inherit}
.fp-se-btn.primary{background:var(--fp-primary);color:var(--fp-on-dark,#fff);border-color:var(--fp-primary);font-weight:600}
.fp-se-btn:disabled{opacity:.45;cursor:not-allowed}
.fp-se-err{color:var(--fp-danger,#e05252);margin:0;font-weight:500}
.fp-se-ro{font-size:11px;opacity:.8;margin:0}
.fp-se-modes,.fp-se-steps,.fp-se-effs{display:flex;flex-wrap:wrap;align-items:center;gap:5px}
.fp-se-dyn{display:flex;flex-direction:column;gap:6px;padding:6px 8px;border:1px solid color-mix(in srgb,var(--fp-idle) 55%,transparent);border-radius:6px;background:var(--fp-bg)}
.fp-se-dyn input[type=number]{width:62px;padding:2px 5px;border:1px solid var(--fp-idle);border-radius:4px;background:var(--fp-room);color:var(--fp-ink);font:inherit}
.fp-se-chip{padding:2px 8px;border:1px solid var(--fp-idle);border-radius:12px;background:var(--fp-room);color:var(--fp-ink);cursor:pointer;font-size:11px}
.fp-se-chip.on{border-color:var(--fp-primary);background:var(--fp-primary);color:var(--fp-on-dark,#fff)}
.fp-se-bud{font-size:11px;opacity:.85}
`;

export function sceneEditorView(tools: SceneEditorTools, m: SceneEditorModel): unknown {
  const { html, nothing, renderFloor } = tools;
  const lv = tools.live ?? (<T>(v: T) => v);
  const { draft } = m;
  const ro = !m.canWriteHa && !m.canSaveLocal;
  const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); m.close(); } };
  const known = new Set(m.targets.map((t) => t.entity));
  const rows: SceneTarget[] = [
    ...m.targets,
    ...[...draft.items.keys()].filter((e) => !known.has(e)).map((e) => ({ entity: e, name: e, domain: e.split(".")[0] ?? "" })),
  ];
  const setItem = (entity: string, fn: (it: SceneItem) => void) => {
    const it = draft.items.get(entity);
    if (it) { fn(it); m.refresh(); }
  };

  const crop = roomCropBox(m.floor, m.roomIndex);
  const previewState = scenePreviewStates(draft.items.values(), m.liveStates);
  const selTarget = rows.find((r) => r.entity === draft.selected);
  const svgBody = renderFloor(m.floor, {
    scale: Math.max(0.25, 280 / Math.max(1, crop.w)),
    state: previewState,
    roomGlow: true,
    labels: true,
    showNames: true,
    selectedRoom: m.roomIndex,
    selection: selTarget?.devIndex !== undefined ? { t: "dev", i: selTarget.devIndex } : null,
    theme: m.theme,
    dark: m.dark,
    colors: m.colors,
    wallColors: m.wallColors,
  });

  const onMapClick = (ev: MouseEvent) => {
    const path = ev.composedPath() as Element[];
    for (const el of path) {
      if (!(el instanceof Element)) continue;
      const dx = el.getAttribute?.("data-x");
      if (dx !== null) {
        const idx = Number(dx);
        const hit = rows.find((r) => r.devIndex === idx);
        if (hit) {
          draft.selected = hit.entity;
          if (!ro && !draft.items.has(hit.entity)) draft.items.set(hit.entity, { entity: hit.entity, on: true });
          m.refresh();
        }
        return;
      }
      const dd = el.getAttribute?.("data-d");
      if (dd !== null) {
        const idx = Number(dd);
        const hit = rows.find((r) => r.doorIndex === idx);
        if (hit) {
          draft.selected = hit.entity;
          if (!ro && !draft.items.has(hit.entity)) draft.items.set(hit.entity, { entity: hit.entity, on: true });
          m.refresh();
        }
        return;
      }
    }
  };

  const field = (it: SceneItem, f: string, j: number) => {
    const rec = it as unknown as Record<string, unknown>;
    if (f === "hs") {
      const hs = it.hs;
      return html`<input type="color" id=${`sd-col-${j}`} aria-label="colour" ?disabled=${ro} .value=${lv(hs ? hsToHex(hs[0], hs[1]) : "#ffffff")} @input=${(e: Event) => {
        const v = hexToHs((e.target as HTMLInputElement).value);
        if (v) setItem(it.entity, (x) => { x.hs = v; delete x.kelvin; });
      }}>`;
    }
    if (NUMERIC.has(f)) {
      const cur = rec[f];
      const rng = RANGE[f];
      return html`<input type="number" id=${`sd-${f}-${j}`} min=${rng ? String(rng[0]) : ""} max=${rng ? String(rng[1]) : ""} step=${STEP[f] ?? "1"} placeholder=${LABEL[f]} aria-label=${LABEL[f]} ?disabled=${ro} .value=${lv(typeof cur === "number" ? String(cur) : "")} @change=${(e: Event) => {
        const raw = (e.target as HTMLInputElement).value.trim(), n = Number(raw);
        setItem(it.entity, (x) => {
          const r = x as unknown as Record<string, unknown>;
          if (raw === "" || !Number.isFinite(n)) delete r[f];
          else { r[f] = n; if (f === "kelvin") delete x.hs; }
        });
      }}>`;
    }
    return html`<input type="text" id=${`sd-${f}-${j}`} placeholder=${LABEL[f]} aria-label=${LABEL[f]} ?disabled=${ro} .value=${lv(typeof rec[f] === "string" ? (rec[f] as string) : "")} @change=${(e: Event) => {
      const v = (e.target as HTMLInputElement).value;
      setItem(it.entity, (x) => { const r = x as unknown as Record<string, unknown>; if (v.trim()) r[f] = v; else delete r[f]; });
    }}>`;
  };

  const row = (t: SceneTarget, j: number) => {
    const it = draft.items.get(t.entity);
    const fields = FIELDS[t.domain] ?? [];
    return html`<div class=${`sd-row${draft.selected === t.entity ? " sd-sel" : ""}`} data-sdev=${t.entity} @click=${(e: MouseEvent) => { if ((e.target as Element)?.closest("input,select,button,label")) return; if (draft.selected !== t.entity) { draft.selected = t.entity; m.refresh(); } }}>
      <label class="sd-dev"><input type="checkbox" id=${`sd-inc-${j}`} ?disabled=${ro} .checked=${lv(!!it)} @change=${(e: Event) => {
        if ((e.target as HTMLInputElement).checked) draft.items.set(t.entity, { entity: t.entity, on: true });
        else draft.items.delete(t.entity);
        draft.selected = t.entity;
        m.refresh();
      }}><span class="prow-name" title=${t.entity}>${t.name}</span></label>
      ${it ? html`<select id=${`sd-on-${j}`} aria-label=${`${t.name} state`} ?disabled=${ro} .value=${lv(it.on ? "on" : "off")} @change=${(e: Event) => setItem(t.entity, (x) => { x.on = (e.target as HTMLSelectElement).value === "on"; })}><option value="on">On</option><option value="off">Off</option></select>
        ${it.on ? fields.map((f) => field(it, f, j)) : (t.domain === "light" ? field(it, "transition", j) : nothing)}` : nothing}
    </div>`;
  };

  const applyPalette = () => {
    const lights = rows.filter((t) => t.domain === "light" && draft.items.get(t.entity)?.on);
    const cols = spreadColours(draft.palette, lights.length);
    if (!cols.length) { draft.note = "Tick at least one light that is on."; m.refresh(); return; }
    lights.forEach((t, j) => { const it = draft.items.get(t.entity)!; it.hs = cols[j]; delete it.kelvin; });
    draft.note = `Gave ${lights.length} light${lights.length === 1 ? "" : "s"} a colour from the palette.`;
    m.refresh();
  };

  const fromPicture = async (e: Event) => {
    const input = e.target as HTMLInputElement, file = input.files?.[0];
    input.value = "";
    if (!file || !tools.readImageColours) return;
    try {
      const cols = await tools.readImageColours(file, MAX_PALETTE);
      draft.palette.splice(0, draft.palette.length, ...cols);
      draft.note = `Took ${cols.length} colour${cols.length === 1 ? "" : "s"} from ${file.name}. Press Apply to lights.`;
    } catch (err) { draft.note = err instanceof Error ? err.message : "That picture could not be read."; }
    m.refresh();
  };

  const pal = draft.palette;
  const paletteEl = html`<div class="sd-palette" id="scenePalette"><span>palette</span>
    ${pal.map((c, k) => html`<input type="color" id=${`sp-col-${k}`} aria-label=${`palette colour ${k + 1}`} ?disabled=${ro} .value=${lv(c)} @input=${(e: Event) => { const v = (e.target as HTMLInputElement).value; if (hexToHs(v)) pal[k] = v; }}>
      ${pal.length > 2 && !ro ? html`<button type="button" class="btn fp-se-btn keep" id=${`sp-rm-${k}`} aria-label=${`Remove palette colour ${k + 1}`} @click=${() => { pal.splice(k, 1); m.refresh(); }}>&times;</button>` : nothing}`)}
    ${pal.length < MAX_PALETTE && !ro ? html`<button type="button" class="btn fp-se-btn keep" id="sp-add" @click=${() => { pal.push("#ffffff"); m.refresh(); }}>+</button>` : nothing}
    ${tools.readImageColours && !ro ? html`<label class="btn fp-se-btn keep" for="sp-image">Colours from a picture</label><input type="file" id="sp-image" accept="image/*" hidden @change=${fromPicture}>` : nothing}
    ${!ro ? html`<button type="button" class="btn fp-se-btn keep" id="sp-apply" @click=${applyPalette}>Apply to lights</button>` : nothing}
    ${draft.note ? html`<span id="paletteNote" role="status">${draft.note}</span>` : nothing}
  </div>`;

  const isDyn = draft.mode === "dynamic";
  const ensureSteps = (): DynamicStep[] => {
    if (!draft.steps || !draft.steps.length) draft.steps = [{ items: draft.items, duration: 10, transition: 2 }];
    const idx = Math.max(0, Math.min(draft.steps.length - 1, draft.activeStep ?? 0));
    draft.activeStep = idx;
    draft.steps[idx]!.items = draft.items;
    return draft.steps;
  };
  const selectStep = (idx: number) => {
    const steps = ensureSteps();
    const clamped = Math.max(0, Math.min(steps.length - 1, idx));
    draft.activeStep = clamped;
    draft.items = steps[clamped]!.items;
    m.refresh();
  };
  const setMode = (mode: "static" | "dynamic") => {
    if ((draft.mode ?? "static") === mode) return;
    draft.mode = mode;
    if (mode === "dynamic") ensureSteps();
    draft.error = "";
    m.refresh();
  };
  const effects = isDyn ? lightEffectsFor(rows, m.liveStates) : [];
  const dynSteps = isDyn ? ensureSteps() : [];
  const curStep = isDyn ? dynSteps[draft.activeStep ?? 0]! : null;
  const dynBudget = isDyn
    ? checkDynamicBudget(dynSteps.map((s) => ({ items: [...s.items.values()], duration: s.duration, transition: s.transition })), draft.loop === true, tools.customCalls)
    : null;
  const applyNativeEffect = (eff: string, entities: string[]) => {
    for (const ent of entities) {
      const prev = draft.items.get(ent);
      draft.items.set(ent, { ...(prev ?? { entity: ent, on: true }), entity: ent, on: true, effect: eff });
    }
    draft.note = `Applied native "${eff}" effect to ${entities.length} light${entities.length === 1 ? "" : "s"} (no Zigbee loop traffic).`;
    m.refresh();
  };

  const saveLabel = isDyn ? "Save dynamic script" : m.canWriteHa ? "Save to Home Assistant" : "Save";
  const panelStyle = m.host === "studio" && m.pos ? `left:${m.pos.x}px;top:${m.pos.y}px` : "";
  const panelClass = m.host === "studio" ? "fpanel scene-panel" : "fp-se-ov";
  const headClass = m.host === "studio" ? "fpanel-head" : "fp-se-hd";

  return html`<style>${SCENE_EDITOR_CSS}</style>
  <div class=${panelClass} id="scenePanel" role="dialog" aria-label="Scene editor" data-pop style=${panelStyle} @keydown=${esc}>
    <div class=${headClass} @pointerdown=${m.head?.down} @pointermove=${m.head?.move} @pointerup=${m.head?.up} @pointercancel=${m.head?.up}>
      <span>${draft.id || draft.haSceneId ? "Edit scene" : "New scene"} in ${m.roomName}</span>
      <button type="button" class="btn fp-se-btn keep" id="sceneClose" aria-label="Close" @click=${() => m.close()}>&times;</button>
    </div>
    <div class="fp-se-bd">
      <div class="fp-se-top">
        <label for="sceneName">name</label>
        <input id="sceneName" type="text" maxlength="60" ?disabled=${ro} .value=${lv(draft.name)} @input=${(e: Event) => { draft.name = (e.target as HTMLInputElement).value; }}>
        ${!ro ? html`<button type="button" class="btn fp-se-btn keep" id="sceneCapture" @click=${() => m.capture()}>Capture the room now</button>` : nothing}
      </div>
      ${m.canWriteHa || m.host === "card" ? html`<div class="fp-se-modes">
        <button type="button" class=${`fp-se-chip${!isDyn ? " on" : ""}`} id="sceneModeStatic" @click=${() => setMode("static")}>Static (scene)</button>
        <button type="button" class=${`fp-se-chip${isDyn ? " on" : ""}`} id="sceneModeDynamic" @click=${() => setMode("dynamic")}>Dynamic (steps / script)</button>
      </div>` : nothing}
      ${isDyn && curStep ? html`<div class="fp-se-dyn" id="sceneDynamic">
        ${effects.length ? html`<div class="fp-se-effs" id="sceneEffects">
          <span>Native effects (no Zigbee traffic):</span>
          ${effects.map((ef) => html`<button type="button" class="fp-se-chip" ?disabled=${ro} @click=${() => applyNativeEffect(ef.effect, ef.entities)}>${ef.effect}</button>`)}
        </div>` : nothing}
        <div class="fp-se-steps" id="sceneSteps">
          ${dynSteps.map((_, k) => html`<button type="button" class=${`fp-se-chip${k === (draft.activeStep ?? 0) ? " on" : ""}`} id=${`sdStep-${k}`} @click=${() => selectStep(k)}>Step ${k + 1}</button>`)}
          ${!ro && dynSteps.length < MAX_DYNAMIC_STEPS ? html`<button type="button" class="btn fp-se-btn keep" id="sdStepAdd" @click=${() => { const steps = ensureSteps(); steps.push({ items: new Map(), duration: 10, transition: 2 }); selectStep(steps.length - 1); }}>+ Step</button>` : nothing}
          ${!ro && dynSteps.length > 1 ? html`<button type="button" class="btn fp-se-btn keep" id="sdStepRm" @click=${() => { const steps = ensureSteps(); steps.splice(draft.activeStep ?? 0, 1); selectStep(Math.max(0, (draft.activeStep ?? 0) - 1)); }}>Remove step</button>` : nothing}
        </div>
        <div class="fp-se-steps">
          <label for="sdStepDur">Duration (s)</label>
          <input id="sdStepDur" type="number" min="0" max="3600" step="1" ?disabled=${ro} .value=${lv(String(curStep.duration))} @change=${(e: Event) => { const n = Number((e.target as HTMLInputElement).value); if (Number.isFinite(n) && n >= 0) { curStep.duration = n; m.refresh(); } }}>
          <label for="sdStepTrans">Transition (s)</label>
          <input id="sdStepTrans" type="number" min="0" max="300" step="0.5" ?disabled=${ro} .value=${lv(curStep.transition !== undefined ? String(curStep.transition) : "")} @change=${(e: Event) => { const raw = (e.target as HTMLInputElement).value.trim(), n = Number(raw); curStep.transition = raw === "" || !Number.isFinite(n) ? undefined : Math.max(0, Math.min(300, n)); m.refresh(); }}>
          <label><input id="sdLoop" type="checkbox" ?disabled=${ro} .checked=${lv(draft.loop === true)} @change=${(e: Event) => { draft.loop = (e.target as HTMLInputElement).checked; m.refresh(); }}> Loop</label>
        </div>
        ${dynBudget ? html`<div class=${dynBudget.ok ? "fp-se-bud" : "fp-se-err"} id="sdBudget">${dynBudget.ok ? `Zigbee budget OK · ${dynBudget.callsPerMin} calls/min (${dynBudget.totalCalls} calls)` : dynBudget.reason}</div>` : nothing}
      </div>` : nothing}
      ${ro ? html`<p class="fp-se-ro" id="sceneReadOnly">Read-only (admin required to save Home Assistant scenes). You can still preview and Try it.</p>` : nothing}
      ${m.legacyScenes.length && m.canWriteHa && m.migrateLegacy ? html`<div class="fp-se-mig" id="sceneMigrateBar">
        <span>${m.legacyScenes.length} legacy custom scene${m.legacyScenes.length === 1 ? "" : "s"} on this room.</span>
        <button type="button" class="btn fp-se-btn keep" id="sceneMigrate" ?disabled=${draft.migrating} @click=${() => m.migrateLegacy?.()}>${draft.migrating ? "Moving…" : "Move custom scenes to HA"}</button>
      </div>` : nothing}
      ${draft.haList?.length && (m.loadExisting || m.migrateHue) ? html`<div class="fp-se-steps" id="sceneHaBar">
        <span>Existing / Hue:</span>
        ${draft.haList.map((item, k) => item.kind === "hue"
          ? (m.canWriteHa && m.migrateHue ? html`<button type="button" class="fp-se-chip" id=${`sdHue-${k}`} ?disabled=${draft.busy} title=${`Activate & capture ${item.entityId}`} @click=${() => m.migrateHue?.(item)}>Migrate Hue: ${item.name}</button>` : nothing)
          : (m.loadExisting ? html`<button type="button" class=${`fp-se-chip${draft.haSceneId === item.configId ? " on" : ""}`} id=${`sdLoad-${k}`} ?disabled=${draft.busy} title=${`Edit ${item.entityId}`} @click=${() => m.loadExisting?.(item)}>${item.kind === "dynamic" ? "▶ " : "✎ "}${item.name}</button>` : nothing))}
      </div>` : nothing}
      ${draft.replaceHueEntity ? html`<div class="fp-se-mig" id="sceneHueBanner">
        <span>Replacing Hue scene <code>${draft.replaceHueEntity}</code></span>
        <label><input type="checkbox" id="sceneDisableHue" .checked=${lv(draft.disableHueOnSave !== false)} @change=${(e: Event) => { draft.disableHueOnSave = (e.target as HTMLInputElement).checked; m.refresh(); }}> Disable Hue scene in HA after saving</label>
        <button type="button" class="btn fp-se-btn keep" id="sceneHueClear" @click=${() => { draft.replaceHueEntity = null; m.refresh(); }}>Cancel replace</button>
      </div>` : nothing}
      <div class="fp-se-grid">
        <div class="fp-se-map" id="scenePreview" @click=${onMapClick}>
          ${tools.svgAttr
            ? html`<svg viewBox="${crop.x} ${crop.y} ${crop.w} ${crop.h}" role="img" aria-label=${`${m.roomName} scene preview`} ${tools.svgAttr(svgBody)}></svg>`
            : html`<svg viewBox="${crop.x} ${crop.y} ${crop.w} ${crop.h}" role="img" aria-label=${`${m.roomName} scene preview`}>${tools.svgBody ? tools.svgBody(svgBody) : nothing}</svg>`}
          <span class="fp-se-map-cap">Tap a device to edit</span>
        </div>
        <div class="rows fp-se-rows">${rows.length ? rows.map(row) : html`<p>No light, switch, fan, cover, climate or media player is placed in this room.</p>`}</div>
      </div>
      ${paletteEl}
      ${draft.error ? html`<p class="warn-text fp-se-err" id="sceneError" role="alert">${draft.error}</p>` : nothing}
      <div class="sd-try">
        ${m.canTry
          ? html`<button type="button" class="btn fp-se-btn keep" id="sceneTry" ?disabled=${draft.busy} title="Sends this scene to the real devices now. Restore puts them back." @click=${() => m.tryRun()}>Try it</button>
            <button type="button" class="btn fp-se-btn keep" id="sceneRestore" ?disabled=${draft.busy || !draft.backup.length} @click=${() => m.tryRestore()}>Restore</button>`
          : html`<button type="button" class="btn fp-se-btn keep" id="sceneTry" disabled>Try it</button>
            <button type="button" class="btn fp-se-btn keep" id="sceneRestore" disabled>Restore</button>
            <span id="tryNeeds">Trying a scene needs the studio connected to Home Assistant with write access.</span>`}
        ${draft.trying ? html`<span id="tryNote" role="status">${draft.trying}</span>` : nothing}
      </div>
      <div class="sd-actions">
        <button type="button" class="btn fp-se-btn primary keep" id="sceneSave" ?disabled=${ro || draft.busy} @click=${() => m.save()}>${saveLabel}</button>
        <button type="button" class="btn fp-se-btn keep" id="sceneCancel" @click=${() => m.close()}>Cancel</button>
      </div>
    </div>
  </div>`;
}
