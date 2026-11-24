import type { Labelled } from "./hass-write";
import {
  haRow, loadHaList, notifyAutomation, syncAssignAreaFloor, syncCreateArea, syncCreateFloor, syncLinkArea, syncLinkFloor,
  syncMoveDeviceArea, syncRemoveOrphan, syncReplaceEntity,
} from "./editor-ha";
import { haSyncReport } from "./ha-sync";
import { attention } from "../core";
import type { AsideMode } from "./inspector";
import { closeAlign } from "./editor-align";
import { counted, placedNote } from "./editor-search";
import { newDraft } from "./scene-designer";
import { restoreScene, tryScene } from "./scene-try";
import { captureRoomItems, sceneTargets } from "../card/scene";
import { type AddCandidate, DEVICE_COLOURS, FLOOR_COLOURS, WALL_COLOUR_KEYS, type Pt, type SceneItem, viewBoxFor } from "../core";
import { cleanSceneItem, removeScene, roomSceneTargets, saveScene } from "./room-scenes-ops";
import { placeDevice } from "./editor-draw";
import { MAX_ZOOM } from "../card/viewport";
import { EditorState } from "./state";
import { html, nothing } from "lit";
import { TYPE_LABELS } from "./panels";
import { live } from "./live-keep";
import { setColour, setWallColour } from "./editor-actions";
import type { FloorplanStudioEditor } from "./editor-app";

// ---- the floating panels: Place, the scene designer, Add > Device, Home Assistant, Device colours, Install code ---

/** S4.10: the Home Assistant menu's groups, in the order they are shown. */
const HA_KIND_LABELS: [Labelled["kind"], string][] = [["helper", "Helpers"], ["automation", "Automations"], ["area", "Areas"]];

export const closeCtxMenu = (ed: FloorplanStudioEditor) => { if (ed.ctxMenu) { ed.ctxMenu = null; ed.requestUpdate(); } };

export const toggleDevCols = (ed: FloorplanStudioEditor) => {
  ed.devColsPos = ed.devColsPos ? null : { x: Math.max(20, (window.innerWidth - 560) / 2), y: panelTop(ed) };
  ed.requestUpdate();
};

/** Where a floating panel of width `w` opens: centred under the toolbar, never off the left edge. */
/** S18.7: centred in the viewport, whatever the page scroll or the toolbar's height. `h` is the panel's largest height (its CSS max-height). */
/** S22.3: `h` defaults to the tallest a Place or Add popup may grow (CSS `100vh - 40px`), not 80vh: placed as if
 *  shorter, a long popup ran off the bottom of the window and its Place button could not be reached. Callers pass
 *  the popup's real CSS width for the same reason (Add was placed as if 520 px wide and ran off the right edge). */
export function panelPos(ed: FloorplanStudioEditor, w: number, h = window.innerHeight - 40) { return { x: Math.max(0, Math.round((window.innerWidth - w) / 2)), y: Math.max(8, Math.round((window.innerHeight - Math.min(h, window.innerHeight - 16)) / 2)) }; }

/**
 * S8.10 follow-up (Opus review): a floating panel used to always open at a hardcoded y:90 — fine for the one-row
 * toolbar this was measured against, but the toolbar's own right-aligned cluster can wrap onto several rows at a
 * narrow width, reaching well past 90px, and the panel opened underneath it, covered. Measures the toolbar's own
 * rendered bottom edge instead, so a panel never opens under whatever the toolbar actually is this render. Falls
 * back to 90 only if `.bar` cannot be found (should not happen; defensive only).
 */
export function panelTop(ed: FloorplanStudioEditor) { const r = ed.renderRoot.querySelector(".bar")?.getBoundingClientRect(); return r ? Math.round(r.bottom) + 10 : 90; }

/** S8.1: the pointer handlers that drag a floating panel by its head. `get` reads its position, `set` writes the new one; a
 * press on a button in the head (its X) is not a drag. Shared by Device colours, Home Assistant and Place. */
export function dragHead(ed: FloorplanStudioEditor, get: () => { x: number; y: number } | null, set: (p: { x: number; y: number }) => void) {
  let d: { dx: number; dy: number } | null = null;
  return {
    down: (e: PointerEvent) => {
      const p = get();
      if (!p || (e.target as Element).closest("button")) return;
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      d = { dx: e.clientX - p.x, dy: e.clientY - p.y };
    },
    move: (e: PointerEvent) => { if (!d) return; set({ x: e.clientX - d.dx, y: e.clientY - d.dy }); ed.requestUpdate(); },
    up: () => { d = null; },
  };
}

