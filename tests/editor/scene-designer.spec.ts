import { test, expect, type Page } from "@playwright/test";
import type { Layout } from "../../src/core/schema";

// S17.3 (docs/specs/scene-designer.md): the scene designer popup. Real mouse at real coordinates (CLAUDE.md finding 3). The colour
// box is a native picker, which a script cannot open: its value is filled, which fires the same `input` event a pick does.

const EDITOR = "floorplan-studio-editor";
const layoutOf = (page: Page) => page.evaluate((tag) => JSON.parse(JSON.stringify((document.querySelector(tag) as any).layout)) as Layout, EDITOR);
const scenes = async (page: Page) => (await layoutOf(page)).floors.ground.rooms[0].scenes ?? [];
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

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto("/standalone.html");
  await page.locator("#fixPlan").uncheck();
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  const p = await screenOf(page, 150, 100);
  await page.mouse.click(p.x, p.y);
  await press(page, "#rsc-new");
  await expect(page.locator("#scenePanel")).toBeVisible();
});

const firstRow = (page: Page) => page.locator("#scenePanel .sd-row").first();

test("New scene opens a popup listing the room's devices; nothing is in the layout yet", async ({ page }) => {
  await expect(page.locator("#scenePanel .sd-row").first()).toBeVisible();
  expect(await page.locator("#scenePanel .sd-row").count()).toBeGreaterThan(0);
  expect(await scenes(page)).toHaveLength(0);
});

test("Save without a name says why and stays open; with no device it says that; the layout does not change", async ({ page }) => {
  await press(page, "#sceneSave");
  await expect(page.locator("#sceneError")).toHaveText("Give the scene a name.");
  await page.locator("#sceneName").fill("Movie");
  await press(page, "#sceneSave");
  await expect(page.locator("#sceneError")).toHaveText("Pick at least one device.");
  await expect(page.locator("#scenePanel")).toBeVisible();
  expect(await scenes(page)).toHaveLength(0);
});

test("tick a light, set its brightness and kelvin, name it, Save: one scene, one undo step, popup closed", async ({ page }) => {
  await page.locator("#sceneName").fill("Movie");
  await press(page, "#sd-inc-0");
  const bri = page.locator("#sd-brightness-0"), kel = page.locator("#sd-kelvin-0");
  await bri.fill("40"); await bri.press("Tab");
  await kel.fill("2700"); await kel.press("Tab");
  await press(page, "#sceneSave");
  await expect(page.locator("#scenePanel")).toHaveCount(0);
  const s = await scenes(page);
  expect(s).toHaveLength(1);
  expect(s[0].name).toBe("Movie");
  expect(s[0].items).toHaveLength(1);
  expect(s[0].items[0]).toMatchObject({ on: true, brightness: 40, kelvin: 2700 });
  await press(page, "#undo");
  expect(await scenes(page)).toHaveLength(0);
});

test("a colour replaces the kelvin, and kelvin replaces the colour: a light holds one of them", async ({ page }) => {
  await page.locator("#sceneName").fill("Red");
  await press(page, "#sd-inc-0");
  await page.locator("#sd-kelvin-0").fill("3000"); await page.locator("#sd-kelvin-0").press("Tab");
  await page.locator("#sd-col-0").fill("#ff0000");
  await press(page, "#sceneSave");
  let it = (await scenes(page))[0].items[0];
  expect(it.hs).toEqual([0, 100]);
  expect(it.kelvin).toBeUndefined();
  await press(page, "#rsc-edit-0");
  await page.locator("#sd-kelvin-0").fill("2200"); await page.locator("#sd-kelvin-0").press("Tab");
  await press(page, "#sceneSave");
  it = (await scenes(page))[0].items[0];
  expect(it.kelvin).toBe(2200);
  expect(it.hs).toBeUndefined();
});

test("Cancel, the X and Escape change nothing and add no undo step", async ({ page }) => {
  await page.locator("#sceneName").fill("Nope");
  await press(page, "#sd-inc-0");
  await press(page, "#sceneCancel");
  await expect(page.locator("#scenePanel")).toHaveCount(0);
  expect(await scenes(page)).toHaveLength(0);
  await expect(page.locator("#undo")).toBeDisabled();
  await press(page, "#rsc-new");
  await page.locator("#sceneName").fill("Nope");
  await press(page, "#sceneClose");
  await expect(page.locator("#scenePanel")).toHaveCount(0);
  await press(page, "#rsc-new");
  await page.locator("#sceneName").press("Escape");
  await expect(page.locator("#scenePanel")).toHaveCount(0);
  expect(await scenes(page)).toHaveLength(0);
});

test("an off device drops its fields; Edit opens the saved scene and Save replaces it in place", async ({ page }) => {
  await page.locator("#sceneName").fill("Night");
  await press(page, "#sd-inc-0");
  await page.locator("#sd-brightness-0").fill("10"); await page.locator("#sd-brightness-0").press("Tab");
  await page.locator("#sd-on-0").selectOption("off");
  await expect(page.locator("#sd-brightness-0")).toHaveCount(0);
  await press(page, "#sceneSave");
  expect((await scenes(page))[0].items[0]).toEqual({ entity: expect.any(String), on: false });
  await press(page, "#rsc-edit-0");
  await expect(page.locator("#sceneName")).toHaveValue("Night");
  await page.locator("#sceneName").fill("Late");
  await press(page, "#sceneSave");
  const s = await scenes(page);
  expect(s).toHaveLength(1);
  expect(s[0].name).toBe("Late");
  expect(s[0].id).toBe("scene-1");
});

test("a name that is typed survives a re-render while the box has focus", async ({ page }) => {
  await page.locator("#sceneName").click();
  await page.keyboard.type("Dinner");
  await press(page, "#sd-inc-0");
  await expect(page.locator("#sceneName")).toHaveValue("Dinner");
  void firstRow;
});
