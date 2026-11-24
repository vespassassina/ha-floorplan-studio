import { describe, it, expect } from "vitest";
import { carDetails } from "../../src/card/car";

const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes });

describe("Sprint 64: carDetails telemetry & control extractor", () => {
  it("extracts battery (over fuel), range, charging power & ETA, openings sorted alerts-first, and controls", () => {
    const details = carDetails(
      [
        "device_tracker.car",
        "sensor.car_fuel",
        "sensor.car_battery",
        "sensor.car_range",
        "sensor.car_charge_power",
        "sensor.car_charge_time_remaining",
        "binary_sensor.car_charging",
        "binary_sensor.car_front_door",
        "binary_sensor.car_trunk",
        "lock.car_doors",
        "climate.car_hvac",
        "switch.car_charger",
      ],
      {
        "device_tracker.car": st("home"),
        "sensor.car_fuel": st("40", { unit_of_measurement: "%" }),
        "sensor.car_battery": st("82", { device_class: "battery", unit_of_measurement: "%" }),
        "sensor.car_range": st("340", { device_class: "distance", unit_of_measurement: "km" }),
        "sensor.car_charge_power": st("7400", { device_class: "power", unit_of_measurement: "W" }),
        "sensor.car_charge_time_remaining": st("45", { device_class: "duration", unit_of_measurement: "min" }),
        "binary_sensor.car_charging": st("on", { device_class: "battery_charging" }),
        "binary_sensor.car_front_door": st("off", { device_class: "door", friendly_name: "Front door" }),
        "binary_sensor.car_trunk": st("on", { device_class: "opening", friendly_name: "Trunk" }),
        "lock.car_doors": st("locked", { friendly_name: "Doors" }),
        "climate.car_hvac": st("off", { friendly_name: "Climate" }),
        "switch.car_charger": st("on", { friendly_name: "Charger" }),
      },
    );

    expect(details.level).toEqual({ value: 82, kind: "battery" });
    expect(details.range).toBe("340 km");
    expect(details.charging).toBe(true);
    expect(details.chargePower).toBe("7.4 kW");
    expect(details.chargeEta).toBe("45 min");
    expect(details.openings.map((o) => [o.name, o.open])).toEqual([
      ["Trunk", true],
      ["Front door", false],
      ["Doors", false],
    ]);
    expect(details.controls.map((c) => [c.entity, c.domain, c.on])).toEqual([
      ["lock.car_doors", "lock", false],
      ["climate.car_hvac", "climate", false],
      ["switch.car_charger", "switch", true],
    ]);
  });

  it("falls back to fuel when no battery sensor exists and survives hostile/missing states", () => {
    const fuelOnly = carDetails(["sensor.my_fuel"], { "sensor.my_fuel": st("55", { unit_of_measurement: "%" }) });
    expect(fuelOnly.level).toEqual({ value: 55, kind: "fuel" });

    expect(carDetails(["", "bad", "sensor.x"], null)).toEqual({
      level: null, range: null, charging: false, chargePower: null, chargeEta: null, openings: [], controls: [],
    });
    expect(carDetails(["sensor.x"], { "sensor.x": st("unavailable") }).level).toBeNull();
  });
});
