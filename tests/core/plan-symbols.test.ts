import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";
import type { Door, Floor, Layout, Pt, Room, RoomKind } from "../../src/core/schema";
import { renderFloor } from "../../src/core/render";

// S23.7: plan symbols. A door is a gap in the wall, a 1 px leaf from the hinge (a) and a 90 degree swing arc to b, on the
// room side; a window is three hairlines across the wall. One draw path (finding 8): the card and the editor both call this.

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
  const hallBelow = [box("pav", "pavement", 0, 0, 400, 300, "boundary"), box("hall", "room", 0, 300, 400, 600)];

  it("a door is a leaf from the hinge a, |ab| long, square to the wall, and an arc of radius |ab| back to b", () => {
    const html = renderFloor(floor(hallAbove, [door("door", [100, 300], [190, 300])]), opts);
    const m = symOf(html)!;
    expect(m, "a door symbol").toBeTruthy();
    expect(m[1].split(" ")).toEqual(expect.arrayContaining(["door-sym", "k-door"]));
    const d = m[2];
    expect(d).toMatch(/^M[^LA]+L[^LA]+A[^LA]+$/); // one leaf, one arc
    const [mx, my, lx, ly] = nums(d.slice(0, d.indexOf("A")));
    const [rx, ry, , , , ex, ey] = nums(d.slice(d.indexOf("A") + 1));
    expect([mx, my]).toEqual([100, 300]); // the hinge is a
    expect([lx, ly]).toEqual([100, 210]); // the leaf goes into the hall (up), 90 long
    expect([rx, ry]).toEqual([90, 90]); // a quarter circle of radius |ab| ...
    expect([ex, ey]).toEqual([190, 300]); // ... that ends at b
  });

  it("the swing goes to the room side, whichever side that is, and an indoor room wins over an outdoor one", () => {
    const below = nums(symOf(renderFloor(floor(hallBelow, [door("door", [100, 300], [190, 300])]), opts))![2]);
    expect(below.slice(2, 4)).toEqual([100, 390]); // the hall is below now: the leaf goes down
    // the hinge is always a: the same door given b to a hinges at the other end
    const flipped = nums(symOf(renderFloor(floor(hallAbove, [door("door", [190, 300], [100, 300])]), opts))![2]);
    expect(flipped.slice(0, 4)).toEqual([190, 300, 190, 210]);
  });

  it("the arc's sweep flag turns it from the leaf to b, on both sides", () => {
    // leaf up (0,-1) to b along +x: clockwise on screen, sweep 1; leaf down to b along +x: counter-clockwise, sweep 0
    const up = symOf(renderFloor(floor(hallAbove, [door("door", [100, 300], [190, 300])]), opts))![2];
    const down = symOf(renderFloor(floor(hallBelow, [door("door", [100, 300], [190, 300])]), opts))![2];
    expect(up).toMatch(/A90 90 0 0 1 190 300$/);
    expect(down).toMatch(/A90 90 0 0 0 190 300$/);
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

  it("a glass door swings like a door; sealed and open doorways draw no symbol", () => {
    const html = renderFloor(floor(hallAbove, [door("glass", [100, 300], [190, 300]), door("sealed", [200, 300], [290, 300]), door("open", [300, 300], [390, 300])]), opts);
    expect(symOf(html, 0)![1]).toContain("k-glass");
    expect(symOf(html, 0)![2]).toContain("A");
    expect(symOf(html, 1)).toBeNull();
    expect(symOf(html, 2)).toBeNull();
  });

  it("doors and windows cut a gap in the wall; a sealed door does not", () => {
    const html = renderFloor(floor(hallAbove, [door("door", [100, 300], [190, 300]), door("window", [100, 0], [300, 0]), door("sealed", [200, 300], [290, 300])]), opts);
    const mask = html.match(/<mask id="fp-open-mask-[^"]*"[^>]*>(.*?)<\/mask>/)![1];
    expect(mask).toContain('x1="100" y1="300" x2="190" y2="300"');
    expect(mask).toContain('x1="100" y1="0" x2="300" y2="0"');
    expect(mask).not.toContain('x1="200" y1="300"');
  });

  it("a closed, unselected door's own line paints nothing (quiet); open, alarm and selection still show it, and the symbol turns red with the state", () => {
    const d = door("door", [100, 300], [190, 300], { sensors: ["binary_sensor.x"] });
    const closed = renderFloor(floor(hallAbove, [d]), { ...opts, state: { "binary_sensor.x": st("off") } });
    expect(closed).toMatch(/<line data-d="0" class="door door-door quiet"/);
    expect(symOf(closed)![1]).not.toContain("open");
    const open = renderFloor(floor(hallAbove, [d]), { ...opts, state: { "binary_sensor.x": st("on") } });
    expect(open).toMatch(/<line data-d="0" class="door door-door open"/);
    expect(symOf(open)![1].split(" ")).toContain("open");
    const sel = renderFloor(floor(hallAbove, [d]), { ...opts, selection: { t: "door", i: 0 } });
    expect(sel).toMatch(/<line data-d="0" class="door door-door sel"/);
  });

  it("the symbol takes no clicks: the hit line under it keeps data-d, the symbol only data-ds", () => {
    const html = renderFloor(floor(hallAbove, [door("door", [100, 300], [190, 300])]), opts);
    expect(html).toMatch(/<line data-d="0" class="door-hit"/);
    expect(html).not.toMatch(/<path data-d=/);
  });

  it("2.5D draws the same symbols on the floor", () => {
    const html = renderFloor(floor(hallAbove, [door("door", [100, 300], [190, 300]), door("window", [100, 0], [300, 0])]), { ...opts, view: "2.5d" } as never);
    expect(symOf(html, 0)![2]).toContain("A");
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
