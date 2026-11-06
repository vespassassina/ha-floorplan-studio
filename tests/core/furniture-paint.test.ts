import { describe, it, expect } from "vitest";
import { FURNITURE_SYMBOLS, validate, type Floor, type Layout } from "../../src/core/schema";
import { migrate } from "../../src/core/migrate";
import { renderFloor } from "../../src/core/render";
import { buildScene } from "../../src/core/scene";
import { TEXTURES, TEXTURE_IDS } from "../../src/core/textures";
import { furniturePaint, furniturePaintable } from "../../src/core/furniture-paint";
import { EditorState } from "../../src/editor/state";

// B53.4 (spec item 19a, criterion 3a): any furniture piece takes `color` or `texture` (+ `textureRot`, `textureScale`) as a room does.
// A layout file is untrusted (finding 1): validate never throws and names the piece, migrate drops what validate would refuse.
const piece = (symbol: string, extra: Record<string, unknown> = {}) => ({ id: "m1", symbol, x: 400, y: 300, rot: 30, w: 200, h: 90, ...extra });
const floorOf = (furniture: unknown[]): Floor => ({
  title: "G", outline: [[0, 0], [1000, 0], [1000, 800], [0, 800]], owk: ["external", "external", "external", "external"],
  rooms: [{ id: "r0", name: "Hall", area: "", kind: "room", pts: [[0, 0], [1000, 0], [1000, 800], [0, 800]], wk: ["wall", "wall", "wall", "wall"] }],
  walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture, unlinked: [],
}) as unknown as Floor;
const layoutOf = (m: unknown) => ({ version: 2, unit: "cm", north: 0, rotate: 0, catalog: [], floors: { Ground: floorOf([m]) } });
const errorsOf = (m: unknown): string[] => { const r = validate(layoutOf(m)); return r.ok ? [] : r.errors; };
const draw = (m: unknown, view?: "2.5d") => renderFloor(floorOf([m]), { scale: 1, ...(view ? { view } : {}) });
const groupOf = (html: string) => /<g data-f="0"[^>]*>/.exec(html)?.[0] ?? "";

describe("furniturePaint: the one colour 2.5D and 3D consult", () => {
  it("is the colour, or the texture's base colour, lower-cased; nothing for no paint", () => {
    expect(furniturePaint(piece("sofa") as never)).toBeUndefined();
    expect(furniturePaint(piece("sofa", { color: "#AABBCC" }) as never)).toBe("#aabbcc");
    const wood = TEXTURES.find((t) => t.id === "wood-warm")!;
    expect(furniturePaint(piece("table", { texture: "wood-warm" }) as never)).toBe(wood.preview);
  });
  it("is nothing for junk, and a texture wins over a colour like it does on a room", () => {
    for (const bad of [{ color: "red" }, { color: 5 }, { color: '"><script>' }, { texture: "__proto__" }, { texture: 7 }]) expect(furniturePaint(piece("sofa", bad) as never), JSON.stringify(bad)).toBeUndefined();
    expect(furniturePaint(piece("sofa", { color: "#112233", texture: "wood-dark" }) as never)).toBe(TEXTURES.find((t) => t.id === "wood-dark")!.preview);
  });
  it("leaves a car (its own colour) and a tree alone", () => {
    expect(furniturePaint(piece("car", { color: "#c03030" }) as never)).toBeUndefined();
    expect(furniturePaintable("car")).toBe(false);
    expect(furniturePaintable("tree")).toBe(false);
  });
  it("decides every symbol (finding 17)", () => {
    for (const s of FURNITURE_SYMBOLS) expect(typeof furniturePaintable(s), s).toBe("boolean");
    expect(FURNITURE_SYMBOLS.filter((s) => !furniturePaintable(s)).sort()).toEqual(["car", "tree"]);
  });
});

