import { describe, it, expect } from "vitest";
import { render } from "lit";
import demo from "../../demo/layout.json";
import { ROOM_KINDS, type Layout } from "../../src/core/schema";
import { EditorState } from "../../src/editor/state";
import { selectionPanel, type PanelCtx } from "../../src/editor/panels";

const fresh = () => structuredClone(demo) as unknown as Layout;

/** A PanelCtx whose callbacks are all no-ops except the ones a test overrides; every panel function reads only
 *  a handful of these for a given selection, but the type requires them all. */
function baseCtx(st: EditorState): PanelCtx {
  return {
    st,
    commit: () => {},
    attachEntity: () => {},
    attachToRoom: () => {},
    select: () => {},
    paint: () => {},
    rotateTexture: () => {},
    scaleTexture: () => {},
    drawArea: () => {},
    placeArea: () => {},
    moreInfo: () => {},
    say: () => {},
    refresh: () => {},
    help: () => {},
    floors: { rename: () => {}, move: () => {}, remove: () => {} },
  };
}

describe("devicePanel Links heading (Opus review of S8.9)", () => {
  // areaDiffField (panels.ts) renders nothing unless c.moveArea is also given, so a Links heading gated on
  // areaDiff alone could show over an empty section. devIndex 2 is "switch.demo_hall", not a light, so the
  // heading's only source is the areaDiff/moveArea pair.
  const switchIndex = 2;

  it("hides Links when areaDiff is set but moveArea is absent", () => {
    const st = new EditorState(fresh());
    st.sel = { t: "dev", i: switchIndex };
    const ctx = { ...baseCtx(st), areaDiff: () => ({ name: "Kitchen" }) }; // moveArea omitted on purpose
    const div = document.createElement("div");
    render(selectionPanel(ctx), div);
    expect(div.querySelectorAll("h4.pnl-h").length ? [...div.querySelectorAll("h4.pnl-h")].map((h) => h.textContent) : []).not.toContain("Links");
  });

  it("shows Links when both areaDiff and moveArea are given", () => {
    const st = new EditorState(fresh());
    st.sel = { t: "dev", i: switchIndex };
    const ctx = { ...baseCtx(st), areaDiff: () => ({ name: "Kitchen" }), moveArea: () => {} };
    const div = document.createElement("div");
    render(selectionPanel(ctx), div);
    const headings = [...div.querySelectorAll("h4.pnl-h")].map((h) => h.textContent);
    expect(headings).toContain("Links");
  });
});

describe("room Sensors section follows roomAt's rule (Opus review of Sprint 11, finding 2)", () => {
  it("shows the three pickers for exactly the kinds that can own a point, one test per RoomKind", () => {
    const owns: Record<string, boolean> = { room: true, garden: true, pavement: true, terrace: true, water: true, fill: false, structure: false, zone: false };
    for (const kind of ROOM_KINDS) {
      const st = new EditorState(fresh());
      st.edit((f) => { f.rooms[0].kind = kind; });
      st.sel = { t: "room", i: 0 };
      const div = document.createElement("div");
      render(selectionPanel(baseCtx(st)), div);
      const headings = [...div.querySelectorAll("h4.pnl-h")].map((h) => h.textContent);
      expect(headings.includes("Sensors"), kind).toBe(owns[kind]);
    }
  });
});
