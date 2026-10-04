import { test, expect, type Page } from "@playwright/test";
import type { Floor, Layout } from "../../src/core/schema";

// S11.2: a room owns temperature, humidity and motion sensors. Every pointer action is a real page.mouse click at
// real coordinates (CLAUDE.md finding 3); the layout is read back from the editor element, not from the DOM.

const EDITOR = "floorplan-studio-editor";
const layoutOf = (page: Page) => page.evaluate((tag) => JSON.parse(JSON.stringify((document.querySelector(tag) as any).layout)) as Layout, EDITOR);
const groundOf = async (page: Page): Promise<Floor> => (await layoutOf(page)).floors.ground;
const screenOf = (page: Page, x: number, y: number) =>
  page.evaluate(([tag, px, py]) => {
    const svg = (document.querySelector(tag as string) as any).shadowRoot.querySelector("svg") as SVGSVGElement;
    const g = svg.querySelector(":scope > g.plan-turn") as SVGGraphicsElement | null;
    const q = new DOMPoint(px as number, py as number).matrixTransform((g ?? svg).getScreenCTM()!);
    return { x: q.x, y: q.y };
  }, [EDITOR, x, y] as const);
const clickCm = async (page: Page, x: number, y: number) => { const p = await screenOf(page, x, y); await page.mouse.click(p.x, p.y); };
const optionValues = async (page: Page, sel: string) => {
  await page.locator(sel).locator("input").click();
  const v = await page.locator(sel).locator("li[role='option']").evaluateAll((els) => els.map((e) => e.getAttribute("data-value") ?? ""));
  await page.keyboard.press("Escape");
  return v;
};
async function pick(page: Page, sel: string, value: string) {
  const host = page.locator(sel);
  await host.locator("input").click();
  await host.locator("input").fill(value);
  await host.locator(`li[role="option"][data-value="${value}"]`).click();
}
const icons = (page: Page) => page.locator("g[data-x]").count();

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
});

test("S11.2: the room panel lists only entities of the right kind in each picker", async ({ page }) => {
  await clickCm(page, 150, 100); // Living room floor, clear of icons and furniture
  await expect(page.locator("#rtemp")).toBeVisible();
  expect(await optionValues(page, "#rtemp")).toEqual(["", "sensor.demo_living_temperature", "sensor.demo_bedroom_temperature"]);
  expect(await optionValues(page, "#rhum")).toEqual(["", "sensor.demo_bathroom_humidity"]);
  expect(await optionValues(page, "#rmot")).toEqual(["", "binary_sensor.demo_hall_motion"]);
});

test("S11.2: a pick is one undo step that restores the list and the icon; a repeat is no step; Remove is one step", async ({ page }) => {
  await clickCm(page, 150, 100);
  const iconsBefore = await icons(page);
  await pick(page, "#rtemp", "sensor.demo_living_temperature");
  expect((await groundOf(page)).rooms[0].temps).toEqual(["sensor.demo_living_temperature"]);
  expect(await icons(page)).toBe(iconsBefore - 1);
  await expect(page.locator("#rtemp-rm0")).toBeVisible();
  expect(await optionValues(page, "#rtemp")).not.toContain("sensor.demo_living_temperature"); // kept out of the list twice
  // one Ctrl+Z puts back both the room list and the icon (shortcut goes to the editor host)
  await page.locator(EDITOR).evaluate((el) => (el as HTMLElement).focus());
  await page.keyboard.press("Control+z");
  expect((await groundOf(page)).rooms[0].temps).toBeUndefined();
  expect(await icons(page)).toBe(iconsBefore);
  await page.keyboard.press("Control+Shift+z");
  expect((await groundOf(page)).rooms[0].temps).toEqual(["sensor.demo_living_temperature"]);
  // Remove detaches only, one step, the icon stays gone (undo and redo clear the selection: select the room again)
  await clickCm(page, 150, 100);
  await page.locator("#rtemp-rm0").click();
  expect((await groundOf(page)).rooms[0].temps).toBeUndefined();
  expect(await icons(page)).toBe(iconsBefore - 1);
  await page.locator(EDITOR).evaluate((el) => (el as HTMLElement).focus());
  await page.keyboard.press("Control+z");
  expect((await groundOf(page)).rooms[0].temps).toEqual(["sensor.demo_living_temperature"]);
});

