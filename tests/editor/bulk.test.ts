import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import { DEVICE_TYPES, validate } from "../../src/core";
import type { Device, Floor, Layout } from "../../src/core";
import { EditorState } from "../../src/editor/state";
import { bindLights, lockDevices, moveDevices, reindexAfterRemove, removeDevices } from "../../src/editor/bulk";

/** One device per type x (bound or not; only a light may be bound) x (locked or not), half of them segments. */
function build(): { layout: Layout; floor: Floor } {
  const layout = structuredClone(demo) as unknown as Layout;
  const f = layout.floors.ground;
  f.devices = [];
  let n = 0;
  for (const type of DEVICE_TYPES)
    for (const bound of [false, true])
      for (const locked of [false, true]) {
        if (bound && type !== "light") continue;
        n++;
        const base = { id: `d${n}`, type, entity: `${type === "light" ? "light" : "sensor"}.e${n}`, ...(bound ? { bound: "switch.old" } : {}), ...(locked ? { locked: true } : {}) };
        f.devices.push((n % 3 === 0 ? { ...base, a: [n * 10, 100], b: [n * 10 + 40, 100] } : { ...base, x: n * 10, y: 50 }) as Device);
      }
  return { layout, floor: f };
}
const ok = (layout: Layout) => { const r = validate(layout); return r.ok ? [] : r.errors; };
const all = (f: Floor) => f.devices.map((_, i) => i);
const JUNK = [-1, 999, 1.5, NaN, Infinity, 0, 0, 2, 2] as number[];
const asLayout = (l: Layout, f: Floor) => ({ ...l, floors: { ...l.floors, ground: f } }) as Layout;
const through = (l: Layout, fn: (f: Floor) => Floor) => { const st = new EditorState(structuredClone(l)); return { st, changed: st.edit((f) => fn(f)) }; };

describe("bindLights", () => {
  it("binds lights only, counts what it left alone, and every result validates", () => {
    const { layout, floor } = build();
    const lights = floor.devices.filter((d) => d.type === "light").length;
    const r = bindLights(floor, all(floor), "switch.hall");
    expect(r.skipped).toBe(floor.devices.length - lights);
    for (const d of r.floor.devices) expect(d.bound).toBe(d.type === "light" ? "switch.hall" : undefined);
    expect(ok(asLayout(layout, r.floor))).toEqual([]);
    expect(floor.devices.find((d) => d.bound === "switch.hall")).toBeUndefined(); // input untouched
  });
  it("an empty string clears bound on lights", () => {
    const { layout, floor } = build();
    const r = bindLights(floor, all(floor), "");
    expect(r.floor.devices.some((d) => d.bound !== undefined)).toBe(false);
    expect("bound" in r.floor.devices.find((d) => d.type === "light")!).toBe(false);
    expect(ok(asLayout(layout, r.floor))).toEqual([]);
  });
  it("a light never binds to its own entity (that would not validate)", () => {
    const { layout, floor } = build();
    const own = floor.devices.find((d) => d.type === "light")!;
    const r = bindLights(floor, all(floor), own.entity);
    expect(r.floor.devices.find((d) => d.id === own.id)!.bound).toBe(own.bound);
    expect(ok(asLayout(layout, r.floor))).toEqual([]);
  });
  it("junk entity text changes nothing", () => {
    const { floor } = build();
    for (const e of ["nodot", 5, null, undefined, {}] as unknown as string[]) expect(bindLights(floor, all(floor), e).floor).toEqual(floor);
  });
  it("junk, duplicate and out-of-range indices are ignored", () => {
    const { layout, floor } = build();
    const li = floor.devices.findIndex((d) => d.type === "light");
    const r = bindLights(floor, [...JUNK, li, li], "switch.hall");
    expect(r.floor.devices.filter((d) => d.bound === "switch.hall").length).toBeGreaterThanOrEqual(1);
    expect(ok(asLayout(layout, r.floor))).toEqual([]);
    expect(bindLights(floor, "x" as unknown as number[], "switch.hall").floor).toEqual(floor);
  });
  it("no change records no undo step; a change records one", () => {
    const { layout, floor } = build();
    const first = floor.devices.findIndex((d) => d.type === "light" && !d.bound);
    expect(through(layout, (f) => bindLights(f, [first], "").floor).changed).toBe(false);
    expect(through(layout, (f) => bindLights(f, [999], "switch.x").floor).changed).toBe(false);
    expect(through(layout, (f) => bindLights(f, all(f).filter((i) => f.devices[i].type !== "light"), "switch.x").floor).changed).toBe(false);
    const t = through(layout, (f) => bindLights(f, [first], "switch.x").floor);
    expect(t.changed).toBe(true);
    expect(t.st.canUndo).toBe(true);
  });
});

describe("removeDevices", () => {
  it("removes the listed devices, ignores junk, keeps order, validates", () => {
    const { layout, floor } = build();
    const r = removeDevices(floor, [1, 3, 3, ...JUNK]);
    const gone = new Set([0, 1, 2, 3].filter((i) => [1, 3, 0, 2].includes(i)));
    expect(r.devices.length).toBe(floor.devices.length - gone.size);
    expect(r.devices.map((d) => d.id)).toEqual(floor.devices.filter((_, i) => !gone.has(i)).map((d) => d.id));
    expect(ok(asLayout(layout, r))).toEqual([]);
  });
  it("junk only: equal floor, no undo step", () => {
    const { layout, floor } = build();
    expect(removeDevices(floor, [-1, 999, NaN, 1.5])).toEqual(floor);
    expect(through(layout, (f) => removeDevices(f, [-1, 999, NaN])).changed).toBe(false);
    expect(through(layout, (f) => removeDevices(f, [0])).changed).toBe(true);
  });
});

