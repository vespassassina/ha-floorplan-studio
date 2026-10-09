import { describe, it, expect } from "vitest";
import type { Device, DeviceType, Door, Floor, Room } from "../../src/core/schema";
import { renderFloor, FLOORPLAN_CSS } from "../../src/core/render";
import { floorRollups, roomRollup } from "../../src/core/rollup";
import { DEVICE_ICONS } from "../../src/core/icons";
import { migrate } from "../../src/core/migrate";
import type { Layout } from "../../src/core/schema";
import { readFileSync } from "node:fs";

// S25.3: a badge per room, counts of what is on, wrong, open and moving. Alerts and open come from attention.ts (the
// card's Overview rule), lights and motion from classOf (the plan's own rule), so the badge and the plan cannot disagree.

const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-09T10:00:00Z" });
const dev = (type: DeviceType, entity: string, x: number, y: number, extra: Record<string, unknown> = {}): Device => ({ id: `id-${entity}`, type, entity, x, y, ...extra }) as Device;
const box = (id: string, name: string, x: number, y: number, w: number, h: number, extra: Partial<Room> = {}): Room =>
  ({ id, name, area: "", kind: "room", pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], wk: ["wall", "wall", "wall", "wall"], ...extra }) as Room;
// Hall: x 0..400. Study: x 500..900. A door on the Hall's right edge faces the gap, not the Study.
const floorOf = (devices: Device[], rooms: Room[] = [box("hall", "Hall", 0, 0, 400, 300), box("study", "Study", 500, 0, 400, 300)], doors: Door[] = []): Floor => ({
  title: "G", outline: [[-100, -100], [1000, -100], [1000, 400], [-100, 400]], owk: ["external", "external", "external", "external"],
  walls: [], stairs: [], openings: [], extras: [], furniture: [], unlinked: [], devices, doors, rooms,
}) as unknown as Floor;
const door = (name: string, extra: Record<string, unknown> = {}): Door => ({ id: `d-${name}`, name, kind: "door", a: [0, 100], b: [0, 190], ...extra }) as unknown as Door;

describe("S25.3 roomRollup", () => {
  const f = floorOf(
    [dev("light", "light.a", 50, 50), dev("light", "light.b", 60, 60), dev("light", "light.c", 70, 70), dev("light", "light.d", 80, 80),
      dev("motion", "bs.m", 90, 90), dev("contact", "bs.win", 100, 100), dev("lock", "lock.front", 110, 110), dev("light", "light.study", 600, 100)],
    undefined,
    [door("Front")],
  );
  const state = {
    "light.a": st("on"), "light.b": st("on"), "light.c": st("off"), "light.d": st("unavailable"),
    "bs.m": st("on"), "bs.win": st("on"), "lock.front": st("unlocked"), "light.study": st("on"),
  };

  it("counts a room with mixed states: 2 lights on (an off and an unavailable lamp are not on), 1 motion, 1 open, 1 alert", () => {
    expect(roomRollup(f, 0, state)).toEqual({ lights: 2, alerts: 1, open: 1, motion: 1 });
  });

  it("a device counts only in the room it stands in", () => {
    expect(roomRollup(f, 1, state)).toEqual({ lights: 1, alerts: 0, open: 0, motion: 0 });
  });

  it("an unavailable light is not on, and does not raise an alert (unavailable has its own row in attention)", () => {
    const g = floorOf([dev("light", "light.d", 50, 50)]);
    expect(roomRollup(g, 0, { "light.d": st("unavailable") })).toEqual({ lights: 0, alerts: 0, open: 0, motion: 0 });
  });

  it("a bound lamp whose relay is on counts as on, as the plan draws it", () => {
    const g = floorOf([dev("light", "light.l", 50, 50, { bound: "switch.relay" })]);
    expect(roomRollup(g, 0, { "light.l": st("off"), "switch.relay": st("on") }).lights).toBe(1);
  });

  it("an open door counts as open, not as an alert; a jammed lock on it is an alert", () => {
    const g = floorOf([], undefined, [door("Front", { sensors: ["bs.front"], locks: ["lock.f"] })]);
    // The door's edge x = 0 is the Hall's left edge.
    expect(roomRollup(g, 0, { "bs.front": st("on"), "lock.f": st("jammed") })).toEqual({ lights: 0, alerts: 1, open: 1, motion: 0 });
  });

  it("a room's own motion list counts once, also when the same sensor is placed as an icon", () => {
    const rooms = [box("hall", "Hall", 0, 0, 400, 300, { motion: ["bs.m"] } as Partial<Room>)];
    const g = floorOf([dev("motion", "bs.m", 90, 90), dev("motion", "bs.n", 95, 95)], rooms);
    expect(roomRollup(g, 0, { "bs.m": st("on"), "bs.n": st("on") }).motion).toBe(2);
    const h = floorOf([], rooms);
    expect(roomRollup(h, 0, { "bs.m": st("on") }).motion).toBe(1);
  });

  it("junk in, zeros out: no state, no rooms, a bad index, a room with a broken ring", () => {
    expect(roomRollup(f, 0, undefined)).toEqual({ lights: 0, alerts: 0, open: 0, motion: 0 });
    expect(roomRollup(f, 9, state)).toEqual({ lights: 0, alerts: 0, open: 0, motion: 0 });
    expect(roomRollup(f, -1, state)).toEqual({ lights: 0, alerts: 0, open: 0, motion: 0 });
    expect(() => floorRollups({ ...f, rooms: 5, devices: "x", doors: null } as never, state)).not.toThrow();
    expect(floorRollups({ ...f, rooms: [{ name: "x", pts: 5 }] } as never, state)).toHaveLength(1);
  });
});

