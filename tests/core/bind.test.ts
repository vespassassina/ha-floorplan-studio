import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import type { Floor, Layout } from "../../src/core/schema";
import { attachedEntities, groupKind, placedEntities, unplacedCatalog } from "../../src/core/bind";

const clone = () => structuredClone(demo) as unknown as Layout;

const emptyFloor = (): Floor => ({
  title: "F", outline: [], walls: [], rooms: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [],
});
const baseLayout = (floors: Record<string, Floor>): Layout => ({ version: 2, unit: "cm", north: 0, floors, catalog: [] } as unknown as Layout);

describe("placedEntities", () => {
  it("counts the entity of every device on every floor, and not a bound switch", () => {
    const l = clone();
    const set = placedEntities(l);
    expect(set.has("light.demo_living")).toBe(true);
    expect(set.has("switch.demo_living_relay")).toBe(false); // bound to a light, but not an icon of its own
    expect(set.has("light.demo_bedroom")).toBe(true); // second floor
    expect(set.has("binary_sensor.demo_garage_door")).toBe(false);
  });

  it("counts a switch once it is a device of its own, even when lights name it", () => {
    const l = clone();
    l.floors.ground.devices.push({ id: "switch-relay", type: "switch", entity: "switch.demo_living_relay", x: 10, y: 10 });
    expect(placedEntities(l).has("switch.demo_living_relay")).toBe(true);
  });
});

describe("unplacedCatalog", () => {
  it("keeps a bound switch that is not placed, and unplaced entries; a bound light's own entity is placed", () => {
    const ids = unplacedCatalog(clone()).map((c) => c.id);
    expect(ids).toContain("contact-garage");
    expect(ids).toContain("switch-living-relay");
    expect(ids).not.toContain("light-living");
  });

  it("drops the switch once it is placed as an icon", () => {
    const l = clone();
    l.floors.ground.devices.push({ id: "switch-relay", type: "switch", entity: "switch.demo_living_relay", x: 10, y: 10 });
    expect(unplacedCatalog(l).map((c) => c.id)).not.toContain("switch-living-relay");
  });

  // S10.5: an attached entity has no icon (attaching pulled it off the plan), but its catalog entry must not be
  // offered again while it stays attached — it is "in use", not "unplaced".
  it("drops a catalogued entity once it is attached to a door's sensors, and offers it again once detached", () => {
    const l = clone();
    l.floors.ground.doors[2].sensors = ["binary_sensor.demo_garage_door"]; // contact-garage, catalogued but unplaced
    expect(unplacedCatalog(l).map((c) => c.id)).not.toContain("contact-garage");
    delete l.floors.ground.doors[2].sensors;
    expect(unplacedCatalog(l).map((c) => c.id)).toContain("contact-garage");
  });
});

