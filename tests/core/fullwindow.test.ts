import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import { OBLIQUE, renderFloor } from "../../src/core/render";
import { buildScene } from "../../src/core/scene";
import { DOOR_KINDS, validate, type Floor, type Layout } from "../../src/core/schema";
import { migrate } from "../../src/core/migrate";
import { DEFAULT_FLOOR_HEIGHT, DOOR_DEFAULTS, SLIT_HEAD_GAP, doorSpan } from "../../src/core/heights";
import { doorStateOf } from "../../src/core/door-state";
import { OPENING_FILL } from "../../src/core/solids";
import { isKnownRole } from "../../src/card/three/palette";

// The full-height window (S25.D3, Diego 2026-10-09): "allow for full height windows (we have those) so that i do not need
// to use a glass door for them." A window in every respect but its heights: sill 0, head as far under the ceiling as a
// window's and a glass door's is (SLIT_HEAD_GAP: 210 on a 250 wall).
const R = OBLIQUE.rise, K = OBLIQUE.skew;
const n = (v: number) => String(Math.round(v * 100) / 100);
const P = (x: number, y: number, h: number) => `${n(x + h * K * R)},${n(y - h * R)}`;
const box = (x0: number, x1: number, z0: number, z1: number) => `${P(x0, 0, z0)} ${P(x1, 0, z0)} ${P(x1, 0, z1)} ${P(x0, 0, z1)}`;
const floor = (o: Partial<Floor> = {}): Floor => ({
  title: "T", outline: [[0, 0], [400, 0], [400, 300], [0, 300]], owk: ["external", "none", "none", "none"], rooms: [],
  walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [], ...o,
});
const fw = (d: Record<string, unknown> = {}) => ({ id: "f", name: "F", kind: "fullwindow", a: [100, 0], b: [220, 0], ...d });
const glass = (html: string) => [...html.matchAll(/<polygon class="(glass [^"]*)" points="([^"]*)"\/>/g)].map((m) => `${m[1]}|${m[2]}`);

describe("fullwindow: decided in every per-kind table (finding 17)", () => {
  it("is a DoorKind, last-but-open placement does not matter, but it must be there", () => {
    expect(DOOR_KINDS).toContain("fullwindow");
  });
  it.each([...DOOR_KINDS])("%s has a default span, an opening fill and a known 3D pane role", (k) => {
    expect(DOOR_DEFAULTS[k]).toBeDefined();
    expect(Number.isFinite(DOOR_DEFAULTS[k].height)).toBe(true);
    expect(OPENING_FILL[k]).toBeDefined();
    if (k !== "open") expect(isKnownRole(`glass-${k}`), `glass-${k}`).toBe(true);
    const span = doorSpan({ kind: k } as never, 250);
    expect(span.head).toBeGreaterThan(span.sill);
  });
  it("is glass-filled, curtain-covered, and has the window's default span in a 250 wall less 40: 0 to 210", () => {
    expect(OPENING_FILL.fullwindow).toBe("glass");
    expect(DOOR_DEFAULTS.fullwindow).toEqual({ height: 210, sill: 0 });
    expect(doorStateOf({ kind: "fullwindow", cover: "cover.c" } as never, { "cover.c": { state: "open", attributes: {}, last_changed: "" } }).cover).toBe(false);
    expect(doorStateOf({ kind: "door", cover: "cover.c" } as never, { "cover.c": { state: "open", attributes: {}, last_changed: "" } }).cover).toBe(true);
  });
});

describe("fullwindow: validate (untrusted input, finding 1)", () => {
  it("accepts the kind, round-trips through migrate, rejects near misses", () => {
    const l = structuredClone(demo) as unknown as Layout;
    const key = Object.keys(l.floors)[0];
    l.floors[key].doors.push(fw() as never);
    expect(validate(l).ok).toBe(true);
    const m = migrate(JSON.parse(JSON.stringify(l)));
    expect(validate(m).ok).toBe(true);
    expect(m.floors[key].doors.at(-1)).toMatchObject({ kind: "fullwindow" });
    for (const bad of ["fullwindows", "FullWindow", "full-window", "__proto__", "", 5, null]) {
      const b = structuredClone(l);
      b.floors[key].doors.at(-1)!.kind = bad as never;
      expect(() => validate(b)).not.toThrow();
      expect(validate(b).ok, String(bad)).toBe(false);
    }
  });
  it("junk sill and height never throw and are errors", () => {
    for (const j of [NaN, "tall", -5, 1001, null, {}, []]) {
      const l = structuredClone(demo) as unknown as Layout;
      l.floors[Object.keys(l.floors)[0]].doors.push(fw({ sill: j, height: j }) as never);
      expect(() => validate(l)).not.toThrow();
      expect(validate(l).ok, String(j)).toBe(false);
    }
  });
});

describe("fullwindow: heights", () => {
  it.each([[250, 210], [300, 260], [220, 180], [100, 60], [41, 1], [40, 40], [0, 0]])("wall %i: sill 0, head %i (a wall lower than the gap: as high as the wall)", (h, head) => {
    expect(doorSpan(fw() as never, h)).toEqual({ sill: 0, head });
  });
  it("is as high as a glass door under the default wall, and no storey means 250", () => {
    expect(doorSpan(fw() as never)).toEqual(doorSpan({ kind: "glass" } as never));
    expect(DEFAULT_FLOOR_HEIGHT).toBe(250);
    expect(250 - doorSpan(fw() as never, 250).head).toBe(SLIT_HEAD_GAP);
  });
  it("an own sill and height win, clamped to the wall; junk falls back", () => {
    expect(doorSpan(fw({ sill: 30 }) as never, 300)).toEqual({ sill: 30, head: 260 });
    expect(doorSpan(fw({ height: 100 }) as never, 300)).toEqual({ sill: 0, head: 100 });
    expect(doorSpan(fw({ height: 900 }) as never, 300)).toEqual({ sill: 0, head: 300 });
    expect(doorSpan(fw({ sill: NaN, height: "x" }) as never, 300)).toEqual({ sill: 0, head: 260 });
  });
});

describe("fullwindow: 2.5D, 3D, 2D", () => {
  it("2.5D: glass from the floor to 210, wall above it, class g-fullwindow", () => {
    const html = renderFloor(floor({ doors: [fw()] as never }), { scale: 1, view: "2.5d" });
    expect(glass(html)).toEqual([`glass g-fullwindow|${box(100, 220, 0, 210)}`]);
  });
  it("3D: one pane 0 to 210 painted glass-fullwindow, shown whatever the sensor says (it is a window, not a door)", () => {
    const sc = buildScene(floor({ doors: [fw()] as never }));
    const pane = sc.solids.filter((s) => s.tag === "glass");
    expect(pane).toHaveLength(1);
    expect([(pane[0].shape as any).z0, (pane[0].shape as any).z1]).toEqual([0, 210]);
    expect(pane[0].paint.role).toBe("glass-fullwindow");
  });
  it("2D: the window's pane, jambs and colour class; a window's line, never a door's", () => {
    const html = renderFloor(floor({ doors: [fw(), fw({ id: "w", kind: "window", a: [250, 0], b: [370, 0] })] as never }), { scale: 1 });
    expect(html).toMatch(/class="door door-fullwindow[^"]*"/);
    const syms = [...html.matchAll(/class="door-sym k-(\w+)/g)].map((m) => m[1]);
    expect(syms).toEqual(["fullwindow", "window"]);
  });
});
