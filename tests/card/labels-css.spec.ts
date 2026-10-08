import { test, expect } from "@playwright/test";
import { FLOORPLAN_CSS, THEMES, renderFloor } from "../../src/core/render";
import type { Floor, RoomKind } from "../../src/core/schema";

// S23.1 (V2, V7, V8): one label style, read back from Chromium (finding 10). A name is a solid colour mixed into the
// room it sits on, never faded with opacity; one font for the plan; values are tabular. The contrast pairs are the
// computed fill of a name against the computed fill of the room under it, in every theme.

const sq = (x: number, y: number, s: number): [number, number][] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
const room = (i: number, kind: RoomKind, name: string, pts: [number, number][]) => ({ id: `r${i}`, name, area: "", kind, pts, wk: pts.map(() => "wall") });
/** One room of every kind that draws a name, side by side, and a zone inside the plain room. */
const NAMED: RoomKind[] = ["room", "structure", "garden", "terrace", "pavement", "water"];
const FLOOR = {
  title: "T", outline: sq(0, 0, 6000), walls: [], stairs: [], doors: [], openings: [], extras: [], furniture: [], unlinked: [],
  rooms: [...NAMED.map((k, i) => room(i, k, `N-${k}`, sq(i * 1000, 0, 1000))), room(NAMED.length, "zone", "N-zone", sq(100, 600, 300))],
  devices: [{ id: "t", type: "temp", entity: "sensor.t", x: 500, y: 300 }],
} as unknown as Floor;
const STATE = { "sensor.t": { state: "21.5", attributes: { unit_of_measurement: "°C" }, last_changed: "2026-10-08T10:00:00Z" } };

/** Every theme, and Home Assistant's in both modes. */
const CASES = [...THEMES.map((t) => ({ t, dark: false, id: t })), { t: "ha" as const, dark: true, id: "ha-dark" }];
const page_ = () => `<!DOCTYPE html><html><body><style>${FLOORPLAN_CSS}</style>${CASES.map((c) =>
  `<svg class="fp" id="s-${c.id}" viewBox="0 0 6000 1000" width="1200" height="200">${renderFloor(FLOOR, { scale: 1, theme: c.t, dark: c.dark, state: STATE })}</svg>`).join("")}</body></html>`;

const lum = (rgb: number[]) => { const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a: number[], b: number[]) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
/** `rgb(r, g, b)` or Chromium's `color(srgb r g b)` for a color-mix(), both as 0-255. */
const rgbOf = (css: string): number[] => {
  const m = /color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)/.exec(css);
  if (m) return [m[1], m[2], m[3]].map((v) => Number(v) * 255);
  return (css.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
};

/** The colour a reader sees: the fill blended over the room by the text's own opacity (a faded name is a weaker name). */
const seen = (r: { fill: string; under: string; opacity: string }) => { const f = rgbOf(r.fill), u = rgbOf(r.under), a = Number(r.opacity); return f.map((v, i) => v * a + u[i] * (1 - a)); };

/** What sits under each name: its own room, and the plain room for the zone. */
const UNDER: Record<string, string> = { ...Object.fromEntries(NAMED.map((k, i) => [`N-${k}`, String(i)])), "N-zone": "0" };
/** The pairs S23.6 left short. Midnight (and Home Assistant's dark fallback, which is midnight) keeps its light water
 * #a9cfe3, and solarized's outdoor names, its base0 on the new ramp teal, stay near 3.2:1. Each is a test.fixme
 * below, never a lower bar here. */
const fixme = (id: string, name: string): string | null => {
  if (name === "N-water" && (id === "midnight" || id === "ha-dark")) return "midnight keeps its light water #a9cfe3";
  if (["N-garden", "N-terrace", "N-pavement", "N-water"].includes(name) && id === "solarized") return "solarized's outdoor names are near 3.2:1 on the ramp teal";
  return null;
};

type Read = { name: string; fill: string; under: string; opacity: string; weight: string; style: string; family: string; stroke: string; outline: string; size: string };
const readAll = (page: import("@playwright/test").Page, id: string) => page.locator(`#s-${id}`).evaluate((svg, UNDER) => {
  const probe = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  probe.setAttribute("style", "fill:var(--fp-outline)");
  svg.querySelector("g")!.appendChild(probe);
  const outline = getComputedStyle(probe).fill;
  probe.remove();
  return [...svg.querySelectorAll("text.lbl")].map((el) => {
    const c = getComputedStyle(el), name = el.textContent ?? "";
    const under = svg.querySelector(`polygon[data-r="${UNDER[name]}"]`)!;
    return { name, fill: c.fill, under: getComputedStyle(under).fill, opacity: c.opacity, weight: c.fontWeight, style: c.fontStyle, family: c.fontFamily, stroke: c.stroke, outline, size: c.fontSize };
  });
}, UNDER) as Promise<Read[]>;

