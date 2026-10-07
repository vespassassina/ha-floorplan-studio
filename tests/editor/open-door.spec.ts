import { test, expect, type Page } from "@playwright/test";
import type { Layout } from "../../src/core/schema";

// The open doorway in the editor: add it, set its width, select it by a real click where it is, undo. Every pointer
// action goes through page.mouse at real coordinates (CLAUDE.md finding 3). Nothing is drawn for it unless selected.

const EDITOR = "floorplan-studio-editor";
const layoutOf = (page: Page) => page.evaluate((tag) => JSON.parse(JSON.stringify((document.querySelector(tag) as any).layout)) as Layout, EDITOR);
const doors = async (page: Page) => (await layoutOf(page)).floors.ground.doors;
const len = (o: { a: number[]; b: number[] }) => Math.hypot(o.b[0] - o.a[0], o.b[1] - o.a[1]);
const hit = (page: Page, i: number) => page.locator(`${EDITOR} svg line.door-hit[data-d="${i}"]`);
const drawn = (page: Page, i: number) => page.locator(`${EDITOR} svg line.door[data-d="${i}"]`);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await page.locator("#fixPlan").uncheck(); // the plan opens fixed; these tests edit it
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
});

async function addOpen(page: Page) {
  await page.locator('details.menu > summary:text-is("Add")').click();
  await page.locator('#mAdd details.sub > summary:text-is("Openings")').click();
  await page.locator("#addOpenDoor").click();
}
const deselect = async (page: Page) => {
  await page.locator("#mAdd").evaluate((el) => el.removeAttribute("open"));
  await page.mouse.click(2, 2);
};

test("Add, Openings, Open doorway places a 90 cm door of kind open, selected, with a door's defaults, in one undo step", async ({ page }) => {
  const before = (await doors(page)).length;
  await addOpen(page);
  const d = await doors(page);
  expect(d).toHaveLength(before + 1);
  expect(d.at(-1)).toMatchObject({ kind: "open", name: "new open doorway" });
  expect(len(d.at(-1)!)).toBeCloseTo(90, 5);
  await expect(page.locator("#dk")).toHaveValue("open");
  await expect(page.locator("#dht")).toHaveAttribute("placeholder", "210");
  await expect(page.locator("#dsens")).toBeAttached(); // it keeps a door's sensors
  await page.locator("#undo").click();
  expect(await doors(page)).toHaveLength(before);
});

test("it draws nothing unless selected: a line while selected, none once deselected, the hit area stays", async ({ page }) => {
  await addOpen(page);
  const i = (await doors(page)).length - 1;
  await expect(drawn(page, i)).toHaveClass(/sel/);
  await deselect(page);
  await expect(drawn(page, i)).toHaveCount(0);
  await expect(hit(page, i)).toHaveCount(1);
});

test("a real click where the doorway is selects it, though nothing is drawn there", async ({ page }) => {
  await addOpen(page);
  const i = (await doors(page)).length - 1;
  await deselect(page);
  await expect(page.locator("#dk")).toHaveCount(0);
  const b = (await hit(page, i).boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await expect(page.locator("#dk")).toHaveValue("open");
  await expect(drawn(page, i)).toHaveClass(/sel/);
});

test("the length field sets the width in one undo step", async ({ page }) => {
  await addOpen(page);
  const i = (await doors(page)).length - 1;
  await page.locator("#dl").fill("150");
  await page.locator("#dl").press("Tab");
  expect(len((await doors(page))[i])).toBeCloseTo(150, 5);
  await page.locator("#undo").click();
  expect(len((await doors(page))[i])).toBeCloseTo(90, 5);
});

test("the type selector turns a door into an open doorway and back, one undo step each", async ({ page }) => {
  await addOpen(page);
  const i = (await doors(page)).length - 1;
  await page.locator("#dk").selectOption("door");
  expect((await doors(page))[i].kind).toBe("door");
  await page.locator("#dk").selectOption("open");
  expect((await doors(page))[i].kind).toBe("open");
  await page.locator("#undo").click();
  expect((await doors(page))[i].kind).toBe("door");
  await page.locator("#undo").click();
  expect((await doors(page))[i].kind).toBe("open"); // back to the one that was added
  await page.locator("#undo").click();
  expect(await doors(page)).toHaveLength(i); // the add itself
});

test("hovering an unselected doorway shows a faint outline, moving off it shows none", async ({ page }) => {
  await addOpen(page);
  const i = (await doors(page)).length - 1;
  await deselect(page);
  await expect(drawn(page, i)).toHaveCount(0); // the plan has re-rendered without the selection
  const b = (await hit(page, i).boundingBox())!;
  const stroke = () => hit(page, i).evaluate((el) => getComputedStyle(el).stroke);
  await page.mouse.move(2, 2);
  const off = await stroke();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await expect.poll(stroke).not.toBe(off);
  await page.mouse.move(2, 2);
  await expect.poll(stroke).toBe(off);
});
