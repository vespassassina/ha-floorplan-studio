import { test, expect } from "@playwright/test";
import { FLOORPLAN_CSS, THEMES } from "../../src/core/render";

// B53.12, finding 10: the shower's glass and the mirrors are rules (`.blk-glass`, `.blk-mirror`), and a rule read as a string says
// nothing about specificity or about paint. Each is read back from Chromium as a computed colour in every theme, on a piece that wears
// a loud paint (--fp-box-* set to red, green and blue, as a painted piece does): glass and mirror must ignore all three.
const faces = `<polygon class="bs" points="0,0 1,0 1,1"/><polygon class="bs w" points="0,0 1,0 1,1"/><polygon class="bt" points="0,0 1,0 1,1"/>`;
const PAINT = "--fp-box-top:#ff0000;--fp-box-side:#00ff00;--fp-box-side-w:#0000ff";
const probe = (v: string) => `<g style="fill:var(${v})"><path d="M0 0"/></g>`;
const body = `<g class="furn" style="${PAINT}"><g class="blk-glass">${faces}</g></g><g class="furn" style="${PAINT}"><g class="blk-mirror">${faces}</g></g><g class="furn" style="${PAINT}">${faces}</g>${probe("--fp-glass")}${probe("--fp-mirror")}`;
const plan = `<!DOCTYPE html><html><body><style>${FLOORPLAN_CSS}</style><svg>${THEMES.map((t) => `<g data-theme="${t}" data-mode="dark" id="t-${t}">${body}</g>`).join("")}</svg></body></html>`;
// Chromium answers a colour-mix as color(srgb r g b) in 0..1 and a plain colour as rgb(r, g, b) in 0..255.
const lum = (rgb: string) => { const k = rgb.startsWith("color(") ? 255 : 1; const [r, g, b] = (rgb.replace("srgb", "").match(/[\d.]+/g) ?? []).map((v) => Number(v) * k); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };

test("a shower wall is the theme's glass, translucent, whatever the paint; a mirror is the theme's mirror colour, its top the lightest", async ({ page }) => {
  await page.setContent(plan);
  for (const t of THEMES) {
    const r = await page.locator(`#t-${t}`).evaluate((g) => {
      const st = (e: Element) => Array.from(e.querySelectorAll("polygon")).map((p) => ({ fill: getComputedStyle(p).fill, op: getComputedStyle(p).fillOpacity }));
      const c = Array.from(g.children);
      return { glass: st(c[0]), mirror: st(c[1]), plain: st(c[2]), glassTok: getComputedStyle(c[3].querySelector("path")!).fill, mirrorTok: getComputedStyle(c[4].querySelector("path")!).fill };
    });
    expect(r.mirrorTok, `${t}: --fp-mirror is defined`).not.toBe("");
    // glass: all three faces the glass token, all see-through, none the paint
    for (const f of r.glass) { expect(f.fill, `${t} glass`).toBe(r.glassTok); expect(Number(f.op), `${t} glass opacity`).toBeLessThan(0.6); expect(Number(f.op)).toBeGreaterThan(0.1); }
    // mirror: side is the token, west side darker, top lighter; none of the paint colours
    const [side, west, top] = r.mirror.map((f) => f.fill);
    expect(side, `${t} mirror side`).toBe(r.mirrorTok);
    expect(lum(top), `${t} top is lighter than side`).toBeGreaterThan(lum(side));
    expect(lum(west), `${t} west is darker than side`).toBeLessThan(lum(side));
    for (const f of r.mirror) expect(Number(f.op), `${t} mirror is opaque`).toBe(1);
    // the control: the same faces without the class do wear the paint, so the test could see it
    expect(r.plain.map((f) => f.fill)).toEqual(["rgb(0, 255, 0)", "rgb(0, 0, 255)", "rgb(255, 0, 0)"]);
  }
});

test("the mirror colour is its own token in every theme, apart from the glass blue", async ({ page }) => {
  await page.setContent(plan);
  for (const t of THEMES) {
    const r = await page.locator(`#t-${t}`).evaluate((g) => ({ glass: getComputedStyle(g.children[3].querySelector("path")!).fill, mirror: getComputedStyle(g.children[4].querySelector("path")!).fill }));
    expect(r.mirror, t).not.toBe(r.glass);
  }
});
