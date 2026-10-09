import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import type { Door, Floor, Layout, Pt, Room, RoomKind } from "../../src/core/schema";
import { renderFloor } from "../../src/core/render";

// S23.7: plan symbols. A window is three hairlines across the wall. S23.F6: no swing arc (Diego, 2026-10-08). S25.D1: no leaf
// either (Diego, 2026-10-09): an open door is a hole, a closed one a thin line across the gap. One draw path (finding 8): the card and the editor both call this.

const ground = (demo as unknown as Layout).floors.ground;
const box = (id: string, kind: RoomKind, x0: number, y0: number, x1: number, y1: number, wk = "wall"): Room =>
  ({ id, name: id, area: "", kind, pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], wk: Array(4).fill(wk) } as Room);
const door = (kind: Door["kind"], a: Pt, b: Pt, extra: Partial<Door> = {}): Door => ({ id: `d-${kind}`, name: kind, kind, a, b, ...extra });
// the house outline is kept far away, so the only walls near a door are the rooms' own (internal, 10 cm)
const floor = (rooms: Room[], doors: Door[]): Floor => ({ ...structuredClone(ground), outline: [[-1000, -1000], [3000, -1000], [3000, 2000], [-1000, 2000]], owk: Array(4).fill("external"), rooms, doors, openings: [], walls: [], devices: [], furniture: [], extras: [], stairs: [] } as Floor);
const opts = { scale: 0.5 };
const st = (state: string) => ({ state, attributes: {}, last_changed: "2026-10-08T10:00:00Z" });

const symOf = (html: string, i = 0) => html.match(new RegExp(`<path data-ds="${i}" class="([^"]*)" d="([^"]*)"`));
const nums = (s: string) => (s.match(/-?[\d.]+/g) ?? []).map(Number);

