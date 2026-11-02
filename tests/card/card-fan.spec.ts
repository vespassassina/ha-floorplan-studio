import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { cardSource } from "../../scripts/card-source.mjs";

// S33.2 (docs/specs/extras-s33.md, X1, criteria 3 and 4): a real click on a fan's icon opens its popup, Turn on and Turn off
// call fan.turn_on and fan.turn_off (OFF asks first), a fan that reports `percentage` and SET_SPEED gets a speed slider whose
// release is one fan.set_percentage, and the floor's checklist lists a fan that is on under Fans. Every click and drag is a
// real page.mouse event on the real top element (CLAUDE.md finding 3).
// Home Assistant's fan attributes (core fan/__init__.py): percentage 0-100, percentage_step, supported_features (SET_SPEED = 1).

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = cardSource(); // the card with its Overview chunk inlined (scripts/card-source.mjs)
const FAN = 6; // first floor: the demo's Bedroom fan, fan.demo_bedroom

const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-04T09:30:15Z" });
const SPEED = { percentage: 40, percentage_step: 1, supported_features: 1 };

async function boot(page: Page, fan: unknown, extra: Record<string, unknown> = {}, fold = true) {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(([config, states]) => {
    const w = window as unknown as { __calls: string[] };
    w.__calls = [];
    const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(config);
    el.hass = { states, callService: (d: string, s: string, data: Record<string, unknown>) => { w.__calls.push(`${d}.${s} ${JSON.stringify(data)}`); } };
    return el.updateComplete;
  }, [{ layout: structuredClone(demo), floor: "first", ...extra }, { "fan.demo_bedroom": fan, "light.demo_bedroom": st("off") }] as const);
  if (fold) await card(page).evaluate((el) => el.shadowRoot!.querySelector<HTMLButtonElement>(".fp-active-collapse[aria-expanded=true]")?.click());
}
const card = (page: Page) => page.locator("floorplan-studio-card");
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: string[] }).__calls);
const pop = (page: Page) => card(page).locator("css=.fp-pop");
const speed = (page: Page) => pop(page).locator('css=input[aria-label="Speed"]');

async function tapFan(page: Page) {
  const p = await card(page).evaluate((el, i) => {
    const g = el.shadowRoot!.querySelector<SVGGElement>(`svg g[data-x="${i}"]`)!;
    const r = g.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2, top = el.shadowRoot!.elementFromPoint(x, y);
    return { x, y, top: top ? `${top.tagName}.${top.getAttribute("class") ?? ""}` : "none", hit: !!top?.closest(`g[data-x="${i}"]`) };
  }, FAN);
  expect(p.hit, `the fan is the top element at its centre (top: ${p.top})`).toBe(true);
  await page.mouse.click(p.x, p.y);
}
const parsed = async (page: Page) => (await calls(page)).map((c) => ({ call: c.slice(0, c.indexOf(" ")), data: JSON.parse(c.slice(c.indexOf(" ") + 1)) }));

