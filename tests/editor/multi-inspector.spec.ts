import { test, expect, type Page } from "@playwright/test";
import type { Layout } from "../../src/core/schema";

// S26.15: the Inspector on a multi-selection {t:"devs", is}: count by type, Controlled by (bulk bindLights), Lock (ticked,
// unticked or mixed), Delete n. The selection is set through the editor (the pointer gestures that make one are lane A's);
// everything after it is real clicks on the aside. 20 lights and 2 temperature sensors, a switch in the catalog.

const EDITOR = "floorplan-studio-editor";
const layoutOf = (page: Page) => page.evaluate((tag) => JSON.parse(JSON.stringify((document.querySelector(tag) as any).layout)) as Layout, EDITOR);
const devs = async (page: Page) => (await layoutOf(page)).floors.ground.devices;
const undoDepth = (page: Page) => page.evaluate((tag) => (document.querySelector(tag) as any).st.hist.length as number, EDITOR);
const select = (page: Page, is: number[]) => page.evaluate(([tag, list]) => { const el = document.querySelector(tag as string) as any; el.st.sel = { t: "devs", is: list }; el.requestUpdate(); }, [EDITOR, is] as const);
const LIGHTS = 20;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await page.locator("#fixPlan").uncheck();
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  await page.evaluate(([tag, n]) => {
    const el = document.querySelector(tag as string) as any, l = JSON.parse(JSON.stringify(el.layout));
    const f = l.floors.ground;
    f.devices = [];
    for (let k = 0; k < (n as number); k++) f.devices.push({ id: `sl${k}`, type: "light", name: `Spot ${k}`, entity: `light.spot_${k}`, x: 60 + (k % 5) * 40, y: 60 + Math.floor(k / 5) * 30 });
    f.devices.push({ id: "st0", type: "temp", name: "Temp A", entity: "sensor.temp_a", x: 300, y: 60 });
    f.devices.push({ id: "st1", type: "temp", name: "Temp B", entity: "sensor.temp_b", x: 340, y: 60 });
    l.catalog.unshift({ id: "sw-hall", floor: "ground", room: "Living", type: "switch", name: "Hall relay", entity: "switch.hall_relay" });
    el.layout = l;
  }, [EDITOR, LIGHTS] as const);
  await select(page, Array.from({ length: LIGHTS + 2 }, (_, i) => i));
});

test("the panel counts the selection by type", async ({ page }) => {
  await expect(page.locator("#panel strong").first()).toHaveText("22 devices selected");
  await expect(page.locator("#devsTypes")).toContainText("20 Lights");
  await expect(page.locator("#devsTypes")).toContainText("2 Temperature");
});

test("Controlled by: one pick binds all 20 lights, leaves the sensors, says so, one undo step", async ({ page }) => {
  const depth = await undoDepth(page);
  await page.locator("#vbound input").click();
  await page.locator("#vbound li[role='option'][data-value='switch.hall_relay']").click();
  const d = await devs(page);
  expect(d.filter((x) => x.type === "light" && x.bound === "switch.hall_relay")).toHaveLength(LIGHTS);
  expect(d.filter((x) => x.type === "temp" && "bound" in x)).toHaveLength(0);
  await expect(page.locator("#status")).toHaveText("Bound 20 lights; 2 others left alone");
  expect(await undoDepth(page)).toBe(depth + 1);
  await page.locator("#undo").click();
  expect((await devs(page)).filter((x) => "bound" in x)).toHaveLength(0);
});

test("Controlled by is absent when no light is selected", async ({ page }) => {
  await select(page, [LIGHTS, LIGHTS + 1]);
  await expect(page.locator("#vbound")).toHaveCount(0);
  await expect(page.locator("#devsLock")).toBeVisible(); // the rest of the panel is there, so this is not an empty panel
});

test("Controlled by: (none) clears the 20 and says so; the box shows the one switch they share", async ({ page }) => {
  await page.locator("#vbound input").click();
  await page.locator("#vbound li[role='option'][data-value='switch.hall_relay']").click();
  await expect(page.locator("#vbound input")).toHaveValue(/Hall relay/);
  await page.locator("#vbound input").click();
  await page.locator("#vbound li[role='option'][data-value='']").click();
  expect((await devs(page)).filter((x) => "bound" in x)).toHaveLength(0);
  await expect(page.locator("#status")).toHaveText("Cleared 20 lights; 2 others left alone");
});

test("Lock: mixed shows a half-ticked box; a click locks all, the next unlocks all, each one undo step", async ({ page }) => {
  // lock one device through the layout so the selection is mixed
  await page.evaluate((tag) => { const el = document.querySelector(tag) as any; const l = JSON.parse(JSON.stringify(el.layout)); l.floors.ground.devices[0].locked = true; el.layout = l; el.st.sel = { t: "devs", is: Array.from({ length: 22 }, (_, i) => i) }; el.requestUpdate(); }, EDITOR);
  const box = page.locator("#devsLock");
  await expect(box).toBeVisible();
  expect(await box.evaluate((el: HTMLInputElement) => el.indeterminate)).toBe(true);
  const depth = await undoDepth(page);
  await box.click();
  expect((await devs(page)).every((x) => x.locked === true)).toBe(true);
  expect(await undoDepth(page)).toBe(depth + 1);
  expect(await box.evaluate((el: HTMLInputElement) => ({ c: el.checked, i: el.indeterminate }))).toEqual({ c: true, i: false });
  await box.click();
  expect((await devs(page)).some((x) => x.locked)).toBe(false);
  expect(await undoDepth(page)).toBe(depth + 2);
});

test("Delete 22 removes them all in one undo step; one Undo brings them back", async ({ page }) => {
  const depth = await undoDepth(page);
  const del = page.locator("#devsDel");
  await expect(del).toHaveText("Delete 22");
  await del.click();
  expect(await devs(page)).toHaveLength(0);
  expect(await undoDepth(page)).toBe(depth + 1);
  await page.locator("#undo").click();
  expect(await devs(page)).toHaveLength(22);
});
