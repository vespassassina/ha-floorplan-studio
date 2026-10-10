import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { FLOORPLAN_CSS, THEMES, renderFloor } from "../../src/core/render";
import type { Layout } from "../../src/core/schema";

// S28.3: the 2D tree on the real element, in every theme (finding 17): the crown's fill and edge, the trunk dot and the shade patch
// resolve to the tokens, the patch takes no click, and the crown edge reads against the garden it stands on at 3:1 (S28.1 checks the
// token; this reads the painted element). The markup is renderFloor's own, in the real stylesheet.
const demo = JSON.parse(readFileSync("demo/layout.json", "utf8")) as Layout;
const floor = structuredClone(demo.floors.ground!);
floor.furniture = [{ id: "t", symbol: "tree", x: 868, y: 408, rot: 20, w: 50, h: 70 } as never];
const CASES = [...THEMES.map((t) => ({ t, dark: false })), { t: "ha", dark: true }];
const html = `<!DOCTYPE html><html><body style="margin:0"><style>${FLOORPLAN_CSS}</style>${CASES.map((c, i) => `<svg id="c${i}" width="400" height="400" viewBox="800 330 150 150">${renderFloor(floor, { scale: 1, theme: c.t, dark: c.dark } as never)}</svg>`).join("")}</body></html>`;

const rgb = (s: string): number[] => {
  const srgb = /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/.exec(s);
  if (srgb) return srgb.slice(1, 4).map(Number);
  const m = /rgba?\((\d+), (\d+), (\d+)/.exec(s);
  if (!m) throw new Error(`not a colour: ${s}`);
  return m.slice(1, 4).map((v) => Number(v) / 255);
};
const lum = (s: string) => { const [r, g, b] = rgb(s).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test("S28.3 the tree's crown, trunk and shade resolve to their tokens in every theme, and the edge reads on the garden at 3:1", async ({ page }) => {
  await page.setContent(html);
  const r = await page.evaluate((n) => Array.from({ length: n }, (_, i) => {
    const svg = document.getElementById(`c${i}`)!;
    const s = (sel: string) => getComputedStyle(svg.querySelector(sel)!);
    const root = getComputedStyle(svg.firstElementChild!);
    return {
      crown: { fill: s(".tree-crown").fill, op: s(".tree-crown").fillOpacity, stroke: s(".tree-crown").stroke, w: s(".tree-crown").strokeWidth },
      trunk: s(".tree-trunk").fill, shade: { fill: s(".tree-shade").fill, op: s(".tree-shade").fillOpacity, events: s(".tree-shade").pointerEvents },
      garden: s("polygon.room-garden").fill, tree: root.getPropertyValue("--fp-tree").trim(), edge: root.getPropertyValue("--fp-tree-edge").trim(), alpha: root.getPropertyValue("--fp-shade-alpha").trim(),
      ink: root.getPropertyValue("--fp-on-light").trim(),
    };
  }), CASES.length);
  CASES.forEach((c, i) => {
    const v = r[i], tag = `${c.t}/${c.dark ? "dark" : "light"}`;
    expect(v.crown.op, tag).toBe("0.35");
    expect(v.crown.w, tag).toBe("1px");
    expect(v.crown.stroke, tag).toBe(v.trunk);
    expect(v.crown.fill, tag).not.toBe(v.garden);
    expect(contrast(v.crown.stroke, v.garden), tag).toBeGreaterThanOrEqual(3);
    expect(v.shade.events, tag).toBe("none");
    expect(+v.shade.op, tag).toBeCloseTo(+v.alpha, 5);
    expect(v.alpha, tag).not.toBe("");
  });
});
