import { test, expect } from "@playwright/test";
import { FLOORPLAN_CSS, THEMES } from "../../src/core/render";

// B53.5, finding 10: the FLOORPLAN_CSS string says nothing about specificity, so the rule that darkens a leg or a plinth is read back
// from Chromium as a computed colour in every theme. Remove `.blk-dark` and the dark faces equal the plain ones: this fails.
const faces = `<polygon class="bs" points="0,0 1,0 1,1"/><polygon class="bs w" points="0,0 1,0 1,1"/><polygon class="bt" points="0,0 1,0 1,1"/>`;
const body = `<g class="furn">${faces}</g><g class="furn"><g class="blk-dark">${faces}</g></g>`;
const plan = `<!DOCTYPE html><html><body><style>${FLOORPLAN_CSS}</style><svg>${THEMES.map((t) => `<g data-theme="${t}" data-mode="dark" id="t-${t}">${body}</g>`).join("")}</svg></body></html>`;
const lum = (rgb: string) => { const [r, g, b] = (rgb.match(/[\d.]+/g) ?? []).map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };

test("a leg or a plinth is its piece's own face colour 20 % darker, on every face, in every theme", async ({ page }) => {
  await page.setContent(plan);
  for (const t of THEMES) {
    const r = await page.locator(`#t-${t}`).evaluate((g) => {
      const fills = (e: Element) => Array.from(e.querySelectorAll("polygon")).map((p) => getComputedStyle(p).fill);
      return { plain: fills(g.children[0]), dark: fills(g.children[1]) };
    });
    expect(r.plain.length).toBe(3);
    r.plain.forEach((p, i) => {
      expect(r.dark[i], `${t} face ${i} differs`).not.toBe(p);
      expect(lum(r.dark[i]), `${t} face ${i} is darker`).toBeLessThan(lum(p));
      // 80 % of the face, 20 % black: each channel is 0.8 of the plain one (within rounding).
      const a = (p.match(/[\d.]+/g) ?? []).map(Number), b = (r.dark[i].match(/[\d.]+/g) ?? []).map(Number);
      a.slice(0, 3).forEach((v, k) => expect(Math.abs(b[k] - v * 0.8), `${t} face ${i} channel ${k}`).toBeLessThanOrEqual(1.5));
    });
  }
});
