import { test, expect } from "@playwright/test";
import { FLOORPLAN_CSS, THEMES } from "../../src/core/render";

// B55.3, findings 10 and 18: the room badges' colours and click rules, read back from Chromium as computed values in every theme.
// Each lit colour is compared with the token it must wear and with the idle grey, so a rule that never reaches the pixel fails.
const badge = (cls: string) => `<g class="cb ${cls}"><circle class="cb-bg" r="9"/><path class="cb-i" d="M0 0h1"/></g>`;
const probe = (v: string) => `<g class="probe" style="fill:var(${v})"><path d="M0 0"/></g>`;
// order matters: read() indexes into it
const KINDS: [string, string][] = [
  ["cb-lights on", "--fp-dev-light"], ["cb-motion on", "--fp-dev-motion"], ["cb-energy on", "--fp-on"],
  ["cb-climate on cb-heat", "--fp-dev-ac-heat"], ["cb-climate on cb-cool", "--fp-dev-ac-cool"],
];
const BODY = KINDS.map(([c]) => badge(c)).join("") + badge("cb-lights") + badge("cb-lights cb-ed") + KINDS.map(([, v]) => probe(v)).join("") + probe("--fp-idle") + probe("--fp-outline");
const plan = `<!DOCTYPE html><html><body><style>${FLOORPLAN_CSS}</style><svg>${THEMES.map((t) => `<g data-theme="${t}" data-mode="dark" id="t-${t}">${BODY}</g>`).join("")}</svg></body></html>`;

const read = (page: import("@playwright/test").Page, t: string) => page.locator(`#t-${t}`).evaluate((g) => {
  const c = Array.from(g.children), css = (e: Element | null) => getComputedStyle(e!), fill = (i: number, s: string) => css(c[i].querySelector(s)).fill;
  const n = 5;
  return {
    lit: Array.from({ length: n }, (_, i) => fill(i, ".cb-i")), tokens: Array.from({ length: n }, (_, i) => css(c[n + 2 + i].querySelector("path")).fill),
    idle: fill(n, ".cb-i"), idleToken: css(c[2 * n + 2].querySelector("path")).fill, plate: fill(n, ".cb-bg"), plateToken: css(c[2 * n + 3].querySelector("path")).fill,
    plateOpacity: css(c[n].querySelector(".cb-bg")).fillOpacity, stroke: css(c[n].querySelector(".cb-bg")).stroke,
    card: css(c[n]).pointerEvents, cardCircle: css(c[n].querySelector(".cb-bg")).pointerEvents, editor: css(c[n + 1]).pointerEvents, editorCircle: css(c[n + 1].querySelector(".cb-bg")).pointerEvents,
  };
});

test("a lit badge wears its device colour in every theme; an unlit one is the idle grey", async ({ page }) => {
  await page.setContent(plan);
  for (const t of THEMES) {
    const r = await read(page, t);
    KINDS.forEach(([c], i) => {
      expect(r.lit[i], `${t}: ${c}`).toBe(r.tokens[i]);
      expect(r.lit[i], `${t}: ${c} is not the idle grey`).not.toBe(r.idle);
    });
    expect(r.idle, `${t}: unlit`).toBe(r.idleToken);
  }
});

test("the plate is the outline colour at 85 % with an idle-grey ring", async ({ page }) => {
  await page.setContent(plan);
  for (const t of THEMES) {
    const r = await read(page, t);
    expect(r.plate, t).toBe(r.plateToken);
    expect(r.plateOpacity, t).toBe("0.85");
    expect(r.stroke, `${t}: ring`).toBe(r.idleToken);
  }
});

test("the card's badge takes the pointer, its glyphs too; the editor's takes none", async ({ page }) => {
  await page.setContent(plan);
  for (const t of THEMES) {
    const r = await read(page, t);
    expect([r.card, r.cardCircle], t).toEqual(["all", "all"]);
    expect([r.editor, r.editorCircle], t).toEqual(["none", "none"]);
  }
});
