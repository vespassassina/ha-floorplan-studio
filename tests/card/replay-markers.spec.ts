import { test, expect, type Page } from "@playwright/test";
import { demo, serve, ORIGIN } from "./helpers-3d";
import { openMenu, menuItem } from "./menu-helper";
import { THEMES } from "../../src/core";

// R2.3 (docs/specs/replay-2.md items 5 to 8, criteria 5, 6, 12): the markers on the slider, end to end in the built card, with the replay chunk beside it.
// Real page.mouse at real coordinates on the real elements (CLAUDE.md finding 3).
//
// Where the stubbed reply comes from (finding 21): `homeassistant/components/history/websocket_api.py` answers `history/history_during_period` with
// `{ [entity_id]: CompressedState[] }`; `homeassistant/components/recorder/models/state.py` builds a row as `{ s, a?, lu, lc? }` (float seconds);
// `homeassistant/components/recorder/history/modern.py` sends the lean call (minimal_response) as `{s, a, lu}` on the first row and `{s, lu}` after, the
// full call as `{s, a, lu}` on every row. The first row is the state at the start (its `lu` is the start time) and is never an onset.
//
// The clock: 2026-10-28 12:00 local is the moment the bar opens. The slider is 1440 minutes from 12:00 the day before; 09:00 today is minute 1260.

const NOW = new Date(2026, 9, 28, 12, 0, 0).getTime();
const secs = (h: number, m = 0, day = 0) => (NOW + ((h - 12) * 60 + m + day * 1440) * 60000) / 1000;
const START = secs(12, 0, -1) - 100;

const card = (page: Page) => page.locator("floorplan-studio-card");
const range = (page: Page) => card(page).locator("css=input.fp-rp-range");
const strip = (page: Page) => card(page).locator("css=.fp-rp-strip");
const ticks = (page: Page) => card(page).locator("css=.fp-rp-tick");
const dev = (entity: string) => demo.floors.ground.devices.findIndex((d: { entity: string }) => d.entity === entity);
const kitchen = dev("light.demo_kitchen");
const g = (page: Page, i: number) => card(page).locator(`css=svg g[data-x="${i}"]`);

type Rows = Record<string, unknown[]>;
/** Kitchen lamp on 09:00, living lamp on 09:20 (20 minutes: 11 px apart on a wide bar, 4 px on a narrow one). The front door opens 08:00 and closes 08:10. Hall motion 10:00. */
const ROWS = (): Rows => ({
  "light.demo_kitchen": [{ s: "off", a: {}, lu: START }, { s: "on", a: {}, lu: secs(9, 0) }],
  "light.demo_living": [{ s: "off", a: {}, lu: START }, { s: "on", a: {}, lu: secs(9, 20) }],
  "binary_sensor.demo_front_door": [{ s: "off", a: {}, lu: START }, { s: "on", lu: secs(8, 0) }, { s: "off", lu: secs(8, 10) }],
  "binary_sensor.demo_hall_motion": [{ s: "off", a: {}, lu: START }, { s: "on", lu: secs(10, 0) }, { s: "off", lu: secs(10, 1) }],
});

async function boot(page: Page, o: { width?: number; theme?: string; layout?: unknown; rows?: Rows } = {}) {
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
  await wrapWidth(page, o.width ?? 900);
  await page.evaluate(([config, rows]) => {
    const w = window as unknown as { __mk(r: unknown): unknown };
    const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(config);
    el.hass = w.__mk(rows);
    return el.updateComplete;
  }, [{ layout: structuredClone(o.layout ?? demo), floor: "ground", theme: o.theme ?? "light", active_list: false }, o.rows ?? ROWS()] as const);
  await openMenu(page);
  await menuItem(page, "replay").click();
  await expect(range(page)).toBeEnabled();
  await expect(strip(page)).toBeVisible();
}

/** The card's own container is 900 px wide in the harness; the bar's width follows it, not the viewport. */
const wrapWidth = (page: Page, w: number) => page.evaluate((w) => { document.getElementById("wrap")!.style.width = `${w}px`; }, w);

