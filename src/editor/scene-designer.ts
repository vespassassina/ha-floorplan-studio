import { html, nothing } from "lit";
import { SCENE_FIELDS } from "../core";
import type { SceneItem } from "../core";
import { live } from "./live-keep";
import { readImageColours } from "./image-colours";
import { MAX_PALETTE, hexToHs, hsToHex, spreadColours } from "./scene-colour";

// S17.3: the scene designer popup (docs/specs/scene-designer.md). A draft lives in the editor host while the popup is open; nothing
// reaches the layout until Save, which is one `commit` (`saveScene`), so Cancel changes nothing and Save is one undo step.

export interface SceneDraft {
  room: string;            // room id
  id: string | null;       // the scene being edited, null for a new one
  name: string;
  items: Map<string, SceneItem>; // the devices ticked in, by entity
  error: string;
  palette: string[];       // S17.5: the colours to deal out, 2 to 6
  note: string;            // what the last Apply did
  trying: string;          // what the last Try or Restore did
}
export const DEFAULT_PALETTE = ["#ff8a3d", "#ffd23d", "#3d7bff"];
export const newDraft = (room: string, id: string | null, name: string, items: SceneItem[]): SceneDraft =>
  ({ room, id, name, items: new Map(items.map((it) => [it.entity, structuredClone(it)])), error: "", palette: [...DEFAULT_PALETTE], note: "", trying: "" });
export interface DesignerDeps {
  draft: SceneDraft;
  pos: { x: number; y: number };
  head: { down: (e: PointerEvent) => void; move: (e: PointerEvent) => void; up: () => void };
  roomName: string;
  targets: { entity: string; name: string }[];
  refresh: () => void;
  close: () => void;
  save: () => void;
  /** S17.7: present only with a writer. `hasBackup` is true after a Try that Restore has not yet undone. */
  preview?: { hasBackup: boolean; busy: boolean; run: () => void; restore: () => void };
}

const LABEL: Record<string, string> = { brightness: "brightness %", kelvin: "kelvin", percentage: "speed %", position: "position %", temperature: "temp °C", volume: "volume %", hvac: "mode", source: "source" };
const NUMERIC = new Set(["brightness", "kelvin", "percentage", "position", "temperature", "volume"]);
const STEP: Record<string, string> = { temperature: "0.5" };

