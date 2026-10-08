import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { Floor, Layout, Pt } from "../../src/core/schema";
import { inside, migrate, renderFloor, validate } from "../../src/core";

// S23.3 (V3, V6): a room's name stays in its room. The review found the 2.5D Hall name in the Cloakroom and names
// under device discs: the old search tried only rows above and below and took a free spot in the next room before a
// covered one in its own. Boxes are the renderer's own model (len x 0.6 x size wide, size tall, baseline at 0.75),
// which is wider than system-ui really draws, so a pass here is a pass on screen.

const demo = migrate(JSON.parse(readFileSync("demo/layout.json", "utf8"))) as Layout;
// tests/fixtures/stress-layout.json: the stress generator's house (scratch make-stress.mjs, seeded, no network):
// three storeys, 46 rooms, 437 devices. Synthetic names only.
const stress = migrate(JSON.parse(readFileSync("tests/fixtures/stress-layout.json", "utf8"))) as Layout;

type Box = [number, number, number, number];
const meet = (a: Box, b: Box) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
const area = (p: Pt[]) => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0)) / 2;
const attr = (tag: string, a: string) => tag.match(new RegExp(` ${a}="([^"]*)"`))?.[1];

/** Every room name drawn: its room, its box, and whether it is drawn as a tag on top of the icons. */
const names = (html: string) => [...html.matchAll(/<text class="lbl[^"]*"[^>]*data-rl="(\d+)"[^>]*>([^<]*)<\/text>/g)].map((m) => {
  const x = Number(attr(m[0], "x")), y = Number(attr(m[0], "y")), size = Number(attr(m[0], "font-size")), w = m[2].length * 0.6 * size;
  return { i: Number(m[1]), name: m[2], zone: /class="lbl zone/.test(m[0]), tag: /\blbl-on\b/.test(m[0]), box: [x - w / 2, y - 0.75 * size, w, size] as Box };
});
/** Every device disc drawn: a 32-unit circle in the 24-unit icon, at the group's own translate and scale. */
const discs = (html: string) => [...html.matchAll(/<g data-x="\d+"[^>]* transform="translate\(([-\d.]+) ([-\d.]+)\) scale\(([\d.]+)\)/g)].map((m) => {
  const x = Number(m[1]), y = Number(m[2]), k = Number(m[3]);
  return [x + 12 * k - 16 * k, y + 12 * k - 16 * k, 32 * k, 32 * k] as Box;
});
/** The room a point is in: the smallest named room or outdoor area holding it (zones and fills are not rooms). */
const owner = (f: Floor, p: Pt) => {
  let best = -1, a = Infinity;
  f.rooms.forEach((r, j) => { if (r.kind !== "zone" && r.kind !== "fill" && inside(p, r.pts) && area(r.pts) <= a) { best = j; a = area(r.pts); } });
  return best;
};
const corners = ([x, y, w, h]: Box): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x + w / 2, y], [x + w / 2, y + h]];

const CASES: [string, Layout][] = [["demo", demo], ["stress", stress]];
const VIEWS = ["2d", "2.5d"] as const;

