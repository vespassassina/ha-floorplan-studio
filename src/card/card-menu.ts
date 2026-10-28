import { CAM_POS, CAM_SIZES, type CamPos, type CamSize, clampTilt, DETAIL_LABELS, DETAIL_MODES, type DetailMode, floorBelow, HEAT_KINDS, type HeatKind, layerCounts, type LayerId, LAYERS, type SavedView, soloLayer, type Theme, THEMES, toggleLayer, WALLS_LABELS, WALLS_MODES, type WallsMode } from "../core";
import { mark, t } from "../core/i18n";
import type { MenuItem, MenuSection } from "./more-menu";
import { BELOW_LABELS, BELOW_MODES, type BelowMode, HEAT_LABELS, normaliseRotation, ROTATION_STEP, shortestDelta } from "./view-state";
import type { Pt } from "./viewport";
import { html, nothing } from "lit";
import { popupInSheet } from "./card-sheet";
import type { FloorplanStudioCard, CardView } from "./floorplan-studio-card";

/** The View dropdown's options, one list for the markup and for reading the choice back (a value that is not here
 * is refused). */
const VIEW_OPTIONS: readonly { value: CardView; label: string }[] = [
  { value: "2d", label: "2D" },
  { value: "2.5d", label: "2.5D" },
  { value: "3d", label: "3D" },
];
/** The Camera thumbnail menu's words for `CAM_SIZES` and `CAM_POS`; shown through `t(CAM_WORDS[x])`. */
const CAM_WORDS: Record<(typeof CAM_SIZES)[number] | (typeof CAM_POS)[number], string> = {
  small: mark("Small"), medium: mark("Medium"), large: mark("Large"), above: mark("Above"), below: mark("Below"), left: mark("Left"), right: mark("Right"),
};
/** S31.6: the Tilt slider is a menu of steps. A stored or YAML tilt in between reads as the nearest step. */
export const TILT_STEPS: readonly number[] = [0, 0.25, 0.5, 0.75, 1];
export const isView = (v: unknown): v is CardView => VIEW_OPTIONS.some((o) => o.value === v);

/** The Theme dropdown's labels. A Record over `Theme`, so a theme added to core fails the build here until it has a name. */
export const THEME_LABELS: Record<Theme, string> = {
  blueprint: "Blueprint", midnight: "Midnight", light: "Light|theme", slate: "Slate", terminal: "Terminal", solarized: "Solarized",
  ha: "Home Assistant", coffee: "Coffee", "a-team": "A-Team", space: "Space", cyberpunk: "Cyberpunk",
  "carpenter-brut": "Carpenter Brut", "beach-house": "Beach house",
};
export const isTheme = (v: unknown): v is Theme => typeof v === "string" && (THEMES as readonly string[]).includes(v);

/** S31.5: the header bar, the top band of the card's grid: floor tabs on the left, Search and the ⋯ menu on the right.
 *  Text, not icons, for Search: the plan's own `<svg>` stays the first one in the shadow root (`updated()` binds it by that).
 *  Left out whole when it would be empty, and in kiosk (where the menu, if the config brings one, sits in the cluster).
 *  Search needs the sheet it opens in, so `active_list: false` drops it. */
export function header(c: FloorplanStudioCard) {
  if (c._kiosk()) return null;
  const tabs = floorChips(c);
  const search = c._activeListVisible() && c._layout ? html`<button type="button" class="fp-head-btn" aria-label=${t("Search")} title=${t("Search")} @click=${() => { c._openSearch(); }}>${t("Search")}</button>` : null;
  const options = optionsMenu(c);
  if (!tabs && !search && !options) return null;
  return html`<div class="fp-head">${tabs}<span class="fp-head-gap"></span>${search}${options}</div>`;
}

/** S31.6: the ⋯ menu, or `null` when it would hold nothing (`view_switch: false` with no rotate, no layers, no detail). */
export function optionsMenu(c: FloorplanStudioCard) {
  const sections = menuSections(c);
  return sections.length ? html`<fp-menu label=${t("View options")} .items=${sections} @fp-menu-pick=${c._onMenuPick}></fp-menu>` : null;
}

