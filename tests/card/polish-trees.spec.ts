import { test, expect, type Page } from "@playwright/test";
import { FLOORPLAN_CSS, THEMES } from "../../src/core/render";
import { roleStyle } from "../../src/card/three/palette";

// S28 final: two colour defects the 4x shots showed. (1) 3D crowns were dark grey on a dark ground at night; (2) 2.5D trunks were
// paler than the crown they hold up in dark themes. Read back from Chromium in every theme, plus ha in dark mode (finding 17), through
// the palette's own role expressions, so what is measured is what the viewer paints.
const CASES = [...THEMES.map((t) => ({ t, mode: "light" })), { t: "ha", mode: "dark" }] as const;
/** What night does to a surface in linear light. Measured, not the hemisphere light's 0.5: the blueprint crown's (102, 113, 128) shows as about (45, 50, 60) in the 4x shot, a linear factor of 0.2
 * (hemisphere 0.5, a crown facet turned from the sky, and tone mapping). Ground and crown share it, so the ratio is the palette's. */
const NIGHT_LIGHT = 0.2;

const crownCss = roleStyle("tree-crown").css, gardenCss = roleStyle("room-garden").css, planeCss = roleStyle("ground").css; // a tree stands on a garden or, outside every room, on the ground plane
const body = `<rect class="p-crown3" style="fill:${crownCss}"/><rect class="p-ground3" style="fill:${gardenCss}"/><rect class="p-plane3" style="fill:${planeCss}"/>
<rect class="p-bg" style="fill:var(--fp-bg)"/><rect class="p-text" style="fill:var(--fp-text)"/><rect class="p-garden" style="fill:var(--fp-garden)"/>
<path class="tree-crown" d="M0 0h1v1z"/><line class="trunk" x1="0" y1="0" x2="1" y2="1"/>`;
const html = `<!DOCTYPE html><html><body><style>${FLOORPLAN_CSS}</style><svg>${CASES.map((c, i) => `<g id="c${i}" data-theme="${c.t}" data-mode="${c.mode}">${body}</g>`).join("")}</svg></body></html>`;

const rgb = (s: string): number[] => {
  const srgb = /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/.exec(s);
  if (srgb) return srgb.slice(1, 4).map(Number);
  const m = /rgba?\((\d+), (\d+), (\d+)/.exec(s);
  if (!m) throw new Error(`not a colour: ${s}`);
  return m.slice(1, 4).map((v) => Number(v) / 255);
};
const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const lum = (c: number[], k = 1) => { const [r, g, b] = c.map((v) => lin(v) * k); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

async function read(page: Page) {
  await page.setContent(html);
  return page.evaluate((n) => Array.from({ length: n }, (_, i) => {
    const g = document.getElementById(`c${i}`)!, cs = (sel: string) => getComputedStyle(g.querySelector(sel)!);
    return { crown3: cs(".p-crown3").fill, ground3: cs(".p-ground3").fill, plane3: cs(".p-plane3").fill, bg: cs(".p-bg").fill, text: cs(".p-text").fill, garden: cs(".p-garden").fill, crown: cs(".tree-crown").fill, op: cs(".tree-crown").fillOpacity, trunk: cs(".trunk").stroke };
  }), CASES.length);
}

test("S28 final: a 3D crown reads against the ground at 1.8:1 at night in every dark theme, and by day too", async ({ page }) => {
  const r = await read(page);
  CASES.forEach((c, i) => {
    const v = r[i], dark = lum(rgb(v.bg)) < lum(rgb(v.text)), tag = `${c.t}/${c.mode}`;
    const against = (k: number) => Math.min(...[v.ground3, v.plane3].map((g) => ratio(lum(rgb(v.crown3), k), lum(rgb(g), k))));
    const day = against(1), night = against(NIGHT_LIGHT);
    if (dark) expect.soft(night, `${tag}: night ${night.toFixed(2)}`).toBeGreaterThanOrEqual(1.8);
    expect.soft(day, `${tag}: day ${day.toFixed(2)}`).toBeGreaterThanOrEqual(1.3);
    // not bright: a dark theme's crown stays a mid tone (relative luminance under 0.5, about sRGB 190 grey), so it does not glare by day
    if (dark) expect.soft(lum(rgb(v.crown3)), `${tag}: not bright`).toBeLessThan(0.5);
  });
});