/** S8.1: Edit, Home Assistant. Opening closes the menu it sits in and reloads the list (HA state moves on its own). */
export function toggleHa(ed: FloorplanStudioEditor) {
  ed.closeMenus();
  ed.haPos = ed.haPos ? null : panelPos(ed, 440);
  if (ed.haPos) void loadHaList(ed);
  ed.requestUpdate();
}

/** S46: Edit, Check HA sync. Opening closes menus and shows entity orphans, area mismatches, and floor links. */
export function toggleHaSync(ed: FloorplanStudioEditor) {
  ed.closeMenus();
  ed.haSyncPos = ed.haSyncPos ? null : panelPos(ed, 480);
  ed.requestUpdate();
}

/** S47: Edit, Attention. Lists current Attention rows with one-click notification automation creation. */
export function toggleAttention(ed: FloorplanStudioEditor) {
  ed.closeMenus();
  ed.attentionPos = ed.attentionPos ? null : panelPos(ed, 460);
  ed.requestUpdate();
}

export function openPlace(ed: FloorplanStudioEditor, i: number) {
  const r = ed.st.f.rooms[i];
  if (!r) return;
  ed.traceMove = false;
  ed.placeRoom = r.id; ed.placeOn = new Set(); ed.placeType = null; ed.asideMode = "place";
  ed.requestUpdate();
}

export function closePlace(ed: FloorplanStudioEditor) { ed.placeRoom = null; if (ed.asideMode === "place") ed.asideMode = "selection"; ed.requestUpdate(); }

/** The index of the room the Place mode was opened on, -1 when none (or it left the floor). */
export function placeIndex(ed: FloorplanStudioEditor): number { return ed.placeRoom === null ? -1 : ed.st.f.rooms.findIndex((r) => r.id === ed.placeRoom); }

/** S26.14: a tab of the aside. Place resumes its room, or opens on the selected one; Add opens as the menu entry does; Selection leaves both as they are. */
export function setAsideMode(ed: FloorplanStudioEditor, m: AsideMode) {
  if (ed.st.helpOpen) ed.st.setHelp(false); // Help covers every mode; a tab click is a way out of it
  if (m !== "align") closeAlign(ed, false);
  if (m === ed.asideMode) { ed.requestUpdate(); return; }
  if (m === "add") { openAddDev(ed); return; }
  if (m === "place") {
    if (placeIndex(ed) >= 0) ed.asideMode = "place";
    else { const s = ed.st.sel; if (s && s.t === "room") openPlace(ed, s.i); }
  } else ed.asideMode = "selection";
  ed.requestUpdate();
}

/** Places the ticked rows (one undo step, `EditorState.placeArea`) and closes the popup. */
export function placeGo(ed: FloorplanStudioEditor, i: number, ids: string[]) {
  const before = counted(ed);
  const n = ed.st.placeArea(i, new Set(ids));
  closePlace(ed);
  if (n) placedNote(ed, before, `Placed ${n} device${n === 1 ? "" : "s"}. Drag each to its spot.`, `Placed ${n} device${n === 1 ? "" : "s"}`);
}

/** Opens the designer on a copy of scene `id` of room `i` (null: a new one). Nothing reaches the layout before Save. */
export function openScene(ed: FloorplanStudioEditor, i: number, id: string | null) {
  const r = ed.st.f.rooms[i];
  if (!r) return;
  const sc = id === null ? undefined : r.scenes?.find((s) => s.id === id);
  if (id !== null && !sc) return;
  ed.sceneDraft = newDraft(r.id, id, sc?.name ?? "", sc?.items ?? []);
  ed.scenePos = panelPos(ed, 760, Math.min(900, window.innerHeight - 40));
  ed.requestUpdate();
}

/** Closing without Save (Cancel, the X, Escape) puts back what a Try changed; Save leaves the devices as tried. */
export function closeScene(ed: FloorplanStudioEditor, keepDevices = false) {
  const w = ed.writer, back = ed.sceneBackup;
  ed.sceneDraft = null; ed.scenePos = null; ed.sceneBackup = []; ed.sceneOrigin = [];
  if (!keepDevices && w && back.length) void restoreScene(w, back);
  ed.requestUpdate();
}

export function draftItems(ed: FloorplanStudioEditor): SceneItem[] { return [...(ed.sceneDraft?.items.values() ?? [])].flatMap((it) => { const c = cleanSceneItem(it); return c ? [c] : []; }); }

