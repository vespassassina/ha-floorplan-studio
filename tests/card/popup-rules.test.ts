import { describe, expect, it } from "vitest";
import { DEVICE_TYPES, type DeviceType } from "../../src/core";
import { lightCaps, popupOp } from "../../src/card/popup";

// S14.2 items 3 and 5: what the popup's one button does, per device type, and where OFF asks first.
// A type needs a representative entity: the button follows the entity's domain, the type says whether the card operates it.
type Kind = "confirm-off" | "immediate-off" | "none" | "lock" | "cover";
const CASE: Record<DeviceType, { entity: string; kind: Kind }> = {
  light: { entity: "light.x", kind: "immediate-off" }, // lights are exempt from the confirm (Diego, 2026-10-06)
  switch: { entity: "switch.x", kind: "confirm-off" }, plug: { entity: "switch.x", kind: "confirm-off" },
  ac: { entity: "climate.x", kind: "confirm-off" }, heater: { entity: "climate.x", kind: "confirm-off" }, climate: { entity: "climate.x", kind: "confirm-off" },
  tv: { entity: "media_player.x", kind: "confirm-off" }, computer: { entity: "switch.x", kind: "confirm-off" }, boiler: { entity: "switch.x", kind: "confirm-off" },
  car: { entity: "switch.x", kind: "confirm-off" }, ups: { entity: "switch.x", kind: "confirm-off" }, printer: { entity: "switch.x", kind: "confirm-off" },
  other: { entity: "fan.x", kind: "confirm-off" },
  lock: { entity: "lock.x", kind: "lock" }, cover: { entity: "cover.x", kind: "cover" },
  // No button: a sensor has nothing to operate, and these types never toggled (NO_TOGGLE, S2.13 / S9.4: media_player.toggle is play/pause or power, guessing is worse).
  temp: { entity: "sensor.x", kind: "none" }, humidity: { entity: "sensor.x", kind: "none" }, motion: { entity: "binary_sensor.x", kind: "none" },
  contact: { entity: "binary_sensor.x", kind: "none" }, vibration: { entity: "binary_sensor.x", kind: "none" },
  camera: { entity: "camera.x", kind: "none" }, media: { entity: "media_player.x", kind: "none" }, speaker: { entity: "media_player.x", kind: "none" },
  battery: { entity: "sensor.x", kind: "none" }, inverter: { entity: "sensor.x", kind: "none" }, server: { entity: "sensor.x", kind: "none" },
  access_point: { entity: "sensor.x", kind: "none" }, person: { entity: "person.x", kind: "none" }, radar: { entity: "binary_sensor.x", kind: "none" },
  vacuum: { entity: "vacuum.x", kind: "none" }, // its own dialog (S7.10)
  // S18.14: a siren has a real on/off service; an alarm panel has none, so it opens more-info (NO_TOGGLE).
  siren: { entity: "siren.x", kind: "confirm-off" }, alarm: { entity: "alarm_control_panel.x", kind: "none" },
};

