import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import { validate, migrate, type Floor, type Layout, type Pt } from "../../src/core";
import { renderFloor } from "../../src/core/render";
import { collectWalls } from "../../src/core/solids";
import { wallColourMap, wallEdgeKey, wallColourVars, WALL_COLOUR_KEYS } from "../../src/core/wall-colour";
import { makeBuildScene } from "../../src/core/scene-build";
import { sceneDeps } from "../../src/core/three-deps";

// B53.9: a layout default per wall kind (`wallColors`) and a colour per wall piece (`wc`, `owc`, `Wall.color`).
const box = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const room = (id: string, pts: Pt[], extra: object = {}) => ({ id, name: id, area: id, kind: "room", pts, wk: pts.map(() => "wall"), ...extra });
/** Two rooms side by side on the edge x=100 inside a 200x100 outline. */
const floor = (over: object = {}): Floor => ({
  title: "T", outline: box(0, 0, 200, 100), owk: ["external", "external", "external", "external"],
  rooms: [room("a", box(0, 0, 100, 100)), room("b", box(100, 0, 200, 100))],
  walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [], ...over,
}) as unknown as Floor;
const layoutOf = (f: Floor, over: object = {}): unknown => ({ ...structuredClone(demo), floors: { ground: f }, catalog: [], ...over });
const errorsOf = (x: unknown) => { const r = validate(x); return r.ok ? [] : r.errors; };
const SHARED = wallEdgeKey([100, 0], [100, 100]);

describe("validate: wall colours are untrusted input (CLAUDE.md finding 1)", () => {
  it("accepts a clean layout with a default, per-edge colours and a coloured free wall", () => {
    const f = floor({ owc: ["#112233", null, null, null], walls: [{ id: "w1", a: [0, 50], b: [100, 50], kind: "wall", color: "#AABBCC" }] });
    (f.rooms[0] as unknown as { wc: unknown }).wc = [null, "#445566", null, null];
    expect(errorsOf(layoutOf(f, { wallColors: { wall: "#101010", external: "#202020", fence: "#303030" } }))).toEqual([]);
  });
  it("wallColors: an object of the three kinds, each #rrggbb", () => {
    for (const bad of [5, "x", [], null, { wall: "red" }, { wall: 7 }, { wall: "#12345" }, { edge: "#112233" }, { wall: "\"><script>" }, { wall: { a: 1 } }, { wall: ["#112233"] }])
      expect(errorsOf(layoutOf(floor(), { wallColors: bad })).length, JSON.stringify(bad)).toBeGreaterThan(0);
  });
  it("wc: must be a list as long as the room's points, each null or #rrggbb", () => {
    const wcs: unknown[] = [5, "x", {}, [], ["#112233"], [null, null, null, null, null], [null, null, null, "red"], [null, null, null, 7], [null, null, null, {}], [null, null, null, "\"><script>"], [null, null, null, [1]], ["#1234567", null, null, null]];
    for (const bad of wcs) {
      const f = floor(); (f.rooms[0] as unknown as { wc: unknown }).wc = bad;
      expect(errorsOf(layoutOf(f)).length, JSON.stringify(bad)).toBeGreaterThan(0);
    }
  });
  it("owc and Wall.color: same rules", () => {
    for (const bad of [5, "x", {}, [], ["#112233"], [null, null, null, null, "#112233"], [null, null, null, "x"]])
      expect(errorsOf(layoutOf(floor({ owc: bad }))).length, JSON.stringify(bad)).toBeGreaterThan(0);
    for (const bad of [5, "red", {}, [], null, "#12", "\"><script>"]) {
      const f = floor({ walls: [{ id: "w1", a: [0, 50], b: [100, 50], kind: "wall", color: bad }] });
      expect(errorsOf(layoutOf(f)).length, JSON.stringify(bad)).toBeGreaterThan(0);
    }
  });
  it("never throws on hostile shapes, a room named __proto__ included", () => {
    const hostile: unknown[] = [
      floor({ owc: 5, rooms: [room("__proto__", box(0, 0, 9, 9), { wc: { length: 4 } })] }),
      floor({ rooms: [room("a", box(0, 0, 9, 9), { wc: [null, null, null, null], pts: 5 })] }),
      floor({ rooms: [room("a", box(0, 0, 9, 9), { wc: 5, wk: 7 })], owc: [null], outline: 4 }),
      floor({ walls: [{ id: "w", color: { toString() { throw new Error("boom"); } } }] }),
    ];
    for (const h of hostile) expect(() => validate(layoutOf(h as Floor))).not.toThrow();
    expect(() => validate(layoutOf(floor(), { wallColors: { toString() { throw new Error("boom"); } } }))).not.toThrow();
  });
  it("migrate passes wallColors through and leaves judging to validate", () => {
    const out = migrate({ ...(layoutOf(floor()) as object), wallColors: { wall: "#112233" } } as never) as Layout;
    expect(out.wallColors).toEqual({ wall: "#112233" });
    expect(migrate(layoutOf(floor()) as never).wallColors).toBeUndefined();
  });
});

