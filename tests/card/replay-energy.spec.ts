import { test, expect, type Page } from "@playwright/test";
import { demo, serve, ORIGIN } from "./helpers-3d";
import { openMenu, menuItem } from "./menu-helper";

// Sprint 56 (docs/specs/batch-s52.md, criteria 10, 11, 12): replay: "always" + lazy energy counters end to end in the built card.
// Stubs mirror Home Assistant's `energy/get_prefs` and `recorder/statistics_during_period` (`period: "5minute"`, `units: { energy: "kWh" }`).

const NOW = new Date(2026, 9, 28, 12, 0, 0).getTime();
const START = NOW - 24 * 3600_000;
const STEP_MS = 300_000;
const LONGITUDE = -new Date(NOW).getTimezoneOffset() / 4;
const secs = (h: number, m = 0, day = 0) => (NOW + ((h - 12) * 60 + m + day * 1440) * 60000) / 1000;
const iso = (s: number) => new Date(s * 1000).toISOString();

const card = (page: Page) => page.locator("floorplan-studio-card");
const bar = (page: Page) => card(page).locator("css=.fp-replay");
const range = (page: Page) => card(page).locator("css=input.fp-rp-range");
const playBtn = (page: Page) => card(page).locator("css=button.fp-rp-play");
const liveBtn = (page: Page) => card(page).locator("css=button.fp-rp-close");
const chips = (page: Page) => card(page).locator("css=.fp-en-chips");
const chip = (page: Page, k: string) => card(page).locator(`css=.fp-en-chip[data-k="${k}"]`);
const dev = (entity: string) => demo.floors.ground.devices.findIndex((d: { entity: string }) => d.entity === entity);
const lampIdx = dev("light.demo_kitchen");
const g = (page: Page, i: number) => card(page).locator(`css=svg g[data-x="${i}"]`);

const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: iso(secs(11, 59)) });

interface BucketDef {
  /** Constant per-5-minute bucket change across the 24 h window (used unless override matches). */
  perBucket: number;
  mean?: number;
  /** Optional sparse map from bucket index (0..287) to override change/mean. */
  at?: Record<number, { change?: number | null; mean?: number | null }>;
}

function makeSeries(startMs: number, count: number, def: BucketDef) {
  const out: { start: number; end: number; change: number | null; mean: number | null }[] = [];
  for (let i = 0; i < count; i++) {
    const start = startMs + i * STEP_MS;
    const ov = def.at?.[i];
    out.push({
      start,
      end: start + STEP_MS,
      change: ov && "change" in ov ? ov.change ?? null : def.perBucket,
      mean: ov && "mean" in ov ? ov.mean ?? null : (def.mean ?? null),
    });
  }
  return out;
}

const ROWS = () => ({
  "light.demo_kitchen": [{ s: "off", a: { friendly_name: "Kitchen" }, lu: secs(12, 0, -1) - 7200 }, { s: "on", lu: secs(8, 0) }, { s: "off", lu: secs(10, 0) }],
  "sun.sun": [{ s: "below_horizon", a: { friendly_name: "Sun" }, lu: secs(12, 0, -1) - 100 }, { s: "above_horizon", lu: secs(7, 0) }],
});

// Unified HA prefs: grid import (stat_cost), solar (compensation on export), gas (fixed price), water (no price).
// Includes a battery entry on purpose to verify battery is ignored cleanly.
const UNIFIED_PREFS = {
  energy_sources: [
    {
      type: "grid",
      stat_energy_from: "sensor.grid_import",
      stat_cost: "sensor.grid_import_cost",
      stat_energy_to: "sensor.grid_export",
      stat_compensation: "sensor.grid_export_comp",
    },
    { type: "solar", stat_energy_from: "sensor.solar_gen" },
    { type: "battery", stat_energy_from: "sensor.bat_in", stat_energy_to: "sensor.bat_out" },
    { type: "gas", stat_energy_from: "sensor.gas_m3", number_energy_price: 1.2 },
    { type: "water", stat_energy_from: "sensor.water_l" },
  ],
};

// Legacy HA prefs: flow_from/flow_to arrays + dynamic entity_energy_price.
const LEGACY_PREFS = {
  energy_sources: [
    {
      type: "grid",
      flow_from: [{ stat_energy_from: "sensor.grid_import", entity_energy_price: "sensor.spot_price" }],
      flow_to: [{ stat_energy_to: "sensor.grid_export", number_energy_price: 0.1 }],
    },
    { type: "solar", stat_energy_from: "sensor.solar_gen" },
  ],
};

