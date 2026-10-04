import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import type { Device, DeviceType, Layout, Pt } from "../../src/core/schema";
import { MAX_ROOM_SENSORS, validate } from "../../src/core/schema";
import { migrate } from "../../src/core/migrate";
import { FLOORPLAN_CSS, renderFloor, type StateOverlay } from "../../src/core/render";

// S11.1: temperature, humidity and motion sensors belong to a room (spec docs/specs/room-sensors.md, criteria 1, 2, 7).
const ground = (demo as unknown as Layout).floors.ground;
const NOW = Date.parse("2026-10-04T10:00:00Z");
const st = (state: string, attributes: Record<string, unknown> = {}, last_changed = "2026-10-04T10:00:00Z") => ({ state, attributes, last_changed });
const dev = (type: DeviceType, entity: string, x: number, y: number): Device => ({ id: entity, type, entity, name: entity, x, y }) as Device;
const sq = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const room = (extra: Record<string, unknown> = {}, name = "Office") => ({ id: name, name, area: "", kind: "room", pts: sq(0, 0, 400, 300), wk: ["wall", "wall", "wall", "wall"], ...extra });
const draw = (rooms: unknown[], devices: Device[], state: StateOverlay | undefined, extra: Record<string, unknown> = {}) =>
  renderFloor({ ...ground, outline: [], rooms, devices, doors: [], walls: [], openings: [], furniture: [], stairs: [], extras: [], unlinked: [] } as unknown as typeof ground, { scale: 0.5, now: NOW, state, ...extra });
