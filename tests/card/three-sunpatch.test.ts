import { describe, expect, it } from "vitest";
import { sunDir } from "../../src/card/three/sun";
import { MAX_SUN_PATCHES, SUN_REACH, sunPatch, sunPatches } from "../../src/card/three/sunpatch";
import { inPoly } from "../../src/card/three/light";
import type { Aperture } from "../../src/core/scene-build";
import { DOOR_KINDS, ROOM_KINDS } from "../../src/core";

// S38.4 (docs/specs/sun-s38.md, behaviour 6): the floor patch a window throws. Plan frame: x east, y south, cm.
// One room 800 x 600; its south wall is y = 600, outward normal (0, 1). Sun at azimuth 180 (south), 40 degrees up: the light
// travels north, a point h up the opening lands h / tan 40 cm into the room.
const room = { index: 0, base: [[0, 0], [800, 0], [800, 600], [0, 600]], top: 1, area: 480000 };
const south: Aperture = { kind: "window", a: [300, 600], b: [500, 600], sill: 90, head: 210, thick: 20, faces: [[0, 1]], outer: true };
const north: Aperture = { kind: "window", a: [300, 0], b: [500, 0], sill: 90, head: 210, thick: 20, faces: [[0, -1]], outer: true };
const sun = (az: number, el: number) => sunDir(az, el, 0)!;
const T40 = Math.tan((40 * Math.PI) / 180);
const ys = (p: { ring: readonly (readonly number[])[] }) => p.ring.map((q) => q[1]);
const xs = (p: { ring: readonly (readonly number[])[] }) => p.ring.map((q) => q[0]);

describe("sunPatch: the projection", () => {
  it("a south window with the sun in the south: the opening from sill to head, projected onto the floor", () => {
    const p = sunPatch(south, [room], sun(180, 40))!;
    expect(p).not.toBeNull();
    expect(p.room).toBe(0);
    expect(Math.min(...ys(p))).toBeCloseTo(600 - 210 / T40, 6); // 349.7: the head's shadow
    expect(Math.max(...ys(p))).toBeCloseTo(600 - 90 / T40, 6); // 492.8: the sill's
    expect(Math.min(...xs(p))).toBeCloseTo(300, 6);
    expect(Math.max(...xs(p))).toBeCloseTo(500, 6);
  });
  it("a sun in the south-east shifts the patch west, by the height over tan(elevation) times the sideways part", () => {
    const p = sunPatch(south, [room], sun(135, 40))!;
    expect(p).not.toBeNull();
    const k = Math.SQRT1_2, farShift = (210 / T40) * k;
    expect(Math.min(...xs(p))).toBeCloseTo(300 - farShift, 6);
    expect(Math.max(...xs(p))).toBeCloseTo(500 - (90 / T40) * k, 6);
    expect(Math.min(...ys(p))).toBeCloseTo(600 - farShift, 6);
  });
  it("its strength is the cosine of the angle between the sun and the wall's normal", () => {
    expect(sunPatch(south, [room], sun(180, 40))!.cos).toBeCloseTo(1, 9);
    expect(sunPatch(south, [room], sun(135, 40))!.cos).toBeCloseTo(Math.SQRT1_2, 9);
  });
  it("a window facing away from the sun casts none", () => {
    expect(sunPatch(north, [room], sun(180, 40))).toBeNull();
    expect(sunPatch(north, [room], sun(0, 40))).not.toBeNull(); // the sun in the north: now the north window shines
    expect(sunPatch(south, [room], sun(0, 40))).toBeNull();
  });
  it("a sun parallel to the wall (side-on) casts none", () => {
    expect(sunPatch(south, [room], sun(90, 40))).toBeNull();
  });
  it("no sun, no patch", () => { expect(sunPatch(south, [room], null)).toBeNull(); });
});

