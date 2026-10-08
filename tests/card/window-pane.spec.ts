import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// S1 (Opus review of S23): a window in an outer wall read as a hole. The wall is cut wider than the room polygon (which
// stops at the wall's centre line), so the outer half of the gap showed the board. Read from real pixels (finding 16).
// Demo first floor: the Bedroom window runs x 100..300 on the outer wall y = 0 (external, 20 cm; the cut is 24 cm, y -12..12).
//   gap   = 250,-8   the outer half of the cut, outside every room: must be the pane, not the board
//   board = 250,-40  plain board above the house: the colour the gap must not be

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");

async function open(page: Page, config: Record<string, unknown>) {
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate((config) => {
    const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(config);
    el.hass = { states: {}, callService: () => undefined };
    return el.updateComplete;
  }, config);
}

/** The colour of the screen pixel under a plan point: svg -> client by the real CTM, then a pixel of a real screenshot. */
async function pixels(page: Page, planPts: [number, number][]) {
  const client = await page.evaluate((pts) => {
    const svg = document.querySelector("floorplan-studio-card")!.shadowRoot!.querySelector("svg")!;
    const m = svg.getScreenCTM()!;
    return pts.map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]);
  }, planPts);
  const png = (await page.screenshot()).toString("base64");
  return page.evaluate(async ([b64, at]) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0);
    return (at as number[][]).map(([x, y]) => Array.from(g.getImageData(Math.round(x), Math.round(y), 1, 1).data.slice(0, 3)));
  }, [png, client] as const);
}
const apart = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

test.describe("window pane (S1)", () => {
  test.use({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 });

  for (const theme of ["light", "blueprint", "midnight"]) {
    test(`${theme}: the outer half of a window's gap is glass, not the board`, async ({ page }) => {
      const l = structuredClone(demo);
      l.floors.first.devices = [];
      await open(page, { layout: l, floor: "first", theme });
      await expect(page.locator("floorplan-studio-card").locator("css=path.win-pane")).toHaveCount(1);
      const [gap, board] = await pixels(page, [[250, -8], [250, -40]]);
      expect(apart(gap, board), `the outer half of the gap (${gap}) is not the board (${board})`).toBeGreaterThan(12);
    });
  }
});