describe("moveDevices", () => {
  it("moves point and segment devices by the delta and skips locked ones", () => {
    const { layout, floor } = build();
    const r = moveDevices(floor, all(floor), 7, -3);
    r.devices.forEach((d, i) => {
      const o = floor.devices[i];
      if (o.locked) return expect(d).toEqual(o);
      if ("x" in o) expect([(d as typeof o).x, (d as typeof o).y]).toEqual([o.x + 7, o.y - 3]);
      else expect([(d as typeof o).a, (d as typeof o).b]).toEqual([[o.a[0] + 7, o.a[1] - 3], [o.b[0] + 7, o.b[1] - 3]]);
    });
    expect(ok(asLayout(layout, r))).toEqual([]);
  });
  it("junk indices and junk or zero deltas change nothing and leave no undo step", () => {
    const { layout, floor } = build();
    expect(moveDevices(floor, JUNK.filter((n) => n !== 0 && n !== 2), 5, 5)).toEqual(floor);
    for (const [dx, dy] of [[0, 0], [NaN, 4], [Infinity, 0], [1, -Infinity]] as [number, number][]) expect(moveDevices(floor, all(floor), dx, dy)).toEqual(floor);
    const lockedOnly = all(floor).filter((i) => floor.devices[i].locked);
    expect(through(layout, (f) => moveDevices(f, lockedOnly, 5, 5)).changed).toBe(false);
    const free = all(floor).filter((i) => !floor.devices[i].locked);
    expect(through(layout, (f) => moveDevices(f, free, 5, 5)).changed).toBe(true);
  });
  it("a move that would leave the coordinate limit leaves that device where it is", () => {
    const { layout, floor } = build();
    const r = moveDevices(floor, all(floor), 5e7, 0);
    expect(r).toEqual(floor);
    expect(ok(asLayout(layout, r))).toEqual([]);
  });
});

describe("lockDevices", () => {
  it("locks every listed device of every type, unlocks them, and validates", () => {
    const { layout, floor } = build();
    const on = lockDevices(floor, all(floor), true);
    expect(on.devices.every((d) => d.locked === true)).toBe(true);
    expect(ok(asLayout(layout, on))).toEqual([]);
    const off = lockDevices(on, all(on), false);
    expect(off.devices.some((d) => d.locked)).toBe(false);
    expect(off.devices.every((d) => !("locked" in d))).toBe(true);
    expect(ok(asLayout(layout, off))).toEqual([]);
  });
  it("only the listed devices change, junk is ignored", () => {
    const { floor } = build();
    const i = floor.devices.findIndex((d) => !d.locked);
    const r = lockDevices(floor, [i, ...JUNK.filter((n) => n !== 0 && n !== 2)], true);
    r.devices.forEach((d, k) => { if (k !== i) expect(d).toEqual(floor.devices[k]); });
    expect(r.devices[i].locked).toBe(true);
  });
  it("no change records no undo step", () => {
    const { layout, floor } = build();
    const lockedIdx = all(floor).filter((i) => floor.devices[i].locked);
    const freeIdx = all(floor).filter((i) => !floor.devices[i].locked);
    expect(through(layout, (f) => lockDevices(f, lockedIdx, true)).changed).toBe(false);
    expect(through(layout, (f) => lockDevices(f, freeIdx, false)).changed).toBe(false);
    expect(through(layout, (f) => lockDevices(f, [999, NaN], true)).changed).toBe(false);
    expect(through(layout, (f) => lockDevices(f, freeIdx, true)).changed).toBe(true);
  });
  it("a locked:false device is left as written on unlock", () => {
    const { floor } = build();
    floor.devices[0].locked = false;
    expect(lockDevices(floor, [0], false)).toEqual(floor);
  });
});

describe("reindexAfterRemove", () => {
  it("drops the removed, shifts the rest down, sorts, dedupes, ignores junk", () => {
    expect(reindexAfterRemove([0, 2, 5, 7, 7], [2, 5])).toEqual([0, 5]);
    expect(reindexAfterRemove([4, 1, 9], [0])).toEqual([0, 3, 8]);
    expect(reindexAfterRemove([3, 1], [])).toEqual([1, 3]);
    expect(reindexAfterRemove([1, 2], [1, 2])).toEqual([]);
    expect(reindexAfterRemove([-1, NaN, 1.5, Infinity, 4, 1], [-1, NaN, 3.5, 3])).toEqual([1, 3]);
  });
  it("matches removeDevices on a real floor", () => {
    const { floor } = build();
    const sel = [2, 5, 6, 9], removed = [5, 1];
    const next = removeDevices(floor, removed);
    const idx = reindexAfterRemove(sel, removed);
    expect(idx.map((i) => next.devices[i].id)).toEqual([2, 6, 9].map((i) => floor.devices[i].id));
  });
});
