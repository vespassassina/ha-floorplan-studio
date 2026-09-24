import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import { applyHaNames, availableEntities, roomHaBox, typeForEntity, unplacedHaEntities, type HaData } from "../../src/core/ha";
import { migrate } from "../../src/core/migrate";
import v1 from "../../demo/layout.v1.json";
import type { Layout } from "../../src/core/schema";

type Ent = HaData["entities"][number];
const ent = (id: string, domain: string, dc?: string): Ent => ({ id, name: id, domain, dc });

describe("typeForEntity (S4.18): a reverse domain/device_class guess for placing an HA entity as a device", () => {
  it("maps every device_class the forward TYPE_RULES already distinguish unambiguously", () => {
    expect(typeForEntity(ent("light.x", "light"))).toBe("light");
    expect(typeForEntity(ent("lock.x", "lock"))).toBe("lock");
    expect(typeForEntity(ent("camera.x", "camera"))).toBe("camera");
    expect(typeForEntity(ent("cover.x", "cover"))).toBe("cover");
    expect(typeForEntity(ent("switch.x", "switch", "outlet"))).toBe("plug");
    expect(typeForEntity(ent("switch.x", "switch"))).toBe("switch");
    expect(typeForEntity(ent("sensor.x", "sensor", "temperature"))).toBe("temp");
    expect(typeForEntity(ent("sensor.x", "sensor", "humidity"))).toBe("humidity");
    expect(typeForEntity(ent("sensor.x", "sensor", "battery"))).toBe("battery");
    expect(typeForEntity(ent("binary_sensor.x", "binary_sensor", "motion"))).toBe("motion");
    expect(typeForEntity(ent("binary_sensor.x", "binary_sensor", "occupancy"))).toBe("motion");
    expect(typeForEntity(ent("binary_sensor.x", "binary_sensor", "door"))).toBe("contact");
    expect(typeForEntity(ent("binary_sensor.x", "binary_sensor", "garage_door"))).toBe("contact");
    expect(typeForEntity(ent("binary_sensor.x", "binary_sensor", "vibration"))).toBe("vibration");
  });
  it("defaults a genuinely ambiguous domain to its most common member, correctable afterward via the device panel's type field", () => {
    expect(typeForEntity(ent("climate.x", "climate"))).toBe("climate"); // not ac or heater: those add heater/ac-only UI a guess should not turn on
    expect(typeForEntity(ent("media_player.x", "media_player"))).toBe("media"); // not tv
  });
  it("falls back to other for a domain with no rule and a sensor/binary_sensor with no recognised device_class", () => {
    expect(typeForEntity(ent("vacuum.x", "vacuum"))).toBe("other");
    expect(typeForEntity(ent("sensor.x", "sensor", "pressure"))).toBe("other");
    expect(typeForEntity(ent("sensor.x", "sensor"))).toBe("other");
    expect(typeForEntity(ent("binary_sensor.x", "binary_sensor", "moisture"))).toBe("other");
  });
});

const L = demo as unknown as Layout;
const ha: HaData = {
  floors: [{ id: "downstairs", name: "Downstairs" }],
  areas: [{ id: "kitchen", name: "The Kitchen" }, { id: "living", name: "Living" }],
  entities: [],
};

describe("migrate keeps the HA links and invents none (S1.37)", () => {
  it("a v1 file has no ha and no entity", () => {
    const l = migrate(v1);
    for (const f of Object.values(l.floors)) { expect("ha" in f).toBe(false); for (const r of f.rooms) expect("entity" in r).toBe(false); }
  });
  it("a v2 file with every link keeps each one byte for byte", () => {
    const src = structuredClone(L) as any;
    src.floors.ground.ha = "downstairs";
    src.floors.ground.rooms[5].entity = "sensor.pond";
    src.floors.ground.furniture[0].name = "Sofa";
    src.floors.ground.furniture[0].entity = "media_player.tv";
    const out = migrate(src) as any;
    expect(out.floors.ground.ha).toBe("downstairs");
    expect(out.floors.ground.rooms[5].entity).toBe("sensor.pond");
    expect(out.floors.ground.furniture[0].name).toBe("Sofa");
    expect(out.floors.ground.furniture[0].entity).toBe("media_player.tv");
  });
});

