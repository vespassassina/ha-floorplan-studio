import { describe, expect, it } from "vitest";
import { presenceHeat, presenceSensorsForFloor } from "../../src/card/history";
import { roomAt, ROOM_OWNS } from "../../src/core";
import type { HistoryIndex, HistoryRow } from "../../src/card/replay/history";
import type { Floor, Pt } from "../../src/core/schema";

const sq = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const row = (state: string, luSec: number): HistoryRow => ({ state, attributes: {}, lu: luSec, lc: luSec });

describe("S77: presenceHeat & presenceSensorsForFloor", () => {
  const startMs = 1_700_000_000_000;
  const endMs = startMs + 24 * 3600_000;
  const s = (hrs: number) => (startMs + hrs * 3600_000) / 1000;

  it("collects room.motion, placed motion/radar devices, and attached device.motion", () => {
    const f: Floor = {
      title: "G",
      outline: sq(0, 0, 800, 400),
      rooms: [
        { id: "r0", name: "Living", area: "living", kind: "room", pts: sq(0, 0, 400, 400), wk: ["wall", "wall", "wall", "wall"], motion: ["binary_sensor.living_pir"] },
        { id: "r1", name: "Study", area: "study", kind: "room", pts: sq(400, 0, 400, 400), wk: ["wall", "wall", "wall", "wall"] },
        { id: "r2", name: "Fill", area: "", kind: "fill", pts: sq(0, 400, 200, 200), wk: ["wall", "wall", "wall", "wall"], motion: ["binary_sensor.ignored"] },
      ],
      walls: [], stairs: [], doors: [], openings: [], extras: [], furniture: [], unlinked: [],
      devices: [
        { id: "d1", type: "radar", entity: "binary_sensor.living_radar", x: 100, y: 100 },
        { id: "d2", type: "light", entity: "light.study", motion: "binary_sensor.study_occ", x: 500, y: 100 },
        { id: "d3", type: "motion", entity: "binary_sensor.study_pir", x: 550, y: 150 },
      ],
    };
    const m = presenceSensorsForFloor(f, roomAt as never, ROOM_OWNS);
    expect(m.get(0)?.sort()).toEqual(["binary_sensor.living_pir", "binary_sensor.living_radar"]);
    expect(m.get(1)?.sort()).toEqual(["binary_sensor.study_occ", "binary_sensor.study_pir"]);
    expect(m.has(2)).toBe(false);
  });

  it("merges overlapping ON intervals across multiple sensors without double-counting", () => {
    const idx: HistoryIndex = new Map([
      ["binary_sensor.a", [row("off", s(0)), row("on", s(2)), row("off", s(5))]], // 3h
      ["binary_sensor.b", [row("off", s(0)), row("detected", s(4)), row("off", s(6))]], // overlaps 4..5, total union 2..6 = 4h
    ]);
    const res = presenceHeat(new Map([[0, ["binary_sensor.a", "binary_sensor.b"]]]), idx, startMs, endMs);
    expect(res[0]).toEqual({ text: "4h", t: 0.5 });
  });

  it("clamps intervals to [startMs, endMs], formats <1m / minutes / hours, and caps t at 1 (8h+)", () => {
    const idx: HistoryIndex = new Map([
      ["s.long", [row("occupied", s(-2)), row("off", s(10))]], // clamped 0..10 = 10h -> t=1
      ["s.short", [row("on", s(1)), row("off", s(1) + 30)]], // 30s -> <1m
      ["s.mid", [row("on", s(3)), row("off", s(3.5))]], // 30m
      ["s.idle", [row("off", s(0)), row("unavailable", s(5))]], // 0m
    ]);
    const res = presenceHeat(new Map([
      [0, ["s.long"]],
      [1, ["s.short"]],
      [2, ["s.mid"]],
      [3, ["s.idle"]],
      [4, ["s.missing"]],
    ]), idx, startMs, endMs);
    expect(res[0]).toEqual({ text: "10h", t: 1 });
    expect(res[1]?.text).toBe("<1m");
    expect(res[2]).toEqual({ text: "30m", t: 0.063 });
    expect(res[3]).toEqual({ text: "0m", t: 0 });
    expect(res[4]).toBeUndefined();
  });
});
