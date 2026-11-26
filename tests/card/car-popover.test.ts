import { describe, it, expect, vi } from "vitest";
import { carCardConfigOf, carDetails, renderCarPopover, type CarCardState } from "../../src/card/car";

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

describe("Sprint 78: carCardConfigOf & custom car card popover", () => {
  it("validates car_cards safely and rejects junk or prototype-pollution keys", () => {
    const cfg = { type: "custom:ultra-vehicle-card", entity: "sensor.car_battery" };
    expect(carCardConfigOf({ "device_tracker.car": cfg }, "device_tracker.car")).toEqual(cfg);
    expect(carCardConfigOf({ "device_tracker.car": cfg }, "device_tracker.other")).toBeNull();
    expect(carCardConfigOf({ "device_tracker.car": { type: "   " } }, "device_tracker.car")).toBeNull();
    expect(carCardConfigOf({ "device_tracker.car": ["not-obj"] }, "device_tracker.car")).toBeNull();
    expect(carCardConfigOf("not-map", "device_tracker.car")).toBeNull();
    expect(carCardConfigOf({ "device_tracker.car": cfg }, "__proto__")).toBeNull();
    expect(carCardConfigOf({ "device_tracker.car": cfg }, "constructor")).toBeNull();
    expect(carCardConfigOf({ "device_tracker.car": cfg }, "prototype")).toBeNull();
  });

  it("warns once and falls back when loadCardHelpers is unavailable, and mounts when available", async () => {
    const warnOnce = vi.fn();
    const holder: { state: CarCardState | null } = { state: null };
    const readState = () => holder.state;
    const html = ((s: TemplateStringsArray, ...v: unknown[]) => ({ s, v })) as unknown as Parameters<typeof renderCarPopover>[0]["html"];
    const baseDeps = {
      html, nothing: null, kiosk: false, confirmEntity: null, setConfirm: () => {}, callService: () => {},
      carCards: { "device_tracker.car": { type: "custom:my-car" } },
      mainEntity: "device_tracker.car",
      hass: { states: {} },
      setCarCardState: (s: CarCardState | null) => { holder.state = s; },
      warnOnce,
    };

    // Without loadCardHelpers -> warns once, sets failed, falls through to built-in car popover
    const fallbackRes = renderCarPopover({ ...baseDeps, carCardState: readState() }, ["sensor.car_battery"], { "sensor.car_battery": st("70", { device_class: "battery", unit_of_measurement: "%" }) });
    expect(warnOnce).toHaveBeenCalledTimes(1);
    expect(readState()?.status).toBe("failed");
    expect(fallbackRes).not.toBeNull();

    // With stubbed loadCardHelpers -> creates element and forwards hass
    const fakeEl = { tagName: "MY-CAR", hass: undefined as unknown } as unknown as HTMLElement & { hass?: unknown };
    (globalThis as unknown as { loadCardHelpers?: unknown }).loadCardHelpers = async () => ({ createCardElement: async () => fakeEl });
    holder.state = null;
    try {
      renderCarPopover({ ...baseDeps, carCardState: readState() }, ["device_tracker.car"], {});
      expect(readState()?.status).toBe("loading");
      await vi.waitFor(() => expect(readState()?.status).toBe("ready"));
      const nextHass = { states: { "sensor.car_battery": st("75") } };
      const mounted = renderCarPopover({ ...baseDeps, hass: nextHass, carCardState: readState() }, ["device_tracker.car"], {});
      expect(fakeEl.hass).toBe(nextHass);
      expect(mounted).not.toBeNull();
    } finally {
      delete (globalThis as unknown as { loadCardHelpers?: unknown }).loadCardHelpers;
    }
  });
});
