import { test, expect } from "@playwright/test";
import { FLOORPLAN_CSS, THEMES } from "../../src/core/render";

// S23.6 (finding 10): every surface follows the theme. Read back from Chromium in every theme, plus ha in dark mode,
// never a hand-picked subset. The label colour is the one the labels task (S23.1) gives a name on an empty room:
// --fp-text mixed 92 % into the colour under it.

const CASES = [...THEMES.map((t) => ({ t, mode: "light" })), { t: "ha", mode: "dark" }] as const;
const body = `<polygon class="room room-room" points="0,0 10,0 10,10"/>
<polygon class="room room-garden" points="0,0 10,0 10,10"/><polygon class="room room-terrace" points="0,0 10,0 10,10"/>
<polygon class="room room-pavement" points="0,0 10,0 10,10"/>
<polygon class="room room-room paint" fill="#cc3333" points="0,0 10,0 10,10"/>
<path class="stairs room paint-stairs" fill="#cc3333" d="M0 0H10V10Z"/>
<polygon class="room on ring" fill="none" points="0,0 10,0 10,10"/>
<g class="furn" color="var(--fp-furniture)"><rect class="ff" width="5" height="5"/></g>
<rect class="p-bg" style="fill:var(--fp-bg)"/><rect class="p-text" style="fill:var(--fp-text)"/><rect class="p-furn" style="fill:var(--fp-furniture)"/>
<rect class="p-label" style="fill:color-mix(in srgb,var(--fp-text) 92%,var(--fp-room-empty))"/>`;
const html = `<!DOCTYPE html><html><body><style>${FLOORPLAN_CSS}</style><svg>${CASES.map((c, i) => `<g id="c${i}" data-theme="${c.t}" data-mode="${c.mode}">${body}</g>`).join("")}</svg></body></html>`;

/** Parses Chromium's computed colour, either rgb()/rgba() or color(srgb r g b), into 0..1 channels. */
const rgb = (s: string): number[] => {
  const srgb = /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/.exec(s);
  if (srgb) return srgb.slice(1, 4).map(Number);
  const m = /rgba?\((\d+), (\d+), (\d+)/.exec(s);
  if (!m) throw new Error(`not a colour: ${s}`);
  return m.slice(1, 4).map((v) => Number(v) / 255);
};
const lum = (s: string) => { const [r, g, b] = rgb(s).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

async function read(page: import("@playwright/test").Page) {
  await page.setContent(html);
  return page.evaluate((n) => Array.from({ length: n }, (_, i) => {
    const g = document.getElementById(`c${i}`)!;
    const cs = (sel: string) => getComputedStyle(g.querySelector(sel)!);
    return {
      empty: cs(".room-room:not([fill])").fill, garden: cs(".room-garden").fill, terrace: cs(".room-terrace").fill, pavement: cs(".room-pavement").fill,
      bg: cs(".p-bg").fill, text: cs(".p-text").fill, furn: cs(".p-furn").fill, label: cs(".p-label").fill, ff: cs(".furn .ff").fill,
      paintFill: cs(".paint").fill, paintFilter: cs(".paint").filter, stairsFilter: cs(".paint-stairs").filter,
      emptyFilter: cs(".room-room:not([fill])").filter, ringFilter: cs(".ring").filter,
    };
  }), CASES.length);
}

test("S23.6 theme surfaces: the empty room stands off the board and sits on the theme's side, in every theme", async ({ page }) => {
  const r = await read(page);
  CASES.forEach((c, i) => {
    const v = r[i], tag = `${c.t}/${c.mode}`;
    expect(contrast(v.empty, v.bg), `${tag}: empty room vs board`).toBeGreaterThanOrEqual(1.09);
    // the theme's side: an empty room is nearer the board than the text, so a dark theme never shows a light-grey hole
    expect(contrast(v.empty, v.bg), `${tag}: empty room nearer the board than the text`).toBeLessThan(contrast(v.empty, v.text));
    expect(contrast(v.label, v.empty), `${tag}: a name on an empty room`).toBeGreaterThanOrEqual(4.5);
  });
});

test("S23.6 theme surfaces: garden, terrace and pavement sit on the theme's side, in every theme", async ({ page }) => {
  const r = await read(page);
  CASES.forEach((c, i) => {
    const v = r[i], tag = `${c.t}/${c.mode}`;
    for (const k of ["garden", "terrace", "pavement"] as const) {
      expect(contrast(v[k], v.bg), `${tag}: ${k} nearer the board than the text`).toBeLessThan(contrast(v[k], v.text));
    }
  });
});

test("S23.6 theme surfaces: furniture comes from the theme and reads on the empty room", async ({ page }) => {
  const r = await read(page);
  CASES.forEach((c, i) => {
    const v = r[i], tag = `${c.t}/${c.mode}`;
    const dark = lum(v.bg) < lum(v.text);
    if (dark) expect(v.furn, `${tag}: a dark theme's furniture is not the light theme's grey`).not.toBe("rgb(121, 118, 110)");
    expect(contrast(v.furn, v.empty), `${tag}: furniture edge vs empty room`).toBeGreaterThanOrEqual(1.8);
    expect(v.ff, `${tag}: the body is not the bare empty room`).not.toBe(v.empty);
  });
});

test("S23.6 theme surfaces: user paint is dimmed on dark themes, never recoloured", async ({ page }) => {
  const r = await read(page);
  CASES.forEach((c, i) => {
    const v = r[i], tag = `${c.t}/${c.mode}`;
    const dark = lum(v.bg) < lum(v.text);
    expect(v.paintFill, `${tag}: the paint itself is untouched`).toBe("rgb(204, 51, 51)");
    expect(v.emptyFilter, `${tag}: an empty room is not filtered`).toBe("none");
    expect(v.ringFilter, `${tag}: the on ring is not filtered`).toBe("none");
    if (dark) {
      expect(v.paintFilter, `${tag}: paint dimmed`).toMatch(/brightness\(0?\.\d+\)/);
      expect(v.stairsFilter, `${tag}: painted stairs dimmed`).toBe(v.paintFilter);
    } else {
      expect(v.paintFilter, `${tag}: a light theme leaves paint alone`).toBe("none");
      expect(v.stairsFilter, `${tag}`).toBe("none");
    }
  });
});
