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

test("S25.D3: the selector offers \"Full-height window\"; picking it stores fullwindow, draws the window pane from the floor and shows the sill field", async ({ page }) => {
  const demoFull = await page.locator(`${EDITOR} svg line.door-fullwindow`).count(); // the demo has one of its own (S27.C)
  await addDoor(page);
  const opts = await options(page);
  expect(opts).toContainEqual(["fullwindow", "Full-height window"]);
  expect(opts.map((o) => o[0])).toEqual(["door", "glass", "window", "sealed", "slit", "fullwindow", "open"]);
  await page.locator("#dk").selectOption("fullwindow");
  expect((await doors(page)).at(-1)!.kind).toBe("fullwindow");
  await expect(page.locator(`${EDITOR} svg line.door-fullwindow`).last()).toHaveClass(/door-window/);
  await expect(page.locator("#dsill")).toBeVisible();
  await expect(page.locator("#dsill")).toHaveAttribute("placeholder", "0"); // the default shows as the placeholder: DOOR_DEFAULTS.fullwindow sill 0
  await page.locator("#undo").click();
  expect((await doors(page)).at(-1)!.kind).toBe("door");
  await expect(page.locator(`${EDITOR} svg line.door-fullwindow`)).toHaveCount(demoFull);
});