describe("wallColourMap: which colour a drawn edge has", () => {
  it("is keyed by the edge's rounded ends, in either order", () => {
    expect(wallEdgeKey([0, 0], [100, 0])).toBe(wallEdgeKey([100.2, 0.4], [0, 0]));
  });
  it("a layout with no colour anywhere has none", () => {
    expect(wallColourMap(floor()).size).toBe(0);
  });
  it("an edge shared by two rooms takes the colour of whichever side sets one", () => {
    const f = floor(); (f.rooms[1] as unknown as { wc: unknown }).wc = [null, null, null, "#aa0000"]; // room b's west edge
    expect(wallColourMap(f).get(SHARED)).toBe("#aa0000");
  });
  it("when both sides set different colours the first room in array order wins", () => {
    const f = floor();
    (f.rooms[0] as unknown as { wc: unknown }).wc = [null, "#aa0000", null, null]; // a's east edge
    (f.rooms[1] as unknown as { wc: unknown }).wc = [null, null, null, "#0000bb"]; // b's west edge, the same segment
    expect(wallColourMap(f).get(SHARED)).toBe("#aa0000");
    f.rooms.reverse();
    expect(wallColourMap(f).get(SHARED)).toBe("#0000bb");
  });
  it("the outline comes before the rooms", () => {
    const f = floor({ outline: box(0, 0, 100, 100), owc: ["#00cc00", null, null, null] });
    f.rooms = [room("a", box(0, 0, 100, 100), { wc: ["#aa0000", null, null, null] })] as never;
    expect(wallColourMap(f).get(wallEdgeKey([0, 0], [100, 0]))).toBe("#00cc00");
  });
  it("a free wall on a room edge shares it; its colour counts last", () => {
    const f = floor({ walls: [{ id: "w1", a: [100, 0], b: [100, 100], kind: "wall", color: "#00aa00" }] });
    expect(wallColourMap(f).get(SHARED)).toBe("#00aa00");
    (f.rooms[0] as unknown as { wc: unknown }).wc = [null, "#aa0000", null, null];
    expect(wallColourMap(f).get(SHARED)).toBe("#aa0000");
  });
  it("colours are lower-cased; junk and zone rooms are ignored without throwing", () => {
    const f = floor({ owc: ["#ABCDEF", "red", 5, {}] });
    f.rooms.push(room("z", box(10, 10, 20, 20), { kind: "zone", wk: ["boundary", "boundary", "boundary", "boundary"], wc: ["#123456", null, null, null] }) as never);
    const m = wallColourMap(f);
    expect(m.get(wallEdgeKey([0, 0], [200, 0]))).toBe("#abcdef");
    expect(m.get(wallEdgeKey([200, 0], [200, 100]))).toBeUndefined();
    expect(m.get(wallEdgeKey([10, 10], [20, 10]))).toBeUndefined();
    expect(() => wallColourMap({ outline: 5, rooms: [null, { pts: 3, wc: 4 }], walls: [7] } as never)).not.toThrow();
  });
});

