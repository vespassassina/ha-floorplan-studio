import { describe, it, expect } from "vitest";
import { AREA_NOISE_TYPES, AREA_PLACEABLE_TYPES, addCandidates, placeableDevicesInArea, placeableInArea, typeForEntity, unplacedDevicesInArea, type HaData } from "../../src/core/ha";
import { DEVICE_TYPES, type Device, type Layout } from "../../src/core/schema";

type Ent = HaData["entities"][number];
const layout = (): Layout => ({
  version: 2, unit: "cm", north: 0,
  floors: { ground: { title: "Ground", outline: [], walls: [], rooms: [{ id: "r1", name: "Office", area: "office", kind: "room", pts: [], wk: [] }], stairs: [], doors: [], openings: [], extras: [], furniture: [], devices: [], unlinked: [] } },
  catalog: [],
} as unknown as Layout);
const mot = (id: string, name: string, extra: Partial<Ent> = {}): Ent => ({ id, name, domain: "binary_sensor", dc: "motion", area: "office", ...extra });
const haOf = (entities: Ent[], devices: HaData["devices"] = [{ id: "d1", name: "Office sensor" }]): HaData => ({ floors: [], areas: [{ id: "office", name: "Office" }], devices, entities });
const placeMotion = (l: Layout, entity: string) => { l.floors.ground.devices = [{ id: "p", type: "motion", entity, name: entity, x: 0, y: 0 } as Device]; };

// A multisensor: two zones, a diagnostic motion-like entity, a temperature reading. Shaped like HA's registry rows.
const multi = (): Ent[] => [
  mot("binary_sensor.office_zone_a", "Office zone A", { dev: "d1" }),
  mot("binary_sensor.office_zone_b", "Zone B", { dev: "d1" }),
  mot("binary_sensor.office_tamper_motion", "Tamper", { dev: "d1", cat: "diagnostic" }),
  { id: "sensor.office_temp", name: "Office temp", domain: "sensor", dc: "temperature", area: "office", dev: "d1" },
];

describe("motion: every live motion entity of a device is its own row, in all three lists", () => {
  it("placeableDevicesInArea: two zones, two rows with different names; the diagnostic one stays hidden", () => {
    const out = placeableDevicesInArea(layout(), haOf(multi()), "office");
    const m = out.filter((e) => e.id.startsWith("binary_sensor."));
    expect(m.map((e) => e.id).sort()).toEqual(["binary_sensor.office_zone_a", "binary_sensor.office_zone_b"]);
    expect(new Set(m.map((e) => e.name)).size).toBe(2);
  });
  it("unplacedDevicesInArea: the same rule", () => {
    const m = unplacedDevicesInArea(layout(), haOf(multi()), "office").filter((e) => e.id.startsWith("binary_sensor."));
    expect(m.map((e) => e.id).sort()).toEqual(["binary_sensor.office_zone_a", "binary_sensor.office_zone_b"]);
    expect(new Set(m.map((e) => e.name)).size).toBe(2);
  });
  it("addCandidates: the same rule, one key per entity, typed motion", () => {
    const m = addCandidates(layout(), haOf(multi())).filter((c) => c.entity.startsWith("binary_sensor."));
    expect(m.map((c) => c.entity).sort()).toEqual(["binary_sensor.office_zone_a", "binary_sensor.office_zone_b"]);
    expect(new Set(m.map((c) => c.key)).size).toBe(2);
    expect(m.every((c) => c.type === "motion")).toBe(true);
    expect(new Set(m.map((c) => c.name)).size).toBe(2);
  });
  it("placing one zone leaves its sibling offered, in all three lists", () => {
    const l = layout();
    placeMotion(l, "binary_sensor.office_zone_a");
    const ha = haOf(multi());
    const only = (xs: string[]) => expect(xs.filter((x) => x.startsWith("binary_sensor."))).toEqual(["binary_sensor.office_zone_b"]);
    only(placeableDevicesInArea(l, ha, "office").map((e) => e.id));
    only(unplacedDevicesInArea(l, ha, "office").map((e) => e.id));
    only(addCandidates(l, ha).map((c) => c.entity));
  });
  it("a multisensor whose main entity ranks higher (a light) still shows both motion zones, plus the main row", () => {
    const ents = [...multi(), { id: "light.office_sensor_led", name: "Sensor LED", domain: "light", area: "office", dev: "d1" } as Ent];
    const ids = placeableDevicesInArea(layout(), haOf(ents), "office").map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(["binary_sensor.office_zone_a", "binary_sensor.office_zone_b", "light.office_sensor_led"]));
    expect(ids).toHaveLength(3);
  });
  it("a device with ONE motion entity is unchanged: one row named by the device", () => {
    const ents = [mot("binary_sensor.solo", "Solo", { dev: "d1" }), { id: "sensor.solo_temp", name: "t", domain: "sensor", dc: "temperature", area: "office", dev: "d1" } as Ent];
    const out = placeableDevicesInArea(layout(), haOf(ents), "office");
    expect(out.map((e) => [e.id, e.name])).toEqual([["binary_sensor.solo", "Office sensor"]]);
  });
  it("a catalogued sibling keeps its catalog id on its own row", () => {
    const l = layout();
    l.catalog = [{ id: "c-b", floor: "ground", room: "Office", type: "motion", name: "Zone B", entity: "binary_sensor.office_zone_b" }];
    const m = addCandidates(l, haOf(multi())).filter((c) => c.entity.startsWith("binary_sensor."));
    expect(m).toHaveLength(2);
    expect(m.find((c) => c.entity.endsWith("zone_b"))).toMatchObject({ key: "catalog:c-b", id: "c-b" });
  });
});

