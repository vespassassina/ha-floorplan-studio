import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import { applyHaNames, availableEntities, entitiesForType, mainEntitiesByDevice, mainEntity, roomHaBox, switchChoicesForLight, typeForEntity, unplacedHaEntities, type HaData } from "../../src/core/ha";
import { migrate } from "../../src/core/migrate";
import v1 from "../../demo/layout.v1.json";
import type { Device, Layout } from "../../src/core/schema";

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
  it("S7.8: person.* and device_tracker.* are a person", () => {
    expect(typeForEntity(ent("person.alex", "person"))).toBe("person");
    expect(typeForEntity(ent("device_tracker.alex_phone", "device_tracker"))).toBe("person");
  });
  it("S7.8: entitiesForType offers a person its person and device_tracker entities, and leaves a sensor in the rest", () => {
    const data: HaData = { floors: [], areas: [], entities: [ent("person.alex", "person"), ent("device_tracker.phone", "device_tracker"), ent("sensor.alex_room", "sensor")] };
    const { match, rest } = entitiesForType(data, "person");
    expect(match.map((e) => e.id)).toEqual(["person.alex", "device_tracker.phone"]);
    expect(rest.map((e) => e.id)).toEqual(["sensor.alex_room"]);
  });
  it("S7.9: entitiesForType offers a radar its occupancy binary_sensor, and leaves a plain motion one in the rest", () => {
    const data: HaData = {
      floors: [], areas: [],
      entities: [ent("binary_sensor.radar_presence", "binary_sensor", "occupancy"), ent("binary_sensor.pir", "binary_sensor", "motion"), ent("sensor.radar_target_1_x", "sensor")],
    };
    const { match, rest } = entitiesForType(data, "radar");
    expect(match.map((e) => e.id)).toEqual(["binary_sensor.radar_presence"]);
    expect(rest.map((e) => e.id)).toEqual(["binary_sensor.pir", "sensor.radar_target_1_x"]);
  });
  it("S7.9: typeForEntity never guesses radar — an occupancy binary_sensor still reads as motion, correctable in the device panel", () => {
    expect(typeForEntity(ent("binary_sensor.radar_presence", "binary_sensor", "occupancy"))).toBe("motion");
  });
  it("defaults a genuinely ambiguous domain to its most common member, correctable afterward via the device panel's type field", () => {
    expect(typeForEntity(ent("climate.x", "climate"))).toBe("climate"); // not ac or heater: those add heater/ac-only UI a guess should not turn on
    expect(typeForEntity(ent("media_player.x", "media_player"))).toBe("media"); // not tv
  });
  it("falls back to other for a domain with no rule and a sensor/binary_sensor with no recognised device_class", () => {
    expect(typeForEntity(ent("fan.x", "fan"))).toBe("other");
    expect(typeForEntity(ent("sensor.x", "sensor", "pressure"))).toBe("other");
    expect(typeForEntity(ent("sensor.x", "sensor"))).toBe("other");
    expect(typeForEntity(ent("binary_sensor.x", "binary_sensor", "moisture"))).toBe("other");
  });
  it("S7.10: vacuum.* maps straight to vacuum, not other", () => {
    expect(typeForEntity(ent("vacuum.hall", "vacuum"))).toBe("vacuum");
  });
  it("S7.10: entitiesForType offers a vacuum only its own vacuum.* entities, and leaves everything else in the rest", () => {
    const data: HaData = { floors: [], areas: [], entities: [ent("vacuum.hall", "vacuum"), ent("switch.hall", "switch"), ent("sensor.hall_battery", "sensor", "battery")] };
    const { match, rest } = entitiesForType(data, "vacuum");
    expect(match.map((e) => e.id)).toEqual(["vacuum.hall"]);
    expect(rest.map((e) => e.id)).toEqual(["switch.hall", "sensor.hall_battery"]);
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

// ---- S8.1: the room panel's Place popup lists only what the plan has an icon for ------------------------------------
import { AREA_NOISE_TYPES, AREA_PLACEABLE_TYPES, placeableInArea } from "../../src/core/ha";
import { DEVICE_TYPES } from "../../src/core/schema";

describe("S8.1: placeableInArea", () => {
  it("every device type is in exactly one of AREA_PLACEABLE_TYPES and AREA_NOISE_TYPES: a new type fails until someone decides", () => {
    for (const t of DEVICE_TYPES) expect([AREA_PLACEABLE_TYPES.has(t), AREA_NOISE_TYPES.has(t)], t).toEqual(expect.arrayContaining([true]));
    for (const t of DEVICE_TYPES) expect(AREA_PLACEABLE_TYPES.has(t) && AREA_NOISE_TYPES.has(t), t).toBe(false);
    expect(AREA_PLACEABLE_TYPES.size + AREA_NOISE_TYPES.size).toBe(DEVICE_TYPES.length);
  });
  it("lists the area's unplaced entities with an icon of their own; power, battery, a group, a person, another area and what is placed stay out", () => {
    const l = migrate(structuredClone(demo)) as Layout;
    const placed = l.floors.ground.devices.find((d) => "entity" in d && d.entity)!.entity!;
    const area = "living";
    const ha: HaData = { floors: [], areas: [{ id: area, name: "Living" }], entities: [
      { id: placed, name: "Placed", domain: placed.split(".")[0], area },
      { id: "light.spot", name: "Spot", domain: "light", area },
      { id: "sensor.t", name: "Temp", domain: "sensor", dc: "temperature", area },
      { id: "binary_sensor.m", name: "Motion", domain: "binary_sensor", dc: "motion", area },
      { id: "sensor.power", name: "Power", domain: "sensor", dc: "power", area },
      { id: "sensor.batt", name: "Battery", domain: "sensor", dc: "battery", area },
      { id: "group.lights", name: "Lights", domain: "group", area, members: ["light.spot"] },
      { id: "person.alex", name: "Alex", domain: "person", area },
      { id: "light.kitchen", name: "Kitchen", domain: "light", area: "kitchen" },
    ] };
    expect(placeableInArea(l, ha, area).map((e) => e.id)).toEqual(["light.spot", "sensor.t", "binary_sensor.m"]);
    expect(placeableInArea(l, { ...ha, entities: undefined as unknown as HaData["entities"] }, area)).toEqual([]); // hostile data never throws
  });
});

// ---- S8.5: the merged Add > Device panel's source list -------------------------------------------------------------
import { addCandidates } from "../../src/core/ha";

describe("S8.5: addCandidates — catalog + HA entities, merged, each located by its HA area", () => {
  const layout = (): Layout => ({
    version: 2, unit: "cm", north: 0,
    floors: {
      ground: { title: "Ground", outline: [], walls: [], rooms: [{ id: "r-1", name: "Kitchen", area: "kitchen", label: "", kind: "room", pts: [], wk: [] }], stairs: [], doors: [], openings: [], extras: [], furniture: [], devices: [] },
      first: { title: "", outline: [], walls: [], rooms: [{ id: "r-2", name: "Bedroom", area: "bedroom", label: "", kind: "room", pts: [], wk: [] }], stairs: [], doors: [], openings: [], extras: [], furniture: [], devices: [] },
    },
    catalog: [],
  } as unknown as Layout);

  it("catalog only, no HA: area/floor stay unset, room falls back to the catalog entry's own field", () => {
    const l = layout();
    l.catalog = [{ id: "c-1", floor: "ground", room: "Kitchen", type: "light", name: "Ceiling light", entity: "light.kitchen" }];
    expect(addCandidates(l, null)).toEqual([
      { key: "catalog:c-1", source: "catalog", id: "c-1", entity: "light.kitchen", name: "Ceiling light", type: "light", room: "Kitchen" },
    ]);
  });

  it("HA only, no catalog: every unplaced HA entity, guessed type via typeForEntity", () => {
    const l = layout();
    const ha: HaData = { floors: [], areas: [{ id: "kitchen", name: "The Kitchen" }], entities: [
      { id: "light.spare", name: "Spare bulb", domain: "light", area: "kitchen" },
    ] };
    expect(addCandidates(l, ha)).toEqual([
      { key: "ha:light.spare", source: "ha", id: "light.spare", entity: "light.spare", name: "Spare bulb", type: "light", area: "The Kitchen", room: "Kitchen", floor: "Ground" },
    ]);
  });

  it("both, with an overlapping entity: the catalog entry wins, no duplicate", () => {
    const l = layout();
    l.catalog = [{ id: "c-1", floor: "ground", room: "Kitchen", type: "light", name: "Ceiling light", entity: "light.kitchen" }];
    const ha: HaData = { floors: [], areas: [{ id: "kitchen", name: "The Kitchen" }], entities: [
      { id: "light.kitchen", name: "Ceiling light", domain: "light", area: "kitchen" },
      { id: "light.spare", name: "Spare bulb", domain: "light", area: "kitchen" },
    ] };
    const out = addCandidates(l, ha);
    expect(out.filter((c) => c.entity === "light.kitchen")).toHaveLength(1);
    expect(out.find((c) => c.entity === "light.kitchen")?.source).toBe("catalog");
    expect(out.map((c) => c.key).sort()).toEqual(["catalog:c-1", "ha:light.spare"]);
  });

  it("an entity with no area: no area, no room, no floor", () => {
    const l = layout();
    const ha: HaData = { floors: [], areas: [], entities: [{ id: "light.loose", name: "Loose", domain: "light" }] };
    expect(addCandidates(l, ha)[0]).toEqual({ key: "ha:light.loose", source: "ha", id: "light.loose", entity: "light.loose", name: "Loose", type: "light" });
  });

  it("an area with no plan room: area is filled, room and floor are not", () => {
    const l = layout();
    const ha: HaData = { floors: [], areas: [{ id: "garage", name: "Garage" }], entities: [{ id: "switch.garage", name: "Garage switch", domain: "switch", area: "garage" }] };
    const c = addCandidates(l, ha)[0];
    expect(c.area).toBe("Garage");
    expect("room" in c).toBe(false);
    expect("floor" in c).toBe(false);
  });

  it("an area whose room is on floor 2: floor names that floor, not the first", () => {
    const l = layout();
    const ha: HaData = { floors: [], areas: [{ id: "bedroom", name: "Bedroom HA" }], entities: [{ id: "light.bed", name: "Bed light", domain: "light", area: "bedroom" }] };
    const c = addCandidates(l, ha)[0];
    expect(c.room).toBe("Bedroom");
    expect(c.floor).toBe("first"); // no title set: falls back to the floor key
  });

  it("ha null: only the catalog half, never throws", () => {
    const l = layout();
    l.catalog = [{ id: "c-1", floor: "ground", room: "", type: "switch", name: "Fan switch", entity: "switch.fan" }];
    expect(addCandidates(l, null).map((c) => c.key)).toEqual(["catalog:c-1"]);
  });

  it("empty layout: no candidates, with or without HA", () => {
    const l = layout();
    expect(addCandidates(l, null)).toEqual([]);
    expect(addCandidates(l, { floors: [], areas: [], entities: [] })).toEqual([]);
  });
});

// ---- S8.6: "devices, not entities" — mainEntity/mainEntitiesByDevice and addCandidates' device rows --------------

const devEnt = (id: string, domain: string, dc?: string, cat?: string): Ent => ({ id, name: id, domain, dc, dev: "d1", ...(cat ? { cat } : {}) });

describe("S8.6: mainEntity — the one entity that represents an HA device", () => {
  it("a plug: switch + power sensor + energy sensor + a diagnostic connectivity binary_sensor picks the switch", () => {
    const entities = [
      devEnt("sensor.plug_power", "sensor", "power"),
      devEnt("sensor.plug_energy", "sensor", "energy"),
      devEnt("binary_sensor.plug_connectivity", "binary_sensor", "connectivity", "diagnostic"),
      devEnt("switch.plug", "switch", "outlet"),
    ];
    expect(mainEntity(entities)?.id).toBe("switch.plug");
  });

  it("a multisensor: motion + temperature + humidity + a diagnostic battery sensor picks the motion binary_sensor", () => {
    const entities = [
      devEnt("sensor.multi_temperature", "sensor", "temperature"),
      devEnt("sensor.multi_humidity", "sensor", "humidity"),
      devEnt("sensor.multi_battery", "sensor", "battery", "diagnostic"),
      devEnt("binary_sensor.multi_motion", "binary_sensor", "motion"),
    ];
    expect(mainEntity(entities)?.id).toBe("binary_sensor.multi_motion");
  });

  it("a light bulb: a single light entity plus a diagnostic signal sensor picks the light", () => {
    const entities = [devEnt("light.bulb", "light"), devEnt("sensor.bulb_signal", "sensor", "signal_strength", "diagnostic")];
    expect(mainEntity(entities)?.id).toBe("light.bulb");
  });

  it("a device whose entities are all diagnostic/config: no main entity, and no row in mainEntitiesByDevice", () => {
    const entities = [devEnt("sensor.gw_uptime", "sensor", undefined, "diagnostic"), devEnt("switch.gw_restart", "switch", undefined, "config")];
    expect(mainEntity(entities)).toBeUndefined();
    const ha: HaData = { floors: [], areas: [], entities };
    expect(mainEntitiesByDevice(ha).has("d1")).toBe(false);
  });

  it("mainEntitiesByDevice groups by dev and skips device-less entities", () => {
    const ha: HaData = {
      floors: [], areas: [],
      entities: [...[
        devEnt("switch.plug", "switch", "outlet"),
        devEnt("sensor.plug_power", "sensor", "power"),
      ], { id: "light.loose", name: "Loose", domain: "light" }],
    };
    const m = mainEntitiesByDevice(ha);
    expect(m.get("d1")?.id).toBe("switch.plug");
    expect(m.size).toBe(1);
  });

  it("break it: hostile or missing entities never throw", () => {
    expect(mainEntity([])).toBeUndefined();
    expect(mainEntitiesByDevice({ floors: [], areas: [], entities: null as unknown as Ent[] }).size).toBe(0);
  });
});

describe("S8.6: addCandidates emits one row per HA device, not one per entity", () => {
  const layout = (): Layout => ({
    version: 2, unit: "cm", north: 0,
    floors: { ground: { title: "Ground", outline: [], walls: [], rooms: [], stairs: [], doors: [], openings: [], extras: [], furniture: [], devices: [] } },
    catalog: [],
  } as unknown as Layout);

  const plugHa = (): HaData => ({
    floors: [], areas: [],
    devices: [{ id: "d1", name: "Kitchen plug" }],
    entities: [
      devEnt("switch.plug", "switch", "outlet"),
      devEnt("sensor.plug_power", "sensor", "power"),
      devEnt("binary_sensor.plug_connectivity", "binary_sensor", "connectivity", "diagnostic"),
    ],
  });

  it("one row for the plug device, named from the device registry, entity is the main (switch)", () => {
    const out = addCandidates(layout(), plugHa());
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ key: "ha-dev:d1", source: "ha", id: "d1", entity: "switch.plug", name: "Kitchen plug" });
  });

  it("a device already placed through one of its entities does not reappear through a sibling", () => {
    const l = layout();
    l.catalog = [{ id: "c-1", floor: "ground", room: "", type: "plug", name: "Kitchen plug", entity: "switch.plug" }];
    const out = addCandidates(l, plugHa());
    expect(out.find((c) => c.id === "d1")).toBeUndefined();
    expect(out.find((c) => c.entity === "sensor.plug_power")).toBeUndefined(); // no fallback row via the power sensor either
  });
});

