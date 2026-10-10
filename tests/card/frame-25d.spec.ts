import { test, expect } from "@playwright/test";
import { FLOORPLAN_CSS, THEMES, renderFloor, type Theme } from "../../src/core/render";
import type { Floor } from "../../src/core/schema";

// S28.6: the framed opening on the real stylesheet and real pixels, in every theme (finding 17): `.frame` takes the frame token and no
// click (finding 10), and the pixel in the middle of a jamb is the frame colour, in the wall-side colour's place (finding 16).
const floor: Floor = {
  title: "T", outline: [[0, 0], [400, 0], [400, 300], [0, 300]], owk: ["external", "none", "none", "none"], rooms: [],
  walls: [], stairs: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [],
  doors: [{ id: "d", name: "D", kind: "door", a: [100, 0], b: [200, 0] }, { id: "w", name: "W", kind: "window", a: [260, 0], b: [360, 0] }] as never,
};
const CASES: { t: Theme; dark: boolean }[] = [...THEMES.map((t) => ({ t, dark: false })), { t: "ha", dark: true }];
const VB = [60, -140, 360, 200];
const svgOf = (c: { t: Theme; dark: boolean }, id: string) => `<svg id="${id}" width="${VB[2]}" height="${VB[3]}" viewBox="${VB.join(" ")}" style="display:block">${renderFloor(floor, { scale: 1, view: "2.5d", theme: c.t, dark: c.dark })}</svg>`;
const rgb = (s: string): number[] => {
  const srgb = /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/.exec(s);
  if (srgb) return srgb.slice(1, 4).map((v) => Number(v) * 255);
  const m = /rgba?\((\d+), (\d+), (\d+)/.exec(s);
  if (!m) throw new Error(`not a colour: ${s}`);
  return m.slice(1, 4).map(Number);
};

test("S28.6 .frame resolves to the frame token and takes no click, in every theme", async ({ page }) => {
  await page.setContent(`<!DOCTYPE html><html><body style="margin:0"><style>${FLOORPLAN_CSS}</style>${CASES.map((c, i) => svgOf(c, `c${i}`)).join("")}</body></html>`);
  const r = await page.evaluate((n) => Array.from({ length: n }, (_, i) => {
    const svg = document.getElementById(`c${i}`)!, f = getComputedStyle(svg.querySelector("polygon.frame")!);
    const probe = document.createElement("i"); probe.style.color = "var(--fp-frame)"; svg.firstElementChild!.appendChild(probe);
    return { fill: f.fill, stroke: f.stroke, events: f.pointerEvents, token: getComputedStyle(probe).color, count: svg.querySelectorAll("polygon.frame").length };
  }), CASES.length);
  CASES.forEach((c, i) => {
    const tag = `${c.t}/${c.dark ? "dark" : "light"}`;
    expect(r[i].fill, tag).toBe(r[i].token);
    expect(r[i].stroke, tag).toBe(r[i].token);
    expect(r[i].events, tag).toBe("none");
    expect(r[i].count, tag).toBe(7); // the door: 2 jambs + head; the window: 2 jambs + head + sill
  });
});

test.describe("the jamb on real pixels", () => {
  test.use({ deviceScaleFactor: 4, viewport: { width: 400, height: 220 } });
  for (const [i, c] of CASES.entries()) {
    test(`${c.t}${c.dark ? " (dark)" : ""}: the middle of the door's left jamb is the frame colour`, async ({ page }) => {
      await page.setContent(`<!DOCTYPE html><html><body style="margin:0"><style>${FLOORPLAN_CSS}</style>${svgOf(c, "c0")}</body></html>`);
      const token = await page.evaluate(() => { const svg = document.getElementById("c0")!, probe = document.createElement("i"); probe.style.color = "var(--fp-frame)"; svg.firstElementChild!.appendChild(probe); return getComputedStyle(probe).color; });
      const shot = (await page.screenshot({ clip: { x: 0, y: 0, width: VB[2], height: VB[3] } })).toString("base64");
      // The door's left jamb: x 100..105, z 0..205, FRAME_PROUD (2 cm) south of the wall line. Its middle, 100 cm up, is plan (102.5, 2) lifted by 100.
      const rise = 0.55, skew = 0.3;
      const at = [102.5 + 100 * skew * rise - VB[0], 2 - 100 * rise - VB[1]];
      const [px] = await page.evaluate(async ([b64, pts]) => {
        const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
        const cv = document.createElement("canvas"); cv.width = bmp.width; cv.height = bmp.height;
        const g = cv.getContext("2d")!; g.drawImage(bmp, 0, 0);
        return (pts as unknown as number[][]).map(([x, y]) => Array.from(g.getImageData(Math.round(x * 4), Math.round(y * 4), 1, 1).data.slice(0, 3)));
      }, [shot, [at]] as const);
      const want = rgb(token);
      px.forEach((v, k) => expect(Math.abs(v - want[k]), `channel ${k}: got ${px} want ${want.map(Math.round)} (case ${i})`).toBeLessThanOrEqual(3));
    });
  }
});
