import { test, expect, type Page } from "@playwright/test";
import { demo, serve, ORIGIN } from "./helpers-3d";
import { openMenu, menuItem } from "./menu-helper";

// R2.6 (docs/specs/replay-2.md items 14 and 15, criteria 11 and 12): the filter button and list, end to end in the built card with the replay chunk.
// Real page.mouse at real coordinates and page.keyboard (CLAUDE.md finding 3).
//
// Where the stubbed reply comes from (finding 21): as replay-jumps.spec.ts. `homeassistant/components/history/websocket_api.py` answers
// `history/history_during_period` with `{ [entity_id]: CompressedState[] }`; `recorder/models/state.py` builds a row as `{ s, a?, lu }` (float seconds);
// `recorder/history/modern.py` sends `{s, a, lu}` on the first row and `{s, lu}` after. The first row is the start state, never an onset.
//
// The clock: 2026-10-28 12:00 local is the moment the bar opens; the slider is 1440 minutes from 12:00 the day before.
// The demo's ground floor has Living room (index 0), Kitchen (1), Hall (2). A door is added on the wall between Living room and Hall.
// Onsets: inner door opens 08:00 (1200, Living room and Hall), kitchen lamp 09:00 (1260, Kitchen), living lamp 09:20 (1280, Living room),
// hall motion 10:00 (1320, Hall).

const NOW = new Date(2026, 9, 28, 12, 0, 0).getTime();
const secs = (h: number, m = 0) => (NOW + (h - 12) * 3600000 + m * 60000) / 1000;
const START = secs(12, 0) - 86400 - 100;

const card = (page: Page) => page.locator("floorplan-studio-card");
const range = (page: Page) => card(page).locator("css=input.fp-rp-range");
const prev = (page: Page) => card(page).locator("css=button.fp-rp-prev");
const next = (page: Page) => card(page).locator("css=button.fp-rp-next");
const filter = (page: Page) => card(page).locator("css=button.fp-rp-filter");
const menu = (page: Page) => card(page).locator("css=.fp-rp-menu");
const group = (page: Page, g: string) => card(page).locator(`css=.fp-rp-menu [data-g=${g}]`);
const room = (page: Page, i: number) => card(page).locator(`css=.fp-rp-menu [data-r="${i}"]`);
const strip = (page: Page) => card(page).locator("css=.fp-rp-strip");
const ticks = (page: Page) => card(page).locator("css=.fp-rp-tick");

const ROWS = () => ({
  "light.demo_kitchen": [{ s: "off", a: {}, lu: START }, { s: "on", a: {}, lu: secs(9, 0) }],
  "light.demo_living": [{ s: "off", a: {}, lu: START }, { s: "on", a: {}, lu: secs(9, 20) }],
  "binary_sensor.inner_door": [{ s: "off", a: {}, lu: START }, { s: "on", lu: secs(8, 0) }, { s: "off", lu: secs(8, 10) }],
  "binary_sensor.demo_hall_motion": [{ s: "off", a: {}, lu: START }, { s: "on", lu: secs(10, 0) }, { s: "off", lu: secs(10, 1) }],
});
const LAYOUT = () => {
  const l = structuredClone(demo);
  l.floors.ground.doors = [{ id: "d-inner", name: "Inner", kind: "door", a: [100, 400], b: [200, 400], sensors: ["binary_sensor.inner_door"] }];
  return l;
};

async function boot(page: Page, o: { width?: number; layout?: unknown; theme?: string; rows?: Record<string, unknown[]> } = {}) {
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
  await page.evaluate((w) => { document.getElementById("wrap")!.style.width = `${w}px`; }, o.width ?? 1000);
  await page.evaluate(([config, rows]) => {
    const w = window as unknown as { __mk(r: unknown): unknown };
    const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(config);
    el.hass = w.__mk(rows);
    return el.updateComplete;
  }, [{ layout: o.layout ?? LAYOUT(), floor: "ground", theme: o.theme ?? "light", active_list: false }, o.rows ?? ROWS()] as const);
  await openMenu(page);
  await menuItem(page, "replay").click();
  await expect(range(page)).toBeEnabled();
  await expect(ticks(page)).not.toHaveCount(0);
}

