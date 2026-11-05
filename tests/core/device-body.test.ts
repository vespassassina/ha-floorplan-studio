import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import { DEVICE_BODIES, DEVICE_TYPES, validate, type Layout } from "../../src/core/schema";
import { OBLIQUE, renderFloor } from "../../src/core/render";
import type { Floor } from "../../src/core/schema";
import { DEVICE_SOLID, bodyOf, deviceSolidTop } from "../../src/core/solids";
import { deviceZ } from "../../src/core/heights";
import { buildScene } from "../../src/core/scene";

// B53.8: a device's `body` says which solid it draws. Absent is its type's default (DEVICE_SOLID); the Body select writes it.
const floor = (o: Partial<Floor> = {}): Floor => ({
  title: "T", outline: [[0, 0], [600, 0], [600, 500], [0, 500]], owk: ["wall", "wall", "wall", "wall"], rooms: [],
  walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [], ...o,
});
const dev = (type: string, o: Record<string, unknown> = {}) => ({ id: "d", type, entity: `x.${type}`, x: 300, y: 250, ...o });
const bar = { x: undefined, y: undefined, a: [100, 50], b: [300, 50] };
const deep = (f: Floor, o = {}) => renderFloor(f, { scale: 1, view: "2.5d", ...o });
const flat = (f: Floor, o = {}) => renderFloor(f, { scale: 1, ...o });
const solidClass = (html: string) => [...html.matchAll(/<g class="obj dsolid (\w+)/g)].map((m) => m[1]);
/** The demo with one extra device on its first floor, and what `validate` says about that device. */
const check = (d: Record<string, unknown>): string[] => {
  const l = JSON.parse(JSON.stringify(demo)) as Layout;
  Object.values(l.floors)[0]!.devices.push(d as never);
  const r = validate(l);
  return r.ok ? [] : r.errors.filter((e) => e.includes(String(d.id)));
};

describe("DEVICE_BODIES", () => {
  it("is the seven bodies, in this order", () => {
    expect([...DEVICE_BODIES]).toEqual(["none", "radiator", "speaker", "tv", "ac-wall", "ac-floor", "screen"]);
  });

  it("every type's default is one of them, and ac and screen have their own", () => {
    for (const t of DEVICE_TYPES) expect(DEVICE_BODIES, t).toContain(DEVICE_SOLID[t]);
    expect(DEVICE_SOLID.ac).toBe("ac-wall");
    expect(DEVICE_SOLID.screen).toBe("screen");
  });
});

describe("validate and body", () => {
  it("accepts every body on a point device, except a radiator, which needs a bar", () => {
    for (const body of DEVICE_BODIES) {
      const e = check({ id: "zz", type: "media", entity: "media_player.x", x: 5, y: 5, body });
      if (body === "radiator") expect(e.join("|"), body).toMatch(/body.*bar/);
      else expect(e, body).toEqual([]);
    }
  });

  it("a heater bar takes radiator or none, and refuses the rest in words", () => {
    for (const body of DEVICE_BODIES) {
      const e = check({ id: "zz", type: "heater", entity: "climate.x", a: [10, 10], b: [60, 10], body });
      if (body === "radiator" || body === "none") expect(e, body).toEqual([]);
      else expect(e.join("|"), body).toMatch(/body.*radiator.*none/);
    }
  });

  it("leaving body out is fine, and hostile values are errors, never a throw", () => {
    expect(check({ id: "zz", type: "ac", entity: "climate.x", x: 5, y: 5 })).toEqual([]);
    for (const body of ["sofa", "", 5, null, true, {}, [], ["tv"], "__proto__", "constructor", "toString", NaN]) {
      expect(check({ id: "zz", type: "ac", entity: "climate.x", x: 5, y: 5, body }).join("|"), String(body)).toMatch(/body must be one of/);
    }
    const l = JSON.parse(JSON.stringify(demo)) as Layout;
    const d = { id: "zz", type: "ac", entity: "climate.x", x: 5, y: 5 };
    Object.defineProperty(d, "body", { get() { throw new Error("boom"); }, enumerable: true });
    Object.values(l.floors)[0]!.devices.push(d as never);
    expect(() => validate(l)).not.toThrow();
    expect(validate(l).ok).toBe(false);
  });

  it("a control screen is a device type", () => {
    expect(DEVICE_TYPES).toContain("screen");
    expect(check({ id: "zz", type: "screen", entity: "sensor.panel", x: 5, y: 5 })).toEqual([]);
  });
});

describe("bodyOf", () => {
  it("is the type's default, or the body the device names", () => {
    expect(bodyOf(dev("ac") as never)).toBe("ac-wall");
    expect(bodyOf(dev("ac", { body: "ac-floor" }) as never)).toBe("ac-floor");
    expect(bodyOf(dev("media", { body: "tv" }) as never)).toBe("tv");
    expect(bodyOf(dev("tv", { body: "none" }) as never)).toBe("none");
  });

  it("ignores junk, and a body that cannot fit: a bar takes only radiator or none, a point has no radiator", () => {
    for (const body of ["sofa", 5, null, {}, [], "__proto__"]) expect(bodyOf(dev("ac", { body }) as never), String(body)).toBe("ac-wall");
    expect(bodyOf(dev("heater", { ...bar, body: "tv" }) as never)).toBe("radiator");
    expect(bodyOf(dev("heater", { ...bar, body: "none" }) as never)).toBe("none");
    expect(bodyOf(dev("media", { body: "radiator" }) as never)).toBe("speaker");
    expect(bodyOf(null as never)).toBe("none");
  });
});

describe("a body decides what 2.5D and 3D draw", () => {
  it("a media device given a tv body draws a tv panel, not a speaker", () => {
    expect(solidClass(deep(floor({ devices: [dev("media")] as never })))).toEqual(["speaker"]);
    expect(solidClass(deep(floor({ devices: [dev("media", { body: "tv" })] as never })))).toEqual(["tv"]);
  });

  it("body none draws no solid, in 2.5D or 3D; a light can be given a speaker", () => {
    expect(deep(floor({ devices: [dev("tv", { body: "none" })] as never }))).not.toContain("dsolid");
    expect(buildScene(floor({ devices: [dev("tv", { body: "none" })] as never })).solids.find((s) => s.kind === "device")!.shape.type).toBe("point");
    expect(solidClass(deep(floor({ devices: [dev("light", { body: "speaker" })] as never })))).toEqual(["speaker"]);
  });

  it("2D never draws a solid", () => {
    expect(flat(floor({ devices: [dev("media", { body: "tv" })] as never }))).not.toContain("dsolid");
  });

  it("3D follows the body: a media device with a tv body is a 100 cm wide panel; a heater bar with body none is a point", () => {
    const s = buildScene(floor({ devices: [dev("media", { body: "tv" })] as never })).solids.find((x) => x.kind === "device")!;
    expect(s.shape.type).toBe("prism");
    const xs = (s.shape as { base: [number, number][] }).base.map((q) => q[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(100, 5);
    expect(buildScene(floor({ devices: [dev("heater", { ...bar, body: "none" })] as never })).solids.find((x) => x.kind === "device")!.shape.type).toBe("point");
  });

  it("the top of the solid and the icon's height follow the body", () => {
    expect(deviceSolidTop(dev("ac") as never)).toBe(225);
    expect(deviceSolidTop(dev("ac", { body: "ac-floor" }) as never)).toBe(60);
    expect(deviceSolidTop(dev("media", { body: "none" }) as never)).toBe(0);
    expect(deviceZ(dev("ac") as never)).toBe(195);
    expect(deviceZ(dev("ac", { body: "ac-floor" }) as never)).toBe(60); // the icon sits on top of the console, as a speaker's does
    expect(deviceZ(dev("ac", { body: "ac-floor", z: 20 }) as never)).toBe(20);
  });

  it("2.5D lifts a floor console's icon onto its top (60 cm), though that is under the stem threshold", () => {
    const R = OBLIQUE.rise;
    const html = deep(floor({ devices: [dev("ac", { body: "ac-floor" })] as never }));
    const m = /<g data-x="0"[^>]*transform="translate\(([\d.-]+) ([\d.-]+)\)/.exec(html)!;
    expect(Number(m[2]) + 12).toBeCloseTo(250 - 60 * R, 0);
  });
});
