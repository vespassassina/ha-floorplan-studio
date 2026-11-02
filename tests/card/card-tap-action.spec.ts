import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { cardSource } from "../../scripts/card-source.mjs";

// S33.4, spec X2, criteria 5 to 7: the card's `tap_action` and `hold_action` for device icons. Every click and hold is a
// real page.mouse event at the centre of an icon checked to be the real top element there (CLAUDE.md finding 3); the hold
// is a real 600 ms press. `hass.callService` and `hass-more-info` are recorded, as in card-popup.spec.ts.

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = cardSource(); // the card with its Overview chunk inlined (scripts/card-source.mjs)

const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-04T09:30:15Z" });
// ground devices: 0 living light (on), 1 kitchen light, 2 hall switch (off), 3 TV plug (on), 4 temperature sensor,
// 6 camera, 7 heater (climate, no position), 8 to 11 stacked at one spot. Door 0 is the front door.
const STATES = () => ({
  "light.demo_living": st("on", { friendly_name: "Living light", supported_color_modes: ["onoff"] }),
  "light.demo_kitchen": st("off", { supported_color_modes: ["onoff"] }),
  "switch.demo_hall": st("off"), "switch.demo_tv_plug": st("on"),
  "sensor.demo_living_temperature": st("21.5", { unit_of_measurement: "°C" }),
  "camera.demo_hall": st("idle"), "climate.demo_living": st("heat"),
  "binary_sensor.demo_front_door": st("off"),
  "lock.demo_front": st("locked"), "cover.demo_garage": st("closed"), "siren.demo_alarm": st("off"),
  "fan.demo_ceiling": st("off"), "automation.demo_night": st("off"),
});

async function boot(page: Page, extra: Record<string, unknown> = {}) {
  const warns: string[] = [];
  page.on("console", (m) => { if (m.type() === "warning") warns.push(m.text()); });
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto(URL_);
  const layout = structuredClone(demo);
  // S33 review: devices 12 to 16 are a lock, a cover, a siren, a fan and an automation, the entities `toggle` must not act on blind.
  layout.floors.ground.devices.push(
    { id: "lock-x", type: "lock", entity: "lock.demo_front", name: "Front lock", x: 300, y: 420 },
    { id: "cover-x", type: "cover", entity: "cover.demo_garage", name: "Garage", x: 450, y: 380 },
    { id: "siren-x", type: "siren", entity: "siren.demo_alarm", name: "Siren", x: 200, y: 420 },
    { id: "fan-x", type: "fan", entity: "fan.demo_ceiling", name: "Fan", x: 520, y: 420 },
    { id: "auto-x", type: "other", entity: "automation.demo_night", name: "Night", x: 350, y: 330 },
  );
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(([config, states]) => {
    const w = window as unknown as { __calls: string[]; __info: string[] };
    w.__calls = []; w.__info = [];
    const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.addEventListener("hass-more-info", (e) => w.__info.push((e as CustomEvent).detail.entityId));
    el.setConfig(config);
    el.hass = { states, callService: (d: string, s: string, data: Record<string, unknown>) => { w.__calls.push(`${d}.${s} ${JSON.stringify(data)}`); } };
    return el.updateComplete;
  }, [{ layout, floor: "ground", ...extra }, STATES()] as const);
  await card(page).evaluate((el) => el.shadowRoot!.querySelector<HTMLButtonElement>(".fp-active-collapse[aria-expanded=true]")?.click());
  return warns;
}
const card = (page: Page) => page.locator("floorplan-studio-card");
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: string[] }).__calls);
const infos = (page: Page) => page.evaluate(() => (window as unknown as { __info: string[] }).__info);
const pop = (page: Page) => card(page).locator("css=.fp-pop");

