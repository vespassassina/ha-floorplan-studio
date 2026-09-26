import { describe, it, expect } from "vitest";
import { render } from "lit";
import demo from "../../demo/layout.json";
import type { Layout } from "../../src/core/schema";
import { EditorState } from "../../src/editor/state";
import { selectionPanel, type PanelCtx } from "../../src/editor/panels";

const fresh = () => structuredClone(demo) as unknown as Layout;

/** A PanelCtx whose callbacks are all no-ops except the ones a test overrides; every panel function reads only
 *  a handful of these for a given selection, but the type requires them all. */
function baseCtx(st: EditorState): PanelCtx {
  return {
    st,
    commit: () => {},
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