test("S11.2: another room's sensor is not offered; a sensor name with markup is shown as text", async ({ page }) => {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.catalog.push({ id: "evil", floor: "ground", room: "", type: "temp", name: '"><script>window.__pwn=1</script>', entity: "sensor.evil" });
    l.floors.ground.rooms[1].temps = ["sensor.demo_bedroom_temperature"];
    el.layout = l;
  }, EDITOR);
  await clickCm(page, 150, 100);
  const offered = await optionValues(page, "#rtemp");
  expect(offered).not.toContain("sensor.demo_bedroom_temperature"); // Kitchen owns it
  await pick(page, "#rtemp", "sensor.evil");
  await expect(page.locator("#rtemp-rm0").locator("xpath=..")).toContainText('"><script>');
  expect(await page.evaluate(() => (window as any).__pwn)).toBeUndefined();
  expect(await page.locator(`${EDITOR} script`).count()).toBe(0);
});

test("S11.2: Attach to room moves a loose sensor into its room in one undo step", async ({ page }) => {
  const iconsBefore = await icons(page);
  await clickCm(page, 380, 120); // temp-living icon
  await expect(page.locator("#vattach")).toBeEnabled();
  await page.locator("#vattach").click();
  const g = await groundOf(page);
  expect(g.rooms[0].temps).toEqual(["sensor.demo_living_temperature"]);
  expect(g.devices.some((d) => d.id === "temp-living")).toBe(false);
  expect(await icons(page)).toBe(iconsBefore - 1);
  expect(await page.locator("#status").textContent()).toContain("Living");
  await page.locator(EDITOR).evaluate((el) => (el as HTMLElement).focus());
  await page.keyboard.press("Control+z");
  const back = await groundOf(page);
  expect(back.rooms[0].temps).toBeUndefined();
  expect(back.devices.some((d) => d.id === "temp-living")).toBe(true);
  expect(await icons(page)).toBe(iconsBefore);
  await page.keyboard.press("Control+z"); // nothing else was recorded: the layout is the one we loaded
  expect(await groundOf(page)).toEqual(back);
});

test("S11.2: Attach to room is disabled with the reason: outside every room, no entity", async ({ page }) => {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout));
    const d = l.floors.ground.devices;
    d.find((x: any) => x.id === "temp-living").x = 1500; // far outside the plan
    d.find((x: any) => x.id === "motion-hall").entity = "";
    el.layout = l;
  }, EDITOR);
  // the icon of temp-living is now off the plan, out of reach of the mouse: select it through the editor state instead
  await page.evaluate((tag) => { const el = document.querySelector(tag) as any; el.st.sel = { t: "dev", i: el.layout.floors.ground.devices.findIndex((x: any) => x.id === "temp-living") }; el.requestUpdate(); }, EDITOR);
  await expect(page.locator("#vattach")).toBeDisabled();
  await expect(page.locator("#vattach-why")).toContainText("not inside a room");
  await page.evaluate((tag) => { const el = document.querySelector(tag) as any; el.st.sel = { t: "dev", i: el.layout.floors.ground.devices.findIndex((x: any) => x.id === "motion-hall") }; el.requestUpdate(); }, EDITOR);
  await expect(page.locator("#vattach")).toBeDisabled();
  await expect(page.locator("#vattach-why")).toContainText("no Home Assistant entity");
});

test("S11.2: a sensor already on a room is still drawn and says which room owns it", async ({ page }) => {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.rooms[0].temps = ["sensor.demo_living_temperature"];
    el.layout = l;
  }, EDITOR);
  await clickCm(page, 380, 120);
  await expect(page.locator("#vattached")).toContainText("Attached to Living");
  await expect(page.locator("#vattach")).toHaveCount(0);
});