/** S31.6, spec D3, in its order: View, Tilt (2.5D), Walls (2.5D and 3D), Floors below (3D) or Floor below (2D and 2.5D), Theme,
 *  Labels, Device names, Detail, Layers, Rotate left, Rotate right, Reset view. Each item is what the old control was and
 *  `_onMenuPick` writes what that control wrote. `view_switch: false` drops everything up to Device names; Detail and Layers
 *  keep the Overview's condition (the sheet is shown, no live 3D); the rotate pair and Reset view keep theirs (`_rotateOn`,
 *  `_hasViewControls`) and are not in live 3D, where the camera has its own Reset camera. Kiosk has no menu unless
 *  `rotate_switch: true` brings the rotate pair. */
export function menuSections(c: FloorplanStudioCard): MenuSection[] {
  const out: MenuSection[] = [];
  const view = c._viewPick(), live3d = view === "3d" && c._shows3d(), f = c._floor();
  const radio = (label: string, value: string, checked: boolean): MenuItem => ({ kind: "radio", label, value, checked });
  if (c._viewSwitchOn()) {
    out.push({ label: t("View"), items: VIEW_OPTIONS.map((o) => radio(o.label, `view:${o.value}`, o.value === view)) });
    if (view === "2.5d") {
      const near = TILT_STEPS.reduce((a, b) => (Math.abs(b - c._tilt()) < Math.abs(a - c._tilt()) ? b : a));
      out.push({ label: t("Tilt"), items: TILT_STEPS.map((s) => radio(`${Math.round(s * 100)}%`, `tilt:${s}`, s === near)) });
    }
    if (live3d || view === "2.5d") out.push({ label: t("Walls"), items: WALLS_MODES.map((m) => radio(t(WALLS_LABELS[m]), `walls:${m}`, m === c._walls())) });
    if (live3d) out.push({ label: t("Floors below"), items: BELOW_MODES.map((m) => radio(t(BELOW_LABELS[m]), `below:${m}`, m === c._below())) });
    else {
      const key = c._floorKey(), none = !key || !c._layout || floorBelow(c._layout, key) === null;
      out.push({ items: [{ kind: "check", label: t("Floor below"), value: "ghost", checked: c._ghostOn(), disabled: none }] });
    }
    out.push({ items: [{ kind: "select", label: t("Theme"), value: "theme", selected: `theme:${c._theme()}`, options: THEMES.map((k) => ({ label: t(THEME_LABELS[k]), value: `theme:${k}` })) }] });
    out.push({ items: [
      { kind: "check", label: t("Labels"), value: "labels", checked: c._labels() },
      { kind: "check", label: t("Device names"), value: "names", checked: c._names() },
    ] });
  }
  const saved = savedViews(c);
  if (saved.length) out.push({ label: t("Views"), items: saved.map((v) => radio(v.name, `view:${v.id}`, v.id === c._appliedView)) });
  if (c._activeListVisible() && f && !c._shows3d()) {
    out.push({ label: t("Detail"), items: DETAIL_MODES.map((m) => radio(t(DETAIL_LABELS[m]), `detail:${m}`, m === c._detailMode())) });
    const n = layerCounts(f), hidden = c._hiddenLayers;
    const layers = LAYERS.filter((l) => n[l.id] > 0).map((l): MenuItem => ({ kind: "check", label: t(l.label), value: `layer:${l.id}`, checked: !hidden.includes(l.id) }));
    if (layers.length) out.push({ label: t("Layers"), items: layers });
  }
  // S34.8: the Heat map is data, like Detail and Layers, and keeps their condition: it stays under `view_switch: false`, is not in live
  // 3D, and kiosk and `active_list: false` have no menu for it (the YAML key still applies there).
  if (c._activeListVisible() && f && !c._shows3d()) out.push({ label: t("Heat map"), items: HEAT_KINDS.map((k) => radio(t(HEAT_LABELS[k]), `heat:${k}`, k === c._heatKind())) });
  // S16.3: the Camera thumbnail is a view choice too, offered while the shown floor has a camera. In 3D as well: the picture floats beside the icon there.
  if (c._activeListVisible() && f?.devices.some((d) => d.type === "camera")) {
    const th = c._camThumb();
    out.push({ label: t("Camera thumbnail"), items: [radio(t("Off"), "cam:off", !th.on), radio(t("On"), "cam:on", th.on)] },
      { label: t("Thumbnail size"), items: CAM_SIZES.map((s) => radio(t(CAM_WORDS[s]), `camsize:${s}`, s === th.size)) },
      { label: t("Thumbnail position"), items: CAM_POS.map((p) => radio(t(CAM_WORDS[p]), `campos:${p}`, p === th.pos)) });
  }
  if (!c._shows3d() && c._hasViewControls()) {
    const acts: MenuItem[] = [];
    if (c._rotateOn()) acts.push({ kind: "action", label: t("Rotate left"), value: "rotate:-1" }, { kind: "action", label: t("Rotate right"), value: "rotate:1" });
    acts.push({ kind: "action", label: t("Reset view"), value: "reset", disabled: !c._modified() });
    out.push({ items: acts });
  }
  return out;
}