// S10.5: attachedEntities(layout) — every entity "in use" through an attachment, so unplacedCatalog and every other
// placing list can exclude it. Table-driven over every attachment field so a new one is decided explicitly, not
// silently missed (finding 17's "an enumeration is a list of decisions" applied to a field list, not a union).
describe("attachedEntities", () => {
  const ATTACH_CASES: { label: string; floor: Floor; entity: string }[] = [
    { label: "door.sensors", entity: "binary_sensor.contact_1", floor: { ...emptyFloor(), doors: [{ id: "d1", name: "Door", kind: "door", a: [0, 0], b: [1, 0], sensors: ["binary_sensor.contact_1"] }] } },
    { label: "door.vibration", entity: "binary_sensor.vib_1", floor: { ...emptyFloor(), doors: [{ id: "d1", name: "Door", kind: "door", a: [0, 0], b: [1, 0], vibration: ["binary_sensor.vib_1"] }] } },
    { label: "door.locks", entity: "lock.front", floor: { ...emptyFloor(), doors: [{ id: "d1", name: "Door", kind: "door", a: [0, 0], b: [1, 0], locks: ["lock.front"] }] } },
    { label: "door.cover", entity: "cover.garage", floor: { ...emptyFloor(), doors: [{ id: "d1", name: "Door", kind: "door", a: [0, 0], b: [1, 0], cover: "cover.garage" }] } },
    { label: "device.trvs", entity: "climate.trv_1", floor: { ...emptyFloor(), devices: [{ id: "h1", type: "heater", entity: "climate.heater", trvs: ["climate.trv_1"], x: 0, y: 0 }] } },
    { label: "device.tempSensors", entity: "sensor.temp_1", floor: { ...emptyFloor(), devices: [{ id: "h1", type: "heater", entity: "climate.heater", tempSensors: ["sensor.temp_1"], x: 0, y: 0 }] } },
    { label: "device.linked", entity: "climate.linked_1", floor: { ...emptyFloor(), devices: [{ id: "a1", type: "ac", entity: "climate.ac", linked: ["climate.linked_1"], x: 0, y: 0 }] } },
    // S11.2: a room's own sensor lists are attachments too
    { label: "room.temps", entity: "sensor.room_t", floor: { ...emptyFloor(), rooms: [{ id: "r1", name: "R", area: "", kind: "room", pts: [[0, 0], [1, 0], [1, 1]], wk: ["wall", "wall", "wall"], temps: ["sensor.room_t"] }] } },
    { label: "room.humidity", entity: "sensor.room_h", floor: { ...emptyFloor(), rooms: [{ id: "r1", name: "R", area: "", kind: "room", pts: [[0, 0], [1, 0], [1, 1]], wk: ["wall", "wall", "wall"], humidity: ["sensor.room_h"] }] } },
    { label: "room.motion", entity: "binary_sensor.room_m", floor: { ...emptyFloor(), rooms: [{ id: "r1", name: "R", area: "", kind: "room", pts: [[0, 0], [1, 0], [1, 1]], wk: ["wall", "wall", "wall"], motion: ["binary_sensor.room_m"] }] } },
    { label: "unlinked.attached", entity: "sensor.attached_1", floor: { ...emptyFloor(), unlinked: [{ id: "u1", type: "other", x: 0, y: 0, rot: 0, scale: 1, attached: ["sensor.attached_1"] }] } },
  ];

  it.each(ATTACH_CASES)("counts $label", ({ floor, entity }) => {
    const l = baseLayout({ f: floor });
    expect(attachedEntities(l).has(entity)).toBe(true);
  });

  it("does NOT count a light's bound switch or motion link — neither goes through attachEntity, neither ever loses its own icon", () => {
    const floor: Floor = { ...emptyFloor(), devices: [{ id: "l1", type: "light", entity: "light.lamp", bound: "switch.relay", motion: "binary_sensor.hall_motion", x: 0, y: 0 }] };
    const l = baseLayout({ f: floor });
    const out = attachedEntities(l);
    expect(out.has("switch.relay")).toBe(false);
    expect(out.has("binary_sensor.hall_motion")).toBe(false);
  });

  it("does NOT count a person's room sensor or a radar's target pairs — set through a plain commit, never attachEntity", () => {
    const floor: Floor = {
      ...emptyFloor(),
      devices: [
        { id: "p1", type: "person", entity: "person.alex", room: "sensor.alex_room", x: 0, y: 0 },
        { id: "r1", type: "radar", entity: "binary_sensor.radar_occ", targets: [{ x: "sensor.t1x", y: "sensor.t1y" }], x: 0, y: 0 },
      ],
    };
    const l = baseLayout({ f: floor });
    const out = attachedEntities(l);
    expect(out.has("sensor.alex_room")).toBe(false);
    expect(out.has("sensor.t1x")).toBe(false);
    expect(out.has("sensor.t1y")).toBe(false);
  });

  it("collects across every floor and every field at once, no duplicates", () => {
    const l = clone();
    l.floors.ground.doors[2].sensors = ["binary_sensor.demo_garage_door"];
    l.floors.ground.devices.push({ id: "heater-2", type: "heater", entity: "climate.heater_2", trvs: ["climate.trv_x"], tempSensors: ["sensor.temp_x"], x: 5, y: 5 });
    l.floors.first.devices.push({ id: "unlinked-1", type: "other", entity: "", x: 1, y: 1 } as any);
    l.floors.first.unlinked = [{ id: "u1", type: "server", x: 0, y: 0, rot: 0, scale: 1, attached: ["sensor.rack_temp"] }];
    const out = attachedEntities(l);
    expect(out.has("binary_sensor.demo_garage_door")).toBe(true);
    expect(out.has("climate.trv_x")).toBe(true);
    expect(out.has("sensor.temp_x")).toBe(true);
    expect(out.has("sensor.rack_temp")).toBe(true);
  });

  it("never throws on hostile input: a non-array list, a non-string member, a missing floors field, floors not an object", () => {
    expect(() => attachedEntities({} as unknown as Layout)).not.toThrow();
    expect(attachedEntities({} as unknown as Layout).size).toBe(0);
    expect(() => attachedEntities({ floors: null } as unknown as Layout)).not.toThrow();
    expect(() => attachedEntities({ floors: "nope" } as unknown as Layout)).not.toThrow();
    const hostileFloor = { doors: [{ sensors: 5, cover: 12, locks: [null, 3, "lock.ok"] }], devices: [{ trvs: "not-an-array" }], unlinked: [{ attached: [{}, "sensor.ok"] }] } as unknown as Floor;
    const l = { floors: { f: hostileFloor } } as unknown as Layout;
    let out: Set<string> = new Set();
    expect(() => { out = attachedEntities(l); }).not.toThrow();
    expect(out.has("lock.ok")).toBe(true);
    expect(out.has("sensor.ok")).toBe(true);
    expect(out.size).toBe(2);
    // __proto__-named floor, rooms: 5 style hostility on floors themselves
    const l2 = { floors: { __proto__: hostileFloor, normal: hostileFloor } } as unknown as Layout;
    expect(() => attachedEntities(l2)).not.toThrow();
  });
});