async function point(page: Page, sel: string) {
  const p = await card(page).evaluate((el, sel) => {
    const g = el.shadowRoot!.querySelector<SVGGraphicsElement>(sel)!;
    const r = g.getBoundingClientRect();
    let x = r.x + r.width / 2, y = r.y + r.height / 2, top = el.shadowRoot!.elementFromPoint(x, y);
    for (let a = 1; a < 8 && !top?.closest(sel); a++) for (let b = 1; b < 8 && !top?.closest(sel); b++) {
      x = r.x + (r.width * a) / 8; y = r.y + (r.height * b) / 8; top = el.shadowRoot!.elementFromPoint(x, y);
    }
    return { x, y, hit: !!top?.closest(sel), top: top?.tagName ?? "none" };
  }, sel);
  expect(p.hit, `${sel} is the top element at its point (top: ${p.top})`).toBe(true);
  return p;
}
const iconPoint = (page: Page, i: number) => point(page, `svg g[data-x="${i}"]`);
const tapIcon = async (page: Page, i: number) => { const p = await iconPoint(page, i); await page.mouse.click(p.x, p.y); };
const holdIcon = async (page: Page, i: number) => {
  const p = await iconPoint(page, i);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.waitForTimeout(650); // a real hold: HOLD_MS is 500
  await page.mouse.up();
};

