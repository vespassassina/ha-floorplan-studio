import { describe, it, expect } from "vitest";
import { classOf, OBLIQUE, renderFloor } from "../../src/core/render";
import type { Floor } from "../../src/core/schema";
import { bodyPlacement, deviceSolidTop, tvPlacement } from "../../src/core/solids";
import { buildScene } from "../../src/core/scene";

// An air conditioner has a body: a split unit high on the wall, or a console on the floor, and it blows while it runs.
const R = OBLIQUE.rise, K = OBLIQUE.skew;
const floor = (o: Partial<Floor> = {}): Floor => ({
  title: "T", outline: [[0, 0], [600, 0], [600, 500], [0, 500]], owk: ["wall", "wall", "wall", "wall"], rooms: [],
  walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [], ...o,
});
const ac = (o: Record<string, unknown> = {}) => ({ id: "a", type: "ac", entity: "climate.ac", x: 200, y: 60, ...o });
const st = (state: string, hvac_action?: string) => ({ "climate.ac": { state, attributes: hvac_action ? { hvac_action } : {}, last_changed: "2026-01-01T00:00:00Z" } });
const flat = (f: Floor, o = {}) => renderFloor(f, { scale: 1, ...o });
const deep = (f: Floor, o = {}) => renderFloor(f, { scale: 1, view: "2.5d", ...o });
const ptsOf = (s: string) => s.split(" ").map((p) => p.split(",").map(Number) as [number, number]);
const body = (html: string) => html.match(/<polygon class="ac-body[^"]*" points="([^"]*)"/);
const wind = (html: string) => html.match(/<g class="ac-wind[^"]*">.*?<\/g>/)?.[0] ?? "";
/** Every point a wind strand passes through (its M, Q and T coordinates). */
const windPts = (g: string) => [...g.matchAll(/d="([^"]*)"/g)].flatMap((m) => m[1].replace(/[MQT]/g, " ").trim().split(/\s+/).map((p) => p.split(",").map(Number) as [number, number]));
const span = (v: number[]) => [Math.min(...v), Math.max(...v)].map((x) => Math.round(x * 100) / 100);

describe("ac placement", () => {
  it("hangs a split unit flush on the nearest wall: 80 wide, 22 deep, from its mount height 30 cm up, facing into the room", () => {
    const p = bodyPlacement(floor(), ac() as never)!;
    expect(span(p.base.map((q) => q[0]))).toEqual([160, 240]);
    expect(span(p.base.map((q) => q[1]))).toEqual([5, 27]); // a plain wall's room face is 5 cm in
    expect([p.z0, p.z1]).toEqual([195, 225]);
    expect(p.n.map((v) => Math.round(v) + 0)).toEqual([0, 1]);
    expect(p.floor).toBe(false);
  });

  it("a device exactly on a wall line still hangs inside the room, on all four walls (Opus review: the flip did nothing at a dot product of 0)", () => {
    const cases: [number, number, [number, number]][] = [[200, 0, [0, 1]], [600, 250, [-1, 0]], [0, 250, [1, 0]], [200, 500, [0, -1]]];
    const inRoom = (q: number[]) => q[0] >= 0 && q[0] <= 600 && q[1] >= 0 && q[1] <= 500;
    for (const [x, y, n] of cases) for (const f of [floor(), floor({ rooms: [{ name: "R", kind: "living", pts: [[0, 0], [600, 0], [600, 500], [0, 500]] }] as never })]) {
      const p = bodyPlacement(f, ac({ x, y }) as never)!;
      expect(p.n.map((v) => Math.round(v) + 0), `n at ${x},${y}`).toEqual(n);
      expect(p.base.every(inRoom), `base at ${x},${y}`).toBe(true);
      const t = tvPlacement(f, { id: "t", type: "tv", entity: "media_player.t", x, y } as never, [0, 1])!;
      expect(t.n.map((v) => Math.round(v) + 0), `tv n at ${x},${y}`).toEqual(n);
    }
  });

  it("on a wall line it faces the indoor side: an indoor room beats the outline, which beats a terrace, garden or pavement (Opus re-check)", () => {
    const sq = (y0: number, y1: number): [number, number][] => [[0, y0], [600, y0], [600, y1], [0, y1]];
    const indoor = { id: "i", name: "Living", area: "", kind: "room", pts: sq(0, 500), wk: ["external", "wall", "wall", "wall"] };
    const near = (f: Floor, n: number[], label: string) => {
      const p = bodyPlacement(f, ac({ x: 200, y: 0 }) as never)!, t = tvPlacement(f, { id: "t", type: "tv", entity: "media_player.t", x: 200, y: 0 } as never, [0, 1])!;
      expect(p.n.map((v) => Math.round(v) + 0), `ac ${label}`).toEqual(n);
      expect(t.n.map((v) => Math.round(v) + 0), `tv ${label}`).toEqual(n);
    };
    for (const kind of ["terrace", "garden", "pavement", "water"]) near(floor({ rooms: [indoor, { id: "t", name: "T", area: "", kind, pts: sq(-300, 0), wk: ["fence", "fence", "external", "fence"] }] as never }), [0, 1], kind);
    // An indoor room on one side and only outline space on the other: the room wins, wherever the room lies.
    near(floor({ outline: [[0, -300], [600, -300], [600, 500], [0, 500]], owk: ["wall", "wall", "wall", "wall"], rooms: [indoor] as never }), [0, 1], "room below, outline above");
    near(floor({ outline: [[0, -300], [600, -300], [600, 500], [0, 500]], owk: ["wall", "wall", "wall", "wall"], rooms: [{ ...indoor, pts: sq(-300, 0) }] as never }), [0, -1], "room above, outline below");
    // No rooms at all: the outline's inside, as before.
    near(floor(), [0, 1], "outline only");
  });

  it("near a corner the body stays on its own wall's segment and clear of the neighbouring wall's face (Opus review)", () => {
    const f = floor(), q = bodyPlacement(f, ac({ x: 20, y: 30 }) as never)!;
    expect(q.base.map((b) => b[0]).every((v) => v >= 0)).toBe(true);
    const ys = q.base.map((b) => b[1]);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(5); // the top wall's room face is 5 in
    expect(span(ys)[1] - span(ys)[0]).toBe(80); // still 80 wide, only shifted
    const far = bodyPlacement(f, ac({ x: 590, y: 490 }) as never)!;
    expect(Math.max(...far.base.map((b) => b[0]))).toBeLessThanOrEqual(595);
    expect(Math.max(...far.base.map((b) => b[1]))).toBeLessThanOrEqual(495);
    // a wall shorter than the unit centres it instead of overrunning either end
    const short = bodyPlacement(floor({ outline: [[0, 0], [60, 0], [60, 500], [0, 500]] }), ac({ x: 10, y: 0 }) as never)!;
    expect(span(short.base.map((b) => b[0]))).toEqual([-10, 70]);
  });

  it("is a floor console when its body says so, not by height: 70 wide, 20 deep, 60 tall, from the floor", () => {
    const p = bodyPlacement(floor(), ac({ body: "ac-floor" }) as never)!;
    expect(span(p.base.map((q) => q[0]))).toEqual([165, 235]);
    expect(span(p.base.map((q) => q[1]))).toEqual([5, 25]);
    expect([p.z0, p.z1]).toEqual([0, 60]);
    expect(p.floor).toBe(true);
    // The height alone changes nothing: a low `z` on a wall unit is still a wall unit; a `z` on a console lifts it.
    const low = bodyPlacement(floor(), ac({ z: 40 }) as never)!;
    expect([low.floor, low.z0, low.z1]).toEqual([false, 40, 70]);
    expect([bodyPlacement(floor(), ac({ body: "ac-floor", z: 20 }) as never)!.z0, bodyPlacement(floor(), ac({ body: "ac-wall" }) as never)!.floor]).toEqual([20, false]);
  });

  it("a control screen is 24 wide, 2 thick, 16 tall, flush on the wall at 140 cm by default", () => {
    const p = bodyPlacement(floor(), { id: "s", type: "screen", entity: "sensor.s", x: 200, y: 60 } as never)!;
    expect(span(p.base.map((q) => q[0]))).toEqual([188, 212]);
    expect(span(p.base.map((q) => q[1]))).toEqual([5, 7]);
    expect([p.z0, p.z1]).toEqual([140, 156]);
    expect(deviceSolidTop({ id: "s", type: "screen", entity: "sensor.s", x: 200, y: 60 } as never)).toBe(156);
  });

  it("owns only the three bodies it places: a speaker, a tv, none, or a heater bar given a radiator, gives null", () => {
    for (const body of ["speaker", "tv", "none"]) expect(bodyPlacement(floor(), ac({ body }) as never), body).toBeNull();
    expect(bodyPlacement(floor(), { id: "h", type: "heater", entity: "climate.h", a: [100, 50], b: [300, 50] } as never)).toBeNull();
  });

  it("follows the unit to another wall", () => {
    const p = bodyPlacement(floor(), ac({ x: 560, y: 300 }) as never)!; // east wall 40 cm off
    expect(span(p.base.map((q) => q[0]))).toEqual([573, 595]);
    expect(span(p.base.map((q) => q[1]))).toEqual([260, 340]);
    expect(p.n.map((v) => Math.round(v) + 0)).toEqual([-1, 0]);
  });

  it("stands free at its own point when no wall is within 60 cm, blowing the way `rot` points (0 is up the plan)", () => {
    const up = bodyPlacement(floor(), ac({ x: 300, y: 250 }) as never)!;
    expect(up.n.map((v) => Math.round(v) + 0)).toEqual([0, -1]);
    expect(span(up.base.map((q) => q[0]))).toEqual([260, 340]);
    expect(span(up.base.map((q) => q[1]))).toEqual([239, 261]);
    expect(bodyPlacement(floor(), ac({ x: 300, y: 250, rot: 90 }) as never)!.n.map((v) => Math.round(v) + 0)).toEqual([1, 0]);
  });

  it("returns null, never throws, on hostile numbers", () => {
    for (const v of [NaN, Infinity, "x", null, {}, []]) {
      expect(bodyPlacement(floor(), ac({ x: v }) as never)).toBeNull();
      expect(() => bodyPlacement(floor(), ac({ z: v, rot: v, body: v }) as never)).not.toThrow();
    }
    expect(bodyPlacement(floor({ outline: [] }), ac() as never)).not.toBeNull();
  });
});

describe("ac on the plan", () => {
  it("draws its body as a rectangle on the wall in 2D, and as a solid instead in 2.5D", () => {
    const f = floor({ devices: [ac()] as never });
    const b = body(flat(f))!;
    const q = ptsOf(b[1]);
    expect(span(q.map((p) => p[0]))).toEqual([160, 240]);
    expect(span(q.map((p) => p[1]))).toEqual([5, 27]);
    const html = deep(f);
    expect(body(html)).toBeNull();
    expect(html).toMatch(/<g class="obj dsolid ac /);
    expect(deviceSolidTop(ac() as never)).toBe(225);
  });

  it("blows only while it runs: no wind when off, unavailable or missing; wind in its mode's class when cooling or heating, plain on fan", () => {
    const f = floor({ devices: [ac()] as never });
    expect(wind(flat(f))).toBe("");
    expect(wind(flat(f, { state: st("off") }))).toBe("");
    expect(wind(flat(f, { state: st("unavailable") }))).toBe("");
    expect(wind(flat(f, { state: st("cool", "cooling") }))).toMatch(/^<g class="ac-wind cool">/);
    expect(wind(flat(f, { state: st("heat", "heating") }))).toMatch(/^<g class="ac-wind heat">/);
    expect(wind(flat(f, { state: st("fan_only", "fan") }))).toMatch(/^<g class="ac-wind">/);
    // The body takes the mode too, so it can be tinted.
    expect(body(flat(f, { state: st("cool", "cooling") }))![0]).toMatch(/class="ac-body[^"]* cool"/);
  });

  it("an AC running only its fan reads as on, so the icon and the wind agree (Opus review); idle with the compressor off stays off", () => {
    const o = (state: string, hvac_action?: string) => ({ scale: 1, state: st(state, hvac_action) });
    for (const d of [ac(), ac({ type: "climate", body: "ac-wall" })]) {
      expect(classOf(d as never, o("fan_only", "fan")), String(d.type)).toBe("on");
      expect(classOf(d as never, o("fan_only")), String(d.type)).toBe("on");
      expect(classOf(d as never, o("cool", "cooling"))).toBe("on");
      expect(classOf(d as never, o("cool", "idle"))).toBe("off");
      expect(classOf(d as never, o("off"))).toBe("off");
      expect(classOf(d as never, o("unavailable"))).toBe("unavailable");
    }
    // Any type that stands on a climate entity with an AC body: the icon and the wind agree (a heater, an "other").
    for (const type of ["heater", "other", "climate"]) {
      const d = ac({ type, body: "ac-floor" });
      expect(classOf(d as never, o("fan_only", "fan")), type).toBe("on");
      expect(classOf(d as never, o("cool", "cooling")), type).toBe("on");
      expect(classOf(d as never, o("cool", "idle")), type).toBe("off");
    }
    expect(classOf(ac({ type: "heater" }) as never, o("fan_only"))).toBe("off"); // no AC body: a heater is on only while it heats
    expect(classOf(ac({ type: "climate" }) as never, o("fan_only"))).toBe("off"); // a plain thermostat is on only while it heats
    const html = flat(floor({ devices: [ac()] as never }), { state: st("fan_only", "fan") });
    expect(html).toMatch(/class="dev dev-ac [^"]*\bon\b/); // the icon says on while the wind blows
    expect(wind(html)).not.toBe("");
  });

  it("blows from the front face into the room, three strands, about 70 cm", () => {
    const g = wind(flat(floor({ devices: [ac()] as never }), { state: st("cool", "cooling") }));
    expect(g.match(/<path /g)?.length).toBe(3);
    const ys = windPts(g).map((p) => p[1]);
    expect(Math.min(...ys)).toBeCloseTo(27, 1);
    expect(Math.max(...ys)).toBeCloseTo(97, 1);
    const xs = windPts(g).map((p) => p[0]);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(160);
    expect(Math.max(...xs)).toBeLessThanOrEqual(240);
  });

  it("lifts the wind to the middle of the unit in 2.5D", () => {
    const g = wind(deep(floor({ devices: [ac()] as never }), { state: st("cool", "cooling") }));
    const [x, y] = windPts(g)[0], zw = 210;
    expect(y).toBeCloseTo(27 - zw * R, 1);
    expect(x).toBeCloseTo(176 + zw * K * R, 1);
  });

  it("never throws on hostile input, flat or deep", () => {
    for (const v of [NaN, Infinity, "x", null, {}, [], -5, 1e9]) for (const d of [ac({ x: v, y: v }), ac({ z: v }), ac({ rot: v }), ac({ body: v }), ac({ x: v, body: "ac-floor" }), { id: "s", type: "screen", entity: "", x: v, y: 5 }]) {
      const f = floor({ devices: [d] as never });
      try { flat(f); } catch { continue; }
      expect(() => flat(f, { state: st("cool", "cooling") })).not.toThrow();
      expect(() => deep(f, { state: st("cool", "cooling"), rotate: { deg: 90, pivot: [300, 250] }, tilt: 1 })).not.toThrow();
    }
  });
});

describe("ac in 3D", () => {
  it("a floor console is a prism from the floor to 60 cm, tagged ac", () => {
    const sol = buildScene(floor({ devices: [ac({ body: "ac-floor" })] as never })).solids.find((s) => s.kind === "device")!;
    const p = sol.shape as { z0: number; z1: number };
    expect([sol.tag, p.z0, p.z1]).toEqual(["ac", 0, 60]);
  });

  it("a control screen is a prism tagged screen; body none leaves a point", () => {
    const scr = buildScene(floor({ devices: [{ id: "s", type: "screen", entity: "", x: 200, y: 60 }] as never })).solids.find((s) => s.kind === "device")!;
    expect([scr.tag, scr.shape.type]).toEqual(["screen", "prism"]);
    expect(buildScene(floor({ devices: [ac({ body: "none" })] as never })).solids.find((s) => s.kind === "device")!.shape.type).toBe("point");
  });

  it("is a box: the same footprint and heights the plan uses", () => {
    const sol = buildScene(floor({ devices: [ac()] as never })).solids.find((s) => s.kind === "device")!;
    expect(sol.tag).toBe("ac");
    expect(sol.shape.type).toBe("prism");
    const p = sol.shape as { base: [number, number][]; z0: number; z1: number };
    expect([p.z0, p.z1]).toEqual([195, 225]);
    expect(span(p.base.map((q) => q[0]))).toEqual([160, 240]);
    expect(span(p.base.map((q) => q[1]))).toEqual([5, 27]);
  });
});
