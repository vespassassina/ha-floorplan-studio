import { describe, it, expect } from "vitest";
import { OBLIQUE, renderFloor } from "../../src/core/render";
import { OPENING_FILL } from "../../src/core/solids";
import { DOOR_KINDS, type Floor } from "../../src/core/schema";

const R = OBLIQUE.rise, K = OBLIQUE.skew;
const n = (v: number) => String(Math.round(v * 100) / 100);
/** Where plan (x, y) at height h is drawn on an unturned plan. */
const P = (x: number, y: number, h: number) => `${n(x + h * K * R)},${n(y - h * R)}`;
const floor = (o: Partial<Floor> = {}): Floor => ({
  title: "T", outline: [[0, 0], [400, 0], [400, 300], [0, 300]], owk: ["external", "none", "none", "none"], rooms: [],
  walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [], ...o,
});
const flat = (f: Floor) => renderFloor(f, { scale: 1 });
const deep = (f: Floor) => renderFloor(f, { scale: 1, view: "2.5d" });
const faces = (html: string) => [...html.matchAll(/<polygon class="ws[^"]*" points="([^"]*)"\/>/g)].map((m) => m[1]);
const glass = (html: string) => [...html.matchAll(/<polygon class="(glass [^"]*)" points="([^"]*)"\/>/g)].map((m) => `${m[1]}|${m[2]}`);
/** The back wall (y = 0, x 0 to 400, 250 high) with one door or window in it, x 100 to 200. */
const withDoor = (d: Record<string, unknown>) => floor({ doors: [{ id: "d", name: "D", kind: "door", a: [100, 0], b: [200, 0], ...d }] as never });
const box = (x0: number, x1: number, z0: number, z1: number) => `${P(x0, 0, z0)} ${P(x1, 0, z0)} ${P(x1, 0, z1)} ${P(x0, 0, z1)}`;

describe("2.5D openings", () => {
  it("a door is a gap with a header over it: the wall runs either side and closes above 210 cm", () => {
    const f = faces(deep(withDoor({})));
    expect(f).toContain(box(0, 100, 0, 250));
    expect(f).toContain(box(200, 400, 0, 250));
    expect(f).toContain(box(100, 200, 210, 250));
    expect(glass(deep(withDoor({})))).toEqual([]);
    // Nothing is drawn between the jambs below the head.
    expect(f.filter((q) => q.startsWith(`100,0 200,0 `)).length).toBe(0);
  });

  it("a window has a block under the sill, a glass band and a header", () => {
    const html = deep(withDoor({ kind: "window" }));
    expect(faces(html)).toContain(box(100, 200, 0, 90));
    expect(glass(html)).toEqual([`glass g-window|${box(100, 200, 90, 210)}`]);
    expect(faces(html)).toContain(box(100, 200, 210, 250));
  });

  it("an own sill and height move the band", () => {
    expect(glass(deep(withDoor({ kind: "window", sill: 40, height: 60 })))).toEqual([`glass g-window|${box(100, 200, 40, 100)}`]);
  });

  it("a glass door is glass from the floor", () => {
    expect(glass(deep(withDoor({ kind: "glass" })))).toEqual([`glass g-glass|${box(100, 200, 0, 210)}`]);
  });

  it("a sealed door is a solid panel, not a gap", () => {
    expect(faces(deep(withDoor({ kind: "sealed" })))).toContain(box(100, 200, 0, 210));
  });

  it("an opening is a gap", () => {
    const f = faces(deep(floor({ openings: [{ id: "o", a: [100, 0], b: [200, 0] }] as never })));
    expect(f.filter((q) => q.startsWith("100,0 200,0 ")).length).toBe(0);
    expect(f).toContain(box(100, 200, 210, 250));
  });

  it("a door as tall as the wall leaves no header, and the top is broken over it", () => {
    const html = deep(withDoor({ height: 250 }));
    expect(faces(html)).not.toContain(box(100, 200, 210, 250));
    expect(html.match(/<line class="e external top"/g)?.length).toBe(2); // left of the door and right of it
  });

  it("a window in a cut-away front wall: the block takes the whole low wall and no glass shows", () => {
    const html = deep(floor({ owk: ["none", "none", "external", "none"], doors: [{ id: "d", name: "D", kind: "window", a: [100, 300], b: [200, 300] }] as never }));
    expect(glass(html)).toEqual([]);
    expect(faces(html)).toContain(`${P(200, 300, 0)} ${P(100, 300, 0)} ${P(100, 300, 90)} ${P(200, 300, 90)}`);
  });

  it("a door elsewhere in the plan does not cut the wall", () => {
    expect(faces(deep(withDoor({ a: [100, 120], b: [200, 120] })))).toContain(box(0, 400, 0, 250));
  });

  it("the floor-level door line keeps its state class and its alert, and is only a threshold wide", () => {
    const f = withDoor({ sensors: ["binary_sensor.d"] });
    const html = renderFloor(f, { scale: 1, view: "2.5d", state: { "binary_sensor.d": { state: "on", attributes: {}, last_changed: "2026-09-19T10:00:00Z" } } });
    expect(html).toMatch(/<line data-d="0" class="door door-door open" [^>]*stroke-width="4"/);
    expect(html).toContain('class="door-alert"');
    expect(flat(f)).toMatch(/<line data-d="0" class="door door-door" [^>]*stroke-width="20"/);
  });

  it("decides every DoorKind (a new kind fails here until someone chooses what fills its hole)", () => {
    expect(Object.keys(OPENING_FILL).sort()).toEqual([...DOOR_KINDS, "opening"].sort());
    for (const kind of DOOR_KINDS) {
      const html = deep(withDoor({ kind, sill: 0, height: 100 }));
      const fill = OPENING_FILL[kind];
      expect(glass(html).length, kind).toBe(fill === "glass" ? 1 : 0);
      expect(html.includes('class="ws sealed"'), kind).toBe(fill === "panel");
    }
  });

  it("escapes an unknown door kind", () => {
    expect(deep(withDoor({ kind: '"><script>' }))).not.toContain("<script>");
  });
});
