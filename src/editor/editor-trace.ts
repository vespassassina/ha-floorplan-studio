import { dist, MAX_LAYOUT_BYTES, type Pt, type Trace } from "../core";
import { stopDraw } from "./editor-draw";
import { takesTyping } from "../card/view-keys";
import { traceImage, traceRotShown, traceRotStored } from "./trace";
import { num } from "./editor-kit";
import { html, nothing } from "lit";
import { live } from "./live-keep";
import type { FloorplanStudioEditor } from "./editor-app";

// ---- S7.11: the trace image ------------------------------------------------------------------------------

export function toggleTrace(ed: FloorplanStudioEditor) {
  ed.traceOpen = !ed.traceOpen;
  ed.traceScale = null;
  ed.traceMove = false;
  ed.requestUpdate();
}

/** Changes this floor's trace: one undo step, none when nothing changed. */
export function setTrace(ed: FloorplanStudioEditor, t: Trace | null, status: string) {
  if (!t || !t.on) ed.traceMove = false; // S40.2: nothing shown, nothing to move
  if (ed.st.setTrace(t)) ed.changed(status);
  else ed.refused();
}

export function setTraceMove(ed: FloorplanStudioEditor, on: boolean) {
  ed.traceMove = on;
  if (on) { stopDraw(ed); ed.traceScale = null; }
  ed.requestUpdate();
  ed.focus({ preventScroll: true });
}

/** S40.2: the arrows move the image 1 cm, Shift 10 cm; one undo step per press. A text field keeps its keys. */
export function traceKeyDo(ed: FloorplanStudioEditor, ev: KeyboardEvent): boolean {
  if (!ed.moving || ed.draw) return false;
  if (ev.defaultPrevented || ev.isComposing || ev.ctrlKey || ev.metaKey || ev.altKey) return false;
  const dir: Record<string, Pt> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
  const d = dir[ev.key], t = ed.st.f.trace;
  if (!d || !t || takesTyping(ev.composedPath()[0] as HTMLElement | undefined)) return false;
  ev.preventDefault();
  if (ev.repeat) return true;
  const n = ev.shiftKey ? 10 : 1;
  setTrace(ed, { ...t, x: t.x + d[0] * n, y: t.y + d[1] * n }, `Image moved ${n} cm`);
  return true;
}

/** S40.2: Rotation field, degrees -180..180 (a comma works). `rot` is stored in [0, 360) about the image's top-left corner. Junk or out of range is refused and the box shows the layout again. */
export function setTraceRot(ed: FloorplanStudioEditor, ev: Event) {
  const input = ev.target as HTMLInputElement, t = ed.st.f.trace;
  if (!t) return;
  const n = Number(input.value.trim().replace(",", "."));
  if (input.value.trim() === "" || !Number.isFinite(n) || n < -180 || n > 180) {
    ed.status = "Type a rotation from -180 to 180 degrees";
    input.value = String(traceRotShown(t.rot));
    ed.requestUpdate();
    return;
  }
  setTrace(ed, { ...t, rot: traceRotStored(n) }, "Image turned");
  input.value = String(traceRotShown(ed.st.f.trace?.rot ?? 0)); // the box shows what was stored, not what was typed
}

/** Load: downscale, then place the image over the outline (or the view, on a blank floor), fitted inside it. Load again resets the placement. */
export async function loadTrace(ed: FloorplanStudioEditor, ev: Event) {
  const input = ev.target as HTMLInputElement, file = input.files?.[0];
  input.value = "";
  if (!file) return;
  const floor = ed.st.floor;
  ed.status = "Loading the image…";
  ed.requestUpdate();
  let img;
  // G19: the image may take what the save limit leaves after the rest of the plan (this floor's old trace is replaced, so it does not count), less the trace's own fields.
  const room = MAX_LAYOUT_BYTES - (JSON.stringify(ed.st.layout).length - (ed.st.f.trace?.src.length ?? 0)) - 400;
  try { img = await traceImage(file, room); } catch (e) { ed.status = (e as Error).message; ed.requestUpdate(); return; }
  if (ed.st.floor !== floor) { ed.status = "Floor changed while loading; load the image again."; ed.requestUpdate(); return; }
  const o = ed.st.f.outline, v = ed.st.view;
  const box = o.length >= 3
    ? { x: Math.min(...o.map((p) => p[0])), y: Math.min(...o.map((p) => p[1])), w: Math.max(...o.map((p) => p[0])) - Math.min(...o.map((p) => p[0])), h: Math.max(...o.map((p) => p[1])) - Math.min(...o.map((p) => p[1])) }
    : { x: v.x + v.w * 0.1, y: v.y + v.h * 0.1, w: v.w * 0.8, h: v.h * 0.8 };
  const w = Math.max(1, Math.round(Math.min(box.w || 100, (box.h || 100) * (img.w / img.h))));
  ed.traceScale = null;
  setTrace(ed, { src: img.src, x: Math.round(box.x), y: Math.round(box.y), w, rot: 0, alpha: 0.5, on: true }, "Image loaded. Scale it: click two points a known distance apart.");
  ed.focus({ preventScroll: true });
}

export function startTraceScale(ed: FloorplanStudioEditor) {
  stopDraw(ed);
  ed.traceMove = false;
  ed.traceScale = [];
  ed.status = "Click two points on the image a known distance apart. Esc cancels.";
  ed.requestUpdate();
}