function unifiedStats() {
  // Asymmetric slopes across buckets 252..258 (09:00..09:35 today is bucket 252..258 since START = yesterday 12:00).
  // Specifically, bucket 252 starts at 21 h after START (09:00 today): minutes 1260..1265.
  return {
    "sensor.grid_import": makeSeries(START, 288, { perBucket: 0.1, at: { 252: { change: 0.5 } } }),
    "sensor.grid_import_cost": makeSeries(START, 288, { perBucket: 0.03, at: { 252: { change: 0.25 } } }),
    "sensor.grid_export": makeSeries(START, 288, { perBucket: 0.02, at: { 252: { change: 0.1 } } }),
    "sensor.grid_export_comp": makeSeries(START, 288, { perBucket: 0.005, at: { 252: { change: 0.05 } } }),
    "sensor.solar_gen": makeSeries(START, 288, { perBucket: 0.05, at: { 252: { change: 0.3 } } }),
    "sensor.gas_m3": makeSeries(START, 288, { perBucket: 0.04, at: { 252: { change: 0.2 } } }),
    "sensor.water_l": makeSeries(START, 288, { perBucket: 2, at: { 252: { change: 10 } } }),
    "sensor.spot_price": makeSeries(START, 288, { perBucket: 0, mean: 0.4, at: { 252: { mean: 0.6 } } }),
  };
}

interface Opts {
  config?: Record<string, unknown>;
  layoutPatch?: (d: typeof demo) => void;
  prefs?: unknown;
  prefsFail?: unknown;
  stats?: Record<string, unknown>;
  statsFail?: unknown;
  currency?: string;
  size?: { width: number; height: number };
}

async function boot(page: Page, o: Opts = {}) {
  await page.clock.install({ time: NOW });
  await page.clock.pauseAt(NOW);
  await serve(page);
  await page.setViewportSize(o.size ?? { width: 1100, height: 800 });
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__sent = [];
    w.__calls = [];
    w.__mk = (states: unknown, extra: {
      longitude?: number; currency?: string; rows?: Record<string, unknown[]>;
      prefs?: unknown; prefsFail?: unknown; stats?: Record<string, unknown>; statsFail?: unknown;
    }) => ({
      states,
      themes: { darkMode: false },
      config: { latitude: 52.52, longitude: extra.longitude, currency: extra.currency ?? "EUR" },
      language: "en",
      locale: { language: "en", time_format: "24" },
      callService: (d: string, s: string, data: { entity_id: string }) => { (w.__calls as string[]).push(`${d}.${s} ${data.entity_id}`); return Promise.resolve(); },
      connection: {
        sendMessagePromise: (m: { type: string; entity_ids?: string[]; statistic_ids?: string[] }) => {
          (w.__sent as unknown[]).push(m);
          if (m.type === "history/history_during_period") {
            const out: Record<string, unknown[]> = {};
            for (const id of m.entity_ids ?? []) if (extra.rows?.[id]) out[id] = extra.rows[id];
            return Promise.resolve(out);
          }
          if (m.type === "energy/get_prefs") {
            if (extra.prefsFail) return Promise.reject(extra.prefsFail);
            return Promise.resolve(extra.prefs ?? { energy_sources: [] });
          }
          if (m.type === "recorder/statistics_during_period") {
            if (extra.statsFail) return Promise.reject(extra.statsFail);
            const out: Record<string, unknown> = {};
            for (const id of m.statistic_ids ?? []) if (extra.stats?.[id]) out[id] = extra.stats[id];
            return Promise.resolve(out);
          }
          return Promise.resolve({});
        },
      },
    });
  });

  const layout = structuredClone(demo);
  o.layoutPatch?.(layout);
  const live = {
    "light.demo_kitchen": st("off"),
    "sensor.gas_m3": st("100", { unit_of_measurement: "m³" }),
    "sensor.water_l": st("500", { unit_of_measurement: "L" }),
  };

  await page.goto(`${ORIGIN}/harness.html`);
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  if (o.size) await page.evaluate((w) => { document.getElementById("wrap")!.style.width = `${w}px`; }, o.size.width);
  await page.evaluate(([config, liveState, extra]) => {
    const w = window as unknown as { __mk(s: unknown, e: unknown): unknown };
    const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(config);
    el.hass = w.__mk(liveState, extra);
    return el.updateComplete;
  }, [
    { layout, floor: "ground", theme: "light", active_list: false, replay: "always", ...o.config },
    live,
    {
      longitude: LONGITUDE,
      currency: o.currency ?? "EUR",
      rows: ROWS(),
      prefs: o.prefs ?? UNIFIED_PREFS,
      prefsFail: o.prefsFail,
      stats: o.stats ?? unifiedStats(),
      statsFail: o.statsFail,
    },
  ] as const);
  await expect(card(page).locator("css=svg polygon[data-r]").first()).toBeVisible();
}

