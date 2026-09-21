import { describe, expect, it, vi } from "vitest";
import demo from "../../demo/layout.json";
import type { Layout } from "../../src/core/schema";
import { FloorplanStudioPanel } from "../../src/editor/panel";
import type { FloorplanStudioEditor } from "../../src/editor/editor-app";

// S3.2: the panel is the editor plus two websocket calls. Each test drives it through a stub `hass`, the same
// object Home Assistant hands a panel, and reads what the editor and the socket saw.
const L = demo as unknown as Layout;

type State = { state: string; attributes: Record<string, unknown> };
function stubHass(ws: (msg: { type: string; layout?: unknown }) => unknown, darkMode = false, states: Record<string, State> = {}, install: () => unknown = () => undefined) {
  return { callWS: vi.fn(async (msg) => ws(msg)), callService: vi.fn(async () => install()), themes: { darkMode }, states };
}
// What HACS publishes for this integration: entity `update.floorplan_studio_update`, release_url on the repository.
const UPDATE = (state = "on", extra: Record<string, unknown> = {}): State => ({
  state,
  attributes: { installed_version: "0.3.0", latest_version: "0.4.0", release_url: "https://github.com/vespassassina/ha-floorplan-studio/releases/v0.4.0", in_progress: false, ...extra },
});
const banner = (el: FloorplanStudioPanel) => el.shadowRoot!.querySelector(".update") as HTMLElement | null;
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

  it("a state update from Home Assistant leaves the editor as the person left it: zoom, edits and undo survive", async () => {
    // HA sets `hass` on every state change, several times a second. Lit re-sets an object property on every render, so the
    // panel handing the stored layout down again would read as a fresh load: zoom reset, selection gone, edits reverted.
    const hass = stubHass(() => ({ layout: L }));
    const el = await mount(hass);
    const st = (editorOf(el) as unknown as { st: { views: Record<string, unknown>; floor: string; edit(fn: (f: { title?: string }) => void): boolean; layout: Layout; hist: unknown[] } }).st;
    st.views[st.floor] = { x: 1, y: 2, w: 300, h: 200 };
    st.edit((f) => { f.title = "Edited by hand"; });
    const undo = st.hist.length;
    for (let i = 0; i < 3; i++) { el.hass = { ...hass, states: { "sensor.x": { state: String(i), attributes: {} } } } as never; await settle(el); }
    expect(st.views[st.floor]).toEqual({ x: 1, y: 2, w: 300, h: 200 });
    expect(editorOf(el)!.layout.floors[st.floor].title).toBe("Edited by hand");
    expect(st.hist.length).toBe(undo);
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

  describe("update banner", () => {
    const withUpdate = (states: Record<string, State>, install?: () => unknown) => stubHass(() => ({ layout: L }), false, states, install);

    it("shows nothing when HACS reports no update, or no entity exists (installed by hand)", async () => {
      expect(banner(await mount(withUpdate({})))).toBeNull();
      expect(banner(await mount(withUpdate({ "update.floorplan_studio_update": UPDATE("off") })))).toBeNull();
    });

    it("says which version is available, and offers Update and the release notes", async () => {
      const el = await mount(withUpdate({ "update.floorplan_studio_update": UPDATE() }));
      expect(banner(el)!.textContent).toContain("0.4.0");
      expect(banner(el)!.textContent).toContain("0.3.0");
      expect(banner(el)!.querySelector("a")!.getAttribute("href")).toContain("releases/v0.4.0");
      expect(banner(el)!.querySelector("button")).not.toBeNull();
    });

    it("finds the entity by its release URL when it was renamed, and ignores other integrations' updates", async () => {
      const el = await mount(withUpdate({
        "update.home_assistant_core_update": { state: "on", attributes: { installed_version: "1", latest_version: "2", release_url: "https://github.com/home-assistant/core/releases/2" } },
        "update.my_renamed_thing": UPDATE(),
      }));
      expect(banner(el)!.textContent).toContain("0.4.0");
      const other = await mount(withUpdate({ "update.home_assistant_core_update": { state: "on", attributes: { installed_version: "1", latest_version: "2", release_url: "https://github.com/home-assistant/core/releases/2" } } }));
      expect(banner(other)).toBeNull();
    });

    it("Update calls HACS's install on that entity, then says to restart", async () => {
      const hass = withUpdate({ "update.floorplan_studio_update": UPDATE() });
      const el = await mount(hass);
      (banner(el)!.querySelector("button") as HTMLButtonElement).click();
      await settle(el);
      expect(hass.callService).toHaveBeenCalledWith("update", "install", { entity_id: "update.floorplan_studio_update" });
      expect(banner(el)!.textContent).toMatch(/restart/i);
      expect(banner(el)!.querySelector("button")).toBeNull(); // no second install
    });

    it("a failed install says why and keeps the button", async () => {
      const el = await mount(withUpdate({ "update.floorplan_studio_update": UPDATE() }, () => { throw { message: "Download failed" }; }));
      (banner(el)!.querySelector("button") as HTMLButtonElement).click();
      await settle(el);
      expect(banner(el)!.textContent).toContain("Download failed");
      expect(banner(el)!.querySelector("button")).not.toBeNull();
    });

    it("while HACS is installing, the button is off", async () => {
      const el = await mount(withUpdate({ "update.floorplan_studio_update": UPDATE("on", { in_progress: true }) }));
      expect((banner(el)!.querySelector("button") as HTMLButtonElement).disabled).toBe(true);
    });

    it("the editor is still there under the banner", async () => {
      const el = await mount(withUpdate({ "update.floorplan_studio_update": UPDATE() }));
      expect(editorOf(el)).not.toBeNull();
    });
  });
});
