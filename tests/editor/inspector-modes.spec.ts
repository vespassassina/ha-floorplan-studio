import { test, expect, type Page } from "@playwright/test";

// S26.14: the Inspector has modes. Place (a room's HA area) and Add (Add > Device) open as tabs inside the aside, never as
// floating panels, and the canvas does not move. Real page.mouse at real coordinates (CLAUDE.md finding 3).

const EDITOR = "floorplan-studio-editor";
const screenOf = (page: Page, x: number, y: number) =>
  page.evaluate(([tag, px, py]) => {
    const svg = (document.querySelector(tag as string) as any).shadowRoot.querySelector("svg") as SVGSVGElement;
    const g = svg.querySelector(":scope > g.plan-turn") as SVGGraphicsElement | null;
    const q = new DOMPoint(px as number, py as number).matrixTransform((g ?? svg).getScreenCTM()!);
    return { x: q.x, y: q.y };
  }, [EDITOR, x, y] as const);
const setHa = (page: Page, ha: unknown) => page.evaluate(([tag, h]) => { (document.querySelector(tag as string) as any).ha = h; }, [EDITOR, ha]);
const N = 12;
const HA = { floors: [{ id: "gf", name: "Ground" }], areas: [{ id: "living", name: "Living" }],
  entities: Array.from({ length: N }, (_, k) => ({ id: `light.strip_${k}`, name: `Strip ${k}`, domain: "light", area: "living" })) };
async function clickCentre(page: Page, sel: string) { const b = (await page.locator(sel).boundingBox())!; await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); }

for (const [width, height] of [[1280, 800], [1024, 768]] as const) {
  test.describe(`${width}x${height}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/standalone.html");
      await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
      await setHa(page, HA);
    });

    test("a room, Place devices: the Place tab is on, no floating panel, the button is in view, the canvas has not moved", async ({ page }) => {
      const c = await screenOf(page, 200, 150); // inside Living
      await page.mouse.click(c.x, c.y);
      await expect(page.locator("#rplace")).toBeVisible();
      const before = (await page.locator(`${EDITOR} .canvas`).boundingBox())!;
      await clickCentre(page, "#rplace");
      await expect(page.locator('aside [role=tab][data-mode="place"]')).toHaveAttribute("aria-selected", "true");
      await expect(page.locator("aside #placePanel")).toBeVisible();
      await expect(page.locator(".fpanel")).toHaveCount(0);
      const go = (await page.locator("#placeGo").boundingBox())!, vp = page.viewportSize()!;
      expect(go.y).toBeGreaterThanOrEqual(0);
      expect(go.y + go.height).toBeLessThanOrEqual(vp.height);
      expect(go.x + go.width).toBeLessThanOrEqual(vp.width);
      expect(await page.locator(`${EDITOR} .canvas`).boundingBox()).toEqual(before);
      // the tabs switch the aside; Selection shows the room again, Place comes back with its ticks
      await page.locator('#placeAll').click();
      await page.locator('aside [role=tab][data-mode="selection"]').click();
      await expect(page.locator("aside #placePanel")).toHaveCount(0);
      await expect(page.locator("#rplace")).toBeVisible();
      await page.locator('aside [role=tab][data-mode="place"]').click();
      await expect(page.locator("#placeGo")).toHaveText(`Place ${N}`);
    });

    test("Add > Device opens the Add tab in the aside, no floating panel, the canvas has not moved; Escape returns to Selection", async ({ page }) => {
      const before = (await page.locator(`${EDITOR} .canvas`).boundingBox())!;
      await page.locator('details.menu > summary:text-is("Add")').click();
      await clickCentre(page, "#addDevBtn");
      await expect(page.locator('aside [role=tab][data-mode="add"]')).toHaveAttribute("aria-selected", "true");
      await expect(page.locator("aside #addDevPanel")).toBeVisible();
      await expect(page.locator(".fpanel")).toHaveCount(0);
      expect(await page.locator(`${EDITOR} .canvas`).boundingBox()).toEqual(before);
      await page.keyboard.press("Escape");
      await expect(page.locator("#addDevPanel")).toHaveCount(0);
      await expect(page.locator('aside [role=tab][data-mode="selection"]')).toHaveAttribute("aria-selected", "true");
    });

    test("computed-style pair: the selected tab is bold with an ink underline, the others not; a mode's list scrolls inside the aside", async ({ page }) => {
      await page.locator('details.menu > summary:text-is("Add")').click();
      await clickCentre(page, "#addDevBtn");
      const css = (sel: string) => page.locator(sel).evaluate((el) => { const c = getComputedStyle(el); return { w: c.fontWeight, b: c.borderBottomColor, ink: getComputedStyle(el.closest("aside")!).color }; });
      const on = await css('aside [data-mode="add"]'), off = await css('aside [data-mode="selection"]');
      expect(on.w).toBe("600");
      expect(off.w).toBe("400");
      expect(on.b).toBe(on.ink);
      expect(off.b).not.toBe(off.ink);
      expect(await page.locator("#addDevPanel .rows").evaluate((el) => getComputedStyle(el).overflowY)).toBe("auto");
    });

    test("the Place tab is off until there is a room to place into", async ({ page }) => {
      await expect(page.locator('aside [role=tab][data-mode="place"]')).toBeDisabled();
      await expect(page.locator('aside [role=tab][data-mode="selection"]')).toHaveAttribute("aria-selected", "true");
    });
  });
}