export async function trySceneDraft(ed: FloorplanStudioEditor) {
  const w = ed.writer, d = ed.sceneDraft, items = draftItems(ed);
  if (!w || !d) return;
  if (!items.length) { d.trying = "Pick at least one device to try."; ed.requestUpdate(); return; }
  ed.sceneBusy = true; d.trying = "Sending…"; ed.requestUpdate();
  const r = await tryScene(w, items, ed._hassStates ?? {}, ed.sceneOrigin);
  ed.sceneOrigin = r.backup; ed.sceneBackup = r.backup; ed.sceneBusy = false;
  d.trying = r.failed.length ? `Home Assistant refused ${r.failed.join(", ")}.` : r.unrestorable.length ? `Sent. Restore cannot put back ${r.unrestorable.join(", ")}: its state is unknown.` : "Sent. Restore puts the devices back.";
  ed.requestUpdate();
}

export async function restoreSceneDraft(ed: FloorplanStudioEditor) {
  const w = ed.writer, d = ed.sceneDraft;
  if (!w || !d) return;
  ed.sceneBusy = true; ed.requestUpdate();
  const failed = await restoreScene(w, ed.sceneBackup);
  ed.sceneBackup = []; ed.sceneBusy = false;
  d.trying = failed.length ? `Could not put back ${failed.join(", ")}.` : "Put back.";
  ed.requestUpdate();
}

/** S50: fills the draft from the room's current live HA states. */
export function captureSceneDraft(ed: FloorplanStudioEditor) {
  const d = ed.sceneDraft;
  const i = d ? ed.st.f.rooms.findIndex((r) => r.id === d.room) : -1;
  if (!d || i < 0) return;
  const targets = sceneTargets(ed.st.f, i);
  const got = captureRoomItems(targets, ed._hassStates ?? {});
  if (!got.size) { d.note = "No live device states available to capture."; ed.requestUpdate(); return; }
  d.items = got;
  d.note = `Captured ${got.size} device${got.size === 1 ? "" : "s"} from the room.`;
  ed.requestUpdate();
}

/** S50: one-time explicit migration of a room's legacy custom scenes into real HA `scene.*` entities. */
export async function migrateLegacyScenes(ed: FloorplanStudioEditor) {
  const d = ed.sceneDraft, w = ed.writer;
  const i = d ? ed.st.f.rooms.findIndex((r) => r.id === d.room) : -1;
  if (!d || i < 0 || !w?.saveScene || d.migrating) return;
  const r = ed.st.f.rooms[i]!;
  const legacy = [...(r.scenes ?? [])];
  if (!legacy.length) return;
  d.migrating = true; d.error = ""; ed.requestUpdate();
  const moved: string[] = [];
  try {
    for (const sc of legacy) {
      await w.saveScene({ name: sc.name, areaId: r.area, items: sc.items });
      moved.push(sc.id);
    }
  } catch (err) {
    d.error = err instanceof Error ? err.message : String(err);
  }
  if (moved.length) ed.commit((f) => { for (const id of moved) removeScene(f.rooms[i]!, id); });
  d.migrating = false;
  if (moved.length) d.note = `Moved ${moved.length} scene${moved.length === 1 ? "" : "s"} to Home Assistant.`;
  ed.requestUpdate();
}