describe("S23.3: a room's name stays in its room", () => {
  it("the layouts are valid", () => {
    for (const [n, l] of CASES) expect(validate(l).ok, n).toBe(true);
  });

  for (const [n, l] of CASES) for (const [fk, f] of Object.entries(l.floors)) for (const view of VIEWS) for (const scale of [0.5, 1]) {
    it(`${n} ${fk} ${view} at scale ${scale}: every room name's box is in its own room and off every device disc`, () => {
      const html = renderFloor(f, { scale, view }), k = 1 / scale;
      // A room narrower than its name at the 7k floor (6k for a zone) cannot hold it: that name, and only that one, goes
      // outside on a leader. The demo's pond is one. Every other name must stay in.
      const small = (i: number) => {
        const r = f.rooms[i], xs = r.pts.map((p) => p[0]), ys = r.pts.map((p) => p[1]), min = (r.kind === "zone" ? 6 : 7) * k;
        return Math.max(...xs) - Math.min(...xs) < String(r.name).length * 0.6 * min + 4 * k || Math.max(...ys) - Math.min(...ys) < min + 4 * k;
      };
      const ds = discs(html);
      if (f.devices.length) expect(ds.length).toBeGreaterThan(0);
      const all = names(html);
      expect(all.length).toBe(f.rooms.filter((r) => r.name && r.kind !== "fill").length);
      expect((html.match(/class="lbl-leader"/g) ?? []).length).toBe(all.filter((t) => small(t.i)).length);
      for (const t of all.filter((t) => !small(t.i))) {
        for (const c of corners(t.box)) {
          if (t.zone) expect(inside(c, f.rooms[t.i].pts), `${t.name} corner ${c.map(Math.round)}`).toBe(true);
          else expect(owner(f, c), `${t.name} corner ${c.map(Math.round)}`).toBe(t.i);
        }
        if (!t.tag) expect(ds.filter((d) => meet(d, t.box)).length, `${t.name} under a disc`).toBe(0);
      }
    });
  }

  it("2.5D: the stress house's Hall name stays in the Hall (the review found it in the Cloakroom)", () => {
    const f = stress.floors.ground, hall = f.rooms.findIndex((r) => r.name === "Hall");
    for (const scale of [0.5, 1]) {
      const t = names(renderFloor(f, { scale, view: "2.5d" })).find((x) => x.i === hall)!;
      for (const c of corners(t.box)) expect(owner(f, c)).toBe(hall);
    }
  });

  // Small synthetic floors for the three rules the house layouts never hit.
  const sq = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const plain = (rooms: Floor["rooms"], devices: unknown[] = []) => ({ title: "T", outline: sq(0, 0, 2000, 2000), rooms, walls: [], stairs: [], doors: [], openings: [], extras: [], devices, furniture: [], unlinked: [] }) as unknown as Floor;
  const room = (name: string, pts: Pt[]) => ({ id: name, name, area: "", kind: "room", pts, wk: pts.map(() => "wall") }) as unknown as Floor["rooms"][number];

  it("2.5D: a ceiling light's stem foot is an obstacle, so the name moves off the dot on the floor", () => {
    const f = plain([room("Lounge", sq(0, 0, 600, 400))], [{ id: "l", type: "light", entity: "light.l", x: 300, y: 200, z: 250 }]);
    const html = renderFloor(f, { scale: 1, view: "2.5d" });
    expect(html).toContain('class="stem-top"');
    const t = names(html)[0];
    expect(meet(t.box, [300 - 3, 200 - 3, 6, 6]), `name at ${t.box.map(Math.round)}`).toBe(false);
    for (const c of corners(t.box)) expect(inside(c, f.rooms[0].pts)).toBe(true);
  });

  it("a long low room with icons along most of it slides the name sideways, not into a tag or the next room", () => {
    // Icons along the left two thirds of the centre line: the centroid and the pole (the grid's first deepest point, at
    // the left end) are both covered. Only a step sideways reaches the free right end.
    const icons = Array.from({ length: 14 }, (_, j) => ({ id: `m${j}`, type: "motion", entity: `binary_sensor.m${j}`, x: 10 + 30 * j, y: 20 }));
    const f = plain([room("Gallery", sq(0, 0, 600, 40))], icons);
    const html = renderFloor(f, { scale: 1 }), t = names(html)[0], d = discs(html);
    expect(t.tag).toBe(false);
    expect(d.filter((q) => meet(q, t.box)).length).toBe(0);
    for (const c of corners(t.box)) expect(inside(c, f.rooms[0].pts)).toBe(true);
  });

  it("an L-shaped room whose centroid lies outside it keeps its name inside (the pole of inaccessibility)", () => {
    const L: Pt[] = [[0, 0], [600, 0], [600, 80], [80, 80], [80, 600], [0, 600]];
    const f = plain([room("Corridor", L)]);
    expect(inside([200, 200], L)).toBe(false); // the centroid is out in the crook
    for (const scale of [0.5, 1]) {
      const t = names(renderFloor(f, { scale }))[0];
      expect(renderFloor(f, { scale })).not.toContain("lbl-leader");
      for (const c of corners(t.box)) expect(inside(c, L), `scale ${scale} corner ${c.map(Math.round)}`).toBe(true);
    }
  });

  it("a room whose every spot is covered draws its name as a tag on top of the icons, inside the room", () => {
    const devices = [];
    for (let x = 10; x < 300; x += 20) for (let y = 10; y < 120; y += 20) devices.push({ id: `s${x}-${y}`, type: "temp", entity: `sensor.t${x}_${y}`, x, y });
    const f = plain([room("Den", sq(0, 0, 300, 120))], devices);
    const html = renderFloor(f, { scale: 1 });
    const t = names(html)[0];
    expect(t.tag).toBe(true);
    for (const c of corners(t.box)) expect(inside(c, f.rooms[0].pts)).toBe(true);
    // Drawn after the last icon, on its own plate, and the plate before the text.
    const plate = html.indexOf('class="lbl-tag"'), text = html.indexOf("lbl-on"), lastIcon = html.lastIndexOf("<g data-x=");
    expect(plate).toBeGreaterThan(lastIcon);
    expect(text).toBeGreaterThan(plate);
    expect(html.match(/data-rl="0"/g)?.length).toBe(1); // drawn once, not also under the icons
    // A free spot exists once one icon goes: then no tag.
    const html2 = renderFloor(plain([room("Den", sq(0, 0, 300, 120))], devices.filter((d) => !(d.x >= 110 && d.x <= 190 && d.y >= 30 && d.y <= 90))), { scale: 1 });
    expect(html2).not.toContain("lbl-tag");
  });

  it("a tag's name is escaped like any other (finding 2)", () => {
    const devices = [];
    for (let x = 10; x < 300; x += 20) for (let y = 10; y < 120; y += 20) devices.push({ id: `s${x}-${y}`, type: "temp", entity: `sensor.t${x}_${y}`, x, y });
    const html = renderFloor(plain([room('"><script>x', sq(0, 0, 300, 120))], devices), { scale: 1 });
    expect(html).toContain("lbl-on");
    expect(html).not.toContain("<script>");
  });
});