describe("validate: the paint keys on a piece", () => {
  it("accepts a colour, and a texture with a rotation and a scale, on every paintable symbol", () => {
    for (const s of FURNITURE_SYMBOLS.filter(furniturePaintable)) {
      expect(errorsOf(piece(s, { color: "#c03030" })), s).toEqual([]);
      expect(errorsOf(piece(s, { texture: "wood-light", textureRot: 45, textureScale: 1.5 })), s).toEqual([]);
    }
    for (const id of TEXTURE_IDS) expect(errorsOf(piece("table", { texture: id })), id).toEqual([]);
  });
  const junk: [string, Record<string, unknown>, RegExp][] = [
    ["colour red", { color: "red" }, /color/], ["colour #12345", { color: "#12345" }, /color/], ["colour number", { color: 5 }, /color/],
    ["colour with markup", { color: '#"><script>' }, /color/],
    ["unknown texture", { texture: "plaid" }, /texture/], ["texture __proto__", { texture: "__proto__" }, /texture/], ["texture number", { texture: 3 }, /texture/],
    ["rotation NaN-ish string", { texture: "wood-light", textureRot: "45" }, /textureRot/], ["rotation Infinity", { texture: "wood-light", textureRot: 1e999 }, /textureRot/],
    ["rotation 360", { texture: "wood-light", textureRot: 360 }, /textureRot/],
    ["scale 0", { texture: "wood-light", textureScale: 0 }, /textureScale/], ["scale 3", { texture: "wood-light", textureScale: 3 }, /textureScale/], ["scale null", { texture: "wood-light", textureScale: null }, /textureScale/],
    ["rotation without a texture", { textureRot: 10 }, /textureRot/], ["scale without a texture", { textureScale: 1.5 }, /textureScale/],
  ];
  for (const [label, extra, re] of junk) {
    it(`reports ${label}, names the piece, and does not throw`, () => {
      const errs = errorsOf(piece("sofa", extra));
      expect(errs.some((e) => e.includes("m1") && re.test(e)), `${label}: ${errs.join(" | ")}`).toBe(true);
    });
  }
  it("a car keeps its colour and refuses a texture; a tree takes no paint (decision, DECISIONS 2026-11-06)", () => {
    expect(errorsOf(piece("car", { color: "#c03030" }))).toEqual([]);
    for (const k of [{ texture: "wood-light" }, { textureRot: 10 }, { textureScale: 1.5 }]) expect(errorsOf(piece("car", k)).some((e) => e.includes("m1") && /car/.test(e)), JSON.stringify(k)).toBe(true);
    for (const k of [{ color: "#c03030" }, { texture: "wood-light" }]) expect(errorsOf(piece("tree", k)).some((e) => e.includes("m1") && /tree/.test(e)), JSON.stringify(k)).toBe(true);
  });
  it("model and attached still belong to a car only", () => {
    expect(errorsOf(piece("sofa", { model: "suv" })).some((e) => /model/.test(e) && /car/.test(e))).toBe(true);
  });
  it("never throws on hostile shapes", () => {
    for (const m of [null, 5, "x", [], { id: "m1", symbol: "sofa", color: {}, texture: [], textureRot: {}, textureScale: [] }]) expect(() => validate(layoutOf(m)), JSON.stringify(m)).not.toThrow();
  });
});

describe("migrate: paint shapes are not trusted", () => {
  const out = (m: Record<string, unknown>) => {
    const l = migrate(layoutOf(m) as never) as unknown as Layout;
    return l.floors.Ground.furniture[0] as unknown as Record<string, unknown>;
  };
  it("keeps good paint, drops bad paint, and the result validates", () => {
    expect(out(piece("sofa", { color: "#AABBCC" })).color).toBe("#AABBCC");
    const w = out(piece("sofa", { texture: "wood-dark", textureRot: 90, textureScale: 0.5 }));
    expect(w).toMatchObject({ texture: "wood-dark", textureRot: 90, textureScale: 0.5 });
    const bad = out(piece("sofa", { color: "red", texture: "plaid", textureRot: "x", textureScale: 9 }));
    for (const k of ["color", "texture", "textureRot", "textureScale"]) expect(bad[k], k).toBeUndefined();
    const half = out(piece("sofa", { texture: "wood-dark", textureRot: Infinity, textureScale: -1 }));
    expect(half.texture).toBe("wood-dark");
    expect(half.textureRot).toBeUndefined();
    expect(half.textureScale).toBeUndefined();
    expect(validate(migrate(layoutOf(piece("sofa", { color: 5, texture: {} })) as never)).ok).toBe(true);
  });
  it("a texture on a car, and any paint on a tree, go; a car's colour stays", () => {
    const c = out(piece("car", { color: "#c03030", texture: "wood-dark", textureRot: 10 }));
    expect(c.color).toBe("#c03030");
    expect(c.texture).toBeUndefined();
    expect(c.textureRot).toBeUndefined();
    const t = out(piece("tree", { color: "#c03030", texture: "wood-dark" }));
    expect(t.color).toBeUndefined();
    expect(t.texture).toBeUndefined();
  });
  it("a texture rotation or scale with no texture goes", () => {
    const m = out(piece("sofa", { textureRot: 10, textureScale: 1.5 }));
    expect(m.textureRot).toBeUndefined();
    expect(m.textureScale).toBeUndefined();
  });
});

