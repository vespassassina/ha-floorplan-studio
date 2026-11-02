import { describe, it, expect } from "vitest";
import { viewProblem } from "../../src/editor/panels";
import demo from "../../demo/layout.json";
import type { Layout } from "../../src/core/schema";

// S40 review 7: the validator's message is matched for the exact device, not a suffix of another id.
describe("viewProblem", () => {
  const ctx = (mutate: (devs: any[]) => void) => {
    const layout = structuredClone(demo) as unknown as Layout;
    const floor = Object.keys(layout.floors)[0];
    const d = layout.floors[floor].devices;
    d[0].id = "a"; d[1].id = "aa";
    mutate(d);
    return { st: { layout, floor } } as any;
  };
  it("says nothing for device a when only device aa has a bad view", () => {
    const c = ctx((d) => { d[1].view = "no slash"; });
    expect(viewProblem(c, 0, "/lovelace/ok")).toBe("");
  });
  it("still words the problem for the device itself", () => {
    expect(viewProblem(ctx(() => {}), 1, "no slash")).toMatch(/^view must be a path inside Home Assistant/);
  });
  it("names the right device when both are bad", () => {
    const c = ctx((d) => { d[0].view = "x"; });
    expect(viewProblem(c, 1, "//bad")).toMatch(/^view must be a path/);
  });
});
