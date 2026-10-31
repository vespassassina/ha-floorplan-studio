import { test, expect, type Page } from "@playwright/test";
import { FLOORPLAN_CSS, renderFloor } from "../../src/core/render";
import type { Floor, Pt } from "../../src/core/schema";

// S42.2, finding 10 and criterion 5: the tint rules read as strings say nothing about specificity or the pixel. Chromium's computed
// style, in one light and one dark theme, each set first (finding 19): a warned room carries a wash in --fp-hot or --fp-cold at low
// opacity that takes no click; under the temperature heat map it carries a steady 2 px border instead and no wash. The expected colour
// is a probe of the same token, not copied from the rule.
const sq = (x: number): Pt[] => [[x, 0], [x + 100, 0], [x + 100, 100], [x, 100]];
const room = (i: number, extra: Record<string, unknown> = {}) => ({ id: `r${i}`, name: `R${i}`, area: "", kind: "room", pts: sq(i * 120), wk: ["wall", "wall", "wall", "wall"], ...extra });
// 0 hot, 1 cold, 2 not warned, 3 hot and painted (its own colour must stay under the wash)
const floor = (): Floor => ({
  title: "T", outline: [[0, 0], [480, 0], [480, 100], [0, 100]], walls: [], stairs: [], openings: [], extras: [], furniture: [], unlinked: [], doors: [], devices: [],
  rooms: [room(0), room(1), room(2), room(3, { color: "#22aa66" })],
}) as unknown as Floor;
const WARN = { r0: "hot", r1: "cold", r3: "hot" } as const;
const THEMES_TESTED = [["light", false], ["midnight", true]] as const;
const probe = (css: string) => `<path class="probe" d="M0 0" style="fill:${css};stroke:${css}"/>`;
const html = (theme: string, dark: boolean, heat: "temperature" | "humidity" | "off", warn: boolean) =>
  // The editor's own .room{pointer-events:all}, so the test sees the clash finding 18 is about.
  `<!DOCTYPE html><html><body><style>${FLOORPLAN_CSS} .room{pointer-events:all}</style><svg width="500" height="120"><g data-theme="${theme}"${dark ? ' data-mode="dark"' : ""}>${renderFloor(floor(), { scale: 1, theme: theme as never, dark, heat, ...(warn ? { tempWarn: WARN } : {}) })}${probe("var(--fp-hot)")}${probe("var(--fp-cold)")}</g></svg></body></html>`;

const read = (page: Page) => page.evaluate(() => {
  const cs = (e: Element) => getComputedStyle(e);
  const wash = [...document.querySelectorAll("polygon.tw")].map((e) => ({ i: (e as SVGElement).dataset.tw, fill: cs(e).fill, op: cs(e).fillOpacity, pe: cs(e).pointerEvents, stroke: cs(e).stroke }));
  const ring = [...document.querySelectorAll("polygon.tr")].map((e) => ({ i: (e as SVGElement).dataset.tr, stroke: cs(e).stroke, w: cs(e).strokeWidth, fill: cs(e).fill, pe: cs(e).pointerEvents }));
  const probes = [...document.querySelectorAll("path.probe")].map((e) => ({ fill: cs(e).fill, stroke: cs(e).stroke }));
  const rooms = [...document.querySelectorAll("polygon[data-r]")].map((e) => cs(e).fill);
  const svg = document.querySelector("svg")!.getBoundingClientRect();
  const top = (cx: number) => { const e = document.elementFromPoint(svg.x + cx, svg.y + 15); return e?.closest("polygon")?.getAttribute("data-r") ?? e?.getAttribute("class") ?? null; };
  return { wash, ring, probes, rooms, top0: top(20), top3: top(3 * 120 + 20) };
});

for (const [theme, dark] of THEMES_TESTED) {
  test(`temp warn pair (${theme}): the wash is --fp-hot or --fp-cold at low opacity, over an untouched room, and takes no click`, async ({ page }) => {
    await page.setContent(html(theme, dark, "off", true));
    const on = await read(page);
    await page.setContent(html(theme, dark, "off", false));
    const off = await read(page);
    const [hot, cold] = on.probes;
    expect(hot!.fill).not.toBe(cold!.fill);
    expect(on.wash.map((w) => w.i)).toEqual(["0", "1", "3"]);
    expect(on.wash[0]!.fill, `${theme} hot`).toBe(hot!.fill);
    expect(on.wash[1]!.fill, `${theme} cold`).toBe(cold!.fill);
    expect(on.wash[2]!.fill, `${theme} painted room, hot`).toBe(hot!.fill);
    for (const w of on.wash) { expect(Number(w.op), "low opacity, not zero, not solid").toBeGreaterThan(0.1); expect(Number(w.op)).toBeLessThan(0.5); expect(w.pe).toBe("none"); expect(w.stroke).toBe("none"); }
    expect(on.ring).toEqual([]);
    expect(on.rooms, "the room's own fill is not touched").toEqual(off.rooms);
    expect(on.top0, "the click goes to the room under the wash").toBe("0");
    expect(on.top3).toBe("3");
  });

  test(`temp warn pair (${theme}): under the temperature heat map a steady 2 px border replaces the wash`, async ({ page }) => {
    await page.setContent(html(theme, dark, "temperature", true));
    const on = await read(page);
    const [hot, cold] = on.probes;
    expect(on.wash).toEqual([]);
    expect(on.ring.map((r) => r.i)).toEqual(["0", "1", "3"]);
    expect(on.ring[0]!.stroke, `${theme} hot`).toBe(hot!.stroke);
    expect(on.ring[1]!.stroke, `${theme} cold`).toBe(cold!.stroke);
    for (const r of on.ring) { expect(r.w).toBe("2px"); expect(r.fill).toBe("none"); expect(r.pe).toBe("none"); }
    expect(on.top0).toBe("0");
  });

  test(`temp warn pair (${theme}): the humidity heat map keeps the wash`, async ({ page }) => {
    await page.setContent(html(theme, dark, "humidity", true));
    const on = await read(page);
    expect(on.wash.length).toBe(3);
    expect(on.ring).toEqual([]);
  });
}

test("temp warn pair: the ring is steady, with no animation", async ({ page }) => {
  await page.setContent(html("light", false, "temperature", true));
  const names = await page.evaluate(() => [...document.querySelectorAll("polygon.tr, polygon.tw")].map((e) => getComputedStyle(e).animationName));
  expect(names.length).toBeGreaterThan(0);
  for (const n of names) expect(n).toBe("none");
});
