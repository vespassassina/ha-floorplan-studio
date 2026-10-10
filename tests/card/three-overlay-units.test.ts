import { describe, expect, it } from "vitest";
import { ROOM_PRIORITY, roomPriority } from "../../src/card/three/overlay";
import { ROOM_KINDS } from "../../src/core/schema";

// S28 review: which room name keeps its place when labels meet. Finding 17: a decision for every member of the union.
describe("roomPriority", () => {
  it("decides every room kind, with a finite number", () => {
    expect(Object.keys(ROOM_PRIORITY).sort()).toEqual([...ROOM_KINDS].sort());
    for (const k of ROOM_KINDS) expect(Number.isFinite(roomPriority(k)), k).toBe(true);
  });
  it("keeps the ranking that shipped: a room over a garden over water", () => {
    expect(roomPriority("room")).toBeGreaterThan(roomPriority("garden"));
    expect(roomPriority("garden")).toBeGreaterThan(roomPriority("water"));
  });
  it("a garden-, terrace-, pavement- or water-type outdoor name ranks below every indoor name", () => {
    for (const out of ["garden", "terrace", "pavement", "water"] as const) for (const inn of ["room", "structure", "zone"] as const) expect(roomPriority(out), `${out} < ${inn}`).toBeLessThan(roomPriority(inn));
  });
  it("a fill names nothing worth keeping over a room's name, and an unknown kind ranks as a room", () => {
    expect(roomPriority("fill")).toBeLessThan(roomPriority("room"));
    expect(roomPriority("nonsense")).toBe(roomPriority("room"));
  });
});
