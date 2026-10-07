import { describe, it, expect } from "vitest";
import { FURNITURE_SYMBOLS, type Device, type Floor, type Furniture, type Layout } from "../../src/core/schema";
import { classOf, pieceOn, renderFloor, type StateOverlay } from "../../src/core/render";
import { activeDevices } from "../../src/core/active";
import { roomSummary } from "../../src/core/room-info";
import { roomSceneTargets } from "../../src/editor/room-scenes-ops";

// A tv, speaker or computer piece with an entity is linked, and in the card it behaves like the device of the same
// type (DECISIONS 2026-10-07, linked piece carries device behaviour). One predicate, `pieceOn`, is the on rule.
const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-07T10:00:00Z" });
const piece = (symbol: string, entity: string | undefined, extra: Partial<Furniture> = {}): Furniture => ({ id: `p-${symbol}`, symbol, x: 100, y: 100, rot: 0, w: 120, h: 10, ...(entity ? { entity } : {}), ...extra }) as Furniture;
const floorOf = (furniture: Furniture[], devices: Device[] = []): Floor => ({
  title: "F", outline: [], walls: [], stairs: [], openings: [], extras: [], unlinked: [], doors: [], devices, furniture,
  rooms: [{ id: "r0", name: "Living", area: "", kind: "room", pts: [[0, 0], [400, 0], [400, 300], [0, 300]], wk: ["wall", "wall", "wall", "wall"] }, { id: "r1", name: "Study", area: "", kind: "room", pts: [[400, 0], [800, 0], [800, 300], [400, 300]], wk: ["wall", "wall", "wall", "wall"] }],
}) as unknown as Floor;
const layoutOf = (f: Floor): Layout => ({ version: 2, unit: "cm", north: 0, catalog: [], floors: { f } }) as unknown as Layout;
const STATES = ["on", "off", "playing", "paused", "idle", "standby", "unavailable", "unknown", "open"];

describe("pieceOn: the on rule of a linked piece is its device type's rule", () => {
  for (const symbol of ["tv", "speaker", "computer"] as const) {
    it(`${symbol}: every state reads as the ${symbol} device reads it`, () => {
      for (const s of STATES) {
        const state: StateOverlay = { "media_player.x": st(s) };
        const dev = { id: "d", type: symbol, entity: "media_player.x", x: 0, y: 0 } as Device;
        expect(pieceOn({ scale: 1, state }, piece(symbol, "media_player.x")), `${symbol} ${s}`).toBe(classOf(dev, { scale: 1, state }) === "on");
      }
    });
  }
  it("a paused or idle tv reads on; a speaker is on only while playing; off and unavailable are never on", () => {
    const on = (symbol: string, s: string) => pieceOn({ scale: 1, state: { "media_player.x": st(s) } }, piece(symbol, "media_player.x"));
    expect(on("tv", "paused")).toBe(true);
    expect(on("tv", "idle")).toBe(true);
    expect(on("tv", "off")).toBe(false);
    expect(on("tv", "standby")).toBe(false);
    expect(on("tv", "unavailable")).toBe(false);
    expect(on("speaker", "playing")).toBe(true);
    expect(on("speaker", "paused")).toBe(false);
  });
  it("an unlinked piece keeps the old rule: on, open or playing", () => {
    const on = (symbol: string, s: string) => pieceOn({ scale: 1, state: { "switch.x": st(s) } }, piece(symbol, "switch.x"));
    expect(on("patio-wood", "on")).toBe(true);
    expect(on("patio-wood", "paused")).toBe(false);
    expect(pieceOn({ scale: 1, state: { "switch.x": st("on") } }, piece("tv", undefined))).toBe(false);
  });
  it("every furniture symbol is decided (finding 17)", () => {
    for (const symbol of FURNITURE_SYMBOLS) {
      const paused = pieceOn({ scale: 1, state: { "media_player.x": st("paused") } }, piece(symbol, "media_player.x"));
      expect(paused, symbol).toBe(symbol === "tv");
    }
  });
});

