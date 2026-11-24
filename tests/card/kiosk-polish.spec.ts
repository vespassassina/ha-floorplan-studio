import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { cardSource } from "../../scripts/card-source.mjs";

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = cardSource();

const STATES = {
  "light.demo_living": { state: "on", attributes: { friendly_name: "Living light" }, last_changed: "2026-11-24T12:00:00Z" },
  "weather.home": { state: "sunny", attributes: { temperature: 22.5, temperature_unit: "°C" }, last_changed: "2026-11-24T12:00:00Z" },
};

async function boot(page: Page, config: Record<string, unknown>, states: Record<string, unknown> = STATES) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(([cfg, st]) => {
    const w = window as unknown as { __calls: string[] };
    w.__calls = [];
    const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(cfg);
    el.hass = { states: st, callService: (d: string, s: string, data: { entity_id?: string }) => { w.__calls.push(`${d}.${s} ${data?.entity_id ?? ""}`); } };
    return el.updateComplete;
  }, [{ layout: demo, ...config }, states] as const);
}

const card = (page: Page) => page.locator("floorplan-studio-card");

test.describe("Sprint 65: wall-tablet & mobile kiosk polish", () => {
  test("header_clock shows clock and weather in normal header and in kiosk mode", async ({ page }) => {
    await page.clock.install({ time: new Date(2026, 10, 24, 14, 32, 0) });
    await boot(page, { floor: "all", header_clock: true });
    const chip = card(page).locator("css=.fp-head-clock");
    await expect(chip).toBeVisible();
    await expect(chip).toHaveText("14:32 · 22.5 °C · Sunny");

    await boot(page, { floor: "ground", kiosk: true, header_clock: true });
    const pill = card(page).locator("css=.fp-kiosk-clock");
    await expect(pill).toBeVisible();
    await expect(pill).toHaveText("14:32 · 22.5 °C · Sunny");
  });

  test("idle_return closes open popup and returns to default floor after inactivity", async ({ page }) => {
    await page.clock.install({ time: new Date(2026, 10, 24, 14, 0, 0) });
    await boot(page, { floors: ["ground", "first"], idle_return: 10 });
    // Switch to first floor
    await card(page).locator("css=.fp-floors button", { hasText: /First/i }).click();
    await expect(card(page).locator('css=.fp-floors button[aria-pressed="true"]')).toContainText(/First/i);
    // Open a device popup
    await card(page).locator("css=svg g[data-x]").first().click();
    await expect(card(page).locator("css=.fp-pop")).toBeVisible();

    // Advance 10 s -> popup closes and returns to ground floor
    await page.clock.runFor(10_100);
    await expect(card(page).locator("css=.fp-pop")).toHaveCount(0);
    await expect(card(page).locator('css=.fp-floors button[aria-pressed="true"]')).toContainText(/Ground/i);
  });

  test("idle_dim shows screensaver with clock & weather, and first tap wakes without toggling any device", async ({ page }) => {
    await page.clock.install({ time: new Date(2026, 10, 24, 20, 15, 0) });
    await boot(page, { floor: "ground", tap_action: "toggle", idle_dim: 10 });
    await expect(card(page).locator("css=.fp-screensaver")).toHaveCount(0);

    await page.clock.runFor(10_100);
    const ss = card(page).locator("css=.fp-screensaver");
    await expect(ss).toBeVisible();
    await expect(ss).toContainText("20:15");
    await expect(ss).toContainText("22.5 °C · Sunny");

    // Tap right on the screensaver -> wakes cleanly, fires zero service calls and opens no popup
    await ss.click();
    await expect(ss).toHaveCount(0);
    await expect(card(page).locator("css=.fp-pop")).toHaveCount(0);
    const calls = await page.evaluate(() => (window as unknown as { __calls: string[] }).__calls);
    expect(calls).toEqual([]);
  });
});