describe("unplacedHaEntities (S4.14): the palette's source list", () => {
  const layout = (): Layout => ({
    version: 2, unit: "cm", north: 0,
    floors: { ground: { title: "Ground", outline: [], walls: [], rooms: [], stairs: [], doors: [], openings: [], extras: [], furniture: [],
      devices: [{ id: "l-1", name: "Lamp", type: "light", entity: "light.lamp", x: 0, y: 0 }] } },
    catalog: [{ id: "l-1", floor: "ground", room: "", type: "light", name: "Lamp", entity: "light.lamp" }, { id: "s-1", floor: "ground", room: "", type: "switch", name: "Fan switch", entity: "switch.fan" }],
  } as unknown as Layout);
  const has: HaData = { floors: [], areas: [{ id: "kitchen", name: "Kitchen" }],
    entities: [
      { id: "light.lamp", name: "Lamp", domain: "light" },       // already a device on the plan
      { id: "switch.fan", name: "Fan switch", domain: "switch" }, // in the catalog but not placed — still not "new"
      { id: "sensor.kitchen_temp", name: "Kitchen temp", domain: "sensor", dc: "temperature", area: "kitchen" },
      { id: "light.spare", name: "Spare bulb", domain: "light" },
    ] };

  it("keeps only entities neither on the plan nor already in the catalog", () => {
    const out = unplacedHaEntities(layout(), has);
    expect(out.map((e) => e.id).sort()).toEqual(["light.spare", "sensor.kitchen_temp"]);
  });

  it("returns everything when there is no catalog and no device yet", () => {
    const l = layout(); l.catalog = []; l.floors.ground.devices = [];
    expect(unplacedHaEntities(l, has)).toHaveLength(4);
  });

  it("an empty or hostile entity list never throws", () => {
    expect(unplacedHaEntities(layout(), { floors: [], areas: [], entities: [] })).toEqual([]);
    expect(unplacedHaEntities(layout(), { floors: null, areas: null, entities: null } as any)).toEqual([]);
  });
});

describe("availableEntities (S6.7): a snapshot of every HA entity, for the exported JSON to carry with no live connection", () => {
  const layout = (): Layout => ({
    version: 2, unit: "cm", north: 0,
    floors: {
      ground: {
        title: "Ground", outline: [], walls: [], stairs: [], doors: [], openings: [], extras: [], furniture: [],
        rooms: [{ id: "r-1", name: "Kitchen", area: "kitchen", label: "", kind: "room", pts: [], wk: [] }],
        devices: [{ id: "l-1", name: "Lamp", type: "light", entity: "light.lamp", x: 0, y: 0 }],
      },
    },
    catalog: [],
  } as unknown as Layout);
  const has: HaData = {
    floors: [],
    areas: [{ id: "kitchen", name: "The Kitchen" }],
    entities: [
      { id: "light.lamp", name: "Lamp", domain: "light" }, // already placed
      { id: "sensor.kitchen_temp", name: "Kitchen temp", domain: "sensor", dc: "temperature", area: "kitchen" }, // area has a drawn room
      { id: "switch.garage", name: "Garage switch", domain: "switch", area: "garage" }, // area with no drawn room
      { id: "light.spare", name: "", domain: "light" }, // no friendly name: falls back to its id
    ],
  };

  it("carries entity, name, domain, area/areaName/room when the area matches a drawn room, and placed", () => {
    const out = availableEntities(layout(), has);
    expect(out.find((e) => e.entity === "light.lamp")).toEqual({ entity: "light.lamp", name: "Lamp", domain: "light", placed: true });
    expect(out.find((e) => e.entity === "sensor.kitchen_temp")).toEqual({
      entity: "sensor.kitchen_temp", name: "Kitchen temp", domain: "sensor", dc: "temperature",
      area: "kitchen", areaName: "The Kitchen", room: "Kitchen", placed: false,
    });
  });

  it("an area with no drawn room carries area/areaName but no room", () => {
    const out = availableEntities(layout(), has).find((e) => e.entity === "switch.garage")!;
    expect(out.area).toBe("garage");
    expect("room" in out).toBe(false);
  });

  it("falls back to the entity id when it has no friendly name", () => {
    expect(availableEntities(layout(), has).find((e) => e.entity === "light.spare")?.name).toBe("light.spare");
  });

  it("break it: hostile or missing entities never throws", () => {
    expect(availableEntities(layout(), { floors: [], areas: [], entities: [] })).toEqual([]);
    expect(availableEntities(layout(), { floors: null, areas: null, entities: null } as any)).toEqual([]);
    expect(availableEntities(layout(), { floors: [], areas: [], entities: [null, { id: 5 }, "junk"] } as any)).toEqual([]);
  });
});

