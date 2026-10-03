import { beforeEach, describe, expect, it } from "vitest";
import demo from "../../demo/layout.json";
import type { Layout } from "../../src/core/schema";
import { WALLS_MODES } from "../../src/core/solids";
import { EditorState } from "../../src/editor/state";
import { parseViewMemory, readViewMemory, writeViewMemory } from "../../src/editor/view-memory";

const fresh = () => structuredClone(demo) as unknown as Layout;

beforeEach(() => localStorage.clear());

describe("editor view memory: walls", () => {
  it("keeps every mode in WALLS_MODES, drops anything else on its own", () => {
    for (const m of WALLS_MODES) expect(parseViewMemory({ walls: m }), m).toEqual({ walls: m });
    for (const junk of ["", "FULL", "tall", "__proto__", 1, null, false, ["low"], { low: 1 }]) {
      expect(parseViewMemory({ walls: junk, tilt: 0.4 }), JSON.stringify(junk)).toEqual({ tilt: 0.4 });
    }
  });
  it("round-trips through exportView, storage and importView", () => {
    for (const m of WALLS_MODES) {
      localStorage.clear();
      const st = new EditorState(fresh());
      st.setWalls(m);
      expect(st.exportView().walls).toBe(m);
      expect(writeViewMemory(st.exportView())).toBe(true);
      const back = new EditorState(fresh());
      back.importView(readViewMemory());
      expect(back.walls).toBe(m);
    }
  });
  it("starts at cut; junk from setWalls or importView leaves it there", () => {
    const st = new EditorState(fresh());
    expect(st.walls).toBe("cut");
    st.importView({ walls: "tall" as never });
    st.setWalls(5 as never);
    st.setWalls("__proto__" as never);
    expect(st.walls).toBe("cut");
  });
});
