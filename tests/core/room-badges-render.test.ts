import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import type { Device, DeviceType, Layout, Pt } from "../../src/core/schema";
import { ROOM_CORNERS } from "../../src/core/schema";
import { inside, renderFloor, type StateOverlay } from "../../src/core/render";

// B55.3 (docs/specs/batch-s52.md F34, F36): renderFloor draws a room's badges in the chosen corner of its box.
const ground = (demo as unknown as Layout).floors.ground;
const NOW = Date.parse("2026-11-07T12:00:00Z");
const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-11-07T12:00:00Z" });
const dev = (type: DeviceType, entity: string, x: number, y: number): Device => ({ id: entity, type, entity, name: entity, x, y }) as Device;
const sq = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const L: Pt[] = [[0, 0], [200, 0], [200, 100], [400, 100], [400, 300], [0, 300]];
const room = (extra: Record<string, unknown> = {}, pts: Pt[] = sq(0, 0, 400, 300), name = "Office") => ({ id: "r1", name, area: "", kind: "room", pts, wk: pts.map(() => "wall"), ...extra });
const draw = (rooms: unknown[], devices: Device[], state?: StateOverlay, extra: Record<string, unknown> = {}) =>
  renderFloor({ ...ground, outline: [], rooms, devices, doors: [], walls: [], openings: [], furniture: [], stairs: [], extras: [], unlinked: [] } as unknown as typeof ground, { scale: 0.5, now: NOW, state, ...extra });
const ALL: Device[] = [dev("light", "light.a", 100, 150), dev("ac", "climate.a", 110, 150), dev("motion", "binary_sensor.a", 120, 150)];
const WITH_POWER = { power: ["sensor.p"] };
type Cb = { ri: number; kind: string; cls: string; cx: number; cy: number; r: number; transform: string };
const badges = (html: string): Cb[] => [...html.matchAll(/<g class="(cb [^"]*)" data-cb="(\d+):(\w+)"([^>]*)><circle class="cb-bg" cx="([-\d.]+)" cy="([-\d.]+)" r="([-\d.]+)"/g)]
  .map((m) => ({ cls: m[1], ri: +m[2], kind: m[3], transform: m[4], cx: +m[5], cy: +m[6], r: +m[7] }));