// S4.5 (Opus review pair: break it by removing the `devs.length !== is.length` guard, which makes a selection with one
// missing/duplicate index still read as "same kind" — the "keeps clear of a mixed or partial selection" case below then passes).
describe("groupKind", () => {
  it("is the shared kind for two or more lights, or two or more motion sensors", () => {
    const l = clone(), f = l.floors.ground;
    f.devices.push({ id: "motion-2", type: "motion", entity: "binary_sensor.demo_kitchen_motion", x: 1, y: 1 });
    expect(groupKind(f, [0, 1])).toBe("light"); // demo devices 0, 1 are both lights
    expect(groupKind(f, [5, f.devices.length - 1])).toBe("motion"); // demo device 5 plus the pushed one
  });

  it("is undefined for a single device, an empty selection, a mixed kind, a non-groupable type, or an index off the end", () => {
    const l = clone(), f = l.floors.ground;
    expect(groupKind(f, [0])).toBeUndefined(); // one light alone
    expect(groupKind(f, [])).toBeUndefined();
    expect(groupKind(f, [0, 5])).toBeUndefined(); // a light and a motion sensor
    expect(groupKind(f, [2, 3])).toBeUndefined(); // switch + plug: neither light nor motion
    expect(groupKind(f, [0, 99])).toBeUndefined();
  });

  it("skips a device with no entity: an unbound light does not count towards the kind", () => {
    const l = clone(), f = l.floors.ground;
    f.devices.push({ id: "unbound-light", type: "light", entity: "", x: 2, y: 2 });
    expect(groupKind(f, [0, f.devices.length - 1])).toBeUndefined();
  });
});