describe("applyHaNames (S1.37)", () => {
  const linked = () => {
    const l = structuredClone(L) as any;
    l.floors.ground.ha = "downstairs";
    l.floors.ground.rooms[1].area = "kitchen"; l.floors.ground.rooms[1].name = "Old kitchen";
    return l as Layout;
  };
  it("renames a linked floor and a linked room and counts both", () => {
    const l = linked(), r = applyHaNames(l, ha);
    expect(r.changed).toBe(2); // the floor and the kitchen; the demo living room is already called Living
    expect(r.layout.floors.ground.title).toBe("Downstairs");
    expect(r.layout.floors.ground.rooms[1].name).toBe("The Kitchen");
  });
  it("leaves an unknown area id, an empty one, an unlinked floor and their names alone", () => {
    const l = linked() as any;
    l.floors.ground.rooms[0].area = "bogus"; l.floors.ground.rooms[0].name = "Mine";
    l.floors.ground.rooms[2].area = ""; l.floors.ground.rooms[2].name = "Custom";
    l.floors.first.title = "Upper";
    const r = applyHaNames(l, { ...ha, areas: [{ id: "kitchen", name: "The Kitchen" }] });
    expect(r.changed).toBe(2);
    expect(r.layout.floors.ground.rooms[0].name).toBe("Mine");
    expect(r.layout.floors.ground.rooms[2].name).toBe("Custom");
    expect(r.layout.floors.first.title).toBe("Upper");
  });
  it("does not change the object passed in", () => {
    const l = linked(), before = structuredClone(l);
    applyHaNames(l, ha);
    expect(l).toEqual(before);
  });
  it("break it: names that already match report 0 changed and return a deep-equal layout, twice over", () => {
    const first = applyHaNames(linked(), ha).layout, second = applyHaNames(first, ha);
    expect(second.changed).toBe(0);
    expect(second.layout).toEqual(first);
  });
  it("a layout with no links reports 0, and empty or hostile HA data never throws", () => {
    expect(applyHaNames(L, { floors: [{ id: "x", name: "X" }], areas: [], entities: [] }).changed).toBe(0);
    const plain = structuredClone(L) as any;
    for (const f of Object.values<any>(plain.floors)) for (const r of f.rooms) r.area = "";
    expect(applyHaNames(plain, ha).changed).toBe(0);
    expect(applyHaNames(linked(), { floors: [], areas: [], entities: [] }).changed).toBe(0);
    expect(applyHaNames(linked(), { floors: null, areas: [{ id: "kitchen", name: 5 }, null] } as any).changed).toBe(0);
  });
});

describe("roomHaBox (S4.7): the room box's grouping", () => {
  const box: HaData = {
    floors: [], areas: [],
    entities: [
      { id: "light.kitchen", name: "Kitchen light", domain: "light", area: "kitchen" },
      { id: "switch.kettle", name: "Kettle", domain: "switch", area: "kitchen" },
      { id: "light.helper", name: "Mock light", domain: "light", area: "kitchen", platform: "switch_as_x" },
      { id: "group.kitchen_lights", name: "Kitchen lights", domain: "group", area: "kitchen" },
      { id: "input_boolean.party_mode", name: "Party mode", domain: "input_boolean", area: "kitchen" },
      { id: "automation.kettle_off", name: "Kettle off", domain: "automation", area: "kitchen" },
      { id: "script.morning", name: "Morning", domain: "script", area: "kitchen" },
      { id: "scene.dinner", name: "Dinner", domain: "scene", area: "kitchen" },
      { id: "light.living", name: "Living light", domain: "light", area: "living" }, // a different area: never shown
      { id: "sensor.no_area", name: "Loose", domain: "sensor" }, // no area: never shown
    ],
  };
  it("sorts a physical light, a plug-domain switch and a switch_as_x light correctly into devices vs. helpers", () => {
    const b = roomHaBox(box, "kitchen", new Set());
    expect(b.devices.map((r) => r.id)).toEqual(["switch.kettle", "light.kitchen"]);
    expect(b.helpers.map((r) => r.id)).toEqual(["light.helper", "group.kitchen_lights", "input_boolean.party_mode"].sort((a, x) => box.entities.find((e) => e.id === a)!.name.localeCompare(box.entities.find((e) => e.id === x)!.name)));
  });
  it("gives automations, scripts and scenes their own heading, and leaves out every other area and unassigned entity", () => {
    const b = roomHaBox(box, "kitchen", new Set());
    expect(b.automations.map((r) => r.id)).toEqual(["automation.kettle_off"]);
    expect(b.scripts.map((r) => r.id)).toEqual(["script.morning"]);
    expect(b.scenes.map((r) => r.id)).toEqual(["scene.dinner"]);
    const all = [...b.devices, ...b.helpers, ...b.automations, ...b.scripts, ...b.scenes].map((r) => r.id);
    expect(all).not.toContain("light.living");
    expect(all).not.toContain("sensor.no_area");
  });
  it("marks a row placed when its id is in the given set", () => {
    const b = roomHaBox(box, "kitchen", new Set(["light.kitchen"]));
    expect(b.devices.find((r) => r.id === "light.kitchen")?.placed).toBe(true);
    expect(b.devices.find((r) => r.id === "switch.kettle")?.placed).toBe(false);
  });
  it("break it: hostile or missing input never throws, and an empty area id returns an empty box", () => {
    expect(roomHaBox(undefined, "kitchen", new Set())).toEqual({ devices: [], helpers: [], automations: [], scripts: [], scenes: [] });
    expect(roomHaBox(box, "", new Set())).toEqual({ devices: [], helpers: [], automations: [], scripts: [], scenes: [] });
    expect(roomHaBox({ floors: [], areas: [], entities: null } as any, "kitchen", new Set()).devices).toEqual([]);
    expect(roomHaBox({ floors: [], areas: [], entities: [null, { id: 5 }, "junk"] } as any, "kitchen", new Set()).devices).toEqual([]);
  });
});