describe("motion: a group whose members are all motion is a motion sensor", () => {
  const grp = (id: string, members: unknown, extra: Partial<Ent> = {}): Ent => ({ id, name: id, domain: "group", area: "office", members: members as string[], ...extra });
  const base = (): Ent[] => [mot("binary_sensor.a", "A"), mot("binary_sensor.b", "B", { dc: "occupancy" }), { id: "light.x", name: "X", domain: "light" }];
  const typeIn = (e: Ent, extra: Ent[] = []) => typeForEntity(e, haOf([...base(), ...extra, e]));

  it("types motion when all members are motion; mixed, empty and unknown-member groups stay other", () => {
    expect(typeIn(grp("group.all", ["binary_sensor.a", "binary_sensor.b"]))).toBe("motion");
    expect(typeIn(grp("group.mixed", ["binary_sensor.a", "light.x"]))).toBe("other");
    expect(typeIn(grp("group.empty", []))).toBe("other");
    expect(typeIn(grp("group.ghost", ["binary_sensor.a", "binary_sensor.nope"]))).toBe("other");
  });
  it("without the entity list it cannot know: other", () => {
    expect(typeForEntity(grp("group.all", ["binary_sensor.a"]))).toBe("other");
  });
  it("never throws on junk: members not an array, non-string members, cycles, a deep chain", () => {
    for (const m of [5, "binary_sensor.a", null, undefined, {}, [null, 3, {}]]) expect(typeIn(grp("group.j", m))).toBe("other");
    const g1 = grp("group.g1", ["group.g2"]), g2 = grp("group.g2", ["group.g1", "binary_sensor.a"]);
    expect(typeIn(g1, [g2])).toBe("other");
    expect(typeIn(grp("group.self", ["group.self"]))).toBe("other");
    const chain = Array.from({ length: 12 }, (_, i) => grp(`group.c${i}`, [i === 11 ? "binary_sensor.a" : `group.c${i + 1}`]));
    expect(() => typeIn(chain[0], chain.slice(1))).not.toThrow();
    expect(typeIn(chain[0], chain.slice(1))).toBe("other"); // past the depth cap
  });
  it("a group in a group counts when it is motion all the way down", () => {
    expect(typeIn(grp("group.outer", ["group.inner", "binary_sensor.a"]), [grp("group.inner", ["binary_sensor.b"])])).toBe("motion");
  });
  it("is offered by the area popup (device-less, with an area) and the Add panel; a mixed group is not", () => {
    const ha = haOf([...base(), grp("group.office_motion", ["binary_sensor.a", "binary_sensor.b"]), grp("group.office_mixed", ["binary_sensor.a", "light.x"])]);
    ha.entities.forEach((e) => { if (e.id.startsWith("binary_sensor.")) e.area = "elsewhere"; });
    expect(placeableInArea(layout(), ha, "office").map((e) => e.id)).toEqual(["group.office_motion"]);
    expect(placeableDevicesInArea(layout(), ha, "office").map((e) => e.id)).toEqual(["group.office_motion"]);
    expect(addCandidates(layout(), ha).find((c) => c.entity === "group.office_motion")?.type).toBe("motion");
    expect(addCandidates(layout(), ha).find((c) => c.entity === "group.office_mixed")?.type).toBe("other");
  });
  it("a device-less binary_sensor motion helper with an area is offered", () => {
    const ha = haOf([mot("binary_sensor.helper", "Any motion", { platform: "group" })]);
    expect(placeableDevicesInArea(layout(), ha, "office").map((e) => e.id)).toEqual(["binary_sensor.helper"]);
  });
  it("keeps every DeviceType decided", () => {
    for (const t of DEVICE_TYPES) expect(AREA_PLACEABLE_TYPES.has(t) !== AREA_NOISE_TYPES.has(t), t).toBe(true);
  });
});
