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
    rotateTexture: () => {}, rotateItem: () => {},
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

describe("changing a room's kind (Opus re-check of Sprint 11, D)", () => {
  /** Drives the real kind select in the panel; `commit` is the editor's own `edit`, so it is one undo step. */
  const changeKind = (st: EditorState, kind: string) => {
    st.sel = { t: "room", i: 0 };
    const div = document.createElement("div");
    render(selectionPanel({ ...baseCtx(st), commit: (fn) => { st.edit(fn); } }), div);
    const sel = div.querySelector<HTMLSelectElement>("#rk")!;
    sel.value = kind;
    sel.dispatchEvent(new Event("change"));
  };
  const withSensors = () => {
    const l = fresh();
    Object.assign(l.floors.ground.rooms[0], { temps: ["sensor.a"], humidity: ["sensor.b"], motion: ["binary_sensor.c"] });
    return new EditorState(l);
  };
  const owns: Record<string, boolean> = { room: true, garden: true, pavement: true, terrace: true, water: true, fill: false, structure: false, zone: false };
  for (const kind of ROOM_KINDS.filter((k) => k !== "room"))
    it(`to ${kind}: the sensor lists go exactly when nothing could show them, and one undo brings them back`, () => {
      const st = withSensors();
      changeKind(st, kind);
      const r = st.f.rooms[0];
      expect(r.kind).toBe(kind);
      if (owns[kind]) expect([r.temps, r.humidity, r.motion]).toEqual([["sensor.a"], ["sensor.b"], ["binary_sensor.c"]]);
      else expect([r.temps, r.humidity, r.motion]).toEqual([undefined, undefined, undefined]);
      expect(st.undo()).toBe(true);
      const back = st.f.rooms[0];
      expect([back.kind, back.temps, back.humidity, back.motion]).toEqual(["room", ["sensor.a"], ["sensor.b"], ["binary_sensor.c"]]);
      expect(st.canUndo).toBe(false);
    });
});
