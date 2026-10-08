import { test, expect, type Page } from "@playwright/test";
import type { Floor, Layout } from "../../src/core/schema";

// Sprint 22: the Studio fits the window. S22.3 (review U11): the Place and Add popups stay inside the viewport, so
// their buttons can be reached without dragging the popup first. S22.6 (U12): the room aside scrolls on its own and
// the plan stays put. Every pointer action is page.mouse at real coordinates (CLAUDE.md finding 3); layout is read
// from the browser, not from CSS text (finding 10).

const EDITOR = "floorplan-studio-editor";
const layoutOf = (page: Page) => page.evaluate((tag) => JSON.parse(JSON.stringify((document.querySelector(tag) as any).layout)) as Layout, EDITOR);
const groundOf = async (page: Page): Promise<Floor> => (await layoutOf(page)).floors.ground;
const screenOf = (page: Page, x: number, y: number) =>
  page.evaluate(([tag, px, py]) => {
    const svg = (document.querySelector(tag as string) as any).shadowRoot.querySelector("svg") as SVGSVGElement;
    const g = svg.querySelector(":scope > g.plan-turn") as SVGGraphicsElement | null;
    const q = new DOMPoint(px as number, py as number).matrixTransform((g ?? svg).getScreenCTM()!);
    return { x: q.x, y: q.y };
  }, [EDITOR, x, y] as const);
async function clickAt(page: Page, sel: string) {
  const b = (await page.locator(sel).boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}
const setHa = (page: Page, ha: unknown) => page.evaluate(([tag, h]) => { (document.querySelector(tag as string) as any).ha = h; }, [EDITOR, ha]);

// Forty lights in the Living area: a long Place list and a long Add list. The demo's Living room maps to area "living".
const N = 40;
const BIG_HA = { floors: [{ id: "gf", name: "Ground" }], areas: [{ id: "living", name: "Living" }, { id: "kitchen", name: "Kitchen" }],
  entities: Array.from({ length: N }, (_, k) => ({ id: `light.strip_${k}`, name: `Strip ${k}`, domain: "light", area: "living" })) };

async function selectLiving(page: Page) {
  const c = await screenOf(page, 200, 150); // Living room floor, clear of icons and furniture
  await page.mouse.click(c.x, c.y);
  await expect(page.locator("#rplace")).toBeVisible();
}
async function inViewport(page: Page, sel: string) {
  const b = (await page.locator(sel).boundingBox())!;
  const vp = page.viewportSize()!;
  expect(b.y, `${sel} top`).toBeGreaterThanOrEqual(0);
  expect(b.y + b.height, `${sel} bottom`).toBeLessThanOrEqual(vp.height);
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(vp.width);
}

for (const [width, height] of [[1440, 900], [1024, 768]] as const) {
  test.describe(`${width}x${height}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/standalone.html");
      await page.locator("#fixPlan").uncheck(); // the plan opens fixed; these tests edit it
      await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
      await setHa(page, BIG_HA);
    });

    test("S22.3: the Place popup fits the window; Place is reached and clicked where it is", async ({ page }) => {
      const before = (await groundOf(page)).devices.length;
      await selectLiving(page);
      await expect(page.locator("#rplace")).toHaveText(`Place ${N} Home Assistant devices`);
      await page.locator("#rplace").scrollIntoViewIfNeeded();
      await clickAt(page, "#rplace");
      await expect(page.locator("#placePanel")).toBeVisible();
      await inViewport(page, "#placePanel");
      await inViewport(page, "#placeAll");
      await clickAt(page, "#placeAll");
      await expect(page.locator("#placeGo")).toHaveText(`Place ${N}`);
      await inViewport(page, "#placeGo");
      // the list scrolls inside the popup: the last row is not in view, yet Place is
      expect(await page.locator("#placePanel .rows").evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
      await clickAt(page, "#placeGo");
      await expect(page.locator("#placePanel")).toHaveCount(0);
      expect((await groundOf(page)).devices).toHaveLength(before + N);
    });

    test("S22.3: the Add device popup fits the window", async ({ page }) => {
      await page.locator('details.menu > summary:text-is("Add")').click();
      await clickAt(page, "#addDevBtn");
      await expect(page.locator("#addDevPanel")).toBeVisible();
      await expect(page.locator('#addDevPanel button[data-add^="ha:"]')).toHaveCount(N);
      await inViewport(page, "#addDevPanel");
      await inViewport(page, "#addDevClose");
      expect(await page.locator("#addDevPanel .rows").evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    });

    test("S22.6: Place devices is the room panel's first entry, in view with no scroll", async ({ page }) => {
      await selectLiving(page);
      await inViewport(page, "#rplace");
      // above the first section heading (Identity), right under the panel's title
      const place = (await page.locator("#rplace").boundingBox())!, first = (await page.locator(`${EDITOR} aside .pnl-h`).first().boundingBox())!;
      expect(place.y).toBeLessThan(first.y);
    });

    test("S22.6: the room aside scrolls on its own; the plan stays put", async ({ page }) => {
      await selectLiving(page);
      const aside = page.locator(`${EDITOR} aside`), svg = page.locator(`${EDITOR} .canvas > svg`);
      // Every section open: the room panel is then taller than any window here.
      await page.evaluate((tag) => { for (const d of (document.querySelector(tag) as any).shadowRoot.querySelectorAll("aside details")) d.open = true; }, EDITOR);
      expect(await aside.evaluate((el) => el.scrollHeight)).toBeGreaterThan(height);
      const svgTop = await svg.evaluate((el) => el.getBoundingClientRect().top);
      const a = (await aside.boundingBox())!;
      await page.mouse.move(a.x + a.width / 2, a.y + Math.min(a.height, height - a.y) / 2);
      await page.mouse.wheel(0, 400);
      await expect.poll(() => aside.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
      expect(await svg.evaluate((el) => el.getBoundingClientRect().top)).toBe(svgTop);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      // the aside ends inside the window, so its last control can be scrolled to
      const b = (await aside.boundingBox())!;
      expect(b.y + b.height).toBeLessThanOrEqual(height);
    });
  });
}
