import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { demo, serve, ORIGIN, drawn, cam } from "./helpers-3d";
import { openMenu, menuItem, menuPanel, menuButton, pick } from "./menu-helper";

// Sprint 39 (docs/specs/replay-s39.md, criteria 3 to 13): the replay bar, end to end, in the built card served the way Home Assistant serves it
// (the replay chunk sits beside the card). Real page.mouse and page.keyboard on the real elements (CLAUDE.md finding 3), asymmetric times (finding 4).
//
// Where the stubbed reply comes from (finding 21): Home Assistant core, `homeassistant/components/history/websocket_api.py` answers
// `history/history_during_period` with `{ [entity_id]: CompressedState[] }`, no wrapper, and leaves out an entity with no rows;
// `homeassistant/components/recorder/models/state.py` builds a row as `{ s, a?, lu, lc? }` (`lc` left out when equal to `lu`; both times float seconds since
// the epoch) and `COMPRESSED_STATE_STATE/ATTRIBUTES/LAST_CHANGED/LAST_UPDATED` in `homeassistant/const.py` are "s" "a" "lc" "lu". `no_attributes: false`
// is why `a` is on the first row; later rows leave it out when it did not change, and the card carries the last one forward.
//
// The clock: every time is local, 2026-10-28 12:00:00 is the moment the bar opens (the end of the slider); 24 hours earlier is its start. A key on the
// slider is a number of minutes from that start, so 09:00 today is Home and 21 times Page Up. The browser and Node share the zone.

const NOW = new Date(2026, 9, 28, 12, 0, 0).getTime();
const secs = (h: number, m = 0, day = 0) => (NOW + ((h - 12) * 60 + m + day * 1440) * 60000) / 1000;
const iso = (s: number) => new Date(s * 1000).toISOString();

const card = (page: Page) => page.locator("floorplan-studio-card");
const bar = (page: Page) => card(page).locator("css=.fp-replay");
const range = (page: Page) => card(page).locator("css=input.fp-rp-range");
const playBtn = (page: Page) => card(page).locator("css=button.fp-rp-play");
const msg = (page: Page) => card(page).locator("css=.fp-rp-msg");
const dev = (entity: string) => demo.floors.ground.devices.findIndex((d: { entity: string }) => d.entity === entity);
const lampIdx = dev("light.demo_kitchen"), motionIdx = dev("binary_sensor.demo_hall_motion");
const g = (page: Page, i: number) => card(page).locator(`css=svg g[data-x="${i}"]`);

type Rows = Record<string, unknown[]>;
const st = (state: string, attributes: Record<string, unknown> = {}, last_changed = iso(secs(11, 59))) => ({ state, attributes, last_changed });

/** Kitchen lamp: off, on 08:00 to 10:00. The hall motion sensor: on 09:00:00, off 09:01:00. The sun: below the horizon until 07:00, then above (east, then west). */
const ROWS = (): Rows => ({
  "light.demo_kitchen": [{ s: "off", a: { friendly_name: "Kitchen" }, lu: secs(12, 0, -1) - 7200 }, { s: "on", lu: secs(8, 0) }, { s: "off", lu: secs(10, 0) }],
  "binary_sensor.demo_hall_motion": [{ s: "off", a: {}, lu: secs(12, 0, -1) - 100 }, { s: "on", lu: secs(9, 0) }, { s: "off", lu: secs(9, 1) }],
  "sun.sun": [
    { s: "below_horizon", a: { azimuth: 10, elevation: -30 }, lu: secs(12, 0, -1) - 100 },
    { s: "above_horizon", a: { azimuth: 90, elevation: 30 }, lu: secs(7, 0) },
    { s: "above_horizon", a: { azimuth: 270, elevation: 30 }, lu: secs(10, 30) },
  ],
});

interface Opts { config?: Record<string, unknown>; live?: Record<string, unknown>; rows?: Rows; fail?: unknown; language?: string; connection?: boolean; size?: { width: number; height: number }; clock?: "install" | "fixed" }