test.describe("S23.1 CSS pair: one label style", () => {
  test("every name is solid, weight 500, one font, halo at --fp-outline; outdoor names are italic", async ({ page }) => {
    await page.setContent(page_());
    for (const c of CASES) {
      const all = await readAll(page, c.id);
      expect(all.length, c.id).toBe(NAMED.length + 1);
      for (const r of all) {
        const tag = `${c.id} ${r.name}`;
        expect(r.opacity, tag).toBe("1");
        expect(r.weight, tag).toBe("500");
        expect(r.family, tag).toBe("system-ui, sans-serif");
        expect(r.stroke, tag).toBe(r.outline);
        expect(r.style, tag).toBe(["N-garden", "N-terrace", "N-pavement", "N-water"].includes(r.name) ? "italic" : "normal");
        expect(r.fill, `${tag}: a colour of its own, not the room's`).not.toBe(r.under);
      }
    }
  });

  test("the plan font follows Home Assistant's body font when the host has one", async ({ page }) => {
    await page.setContent(page_());
    await page.evaluate(() => document.documentElement.style.setProperty("--ha-font-family-body", "Roboto, Noto, sans-serif"));
    const family = await page.locator("#s-blueprint text.lbl").first().evaluate((el) => getComputedStyle(el).fontFamily);
    expect(family).toBe("Roboto, Noto, sans-serif");
    const val = await page.locator("#s-blueprint text.val").first().evaluate((el) => { const c = getComputedStyle(el); return [c.fontFamily, c.fontVariantNumeric]; });
    expect(val).toEqual(["Roboto, Noto, sans-serif", "tabular-nums"]);
  });

  test("the label is the text mixed into its room: a different room gives a different label colour", async ({ page }) => {
    await page.setContent(page_());
    const all = await readAll(page, "light");
    const fills = new Set(all.map((r) => r.fill));
    expect(fills.size, JSON.stringify(all.map((r) => [r.name, r.fill]))).toBeGreaterThan(3);
  });

  for (const c of CASES) {
    test(`contrast: every name is at least 4.5:1 on its room, ${c.id}`, async ({ page }) => {
      await page.setContent(page_());
      const all = await readAll(page, c.id);
      let checked = 0;
      for (const r of all) {
        if (fixme(c.id, r.name)) continue;
        const k = ratio(seen(r), rgbOf(r.under));
        expect(k, `${c.id} ${r.name}: ${r.fill} on ${r.under}`).toBeGreaterThanOrEqual(4.5);
        checked++;
      }
      expect(checked + all.filter((r) => fixme(c.id, r.name)).length).toBe(NAMED.length + 1);
    });
  }

  // The pairs S23.6 left short. Each names its theme and room; delete the line in fixme() when it is fixed.
  for (const c of CASES) for (const n of [...NAMED.map((k) => `N-${k}`), "N-zone"]) {
    const why = fixme(c.id, n);
    if (why) test.fixme(`contrast: ${c.id} ${n} reaches 4.5:1 (${why})`, async ({ page }) => {
      await page.setContent(page_());
      const r = (await readAll(page, c.id)).find((x) => x.name === n)!;
      expect(ratio(seen(r), rgbOf(r.under))).toBeGreaterThanOrEqual(4.5);
    });
  }
});

// S23.3: a name whose every spot is covered is drawn on a plate over the icons. The plate is the outline colour, solid,
// and takes no clicks (the icons under it still do); the name on it mixes into that plate, so it reads in every theme.
const TAGGED = (() => {
  const devices = [];
  for (let x = 10; x < 300; x += 20) for (let y = 10; y < 120; y += 20) devices.push({ id: `s${x}-${y}`, type: "temp", entity: `sensor.t${x}_${y}`, x, y });
  const pts: [number, number][] = [[0, 0], [300, 0], [300, 120], [0, 120]];
  return { ...FLOOR, rooms: [room(0, "room", "Den", pts)], devices } as unknown as Floor;
})();
test.describe("S23.3 CSS pair: a name on a tag", () => {
  for (const c of CASES) {
    test(`the plate is solid --fp-outline, takes no clicks, and its name is at least 4.5:1 on it, ${c.id}`, async ({ page }) => {
      await page.setContent(`<!DOCTYPE html><html><body><style>${FLOORPLAN_CSS}</style><svg class="fp" id="s" viewBox="0 0 300 120" width="600" height="240">${renderFloor(TAGGED, { scale: 1, theme: c.t, dark: c.dark })}</svg></body></html>`);
      const r = await page.locator("#s").evaluate((svg) => {
        const probe = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        probe.setAttribute("style", "fill:var(--fp-outline)");
        svg.querySelector("g")!.appendChild(probe);
        const outline = getComputedStyle(probe).fill;
        probe.remove();
        const plate = getComputedStyle(svg.querySelector("rect.lbl-tag")!), text = getComputedStyle(svg.querySelector("text.lbl-on")!);
        return { outline, fill: plate.fill, op: plate.fillOpacity, opacity: plate.opacity, events: plate.pointerEvents, text: text.fill, textOpacity: text.opacity };
      });
      expect(r.fill).toBe(r.outline);
      expect([r.op, r.opacity, r.textOpacity]).toEqual(["1", "1", "1"]);
      expect(r.events).toBe("none");
      expect(ratio(rgbOf(r.text), rgbOf(r.fill)), `${r.text} on ${r.fill}`).toBeGreaterThanOrEqual(4.5);
    });
  }
});
