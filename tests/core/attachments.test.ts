import { describe, expect, test } from "vitest";
import { DEVICE_TYPES } from "../../src/core/schema";
import type { Device, DeviceType, Door } from "../../src/core/schema";
import { entitiesOfDevice, entitiesOfDoor } from "../../src/core/attachments";

/** A minimal device of `type`, `entity` "domain.main" so every case below can tell the main entity apart from an
 *  attached one by name alone. */
function dev(type: DeviceType, extra: Partial<Device> = {}): Device {
  return { id: "d1", type, entity: "domain.main", x: 0, y: 0, ...extra } as Device;
}

describe("S10.4: entitiesOfDevice decides, per device type, which entities a tap's more-info/chooser covers", () => {
  test("every DEVICE_TYPES member is covered — none silently falls through to just its own entity by accident", () => {
    // CLAUDE.md finding 17: this does not assert a specific list per type (that is done below, per type), only
    // that the function returns a non-throwing, well-formed array (own entity first, unique) for every member,
    // so a new DeviceType added later fails a *different*, more specific test rather than never being looked at.
    for (const type of DEVICE_TYPES) {
      const list = entitiesOfDevice(dev(type));
      expect(Array.isArray(list)).toBe(true);
      expect(list[0]).toBe("domain.main");
      expect(new Set(list).size).toBe(list.length);
    }
  });

  test("a light with no bound switch/plug: just its own entity", () => {
    expect(entitiesOfDevice(dev("light"))).toEqual(["domain.main"]);
  });

  test("a light's bound switch/plug is left out even when set: docs/SPEC.md already gives it its own path (a hold opens more-info for the light; the switch is reachable from inside that HA dialog), so a chooser here would offer a second, competing way to the same place", () => {
    expect(entitiesOfDevice(dev("light", { bound: "switch.hall" }))).toEqual(["domain.main"]);
  });

  test("a light's motion link is an automation bookkeeping field, not an attachment: never listed", () => {
    // docs/DECISIONS.md: the motion sensor is a different real-world device (already its own icon, typically);
    // it does not become one of this light's own entities just because the editor once linked them.
    expect(entitiesOfDevice(dev("light", { motion: "binary_sensor.hall_motion" }))).toEqual(["domain.main"]);
  });

  test("a heater with no trvs/tempSensors: just its own entity", () => {
    expect(entitiesOfDevice(dev("heater"))).toEqual(["domain.main"]);
  });

  test("a heater with trvs and tempSensors: main, then every trv, then every temp sensor", () => {
    expect(
      entitiesOfDevice(dev("heater", { trvs: ["climate.a", "climate.b"], tempSensors: ["sensor.t1"] })),
    ).toEqual(["domain.main", "climate.a", "climate.b", "sensor.t1"]);
  });

  test("an ac with linked climate entities: main, then each linked entity", () => {
    expect(entitiesOfDevice(dev("ac", { linked: ["climate.x", "climate.y"] }))).toEqual([
      "domain.main",
      "climate.x",
      "climate.y",
    ]);
  });

  test("a radar with targets: main, then each target's x then y, in target order", () => {
    expect(
      entitiesOfDevice(
        dev("radar", {
          targets: [
            { x: "sensor.t1x", y: "sensor.t1y" },
            { x: "sensor.t2x", y: "sensor.t2y" },
          ],
        }),
      ),
    ).toEqual(["domain.main", "sensor.t1x", "sensor.t1y", "sensor.t2x", "sensor.t2y"]);
  });

  test("a person's room sensor is a different real-world thing (where they are, not them): never listed", () => {
    expect(entitiesOfDevice(dev("person", { room: "sensor.person_area" }))).toEqual(["domain.main"]);
  });

  test("a duplicate attached entity (same as main, or repeated) is not listed twice", () => {
    expect(entitiesOfDevice(dev("heater", { trvs: ["domain.main", "climate.a", "climate.a"] }))).toEqual([
      "domain.main",
      "climate.a",
    ]);
  });

  test("an Unlinked appliance (no own entity, `attached` list only) lists its attached entities, none first", () => {
    // Unlinked has no `entity` field at all (S4.25); this is the one caller that passes an object without one.
    expect(entitiesOfDevice({ type: "heater", attached: ["switch.a", "switch.b"] } as unknown as Device)).toEqual([
      "switch.a",
      "switch.b",
    ]);
  });

  test("break it: a malformed layout (finding 1) never throws — non-array attachment fields are ignored", () => {
    const bad = { id: "d1", type: "heater", entity: "domain.main", x: 0, y: 0, trvs: "not-an-array", tempSensors: 5 } as unknown as Device;
    expect(() => entitiesOfDevice(bad)).not.toThrow();
    expect(entitiesOfDevice(bad)).toEqual(["domain.main"]);
  });
});

describe("S10.4: entitiesOfDoor lists a door's own sensors, vibration sensors and locks (never its cover)", () => {
  function door(extra: Partial<Door> = {}): Door {
    return { id: "door1", name: "Front door", kind: "door", a: [0, 0], b: [100, 0], ...extra };
  }

  test("a door with nothing attached: an empty list", () => {
    expect(entitiesOfDoor(door())).toEqual([]);
  });

  test("a door with one contact sensor: that one entity", () => {
    expect(entitiesOfDoor(door({ sensors: ["binary_sensor.front_contact"] }))).toEqual(["binary_sensor.front_contact"]);
  });

  test("a door with sensors, vibration and locks: sensors, then vibration, then locks", () => {
    expect(
      entitiesOfDoor(
        door({
          sensors: ["binary_sensor.contact"],
          vibration: ["binary_sensor.vibration"],
          locks: ["lock.front"],
        }),
      ),
    ).toEqual(["binary_sensor.contact", "binary_sensor.vibration", "lock.front"]);
  });

  test("a cover entity is never part of this list — the cover dialog handles it on its own", () => {
    expect(entitiesOfDoor(door({ cover: "cover.front", sensors: ["binary_sensor.contact"] }))).toEqual([
      "binary_sensor.contact",
    ]);
  });

  test("a duplicate entity across the three fields is listed once", () => {
    expect(entitiesOfDoor(door({ sensors: ["binary_sensor.x"], vibration: ["binary_sensor.x"] }))).toEqual([
      "binary_sensor.x",
    ]);
  });

  test("break it: non-array attachment fields never throw", () => {
    const bad = { id: "door1", name: "x", kind: "door", a: [0, 0], b: [1, 0], sensors: "nope" } as unknown as Door;
    expect(() => entitiesOfDoor(bad)).not.toThrow();
    expect(entitiesOfDoor(bad)).toEqual([]);
  });
});