describe("S23.7 plan symbols", () => {
  // A hall above y = 300 and a pavement below it, the door in the wall between them, 90 cm wide.
  const hallAbove = [box("hall", "room", 0, 0, 400, 300), box("pav", "pavement", 0, 300, 400, 400, "boundary")];

  it("a door and a glass door draw no leaf and no symbol at all (S25.D1)", () => {
    for (const view of ["2d", "2.5d"] as const) {
      const html = renderFloor(floor(hallAbove, [door("door", [100, 300], [190, 300]), door("glass", [200, 300], [290, 300])]), { ...opts, view } as never);
      expect(symOf(html, 0), `${view}: door`).toBeNull();
      expect(symOf(html, 1), `${view}: glass door`).toBeNull();
      expect(html, view).not.toMatch(/data-ds=/);
    }
  });

  it("no door kind draws an arc, in 2D or 2.5D, and the wall still has its gap (S23.F6)", () => {
    const kinds: Door["kind"][] = ["door", "glass", "window", "slit", "sealed", "open"];
    const doors = kinds.map((k, i) => door(k, [i * 60, 300], [i * 60 + 50, 300]));
    for (const view of ["2d", "2.5d"] as const) {
      const html = renderFloor(floor(hallAbove, doors), { ...opts, view } as never);
      for (const [, , d] of html.matchAll(/<path data-ds="(\d+)" class="[^"]*" d="([^"]*)"/g)) expect(d, `${view}: ${d}`).not.toMatch(/[Aa]/);
      expect(html, view).not.toMatch(/<(circle|ellipse)[^>]*data-ds=/);
    }
    const mask = renderFloor(floor(hallAbove, doors), opts).match(/<mask id="fp-open-mask-[^"]*"[^>]*>(.*?)<\/mask>/)![1];
    expect(mask).toContain('x1="0" y1="300" x2="50" y2="300"'); // the door's gap
    expect(mask).toContain('x1="60" y1="300" x2="110" y2="300"'); // the glass door's gap
  });

  // S25.D1 (Diego, 2026-10-09): "open doors are just holes and closed doors are closed. doors with no sensor are left open".
  const lineOf = (html: string, i = 0) => html.match(new RegExp(`<line data-d="${i}" class="(door [^"]*)"[^>]*stroke-width="([^"]*)"`));
  it.each(["door", "glass"] as const)("a %s is a hole until its sensor says closed: no sensor, off = a thin line across the gap, anything else = a hole", (kind) => {
    const sensed = door(kind, [100, 300], [190, 300], { sensors: ["binary_sensor.x"] });
    const cls = (d: Door, state?: Record<string, ReturnType<typeof st>>) => lineOf(renderFloor(floor(hallAbove, [d]), { ...opts, state } as never))![1].split(" ");
    expect(cls(door(kind, [100, 300], [190, 300])), "no sensor").toContain("quiet");
    expect(cls(door(kind, [100, 300], [190, 300]), { "binary_sensor.x": st("off") }), "a state for an entity that is not attached").toContain("quiet");
    expect(cls(sensed, { "binary_sensor.x": st("off") }), "sensor off").not.toContain("quiet");
    for (const s of ["unavailable", "unknown", "", "garbage"]) expect(cls(sensed, { "binary_sensor.x": st(s) }), `sensor ${s || "empty"}`).toContain("quiet");
    expect(cls(sensed, {}), "no state yet").toContain("quiet");
    expect(cls(sensed), "no state overlay").toContain("quiet");
  });

  // Diego, 2026-10-09: "a closed door is a thick line". The closed line is CLOSED_DOOR_BAND (1.6) times the wall it sits on,
  // so it reads as a closed door and not as a hairline; an open or sensorless door stays quiet and keeps the wall width.
  it.each(["door", "glass"] as const)("a closed %s is a thick line: 1.6 times the wall width inside (16 cm), the wall itself outside (20 cm); a hole keeps the wall width and stays quiet", (kind) => {
    const sensed = door(kind, [100, 300], [190, 300], { sensors: ["binary_sensor.x"] });
    const off = { "binary_sensor.x": st("off") }, on = { "binary_sensor.x": st("on") };
    const w = (f: Floor, state?: Record<string, ReturnType<typeof st>>, view: "2d" | "2.5d" = "2d") => renderFloor(f, { ...opts, state, view } as never).match(/<line data-d="0" class="(door [^"]*)"[^>]*stroke-width="([^"]*)"/)!;
    expect(w(floor(hallAbove, [sensed]), off)[2], "inside wall").toBe("16");
    const outer = floor([box("hall", "room", 0, 0, 400, 300, "external"), box("pav", "pavement", 0, 300, 400, 400, "boundary")], [sensed]);
    expect(w(outer, off)[2], "external wall: as thick as the wall, no more").toBe("20");
    const none = w(floor(hallAbove, [door(kind, [100, 300], [190, 300])]));
    expect(none[1]).toContain("quiet");
    expect(none[2], "no sensor: wall width").toBe("10");
    expect(w(floor(hallAbove, [sensed]), on)[2], "open (alert): wall width").toBe("10");
    expect(w(floor(hallAbove, [sensed]), off, "2.5d")[2], "2.5D threshold unchanged").toBe("4");
  });

  it("several sensors: the door is closed only when every one says off; one open makes it open", () => {
    const d = door("door", [100, 300], [190, 300], { sensors: ["binary_sensor.a", "binary_sensor.b"] });
    const cls = (a: string, b: string) => lineOf(renderFloor(floor(hallAbove, [d]), { ...opts, state: { "binary_sensor.a": st(a), "binary_sensor.b": st(b) } } as never))![1].split(" ");
    expect(cls("off", "off")).not.toContain("quiet");
    expect(cls("off", "unavailable")).toContain("quiet");
    expect(cls("off", "on")).toContain("open");
  });

  it("a door whose lock is unlocked is not closed, even with its sensor off", () => {
    const d = door("door", [100, 300], [190, 300], { sensors: ["binary_sensor.a"], locks: ["lock.l"] });
    const cls = lineOf(renderFloor(floor(hallAbove, [d]), { ...opts, state: { "binary_sensor.a": st("off"), "lock.l": st("unlocked") } } as never))![1].split(" ");
    expect(cls).toContain("open");
  });

  it("the closed line is in --fp-door for a door and --fp-glass for a glass door (classes), in 2D and 2.5D", () => {
    for (const view of ["2d", "2.5d"] as const) {
      const html = renderFloor(floor(hallAbove, [door("door", [100, 300], [190, 300], { sensors: ["binary_sensor.x"] }), door("glass", [200, 300], [290, 300], { sensors: ["binary_sensor.x"] })]), { ...opts, view, state: { "binary_sensor.x": st("off") } } as never);
      expect(lineOf(html, 0)![1], view).toBe("door door-door");
      expect(lineOf(html, 1)![1], view).toBe("door door-glass");
    }
  });

  it("a window, a slit, a sealed door and an open doorway keep their look whatever a sensor says", () => {
    const html = renderFloor(floor(hallAbove, [door("window", [100, 0], [300, 0]), door("sealed", [200, 300], [290, 300]), door("open", [300, 300], [390, 300])]), { ...opts, state: {} } as never);
    expect(symOf(html, 0)![2].match(/M/g)).toHaveLength(3);
    expect(symOf(html, 1)).toBeNull();
    expect(lineOf(html, 0)![1]).toContain("quiet");
    expect(lineOf(html, 1)![1]).not.toContain("quiet"); // sealed keeps its dashed line
  });

  it("a window is three hairlines along the opening, at the wall's two faces and its middle", () => {
    const html = renderFloor(floor(hallAbove, [door("window", [100, 0], [300, 0])]), opts);
    const m = symOf(html)!;
    expect(m[1].split(" ")).toEqual(expect.arrayContaining(["door-sym", "k-window"]));
    const segs = m[2].match(/M[^M]+/g)!;
    expect(segs).toHaveLength(3);
    const ys = segs.map((s) => { const [x1, y1, x2, y2] = nums(s); expect([x1, x2]).toEqual([100, 300]); expect(y1).toBe(y2); return y1; }).sort((p, q) => p - q);
    // the wall at y = 0 is the hall's own edge, an internal wall of 10 cm: faces at -5 and +5
    expect(ys).toEqual([-5, 0, 5]);
    expect(m[2]).not.toContain("A");
  });

  it("a slit's three hairlines span its narrower band", () => {
    const segs = symOf(renderFloor(floor(hallAbove, [door("slit", [100, 0], [300, 0])]), opts))![2].match(/M[^M]+/g)!;
    expect(segs.map((s) => nums(s)[1]).sort((p, q) => p - q)).toEqual([-2, 0, 2]); // 10 cm * SLIT_BAND .4
  });

  // S1 (Opus review of S23): the wall is cut wider than the room polygon, so the outer half of a window's gap showed the
  // board and the window read as a hole. A pane fills the whole cut, under the hairlines, with a jamb at each end.
  const paneOf = (html: string, i = 0) => html.match(new RegExp(`<path data-dp="${i}" class="([^"]*)" d="([^"]*)"/>`));
  const jambOf = (html: string, i = 0) => html.match(new RegExp(`<path data-dj="${i}" class="([^"]*)" d="([^"]*)"/>`));

  it("a window fills the whole cut with a pane, under its hairlines, with a jamb across each end", () => {
    const html = renderFloor(floor(hallAbove, [door("window", [100, 0], [300, 0])]), opts);
    const p = paneOf(html)!, j = jambOf(html)!;
    expect(p, "a pane").toBeTruthy();
    expect(p[1].split(" ")).toEqual(expect.arrayContaining(["win-pane", "k-window"]));
    // the cut is the 10 cm wall + OPENING_EXTRA (4): 14 cm, so the pane spans y -7..7 and x 100..300
    const xy = nums(p[2]);
    expect(xy).toHaveLength(8);
    const xs = xy.filter((_, k) => k % 2 === 0), ys = xy.filter((_, k) => k % 2 === 1);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([100, 300]);
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([-7, 7]);
    expect(p[2]).toMatch(/Z$/);
    // the pane is drawn first, so the hairlines and jambs sit on it
    expect(html.indexOf('data-dp="0"')).toBeLessThan(html.indexOf('data-ds="0"'));
    expect(html.indexOf('data-dp="0"')).toBeLessThan(html.indexOf('data-dj="0"'));
    expect(j[1].split(" ")).toEqual(expect.arrayContaining(["win-jamb", "k-window"]));
    const segs = j[2].match(/M[^M]+/g)!;
    expect(segs).toHaveLength(2);
    expect(segs.map((s) => nums(s))).toEqual([[100, -7, 100, 7], [300, -7, 300, 7]]);
  });

  it("a slit gets a pane over the whole cut too (the cut does not narrow); doors, sealed and open doorways get none", () => {
    const html = renderFloor(floor(hallAbove, [door("slit", [100, 0], [300, 0]), door("door", [100, 300], [190, 300]), door("glass", [200, 300], [290, 300]), door("sealed", [300, 300], [390, 300]), door("open", [0, 300], [90, 300])]), opts);
    const ys = nums(paneOf(html, 0)![2]).filter((_, k) => k % 2 === 1);
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([-7, 7]);
    for (const i of [1, 2, 3, 4]) { expect(paneOf(html, i), `door ${i}`).toBeNull(); expect(jambOf(html, i)).toBeNull(); }
  });

  it("2.5D draws no pane: the raised wall carries the glass on its face and hides the floor-level cut", () => {
    const html = renderFloor(floor(hallAbove, [door("window", [100, 0], [300, 0])]), { ...opts, view: "2.5d" } as never);
    expect(symOf(html), "the hairlines stay").toBeTruthy();
    expect(paneOf(html)).toBeNull();
    expect(jambOf(html)).toBeNull();
  });

  it("an open or alarmed window's pane carries the state, so it can turn red with the hairlines", () => {
    const d = door("window", [100, 0], [300, 0], { sensors: ["binary_sensor.w"] });
    const open = renderFloor(floor(hallAbove, [d]), { ...opts, state: { "binary_sensor.w": st("on") } });
    expect(paneOf(open)![1].split(" ")).toContain("open");
  });

  it("doors and windows cut a gap in the wall; a sealed door does not", () => {
    const html = renderFloor(floor(hallAbove, [door("door", [100, 300], [190, 300]), door("window", [100, 0], [300, 0]), door("sealed", [200, 300], [290, 300])]), opts);
    const mask = html.match(/<mask id="fp-open-mask-[^"]*"[^>]*>(.*?)<\/mask>/)![1];
    expect(mask).toContain('x1="100" y1="300" x2="190" y2="300"');
    expect(mask).toContain('x1="100" y1="0" x2="300" y2="0"');
    expect(mask).not.toContain('x1="200" y1="300"');
  });

  it("an open (alarm) door still shows its red line and band; a selected door shows its selection line with no state", () => {
    const d = door("door", [100, 300], [190, 300], { sensors: ["binary_sensor.x"] });
    const open = renderFloor(floor(hallAbove, [d]), { ...opts, state: { "binary_sensor.x": st("on") } });
    expect(open).toMatch(/<line data-d="0" class="door door-door open"/);
    expect(open).toContain('class="door-alert"');
    const sel = renderFloor(floor(hallAbove, [d]), { ...opts, selection: { t: "door", i: 0 } });
    expect(sel).toMatch(/<line data-d="0" class="door door-door sel"/);
  });

  it("the symbol takes no clicks: the hit line under it keeps data-d, the symbol only data-ds", () => {
    const html = renderFloor(floor(hallAbove, [door("window", [100, 0], [300, 0])]), opts);
    expect(html).toMatch(/<line data-d="0" class="door-hit"/);
    expect(html).not.toMatch(/<path data-d=/);
  });

  it("2.5D draws the same window symbol on the floor", () => {
    const html = renderFloor(floor(hallAbove, [door("door", [100, 300], [190, 300]), door("window", [100, 0], [300, 0])]), { ...opts, view: "2.5d" } as never);
    expect(symOf(html, 0)).toBeNull();
    expect(symOf(html, 1)![2].match(/M/g)).toHaveLength(3);
  });

  it("outdoor kinds draw no boundary outline; the editor keeps a faint guide; a zone still draws its dash", () => {
    const rooms = [box("hall", "room", 0, 0, 400, 300), ...(["garden", "terrace", "pavement", "water"] as RoomKind[]).map((k, i) => box(k, k, 500 + i * 200, 0, 650 + i * 200, 150, "boundary")), box("rug", "zone", 50, 50, 150, 150, "boundary")];
    const html = renderFloor(floor(rooms, []), opts);
    for (let i = 1; i <= 4; i++) expect(html, rooms[i].kind).not.toMatch(new RegExp(`class="e[^"]*" data-e="r${i}:`));
    expect(html).toMatch(/class="e nw zn" data-e="r5:0"/);
    const ed = renderFloor(floor(rooms, []), { ...opts, editor: true } as never);
    for (let i = 1; i <= 4; i++) expect(ed, rooms[i].kind).toMatch(new RegExp(`class="e none" data-e="r${i}:0"`));
    // a real wall on an outdoor room (a garden fence, say) still draws
    const fenced = renderFloor(floor([box("garden", "garden", 0, 0, 100, 100, "fence")], []), opts);
    expect(fenced).toMatch(/class="e fence" data-e="r0:0"/);
  });

  it("escapes a hostile door kind in the symbol's class (finding 2)", () => {
    const html = renderFloor(floor(hallAbove, [door('"><script>' as never, [100, 300], [190, 300])]), opts);
    expect(html).not.toContain("<script>");
  });
});
