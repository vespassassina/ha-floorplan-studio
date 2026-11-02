import { tag, type Theme, THEMES, wallsModeOf } from "../core";
import { type FloorView, parseStoredView, type StoredView } from "./view-state";
import { isView } from "./card-menu";
import type { FloorplanStudioCard, CardView } from "./floorplan-studio-card";

/** Pan and zoom write to storage once they have been still this long. Short on purpose: a tablet that is put to
 * sleep or a tab that is discarded may never fire pagehide, so the write must not wait long for it. */
const SAVE_DEBOUNCE_MS = 150;

/** The view memory's own key, apart from the Active list's (they change at different moments and a bad entry in
 * one must not cost the other). Same seed, so two cards tell apart the way the panels do, plus the config keys
 * that make a card a different view of the same floor: a 2D card and a 2.5D card of one floor, or two turned
 * differently, must not share a memory. Like `center` above they join the seed only when set. A side effect worth
 * knowing: editing one of them in the card's YAML starts a card with a clean memory. */
export function viewStorageKey(card: FloorplanStudioCard): string {
  const seed = card._storageSeed();
  const c = card._config;
  if (c.view !== undefined) seed.push(["view", c.view]);
  if (c.rotation !== undefined) seed.push(["rotation", c.rotation]);
  if (c.theme !== undefined) seed.push(["theme", c.theme]);
  if (c.tilt !== undefined) seed.push(["tilt", c.tilt]);
  if (c.walls !== undefined) seed.push(["walls", c.walls]);
  if (c.labels !== undefined) seed.push(["labels", c.labels]);
  if (c.names !== undefined) seed.push(["names", c.names]);
  // A stored pick must not outlive a config that now says something else (S25 review): detail and kiosk decide the default.
  if (c.detail !== undefined) seed.push(["detail", c.detail]);
  if (c.ghost_floor !== undefined) seed.push(["ghost_floor", c.ghost_floor]);
  if (c.floors_below !== undefined) seed.push(["floors_below", c.floors_below]);
  if (c.heat_map !== undefined) seed.push(["heat_map", c.heat_map]);
  for (const k of ["camera_thumb", "camera_thumb_size", "camera_thumb_pos"] as const) if (c[k] !== undefined) seed.push([k, c[k]]);
  if (c.kiosk !== undefined) seed.push(["kiosk", c.kiosk]);
  return `fp-view:${tag(JSON.stringify(seed))}`;
}

/** Reads this card's remembered view into the picked fields, before the first render so there is no flash of the
 * config's look. Storage is untrusted: `parseStoredView` drops each bad field, and a throwing `localStorage`
 * (private mode, blocked) is nothing stored. */
export function loadViewState(c: FloorplanStudioCard): void {
  c._pickedView = c._pickedTilt = c._pickedWalls = c._pickedTheme = c._pickedLabels = c._pickedNames = c._pickedRot = c._pickedDetail = c._pickedGhost = c._pickedBelow = c._pickedHeat = c._pickedCam = null;
  c._pendingView = null;
  c._appliedView = null;
  c._shownFloor = null;
  c._floorViews = new Map();
  c._memFloor = null;
  c._camMoved = false;
  c._kept = null;
  let s: StoredView = {};
  try {
    const raw = globalThis.localStorage?.getItem(viewStorageKey(c));
    if (raw) s = parseStoredView(raw, isView, THEMES);
  } catch {
    /* storage blocked: the card starts from its config */
  }
  if (s.view !== undefined) c._pickedView = s.view as CardView;
  if (s.tilt !== undefined) c._pickedTilt = s.tilt;
  if (s.walls !== undefined) c._pickedWalls = wallsModeOf(s.walls);
  if (s.theme !== undefined) c._pickedTheme = s.theme as Theme;
  if (s.labels !== undefined) c._pickedLabels = s.labels;
  if (s.names !== undefined) c._pickedNames = s.names;
  if (s.detail !== undefined) c._pickedDetail = s.detail;
  if (s.ghost !== undefined) c._pickedGhost = s.ghost;
  if (s.below !== undefined) c._pickedBelow = s.below;
  if (s.heat !== undefined) c._pickedHeat = s.heat;
  if (s.cam !== undefined) c._pickedCam = s.cam;
  if (s.floor !== undefined) c._shownFloor = s.floor; // an unknown id is ignored by _floorKey
  c._hiddenLayers = s.layers ?? [];
  for (const [k, fv] of s.floors ?? []) c._floorViews.set(k, fv); // the live fields follow once the first render knows the floor
}

