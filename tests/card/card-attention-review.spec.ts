import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// S24.R: the Opus review of Sprint 24, the card's half. The stress house (437 devices). The hass stub has the shapes Home
// Assistant's frontend hands a card (finding 21): `states` keyed by entity id, and `entities`, the entity registry's display
// entries keyed by entity id with `device_id` and `entity_category` (the frontend's `EntityRegistryDisplayEntry`; the card
// already reads `device_id` from it for the plug power auto-link, `_powerLinks`).

const layout = JSON.parse(readFileSync("tests/fixtures/stress-layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");

const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-08T09:30:15Z" });

async function boot(page: Page, states: Record<string, unknown>, entities?: Record<string, unknown>) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(
    ([cfg, s, e]) => {
      try { localStorage.clear(); } catch { /* file: origin without storage */ }
      const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
      el.setConfig(cfg);
      el.hass = { states: s, ...(e ? { entities: e } : {}), callService: () => {} };
      return el.updateComplete;
    },
    [{ layout, theme: "light", floor: "ground" }, states, entities] as const,
  );
}
const card = (page: Page) => page.locator("floorplan-studio-card");
const attnRow = (page: Page, entity: string) => card(page).locator(`css=.fp-ov-attn .fp-active-row[data-entity="${entity}"]`);
const actRow = (page: Page, entity: string) => card(page).locator(`css=.fp-ov-act .fp-active-row[data-entity="${entity}"]`);

test.describe("S24.R the card's Attention", () => {
  test("R1: a motion sensor whose HA device has a battery sensor at 7 % reads 'battery 7 %'; a Zigbee2MQTT `battery` attribute too", async ({ page }) => {
    await boot(page, {
      "binary_sensor.garage_motion_pir": st("off"), "sensor.garage_pir_battery": st("7", { device_class: "battery", unit_of_measurement: "%" }),
      "binary_sensor.vegetable_garden_motion": st("off", { battery: 4 }),
    }, {
      "binary_sensor.garage_motion_pir": { device_id: "pir", entity_category: null },
      "sensor.garage_pir_battery": { device_id: "pir", entity_category: "diagnostic" },
    });
    await expect(attnRow(page, "binary_sensor.garage_motion_pir").locator("css=.fp-ov-name")).toHaveText("Garage PIR");
    await expect(attnRow(page, "binary_sensor.garage_motion_pir").locator("css=.fp-row-state")).toHaveText(/^battery 7 %/);
    await expect(attnRow(page, "binary_sensor.vegetable_garden_motion").locator("css=.fp-row-state")).toHaveText(/^battery 4 %/);
    await expect(card(page).locator("css=.fp-ov-attn .fp-ov-head")).toHaveText("Attention · 2");
  });

  test("R2: a jammed lock is in Attention and says so", async ({ page }) => {
    await boot(page, { "lock.cloakroom_cabinet": st("jammed") });
    await expect(attnRow(page, "lock.cloakroom_cabinet").locator("css=.fp-row-state")).toHaveText(/^jammed/);
  });

  test("R6: a lamp that is on with a low battery is in Attention and stays in Active; an open window is listed once", async ({ page }) => {
    await boot(page, { "light.kitchen_spot_1": st("on", { battery_level: 5 }), "binary_sensor.mailbox": st("on") });
    await expect(attnRow(page, "light.kitchen_spot_1").locator("css=.fp-row-state")).toHaveText(/^battery 5 %/);
    await expect(actRow(page, "light.kitchen_spot_1")).toHaveCount(1);
    // What Attention already says (open) is not said again under Active.
    await expect(attnRow(page, "binary_sensor.mailbox")).toHaveCount(1);
    await expect(actRow(page, "binary_sensor.mailbox")).toHaveCount(0);
  });
});

test.describe("S24.R7 one @keyframes name, one ring", () => {
  test("no keyframes name is defined twice in the card; the pulse ring and the plan's locate ring each run their own", async ({ page }) => {
    await boot(page, { "light.kitchen_spot_1": st("on") });
    const r = await card(page).evaluate(async (el) => {
      const root = el.shadowRoot!;
      const sheets = [...root.adoptedStyleSheets, ...[...root.querySelectorAll("style")].map((s) => s.sheet!).filter(Boolean)];
      const names: string[] = [];
      const walk = (rules: CSSRuleList) => { for (const rule of rules) { if (rule instanceof CSSKeyframesRule) names.push(rule.name); else if ("cssRules" in rule) walk((rule as CSSGroupingRule).cssRules); } };
      for (const s of sheets) walk(s.cssRules);
      // The plan's own ring (render.ts draws it round a located thing in the Studio): put one in the card's plan.
      const svg = root.querySelector("svg.fp-zoomable")!;
      const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      c.setAttribute("class", "locate"); c.setAttribute("cx", "100"); c.setAttribute("cy", "100"); c.setAttribute("r", "20");
      svg.querySelector("g")!.appendChild(c);
      const props = (e: Element) => e.getAnimations().flatMap((a) => (a.effect as KeyframeEffect).getKeyframes().flatMap((k) => Object.keys(k))).filter((k) => !["offset", "easing", "composite", "computedOffset"].includes(k));
      const locate = { name: getComputedStyle(c).animationName, props: [...new Set(props(c))].sort() };
      return { dupes: names.filter((n, i) => names.indexOf(n) !== i), locate };
    });
    expect(r.dupes).toEqual([]);
    // The plan's ring grows and fades (transform); before the fix the card's ring keyframes, a box-shadow, replaced them.
    expect(r.locate.props).toContain("transform");
    expect(r.locate.props).not.toContain("boxShadow");

    // The card's own pulse, after a row tap, runs the box-shadow keyframes, not the plan ring's scale, which would undo
    // its translate(-50%, -50%) centring.
    const row = card(page).locator('css=.fp-ov-act .fp-active-row[data-entity="light.kitchen_spot_1"]');
    const b = (await row.boundingBox())!;
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    const pulse = await card(page).evaluate((el) => {
      const p = el.shadowRoot!.querySelector(".fp-pulse") as HTMLElement | null;
      if (!p) return null;
      const props = p.getAnimations().flatMap((a) => (a.effect as KeyframeEffect).getKeyframes().flatMap((k) => Object.keys(k)));
      return { name: getComputedStyle(p).animationName, props: [...new Set(props)] };
    });
    expect(pulse).not.toBeNull();
    expect(pulse!.props).toContain("boxShadow");
    expect(pulse!.props).not.toContain("transform");
  });
});
