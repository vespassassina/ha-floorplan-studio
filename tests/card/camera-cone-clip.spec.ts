import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// S21.1: a camera's cone stops at the walls of its room. The test looks at pixels, because the markup can name a clip that the
// browser never applies (a `url(#id)` has to resolve inside the card's shadow root). Demo ground floor, Living room x 0..500,
// Kitchen x 500..800, both y 0..400. One camera at 430,200 looks right (rot 90): its 100 cm cone would end at x 530.
//   inside  = 480,200  in the cone, in the Living room: must be tinted (a clip that hides everything fails here)
//   outside = 515,200  in the cone, past the wall, in the Kitchen: must be bare floor (fails without the clip)
//   bare    = 515,30   Kitchen floor, out of the cone: the colour the outside point must equal

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");
const card = (page: Page) => page.locator("floorplan-studio-card");

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

const layout = () => {
  const l = structuredClone(demo);
  l.floors.ground.devices = [{ id: "cam", type: "camera", entity: "camera.cam", x: 430, y: 200, rot: 90 }];
  l.floors.ground.furniture = [];
  return l;
};

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

test.describe("camera cone clip (S21.1)", () => {
  test.use({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 });

  test("the cone is painted in the camera's room and not past its wall", async ({ page }) => {
    await open(page, { layout: layout(), floor: "ground", theme: "light" });
    await expect(card(page).locator("css=path.cone")).toHaveCount(1);
    const [inside, outside, bare] = await pixels(page, [[480, 200], [515, 200], [515, 30]]);
    expect(apart(inside, bare), `inside the room the cone tints the floor (${inside} against ${bare})`).toBeGreaterThan(15);
    expect(apart(outside, bare), `past the wall the floor is bare (${outside} against ${bare})`).toBeLessThan(4);
  });

  test("a camera in no room keeps its whole cone", async ({ page }) => {
    const l = layout();
    l.floors.ground.devices[0].x = 1200; // right of the Garden (x 800..900), in no room
    l.floors.ground.devices[0].y = 450;
    await open(page, { layout: l, floor: "ground", theme: "light" });
    await expect(card(page).locator("css=path.cone")).toHaveCount(1);
    expect(await card(page).locator("css=path.cone").getAttribute("clip-path")).toBeNull();
  });
});