/** The live view state of the shown floor, written into `_floorViews` (an empty one removes the entry). The 3D camera
 * is read from the view only when the person has moved it on this floor; otherwise what was stored stays. */
export function stashFloor(c: FloorplanStudioCard): void {
  const key = c._floorKey();
  if (!key || key !== c._memFloor) return;
  const fv: FloorView = {};
  if (c._pickedRot !== null) fv.rotation = c._pickedRot;
  const anchor = c._pendingView ?? c._anchorOfView();
  if (anchor) { fv.zoom = anchor.zoom; fv.focus = anchor.focus; }
  const cam = c._camMoved && c._view3d && c._view3dKey === key ? c._view3d.camera() : c._floorViews.get(key)?.cam;
  if (cam) fv.cam = cam;
  if (Object.keys(fv).length) c._floorViews.set(key, fv);
  else c._floorViews.delete(key);
}

/** Writes what the person has chosen: only the picked fields, and the zoom and focus while zoomed. Nothing to
 * say removes the entry. A turn in flight writes nothing; its end does. Never throws. */
export function saveViewNow(c: FloorplanStudioCard): void {
  if (c._saveTimer !== null) {
    globalThis.clearTimeout(c._saveTimer);
    c._saveTimer = null;
  }
  if (c._turn) return;
  const o: Record<string, unknown> = {};
  if (c._pickedView !== null) o.view = c._pickedView;
  if (c._pickedTilt !== null) o.tilt = c._pickedTilt;
  if (c._pickedWalls !== null) o.walls = c._pickedWalls;
  if (c._pickedTheme !== null) o.theme = c._pickedTheme;
  if (c._pickedLabels !== null) o.labels = c._pickedLabels;
  if (c._pickedNames !== null) o.names = c._pickedNames;
  if (c._pickedDetail !== null) o.detail = c._pickedDetail;
  if (c._pickedGhost !== null) o.ghost = c._pickedGhost;
  if (c._pickedBelow !== null) o.below = c._pickedBelow;
  if (c._pickedHeat !== null) o.heat = c._pickedHeat;
  if (c._pickedCam !== null) o.cam = c._pickedCam;
  if (c._shownFloor !== null) o.floor = c._shownFloor;
  if (c._hiddenLayers.length) o.layers = c._hiddenLayers;
  stashFloor(c);
  if (c._floorViews.size) o.floors = [...c._floorViews];
  try {
    const key = viewStorageKey(c);
    if (Object.keys(o).length) globalThis.localStorage?.setItem(key, JSON.stringify({ v: 1, ...o }));
    else globalThis.localStorage?.removeItem(key);
  } catch {
    /* private browsing or storage blocked: the view just does not persist */
  }
}

/** Pan and zoom come in bursts: write once they have been still for a moment. */
export function scheduleSave(c: FloorplanStudioCard): void {
  if (c._saveTimer !== null) globalThis.clearTimeout(c._saveTimer);
  c._saveTimer = globalThis.setTimeout(() => saveViewNow(c), SAVE_DEBOUNCE_MS);
}

export function loadActiveState(c: FloorplanStudioCard): void {
  c._activeCollapsed = false;
  c._activeUserChose = false;
  c._overviewAll = false;
  try {
    const raw = globalThis.localStorage?.getItem(c._activeStorageKey());
    if (!raw) return;
    const parsed = JSON.parse(raw) as { collapsed?: unknown; chosen?: unknown; all?: unknown };
    c._overviewAll = parsed.all === true;
    // An entry from before `chosen` existed that says collapsed was a hand fold (nothing else wrote it as true);
    // one that says open only recorded a drag (gone in S31.5), so the width still decides.
    if (parsed.chosen === true || parsed.collapsed === true) { c._activeUserChose = true; c._activeCollapsed = parsed.collapsed === true; }
  } catch {
    /* malformed or unavailable storage: the sheet just opens at its default, unfolded */
  }
}
