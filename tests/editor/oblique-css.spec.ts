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
