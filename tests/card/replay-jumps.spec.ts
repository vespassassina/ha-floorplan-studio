import { test, expect, type Page } from "@playwright/test";
import { demo, serve, ORIGIN } from "./helpers-3d";
import { openMenu, menuItem } from "./menu-helper";

// R2.4 (docs/specs/replay-2.md item 9, criterion 7): the jump buttons and Shift+arrows, end to end in the built card with the replay chunk.
// Real page.mouse at real coordinates and page.keyboard on the focused bar (CLAUDE.md finding 3).
//
// Where the stubbed reply comes from (finding 21): the same as replay-markers.spec.ts. `homeassistant/components/history/websocket_api.py` answers
// `history/history_during_period` with `{ [entity_id]: CompressedState[] }`; `recorder/models/state.py` builds a row as `{ s, a?, lu }` (float seconds);
// `recorder/history/modern.py` sends the lean call as `{s, a, lu}` on the first row and `{s, lu}` after. The first row is the start state, never an onset.
//
// The clock: 2026-10-28 12:00 local is the moment the bar opens. The slider is 1440 minutes from 12:00 the day before; 09:00 today is minute 1260.
// Onsets: door opens 08:00 (1200), kitchen lamp 09:00 (1260), living lamp 09:20 (1280), hall motion 10:00 (1320).

const NOW = new Date(2026, 9, 28, 12, 0, 0).getTime();
const secs = (h: number, m = 0, day = 0) => (NOW + ((h - 12) * 60 + m + day * 1440) * 60000) / 1000;
const START = secs(12, 0, -1) - 100;

const card = (page: Page) => page.locator("floorplan-studio-card");
const range = (page: Page) => card(page).locator("css=input.fp-rp-range");
const prev = (page: Page) => card(page).locator("css=button.fp-rp-prev");
const next = (page: Page) => card(page).locator("css=button.fp-rp-next");
const play = (page: Page) => card(page).locator("css=button.fp-rp-play");
const shown = (page: Page) => card(page).locator("css=.fp-rp-time");

const ROWS = () => ({
  "light.demo_kitchen": [{ s: "off", a: {}, lu: START }, { s: "on", a: {}, lu: secs(9, 0) }],
  "light.demo_living": [{ s: "off", a: {}, lu: START }, { s: "on", a: {}, lu: secs(9, 20) }],
  "binary_sensor.demo_front_door": [{ s: "off", a: {}, lu: START }, { s: "on", lu: secs(8, 0) }, { s: "off", lu: secs(8, 10) }],
  "binary_sensor.demo_hall_motion": [{ s: "off", a: {}, lu: START }, { s: "on", lu: secs(10, 0) }, { s: "off", lu: secs(10, 1) }],
});

async function boot(page: Page, width = 900) {
  await page.clock.setFixedTime(NOW);
  await serve(page);
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__mk = (rows: Record<string, unknown[]>) => ({
      states: {}, themes: { darkMode: false }, config: { latitude: 52.52, longitude: 13 }, locale: { language: "en", time_format: "24" },
      callService: () => Promise.resolve(),
      connection: {
        sendMessagePromise: (m: { type: string; entity_ids?: string[] }) => {
          const out: Record<string, unknown[]> = {};
          if (m.type === "history/history_during_period") for (const id of m.entity_ids ?? []) if (rows[id]) out[id] = rows[id];
          return Promise.resolve(out);
        },
      },
    });
  });
  await page.goto(`${ORIGIN}/harness.html`);
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate((w) => { document.getElementById("wrap")!.style.width = `${w}px`; }, width);
  await page.evaluate(([config, rows]) => {
    const w = window as unknown as { __mk(r: unknown): unknown };
    const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(config);
    el.hass = w.__mk(rows);
    return el.updateComplete;
  }, [{ layout: structuredClone(demo), floor: "ground", theme: "light", active_list: false }, ROWS()] as const);
  await openMenu(page);
  await menuItem(page, "replay").click();
  await expect(range(page)).toBeEnabled();
}

/** A real click at the centre of the element. */
async function click(loc: ReturnType<typeof prev>) {
  const b = (await loc.boundingBox())!;
  await loc.page().mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}

/** Two animation frames: whatever a frame loop would have done by now has been done. Not a wait for time. */
const frames = (page: Page) => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