export function sceneDesigner(d: DesignerDeps) {
  const { draft, pos: p } = d;
  const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); d.close(); } };
  const known = new Set(d.targets.map((t) => t.entity));
  // A device the scene already names but the room no longer shows stays listed, so Save does not silently drop it.
  const rows = [...d.targets, ...[...draft.items.keys()].filter((e) => !known.has(e)).map((e) => ({ entity: e, name: e }))];
  const setItem = (entity: string, fn: (it: SceneItem) => void) => { const it = draft.items.get(entity); if (it) { fn(it); d.refresh(); } };
  const field = (it: SceneItem, f: string, j: number) => {
    const rec = it as unknown as Record<string, unknown>;
    if (f === "hs") {
      const hs = it.hs;
      return html`<input type="color" id=${`sd-col-${j}`} aria-label="colour" .value=${live(hs ? hsToHex(hs[0], hs[1]) : "#ffffff")} @input=${(e: Event) => { const v = hexToHs((e.target as HTMLInputElement).value); if (v) setItem(it.entity, (x) => { x.hs = v; delete x.kelvin; }); }}>`;
    }
    if (NUMERIC.has(f)) {
      const cur = rec[f];
      return html`<input type="number" id=${`sd-${f}-${j}`} step=${STEP[f] ?? "1"} placeholder=${LABEL[f]} aria-label=${LABEL[f]} .value=${live(typeof cur === "number" ? String(cur) : "")} @change=${(e: Event) => {
        const raw = (e.target as HTMLInputElement).value.trim(), n = Number(raw);
        setItem(it.entity, (x) => { const r = x as unknown as Record<string, unknown>; if (raw === "" || !Number.isFinite(n)) delete r[f]; else { r[f] = n; if (f === "kelvin") delete x.hs; } });
      }}>`;
    }
    return html`<input type="text" id=${`sd-${f}-${j}`} placeholder=${LABEL[f]} aria-label=${LABEL[f]} .value=${live(typeof rec[f] === "string" ? (rec[f] as string) : "")} @change=${(e: Event) => { const v = (e.target as HTMLInputElement).value; setItem(it.entity, (x) => { const r = x as unknown as Record<string, unknown>; if (v.trim()) r[f] = v; else delete r[f]; }); }}>`;
  };
  const row = (t: { entity: string; name: string }, j: number) => {
    const it = draft.items.get(t.entity);
    const domain = t.entity.split(".")[0] as keyof typeof SCENE_FIELDS;
    return html`<div class="sd-row" data-sdev=${t.entity}>
      <label class="sd-dev"><input type="checkbox" id=${`sd-inc-${j}`} .checked=${live(!!it)} @change=${(e: Event) => { if ((e.target as HTMLInputElement).checked) draft.items.set(t.entity, { entity: t.entity, on: true }); else draft.items.delete(t.entity); d.refresh(); }}><span class="prow-name" title=${t.entity}>${t.name}</span></label>
      ${it ? html`<select id=${`sd-on-${j}`} aria-label=${`${t.name} state`} .value=${live(it.on ? "on" : "off")} @change=${(e: Event) => setItem(t.entity, (x) => { x.on = (e.target as HTMLSelectElement).value === "on"; })}><option value="on">On</option><option value="off">Off</option></select>
        ${it.on ? (SCENE_FIELDS[domain] ?? []).map((f) => field(it, f, j)) : nothing}` : nothing}
    </div>`;
  };
  // S17.5: the palette goes to the ticked lights that are on, in the order the room lists them; a light holds a colour or a kelvin, so kelvin goes.
  const apply = () => {
    const lights = rows.filter((t) => t.entity.startsWith("light.") && draft.items.get(t.entity)?.on);
    const cols = spreadColours(draft.palette, lights.length);
    if (!cols.length) { draft.note = "Tick at least one light that is on."; d.refresh(); return; }
    lights.forEach((t, j) => { const it = draft.items.get(t.entity)!; it.hs = cols[j]; delete it.kelvin; });
    draft.note = `Gave ${lights.length} light${lights.length === 1 ? "" : "s"} a colour from the palette.`;
    d.refresh();
  };
  // S17.6: a picture fills the palette (a file that is not a picture is refused in words); Apply then deals it out like any palette.
  const fromPicture = async (e: Event) => {
    const input = e.target as HTMLInputElement, file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      const cols = await readImageColours(file, MAX_PALETTE);
      draft.palette.splice(0, draft.palette.length, ...cols);
      draft.note = `Took ${cols.length} colour${cols.length === 1 ? "" : "s"} from ${file.name}. Press Apply to lights.`;
    } catch (err) { draft.note = err instanceof Error ? err.message : "That picture could not be read."; }
    d.refresh();
  };
  const pal = draft.palette;
  const palette = html`<div class="sd-palette" id="scenePalette"><span>palette</span>
    ${pal.map((c, k) => html`<input type="color" id=${`sp-col-${k}`} aria-label=${`palette colour ${k + 1}`} .value=${live(c)} @input=${(e: Event) => { const v = (e.target as HTMLInputElement).value; if (hexToHs(v)) { pal[k] = v; } }}>
      ${pal.length > 2 ? html`<button class="btn keep" id=${`sp-rm-${k}`} aria-label=${`Remove palette colour ${k + 1}`} @click=${() => { pal.splice(k, 1); d.refresh(); }}>&times;</button>` : nothing}`)}
    ${pal.length < MAX_PALETTE ? html`<button class="btn keep" id="sp-add" @click=${() => { pal.push("#ffffff"); d.refresh(); }}>+</button>` : nothing}
    <label class="btn keep" for="sp-image">Colours from a picture</label><input type="file" id="sp-image" accept="image/*" hidden @change=${fromPicture}>
    <button class="btn keep" id="sp-apply" @click=${apply}>Apply to lights</button>
    ${draft.note ? html`<span id="paletteNote" role="status">${draft.note}</span>` : nothing}
  </div>`;
  return html`<div class="fpanel scene-panel" id="scenePanel" role="dialog" aria-label="Scene designer" style="left:${p.x}px;top:${p.y}px" @keydown=${esc}>
    <div class="fpanel-head" @pointerdown=${d.head.down} @pointermove=${d.head.move} @pointerup=${d.head.up} @pointercancel=${d.head.up}>
      <button class="btn keep" id="sceneClose" aria-label="Close" @click=${() => d.close()}>&times;</button>
      <span>${draft.id ? "Edit scene" : "New scene"} in ${d.roomName}</span>
    </div>
    <p><label for="sceneName">name</label> <input id="sceneName" type="text" maxlength="60" .value=${live(draft.name)} @input=${(e: Event) => { draft.name = (e.target as HTMLInputElement).value; }}></p>
    <p>Tick the devices this scene sets, then say what each one does.</p>
    ${palette}
    <div class="rows">${rows.length ? rows.map(row) : html`<p>No light, switch, fan, cover, climate or media player is placed in this room.</p>`}</div>
    ${draft.error ? html`<p class="warn-text" id="sceneError" role="alert">${draft.error}</p>` : nothing}
    <div class="sd-try">${d.preview
      ? html`<button class="btn keep" id="sceneTry" ?disabled=${d.preview.busy} title="Sends this scene to the real devices now. Restore puts them back." @click=${d.preview.run}>Try it</button>
        <button class="btn keep" id="sceneRestore" ?disabled=${d.preview.busy || !d.preview.hasBackup} @click=${d.preview.restore}>Restore</button>`
      : html`<button class="btn keep" id="sceneTry" disabled>Try it</button><button class="btn keep" id="sceneRestore" disabled>Restore</button><span id="tryNeeds">Trying a scene needs the studio connected to Home Assistant with write access.</span>`}
      ${draft.trying ? html`<span id="tryNote" role="status">${draft.trying}</span>` : nothing}</div>
    <div class="sd-actions"><button class="btn primary keep" id="sceneSave" @click=${() => d.save()}>Save</button><button class="btn keep" id="sceneCancel" @click=${() => d.close()}>Cancel</button></div>
  </div>`;
}
