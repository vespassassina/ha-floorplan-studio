import { test, expect, type Page } from "@playwright/test";
import type { Floor, Layout } from "../../src/core/schema";

// S14.7: the Room panel's Scenes section. Buttons are pressed with real page.mouse clicks at real coordinates
// (CLAUDE.md finding 3); a native <select> takes selectOption. One gesture is one undo step (finding 6).

const EDITOR = "floorplan-studio-editor";
const layoutOf = (page: Page) => page.evaluate((tag) => JSON.parse(JSON.stringify((document.querySelector(tag) as any).layout)) as Layout, EDITOR);
const roomOf = async (page: Page) => ((await layoutOf(page)).floors.ground as Floor).rooms[0];
const screenOf = (page: Page, x: number, y: number) =>
  page.evaluate(([tag, px, py]) => {
    const svg = (document.querySelector(tag as string) as any).shadowRoot.querySelector("svg") as SVGSVGElement;
    const g = svg.querySelector(":scope > g.plan-turn") as SVGGraphicsElement | null;
    const q = new DOMPoint(px as number, py as number).matrixTransform((g ?? svg).getScreenCTM()!);
    return { x: q.x, y: q.y };
  }, [EDITOR, x, y] as const);
const clickCm = async (page: Page, x: number, y: number) => { const p = await screenOf(page, x, y); await page.mouse.click(p.x, p.y); };
const press = async (page: Page, sel: string) => {
  const b = page.locator(sel);
  await b.scrollIntoViewIfNeeded();
  const r = (await b.boundingBox())!;
  await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
};
const undo = async (page: Page) => { await page.locator(EDITOR).evaluate((el) => (el as HTMLElement).focus()); await page.keyboard.press("Control+z"); };
// The shape of the editor's `ha` (src/core/ha.ts HaData): entities carry domain and area.
const HA = { floors: [], areas: [{ id: "living", name: "Living" }, { id: "kitchen", name: "Kitchen" }], entities: [
  { id: "scene.living_relax", name: "Relax", domain: "scene", area: "living" }, { id: "scene.kitchen_cook", name: "Cook", domain: "scene", area: "kitchen" }, { id: "scene.hall_dim", name: "Hall dim", domain: "scene", area: null },
] };

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  await clickCm(page, 150, 100); // Living, bare floor
  await expect(page.locator("#rsc-add")).toBeVisible();
});

test("Add scene fills a scene with the room's lights on; a second press makes a second scene; each is one undo step", async ({ page }) => {
  expect((await roomOf(page)).scenes).toBeUndefined();
  await press(page, "#rsc-add");
  const r = await roomOf(page);
  expect(r.scenes).toHaveLength(1);
  expect(r.scenes![0].items.map((i) => i.entity)).toContain("light.demo_living");
  expect(r.scenes![0].items.every((i) => i.on)).toBe(true);
  await press(page, "#rsc-add");
  expect((await roomOf(page)).scenes!.map((s) => s.name)).toEqual(["Scene 1", "Scene 2"]);
  await undo(page);
  expect((await roomOf(page)).scenes!.map((s) => s.name)).toEqual(["Scene 1"]);
  await undo(page);
  expect((await roomOf(page)).scenes).toBeUndefined();
});

test("rename, brightness, off and remove are one step each, and a repeated value is none", async ({ page }) => {
  await press(page, "#rsc-add");
  await page.locator("#rsc-name-0").fill("Movie");
  await page.locator("#rsc-name-0").press("Tab");
  expect((await roomOf(page)).scenes![0].name).toBe("Movie");
  await page.locator("#rsc-bri-0-0").fill("20");
  await page.locator("#rsc-bri-0-0").press("Tab");
  expect((await roomOf(page)).scenes![0].items[0].brightness).toBe(20);
  await page.locator("#rsc-bri-0-0").fill("20"); // the same value again
  await page.locator("#rsc-bri-0-0").press("Tab");
  await page.locator("#rsc-bri-0-0").fill("500");
  await page.locator("#rsc-bri-0-0").press("Tab");
  expect((await roomOf(page)).scenes![0].items[0].brightness).toBe(100);
  await undo(page); // 500 -> back to 20: the repeat of 20 left no step
  expect((await roomOf(page)).scenes![0].items[0].brightness).toBe(20);
  await clickCm(page, 150, 100); // undo clears the selection: pick the room again
  await page.locator("#rsc-on-0-0").selectOption("off");
  expect((await roomOf(page)).scenes![0].items[0]).toEqual({ entity: "light.demo_living", on: false });
  await expect(page.locator("#rsc-bri-0-0")).toHaveCount(0);
  const before = (await roomOf(page)).scenes![0].items.length;
  await press(page, "#rsc-rm-0-0");
  expect((await roomOf(page)).scenes![0].items).toHaveLength(before - 1);
  await undo(page);
  expect((await roomOf(page)).scenes![0].items).toHaveLength(before);
  await clickCm(page, 150, 100);
  await page.locator("#rsc-name-0").fill("   "); // refused: the name stays
  await page.locator("#rsc-name-0").press("Tab");
  expect((await roomOf(page)).scenes![0].name).toBe("Movie");
});

test("add to scene puts a missing light or switch back; Delete scene removes it and the empty list goes", async ({ page }) => {
  await press(page, "#rsc-add");
  await press(page, "#rsc-rm-0-0");
  const left = (await roomOf(page)).scenes![0].items.map((i) => i.entity);
  expect(left).not.toContain("light.demo_living");
  await page.locator("#rsc-add-0").selectOption("light.demo_living");
  expect((await roomOf(page)).scenes![0].items.map((i) => i.entity)).toContain("light.demo_living");
  await press(page, "#rsc-del-0");
  expect((await roomOf(page)).scenes).toBeUndefined();
});

test("with Home Assistant: the room's area scenes are named, the others can be offered, and Remove stops offering", async ({ page }) => {
  await page.evaluate(([tag, ha]) => { (document.querySelector(tag as string) as any).ha = ha; }, [EDITOR, HA] as const);
  await page.locator("#ra").selectOption("living");
  await expect(page.locator("#rsc-add")).toBeVisible();
  await expect(page.getByText("In this area: Relax")).toBeVisible();
  const opts = await page.locator("#rsc-ha-add option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  expect(opts).toEqual(["", "scene.kitchen_cook", "scene.hall_dim"]); // not the area's own, not offered twice
  await page.locator("#rsc-ha-add").selectOption("scene.hall_dim");
  expect((await roomOf(page)).haScenes).toEqual(["scene.hall_dim"]);
  await press(page, "#rsc-ha-rm-0");
  expect((await roomOf(page)).haScenes).toBeUndefined();
  await undo(page);
  expect((await roomOf(page)).haScenes).toEqual(["scene.hall_dim"]);
});

test("a zone has no Scenes section (nothing on the card would show it)", async ({ page }) => {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag as string) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.rooms[0].kind = "zone"; l.floors.ground.rooms[0].wk = l.floors.ground.rooms[0].pts.map(() => "boundary");
    el.layout = l;
  }, EDITOR);
  await expect(page.locator("#rsc-add")).toHaveCount(0);
});
