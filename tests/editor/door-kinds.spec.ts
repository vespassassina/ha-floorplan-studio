import { test, expect, type Page } from "@playwright/test";
import type { Layout } from "../../src/core/schema";

// The door type selector in the Studio (S25.D2, S25.D3). The visible names are not the stored ids: `glass` is read "Glass door"
// (Diego, 2026-10-09). Every click is a real page.mouse press on the real top element (CLAUDE.md finding 3).

const EDITOR = "floorplan-studio-editor";
const layoutOf = (page: Page) => page.evaluate((tag) => JSON.parse(JSON.stringify((document.querySelector(tag) as any).layout)) as Layout, EDITOR);
const doors = async (page: Page) => (await layoutOf(page)).floors.ground.doors;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await page.locator("#fixPlan").uncheck();
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
});

async function addDoor(page: Page) {
  await page.locator('details.menu > summary:text-is("Add")').click();
  await page.locator('#mAdd details.sub > summary:text-is("Openings")').click();
  await page.locator("#addDoor").click();
}
const options = (page: Page) => page.locator("#dk option").evaluateAll((os) => os.map((o) => [(o as HTMLOptionElement).value, o.textContent]));

test("S25.D2: the type selector says \"Glass door\" for the stored kind glass; no option says plain \"glass\"", async ({ page }) => {
  await addDoor(page);
  const opts = await options(page);
  expect(opts).toContainEqual(["glass", "Glass door"]);
  expect(opts.map((o) => o[1])).not.toContain("glass");
  await page.locator("#dk").selectOption("glass");
  expect((await doors(page)).at(-1)!.kind).toBe("glass"); // stored value unchanged, no migration
  expect(await page.locator("#dk option:checked").textContent()).toBe("Glass door");
  await page.locator("#undo").click();
  expect((await doors(page)).at(-1)!.kind).toBe("door");
});