test.describe("tap_action: toggle", () => {
  test("an off light turns on at once and opens no popup", async ({ page }) => {
    await boot(page, { tap_action: { action: "toggle" } });
    await tapIcon(page, 1);
    expect(await calls(page)).toEqual(['light.turn_on {"entity_id":"light.demo_kitchen"}']);
    await expect(pop(page)).toHaveCount(0);
  });

  test("an on light turns off at once (a light never asks)", async ({ page }) => {
    await boot(page, { tap_action: { action: "toggle" } });
    await tapIcon(page, 0);
    expect(await calls(page)).toEqual(['light.turn_off {"entity_id":"light.demo_living"}']);
    await expect(pop(page)).toHaveCount(0);
  });

  test("an off switch turns on at once", async ({ page }) => {
    await boot(page, { tap_action: "toggle" }); // the string form of the same action
    await tapIcon(page, 2);
    expect(await calls(page)).toEqual(['switch.turn_on {"entity_id":"switch.demo_hall"}']);
    await expect(pop(page)).toHaveCount(0);
  });

  test("an on plug opens the popup already at Confirm turn off and calls nothing; Confirm then calls turn_off", async ({ page }) => {
    await boot(page, { tap_action: { action: "toggle" } });
    await tapIcon(page, 3);
    await expect(pop(page)).toBeVisible();
    await expect(pop(page).locator("css=.fp-pop-do")).toHaveText("Confirm turn off");
    expect(await calls(page)).toEqual([]);
    await pop(page).locator("css=.fp-pop-do").click();
    expect(await calls(page)).toEqual(['switch.turn_off {"entity_id":"switch.demo_tv_plug"}']);
  });

  // S33 review, blocker: a stray tap must never unlock a door, move a garage door or sound a siren.
  for (const [name, idx, label] of [["a locked lock", 12, "Unlock"], ["a closed cover", 13, "Open"], ["an off siren", 14, "Turn on"]] as const) {
    test(`${name} opens the popup and calls no service`, async ({ page }) => {
      await boot(page, { tap_action: { action: "toggle" } });
      await tapIcon(page, idx);
      await expect(pop(page)).toBeVisible();
      await expect(pop(page).locator("css=.fp-pop-do")).toHaveText(label);
      expect(await calls(page)).toEqual([]);
    });
  }

  test("a fan turns on at once; an automation that is off opens the popup (its Turn on has no confirm) (only light, switch, input_boolean and fan act blind)", async ({ page }) => {
    await boot(page, { tap_action: { action: "toggle" } });
    await tapIcon(page, 15);
    expect(await calls(page)).toEqual(['fan.turn_on {"entity_id":"fan.demo_ceiling"}']);
    await expect(pop(page)).toHaveCount(0);
    await tapIcon(page, 16);
    await expect(pop(page)).toBeVisible();
    expect(await calls(page)).toEqual(['fan.turn_on {"entity_id":"fan.demo_ceiling"}']);
  });

  test("a temperature sensor and a camera open the popup, as without tap_action, and call nothing", async ({ page }) => {
    await boot(page, { tap_action: { action: "toggle" } });
    await tapIcon(page, 4);
    await expect(pop(page).locator("css=.fp-pop-name")).toBeVisible();
    await expect(pop(page).locator("css=.fp-pop-do")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await tapIcon(page, 6);
    await expect(pop(page)).toBeVisible();
    expect(await calls(page)).toEqual([]);
  });

  test("a stack still fans out first: the tap toggles nothing", async ({ page }) => {
    await boot(page, { tap_action: { action: "toggle" } });
    await tapIcon(page, 11);
    await expect(card(page).locator("css=svg .spider-leader")).toHaveCount(4);
    await expect(pop(page)).toHaveCount(0);
    expect(await calls(page)).toEqual([]);
  });

  test("a door is unchanged: a tap opens its popup", async ({ page }) => {
    await boot(page, { tap_action: { action: "toggle" } });
    const p = await point(page, 'svg line[data-d="0"]');
    await page.mouse.click(p.x, p.y);
    await expect(pop(page)).toBeVisible();
    expect(await calls(page)).toEqual([]);
  });
});

test.describe("tap_action: more-info and none", () => {
  test("more-info fires hass-more-info for the entity and opens no popup", async ({ page }) => {
    await boot(page, { tap_action: { action: "more-info" } });
    await tapIcon(page, 0);
    expect(await infos(page)).toEqual(["light.demo_living"]);
    await expect(pop(page)).toHaveCount(0);
    expect(await calls(page)).toEqual([]);
  });

  test("none does nothing at all", async ({ page }) => {
    await boot(page, { tap_action: { action: "none" } });
    await tapIcon(page, 0);
    await tapIcon(page, 3);
    expect(await infos(page)).toEqual([]);
    expect(await calls(page)).toEqual([]);
    await expect(pop(page)).toHaveCount(0);
  });

  test("none leaves a door's popup alone", async ({ page }) => {
    await boot(page, { tap_action: { action: "none" } });
    const p = await point(page, 'svg line[data-d="0"]');
    await page.mouse.click(p.x, p.y);
    await expect(pop(page)).toBeVisible();
  });
});

test.describe("hold_action", () => {
  test("none: a 600 ms hold does nothing, and the release opens no popup", async ({ page }) => {
    await boot(page, { hold_action: { action: "none" } });
    await holdIcon(page, 0);
    expect(await infos(page)).toEqual([]);
    expect(await calls(page)).toEqual([]);
    await expect(pop(page)).toHaveCount(0);
  });

  test("absent: a hold is more-info, as before", async ({ page }) => {
    await boot(page);
    await holdIcon(page, 0);
    expect(await infos(page)).toEqual(["light.demo_living"]);
  });

  test("kiosk never holds, whatever hold_action says", async ({ page }) => {
    await boot(page, { kiosk: true, hold_action: { action: "more-info" } });
    await holdIcon(page, 0);
    expect(await infos(page)).toEqual([]);
  });

  test("a hold with tap_action toggle is still more-info and calls nothing", async ({ page }) => {
    await boot(page, { tap_action: { action: "toggle" } });
    await holdIcon(page, 1);
    expect(await infos(page)).toEqual(["light.demo_kitchen"]);
    expect(await calls(page)).toEqual([]);
  });
});

test.describe("junk is absent and warns once", () => {
  const JUNK: [string, unknown, unknown][] = [
    ["a number", 5, 7],
    ["__proto__", "__proto__", { action: "__proto__" }],
    ["an unknown action", { action: "dance" }, { action: "dance" }],
    ["navigate", { action: "navigate", navigation_path: "/x" }, { action: "navigate" }],
    ["an array", ["toggle"], ["none"]],
  ];
  for (const [name, tap, hold] of JUNK) {
    test(`${name}: a tap opens the popup, a hold is more-info, one warning`, async ({ page }) => {
      const warns = await boot(page, { tap_action: tap, hold_action: hold });
      await tapIcon(page, 0);
      await expect(pop(page)).toBeVisible();
      expect(await calls(page)).toEqual([]);
      await page.keyboard.press("Escape");
      await holdIcon(page, 0);
      expect(await infos(page)).toEqual(["light.demo_living"]);
      await tapIcon(page, 1);
      const mine = warns.filter((w) => /tap_action|hold_action/.test(w));
      expect(mine, warns.join(" | ")).toHaveLength(1);
    });
  }

  test("absent keys do not warn", async ({ page }) => {
    const warns = await boot(page);
    await tapIcon(page, 0);
    expect(warns.filter((w) => /tap_action|hold_action/.test(w))).toHaveLength(0);
  });
});