describe("popupOp: the default operation per device type", () => {
  it("every device type is a decision (finding 17)", () => {
    expect(Object.keys(CASE).sort()).toEqual([...DEVICE_TYPES].sort());
  });
  for (const t of DEVICE_TYPES) {
    const { entity, kind } = CASE[t];
    it(`${t} (${entity}): ${kind}`, () => {
      const domain = entity.split(".")[0];
      if (kind === "none") { expect(popupOp(t, entity, "on")).toBeNull(); expect(popupOp(t, entity, "off")).toBeNull(); return; }
      if (kind === "lock") {
        expect(popupOp(t, entity, "locked")).toMatchObject({ label: "Unlock", domain: "lock", service: "unlock", confirm: null });
        expect(popupOp(t, entity, "unlocked")).toMatchObject({ label: "Lock", domain: "lock", service: "lock", confirm: null });
        return;
      }
      if (kind === "cover") {
        expect(popupOp(t, entity, "open")).toMatchObject({ label: "Close", domain: "cover", service: "close_cover", confirm: null });
        expect(popupOp(t, entity, "closed")).toMatchObject({ label: "Open", domain: "cover", service: "open_cover", confirm: null });
        return;
      }
      // ON is always immediate; OFF asks first except for a light.
      expect(popupOp(t, entity, "off")).toMatchObject({ label: "Turn on", domain, service: "turn_on", confirm: null });
      const on = popupOp(t, entity, domain === "climate" ? "heat" : "on");
      expect(on).toMatchObject({ label: "Turn off", domain, service: "turn_off" });
      expect(on!.confirm, `${t}: confirm before OFF`).toBe(kind === "confirm-off" ? "Confirm turn off" : null);
    });
  }
  it("an `other` device decides by its entity's domain: fan, siren and a pump switch ask; a sensor has no button", () => {
    for (const e of ["fan.x", "siren.x", "switch.pump", "humidifier.x", "input_boolean.x"]) expect(popupOp("other", e, "on")!.confirm, e).toBe("Confirm turn off");
    for (const e of ["sensor.x", "binary_sensor.x", "button.x", "scene.x"]) expect(popupOp("other", e, "on"), e).toBeNull();
  });
  it("a group has no turn_on of its own: its button calls homeassistant.turn_on / turn_off (S14 review)", () => {
    expect(popupOp("other", "group.lamps", "off")).toMatchObject({ label: "Turn on", domain: "homeassistant", service: "turn_on", confirm: null });
    expect(popupOp("other", "group.lamps", "on")).toMatchObject({ label: "Turn off", domain: "homeassistant", service: "turn_off", confirm: "Confirm turn off" });
  });
  it("no button with no entity, or a state it cannot act on", () => {
    expect(popupOp("switch", "", "on")).toBeNull();
    expect(popupOp("switch", undefined, "on")).toBeNull();
    for (const s of ["unavailable", "unknown", undefined]) expect(popupOp("switch", "switch.x", s), String(s)).toBeNull();
  });
  it("a heating state counts as on (climate says heat, cool, auto, not on)", () => {
    for (const s of ["heat", "cool", "auto", "heat_cool", "dry"]) expect(popupOp("climate", "climate.x", s)!.label, s).toBe("Turn off");
  });
});

describe("lightCaps: what a light's popup may offer (item 18)", () => {
  it("onoff only: no slider", () => expect(lightCaps({ supported_color_modes: ["onoff"] })).toEqual({ brightness: false, temp: null, hue: false }));
  it("brightness only", () => expect(lightCaps({ supported_color_modes: ["brightness"] })).toEqual({ brightness: true, temp: null, hue: false }));
  it("colour temperature, with its own range (kelvin) and a default", () => {
    expect(lightCaps({ supported_color_modes: ["color_temp"], min_color_temp_kelvin: 2200, max_color_temp_kelvin: 6500 })).toEqual({ brightness: true, temp: { min: 2200, max: 6500 }, hue: false });
    expect(lightCaps({ supported_color_modes: ["color_temp"] }).temp).toEqual({ min: 2000, max: 6500 });
  });
  it("hs, xy and rgb give a hue control; both together give both", () => {
    expect(lightCaps({ supported_color_modes: ["xy"] })).toEqual({ brightness: true, temp: null, hue: true });
    expect(lightCaps({ supported_color_modes: ["color_temp", "hs"] }).temp).not.toBeNull();
    expect(lightCaps({ supported_color_modes: ["color_temp", "hs"] }).hue).toBe(true);
  });
  it("no modes listed: an own brightness attribute says it dims, else nothing", () => {
    expect(lightCaps({ brightness: 100 }).brightness).toBe(true);
    expect(lightCaps({}).brightness).toBe(false);
    expect(lightCaps(undefined)).toEqual({ brightness: false, temp: null, hue: false });
  });
  it("junk modes and a junk range are ignored (untrusted)", () => {
    expect(lightCaps({ supported_color_modes: "hs" as never }).hue).toBe(false);
    expect(lightCaps({ supported_color_modes: ["color_temp"], min_color_temp_kelvin: "x", max_color_temp_kelvin: 100 }).temp).toEqual({ min: 2000, max: 6500 });
  });
});

describe("popupOp: a temperature device never offers a toggle (S19.E4)", () => {
  // The button follows the entity's domain, so a temp device set to a switchable entity (a thermostat, a smart plug that reports
  // temperature) offered "Turn off". A temperature reading is watched, not switched: NO_TOGGLE holds `temp`.
  it.each(["climate.x", "switch.x", "fan.x", "light.x"])("temp on %s: no operation, on or off", (entity) => {
    expect(popupOp("temp", entity, "on")).toBeNull();
    expect(popupOp("temp", entity, "off")).toBeNull();
    expect(popupOp("temp", entity, "heat")).toBeNull();
  });
});