describe("render: a paused linked tv piece is on", () => {
  it("carries class on in 2D and 2.5D; the same piece off does not", () => {
    const f = floorOf([piece("tv", "media_player.x")]);
    const draw = (s: string, view?: "2.5d") => renderFloor(f, { scale: 1, state: { "media_player.x": st(s) }, ...(view ? { view } : {}) });
    const cls = (h: string) => h.match(/<g data-f="0" class="([^"]*)"/)![1].split(" ");
    expect(cls(draw("paused"))).toEqual(["furn", "on"]);
    expect(cls(draw("paused", "2.5d"))).toEqual(["furn", "on"]);
    expect(cls(draw("off"))).toEqual(["furn"]);
  });
});

describe("the Active list takes a linked piece", () => {
  it("lists a playing tv piece as a tv, with the tv colour and its own name; a paused tv too, an off one not", () => {
    const f = floorOf([piece("tv", "media_player.x", { name: "Big screen" })]);
    expect(activeDevices(layoutOf(f), { "media_player.x": st("playing") })).toEqual([{ entity: "media_player.x", name: "Big screen", type: "tv", floor: "f", colorVar: "--fp-dev-tv" }]);
    expect(activeDevices(layoutOf(f), { "media_player.x": st("paused") })).toHaveLength(1);
    expect(activeDevices(layoutOf(f), { "media_player.x": st("off") })).toEqual([]);
  });
  it("a speaker piece is listed while playing, with the speaker colour", () => {
    const f = floorOf([piece("speaker", "media_player.s")]);
    expect(activeDevices(layoutOf(f), { "media_player.s": st("playing") }).map((r) => [r.type, r.colorVar])).toEqual([["speaker", "--fp-dev-speaker"]]);
    expect(activeDevices(layoutOf(f), { "media_player.s": st("paused") })).toEqual([]);
  });
  it("an unlinked piece, or one with another symbol, is never listed", () => {
    expect(activeDevices(layoutOf(floorOf([piece("tv", undefined), piece("patio-wood", "media_player.x")])), { "media_player.x": st("playing") })).toEqual([]);
  });
  it("an entity that is a device too is listed once", () => {
    const d = { id: "d", type: "tv", entity: "media_player.x", x: 10, y: 10 } as Device;
    expect(activeDevices(layoutOf(floorOf([piece("tv", "media_player.x")], [d])), { "media_player.x": st("playing") })).toHaveLength(1);
    expect(activeDevices(layoutOf(floorOf([piece("tv", "media_player.x"), piece("tv", "media_player.x", { id: "p2" })])), { "media_player.x": st("playing") })).toHaveLength(1);
  });
});

describe("the room's rows and scene targets take a linked piece", () => {
  const f = floorOf([piece("tv", "media_player.x", { name: "Big screen" }), piece("speaker", "media_player.far", { x: 600 }), piece("tv", undefined, { id: "plain" })]);
  const state: StateOverlay = { "media_player.x": st("paused"), "media_player.far": st("playing") };
  it("lists the piece in the room it stands in, as a tv row that is on, flagged as a piece, and not in the other room", () => {
    const s = roomSummary(f, 0, state, {})!;
    expect(s.devices).toEqual([{ index: 0, piece: true, entity: "media_player.x", name: "Big screen", type: "tv", state: "paused", on: true, colorVar: "--fp-dev-tv" }]);
    expect(s.entities.has("media_player.x")).toBe(true);
    expect(roomSummary(f, 1, state, {})!.devices.map((r) => r.entity)).toEqual(["media_player.far"]);
  });
  it("an entity that is a device in the room too gives one row, the device's", () => {
    const g = floorOf([piece("tv", "media_player.x")], [{ id: "d", type: "tv", entity: "media_player.x", x: 10, y: 10 } as Device]);
    const rows = roomSummary(g, 0, state, {})!.devices;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.piece).toBeUndefined();
  });
  it("is a scene target once, by name", () => {
    expect(roomSceneTargets(f, 0)).toEqual([{ entity: "media_player.x", name: "Big screen" }]);
    const g = floorOf([piece("tv", "media_player.x")], [{ id: "d", type: "tv", entity: "media_player.x", x: 10, y: 10 } as Device]);
    expect(roomSceneTargets(g, 0)).toHaveLength(1);
  });
});