describe("sunPatch: which openings", () => {
  it("only window, fullwindow, glass, slit and open cast a patch", () => {
    for (const kind of ["window", "fullwindow", "glass", "slit", "open"]) expect(sunPatch({ ...south, kind }, [room], sun(180, 40)), kind).not.toBeNull();
    for (const kind of ["door", "sealed", "opening", "banana"]) expect(sunPatch({ ...south, kind }, [room], sun(180, 40)), kind).toBeNull();
  });
  it("an opening between two rooms casts none, flagged or not", () => {
    const left = { index: 0, base: [[0, 0], [400, 0], [400, 600], [0, 600]], top: 1, area: 240000 }, right = { index: 1, base: [[400, 0], [800, 0], [800, 600], [400, 600]], top: 1, area: 240000 };
    const between: Aperture = { kind: "window", a: [400, 200], b: [400, 400], sill: 90, head: 210, thick: 10, faces: [[1, 0], [-1, 0]], outer: false };
    expect(sunPatch(between, [left, right], sun(90, 40))).toBeNull(); // the sun in the east, light into the left room
    expect(sunPatch({ ...between, outer: true }, [left, right], sun(90, 40))).toBeNull(); // a room on both sides: not the outside, whatever the flag says
  });
  it("a garden, terrace, pavement or water on the other side is still the outside; one of them behind the glass is not a room to light", () => {
    for (const kind of ["garden", "terrace", "pavement", "water", "zone", "fill"]) {
      const out = { index: 7, kind, base: [[0, 600], [800, 600], [800, 700], [0, 700]], top: 1, area: 80000 };
      expect(sunPatch(south, [room, out], sun(180, 40)), `${kind} outside`).not.toBeNull();
      const behind = { ...room, kind };
      expect(sunPatch(south, [behind], sun(180, 40)), `${kind} inside`).toBeNull();
    }
    expect(sunPatch(south, [{ ...room, kind: "room" }], sun(180, 40))).not.toBeNull();
    expect(sunPatch(south, [{ ...room, kind: "structure" }], sun(180, 40))).not.toBeNull();
  });
  it("a wall with no outside (outer false) casts none", () => { expect(sunPatch({ ...south, outer: false }, [room], sun(180, 40))).toBeNull(); });
  it("an opening with no room behind it casts none", () => { expect(sunPatch(south, [], sun(180, 40))).toBeNull(); });
});

describe("sunPatch: clip and reach", () => {
  it("is clipped to the room: a room 150 cm deep stops the patch at its far wall", () => {
    const shallow = { index: 3, base: [[0, 450], [800, 450], [800, 600], [0, 600]], top: 1, area: 120000 };
    const p = sunPatch(south, [shallow], sun(180, 40))!;
    expect(p.room).toBe(3);
    expect(Math.min(...ys(p))).toBeGreaterThanOrEqual(450 - 1e-6);
    expect(Math.min(...ys(p))).toBeGreaterThan(449); // reaches the wall, and no more
    for (const q of p.ring) expect(inPoly(shallow.base, q[0], Math.min(599.99, Math.max(450.01, q[1]))), `${q}`).toBe(true);
  });
  it("is clipped on the side too: a slanted sun at a room's corner never leaves it", () => {
    const narrow = { index: 0, base: [[250, 0], [520, 0], [520, 600], [250, 600]], top: 1, area: 162000 };
    const p = sunPatch(south, [narrow], sun(135, 40))!;
    expect(p).not.toBeNull();
    expect(Math.min(...xs(p))).toBeGreaterThanOrEqual(250 - 1e-6);
  });
  it("reaches at most SUN_REACH from the wall: a sun at 5 degrees would throw 2400 cm", () => {
    const big = { index: 0, base: [[0, -3000], [800, -3000], [800, 600], [0, 600]], top: 1, area: 2880000 };
    const p = sunPatch({ ...south, kind: "fullwindow", sill: 0 }, [big], sun(180, 5))!;
    expect(p).not.toBeNull();
    expect(SUN_REACH).toBe(800);
    expect(600 - Math.min(...ys(p))).toBeCloseTo(SUN_REACH, 6);
    expect(600 - Math.max(...ys(p))).toBeCloseTo(0, 6);
    expect(sunPatch(south, [big], sun(180, 5)), "a sill whose shadow starts past the reach: none").toBeNull(); // 90 / tan 5 = 1029
  });
});

