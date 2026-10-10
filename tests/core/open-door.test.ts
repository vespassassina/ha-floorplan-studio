import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import { FLOORPLAN_CSS, OBLIQUE, renderFloor } from "../../src/core/render";
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
    // S23.7: a closed door's line is quiet (it paints nothing; the plan symbol shows the door)
    expect(visible(withKind("door"))).toEqual(["door door-door quiet"]);
    expect(visible(withKind("open"))).toEqual([]);
    expect(hits(withKind("door"))).toEqual(["0"]);
    expect(hits(withKind("open"))).toEqual(["0"]);
    expect(withKind("open")).not.toMatch(/<title>/); // nothing is drawn, so nothing carries its name
  });
  it("the wall is cut: a mask hole at the doorway for open, and since S23.7 for a door too; none for a sealed one", () => {
    const a = withKind("open"), b = withKind("door");
    expect(a).toMatch(/<mask id="fp-open-mask-[^"]*"[^>]*>.*<line x1="100" y1="0" x2="190" y2="0" stroke="black"/);
    expect(a).toMatch(/<g mask="url\(#fp-open-mask-/);
    expect(b).toMatch(/<mask id="fp-open-mask-[^"]*"[^>]*>.*<line x1="100" y1="0" x2="190" y2="0" stroke="black"/);
    expect(withKind("sealed")).not.toContain("<mask");
  });
  it("it draws the same wall cut as a plain opening of the same span", () => {
    const op = flat(floor({ openings: [{ id: "o", a: [100, 0], b: [190, 0] }] as never }));
    const hole = (h: string) => h.match(/<line x1="100" y1="0" x2="190" y2="0" stroke="black"[^>]*>/)?.[0];
    expect(hole(withKind("open"))).toBeDefined();
    expect(hole(withKind("open"))).toBe(hole(op));
  });
  it("no mask or hit line leaks into a floor without a cut: only the hole is new", () => {
    // S23.7: doors and windows are cut now, so the floor without a cut has sealed doors only
    const w = flat(floor({ doors: [door("sealed"), door("sealed", { a: [200, 0], b: [290, 0] })] as never }));
    expect(w).not.toContain("<mask");
  });
  it("closed and unselected draws nothing; an open contact, vibration or an open cover draws a solid alert band: marked `band`, with no pulse line (S14.5)", () => {
    const f = floor({ doors: [door("open", { sensors: ["binary_sensor.c"], vibration: ["binary_sensor.v"] })] as never });
    expect(visible(flat(f, { state: state("binary_sensor.c", "off") }))).toEqual([]);
    expect(flat(f, { state: state("binary_sensor.c", "off") })).not.toContain("door-alert");
    const open = flat(f, { state: state("binary_sensor.c", "on") });
    expect(visible(open)).toEqual(["door door-open open band"]);
    expect(open).not.toContain("door-alert"); // no pulsing line under it
    const shake = flat(f, { state: state("binary_sensor.v", "on") });
    expect(visible(shake)).toEqual(["door door-open alarm band"]);
    expect(shake).not.toContain("door-alert");
    const g = floor({ doors: [door("open", { cover: "cover.c" })] as never });
    expect(visible(flat(g, { state: state("cover.c", "open") }))).toEqual(["door door-open cover-open band"]);
    expect(visible(flat(g, { state: state("cover.c", "closed") }))).toEqual([]);
  });
  it("a plain door keeps the dashed look and the pulse: only the doorway changed", () => {
    const f = floor({ doors: [door("door", { sensors: ["binary_sensor.c"] })] as never });
    const open = flat(f, { state: state("binary_sensor.c", "on") });
    expect(visible(open)).toEqual(["door door-door open"]);
    expect(open).toContain('class="door-alert"');
  });
  it("the stylesheet says a band is solid and full: no dash, full opacity, and the selected-faint rule leaves it alone", () => {
    expect(FLOORPLAN_CSS).toMatch(/\.door\.door-open\.band\{[^}]*stroke-dasharray:none/);
    expect(FLOORPLAN_CSS).toMatch(/\.door\.door-open\.band\{[^}]*stroke-opacity:1/);
  });
  it("selected, it shows its outline; deselected, it is gone again", () => {
    const f = floor({ doors: [door("open")] as never });
    expect(visible(flat(f, { selection: { t: "door", i: 0 } }))).toEqual(["door door-open sel"]);
    expect(visible(flat(f, { selection: { t: "door", i: 1 } }))).toEqual([]);
  });
  it("an open door is a plain door for the rest: a door beside it is unaffected", () => {
    const f = floor({ doors: [door("open"), door("door", { id: "e", a: [200, 0], b: [290, 0] })] as never });
    expect(visible(flat(f))).toEqual(["door door-door quiet"]);
    expect(hits(flat(f))).toEqual(["0", "1"]);
  });
});

