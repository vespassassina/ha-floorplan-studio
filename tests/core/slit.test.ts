import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import { OBLIQUE, renderFloor } from "../../src/core/render";
import { buildScene } from "../../src/core/scene";
import { DOOR_KINDS, validate, type Floor, type Layout } from "../../src/core/schema";
import { migrate } from "../../src/core/migrate";
import { DEFAULT_FLOOR_HEIGHT, DOOR_DEFAULTS, SLIT_HEIGHT, doorCeiling, doorSpan, radiatorSpan } from "../../src/core/heights";
import { doorStateOf } from "../../src/core/door-state";
import { OPENING_FILL } from "../../src/core/solids";

// The slit window: a window 60 cm high that hangs from the ceiling of the wall it sits in (Diego, 2026-10-05).
const R = OBLIQUE.rise, K = OBLIQUE.skew;
const n = (v: number) => String(Math.round(v * 100) / 100);
const P = (x: number, y: number, h: number) => `${n(x + h * K * R)},${n(y - h * R)}`;
const box = (x0: number, x1: number, z0: number, z1: number) => `${P(x0, 0, z0)} ${P(x1, 0, z0)} ${P(x1, 0, z1)} ${P(x0, 0, z1)}`;
const floor = (o: Partial<Floor> = {}): Floor => ({
  title: "T", outline: [[0, 0], [400, 0], [400, 300], [0, 300]], owk: ["external", "none", "none", "none"], rooms: [],
  walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [], ...o,
});
const slit = (d: Record<string, unknown> = {}) => ({ id: "s", name: "S", kind: "slit", a: [100, 0], b: [220, 0], ...d });
const deep = (f: Floor) => renderFloor(f, { scale: 1, view: "2.5d" });
const flat = (f: Floor) => renderFloor(f, { scale: 1 });
const glass = (html: string) => [...html.matchAll(/<polygon class="(glass [^"]*)" points="([^"]*)"\/>/g)].map((m) => `${m[1]}|${m[2]}`);
const faces = (html: string) => [...html.matchAll(/<polygon class="ws[^"]*" points="([^"]*)"\/>/g)].map((m) => m[1]);

describe("slit: the kind", () => {
  it("is a DoorKind with its own default, 60 high, and decided in every per-kind table (finding 17)", () => {
    expect(DOOR_KINDS).toContain("slit");
    expect(DOOR_DEFAULTS.slit.height).toBe(60);
    expect(SLIT_HEIGHT).toBe(60);
    expect(OPENING_FILL.slit).toBe("glass");
  });

  it("validates, round-trips through migrate, and an unknown kind is still an error", () => {
    const l = structuredClone(demo) as unknown as Layout;
    const g = l.floors[Object.keys(l.floors)[0]];
    g.doors.push(slit({ id: "slit1", sill: 190, height: 60 }) as never);
    expect(validate(l).ok).toBe(true);
    const m = migrate(JSON.parse(JSON.stringify(l)));
    expect(m.version).toBe(2);
    expect(validate(m).ok).toBe(true);
    expect(m.floors[Object.keys(l.floors)[0]].doors.at(-1)).toMatchObject({ kind: "slit", sill: 190, height: 60 });
    const bad = structuredClone(l);
    bad.floors[Object.keys(l.floors)[0]].doors.at(-1)!.kind = "slot" as never;
    const r = validate(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join("\n")).toMatch(/kind/);
  });

  it("validate never throws on junk slit fields, and says so", () => {
    for (const j of [NaN, "tall", -5, 1001, null, {}, []]) {
      const l = structuredClone(demo) as unknown as Layout;
      l.floors[Object.keys(l.floors)[0]].doors.push(slit({ sill: j, height: j }) as never);
      expect(() => validate(l)).not.toThrow();
      expect(validate(l).ok, String(j)).toBe(false);
    }
  });
});

describe("slit: the span hangs from the ceiling of its wall", () => {
  it.each([[250, 190, 250], [300, 240, 300], [40, 0, 40], [60, 0, 60], [0, 0, 0]])("wall %i cm: sill %i, head %i", (h, sill, head) => {
    expect(doorSpan(slit() as never, h)).toEqual({ sill, head });
  });
  it("with no wall at all it is the storey default, 250", () => {
    expect(DEFAULT_FLOOR_HEIGHT).toBe(250);
    expect(doorSpan(slit() as never)).toEqual({ sill: 190, head: 250 });
  });
  it("an own height keeps the top at the ceiling; an own sill wins and the head is clamped; both win together", () => {
    expect(doorSpan(slit({ height: 40 }) as never, 300)).toEqual({ sill: 260, head: 300 });
    expect(doorSpan(slit({ sill: 100 }) as never, 300)).toEqual({ sill: 100, head: 160 });
    expect(doorSpan(slit({ sill: 280 }) as never, 300)).toEqual({ sill: 280, head: 300 }); // head <= the wall
    expect(doorSpan(slit({ sill: 100, height: 30 }) as never, 300)).toEqual({ sill: 100, head: 130 });
    expect(doorSpan(slit({ height: 500 }) as never, 300)).toEqual({ sill: 0, head: 300 }); // taller than the wall: the wall
  });
  it("junk falls back to the default, and no other kind is touched by a ceiling", () => {
    for (const j of [NaN, "tall", -5, 1001, null]) expect(doorSpan(slit({ sill: j, height: j }) as never, 300), String(j)).toEqual({ sill: 240, head: 300 });
    expect(doorSpan({ kind: "window" } as never, 300)).toEqual({ sill: 90, head: 210 });
    expect(doorSpan({ kind: "door" } as never, 40)).toEqual({ sill: 0, head: 210 });
  });
  it("a radiator's default top is still under a window sill, never a slit's", () => {
    expect(radiatorSpan({ type: "heater" } as never).top).toBe(DOOR_DEFAULTS.window.sill - 20);
  });
});

describe("slit: the ceiling is the wall's own", () => {
  const room = { id: "r0", name: "R", area: "r", kind: "room", pts: [[0, 0], [400, 0], [400, 300], [0, 300]], wk: ["wall", "wall", "wall", "wall"], height: 220 };
  it("a free wall, a room edge, the outline and no wall at all each answer with their own height", () => {
    expect(doorCeiling(floor({ owk: ["none", "none", "none", "none"], walls: [{ id: "w", a: [0, 0], b: [400, 0], kind: "wall", height: 40 }] as never }), slit() as never)).toBe(40);
    expect(doorCeiling(floor({ rooms: [room] as never, owk: ["none", "none", "none", "none"] }), slit() as never)).toBe(220); // the room's ceiling
    expect(doorCeiling(floor({ height: 300 }), slit() as never)).toBe(300); // the outline's edge: the storey
    expect(doorCeiling(floor({ height: 300 }), slit({ a: [1000, 1000], b: [1100, 1000] }) as never)).toBe(300); // on no wall: the storey
  });
  it("junk points answer with the storey and never throw", () => {
    for (const j of [undefined, null, [NaN, 0], "x"]) expect(doorCeiling(floor(), slit({ a: j, b: j }) as never)).toBe(250);
    expect(doorCeiling(floor(), null as never)).toBe(250);
  });
  it("a slit on a room whose ceiling is 220 hangs from 220 in the 3D scene", () => {
    const sc = buildScene(floor({ rooms: [room] as never, owk: ["none", "none", "none", "none"], doors: [slit()] as never }));
    const pane = sc.solids.find((s) => s.tag === "glass")!;
    expect([(pane.shape as any).z0, (pane.shape as any).z1]).toEqual([160, 220]);
  });
});

describe("slit: a window in every other respect", () => {
  it("cover is curtains: an open cover never colours it, as with a window", () => {
    const st = { "cover.c": { state: "open", attributes: {}, last_changed: "" }, "binary_sensor.c": { state: "on", attributes: {}, last_changed: "" } };
    expect(doorStateOf({ kind: "slit", cover: "cover.c" } as never, st).cover).toBe(false);
    expect(doorStateOf({ kind: "window", cover: "cover.c" } as never, st).cover).toBe(false);
    expect(doorStateOf({ kind: "slit", sensors: ["binary_sensor.c"] } as never, st).open).toBe(true);
  });
});

describe("slit: 2.5D", () => {
  it.each([[undefined, 250], [300, 300]])("storey %s: a block under, glass from top-60 to top, nothing above", (storey, top) => {
    const f = floor({ doors: [slit()] as never, ...(storey ? { height: storey } : {}) });
    const html = deep(f);
    expect(glass(html)).toEqual([`glass g-slit|${box(100, 220, top - 60, top)}`]);
    expect(faces(html)).toContain(box(100, 220, 0, top - 60));
    expect(faces(html).filter((q) => q === box(100, 220, top, top + 1)).length).toBe(0);
    expect(faces(html).some((q) => q.startsWith(`${P(100, 0, top)} ${P(220, 0, top)}`) && q !== box(100, 220, 0, top - 60))).toBe(false);
  });
  it("an own sill and height win", () => {
    expect(glass(deep(floor({ doors: [slit({ sill: 100, height: 30 })] as never })))).toEqual([`glass g-slit|${box(100, 220, 100, 130)}`]);
  });
  it("a wall of 40 cm gives a slit as high as the wall: glass from 0 to 40", () => {
    const f = floor({ owk: ["none", "none", "none", "none"], walls: [{ id: "w", a: [0, 0], b: [400, 0], kind: "wall", height: 40 }] as never, doors: [slit()] as never });
    expect(glass(deep(f))).toEqual([`glass g-slit|${box(100, 220, 0, 40)}`]);
  });
});

describe("slit: 3D scene", () => {
  const prism = (s: any) => s.shape;
  it.each([[250, undefined], [300, 300], [40, undefined]])("wall %i: the pane spans top-60 to top, the block runs under it, nothing over it", (h, storey) => {
    const f = h === 40
      ? floor({ owk: ["none", "none", "none", "none"], walls: [{ id: "w", a: [0, 0], b: [400, 0], kind: "wall", height: 40 }] as never, doors: [slit()] as never })
      : floor({ doors: [slit()] as never, ...(storey ? { height: storey } : {}) });
    const sc = buildScene(f);
    const pane = sc.solids.filter((s) => s.tag === "glass");
    expect(pane).toHaveLength(1);
    expect([prism(pane[0]).z0, prism(pane[0]).z1]).toEqual([Math.max(0, h - 60), h]);
    expect(pane[0].paint.role).toBe("glass-slit");
    const walls = sc.solids.filter((s) => s.kind === "wall" && s.tag !== "glass");
    const under = walls.filter((s) => { const xs = prism(s).base.map((p: number[]) => p[0]); return Math.min(...xs) >= 100 && Math.max(...xs) <= 220; });
    if (h > 60) expect(under.map((s) => [prism(s).z0, prism(s).z1])).toEqual([[0, h - 60]]);
    else expect(under).toEqual([]);
  });
});

describe("slit: 2D", () => {
  it("draws the window mark as a thin band, selectable like any door", () => {
    const f = floor({ doors: [slit(), slit({ id: "w", kind: "window", a: [250, 0], b: [370, 0] })] as never });
    const html = flat(f);
    const lines = [...html.matchAll(/<line data-d="(\d)" class="door door-(\w+)[^"]*"[^>]*stroke-width="([\d.]+)"/g)].map((m) => [m[1], m[2], Number(m[3])]);
    expect(lines[0]).toEqual(["0", "slit", expect.any(Number)]);
    expect(lines[1][1]).toBe("window");
    expect(html).toMatch(/class="door door-slit door-window"/); // the window's colour rule, no new CSS
    expect(lines[0][2] as number).toBeLessThan(lines[1][2] as number);
    expect(lines[0][2] as number).toBeGreaterThan(0);
  });
  it("a layout with no slit draws exactly what it drew before: the demo has no slit and DOOR_KINDS gained only the members slit and open", () => {
    expect(DOOR_KINDS).toEqual(["door", "glass", "window", "sealed", "slit", "open"]);
    expect(JSON.stringify(demo)).not.toContain('"slit"');
  });
});
