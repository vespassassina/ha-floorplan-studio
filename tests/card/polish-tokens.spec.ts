import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { FLOORPLAN_CSS, THEMES } from "../../src/core/render";

// S28.1: the tokens Sprint 28 draws with. Read back from Chromium in every theme, plus ha in dark mode, never a subset
// (finding 17). Nothing draws them yet; later lanes do, and these bounds are what they rely on.

const CASES = [...THEMES.map((t) => ({ t, mode: "light" })), { t: "ha", mode: "dark" }] as const;
const body = `<polygon class="room room-garden" points="0,0 10,0 10,10"/>
<rect class="p-bg" style="fill:var(--fp-bg)"/><rect class="p-text" style="fill:var(--fp-text)"/><rect class="p-wall-side" style="fill:var(--fp-wall-side)"/>
<rect class="p-tree" style="fill:var(--fp-tree)"/><rect class="p-tree-edge" style="fill:var(--fp-tree-edge)"/>
<rect class="p-frame" style="fill:var(--fp-frame)"/><rect class="p-shade" style="fill:var(--fp-shade)"/><rect class="p-ink" style="fill:var(--fp-on-light)"/>`;
const html = `<!DOCTYPE html><html><body><style>${FLOORPLAN_CSS}</style><svg>${CASES.map((c, i) => `<g id="c${i}" data-theme="${c.t}" data-mode="${c.mode}">${body}</g>`).join("")}</svg></body></html>`;

const rgb = (s: string): number[] => {
  const srgb = /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/.exec(s);
  if (srgb) return srgb.slice(1, 4).map(Number);
  const m = /rgba?\((\d+), (\d+), (\d+)/.exec(s);
  if (!m) throw new Error(`not a colour: ${s}`);
  return m.slice(1, 4).map((v) => Number(v) / 255);
};
const lum = (s: string) => { const [r, g, b] = rgb(s).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

async function read(page: Page) {
  await page.setContent(html);
  return page.evaluate((n) => Array.from({ length: n }, (_, i) => {
    const g = document.getElementById(`c${i}`)!;
    const fill = (sel: string) => getComputedStyle(g.querySelector(sel)!).fill;
    return {
      garden: fill(".room-garden"), bg: fill(".p-bg"), text: fill(".p-text"), wallSide: fill(".p-wall-side"), tree: fill(".p-tree"), edge: fill(".p-tree-edge"),
      frame: fill(".p-frame"), raw: ["--fp-tree", "--fp-tree-edge", "--fp-frame", "--fp-shade", "--fp-shade-alpha"].map((k) => getComputedStyle(g).getPropertyValue(k).trim()), shade: fill(".p-shade"), onLight: fill(".p-ink"), alpha: getComputedStyle(g).getPropertyValue("--fp-shade-alpha").trim(),
    };
  }), CASES.length);
}

test("S28.1 tokens: every theme resolves --fp-tree, --fp-tree-edge, --fp-frame, --fp-shade and --fp-shade-alpha", async ({ page }) => {
  const r = await read(page);
  CASES.forEach((c, i) => {
    const v = r[i], tag = `${c.t}/${c.mode}`;
    for (const k of ["tree", "edge", "frame", "shade"] as const) expect(() => rgb(v[k]), `${tag}: ${k}`).not.toThrow();
    expect(v.shade, `${tag}: the shade is the theme's near-black`).toBe(v.onLight);
    const a = Number(v.alpha);
    expect(Number.isFinite(a) && a > 0 && a < 1, `${tag}: alpha ${v.alpha}`).toBe(true);
  });
});

test("S28.1 tokens: the crown edge reads against the garden at 3:1, in every theme", async ({ page }) => {
  const r = await read(page);
  CASES.forEach((c, i) => expect(r[i].raw[1], `${c.t}/${c.mode}: --fp-tree-edge is declared`).not.toBe(""));
  CASES.forEach((c, i) => expect(contrast(r[i].edge, r[i].garden), `${c.t}/${c.mode}`).toBeGreaterThanOrEqual(3));
});

test("S28.1 tokens: the door frame reads against the wall side at 1.5:1, in every theme", async ({ page }) => {
  const r = await read(page);
  CASES.forEach((c, i) => expect(r[i].raw[2], `${c.t}/${c.mode}: --fp-frame is declared`).not.toBe(""));
  CASES.forEach((c, i) => expect(contrast(r[i].frame, r[i].wallSide), `${c.t}/${c.mode}`).toBeGreaterThanOrEqual(1.5));
});

test("S28.1 tokens: the shade is stronger on every dark theme than on every light one, by a real step", async ({ page }) => {
  const r = await read(page);
  const dark = CASES.map((_, i) => lum(r[i].bg) < lum(r[i].text));
  const a = r.map((v) => Number(v.alpha));
  const darkA = a.filter((_, i) => dark[i]), lightA = a.filter((_, i) => !dark[i]);
  expect(darkA.length).toBeGreaterThan(0);
  expect(lightA.length).toBeGreaterThan(0);
  expect(Math.min(...darkA) - Math.max(...lightA)).toBeGreaterThanOrEqual(0.1);
});

test("S28.1 tokens: the Studio resolves them too, in blueprint, light and ha", async ({ page }) => {
  for (const theme of ["blueprint", "light", "ha"]) {
    await page.addInitScript((t) => localStorage.setItem("floorplan-studio:theme", t), theme);
    await page.goto("/standalone.html");
    await expect(page.locator("floorplan-studio-editor svg polygon[data-r]").first()).toBeVisible();
    const got = await page.evaluate(() => {
      const host = document.querySelector("floorplan-studio-editor")!;
      const cs = getComputedStyle(host);
      return ["--fp-tree", "--fp-tree-edge", "--fp-frame", "--fp-shade", "--fp-shade-alpha"].map((k) => cs.getPropertyValue(k).trim());
    });
    got.forEach((v, i) => expect(v, `${theme}: token ${i}`).not.toBe(""));
  }
});

test("S28.1 shots: the polish set is declared in the script", () => {
  const src = readFileSync("scripts/shots.mjs", "utf8");
  expect(src).toContain("--polish");
  expect(src).toContain("shots/current/polish");
});
