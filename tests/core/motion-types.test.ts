import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import { DEVICE_TYPES, MOTION_TYPES, type Device, type DeviceType, type Layout, type Pt } from "../../src/core/schema";
import { renderFloor, type StateOverlay } from "../../src/core/render";
import { ACTIVE_LIST_RULE, activeDevices } from "../../src/core/active";

const ground = (demo as unknown as Layout).floors.ground;
const NOW = Date.parse("2026-09-19T10:00:00Z");
const at = (secAgo: number, state: string) => ({ state, attributes: {}, last_changed: new Date(NOW - secAgo * 1000).toISOString() });
const dev = (type: DeviceType, x: number, y: number): Device => ({ id: "d", type, entity: "binary_sensor.d", name: "d", x, y }) as Device;
const sq = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const room = (name: string, pts: Pt[], extra: Record<string, unknown> = {}) => ({ id: name, name, area: "", kind: "room", pts, wk: pts.map(() => "wall"), ...extra });
const draw = (devices: Device[], state: StateOverlay, extra: Record<string, unknown> = {}, rooms: unknown[] = [room("Living", sq(0, 0, 500, 400))]) =>
  renderFloor({ ...ground, outline: [], rooms, devices, doors: [], walls: [], openings: [], furniture: [], stairs: [], extras: [], unlinked: [] } as unknown as typeof ground, { scale: 0.5, now: NOW, state, ...extra });
const rings = (html: string) => [...html.matchAll(/<polygon[^>]*class="motion-perimeter[^"]*"[^>]*>/g)].map((m) => m[0]);

describe("MOTION_TYPES: one list, every type decided (finding 17)", () => {
  it("lists exactly the motion-like types", () => expect([...MOTION_TYPES].sort()).toEqual(["motion", "radar"]));
  it("each type in DEVICE_TYPES draws the perimeter when on if it is motion-like, and not otherwise", () => {
    for (const t of DEVICE_TYPES) {
      const html = draw([dev(t, 100, 100)], { "binary_sensor.d": at(1, "on") });
      expect(rings(html).length, t).toBe(MOTION_TYPES.includes(t) ? 1 : 0);
    }
  });
});

describe("the Active list reads the same list", () => {
  it("every MOTION_TYPES type that is on is listed, in its own colour", () => {
    for (const t of MOTION_TYPES) {
      expect(ACTIVE_LIST_RULE[t], t).toBe("on");
      const l = activeDevices({ ...demo, floors: { ground: { ...ground, devices: [dev(t, 100, 100)], doors: [] } } } as unknown as Layout, { "binary_sensor.d": at(1, "on") });
      expect(l.map((a) => a.colorVar), t).toEqual([`--fp-dev-${t}`]);
    }
  });
});

describe("a motion icon that is still red must carry the border (Diego 0.12.23: red icon, no border)", () => {
  it("a sensor that went off a minute ago fades its icon; the border fades with it, same value", () => {
    const html = draw([dev("motion", 100, 100)], { "binary_sensor.d": at(60, "off") }, { fade: 300 });
    const icon = html.match(/class="dev dev-motion[^"]*"[^>]*--fp-fade:([\d.]+)/)![1];
    expect(+icon).toBeCloseTo(0.8, 2);
    const r = rings(html);
    expect(r).toHaveLength(1);
    expect(r[0]).toContain(`style="--fp-fade:${icon}"`);
  });
  it("fully faded, fade 0, or unavailable: no border", () => {
    expect(rings(draw([dev("motion", 100, 100)], { "binary_sensor.d": at(400, "off") }, { fade: 300 }))).toHaveLength(0);
    expect(rings(draw([dev("motion", 100, 100)], { "binary_sensor.d": at(10, "off") }, { fade: 0 }))).toHaveLength(0);
    expect(rings(draw([dev("motion", 100, 100)], { "binary_sensor.d": at(10, "unavailable") }, { fade: 300 }))).toHaveLength(0);
  });
  it("a sensor that is on draws the border at full strength: no style, however old last_changed is", () => {
    const r = rings(draw([dev("motion", 100, 100)], { "binary_sensor.d": at(4000, "on") }, { fade: 300 }));
    expect(r).toHaveLength(1);
    expect(r[0]).not.toContain("style=");
  });
  it("a fading sensor does not dim the border of a sensor that is on in the same room", () => {
    const two = [{ ...dev("motion", 100, 100), entity: "binary_sensor.a" }, { ...dev("motion", 200, 200), entity: "binary_sensor.b" }] as Device[];
    const r = rings(draw(two, { "binary_sensor.a": at(60, "off"), "binary_sensor.b": at(1, "on") }, { fade: 300 }));
    expect(r).toHaveLength(1);
    expect(r[0]).not.toContain("style=");
  });
});

describe("room membership uses the floor point, and a sensor mounted in the wall still counts", () => {
  it("a sensor on the room's edge or just outside it, within the wall, lights that room", () => {
    for (const p of [[0, 0], [250, 0], [-8, 200], [500, 405]] as Pt[])
      expect(rings(draw([dev("motion", p[0], p[1])], { "binary_sensor.d": at(1, "on") })), String(p)).toHaveLength(1);
  });
  it("a sensor well outside every wall does not", () => {
    expect(rings(draw([dev("motion", -60, 200)], { "binary_sensor.d": at(1, "on") }))).toHaveLength(0);
  });
  it("a sensor inside a room wins over one that is only near the wall of the room next door", () => {
    const two = [room("A", sq(0, 0, 400, 400)), room("B", sq(404, 0, 400, 400))];
    const r = rings(draw([dev("motion", 402, 200)], { "binary_sensor.d": at(1, "on") }, {}, two));
    expect(r).toHaveLength(1);
  });
  it("a nested room still wins over the room around it", () => {
    const nested = [room("Garden", sq(0, 0, 1000, 1000)), room("House", sq(100, 100, 300, 300))];
    const r = rings(draw([dev("motion", 200, 200)], { "binary_sensor.d": at(1, "on") }, {}, nested));
    expect(r).toHaveLength(1); expect(r[0]).toContain('data-m="1"');
  });
  it("2.5D, tilted and turned, a tall wall: the border is drawn for the room under the floor point", () => {
    const tall = [room("Living", sq(0, 0, 500, 400), { wh: 250 })];
    for (const view of ["2d", "2.5d"] as const) {
      const html = draw([dev("motion", 10, 10)], { "binary_sensor.d": at(1, "on") }, { view, tilt: 1, rotate: { deg: 45, pivot: [250, 200] } }, tall);
      expect(rings(html), view).toHaveLength(1);
    }
  });
});