/** S33.8: the layout's saved views this card offers, in the layout's order. A view is offered when its floor is one the card can
 *  show (`floors`, or the one floor it is pinned to), and when its id is not one of the View modes (`2d`, `2.5d`, `3d`): the menu value
 *  is `view:<id>` for both, and the mode must keep its own item. The layout went through `validate`, so a view here is well formed. */
export function savedViews(c: FloorplanStudioCard): SavedView[] {
  const views = c._layout?.views;
  if (!views?.length || c._kiosk()) return [];
  const list = c._floorList(), shown = c._floorKey();
  const keys = list ? list.map(([k]) => k) : shown ? [shown] : [];
  return views.filter((v) => keys.includes(v.floor) && !isView(v.id));
}

/** S33.8, spec X3: a saved view is a viewer's pick. Floor, then mode (a view with none leaves the viewer's own), then turn (a view with
 *  none is turned 0, so one view never inherits the last one's turn), then zoom and centre (2D and 2.5D; zoom is a ratio against this
 *  card's fit, the centre is plan cm). In 3D the floor's framed camera stands. Written to view memory like any pick; Reset view goes
 *  back to the config, not to a saved view. */
export function applySavedView(c: FloorplanStudioCard, id: string): void {
  const v = savedViews(c).find((x) => x.id === id);
  if (!v) return;
  c._settleTurn(false);
  c._selectFloor(v.floor);
  if (v.mode !== undefined && isView(v.mode)) { c._pickedView = v.mode; c._fallback3d = null; }
  const flat = c._viewPick() !== "3d";
  const anchor = flat && v.zoom !== undefined && v.center ? { focus: [v.center[0], v.center[1]] as Pt, zoom: v.zoom } : null;
  c._view = null;
  c._pendingView = null;
  c._forgetCamera();
  const to = normaliseRotation(v.rotation ?? 0), from = c._userAngle();
  if (to === from) {
    c._pendingView = anchor;
    c._pickedRot = to === normaliseRotation(c._config.rotation) ? null : to;
  } else c._startTurn(from + shortestDelta(from, to), anchor); // its settle writes the turn
  c._appliedView = v.id; // after _selectFloor, which lets go of a view of another floor
  c._saveViewNow();
  c.requestUpdate();
}

/** S2.6/S6.5: `_floorList()`'s chips, one per switchable floor in its order, or `null` for anything else. Card
 * chrome (like the no-layout message): drawn outside the `<svg>` renderFloor returns, never inside the plan it
 * draws (CLAUDE.md finding 8, one draw path — the plan is drawn only by `renderFloor`, this is the card's own
 * DOM around it). */
export function floorChips(c: FloorplanStudioCard) {
  if (c._kiosk()) return null; // S7.5: no switcher in kiosk mode, even with floors or floor: "all" configured
  const list = c._floorList();
  if (!list) return null;
  const current = c._floorKey(), selected = c._pickedFloorKey(), floors = c._attention()?.floors ?? {};
  // aria-pressed marks the floor shown; the class marks the floor whose panel is open (S20.2), a separate fact.
  // S24.7: "Ground · 3", the floor's attention count (things, not items; nothing at 0); an alarm turns the pill --fp-warn.
  return html`<div class="fp-floors">
      ${list.map(([key, fl]) => {
      const n = floors[key]?.count ?? 0, alarm = floors[key]?.alarm === true;
      const cls = [key === selected ? "fp-floor-picked" : "", alarm ? "fp-floor-alarm" : ""].filter(Boolean).join(" ");
      return html`<button type="button" class=${cls} aria-pressed=${key === current ? "true" : "false"} aria-expanded=${c._activeListVisible() ? (key === selected ? "true" : "false") : nothing} @click=${() => tapFloorChip(c, key)}>${fl.title || key}${n ? html`<span class="fp-floor-sep"> · </span><span class="fp-floor-count">${n}</span>` : nothing}</button>`;
    })}
    </div>`;
}