/** The centre of an element, in page coordinates. */
async function centre(loc: ReturnType<typeof ticks>) {
  const b = (await loc.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

test.describe("R2.3 markers on the slider", () => {
  test("criterion 8: the strip is an image named with the totals; one tick per cluster, motion is a band", async ({ page }) => {
    await boot(page);
    await expect(strip(page)).toHaveAttribute("role", "img");
    await expect(strip(page)).toHaveAttribute("aria-label", "2 lamps, 1 door or window, motion on 1 sensor");
    await expect(ticks(page)).toHaveCount(3); // the door, and two lamps 11 px apart
    // 10:00 is 22 hours into the window: the bucket of 15 minutes at index 88 is the only one drawn.
    const op = await card(page).locator("css=.fp-rp-band i").evaluateAll((els) => els.map((e) => Number(getComputedStyle(e).opacity)));
    expect(op).toHaveLength(96);
    // The busiest bucket is at most half strength, so the ticks above it stay readable (blueprint drew it solid white).
    expect(op[88]).toBeGreaterThan(0.45);
    expect(op[88]).toBeLessThanOrEqual(0.5);
    expect(op.filter((o) => o > 0)).toHaveLength(1);
  });

  test("criterion 6: a real click on a cluster moves the thumb to its first onset and the plan draws that moment", async ({ page }) => {
    await boot(page, { width: 330 }); // narrow: the two lamps (20 minutes apart) are one cluster
    await expect(ticks(page)).toHaveCount(2);
    await expect(range(page)).toHaveValue("1440");
    await expect(g(page, kitchen)).not.toHaveClass(/\bon\b/);
    const lamps = ticks(page).nth(1);
    await expect(lamps).toHaveAttribute("title", "2 lamps");
    const p = await centre(lamps);
    await page.mouse.click(p.x, p.y);
    await expect(range(page)).toHaveValue("1260"); // 09:00, the kitchen lamp
    await expect(card(page).locator("css=.fp-rp-time")).toHaveText("09:00");
    await expect(g(page, kitchen)).toHaveClass(/\bon\b/);
  });

  test("criterion 6: a real click on the door's tick draws the door open, dashed", async ({ page }) => {
    await boot(page);
    const door = ticks(page).first();
    await expect(door).toHaveAttribute("title", "1 door or window");
    expect(await card(page).locator("css=svg .door.open").count()).toBe(0);
    const p = await centre(door);
    await page.mouse.click(p.x, p.y);
    await expect(range(page)).toHaveValue("1200"); // 08:00
    const dash = card(page).locator("css=svg .door.open").first();
    await expect(card(page).locator("css=svg .door.open")).toHaveCount(1);
    expect(await dash.evaluate((e) => getComputedStyle(e).strokeDasharray)).not.toBe("none");
  });

  test("criterion 6: a click between ticks moves nothing", async ({ page }) => {
    await boot(page);
    const a = await centre(ticks(page).nth(0)), b = await centre(ticks(page).nth(1));
    const before = await card(page).locator("css=svg").first().innerHTML();
    await page.mouse.click((a.x + b.x) / 2, a.y);
    await page.mouse.click(b.x + 40, b.y);
    await expect(range(page)).toHaveValue("1440");
    await expect(card(page).locator("css=.fp-rp-time")).toHaveText("12:00");
    expect(await card(page).locator("css=svg").first().innerHTML()).toBe(before);
  });

  test("criterion 5: a narrower bar clusters again, a wider one splits them", async ({ page }) => {
    await boot(page);
    await expect(ticks(page)).toHaveCount(3);
    await wrapWidth(page, 330);
    await expect(ticks(page)).toHaveCount(2);
    await wrapWidth(page, 900);
    await expect(ticks(page)).toHaveCount(3);
  });

  test("criterion 12: a room named like markup is text; no script reaches the card", async ({ page }) => {
    const layout = structuredClone(demo);
    Object.assign(layout.floors.ground.rooms[0], { name: "\"><script>window.__x=1</script>", motion: ["binary_sensor.\"><script>"] });
    await boot(page, { layout, rows: { ...ROWS(), "binary_sensor.\"><script>": [{ s: "off", a: {}, lu: START }, { s: "on", lu: secs(7, 0) }] } });
    expect(await card(page).locator("css=script").count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __x?: number }).__x)).toBeUndefined();
    await expect(strip(page)).toHaveAttribute("aria-label", "2 lamps, 1 door or window, motion on 2 sensors");
  });

  test("CSS pair (finding 10): each group's tick paints its own --fp-* colour, taller with more members; the strip is no second slider", async ({ page }) => {
    const layout = structuredClone(demo);
    layout.floors.ground.devices.push({ id: "sir", type: "siren", entity: "siren.demo", x: 10, y: 10 });
    const rows = { ...ROWS(), "siren.demo": [{ s: "off", a: {}, lu: START }, { s: "on", lu: secs(6, 0) }] };
    await boot(page, { layout, rows });
    await expect(ticks(page)).toHaveCount(4);
    const seen = await card(page).locator("css=.fp-rp-tick").evaluateAll((els) => {
      const probe = (v: string) => { const p = document.createElement("i"); p.style.background = `var(${v})`; els[0].parentElement!.appendChild(p); const c = getComputedStyle(p).backgroundColor; p.remove(); return c; };
      return els.map((e) => ({ cls: e.className, bg: getComputedStyle(e).backgroundColor, h: getComputedStyle(e).height, want: probe(e.classList.contains("fp-rp-t-alarm") ? "--fp-danger" : e.classList.contains("fp-rp-t-opening") ? "--fp-open-door" : "--fp-dev-light") }));
    });
    expect(seen.map((s) => s.cls.replace("fp-rp-tick fp-rp-t-", "")).sort()).toEqual(["alarm", "lamp", "lamp", "opening"]);
    for (const s of seen) { expect(s.bg, s.cls).toBe(s.want); expect(s.bg).not.toBe("rgba(0, 0, 0, 0)"); expect(s.h).toBe("8px"); }
    expect(new Set(seen.map((s) => s.bg)).size).toBe(3); // three groups, three colours
    const band = await card(page).locator("css=.fp-rp-band").evaluate((e) => ({ pe: getComputedStyle(e).pointerEvents, h: getComputedStyle(e).height }));
    expect(band).toEqual({ pe: "none", h: "8px" });
  });

  test("CSS pair: a cluster of five is 16 px, of two 12 px", async ({ page }) => {
    // The living lamp goes on four more times (09:24, 09:28, 09:32, 09:36): with the kitchen lamp at 09:00 and the first living on at 09:20, six lamp onsets in 36 minutes.
    const rows = ROWS();
    for (let i = 0; i < 4; i++) rows["light.demo_living"].push({ s: "off", lu: secs(9, 22 + 4 * i) }, { s: "on", lu: secs(9, 24 + 4 * i) });
    await boot(page, { width: 330, rows });
    expect(await ticks(page).evaluateAll((els) => els.map((e) => [e.getAttribute("title"), getComputedStyle(e).height]))).toEqual([["1 door or window", "8px"], ["6 lamps", "16px"]]);
    await boot(page, { width: 330, rows: ROWS() });
    expect(await ticks(page).evaluateAll((els) => els.map((e) => getComputedStyle(e).height))).toEqual(["8px", "12px"]);
  });

  for (const theme of THEMES) {
    test(`finding 17: every variable the strip uses is defined in ${theme}`, async ({ page }) => {
      await boot(page, { theme });
      const vars = await strip(page).evaluate((e) => ["--fp-dev-light", "--fp-open-door", "--fp-danger", "--fp-text"].map((v) => getComputedStyle(e).getPropertyValue(v).trim()));
      expect(vars.every((v) => v !== "")).toBe(true);
    });
  }
});
