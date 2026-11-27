import { describe, expect, it } from "vitest";
import { classOf, lightFill, renderFloor, validate, type Floor, type Layout } from "../../src/core";
import { buildScene } from "../../src/core/scene";
import { liveOf } from "../../src/core/live";
import { lampRenderer } from "../../src/card/lamp";

function makeFloor(lamp: NonNullable<Floor["devices"][number]["lamp"]>, entity = ""): Floor {
  return {
    title: "Ground",
    outline: [[0, 0], [400, 0], [400, 300], [0, 300]],
    rooms: [{ id: "r1", name: "Living", area: "living", kind: "room", pts: [[0, 0], [400, 0], [400, 300], [0, 300]], wk: ["external", "external", "external", "external"] }],
    walls: [], stairs: [], doors: [], openings: [], extras: [], furniture: [], unlinked: [],
    devices: [{ id: "st1", type: "light", entity, name: "Street lamp", x: 520, y: 150, lamp }],
  };
}

function makeLayout(f: Floor): Layout {
  return { version: 2, unit: "cm", north: 0, floors: { ground: f }, catalog: [] };
}

describe("S88: City and street lights", () => {
  it("validates street lamp kind, color, autoNight, and rejects bad values", () => {
    const ok = validate(makeLayout(makeFloor({ kind: "street", height: 450, reach: 500, color: "#ff9e3d", autoNight: true })));
    expect(ok.ok).toBe(true);

    const badCol = validate(makeLayout(makeFloor({ kind: "street", color: "orange" })));
    expect(badCol.ok).toBe(false);

    const badNight = validate(makeLayout(makeFloor({ kind: "street", autoNight: false as unknown as true })));
    expect(badNight.ok).toBe(false);

    const badH = validate(makeLayout(makeFloor({ kind: "street", height: 90 })));
    expect(badH.ok).toBe(false);

    const badR = validate(makeLayout(makeFloor({ kind: "street", reach: 2000 })));
    expect(badR.ok).toBe(false);
  });

  it("auto-lights ambient street light at night and stays off during daytime", () => {
    const f = makeFloor({ kind: "street", color: "#ff9e3d", autoNight: true });
    const d = f.devices[0];
    expect(classOf(d, { scale: 1, night: false })).toBe("off");
    expect(classOf(d, { scale: 1, night: true })).toBe("on");
    expect(lightFill(undefined, d)).toBe("#ff9e3d");

    const daySvg = renderFloor(f, { scale: 1, night: false, lampLib: lampRenderer });
    expect(daySvg).not.toContain("lamp-aura-street");

    const nightSvg = renderFloor(f, { scale: 1, night: true, lampLib: lampRenderer });
    expect(nightSvg).toContain("lamp-aura-street");
    expect(nightSvg).toContain("--fp-aura:#ff9e3d");
  });

  it("builds 3D street-light pole, arm, and head and emits live light at night", () => {
    const f = makeFloor({ kind: "street", height: 420, reach: 480, color: "#ff4fd8", autoNight: true });
    const scene = buildScene(f);
    expect(scene.solids.some((s) => s.id.endsWith(":post"))).toBe(true);
    expect(scene.solids.some((s) => s.id.endsWith(":arm"))).toBe(true);
    expect(scene.solids.some((s) => s.id.endsWith(":head"))).toBe(true);

    const liveDay = liveOf(f, { scale: 1, night: false }, 0);
    expect(liveDay.lights.length).toBe(0);

    const liveNight = liveOf(f, { scale: 1, night: true }, 0);
    expect(liveNight.lights.length).toBe(1);
    expect(liveNight.lights[0].rgb).toBe("#ff4fd8");
    expect(liveNight.lights[0].lamp?.kind).toBe("street");
  });
});
