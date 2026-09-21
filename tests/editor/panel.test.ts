import { describe, expect, it, vi } from "vitest";
import demo from "../../demo/layout.json";
import type { Layout } from "../../src/core/schema";
import { FloorplanStudioPanel } from "../../src/editor/panel";
import type { FloorplanStudioEditor } from "../../src/editor/editor-app";

// S3.2: the panel is the editor plus two websocket calls. Each test drives it through a stub `hass`, the same
// object Home Assistant hands a panel, and reads what the editor and the socket saw.
const L = demo as unknown as Layout;

function stubHass(ws: (msg: { type: string; layout?: unknown }) => unknown, darkMode = false) {
  return { callWS: vi.fn(async (msg) => ws(msg)), themes: { darkMode }, states: {} };
}
async function mount(hass: ReturnType<typeof stubHass>) {
  const el = new FloorplanStudioPanel();
  document.body.appendChild(el);
  el.hass = hass as never;
  await settle(el);
  return el;
}
const settle = async (el: FloorplanStudioPanel) => { for (let i = 0; i < 4; i++) { await el.updateComplete; await new Promise((r) => setTimeout(r, 0)); } };
const editorOf = (el: FloorplanStudioPanel) => el.shadowRoot!.querySelector("floorplan-studio-editor") as FloorplanStudioEditor | null;

describe("<floorplan-studio-panel>", () => {
  it("asks Home Assistant for the saved layout once, and the editor shows it", async () => {
    const hass = stubHass(() => ({ layout: L }));
    const el = await mount(hass);
    el.hass = { ...hass } as never; // HA sets hass on every state change
    await settle(el);
    expect(hass.callWS.mock.calls.filter(([m]) => m.type === "floorplan_studio/load")).toHaveLength(1);
    expect(editorOf(el)!.layout.floors.ground.rooms.length).toBe(L.floors.ground.rooms.length);
  });

  it("with nothing saved yet, the editor opens on an empty layout and no error", async () => {
    const el = await mount(stubHass(() => ({ layout: null })));
    expect(el.shadowRoot!.textContent).not.toMatch(/could not|error/i);
    expect((editorOf(el) as unknown as { errors: string[] }).errors).toEqual([]); // the editor's own refusal list, not just the panel's text
    expect(editorOf(el)!.layout.version).toBe(2);
    expect(Object.keys(editorOf(el)!.layout.floors).length).toBeGreaterThan(0);
  });

  it("Save sends the layout to Home Assistant and tells the editor it is saved", async () => {
    const hass = stubHass((m) => (m.type === "floorplan_studio/load" ? { layout: L } : { ok: true }));
    const el = await mount(hass);
    const ed = editorOf(el)!;
    const done = vi.spyOn(ed, "saveDone");
    ed.dispatchEvent(new CustomEvent("save-request", { detail: L }));
    await settle(el);
    expect(hass.callWS).toHaveBeenCalledWith({ type: "floorplan_studio/save", layout: L });
    expect(done).toHaveBeenCalledWith(true, expect.any(String));
  });

  it("a refused save says why, and does not claim it saved", async () => {
    const el = await mount(stubHass((m) => { if (m.type === "floorplan_studio/save") throw { code: "unauthorized", message: "Unauthorized" }; return { layout: L }; }));
    const ed = editorOf(el)!;
    const done = vi.spyOn(ed, "saveDone");
    ed.dispatchEvent(new CustomEvent("save-request", { detail: L }));
    await settle(el);
    expect(done).toHaveBeenCalledWith(false, expect.stringContaining("Unauthorized"));
  });

  it("if the load fails, the panel says so and offers Retry instead of an editor that would overwrite the saved plan", async () => {
    let fail = true;
    const hass = stubHass(() => { if (fail) throw { code: "not_loaded", message: "Floorplan Studio is not set up." }; return { layout: L }; });
    const el = await mount(hass);
    expect(editorOf(el)).toBeNull();
    expect(el.shadowRoot!.textContent).toContain("Floorplan Studio is not set up.");
    fail = false;
    (el.shadowRoot!.querySelector("button") as HTMLButtonElement).click();
    await settle(el);
    expect(editorOf(el)).not.toBeNull();
  });

  it("the editor is given the demo home, so File, Load demo works on an empty plan", async () => {
    const el = await mount(stubHass(() => ({ layout: null })));
    expect(editorOf(el)!.demo?.floors.ground.rooms.length).toBe(L.floors.ground.rooms.length);
  });

  it("the editor follows Home Assistant's dark mode", async () => {
    const hass = stubHass(() => ({ layout: L }), true);
    const el = await mount(hass);
    expect(editorOf(el)!.haDark).toBe(true);
    el.hass = { ...hass, themes: { darkMode: false } } as never;
    await settle(el);
    expect(editorOf(el)!.haDark).toBe(false);
  });
});