describe("open: 2.5D is a hole through the wall with no infill", () => {
  it("a door is a gap with a leaf only while its sensor says closed (S25.D1); an open doorway is the same hole with no leaf, no glass, no frame", () => {
    const d = deep(floor({ doors: [door("door", { sensors: ["binary_sensor.c"] })] as never }), { state: state("binary_sensor.c", "off") }), o = deep(floor({ doors: [door("open")] as never }));
    expect(deep(floor({ doors: [door("door")] as never }))).not.toContain("door-leaf"); // no sensor: a hole
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
  it("a live open contact fills the gap with the solid band (the former red frame); closed it does not, and a plain door keeps its frame", () => {
    const f = floor({ doors: [door("open", { sensors: ["binary_sensor.c"] })] as never });
    expect(deep(f, { state: state("binary_sensor.c", "off") })).not.toContain('class="opn');
    expect(deep(f, { state: state("binary_sensor.c", "on") })).toContain(`<polygon class="opn open band" points="${box(100, 190, 0, 210)}"/>`);
    const g = floor({ doors: [door("door", { sensors: ["binary_sensor.c"] })] as never });
    expect(deep(g, { state: state("binary_sensor.c", "on") })).toContain(`<polygon class="opn open" points="${box(100, 190, 0, 210)}"/>`);
  });
  it("the stylesheet fills a band at full opacity, and the frame stays translucent", () => {
    expect(FLOORPLAN_CSS).toMatch(/\.opn\.band\{[^}]*fill-opacity:1/);
  });
});

describe("open: 3D scene", () => {
  it("cuts the wall to a header above 210 and fills the gap with one thin alert band, not a leaf, glass or panel (a door has its leaf)", () => {
    const prism = (s: any) => s.shape;
    for (const [kind, tag] of [["open", "band"], ["door", "door-leaf"]] as const) {
      const sc = buildScene(floor({ doors: [door(kind)] as never }));
      expect(sc.solids.filter((s) => s.kind === "opening" && s.tag !== "frame").map((s) => s.tag), kind).toEqual([tag]);
      const inside = sc.solids.filter((s) => s.kind === "wall").filter((s) => { const xs = prism(s).base.map((p: number[]) => p[0]); return Math.min(...xs) >= 100 && Math.max(...xs) <= 190; });
      expect(inside.map((s) => [prism(s).z0, prism(s).z1]), kind).toEqual([[210, 250]]);
    }
  });
  it("the band lies in the gap: the opening's own range (own sill and height), the door's index, the alert paint role, a thin slab", () => {
    const sc = buildScene(floor({ doors: [door("open", { sill: 20, height: 150 })] as never }));
    const b = sc.solids.find((s) => s.tag === "band")!, sh = b.shape as any;
    expect([sh.z0, sh.z1]).toEqual([20, 170]);
    expect(b.ref.index).toBe(0);
    expect(b.paint.role).toBe("door-band");
    const ys = sh.base.map((p: number[]) => p[1]), xs = sh.base.map((p: number[]) => p[0]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(4);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([100, 190]);
  });
});