/** Save: writes a real HA `scene.*` when connected with HA scene write access on a new scene; otherwise saves to the room in one `commit` (one undo step). */
export async function saveSceneDraft(ed: FloorplanStudioEditor) {
  const d = ed.sceneDraft;
  const i = d ? ed.st.f.rooms.findIndex((r) => r.id === d.room) : -1;
  if (!d || i < 0) { closeScene(ed); return; }
  const order = roomSceneTargets(ed.st.f, i).map((t) => t.entity);
  const items = [...d.items.values()].sort((a, b) => (order.indexOf(a.entity) + 1 || 999) - (order.indexOf(b.entity) + 1 || 999));
  if (d.mode === "dynamic" && ed.writer?.saveDynamicScene) {
    const steps = (d.steps ?? [{ items: d.items, duration: 10 }]).map((s) => ({ items: [...s.items.values()].flatMap((it) => { const c = cleanSceneItem(it); return c ? [c] : []; }), duration: s.duration, transition: s.transition }));
    ed.sceneBusy = true; d.error = ""; ed.requestUpdate();
    try {
      await ed.writer.saveDynamicScene({ name: d.name, areaId: ed.st.f.rooms[i]!.area, steps, loop: d.loop === true });
      ed.sceneBusy = false;
      closeScene(ed, true);
    } catch (err) {
      ed.sceneBusy = false;
      d.error = err instanceof Error ? err.message : String(err);
      ed.requestUpdate();
    }
    return;
  }
  if (ed.writer?.saveScene && d.id === null) {
    const clean = items.flatMap((it) => { const c = cleanSceneItem(it); return c ? [c] : []; });
    if (!d.name.trim()) { d.error = "Give the scene a name."; ed.requestUpdate(); return; }
    if (!clean.length) { d.error = "Pick at least one device."; ed.requestUpdate(); return; }
    ed.sceneBusy = true; d.error = ""; ed.requestUpdate();
    try {
      await ed.writer.saveScene({ name: d.name, areaId: ed.st.f.rooms[i]!.area, items: clean });
      ed.sceneBusy = false;
      closeScene(ed, true);
    } catch (err) {
      ed.sceneBusy = false;
      d.error = err instanceof Error ? err.message : String(err);
      ed.requestUpdate();
    }
    return;
  }
  let reason = "";
  const probe = structuredClone(ed.st.f.rooms[i]);
  const check = saveScene(probe, d.id, d.name, items);
  if (!check.ok) reason = check.reason;
  else ed.commit((f) => { saveScene(f.rooms[i], d.id, d.name, items); });
  if (!reason && ed.st.planBlocked) reason = "The plan is locked, so this scene was not saved. Unlock it and save again."; // never close on a refused save
  if (reason) { d.error = reason; ed.requestUpdate(); return; }
  closeScene(ed, true);
}

/** Closes the Add menu and opens the panel, filters reset, search focused. */
export function openAddDev(ed: FloorplanStudioEditor, at?: Pt) {
  ed.addAt = at ?? null;
  ed.closeMenus();
  ed.asideMode = "add";
  ed.addDevQuery = ""; ed.addDevFloor = ""; ed.addDevRoom = ""; ed.addDevArea = ""; ed.addDevType = "";
  ed.requestUpdate();
  void ed.updateComplete.then(() => ed.renderRoot.querySelector<HTMLInputElement>("#addDevSearch")?.focus({ preventScroll: true }));
}

export function closeAddDev(ed: FloorplanStudioEditor) { ed.addAt = null; if (ed.asideMode === "add") ed.asideMode = "selection"; ed.requestUpdate(); }

/**
 * Places `c`: a catalog entry through the existing `placeDevice` (which already switches to its own stored floor), or
 * an HA entity through `addHaEntity`, switching to the candidate's plan floor first when it differs from the current
 * one — `EditorState.addEntity` only looks at rooms on the current floor. The panel stays open; the row disappears
 * because `addCandidates` no longer lists a placed entity.
 */
export function pickAddDev(ed: FloorplanStudioEditor, c: AddCandidate) {
  const st = ed.st;
  if (c.source === "catalog") { placeDevice(ed, c.id); ed.requestUpdate(); return; }
  const e = st.ha?.entities.find((x) => x.id === c.entity);
  if (!e) return;
  if (c.floorKey && c.floorKey !== st.floor) ed.setFloor(c.floorKey);
  // Opus review finding 11: names the placed device (and the "Added …" status) after c.name, the row the user
  // just clicked — a device row's own name can differ from its main entity's, e.g. the device registry's name.
  ed.addHaEntity(c.name !== e.name ? { ...e, name: c.name } : e);
  ed.requestUpdate();
}

export const toggleInstallCode = (ed: FloorplanStudioEditor) => {
  ed.installCodeOpen = !ed.installCodeOpen;
  ed.requestUpdate();
};

/** S6.6: a whole premade dashboard — pasteable as-is via a new dashboard's own "Edit in YAML" — with one view
 * holding the card: this editor's own theme, and every floor in its current order when there's more than one,
 * so `floors[0]` stays the default the card opens on (a single-floor layout needs no `floors` at all — the card
 * already defaults to its one floor). Floor ids are always a `slug()` (`addFloor`), but a hand-edited or older
 * layout file is untrusted input (CLAUDE.md finding 1), so each one is still written as a quoted YAML string
 * rather than assumed bare-safe. */
export function installCodeYaml(ed: FloorplanStudioEditor): string {
  const st = ed.st;
  const keys = Object.keys(st.layout.floors);
  const lines = [
    "title: Floorplan",
    "views:",
    "  - title: Floorplan",
    "    path: floorplan",
    "    cards:",
    "      - type: custom:floorplan-studio-card",
    `        theme: ${st.theme}`,
  ];
  if (keys.length > 1) {
    lines.push("        floors:");
    for (const k of keys) lines.push(`          - ${JSON.stringify(k)}`);
  }
  return lines.join("\n");
}

