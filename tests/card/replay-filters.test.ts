import { describe, expect, it, vi } from "vitest";
import { html, nothing, render } from "lit";
import { allows, onsets, type EventGroup, type EventTools, type Onset } from "../../src/card/replay/events";
import { parseHistory } from "../../src/card/replay/history";
import { barView, type BarModel } from "../../src/card/replay/bar";
import { newFilter, passes, type FilterState } from "../../src/card/replay/filters";
import { coverActive } from "../../src/core/cover";
import { doorStateOf } from "../../src/core/door-state";
import { doorRoomIndexes } from "../../src/core/active";
import { roomAt } from "../../src/core/render";
import { t, tn } from "../../src/core/i18n";

// R2.6 (docs/specs/replay-2.md items 14 and 15, criteria 11 and 12): which room an onset is in, the filter predicate, and what the bar draws from it.
// Row shapes as in replay-events.test.ts (recorder/models/state.py).
const tools: EventTools = { doorStateOf, coverActive, roomAt, doorRooms: doorRoomIndexes };
const idx = (rows: Record<string, unknown[]>) => parseHistory(rows, Object.keys(rows));
const sq = (x: number, name: unknown, kind = "room") => ({ id: `r${x}`, name, kind, pts: [[x, 0], [x + 100, 0], [x + 100, 100], [x, 100]] });
/** Rooms A (0..100) and B (100..200) side by side; a door on their shared wall, one on A's outer wall, one far from both. */
const rooms = [sq(0, "A"), sq(100, "B")];
const doors = [
  { id: "d1", kind: "door", a: [100, 40], b: [100, 60], sensors: ["binary_sensor.between"] },
  { id: "d2", kind: "door", a: [0, 40], b: [0, 60], sensors: ["binary_sensor.outer"] },
  { id: "d3", kind: "door", a: [500, 40], b: [500, 60], sensors: ["binary_sensor.nowhere"] },
];
const rise = (id: string, lu = 1100) => ({ [id]: [{ s: "off", a: {}, lu: 1000 }, { s: "on", lu }] });
const run = (rows: Record<string, unknown[]>, f: object) => onsets(idx(rows), f as never, tools);

describe("the room of an onset (item 15)", () => {
  it("a device stands in the room roomAt says", () => {
    const f = { rooms, doors: [], devices: [{ id: "l", type: "light", entity: "light.b", x: 150, y: 50 }] };
    expect(run(rise("light.b"), f)[0].rooms).toEqual([1]);
  });
  it("a line device is in the room of its middle", () => {
    const f = { rooms, doors: [], devices: [{ id: "l", type: "light", entity: "light.b", a: [60, 50], b: [130, 50] }] };
    expect(run(rise("light.b"), f)[0].rooms).toEqual([0]);
  });
  it("a door between two rooms belongs to both; on an outer wall, to one; far from every room, to none", () => {
    const f = { rooms, doors, openings: [], devices: [] };
    const o = run({ ...rise("binary_sensor.between"), ...rise("binary_sensor.outer", 1200), ...rise("binary_sensor.nowhere", 1300) }, f);
    expect(o.map((x) => [x.entity, x.rooms])).toEqual([
      ["binary_sensor.between", [0, 1]],
      ["binary_sensor.outer", [0]],
      ["binary_sensor.nowhere", undefined],
    ]);
  });
  it("a junk entry among the doors costs the rooms, not the onsets (the geometry cannot read it)", () => {
    const o = run(rise("binary_sensor.between"), { rooms, doors: [5, ...doors], openings: [], devices: [] });
    expect(o).toHaveLength(1);
    expect(o[0].rooms).toBeUndefined();
  });
  it("a room's motion sensor is in that room", () => {
    const f = { rooms: [sq(0, "A"), { ...sq(100, "B"), motion: ["binary_sensor.rm"] }], doors: [], devices: [] };
    expect(run(rise("binary_sensor.rm"), f)[0].rooms).toEqual([1]);
  });
  it("a device outside every room has none", () => {
    const f = { rooms, doors: [], devices: [{ id: "l", type: "light", entity: "light.x", x: 900, y: 900 }] };
    expect(run(rise("light.x"), f)[0].rooms).toBeUndefined();
  });
  it("a room named __proto__ is a room like any other; a room with no name or a junk ring is none", () => {
    const f = { rooms: [sq(0, "__proto__"), sq(100, ""), { id: "j", name: "J", kind: "room", pts: 5 }], doors: [], devices: [
      { id: "a", type: "light", entity: "light.a", x: 50, y: 50 }, { id: "b", type: "light", entity: "light.b", x: 150, y: 50 }] };
    const o = run({ ...rise("light.a"), ...rise("light.b", 1200) }, f);
    expect(o.map((x) => x.rooms)).toEqual([[0], undefined]);
  });
  it("a layout of the wrong shape gives onsets with no room, never a throw", () => {
    expect(() => run(rise("light.a"), { rooms: 5, doors: "x", devices: [{ id: "a", type: "light", entity: "light.a", x: "no", y: null }] })).not.toThrow();
  });
});

