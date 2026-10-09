import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { Layout } from "../../src/core/schema";
import { migrate } from "../../src/core";
import { renderFloor } from "../../src/core/render";

// S25.4: `zoom` is the view's zoom over the whole floor at fit (1 = fit). A label keeps the on-screen size and offset
// it has at fit, so its plan size is divided by the zoom. Discs and icons keep growing with the view, as before.

const demo = migrate(JSON.parse(readFileSync("demo/layout.json", "utf8"))) as Layout;
const f = demo.floors.ground;
const rooms = (html: string) => [...html.matchAll(/<text [^>]*data-rl="\d+"[^>]*font-size="([\d.]+)"/g)].map((m) => Number(m[1]));
// A device label has no data-rl and no val class.
const devLabels = (html: string) => [...html.matchAll(/<text class="lbl" x="[-\d.]+" y="[-\d.]+"(?: transform="[^"]*")? text-anchor="middle" font-size="([\d.]+)">/g)].map((m) => Number(m[1]));
const discK = (html: string) => [...html.matchAll(/<g data-x="\d+"[^>]* transform="translate\([-\d.]+ [-\d.]+\) scale\(([\d.]+)\)/g)].map((m) => Number(m[1]));
const named = { ...f, devices: f.devices.slice(0, 3) };

describe("S25.4: labels in screen px", () => {
  it("zoom 1, absent or junk changes nothing", () => {
    const plain = renderFloor(f, { scale: 1, px: 0.2 });
    for (const zoom of [undefined, 1, 0, -2, NaN, Infinity, "3" as unknown as number]) expect(renderFloor(f, { scale: 1, px: 0.2, zoom }), String(zoom)).toBe(plain);
  });

  it("a room name's plan size is its size at fit over the zoom (asymmetric zoom 2.5)", () => {
    const a = rooms(renderFloor(f, { scale: 1, px: 0.5 }));
    const b = rooms(renderFloor(f, { scale: 1, px: 0.5, zoom: 2.5 }));
    expect(a.length).toBeGreaterThan(2);
    expect(b.length).toBe(a.length);
    // the biggest name is the unshrunk 12k at fit; at zoom 2.5 it is 12k/2.5
    expect(Math.max(...b)).toBeCloseTo(Math.max(...a) / 2.5, 1);
  });

  it("a shrunk name keeps its floor in screen px at the view's scale: 11 px at zoom 4 as at fit", () => {
    const px = 0.12, zoom = 4;
    const fit = rooms(renderFloor(f, { scale: 1, px })), near = rooms(renderFloor(f, { scale: 1, px, zoom }));
    expect(near.length).toBe(fit.length);
    expect(Math.min(...fit) * px).toBeGreaterThanOrEqual(11 - 0.01);
    for (const s of near) expect(s * px * zoom).toBeGreaterThanOrEqual(11 - 0.01);
    // on screen the smallest name is the same at zoom 4 as at fit, within a pixel
    expect(Math.min(...near) * px * zoom).toBeCloseTo(Math.min(...fit) * px, 0);
  });

  it("device labels shrink in plan units with the zoom; discs do not", () => {
    const at = (zoom: number) => renderFloor(named, { scale: 1, px: 0.5, zoom, showNames: true });
    const a = devLabels(at(1)), b = devLabels(at(6));
    expect(a.length).toBe(3);
    expect(b.length).toBe(3);
    for (let i = 0; i < 3; i++) expect(b[i]).toBeCloseTo(a[i] / 6, 1);
    expect(discK(at(6))).toEqual(discK(at(1)));
  });
});
