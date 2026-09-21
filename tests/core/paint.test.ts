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
});
