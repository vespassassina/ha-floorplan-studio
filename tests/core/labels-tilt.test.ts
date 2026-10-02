import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import type { Layout } from "../../src/core/schema";
import { DEFAULT_TILT, OBLIQUE, clampTilt, obliqueFor, renderFloor, viewBoxFor } from "../../src/core/render";

const L = demo as unknown as Layout;
const ground = L.floors.ground;
const STATE = {
  "sensor.demo_living_temperature": { state: "21.5", attributes: { unit_of_measurement: "°C" }, last_changed: "2026-10-02T10:00:00Z" },
};

/** One floor per text-producing kind, so a new kind of text must be added here (CLAUDE.md finding 17). */
const sq = (x: number, y: number, s: number): [number, number][] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
const base = (o: object) => ({ title: "T", outline: sq(0, 0, 600), rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [], ...o }) as unknown as typeof ground;
const KINDS: Record<string, { floor: typeof ground; opts?: object; marker: RegExp }> = {
  "room name": { floor: base({ rooms: [{ id: "r", name: "Living", kind: "room", pts: sq(0, 0, 600) }] }), marker: /class="lbl"/ },
  "zone name": { floor: base({ rooms: [{ id: "z", name: "Corner", kind: "zone", pts: sq(100, 100, 300) }] }), marker: /class="lbl zone"/ },
  "room name with leader": { floor: base({ rooms: [{ id: "r", name: "A very long room name indeed", kind: "room", pts: sq(0, 0, 60) }] }), marker: /class="lbl-leader"/ },
  "extra name": { floor: base({ extras: [{ id: "e", name: "Shed", a: [100, 100], b: [300, 300] }] }), marker: />Shed</ },
  "device name": { floor: base({ devices: [{ id: "d", type: "light", entity: "light.x", name: "Lamp", x: 300, y: 300 }] }), opts: { showNames: true }, marker: />Lamp</ },
  "unlinked name": { floor: base({ unlinked: [{ id: "u", type: "tv", name: "Telly", x: 300, y: 300, rot: 0, scale: 1 }] }), opts: { showNames: true }, marker: />Telly</ },
  "sensor value": { floor: base({ devices: [{ id: "t", type: "temp", entity: "sensor.demo_living_temperature", x: 300, y: 300 }] }), opts: { state: STATE }, marker: /class="val"/ },
};