const sentTypes = (page: Page) => page.evaluate(() => (window as unknown as { __sent: { type: string }[] }).__sent.map((m) => m.type));
const sentMessages = (page: Page) => page.evaluate(() => (window as unknown as { __sent: Record<string, unknown>[] }).__sent);

/** Scrub to an exact minute offset in `[0, 1440]` using keyboard Home + PageUp + ArrowRight/mouse click. */
async function scrubByMouseToFraction(page: Page, frac: number) {
  const b = (await range(page).boundingBox())!;
  // Thumb travel spans approx [b.x + 8, b.x + b.width - 8]; sample near `frac`.
  const x = b.x + 8 + Math.max(0, Math.min(1, frac)) * Math.max(1, b.width - 16);
  await page.mouse.click(x, b.y + b.height / 2);
}

/** Step by keyboard to an exact multiple of 5 minutes, e.g. 09:00 (`hour=9, min=0`). */
async function toHour(page: Page, hour: number, minute = 0) {
  await range(page).focus();
  await page.keyboard.press("Home");
  const from = hour * 60 + minute + 720;
  for (let i = 0; i < Math.floor(from / 60); i++) await page.keyboard.press("PageUp");
  for (let i = 0; i < Math.floor((from % 60) / 5); i++) await page.keyboard.press("ArrowRight");
  await expect(range(page)).toHaveValue(String(from));
}

/** Compute expected interpolated use for `perBucket` on all buckets except bucket 252 (`override252`). */
function expectedAtMinute(minute: number, perBucket: number, override252: number): number {
  const tMs = START + minute * 60_000;
  let total = 0;
  for (let i = 0; i < 288; i++) {
    const a = START + i * STEP_MS, z = a + STEP_MS;
    if (a >= tMs) break;
    const frac = Math.min(tMs, z) === z ? 1 : (tMs - a) / STEP_MS;
    total += (i === 252 ? override252 : perBucket) * frac;
  }
  return total;
}

const fmtEnNum = (v: number) => new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(Math.abs(v) < 1e-9 ? 0 : v);
const fmtEnEur = (v: number) => new Intl.NumberFormat("en", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(v) < 1e-9 ? 0 : v);

