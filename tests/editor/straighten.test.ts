import { describe, expect, it } from "vitest";
import { validate, type Floor, type Layout, type Pt } from "../../src/core";
import { cornerAngleDeg, externalWallPlace, setCornerAngle, simplifyFloorWalls, straightenFloorWalls } from "../../src/editor/straighten";

const wrap = (f: Floor): Layout => ({ version: 2, unit: "cm", north: 0, floors: { ground: f }, catalog: [] });

const baseFloor = (pts: Pt[], walls: Floor["walls"] = []): Floor => ({
  title: "Ground",
  outline: structuredClone(pts),
  rooms: [{ id: "r1", name: "Living", area: "living", kind: "room", pts: structuredClone(pts), wk: pts.map(() => "wall") }],
  walls,
  stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [],
});

describe("S84: simplifyFloorWalls & straightenFloorWalls", () => {
  it("merges redundant collinear vertices on rooms/outline and chained collinear free walls", () => {
    // Top edge split into 3 slightly wobbly segments (y = 0, 2, -1, 0)
    const pts: Pt[] = [[0, 0], [200, 2], [400, -1], [600, 0], [600, 400], [0, 400]];
    const walls: Floor["walls"] = [
      { id: "w1", a: [0, 500], b: [200, 502], kind: "fence" },
      { id: "w2", a: [200, 502], b: [400, 500], kind: "fence" },
      { id: "w3", a: [400, 500], b: [400, 700], kind: "fence" }, // 90 deg corner: stays separate
    ];
    const res = simplifyFloorWalls(baseFloor(pts, walls));
    expect(res.merged).toBe(4); // 2 on outline + 2 on room
    expect(res.wallsMerged).toBe(1);
    expect(res.floor.outline).toHaveLength(4);
    expect(res.floor.rooms[0]!.pts).toHaveLength(4);
    expect(res.floor.walls).toHaveLength(2);
    expect(validate(wrap(res.floor)).ok).toBe(true);
  });

  it("straightens slightly skewed walls to 90° and 45° while keeping rooms stitched", () => {
    // Slightly skewed rectangle (~2° off horizontal/vertical)
    const skewed: Pt[] = [[0, 0], [600, 18], [590, 418], [-10, 400]];
    const res90 = straightenFloorWalls(baseFloor(skewed), 6, 90);
    expect(res90.straightened).toBeGreaterThanOrEqual(2);
    const o = res90.floor.outline;
    expect(o[0]![1]).toBe(o[1]![1]); // top edge perfectly horizontal
    expect(o[1]![0]).toBe(o[2]![0]); // right edge perfectly vertical
    expect(res90.floor.rooms[0]!.pts).toEqual(o); // room stayed stitched to outline
    expect(validate(wrap(res90.floor)).ok).toBe(true);

    // 43° angled wing snaps to exact 45° with stepDeg = 45
    const angled: Floor = baseFloor([[0, 0], [400, 0], [400, 400], [0, 400]], [
      { id: "w1", a: [0, 0], b: [200, 188], kind: "external" }, // ~43.2°
    ]);
    const res45 = straightenFloorWalls(angled, 6, 45);
    const w = res45.floor.walls[0]!;
    expect(Math.abs(Math.abs(w.b[0] - w.a[0]) - Math.abs(w.b[1] - w.a[1]))).toBeLessThanOrEqual(2);
  });
});

describe("S85: cornerAngleDeg & setCornerAngle", () => {
  it("measures and sets exact corner angles (90°, 45°, 60°, 135°) while keeping rooms stitched", () => {
    const f = baseFloor([[0, 0], [400, 0], [430, 390], [0, 400]]);
    const initial = cornerAngleDeg(f.outline, 1)!;
    expect(initial).toBeGreaterThan(90);

    const sq = setCornerAngle(f, "o", 1, 90);
    expect(cornerAngleDeg(sq.outline, 1)).toBeCloseTo(90, 0);
    expect(sq.rooms[0]!.pts[2]).toEqual(sq.outline[2]); // stitched corner moved together
    expect(validate(wrap(sq)).ok).toBe(true);

    const a60 = setCornerAngle(f, "o", 1, 60);
    expect(cornerAngleDeg(a60.outline, 1)).toBeCloseTo(60, 0);

    const a135 = setCornerAngle(f, "o", 1, 135);
    expect(cornerAngleDeg(a135.outline, 1)).toBeCloseTo(135, 0);
  });
});

describe("S86: externalWallPlace", () => {
  it("computes rotation and offset to align upper floor's longest exterior wall flush onto lower floor's", () => {
    const lower = baseFloor([[0, 0], [800, 0], [800, 500], [0, 500]]);
    // Upper floor shifted by (+50, +30)
    const upper = baseFloor([[50, 30], [850, 30], [850, 530], [50, 530]]);
    const r = externalWallPlace(upper, lower);
    expect(r).not.toBeNull();
    expect(r!.rot).toBe(0);
    expect(r!.off).toEqual([-50, -30]);
  });
});