test.describe("S33.2 fan popup", () => {
  test("a real tap opens the fan's popup; Turn on is one fan.turn_on", async ({ page }) => {
    await boot(page, st("off"));
    await tapFan(page);
    await expect(pop(page)).toHaveAttribute("aria-label", "Bedroom fan");
    await expect(pop(page).locator("css=.fp-pop-do")).toHaveText("Turn on");
    expect(await calls(page)).toEqual([]);
    await pop(page).locator("css=.fp-pop-do").click();
    expect(await parsed(page)).toEqual([{ call: "fan.turn_on", data: { entity_id: "fan.demo_bedroom" } }]);
  });

  test("Turn off asks first, then is one fan.turn_off", async ({ page }) => {
    await boot(page, st("on"));
    await tapFan(page);
    await expect(pop(page).locator("css=.fp-pop-do")).toHaveText("Turn off");
    await pop(page).locator("css=.fp-pop-do").click();
    await expect(pop(page).locator("css=.fp-pop-do")).toHaveText("Confirm turn off");
    expect(await calls(page)).toEqual([]);
    await pop(page).locator("css=.fp-pop-do").click();
    expect(await parsed(page)).toEqual([{ call: "fan.turn_off", data: { entity_id: "fan.demo_bedroom" } }]);
  });

  test("a fan with percentage 40 and SET_SPEED shows a slider at 40; a drag to about 70 and release is exactly one fan.set_percentage", async ({ page }) => {
    await boot(page, st("on", SPEED));
    await tapFan(page);
    await expect(speed(page)).toHaveCount(1);
    await expect(speed(page)).toHaveValue("40");
    await expect(speed(page)).toHaveAttribute("min", "0");
    await expect(speed(page)).toHaveAttribute("max", "100");
    const box = (await speed(page).boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height / 2, { steps: 6 });
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2, { steps: 6 });
    expect(await calls(page), "nothing is sent while dragging").toEqual([]);
    await page.mouse.up();
    const got = await parsed(page);
    expect(got).toHaveLength(1);
    expect(got[0]!.call).toBe("fan.set_percentage");
    expect(Object.keys(got[0]!.data).sort()).toEqual(["entity_id", "percentage"]);
    expect(got[0]!.data.entity_id).toBe("fan.demo_bedroom");
    const value = Number(await speed(page).inputValue());
    expect(got[0]!.data.percentage, "the value the slider shows under the pointer").toBe(value);
    expect(value).toBeGreaterThan(62); // asymmetric to the 40 it started at
    expect(value).toBeLessThan(78);
  });

  test("percentage_step sets the slider's step", async ({ page }) => {
    await boot(page, st("on", { ...SPEED, percentage_step: 33.333333333333336 }));
    await tapFan(page);
    await expect(speed(page)).toHaveAttribute("step", "33.333333333333336");
  });

  test("a fan without SET_SPEED, or without a percentage, has no slider and still has its button", async ({ page }) => {
    for (const attrs of [{ percentage: 40, supported_features: 0 }, { supported_features: 1 }, { percentage: 40 }]) {
      await boot(page, st("on", attrs));
      await tapFan(page);
      await expect(pop(page).locator("css=.fp-pop-do")).toHaveText("Turn off");
      await expect(speed(page), JSON.stringify(attrs)).toHaveCount(0);
    }
  });

  test("junk percentage and attributes never throw: no slider, or one clamped to 0..100", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const junk: [Record<string, unknown>, string | null][] = [
      [{ percentage: "40", supported_features: 1 }, null],
      [{ percentage: NaN, supported_features: 1 }, null],
      [{ percentage: null, supported_features: 1 }, null],
      [{ percentage: 140, supported_features: 1 }, "100"],
      [{ percentage: -5, supported_features: 1 }, "0"],
      [{ percentage: 40, supported_features: "1" }, null],
      [{ percentage: 40, supported_features: 1, percentage_step: "x" }, "40"],
      [{ percentage: 40, supported_features: 1, percentage_step: 0 }, "40"],
    ];
    for (const [attrs, want] of junk) {
      await boot(page, st("on", attrs));
      await tapFan(page);
      await expect(pop(page)).toBeVisible();
      if (want === null) await expect(speed(page), JSON.stringify(attrs)).toHaveCount(0);
      else await expect(speed(page), JSON.stringify(attrs)).toHaveValue(want);
    }
    const step = await speed(page).getAttribute("step");
    expect(step).toBe("1");
    expect(errors).toEqual([]);
  });

  test("Turn off on this floor lists a fan that is on under Fans and turns it off with the rest", async ({ page }) => {
    await boot(page, st("on", SPEED), {}, false); // the checklist button lives in the Overview
    const b = card(page).locator("css=.fp-floor-off");
    const r = (await b.boundingBox())!;
    expect(await card(page).evaluate((el, [x, y]) => !!el.shadowRoot!.elementFromPoint(x!, y!)?.closest(".fp-floor-off"), [r.x + r.width / 2, r.y + r.height / 2] as const)).toBe(true);
    await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
    const dialog = card(page).locator("css=.fp-off-dialog");
    await expect(dialog.locator("css=legend")).toHaveText(["Fans · 1"]);
    await expect(dialog.locator('css=.fp-off-row[data-entity="fan.demo_bedroom"]')).toContainText("Bedroom fan");
    await dialog.locator("css=button.confirm").click();
    // floorOffCalls sends anything but light, switch and media_player through homeassistant.turn_off, which Home Assistant routes to the fan.
    expect(await parsed(page)).toEqual([{ call: "homeassistant.turn_off", data: { entity_id: ["fan.demo_bedroom"] } }]);
  });
});