test.describe("B56.1 replay: always", () => {
  test("criterion 10: bar is mounted at Live on first paint with zero websocket calls, allows live taps, wakes on scrub, and Live returns without closing", async ({ page }) => {
    await boot(page);
    await expect(bar(page)).toBeVisible();
    await expect(liveBtn(page)).toHaveText("Live");
    await expect(liveBtn(page)).toHaveAttribute("aria-pressed", "true");
    await expect(range(page)).toHaveValue("1440");
    await expect(chips(page)).toHaveCount(0); // hidden until replay wakes
    expect(await sentTypes(page)).toEqual([]);

    // Live device tap still works while parked at Live
    await g(page, lampIdx).click();
    await expect(card(page).locator("css=.fp-pop")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(card(page).locator("css=.fp-pop")).toHaveCount(0);

    // Scrubbing wakes replay, closes nothing, fetches history + energy
    await toHour(page, 9);
    await expect(liveBtn(page)).toHaveAttribute("aria-pressed", "false");
    await expect(chips(page)).toBeVisible();
    await expect(g(page, lampIdx)).toHaveClass(/\bon\b/);
    const sent = await sentTypes(page);
    expect(sent).toContain("history/history_during_period");
    expect(sent).toContain("energy/get_prefs");
    expect(sent).toContain("recorder/statistics_during_period");

    // Clicking Live returns bar to Live without unmounting
    await liveBtn(page).click();
    await expect(bar(page)).toBeVisible();
    await expect(liveBtn(page)).toHaveAttribute("aria-pressed", "true");
    await expect(chips(page)).toHaveCount(0);
    await expect(g(page, lampIdx)).not.toHaveClass(/\bon\b/);

    // Pressing Play from Live wakes replay and enters active state
    await playBtn(page).click();
    await expect(liveBtn(page)).toHaveAttribute("aria-pressed", "false");
    await playBtn(page).click(); // pause before end of test
  });

  test("criterion 10: 5 minutes of inactivity automatically returns always-bar to Live", async ({ page }) => {
    await boot(page);
    await toHour(page, 9);
    await expect(liveBtn(page)).toHaveAttribute("aria-pressed", "false");
    await expect(chips(page)).toBeVisible();

    await page.clock.runFor(5 * 60_000 + 200);
    await expect(bar(page)).toBeVisible();
    await expect(liveBtn(page)).toHaveAttribute("aria-pressed", "true");
    await expect(chips(page)).toHaveCount(0);
  });

  test("default card without replay: always keeps bar hidden behind the ⋯ menu", async ({ page }) => {
    await boot(page, { config: { replay: undefined } });
    await expect(bar(page)).toHaveCount(0);
    await openMenu(page);
    await expect(menuItem(page, "replay")).toHaveCount(1);
  });
});

test.describe("B56.2–B56.4 energy counters, interpolation, settings & gaps", () => {
  test("criterion 11: computes electricity = gridFrom + solar - gridTo, linear mid-bucket interpolation, and cost across 3 times", async ({ page }) => {
    await boot(page);

    // t1 = 09:00 (minute 1260 = bucket 252 start)
    await toHour(page, 9, 0);
    await expect(chips(page)).toBeVisible();
    for (const minute of [1260, 1290]) {
      if (minute === 1290) await toHour(page, 9, 30);
      const imp = expectedAtMinute(minute, 0.1, 0.5);
      const exp = expectedAtMinute(minute, 0.02, 0.1);
      const sol = expectedAtMinute(minute, 0.05, 0.3);
      const elec = imp + sol - exp;
      const elecCost = expectedAtMinute(minute, 0.03, 0.25);
      const solCost = expectedAtMinute(minute, 0.005, 0.05);
      const gasUse = expectedAtMinute(minute, 0.04, 0.2);
      const waterUse = expectedAtMinute(minute, 2, 10);

      await expect(chip(page, "electricity")).toContainText(`${fmtEnNum(elec)} kWh`);
      await expect(chip(page, "electricity")).toContainText(fmtEnEur(elecCost));
      await expect(chip(page, "solar")).toContainText(`${fmtEnNum(sol)} kWh`);
      await expect(chip(page, "solar")).toContainText(fmtEnEur(solCost));
      await expect(chip(page, "gas")).toContainText(`${fmtEnNum(gasUse)} m³`);
      await expect(chip(page, "gas")).toContainText(fmtEnEur(gasUse * 1.2));
      await expect(chip(page, "water")).toContainText(`${fmtEnNum(waterUse)} L`);
      await expect(chip(page, "water").locator("css=.fp-en-cost")).toHaveCount(0);
    }

    // t2 = mid-5-minute-bucket via real mouse click on the slider (start from Home so thumb is nowhere near 0.88)
    await range(page).focus();
    await page.keyboard.press("Home");
    let midMinute = 0;
    for (let frac = 0.876; frac <= 0.886; frac += 0.001) {
      await scrubByMouseToFraction(page, frac);
      midMinute = Number(await range(page).inputValue());
      if (midMinute % 5 !== 0) break;
    }
    expect(midMinute % 5).not.toBe(0);
    const impM = expectedAtMinute(midMinute, 0.1, 0.5);
    const expM = expectedAtMinute(midMinute, 0.02, 0.1);
    const solM = expectedAtMinute(midMinute, 0.05, 0.3);
    await expect(chip(page, "electricity")).toContainText(`${fmtEnNum(impM + solM - expM)} kWh`);
    await expect(chip(page, "solar")).toContainText(`${fmtEnNum(solM)} kWh`);
    await expect(chip(page, "electricity").locator("css=svg.fp-en-spark polyline")).toHaveCount(1);

    // Check WebSocket message shape matches HA statistics API contract
    const msgs = await sentMessages(page);
    const statMsg = msgs.find((m) => m.type === "recorder/statistics_during_period");
    expect(statMsg).toMatchObject({
      type: "recorder/statistics_during_period",
      period: "5minute",
      units: { energy: "kWh" },
      types: ["change"],
    });
  });

  test("criterion 11: legacy flow_from/flow_to + entity_energy_price requests mean and uses 5-min mean * bucket change", async ({ page }) => {
    await boot(page, { prefs: LEGACY_PREFS });
    await toHour(page, 9, 0);
    await expect(chips(page)).toBeVisible();
    // Missing gas/water in legacy prefs -> hidden cleanly
    await expect(chip(page, "gas")).toHaveCount(0);
    await expect(chip(page, "water")).toHaveCount(0);
    // Spot price at bucket 0..251 is 0.4 EUR/kWh, change 0.1/bucket -> 252 * 0.1 * 0.4 = 10.08 EUR
    await expect(chip(page, "electricity")).toContainText(fmtEnEur(252 * 0.1 * 0.4));
    // Solar export compensation uses legacy fixed number_energy_price = 0.1 EUR/kWh
    await expect(chip(page, "solar")).toContainText(fmtEnEur(252 * 0.02 * 0.1));

    const msgs = await sentMessages(page);
    const statMsg = msgs.find((m) => m.type === "recorder/statistics_during_period");
    expect(statMsg?.types).toEqual(["change", "mean"]);
  });

  test("criterion 12: gap or missing statistic renders no data (never 0)", async ({ page }) => {
    const partial = unifiedStats();
    delete (partial as Record<string, unknown>)["sensor.gas_m3"];
    await boot(page, { stats: partial });
    await toHour(page, 9, 0);
    await expect(chip(page, "electricity")).toContainText("kWh");
    await expect(chip(page, "gas")).toHaveText("no data");
  });

  test("criterion 11: energy/get_prefs refusal hides chips cleanly while replay continues to work", async ({ page }) => {
    await boot(page, { prefsFail: { code: "unauthorized", message: "Unauthorized" } });
    await toHour(page, 9, 0);
    await expect(g(page, lampIdx)).toHaveClass(/\bon\b/);
    await expect(chips(page)).toHaveCount(0);
  });

  test("layout.energy filters hide, show, and sparkline", async ({ page }) => {
    await boot(page, {
      layoutPatch: (d) => { d.energy = { hide: ["gas", "water"], show: "use", spark: false }; },
    });
    await toHour(page, 9, 0);
    await expect(chip(page, "electricity")).toBeVisible();
    await expect(chip(page, "solar")).toBeVisible();
    await expect(chip(page, "gas")).toHaveCount(0);
    await expect(chip(page, "water")).toHaveCount(0);
    await expect(card(page).locator("css=.fp-en-cost")).toHaveCount(0);
    await expect(card(page).locator("css=svg.fp-en-spark")).toHaveCount(0);
  });

  test("narrow 390px viewport wraps chips onto two rows cleanly without overlap", async ({ page }) => {
    await boot(page, { size: { width: 390, height: 800 } });
    await toHour(page, 9, 0);
    await expect(chip(page, "water")).toBeVisible();

    const boxes = await card(page).evaluate((el) => {
      const root = el.shadowRoot!;
      const rect = (q: string) => [...root.querySelectorAll(q)].map((n) => {
        const r = n.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      });
      return {
        chips: rect(".fp-en-chip"),
        time: rect(".fp-rp-time")[0],
        range: rect("input.fp-rp-range")[0],
      };
    });
    expect(boxes.chips.length).toBe(4);
    expect(boxes.range.w).toBeGreaterThan(80);
    // Wraps to at least two lines at 390 px without horizontal overflow
    expect(new Set(boxes.chips.map((c) => Math.round(c.y))).size).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < boxes.chips.length; i++) {
      const a = boxes.chips[i];
      // Every chip sits completely above the time row
      expect(a.y + a.h).toBeLessThanOrEqual(boxes.time.y + 1);
      for (let j = i + 1; j < boxes.chips.length; j++) {
        const b = boxes.chips[j];
        const overlapX = a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1;
        const overlapY = a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;
        expect(overlapX && overlapY).toBe(false);
      }
    }
    expect(boxes.time.y + boxes.time.h).toBeLessThanOrEqual(boxes.range.y + 1);
  });
});
