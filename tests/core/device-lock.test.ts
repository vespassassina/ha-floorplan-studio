import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import { migrate } from "../../src/core/migrate";
import { validate } from "../../src/core/schema";

const withLock = (id: string, has: boolean, value?: unknown) => {
  const l = structuredClone(demo) as any;
  const d = l.floors.ground.devices[0];
  d.id = id;
  if (has) d.locked = value;
  return l;
};
const errorsOf = (l: any) => { const r = validate(l); return r.ok ? [] : r.errors; };

describe("device.locked", () => {
  for (const id of ["lamp-1", "__proto__"]) {
    describe(`on a device with id ${id}`, () => {
      it("true, false and absent are valid", () => {
        expect(errorsOf(withLock(id, true, true))).toEqual([]);
        expect(errorsOf(withLock(id, true, false))).toEqual([]);
        expect(errorsOf(withLock(id, false))).toEqual([]);
      });
      for (const junk of ["yes", 1, 0, null, {}, [], "true"]) {
        it(`${JSON.stringify(junk)} is reported, never thrown`, () => {
          let errs: string[] = [];
          expect(() => { errs = errorsOf(withLock(id, true, junk)); }).not.toThrow();
          expect(errs.some((e) => e.includes("locked must be true or false"))).toBe(true);
        });
      }
      it("migrate keeps true, false and absent as they are", () => {
        for (const v of [true, false]) expect((migrate(withLock(id, true, v)).floors.ground.devices[0] as any).locked).toBe(v);
        expect("locked" in migrate(withLock(id, false)).floors.ground.devices[0]).toBe(false);
      });
    });
  }
});
