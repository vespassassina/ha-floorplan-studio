import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import { OBLIQUE, renderFloor } from "../../src/core/render";
import { buildScene } from "../../src/core/scene";
import { DOOR_KINDS, validate, type Floor, type Layout } from "../../src/core/schema";
import { migrate } from "../../src/core/migrate";
import { DOOR_DEFAULTS, doorSpan } from "../../src/core/heights";
import { doorStateOf } from "../../src/core/door-state";
import { OPENING_FILL } from "../../src/core/solids";

// The open doorway: a door that is only a hole in the wall (Diego, 2026-10-05: "to doors add as door type: open and do not draw the door").
const R = OBLIQUE.rise, K = OBLIQUE.skew;
const n = (v: number) => String(Math.round(v * 100) / 100);
const P = (x: number, y: number, h: number) => `${n(x + h * K * R)},${n(y - h * R)}`;
const box = (x0: number, x1: number, z0: number, z1: number) => `${P(x0, 0, z0)} ${P(x1, 0, z0)} ${P(x1, 0, z1)} ${P(x0, 0, z1)}`;
const floor = (o: Partial<Floor> = {}): Floor => ({
  title: "T", outline: [[0, 0], [400, 0], [400, 300], [0, 300]], owk: ["external", "none", "none", "none"], rooms: [],
  walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [], ...o,
});
const door = (kind: string, d: Record<string, unknown> = {}) => ({ id: "d", name: "D", kind, a: [100, 0], b: [190, 0], ...d });
const deep = (f: Floor, o: object = {}) => renderFloor(f, { scale: 1, view: "2.5d", ...o });
const flat = (f: Floor, o: object = {}) => renderFloor(f, { scale: 1, ...o });
const faces = (html: string) => [...html.matchAll(/<polygon class="ws[^"]*" points="([^"]*)"\/>/g)].map((m) => m[1]);
const state = (e: string, s: string) => ({ [e]: { state: s, attributes: {}, last_changed: "" } });
const visible = (html: string) => [...html.matchAll(/<line data-d="\d+" class="(door [^"]*)"/g)].map((m) => m[1]);
const hits = (html: string) => [...html.matchAll(/<line data-d="(\d+)" class="door-hit[^"]*"/g)].map((m) => m[1]);

describe("open: the kind", () => {
  it("is a DoorKind, and every kind has a decision in every per-kind table (finding 17)", () => {
    expect(DOOR_KINDS).toContain("open");
    for (const k of DOOR_KINDS) {
      expect(DOOR_DEFAULTS[k], `${k} default`).toBeDefined();
      expect(OPENING_FILL[k], `${k} fill`).toMatch(/^(gap|void|glass|panel)$/);
      expect(() => doorStateOf({ kind: k, sensors: ["s"] } as never, state("s", "on")), `${k} state`).not.toThrow();
      expect(doorStateOf({ kind: k, sensors: ["s"] } as never, state("s", "on")).open, `${k} open`).toBe(true);
    }
    expect(DOOR_DEFAULTS.open).toEqual({ height: 210, sill: 0 });
    expect(OPENING_FILL.open).toBe("void");
    expect(OPENING_FILL.door).toBe("gap");
    expect(doorSpan(door("open") as never)).toEqual({ sill: 0, head: 210 });
    expect(doorSpan(door("open", { height: 100, sill: 20 }) as never)).toEqual({ sill: 20, head: 120 });
  });
  it("validates with sensors and a name, round-trips through migrate, and an unknown kind is still an error", () => {
    const l = structuredClone(demo) as unknown as Layout;
    const key = Object.keys(l.floors)[0];
    l.floors[key].doors.push(door("open", { id: "open1", name: "Hall arch", sensors: ["binary_sensor.x"], vibration: ["binary_sensor.v"], locks: ["lock.l"], cover: "cover.c", height: 230 }) as never);
    expect(validate(l).ok).toBe(true);
    const m = migrate(JSON.parse(JSON.stringify(l)));
    expect(m.version).toBe(2);
    expect(validate(m).ok).toBe(true);
    expect(m.floors[key].doors.at(-1)).toMatchObject({ kind: "open", name: "Hall arch", sensors: ["binary_sensor.x"], height: 230 });
    const bad = structuredClone(l);
    bad.floors[key].doors.at(-1)!.kind = "opened" as never;
    expect(validate(bad).ok).toBe(false);
  });
  it("junk fields on an open door never throw", () => {
    for (const j of [NaN, "tall", -5, 1001, null, {}, []]) {
      const l = structuredClone(demo) as unknown as Layout;
      l.floors[Object.keys(l.floors)[0]].doors.push(door("open", { sill: j, height: j }) as never);
      expect(() => validate(l)).not.toThrow();
      expect(validate(l).ok, String(j)).toBe(false);
    }
  });
  it("cover colours it like a plain door (a roller shutter), it is not curtains", () => {
    expect(doorStateOf({ kind: "open", cover: "cover.c" } as never, state("cover.c", "open")).cover).toBe(true);
    expect(doorStateOf({ kind: "window", cover: "cover.c" } as never, state("cover.c", "open")).cover).toBe(false);
  });
});

describe("open: 2D draws no door, still cuts the wall", () => {
  const withKind = (kind: string, extra: object = {}) => flat(floor({ doors: [door(kind)] as never }), extra);
  it("a door draws its line; an open door draws none, but keeps its click target", () => {
    expect(visible(withKind("door"))).toEqual(["door door-door"]);
    expect(visible(withKind("open"))).toEqual([]);
    expect(hits(withKind("door"))).toEqual(["0"]);
    expect(hits(withKind("open"))).toEqual(["0"]);
    expect(withKind("open")).not.toMatch(/<title>/); // nothing is drawn, so nothing carries its name
  });
  it("the wall is cut: a mask hole at the doorway for open, none for a door", () => {
    const a = withKind("open"), b = withKind("door");
    expect(a).toMatch(/<mask id="fp-open-mask-[^"]*"[^>]*>.*<line x1="100" y1="0" x2="190" y2="0" stroke="black"/);
    expect(a).toMatch(/<g mask="url\(#fp-open-mask-/);
    expect(b).not.toContain("<mask");
  });
  it("it draws the same wall cut as a plain opening of the same span", () => {
    const op = flat(floor({ openings: [{ id: "o", a: [100, 0], b: [190, 0] }] as never }));
    const hole = (h: string) => h.match(/<line x1="100" y1="0" x2="190" y2="0" stroke="black"[^>]*>/)?.[0];
    expect(hole(withKind("open"))).toBeDefined();
    expect(hole(withKind("open"))).toBe(hole(op));
  });
  it("no mask or hit line leaks into a floor without an open door: only the hole is new", () => {
    const w = flat(floor({ doors: [door("window"), door("door", { a: [200, 0], b: [290, 0] })] as never }));
    expect(w).not.toContain("<mask");
  });
  it("closed and unselected draws nothing; an open contact draws the same dashed line and pulse as any door; vibration too", () => {
    const f = floor({ doors: [door("open", { sensors: ["binary_sensor.c"], vibration: ["binary_sensor.v"] })] as never });
    expect(visible(flat(f, { state: state("binary_sensor.c", "off") }))).toEqual([]);
    expect(flat(f, { state: state("binary_sensor.c", "off") })).not.toContain("door-alert");
    const open = flat(f, { state: state("binary_sensor.c", "on") });
    expect(visible(open)).toEqual(["door door-open open"]);
    expect(open).toContain('class="door-alert"');
    expect(visible(flat(f, { state: state("binary_sensor.v", "on") }))).toEqual(["door door-open alarm"]);
  });
  it("selected, it shows its outline; deselected, it is gone again", () => {
    const f = floor({ doors: [door("open")] as never });
    expect(visible(flat(f, { selection: { t: "door", i: 0 } }))).toEqual(["door door-open sel"]);
    expect(visible(flat(f, { selection: { t: "door", i: 1 } }))).toEqual([]);
  });
  it("an open door is a plain door for the rest: a door beside it is unaffected", () => {
    const f = floor({ doors: [door("open"), door("door", { id: "e", a: [200, 0], b: [290, 0] })] as never });
    expect(visible(flat(f))).toEqual(["door door-door"]);
    expect(hits(flat(f))).toEqual(["0", "1"]);
  });
});

describe("open: 2.5D is a hole through the wall with no infill", () => {
  it("a door is a gap with a leaf; an open door is the same hole with no leaf, no glass, no frame", () => {
    const d = deep(floor({ doors: [door("door")] as never })), o = deep(floor({ doors: [door("open")] as never }));
    for (const h of [d, o]) {
      expect(faces(h)).toContain(box(100, 190, 210, 250)); // the header
      expect(faces(h).some((q) => q === box(100, 190, 0, 210))).toBe(false); // nothing between sill and head
    }
    expect(d).toContain('class="door-leaf"');
    expect(o).not.toContain("door-leaf");
    expect(o).not.toContain('class="glass');
    expect(o).not.toContain('class="opn');
    expect(o).not.toContain('class="ws sealed');
  });
  it("an own height sets the head, as for a door", () => {
    expect(faces(deep(floor({ doors: [door("open", { height: 200 })] as never })))).toContain(box(100, 190, 200, 250));
  });
  it("a live open contact still draws the red frame; closed it does not, and a closed door is not confused with it", () => {
    const f = floor({ doors: [door("open", { sensors: ["binary_sensor.c"] })] as never });
    expect(deep(f, { state: state("binary_sensor.c", "off") })).not.toContain('class="opn');
    expect(deep(f, { state: state("binary_sensor.c", "on") })).toContain(`<polygon class="opn open" points="${box(100, 190, 0, 210)}"/>`);
  });
});

describe("open: 3D scene", () => {
  it("cuts the wall to a header above 210 and draws no leaf, glass or panel (a door has its leaf)", () => {
    const prism = (s: any) => s.shape;
    for (const [kind, leaf] of [["open", 0], ["door", 1]] as const) {
      const sc = buildScene(floor({ doors: [door(kind)] as never }));
      expect(sc.solids.filter((s) => s.kind === "opening").length, kind).toBe(leaf);
      const inside = sc.solids.filter((s) => s.kind === "wall").filter((s) => { const xs = prism(s).base.map((p: number[]) => p[0]); return Math.min(...xs) >= 100 && Math.max(...xs) <= 190; });
      expect(inside.map((s) => [prism(s).z0, prism(s).z1]), kind).toEqual([[210, 250]]);
    }
  });
});
