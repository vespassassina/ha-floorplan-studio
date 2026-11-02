import { test, expect, type Page, type Route } from "@playwright/test";
import { demo, serve, ORIGIN, card } from "./helpers-3d";

// B52.2 (docs/specs/batch-s52.md items 13 and 14, criterion 1): the Overview (the side sheet, the phone's bottom sheet) is a lazy
// chunk beside the card, fetched the first time the card has a layout to show. It is served here the way Home Assistant serves the card
// (helpers-3d: a fake origin, the built www/ files), so the card finds the chunk from its own URL.
//   - while the chunk loads the panel slot is empty, and the plan does not move when the panel arrives;
//   - a failed fetch is asked for again under a new query (a browser keeps a failed import() of one URL), a few times, 1 s apart;
//   - after the last failure the card works without the Overview and says so.
// Real clicks at real coordinates (CLAUDE.md finding 3). No test adds a wait: the retries run on the card's own timer and the tests
// poll for what they expect.

const CHUNK = /floorplan-studio-overview-[\w-]+\.js/;
const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-04T09:30:15Z" });
// Shapes as in tests/card/card-categories.spec.ts: two lights on, so the Active list has rows.
const STATES = () => ({ "light.demo_living": st("on", { supported_color_modes: ["onoff"] }), "light.demo_kitchen": st("on", { supported_color_modes: ["onoff"] }) });

interface Boot { reply: (route: Route, hit: number) => Promise<void>; width?: number }

/** Boots the card with `reply` answering each request for the chunk; `hit` counts from 0. Returns the URLs asked for. */
async function boot(page: Page, o: Boot) {
  await serve(page);
  const asked: string[] = [];
  await page.route(CHUNK, (route) => { asked.push(route.request().url()); return o.reply(route, asked.length - 1); });
  await page.goto(`${ORIGIN}/harness.html`);
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  if (o.width) await page.evaluate((w) => { document.getElementById("wrap")!.style.width = `${w}px`; }, o.width);
  await page.evaluate(([layout, states]) => {
    const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig({ layout, floor: "ground" });
    el.hass = { states, callService: () => undefined };
    return el.updateComplete;
  }, [structuredClone(demo), STATES()] as const);
  return { asked };
}

/** A state update, as Home Assistant sends one: the card re-renders. */
const update = (page: Page) => page.evaluate(async (s) => {
  const el = document.getElementById("card") as unknown as { hass: unknown; updateComplete: Promise<unknown> };
  el.hass = { states: s, callService: () => undefined };
  await el.updateComplete;
}, STATES());
const panel = (page: Page) => card(page).locator("css=.fp-active");
const plan = (page: Page) => card(page).locator("css=svg").first();
const errorsOf = (page: Page) => { const e: string[] = []; page.on("pageerror", (x) => e.push(String(x))); return e; };

for (const [name, width] of [["side sheet", 900], ["bottom sheet", 400]] as const) {
  test(`${name}: nothing is drawn for the panel while the chunk loads, the plan does not move when it arrives, and the chunk is asked for once`, async ({ page }) => {
    let open!: () => void;
    const gate = new Promise<void>((r) => { open = r; });
    const { asked } = await boot(page, { width, reply: async (route) => { await gate; return route.fallback(); } });
    await expect.poll(() => asked.length).toBe(1); // the card asked for it: the panel is the chunk's now
    await expect(plan(page)).toBeVisible();
    // Another render while the chunk is on its way (a state update) must not ask again, nor draw anything for the panel.
    await update(page);
    expect(await panel(page).count(), "no panel markup before the chunk is there").toBe(0);
    expect(await card(page).locator("css=.fp-rail-open, .fp-handle, .fp-active-body").count()).toBe(0);
    const before = await plan(page).boundingBox();
    open();
    await expect(panel(page)).toHaveCount(1);
    const after = await plan(page).boundingBox();
    expect(after, "the plan keeps its box when the panel arrives").toEqual(before);
    expect(asked, asked.join(" ")).toHaveLength(1);
    expect(asked[0]).not.toContain("?"); // the first try is the plain import
  });
}

test("a failed first fetch is asked for again under a new query, and the Overview appears", async ({ page }) => {
  const errors = errorsOf(page);
  const { asked } = await boot(page, { reply: (route, hit) => (hit === 0 ? route.fulfill({ status: 503, body: "" }) : route.fallback()) });
  await expect(panel(page)).toHaveCount(1);
  expect(asked, asked.join(" ")).toHaveLength(2);
  expect(asked[1]).toMatch(/floorplan-studio-overview-[\w-]+\.js\?r=1$/);
  expect(errors).toEqual([]);
});

test("when every try fails the card works without the Overview, says why, and stops asking", async ({ page }) => {
  const errors = errorsOf(page);
  const { asked } = await boot(page, { reply: (route) => route.fulfill({ status: 503, body: "" }) });
  await expect(card(page).locator("css=.fp-3d-note")).toContainText(/Overview unavailable/, { timeout: 10000 });
  expect(asked.map((u) => /\?r=(\d)$/.exec(u)?.[1] ?? "plain"), asked.join(" ")).toEqual(["plain", "1", "2"]);
  expect(await panel(page).count()).toBe(0);
  // The card still works: a state update neither throws nor asks again, and a real click on a device icon opens its popup.
  await update(page);
  expect(asked).toHaveLength(3);
  await card(page).locator('css=svg g[data-x="0"]').click();
  await expect(card(page).locator("css=.fp-pop")).toBeVisible();
  expect(errors).toEqual([]);
});

// On a phone the popup is the bottom sheet's Device level, which the chunk draws. A tap before the chunk is there, or after it failed
// for good, must still show the popup: the card draws it itself then.
for (const [name, reply] of [["while the chunk is not there yet", "hold"], ["after every try failed", "fail"]] as const) {
  test(`phone width, ${name}: a real tap on a device still shows its popup, inside the card`, async ({ page }) => {
    let open!: () => void;
    const gate = new Promise<void>((r) => { open = r; });
    const { asked } = await boot(page, { width: 400, reply: async (route) => (reply === "fail" ? route.fulfill({ status: 503, body: "" }) : (await gate, route.fallback())) });
    if (reply === "fail") await expect(card(page).locator("css=.fp-3d-note")).toContainText(/Overview unavailable/, { timeout: 10000 });
    else await expect.poll(() => asked.length).toBe(1);
    await card(page).locator('css=svg g[data-x="0"]').click();
    const pop = card(page).locator("css=.fp-pop");
    await expect(pop).toBeVisible();
    const [box, host] = await Promise.all([pop.boundingBox(), page.locator("#wrap").boundingBox()]);
    expect(box!.y + box!.height, "the popup is inside the card, not below it").toBeLessThanOrEqual(host!.y + host!.height + 1);
    open();
  });
}
