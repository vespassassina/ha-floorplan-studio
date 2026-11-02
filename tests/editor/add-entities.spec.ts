import { test, expect, type Page } from "@playwright/test";
import type { Layout } from "../../src/core/schema";

// S40.4: Add device lists a single entity of a hub, under its own name, while the search box has text.
// The HA data has the shape src/editor/ha-data.ts builds: entities { id, name, domain, dc, dev }, devices { id, name }.

const EDITOR = "floorplan-studio-editor";
const layoutOf = (page: Page) => page.evaluate((tag) => JSON.parse(JSON.stringify((document.querySelector(tag) as any).layout)) as Layout, EDITOR);
const hist = (page: Page) => page.evaluate((tag) => (document.querySelector(tag) as any).st.hist.length as number, EDITOR);
const setHa = (page: Page, ha: unknown) => page.evaluate(([tag, h]) => { (document.querySelector(tag as string) as any).ha = h; }, [EDITOR, ha]);
const search = (page: Page) => page.locator("#addDevSearch");
const groups = (page: Page) => page.locator("#addDevPanel .grp:visible");

const hub = (n: number) => Array.from({ length: n }, (_, i) => ({
  id: `sensor.gateway_a_${i}`, name: i === 7 ? "Innen Temperatur" : `Gateway A channel ${i}`, domain: "sensor", dc: i === 7 ? "temperature" : undefined, dev: "gw-a",
}));
const HA = { floors: [], areas: [], devices: [{ id: "gw-a", name: "Ecowitt gateway A" }], entities: hub(137) };

async function openDevice(page: Page) {
  await page.locator(`details.menu > summary:text-is("Add")`).click();
  await page.locator("#addDevBtn").click();
  await expect(page.locator("#addDevPanel")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await page.locator("#fixPlan").uncheck();
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  await setHa(page, HA);
});

test("S40.4: with the search empty there is one row for the hub and no Entities group", async ({ page }) => {
  await openDevice(page);
  await expect(page.locator('#addDevPanel button[data-add^="ha-dev:"]')).toHaveCount(1);
  await expect(page.locator('#addDevPanel button[data-add^="ha-ent:"]')).toHaveCount(0);
  expect(await groups(page).allInnerTexts()).not.toContain("Entities");
});

test("S40.4: searching 'innen' lists the sensor under its own name in Entities, at the end, with its device's name", async ({ page }) => {
  await openDevice(page);
  await search(page).fill("innen");
  const row = page.locator('#addDevPanel button[data-add="ha-ent:sensor.gateway_a_7"]');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Innen Temperatur");
  await expect(row).toContainText("Ecowitt gateway A");
  const g = await groups(page).allInnerTexts();
  expect(g.at(-1)).toBe("Entities");
  await search(page).fill("SENSOR.GATEWAY_A_7"); // by entity id, any case
  await expect(row).toHaveCount(1);
});

test("S40.4: a pick places that entity as a temp sensor; the hub leaves the device rows, its other entities stay findable", async ({ page }) => {
  await openDevice(page);
  await search(page).fill("innen");
  const h0 = await hist(page);
  await page.locator('#addDevPanel button[data-add="ha-ent:sensor.gateway_a_7"]').click();
  const d = (await layoutOf(page)).floors.ground.devices.find((x) => "entity" in x && x.entity === "sensor.gateway_a_7")!;
  expect(d).toMatchObject({ type: "temp", name: "Innen Temperatur" });
  expect(await hist(page)).toBe(h0 + 1);
  await search(page).fill("");
  await expect(page.locator('#addDevPanel button[data-add^="ha-dev:"]')).toHaveCount(0); // the hub left the device rows, as today
  await search(page).fill("channel 130");
  await expect(page.locator('#addDevPanel button[data-add="ha-ent:sensor.gateway_a_130"]')).toHaveCount(1);
  await search(page).fill("innen");
  await expect(page.locator('#addDevPanel button[data-add^="ha-ent:"]')).toHaveCount(0); // the placed one is gone from the list
});

// 401 probes: the first is the device row (main entity), so 400 are left for the Entities group.
test("S40.4: 400 matches show 50 rows and the line '50 of 400. Type more to narrow it.'", async ({ page }) => {
  await setHa(page, { ...HA, entities: Array.from({ length: 401 }, (_, i) => ({ id: `sensor.probe_${i}`, name: `Probe ${String(i).padStart(3, "0")}`, domain: "sensor", dev: "gw-a" })) });
  await openDevice(page);
  await search(page).fill("probe");
  await expect(page.locator('#addDevPanel button[data-add^="ha-ent:"]')).toHaveCount(50);
  await expect(page.locator("#addDevMore")).toHaveText("50 of 400. Type more to narrow it.");
  await search(page).fill("probe 39");
  await expect(page.locator('#addDevPanel button[data-add^="ha-ent:"]')).toHaveCount(10);
  await expect(page.locator("#addDevMore")).toHaveCount(0);
});

test("S40.4: a floor or type filter narrows the Entities group too", async ({ page }) => {
  await openDevice(page);
  await search(page).fill("sensor.gateway");
  await expect(page.locator('#addDevPanel button[data-add^="ha-ent:"]').first()).toBeVisible();
  await page.locator("#addDevType").selectOption("temp");
  await expect(page.locator('#addDevPanel button[data-add^="ha-ent:"]')).toHaveCount(1); // only Innen Temperatur is a temp
});