describe("switchChoicesForLight (S8.7): floor-scoped switches with a same-area name-match suggestion", () => {
  /** A two-floor layout: "basement" floor has a room in area_basement, "ground" floor has a room in area_kitchen. */
  const baseLayout = (): Layout => ({
    version: 2, unit: "cm", north: 0,
    floors: {
      basement: { title: "Basement", outline: [], rooms: [{ id: "r1", name: "Basement", area: "area_basement", label: "", kind: "room", pts: [[0, 0], [400, 0], [400, 400], [0, 400]], wk: ["wall", "wall", "wall", "wall"] }], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [] },
      ground: { title: "Ground", outline: [], rooms: [{ id: "r2", name: "Kitchen", area: "area_kitchen", label: "", kind: "room", pts: [[0, 0], [400, 0], [400, 400], [0, 400]], wk: ["wall", "wall", "wall", "wall"] }], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [] },
    },
    catalog: [],
  });
  const baseHa = (extraEntities: HaData["entities"]): HaData => ({
    floors: [{ id: "floor_basement", name: "Basement" }, { id: "floor_ground", name: "Ground" }],
    areas: [
      { id: "area_basement", name: "Basement", floor_id: "floor_basement" },
      { id: "area_basement_other", name: "Basement storage", floor_id: "floor_basement" },
      { id: "area_kitchen", name: "Kitchen", floor_id: "floor_ground" },
    ],
    entities: [{ id: "light.basement_dumb", name: "Basement dumb light", domain: "light", area: "area_basement" }, ...extraEntities],
  });
  const light: Device = { id: "d1", type: "light", entity: "light.basement_dumb", name: "Basement dumb light", x: 0, y: 0 };

  it("1. a uniquely-named same-area switch (2 shared tokens) is suggested", () => {
    const ha = baseHa([{ id: "switch.basement_light_switch", name: "Basement light switch", domain: "switch", area: "area_basement" }]);
    const out = switchChoicesForLight(baseLayout(), ha, "basement", light);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ entity: "switch.basement_light_switch", suggested: true });
  });

  it("2. two same-area switches tied at the top score: neither suggested", () => {
    const ha = baseHa([
      { id: "switch.basement_switch_a", name: "Basement switch A", domain: "switch", area: "area_basement" },
      { id: "switch.basement_switch_b", name: "Basement switch B", domain: "switch", area: "area_basement" },
    ]);
    const out = switchChoicesForLight(baseLayout(), ha, "basement", light);
    expect(out).toHaveLength(2);
    expect(out.every((s) => !s.suggested)).toBe(true);
  });

  it("3. the only switch in the area is suggested even with zero shared name tokens", () => {
    const ha = baseHa([{ id: "switch.unrelated_name", name: "Zzz totally unrelated", domain: "switch", area: "area_basement" }]);
    const out = switchChoicesForLight(baseLayout(), ha, "basement", light);
    expect(out).toHaveLength(1);
    expect(out[0].suggested).toBe(true);
  });

  it("4. a switch in a different area of the same plan floor is offered but never suggested", () => {
    const ha = baseHa([{ id: "switch.storage_switch", name: "Basement storage switch", domain: "switch", area: "area_basement_other" }]);
    const out = switchChoicesForLight(baseLayout(), ha, "basement", light);
    expect(out).toHaveLength(1);
    expect(out[0].suggested).toBe(false);
  });

  it("5. a switch on a different floor entirely is not offered at all", () => {
    const ha = baseHa([{ id: "switch.kitchen_switch", name: "Kitchen switch", domain: "switch", area: "area_kitchen" }]);
    const out = switchChoicesForLight(baseLayout(), ha, "basement", light);
    expect(out).toHaveLength(0);
  });

  it("6. two candidates, different scores in the same area: the higher scorer is uniquely suggested", () => {
    const ha = baseHa([
      { id: "switch.basement_light_switch", name: "Basement light switch", domain: "switch", area: "area_basement" }, // shares {basement, light} = 2
      { id: "switch.basement_other", name: "Basement fan switch", domain: "switch", area: "area_basement" }, // shares {basement} = 1... use unrelated below instead
    ]);
    // Replace the second with a zero-overlap name so the scores are unambiguously 2 vs 0.
    ha.entities[2] = { id: "switch.basement_other", name: "Zzz unrelated", domain: "switch", area: "area_basement" };
    const out = switchChoicesForLight(baseLayout(), ha, "basement", light);
    expect(out).toHaveLength(2);
    const suggested = out.filter((s) => s.suggested);
    expect(suggested).toHaveLength(1);
    expect(suggested[0].entity).toBe("switch.basement_light_switch");
  });

  it("without ha, falls back to catalog switches/plugs on this floor only", () => {
    const l = baseLayout();
    l.catalog = [
      { id: "c1", floor: "basement", room: "Basement", type: "switch", name: "Basement switch", entity: "switch.basement_cat" },
      { id: "c2", floor: "ground", room: "Kitchen", type: "switch", name: "Kitchen switch", entity: "switch.kitchen_cat" },
    ];
    const out = switchChoicesForLight(l, null, "basement", light);
    expect(out.map((s) => s.entity)).toEqual(["switch.basement_cat"]);
    expect(out[0].suggested).toBe(false); // no HA area data, so never suggested
  });

  it("the light's current bound value stays offered even off-floor", () => {
    const ha = baseHa([{ id: "switch.kitchen_switch", name: "Kitchen switch", domain: "switch", area: "area_kitchen" }]);
    const boundLight: Device = { ...light, bound: "switch.kitchen_switch" };
    const out = switchChoicesForLight(baseLayout(), ha, "basement", boundLight);
    expect(out.map((s) => s.entity)).toContain("switch.kitchen_switch");
  });
});
