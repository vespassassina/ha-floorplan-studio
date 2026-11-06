import { describe, expect, it } from "vitest";
import type { Floor } from "../../src/core/schema";
import { mirrorOnWall, MIRROR_SNAP } from "../../src/editor/editor-kit";

// B53.12, spec item 19e: a mirror hangs on the nearest wall, back to it, turned with it. Written after the code.
const floor = (): Floor => ({
  title: "T", outline: [[0, 0], [900, 0], [900, 700], [0, 700]], owk: ["wall", "wall", "wall", "wall"],
  rooms: [], walls: [{ a: [300, 0], b: [300, 400], kind: "wall" }], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [],
}) as unknown as Floor;

describe("mirrorOnWall", () => {
  it("sits against the inside of the north wall at rot 0, half the wall and half its own depth off the wall's line", () => {
    const r = mirrorOnWall(floor(), [600, 30], 5)!;
    expect(r.rot).toBe(0);
    expect(r.x).toBe(600);
    expect(r.y).toBeGreaterThan(0); // on the pointer's side, the room's inside
    expect(r.y).toBeLessThan(15);
  });
  it("turns with each wall so its front (+y) faces the room: the front always points to the pointer", () => {
    const f = floor();
    // A piece's +y axis in the plan, as the renderer turns it (CLAUDE.md: rot in degrees, clockwise on screen).
    const front = (r: { rot: number }): [number, number] => [-Math.sin((r.rot * Math.PI) / 180), Math.cos((r.rot * Math.PI) / 180)];
    const south = mirrorOnWall(f, [600, 670], 5)!, east = mirrorOnWall(f, [870, 300], 5)!, west = mirrorOnWall(f, [30, 300], 5)!, north = mirrorOnWall(f, [600, 30], 5)!;
    expect(south.rot).toBe(180); expect(front(south)[1]).toBeLessThan(0);
    expect(north.rot).toBe(0); expect(front(north)[1]).toBeGreaterThan(0);
    expect(front(east)[0]).toBeLessThan(0); expect(Math.abs(front(east)[1])).toBeLessThan(1e-6);
    expect(front(west)[0]).toBeGreaterThan(0);
  });
  it("uses a free wall, on the side the pointer is", () => {
    const left = mirrorOnWall(floor(), [280, 200], 5)!, right = mirrorOnWall(floor(), [320, 200], 5)!;
    expect(left.x).toBeLessThan(300); expect(right.x).toBeGreaterThan(300);
    expect((left.rot + 180) % 360).toBe(right.rot);
  });
  it("answers null farther than MIRROR_SNAP from every wall, and exactly at the limit still snaps", () => {
    expect(mirrorOnWall(floor(), [600, 350], 5)).toBeNull();
    expect(mirrorOnWall(floor(), [600, MIRROR_SNAP], 5)).not.toBeNull();
    expect(mirrorOnWall(floor(), [600, MIRROR_SNAP + 1], 5)).toBeNull();
  });
});
