import { test, expect } from "@playwright/test";
import { FLOORPLAN_CSS, THEMES } from "../../src/core/render";

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