/** S33.10: the same dashboard as a strategy: Home Assistant asks the card's script for it on every load, so a floor added in
 * the Studio is there next time, which the YAML above (a snapshot) is not. Three lines, no per-plan values. */
export function strategyYaml(): string {
  return ["title: Floorplan", "strategy:", "  type: custom:floorplan-studio"].join("\n");
}

export function copyInstallCode(ed: FloorplanStudioEditor, code: string) {
  const cb = navigator.clipboard;
  if (!cb) { ed.status = "Could not copy — select the text and copy it by hand."; ed.requestUpdate(); return; }
  cb.writeText(code).then(
    () => { ed.status = "Install code copied."; ed.requestUpdate(); },
    () => { ed.status = "Could not copy — select the text and copy it by hand."; ed.requestUpdate(); },
  );
}

/** S9.6: "Copy card view" (View menu) — the `center`/`zoom_level` a card needs to open on exactly what the
 * editor is showing right now. `viewBoxFor(st.f, 60, ...)` is the card's own fit (pad 60); the editor's own
 * `fit()`/`recenter()` use pad 80 for their own on-screen margin, so this is computed independently rather than
 * read off `st.view`'s resting box, or a card pasting these values would open slightly wider than the editor.
 * S9.6 review (Opus, 2026-09-27): `zoomLevel` used to come from the width ratio alone. A pinned card's box keeps
 * `fit`'s own aspect (`pinnedView`, `viewport.ts`), but the editor's own `st.view` can have a different aspect —
 * a wide, short window, say — and `fit.w / v.w` alone then asked for a box no narrower than the editor's, which
 * left the editor's view taller than the card's aspect allows and cropped what the editor showed top and
 * bottom. Taking the smaller of the width and height ratios means the card's box is at least as tall and at
 * least as wide as `v` — it may show a little more on the narrow axis, never less on either. */
export function copyCardView(ed: FloorplanStudioEditor): void {
  const st = ed.st;
  const fit = viewBoxFor(st.f, 60, st.rotation);
  const v = st.view;
  const cx = Math.round(v.x + v.w / 2), cy = Math.round(v.y + v.h / 2);
  const zoomLevel = Math.min(MAX_ZOOM, Math.max(1, Math.min(fit.w / v.w, fit.h / v.h)));
  const yaml = `center: [${cx}, ${cy}]\nzoom_level: ${zoomLevel.toFixed(2)}`;
  const cb = navigator.clipboard;
  if (!cb) { ed.status = "Could not copy — select the text and copy it by hand."; ed.requestUpdate(); return; }
  cb.writeText(yaml).then(
    () => { ed.status = "Card view copied."; ed.requestUpdate(); },
    () => { ed.status = "Could not copy — select the text and copy it by hand."; ed.requestUpdate(); },
  );
}

const WALL_COLOUR_LABELS: Record<(typeof WALL_COLOUR_KEYS)[number], string> = { wall: "Walls", external: "External walls", fence: "Fences" };

