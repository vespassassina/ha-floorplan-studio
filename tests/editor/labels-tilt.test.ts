import { describe, it, expect, beforeEach } from "vitest";
import demo from "../../demo/layout.json";
import type { Layout } from "../../src/core/schema";
import { DEFAULT_TILT } from "../../src/core/render";
import { EditorState } from "../../src/editor/state";

const fresh = () => structuredClone(demo) as unknown as Layout;

describe("EditorState labels and tilt", () => {
  beforeEach(() => localStorage.clear());

  it("shows text and the default tilt to begin with", () => {
    const st = new EditorState(fresh());
    expect(st.labels).toBe(true);
    expect(st.tilt).toBe(DEFAULT_TILT);
  });

  it("setLabels and setTilt are no undo step, not in the layout, not stored, and leave selection and zoom alone", () => {
    const st = new EditorState(fresh());
    st.sel = { t: "room", i: 1 };
    const zoomed = { ...st.view, w: st.view.w / 2 };
    st.views[st.floor] = zoomed;
    const layout = JSON.stringify(st.layout);
    st.setLabels(false);
    st.setTilt(0.9);
    expect(st.labels).toBe(false);
    expect(st.tilt).toBe(0.9);
    expect(st.canUndo).toBe(false);
    expect(JSON.stringify(st.layout)).toBe(layout);
    expect(st.sel).toEqual({ t: "room", i: 1 });
    expect(st.views[st.floor]).toEqual(zoomed);
    expect(localStorage.length).toBe(0);
  });

  it("setTilt clamps, and junk is ignored", () => {
    const st = new EditorState(fresh());
    st.setTilt(5);
    expect(st.tilt).toBe(1);
    st.setTilt(-5);
    expect(st.tilt).toBe(0);
    st.setTilt(0.3);
    st.setTilt(NaN);
    st.setTilt("1" as never);
    expect(st.tilt).toBe(0.3);
  });

  it("a view that shows the whole floor is refitted so a steeper tilt does not clip; a zoomed one is left alone", () => {
    const st = new EditorState(fresh());
    st.setViewMode("2.5d");
    st.fit();
    const top = st.view.y;
    st.setTilt(1);
    expect(st.view.y).toBeLessThan(top);
    st.views[st.floor] = { ...st.view, w: st.view.w / 2, h: st.view.h / 2 };
    const zoomed = { ...st.view };
    st.setTilt(0);
    expect(st.view).toEqual(zoomed);
  });
});
