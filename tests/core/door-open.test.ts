import { describe, it, expect } from "vitest";
import { FLOORPLAN_CSS, THEMES, renderFloor, type StateOverlay } from "../../src/core/render";
import { OPENING_FILL } from "../../src/core/solids";
import { DOOR_KINDS, type Floor } from "../../src/core/schema";

// Diego, 0.12.23: "doors and windows need to be red when open" (and, a day later, "internal doors paint them").
// The open state was red in 2D, but the 2.5D wall face had a hole or a blue band and never changed.

const st = (state: string) => ({ state, attributes: {}, last_changed: "2026-10-04T10:00:00Z" });
const floor = (o: Partial<Floor> = {}): Floor => ({
  title: "T", outline: [[0, 0], [400, 0], [400, 300], [0, 300]], owk: ["external", "none", "none", "none"], rooms: [],
  walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [], ...o,
});
const withDoor = (d: Record<string, unknown>) => floor({ doors: [{ id: "d", name: "D", kind: "door", a: [100, 0], b: [200, 0], sensors: ["binary_sensor.d"], ...d }] as never });
const draw = (f: Floor, state: StateOverlay | undefined, view: "2d" | "2.5d") => renderFloor(f, { scale: 1, view, state });
const cls = (html: string, re: RegExp) => [...html.matchAll(re)].map((m) => m[1]);
/** The class of every 2.5D piece that fills an opening: the glass band, the sealed panel, the door leaf, the open frame. */
const infill = (html: string) => cls(html, /<polygon class="((?:glass|door-leaf|opn|ws sealed)[^"]*)"/g);
const line2d = (html: string) => cls(html, /<line data-d="0" class="(door [^"]*)"/g)[0] ?? ""; // a doorway (open) draws no line while closed

describe("every door kind: open is red in 2D and in 2.5D, closed and unavailable are not (finding 17)", () => {
  for (const kind of DOOR_KINDS) {
    it(`${kind}`, () => {
      const f = withDoor({ kind });
      for (const [label, s, red] of [["on", st("on"), true], ["off", st("off"), false], ["unavailable", st("unavailable"), false], ["no state", undefined, false]] as const) {
        const state = s ? { "binary_sensor.d": s } : undefined;
        expect(line2d(draw(f, state, "2d")).split(" ").includes("open"), `2D ${label}`).toBe(red);
        const parts = infill(draw(f, state, "2.5d"));
        expect(parts.some((c) => c.split(" ").includes("open")), `2.5D ${label}: ${parts.join(" | ")}`).toBe(red);
      }
    });
  }
  it("a smart lock left unlocked reads open too, as in 2D", () => {
    const f = withDoor({ kind: "window", sensors: [], locks: ["lock.d"] });
    expect(infill(draw(f, { "lock.d": st("unlocked") }, "2.5d")).some((c) => c.includes("open"))).toBe(true);
    expect(infill(draw(f, { "lock.d": st("locked") }, "2.5d")).some((c) => c.includes("open"))).toBe(false);
  });
  it("a vibrating door is the same red in 2.5D, as the alarm class", () => {
    const f = withDoor({ kind: "door", sensors: [], vibration: ["binary_sensor.v"] });
    expect(infill(draw(f, { "binary_sensor.v": st("on") }, "2.5d")).some((c) => c.includes("alarm"))).toBe(true);
  });
  it("an open garage-style cover on a plain door keeps its orange, as in 2D, in 2.5D too; a curtain cover on a window never colours it", () => {
    const door = withDoor({ kind: "door", sensors: [], cover: "cover.g" });
    expect(infill(draw(door, { "cover.g": st("open") }, "2.5d")).some((c) => c.includes("cover-open"))).toBe(true);
    const win = withDoor({ kind: "window", sensors: [], cover: "cover.g" });
    expect(infill(draw(win, { "cover.g": st("open") }, "2.5d")).join(" ")).not.toMatch(/open/);
  });
});

