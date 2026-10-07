import { test, expect, type Page } from "@playwright/test";

// S17.1 (Diego, 2026-10-07): the Room panel's sections fold, and the editor remembers which are folded across a reload.
// Real mouse at real coordinates (CLAUDE.md finding 3).

const EDITOR = "floorplan-studio-editor";
const screenOf = (page: Page, x: number, y: number) =>
  page.evaluate(([tag, px, py]) => {
    const svg = (document.querySelector(tag as string) as any).shadowRoot.querySelector("svg") as SVGSVGElement;
    const g = svg.querySelector(":scope > g.plan-turn") as SVGGraphicsElement | null;
    const q = new DOMPoint(px as number, py as number).matrixTransform((g ?? svg).getScreenCTM()!);
    return { x: q.x, y: q.y };
  }, [EDITOR, x, y] as const);
const press = async (page: Page, sel: string) => {
  const b = page.locator(sel);
  await b.scrollIntoViewIfNeeded();
  const r = (await b.boundingBox())!;
  await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
};
async function openRoom(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/standalone.html");
  await page.locator("#fixPlan").uncheck();
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  const p = await screenOf(page, 150, 100);
  await page.mouse.click(p.x, p.y);
  await expect(page.locator("#rsc-new")).toBeVisible();
}

test("a room section folds on a click on its title and opens again; the others stay as they were", async ({ page }) => {
  await openRoom(page);
  const scenes = page.locator('details[data-sec="room:scenes"]'), identity = page.locator('details[data-sec="room:identity"]');
  await expect(scenes).toHaveJSProperty("open", true);
  await press(page, 'details[data-sec="room:scenes"] > summary');
  await expect(scenes).toHaveJSProperty("open", false);
  await expect(page.locator("#rsc-new")).toBeHidden();
  await expect(identity).toHaveJSProperty("open", true);
  await press(page, 'details[data-sec="room:scenes"] > summary');
  await expect(page.locator("#rsc-new")).toBeVisible();
});

test("a folded section stays folded when another room is picked and after a reload", async ({ page }) => {
  await openRoom(page);
  await press(page, 'details[data-sec="room:scenes"] > summary');
  await expect(page.locator('details[data-sec="room:scenes"]')).toHaveJSProperty("open", false);
  await page.reload();
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  await page.locator("#fixPlan").uncheck();
  const p = await screenOf(page, 150, 100);
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('details[data-sec="room:scenes"]')).toHaveJSProperty("open", false);
  await expect(page.locator('details[data-sec="room:identity"]')).toHaveJSProperty("open", true);
});

test("a re-render does not reopen a folded section", async ({ page }) => {
  await openRoom(page);
  await press(page, 'details[data-sec="room:scenes"] > summary');
  await page.evaluate(async (tag) => { const e = document.querySelector(tag) as any; e.requestUpdate(); await e.updateComplete; }, EDITOR);
  await expect(page.locator('details[data-sec="room:scenes"]')).toHaveJSProperty("open", false);
});

test("computed style pair: the section title is a pointer with a chevron that follows the fold", async ({ page }) => {
  await openRoom(page);
  const sum = page.locator('details[data-sec="room:scenes"] > summary');
  const look = () => sum.evaluate((el) => ({ cursor: getComputedStyle(el).cursor, chevron: getComputedStyle(el, "::before").content }));
  expect(await look()).toEqual({ cursor: "pointer", chevron: '"▾"' });
  await press(page, 'details[data-sec="room:scenes"] > summary');
  expect(await look()).toEqual({ cursor: "pointer", chevron: '"▸"' });
});
