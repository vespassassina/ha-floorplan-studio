import { test, expect } from "@playwright/test";
import { FLOORPLAN_CSS, OBLIQUE, THEMES, renderFloor, type Theme } from "../../src/core/render";
import type { Floor } from "../../src/core/schema";

// S28.4: the 2.5D tree on real pixels, at 4x, in every theme (finding 17). A bare floor on a white page, so the background is known:
// the pixel at the lifted crown centre is the crown fill at .35 over white, the pixel on the trunk halfway up is the trunk stroke, the
// pixel beside the foot is the shade patch. A rule asserted as text proves nothing (finding 10); this reads the painted result.
const R = OBLIQUE.rise, K = OBLIQUE.skew;
const TREE = { x: 300, y: 260, w: 50, h: 70 }; // height 400: trunk top 240, crown middle 300, crown radius 25 x 35
const floor: Floor = {
  title: "T", outline: [[0, 0], [600, 0], [600, 500], [0, 500]], owk: ["none", "none", "none", "none"], rooms: [],
  walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], unlinked: [],
  furniture: [{ id: "t", symbol: "tree", rot: 0, ...TREE }] as never,
};
const CASES: { t: Theme; dark: boolean }[] = [...THEMES.map((t) => ({ t, dark: false })), { t: "ha", dark: true }];
const VB = [200, -20, 260, 300]; // x y w h, plan cm, around the lifted tree
const PX = 4; // css px per cm: 1040 x 1200 css would be big, so scale 1 css px = 1 cm and deviceScaleFactor 4
const html = `<!DOCTYPE html><html><body style="margin:0;background:#fff"><style>${FLOORPLAN_CSS}</style>${CASES.map((c, i) => `<svg id="c${i}" width="${VB[2]}" height="${VB[3]}" viewBox="${VB.join(" ")}" style="display:block">${renderFloor(floor, { scale: 1, view: "2.5d", theme: c.t, dark: c.dark })}</svg>`).join("")}</body></html>`;

const rgb = (s: string): number[] => {
  const srgb = /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?/.exec(s);
  if (srgb) return srgb.slice(1, 4).map((v) => Number(v) * 255);
  const m = /rgba?\((\d+), (\d+), (\d+)/.exec(s);
  if (!m) throw new Error(`not a colour: ${s}`);
  return m.slice(1, 4).map(Number);
};
const over = (fg: string, a: number, bg: number[]) => rgb(fg).map((v, k) => v * a + bg[k] * (1 - a));
/** Screen position of plan (x, y) at height h, in css px inside its svg. */
const scr = (x: number, y: number, h: number) => [x + h * K * R - VB[0], y - h * R - VB[1]];

test.describe("S28.4 the 2.5D tree stands", () => {
  test.use({ deviceScaleFactor: PX, viewport: { width: 300, height: 340 } });

  for (const [i, c] of CASES.entries()) {
    test(`${c.t}${c.dark ? " (dark)" : ""}: crown, trunk and shade paint their own colours at the right spots`, async ({ page }) => {
      await page.setContent(html);
      const svgBox = await page.evaluate((k) => { for (let j = 0; j < 14; j++) if (j !== k) document.getElementById(`c${j}`)!.style.display = "none"; const r = document.getElementById(`c${k}`)!.getBoundingClientRect(); return { x: r.x, y: r.y }; }, i);
      const style = await page.evaluate((k) => {
        const svg = document.getElementById(`c${k}`)!, s = (sel: string) => getComputedStyle(svg.querySelector(sel)!);
        return { crown: s(".tree-crown").fill, op: s(".tree-crown").fillOpacity, trunk: s(".trunk").stroke, edge: s(".tree-crown").stroke, trunkW: s(".trunk").strokeWidth, shade: s(".tree-shade").fill, shadeOp: s(".tree-shade").fillOpacity };
      }, i);
      expect(style.trunkW).toBe("12px");
      expect(style.trunk, "the trunk takes the crown's edge colour (--fp-tree-edge), not the furniture blue").toBe(style.edge);
      const shot = (await page.screenshot({ clip: { x: svgBox.x, y: svgBox.y, width: VB[2], height: VB[3] } })).toString("base64");
      const probe = async (pts: number[][]) => page.evaluate(async ([b64, pts]) => {
        const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
        const cv = document.createElement("canvas"); cv.width = bmp.width; cv.height = bmp.height;
        const g = cv.getContext("2d")!; g.drawImage(bmp, 0, 0);
        return (pts as number[][]).map(([x, y]) => Array.from(g.getImageData(Math.round(x * 4), Math.round(y * 4), 1, 1).data.slice(0, 3)));
      }, [shot, pts] as const);
      const white = [255, 255, 255];
      const [crownAt, trunkAt, shadeAt, emptyAt] = [scr(TREE.x, TREE.y, 300), scr(TREE.x, TREE.y, 120), [scr(TREE.x, TREE.y, 0)[0] + 19, scr(TREE.x, TREE.y, 0)[1] + 6], [20, 20]];
      const [crown, trunk, shade, empty] = await probe([crownAt, trunkAt, shadeAt, emptyAt]);
      const near = (got: number[], want: number[], tag: string) => got.forEach((v, k) => expect(Math.abs(v - want[k]), `${tag} channel ${k}: got ${got} want ${want.map(Math.round)}`).toBeLessThanOrEqual(3));
      near(empty, white, "empty page");
      near(crown, over(style.crown, +style.op, white), "crown centre"); // the lifted centre: fill at .35 over the page
      near(trunk, rgb(style.trunk), "trunk halfway up"); // opaque stroke
      near(shade, over(style.shade, +style.shadeOp, white), "shade beside the foot");
      // asymmetric: the foot (under the trunk's round cap) is the trunk's colour, not the crown's
      const [foot] = await probe([scr(TREE.x, TREE.y, 0)]);
      near(foot, rgb(style.trunk), "the foot");
      expect(foot.join(), "the foot is not crown-coloured").not.toBe(crown.join());
    });
  }
});