const readout = (html: string) => [...html.matchAll(/<text class="val" data-rv="(\d+)"[^>]*>([^<]*)<\/text>/g)].map((m) => m[2]);
const rings = (html: string) => [...html.matchAll(/<polygon[^>]*class="motion-perimeter[^"]*"[^>]*>/g)].map((m) => m[0]);
const icons = (html: string) => [...html.matchAll(/<g data-x="(\d+)"/g)].map((m) => +m[1]);
const clone = () => structuredClone(demo) as any;
const errs = (l: unknown) => { const r = validate(l); return r.ok ? "" : r.errors.join("\n"); };
const withRoom = (patch: Record<string, unknown>) => { const l = clone(); Object.assign(l.floors.ground.rooms[0], patch); return l; };

describe("schema: a room's temps, humidity and motion", () => {
  it("accepts lists of entity ids", () => {
    expect(errs(withRoom({ temps: ["sensor.a", "sensor.b"], humidity: ["sensor.h"], motion: ["binary_sensor.m", "group.motion"] }))).toBe("");
  });
  it("rejects a non-list, a non-string, a wrong domain, a bare word and too many, without throwing", () => {
    expect(errs(withRoom({ motion: 5 }))).toMatch(/motion must be a list of entity ids/);
    expect(errs(withRoom({ temps: "sensor.a" }))).toMatch(/temps must be a list/);
    expect(errs(withRoom({ temps: [5, null, {}] }))).toMatch(/temps\[0\]/);
    expect(errs(withRoom({ temps: ['"><script>'] }))).toMatch(/temps\[0\] must be an entity id like sensor\.name/);
    expect(errs(withRoom({ temps: ["light.a"] }))).toMatch(/temps\[0\]/);
    expect(errs(withRoom({ humidity: ["binary_sensor.a"] }))).toMatch(/humidity\[0\]/);
    expect(errs(withRoom({ motion: ["sensor.a"] }))).toMatch(/motion\[0\]/);
    expect(errs(withRoom({ motion: ["__proto__"] }))).toMatch(/motion\[0\]/);
    expect(errs(withRoom({ humidity: Array.from({ length: MAX_ROOM_SENSORS + 1 }, (_, i) => `sensor.h${i}`) }))).toMatch(/humidity holds at most/);
    expect(errs(withRoom({ humidity: Array.from({ length: MAX_ROOM_SENSORS }, (_, i) => `sensor.h${i}`) }))).toBe("");
  });
  it("migrate keeps the fields and does not choke on junk in them", () => {
    const m = migrate(withRoom({ temps: ["sensor.a"], motion: 5 })) as any;
    expect(m.floors.ground.rooms[0].temps).toEqual(["sensor.a"]);
    expect(m.floors.ground.rooms[0].motion).toBe(5);
  });
});

describe("render: the room readout", () => {
  const unit = { unit_of_measurement: "°C" };
  it("shows the mean of two sensors rounded to 0.1, with the unit, under the room name", () => {
    const html = draw([room({ temps: ["sensor.a", "sensor.b"] })], [], { "sensor.a": st("21", unit), "sensor.b": st("22.4", unit) });
    expect(readout(html)).toEqual(["21.7 °C"]);
    expect(html.indexOf('class="val"')).toBeGreaterThan(html.indexOf(">Office</text>"));
  });
  it("joins temperature and humidity", () => {
    const html = draw([room({ temps: ["sensor.a"], humidity: ["sensor.h"] })], [], { "sensor.a": st("20.5", unit), "sensor.h": st("55", { unit_of_measurement: "%" }) });
    expect(readout(html)).toEqual(["20.5 °C · 55.0 %"]);
  });
  it("ignores unavailable, unknown and junk states; nothing at all is drawn when none is readable, never NaN", () => {
    const html = draw([room({ temps: ["sensor.a", "sensor.b", "sensor.c"] })], [], { "sensor.a": st("20", unit), "sensor.b": st("unavailable", unit), "sensor.c": st("1,5", unit) });
    expect(readout(html)).toEqual(["20.0 °C"]);
    const none = draw([room({ temps: ["sensor.a", "sensor.b"], humidity: ["sensor.h"] })], [], { "sensor.a": st("unavailable"), "sensor.b": st("unknown") });
    expect(readout(none)).toEqual([]);
    expect(none).not.toMatch(/NaN|undefined/);
    expect(readout(draw([room({ temps: ["sensor.a"] })], [], undefined))).toEqual([]);
  });
  it("draws nothing with labels off; a hostile unit and entity are escaped", () => {
    expect(draw([room({ temps: ["sensor.a"] })], [], { "sensor.a": st("20") }, { labels: false })).not.toContain("<text");
    const evil = '"><script>alert(1)</script>';
    const html = draw([room({ temps: ["sensor.a", evil, 5, "__proto__"] })], [], { "sensor.a": st("20", { unit_of_measurement: evil }), [evil]: st("30") });
    expect(html).not.toContain("<script>");
    expect(readout(html)).toHaveLength(1);
  });
  it("does not throw on a room whose lists are not lists", () => {
    expect(() => draw([room({ temps: 5, humidity: { a: 1 }, motion: "x" })], [], { "sensor.a": st("1") })).not.toThrow();
  });
});

describe("render: an attached sensor has no icon", () => {
  const devices = [dev("temp", "sensor.in", 100, 100), dev("temp", "sensor.loose", 150, 100), dev("humidity", "sensor.h", 200, 100), dev("motion", "binary_sensor.m", 250, 100), dev("light", "light.l", 300, 100)];
  const r = room({ temps: ["sensor.in"], humidity: ["sensor.h"], motion: ["binary_sensor.m"] });
  it("hides the attached temp, humidity and motion devices, keeps the loose one and every other type", () => {
    expect(icons(draw([r], devices, undefined))).toEqual([1, 4]);
    expect(icons(draw([room()], devices, undefined))).toEqual([0, 1, 2, 3, 4]);
  });
  it("hides it in 2.5D as well", () => {
    expect(icons(draw([r], devices, undefined, { view: "2.5d" }))).toEqual([1, 4]);
  });
  it("any room's list counts, not only the one the icon sits in", () => {
    const other = room({ temps: ["sensor.in"] }, "Hall");
    other.pts = sq(1000, 0, 100, 100);
    expect(icons(draw([room(), other], devices, undefined))).toEqual([1, 2, 3, 4]);
  });
  it("the editor keeps it drawn, so it can still be selected and moved", () => {
    expect(icons(draw([r], devices, undefined, { editor: true }))).toEqual([0, 1, 2, 3, 4]);
  });
  it("an entity listed on a room is hidden only for the type that list is for", () => {
    expect(icons(draw([room({ temps: ["light.l"] })], devices, undefined))).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("render: the room's own motion ring", () => {
  const r = room({ motion: ["binary_sensor.a", "binary_sensor.b"] });
  it("is drawn when a listed sensor is on, with the pulse class; none when off, unavailable, unlisted or no state", () => {
    const on = rings(draw([r], [], { "binary_sensor.a": st("off"), "binary_sensor.b": st("on") }, { fade: 300 }));
    expect(on).toHaveLength(1);
    expect(on[0]).toContain("motion-pulse");
    expect(on[0]).toContain('data-m="0"');
    expect(draw([r], [], { "binary_sensor.a": st("off", {}, "2026-10-04T09:00:00Z") }, { fade: 300 })).not.toContain("motion-perimeter");
    expect(draw([r], [], { "binary_sensor.a": st("unavailable") })).not.toContain("motion-perimeter");
    expect(draw([r], [], { "binary_sensor.zzz": st("on") })).not.toContain("motion-perimeter");
    expect(draw([r], [], undefined)).not.toContain("motion-perimeter");
  });
  it("fades after off by the same rule as the icon: stronger just after, gone after `fade` seconds, steady (no pulse)", () => {
    const at = (secs: number) => rings(draw([r], [], { "binary_sensor.a": st("off", {}, new Date(NOW - secs * 1000).toISOString()) }, { fade: 300 }));
    const early = at(30)[0], late = at(240)[0];
    const strength = (p: string) => +p.match(/--fp-fade:([\d.]+)/)![1];
    expect(strength(early)).toBeCloseTo(0.9, 5);
    expect(strength(late)).toBeCloseTo(0.2, 5);
    expect(early).not.toContain("motion-pulse");
    expect(at(301)).toHaveLength(0);
  });
  it("with the fade off, off means gone", () => {
    expect(draw([r], [], { "binary_sensor.a": st("off") }, { fade: 0 })).not.toContain("motion-perimeter");
  });
  it("one ring per room even when an unattached icon in it is on too; an icon-made ring does not pulse", () => {
    const html = draw([r], [dev("motion", "binary_sensor.loose", 100, 100)], { "binary_sensor.a": st("on"), "binary_sensor.loose": st("on") });
    expect(rings(html)).toHaveLength(1);
    const icon = rings(draw([room()], [dev("motion", "binary_sensor.loose", 100, 100)], { "binary_sensor.loose": st("on") }));
    expect(icon[0]).not.toContain("motion-pulse");
  });
  it("an attached motion icon, shown in the editor, does not make a second ring", () => {
    const html = draw([r], [dev("motion", "binary_sensor.a", 100, 100)], { "binary_sensor.a": st("on") }, { editor: true });
    expect(rings(html)).toHaveLength(1);
  });
  it("draws in 2.5D and with labels off; a hostile id never reaches the markup", () => {
    const evil = '"><script>alert(1)</script>.x';
    expect(rings(draw([r], [], { "binary_sensor.a": st("on") }, { view: "2.5d", labels: false }))).toHaveLength(1);
    const html = draw([room({ motion: [evil, 7] }, evil)], [], { [evil]: st("on") });
    expect(html).not.toContain("<script>");
  });
  it("the stylesheet pulses it, and holds it steady under reduced motion", () => {
    expect(FLOORPLAN_CSS).toMatch(/\.motion-perimeter\.motion-pulse\{[^}]*animation:fp-motion-pulse/);
    expect(FLOORPLAN_CSS).toMatch(/@media \(prefers-reduced-motion:reduce\)\{[^}]*\.motion-pulse\{animation:none\}/);
  });
  it("a layout without the new fields draws no readout and no pulse", () => {
    const html = draw([room()], [dev("temp", "sensor.a", 100, 100)], { "sensor.a": st("20") });
    expect(html).not.toContain("data-rv");
    expect(html).not.toContain("motion-pulse");
  });
});