describe("2.5D: a closed door is painted, an open one is a red frame", () => {
  it("OPENING_FILL decides every kind: a gap kind gets a leaf when closed", () => {
    for (const kind of DOOR_KINDS) {
      const parts = infill(draw(withDoor({ kind }), { "binary_sensor.d": st("off") }, "2.5d"));
      const fill = OPENING_FILL[kind];
      expect(parts.some((c) => c.startsWith("door-leaf")), kind).toBe(fill === "gap");
      expect(parts.some((c) => c.startsWith("opn")), `${kind} closed has no open frame`).toBe(false);
    }
  });
  it("a door that opens loses its leaf and gains the open frame", () => {
    const parts = infill(draw(withDoor({}), { "binary_sensor.d": st("on") }, "2.5d"));
    expect(parts.some((c) => c.startsWith("door-leaf"))).toBe(false);
    expect(parts.some((c) => c.startsWith("opn") && c.includes("open"))).toBe(true);
  });
  it("a plain opening (no door) stays a gap: no leaf, no frame", () => {
    const f = floor({ openings: [{ id: "o", a: [100, 0], b: [200, 0] }] as never });
    expect(infill(draw(f, undefined, "2.5d"))).toEqual([]);
  });
  it("a door in an internal wall between two rooms is painted as well", () => {
    const f = floor({
      outline: [[0, 0], [400, 0], [400, 300], [0, 300]], owk: ["external", "external", "external", "external"],
      rooms: [{ id: "a", name: "A", area: "", kind: "room", pts: [[0, 0], [200, 0], [200, 300], [0, 300]], wk: ["none", "wall", "none", "none"] }, { id: "b", name: "B", area: "", kind: "room", pts: [[200, 0], [400, 0], [400, 300], [200, 300]], wk: ["none", "none", "none", "wall"] }] as never,
      doors: [{ id: "d", name: "D", kind: "door", a: [200, 100], b: [200, 190], sensors: ["binary_sensor.d"] }] as never,
    });
    expect(infill(draw(f, { "binary_sensor.d": st("off") }, "2.5d")).some((c) => c.startsWith("door-leaf"))).toBe(true);
    expect(infill(draw(f, { "binary_sensor.d": st("on") }, "2.5d")).some((c) => c.startsWith("opn open"))).toBe(true);
  });
  it("2D output is unchanged by all of this: no leaf, no frame", () => {
    for (const s of ["on", "off"]) expect(draw(withDoor({}), { "binary_sensor.d": st(s) }, "2d")).not.toMatch(/door-leaf|class="opn/);
  });
});

describe("S25.D1: in 2.5D a door and a glass door fill their gap only while their sensor says closed", () => {
  const kinds = ["door", "glass"] as const;
  for (const kind of kinds) {
    it(`${kind}: no sensor, no state, off-but-unattached, unavailable, unknown = a hole; off = filled; on = the red infill`, () => {
      const filled = (f: Floor, s?: StateOverlay) => infill(draw(f, s, "2.5d")).filter((c) => !c.includes("open")).length > 0;
      expect(filled(withDoor({ kind, sensors: [] }), { "binary_sensor.d": st("off") }), "no sensor").toBe(false);
      expect(filled(withDoor({ kind }), undefined), "no state at all").toBe(false);
      expect(filled(withDoor({ kind }), {}), "state without the entity").toBe(false);
      for (const v of ["unavailable", "unknown"]) expect(filled(withDoor({ kind }), { "binary_sensor.d": st(v) }), v).toBe(false);
      expect(filled(withDoor({ kind }), { "binary_sensor.d": st("off") }), "off").toBe(true);
      expect(infill(draw(withDoor({ kind }), { "binary_sensor.d": st("off") }, "2.5d"))[0]).toMatch(kind === "door" ? /^door-leaf/ : /^glass g-glass/);
      expect(infill(draw(withDoor({ kind }), { "binary_sensor.d": st("on") }, "2.5d")).some((c) => c.includes("open")), "on").toBe(true);
    });
  }
  it("every kind is decided: only door and glass wait for a sensor (finding 17)", () => {
    const wait = new Set<string>(kinds);
    for (const kind of DOOR_KINDS) {
      const bare = infill(draw(withDoor({ kind, sensors: [] }), undefined, "2.5d"));
      expect(bare.length > 0, `${kind} with no sensor`).toBe(!wait.has(kind) && kind !== "open");
    }
  });
});

describe("the stylesheet gives every one of those classes a rule that reads a --fp token", () => {
  it("the open pieces are red through --fp-open-door, the leaf through --fp-door", () => {
    expect(FLOORPLAN_CSS).toMatch(/\.glass\.open[^{]*\{[^}]*var\(--fp-open-door\)/);
    expect(FLOORPLAN_CSS).toMatch(/\.opn\{[^}]*var\(--fp-open-door\)/);
    expect(FLOORPLAN_CSS).toMatch(/\.door-leaf\{[^}]*var\(--fp-door\)/);
    expect(FLOORPLAN_CSS).toMatch(/\.ws\.sealed\.open[^{]*\{[^}]*var\(--fp-open-door\)/);
    expect(THEMES.length).toBe(13);
  });
});