/** S20.2: a pill shows its floor, as before, and selects it so the side panel opens on the floor. The selected floor's
 *  pill again lets go. With the panel off (`active_list: false`) there is nowhere to show a floor, so it only switches, as a
 *  room tap does nothing there. Kiosk has no pills, so it never gets here. */
export function tapFloorChip(c: FloorplanStudioCard, key: string): void {
  // S31.8: with the Device level open, a floor tab goes to the Floor level, one level up, even when it names the floor already picked.
  const letGo = c._pickedFloorKey() === key && !(c._popup && popupInSheet(c));
  c._selectFloor(key);
  c._pickFloor(letGo || !c._activeListVisible() ? null : key);
}

/** One pick from the ⋯ menu. The value is `kind:arg`; every arg is checked against its list (the menu is the host's own
 *  data, but a stale or forged event must change nothing). Each case does what the control it replaced did. */
export function onMenuPick(c: FloorplanStudioCard, ev: Event): void {
  const d = (ev as CustomEvent<MenuItem & { alt?: boolean }>).detail, v = d?.value;
  if (typeof v !== "string") return;
  const i = v.indexOf(":"), kind = i < 0 ? v : v.slice(0, i), arg = i < 0 ? "" : v.slice(i + 1);
  const done = () => { c._saveViewNow(); c.requestUpdate(); };
  switch (kind) {
    case "view":
      if (isView(arg)) { c._pickedView = arg; c._fallback3d = null; done(); } // a new pick tries 3D again
      else applySavedView(c, arg); // S33.8: not a mode, so a saved view's id
      break;
    case "tilt": if (TILT_STEPS.includes(Number(arg))) { c._pickedTilt = clampTilt(Number(arg)); done(); } break;
    case "walls": if ((WALLS_MODES as readonly string[]).includes(arg)) { c._pickedWalls = arg as WallsMode; done(); } break;
    case "below": if ((BELOW_MODES as readonly string[]).includes(arg)) { c._pickedBelow = arg as BelowMode; done(); } break;
    case "ghost": c._pickedGhost = !c._ghostOn(); done(); break;
    case "theme": if (isTheme(arg)) { c._pickedTheme = arg; done(); } break;
    case "labels": c._pickedLabels = !c._labels(); done(); break;
    case "names": c._pickedNames = !c._names(); done(); break;
    case "detail": if ((DETAIL_MODES as readonly string[]).includes(arg)) { c._pickedDetail = arg as DetailMode; done(); } break;
    case "heat": if ((HEAT_KINDS as readonly string[]).includes(arg)) { c._pickedHeat = arg as HeatKind; done(); } break;
    case "cam": if (arg === "on" || arg === "off") { c._pickedCam = { ...c._pickedCam, on: arg === "on" }; done(); } break;
    case "camsize": if ((CAM_SIZES as readonly string[]).includes(arg)) { c._pickedCam = { ...c._pickedCam, size: arg as CamSize }; done(); } break;
    case "campos": if ((CAM_POS as readonly string[]).includes(arg)) { c._pickedCam = { ...c._pickedCam, pos: arg as CamPos }; done(); } break;
    case "layer": if (LAYERS.some((l) => l.id === arg)) c._setLayers(d?.alt === true ? soloLayer(c._hiddenLayers, arg as LayerId) : toggleLayer(c._hiddenLayers, arg as LayerId)); break; // Alt: this family alone, again: all
    case "rotate": if (arg === "1" || arg === "-1") c._turnBy(Number(arg) * ROTATION_STEP); break;
    case "reset": c._resetView(); break;
  }
}