/** A real click at the centre of the element. */
async function click(loc: ReturnType<typeof prev>) {
  const b = (await loc.boundingBox())!;
  await loc.page().mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}
const openList = async (page: Page) => { await click(filter(page)); await expect(menu(page)).toBeVisible(); };

test.describe("R2.6 filters by group and room", () => {
  test("the button opens a list: four groups and the rooms that have an onset, all on", async ({ page }) => {
    await boot(page);
    await expect(menu(page)).toHaveCount(0);
    await expect(filter(page)).toHaveAttribute("aria-expanded", "false");
    await openList(page);
    await expect(filter(page)).toHaveAttribute("aria-expanded", "true");
    expect(await card(page).locator("css=.fp-rp-menu [data-g]").evaluateAll((e) => e.map((x) => [x.getAttribute("data-g"), x.textContent, x.getAttribute("aria-pressed")])))
      .toEqual([["lamp", "Lights", "true"], ["motion", "Motion", "true"], ["opening", "Doors and windows", "true"], ["alarm", "Alarm", "true"]]);
    // The demo has a Reading corner (a zone) and more rooms; only the three with an onset are listed, in layout order.
    expect(await card(page).locator("css=.fp-rp-menu [data-r]").evaluateAll((e) => e.map((x) => [x.getAttribute("data-r"), x.textContent, x.getAttribute("aria-pressed")])))
      .toEqual([["0", "Living", "true"], ["1", "Kitchen", "true"], ["2", "Hall", "true"]]);
    await click(filter(page)); // a second click on the button closes it
    await expect(menu(page)).toHaveCount(0);
  });

  test("criterion 11: turning off Lights removes the lamp ticks and the lamp jumps; the name of the strip follows", async ({ page }) => {
    await boot(page);
    await expect(ticks(page)).toHaveCount(3); // door, kitchen lamp, living lamp
    await expect(strip(page)).toHaveAttribute("aria-label", "2 lamps, 1 door or window, motion in 1 room");
    await openList(page);
    await click(group(page, "lamp"));
    await expect(group(page, "lamp")).toHaveAttribute("aria-pressed", "false");
    await expect(ticks(page)).toHaveCount(1);
    await expect(strip(page)).toHaveAttribute("aria-label", "1 door or window, motion in 1 room");
    await click(prev(page));
    await expect(range(page)).toHaveValue("1320"); // hall motion
    await click(prev(page));
    await expect(range(page)).toHaveValue("1200"); // 09:20 and 09:00 are skipped
    await expect(prev(page)).toBeDisabled();
    await expect(menu(page)).toHaveCount(0); // the click on a jump button was outside the list
    await openList(page);
    await click(group(page, "lamp"));
    await expect(ticks(page)).toHaveCount(3);
    await click(next(page));
    await expect(range(page)).toHaveValue("1260"); // the lamps are back as jumps
  });

  test("criterion 11: a door between two rooms stays while either is on; an event with no room needs every room on", async ({ page }) => {
    // A lamp standing in no room (far outside the plan) at 10:30: the one onset without a room.
    const layout = LAYOUT();
    layout.floors.ground.devices.push({ id: "light-out", type: "light", entity: "light.outside", name: "Outside", x: 5000, y: 5000 });
    await boot(page, { layout, rows: { ...ROWS(), "light.outside": [{ s: "off", a: {}, lu: START }, { s: "on", a: {}, lu: secs(10, 30) }] } });
    await expect(ticks(page)).toHaveCount(4);
    await expect(strip(page)).toHaveAttribute("aria-label", "3 lamps, 1 door or window, motion in 1 room");
    await openList(page);
    await expect(card(page).locator("css=.fp-rp-menu [data-r]")).toHaveCount(3); // the outside lamp adds no room to the list
    await click(room(page, 0)); // Living room off: its lamp goes, the door stays (Hall is on); the lamp with no room goes with it
    await expect(ticks(page)).toHaveCount(2); // door, kitchen lamp
    await expect(strip(page)).toHaveAttribute("aria-label", "1 lamp, 1 door or window, motion in 1 room");
    await click(prev(page));
    await expect(range(page)).toHaveValue("1320");
    await click(prev(page));
    await expect(range(page)).toHaveValue("1260"); // 09:20, the living lamp, is skipped
    await click(prev(page));
    await expect(range(page)).toHaveValue("1200"); // the door is still there
    await openList(page);
    await click(room(page, 2)); // Hall off too: the door has no room left on, and the hall motion goes
    await expect(ticks(page)).toHaveCount(1); // kitchen lamp only
    await expect(strip(page)).toHaveAttribute("aria-label", "1 lamp");
    await expect(prev(page)).toBeDisabled(); // standing on 08:00, which is now filtered
    await click(next(page));
    await expect(range(page)).toHaveValue("1260");
    await expect(next(page)).toBeDisabled();
    await openList(page);
    await click(room(page, 0));
    await click(room(page, 2));
    await expect(ticks(page)).toHaveCount(4); // every room on again: the lamp with no room is back
  });

  test("criterion 11: with every group off nothing is left, and the jumps and the name say so", async ({ page }) => {
    await boot(page);
    await openList(page);
    for (const g of ["lamp", "motion", "opening", "alarm"]) await click(group(page, g));
    await expect(ticks(page)).toHaveCount(0);
    await expect(strip(page)).toHaveAttribute("aria-label", "No events");
    await expect(prev(page)).toBeDisabled();
    await expect(next(page)).toBeDisabled();
    await expect(filter(page)).toHaveClass(/fp-rp-filtered/);
  });

  test("criterion 11: the plan is the same with any filter (markup and computed styles)", async ({ page }) => {
    await boot(page);
    await click(prev(page)); // 10:00, the hall motion on the plan
    // The motion pulse is a CSS animation: its computed opacity moves with time. Held at its first frame, only a real change shows.
    const plan = () => card(page).locator("css=svg").first().evaluate((svg) => {
      for (const a of svg.getAnimations({ subtree: true })) { a.pause(); a.currentTime = 0; }
      return {
      html: svg.innerHTML,
      styles: [...svg.querySelectorAll("*")].slice(0, 600).map((e) => { const s = getComputedStyle(e); return [s.fill, s.stroke, s.opacity, s.display, s.strokeDasharray].join("|"); }),
      };
    });
    const before = await plan();
    expect(before.styles.length).toBeGreaterThan(50);
    await openList(page);
    for (const g of ["lamp", "motion", "opening", "alarm"]) await click(group(page, g));
    await click(room(page, 0)); await click(room(page, 1)); await click(room(page, 2));
    expect(await plan()).toEqual(before);
    await expect(range(page)).toHaveValue("1320");
  });

  test("a card detached with the list open takes its click listener off the document", async ({ page }) => {
    await boot(page);
    await openList(page);
    // The list added one capture-phase click listener on the document; count the ones taken off while the card goes.
    const removed = await page.evaluate(() => {
      const seen: string[] = [], real = document.removeEventListener.bind(document);
      document.removeEventListener = ((type: string, fn: EventListener, opt?: unknown) => { seen.push(`${type}:${opt === true}`); real(type, fn, opt as boolean); }) as typeof document.removeEventListener;
      document.getElementById("card")!.remove();
      document.removeEventListener = real;
      return seen;
    });
    expect(removed).toContain("click:true");
  });

  test("Escape closes the list first and gives focus back to the button; the next Escape closes the bar", async ({ page }) => {
    await boot(page);
    await openList(page);
    await group(page, "motion").focus();
    await page.keyboard.press("Escape");
    await expect(menu(page)).toHaveCount(0);
    await expect(range(page)).toBeVisible();
    expect(await card(page).locator("css=button.fp-rp-filter").evaluate((b) => b.getRootNode() instanceof ShadowRoot && (b.getRootNode() as ShadowRoot).activeElement === b)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(range(page)).toHaveCount(0);
  });

  test("a click outside the list closes it: on the slider, on the plan, on the page; a click inside does not", async ({ page }) => {
    await boot(page);
    await openList(page);
    await click(group(page, "alarm"));
    await expect(menu(page)).toBeVisible(); // inside
    await click(range(page));
    await expect(menu(page)).toHaveCount(0);
    await openList(page);
    const svg = (await card(page).locator("css=svg").first().boundingBox())!;
    await page.mouse.click(svg.x + svg.width / 2, svg.y + svg.height / 2);
    await expect(menu(page)).toHaveCount(0);
    await openList(page);
    await page.mouse.click(2, 790);
    await expect(menu(page)).toHaveCount(0);
    await expect(group(page, "alarm")).toHaveCount(0);
    await openList(page);
    await expect(group(page, "alarm")).toHaveAttribute("aria-pressed", "false"); // the toggle was kept
  });

  test("the keyboard reaches the list: Tab from the button, Space toggles", async ({ page }) => {
    await boot(page);
    await filter(page).focus();
    await page.keyboard.press("Enter");
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Space"); // Lights
    await expect(group(page, "lamp")).toHaveAttribute("aria-pressed", "false");
    await expect(ticks(page)).toHaveCount(1);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab"); // the first room
    await page.keyboard.press("Enter");
    await expect(room(page, 0)).toHaveAttribute("aria-pressed", "false");
  });

  test("criterion 12: a room named like markup is text in the list and its tooltip; no script runs", async ({ page }) => {
    const layout = LAYOUT();
    layout.floors.ground.rooms[0].name = "\"><script>window.__x=1</script>";
    await boot(page, { layout });
    await openList(page);
    const evil = "\"><script>window.__x=1</script>";
    await expect(room(page, 0)).toHaveText(evil);
    await expect(room(page, 0)).toHaveAttribute("title", evil);
    expect(await card(page).locator("css=script").count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __x?: number }).__x)).toBeUndefined();
  });

  test("CSS pair (finding 10): a pressed toggle is inked, an off one is not; the list floats above the bar and takes no room from the slider", async ({ page }) => {
    await boot(page);
    const sliderBefore = (await range(page).boundingBox())!;
    await openList(page);
    await click(group(page, "lamp"));
    const seen = await card(page).locator("css=.fp-replay").evaluate((bar) => {
      const probe = (v: string) => { const p = document.createElement("i"); p.style.background = `var(${v})`; bar.appendChild(p); const c = getComputedStyle(p).backgroundColor; p.remove(); return c; };
      const bg = (s: string) => getComputedStyle(bar.querySelector(s)!).backgroundColor;
      const m = getComputedStyle(bar.querySelector(".fp-rp-menu")!);
      return { off: bg("[data-g=lamp]"), on: bg("[data-g=motion]"), ink: probe("--fp-ink"), room: probe("--fp-room"), pos: m.position, menuBg: m.backgroundColor };
    });
    expect(seen.on).toBe(seen.ink);
    expect(seen.off).toBe(seen.room);
    expect(seen.pos).toBe("absolute");
    expect(seen.menuBg).toBe(seen.room);
    const sliderAfter = (await range(page).boundingBox())!;
    expect(sliderAfter).toEqual(sliderBefore);
    const m = (await menu(page).boundingBox())!, bar = (await card(page).locator("css=.fp-replay").boundingBox())!;
    expect(m.y + m.height).toBeLessThanOrEqual(bar.y + 1); // above the bar, over the plan
  });

  test("a narrow card (380 px): the button is on row one, the slider keeps its room, the list stays inside the card", async ({ page }) => {
    const layout = LAYOUT();
    layout.floors.ground.rooms[1].name = "A very long room name that would not fit on one line of a phone-sized card at all";
    await boot(page, { width: 380, layout });
    const bar = (await card(page).locator("css=.fp-replay").boundingBox())!;
    const f = (await filter(page).boundingBox())!, time = (await card(page).locator("css=.fp-rp-time").boundingBox())!;
    expect(f.y).toBeLessThan((await prev(page).boundingBox())!.y); // row one, with the time
    expect(Math.abs(f.y - time.y)).toBeLessThan(20);
    expect(f.x + f.width).toBeLessThanOrEqual(bar.x + bar.width);
    expect((await range(page).boundingBox())!.width).toBeGreaterThan(80);
    await openList(page);
    const m = (await menu(page).boundingBox())!;
    expect(m.x).toBeGreaterThanOrEqual(bar.x);
    expect(m.x + m.width).toBeLessThanOrEqual(bar.x + bar.width);
    expect(await card(page).locator("css=.fp-replay").evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(0);
    expect(await menu(page).evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(0);
    expect((await range(page).boundingBox())!.width).toBeGreaterThan(80);
  });
});
