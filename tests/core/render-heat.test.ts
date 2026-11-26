import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FLOORPLAN_CSS, renderFloor, type RenderOpts } from "../../src/core/render";
import { HEAT_KINDS, type HeatKind } from "../../src/core/heat";
import type { Floor, Layout, Pt } from "../../src/core/schema";

// S34.7 (spec docs/specs/extras-s34.md, H4, H5, criteria 10 and 11): renderFloor draws the heat map. One draw path (finding 8).
const demo = JSON.parse(readFileSync("demo/layout.json", "utf8")) as Layout;
const ground = demo.floors.ground!, first = demo.floors.first!;
const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-17T10:00:00Z" });
// The shots' `on` states, ground: Living 23.5 (its sensor stands inside the Reading corner zone); first: Bedroom "12,5", Bathroom 54 (off state).
const ON = { "light.demo_living": st("on"), "sensor.demo_living_temperature": st("23.5"), "sensor.demo_bedroom_temperature": st("12,5"), "sensor.demo_bathroom_humidity": st("54") };
const N = " ";
const poly = (html: string, i: number) => new RegExp(`<polygon data-r="${i}" class="([^"]*)"([^>]*)/>`).exec(html);
const heatOf = (html: string, i: number) => { const m = poly(html, i); return m && / heat( |$)/.test(` ${m[1]} `) ? Number(/--fp-heat:([\d.]+)/.exec(m[2])?.[1]) : null; };
const readout = (html: string, i: number) => new RegExp(`<text class="([^"]*)" data-rv="${i}"[^>]*>([^<]*)</text>`).exec(html);
const IDX = { living: 0, zone: 3, bedroom: 0, bathroom: 1 };

describe("criterion 10: heat off is the markup as it was", () => {
  const base: RenderOpts = { scale: 0.5, state: ON };
  const sets: RenderOpts[] = [];
  for (const view of ["2d", "2.5d"] as const) for (const night of [false, true]) for (const roomGlow of [false, true]) for (const labels of [true, false]) for (const state of [undefined, ON]) for (const theme of ["blueprint", "light", "ha"] as const) for (const detail of ["far", "near"] as const)
    sets.push({ ...base, view, night, roomGlow, labels, state, theme, detail });
  it("omitted, off, junk and a non-string draw the same bytes, over every option set the render tests use", () => {
    for (const f of [ground, first]) for (const o of sets) {
      const plain = renderFloor(f, o);
      for (const heat of [undefined, "off", "bogus", 3, "Temperature"]) expect(renderFloor(f, { ...o, heat } as never), JSON.stringify([o, heat])).toBe(plain);
      expect(plain).not.toMatch(/ heat|--fp-heat:|heat-val/);
    }
  });
});

describe("criterion 11: temperature on the demo", () => {
  const o: RenderOpts = { scale: 0.5, state: ON, heat: "temperature", detail: "far" };
  it("heats Living at 0.75; the zone and the Bedroom (comma decimal) are not heated", () => {
    const g = renderFloor(ground, o), f1 = renderFloor(first, o);
    expect(heatOf(g, IDX.living)).toBe(0.75);
    expect(poly(g, IDX.living)?.[1]).toContain("heat-temperature");
    expect(heatOf(g, IDX.zone)).toBeNull();
    expect(heatOf(f1, IDX.bedroom)).toBeNull();
    expect(readout(f1, IDX.bedroom)).toBeNull();
    for (const i of [1, 2, 4, 5, 6]) expect(heatOf(g, i), `ground room ${i}`).toBeNull();
  });
  it("prints the heat value under Living's name at far detail, and still under labels: false, and nothing else", () => {
    const g = renderFloor(ground, o);
    expect(readout(g, IDX.living)?.[2]).toBe(`23.5${N}°C`);
    expect(readout(g, IDX.living)?.[1]).toContain("heat-val");
    const bare = renderFloor(ground, { ...o, labels: false });
    expect(readout(bare, IDX.living)?.[2]).toBe(`23.5${N}°C`);
    expect(readout(bare, IDX.living)?.[1]).toContain("heat-val");
    expect(bare.match(/<text/g)?.length).toBe(1); // the readout is the only text
    const off = renderFloor(ground, { ...o, heat: "off", labels: false });
    expect(off).not.toContain("<text");
  });
  it("draws no room-night in a heat mode, and does with heat off", () => {
    expect(renderFloor(ground, { ...o, night: true })).not.toContain("room-night");
    expect(renderFloor(ground, { ...o, night: true, heat: "off" })).toContain("room-night");
  });
  it("humidity heats the first floor's Bathroom at 0.6 and prints 54 %; the temperature rooms are not heated", () => {
    const f1 = renderFloor(first, { ...o, heat: "humidity" });
    expect(heatOf(f1, IDX.bathroom)).toBe(0.6);
    expect(poly(f1, IDX.bathroom)?.[1]).toContain("heat-humidity");
    expect(readout(f1, IDX.bathroom)?.[2]).toBe(`54${N}%`);
    expect(heatOf(f1, IDX.bedroom)).toBeNull();
    expect(heatOf(renderFloor(ground, { ...o, heat: "humidity" }), IDX.living)).toBeNull();
  });
  it("2.5D heats the same", () => {
    expect(heatOf(renderFloor(ground, { ...o, view: "2.5d" }), IDX.living)).toBe(0.75);
  });
  it("every HEAT_KINDS member is decided: off writes nothing, the others heat a room that reads", () => {
    for (const k of HEAT_KINDS) {
      const html = renderFloor(first, { ...o, heat: k as HeatKind });
      const heated = [0, 1, 2].filter((i) => heatOf(html, i) !== null);
      expect(heated.length, k).toBe(k === "off" ? 0 : k === "humidity" ? 1 : 0); // first floor on ON: only the bathroom reads, and only humidity
    }
  });
  it("presence heat uses precomputed heatValues and prints formatted occupied duration", () => {
    const html = renderFloor(ground, { ...o, heat: "presence", heatValues: { [IDX.living]: { text: "3h 30m", t: 0.44 } } });
    expect(poly(html, IDX.living)?.[1]).toContain("heat-presence");
    expect(heatOf(html, IDX.living)).toBe(0.44);
    expect(readout(html, IDX.living)?.[2]).toBe("3h 30m");
  });
});

