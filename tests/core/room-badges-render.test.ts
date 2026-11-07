import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import type { Device, DeviceType, Layout, Pt } from "../../src/core/schema";
import { ROOM_CORNERS } from "../../src/core/schema";
import { inside, renderFloor, rotateAbout, type StateOverlay } from "../../src/core/render";

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
      // inside is not enough: the whole disc keeps off every wall (radius 18 + half a 10 cm wall, scale 0.5). Review of S55: it sat on the inner wall.
      for (const b of bs) for (let i = 0; i < L.length; i++) expect(segDist([b.cx, b.cy], L[i], L[(i + 1) % L.length]), `${corner} icon at ${b.cx},${b.cy} edge ${i}`).toBeGreaterThanOrEqual(23 - 1e-6);
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

// Opus review of S55: in an L the slid row landed on the room's name and across the inner corner wall. A badge disc must keep the wall's
// reach (its radius plus half the wall's thickness) from EVERY edge, and clear of the name, not only be inside the polygon.
const BATH: Pt[] = [[300, 450], [1100, 450], [1100, 700], [700, 700], [700, 550], [300, 550]];
const HALL: Pt[] = [[0, 0], [600, 0], [600, 150], [200, 150], [200, 450], [0, 450]];
const segDist = (p: Pt, a: Pt, b: Pt) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};
/** The room's name as the card draws it: its box in plan cm, from the `<text>` the renderer wrote (width 0.6 em a letter, as its own placer assumes). */
const labelBox = (html: string, name: string): [number, number, number, number] => {
  const m = html.match(new RegExp(`<text class="lbl[^"]*" x="([-\\d.]+)" y="([-\\d.]+)"[^>]*font-size="([-\\d.]+)"[^>]*>${name}</text>`));
  expect(m, `label ${name}`).not.toBeNull();
  const x = +m![1], y = +m![2], size = +m![3], w = name.length * 0.6 * size;
  return [x - w / 2, y - 0.75 * size, x + w / 2, y + 0.25 * size];
};
const MASKS: Device[][] = [
  [dev("light", "light.a", 0, 0)], [dev("light", "light.a", 0, 0), dev("ac", "climate.a", 0, 0)],
  [dev("light", "light.a", 0, 0), dev("ac", "climate.a", 0, 0), dev("motion", "binary_sensor.a", 0, 0)],
];
describe("renderFloor: room badges in an L keep off the walls and the name", () => {
  for (const [name, pts, at] of [["Bath", BATH, [900, 500]], ["Hall", HALL, [100, 300]]] as const) for (const corner of ROOM_CORNERS) for (const withPower of [false, true]) for (const [k, devs] of MASKS.entries()) {
    it(`${name} ${corner} ${devs.length} device(s)${withPower ? " + power" : ""} (${k})`, () => {
      const html = draw([room({ badges: { corner }, ...(withPower ? WITH_POWER : {}) }, pts as unknown as Pt[], name)], devs.map((d) => ({ ...d, x: at[0], y: at[1] }) as Device));
      const bs = badges(html);
      expect(bs).toHaveLength(devs.length + (withPower ? 1 : 0));
      const [lx0, ly0, lx1, ly1] = labelBox(html, name), reach = 18 + 5; // radius 9 px, half of a 10 cm wall, at 2 cm a px
      for (const b of bs) {
        const where = `${name} ${corner} ${b.kind} at ${b.cx},${b.cy}`;
        expect(inside([b.cx, b.cy], pts as unknown as Pt[]), where).toBe(true);
        for (let i = 0; i < pts.length; i++) expect(segDist([b.cx, b.cy], pts[i] as Pt, pts[(i + 1) % pts.length] as Pt), `${where}: edge ${i}`).toBeGreaterThanOrEqual(reach - 1e-6);
        const gx = Math.max(lx0 - b.cx, 0, b.cx - lx1), gy = Math.max(ly0 - b.cy, 0, b.cy - ly1);
        expect(Math.hypot(gx, gy), `${where}: clear of the name box`).toBeGreaterThanOrEqual(b.r);
      }
    });
  }
});

// Opus re-check of S55: in a turned plan the name is drawn upright on screen, so in plan axes it lies at an angle. The placer cleared a flat
// box that is not where the name is. The gap is measured in the name's own frame: turn the disc centre by the plan's turn about the name.
describe("renderFloor: room badges in a turned plan keep clear of the upright name", () => {
  for (const deg of [0, 90, 180, 270]) for (const corner of ROOM_CORNERS) {
    it(`Bathroom ${corner} turned ${deg}`, () => {
      const html = draw([room({ badges: { corner } }, L, "Bathroom")], MASKS[2].map((d) => ({ ...d, x: 100, y: 200 }) as Device), undefined, { rotate: { deg, pivot: [200, 150] } });
      const m = html.match(/<text class="lbl[^"]*" x="([-\d.]+)" y="([-\d.]+)"[^>]*font-size="([-\d.]+)"[^>]*>Bathroom<\/text>/);
      expect(m, "label").not.toBeNull();
      const at: Pt = [+m![1], +m![2]], size = +m![3], w = "Bathroom".length * 0.6 * size;
      const [x0, y0, x1, y1] = [at[0] - w / 2, at[1] - 0.75 * size, at[0] + w / 2, at[1] + 0.25 * size];
      const bs = badges(html);
      expect(bs).toHaveLength(3);
      for (const b of bs) {
        const [ux, uy] = rotateAbout([b.cx, b.cy], deg, at);
        const gap = Math.hypot(Math.max(x0 - ux, 0, ux - x1), Math.max(y0 - uy, 0, uy - y1)) - b.r;
        expect(gap, `${corner} ${deg} ${b.kind} at ${b.cx},${b.cy}`).toBeGreaterThanOrEqual(-1e-6);
      }
    });
  }
});