describe("wallColourVars: the layout default as CSS variables", () => {
  it("names the matching --fp-wall* token for each kind, nothing for an absent kind", () => {
    expect(WALL_COLOUR_KEYS).toEqual(["wall", "external", "fence"]);
    expect(wallColourVars(undefined)).toEqual([]);
    expect(wallColourVars({ external: "#aa0000" })).toEqual(["--fp-wall-external:#aa0000"]);
    expect(wallColourVars({ fence: "#00aa00" })).toEqual(["--fp-wall-fence:#00aa00"]);
    const w = wallColourVars({ wall: "#0000ff" }).join(";");
    expect(w).toContain("--fp-wall:#0000ff");
    expect(w).toContain("--fp-wall-top:#0000ff");
    expect(w).toContain("--fp-wall-side:color-mix(in srgb,#0000ff var(--fp-wall-side-share,55%),var(--fp-bg))");
  });
  it("lets only strict colours into the markup", () => {
    expect(wallColourVars({ wall: "\"><script>", external: "red", fence: 5, edge: "#112233" } as never)).toEqual([]);
    expect(wallColourVars(5 as never)).toEqual([]);
    expect(wallColourVars([] as never)).toEqual([]);
  });
});

const lines = (html: string) => [...html.matchAll(/<line class="(e[^"]*)"([^>]*)\/>/g)].map((m) => ({ cls: m[1].split(" "), rest: m[2] }));
const styleOf = (l: { rest: string }) => /style="([^"]*)"/.exec(l.rest)?.[1];