describe("labels option", () => {
  for (const [kind, { floor, opts, marker }] of Object.entries(KINDS)) {
    it(`${kind}: drawn by default, gone with labels false`, () => {
      const on = renderFloor(floor, { scale: 1, ...opts });
      expect(on).toMatch(marker);
      const off = renderFloor(floor, { scale: 1, ...opts, labels: false });
      expect(off).not.toContain("<text");
      expect(off).not.toMatch(marker);
      expect(off).not.toContain("lbl-leader");
    });
  }

  it("absent and true are byte-identical", () => {
    const o = { scale: 0.5, showNames: true, state: STATE };
    expect(renderFloor(ground, { ...o, labels: true })).toBe(renderFloor(ground, o));
    expect(renderFloor(ground, { ...o, view: "2.5d", labels: true })).toBe(renderFloor(ground, { ...o, view: "2.5d" }));
  });

  it("the whole demo has no text left with labels false, in both views and rotated", () => {
    for (const fl of Object.values(L.floors))
      for (const view of ["2d", "2.5d"] as const) {
        const html = renderFloor(fl, { scale: 0.5, showNames: true, state: STATE, view, labels: false, selection: { t: "dev", i: 0 }, rotate: { deg: 30, pivot: [0, 0] } });
        expect(html).not.toContain("<text");
        expect(html).not.toContain("lbl");
      }
  });

  it("keeps icons and tap targets", () => {
    const withText = renderFloor(ground, { scale: 0.5, state: STATE });
    const without = renderFloor(ground, { scale: 0.5, state: STATE, labels: false });
    const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
    for (const re of [/data-x="/g, /data-d="/g, /class="room[ "]/g]) expect(count(without, re)).toBe(count(withText, re));
    expect(count(without, /data-x="/g)).toBeGreaterThan(0);
    expect(without.length).toBeLessThan(withText.length);
  });
});

describe("tilt mapping", () => {
  it("the default tilt is exactly today's OBLIQUE", () => {
    expect(obliqueFor(DEFAULT_TILT)).toEqual(OBLIQUE);
    expect(OBLIQUE).toEqual({ rise: 0.55, skew: 0.3, cutaway: 90 });
  });

  it("more tilt, more lift; tilt 0 has none; the top is capped", () => {
    const rises = [0, 0.1, 0.25, 0.5, 0.75, 1].map((t) => obliqueFor(t).rise);
    expect(rises[0]).toBe(0);
    for (let i = 1; i < rises.length; i++) expect(rises[i]).toBeGreaterThan(rises[i - 1]);
    expect(obliqueFor(1).rise).toBeCloseTo(1.1, 6);
  });

  it("the cutaway keeps what a front wall hides roughly constant on screen, finite at every tilt", () => {
    for (const t of [0.1, 0.25, 0.5, 0.75, 1]) {
      const o = obliqueFor(t);
      expect(o.cutaway).toBeGreaterThan(0);
      expect(o.cutaway * o.rise).toBeLessThanOrEqual(55);
    }
    expect(obliqueFor(1).cutaway).toBeLessThan(obliqueFor(0.5).cutaway);
    expect(Number.isFinite(obliqueFor(0).cutaway)).toBe(true);
  });

  it("clamps out-of-range to 0..1, junk to the default", () => {
    expect(clampTilt(-3)).toBe(0);
    expect(clampTilt(7)).toBe(1);
    for (const j of ["0.2", NaN, Infinity, null, undefined, {}, []]) expect(clampTilt(j)).toBe(DEFAULT_TILT);
    expect(clampTilt(0.8)).toBe(0.8);
    expect(obliqueFor(99)).toEqual(obliqueFor(1));
    expect(obliqueFor(NaN)).toEqual(OBLIQUE);
  });

  it("default tilt output is byte-identical to no tilt", () => {
    expect(renderFloor(ground, { scale: 0.5, view: "2.5d", tilt: DEFAULT_TILT })).toBe(renderFloor(ground, { scale: 0.5, view: "2.5d" }));
    expect(viewBoxFor(ground, 60, undefined, "2.5d", DEFAULT_TILT)).toEqual(viewBoxFor(ground, 60, undefined, "2.5d"));
  });

  it("tilt does nothing in 2d", () => {
    expect(renderFloor(ground, { scale: 0.5, tilt: 1 })).toBe(renderFloor(ground, { scale: 0.5 }));
    expect(viewBoxFor(ground, 60, undefined, "2d", 1)).toEqual(viewBoxFor(ground, 60));
  });

  it("the view box widens by the actual lift at every tilt", () => {
    const f = { ...structuredClone(ground), height: 400 } as typeof ground;
    const flat = viewBoxFor(f, 60);
    for (const t of [0, 0.25, 0.5, 1]) {
      const o = obliqueFor(t), b = viewBoxFor(f, 60, undefined, "2.5d", t);
      expect(flat.y - b.y).toBeCloseTo(400 * o.rise, 6);
      expect(b.w - flat.w).toBeCloseTo(400 * o.rise * o.skew, 6);
    }
    expect(viewBoxFor(f, 60, undefined, "2.5d", 0)).toEqual(flat);
  });

  it("every drawn wall point of a 2.5d plan is inside the view box at tilt 0, 0.5 and 1", () => {
    for (const t of [0, 0.5, 1]) {
      const b = viewBoxFor(ground, 0, undefined, "2.5d", t);
      const html = renderFloor(ground, { scale: 1, view: "2.5d", tilt: t });
      const polys = [...html.matchAll(/<polygon class="(?:ws|bs|bt|glass)[^"]*" points="([^"]+)"/g)].flatMap((m) => m[1].trim().split(/\s+/).map((p) => p.split(",").map(Number)));
      const tops = [...html.matchAll(/<line class="eh?[^"]* top" x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/g)].flatMap((m) => [[+m[1], +m[2]], [+m[3], +m[4]]]);
      expect(polys.length).toBeGreaterThan(0);
      expect(tops.length).toBeGreaterThan(0);
      const eps = 1e-2;
      for (const [x, y] of [...polys, ...tops]) {
        expect(x).toBeGreaterThanOrEqual(b.x - eps); expect(x).toBeLessThanOrEqual(b.x + b.w + eps);
        expect(y).toBeGreaterThanOrEqual(b.y - eps); expect(y).toBeLessThanOrEqual(b.y + b.h + eps);
      }
      // The box is tight on top: the highest wall top is the box's own top edge, so nothing is wasted either.
      expect(Math.min(...tops.map((p) => p[1]))).toBeGreaterThanOrEqual(b.y - eps);
    }
  });

  it("tilt 0 draws no side-face area; more tilt draws more", () => {
    const area = (html: string, cls: string) => {
      let sum = 0;
      for (const m of html.matchAll(new RegExp(`<polygon class="${cls}[^"]*" points="([^"]+)"`, "g"))) {
        const q = m[1].trim().split(/\s+/).map((p) => p.split(",").map(Number));
        sum += Math.abs(q.reduce((s, a, i) => { const c = q[(i + 1) % q.length]; return s + a[0] * c[1] - c[0] * a[1]; }, 0)) / 2;
      }
      return sum;
    };
    const at = (t: number) => renderFloor(ground, { scale: 1, view: "2.5d", tilt: t });
    expect(area(at(0), "ws")).toBeCloseTo(0, 3);
    expect(area(at(0), "bs")).toBeCloseTo(0, 3);
    expect(area(at(1), "ws")).toBeGreaterThan(area(at(0.5), "ws"));
    expect(area(at(0.5), "ws")).toBeGreaterThan(area(at(0.25), "ws"));
  });
});
