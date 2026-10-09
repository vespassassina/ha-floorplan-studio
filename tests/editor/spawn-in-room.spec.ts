import { test, expect, type Page } from "@playwright/test";
import type { Layout } from "../../src/core/schema";
import { pickFurniture, pickUnlinked } from "./menu-helpers";

// Diego, 2026-10-07: with a room selected, what you add lands in the middle of that room, and a tree added to a textured garden is drawn
// ABOVE the texture (it was reported as lost). Real page.mouse at real coordinates (finding 3); the layout is read back from the editor.

const EDITOR = "floorplan-studio-editor";
const layoutOf = (page: Page) => page.evaluate((tag) => JSON.parse(JSON.stringify((document.querySelector(tag) as any).layout)) as Layout, EDITOR);
const ground = async (page: Page) => (await layoutOf(page)).floors.ground;
const middle = (pts: number[][]) => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await page.locator("#fixPlan").uncheck(); // the plan opens fixed; these tests edit it
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
});

/** Clicks room `i` where nothing else stands: a point near its bottom-right corner. */
async function pickRoom(page: Page, i: number) {
  const b = (await page.locator(`${EDITOR} svg polygon[data-r="${i}"]`).first().boundingBox())!;
  await page.mouse.click(b.x + b.width * 0.9, b.y + b.height * 0.9);
  await expect(page.locator("#panel")).toContainText("Identity");
}
async function addFurniture(page: Page, symbol: string) {
  await page.locator('details.menu > summary:text-is("Add")').click();
  await pickFurniture(page, symbol);
}

test("a tree added with the Kitchen selected lands in the middle of the Kitchen, above its texture", async ({ page }) => {
  const before = await ground(page);
  const k = before.rooms.findIndex((r) => r.name === "Kitchen");
  await pickRoom(page, k);
  await addFurniture(page, "tree");
  const after = await ground(page);
  const m = middle(before.rooms[k].pts), t = after.furniture[after.furniture.length - 1];
  expect(t.symbol).toBe("tree");
  // The demo kitchen's light stands on its middle, so the tree is nudged 40 cm right, never stacked on it; still inside the room.
  expect(Math.hypot(t.x - m[0], t.y - m[1])).toBeLessThanOrEqual(45);
  expect(Math.abs(t.y - m[1])).toBeLessThanOrEqual(10);
  // drawn after (above) every room fill in the same svg
  const order = await page.evaluate((tag) => {
    const svg = document.querySelector(tag)!.shadowRoot?.querySelector("svg") ?? document.querySelector(`${tag} svg`)!;
    const all = [...svg.querySelectorAll("*")], tree = svg.querySelector("g[data-f]:last-of-type") ?? [...svg.querySelectorAll("g[data-f]")].pop()!;
    const rooms = [...svg.querySelectorAll("polygon[data-r]")];
    return rooms.every((r) => all.indexOf(r) < all.indexOf(tree));
  }, EDITOR);
  expect(order).toBe(true);
});

test("with no room selected the spot is unchanged: outside the house", async ({ page }) => {
  const before = await ground(page);
  await addFurniture(page, "tree");
  const t = (await ground(page)).furniture.pop()!;
  expect(t.x).toBeGreaterThan(Math.max(...before.outline.map((p) => p[0])));
});

test("an unlinked object also goes to the selected room's middle", async ({ page }) => {
  const before = await ground(page);
  const k = before.rooms.findIndex((r) => r.name === "Kitchen"), m = middle(before.rooms[k].pts);
  await pickRoom(page, k);
  await page.locator('details.menu > summary:text-is("Add")').click();
  await pickUnlinked(page, "speaker");
  const u = (await ground(page)).unlinked.pop()!;
  expect(Math.hypot(u.x - m[0], u.y - m[1])).toBeLessThanOrEqual(45); // nudged 40 cm only when a point already stands there
});
