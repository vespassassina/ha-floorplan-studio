import { test, expect, type Page } from "@playwright/test";
import type { Layout } from "../../src/core/schema";

// "Fix plan" in the real editor: a drag on a room or a wall end does nothing, a drag on a device still moves it, drawing and
// adding a wall are refused with a message, and unticking gives everything back. Real page.mouse at real coordinates (finding 3).

const EDITOR = "floorplan-studio-editor";
const layoutOf = (page: Page) => page.evaluate((tag) => JSON.parse(JSON.stringify((document.querySelector(tag) as any).layout)) as Layout, EDITOR);
const g = async (page: Page) => (await layoutOf(page)).floors.ground;
const centre = async (page: Page, sel: string) => { const b = (await page.locator(sel).first().boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
});

test("the checkbox sits before the status label", async ({ page }) => {
  const order = await page.evaluate((tag) => {
    const r = document.querySelector(tag)!.shadowRoot ?? document.querySelector(tag)!;
    const box = r.querySelector("#fixPlan")!, status = r.querySelector("#status")!;
    return !!(box.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING);
  }, EDITOR);
  expect(order).toBe(true);
});

test("fixed: a door drag changes nothing, a device drag moves the device, then unticked the door moves again", async ({ page }) => {
  await page.locator("#fixPlan").check();
  const before = await g(page);
  const room = await centre(page, `${EDITOR} svg line.door[data-d="0"]`); // a door: rooms of the demo share corners and a press on one pans
  await page.mouse.move(room.x, room.y);
  await page.mouse.down();
  await page.mouse.move(room.x + 60, room.y + 40, { steps: 6 });
  await page.mouse.up();
  expect((await g(page)).doors).toEqual(before.doors);
  await expect(page.locator("#status")).toContainText("plan is fixed");

  const dev = await centre(page, `${EDITOR} svg g[data-x="0"]`);
  await page.mouse.move(dev.x, dev.y);
  await page.mouse.down();
  await page.mouse.move(dev.x + 50, dev.y + 30, { steps: 6 });
  await page.mouse.up();
  const after = await g(page);
  expect((after.devices[0] as any).x).not.toBe((before.devices[0] as any).x);
  expect(after.rooms).toEqual(before.rooms);

  await page.locator("#fixPlan").uncheck();
  const room2 = await centre(page, `${EDITOR} svg line.door[data-d="0"]`);
  await page.mouse.move(room2.x, room2.y);
  await page.mouse.down();
  await page.mouse.move(room2.x + 40, room2.y + 30, { steps: 6 });
  await page.mouse.up();
  expect((await g(page)).doors[0]).not.toEqual(before.doors[0]);
});

test("fixed: Draw wall and Add wall are refused with the message", async ({ page }) => {
  await page.locator("#fixPlan").check();
  const n = (await g(page)).walls.length;
  await page.locator('details.menu > summary:text-is("Add")').click();
  await page.locator("#addWallSub > summary").click();
  await page.locator("#addWall-parapet").click();
  expect((await g(page)).walls).toHaveLength(n);
  await expect(page.locator("#status")).toContainText("plan is fixed");
});
