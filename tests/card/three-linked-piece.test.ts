import { describe, expect, it } from "vitest";
import { buildScene } from "../../src/core/scene";
import { liveOf } from "../../src/core/live";
import type { Floor } from "../../src/core/schema";
import { Picker, type Ray } from "../../src/card/three/pick";
import { isKnownRole, roleStyle } from "../../src/card/three/palette";

// A linked tv, speaker or computer piece in 3D (DECISIONS 2026-10-07): the scene marks it, the live state says whether it is on
// by the device rule, the picker hands a tap on it to the gesture code as its own thing, and the palette has its two colours.
const st = (state: string) => ({ state, attributes: {}, last_changed: "2026-10-07T10:00:00Z" });
const floor = (furniture: unknown[], devices: unknown[] = []): Floor => ({
  title: "T", outline: [[0, 0], [600, 0], [600, 500], [0, 500]], owk: ["external", "external", "external", "external"],
  rooms: [{ id: "a", name: "A", area: "", kind: "room", pts: [[0, 0], [600, 0], [600, 500], [0, 500]], wk: ["wall", "wall", "wall", "wall"] }] as never,
  walls: [], stairs: [], doors: [], openings: [], extras: [], devices, furniture, unlinked: [],
}) as unknown as Floor;
const piece = (symbol: string, extra: Record<string, unknown> = {}) => ({ id: `p-${symbol}`, symbol, x: 300, y: 250, rot: 0, w: 120, h: 40, ...extra });
const solidOf = (f: Floor) => buildScene(f).solids.find((s) => s.kind === "furniture")!;

describe("scene: a linked piece", () => {
  it("carries its entity and the linked role; an unlinked one, or another symbol with an entity, keeps the plain one", () => {
    for (const symbol of ["tv", "speaker", "computer"]) {
      const s = solidOf(floor([piece(symbol, { entity: "media_player.x" })]));
      expect(s.ref.entity, symbol).toBe("media_player.x");
      expect(s.paint.role, symbol).toBe("furniture-linked");
      const plain = solidOf(floor([piece(symbol)]));
      expect(plain.ref.entity).toBeUndefined();
      expect(plain.paint.role).toBe(`furniture-${symbol}`);
    }
    const other = solidOf(floor([piece("table", { entity: "switch.x" })]));
    expect(other.ref.entity).toBeUndefined();
    expect(other.paint.role).toBe("furniture-table");
  });
});

describe("live: pieces", () => {
  const live = (f: Floor, state: Record<string, unknown>) => liveOf(f, { scale: 1, state: state as never }, 0);
  it("a paused tv piece is on, a speaker piece only while playing, an unlinked or unreadable one is null", () => {
    const f = floor([piece("tv", { entity: "media_player.t" }), piece("speaker", { entity: "media_player.s" }), piece("tv"), 5]);
    expect(live(f, { "media_player.t": st("paused"), "media_player.s": st("paused") }).pieces).toEqual([{ on: true }, { on: false }, null, null]);
    expect(live(f, { "media_player.t": st("off"), "media_player.s": st("playing") }).pieces).toEqual([{ on: false }, { on: true }, null, null]);
  });
});

describe("pick: a linked piece", () => {
  const down = (x: number, y: number): Ray => ({ o: [x, y, 1000], d: [0, 0, -1] });
  const plain = (s: { shape: { type: string; z0?: number; z1?: number } }): [number, number] | null => (s.shape.type === "prism" ? [s.shape.z0!, s.shape.z1!] : null);
  it("is its own thing, by its index; an unlinked piece is its room's floor", () => {
    const p = new Picker(buildScene(floor([piece("tv"), piece("tv", { entity: "media_player.x", x: 450 })])).solids);
    expect(p.pick(down(450, 250), plain as never)).toEqual({ type: "piece", index: 1 });
    expect(p.pick(down(300, 250), plain as never)).toEqual({ type: "room", index: 0 });
  });
});

describe("palette: the linked piece's colours", () => {
  it("has a linked idle colour and an on colour, both named, and not the plain furniture one", () => {
    for (const r of ["furniture-linked", "piece-on"]) expect(isKnownRole(r), r).toBe(true);
    expect(roleStyle("furniture-linked").css).not.toBe(roleStyle("furniture-tv").css);
    expect(roleStyle("piece-on").css).toBe("var(--fp-active)");
    expect(roleStyle("furniture-linked").css).toContain("--fp-dev-tv");
  });
});
