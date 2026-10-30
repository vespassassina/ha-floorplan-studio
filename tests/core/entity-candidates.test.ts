import { describe, it, expect } from "vitest";
import { addCandidates, capEntityRows, entityCandidates, ENTITY_ROWS_MAX, type HaData } from "../../src/core/ha";
import type { Layout } from "../../src/core/schema";

// S40.4: while Add device has search text, a single entity of a hub is listed under its own name.
// Shapes: HaData is what `src/editor/ha-data.ts` builds from the HA registries (an entity row: id, name, domain, dc, dev, area ...).

type Ent = HaData["entities"][number];
const hubEntities = (n: number): Ent[] => Array.from({ length: n }, (_, i): Ent => ({
  id: `sensor.gateway_a_${i}`, name: i === 7 ? "Innen Temperatur" : `Gateway A channel ${i}`, domain: "sensor", dc: i === 7 ? "temperature" : undefined, dev: "gw-a",
}));
const layout = (over: Partial<Layout> = {}): Layout => ({
  version: 2, unit: "cm", north: 0,
  floors: { ground: { title: "Ground", outline: [], walls: [], rooms: [], stairs: [], doors: [], openings: [], extras: [], furniture: [], devices: [] } },
  catalog: [], ...over,
} as unknown as Layout);
const ha = (entities: Ent[], devices = [{ id: "gw-a", name: "Ecowitt gateway A" }, { id: "plug-1", name: "Kitchen plug" }]): HaData => ({ floors: [], areas: [], devices, entities });
const HUB = ha([
  ...hubEntities(137),
  { id: "switch.kitchen_plug", name: "Kitchen plug", domain: "switch", dc: "outlet", dev: "plug-1" },
  { id: "sensor.kitchen_plug_power", name: "Kitchen plug power", domain: "sensor", dc: "power", dev: "plug-1" },
  { id: "light.free", name: "Free lamp", domain: "light" },
]);

