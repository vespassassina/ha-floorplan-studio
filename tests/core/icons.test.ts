import { describe, it, expect } from "vitest";
import { DEVICE_ICONS, FURNITURE } from "../../src/core/icons";
import type { DeviceType, FurnitureSymbol } from "../../src/core/schema";

const DEVICE_TYPES: DeviceType[] = ["heater", "light", "switch", "plug", "temp", "humidity", "motion", "contact", "camera", "climate", "media", "cover", "other"];
const SYMBOLS: FurnitureSymbol[] = ["table", "sofa", "bed", "cabinet", "chair", "sink", "toilet", "shower", "bathtub", "tv", "computer", "tree", "patio-wood", "patio-concrete", "car"];

describe("icons", () => {
  it("has an MDI path for every device type and nothing else", () => {
    expect(Object.keys(DEVICE_ICONS).sort()).toEqual([...DEVICE_TYPES].sort());
    for (const t of DEVICE_TYPES) expect(DEVICE_ICONS[t]).toMatch(/^M/);
  });

  it("has a symbol for every furniture type with the agreed size", () => {
    expect(Object.keys(FURNITURE).sort()).toEqual([...SYMBOLS].sort());
    expect(FURNITURE.bed).toMatchObject({ w: 160, h: 200 });
    expect(FURNITURE.car).toMatchObject({ w: 450, h: 180 });
    for (const s of SYMBOLS) {
      expect(FURNITURE[s].w).toBeGreaterThan(0);
      expect(FURNITURE[s].svg).toMatch(/^</);
    }
  });
});