describe("S25.3 badges in renderFloor", () => {
  const opts = { scale: 0.5 };
  const f = floorOf([dev("light", "light.a", 50, 50), dev("light", "light.b", 60, 60), dev("lock", "lock.front", 110, 110)]);
  const state = { "light.a": st("on"), "light.b": st("on"), "lock.front": st("unlocked") };
  const badges = (html: string) => [...html.matchAll(/<g data-rb="(\d+)"[^>]*class="room-badge"[^>]*>(.*?)<\/g>/gs)];

  it("draws one badge for the room with a count, with the light and alert chips and their numbers", () => {
    const b = badges(renderFloor(f, { ...opts, state }));
    expect(b.map((m) => m[1])).toEqual(["0"]); // the Study has nothing: no badge
    expect([...b[0]![2].matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1])).toEqual(["1", "2"]); // alerts first, then lights
    expect(b[0]![2]).toContain(DEVICE_ICONS.light);
    expect(b[0]![2]).toContain(DEVICE_ICONS.siren);
    expect(b[0]![2]).toMatch(/class="rb-light"/);
    expect(b[0]![2]).toMatch(/class="rb-alert"/);
  });

  it("an empty floor draws no badge, and a state-less render draws none", () => {
    expect(badges(renderFloor(f, opts))).toHaveLength(0);
    expect(badges(renderFloor(floorOf([]), { ...opts, state }))).toHaveLength(0);
  });

  it("a room named \"><script> is escaped: the badge carries no name, and the page has no live script", () => {
    const evil = floorOf([dev("light", "light.a", 50, 50)], [box("h", '"><script>alert(1)</script>', 0, 0, 400, 300)]);
    const html = renderFloor(evil, { ...opts, state });
    expect(html).not.toContain("<script>");
    expect(badges(html)).toHaveLength(1);
  });

  it("with labels off no badge draws: its numbers are text, and labels: false draws none", () => {
    const html = renderFloor(f, { ...opts, state, labels: false });
    expect(badges(html)).toHaveLength(0);
    expect(html).not.toContain("<text");
  });

  it("the plate sits under its room's name and sensor readout, never on them (demo, upright)", () => {
    const L = migrate(JSON.parse(readFileSync("demo/layout.json", "utf8"))) as Layout;
    let checked = 0;
    for (const fl of Object.values(L.floors)) {
      const all: Record<string, ReturnType<typeof st>> = {};
      for (const d of fl.devices) all[d.entity] = st(d.type === "temp" ? "21" : d.type === "humidity" ? "50" : "on");
      const html = renderFloor(fl, { scale: 1, state: all });
      const num = (tag: string, a: string) => Number(tag.match(new RegExp(` ${a}="([-\\d.]+)"`))![1]);
      for (const g of html.matchAll(/<g data-rb="(\d+)"[^>]*>.*?<\/g>/gs)) {
        const plate = g[0].match(/<rect class="rb-plate"[^>]*>/)![0];
        const x = num(plate, "x"), y = num(plate, "y"), w = num(plate, "width"), h = num(plate, "height");
        // every <text> of the same room: its name (data-rl) and readout (data-rv), in the renderer's own box model
        for (const t of html.matchAll(new RegExp(`<text [^>]*data-r[lv]="${g[1]}"[^>]*>[^<]*</text>`, "g"))) {
          const size = num(t[0], "font-size"), len = t[0].match(/>([^<]*)</)![1]!.length, tx = num(t[0], "x"), ty = num(t[0], "y");
          const hit = x < tx + (len * 0.6 * size) / 2 && tx - (len * 0.6 * size) / 2 < x + w && y < ty + 0.25 * size && ty - 0.75 * size < y + h;
          expect(hit, `room ${g[1]}: ${t[0]}`).toBe(false);
          checked++;
        }
      }
    }
    expect(checked, "at least one name was compared").toBeGreaterThan(0);
  });

  it("the CSS hides badges unless the root says far or mid, and gives them no pointer events", () => {
    expect(FLOORPLAN_CSS).toMatch(/\.room-badge\{[^}]*display:none/);
    expect(FLOORPLAN_CSS).toMatch(/\[data-detail="far"\] \.room-badge,\[data-detail="mid"\] \.room-badge\{[^}]*display:inline/);
    expect(FLOORPLAN_CSS).toMatch(/\.room-badge[^{]*\{[^}]*pointer-events:none/);
  });
});

describe("S25 fix C: a badge keeps its screen size when the view zooms", () => {
  const f = floorOf([dev("light", "light.a", 100, 100)]);
  const state = { "light.a": st("on") };
  const size = (zoom: number) => Number(/class="rb-t"[^>]* font-size="([\d.]+)"/.exec(renderFloor(f, { scale: 1, px: 1, zoom, state, detail: "far" }))![1]);
  const plate = (zoom: number) => Number(/class="rb-plate"[^>]* width="([\d.]+)"/.exec(renderFloor(f, { scale: 1, px: 1, zoom, state, detail: "far" }))![1]);
  it("text and plate shrink in plan units by exactly the zoom, as a room name does", () => {
    expect(size(2)).toBeCloseTo(size(1) / 2, 1);
    expect(plate(2)).toBeCloseTo(plate(1) / 2, 0);
    expect(size(4)).toBeCloseTo(size(1) / 4, 1);
  });
});