describe("the readout in a heat mode", () => {
  const sq = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const f = (extra: Record<string, unknown> = {}, name = "Den"): Floor => ({
    title: "T", outline: sq(0, 0, 400, 300), walls: [], stairs: [], openings: [], extras: [], furniture: [], unlinked: [], doors: [], devices: [],
    rooms: [{ id: "r", name, area: "", kind: "room", pts: sq(0, 0, 400, 300), wk: ["wall", "wall", "wall", "wall"], temps: ["t1", "t2"], humidity: ["h1"], ...extra }],
  }) as unknown as Floor;
  const S = { t1: st("95", { unit_of_measurement: "°C" }), t2: st("23", { unit_of_measurement: "°C" }), h1: st("48", { unit_of_measurement: "%" }) };
  it("the mode's kind is the heat value; the other kind stays as today", () => {
    const t = renderFloor(f(), { scale: 1, state: S, heat: "temperature" });
    expect(readout(t, 0)?.[2]).toBe(`23${N}°C · 48${N}%`); // the faulty 95 is out of the heat value, so colour and number agree
    expect(heatOf(t, 0)).toBe(0.7);
    const h = renderFloor(f(), { scale: 1, state: S, heat: "humidity" });
    expect(readout(h, 0)?.[2]).toBe(`59${N}°C · 48${N}%`); // today's mean of 95 and 23, then the heat value of the humidity
    expect(heatOf(h, 0)).toBe(0.45);
    const none = renderFloor(f(), { scale: 1, state: S });
    expect(readout(none, 0)?.[2]).toBe(`59${N}°C · 48${N}%`);
  });
  it("a heated room's own text is escaped and its heat is a number", () => {
    const html = renderFloor(f({}, '"><script>'), { scale: 1, state: S, heat: "temperature" });
    expect(html).not.toContain("<script>");
    expect(/style="--fp-heat:[\d.]+"/.test(html)).toBe(true);
  });
  it("a junk or unreadable state heats nothing and prints no NaN", () => {
    for (const state of [{}, { t1: st("NaN") }, { t1: st("unavailable"), t2: st("abc") }, { t1: { state: 3 } }, undefined]) {
      const html = renderFloor(f(), { scale: 1, state: state as never, heat: "temperature" });
      expect(heatOf(html, 0)).toBeNull();
      expect(html).not.toContain("NaN");
    }
  });
  it("a painted room keeps its fill attribute (the stylesheet, not the markup, lets the heat win)", () => {
    const html = renderFloor(f({ color: "#336699" }), { scale: 1, state: S, heat: "temperature" });
    expect(poly(html, 0)?.[1]).toContain("heat");
    expect(poly(html, 0)?.[2]).toContain('fill="#336699"');
  });
});

describe("the stylesheet", () => {
  it("names the three humidity tokens beside the plug ramp, and the rule that mixes the ramp into the kind's colour", () => {
    expect(FLOORPLAN_CSS).toMatch(/--fp-heat-cool:#[0-9a-f]{6};--fp-heat-mid:#[0-9a-f]{6};--fp-heat-hot:#[0-9a-f]{6};--fp-hum-dry:#[0-9a-f]{6};--fp-hum-mid:#[0-9a-f]{6};--fp-hum-wet:#[0-9a-f]{6}/);
    expect(FLOORPLAN_CSS).toContain(".room.heat");
  });
});

// Found by looking at the card at 3x (S34.11): Living's badge plate sat on its heat value. The plate steps below the room's own
// readout (`roomReadout`), which a room fed by a placed sensor does not have; the heat value is a readout too.
describe("the room badge steps below a heat value", () => {
  const o: RenderOpts = { scale: 0.5, state: ON, detail: "far" };
  const plateTop = (html: string, i: number) => Number(new RegExp(`<g data-rb="${i}"[^>]*>\\s*<rect class="rb-plate" x="[-\\d.]+" y="([-\\d.]+)"`).exec(html)?.[1]);
  const valueY = (html: string, i: number) => Number(new RegExp(`data-rv="${i}"[^>]* y="([-\\d.]+)"|<text class="[^"]*" data-rv="${i}" x="[-\\d.]+" y="([-\\d.]+)"`).exec(html)?.slice(1).find(Boolean));
  it("Living's plate starts below the heat value's baseline, and lower than with the heat map off", () => {
    const heated = renderFloor(ground, { ...o, heat: "temperature" }), plain = renderFloor(ground, o);
    expect(plateTop(heated, IDX.living)).toBeGreaterThan(valueY(heated, IDX.living));
    expect(plateTop(heated, IDX.living)).toBeGreaterThan(plateTop(plain, IDX.living));
  });
});