describe("allows: the filter predicate (items 14 and 15)", () => {
  const on = (group: EventGroup, rooms?: number[]): Onset => ({ entity: "e", t: 1, group, kind: "k", ...(rooms ? { rooms } : {}) });
  const none = { groups: new Set<EventGroup>(), rooms: new Set<number>() };
  it("everything on lets everything through, rooms or not", () => {
    expect(allows(none, on("lamp", [0]))).toBe(true);
    expect(allows(none, on("motion"))).toBe(true);
  });
  it("a group that is off stops its onsets and only those", () => {
    const f = { ...none, groups: new Set<EventGroup>(["lamp"]) };
    expect(allows(f, on("lamp", [0]))).toBe(false);
    expect(allows(f, on("opening", [0]))).toBe(true);
  });
  it("a room that is off stops an onset only if every room it has is off", () => {
    const f = { ...none, rooms: new Set([0]) };
    expect(allows(f, on("lamp", [0]))).toBe(false);
    expect(allows(f, on("opening", [0, 1]))).toBe(true);
    expect(allows(f, on("opening", [1]))).toBe(true);
    expect(allows({ ...none, rooms: new Set([0, 1]) }, on("opening", [0, 1]))).toBe(false);
  });
  it("an onset with no room passes the room filter only when every room is on", () => {
    expect(allows(none, on("lamp"))).toBe(true);
    expect(allows({ ...none, rooms: new Set([1]) }, on("lamp"))).toBe(false);
  });
});

