import { describe, it, expect } from "vitest";
import { OBLIQUE, renderFloor } from "../../src/core/render";
import type { Floor } from "../../src/core/schema";

const R = OBLIQUE.rise, K = OBLIQUE.skew;
const n = (v: number) => String(Math.round(v * 100) / 100);
/** Where plan (x, y) at height h is drawn on an unturned plan. */
const P = (x: number, y: number, h: number) => `${n(x + h * K * R)},${n(y - h * R)}`;
const floor = (o: Partial<Floor> = {}): Floor => ({
  title: "T", outline: [[0, 0], [400, 0], [400, 300], [0, 300]], owk: ["external", "external", "external", "external"],
  rooms: [{ id: "r0", name: "Room", kind: "room", pts: [[0, 0], [400, 0], [400, 300], [0, 300]], wk: ["wall", "wall", "wall", "wall"] } as never],
  walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [], ...o,
});
const flat = (f: Floor) => renderFloor(f, { scale: 1 });
const deep = (f: Floor) => renderFloor(f, { scale: 1, view: "2.5d" });
const faces = (html: string) => [...html.matchAll(/<polygon class="ws[^"]*" points="([^"]*)"\/>/g)].map((m) => m[1]);

describe("2.5D walls", () => {
  it("2d draws no wall face; 2.5d draws side faces and a top for every wall", () => {
    expect(faces(flat(floor()))).toEqual([]);
    expect(deep(floor()).match(/class="e external top"/g)?.length).toBe(4);
  });

  it("a back wall keeps the storey height, lifted by the projection", () => {
    // Back wall: y = 0, left to right, 250 cm. Its face is the quad base-left, base-right, top-right, top-left.
    expect(faces(deep(floor()))).toContain(`0,0 400,0 ${P(400, 0, 250)} ${P(0, 0, 250)}`);
  });

  it("a front wall (outward normal down the screen) is cut away to OBLIQUE.cutaway", () => {
    const f = faces(deep(floor()));
    const cut = Math.min(250, OBLIQUE.cutaway);
    expect(f).toContain(`400,300 0,300 ${P(0, 300, cut)} ${P(400, 300, cut)}`);
    expect(f.filter((q) => q.startsWith("400,300 0,300")).length).toBe(1); // only the cut one, no full-height twin
  });

  it("side walls keep full height", () => {
    const f = faces(deep(floor()));
    expect(f).toContain(`0,300 0,0 ${P(0, 0, 250)} ${P(0, 300, 250)}`);
    expect(f).toContain(`400,0 400,300 ${P(400, 300, 250)} ${P(400, 0, 250)}`);
  });

  it("a wall lower than the cutaway is not raised to it", () => {
    const f = floor({ owk: ["none", "none", "none", "none"] }); (f.rooms[0] as { height?: number }).height = 60;
    expect(faces(deep(f))).toContain(`400,300 0,300 ${P(0, 300, 60)} ${P(400, 300, 60)}`);
  });

  it("draws farther walls first, so a near one covers it", () => {
    const html = deep(floor()), back = html.indexOf(`points="0,0 400,0 `), front = html.indexOf(`points="400,300 0,300 `);
    expect(back).toBeGreaterThan(-1);
    expect(front).toBeGreaterThan(back);
  });

  it("draws an edge two rooms share once", () => {
    const f = floor({
      rooms: [
        { id: "a", name: "A", kind: "room", pts: [[0, 0], [200, 0], [200, 300], [0, 300]], wk: ["wall", "wall", "wall", "wall"] },
        { id: "b", name: "B", kind: "room", pts: [[200, 0], [400, 0], [400, 300], [200, 300]], wk: ["wall", "wall", "wall", "wall"] },
      ] as never,
    });
    // The shared edge is x = 200 from y 0 to 300: a's edge 1 goes down, b's edge 3 goes up.
    const shared = faces(deep(f)).filter((q) => q.includes(P(200, 0, 250)) && q.includes(P(200, 300, 250)));
    expect(shared.length).toBe(1);
  });

  it("boundary, edge and none kinds stay flat, exactly as in 2d", () => {
    const f = floor({ owk: ["none", "none", "none", "none"] }); f.rooms[0].wk = ["boundary", "edge", "none", "wall"];
    const html = deep(f);
    expect(html).toContain('class="e nw" data-e="r0:0"');
    expect(html).toContain('class="e edge" data-e="r0:1"');
    // Only r0:3, the left wall, is a real wall: one face, and nothing for the three flat edges.
    expect(faces(html)).toEqual([`0,300 0,0 ${P(0, 0, 250)} ${P(0, 300, 250)}`]);
  });

  it("a free wall: mostly horizontal is cut away, a vertical one keeps its height; a fence is 110", () => {
    const f = floor({ walls: [
      { id: "h", a: [50, 100], b: [250, 100], kind: "wall" }, { id: "v", a: [300, 50], b: [300, 250], kind: "wall" }, { id: "fe", a: [300, 280], b: [300, 290], kind: "fence" },
    ] as never });
    const fc = faces(deep(f));
    expect(fc).toContain(`50,100 250,100 ${P(250, 100, 90)} ${P(50, 100, 90)}`);
    expect(fc).toContain(`300,50 300,250 ${P(300, 250, 250)} ${P(300, 50, 250)}`);
    expect(fc).toContain(`300,280 300,290 ${P(300, 290, 110)} ${P(300, 280, 110)}`);
  });

  it("a wall's own height wins over the storey", () => {
    const f = floor({ walls: [{ id: "v", a: [300, 50], b: [300, 250], kind: "wall", height: 140 }] as never });
    expect(faces(deep(f))).toContain(`300,50 300,250 ${P(300, 250, 140)} ${P(300, 50, 140)}`);
  });

  it("keeps the extrusion screen-up when the plan is turned", () => {
    // Turned 180 degrees about (200, 150): the back wall (y = 0) becomes the front one, and "up" in the plan frame flips.
    const html = renderFloor(floor(), { scale: 1, view: "2.5d", rotate: { deg: 180, pivot: [200, 150] } });
    const q = faces(html).find((s) => s.startsWith("0,0 400,0"));
    // On screen, up is -y; the plan is turned by 180, so inside the group the lift points to +y of the plan.
    expect(q, "the (turned) back wall keeps its base").toBeTruthy();
    const top = q!.split(" ")[3].split(",").map(Number);
    expect(top[1]).toBeGreaterThan(0);
  });

  it("an untrusted layout does not throw: non-finite points, short polygons", () => {
    const f = floor({ walls: [{ id: "x", a: [NaN, 0], b: [10, 10], kind: "wall" }] as never });
    f.rooms.push({ id: "t", name: "t", kind: "room", pts: [[0, 0]], wk: ["wall"] } as never);
    expect(() => deep(f)).not.toThrow();
  });
});
