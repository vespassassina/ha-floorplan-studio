import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import demo from "../../demo/layout.json";
import { buildScene } from "../../src/core/scene";
import { liveOf } from "../../src/core/live";
import { forgetDebug } from "../../src/core/debug-once";

// S12 review N9: a piece the 3D builders skip leaves one debug line, so a field report ("my room is missing in 3D") can be diagnosed.
const boom = () => { throw new Error("boom"); };
const floor = () => structuredClone(demo.floors.ground) as any;

describe("skipped pieces say so, once, at debug level", () => {
  let debug: ReturnType<typeof vi.spyOn>, others: ReturnType<typeof vi.spyOn>[];
  beforeEach(() => { forgetDebug(); debug = vi.spyOn(console, "debug").mockImplementation(() => undefined); others = [vi.spyOn(console, "warn"), vi.spyOn(console, "error"), vi.spyOn(console, "log")].map((s) => s.mockImplementation(() => undefined)); });
  afterEach(() => vi.restoreAllMocks());

  it("scene: three pieces of furniture that throw when read give one line, and the rest of the floor is still built", () => {
    const f = floor();
    for (let i = 0; i < 3; i++) f.furniture.push({ id: `bad${i}`, symbol: "sofa", get x() { return boom(); }, y: 1, rot: 0, w: 50, h: 50 });
    const scene = buildScene(f);
    expect(scene.solids.length).toBeGreaterThan(10);
    expect(debug).toHaveBeenCalledTimes(1);
    expect(String(debug.mock.calls[0][0])).toMatch(/3D scene.*left out.*boom/);
    others.forEach((s) => expect(s).not.toHaveBeenCalled());
  });

  it("live: a device that cannot be read gives one line and the others are still read", () => {
    const f = floor();
    f.devices.push({ id: "bad", type: "light", entity: "light.x", get x() { return boom(); }, y: 1 });
    f.devices.push({ id: "bad2", type: "light", entity: "light.y", get x() { return boom(); }, y: 1 });
    const l = liveOf(f, { scale: 1, state: {}, now: 0 } as never, 0);
    expect(l.devices.length).toBe(f.devices.length);
    expect(debug.mock.calls.filter((c) => /3D live state/.test(String(c[0])))).toHaveLength(1);
  });
});
