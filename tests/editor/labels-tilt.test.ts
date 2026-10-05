import { describe, it, expect, beforeEach } from "vitest";
import demo from "../../demo/layout.json";
import type { Layout } from "../../src/core/schema";
import { EditorState } from "../../src/editor/state";

const fresh = () => structuredClone(demo) as unknown as Layout;

describe("EditorState labels", () => {
  beforeEach(() => localStorage.clear());

  it("shows text to begin with", () => {
    expect(new EditorState(fresh()).labels).toBe(true);
  });

  it("setLabels is no undo step, not in the layout, not stored, and leaves selection and zoom alone", () => {
    const st = new EditorState(fresh());
    st.sel = { t: "room", i: 1 };
    const zoomed = { ...st.view, w: st.view.w / 2 };
    st.views[st.floor] = zoomed;
    const layout = JSON.stringify(st.layout);
    st.setLabels(false);
    expect(st.labels).toBe(false);
    expect(st.canUndo).toBe(false);
    expect(JSON.stringify(st.layout)).toBe(layout);
    expect(st.sel).toEqual({ t: "room", i: 1 });
    expect(st.views[st.floor]).toEqual(zoomed);
    expect(localStorage.length).toBe(0);
  });
});