async function boot(page: Page, o: Opts = {}) {
  if (o.clock === "install") await page.clock.install({ time: NOW });
  else await page.clock.setFixedTime(NOW);
  await serve(page);
  await page.setViewportSize(o.size ?? { width: 1100, height: 800 });
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__calls = []; w.__sent = [];
    // The connection as Home Assistant's frontend hands it: `sendMessagePromise` answers a websocket command or rejects with { code, message }.
    w.__mk = (states: unknown, extra: { language?: string; rows?: Record<string, unknown[]>; fail?: unknown; connection?: boolean }) => ({
      states, themes: { darkMode: false }, language: extra.language, locale: { language: extra.language ?? "en", time_format: "24" },
      callService: (d: string, s: string, data: { entity_id: string }) => { (w.__calls as string[]).push(`${d}.${s} ${data.entity_id}`); return Promise.resolve(); },
      connection: extra.connection === false ? undefined : {
        sendMessagePromise: (m: { type: string; entity_ids?: string[] }) => {
          (w.__sent as unknown[]).push(m);
          if (m.type !== "history/history_during_period") return Promise.resolve({});
          if (extra.fail) return Promise.reject(extra.fail);
          const out: Record<string, unknown[]> = {};
          for (const id of m.entity_ids ?? []) if (extra.rows?.[id]) out[id] = extra.rows[id];
          return Promise.resolve(out);
        },
      },
    });
  });
  await page.goto(`${ORIGIN}/harness.html`);
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(([config, live, extra]) => {
    const w = window as unknown as { __mk(s: unknown, e: unknown): unknown; __extra: unknown };
    w.__extra = extra;
    const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(config);
    el.hass = w.__mk(live, extra);
    return el.updateComplete;
  }, [{ layout: structuredClone(demo), floor: "ground", theme: "light", active_list: false, ...o.config }, o.live ?? {}, { language: o.language, rows: o.rows ?? ROWS(), fail: o.fail, connection: o.connection }] as const);
  await expect(card(page).locator("css=svg polygon[data-r], .fp-3d").first()).toBeVisible();
}
/** A hass update as Home Assistant makes one: a new object with new states. */
const update = (page: Page, live: Record<string, unknown>) => page.evaluate((live) => {
  const w = window as unknown as { __mk(s: unknown, e: unknown): unknown; __extra: unknown };
  const el = document.getElementById("card") as unknown as { hass: unknown; updateComplete: Promise<unknown> };
  el.hass = w.__mk(live, w.__extra);
  return el.updateComplete;
}, live);
const sent = (page: Page) => page.evaluate(() => (window as unknown as { __sent: Record<string, unknown>[] }).__sent.filter((m) => m.type === "history/history_during_period"));
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: string[] }).__calls);

async function openBar(page: Page) {
  await openMenu(page);
  await menuItem(page, "replay").click();
  await expect(bar(page)).toBeVisible();
  await expect(range(page)).toBeEnabled(); // the history has come
}
/** To a time by its keys: Home is 12:00 yesterday; each Page Up an hour, each arrow 5 minutes. */
async function to(page: Page, hour: number, minute = 0) {
  await range(page).focus();
  await page.keyboard.press("Home");
  const from = hour * 60 + minute + 720; // minutes after 12:00 yesterday, for a time today before 12:00 (hour < 12) or the 24 h day
  for (let i = 0; i < Math.floor(from / 60); i++) await page.keyboard.press("PageUp");
  for (let i = 0; i < Math.floor((from % 60) / 5); i++) await page.keyboard.press("ArrowRight");
  await expect(range(page)).toHaveValue(String(from));
}
const viewBox = (page: Page) => card(page).locator("css=svg.fp-zoomable").getAttribute("viewBox");