describe("entityCandidates (S40.4)", () => {
  it("lists the entity of a 137-entity hub by its own name, with its type and its device's name", () => {
    const rows = entityCandidates(layout(), HUB, "innen", addCandidates(layout(), HUB));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: "ha-ent:sensor.gateway_a_7", source: "ha", entity: "sensor.gateway_a_7", name: "Innen Temperatur", type: "temp", device: "Ecowitt gateway A" });
  });

  it("finds it by entity id, in any case and with spaces around the query", () => {
    const rows = entityCandidates(layout(), HUB, "  GATEWAY_A_7 ", addCandidates(layout(), HUB));
    expect(rows.map((r) => r.entity)).toContain("sensor.gateway_a_7"); // a substring: gateway_a_70 to 79 match too
    expect(rows.every((r) => r.entity.includes("gateway_a_7"))).toBe(true);
  });

  it("with an empty or blank search it lists nothing (the list stays one row per device)", () => {
    const all = addCandidates(layout(), HUB);
    expect(entityCandidates(layout(), HUB, "", all)).toEqual([]);
    expect(entityCandidates(layout(), HUB, "   ", all)).toEqual([]);
  });

  it("does not list an entity that is already a row of the list (a device's main entity, a device-less entity)", () => {
    const all = addCandidates(layout(), HUB);
    expect(all.some((c) => c.entity === "switch.kitchen_plug")).toBe(true); // the plug is a device row
    expect(all.some((c) => c.entity === "light.free")).toBe(true); // a device-less entity is a plain row
    const rows = entityCandidates(layout(), HUB, "kitchen plug", all);
    expect(rows.map((r) => r.entity)).toEqual(["sensor.kitchen_plug_power"]); // the plug itself is the device row
    expect(entityCandidates(layout(), HUB, "free lamp", all)).toEqual([]);
  });

  it("does not list an entity that is on the plan or attached, and the others of its device stay findable", () => {
    const placed = layout();
    placed.floors.ground.devices.push({ id: "t-1", name: "Innen Temperatur", type: "temp", entity: "sensor.gateway_a_7", x: 1, y: 1 } as never);
    placed.catalog.push({ id: "t-1", floor: "ground", room: "", type: "temp", name: "Innen Temperatur", entity: "sensor.gateway_a_7" });
    const all = addCandidates(placed, HUB);
    expect(all.some((c) => c.key === "ha-dev:sensor.gateway_a_0")).toBe(false); // the hub left the device rows, as today
    expect(entityCandidates(placed, HUB, "innen", all)).toEqual([]);
    expect(entityCandidates(placed, HUB, "channel 130", all).map((r) => r.entity)).toEqual(["sensor.gateway_a_130"]); // its siblings are still findable
  });

  it("sorts by name, so the cap keeps a stable first page", () => {
    const rows = entityCandidates(layout(), HUB, "gateway a channel 1", []);
    const names = rows.map((r) => r.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(rows.length).toBeGreaterThan(10);
  });

  it("untrusted HA data never throws", () => {
    const junk = { floors: null, areas: null, devices: "x", entities: [null, 5, "sensor.x", { id: 3, name: "n" }, { id: "sensor.ok", name: 7, domain: 4, dev: 9 }, { id: "sensor.good", name: "Good", domain: "sensor", dev: "d" }, { id: "sensor.m", name: {}, domain: "group", dev: "d", members: "oops" }] } as unknown as HaData;
    expect(() => entityCandidates(layout(), junk, "good", [])).not.toThrow();
    expect(entityCandidates(layout(), junk, "good", []).map((r) => r.entity)).toEqual(["sensor.good"]);
    expect(entityCandidates(layout(), { entities: "nope" } as unknown as HaData, "x", [])).toEqual([]);
    expect(entityCandidates(layout(), null, "x", [])).toEqual([]);
    expect(entityCandidates(layout(), HUB, 5 as unknown as string, [])).toEqual([]);
    expect(entityCandidates(layout(), HUB, "innen", [null as never, { entity: 4 } as never]).length).toBe(1);
  });
});

describe("capEntityRows (S40.4)", () => {
  it("400 matches show the first 50 and the real count", () => {
    const big = ha(Array.from({ length: 400 }, (_, i): Ent => ({ id: `sensor.n_${String(i).padStart(3, "0")}`, name: `Probe ${String(i).padStart(3, "0")}`, domain: "sensor", dev: "gw-a" })));
    const rows = entityCandidates(layout(), big, "probe", []);
    expect(rows).toHaveLength(400);
    const cap = capEntityRows(rows);
    expect(ENTITY_ROWS_MAX).toBe(50);
    expect(cap.rows).toHaveLength(50);
    expect(cap.rows[0].name).toBe("Probe 000");
    expect(cap.rows[49].name).toBe("Probe 049");
    expect(cap.total).toBe(400);
    expect(cap.note).toBe("50 of 400. Type more to narrow it.");
  });
  it("50 or fewer show all and no line", () => {
    const rows = entityCandidates(layout(), HUB, "innen", []);
    expect(capEntityRows(rows)).toEqual({ rows, total: 1, note: "" });
    const fifty = Array.from({ length: 50 }, (_, i) => ({ key: `k${i}` })) as never[];
    expect(capEntityRows(fifty).note).toBe("");
    expect(capEntityRows([...fifty, { key: "k50" } as never]).note).toBe("50 of 51. Type more to narrow it.");
  });
});

describe("addCandidates is untouched by S40.4", () => {
  it("with the search empty the list is one row per HA device, then the device-less entities", () => {
    const keys = addCandidates(layout(), HUB).map((c) => c.key);
    expect([...keys].sort()).toEqual(["ha-dev:sensor.gateway_a_0", "ha-dev:switch.kitchen_plug", "ha:light.free"]); // 139 entities, three rows
    expect(keys.filter((k) => k.startsWith("ha-ent:"))).toEqual([]);
  });
});