describe("renderFloor draws the colours", () => {
  it("2D: a coloured edge carries class wc and an inline --fp-wall-c; an uncoloured one carries neither", () => {
    const f = floor(); (f.rooms[0] as unknown as { wc: unknown }).wc = [null, "#aa0000", null, null];
    const out = lines(renderFloor(f, { scale: 1 }));
    const east = out.filter((l) => l.rest.includes('data-e="r0:1"'));
    expect(east).toHaveLength(1);
    expect(east[0].cls).toContain("wc");
    expect(styleOf(east[0])).toBe("--fp-wall-c:#aa0000");
    const plain = out.filter((l) => l.rest.includes('data-e="r0:0"'))[0];
    expect(plain.cls).not.toContain("wc");
    expect(styleOf(plain)).toBeUndefined();
  });
  it("2D: both sides of a shared edge draw the same colour (the first set wins)", () => {
    const f = floor(); (f.rooms[1] as unknown as { wc: unknown }).wc = [null, null, null, "#0000bb"];
    const out = lines(renderFloor(f, { scale: 1 }));
    expect(styleOf(out.find((l) => l.rest.includes('data-e="r0:1"'))!)).toBe("--fp-wall-c:#0000bb");
    expect(styleOf(out.find((l) => l.rest.includes('data-e="r1:3"'))!)).toBe("--fp-wall-c:#0000bb");
  });
  it("2D: the outline and a free wall take their own colours", () => {
    const f = floor({ owc: ["#112233", null, null, null], walls: [{ id: "w1", a: [10, 50], b: [90, 50], kind: "fence", color: "#445566" }] });
    const out = lines(renderFloor(f, { scale: 1 }));
    expect(styleOf(out.find((l) => l.rest.includes('data-e="o:0"'))!)).toBe("--fp-wall-c:#112233");
    expect(styleOf(out.find((l) => l.rest.includes('data-w="0"'))!)).toBe("--fp-wall-c:#445566");
  });
  it("2D: a zone's edges and an edge of kind none are never coloured", () => {
    const f = floor(); f.rooms[0].wk = ["none", "wall", "wall", "wall"]; (f.rooms[0] as unknown as { wc: unknown }).wc = ["#aa0000", null, null, null];
    f.rooms.push(room("z", box(10, 10, 20, 20), { kind: "zone", wk: ["boundary", "boundary", "boundary", "boundary"], wc: ["#123456", null, null, null] }) as never);
    const html = renderFloor(f, { scale: 1, editor: true });
    expect(html).not.toContain("#123456");
    expect(lines(html).filter((l) => l.rest.includes('data-e="r0:0"')).every((l) => !l.cls.includes("wc"))).toBe(true);
  });
  it("the layout default sits on the group round the drawing as variables, only for strict colours", () => {
    const html = renderFloor(floor(), { scale: 1, wallColors: { wall: "#0000ff", external: "#aa0000", fence: "#00aa00" } });
    const g = /<g class="dev-colours[^"]*" style="([^"]*)"/.exec(html)![1];
    expect(g).toContain("--fp-wall:#0000ff");
    expect(g).toContain("--fp-wall-external:#aa0000");
    expect(g).toContain("--fp-wall-fence:#00aa00");
    expect(renderFloor(floor(), { scale: 1, wallColors: { wall: "\"><script>" } as never })).not.toContain("<script>");
    expect(renderFloor(floor(), { scale: 1 })).not.toContain("dev-colours");
  });
  it("escapes: a hostile colour never reaches the markup", () => {
    const f = floor();
    (f.rooms[0] as unknown as { wc: unknown[] }).wc = [null, "\"><script>alert(1)</script>", null, null];
    (f as unknown as { owc: unknown[] }).owc = ["\" onmouseover=\"x", null, null, null];
    f.walls = [{ id: "w", a: [1, 1], b: [50, 1], kind: "wall", color: "\"><script>" } as never];
    expect(renderFloor(f, { scale: 1 })).not.toMatch(/<script|onmouseover/);
    expect(renderFloor(f, { scale: 1, view: "2.5d", tilt: 40 })).not.toMatch(/<script|onmouseover/);
  });
  it("2.5D: a coloured wall's faces and cap carry class wc and the variable", () => {
    const f = floor(); (f.rooms[0] as unknown as { wc: unknown }).wc = [null, "#aa0000", null, null];
    const html = renderFloor(f, { scale: 1, view: "2.5d", tilt: 40 });
    const faces = [...html.matchAll(/<polygon class="(ws[^"]*)" points="[^"]*"( style="[^"]*")?\/>/g)];
    expect(faces.some((m) => m[1].split(" ").includes("wc") && m[2] === ' style="--fp-wall-c:#aa0000"')).toBe(true);
    expect(lines(html).some((l) => l.cls.includes("top") && l.cls.includes("wc") && (styleOf(l) ?? "").includes("--fp-wall-c:#aa0000"))).toBe(true);
  });
});

describe("collectWalls and the 3D scene carry the colour", () => {
  const px = { scr: (p: Pt) => p, lift: (p: Pt) => p, rise: 0, skew: 0, cutaway: 110 } as never;
  it("collectWalls: a doubled edge keeps one colour by the shared rule", () => {
    const f = floor(); (f.rooms[1] as unknown as { wc: unknown }).wc = [null, null, null, "#0000bb"];
    const seg = collectWalls(f, px, "full").find((w) => wallEdgeKey(w.a, w.b) === SHARED)!;
    expect(seg.color).toBe("#0000bb");
    expect(collectWalls(floor(), px, "full").every((w) => w.color === undefined)).toBe(true);
  });
  it("scene: only the wall solids of the coloured edge carry paint.color", () => {
    const f = floor(); (f.rooms[0] as unknown as { wc: unknown }).wc = [null, "#aa0000", null, null];
    const walls = makeBuildScene(sceneDeps)(f).solids.filter((s) => s.kind === "wall");
    expect(walls.filter((s) => s.paint.color === "#aa0000").length).toBeGreaterThan(0);
    expect(walls.filter((s) => s.paint.color === undefined).length).toBeGreaterThan(0);
    expect(walls.filter((s) => s.paint.color !== undefined && s.paint.color !== "#aa0000")).toHaveLength(0);
  });
  it("scene: a hostile colour gives none", () => {
    const f = floor(); (f.rooms[1] as unknown as { wc: unknown[] }).wc = [null, null, null, "\"><script>"];
    expect(makeBuildScene(sceneDeps)(f).solids.some((s) => s.kind === "wall" && s.paint.color !== undefined)).toBe(false);
  });
});
