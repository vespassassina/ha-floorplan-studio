import { html, nothing } from "lit";
import { unsafeSVG } from "lit/directives/unsafe-svg.js";
import { customCalls, renderFloor, type Floor, type Layout, type RoomScene, type SceneItem, type StateOverlay, type Theme } from "../core";
import { live } from "./live-keep";
import { readImageColours } from "./image-colours";
import { DEFAULT_SCENE_PALETTE, sceneEditorView, sceneTargets, type DynamicStep, type SceneEditorDraft } from "../card/scene";

// S17.3 / S50: Studio host wrapper around the shared WYSIWYG scene editor (`src/card/scene/index.ts`).
// One editor, two hosts: card and Studio share the exact same preview, controls, palette and HA scene writer.

export interface SceneDraft {
  room: string;            // room id
  id: string | null;       // the custom scene being edited, null for a new one
  name: string;
  items: Map<string, SceneItem>; // the devices ticked in, by entity
  selected: string | null;
  error: string;
  palette: string[];       // S17.5: the colours to deal out, 2 to 6
  note: string;            // what the last Apply / Capture did
  trying: string;          // what the last Try or Restore did
  migrating: boolean;
  mode?: "static" | "dynamic";
  steps?: DynamicStep[];
  activeStep?: number;
  loop?: boolean;
}
export const DEFAULT_PALETTE = [...DEFAULT_SCENE_PALETTE];
export const newDraft = (room: string, id: string | null, name: string, items: SceneItem[]): SceneDraft => ({
  room, id, name,
  items: new Map(items.map((it) => [it.entity, structuredClone(it)])),
  selected: items[0]?.entity ?? null,
  error: "",
  palette: [...DEFAULT_SCENE_PALETTE],
  note: "",
  trying: "",
  migrating: false,
});

export interface DesignerDeps {
  floor: Floor;
  roomIndex: number;
  draft: SceneDraft;
  pos: { x: number; y: number };
  head: { down: (e: PointerEvent) => void; move: (e: PointerEvent) => void; up: () => void };
  roomName: string;
  roomArea: string;
  targets: { entity: string; name: string }[];
  liveStates: StateOverlay;
  theme?: Theme;
  colors?: Layout["colors"];
  wallColors?: Layout["wallColors"];
  canWriteHa: boolean;
  legacyScenes: RoomScene[];
  refresh: () => void;
  close: () => void;
  save: () => void;
  capture: () => void;
  migrateLegacy?: () => void;
  /** S17.7: present only with a writer. `hasBackup` is true after a Try that Restore has not yet undone. */
  preview?: { hasBackup: boolean; busy: boolean; run: () => void; restore: () => void };
}

export function sceneDesigner(d: DesignerDeps) {
  const fullTargets = sceneTargets(d.floor, d.roomIndex);
  const byEnt = new Map(fullTargets.map((t) => [t.entity, t]));
  const targets = d.targets.map((t) => byEnt.get(t.entity) ?? { entity: t.entity, name: t.name, domain: t.entity.split(".")[0] ?? "" });
  const sharedDraft: SceneEditorDraft = {
    roomId: d.draft.room,
    roomIndex: d.roomIndex,
    id: d.draft.id,
    haSceneId: null,
    get name() { return d.draft.name; },
    set name(v: string) { d.draft.name = v; },
    get items() { return d.draft.items; },
    set items(v: Map<string, SceneItem>) { d.draft.items = v; },
    get selected() { return d.draft.selected; },
    set selected(v: string | null) { d.draft.selected = v; },
    palette: d.draft.palette,
    get error() { return d.draft.error; },
    set error(v: string) { d.draft.error = v; },
    get note() { return d.draft.note; },
    set note(v: string) { d.draft.note = v; },
    get trying() { return d.draft.trying; },
    set trying(v: string) { d.draft.trying = v; },
    busy: d.preview?.busy ?? false,
    get migrating() { return d.draft.migrating; },
    set migrating(v: boolean) { d.draft.migrating = v; },
    backup: d.preview?.hasBackup ? [{ entity: "light._", on: true }] : [],
    origin: [],
    get mode() { return d.draft.mode; },
    set mode(v: "static" | "dynamic" | undefined) { d.draft.mode = v; },
    get steps() { return d.draft.steps; },
    set steps(v: DynamicStep[] | undefined) { d.draft.steps = v; },
    get activeStep() { return d.draft.activeStep; },
    set activeStep(v: number | undefined) { d.draft.activeStep = v; },
    get loop() { return d.draft.loop; },
    set loop(v: boolean | undefined) { d.draft.loop = v; },
  };
  return sceneEditorView(
    { html, nothing, svgBody: unsafeSVG, renderFloor, customCalls, live, readImageColours },
    {
      host: "studio",
      floor: d.floor,
      roomIndex: d.roomIndex,
      roomName: d.roomName,
      roomArea: d.roomArea,
      draft: sharedDraft,
      targets,
      liveStates: d.liveStates,
      theme: d.theme,
      colors: d.colors,
      wallColors: d.wallColors,
      pos: d.pos,
      head: d.head,
      canWriteHa: d.canWriteHa && d.draft.id === null,
      canSaveLocal: true,
      canTry: !!d.preview,
      legacyScenes: d.legacyScenes,
      refresh: d.refresh,
      close: d.close,
      save: d.save,
      tryRun: () => d.preview?.run(),
      tryRestore: () => d.preview?.restore(),
      capture: d.capture,
      migrateLegacy: d.migrateLegacy,
    },
  );
}