describe("EditorState.paint on furniture: one undo step each", () => {
  const layout = () => ({ ...layoutOf(piece("sofa")), version: 2 }) as unknown as Layout;
  it("a colour, then a wood texture, then null; each is one step and undo restores the one before", () => {
    const st = new EditorState(layout());
    expect(st.paint("furniture", 0, { color: "#AB12CD" })).toBe(true);
    expect(st.f.furniture[0].color).toBe("#ab12cd");
    expect(st.layout.palette).toEqual(["#ab12cd"]);
    expect(st.paint("furniture", 0, { texture: "wood-warm", rot: 45, scale: 1.5 })).toBe(true);
    expect(st.f.furniture[0]).toMatchObject({ texture: "wood-warm", textureRot: 45, textureScale: 1.5 });
    expect(st.f.furniture[0].color).toBeUndefined();
    expect(st.paint("furniture", 0, null)).toBe(true);
    for (const k of ["color", "texture", "textureRot", "textureScale"]) expect((st.f.furniture[0] as unknown as Record<string, unknown>)[k], k).toBeUndefined();
    expect(st.undo()).toBe(true);
    expect(st.f.furniture[0].texture).toBe("wood-warm");
    expect(st.undo()).toBe(true);
    expect(st.f.furniture[0].color).toBe("#ab12cd");
    expect(st.undo()).toBe(true);
    expect(st.f.furniture[0].color).toBeUndefined();
    expect(st.layout.palette).toBeUndefined();
    expect(st.undo()).toBe(false);
  });
  it("refuses a bad colour, an unknown texture, a missing piece, an unchanged value and a car's texture, recording nothing", () => {
    const st = new EditorState(layout());
    expect(st.paint("furniture", 0, { color: "red" })).toBe(false);
    expect(st.paint("furniture", 0, { texture: "plaid" })).toBe(false);
    expect(st.paint("furniture", 5, { color: "#aabbcc" })).toBe(false);
    expect(st.paint("furniture", 0, null)).toBe(false);
    expect(st.undo()).toBe(false);
    const car = new EditorState(layoutOf(piece("car", { w: 470, h: 182 })) as unknown as Layout);
    expect(car.paint("furniture", 0, { texture: "wood-warm" })).toBe(false);
    expect(car.paint("furniture", 0, { color: "#c03030" })).toBe(true);
  });
  it("the painted layout validates", () => {
    const st = new EditorState(layout());
    st.paint("furniture", 0, { texture: "wood-dark", rot: 10, scale: 0.5 });
    expect(validate(JSON.parse(JSON.stringify(st.layout))).ok).toBe(true);
  });
});