export function cancelTraceScale(ed: FloorplanStudioEditor) {
  ed.traceScale = null;
  ed.status = "Scale cancelled";
  ed.requestUpdate();
  ed.focus({ preventScroll: true });
}

/** After each Scale click: the second one asks for the real distance. */
export function traceStep(ed: FloorplanStudioEditor) {
  const n = ed.traceScale?.length ?? 0;
  ed.status = n < 2 ? "Now the second point." : "Type the real distance between the two points, in cm.";
  ed.requestUpdate();
  if (n === 2) void ed.updateComplete.then(() => ed.renderRoot.querySelector<HTMLInputElement>("#traceDist")?.focus({ preventScroll: true }));
}

/** Sets `w` so the two clicked points are `real` cm apart; the aspect ratio follows, x and y stay. */
export function applyTraceScale(ed: FloorplanStudioEditor) {
  const t = ed.st.f.trace, pts = ed.traceScale;
  const real = Number(ed.renderRoot.querySelector<HTMLInputElement>("#traceDist")?.value);
  if (!t || !pts || pts.length < 2) return;
  const d = dist(pts[0], pts[1]);
  if (!(Number.isFinite(real) && real > 0)) { ed.status = "Type a distance above 0 cm."; ed.requestUpdate(); return; }
  if (!(d > 0)) { ed.status = "The two points are the same point. Click Scale again."; ed.traceScale = null; ed.requestUpdate(); return; }
  const w = Math.round(t.w * (real / d) * 100) / 100;
  ed.traceScale = null;
  if (!(Number.isFinite(w) && w > 0)) { ed.status = "That scale is out of range."; ed.requestUpdate(); return; }
  setTrace(ed, { ...t, w }, `Image scaled: ${num(w)} cm wide`);
  ed.focus({ preventScroll: true });
}

export function traceView(ed: FloorplanStudioEditor) {
  const t = ed.st.f.trace, sc = ed.traceScale;
  return html`<div class="trace-panel" id="tracePanel" role="dialog" aria-label="Trace image">
    <div class="installcode-head"><span>Trace image</span>
      <button class="btn keep" id="traceClose" aria-label="Close" @click=${() => toggleTrace(ed)}>&times;</button>
    </div>
    <input type="file" id="traceFile" accept="image/png,image/jpeg,image/webp" hidden @change=${(e: Event) => void loadTrace(ed, e)}>
    <button class="btn" id="traceLoad" title="A scan or photo of a floor plan, drawn under this floor in the editor only" @click=${() => ed.renderRoot.querySelector<HTMLInputElement>("#traceFile")?.click()}>${t ? "Replace image…" : "Load image…"}</button>
    ${t ? html`
      ${sc && sc.length === 2
        ? html`<label for="traceDist">Real distance (cm)</label>
          <div class="row"><input id="traceDist" type="number" min="1" step="1" @keydown=${(e: KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); applyTraceScale(ed); } else if (e.key === "Escape") { e.preventDefault(); cancelTraceScale(ed); } }}>
            <button class="btn" id="traceApply" @click=${() => applyTraceScale(ed)}>Apply</button></div>`
        : html`<button class="btn" id="traceScale" aria-pressed=${sc ? "true" : "false"} @click=${() => (sc ? cancelTraceScale(ed) : startTraceScale(ed))}>${sc ? `Click point ${sc.length + 1} of 2…` : "Scale…"}</button>`}
      ${t.on ? html`<button class="btn" id="traceMove" aria-pressed=${ed.moving ? "true" : "false"} title="Drag the image, or nudge it with the arrow keys (Shift: 10 cm). Esc ends it" @click=${() => setTraceMove(ed, !ed.moving)}>Move</button>` : nothing}
      ${ed.moving ? html`<p class="hint" id="traceMoveHint">Move: drag the image, arrows nudge it</p>` : nothing}
      <div class="rotrow"><label for="traceRot">Rotation (°)</label>
      <input id="traceRot" type="number" min="-180" max="180" step="0.1" .value=${live(String(traceRotShown(t.rot)))} @change=${(e: Event) => setTraceRot(ed, e)} @keydown=${(e: KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); setTraceRot(ed, e); } }}></div>
      <label for="traceAlpha">Opacity</label>
      <div class="rangerow"><input id="traceAlpha" type="range" min="0" max="1" step="0.05" .value=${live(String(t.alpha))} @change=${(e: Event) => { const a = Number((e.target as HTMLInputElement).value); if (Number.isFinite(a)) setTrace(ed, { ...t, alpha: Math.min(1, Math.max(0, a)) }, "Image opacity changed"); }}><span class="rot-val">${Math.round(t.alpha * 100)}%</span></div>
      <label><input id="traceOn" type="checkbox" .checked=${live(t.on)} @change=${(e: Event) => setTrace(ed, { ...t, on: (e.target as HTMLInputElement).checked }, (e.target as HTMLInputElement).checked ? "Image shown" : "Image hidden")}> Show</label>
      <button class="btn warn" id="traceRemove" @click=${() => { ed.traceScale = null; setTrace(ed, null, "Image removed"); }}>Remove image</button>`
      : html`<p class="hint">Load a scan, then Scale it with two points a known distance apart, and draw over it. Only the editor shows it.</p>`}
  </div>`;
}