test.describe("S39.2 the bar and the fetch", () => {
  test("Replay is in the menu with a connection, and opens a paused bar at now: 12:00, the slider at its end, a name and a value text", async ({ page }) => {
    await boot(page);
    await openBar(page);
    await expect(range(page)).toHaveValue("1440");
    await expect(range(page)).toHaveAttribute("aria-label", "Replay time");
    await expect(range(page)).toHaveAttribute("aria-valuetext", "12:00");
    await expect(card(page).locator("css=.fp-rp-time")).toHaveText("12:00");
    await expect(playBtn(page)).toHaveAttribute("aria-label", "Play");
    await expect(card(page).locator("css=button.fp-rp-live")).toHaveText("Live");
    await expect(menuButton(page)).toBeVisible();
  });

  test("criterion 3: one call for the shown floor with its devices, a bound switch, the room sensors, the sun and the flags; the second floor one more; back, none", async ({ page }) => {
    const layout = structuredClone(demo);
    Object.assign(layout.floors.ground.rooms[0], { temps: ["sensor.room_t"], humidity: ["sensor.room_h"], motion: ["binary_sensor.room_m"] });
    await boot(page, { config: { layout, floor: "all" }, live: {} });
    await openBar(page);
    const first = await sent(page);
    expect(first).toHaveLength(1);
    const m = first[0] as { entity_ids: string[]; start_time: string; end_time: string } & Record<string, unknown>;
    expect(m.entity_ids).toEqual(expect.arrayContaining(["light.demo_living", "switch.demo_living_relay", "sun.sun", "sensor.room_t", "sensor.room_h", "binary_sensor.room_m", "binary_sensor.demo_hall_motion"]));
    expect(m.entity_ids).not.toContain("light.demo_bedroom"); // that is on the other floor
    expect([...m.entity_ids].sort()).toEqual(m.entity_ids);
    expect(m).toMatchObject({ include_start_time_state: true, significant_changes_only: false, minimal_response: false, no_attributes: false, start_time: iso(NOW / 1000 - 86400), end_time: iso(NOW / 1000) });
    await card(page).locator("css=.fp-floors button", { hasText: "First" }).click();
    await expect.poll(async () => (await sent(page)).length).toBe(2);
    expect(((await sent(page))[1] as { entity_ids: string[] }).entity_ids).toEqual(expect.arrayContaining(["light.demo_bedroom", "sun.sun"]));
    await card(page).locator("css=.fp-floors button", { hasText: "Ground" }).click();
    await expect(card(page).locator("css=.fp-floors button", { hasText: "Ground" })).toHaveAttribute("aria-pressed", "true");
    await expect(range(page)).toBeEnabled();
    expect(await sent(page)).toHaveLength(2);
  });

  test("criterion 13: no Replay item in kiosk, without a connection, and none in the Studio", async ({ page }) => {
    await boot(page, { connection: false });
    await openMenu(page);
    await expect(menuPanel(page).locator("css=[data-value]").first()).toBeVisible(); // a menu with items, so the absence is meant
    await expect(menuItem(page, "replay")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await boot(page, { config: { kiosk: true, rotate_switch: true } }); // kiosk: only the cluster's menu, if the config brings one
    await openMenu(page);
    await expect(menuPanel(page).locator("css=[data-value]").first()).toBeVisible();
    await expect(menuItem(page, "replay")).toHaveCount(0);
    expect(readFileSync("dist/editor.html", "utf8")).not.toMatch(/floorplan-studio-replay|fp-rp-/); // the Studio has no replay
  });

  test("criterion 13 control: the same card with a connection offers it, so the absences above are not a broken locator", async ({ page }) => {
    await boot(page);
    await openMenu(page);
    await expect(menuItem(page, "replay")).toHaveCount(1);
  });

  test("criterion 12: a failed fetch shows the reason in German, in the bar, and the plan stays live", async ({ page }) => {
    await boot(page, { language: "de", live: { "light.demo_kitchen": st("on") }, fail: { code: "unknown_error", message: "Recorder is not running" } });
    await expect(g(page, lampIdx)).toHaveClass(/\bon\b/); // live: lit
    await card(page).locator("css=fp-menu button").first().click(); // its label is in German now
    await card(page).locator("css=[data-value='replay']").click();
    await expect(msg(page)).toHaveText("Der Verlauf konnte nicht geladen werden: Recorder is not running");
    await expect(range(page)).toBeDisabled();
    await expect(playBtn(page)).toBeDisabled();
    await expect(g(page, lampIdx)).toHaveClass(/\bon\b/); // still live
    await card(page).locator("css=button.fp-rp-live").click();
    await expect(bar(page)).toHaveCount(0);
  });

  test("while the history loads the bar is busy and the slider is disabled", async ({ page }) => {
    await boot(page);
    await page.evaluate(() => { // an answer that waits until the test lets it go
      const w = window as unknown as { __release: () => void; __mk: (...a: unknown[]) => { connection: { sendMessagePromise: (m: unknown) => Promise<unknown> } } };
      const el = document.getElementById("card") as unknown as { hass: { connection: { sendMessagePromise: (m: unknown) => Promise<unknown> } } };
      const slow = new Promise<void>((r) => { w.__release = r; });
      const was = el.hass.connection.sendMessagePromise;
      el.hass.connection.sendMessagePromise = (m) => slow.then(() => was(m));
    });
    await openMenu(page);
    await menuItem(page, "replay").click();
    await expect(range(page)).toBeDisabled();
    await expect(bar(page)).toHaveAttribute("aria-busy", "true");
    await expect(msg(page)).toHaveText("Loading history…");
    await page.evaluate(() => (window as unknown as { __release: () => void }).__release());
    await expect(range(page)).toBeEnabled();
    await expect(bar(page)).toHaveAttribute("aria-busy", "false");
  });

  test("a mouse click on the slider moves the thumb to that place, and the time follows", async ({ page }) => {
    await boot(page);
    await openBar(page);
    const b = (await range(page).boundingBox())!;
    await page.mouse.click(b.x + b.width * 0.25, b.y + b.height / 2);
    const v = Number(await range(page).inputValue());
    expect(v).toBeGreaterThan(300);
    expect(v).toBeLessThan(420); // a quarter of 1440 is 360, the thumb has a width
    const at = new Date(NOW - (1440 - v) * 60000);
    await expect(card(page).locator("css=.fp-rp-time")).toHaveText(`${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`);
  });
});

test.describe("S39.3 one draw path for the past", () => {
  test("criterion 4: the kitchen lamp is lit at 09:00 and unlit at 11:00, where the live state says the opposite each time", async ({ page }) => {
    await boot(page, { live: { "light.demo_kitchen": st("off") } });
    await expect(g(page, lampIdx)).not.toHaveClass(/\bon\b/);
    await openBar(page);
    await to(page, 9);
    await expect(card(page).locator("css=.fp-rp-time")).toHaveText("09:00");
    await expect(g(page, lampIdx)).toHaveClass(/\bon\b/); // live says off
    await update(page, { "light.demo_kitchen": st("on") });
    await to(page, 11);
    await expect(g(page, lampIdx)).not.toHaveClass(/\bon\b/); // live says on
  });

  test("criterion 6: a motion sensor that went off at 09:01 shows the fade of 09:05 (0.6 of 600 s), then of 09:10 (0.1), not the live one", async ({ page }) => {
    await boot(page, { config: { fade: 600 }, live: { "binary_sensor.demo_hall_motion": st("off", {}, iso(secs(11, 0))) } });
    await openBar(page);
    const fade = () => g(page, motionIdx).evaluate((el) => getComputedStyle(el).getPropertyValue("--fp-fade"));
    await to(page, 9, 0); // on
    await expect.poll(async () => Number(await fade())).toBeCloseTo(1, 2);
    await to(page, 9, 5);
    await expect.poll(async () => Number(await fade())).toBeCloseTo(0.6, 2);
    await to(page, 9, 10);
    await expect.poll(async () => Number(await fade())).toBeCloseTo(0.1, 2);
  });

  test("criterion 7: night: auto follows the replayed sun: night at 03:00, day at 12:00, with the live sun saying the opposite", async ({ page }) => {
    const night = () => card(page).locator("css=svg.fp-zoomable g.night");
    await boot(page, { config: { night: "auto" }, live: { "sun.sun": st("above_horizon") } });
    await expect(night()).toHaveCount(0);
    await openBar(page);
    await to(page, 3);
    await expect(night()).toHaveCount(1); // live: day
    await update(page, { "sun.sun": st("below_horizon") });
    await range(page).focus();
    await page.keyboard.press("End");
    await expect(night()).toHaveCount(0); // live: night
    await card(page).locator("css=button.fp-rp-live").click();
    await expect(night()).toHaveCount(1); // Live shows the newest
  });

  test("criterion 8: a hass update that lights the lamp leaves the plan as it was; Live shows it; the zoom and the floor are kept", async ({ page }) => {
    await boot(page, { config: { floor: "all" }, live: { "light.demo_kitchen": st("off") } });
    await card(page).locator("css=button[aria-label='Zoom in']").click();
    const zoomed = await viewBox(page);
    const whole = (await card(page).locator("css=svg.fp-zoomable").getAttribute("aria-label"))!;
    await openBar(page);
    await to(page, 11);
    await expect(g(page, lampIdx)).not.toHaveClass(/\bon\b/);
    await update(page, { "light.demo_kitchen": st("on") });
    await expect(g(page, lampIdx)).not.toHaveClass(/\bon\b/);
    await expect(range(page)).toHaveValue(String(23 * 60));
    expect(await viewBox(page)).toBe(zoomed);
    await card(page).locator("css=button.fp-rp-live").click();
    await expect(g(page, lampIdx)).toHaveClass(/\bon\b/);
    expect(await viewBox(page)).toBe(zoomed);
    await expect(card(page).locator("css=svg.fp-zoomable")).toHaveAttribute("aria-label", whole);
  });

  test("zoom, floor and selection survive opening and closing the bar", async ({ page }) => {
    await boot(page, { config: { floor: "all" }, live: {} });
    await card(page).locator("css=.fp-floors button", { hasText: "First" }).click();
    await expect(card(page).locator("css=.fp-floors button", { hasText: "First" })).toHaveAttribute("aria-pressed", "true");
    await card(page).locator("css=button[aria-label='Zoom in']").click();
    const zoomed = await viewBox(page);
    const picked = () => card(page).evaluate((el) => (el as unknown as { _picked(): number | null })._picked());
    const room = card(page).locator("css=svg polygon[data-r]").first();
    await room.click({ position: { x: 5, y: 5 }, force: true });
    const before = await picked();
    await openBar(page);
    await to(page, 9);
    await card(page).locator("css=button.fp-rp-live").click();
    await expect(bar(page)).toHaveCount(0);
    await expect(card(page).locator("css=.fp-floors button", { hasText: "First" })).toHaveAttribute("aria-pressed", "true");
    expect(await viewBox(page)).toBe(zoomed);
    expect(await picked()).toBe(before);
  });

  test("criterion 9: a tap on a device while replaying calls no service and opens no popup, the bar says Replaying; Live gives the tap back", async ({ page }) => {
    await boot(page, { live: { "light.demo_kitchen": st("off") } });
    await g(page, lampIdx).click(); // a real tap, before: the popup opens, so the click does land on the device
    await expect(card(page).locator("css=.fp-pop")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(card(page).locator("css=.fp-pop")).toHaveCount(0);
    await openBar(page);
    await to(page, 9);
    await g(page, lampIdx).click();
    await expect(msg(page)).toHaveText("Replaying");
    await expect(card(page).locator("css=.fp-pop")).toHaveCount(0);
    expect(await calls(page)).toEqual([]);
    await card(page).locator("css=button.fp-rp-live").click();
    await g(page, lampIdx).click();
    await expect(card(page).locator("css=.fp-pop")).toHaveCount(1);
  });

  test("the floor-off button is off while replaying: the rows would be the past's", async ({ page }) => {
    await boot(page, { config: { active_list: true }, live: { "light.demo_kitchen": st("on") } });
    const off = card(page).locator("css=button.fp-floor-off");
    await expect(off).toBeEnabled();
    await openBar(page);
    await expect(off).toBeDisabled();
  });
});

test.describe("Opus review B1: nothing acts or opens while replaying, whatever the path (with the Overview on)", () => {
  // Every test above uses active_list: false, so none of these paths was ever reached. The kitchen lamp is on in the replayed past (08:00 to 10:00)
  // and off live, so the replayed rows offer Turn off / Lights off and a service call would be a real act on the present.
  const live = { "light.demo_kitchen": st("off") };
  const CFG = { active_list: true, favourites: ["light.demo_kitchen"] };
  const noPopup = (page: Page) => expect(card(page).locator("css=.fp-pop")).toHaveCount(0);

  test("the room's Lights off, a favourite's button and an Active row's tap call no service and open no popup; the bar says Replaying", async ({ page }) => {
    await boot(page, { config: CFG, live });
    await openBar(page);
    await to(page, 9);
    await expect(g(page, lampIdx)).toHaveClass(/\bon\b/);
    // The favourite's own button must do nothing (its label is another matter: subjectOp reads the live state).
    await card(page).locator('css=.fp-ov-fav .fp-fav-row[data-entity="light.demo_kitchen"] .fp-fav-act').click();
    await expect(msg(page)).toHaveText("Replaying");
    // The Active row of the same lamp (the replayed state lists it): a tap goes to the thing, and must not.
    await card(page).locator('css=.fp-ov-act .fp-active-row[data-entity="light.demo_kitchen"]').click();
    await noPopup(page);
    // A real click on the Kitchen room, then its Lights off.
    await card(page).locator("css=svg text[data-rl='1']").click(); // the room's own name picks it (tapRoom)
    const off = card(page).locator("css=.fp-room .fp-alloff");
    await expect(off).toHaveCount(1); // its rows come from the replayed states
    await page.evaluate(() => { (document.querySelector("floorplan-studio-card") as unknown as { _replay: { note: boolean } })._replay.note = false; });
    await off.click();
    await expect(msg(page)).toHaveText("Replaying");
    await noPopup(page);
    expect(await calls(page)).toEqual([]);
    // Live gives the acts back: the same button now calls the service (the control: the paths above were reachable).
    await card(page).locator("css=button.fp-rp-live").click();
    await update(page, { "light.demo_kitchen": st("on") });
    await off.click();
    expect(await calls(page)).toEqual(["light.turn_off light.demo_kitchen"]);
  });

  test("Enter on a device the keys have focused opens nothing while replaying, and opens the popup live", async ({ page }) => {
    await boot(page, { config: { active_list: true }, live });
    const tabIn = async () => { await card(page).locator("css=button[aria-label='View options']").focus(); await page.keyboard.press("Tab"); await expect(card(page).locator("css=.fp-focus")).toBeVisible(); };
    await tabIn();
    await page.keyboard.press("Enter");
    await expect(card(page).locator("css=.fp-pop")).toHaveCount(1); // live: it opens, so the key does reach the device
    await page.keyboard.press("Escape");
    await expect(card(page).locator("css=.fp-pop")).toHaveCount(0);
    await openBar(page);
    await to(page, 9);
    await tabIn();
    await page.keyboard.press("Enter");
    await noPopup(page);
    await expect(msg(page)).toHaveText("Replaying");
    expect(await calls(page)).toEqual([]);
  });
});

test.describe("Opus review S1: the words are the past's, like the picture", () => {
  test("lamp on 08:00 to 10:00, off live, thumb at 09:00: the Active row and the hover tooltip say on", async ({ page }) => {
    await boot(page, { config: { active_list: true }, live: { "light.demo_kitchen": st("off") } });
    await openBar(page);
    await to(page, 9);
    await expect(g(page, lampIdx)).toHaveClass(/\bon\b/);
    await expect(card(page).locator('css=.fp-ov-act .fp-active-row[data-entity="light.demo_kitchen"] .fp-row-state')).toHaveText(/^on\b/i);
    await g(page, lampIdx).hover();
    await expect(card(page).locator("css=.fp-tip")).toHaveText(/^Kitchen light\s*on$/i); // name, type, state: the spans run together in textContent
    await expect(card(page).locator("css=#fp-tip")).not.toContainText(/off/i);
  });
});

test.describe("Opus review S2: the clock is the past's only while the past is drawn", () => {
  const fade = (page: Page) => g(page, motionIdx).evaluate((el) => getComputedStyle(el).getPropertyValue("--fp-fade"));

  test("a failed fetch keeps the plan live, and the motion fade keeps moving with the clock", async ({ page }) => {
    // The sensor went off 140 s before 12:00:00, so the live fade of 600 s starts at 1 - 140/600.
    await boot(page, { clock: "install", config: { fade: 600 }, fail: { code: "unknown_error", message: "no recorder" }, live: { "binary_sensor.demo_hall_motion": st("off", {}, iso(NOW / 1000 - 140)) } });
    await openMenu(page);
    await menuItem(page, "replay").click();
    await expect(msg(page)).toHaveText(/no recorder/);
    await expect.poll(async () => Number(await fade(page))).toBeCloseTo(1 - 140 / 600, 2);
    await page.clock.runFor(300000);
    await expect.poll(async () => Number(await fade(page))).toBeCloseTo(1 - 440 / 600, 2); // five minutes later, live, not frozen
  });

  test("a floor switch while playing pauses the play until the new floor's history is there", async ({ page }) => {
    await boot(page, { clock: "install", config: { floor: "all" } });
    await openBar(page);
    await page.evaluate(() => { // the second floor's answer waits for the test
      const w = window as unknown as { __release: () => void };
      const el = document.getElementById("card") as unknown as { hass: { connection: { sendMessagePromise: (m: unknown) => Promise<unknown> } } };
      const slow = new Promise<void>((r) => { w.__release = r; });
      const was = el.hass.connection.sendMessagePromise;
      el.hass.connection.sendMessagePromise = (m) => slow.then(() => was(m));
    });
    await playBtn(page).click();
    await page.clock.runFor(2000);
    await expect(playBtn(page)).toHaveAttribute("aria-label", "Pause");
    await card(page).locator("css=.fp-floors button", { hasText: "First" }).click();
    await expect(range(page)).toBeDisabled(); // loading
    await page.clock.runFor(2000);
    await expect(playBtn(page)).toHaveAttribute("aria-label", "Play"); // paused, not running on live states with a past clock
    await page.evaluate(() => (window as unknown as { __release: () => void }).__release());
    await expect(range(page)).toBeEnabled();
    const held = await range(page).inputValue();
    await page.clock.runFor(3000);
    await expect(range(page)).toHaveValue(held);
  });
});

test.describe("Opus review S4: the floors that are not on show keep their alerts live", () => {
  test("an unlocked door upstairs keeps its badge while the ground floor is replayed; the ground floor's own badge follows the replay", async ({ page }) => {
    const layout = structuredClone(demo);
    layout.floors.ground.devices.push({ id: "dev-down-lock", type: "lock", entity: "lock.down_front", x: 300, y: 300 });
    layout.floors.first.devices.push({ id: "dev-up-lock", type: "lock", entity: "lock.up_front", x: 300, y: 300 });
    const rows = ROWS();
    rows["lock.down_front"] = [{ s: "locked", a: {}, lu: secs(12, 0, -1) - 100 }]; // locked all day in the recorder
    const pill = (title: string) => card(page).locator("css=.fp-floors button", { hasText: title }).locator("css=.fp-floor-count");
    await boot(page, { config: { layout, floor: "all" }, rows, live: { "lock.down_front": st("unlocked"), "lock.up_front": st("unlocked") } });
    await expect(pill("Ground")).toHaveText("1"); // live: both are unlocked
    await expect(pill("First")).toHaveText("1");
    await openBar(page);
    await to(page, 9);
    await expect(pill("Ground")).toHaveCount(0); // the shown floor, as it was at 09:00
    await expect(pill("First")).toHaveText("1"); // another floor: now, not absent
    await card(page).locator("css=button.fp-rp-live").click();
    await expect(pill("Ground")).toHaveText("1");
  });
});

test.describe("Opus review S5: the timeout reason is translated", () => {
  test("a history that never answers says why in German after 20 s", async ({ page }) => {
    await boot(page, { language: "de", clock: "install" });
    await page.evaluate(() => {
      const el = document.getElementById("card") as unknown as { hass: { connection: { sendMessagePromise: (m: unknown) => Promise<unknown> } } };
      el.hass.connection.sendMessagePromise = () => new Promise(() => undefined); // the socket is open and silent
    });
    await card(page).locator("css=fp-menu button").first().click();
    await card(page).locator("css=[data-value='replay']").click();
    await expect(bar(page)).toHaveAttribute("aria-busy", "true"); // waiting, not an error yet
    await page.clock.runFor(20001);
    await expect(msg(page)).toHaveText("Der Verlauf konnte nicht geladen werden: keine Antwort in 20 s");
  });
});

test.describe("S39.2 play and keys", () => {
  test("criterion 10: play from the end restarts at the start, 60 s of play cover 24 h, few draws, one draw per minute, and it stops at the end", async ({ page }) => {
    await boot(page, { clock: "install" });
    await page.evaluate(() => { // counts the card's draws
      const P = customElements.get("floorplan-studio-card")!.prototype as unknown as { render(): unknown };
      const was = P.render; const w = window as unknown as { __renders: number };
      w.__renders = 0;
      P.render = function (this: unknown) { w.__renders++; return was.call(this); };
    });
    await openBar(page);
    await expect(range(page)).toHaveValue("1440");
    await playBtn(page).click(); // from the end
    await expect(range(page)).toHaveValue("0");
    await expect(playBtn(page)).toHaveAttribute("aria-label", "Pause");
    const draws0 = await page.evaluate(() => (window as unknown as { __renders: number }).__renders);
    await page.clock.runFor(30000);
    const v = Number(await range(page).inputValue());
    expect(v).toBeGreaterThan(700);
    expect(v).toBeLessThan(740); // half of 1440 after half of the 60 s
    await page.clock.runFor(30500);
    await expect(range(page)).toHaveValue("1440");
    await expect(playBtn(page)).toHaveAttribute("aria-label", "Play"); // stopped by itself
    const draws = (await page.evaluate(() => (window as unknown as { __renders: number }).__renders)) - draws0;
    // 3,700 frames and 1,440 minutes went by. The plan is drawn when the states change (the lamp, the sensor, the sun: a dozen times) and
    // while a motion fade runs, not for every frame and not for every minute; with the sheet shown it is drawn for the minutes too.
    expect(draws, "draws of the card").toBeLessThan(80);
    expect(draws).toBeGreaterThan(5);
    await page.clock.runFor(5000);
    await expect(range(page)).toHaveValue("1440");
  });

  test("play and pause with the button, and a key on the slider while it plays moves from where it is", async ({ page }) => {
    await boot(page, { clock: "install" });
    await openBar(page);
    await to(page, 3);
    await playBtn(page).click();
    await page.clock.runFor(10000);
    const v = Number(await range(page).inputValue());
    expect(v).toBeGreaterThan(900 + 200);
    expect(v).toBeLessThan(900 + 280); // 10 s of 60 s is 240 minutes
    await playBtn(page).click();
    await expect(playBtn(page)).toHaveAttribute("aria-label", "Play");
    const held = await range(page).inputValue();
    await page.clock.runFor(10000);
    await expect(range(page)).toHaveValue(held);
  });

  test("criterion 11: the arrows move 5 minutes, Page Up and Down an hour, Home and End the ends, Space plays and pauses, Escape is Live", async ({ page }) => {
    await boot(page, { config: { floor: "ground" }, clock: "install" });
    await card(page).locator("css=button[aria-label='Zoom in']").click();
    const zoomed = await viewBox(page);
    await openBar(page);
    await range(page).focus();
    const val = () => range(page).inputValue();
    await page.keyboard.press("ArrowLeft"); expect(await val()).toBe("1435");
    await page.keyboard.press("PageDown"); expect(await val()).toBe("1375");
    await page.keyboard.press("ArrowRight"); expect(await val()).toBe("1380");
    await page.keyboard.press("ArrowUp"); expect(await val()).toBe("1385");
    await page.keyboard.press("ArrowDown"); expect(await val()).toBe("1380");
    await page.keyboard.press("PageUp"); expect(await val()).toBe("1440");
    await page.keyboard.press("Home"); expect(await val()).toBe("0");
    await page.keyboard.press("PageDown"); expect(await val()).toBe("0");
    await page.keyboard.press("End"); expect(await val()).toBe("1440");
    await expect(card(page).locator("css=.fp-rp-time")).toHaveText("12:00");
    expect(await viewBox(page), "the arrows are the bar's, they do not pan the plan").toBe(zoomed);
    await page.keyboard.press("Space");
    await expect(playBtn(page)).toHaveAttribute("aria-label", "Pause");
    await expect(range(page)).toHaveValue("0"); // from the end, again from the start
    await page.keyboard.press("Space");
    await expect(playBtn(page)).toHaveAttribute("aria-label", "Play");
    expect(await viewBox(page), "Space is the bar's, it does not reset the view").toBe(zoomed);
    await page.keyboard.press("Escape");
    await expect(bar(page)).toHaveCount(0);
  });

  test("a keyboard user on the Play button: Space and Enter press it once, not twice", async ({ page }) => {
    await boot(page, { clock: "install" });
    await openBar(page);
    await to(page, 3);
    await playBtn(page).focus();
    await page.keyboard.press("Space");
    await expect(playBtn(page)).toHaveAttribute("aria-label", "Pause");
    await page.keyboard.press("Enter");
    await expect(playBtn(page)).toHaveAttribute("aria-label", "Play");
  });
});

test.describe("S39.3 in 3D", () => {
  const pools = (page: Page) => page.evaluate(() => (window as unknown as { __fp3d: { live(): { pools: { visible: boolean }[] } } }).__fp3d.live().pools.filter((p) => p.visible).length);
  const light = (page: Page) => page.evaluate(() => (window as unknown as { __fp3d: { light(): { x: number } } }).__fp3d.light().x);
  async function still(page: Page) {
    let prev = -1, same = 0;
    await expect.poll(async () => { const n = (await cam(page)).drawn; same = n === prev ? same + 1 : 0; prev = n; return same; }, { intervals: [100], timeout: 15000 }).toBeGreaterThanOrEqual(3);
  }

  test("criterion 5: the lamp's pool is there at 09:00 and not at 11:00, live says the opposite; the sun follows the replayed moment; the moment survives a change of view", async ({ page }) => {
    await boot(page, { config: { view: "3d", walls: "full" }, live: { "light.demo_kitchen": st("off"), "sun.sun": st("above_horizon", { azimuth: 180, elevation: 60 }) } });
    await drawn(page); await still(page);
    expect(await pools(page)).toBe(0);
    await openBar(page);
    await to(page, 9);
    await still(page);
    expect(await pools(page)).toBeGreaterThan(0);
    const east = await light(page);
    await update(page, { "light.demo_kitchen": st("on"), "sun.sun": st("above_horizon", { azimuth: 180, elevation: 60 }) });
    await to(page, 11);
    await still(page);
    expect(await pools(page)).toBe(0);
    const west = await light(page);
    expect(Math.sign(east) * Math.sign(west), `sun at 90 degrees then 270: x ${east} then ${west}`).toBe(-1);
    await pick(page, "view:2d"); // another view, the same moment
    await expect(card(page).locator("css=.fp-rp-time")).toHaveText("11:00");
    await expect(g(page, lampIdx)).not.toHaveClass(/\bon\b/);
    await to(page, 9);
    await expect(g(page, lampIdx)).toHaveClass(/\bon\b/);
  });
});
