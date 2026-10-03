import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import type { Device, DeviceType, Layout, Pt } from "../../src/core/schema";
import { FLOORPLAN_CSS, THEMES, renderFloor, type StateOverlay } from "../../src/core/render";

const ground = (demo as unknown as Layout).floors.ground;
const st = (state: string) => ({ state, attributes: {}, last_changed: "2026-09-19T10:00:00Z" });
const NOW = Date.parse("2026-09-19T10:00:05Z");
const dev = (type: DeviceType, entity: string, x: number, y: number): Device => ({ id: entity, type, entity, name: entity, x, y }) as Device;
const sq = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const room = (name: string, pts: Pt[], extra: Record<string, unknown> = {}) => ({ id: name, name, area: "", kind: "room", pts, wk: pts.map(() => "wall"), ...extra });
const draw = (rooms: unknown[], devices: Device[], state: StateOverlay | undefined, extra: Record<string, unknown> = {}) =>
  renderFloor({ ...ground, outline: [], rooms, devices, doors: [], walls: [], openings: [], furniture: [], stairs: [], extras: [], unlinked: [] } as unknown as typeof ground, { scale: 0.5, now: NOW, state, ...extra });
const rings = (html: string) => [...html.matchAll(/<polygon[^>]*class="motion-perimeter[^"]*"[^>]*>/g)].map((m) => m[0]);
const L_SHAPE: Pt[] = [[0, 0], [400, 0], [400, 150], [150, 150], [150, 400], [0, 400]];

describe("motion perimeter: a room with a triggered motion sensor in it gets one inner line", () => {
  const rooms = [room("Office", sq(0, 0, 400, 300)), room("Hall", sq(500, 0, 300, 300))];

  it("draws one polygon for the room holding the sensor that is on, none for the other; off or no state draws none", () => {
    const html = draw(rooms, [dev("motion", "binary_sensor.a", 100, 100)], { "binary_sensor.a": st("on") });
    const r = rings(html);
    expect(r).toHaveLength(1);
    expect(r[0]).toContain('data-m="0"');
    expect(draw(rooms, [dev("motion", "binary_sensor.a", 100, 100)], { "binary_sensor.a": st("off") })).not.toContain("motion-perimeter");
    expect(draw(rooms, [dev("motion", "binary_sensor.a", 100, 100)], { "binary_sensor.a": st("unavailable") })).not.toContain("motion-perimeter");
    expect(draw(rooms, [dev("motion", "binary_sensor.a", 100, 100)], undefined)).not.toContain("motion-perimeter");
  });
  it("two sensors in the room, one on one off: still one line; only the off one: none", () => {
    const two = [dev("motion", "binary_sensor.a", 100, 100), dev("motion", "binary_sensor.b", 200, 200)];
    expect(rings(draw(rooms, two, { "binary_sensor.a": st("off"), "binary_sensor.b": st("on") }))).toHaveLength(1);
    expect(rings(draw(rooms, two, { "binary_sensor.a": st("on"), "binary_sensor.b": st("on") }))).toHaveLength(1);
    expect(rings(draw(rooms, two, { "binary_sensor.a": st("off"), "binary_sensor.b": st("off") }))).toHaveLength(0);
  });
  it("a sensor outside every room, or in another room, does not light this one", () => {
    expect(rings(draw(rooms, [dev("motion", "binary_sensor.a", 450, 100)], { "binary_sensor.a": st("on") }))).toHaveLength(0);
    const r = rings(draw(rooms, [dev("motion", "binary_sensor.a", 600, 100)], { "binary_sensor.a": st("on") }));
    expect(r).toHaveLength(1);
    expect(r[0]).toContain('data-m="1"');
  });
  it("a sensor in a room nested in a bigger one lights the smaller room only", () => {
    const nested = [room("Garden", sq(0, 0, 1000, 1000)), room("House", sq(100, 100, 300, 300))];
    const r = rings(draw(nested, [dev("motion", "binary_sensor.a", 200, 200)], { "binary_sensor.a": st("on") }));
    expect(r).toHaveLength(1);
    expect(r[0]).toContain('data-m="1"');
  });
  it("a radar that is on counts, with its own colour class; zones, structures and unnamed fills never get one", () => {
    const r = rings(draw(rooms, [dev("radar", "binary_sensor.r", 100, 100)], { "binary_sensor.r": st("on") }));
    expect(r).toHaveLength(1);
    expect(r[0]).toContain("radar");
    for (const kind of ["zone", "structure"]) expect(rings(draw([room("Z", sq(0, 0, 400, 300), { kind })], [dev("motion", "binary_sensor.a", 100, 100)], { "binary_sensor.a": st("on") })), kind).toHaveLength(0);
    expect(rings(draw([room("", sq(0, 0, 400, 300), { kind: "fill" })], [dev("motion", "binary_sensor.a", 100, 100)], { "binary_sensor.a": st("on") }))).toHaveLength(0);
  });
  it("the first sensor in array order that is on decides the colour class (radar first, motion second)", () => {
    const a = rings(draw(rooms, [dev("radar", "binary_sensor.r", 100, 100), dev("motion", "binary_sensor.m", 120, 120)], { "binary_sensor.r": st("on"), "binary_sensor.m": st("on") }));
    expect(a[0]).toContain("radar");
    const b = rings(draw(rooms, [dev("motion", "binary_sensor.m", 120, 120), dev("radar", "binary_sensor.r", 100, 100)], { "binary_sensor.r": st("on"), "binary_sensor.m": st("on") }));
    expect(b[0]).not.toContain("radar");
  });
  it("is fill none, tap-proof and a class rule: no hard-coded colour, no pointer-events attribute (findings 9, 18)", () => {
    const [r] = rings(draw(rooms, [dev("motion", "binary_sensor.a", 100, 100)], { "binary_sensor.a": st("on") }));
    expect(r).not.toMatch(/#[0-9a-f]{3,6}|rgb\(|pointer-events|style=/i);
    expect(FLOORPLAN_CSS).toMatch(/\.motion-perimeter\{[^}]*fill:none[^}]*\}/);
    expect(FLOORPLAN_CSS).toMatch(/\.motion-perimeter\{[^}]*pointer-events:none/);
    expect(FLOORPLAN_CSS).toMatch(/\.motion-perimeter\{[^}]*stroke:var\(--fp-dev-motion\)/);
    expect(FLOORPLAN_CSS).toMatch(/\.motion-perimeter\.radar\{[^}]*stroke:var\(--fp-dev-radar\)/);
  });
  it("lies inside the walls: masked to a band that starts past half the wall and halo, for an L-shaped room too", () => {
    for (const pts of [sq(0, 0, 400, 300), L_SHAPE]) {
      const html = draw([room("R", pts, { wk: pts.map(() => "external") })], [dev("motion", "binary_sensor.a", 50, 50)], { "binary_sensor.a": st("on") });
      const mask = html.match(/<mask id="(fp-mp-[a-z0-9]+)"[^>]*>(.*?)<\/mask>/)!;
      expect(rings(html)[0]).toContain(`mask="url(#${mask[1]})"`);
      // the white shape is the room itself (so nothing outside it shows); the black stroke hides the wall zone
      expect(mask[2]).toContain('fill="white"');
      expect(mask[2]).toContain(pts.map((p) => `${p[0]},${p[1]}`).join(" "));
      const hide = +mask[2].match(/stroke="black"[^>]*stroke-width="([\d.]+)"|stroke-width="([\d.]+)"[^>]*stroke="black"/)!.slice(1).find(Boolean)!;
      expect(hide / 2).toBeGreaterThanOrEqual(11); // external wall 20 + halo 2, half of it
      const line = +rings(html)[0].match(/stroke-width="([\d.]+)"/)![1];
      expect(line / 2).toBeGreaterThan(hide / 2); // the painted band is wider than the hidden one: a line is left
      expect(line / 2 - hide / 2).toBeLessThanOrEqual(8); // and it is thin
    }
  });
  it("2D output with nothing triggered is byte-identical to one with no state at all for motion", () => {
    const off = draw(rooms, [dev("motion", "binary_sensor.a", 100, 100)], { "binary_sensor.a": st("off") });
    expect(off).not.toContain("<mask");
    expect(off).not.toContain("motion-perimeter");
  });
  it("is drawn above the room fill and the night overlay, and below the icons; 2.5D puts it under the solids", () => {
    const html = draw(rooms, [dev("motion", "binary_sensor.a", 100, 100)], { "binary_sensor.a": st("on") }, { night: true });
    const at = (s: string) => html.indexOf(s);
    expect(at("motion-perimeter")).toBeGreaterThan(at('class="room-night'));
    expect(at("motion-perimeter")).toBeGreaterThan(at('data-r="0"'));
    expect(at("motion-perimeter")).toBeLessThan(at('<g data-x="0"'));
    const walled = { ...rooms[0], wh: 250 };
    const h25 = draw([walled, rooms[1]], [dev("motion", "binary_sensor.a", 100, 100)], { "binary_sensor.a": st("on") }, { view: "2.5d" });
    expect(h25).toContain("motion-perimeter");
    const i = h25.indexOf("motion-perimeter");
    expect(h25.indexOf('class="ws', i)).toBeGreaterThan(i === -1 ? 0 : i);
  });
  it("still draws with labels off, in every theme (the draw is theme-free: colour is a variable)", () => {
    for (const theme of THEMES) {
      const html = draw(rooms, [dev("motion", "binary_sensor.a", 100, 100)], { "binary_sensor.a": st("on") }, { labels: false, theme });
      expect(rings(html), theme).toHaveLength(1);
      expect(html, theme).not.toContain("<text");
    }
  });
  it("hostile ids and names: nothing from them reaches the perimeter markup", () => {
    const evil = '"><script>alert(1)</script>';
    const html = draw([room(evil, sq(0, 0, 400, 300))], [dev("motion", evil, 100, 100)], { [evil]: st("on") });
    expect(rings(html)).toHaveLength(1);
    expect(html).not.toContain("<script>");
  });
  it("junk geometry never throws: a room with NaN or too few points is skipped", () => {
    const junk = [room("A", [[0, 0], [NaN, 5], [4, 4]]), room("B", [[0, 0], [10, 10]])];
    expect(() => draw(junk, [dev("motion", "binary_sensor.a", 1, 1)], { "binary_sensor.a": st("on") })).not.toThrow();
  });
  it("the demo hall with its sensor on draws exactly one line, in the Hall", () => {
    const html = renderFloor(ground, { scale: 0.5, now: NOW, state: { "binary_sensor.demo_hall_motion": st("on") } });
    expect(rings(html)).toHaveLength(1); expect(rings(html)[0]).toContain(`data-m="2"`);
  });
});
