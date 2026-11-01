import { test, expect, type Page } from "@playwright/test";
import { demo, serve, ORIGIN } from "./helpers-3d";
import { openMenu, menuItem } from "./menu-helper";

// R2.5 (docs/specs/replay-2.md items 10, 11, 13, criteria 8 and 10): the 48 h window and its length selector, in the built card with the
// replay chunk. Real page.mouse at real coordinates and page.keyboard on the focused bar (CLAUDE.md finding 3).
//
// Where the stubbed reply comes from (finding 21): as replay-jumps.spec.ts. `homeassistant/components/history/websocket_api.py` answers
// `history/history_during_period` with `{ [entity_id]: CompressedState[] }`; `recorder/models/state.py` builds a row as `{ s, a?, lu }` (float
// seconds); `recorder/history/modern.py` sends `{s, a, lu}` on the first row and `{s, lu}` after. With include_start_time_state the first row
// is the state at the request's start_time, so the stub puts it AT the start it was asked for ("start" below), and rows before the start are
// not sent. A purged recorder has no such row: its first row is the first state it kept (`cut`).
//
// The clock: 2026-10-28 12:00 local is the moment the bar opens. A 24 h slider has 1440 minutes from 12:00 the day before; a 48 h one 2880.

const NOW = new Date(2026, 9, 28, 12, 0, 0).getTime();
const secs = (h: number, m = 0, day = 0) => (NOW + ((h - 12) * 60 + m + day * 1440) * 60000) / 1000;

const card = (page: Page) => page.locator("floorplan-studio-card");
const range = (page: Page) => card(page).locator("css=input.fp-rp-range");
const prev = (page: Page) => card(page).locator("css=button.fp-rp-prev");
const play = (page: Page) => card(page).locator("css=button.fp-rp-play");
const shown = (page: Page) => card(page).locator("css=.fp-rp-time");
const status = (page: Page) => card(page).locator("css=.fp-replay [role=status]");
const len = (page: Page, label: string) => card(page).locator("css=.fp-rp-len button", { hasText: label });
const ticks = (page: Page) => card(page).locator("css=.fp-rp-tick");

/** `lu: "start"` is the state at the asked start_time. Onsets: front door 27 Oct 10:00 (26 h before the end), 09:00 today, kitchen lamp 09:00 today. */
const ROWS = () => ({
  "light.demo_kitchen": [{ s: "off", a: {}, lu: "start" }, { s: "on", a: {}, lu: secs(9, 0) }],
  "binary_sensor.demo_front_door": [{ s: "off", a: {}, lu: "start" }, { s: "on", lu: secs(10, 0, -1) }, { s: "off", lu: secs(10, 5, -1) }],
});

interface Opts { rows?: Record<string, unknown[]>; cut?: number; hold?: boolean; clock?: "install" | "fixed"; width?: number }

async function boot(page: Page, o: Opts = {}) {
  if (o.clock === "install") await page.clock.install({ time: NOW }); else await page.clock.setFixedTime(NOW);
  await serve(page);
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.addInitScript((cut) => {
    const w = window as unknown as Record<string, unknown>;
    w.__asks = [];
    w.__held = [];
    w.__hold = false;
    w.__mk = (rows: Record<string, { s: string; a?: object; lu: number | "start" }[]>) => ({
      states: {}, themes: { darkMode: false }, config: { latitude: 52.52, longitude: 13 }, locale: { language: "en", time_format: "24" },
      callService: () => Promise.resolve(),
      connection: {
        sendMessagePromise: (m: { type: string; entity_ids?: string[]; start_time: string; end_time: string }) => {
          const startSec = Date.parse(m.start_time) / 1000, out: Record<string, unknown[]> = {};
          (w.__asks as unknown[]).push(m);
          if (m.type !== "history/history_during_period") return Promise.resolve(out);
          for (const id of m.entity_ids ?? []) {
            if (!rows[id]) continue;
            const mine = rows[id].map((r) => (r.lu === "start" ? { ...r, lu: startSec } : r)).filter((r) => (r.lu as number) >= startSec);
            // A purged recorder: nothing before `cut`, and the first state it kept is at `cut` (the start-time row exists only if the window starts after it).
            out[id] = cut && startSec < cut ? [{ s: mine[0].s, a: mine[0].a ?? {}, lu: cut }, ...mine.filter((r) => (r.lu as number) > cut)] : mine;
          }
          if (!w.__hold) return Promise.resolve(out);
          return new Promise((res) => (w.__held as { hours: number; f: () => void }[]).push({ hours: Math.round((Date.parse(m.end_time) - Date.parse(m.start_time)) / 3600000), f: () => res(out) }));
        },
      },
    });
  }, o.cut ?? 0);
  await page.goto(`${ORIGIN}/harness.html`);
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate((w) => { document.getElementById("wrap")!.style.width = `${w}px`; }, o.width ?? 900);
  await page.evaluate(([config, rows, hold]) => {
    const w = window as unknown as { __mk(r: unknown): unknown; __hold: boolean };
    w.__hold = !!hold;
    const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(config);
    el.hass = w.__mk(rows);
    return el.updateComplete;
  }, [{ layout: structuredClone(demo), floor: "ground", theme: "light", active_list: false }, o.rows ?? ROWS(), !!o.hold] as const);
  await openMenu(page);
  await menuItem(page, "replay").click();
  if (!o.hold) await expect(range(page)).toBeEnabled();
}

