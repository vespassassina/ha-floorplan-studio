import { describe, it, expect } from "vitest";
import type { Layout } from "../../src/core/schema";
import { validate } from "../../src/core";
import { FloorplanStudioEditor } from "../../src/editor/editor-app";

// Opus re-check of S8.9: the Add > Device path (`placeDevice`) reuses a catalog entry's stored id
// unconditionally, exactly like `placeArea` did (see tests/editor/place-area.test.ts). This is the
// end state of the same 4-step repro: a device already sits on the floor under the id a stale
// catalog entry still remembers (the plan's own device was placed after the catalogued one was
// deleted and its id recycled by `newId`), and Add > Device is used to place the catalogued one.
describe("FloorplanStudioEditor.placeDevice (Opus re-check of S8.9)", () => {
  it("mints a fresh id instead of reusing one a floor's device already carries", () => {
    const layout: Layout = {
      version: 2, unit: "cm", north: 0,
      floors: {
        ground: {
          title: "Ground", outline: [[0, 0], [400, 0], [400, 300], [0, 300]], rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [],
          devices: [{ id: "device-ground-1", name: "Other", type: "light", entity: "light.other", x: 100, y: 100 }],
          furniture: [], unlinked: [],
        },
      },
      // A stale catalog entry: light.bulb was placed first (minted device-ground-1), deleted from the
      // plan, and light.other later recycled the same id — the catalog entry was never told.
      catalog: [{ id: "device-ground-1", floor: "ground", room: "", type: "light", name: "Bulb", entity: "light.bulb" }],
    };

    const el = new FloorplanStudioEditor();
    document.body.appendChild(el);
    el.layout = layout;

    (el as unknown as { placeDevice(id: string): void }).placeDevice("device-ground-1");

    const st = (el as unknown as { st: { f: { devices: { id: string }[] }; layout: Layout } }).st;
    const ids = st.f.devices.map((d) => d.id);
    expect(ids.filter((id) => id === "device-ground-1")).toHaveLength(1); // not both devices sharing it
    expect(new Set(ids).size).toBe(ids.length);
    expect(validate(st.layout).ok).toBe(true);

    el.remove();
  });
});