describe("sunPatches", () => {
  it("lists every patch, the largest first", () => {
    const big: Aperture = { ...south, a: [100, 600], b: [250, 600] }, small: Aperture = { ...south, a: [600, 600], b: [650, 600] }, other: Aperture = { ...south, a: [350, 600], b: [500, 600], head: 180 };
    const all = sunPatches([small, big, north, other], [room], sun(180, 40));
    expect(all).toHaveLength(3);
    expect(all.map((p) => Math.round(p.area))).toEqual([...all.map((p) => Math.round(p.area))].sort((a, b) => b - a));
    expect(all[0].area).toBeGreaterThan(all[2].area);
    expect(MAX_SUN_PATCHES).toBe(24);
  });
});

describe("sunPatch: junk", () => {
  it("never throws and gives nothing", () => {
    const junk: unknown[] = [null, undefined, 5, "x", [], {}, { kind: "window" }, { ...south, a: [Number.NaN, 0] }, { ...south, faces: "x" }, { ...south, faces: [[Number.NaN, 1]] }, { ...south, sill: "9" }, { ...south, head: Number.NaN }, { ...south, a: [300, 600], b: [300, 600] }];
    for (const j of junk) { expect(() => sunPatch(j as Aperture, [room], sun(180, 40)), JSON.stringify(j)).not.toThrow(); expect(sunPatch(j as Aperture, [room], sun(180, 40)), JSON.stringify(j)).toBeNull(); }
    for (const r of [null, undefined, "x", [null], [{}], [{ index: 0, base: "x" }], [{ index: 0, base: [[Number.NaN, 0]] }]]) expect(() => sunPatch(south, r as never, sun(180, 40))).not.toThrow();
    for (const d of [undefined, [], [Number.NaN, 0, 1], "x", [0, 1, 0], [0, 0, 1]]) { expect(() => sunPatch(south, [room], d as never)).not.toThrow(); expect(sunPatch(south, [room], d as never)).toBeNull(); }
    expect(() => sunPatches(null as never, [room], sun(180, 40))).not.toThrow();
    expect(sunPatches("x" as never, [room], sun(180, 40))).toEqual([]);
  });
});

// Finding 17: an enumeration is a list of decisions. Every kind the schema has is written down here as shining in (or not), indoors (or
// not); a kind added to the schema fails these tests until someone decides what the sun does with it.
describe("sunPatch: every opening kind and room kind is decided", () => {
  const SHINES_IN = ["window", "fullwindow", "glass", "slit", "open"];
  const NO_SUN = ["door", "sealed"];
  const INDOORS = ["room", "structure"];
  const OUTDOORS = ["garden", "terrace", "pavement", "water", "zone", "fill"];

  it("each opening kind is in exactly one of the two lists, and the list says whether a patch falls", () => {
    for (const kind of DOOR_KINDS) {
      expect([SHINES_IN, NO_SUN].filter((l) => l.includes(kind)).length, `${kind}: decide whether the sun shines through it`).toBe(1);
      const patch = sunPatch({ ...south, kind }, [room], sun(180, 40));
      expect(patch !== null, `${kind} ${SHINES_IN.includes(kind) ? "lets the sun in" : "does not"}`).toBe(SHINES_IN.includes(kind));
    }
    for (const kind of [...SHINES_IN, ...NO_SUN]) expect(DOOR_KINDS as readonly string[], `${kind} is no longer a schema kind`).toContain(kind);
  });

  it("each room kind is in exactly one of the two lists, and the list says whether the sun lands in it", () => {
    for (const kind of ROOM_KINDS) {
      expect([INDOORS, OUTDOORS].filter((l) => l.includes(kind)).length, `${kind}: decide whether it is indoors`).toBe(1);
      const patch = sunPatch(south, [{ ...room, kind }], sun(180, 40));
      expect(patch !== null, `${kind} ${INDOORS.includes(kind) ? "takes a patch" : "takes none"}`).toBe(INDOORS.includes(kind));
    }
    for (const kind of [...INDOORS, ...OUTDOORS]) expect(ROOM_KINDS as readonly string[], `${kind} is no longer a schema kind`).toContain(kind);
  });
});