async function click(loc: ReturnType<typeof prev>) {
  const b = (await loc.boundingBox())!;
  await loc.page().mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}
const asks = (page: Page) => page.evaluate(() => (window as unknown as { __asks: { start_time: string; end_time: string; entity_ids: string[] }[] }).__asks);
/** Answers the held calls of one window length, now. */
const release = (page: Page, hours: number) => page.evaluate((h) => { const w = window as unknown as { __held: { hours: number; f: () => void }[] }; w.__held.filter((x) => x.hours === h).forEach((x) => x.f()); }, hours);

test.describe("R2.5 the 48 h window", () => {
  test("criterion 8: opens at 24 h with two lengths only; no 7 days", async ({ page }) => {
    await boot(page);
    await expect(card(page).locator("css=.fp-rp-len button")).toHaveText(["24 h", "48 h"]);
    await expect(len(page, "24 h")).toHaveAttribute("aria-pressed", "true");
    await expect(range(page)).toHaveAttribute("max", "1440");
    const a = await asks(page);
    expect(a.length).toBeGreaterThan(0);
    for (const m of a) expect(Date.parse(m.end_time) - Date.parse(m.start_time)).toBe(24 * 3600000);
  });

  test("criterion 8: a real click on 48 h asks a 48-hour range ending when the bar opened, and keeps the moment on show", async ({ page }) => {
    await boot(page);
    await range(page).focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press("PageDown"); // 09:00 today
    await expect(shown(page)).toHaveText("09:00");
    const before = (await asks(page)).length;
    await click(len(page, "48 h"));
    await expect(len(page, "48 h")).toHaveAttribute("aria-pressed", "true");
    await expect(range(page)).toHaveAttribute("max", "2880");
    await expect(range(page)).toBeEnabled();
    const fresh = (await asks(page)).slice(before);
    expect(fresh.length).toBeGreaterThan(0);
    for (const m of fresh) {
      expect(Date.parse(m.end_time)).toBe(NOW);
      expect(Date.parse(m.start_time)).toBe(NOW - 48 * 3600000);
    }
    await expect(shown(page)).toHaveText("09:00");
    await expect(range(page)).toHaveValue("2700"); // 09:00 today is 3 h before the end of 2880
  });

  test("criterion 8: a moment outside the shorter window goes to its start", async ({ page }) => {
    await boot(page);
    await click(len(page, "48 h"));
    await expect(range(page)).toBeEnabled();
    await range(page).focus();
    await page.keyboard.press("Home"); // 48 h ago: 26 Oct 12:00
    await expect(range(page)).toHaveValue("0");
    await click(len(page, "24 h"));
    await expect(range(page)).toHaveAttribute("max", "1440");
    await expect(range(page)).toBeEnabled();
    await expect(range(page)).toHaveValue("0");
    await expect(shown(page)).toHaveText("12:00"); // the start of the 24 h window, 27 Oct 12:00
  });

  test("item 11: arrows move 5 minutes at 24 h and 10 at 48 h; Page keys an hour at both", async ({ page }) => {
    await boot(page);
    await range(page).focus();
    await page.keyboard.press("ArrowLeft");
    await expect(range(page)).toHaveValue("1435");
    await page.keyboard.press("PageDown");
    await expect(range(page)).toHaveValue("1375");
    await click(len(page, "48 h"));
    await expect(range(page)).toBeEnabled();
    await range(page).focus();
    await expect(range(page)).toHaveValue("2815"); // the same moment: 1375 + 1440
    await page.keyboard.press("ArrowLeft");
    await expect(range(page)).toHaveValue("2805");
    await page.keyboard.press("ArrowRight");
    await expect(range(page)).toHaveValue("2815");
    await page.keyboard.press("PageDown");
    await expect(range(page)).toHaveValue("2755");
    await page.keyboard.press("PageUp");
    await expect(range(page)).toHaveValue("2815");
  });

  test("criterion 8: play covers 24 hours per 60 s at 48 h, half the window after a minute", async ({ page }) => {
    await boot(page, { clock: "install" });
    await click(len(page, "48 h"));
    await expect(range(page)).toBeEnabled();
    await range(page).focus();
    await page.keyboard.press("Home");
    await click(play(page));
    await page.clock.runFor(60000);
    const v = Number(await range(page).inputValue());
    expect(v).toBeGreaterThanOrEqual(1430);
    expect(v).toBeLessThanOrEqual(1450);
  });

  test("markers, jumps and the strip follow the window: a door from 26 h ago appears at 48 h and not at 24 h", async ({ page }) => {
    await boot(page);
    await expect(ticks(page)).toHaveCount(1); // the lamp at 09:00; the door of 27 Oct 10:00 is before the window
    await click(prev(page));
    await expect(range(page)).toHaveValue("1260");
    await expect(prev(page)).toBeDisabled();
    await click(len(page, "48 h"));
    await expect(range(page)).toBeEnabled();
    await expect(ticks(page)).toHaveCount(2);
    const strip = (await card(page).locator("css=.fp-rp-strip").boundingBox())!;
    const door = (await ticks(page).first().boundingBox())!;
    // 27 Oct 10:00 is minute 1320 of 2880 (26 h before the end): 45.8 % along the strip, less its 8 px margins
    expect((door.x + door.width / 2 - strip.x - 8) / (strip.width - 16)).toBeCloseTo(1320 / 2880, 1);
    await expect(prev(page)).toBeEnabled();
    await click(prev(page));
    await expect(range(page)).toHaveValue("1320");
    await expect(shown(page)).toHaveText("10:00");
  });

  test("only the newest length's history is kept: a slow 24 h reply landing after 48 h was chosen changes nothing", async ({ page }) => {
    await boot(page, { hold: true });
    await expect(len(page, "48 h")).toBeVisible(); // the chunk is here, the 24 h calls are still out
    await click(len(page, "48 h"));
    await expect(range(page)).toHaveAttribute("max", "2880");
    await expect.poll(async () => (await asks(page)).filter((m) => Date.parse(m.end_time) - Date.parse(m.start_time) === 48 * 3600000).length).toBeGreaterThan(0);
    await release(page, 48);
    await expect(range(page)).toBeEnabled();
    await expect(ticks(page)).toHaveCount(2);
    await release(page, 24); // the slow one, last
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    await expect(range(page)).toHaveAttribute("max", "2880");
    await expect(len(page, "48 h")).toHaveAttribute("aria-pressed", "true");
    await expect(range(page)).toBeEnabled();
    await expect(ticks(page)).toHaveCount(2); // the 24 h reply has one onset only
  });
});

