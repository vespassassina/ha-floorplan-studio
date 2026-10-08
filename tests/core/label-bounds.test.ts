import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { Floor, Layout, Pt } from "../../src/core/schema";
import { inside, migrate, renderFloor, viewBoxFor } from "../../src/core";

// S23 review S3: at 375 px a name clipped at the card's right edge and sat under its controls ("Garden pond" read
// "Garden"). `bounds` is the part of the view box a label may use: the card passes its fit box minus the strip its
// controls cover. Every name, tag and leader must lie inside it. Boxes are the renderer's own model (len x 0.6 x size
// wide, size tall, baseline at 0.75 of it).

const demo = migrate(JSON.parse(readFileSync("demo/layout.json", "utf8"))) as Layout;
// tests/fixtures/stress-layout.json: the stress generator's house, three storeys, 46 rooms. Synthetic names only.
const stress = migrate(JSON.parse(readFileSync("tests/fixtures/stress-layout.json", "utf8"))) as Layout;

type Box = [number, number, number, number];
type Rect = { x: number; y: number; w: number; h: number };
const attr = (tag: string, a: string) => Number(tag.match(new RegExp(` ${a}="([^"]*)"`))?.[1]);
const names = (html: string) => [...html.matchAll(/<text class="lbl[^"]*"[^>]*data-rl="(\d+)"[^>]*>([^<]*)<\/text>/g)].map((m) => {
  const x = attr(m[0], "x"), y = attr(m[0], "y"), size = attr(m[0], "font-size"), w = m[2].length * 0.6 * size;
  return { i: Number(m[1]), name: m[2], box: [x - w / 2, y - 0.75 * size, w, size] as Box };
});
const tags = (html: string) => [...html.matchAll(/<rect class="lbl-tag"[^>]*>/g)].map((m) => [attr(m[0], "x"), attr(m[0], "y"), attr(m[0], "width"), attr(m[0], "height")] as Box);
const leaders = (html: string) => [...html.matchAll(/<line class="lbl-leader"[^>]*>/g)].flatMap((m) => [[attr(m[0], "x1"), attr(m[0], "y1")], [attr(m[0], "x2"), attr(m[0], "y2")]] as Pt[]);
const within = (b: Box, r: Rect) => b[0] >= r.x - 1e-6 && b[1] >= r.y - 1e-6 && b[0] + b[2] <= r.x + r.w + 1e-6 && b[1] + b[3] <= r.y + r.h + 1e-6;
/** What the card passes at a given width: px from the fit box, the card's own `_scale`, and the fit box less a strip. */
const card = (f: Floor, view: "2d" | "2.5d", width: number, stripPx = 0) => {
  const fit = viewBoxFor(f, 60, undefined, view), px = width / fit.w, scale = 1 / Math.max(1, Math.max(fit.w, fit.h) / 1000);
  const bounds = { ...fit, w: fit.w - stripPx / px };
  return { html: renderFloor(f, { scale, px, view, bounds }), bounds };
};

const CASES: [string, Layout][] = [["demo", demo], ["stress", stress]];

describe("S23 review S3: labels stay inside the bounds the card gives", () => {
  for (const [n, l] of CASES) for (const [fk, f] of Object.entries(l.floors)) for (const view of ["2d", "2.5d"] as const) for (const strip of [0, 40]) {
    it(`${n} ${fk} ${view} at 375 px, ${strip} px of controls: every name, tag and leader is inside`, () => {
      const { html, bounds } = card(f, view, 375, strip);
      const all = names(html);
      expect(all.length).toBe(f.rooms.filter((r) => r.name && r.kind !== "fill").length);
      for (const t of all) expect(within(t.box, bounds), `${t.name} at ${t.box.map(Math.round)} in ${Object.values(bounds).map(Math.round)}`).toBe(true);
      for (const b of tags(html)) expect(within(b, bounds), `tag ${b.map(Math.round)}`).toBe(true);
      for (const p of leaders(html)) expect(within([p[0], p[1], 0, 0], bounds), `leader end ${p.map(Math.round)}`).toBe(true);
    });
  }

  it("an outdoor name uses free space beside its area before it takes a leader", () => {
    // A garden 100 wide beside a house: "Garden" does not fit in it at 11 px, but the board below it is free.
    const sq = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    const room = (name: string, kind: string, pts: Pt[]) => ({ id: name, name, area: "", kind, pts, wk: pts.map(() => "wall") });
    const f = { title: "T", outline: sq(0, 0, 800, 600), walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [],
      rooms: [room("House", "room", sq(0, 0, 800, 600)), room("Garden", "garden", sq(800, 380, 100, 160))] } as unknown as Floor;
    const { html, bounds } = card(f, "2d", 375);
    expect(html).not.toContain("lbl-leader");
    const g = names(html).find((t) => t.name === "Garden")!;
    expect(within(g.box, bounds)).toBe(true);
    // on free board: no corner in the house
    const [x, y, w, h] = g.box;
    for (const c of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]] as Pt[]) expect(inside(c, f.rooms[0].pts), `corner ${c.map(Math.round)}`).toBe(false);
  });

  it("without bounds nothing changes (the editor)", () => {
    const f = demo.floors.ground, fit = viewBoxFor(f, 60);
    const a = renderFloor(f, { scale: 1 }), b = renderFloor(f, { scale: 1, bounds: { ...fit, w: 1e6, h: 1e6, x: -5e5, y: -5e5 } });
    expect(b).toBe(a);
  });
});