describe("the bar's filter button and list", () => {
  const MIN = 60000;
  const calls: unknown[][] = [];
  /** A filter state with the given things off and the list open or not; its buttons are recorded, not run (the real ones are tested below). */
  const fl = (groups: EventGroup[] = [], rooms: number[] = [], open = false): FilterState =>
    Object.assign(newFilter(() => {}), { groups: new Set(groups), rooms: new Set(rooms), open, show: (o: boolean) => void calls.push(["menu", o]), group: (g: EventGroup) => void calls.push(["group", g]), room: (i: number) => void calls.push(["room", i]) });
  const base: BarModel = { shown: "21:14", value: 700, max: 1440, hours: 24, ready: true, failed: false, playing: false, note: false, info: false, missing: 0, message: "", onsets: [], end: 1440 * MIN, width: 1000, at: 0,
    filter: fl(), rooms: [] };
  const handlers = { key() {}, play() {}, seek() {}, info() {}, close() {}, jump() {}, jumpBy() {}, length() {} };
  const draw = (m: Partial<BarModel>) => { const host = document.createElement("div"); render(barView({ html, nothing, t, tn, close: "" }, { ...base, ...m }, handlers), host); return host; };
  const on = (tt: number, group: EventGroup, rooms?: number[], entity = `e.${tt}`): Onset => ({ entity, t: tt, group, kind: group === "lamp" ? "light" : "k", ...(rooms ? { rooms } : {}) });
  const list = [on(100, "lamp", [0]), on(200, "motion", [1]), on(300, "opening", [0, 1]), on(400, "alarm", [1])];
  const names = ["A", "B"];
  const rm = (...n: unknown[]) => n.map((name) => ({ name }));

  it("the button names itself and says whether the list is open; the list is not drawn until then", () => {
    const h = draw({ onsets: list, rooms: rm(...names) });
    const b = h.querySelector<HTMLButtonElement>(".fp-rp-filter")!;
    expect(b.getAttribute("aria-label")).toBe("Filter events");
    expect(b.getAttribute("aria-expanded")).toBe("false");
    expect(h.querySelector(".fp-rp-menu")).toBeNull();
    b.click();
    expect(calls.at(-1)).toEqual(["menu", true]);
  });
  it("open: four group toggles and a toggle per room with an onset, each with aria-pressed, in layout order", () => {
    const h = draw({ onsets: [list[0], list[1]], rooms: rm("A", "B", "C"), filter: fl([], [], true) });
    const g = [...h.querySelectorAll<HTMLButtonElement>(".fp-rp-menu [data-g]")];
    expect(g.map((e) => [e.dataset.g, e.getAttribute("aria-pressed")])).toEqual([["lamp", "true"], ["motion", "true"], ["opening", "true"], ["alarm", "true"]]);
    const r = [...h.querySelectorAll<HTMLButtonElement>(".fp-rp-menu [data-r]")];
    expect(r.map((e) => [e.dataset.r, e.textContent!.trim()])).toEqual([["0", "A"], ["1", "B"]]); // C has no onset: not listed
    r[1].click(); g[2].click();
    expect(calls.slice(-2)).toEqual([["room", 1], ["group", "opening"]]);
  });
  it("the strip follows a toggle made on the same state object (the card changes one state in place and redraws)", () => {
    // Apart by hours so no two ticks merge; motion is the band, not a tick.
    const spaced = [on(100 * MIN, "lamp", [0]), on(400 * MIN, "motion", [1]), on(700 * MIN, "opening", [0, 1]), on(1000 * MIN, "alarm", [1])];
    const f = newFilter(() => {});
    const model = { onsets: spaced, rooms: rm(...names), filter: f };
    const count = () => draw(model).querySelectorAll(".fp-rp-tick").length;
    expect(count()).toBe(3);
    f.group("lamp");
    expect(count()).toBe(2);
    f.room(1); // the alarm stands in room 1 only and goes; the door joins rooms 0 and 1 and stays
    expect(count()).toBe(1);
  });
  it("a toggle that is off says so", () => {
    const h = draw({ onsets: list, rooms: rm(...names), filter: fl(["alarm"], [1], true) });
    expect(h.querySelector(".fp-rp-menu [data-g=alarm]")!.getAttribute("aria-pressed")).toBe("false");
    expect(h.querySelector(".fp-rp-menu [data-r='1']")!.getAttribute("aria-pressed")).toBe("false");
    expect(h.querySelector(".fp-rp-menu [data-r='0']")!.getAttribute("aria-pressed")).toBe("true");
    expect(h.querySelector(".fp-rp-filter")!.classList.contains("fp-rp-filtered")).toBe(true);
    expect(draw({ onsets: list, rooms: rm(...names) }).querySelector(".fp-rp-filter")!.classList.contains("fp-rp-filtered")).toBe(false);
  });
  it("a room named \"><script> is text in the list and in its tooltip (criterion 12)", () => {
    const evil = "\"><script>window.__x=1</script>";
    const h = draw({ onsets: list, rooms: rm(evil, "B"), filter: fl([], [], true) });
    expect(h.querySelector("script")).toBeNull();
    const r = h.querySelector<HTMLElement>(".fp-rp-menu [data-r='0']")!;
    expect(r.textContent!.trim()).toBe(evil);
    expect(r.getAttribute("title")).toBe(evil);
  });
  it("a name that is not a string is not listed", () => {
    const h = draw({ onsets: list, rooms: rm(5, "B"), filter: fl([], [], true) });
    expect([...h.querySelectorAll<HTMLElement>(".fp-rp-menu [data-r]")].map((e) => e.dataset.r)).toEqual(["1"]);
  });
  it("the strip counts only what the filters allow (ticks, totals and the name)", () => {
    const all = draw({ onsets: list, rooms: rm(...names) });
    expect(all.querySelectorAll(".fp-rp-tick").length).toBeGreaterThan(0);
    expect(all.querySelector(".fp-rp-strip")!.getAttribute("aria-label")).toBe("1 lamp, 1 door or window, 1 alarm, motion in 1 room");
    const f = draw({ onsets: list, rooms: rm(...names), filter: fl(["lamp", "motion"]) });
    expect(f.querySelector(".fp-rp-strip")!.getAttribute("aria-label")).toBe("1 door or window, 1 alarm");
    const r = draw({ onsets: list, rooms: rm(...names), filter: fl([], [1]) });
    // room B off: the alarm (B only) and the motion (B only) go; the lamp (A) and the door (A and B) stay
    expect(r.querySelector(".fp-rp-strip")!.getAttribute("aria-label")).toBe("1 lamp, 1 door or window");
  });
  it("motion in two rooms is said in rooms", () => {
    const two = [on(1, "motion", [0], "m.a"), on(2, "motion", [1], "m.b"), on(3, "motion", [1], "m.c")];
    expect(draw({ onsets: two, rooms: rm(...names) }).querySelector(".fp-rp-strip")!.getAttribute("aria-label")).toBe("motion in 2 rooms");
  });
  it("motion with no room known is said plainly", () => {
    expect(draw({ onsets: [on(1, "motion")], rooms: rm(...names) }).querySelector(".fp-rp-strip")!.getAttribute("aria-label")).toBe("motion");
  });
  it("the motion band follows the filters", () => {
    const m = [on(100, "motion", [0])];
    const lit = (h: HTMLElement) => [...h.querySelectorAll<HTMLElement>(".fp-rp-band i")].filter((i) => i.style.opacity !== "0").length;
    expect(lit(draw({ onsets: m, rooms: rm(...names), end: 1000 }))).toBe(1);
    expect(lit(draw({ onsets: m, rooms: rm(...names), end: 1000, filter: fl(["motion"]) }))).toBe(0);
    expect(lit(draw({ onsets: m, rooms: rm(...names), end: 1000, filter: fl([], [0]) }))).toBe(0);
  });
  it("the jump buttons follow the filters: disabled when nothing allowed lies that way", () => {
    const prev = (h: HTMLElement) => h.querySelector<HTMLButtonElement>(".fp-rp-prev")!, next = (h: HTMLElement) => h.querySelector<HTMLButtonElement>(".fp-rp-next")!;
    const h = draw({ onsets: list, rooms: rm(...names), at: 150, filter: fl(["lamp"]) });
    expect([prev(h).disabled, next(h).disabled]).toEqual([true, false]); // the lamp at 100 is filtered out
    expect([prev(draw({ onsets: list, rooms: rm(...names), at: 150 })).disabled]).toEqual([false]);
  });
});