describe("renderFloor: room badges", () => {
  it("draws none for a room without `badges`, and none for a room with no source", () => {
    expect(badges(draw([room(WITH_POWER)], ALL))).toEqual([]);
    expect(badges(draw([room({ badges: { corner: "ne" } })], [dev("temp", "sensor.t", 50, 50)]))).toEqual([]);
  });
  it("draws one badge per source the room has, in order, and none for a source it lacks", () => {
    expect(badges(draw([room({ badges: { corner: "nw" }, ...WITH_POWER })], ALL)).map((b) => b.kind)).toEqual(["lights", "climate", "motion", "energy"]);
    expect(badges(draw([room({ badges: { corner: "nw" } })], [dev("light", "light.a", 50, 50)])).map((b) => b.kind)).toEqual(["lights"]);
  });
  it("sits 8 screen px in from the chosen corner of the box (scale 0.5: 2 cm a px), icons left to right", () => {
    // radius 9 px = 18 cm; first centre 8 + 9 = 17 px = 34 cm in; pitch 9 + 4 + 9 = 22 px = 44 cm
    const nw = badges(draw([room({ badges: { corner: "nw" } })], ALL));
    expect(nw.map((b) => [b.cx, b.cy, b.r])).toEqual([[34, 34, 18], [78, 34, 18], [122, 34, 18]]);
    const se = badges(draw([room({ badges: { corner: "se" } })], ALL));
    expect(se.map((b) => [b.cx, b.cy])).toEqual([[400 - 34 - 88, 300 - 34], [400 - 34 - 44, 300 - 34], [400 - 34, 300 - 34]]);
    const ne = badges(draw([room({ badges: { corner: "ne" } })], ALL)), sw = badges(draw([room({ badges: { corner: "sw" } })], ALL));
    expect(ne[2].cx).toBe(366); expect(ne[2].cy).toBe(34);
    expect(sw[0].cx).toBe(34); expect(sw[0].cy).toBe(266);
  });
  it("keeps its screen size when the view is zoomed: 2x halves the plan units", () => {
    const z = badges(draw([room({ badges: { corner: "nw" } })], ALL, undefined, { zoom: 2 }));
    expect(z.map((b) => [b.cx, b.r])).toEqual([[17, 9], [39, 9], [61, 9]]);
  });
  it("stays upright in a turned plan: each badge is turned back about its own centre", () => {
    const html = draw([room({ badges: { corner: "nw" } })], ALL, undefined, { rotate: { deg: 90, pivot: [200, 150] } });
    for (const b of badges(html)) expect(b.transform).toContain(`rotate(-90 ${b.cx} ${b.cy})`);
    expect(badges(draw([room({ badges: { corner: "nw" } })], ALL)).every((b) => b.transform === "" || !b.transform.includes("rotate"))).toBe(true);
  });
  it("an L-shaped room: a corner outside the polygon slides toward the label point until every icon is inside; never outside", () => {
    for (const corner of ROOM_CORNERS) {
      const bs = badges(draw([room({ badges: { corner } }, L)], ALL));
      expect(bs, corner).toHaveLength(3);
      for (const b of bs) expect(inside([b.cx, b.cy], L), `${corner} icon at ${b.cx},${b.cy}`).toBe(true);
    }
    // the ne corner of the box (400,0) is outside the L: the row is not where a rectangle would put it
    const ne = badges(draw([room({ badges: { corner: "ne" } }, L)], ALL)), rect = badges(draw([room({ badges: { corner: "ne" } })], ALL));
    expect(ne.map((b) => [b.cx, b.cy])).not.toEqual(rect.map((b) => [b.cx, b.cy]));
    // the nw corner is inside the L: it does not slide
    expect(badges(draw([room({ badges: { corner: "nw" } }, L)], ALL)).map((b) => [b.cx, b.cy])).toEqual([[34, 34], [78, 34], [122, 34]]);
  });
  it("lit and tone come from the states", () => {
    const on = draw([room({ badges: { corner: "nw" }, ...WITH_POWER })], ALL, { "light.a": st("on"), "climate.a": st("heat", { hvac_action: "heating" }), "binary_sensor.a": st("on"), "sensor.p": st("300", { unit_of_measurement: "W" }) });
    expect(badges(on).map((b) => b.cls)).toEqual(["cb cb-lights on", "cb cb-climate on cb-heat", "cb cb-motion on", "cb cb-energy on"]);
    const cool = draw([room({ badges: { corner: "nw" } })], ALL, { "climate.a": st("cool", { hvac_action: "cooling" }) });
    expect(badges(cool)[1].cls).toBe("cb cb-climate on cb-cool");
    const off = draw([room({ badges: { corner: "nw" }, ...WITH_POWER })], ALL, {});
    expect(badges(off).map((b) => b.cls)).toEqual(["cb cb-lights", "cb cb-climate", "cb cb-motion", "cb cb-energy"]);
  });
  it("the editor's badges take no click; the card's do (the bubble needs them)", () => {
    expect(badges(draw([room({ badges: { corner: "nw" } })], ALL, undefined, { editor: true })).every((b) => b.cls.includes("cb-ed"))).toBe(true);
    expect(badges(draw([room({ badges: { corner: "nw" } })], ALL)).some((b) => b.cls.includes("cb-ed"))).toBe(false);
  });
  it("escapes: a hostile room name or device name never reaches the markup raw", () => {
    const evil = '"><script>alert(1)</script>';
    const html = draw([room({ badges: { corner: "nw" } }, sq(0, 0, 400, 300), evil)], [{ ...dev("light", "light.a", 50, 50), name: evil } as Device]);
    expect(html).not.toContain("<script");
    expect(badges(html)).toHaveLength(1);
  });
  it("junk in a room is not a crash: bad corner, bad points, a kind that owns no devices", () => {
    expect(() => draw([room({ badges: { corner: "up" } }), room({ badges: { corner: "nw" } }, [[0, 0], [1, 1]]), room({ badges: 5 })], ALL)).not.toThrow();
    expect(badges(draw([room({ badges: { corner: "up" } })], ALL))).toEqual([]);
    expect(badges(draw([{ ...room({ badges: { corner: "nw" } }), kind: "structure" }], ALL))).toEqual([]);
  });
  it("the badge of the second room is that room's, by index", () => {
    const html = draw([room(), { ...room({ badges: { corner: "nw" } }, sq(500, 0, 300, 300), "Hall"), id: "r2" }], [dev("light", "light.h", 600, 100)]);
    expect(badges(html).map((b) => [b.ri, b.kind, b.cx])).toEqual([[1, "lights", 534]]);
  });
});
