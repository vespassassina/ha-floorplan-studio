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

  // S23 review S6: a theme may give outdoor names an ink of their own (--fp-text-out). Solarized does: its base1 is near
  // 3.2:1 on its outdoor shades. A theme without one keeps --fp-text, so the out name and a plain name on the same
  // surface are the same colour there.
  test("S6 CSS pair: an outdoor name takes --fp-text-out where the theme has one, --fp-text where it does not", async ({ page }) => {
    await page.setContent(page_());
    const pair = (id: string) => page.locator(`#s-${id}`).evaluate((svg) => {
      const mk = (cls: string) => {
        const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
        t.setAttribute("class", cls); t.setAttribute("data-rl", "0"); t.setAttribute("style", "--fp-under:var(--fp-garden)");
        svg.querySelector("g")!.appendChild(t);
        const fill = getComputedStyle(t).fill; t.remove(); return fill;
      };
      return { out: mk("lbl out"), plain: mk("lbl") };
    });
    const sol = await pair("solarized");
    expect(sol.out, "solarized: its outdoor ink").not.toBe(sol.plain);
    for (const id of ["light", "blueprint", "midnight"]) { const r = await pair(id); expect(r.out, id).toBe(r.plain); }
  });

  // S23 review S6: midnight's stair fill was light's #c4c0b8, a pale block on a navy plan. A dark theme's fill is dark.
  test("S6 CSS pair: midnight and Home Assistant dark have a dark stair fill and water", async ({ page }) => {
    await page.setContent(page_());
    for (const id of ["midnight", "ha-dark"]) {
      const [fill, water, bg] = await page.locator(`#s-${id}`).evaluate((svg) => ["--fp-fill", "--fp-water", "--fp-bg"].map((v) => {
        const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        r.setAttribute("style", `fill:var(${v})`); svg.querySelector("g")!.appendChild(r);
        const c = getComputedStyle(r).fill; r.remove(); return c;
      }));
      expect(lum(rgbOf(fill)), `${id} fill ${fill}`).toBeLessThan(0.1);
      expect(lum(rgbOf(water)), `${id} water ${water}`).toBeLessThan(0.15);
      expect(water, `${id}: water is not the background`).not.toBe(bg);
    }
  });

  for (const c of CASES) {
    test(`contrast: every name is at least 4.5:1 on its room, ${c.id}`, async ({ page }) => {
      await page.setContent(page_());
      const all = await readAll(page, c.id);
      expect(all.length).toBe(NAMED.length + 1);
      const short = all.map((r) => ({ r, k: ratio(seen(r), rgbOf(r.under)) })).filter((x) => x.k < 4.5)
        .map(({ r, k }) => `${r.name} ${k.toFixed(2)}:1 (${r.fill} on ${r.under})`);
      expect(short, c.id).toEqual([]);
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
        return { outline, fill: plate.fill, op: plate.fillOpacity, opacity: plate.opacity, events: plate.pointerEvents, textEvents: text.pointerEvents, text: text.fill, textOpacity: text.opacity };
      });
      expect(r.fill).toBe(r.outline);
      expect([r.op, r.opacity, r.textOpacity]).toEqual(["1", "1", "1"]);
      expect(r.events).toBe("none");
      // Opus review M1: the name on the plate takes no clicks either, or a tap on a device under it picks the room.
      expect(r.textEvents).toBe("none");
      expect(ratio(rgbOf(r.text), rgbOf(r.fill)), `${r.text} on ${r.fill}`).toBeGreaterThanOrEqual(4.5);
    });
  }
});
