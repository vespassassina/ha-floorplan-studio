import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { menuItem, menuPanel, openMenu, closeMenu, pick, checkedIn, hasItem, resetView, menuButton } from "./menu-helper";
import { open as open3d, configure as configure3d, drawn, holder, card as card3d } from "./helpers-3d";
import { cardSource } from "../../scripts/card-source.mjs";

// S33.8 (docs/specs/extras-s33.md, X3 Card, criterion 10): the layout's saved views are the Views section of the card's ⋯ menu,
// one radio-like item per view, `data-value` `view:<id>`. A pick is a viewer's pick: floor, then mode, then turn (a view that names
// none is turned 0), then zoom and centre (zoom is a ratio against the card's own fit). It is remembered like any pick; Reset view
// goes back to the config. A view on a floor the card's `floors` leaves out is not offered. Real clicks on the real menu.

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = cardSource(); // the card with its Overview chunk inlined (scripts/card-source.mjs)

const VIEWS = [
  { id: "view-bed-close", name: "Bed close", floor: "first", zoom: 3, center: [120, 90] },
  { id: "view-turned", name: "Turned flat", floor: "ground", rotation: 90, mode: "2.5d" },
  { id: "view-test-room", name: "Test room", floor: "test", zoom: 2, center: [200, 200] },
  { id: "view-3d", name: "House in 3D", floor: "ground", mode: "3d" },
  { id: "2d", name: "Clashes with the 2D mode", floor: "ground" },
];
const withViews = (views: unknown) => ({ ...structuredClone(demo), views });