/** Colours: a floating, draggable panel (Edit > Colours): Devices, a 3-column grid of every device type's colour and reset, then Wall colours. */
export function devColsView(ed: FloorplanStudioEditor, st: EditorState) {
  const p = ed.devColsPos!;
  return html`<div class="devcols-panel" style="left:${p.x}px;top:${p.y}px">
    <div class="devcols-head" @pointerdown=${ed.devColsHead.down} @pointermove=${ed.devColsHead.move} @pointerup=${ed.devColsHead.up} @pointercancel=${ed.devColsHead.up}>
      <span>Colours</span>
      <button class="btn keep" id="devcolsClose" aria-label="Close" @click=${() => toggleDevCols(ed)}>&times;</button>
    </div>
    <div class="devcols-sub" id="devcolsDevices">Devices</div>
    <div class="devcols-grid">
      ${TYPE_LABELS.map(([t, label]) => html`<div class="colrow" data-type=${t}><label>${label}<input type="color" .value=${live(st.layout.colors?.[t] ?? DEVICE_COLOURS[t])} @change=${(e: Event) => setColour(ed, t, (e.target as HTMLInputElement).value)}></label>
        <button class="btn keep" aria-label=${`Reset ${label}`} ?disabled=${!(st.layout.colors && t in st.layout.colors)} @click=${() => setColour(ed, t, null)}>Reset</button></div>`)}
    </div>
    <div class="devcols-sub" id="wallcols">Wall colours</div>
    <div class="devcols-walls">
      ${WALL_COLOUR_KEYS.map((k) => {
        const cur = st.layout.wallColors?.[k]?.toLowerCase() ?? "";
        const sw = (hex: string, name: string, extra = "") => html`<button class=${`sw${extra}`} type="button" title=${name} aria-label=${name} aria-pressed=${String(cur === hex)} style="background:${hex}" @click=${() => setWallColour(ed, k, hex)}></button>`;
        return html`<div class="colrow" data-wall=${k}><label>${WALL_COLOUR_LABELS[k]}<input type="color" .value=${live(cur || "#8b8578")} @change=${(e: Event) => setWallColour(ed, k, (e.target as HTMLInputElement).value)}></label>
          <button class="btn keep" aria-label=${`Theme default for ${WALL_COLOUR_LABELS[k].toLowerCase()}`} ?disabled=${!cur} @click=${() => setWallColour(ed, k, null)}>Theme default</button></div>
          <div class="swatches" role="group" aria-label=${`Colours for ${WALL_COLOUR_LABELS[k].toLowerCase()}`}>${FLOOR_COLOURS.map((c) => sw(c.hex, c.name))}${(st.layout.palette ?? []).map((hex) => sw(hex, `Custom ${hex}`, " custom"))}</div>`;
      })}
    </div>
    <button class="btn keep" id="devcolsx" ?disabled=${!st.layout.colors && !st.layout.wallColors} @click=${() => { if (st.resetColours()) ed.changed("Colours reset"); }}>Reset all</button>
  </div>`;
}

/** S8.1: Edit, Home Assistant: a floating, draggable popover, X top-left, of everything Floorplan Studio made in Home
 * Assistant (`listLabelled`), with what it is for, a name that opens the item in HA, and Remove. Stays open across a
 * click elsewhere, like Device colours; Escape closes it. */
export function haView(ed: FloorplanStudioEditor) {
  const p = ed.haPos!;
  return html`<div class="fpanel ha-panel" id="haPanel" role="dialog" aria-label="Home Assistant" style="left:${p.x}px;top:${p.y}px">
    <div class="fpanel-head" @pointerdown=${ed.haHead.down} @pointermove=${ed.haHead.move} @pointerup=${ed.haHead.up} @pointercancel=${ed.haHead.up}>
      <button class="btn keep" id="haClose" aria-label="Close" @click=${() => toggleHa(ed)}>&times;</button>
      <span>Home Assistant</span>
    </div>
    <p>These are the helpers, automations and areas Floorplan Studio created in Home Assistant. Click one to open it there, to edit or rename it. Remove deletes it from Home Assistant; the plan is not touched either way.</p>
    <p><button class="btn keep" id="haOpenSync" @click=${() => { if (!ed.haSyncPos) toggleHaSync(ed); }}>Check HA sync…</button></p>
    ${ed.haListLoading ? html`<span class="grp" id="haLoading">Loading…</span>` : nothing}
    ${ed.haListErr ? html`<span class="grp" id="haErr">${ed.haListErr}</span>` : nothing}
    ${!ed.haListLoading && !ed.haListErr && ed.haList?.length === 0 ? html`<span class="grp" id="haNone">Nothing Floorplan Studio made is labelled in Home Assistant.</span>` : nothing}
    ${HA_KIND_LABELS.map(([k, label]) => { const g = (ed.haList ?? []).filter((x) => x.kind === k); return g.length ? html`<span class="grp">${label}</span>${g.map((it) => haRow(ed, it))}` : nothing; })}
  </div>`;
}

