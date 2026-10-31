import { test, expect } from "@playwright/test";

// S42.4 (spec decision 8, studio and card parity): the Studio's live view tints a room that is out of range through the same core
// onset memory as the card. The range is typed into the house-range fields (S42.5); the states are set on `hassState`, the property
// the panel sets, with the shape HA gives (state text, attributes, last_changed) as in heat-map.spec.ts. Hold 0 warns at once.

const EDITOR = "floorplan-studio-editor";
const reading = (state: string) => ({ state, attributes: { unit_of_measurement: "°C" }, last_changed: new Date().toISOString() });
const type = async (page: import("@playwright/test").Page, sel: string, v: string) => { await page.locator(sel).fill(v); await page.locator(sel).press("Tab"); };
const feed = (page: import("@playwright/test").Page, v: string) =>
  page.evaluate(([tag, s]) => { (document.querySelector(tag as string) as any).hassState = { "sensor.demo_living_temperature": s }; }, [EDITOR, reading(v)] as const);

test("a hot room is tinted in the live view and clears when the reading is back inside the band", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await page.locator("#fixPlan").uncheck();
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  await type(page, "#hrmin", "17"); await type(page, "#hrmax", "26"); await type(page, "#hrhold", "0");
  await feed(page, "23.5");
  await expect(page.locator(`${EDITOR} svg polygon.temp-wash`)).toHaveCount(0);
  await feed(page, "29");
  await expect(page.locator(`${EDITOR} svg polygon.temp-wash-hot`)).toHaveCount(1);
  await feed(page, "23.5");
  await expect(page.locator(`${EDITOR} svg polygon.temp-wash`)).toHaveCount(0);
});