describe("renderFloor: 2D fills the piece and keeps its lines", () => {
  it("no paint keeps today's markup: no paint class, no custom property", () => {
    const g = groupOf(draw(piece("sofa")));
    expect(g).not.toContain("fpaint");
    expect(g).not.toContain("--fp-furn-fill");
  });
  it("a colour is a custom property on the group that a class rule reads; the outline and lines stay", () => {
    const html = draw(piece("bed", { color: "#c03030" }));
    const g = groupOf(html);
    expect(g).toMatch(/class="furn fpaint"/);
    expect(g).toContain("--fp-furn-fill:#c03030");
    expect(html).toContain('stroke="currentColor"'); // the symbol's own strokes
    expect(html).toContain('d="M4 40 H96"'); // the bed's line
    expect(html).not.toMatch(/class="ff"[^>]*fill=/); // no presentation attribute to lose to a rule (finding 18)
  });
  it("a texture points at a pattern made for this piece (its size and the texture's turn and scale) and declares it", () => {
    const html = draw(piece("table", { texture: "wood-light", textureRot: 30, textureScale: 0.5, w: 160, h: 80 }));
    const m = /--fp-furn-fill:url\(#([^)]+)\)/.exec(groupOf(html));
    expect(m, groupOf(html)).not.toBeNull();
    const pat = new RegExp(`<pattern id="${m![1]}"[^>]*>`).exec(html)?.[0] ?? "";
    expect(pat).toContain("patternTransform");
    expect(pat).toContain("scale(0.625 1.25)"); // 100 / w and 100 / h: the piece's group is scaled w/100 x h/100
    expect(pat).toContain("rotate(30)");
    // two sizes, two patterns
    expect(draw(piece("table", { texture: "wood-light", textureRot: 30, textureScale: 0.5, w: 100, h: 80 }))).not.toContain(m![1]);
  });
  it("an escape: a hostile colour or texture never reaches the markup", () => {
    for (const bad of [{ color: '"><script>alert(1)</script>' }, { texture: '"><script>alert(1)</script>' }, { color: "#abc;stroke:red" }]) {
      const html = draw(piece("sofa", bad));
      expect(html, JSON.stringify(bad)).not.toContain("<script>");
      expect(groupOf(html), JSON.stringify(bad)).not.toContain("fpaint");
    }
  });
  it("2.5D: the block and its lid wear the colour; sides are shades of it; a texture colours the block with its base colour", () => {
    const g = groupOf(draw(piece("sofa", { color: "#c03030" }), "2.5d"));
    expect(g).toContain("--fp-furn-fill:#c03030");
    expect(g).toContain("--fp-box-top:#c03030");
    expect(g).toMatch(/--fp-box-side:color-mix\(in srgb,#c03030 \d+%,black\)/);
    expect(g).toMatch(/--fp-box-side-w:color-mix\(in srgb,#c03030 \d+%,black\)/);
    const t = groupOf(draw(piece("table", { texture: "wood-dark" }), "2.5d"));
    expect(t).toContain(`--fp-box-top:${TEXTURES.find((x) => x.id === "wood-dark")!.preview}`);
    expect(t).toContain("--fp-furn-fill:url(#fp-tex-wood-dark-f");
  });
  it("2.5D with no paint keeps the theme's block", () => {
    expect(groupOf(draw(piece("sofa"), "2.5d"))).not.toContain("--fp-box-top");
  });
  it("a car keeps its own paint path: --fp-car-body, no fpaint", () => {
    const g = groupOf(draw(piece("car", { w: 470, h: 182, color: "#c03030" })));
    expect(g).toContain("--fp-car-body:#c03030");
    expect(g).not.toContain("fpaint");
  });
});

describe("buildScene: 3D colours the piece", () => {
  const parts = (m: unknown) => buildScene(floorOf([m])).solids.filter((s) => s.kind === "furniture");
  it("a colour, or a texture's base colour, is the solid's paint colour; the role stays", () => {
    expect(parts(piece("sofa", { color: "#c03030" }))[0].paint).toEqual({ role: "furniture-sofa", color: "#c03030" });
    expect(parts(piece("table", { texture: "wood-dark" })).find((b) => !b.paint.role.endsWith("-dark"))!.paint).toEqual({ role: "furniture-table", color: TEXTURES.find((t) => t.id === "wood-dark")!.preview });
  });
  it("every block of a painted piece wears the paint; a leg is it 20 % darker (B53.4 with B53.5)", () => {
    const blocks = parts(piece("table", { color: "#c86432" }));
    expect(blocks.length).toBe(5); // a top and four legs
    expect(blocks.filter((b) => b.paint.color === "#c86432").map((b) => b.paint.role)).toEqual(["furniture-table"]);
    expect(blocks.filter((b) => b.paint.color === "#a05028").map((b) => b.paint.role)).toEqual(Array(4).fill("furniture-table-dark"));
  });
  it("no paint keeps the palette role alone", () => {
    expect(parts(piece("sofa"))[0].paint).toEqual({ role: "furniture-sofa" });
  });
  it("junk paint is ignored; a car keeps its own colour path", () => {
    expect(parts(piece("sofa", { color: '"><script>' }))[0].paint).toEqual({ role: "furniture-sofa" });
    const car = parts(piece("car", { w: 470, h: 182, color: "#c03030" }));
    expect(car.some((s) => s.paint.color === "#c03030")).toBe(true);
  });
});
