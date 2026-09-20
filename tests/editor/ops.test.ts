import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import type { Layout, Pt } from "../../src/core/schema";
import { rotateSegment, snapRoomTo, spawnPoint } from "../../src/editor/ops";

const ground = () => structuredClone((demo as unknown as Layout).floors.ground);
const FALLBACK: Pt = [123, 457];

describe("spawnPoint", () => {
  it("is right of the outline's bounding box, at its top, on the 5 cm grid", () => {
    const f = ground();
    f.outline = [[10, 20], [803, 20], [803, 604], [10, 604]]; // max x 803, min y 20: asymmetric on purpose
    expect(spawnPoint(f, FALLBACK)).toEqual([955, 20]); // 803 + 150 = 953 rounds to 955
  });

  it("uses the demo outline: 800 wide, top at 0", () => {
    expect(spawnPoint(ground(), FALLBACK)).toEqual([950, 0]);
  });

  it("returns the fallback for an outline of fewer than three points", () => {
    const f = ground();
    f.outline = [];
    expect(spawnPoint(f, FALLBACK)).toEqual(FALLBACK);
    f.outline = [[0, 0], [100, 0]];
    expect(spawnPoint(f, FALLBACK)).toEqual(FALLBACK);
  });

  it("does not change the floor", () => {
    const f = ground(), copy = structuredClone(f);
    spawnPoint(f, FALLBACK);
    expect(f).toEqual(copy);
  });
});

describe("snapRoomTo", () => {
  it("moves a room 3 cm off its place back onto the neighbour's corner, and shares the edge", () => {
    const f = ground(), orig = structuredClone(f);
    f.rooms[0].pts = f.rooms[0].pts.map((p): Pt => [p[0] + 3, p[1] - 2]);
    const g = snapRoomTo(f, 0, 14);
    expect(g.rooms[0].pts).toEqual(orig.rooms[0].pts);
    expect(g.rooms[0].pts[1]).toEqual(g.rooms[1].pts[0]);
  });
  it("uses the closest corner pair, not the first in range", () => {
    const f = ground(), orig = structuredClone(f);
    f.rooms[0].pts = f.rooms[0].pts.map((p): Pt => [p[0] + 4, p[1]]);
    expect(snapRoomTo(f, 0, 14).rooms[0].pts).toEqual(orig.rooms[0].pts);
  });
  it("changes nothing when no corner is in range, or for a zone", () => {
    const f = ground();
    f.rooms[0].pts = f.rooms[0].pts.map((p): Pt => [p[0] + 300, p[1] + 300]);
    expect(snapRoomTo(f, 0, 14)).toBe(f);
    const z = ground(), zi = z.rooms.findIndex((r) => r.kind === "zone");
    z.rooms[zi].pts = z.rooms[zi].pts.map((p): Pt => [p[0] + 3, p[1]]);
    expect(snapRoomTo(z, zi, 14)).toBe(z);
  });
});

describe("rotateSegment", () => {
  it("turns a horizontal segment 90 degrees about its midpoint", () => {
    expect(rotateSegment([100, 200], [300, 200], 90)).toEqual({ a: [200, 100], b: [200, 300] });
  });
  it("keeps the midpoint and the length, rounded to 1 cm", () => {
    const r = rotateSegment([0, 0], [100, 0], 30);
    expect(r.a).toEqual([7, -25]);
    expect(r.b).toEqual([93, 25]);
    expect([(r.a[0] + r.b[0]) / 2, (r.a[1] + r.b[1]) / 2]).toEqual([50, 0]);
    expect(Math.abs(Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]) - 100)).toBeLessThanOrEqual(1); // rounding to 1 cm costs at most 1 cm
  });
  it("360 degrees gives the segment back, and 0 changes nothing", () => {
    expect(rotateSegment([10, 20], [110, 20], 360)).toEqual({ a: [10, 20], b: [110, 20] });
    expect(rotateSegment([10, 20], [110, 20], 0)).toEqual({ a: [10, 20], b: [110, 20] });
  });
  it("a segment of zero length stays a point", () => {
    expect(rotateSegment([5, 5], [5, 5], 77)).toEqual({ a: [5, 5], b: [5, 5] });
  });
});
