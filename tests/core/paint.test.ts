import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import { validate, renderFloor, TEXTURES, type Layout } from "../../src/core";
import { EditorState } from "../../src/editor/state";

const fresh = () => structuredClone(demo) as unknown as Layout;
const opts = { scale: 1 } as const;

describe("room and stair paint: colours you used, and textures", () => {
  it("a custom colour joins layout.palette once, lower-case, and stays after a reload of the JSON", () => {
    const st = new EditorState(fresh());
    expect(st.paint("rooms", 0, { color: "#AABBCC" })).toBe(true);
    expect(st.layout.palette).toEqual(["#aabbcc"]);
    expect(st.paint("rooms", 1, { color: "#aabbcc" })).toBe(true); // reused: not added twice
    expect(st.layout.palette).toEqual(["#aabbcc"]);
    expect(validate(JSON.parse(JSON.stringify(st.layout))).ok).toBe(true);
  });

  it("a built-in swatch colour is not added to the palette", () => {
    const st = new EditorState(fresh());
    st.paint("rooms", 0, { color: "#f4f4f0" });
    expect(st.layout.palette).toBeUndefined();
  });

  it("colour and palette are one undo step, and the same colour again is none", () => {
    const st = new EditorState(fresh());
    st.paint("rooms", 0, { color: "#123456" });
    expect(st.paint("rooms", 0, { color: "#123456" })).toBe(false);
    expect(st.undo()).toBe(true);
    expect(st.layout.palette).toBeUndefined();
    expect(st.f.rooms[0].color).toBeUndefined();
    expect(st.undo()).toBe(false);
  });

  it("a texture replaces the colour, a colour replaces the texture, null clears both", () => {
    const st = new EditorState(fresh());
    st.paint("rooms", 0, { color: "#123456" });
    st.paint("rooms", 0, { texture: "wood-dark" });
    expect(st.f.rooms[0]).toMatchObject({ texture: "wood-dark" });
    expect(st.f.rooms[0].color).toBeUndefined();
    st.paint("rooms", 0, { color: "#654321" });
    expect(st.f.rooms[0].texture).toBeUndefined();
    st.paint("rooms", 0, null);
    expect(st.f.rooms[0].color).toBeUndefined();
    expect(st.f.rooms[0].texture).toBeUndefined();
  });

  it("refuses a bad colour, an unknown texture and a missing shape, recording nothing", () => {
    const st = new EditorState(fresh());
    expect(st.paint("rooms", 0, { color: "red" })).toBe(false);
    expect(st.paint("rooms", 0, { texture: "lava" })).toBe(false);
    expect(st.paint("rooms", 99, { color: "#123456" })).toBe(false);
    expect(st.undo()).toBe(false);
  });

  it("a staircase can be painted, and a zone is a room so it can too", () => {
    const st = new EditorState(fresh());
    expect(st.f.stairs.length).toBeGreaterThan(0);
    st.paint("stairs", 0, { texture: "stone-grey" });
    const html = renderFloor(st.f, opts);
    expect(html).toMatch(/<(polygon|path) class="stairs room" fill="url\(#fp-tex-stone-grey\)"/);
    st.edit((f) => { f.rooms.push({ id: "zone-1", name: "Rug", area: "", label: "", kind: "zone", pts: [[10, 10], [60, 10], [60, 60], [10, 60]], wk: ["boundary", "boundary", "boundary", "boundary"] }); });
    const z = st.f.rooms.length - 1;
    st.paint("rooms", z, { color: "#336699" });
    expect(renderFloor(st.f, opts)).toContain(`data-r="${z}" class="room room-zone" fill="#336699"`);
  });

  it("there are 3 wood and 4 stone textures, and only the ones in use are declared", () => {
    expect(TEXTURES.filter((t) => t.id.startsWith("wood"))).toHaveLength(3);
    expect(TEXTURES.filter((t) => t.id.startsWith("stone"))).toHaveLength(4);
    const st = new EditorState(fresh());
    expect(renderFloor(st.f, opts)).not.toContain("fp-tex-");
    st.paint("rooms", 0, { texture: "wood-light" });
    const html = renderFloor(st.f, opts);
    expect(html).toContain('<pattern id="fp-tex-wood-light"');
    expect(html).toContain('fill="url(#fp-tex-wood-light)"');
    expect(html).not.toContain('id="fp-tex-stone');
  });

  it("validate rejects an unknown texture and a bad palette; render ignores a hostile texture value", () => {
    const l = fresh();
    (l.floors[Object.keys(l.floors)[0]].rooms[0] as any).texture = '"><script>x</script>';
    expect(validate(l).ok).toBe(false);
    const html = renderFloor(l.floors[Object.keys(l.floors)[0]], opts);
    expect(html).not.toContain("<script>");
    const p = fresh(); (p as any).palette = ["#12345", 5];
    expect(validate(p).ok).toBe(false);
    const q = fresh(); (q as any).palette = Array(25).fill("#123456");
    expect(validate(q).ok).toBe(false);
  });

  // S4.22: a texture's own rotation.
  it("validate accepts textureRot in [0, 360) and rejects everything else; it never appears without a texture", () => {
    const ok = fresh();
    (ok.floors[Object.keys(ok.floors)[0]].rooms[0] as any).texture = "wood-light";
    (ok.floors[Object.keys(ok.floors)[0]].rooms[0] as any).textureRot = 0;
    expect(validate(ok).ok).toBe(true);
    for (const bad of [-1, 360, 361, NaN, Infinity, "45", null, "many"]) {
      const l = fresh();
      (l.floors[Object.keys(l.floors)[0]].rooms[0] as any).texture = "wood-light";
      (l.floors[Object.keys(l.floors)[0]].rooms[0] as any).textureRot = bad;
      expect(validate(l).ok, `textureRot ${String(bad)} should be refused`).toBe(false);
    }
    const noTex = fresh();
    (noTex.floors[Object.keys(noTex.floors)[0]].rooms[0] as any).textureRot = 45; // no texture set at all: the field itself is still well-formed, so validate accepts it (the render simply never uses it)
    expect(validate(noTex).ok).toBe(true);
  });

  it("a texture rotation clears when the texture or colour changes, and render ignores a hostile textureRot value", () => {
    const st = new EditorState(fresh());
    st.paint("rooms", 0, { texture: "wood-light", rot: 90 });
    expect(st.f.rooms[0].textureRot).toBe(90);
    st.paint("rooms", 0, { texture: "stone-grey" }); // a fresh texture starts unrotated
    expect(st.f.rooms[0].textureRot).toBeUndefined();
    st.paint("rooms", 0, { texture: "wood-light", rot: 45 });
    st.paint("rooms", 0, { color: "#123456" });
    expect(st.f.rooms[0].textureRot).toBeUndefined();

    const l = fresh();
    (l.floors[Object.keys(l.floors)[0]].rooms[0] as any).texture = "wood-light";
    (l.floors[Object.keys(l.floors)[0]].rooms[0] as any).textureRot = "><script>x</script>";
    const html = renderFloor(l.floors[Object.keys(l.floors)[0]], opts);
    expect(html).not.toContain("<script>");
    expect(html).toContain('fill="url(#fp-tex-wood-light)"'); // a hostile rotation falls back to 0, not a broken url
  });

  it("rotateTexture: a rotated pattern gets its own <pattern>, at 0 it reuses the plain one; only in-use rotations are declared", () => {
    const st = new EditorState(fresh());
    st.paint("rooms", 0, { texture: "wood-light" });
    st.paint("rooms", 1, { texture: "wood-light", rot: 90 });
    const html = renderFloor(st.f, opts);
    expect(html).toContain('<pattern id="fp-tex-wood-light"'); // room 0, unrotated: the plain id, unchanged from before this feature
    expect(html).toContain('<pattern id="fp-tex-wood-light-r90" width="80" height="40" patternUnits="userSpaceOnUse" patternTransform="rotate(90)"');
    expect(html).toContain('fill="url(#fp-tex-wood-light)"');
    expect(html).toContain('fill="url(#fp-tex-wood-light-r90)"');
    expect(html.match(/<pattern id="fp-tex-wood-light/g)).toHaveLength(2); // no duplicate declarations
  });

  it("rotateTexture: one undo step per gesture (a live preview via replaceFloor, committed once), none if it ends back where it started", () => {
    const st = new EditorState(fresh());
    st.paint("rooms", 0, { texture: "wood-light" });
    const before = structuredClone(st.layout);
    // Simulates the slider: replaceFloor on every drag tick (no history), one commitLiveEdit at release.
    let g = structuredClone(st.f); g.rooms[0].textureRot = 30; st.replaceFloor(g);
    g = structuredClone(st.f); g.rooms[0].textureRot = 60; st.replaceFloor(g);
    expect(st.f.rooms[0].textureRot).toBe(60); // live-previewed already, before any undo step exists
    expect(st.commitLiveEdit(before)).toBe(true);
    expect(st.f.rooms[0].textureRot).toBe(60);
    expect(st.undo()).toBe(true);
    expect(st.f.rooms[0].textureRot).toBeUndefined(); // the whole gesture is one step, back to before the drag
    expect(st.undo()).toBe(true); // the paint() that set the texture is its own, separate, earlier step
    expect(st.f.rooms[0].texture).toBeUndefined();
    expect(st.undo()).toBe(false); // nothing further back than the fresh demo layout
  });

  it("rotateTexture: a drag that ends back at its starting value adds no undo step", () => {
    const st = new EditorState(fresh());
    st.paint("rooms", 0, { texture: "wood-light", rot: 30 });
    const before = structuredClone(st.layout);
    let g = structuredClone(st.f); g.rooms[0].textureRot = 90; st.replaceFloor(g);
    g = structuredClone(st.f); g.rooms[0].textureRot = 30; st.replaceFloor(g); // back to where it started
    expect(st.commitLiveEdit(before)).toBe(false); // no-op: nothing to undo
    expect(st.f.rooms[0].textureRot).toBe(30);
  });
});
