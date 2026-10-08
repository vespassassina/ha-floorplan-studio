import { describe, expect, it } from "vitest";
import { DEVICE_TYPES, type DeviceType } from "../../src/core";
import { NO_TOGGLE } from "../../src/card/actions";
import { popupOp } from "../../src/card/popup";

// S21.2 (finding 20): every device type either opens more-info on a tap or is operated, and the choice is written down.
// S19.E4 fixed `temp`; humidity, motion, contact and vibration had the same flaw: set to a switchable entity they offered "Turn off".
const TOGGLES: Record<string, string> = {
  light: "a lamp is flipped by hand", switch: "on/off", plug: "on/off", heater: "climate or switch, on/off", climate: "on/off", ac: "on/off",
  tv: "power", computer: "power", boiler: "on/off", car: "a charger switch", ups: "on/off", printer: "power", other: "no type to rule it out; the domain decides",
  lock: "lock/unlock", cover: "open/close", siren: "a real turn_on/turn_off (S18.14)",
};

describe("every device type is toggling or NO_TOGGLE, on purpose", () => {
  it("the two lists together are exactly DEVICE_TYPES, with no overlap", () => {
    const listed = [...Object.keys(TOGGLES), ...NO_TOGGLE].sort();
    expect(listed).toEqual([...DEVICE_TYPES].sort());
  });
  for (const t of DEVICE_TYPES as readonly DeviceType[]) {
    if (NO_TOGGLE.has(t)) {
      it(`${t}: no operation on any switchable entity`, () => {
        for (const e of ["switch.x", "light.x", "climate.x", "fan.x", "lock.x", "cover.x"]) {
          expect(popupOp(t, e, "on")).toBeNull();
          expect(popupOp(t, e, "off")).toBeNull();
        }
      });
    } else {
      it(`${t}: operable (${TOGGLES[t]})`, () => {
        expect(popupOp(t, "switch.x", "on")).not.toBeNull();
      });
    }
  }
  it.each(["humidity", "motion", "contact", "vibration"])("%s is read-only", (t) => expect(NO_TOGGLE.has(t)).toBe(true));
});
