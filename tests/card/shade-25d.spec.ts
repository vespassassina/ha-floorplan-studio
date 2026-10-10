import { test, expect } from "@playwright/test";
import { FLOORPLAN_CSS, THEMES, renderFloor, type Theme } from "../../src/core/render";
import type { Floor } from "../../src/core/schema";

// S28.5: the 2.5D contact shadow on the real stylesheet, in every theme (finding 17): the group's fill, alpha and pointer events resolve
// (finding 10), and on a real frame the pixel 4 cm off a wall foot, inside the room, is darker than the middle of the room (finding 16).
const floor: Floor = {
  title: "T", outline: [[0, 0], [600, 0], [600, 500], [0, 500]], owk: ["external", "external", "external", "external"],
  rooms: [{ id: "r", kind: "room", name: "Hall", pts: [[0, 0], [600, 0], [600, 500], [0, 500]], wk: ["wall", "wall", "wall", "wall"] }] as never,
  walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], unlinked: [],
  furniture: [{ id: "c", symbol: "cabinet", x: 300, y: 330, rot: 0, w: 80, h: 60 }] as never,
};
const CASES: { t: Theme; dark: boolean }[] = [...THEMES.map((t) => ({ t, dark: false })), { t: "ha", dark: true }];
const page_ = (c: { t: Theme; dark: boolean }, id: string, extra: object = {}) => `<svg id="${id}" width="640" height="560" viewBox="-20 -80 640 560" style="display:block">${renderFloor(floor, { scale: 1, view: "2.5d", theme: c.t, dark: c.dark, ...extra })}</svg>`;
const html = (cases: typeof CASES) => `<!DOCTYPE html><html><body style="margin:0"><style>${FLOORPLAN_CSS}</style>${cases.map((c, i) => page_(c, `c${i}`)).join("")}</body></html>`;

const lum = (c: number[]) => { const [r, g, b] = c.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

test("S28.5 the shade group resolves to the shade token, the soft band to half its alpha, and takes no click, in every theme", async ({ page }) => {
  await page.setContent(html(CASES));
  const r = await page.evaluate((n) => Array.from({ length: n }, (_, i) => {
    const svg = document.getElementById(`c${i}`)!, s = (sel: string) => getComputedStyle(svg.querySelector(sel)!);
    const root = getComputedStyle(svg.firstElementChild!);
    return {
      group: { fill: s("g.shade").fill, events: s("g.shade").pointerEvents }, s1: { fill: s(".shade .s1").fill, op: s(".shade .s1").fillOpacity, events: s(".shade .s1").pointerEvents },
      s2: s(".shade .s2").fillOpacity, sp: s(".shade .sp").fillOpacity, token: root.getPropertyValue("--fp-shade").trim(), alpha: root.getPropertyValue("--fp-shade-alpha").trim(),
    };
  }), CASES.length);
    CASES.forEach((c, i) => {
    const v = r[i], tag = `${c.t}/${c.dark ? "dark" : "light"}`;
    expect(v.alpha, tag).not.toBe("");
    expect(+v.s1.op, tag).toBeCloseTo(+v.alpha, 5);
    expect(+v.sp, tag).toBeCloseTo(+v.alpha, 5);
    expect(+v.s2, tag).toBeCloseTo(+v.alpha / 2, 5);
    expect(v.s1.fill, tag).toBe(v.group.fill);
    expect(v.group.events, tag).toBe("none");
    expect(v.s1.events, tag).toBe("none");
    expect(v.token, tag).not.toBe("");
  });
});

for (const c of [{ t: "light", dark: false }, { t: "blueprint", dark: false }] as typeof CASES) {
  test.describe(`${c.t}: the wall foot is darker than the room`, () => {
    test.use({ deviceScaleFactor: 2, viewport: { width: 700, height: 600 } });
    for (const night of [false, true]) {
      test(`${night ? "night" : "day"}: 4 cm off the back wall's face is at least 4 % darker than the middle`, async ({ page }) => {
        await page.setContent(`<!DOCTYPE html><html><body style="margin:0"><style>${FLOORPLAN_CSS}</style>${page_(c, "c0", { night })}</body></html>`);
        const shot = (await page.screenshot({ clip: { x: 0, y: 0, width: 640, height: 560 } })).toString("base64");
        // x: 300 is the room's middle column; the back (north) wall of an external ring has its room face at y = 10, so y = 14 is 4 cm off it.
        const at = (x: number, y: number) => [x + 20, y + 80]; // viewBox -20 -80: plan to css px
        const [foot, mid] = await page.evaluate(async ([b64, pts]) => {
          const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
          const cv = document.createElement("canvas"); cv.width = bmp.width; cv.height = bmp.height;
          const g = cv.getContext("2d")!; g.drawImage(bmp, 0, 0);
          return (pts as unknown as number[][]).map(([x, y]) => Array.from(g.getImageData(Math.round(x * 2), Math.round(y * 2), 1, 1).data.slice(0, 3)));
        }, [shot, [at(120, 14), at(120, 250)]] as const);
        const drop = (lum(mid) - lum(foot)) / lum(mid);
        expect(drop, `foot ${foot} mid ${mid}`).toBeGreaterThanOrEqual(0.04);
      });
    }
  });
}