describe("the filter state's buttons (what the card holds per floor history)", () => {
  const make = () => { const repaint = vi.fn(); return { f: newFilter(repaint), repaint }; };
  const body = (cls: string) => { const e = document.createElement("div"); e.className = cls; document.body.append(e); return e; };
  it("starts with everything on and the list closed", () => {
    const { f } = make();
    expect([f.groups.size, f.rooms.size, f.open]).toEqual([0, 0, false]);
  });
  it("a group or room toggles on and off, with a new set each time, and repaints", () => {
    const { f, repaint } = make();
    const g0 = f.groups;
    f.group("lamp");
    expect([...f.groups]).toEqual(["lamp"]);
    expect(f.groups).not.toBe(g0);
    f.group("lamp");
    expect(f.groups.size).toBe(0);
    f.room(2); f.room(0);
    expect([...f.rooms]).toEqual([2, 0]);
    f.room(2);
    expect([...f.rooms]).toEqual([0]);
    expect(repaint).toHaveBeenCalledTimes(5);
  });
  it("a click outside closes an open list; a click on the list or the button does not", () => {
    const { f } = make();
    const menu = body("fp-rp-menu"), btn = body("fp-rp-filter"), page = body("somewhere");
    f.show(true);
    expect(f.open).toBe(true);
    menu.click(); btn.click();
    expect(f.open).toBe(true);
    page.click();
    expect(f.open).toBe(false);
    page.click(); // the listener is gone: nothing happens, nothing throws
    document.body.replaceChildren();
  });
  it("closing removes the listener; Escape (back) gives focus to the button that was clicked", () => {
    const { f, repaint } = make();
    const btn = body("fp-rp-filter"), p = body("somewhere");
    btn.tabIndex = 0;
    f.button = btn;
    f.show(true);
    f.show(false, true);
    expect(document.activeElement).toBe(btn);
    repaint.mockClear();
    p.click();
    expect(repaint).not.toHaveBeenCalled();
    f.show(true);
    f.show(false); // closed without Escape: focus is not moved
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).not.toBe(btn);
    document.body.replaceChildren();
  });
  it("passes: everything without a state; the predicate of the filters with one", () => {
    expect(passes(undefined)({ entity: "e", t: 1, group: "lamp", kind: "light" })).toBe(true);
    const { f } = make();
    f.group("lamp");
    expect(passes(f)({ entity: "e", t: 1, group: "lamp", kind: "light" })).toBe(false);
    expect(passes(f)({ entity: "e", t: 1, group: "motion", kind: "room" })).toBe(true);
  });
});
