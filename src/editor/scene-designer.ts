import { html, nothing } from "lit";
import { SCENE_FIELDS } from "../core";
import type { SceneItem } from "../core";
import { live } from "./live-keep";
import { hexToHs, hsToHex } from "./scene-colour";

// S17.3: the scene designer popup (docs/specs/scene-designer.md). A draft lives in the editor host while the popup is open; nothing
// reaches the layout until Save, which is one `commit` (`saveScene`), so Cancel changes nothing and Save is one undo step.

export interface SceneDraft {
  room: string;            // room id
  id: string | null;       // the scene being edited, null for a new one
  name: string;
  items: Map<string, SceneItem>; // the devices ticked in, by entity
  error: string;
}
export interface DesignerDeps {
  draft: SceneDraft;
  pos: { x: number; y: number };
  head: { down: (e: PointerEvent) => void; move: (e: PointerEvent) => void; up: () => void };
  roomName: string;
  targets: { entity: string; name: string }[];
  refresh: () => void;
  close: () => void;
  save: () => void;
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
  return html`<div class="fpanel scene-panel" id="scenePanel" role="dialog" aria-label="Scene designer" style="left:${p.x}px;top:${p.y}px" @keydown=${esc}>
    <div class="fpanel-head" @pointerdown=${d.head.down} @pointermove=${d.head.move} @pointerup=${d.head.up} @pointercancel=${d.head.up}>
      <button class="btn keep" id="sceneClose" aria-label="Close" @click=${() => d.close()}>&times;</button>
      <span>${draft.id ? "Edit scene" : "New scene"} in ${d.roomName}</span>
    </div>
    <p><label for="sceneName">name</label> <input id="sceneName" type="text" maxlength="60" .value=${live(draft.name)} @input=${(e: Event) => { draft.name = (e.target as HTMLInputElement).value; }}></p>
    <p>Tick the devices this scene sets, then say what each one does.</p>
    <div class="rows">${rows.length ? rows.map(row) : html`<p>No light, switch, fan, cover, climate or media player is placed in this room.</p>`}</div>
    ${draft.error ? html`<p class="warn-text" id="sceneError" role="alert">${draft.error}</p>` : nothing}
    <div class="sd-actions"><button class="btn primary keep" id="sceneSave" @click=${() => d.save()}>Save</button><button class="btn keep" id="sceneCancel" @click=${() => d.close()}>Cancel</button></div>
  </div>`;
}
