import { test, expect, type Page } from "@playwright/test";
import { demo, serve, ORIGIN } from "./helpers-3d";

// Sprint 57 (B57.1 & B57.2, criteria 13 & 14):
// - Clicking an energy chip opens the see-through 5-minute bar overlay chart, one at a time,
//   with faded bars after t, a vertical line at t, and draggable header clamped inside the card.
// - Electricity overlay shows the nested `device_consumption` tree (`included_in_stat`) and Untracked remainder.

const NOW = new Date(2026, 9, 28, 12, 0, 0).getTime();
const START = NOW - 24 * 3600_000;
const STEP_MS = 300_000;
const secs = (h: number, m = 0, day = 0) => (NOW + ((h - 12) * 60 + m + day * 1440) * 60000) / 1000;
const iso = (s: number) => new Date(s * 1000).toISOString();

const card = (page: Page) => page.locator("floorplan-studio-card");
const chip = (page: Page, k: string) => card(page).locator(`css=.fp-en-chip[data-k="${k}"]`);
const overlay = (page: Page) => card(page).locator("css=.fp-en-overlay");
const range = (page: Page) => card(page).locator("css=input.fp-rp-range");

function makeSeries(startMs: number, count: number, perBucket: number) {
  return Array.from({ length: count }, (_, i) => {
    const start = startMs + i * STEP_MS;
    return { start, end: start + STEP_MS, change: perBucket, mean: null };
  });
}

const PREFS = {
  energy_sources: [
    { type: "grid", stat_energy_from: "sensor.grid_import", stat_cost: "sensor.grid_import_cost" },
    { type: "solar", stat_energy_from: "sensor.solar_gen" },
  ],
  device_consumption: [
    { stat_consumption: "sensor.hvac", name: "Heat pump" },
    { stat_consumption: "sensor.hvac_fan", name: "Fan", included_in_stat: "sensor.hvac" },
    { stat_consumption: "sensor.ev", name: "EV charger" },
  ],
};

const STATS = {
  "sensor.grid_import": makeSeries(START, 288, 0.2),
  "sensor.grid_import_cost": makeSeries(START, 288, 0.05),
  "sensor.solar_gen": makeSeries(START, 288, 0.1),
  "sensor.hvac": makeSeries(START, 288, 0.1),
  "sensor.hvac_fan": makeSeries(START, 288, 0.02),
  "sensor.ev": makeSeries(START, 288, 0.05),
};

async function mountCard(page: Page) {
  await page.clock.install({ time: NOW });
  await serve(page);
  await page.setViewportSize({ width: 1000, height: 760 });
  await page.goto(`${ORIGIN}/harness.html`);
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(([layout, prefs, stats, nowIso]) => {
    const el = document.getElementById("card") as any;
    el.setConfig({ layout, floor: "ground", replay: "always" });
    el.hass = {
      config: { currency: "EUR", latitude: 45, longitude: 0 },
      language: "en",
      states: {
        "light.demo_kitchen": { state: "on", attributes: {}, last_changed: nowIso },
        "sun.sun": { state: "above_horizon", attributes: {}, last_changed: nowIso },
      },
      connection: {
        sendMessagePromise: async (msg: { type: string }) => {
          if (msg.type === "history/history_during_period") return {};
          if (msg.type === "energy/get_prefs") return prefs;
          if (msg.type === "recorder/statistics_during_period") return stats;
          return {};
        },
      },
      callService: () => {},
    };
    return el.updateComplete;
  }, [demo, PREFS, STATS, iso(secs(11, 59))] as const);

  // Wake replay from Live by scrubbing to mid-window (720 min = 12 h).
  await range(page).fill("720");
  await range(page).dispatchEvent("input");
  await expect(chip(page, "electricity")).toBeVisible();
}

test("B57.1 & B57.2: overlay chart, one at a time, faded post-t bars, draggable header, and nested device tree", async ({ page }) => {
  await mountCard(page);

  await chip(page, "electricity").click();
  await expect(overlay(page)).toBeVisible();
  await expect(overlay(page)).toHaveAttribute("data-k", "electricity");

  // 288 5-minute bars across 24 h; scrubbing at midpoint fades the post-t bars (143 or 144 depending on sub-minute clock tick).
  await expect(overlay(page).locator("css=.fp-en-bar")).toHaveCount(288);
  const afterCount = await overlay(page).locator("css=.fp-en-bar-after").count();
  expect(afterCount).toBeGreaterThanOrEqual(143);
  expect(afterCount).toBeLessThanOrEqual(144);
  await expect(overlay(page).locator("css=.fp-en-tline")).toBeVisible();

  // B57.2: nested device_consumption tree + Untracked remainder.
  const tree = overlay(page).locator("css=.fp-en-tree");
  await expect(tree).toContainText("Heat pump");
  await expect(tree).toContainText("Fan");
  await expect(tree).toContainText("EV charger");
  await expect(tree).toContainText("Untracked");
  await expect(tree.locator("css=ul .fp-en-name")).toHaveText(["Fan"]);

  // Drag header within the card and verify it stays inside card bounds.
  const hdr = (await overlay(page).locator("css=.fp-en-oh").boundingBox())!;
  const cardBox = (await card(page).boundingBox())!;
  const before = (await overlay(page).boundingBox())!;
  const cx = hdr.x + hdr.width / 2, cy = hdr.y + hdr.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 150, cy + 80, { steps: 5 });
  await page.mouse.up();
  const after = (await overlay(page).boundingBox())!;
  expect(after.x).toBeGreaterThan(before.x + 50);
  expect(after.x + after.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
  expect(after.y + after.height).toBeLessThanOrEqual(cardBox.y + cardBox.height + 1);

  // One at a time: clicking solar chip switches the overlay to solar (no device tree).
  await chip(page, "solar").click();
  await expect(overlay(page)).toHaveCount(1);
  await expect(overlay(page)).toHaveAttribute("data-k", "solar");
  await expect(overlay(page).locator("css=.fp-en-tree")).toHaveCount(0);

  // Close button dismisses it.
  await overlay(page).locator("css=.fp-en-oclose").click();
  await expect(overlay(page)).toHaveCount(0);
});
