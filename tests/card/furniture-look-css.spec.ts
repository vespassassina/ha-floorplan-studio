import { test, expect } from "@playwright/test";
import { FLOORPLAN_CSS, THEMES } from "../../src/core/render";
import { FURNITURE } from "../../src/core/icons";
import { FURNITURE_SYMBOLS } from "../../src/core/schema";

// S18.8 and S18.9 (finding 10): a string match on the stylesheet cannot see specificity, so each rule is read back from
// Chromium in every theme, light and dark. A symbol's own markup carries no colour; the stylesheet gives the fill.

const MODES = ["light", "dark"] as const;
const page_ = (body: string) => `<!DOCTYPE html><html><body><style>${FLOORPLAN_CSS}</style><svg>${THEMES.flatMap((t) => MODES.map((m) => `<g data-theme="${t}" data-mode="${m}" id="t-${t}-${m}">${body}</g>`)).join("")}</svg></body></html>`;
// A tree is drawn in its own colours (`.tree-crown`, `.tree-trunk`), not `.ff`, and does not light: its pair is in editor.spec.ts (S28.3).
const SYMBOLS = FURNITURE_SYMBOLS.filter((s) => s !== "tree");
const symbols = SYMBOLS.map((s) => `<g class="furn" data-s="${s}" color="var(--fp-furniture)">${FURNITURE[s].svg}</g><g class="furn on" data-s="${s}" data-on="1" color="var(--fp-furniture)">${FURNITURE[s].svg}</g>`).join("");
const waves = `<g class="furn-waves"><circle class="wave" r="10"/><circle class="wave w2" r="10"/></g><rect id="probe" style="fill:var(--fp-active)"/><rect id="bg" style="fill:var(--fp-room-empty)"/>`;

test("furniture CSS pair: every symbol is filled from the theme, and an on piece changes the pixel", async ({ page }) => {
  await page.setContent(page_(symbols + waves));
  for (const t of THEMES) for (const m of MODES) {
    const r = await page.locator(`#t-${t}-${m}`).evaluate((g) => {
      const fills = (on: string) => [...g.querySelectorAll(`g.furn[data-s]${on === "1" ? "[data-on]" : ":not([data-on])"}`)].map((el) => ({
        s: el.getAttribute("data-s"), ff: [...el.querySelectorAll(".ff")].map((e) => getComputedStyle(e).fill), stroke: getComputedStyle(el.querySelector(".ff, path")!).stroke,
      }));
      return { off: fills("0"), on: fills("1"), bg: getComputedStyle(g.querySelector("#bg")!).fill, active: getComputedStyle(g.querySelector("#probe")!).fill };
    });
    const tag = `${t}/${m}`;
    expect(r.off.length, tag).toBe(SYMBOLS.length);
    r.off.forEach((o, i) => {
      expect(o.ff.length, `${tag} ${o.s}: a filled shape`).toBeGreaterThan(0);
      for (const v of o.ff) { expect(v, `${tag} ${o.s}`).toMatch(/^(rgb|color)\(/); expect(v, `${tag} ${o.s}: not the plain room colour`).not.toBe(r.bg); }
      expect(r.on[i].ff, `${tag} ${o.s}: on is not the idle fill`).not.toEqual(o.ff);
      expect(r.on[i].stroke, `${tag} ${o.s}: on strokes in the on colour`).toBe(r.active);
    });
  }
});

test("furniture CSS pair: waves are in the on colour and take no clicks, in every theme", async ({ page }) => {
  await page.setContent(page_(waves));
  for (const t of THEMES) for (const m of MODES) {
    const r = await page.locator(`#t-${t}-${m}`).evaluate((g) => {
      const w = [...g.querySelectorAll(".furn-waves .wave")].map((e) => { const c = getComputedStyle(e); return { stroke: c.stroke, pe: c.pointerEvents, fill: c.fill }; });
      return { w, active: getComputedStyle(g.querySelector("#probe")!).fill };
    });
    expect(r.w.length, `${t}/${m}`).toBe(2);
    for (const x of r.w) { expect(x.stroke, `${t}/${m}`).toBe(r.active); expect(x.pe).toBe("none"); expect(x.fill).toBe("none"); }
  }
});
