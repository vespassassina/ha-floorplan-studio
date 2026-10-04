import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import { renderFloor } from "../../src/core/render";
import type { Floor, Layout } from "../../src/core/schema";

// Diego, 0.12.23: "walls still look like 2d + hat". A wall face is lit like a solid (three tones by which way it looks on
// screen), has a darker foot and a lit top edge, and the cap on top is thinner than the flat wall. At tilt 0 a wall has no
// face and is drawn as before.

const ground = (demo as unknown as Layout).floors.ground;
const box = (o: Partial<Floor> = {}): Floor => ({
  title: "T", outline: [[0, 0], [400, 0], [400, 300], [0, 300]], owk: ["external", "external", "external", "external"], rooms: [],
  walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [], ...o,
});
const deep = (f: Floor, o: Record<string, unknown> = {}) => renderFloor(f, { scale: 1, view: "2.5d", ...o });
const faceClasses = (html: string) => [...html.matchAll(/<polygon class="(ws[^"]*)" points/g)].map((m) => m[1]);
const tones = (html: string) => new Set(faceClasses(html).map((c) => (c.includes(" lit") ? "lit" : c.includes(" dim") ? "dim" : "plain")));

describe("a wall face is lit by which way it looks on screen", () => {
  it("the demo ground floor at rotation 0 shows a lit side and a plain front (the skew hides the dim side); turned round, the dim side shows", () => {
    expect([...tones(deep(ground))].sort()).toEqual(["lit", "plain"]);
    const all = new Set<string>();
    for (let deg = 0; deg < 360; deg += 30) for (const t of tones(deep(ground, { rotate: { deg, pivot: [400, 300] } }))) all.add(t);
    expect(all.has("dim")).toBe(true);
  });
  it("opposite faces of one box differ; turning the plan changes which face is lit, never how many tones there are", () => {
    const seen = new Set<string>();
    for (let deg = 0; deg < 360; deg += 15) {
      const html = deep(box(), { rotate: { deg, pivot: [200, 150] } });
      const cs = faceClasses(html);
      expect(cs.length, `${deg}`).toBeGreaterThan(0);
      for (const c of cs) seen.add(c.includes(" lit") ? "lit" : c.includes(" dim") ? "dim" : "plain");
    }
    expect([...seen].sort()).toEqual(["dim", "lit", "plain"]);
  });
  it("the rotation is real: a front wall that is plain at 0 degrees is not plain at 90", () => {
    const front = (deg: number) => faceClasses(deep(box({ outline: [[0, 0], [400, 0], [400, 20], [0, 20]], owk: ["none", "none", "none", "none"], walls: [{ id: "w", a: [0, 300], b: [400, 300], kind: "wall" }] as never }), { rotate: { deg, pivot: [200, 150] } }))[0];
    expect(front(0)).not.toMatch(/lit|dim/);
    expect(front(90)).toMatch(/lit|dim/);
  });
  it("every wall piece draws a darker foot and a lit top edge", () => {
    const html = deep(box());
    expect((html.match(/class="wfoot"/g) ?? []).length).toBeGreaterThanOrEqual(faceClasses(html).length);
    expect((html.match(/class="wl"/g) ?? []).length).toBeGreaterThan(0);
  });
  it("a door gap has no foot across it: the foot sits under the blocks either side only", () => {
    const f = box({ doors: [{ id: "d", name: "D", kind: "door", a: [100, 0], b: [200, 0] }] as never });
    const feet = [...deep(f).matchAll(/<polygon class="wfoot" points="([^"]*)"/g)].map((m) => m[1]);
    expect(feet.some((p) => p.includes("100") && p.includes("200"))).toBe(false);
  });
});

describe("the cap of a wall is thinner than the flat wall, and thins with the tilt", () => {
  const capWidth = (tilt: number, kind: "external" | "wall") => {
    const f = kind === "external" ? box() : box({ owk: ["none", "none", "none", "none"], walls: [{ id: "w", a: [0, 150], b: [400, 150], kind: "wall" }] as never });
    const m = deep(f, { tilt }).match(new RegExp(`<line class="e${kind === "wall" ? "" : " external"} top"[^>]*style="stroke-width:([\\d.]+)"`));
    return m ? +m[1] : null;
  };
  it("at the default tilt an external cap is 12 cm, a wall cap 7, against 20 and 10 flat", () => {
    expect(capWidth(0.5, "external")).toBe(12);
    expect(capWidth(0.5, "wall")).toBe(7);
  });
  it("a steeper tilt does not thin it further; a shallower one thins it less, in proportion to the lift", () => {
    expect(capWidth(1, "external")).toBe(12);
    const half = capWidth(0.25, "external")!;
    expect(half).toBeGreaterThan(12);
    expect(half).toBeLessThan(20);
  });
  it("the halo under the cap is 2 cm wider, as the flat halo is", () => {
    const m = deep(box(), { tilt: 0.5 }).match(/<line class="eh external top"[^>]*style="stroke-width:([\d.]+)"/);
    expect(+m![1]).toBe(14);
  });
});

describe("at tilt 0 and in 2D nothing new is drawn", () => {
  it("2D has none of the 2.5D markup", () => {
    const html = renderFloor(ground, { scale: 1 });
    expect(html).not.toMatch(/wfoot|class="wl"|class="ws|door-leaf|class="opn|stroke-width:\d/);
  });
  it("tilt 0: faces have no tone, no foot, no top edge, no leaf, and the caps keep the stylesheet's width", () => {
    const html = deep(ground, { tilt: 0 });
    expect(html).not.toMatch(/wfoot|class="wl"|door-leaf|class="opn| lit| dim/);
    expect(html).not.toMatch(/class="(e|eh)[^"]* top"[^>]*style=/);
  });
});
