import { test, expect } from "@playwright/test";
import { FLOORPLAN_CSS, THEMES } from "../../src/core/render";

// Moved from tests/editor in S12.1: the editor has no 2.5D any more, the card does.
// 2.5D CSS pairs (CLAUDE.md finding 10). The string tests in render.test.ts prove nothing about specificity or
// inheritance, so each rule that carries the 2.5D look is read back from Chromium, in every theme (finding 17).
// A bare page with FLOORPLAN_CSS, one `<g data-theme>` per theme, like theme-css.spec.ts.

const plan = (body: string) => `<!DOCTYPE html><html><body><style>${FLOORPLAN_CSS}</style><svg>${THEMES.map((t) => `<g data-theme="${t}" data-mode="dark" id="t-${t}">${body}</g>`).join("")}</svg></body></html>`;

test("2.5D CSS pair: a wall's side and top resolve in every theme, the side is its own shade, the top keeps the flat colour", async ({ page }) => {
  await page.setContent(plan(`<polygon class="ws" points="0,0 1,0 1,1"/><line class="e top" x1="0" y1="0" x2="1" y2="1"/><line class="e" x1="0" y1="0" x2="1" y2="1"/><line class="e external top" x1="0" y1="0" x2="1" y2="1"/><line class="e external" x1="0" y1="0" x2="1" y2="1"/>`));
  for (const t of THEMES) {
    const r = await page.locator(`#t-${t}`).evaluate((g) => {
      const c = (el: Element, p: string) => getComputedStyle(el).getPropertyValue(p).trim();
      const [side, top, flat, extTop, ext] = [...g.children];
      return { token: c(g, "--fp-wall-side"), topToken: c(g, "--fp-wall-top"), sideFill: c(side, "fill"), sidePe: c(side, "pointer-events"), top: c(top, "stroke"), flat: c(flat, "stroke"), extTop: c(extTop, "stroke"), ext: c(ext, "stroke") };
    });
    expect(r.token, `${t}: --fp-wall-side resolves`).not.toBe("");
    expect(r.topToken, `${t}: --fp-wall-top resolves`).not.toBe("");
    expect(r.sideFill, t).toMatch(/^(rgb|color)\(/);
    expect(r.sideFill, `${t}: the side is not the top colour`).not.toBe(r.top);
    expect(r.top, `${t}: the top draws as the flat wall`).toBe(r.flat);
    expect(r.extTop, `${t}: an external top keeps its own colour`).toBe(r.ext);
    expect(r.sidePe, t).toBe("none");
  }
});

test("2.5D CSS pair: boxes, glass, panels, stems and trunks resolve in every theme and take no clicks", async ({ page }) => {
  await page.setContent(plan(`<polygon class="bt" points="0,0 1,0 1,1"/><polygon class="bs" points="0,0 1,0 1,1"/><polygon class="bs w" points="0,0 1,0 1,1"/><g class="obj"><polygon class="bs" points="0,0 1,0 1,1"/></g>
<polygon class="glass g-window" points="0,0 1,0 1,1"/><polygon class="glass g-glass" points="0,0 1,0 1,1"/><polygon class="ws sealed" points="0,0 1,0 1,1"/><polygon class="ws fence" points="0,0 1,0 1,1"/><polygon class="ws" points="0,0 1,0 1,1"/>
<line class="stem" x1="0" y1="0" x2="1" y2="1"/><circle class="stem-top" r="1"/><line class="trunk" x1="0" y1="0" x2="1" y2="1"/>`));
  for (const t of THEMES) {
    const r = await page.locator(`#t-${t}`).evaluate((g) => {
      const c = (el: Element, p: string) => getComputedStyle(el).getPropertyValue(p).trim();
      const k = [...g.children];
      return {
        lid: c(k[0], "fill"), side: c(k[1], "fill"), sideW: c(k[2], "fill"), edge: c(k[1], "stroke"), furn: c(g, "--fp-furniture"), objPe: c(k[3], "pointer-events"), wallSide: c(k[8], "fill"),
        window: c(k[4], "fill"), glass: c(k[5], "fill"), glassOpacity: c(k[4], "fill-opacity"), glassPe: c(k[4], "pointer-events"), sealed: c(k[6], "fill"), fence: c(k[7], "fill"),
        stem: c(k[9], "stroke"), stemDot: c(k[10], "fill"), stemPe: c(k[9], "pointer-events"), trunk: c(k[11], "stroke"), trunkPe: c(k[11], "pointer-events"),
      };
    });
    expect(new Set([r.lid, r.side, r.sideW]).size, `${t}: lid, side and west side are three shades`).toBe(3);
    for (const v of [r.lid, r.side, r.sideW, r.window, r.glass, r.sealed, r.fence, r.stem, r.stemDot, r.trunk]) expect(v, t).toMatch(/^(rgb|color)\(/);
    expect(r.edge, t).not.toBe("none");
    // Role-generated themes give window and glass the same colour on purpose (theme-roles.ts), as in 2D; so no inequality here.
    expect(Number(r.glassOpacity), t).toBeLessThan(1);
    expect(r.sealed, `${t}: a sealed panel is not wall-coloured`).not.toBe(r.wallSide);
    expect(r.fence, t).not.toBe(r.wallSide);
    expect([r.objPe, r.glassPe, r.stemPe, r.trunkPe], t).toEqual(["none", "none", "none", "none"]);
  }
});

// Opus review of Sprint 23, S2: in Home Assistant's dark mode --fp-wall is HA's primary text colour, a light grey, so a side
// face 55% of it into the card background was a light grey slab on a dark plan. On HA dark the face takes less of the wall
// (--fp-wall-side-share) and stays closer to the dark card than to the light text. Read in a shadow root through :host, as the
// card draws it, and in a nested theme group; with HA's own dark variables set. Every other theme keeps 55%.
const HA_DARK_VARS = "--primary-text-color:#e1e1e1;--card-background-color:#1c1c1c;--secondary-background-color:#282828;--secondary-text-color:#9b9b9b";
const lum = (rgb: number[]) => { const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a: number[], b: number[]) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const rgbOf = (css: string): number[] => {
  const m = /color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)/.exec(css);
  if (m) return [m[1], m[2], m[3]].map((v) => Number(v) * 255);
  return (css.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
};
/** The side face, the wall, the background and the old 55% mix, as Chromium paints them in probe group `g`. */
const readSide = (g: Element) => {
  const c = (el: Element, p: string) => getComputedStyle(el).getPropertyValue(p).trim();
  const [side, wall, bg, at55] = [...g.children];
  return { side: c(side, "fill"), wall: c(wall, "fill"), bg: c(bg, "fill"), at55: c(at55, "fill") };
};
const PROBES = `<polygon class="ws" points="0,0 1,0 1,1"/><rect style="fill:var(--fp-wall)"/><rect style="fill:var(--fp-bg)"/><rect style="fill:color-mix(in srgb,var(--fp-wall) 55%,var(--fp-bg))"/>`;

test("2.5D CSS pair: on Home Assistant dark a wall's side is dark, nearer the card than the text; through :host and in a theme group", async ({ page }) => {
  await page.setContent(`<!DOCTYPE html><html><body style="${HA_DARK_VARS}"><div id="host" data-theme="ha" data-mode="dark"></div>
<style>${FLOORPLAN_CSS}</style><svg><g data-theme="ha" data-mode="dark" data-probe>${PROBES}</g></svg></body></html>`);
  await page.evaluate(([css, probes]) => {
    document.getElementById("host")!.attachShadow({ mode: "open" }).innerHTML = `<style>${css}</style><svg class="fp"><g data-probe id="in-host">${probes}</g></svg>`;
  }, [FLOORPLAN_CSS, PROBES] as const);
  const viaHost = await page.locator("#in-host").evaluate(readSide), inGroup = await page.locator("body > svg [data-probe]").evaluate(readSide);
  for (const [where, r] of [["host", viaHost], ["group", inGroup]] as const) {
    expect(rgbOf(r.wall), `${where}: HA's text colour reached the wall`).toEqual([225, 225, 225]);
    expect(r.side, `${where}: not the 55% slab`).not.toBe(r.at55);
    const toBg = ratio(rgbOf(r.side), rgbOf(r.bg)), toWall = ratio(rgbOf(r.side), rgbOf(r.wall));
    expect(toBg, `${where}: ${r.side} is nearer the card ${r.bg} than the text ${r.wall}`).toBeLessThan(toWall);
    expect(toBg, `${where}: still a face, not the floor`).toBeGreaterThan(1.5);
  }
});

test("2.5D CSS pair: every theme but Home Assistant dark keeps its side at 55% of the wall", async ({ page }) => {
  await page.setContent(`<!DOCTYPE html><html><body style="${HA_DARK_VARS}"><style>${FLOORPLAN_CSS}</style><svg>${THEMES.map((t) =>
    `<g data-theme="${t}" id="l-${t}" data-probe>${PROBES}</g>`).join("")}<g data-theme="midnight" data-mode="dark" id="d-midnight" data-probe>${PROBES}</g>
<g data-theme="ha" data-mode="dark"><g data-theme="blueprint" id="nested" data-probe>${PROBES}</g></g></svg></body></html>`);
  // "nested": a theme group inside an HA dark one does not inherit HA dark's share.
  for (const id of [...THEMES.map((t) => `l-${t}`), "d-midnight", "nested"]) {
    const r = await page.locator(`#${id}`).evaluate(readSide);
    expect(r.side, id).toBe(r.at55);
  }
});
