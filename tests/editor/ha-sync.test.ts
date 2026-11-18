import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { HaData, Layout } from "../../src/core";
import {
  haSyncReport,
  removeOrphanFromLayout,
  replaceEntityInLayout,
  setFloorHaInLayout,
  setRoomAreaInLayout,
} from "../../src/editor/ha-sync";
import { makeWriter } from "../../src/editor/hass-write";

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8")) as Layout;
const cloneDemo = (): Layout => structuredClone(demo);

describe("ha-sync", () => {
  it("detects orphaned entities and suggests unique domain/slug matches", () => {
    const layout = cloneDemo();
    layout.floors.ground.devices[0].entity = "light.living_old";
    layout.floors.ground.rooms[0].temps = ["sensor.missing_temp"];
    layout.floors.ground.rooms[0].area = "living";

    const ha: HaData = {
      floors: [{ id: "fl_g", name: "Ground" }],
      areas: [{ id: "living", name: "Living", floor_id: "fl_g" }],
      entities: [
        { id: "light.living_light", name: "Living light", domain: "light", area: "living" },
        { id: "sensor.living_temp", name: "Living temperature", domain: "sensor", area: "living" },
      ],
    };

    const rep = haSyncReport(layout, ha);
    const devOrphan = rep.orphans.find((o) => o.entityId === "light.living_old");
    expect(devOrphan).toBeDefined();
    expect(devOrphan?.suggested).toBe("light.living_light");

    const tempOrphan = rep.orphans.find((o) => o.entityId === "sensor.missing_temp");
    expect(tempOrphan).toBeDefined();

    replaceEntityInLayout(layout, "light.living_old", "light.living_light");
    expect(layout.floors.ground.devices[0].entity).toBe("light.living_light");

    removeOrphanFromLayout(layout, tempOrphan!);
    expect(layout.floors.ground.rooms[0].temps).toBeUndefined();
  });

  it("detects rooms without areas, device area mismatches, and floor/area-floor mismatches", () => {
    const layout = cloneDemo();
    const firstRoom = layout.floors.ground.rooms[0];
    firstRoom.area = "";

    const ha: HaData = {
      floors: [{ id: "fl_g", name: "Ground" }],
      areas: [
        { id: "living", name: firstRoom.name },
        { id: "kitchen", name: "Kitchen", floor_id: "fl_g" },
      ],
      entities: [
        { id: layout.floors.ground.devices[0].entity, name: "Living light", domain: "light", area: "kitchen", dev: "dev_1" },
      ],
    };

    const rep1 = haSyncReport(layout, ha);
    const noArea = rep1.areas.find((a) => a.kind === "room-no-area" && a.roomIndex === 0);
    expect(noArea?.matchArea?.id).toBe("living");
    expect(rep1.floors.some((f) => f.kind === "link-floor" && f.floorKey === "ground")).toBe(true);

    setRoomAreaInLayout(layout, "ground", 0, "living");
    setFloorHaInLayout(layout, "ground", "fl_g");

    const rep2 = haSyncReport(layout, ha);
    expect(rep2.areas.some((a) => a.kind === "device-area-diff" && a.entityId === layout.floors.ground.devices[0].entity)).toBe(true);
    expect(rep2.floors.some((f) => f.kind === "assign-area-floor" && f.area?.id === "living")).toBe(true);
  });

  it("calls floor_registry/create and area_registry/update via makeWriter", async () => {
    const callWS = vi.fn(async (msg: { type: string; [k: string]: unknown }) => {
      if (msg.type === "config/floor_registry/create") return { floor_id: "fl_1", name: msg.name };
      return {};
    });
    const writer = makeWriter({
      callWS: callWS as <T>(msg: { type: string; [k: string]: unknown }) => Promise<T>,
      callApi: async () => ({}) as never,
    });
    const created = await writer.createFloor("First", 1);
    expect(created).toEqual({ id: "fl_1", name: "First" });
    await writer.setAreaFloor("bedroom", "fl_1");
    expect(callWS).toHaveBeenCalledWith({ type: "config/floor_registry/create", name: "First", level: 1 });
    expect(callWS).toHaveBeenCalledWith({ type: "config/area_registry/update", area_id: "bedroom", floor_id: "fl_1" });
  });
});