const card = (page: Page) => page.locator("floorplan-studio-card");
const viewBox = (page: Page) => card(page).evaluate((el) => el.shadowRoot!.querySelector("svg.fp-zoomable")!.getAttribute("viewBox")!.split(/\s+/).map(Number));
const planDeg = (page: Page) => card(page).evaluate((el) => {
  const m = el.shadowRoot!.querySelector("svg g.plan-turn")?.getAttribute("transform")?.match(/^rotate\((-?[\d.]+)/);
  return m ? Number(m[1]) : 0;
});
const settled = (page: Page) => expect(card(page).locator("css=svg.fp-turning")).toHaveCount(0);
const chip = (page: Page, title: string) => card(page).locator("css=.fp-floors button").filter({ hasText: new RegExp(`^${title}`) });
const shownFloor = (page: Page) => card(page).evaluate((el) => [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>(".fp-floors button")].find((b) => b.getAttribute("aria-pressed") === "true")?.textContent?.trim().split(" ")[0] ?? "");
const view = (id: string) => `view:${id}`;

async function boot(page: Page, config: Record<string, unknown>, layout: unknown = withViews(VIEWS), fresh = true) {
  await page.setViewportSize({ width: 1100, height: 900 });
  if (fresh) await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(([c, l]) => {
    const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig({ type: "custom:floorplan-studio-card", layout: l, ...(c as object) });
    el.hass = { states: {}, themes: { darkMode: false } };
    return el.updateComplete;
  }, [config, layout] as const);
}

test.describe("S33.8 saved views in the card", () => {
  test("the Views section lists each view of the layout as a radio, names as text", async ({ page }) => {
    const bad = [{ id: "view-x", name: '"><script>window.__x=1</script>', floor: "ground" }];
    await boot(page, { view: "2d" }, withViews(bad));
    await openMenu(page);
    const item = menuItem(page, view("view-x"));
    await expect(item).toHaveCount(1);
    await expect(item).toHaveAttribute("role", "menuitemradio");
    await expect(item).toContainText('"><script>window.__x=1</script>');
    expect(await page.evaluate(() => (window as unknown as { __x?: number }).__x)).toBeUndefined();
    await expect(menuPanel(page).locator('css=[role=group][aria-label="Views"]')).toHaveCount(1);
  });

  test("a layout with no views has no Views section", async ({ page }) => {
    await boot(page, { view: "2d" }, structuredClone(demo));
    await openMenu(page);
    await expect(menuPanel(page).locator('css=[role=group][aria-label="Views"]')).toHaveCount(0);
  });

  test("a real click on a view switches floor and zooms to the ratio against the card's fit, centred; reload keeps it; Reset view returns to the config", async ({ page }) => {
    await boot(page, { view: "2d" });
    await chip(page, "First").click();
    const fit = await viewBox(page); // the first floor, whole: the card's own fit
    await chip(page, "Ground").click();
    expect(await shownFloor(page)).toBe("Ground");
    await pick(page, view("view-bed-close"));
    await settled(page);
    expect(await shownFloor(page)).toBe("First");
    const b = await viewBox(page);
    expect(b[2]!).toBeCloseTo(fit[2]! / 3, 1);
    expect(b[3]!).toBeCloseTo(fit[3]! / 3, 1);
    expect(b[0]! + b[2]! / 2).toBeCloseTo(120, 0);
    expect(b[1]! + b[3]! / 2).toBeCloseTo(90, 0);
    // a real reload keeps it
    await page.reload();
    await boot(page, { view: "2d" }, withViews(VIEWS), false);
    await settled(page);
    const again = await viewBox(page);
    for (let i = 0; i < 4; i++) expect(again[i]!).toBeCloseTo(b[i]!, 1);
    await resetView(page);
    await settled(page);
    const home = await viewBox(page);
    for (let i = 0; i < 4; i++) expect(home[i]!).toBeCloseTo(fit[i]!, 1);
  });

  test("a view with a turn and a mode applies both; a view with no rotation turns the plan back to 0", async ({ page }) => {
    await boot(page, { view: "2d" });
    await pick(page, view("view-turned"));
    await settled(page);
    expect(await planDeg(page)).toBe(90);
    expect(await checkedIn(page, "view", ["2d", "2.5d", "3d"])).toBe("2.5d");
    await pick(page, view("view-bed-close")); // no rotation, no mode: turned 0, the mode stays the viewer's
    await settled(page);
    expect(await planDeg(page)).toBe(0);
    expect(await checkedIn(page, "view", ["2d", "2.5d", "3d"])).toBe("2.5d");
  });

  test("the applied view is the checked one; picking a floor chip clears it", async ({ page }) => {
    await boot(page, { view: "2d" });
    await pick(page, view("view-bed-close"));
    await settled(page);
    await openMenu(page);
    await expect(menuItem(page, view("view-bed-close"))).toHaveAttribute("aria-checked", "true");
    await expect(menuItem(page, view("view-turned"))).toHaveAttribute("aria-checked", "false");
    await closeMenu(page);
    await chip(page, "Ground").click();
    await openMenu(page);
    await expect(menuItem(page, view("view-bed-close"))).toHaveAttribute("aria-checked", "false");
  });

  test("a view on a floor the card's `floors` leaves out is not offered; one on a listed floor is", async ({ page }) => {
    await boot(page, { view: "2d", floors: ["ground", "first"] });
    await openMenu(page);
    await expect(menuItem(page, view("view-test-room"))).toHaveCount(0);
    await expect(menuItem(page, view("view-bed-close"))).toHaveCount(1);
  });

  test("a card pinned to one floor offers that floor's views only", async ({ page }) => {
    await boot(page, { view: "2d", floor: "first" });
    await openMenu(page);
    await expect(menuItem(page, view("view-bed-close"))).toHaveCount(1);
    await expect(menuItem(page, view("view-turned"))).toHaveCount(0);
  });

  test("a view id that is a View mode (2d) is not offered: its item would be the mode's", async ({ page }) => {
    await boot(page, { view: "2d" });
    await openMenu(page);
    await expect(menuPanel(page).locator('css=[data-value="view:2d"]')).toHaveCount(1); // the mode radio, only
    await expect(menuPanel(page).locator('css=[data-value="view:2d"]')).toHaveAttribute("role", "menuitemradio");
    await expect(menuPanel(page).locator('css=[role=group][aria-label="Views"] [data-value="view:2d"]')).toHaveCount(0);
  });

  test("a hass update keeps the applied view", async ({ page }) => {
    await boot(page, { view: "2d" });
    await pick(page, view("view-bed-close"));
    await settled(page);
    const before = await viewBox(page);
    await page.evaluate(() => {
      const el = document.getElementById("card") as unknown as { hass: unknown; updateComplete: Promise<unknown> };
      el.hass = { states: { "light.x": { state: "on", attributes: {}, last_changed: "2026-10-04T09:30:15Z" } }, themes: { darkMode: false } };
      return el.updateComplete;
    });
    expect(await shownFloor(page)).toBe("First");
    const after = await viewBox(page);
    for (let i = 0; i < 4; i++) expect(after[i]!).toBeCloseTo(before[i]!, 2);
    await openMenu(page);
    await expect(menuItem(page, view("view-bed-close"))).toHaveAttribute("aria-checked", "true");
  });

  test("view_switch: false still has the Views section; kiosk has no menu", async ({ page }) => {
    await boot(page, { view: "2d", view_switch: false });
    expect(await hasItem(page, view("view-turned"))).toBe(true);
    await boot(page, { view: "2d", kiosk: true });
    await expect(menuButton(page)).toHaveCount(0);
  });

  test("in 3D a view picks its floor and mode and keeps the framed camera (no zoom, no centre)", async ({ page }) => {
    await open3d(page, { layout: withViews(VIEWS), view: "3d" });
    await expect(holder(page)).toBeVisible();
    await drawn(page);
    await pick(page, view("view-bed-close"));
    await expect.poll(() => card3d(page).evaluate((el) => [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>(".fp-floors button")].find((b) => b.getAttribute("aria-pressed") === "true")?.textContent?.trim().split(" ")[0])).toBe("First");
    await expect(holder(page)).toBeVisible(); // still 3D
    await drawn(page);
    expect(await checkedIn(page, "view", ["2d", "2.5d", "3d"])).toBe("3d");
  });

  test("a view whose mode is 3d switches a 2D card to 3D", async ({ page }) => {
    await open3d(page, { layout: withViews(VIEWS), view: "2d" });
    await expect(holder(page)).toHaveCount(0);
    await pick(page, view("view-3d"));
    await expect(holder(page)).toBeVisible();
    await configure3d(page, { layout: withViews(VIEWS), view: "2d" }); // setConfig again: the pick stays
    await expect(holder(page)).toBeVisible();
  });
});
