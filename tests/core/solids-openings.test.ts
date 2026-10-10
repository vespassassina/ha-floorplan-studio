import { describe, it, expect } from "vitest";
import { OBLIQUE, renderFloor } from "../../src/core/render";
import { FRAME_PROUD, FRAME_WIDTH, OPENING_FILL, SHUT_KINDS } from "../../src/core/solids";
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

  it("a glass door is glass from the floor while its sensor says closed, and a hole otherwise (S25.D1)", () => {
    const sensed = renderFloor(floor({ doors: [{ id: "d", name: "D", kind: "glass", a: [100, 0], b: [200, 0], sensors: ["binary_sensor.d"] }] as never }), { scale: 1, view: "2.5d", state: { "binary_sensor.d": { state: "off", attributes: {}, last_changed: "" } } });
    expect(glass(sensed)).toEqual([`glass g-glass|${box(100, 200, 0, 210)}`]);
    expect(glass(deep(withDoor({ kind: "glass" })))).toEqual([]);
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
    expect(flat(f)).toMatch(/<line data-d="0" class="door door-door quiet" [^>]*stroke-width="20"/); // S23.7: closed, the line is quiet
  });

  it("decides every DoorKind (a new kind fails here until someone chooses what fills its hole)", () => {
    expect(Object.keys(OPENING_FILL).sort()).toEqual([...DOOR_KINDS, "opening"].sort());
    for (const kind of DOOR_KINDS) {
      const html = deep(withDoor({ kind, sill: 0, height: 100 }));
      const fill = OPENING_FILL[kind];
      expect(glass(html).length, kind).toBe(fill === "glass" && !SHUT_KINDS.includes(kind) ? 1 : 0);
      expect(html.includes('class="ws sealed"'), kind).toBe(fill === "panel");
    }
  });

  it("escapes an unknown door kind", () => {
    expect(deep(withDoor({ kind: '"><script>' }))).not.toContain("<script>");
  });
});

