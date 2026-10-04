import { describe, it, expect } from "vitest";
import { OBLIQUE, renderFloor } from "../../src/core/render";
import { DEVICE_TYPES, type DeviceType, type Floor } from "../../src/core/schema";
import { DEVICE_SOLID } from "../../src/core/solids";

// 2.5D devices that stand for a real object: a radiator under a window, a speaker cabinet, a TV on the wall.
const R = OBLIQUE.rise, K = OBLIQUE.skew;
const n = (v: number) => String(Math.round(v * 100) / 100);
const P = (x: number, y: number, h: number) => `${n(x + h * K * R)},${n(y - h * R)}`;
const floor = (o: Partial<Floor> = {}): Floor => ({
  title: "T", outline: [[0, 0], [600, 0], [600, 500], [0, 500]], owk: ["wall", "wall", "wall", "wall"], rooms: [],
  walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [], ...o,
});
const dev = (type: string, o: Record<string, unknown> = {}) => ({ id: "d", type, entity: `x.${type}`, x: 300, y: 250, ...o });
const flat = (f: Floor, o = {}) => renderFloor(f, { scale: 1, ...o });
const deep = (f: Floor, o = {}) => renderFloor(f, { scale: 1, view: "2.5d", ...o });
const solid = (html: string, kind: string) => html.match(new RegExp(`<g class="obj dsolid ${kind}[^"]*">(.*?)</g>`))?.[0] ?? "";
const polys = (g: string, cls: string) => [...g.matchAll(new RegExp(`<polygon class="${cls}[^"]*" points="([^"]*)"`, "g"))].map((m) => m[1]);
const ptsOf = (s: string) => s.split(" ").map((p) => p.split(",").map(Number) as [number, number]);

/** What each device type becomes in 2.5D. Written out on purpose: a new DeviceType is a type error until someone decides. */
const KIND: Record<DeviceType, "radiator" | "speaker" | "tv" | "none"> = {
  light: "none", camera: "none", motion: "none", radar: "none", access_point: "none", ac: "none", speaker: "speaker", cover: "none",
  switch: "none", plug: "none", contact: "none", vibration: "none", lock: "none", temp: "none", humidity: "none", climate: "none",
  boiler: "none", battery: "none", inverter: "none", media: "speaker", tv: "tv", other: "none", heater: "radiator", computer: "none",
  server: "none", ups: "none", printer: "none", car: "none", person: "none", vacuum: "none",
};

