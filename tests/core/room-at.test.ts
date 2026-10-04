import { describe, it, expect } from "vitest";
import type { Device, DeviceType, Floor, Pt, RoomKind } from "../../src/core/schema";
import { ROOM_KINDS } from "../../src/core/schema";
import { ROOM_OWNS, renderFloor, roomAt, type StateOverlay } from "../../src/core/render";
import { roomSummary } from "../../src/core/room-info";

// Opus review of Sprint 11, finding 2: one rule for "the room a point belongs to", used by the lamp aura clip, the
// editor's Attach, the readout, the Sensors section and the card's room summary. The smallest room that is not a
// zone, a structure or a fill.
const sq = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const room = (name: string, pts: Pt[], extra: Record<string, unknown> = {}) => ({ id: name, name, area: "", kind: "room", pts, wk: ["wall", "wall", "wall", "wall"], ...extra });
const dev = (type: DeviceType, entity: string, x: number, y: number): Device => ({ id: entity, type, entity, name: entity.split(".")[1], x, y }) as Device;
const floor = (rooms: unknown[], devices: Device[] = []): Floor =>
  ({ title: "G", outline: [], walls: [], stairs: [], openings: [], extras: [], furniture: [], unlinked: [], doors: [], devices, rooms }) as unknown as Floor;
const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-04T10:00:00Z" });

describe("roomAt", () => {
  it("decides every RoomKind (finding 17): who may own a point", () => {
    const owns: Record<RoomKind, boolean> = { room: true, garden: true, pavement: true, terrace: true, water: true, fill: false, structure: false, zone: false };
    expect(Object.keys(ROOM_OWNS).sort()).toEqual([...ROOM_KINDS].sort());
    for (const k of ROOM_KINDS) {
      expect(ROOM_OWNS[k], k).toBe(owns[k]);
      // a small room of this kind alone on the floor: it owns the point only when its kind may
      expect(roomAt(floor([room("X", sq(0, 0, 100, 100), { kind: k })]), [50, 50]), k).toBe(owns[k] ? 0 : -1);
    }
  });
  it("takes the smallest owning room, skipping a smaller structure, zone or fill on top", () => {
    const f = floor([room("Hall", sq(0, 0, 400, 400)), room("Closet", sq(10, 10, 100, 100)), room("Box", sq(40, 40, 40, 40), { kind: "structure" }), room("Z", sq(45, 45, 20, 20), { kind: "zone" })]);
    expect(roomAt(f, [50, 50])).toBe(1);
    expect(roomAt(f, [300, 300])).toBe(0);
    expect(roomAt(f, [900, 900])).toBe(-1);
  });
  it("ties in area go to the highest index, the polygon a tap reaches (drawn last)", () => {
    const f = floor([room("Under", sq(0, 0, 100, 100)), room("Over", sq(0, 0, 100, 100))]);
    expect(roomAt(f, [50, 50])).toBe(1);
  });
  it("never throws on junk", () => {
    const f = floor([{ kind: "room", pts: 5 }, { kind: "room", pts: [[NaN, 1], [1, 1], [1, 2]] }, room("Ok", sq(0, 0, 10, 10))]);
    expect(roomAt(f, [5, 5])).toBe(2);
    expect(roomAt(f, [NaN, 5])).toBe(-1);
  });
});

describe("the surfaces that follow the rule", () => {
  const lamp = dev("light", "light.l", 60, 60);
  const on: StateOverlay = { "light.l": st("on") };
  it("a lamp inside a structure is clipped to the room around it, not to the structure", () => {
    const f = floor([room("Hall", sq(0, 0, 400, 400)), room("Box", sq(40, 40, 60, 40), { kind: "structure" })], [lamp]);
    const html = renderFloor(f, { scale: 0.5, state: on });
    const id = /<circle class="aura"[^>]*clip-path="url\(#([^)]+)\)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(new RegExp(`<clipPath id="${id}"[^>]*><polygon points="0,0 400,0 400,400 0,400"`).test(html)).toBe(true);
  });
  it("a lamp whose only holder is a structure keeps the free circle", () => {
    const html = renderFloor(floor([room("Box", sq(40, 40, 60, 40), { kind: "structure" })], [lamp]), { scale: 0.5, state: on });
    expect(html).toMatch(/<circle class="aura" cx="60" cy="60" r="150"\/>/);
  });
  it("a structure draws no readout, as it has no Sensors section", () => {
    const f = floor([room("Box", sq(0, 0, 100, 100), { kind: "structure", temps: ["sensor.t"] })]);
    expect(renderFloor(f, { scale: 0.5, state: { "sensor.t": st("20") } })).not.toContain('class="val"');
  });
  it("roomSummary counts a device in exactly one room: the closet's lamp is not the hall's", () => {
    const f = floor([room("Hall", sq(0, 0, 400, 400)), room("Closet", sq(10, 10, 100, 100))], [lamp]);
    const state = on;
    const opts = { plugWatts: 10, powerLinks: new Map() } as never;
    expect(roomSummary(f, 0, state, opts)!.devices).toEqual([]);
    expect(roomSummary(f, 0, state, opts)!.lightsOn).toEqual([]);
    expect(roomSummary(f, 1, state, opts)!.devices.map((r) => r.entity)).toEqual(["light.l"]);
    expect(roomSummary(f, 1, state, opts)!.lightsOn).toHaveLength(1);
  });
});