/** S46: floating, draggable HA sync panel listing orphaned entities, room/device area mismatches, and plan-vs-HA floor links. */
export function haSyncView(ed: FloorplanStudioEditor) {
  const p = ed.haSyncPos!, ha = ed.st.ha;
  const rep = haSyncReport(ed.st.layout, ha);
  return html`<div class="fpanel ha-panel" id="haSyncPanel" role="dialog" aria-label="HA sync" style="left:${p.x}px;top:${p.y}px">
    <div class="fpanel-head" @pointerdown=${ed.haSyncHead.down} @pointermove=${ed.haSyncHead.move} @pointerup=${ed.haSyncHead.up} @pointercancel=${ed.haSyncHead.up}>
      <button class="btn keep" id="haSyncClose" aria-label="Close" @click=${() => toggleHaSync(ed)}>&times;</button>
      <span>Check HA sync${rep.total ? ` (${rep.total})` : ""}</span>
    </div>
    ${!ha ? html`<p id="haSyncNone">Connect Home Assistant to compare entities, areas and floors.</p>` : rep.total === 0 ? html`<p id="haSyncOk">The plan and Home Assistant agree.</p>` : html`<div class="rows">
      ${rep.orphans.length ? html`<span class="grp">Missing entities (${rep.orphans.length})</span>${rep.orphans.map((o) => {
        const key = `${o.floorKey}:${o.kind}:${o.index}:${o.field}:${o.entityId}`;
        const candidates = ha.entities.filter((e) => e.domain === o.domain);
        const picked = ed.haSyncPick[key] ?? o.suggested ?? candidates[0]?.id ?? "";
        return html`<div class="sync-row" data-orphan=${o.entityId}>
          <div class="sync-info"><strong>${o.label}</strong> <code>${o.entityId}</code></div>
          <div class="sync-acts">
            ${o.suggested ? html`<button class="btn keep" data-sync="suggest" @click=${() => syncReplaceEntity(ed, o.entityId, o.suggested!)}>Use ${o.suggested}</button>` : nothing}
            ${candidates.length ? html`<select aria-label="Replacement entity" .value=${picked} @change=${(e: Event) => { ed.haSyncPick = { ...ed.haSyncPick, [key]: (e.target as HTMLSelectElement).value }; ed.requestUpdate(); }}>
              ${candidates.map((c) => html`<option value=${c.id}>${c.name ? `${c.name} (${c.id})` : c.id}</option>`)}
            </select><button class="btn keep" data-sync="replace" @click=${() => syncReplaceEntity(ed, o.entityId, picked)}>Replace</button>` : nothing}
            <button class="btn keep danger" data-sync="remove" @click=${() => syncRemoveOrphan(ed, o)}>Remove</button>
          </div>
        </div>`;
      })}` : nothing}
      ${rep.areas.length ? html`<span class="grp">Areas (${rep.areas.length})</span>${rep.areas.map((a) => html`<div class="sync-row" data-area-issue=${a.kind}>
        <div class="sync-info"><strong>${a.kind === "room-no-area" ? a.roomName : a.deviceName ?? a.entityId}</strong> <span>${a.kind === "room-no-area" ? `${a.floorTitle} · no HA area` : `in ${a.roomName}, HA has another area`}</span></div>
        <div class="sync-acts">
          ${a.kind === "room-no-area" && a.matchArea ? html`<button class="btn keep" data-sync="link-area" @click=${() => syncLinkArea(ed, a)}>Link ${a.matchArea.name}</button>` : nothing}
          ${a.kind === "room-no-area" && !a.matchArea && ed.writer ? html`<button class="btn keep" data-sync="create-area" @click=${() => void syncCreateArea(ed, a)}>Create area in HA</button>` : nothing}
          ${a.kind === "device-area-diff" && ed.writer ? html`<button class="btn keep" data-sync="move-area" @click=${() => void syncMoveDeviceArea(ed, a)}>Move to ${a.targetArea?.name}</button>` : nothing}
        </div>
      </div>`)}` : nothing}
      ${rep.floors.length ? html`<span class="grp">Floors (${rep.floors.length})</span>${rep.floors.map((fl) => html`<div class="sync-row" data-floor-issue=${fl.kind}>
        <div class="sync-info"><strong>${fl.kind === "assign-area-floor" ? fl.area?.name : fl.floorTitle}</strong> <span>${fl.kind === "create-floor" ? "not in HA" : fl.kind === "link-floor" ? `matches HA floor ${fl.haFloor?.name}` : `assign to HA floor ${fl.haFloor?.name}`}</span></div>
        <div class="sync-acts">
          ${fl.kind === "create-floor" && ed.writer ? html`<button class="btn keep" data-sync="create-floor" @click=${() => void syncCreateFloor(ed, fl)}>Create floor in HA</button>` : nothing}
          ${fl.kind === "link-floor" ? html`<button class="btn keep" data-sync="link-floor" @click=${() => syncLinkFloor(ed, fl)}>Link ${fl.haFloor?.name}</button>` : nothing}
          ${fl.kind === "assign-area-floor" && ed.writer ? html`<button class="btn keep" data-sync="assign-floor" @click=${() => void syncAssignAreaFloor(ed, fl)}>Assign floor</button>` : nothing}
        </div>
      </div>`)}` : nothing}
    </div>`}
  </div>`;
}

