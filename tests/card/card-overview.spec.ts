import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// S24.7: the card's Overview sheet on the stress house (three floors, 437 devices). Every click is a real page.mouse click at
// a point checked to be the real top element (CLAUDE.md finding 3). The hass stub has the shape Home Assistant's frontend
// gives a card: `states` keyed by entity id, each with state, attributes and last_changed (finding 21).

const layout = JSON.parse(readFileSync("tests/fixtures/stress-layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");

const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-08T09:30:15Z" });
// Lights on on every floor, and the attention state counted by hand in tests/core/attention.test.ts (ground: alarm triggered,
// 9 things; first: 2 things here, the leak sensor is not in the fixture; second: 1). The Living floor lamp's own light is off
// and its relay on: the plan draws it lit (S22.1).
const STATES = () => ({
  "light.living_floor_lamp": st("off", { friendly_name: "Living floor lamp" }), "switch.living_relay_1": st("on", { friendly_name: "Living relay 1" }),
  "light.kitchen_spot_1": st("on", { brightness: 128 }),
  "light.study_desk_lamp": st("on"), "light.landing_wall_light": st("on"),
  "light.library_spot_1": st("on"),
  "alarm_control_panel.home": st("triggered"),
  "binary_sensor.living_window_1_contact": st("on"), "lock.living_patio_door": st("locked"),
  "cover.garage_door": st("open"), "binary_sensor.mailbox": st("on"),
  "cover.driveway_gate": st("open", { device_class: "gate" }),
  "lock.cloakroom_cabinet": st("unlocked", { battery_level: 12 }),
  "binary_sensor.front_door_contact": st("off", { battery_level: 9 }), "lock.kitchen_patio_door": st("locked", { battery_level: 14 }),
  "lock.front_door": st("locked"), "lock.front_door_deadbolt": st("unlocked"), "lock.garage_side_door": st("unlocked"),
  "camera.garage": st("unavailable"), "light.living_spot_1": st("unavailable"),
  "binary_sensor.master_bedroom_window_1_contact": st("on"), "binary_sensor.study_window_1_contact": st("off", { battery_level: 11 }),
  "binary_sensor.library_window_1_contact": st("on"),
});

async function boot(page: Page, config: Record<string, unknown>, size = { width: 1280, height: 900 }) {
  await page.setViewportSize(size);
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(
    ([cfg, s]) => {
      try { localStorage.clear(); } catch { /* file: origin without storage */ }
      const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
      el.setConfig(cfg);
      el.hass = { states: s, callService: () => {} };
      return el.updateComplete;
    },
    [{ layout, theme: "light", ...config }, STATES()] as const,
  );
}
const card = (page: Page) => page.locator("floorplan-studio-card");
const pop = (page: Page) => card(page).locator("css=.fp-pop");
const pills = (page: Page) => card(page).locator("css=.fp-floors button");
const rows = (page: Page) => card(page).locator("css=.fp-active .fp-active-row");

/** Re-sends hass with fresh state objects, as Home Assistant does on every change. */
const rehass = (page: Page) => card(page).evaluate((el, s) => { (el as unknown as { hass: unknown }).hass = { states: s, callService: () => {} }; return (el as unknown as { updateComplete: Promise<unknown> }).updateComplete; }, STATES());

/** A point on `sel` (inside the card's shadow root, scrolled into view) where it, or a descendant, is the real top element. */
async function topPoint(page: Page, sel: string) {
  const p = await card(page).evaluate((el, sel) => {
    const t = el.shadowRoot!.querySelector(sel);
    if (!t) return null;
    t.scrollIntoView({ block: "center" });
    const r = t.getBoundingClientRect();
    for (let a = 1; a < 8; a++) for (let b = 1; b < 8; b++) {
      const x = r.x + (r.width * a) / 8, y = r.y + (r.height * b) / 8, top = el.shadowRoot!.elementFromPoint(x, y);
      if (top && (top === t || t.contains(top))) return { x, y };
    }
    return null;
  }, sel);
  expect(p, `${sel} is the top element somewhere on its box`).not.toBeNull();
  return p!;
}
const clickOn = async (page: Page, sel: string) => { const p = await topPoint(page, sel); await page.mouse.click(p.x, p.y); };

test.describe("S24.7 the Overview sheet", () => {
  test("a floor: ground card lists ground only: Attention first, then Active, with count chips in the header", async ({ page }) => {
    await boot(page, { floor: "ground" });
    const panel = card(page).locator("css=.fp-active");
    await expect(panel).toHaveAttribute("aria-label", "Overview");
    const floors = await rows(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-floor")));
    expect(floors.length).toBeGreaterThan(5);
    expect(new Set(floors)).toEqual(new Set(["ground"]));
    const entities = await rows(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-entity")));
    expect(entities).toContain("light.kitchen_spot_1");
    expect(entities).not.toContain("light.study_desk_lamp");
    expect(entities).not.toContain("binary_sensor.library_window_1_contact");
    // Attention before Active, most severe first; each Attention row says how long.
    const sections = await panel.locator("css=.fp-ov-section > .fp-ov-head").allTextContents();
    expect(sections.map((s) => s.replace(/\s+/g, " ").trim())).toEqual(["Attention · 11", "Active · 2"]);
    const first = panel.locator("css=.fp-ov-attn .fp-active-row").first();
    await expect(first).toHaveAttribute("data-entity", "alarm_control_panel.home");
    await expect(first.locator("css=.fp-row-state")).toHaveText(/^triggered · (\d+ (min|h|d)|now)$/);
    // CSS pair (finding 10): the age never breaks across lines ("3" / "min" read as two things in the 200 px panel).
    expect(await first.locator("css=.fp-ov-age").evaluate((e) => getComputedStyle(e).whiteSpace)).toBe("nowrap");
    // What is in Attention is not repeated in Active: the alarm, the gate, the mailbox and the patio door's contact are
    // on, but listed once, above. Active is the two lamps. The header counts both, short.
    expect(entities.filter((e) => e === "binary_sensor.mailbox")).toHaveLength(1);
    await expect(panel.locator("css=.fp-active-head .fp-ov-chips")).toHaveText("11 alerts · 2 lights"); // what is wrong first, so a folded header keeps it
    // A pinned card shows no floor badge on its rows; All floors lists the other floors too, each with its badge.
    await expect(panel.locator("css=.fp-row-floor")).toHaveCount(0);
    await clickOn(page, ".fp-ov-scope");
    await expect(card(page).locator("css=.fp-ov-scope")).toHaveAttribute("aria-pressed", "true");
    const all = await rows(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-floor")));
    expect(new Set(all)).toEqual(new Set(["ground", "first", "second"]));
    await expect(panel.locator('css=.fp-active-row[data-entity="light.study_desk_lamp"] .fp-row-floor')).toHaveText("First");
  });

  test("All floors: a row tap on another floor's device switches floor, pans to it, pulses it and opens its popup", async ({ page }) => {
    await boot(page, {});
    await expect(pills(page).nth(0)).toHaveAttribute("aria-pressed", "true");
    await clickOn(page, ".fp-ov-scope");
    await clickOn(page, '.fp-active-row[data-entity="light.study_desk_lamp"]');
    await expect(pills(page).nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect(pop(page)).toHaveAttribute("aria-label", "Study desk lamp");
    // Panned: zoomed in, the lamp near the middle of the plan.
    await expect(card(page).locator("css=svg.fp-zoomed")).toHaveCount(1);
    const at = await card(page).evaluate((el) => {
      const svg = el.shadowRoot!.querySelector("svg.fp-zoomable")!.getBoundingClientRect();
      const g = el.shadowRoot!.querySelector('svg g[data-x="95"]')!.getBoundingClientRect();
      const ring = el.shadowRoot!.querySelector(".fp-pulse")?.getBoundingClientRect() ?? null;
      return { dx: (g.x + g.width / 2 - (svg.x + svg.width / 2)) / svg.width, dy: (g.y + g.height / 2 - (svg.y + svg.height / 2)) / svg.height, g: { x: g.x + g.width / 2, y: g.y + g.height / 2 }, ring: ring && { x: ring.x + ring.width / 2, y: ring.y + ring.height / 2, w: ring.width } };
    });
    expect(Math.abs(at.dx)).toBeLessThan(0.1);
    expect(Math.abs(at.dy)).toBeLessThan(0.1);
    // The pulse ring sits on the lamp's icon.
    expect(at.ring).not.toBeNull();
    expect(Math.hypot(at.ring!.x - at.g.x, at.ring!.y - at.g.y)).toBeLessThan(4);
    expect(at.ring!.w).toBeGreaterThan(10);
  });

  test("a relay-lit lamp's row reads on, via the relay (S22.F4)", async ({ page }) => {
    await boot(page, { floor: "ground" });
    await expect(card(page).locator('css=.fp-active .fp-active-row[data-entity="light.living_floor_lamp"] .fp-row-state')).toHaveText("on · via Living relay 1");
  });

  test("floor tabs read the floor's attention count and turn --fp-warn on an alarm", async ({ page }) => {
    await boot(page, {});
    await expect(pills(page)).toHaveText(["Ground · 9", "First · 2", "Second · 1"]);
    const colours = await card(page).evaluate((el) => {
      const warn = getComputedStyle(el).getPropertyValue("--fp-warn").trim();
      const probe = document.createElement("span");
      probe.style.color = warn;
      el.shadowRoot!.appendChild(probe);
      const want = getComputedStyle(probe).color;
      probe.remove();
      const [g, f] = [...el.shadowRoot!.querySelectorAll<HTMLElement>(".fp-floors button")];
      return { want, ground: getComputedStyle(g!).borderColor, groundBadge: getComputedStyle(g!.querySelector(".fp-floor-count")!).backgroundColor, firstBadge: getComputedStyle(f!.querySelector(".fp-floor-count")!).backgroundColor, first: getComputedStyle(f!).borderColor };
    });
    // Opus review CSS pair (finding 10): the alarm pill wears the warn colour, border and count badge; the plain one neither.
    expect(colours.ground).toBe(colours.want);
    expect(colours.groundBadge).toBe(colours.want);
    expect(colours.first).not.toBe(colours.want);
    expect(colours.firstBadge).not.toBe(colours.want);
  });

  test("no row has a details chevron; the popup holds the details instead", async ({ page }) => {
    await boot(page, {});
    await expect(card(page).locator("css=.fp-info-btn")).toHaveCount(0);
    await clickOn(page, '.fp-active-row[data-entity="light.kitchen_spot_1"]');
    await expect(pop(page)).toHaveAttribute("aria-label", "Kitchen spot 1");
    await clickOn(page, ".fp-pop-info summary");
    await expect(pop(page).locator("css=.fp-pop-info dd").filter({ hasText: "light.kitchen_spot_1" })).toHaveCount(1);
    // The floor's panel (its device rows) has no chevrons either.
    await page.keyboard.press("Escape");
    await expect(pop(page)).toHaveCount(0);
    await clickOn(page, ".fp-floors button");
    await expect(card(page).locator("css=.fp-room-devices .fp-active-row").first()).toBeVisible();
    await expect(card(page).locator("css=.fp-info-btn")).toHaveCount(0);
  });

  test("a hass update keeps the scope, a folded category and the open popup", async ({ page }) => {
    await boot(page, {});
    await clickOn(page, ".fp-ov-scope");
    await clickOn(page, '.fp-active-group[data-cat="lights"] .fp-cat');
    await expect(card(page).locator('css=.fp-active-group[data-cat="lights"] .fp-cat')).toHaveAttribute("aria-expanded", "false");
    await clickOn(page, '.fp-ov-attn .fp-active-row[data-entity="lock.garage_side_door"]');
    await expect(pop(page)).toHaveAttribute("aria-label", "Garage side door");
    await rehass(page);
    await rehass(page);
    await expect(card(page).locator("css=.fp-ov-scope")).toHaveAttribute("aria-pressed", "true");
    await expect(card(page).locator('css=.fp-active-group[data-cat="lights"] .fp-cat')).toHaveAttribute("aria-expanded", "false");
    await expect(pop(page)).toHaveAttribute("aria-label", "Garage side door");
  });

  test("folded at phone width, the header is one line that still shows the alerts first (computed style pair)", async ({ page }) => {
    await boot(page, { floor: "ground" }, { width: 390, height: 844 });
    await expect(card(page).locator("css=.fp-active-collapse")).toHaveAttribute("aria-expanded", "false"); // below 480 px it starts folded
    const head = await card(page).locator("css=.fp-active-head").evaluate((h) => {
      const chips = h.querySelector<HTMLElement>(".fp-ov-chips")!, first = chips.querySelector<HTMLElement>(".fp-chip")!;
      const cs = getComputedStyle(chips), r = h.getBoundingClientRect(), f = first.getBoundingClientRect(), c = chips.getBoundingClientRect();
      return { h: r.height, wrap: getComputedStyle(h).flexWrap, ws: cs.whiteSpace, ellipsis: cs.textOverflow, first: first.textContent, firstShown: f.right <= c.right + 0.5, crumb: getComputedStyle(h.querySelector(".fp-crumb")!).display };
    });
    expect(head.wrap).toBe("nowrap");
    expect(head.ws).toBe("nowrap");
    expect(head.ellipsis).toBe("ellipsis");
    expect(head.crumb).toBe("none");
    expect(head.h, "one line: no taller than the header was before S24.7").toBeLessThanOrEqual(32);
    expect(head.first).toBe("11 alerts");
    expect(head.firstShown, "the alerts chip is not cut").toBe(true);
  });
});
