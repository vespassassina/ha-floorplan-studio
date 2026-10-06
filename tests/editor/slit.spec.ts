import { test, expect, type Page } from "@playwright/test";
import type { Layout } from "../../src/core/schema";

// The slit window in the editor: add it, set its width, see it, select it by a real click, undo. Every pointer action
// goes through page.mouse at real coordinates (CLAUDE.md finding 3). Slit 2D drawing is a thin band of the window mark.

const EDITOR = "floorplan-studio-editor";
const layoutOf = (page: Page) => page.evaluate((tag) => JSON.parse(JSON.stringify((document.querySelector(tag) as any).layout)) as Layout, EDITOR);
const doors = async (page: Page) => (await layoutOf(page)).floors.ground.doors;
const len = (o: { a: number[]; b: number[] }) => Math.hypot(o.b[0] - o.a[0], o.b[1] - o.a[1]);
const line = (page: Page, i: number) => page.locator(`${EDITOR} svg line.door[data-d="${i}"]`);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
});

async function addSlit(page: Page) {
  await page.locator('details.menu > summary:text-is("Add")').click();
  await page.locator('#mAdd details.sub > summary:text-is("Openings")').click();
  await page.locator("#addSlit").click();
}

test("Add, Openings, Slit window places a 120 cm slit, selected, with the window's fields and a 60 cm default", async ({ page }) => {
  const before = (await doors(page)).length;
  await addSlit(page);
  const d = await doors(page);
  expect(d).toHaveLength(before + 1);
  expect(d.at(-1)).toMatchObject({ kind: "slit", name: "new slit window" });
  expect(len(d.at(-1)!)).toBeCloseTo(120, 5);
  expect("height" in d.at(-1)!).toBe(false); // the default is read, never stored
  expect("sill" in d.at(-1)!).toBe(false);
  await expect(page.locator("#dk")).toHaveValue("slit");
  await expect(page.locator("#dht")).toHaveAttribute("placeholder", "60");
  await expect(page.locator("#dsill")).toHaveAttribute("placeholder", "190"); // the demo's storey is 250: 250 - 60
  await expect(page.locator("#dsill")).toBeVisible();
  await expect(page.locator("#dcover")).toBeAttached();
  await expect(page.locator('label[for="dcover"]')).toHaveText("electric curtain"); // cover is curtains, as on a window
  await expect(line(page, d.length - 1)).toHaveClass(/door-slit/);
});

test("the length field sets the width, in one undo step, and the band on the plan follows it", async ({ page }) => {
  await addSlit(page);
  const i = (await doors(page)).length - 1;
  // Pixels of a 90 cm reference door on the same plan give the scale, so a view that re-fits after the edit cannot fool it.
  // The line's own geometry (getBoundingClientRect); Playwright's boundingBox adds the stroke.
  const px = (sel: string) => page.locator(sel).first().evaluate((el) => { const b = el.getBoundingClientRect(); return Math.max(b.width, b.height); });
  const ref = len((await doors(page))[0]); // door 0, by its own layout length
  const cm = async () => (await px(`${EDITOR} svg line.door-slit`)) / ((await px(`${EDITOR} svg line.door[data-d="0"]`)) / ref);
  await expect.poll(cm, { message: "the plan settles at 120 cm" }).toBeCloseTo(120, -1);
  await page.locator("#dl").fill("240");
  await page.locator("#dl").press("Tab");
  expect(len((await doors(page))[i])).toBeCloseTo(240, 5);
  await expect.poll(cm).toBeCloseTo(240, -1); // twice as long on screen, in real pixels
  await page.locator("#undo").click();
  expect(len((await doors(page))[i])).toBeCloseTo(120, 5);
  await expect.poll(cm).toBeCloseTo(120, -1);
});

test("the slit is a band 0.4 as thick as a window on the same wall, and a real click on it selects it", async ({ page }) => {
  await addSlit(page);
  const i = (await doors(page)).length - 1;
  await page.locator("#mAdd").evaluate((el) => el.removeAttribute("open"));
  await page.mouse.click(2, 2); // unselected: a selected door is drawn 8 cm wider
  await expect(line(page, i)).not.toHaveClass(/sel/);
  // The stroke the browser resolves, in plan units (a line's bounding box has no thickness).
  const thick = (sel: string) => page.locator(sel).first().evaluate((el) => parseFloat(getComputedStyle(el).strokeWidth));
  const slitT = await thick(`${EDITOR} svg line.door-slit`);
  // The same door as a window, on the same wall: only the kind differs.
  await page.evaluate((tag) => { const el = document.querySelector(tag as string) as any, l = JSON.parse(JSON.stringify(el.layout)); l.floors.ground.doors.at(-1).kind = "window"; el.layout = l; }, EDITOR);
  const windowT = await thick(`${EDITOR} svg line.door-window`);
  expect(slitT).toBeGreaterThan(0);
  expect(slitT / windowT).toBeCloseTo(0.4, 1);
  await page.evaluate((tag) => { const el = document.querySelector(tag as string) as any, l = JSON.parse(JSON.stringify(el.layout)); l.floors.ground.doors.at(-1).kind = "slit"; el.layout = l; }, EDITOR);
  // click the slit at its middle, on the real top element
  const b = (await line(page, i).boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await expect(page.locator("#dk")).toHaveValue("slit");
});

test("changing the type of a window to slit, and back, is one undo step each", async ({ page }) => {
  await addSlit(page);
  await page.locator("#dk").selectOption("window");
  expect((await doors(page)).at(-1)!.kind).toBe("window");
  await expect(page.locator("#dht")).toHaveAttribute("placeholder", "120");
  await page.locator("#dk").selectOption("slit");
  expect((await doors(page)).at(-1)!.kind).toBe("slit");
  await page.locator("#undo").click();
  expect((await doors(page)).at(-1)!.kind).toBe("window");
});

test("an own height and sill are kept as typed; clearing them brings the default back", async ({ page }) => {
  await addSlit(page);
  await page.locator("#dht").fill("40");
  await page.locator("#dht").press("Tab");
  await page.locator("#dsill").fill("200");
  await page.locator("#dsill").press("Tab");
  expect((await doors(page)).at(-1)).toMatchObject({ height: 40, sill: 200 });
  await page.locator("#dht").fill("");
  await page.locator("#dht").press("Tab");
  expect("height" in (await doors(page)).at(-1)!).toBe(false);
});

test("the sill default follows the wall the slit hangs from: a 300 cm storey reads 240", async ({ page }) => {
  await page.evaluate((tag) => { const el = document.querySelector(tag as string) as any, l = JSON.parse(JSON.stringify(el.layout)); l.floors.ground.height = 300; el.layout = l; }, EDITOR);
  await addSlit(page);
  await expect(page.locator("#dsill")).toHaveAttribute("placeholder", "240");
  await expect(page.locator("#dht")).toHaveAttribute("placeholder", "60");
});
