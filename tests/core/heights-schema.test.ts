import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import demo from "../../demo/layout.json";
import { migrate } from "../../src/core/migrate";
import { validate } from "../../src/core/schema";

const plain = () => structuredClone(demo) as any;
/** The demo's ground floor has no wall, opening or unlinked appliance; add one of each so every field has a home. */
const base = () => {
  const l = plain(), g = l.floors.ground;
  g.walls.push({ id: "w-h", a: [0, 0], b: [100, 0], kind: "wall" });
  g.openings.push({ id: "o-h", a: [0, 0], b: [90, 0] });
  g.unlinked.push({ id: "u-h", type: "heater", x: 50, y: 50, rot: 0, scale: 1 });
  return l;
};
const errorsOf = (l: any) => { const r = validate(l); return r.ok ? [] : r.errors; };

/** One place per optional height: where it lives in the demo, and the key. */
const PLACES: { label: string; key: string; get: (l: any) => any }[] = [
  { label: "floor height", key: "height", get: (l) => l.floors.ground },
  { label: "floor slab", key: "slab", get: (l) => l.floors.ground },
  { label: "room height", key: "height", get: (l) => l.floors.ground.rooms[0] },
  { label: "wall height", key: "height", get: (l) => l.floors.ground.walls[0] },
  { label: "door height", key: "height", get: (l) => l.floors.ground.doors[0] },
  { label: "door sill", key: "sill", get: (l) => l.floors.ground.doors[0] },
  { label: "opening height", key: "height", get: (l) => l.floors.ground.openings[0] },
  { label: "opening sill", key: "sill", get: (l) => l.floors.ground.openings[0] },
  { label: "furniture height", key: "height", get: (l) => l.floors.ground.furniture[0] },
  { label: "unlinked height", key: "height", get: (l) => l.floors.ground.unlinked[0] },
  { label: "device z", key: "z", get: (l) => l.floors.ground.devices[0] },
];
const JUNK: unknown[] = ["tall", "250", NaN, Infinity, -5, 1000.5, 1001, null, {}, [], true];

describe("height fields in validate", () => {
  it("the demo has none and stays valid, and migrate gives it back unchanged", () => {
    const l = plain();
    expect(validate(l).ok).toBe(true);
    const text = JSON.stringify(migrate(l));
    expect(text).not.toMatch(/"(slab|sill|z)"|"height"/);
    expect(JSON.stringify(migrate(JSON.parse(text)))).toBe(text); // a second pass changes nothing
    expect(migrate(l)).toEqual(l);
  });

  for (const p of PLACES) {
    it(`${p.label}: accepts 0, a value and 1000`, () => {
      for (const v of [0, 1, 123.5, 1000]) {
        const l = base(); p.get(l)[p.key] = v;
        expect(errorsOf(l), String(v)).toEqual([]);
      }
    });
    it(`${p.label}: refuses junk, naming the floor and the item`, () => {
      for (const v of JUNK) {
        const l = base(); const o = p.get(l); o[p.key] = v;
        const e = errorsOf(l).filter((m) => m.includes(p.key));
        expect(e.length, String(v)).toBe(1);
        expect(e[0]).toContain("floor ground:");
        expect(e[0]).toMatch(/0 to 1000/);
        if (o.id) expect(e[0]).toContain(o.id);
      }
    });
    it(`${p.label}: migrate keeps a valid value and drops an invalid one, never throws`, () => {
      const good = base(); p.get(good)[p.key] = 77;
      expect(p.get(migrate(good))[p.key]).toBe(77);
      for (const v of JUNK) {
        const l = base(); p.get(l)[p.key] = v;
        const m = migrate(l);
        expect(p.key in p.get(m), String(v)).toBe(false);
        expect(validate(m).ok, String(v)).toBe(true);
      }
    });
  }

  it("migrate survives a __proto__ floor and a height on a non-object", () => {
    const l: any = JSON.parse('{"version":2,"north":0,"floors":{"__proto__":{"height":"tall","slab":-1,"rooms":5}},"catalog":[]}');
    expect(() => migrate(l)).toThrow(/rooms must be an array/); // existing behaviour, not a new crash
    const l2: any = JSON.parse('{"version":2,"north":0,"floors":{"__proto__":{"height":"tall","slab":-1}},"catalog":[]}');
    const m = migrate(l2);
    const f: any = Object.values(m.floors)[0]; // no outline, so validate would refuse it for that; the heights are what is under test
    expect(f).not.toHaveProperty("height");
    expect(f).not.toHaveProperty("slab");
    expect(validate(m)).toMatchObject({ ok: false });
    expect((validate(m) as any).errors.join("\n")).not.toMatch(/height|slab/);
  });
});

describe("assistant examples and prompts", () => {
  const read = (p: string) => readFileSync(resolve(p), "utf8");
  it("both examples validate; two-floors carries the heights the prompts teach", () => {
    for (const f of ["flat", "two-floors"]) expect(validate(JSON.parse(read(`prompts/examples/${f}.json`))).ok, f).toBe(true);
    const first = JSON.parse(read("prompts/examples/two-floors.json")).floors.first;
    expect(first.height).toBe(270);
    expect(first.rooms.find((r: any) => r.name === "Bathroom").height).toBe(240);
    expect(first.doors.find((d: any) => d.kind === "window")).toMatchObject({ sill: 90, height: 130 });
  });
  it("SKILL.md tells the assistant to read heights, convert to cm, leave gaps out and report", () => {
    const s = read("prompts/SKILL.md");
    expect(s).toMatch(/leave the field out/i);
    expect(s).toMatch(/2\.70/);
    expect(s).toMatch(/\*\*Heights\*\* list/);
    expect(read("prompts/SCHEMA.md")).toMatch(/## Heights/);
  });
});