test.describe("R2.5 purge (item 13, criterion 10)", () => {
  const cut = secs(0, 0, -1); // 27 Oct 00:00: 12 h into the 48 h window

  test("a reply that starts 12 hours into a 48 h window greys that quarter of the strip, and the info line says from when", async ({ page }) => {
    await boot(page, { cut });
    await expect(card(page).locator("css=.fp-rp-purge")).toHaveCount(0); // 24 h starts after the cut: all kept
    await click(len(page, "48 h"));
    await expect(range(page)).toBeEnabled();
    const grey = (await card(page).locator("css=.fp-rp-purge").boundingBox())!;
    const strip = (await card(page).locator("css=.fp-rp-strip").boundingBox())!;
    expect(grey.x).toBeCloseTo(strip.x, 0);
    expect(grey.width / strip.width).toBeCloseTo(0.25, 1);
    await click(card(page).locator("css=button.fp-rp-info"));
    await expect(status(page)).toContainText("History is kept from");
    await expect(status(page)).toContainText("27");
    await expect(status(page)).toContainText("00:00");
  });

  test("with the whole window kept there is no grey and no purge line", async ({ page }) => {
    await boot(page);
    await click(len(page, "48 h"));
    await expect(range(page)).toBeEnabled();
    await expect(card(page).locator("css=.fp-rp-purge")).toHaveCount(0);
    await click(card(page).locator("css=button.fp-rp-info"));
    await expect(status(page)).not.toContainText("History is kept");
  });

  test("a 380 px card: the selector fits and the slider stays over 80 px", async ({ page }) => {
    await boot(page, { width: 380 });
    const bar = (await card(page).locator("css=.fp-replay").boundingBox())!;
    for (const b of [len(page, "24 h"), len(page, "48 h"), card(page).locator("css=.fp-rp-close")]) {
      const r = (await b.boundingBox())!;
      expect(r.x).toBeGreaterThanOrEqual(bar.x);
      expect(r.x + r.width).toBeLessThanOrEqual(bar.x + bar.width);
    }
    expect(await card(page).locator("css=.fp-replay").evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(0);
    expect((await range(page).boundingBox())!.width).toBeGreaterThan(80);
  });
});