test.describe("R2.4 jump to the previous and next event", () => {
  test("criterion 7: real clicks on the buttons walk back and forth through the onsets, and the value text names each", async ({ page }) => {
    await boot(page);
    await expect(range(page)).toHaveValue("1440");
    await click(prev(page));
    await expect(range(page)).toHaveValue("1320");
    await expect(shown(page)).toHaveText("10:00");
    await expect(range(page)).toHaveAttribute("aria-valuetext", "10:00, motion");
    await click(prev(page));
    await expect(range(page)).toHaveValue("1280");
    await expect(range(page)).toHaveAttribute("aria-valuetext", "09:20, light on");
    await click(prev(page));
    await click(prev(page));
    await expect(range(page)).toHaveValue("1200");
    await expect(range(page)).toHaveAttribute("aria-valuetext", "08:00, door opened");
    await click(next(page));
    await expect(range(page)).toHaveValue("1260");
    await expect(range(page)).toHaveAttribute("aria-valuetext", "09:00, light on");
  });

  test("criterion 7: the buttons are disabled at the ends; between events the value text is the time alone", async ({ page }) => {
    await boot(page);
    await expect(next(page)).toBeDisabled(); // 12:00 is after the last onset
    await expect(prev(page)).toBeEnabled();
    await expect(range(page)).toHaveAttribute("aria-valuetext", "12:00");
    for (let i = 0; i < 4; i++) await click(prev(page));
    await expect(range(page)).toHaveValue("1200");
    await expect(prev(page)).toBeDisabled(); // 08:00, the first
    await expect(next(page)).toBeEnabled();
    await click(next(page));
    await click(next(page));
    await click(next(page));
    await expect(range(page)).toHaveValue("1320");
    await expect(next(page)).toBeDisabled(); // 10:00, the last
    // A drag of the slider to a quiet minute: both enabled, no event in the text.
    await range(page).focus();
    await page.keyboard.press("ArrowLeft");
    await expect(range(page)).toHaveValue("1315");
    await expect(range(page)).toHaveAttribute("aria-valuetext", "09:55");
    await expect(next(page)).toBeEnabled();
    await expect(prev(page)).toBeEnabled();
  });

  test("criterion 7: Shift+ArrowLeft and Shift+ArrowRight on the bar jump, and plain arrows still move 5 minutes", async ({ page }) => {
    await boot(page);
    await range(page).focus();
    await page.keyboard.press("Shift+ArrowLeft");
    await expect(range(page)).toHaveValue("1320");
    await page.keyboard.press("Shift+ArrowLeft");
    await expect(range(page)).toHaveValue("1280");
    await expect(range(page)).toHaveAttribute("aria-valuetext", "09:20, light on");
    await page.keyboard.press("Shift+ArrowRight");
    await expect(range(page)).toHaveValue("1320");
    await page.keyboard.press("ArrowLeft");
    await expect(range(page)).toHaveValue("1315");
    await page.keyboard.press("Shift+ArrowRight"); // from 09:55 the next onset is 10:00
    await expect(range(page)).toHaveValue("1320");
    await expect(range(page)).toHaveAttribute("aria-valuetext", "10:00, motion");
  });

  test("criterion 7: at the ends the key does nothing", async ({ page }) => {
    await boot(page);
    await range(page).focus();
    await page.keyboard.press("Shift+ArrowRight"); // 12:00, after the last onset
    await expect(range(page)).toHaveValue("1440");
    await expect(shown(page)).toHaveText("12:00");
    for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowLeft");
    await expect(range(page)).toHaveValue("1200");
    await page.keyboard.press("Shift+ArrowLeft"); // before the first
    await frames(page);
    await expect(range(page)).toHaveValue("1200");
    await expect(shown(page)).toHaveText("08:00");
  });

  test("criterion 7: Shift+arrows work with focus on a button of the bar too", async ({ page }) => {
    await boot(page);
    await click(prev(page));
    await expect(range(page)).toHaveValue("1320");
    await prev(page).focus();
    await page.keyboard.press("Shift+ArrowLeft");
    await expect(range(page)).toHaveValue("1280");
  });

  test("a button that jumps to the end of the line and goes disabled does not take the keyboard with it", async ({ page }) => {
    await boot(page);
    for (let i = 0; i < 4; i++) await click(prev(page));
    await expect(prev(page)).toBeDisabled();
    await page.keyboard.press("Shift+ArrowRight"); // focus was on the button that just went disabled
    await expect(range(page)).toHaveValue("1260");
    await page.keyboard.press("Escape");
    await expect(range(page)).toHaveCount(0);
  });

  test("criterion 7: a jump pauses play, button and key; a key with nowhere to go does not", async ({ page }) => {
    await boot(page);
    await click(play(page)); // from the end, play restarts at the beginning
    await expect(play(page)).toHaveAttribute("aria-label", "Pause");
    await click(next(page));
    await expect(play(page)).toHaveAttribute("aria-label", "Play");
    await expect(range(page)).toHaveValue("1200");
    await frames(page);
    await expect(range(page)).toHaveValue("1200"); // paused: no frame moved it on
    await click(play(page));
    await expect(play(page)).toHaveAttribute("aria-label", "Pause");
    await range(page).focus();
    await page.keyboard.press("Shift+ArrowRight");
    await expect(play(page)).toHaveAttribute("aria-label", "Play");
    await expect(range(page)).toHaveValue("1260");
    await frames(page);
    await expect(range(page)).toHaveValue("1260");
  });

  test("a narrow card (380 px): the bar fits, the buttons are on it", async ({ page }) => {
    await boot(page, 380);
    const bar = (await card(page).locator("css=.fp-replay").boundingBox())!;
    for (const b of [prev(page), play(page), next(page), card(page).locator("css=.fp-rp-close")]) {
      const r = (await b.boundingBox())!;
      expect(r.x).toBeGreaterThanOrEqual(bar.x);
      expect(r.x + r.width).toBeLessThanOrEqual(bar.x + bar.width);
    }
    const sw = await card(page).locator("css=.fp-replay").evaluate((e) => e.scrollWidth - e.clientWidth);
    expect(sw).toBeLessThanOrEqual(0);
    expect((await range(page).boundingBox())!.width).toBeGreaterThan(80);
  });
});