// S28.6: a framed opening. A door, glass door, window, slit window and full window get two jambs, a head and, when the opening
// starts above the floor, a sill, each FRAME_WIDTH wide, on the face the viewer sees and FRAME_PROUD toward him.
describe("S28.6 framed openings", () => {
  const FW = FRAME_WIDTH;
  const frames = (html: string) => [...html.matchAll(/<polygon class="frame" points="([^"]*)"\/>/g)].map((m) => m[1]);
  /** The back wall at y = 0 faces the viewer to the south, so its frame stands FRAME_PROUD south of the line. */
  const Q = (x0: number, x1: number, z0: number, z1: number) => `${P(x0, FRAME_PROUD, z0)} ${P(x1, FRAME_PROUD, z0)} ${P(x1, FRAME_PROUD, z1)} ${P(x0, FRAME_PROUD, z1)}`;
  const FRAMED: Record<(typeof DOOR_KINDS)[number] | "opening", boolean> = { door: true, glass: true, window: true, slit: true, fullwindow: true, sealed: false, open: false, opening: false };

  it("decides every kind, and draws a frame for exactly the framed ones", () => {
    expect(Object.keys(FRAMED).sort()).toEqual([...DOOR_KINDS, "opening"].sort());
    for (const kind of [...DOOR_KINDS, "opening"] as const) {
      const f = kind === "opening" ? floor({ openings: [{ id: "o", a: [100, 0], b: [200, 0] }] as never }) : withDoor({ kind });
      expect(frames(deep(f)).length > 0, kind).toBe(FRAMED[kind]);
    }
  });

  it("a door: two jambs up to the head bar, a head bar, and no sill", () => {
    expect(frames(deep(withDoor({}))).sort()).toEqual([Q(100, 100 + FW, 0, 210 - FW), Q(200 - FW, 200, 0, 210 - FW), Q(100, 200, 210 - FW, 210)].sort());
  });

  it("a window with a sill: jambs between sill and head bars, plus a sill bar", () => {
    expect(frames(deep(withDoor({ kind: "window" }))).sort()).toEqual([
      Q(100, 100 + FW, 90 + FW, 210 - FW), Q(200 - FW, 200, 90 + FW, 210 - FW), Q(100, 200, 210 - FW, 210), Q(100, 200, 90, 90 + FW),
    ].sort());
  });

  it("a full window reaches the floor and has no sill bar", () => {
    const q = frames(deep(withDoor({ kind: "fullwindow" })));
    expect(q).toHaveLength(3);
    expect(q).toContain(Q(100, 100 + FW, 0, 210 - FW));
  });

  it("an own sill and height move the bars", () => {
    expect(frames(deep(withDoor({ kind: "window", sill: 40, height: 60 }))).sort()).toEqual([
      Q(100, 100 + FW, 40 + FW, 100 - FW), Q(200 - FW, 200, 40 + FW, 100 - FW), Q(100, 200, 100 - FW, 100), Q(100, 200, 40, 40 + FW),
    ].sort());
  });

  it("every frame point lies in the opening's span widened by the frame width", () => {
    for (const kind of ["door", "glass", "window", "slit", "fullwindow"]) {
      const pts = frames(deep(withDoor({ kind }))).flatMap((q) => q.split(" ").map((p) => p.split(",").map(Number)));
      expect(pts.length, kind).toBeGreaterThan(0);
      for (const [px, py] of pts) {
        const z = (FRAME_PROUD - py) / R, x = px - z * K * R;
        expect(x, `${kind} x`).toBeGreaterThanOrEqual(100 - FW - 0.01);
        expect(x, `${kind} x`).toBeLessThanOrEqual(200 + FW + 0.01);
      }
    }
  });

  it("a lowered wall lowers its frame: no head bar under the cutaway, and nothing above the wall top", () => {
    const html = renderFloor(withDoor({}), { scale: 1, view: "2.5d", walls: "low" });
    const top = Math.min(...faces(html).filter((q) => q.startsWith(`${P(0, 0, 0)} `)).flatMap((q) => q.split(" ").map((p) => +p.split(",")[1])));
    const fr = frames(html);
    expect(fr.length).toBeGreaterThan(0);
    for (const q of fr) for (const p of q.split(" ")) expect(+p.split(",")[1] + FRAME_PROUD, q).toBeGreaterThanOrEqual(top - 0.01);
    expect(fr).not.toContain(Q(100, 200, 210 - FW, 210));
  });

  it("an open door keeps its red band and still has its frame", () => {
    const html = renderFloor(floor({ doors: [{ id: "d", name: "D", kind: "door", a: [100, 0], b: [200, 0], sensors: ["binary_sensor.d"] }] as never }), { scale: 1, view: "2.5d", state: { "binary_sensor.d": { state: "on", attributes: {}, last_changed: "2026-01-01T00:00:00Z" } } as never });
    expect(html).toMatch(/<polygon class="opn open" /);
    expect(frames(html).length).toBe(3);
  });

  it("nothing at rise 0", () => {
    expect(frames(renderFloor(withDoor({ kind: "window" }), { scale: 1, view: "2.5d", tilt: 0 }))).toEqual([]);
    expect(frames(flat(withDoor({ kind: "window" })))).toEqual([]);
  });

  it("junk spans draw nothing and never throw", () => {
    for (const bad of [{ a: [Number.NaN, 0] }, { b: "x" }, { a: [100, 0], b: [100, 0] }, { sill: Number.NaN }, { height: -5 }]) expect(() => deep(withDoor(bad as never)), JSON.stringify(bad)).not.toThrow();
  });

  it("the stylesheet gives .frame the frame colour and no pointer events", async () => {
    const { FLOORPLAN_CSS } = await import("../../src/core/render");
    expect(FLOORPLAN_CSS).toMatch(/\.frame\{[^}]*fill:var\(--fp-frame\)/);
    expect(FLOORPLAN_CSS).toMatch(/\.frame,[^{]*\{pointer-events:none\}/);
  });
});