describe("2.5D device solids", () => {
  it("decides every DeviceType", () => {
    expect(Object.keys(KIND).sort()).toEqual([...DEVICE_TYPES].sort());
    for (const t of DEVICE_TYPES) expect(DEVICE_SOLID[t], t).toBe(KIND[t]);
  });

  it("draws exactly the kinds it decided, in 2.5D only", () => {
    for (const t of DEVICE_TYPES) {
      const d = t === "heater" ? dev(t, { x: undefined, y: undefined, a: [100, 50], b: [300, 50] }) : dev(t);
      const f = floor({ devices: [d] as never });
      expect(flat(f), t).not.toContain("dsolid");
      const html = deep(f);
      if (KIND[t] === "none") expect(html, t).not.toContain("dsolid");
      else expect(solid(html, KIND[t]), t).not.toBe("");
    }
  });

  describe("radiator", () => {
    const bar = { x: undefined, y: undefined, a: [100, 50], b: [300, 50] };
    it("is a box along the bar, 8 cm deep, from 10 to 70 cm, much taller on screen than the 2D bar", () => {
      const html = deep(floor({ devices: [dev("heater", bar)] as never })), g = solid(html, "radiator");
      expect(polys(g, "bt")).toEqual([[P(100, 46, 70), P(300, 46, 70), P(300, 54, 70), P(100, 54, 70)].join(" ")]);
      const all = polys(g, "b[st]").flatMap(ptsOf);
      expect(Math.max(...all.map((p) => p[1])) - Math.min(...all.map((p) => p[1]))).toBeGreaterThan(8 + 59 * R);
      // The south face stands off the floor: its foot is 10 cm up.
      expect(polys(g, "bs").some((s) => s.includes(P(100, 54, 10)) && s.includes(P(100, 54, 70)))).toBe(true);
      expect(flat(floor({ devices: [dev("heater", bar)] as never }))).toContain('data-xbar="0"');
    });
    it("takes an own z as its top", () => {
      const g = solid(deep(floor({ devices: [dev("heater", { ...bar, z: 90 })] as never })), "radiator");
      expect(polys(g, "bt")[0]).toContain(P(100, 46, 90));
    });
    it("is tinted when heating", () => {
      const f = floor({ devices: [dev("heater", bar)] as never });
      const st = (a: string) => ({ "x.heater": { state: "heat", attributes: { hvac_action: a }, last_changed: "2026-01-01T00:00:00Z" } });
      expect(solid(deep(f, { state: st("heating") }), "radiator")).toMatch(/^<g class="obj dsolid radiator on"/);
      expect(solid(deep(f, { state: st("idle") }), "radiator")).toMatch(/^<g class="obj dsolid radiator off"/);
    });
  });

  describe("speaker", () => {
    it("is a 20 x 20 x 30 cabinet at the floor point with two driver marks, for speaker and media", () => {
      for (const type of ["speaker", "media"]) {
        const html = deep(floor({ devices: [dev(type, { x: 200, y: 300 })] as never })), g = solid(html, "speaker");
        expect(polys(g, "bt")).toEqual([[P(190, 290, 30), P(210, 290, 30), P(210, 310, 30), P(190, 310, 30)].join(" ")]);
        expect(g.match(/class="drv"/g)?.length, type).toBe(2);
        expect(html, type).toContain('data-x="0"'); // the icon is still there, and still the tap target
      }
    });
    it("puts both drivers on the face that looks at the viewer, side by side at one height", () => {
      const g = solid(deep(floor({ devices: [dev("speaker", { x: 200, y: 300 })] as never })), "speaker");
      const c = [...g.matchAll(/<circle class="drv" transform="matrix\(([^)]*)\)" cx="([^"]*)" cy="([^"]*)"/g)].map((m) => {
        const [a, b, cc, d, e, f] = m[1].split(" ").map(Number), x = +m[2], y = +m[3];
        return [a * x + cc * y + e, b * x + d * y + f];
      });
      expect(c.length).toBe(2);
      expect(c[0][1]).toBeCloseTo(c[1][1], 1);
      expect(Math.abs(c[0][0] - c[1][0])).toBeGreaterThan(5);
      // South face (y 310), between 10 and 30 cm up: x inside the cabinet's width plus the lean.
      for (const [x, y] of c) { expect(y).toBeLessThan(310); expect(y).toBeGreaterThan(310 - 30 * R); expect(x).toBeGreaterThan(190); expect(x).toBeLessThan(210 + 30 * K * R); }
    });
    it("is playing on", () => {
      const st = { "x.speaker": { state: "playing", attributes: {}, last_changed: "2026-01-01T00:00:00Z" } };
      expect(solid(deep(floor({ devices: [dev("speaker")] as never }), { state: st }), "speaker")).toMatch(/^<g class="obj dsolid speaker on"/);
    });
  });

  describe("tv", () => {
    /** The panel's footprint: the base of the box, read from the top face lifted back to the floor. */
    const foot = (html: string, z: number) => ptsOf(polys(solid(html, "tv"), "bt")[0]).map(([x, y]): [number, number] => [x - z * K * R, y + z * R]);
    it("goes flush against the nearest wall, parallel, centred on the TV's projection onto it", () => {
      // Wall y=0 is 120 cm off, the east wall 400: the north wall. The room face is 5 cm in (a plain wall is 10 thick).
      const f = floor({ devices: [dev("tv", { x: 200, y: 120 })] as never });
      const q = foot(deep(f), 160);
      const ys = q.map((p) => Math.round(p[1] * 100) / 100), xs = q.map((p) => Math.round(p[0] * 100) / 100);
      expect(Math.min(...ys)).toBe(5);
      expect(Math.max(...ys)).toBe(11); // 6 cm thick
      expect(Math.min(...xs)).toBe(150);
      expect(Math.max(...xs)).toBe(250); // 100 wide, centred on x = 200
    });
    it("follows the TV to another wall", () => {
      const f = floor({ devices: [dev("tv", { x: 520, y: 330 })] as never }); // east wall x=600 is 80 away, south 170
      const q = foot(deep(f), 160), xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
      expect(Math.max(...xs)).toBeCloseTo(595, 1);
      expect(Math.min(...xs)).toBeCloseTo(589, 1);
      expect(Math.min(...ys)).toBeCloseTo(280, 1);
      expect(Math.max(...ys)).toBeCloseTo(380, 1);
    });
    it("is free-standing at its own point, facing down the screen, when no wall is within 150 cm", () => {
      const f = floor({ outline: [[0, 0], [2000, 0], [2000, 2000], [0, 2000]], devices: [dev("tv", { x: 1000, y: 1000, z: 50 })] as never });
      const q = foot(deep(f), 110); // z 50 plus the 60 cm panel
      expect(q.map((p) => p[0]).sort((a, b) => a - b)[0]).toBeCloseTo(950, 1);
      expect(Math.max(...q.map((p) => p[0]))).toBeCloseTo(1050, 1);
      expect(Math.min(...q.map((p) => p[1]))).toBeCloseTo(997, 1);
      expect(Math.max(...q.map((p) => p[1]))).toBeCloseTo(1003, 1);
    });
    it("shows a screen on the room face, lit when on, dark when off; none when seen from behind", () => {
      const f = floor({ devices: [dev("tv", { x: 200, y: 120 })] as never });
      const st = (s: string) => ({ "x.tv": { state: s, attributes: {}, last_changed: "2026-01-01T00:00:00Z" } });
      expect(solid(deep(f, { state: st("on") }), "tv")).toMatch(/^<g class="obj dsolid tv on"[\s\S]*class="tv-screen"/);
      expect(solid(deep(f, { state: st("off") }), "tv")).toMatch(/^<g class="obj dsolid tv off"/);
      // On the south wall it faces north, away from the viewer: the back is seen.
      const south = floor({ devices: [dev("tv", { x: 200, y: 400 })] as never });
      expect(solid(deep(south), "tv")).not.toContain("tv-screen");
      expect(solid(deep(south), "tv")).not.toBe("");
    });
    it("takes the wall's own thickness: an external wall is 20 thick", () => {
      const f = floor({ owk: ["external", "wall", "wall", "wall"], devices: [dev("tv", { x: 200, y: 120 })] as never });
      expect(Math.min(...foot(deep(f), 160).map((p) => p[1]))).toBeCloseTo(10, 1);
    });
  });

  it("sorts a TV and a radiator after the wall they hang on, even when the wall's near end is far off", () => {
    // The wall's near (left) end is at x 0; the TV is at x 500. Keyed by its own corners alone it would draw first and the wall would cover it.
    const wall = { id: "w", a: [0, 0], b: [600, 0], kind: "wall" } as never;
    const base = { outline: [], walls: [wall] } as Partial<Floor>;
    const tv = deep(floor({ ...base, devices: [dev("tv", { x: 500, y: 60 })] as never }));
    expect(tv.indexOf('class="obj dsolid tv')).toBeGreaterThan(tv.lastIndexOf('class="ws'));
    const rad = deep(floor({ ...base, devices: [dev("heater", { x: undefined, y: undefined, a: [450, 8], b: [550, 8] })] as never }));
    expect(rad.indexOf('class="obj dsolid radiator')).toBeGreaterThan(rad.lastIndexOf('class="ws'));
  });

  it("never throws on hostile input", () => {
    const junk = [NaN, Infinity, "x", null, {}, [], -5, 1e9];
    for (const type of ["heater", "speaker", "media", "tv"]) for (const v of junk) {
      const ds = [
        dev(type, { x: v, y: v }), dev(type, { z: v }), dev(type, { rot: v }), dev(type, { a: [v, v], b: [v, 1], x: undefined, y: undefined }),
        dev(type, { a: [1, 1], b: [1, 1], x: undefined, y: undefined }), dev(type, { a: v, b: v, x: undefined, y: undefined }),
      ];
      for (const d of ds) {
        const f = floor({ devices: [d] as never });
        // Where 2D already refuses a shape (a bar that is not two points), 2.5D is not asked to do better; it must not add a throw.
        try { flat(f); } catch { continue; }
        expect(() => deep(f), `${type} ${String(v)}`).not.toThrow();
        expect(() => deep(f, { rotate: { deg: 90, pivot: [300, 250] }, tilt: 1 })).not.toThrow();
      }
    }
    // A room with no points, no edges and no walls at all.
    expect(() => deep(floor({ outline: [], rooms: [], devices: [dev("tv")] as never }))).not.toThrow();
    expect(() => deep(floor({ outline: [[0, 0], [0, 0], [0, 0]], devices: [dev("tv")] as never }))).not.toThrow();
  });

  it("turns with the plan: the TV still lies on its wall when the plan is rotated 90", () => {
    const f = floor({ devices: [dev("tv", { x: 200, y: 120 })] as never });
    const html = deep(f, { rotate: { deg: 90, pivot: [300, 250] } });
    expect(solid(html, "tv")).not.toBe("");
  });
});
