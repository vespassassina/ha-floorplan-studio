import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { validate, type Layout, type Floor } from "../../src/core/schema";

// Every pointer action goes through page.mouse at real screen coordinates, so the
// real top element decides what is hit (icons, handles, walls), as for a user.

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8")) as Layout;
const EDITOR = "floorplan-studio-editor";
const layoutOf = (page: Page) => page.evaluate((tag) => JSON.parse(JSON.stringify((document.querySelector(tag) as any).layout)) as Layout, EDITOR);
const groundOf = async (page: Page): Promise<Floor> => (await layoutOf(page)).floors.ground;
const unplaced = (page: Page) => page.locator('#addDev option:not([value=""])');

async function centre(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
async function drag(page: Page, selector: string, dx: number, dy: number) {
  const c = await centre(page, selector);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + dx / 2, c.y + dy / 2, { steps: 4 });
  await page.mouse.move(c.x + dx, c.y + dy, { steps: 4 });
  await page.mouse.up();
}
async function menu(page: Page, name: string) {
  await page.locator(`details.menu > summary:text-is("${name}")`).click();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
});

test("loads the demo and draws the ground floor", async ({ page }) => {
  const l = await layoutOf(page);
  expect(l.floors.ground.rooms).toHaveLength(3);
  await expect(page.locator("svg polygon[data-r]")).toHaveCount(3);
  await expect(page.locator(".chip[data-f]")).toHaveCount(2);
});

test("dragging a room corner 50 px moves the coincident corner of the neighbour", async ({ page }) => {
  const before = await groundOf(page);
  const living = before.rooms[0].pts[1], kitchen = before.rooms[1].pts[0];
  expect(living).toEqual([500, 0]);
  expect(kitchen).toEqual([500, 0]);
  await drag(page, 'circle[data-h="r0:1"]', 0, 50);
  const after = await groundOf(page);
  expect(after.rooms[0].pts[1]).not.toEqual([500, 0]);
  expect(after.rooms[0].pts[1][1]).toBeGreaterThan(0);
  expect(after.rooms[1].pts[0]).toEqual(after.rooms[0].pts[1]);
  // the panel shows the same numbers
  await expect(page.locator("#py")).toHaveValue(String(after.rooms[0].pts[1][1]));
});

test("Shift while dragging moves only the grabbed corner", async ({ page }) => {
  // The kitchen's corner is drawn after the living room's, so it is the one on top at (500, 0).
  await page.keyboard.down("Shift");
  await drag(page, 'circle[data-h="r1:0"]', 0, 50);
  await page.keyboard.up("Shift");
  const after = await groundOf(page);
  expect(after.rooms[1].pts[0][1]).toBeGreaterThan(0);
  expect(after.rooms[0].pts[1]).toEqual([500, 0]);
});

test("clicking a device icon selects that device, not what lies under it", async ({ page }) => {
  await page.mouse.click(...Object.values(await centre(page, 'g[data-x="0"]')) as [number, number]);
  await expect(page.locator("#panel")).toContainText("Living light");
  await expect(page.locator("#panel")).not.toContainText("Room");
});

test("Add, Device places one and the list shrinks; removing it makes the list grow", async ({ page }) => {
  await expect(unplaced(page)).toHaveCount(0);
  await page.mouse.click(...Object.values(await centre(page, 'g[data-x="0"]')) as [number, number]);
  await page.locator("#vdel").click();
  await expect(unplaced(page)).toHaveCount(1);
  expect((await groundOf(page)).devices).toHaveLength(7);
  await menu(page, "Add");
  await page.locator("#addDev").selectOption({ index: 1 });
  await expect(unplaced(page)).toHaveCount(0);
  expect((await groundOf(page)).devices).toHaveLength(8);
});

test("Add, Furniture, bed places a bed that can be moved and resized in the panel", async ({ page }) => {
  await menu(page, "Add");
  await page.locator("#addFurn").selectOption("bed");
  let g = await groundOf(page);
  expect(g.furniture).toHaveLength(3);
  const bed = g.furniture[2];
  expect(bed.symbol).toBe("bed");
  const n = g.furniture.length - 1;
  await drag(page, `g[data-f="${n}"]`, 60, 40);
  g = await groundOf(page);
  expect(g.furniture[2].x).not.toBe(bed.x);
  await page.locator("#fr").fill("90");
  await page.locator("#fr").press("Enter");
  expect((await groundOf(page)).furniture[2].rot).toBe(90);
});

test("File, Save downloads a file that validates", async ({ page }) => {
  await menu(page, "File");
  const dl = page.waitForEvent("download");
  await page.locator("#save").click();
  const file = await (await dl).path();
  const res = validate(JSON.parse(readFileSync(file, "utf8")));
  expect(res.ok).toBe(true);
});

test("a reload restores the edit from localStorage and Reset returns to the demo", async ({ page }) => {
  await drag(page, 'circle[data-h="r0:1"]', 0, 50);
  const edited = await groundOf(page);
  await page.reload();
  await expect(page.locator("svg polygon[data-r]").first()).toBeVisible();
  expect((await groundOf(page)).rooms[0].pts[1]).toEqual(edited.rooms[0].pts[1]);
  page.once("dialog", (d) => d.accept());
  await menu(page, "File");
  await page.locator("#reset").click();
  expect(await layoutOf(page)).toEqual(demo);
});

test("undo reverts the last drag", async ({ page }) => {
  await drag(page, 'circle[data-h="r0:1"]', 0, 50);
  await menu(page, "File");
  await page.locator("#undo").click();
  expect((await groundOf(page)).rooms[0].pts[1]).toEqual([500, 0]);
});

test("Open takes a v1 file and migrates it; a bad file lists errors and changes nothing", async ({ page }) => {
  const before = await layoutOf(page);
  await page.locator("#file").setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from('{"version":2,"floors":{"g":{"outline":[[0,0]]}}}') });
  await expect(page.locator("#errors")).toContainText("outline needs at least 3 points");
  expect(await layoutOf(page)).toEqual(before);
  await page.locator("#file").setInputFiles({ name: "junk.json", mimeType: "application/json", buffer: Buffer.from("not json") });
  await expect(page.locator("#errors")).toBeVisible();
  expect(await layoutOf(page)).toEqual(before);
  await page.locator("#file").setInputFiles("demo/layout.v1.json");
  await expect(page.locator("#errors")).toHaveCount(0);
  expect(validate(await layoutOf(page)).ok).toBe(true);
});

test("a device name with markup is shown as text", async ({ page }) => {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any;
    const l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.devices[0].name = '<img src=x onerror="window.__pwn=1">';
    el.layout = l;
  }, EDITOR);
  await page.locator("#names").click();
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => (window as any).__pwn)).toBeUndefined();
  await expect(page.locator("svg text.lbl", { hasText: "<img" })).toHaveCount(1);
});
