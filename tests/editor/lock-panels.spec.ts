import { test, expect, type Page } from "@playwright/test";
import type { Layout } from "../../src/core/schema";

// S26.16 (U3): Lock in every panel. The device panel gets a Lock box; a wall, door and opening say "Lock (keeps its
// length)"; furniture and unlinked panels say "Lock". No panel says Fix or "length locked". The selection is set through
// the editor; the tick is a real click on the aside.

const EDITOR = "floorplan-studio-editor";
const layoutOf = (page: Page) => page.evaluate((tag) => JSON.parse(JSON.stringify((document.querySelector(tag) as any).layout)) as Layout, EDITOR);
const ground = async (page: Page) => (await layoutOf(page)).floors.ground;
const undoDepth = (page: Page) => page.evaluate((tag) => (document.querySelector(tag) as any).st.hist.length as number, EDITOR);
const select = (page: Page, t: string, i: number) => page.evaluate(([tag, kind, n]) => { const el = document.querySelector(tag as string) as any; el.st.sel = { t: kind, i: n }; el.requestUpdate(); }, [EDITOR, t, i] as const);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await page.locator("#fixPlan").uncheck();
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout));
    const f = l.floors.ground;
    f.walls.push({ id: "w-t", a: [10, 10], b: [110, 10], kind: "wall" });
    f.openings.push({ id: "o-t", a: [10, 40], b: [60, 40] });
    f.unlinked.push({ id: "u-t", type: "tv", x: 200, y: 200, rot: 0, scale: 1 });
    el.layout = l;
  }, EDITOR);
});

const CASES: { name: string; t: string; box: string; label: RegExp }[] = [
  { name: "device", t: "dev", box: "#vlock", label: /^Lock$/ },
  { name: "wall", t: "wall", box: "#wlock", label: /^Lock \(keeps its length\)$/ },
  { name: "door", t: "door", box: "#dlock", label: /^Lock \(keeps its length\)$/ },
  { name: "opening", t: "opening", box: "#olock", label: /^Lock \(keeps its length\)$/ },
  { name: "furniture", t: "furn", box: "#fulock", label: /^Lock$/ },
  { name: "unlinked", t: "unl", box: "#uulock", label: /^Lock$/ },
];

for (const c of CASES) {
  test(`${c.name} panel: Lock box reads right, never says Fix or "length locked"`, async ({ page }) => {
    const f = await ground(page);
    const idx = c.t === "dev" ? 0 : c.t === "wall" ? f.walls.length - 1 : c.t === "door" ? 0 : c.t === "opening" ? f.openings.length - 1 : c.t === "furn" ? 0 : f.unlinked.length - 1;
    await select(page, c.t, idx);
    const box = page.locator(c.box);
    await expect(box).toBeVisible();
    const label = (await box.locator("xpath=ancestor::label").innerText()).trim();
    expect(label).toMatch(c.label);
    const text = await page.locator("#panel").innerText();
    expect(text).not.toMatch(/fix/i);
    expect(text).not.toMatch(/length locked/i);
  });
}

test("ticking Lock on a device writes locked: true in one undo step; unticking removes it", async ({ page }) => {
  await select(page, "dev", 0);
  const depth = await undoDepth(page);
  await page.locator("#vlock").check();
  expect((await ground(page)).devices[0].locked).toBe(true);
  expect(await undoDepth(page)).toBe(depth + 1);
  await page.locator("#vlock").uncheck();
  expect("locked" in (await ground(page)).devices[0]).toBe(false);
  expect(await undoDepth(page)).toBe(depth + 2);
  await page.locator("#undo").click();
  expect((await ground(page)).devices[0].locked).toBe(true);
});

test("ticking Lock on furniture and on an unlinked appliance writes locked: true", async ({ page }) => {
  await select(page, "furn", 0);
  await page.locator("#fulock").check();
  expect((await ground(page)).furniture[0].locked).toBe(true);
  await select(page, "unl", 0);
  await page.locator("#uulock").check();
  expect((await ground(page)).unlinked[0].locked).toBe(true);
});