/** S47: floating, draggable Attention panel listing current Attention items with Notify automation creation. */
export function attentionView(ed: FloorplanStudioEditor) {
  const p = ed.attentionPos!;
  const reg = ed.st.ha ? Object.fromEntries(ed.st.ha.entities.filter((e) => e.dev).map((e) => [e.id, { device_id: e.dev! }])) : undefined;
  const a = attention(ed.st.layout, ed.hassState, reg);
  return html`<div class="fpanel ha-panel" id="attentionPanel" role="dialog" aria-label="Attention" style="left:${p.x}px;top:${p.y}px">
    <div class="fpanel-head" @pointerdown=${ed.attentionHead.down} @pointermove=${ed.attentionHead.move} @pointerup=${ed.attentionHead.up} @pointercancel=${ed.attentionHead.up}>
      <button class="btn keep" id="attentionClose" aria-label="Close" @click=${() => toggleAttention(ed)}>&times;</button>
      <span>Attention${a.items.length ? ` (${a.items.length})` : ""}</span>
    </div>
    ${!ed.hassState ? html`<p id="attentionNone">Connect Home Assistant or live states to view Attention items.</p>` : a.items.length === 0 ? html`<p id="attentionOk">Nothing needs attention right now.</p>` : html`<div class="rows">
      ${a.items.map((it) => html`<div class="sync-row" data-attn-entity=${it.entity}>
        <div class="sync-info"><strong>${it.name}</strong> <span>${it.kind}${it.room ? ` · ${it.room}` : ""} (${it.state})</span></div>
        <div class="sync-acts">
          ${ed.writer ? html`<button class="btn keep" data-attn-notify=${it.entity} @click=${() => void notifyAutomation(ed, it)}>Notify…</button>` : nothing}
        </div>
      </div>`)}
    </div>`}
  </div>`;
}

/** File, Install code: a fixed, centred panel with the card config YAML that reproduces the current plan
 * (`installCodeYaml`), ready to paste into a dashboard. Read-only and selected on focus so a click and Ctrl/Cmd+C
 * copies it without a native clipboard permission; Copy does the same in one click where `navigator.clipboard`
 * is available. Escape is handled on the textarea itself, not only by `onKey`, since `onKey` ignores keys typed
 * into a TEXTAREA (so as not to steal Delete/Backspace from someone editing a field) and focus sits in this one
 * the moment it opens. */
export function installCodeView(ed: FloorplanStudioEditor) {
  const code = installCodeYaml(ed), strategy = strategyYaml();
  // S8.10 follow-up (Opus review): same fixed-90px overlap as the draggable panels (see panelTop's own comment),
  // just with a static CSS top instead of a JS position — cleared here with an inline style, which wins over the
  // class's own top:90px.
  return html`<div class="installcode-panel" role="dialog" aria-label="Install code" style="top:${panelTop(ed)}px">
    <div class="installcode-head"><span>Install this card</span>
      <button class="btn keep" id="installcodeClose" aria-label="Close" @click=${() => toggleInstallCode(ed)}>&times;</button>
    </div>
    <p>A whole dashboard, matching what you're editing now — nothing else to install. Settings → Dashboards → Add dashboard → New dashboard from scratch, then its ⋮ menu, Edit in YAML, paste this over what's there. Or paste just the <code>cards:</code> entry into an existing dashboard.</p>
    <textarea id="installcodeText" readonly rows="12" @focus=${(e: Event) => (e.target as HTMLTextAreaElement).select()} @keydown=${(e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); toggleInstallCode(ed); } }}>${code}</textarea>
    <button class="btn keep" id="installcodeCopy" @click=${() => copyInstallCode(ed, code)}>Copy</button>
    <p><strong>Or as a strategy.</strong> The same dashboard, built by Home Assistant each time it loads, so a floor you add here shows up without pasting again. Paste this instead (Edit in YAML). Options for every card go under <code>card:</code>, for example <code>card: {theme: slate}</code>.</p>
    <textarea id="installcodeStrategy" readonly rows="3" style="flex-shrink:0" @focus=${(e: Event) => (e.target as HTMLTextAreaElement).select()} @keydown=${(e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); toggleInstallCode(ed); } }}>${strategy}</textarea>
    <button class="btn keep" id="installcodeStrategyCopy" @click=${() => copyInstallCode(ed, strategy)}>Copy</button>
  </div>`;
}
