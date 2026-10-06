import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// S14.6 (docs/specs/card-polish-and-light.md, item 12): the Active list and the Room panel group their rows by category,
// each category a header button that folds it, remembered per card. Clicks are real page.mouse events at the header's
// centre, checked to be the real top element there (CLAUDE.md finding 3).

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");

const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-04T09:30:15Z" });
const STATES = () => ({
  "light.demo_living": st("on", { friendly_name: "Living light", supported_color_modes: ["onoff"] }),
  "light.demo_kitchen": st("on", { supported_color_modes: ["onoff"] }),
  "switch.demo_hall": st("off"), "switch.demo_tv_plug": st("on"),
  "sensor.demo_living_temperature": st("21.5", { unit_of_measurement: "°C" }),
  "climate.demo_living": st("heat"), "camera.demo_hall": st("idle"),
});

async function boot(page: Page, width: number, extra: Record<string, unknown> = {}, fresh = true) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(URL_);
  if (fresh) await page.evaluate(() => { try { localStorage.clear(); } catch { /* none */ } });
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(([config, states]) => {
    const w = window as unknown as { __calls: string[] };
    w.__calls = [];
    const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(config);
    el.hass = { states, callService: (d: string, s: string) => { w.__calls.push(`${d}.${s}`); } };
    return el.updateComplete;
  }, [{ layout: structuredClone(demo), floor: "ground", ...extra }, STATES()] as const);
  // below 480 px the list starts folded: open it, as a person would
  const collapse = card(page).locator("css=.fp-active-collapse");
  if ((await collapse.getAttribute("aria-expanded")) === "false") await collapse.click();
}
const card = (page: Page) => page.locator("floorplan-studio-card");
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: string[] }).__calls);
const names = (page: Page) => card(page).locator("css=.fp-active-body > .fp-active-group .fp-cat-name").allTextContents();

/** A real click at the header's centre, after checking that the header is the top element there. */
async function clickHead(page: Page, cat: string, list = ".fp-active-body > .fp-active-group") {
  const p = await card(page).evaluate((el, sel) => {
    const b = el.shadowRoot!.querySelector<HTMLElement>(sel)!;
    b.scrollIntoView({ block: "nearest" });
    const r = b.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
    return { x, y, hit: el.shadowRoot!.elementFromPoint(x, y)?.closest("button.fp-cat") === b };
  }, `${list}[data-cat="${cat}"] > button.fp-cat`);
  expect(p.hit, `the ${cat} header is the top element at its centre`).toBe(true);
  await page.mouse.click(p.x, p.y);
}
const rowsIn = (page: Page, cat: string, list = ".fp-active-body > .fp-active-group") => card(page).locator(`css=${list}[data-cat="${cat}"] .fp-active-row`).count();
const expanded = (page: Page, cat: string, list = ".fp-active-body > .fp-active-group") => card(page).locator(`css=${list}[data-cat="${cat}"] > button.fp-cat`).getAttribute("aria-expanded");

for (const width of [1100, 375]) {
  for (const theme of ["light", "midnight"]) {
    test.describe(`categories at ${width} px, theme ${theme}`, () => {
      test("the Active list is ordered by category; a real click folds one group and a second opens it", async ({ page }) => {
        await boot(page, width, { theme });
        // the demo lists the plug (power) before the camera (security); the fixed category order puts lights, security, power
        const got = await names(page);
        expect(got.slice(0, 3)).toEqual(["Lights", "Security", "Power"]);
        expect(await rowsIn(page, "lights")).toBe(2);
        await clickHead(page, "lights");
        expect(await expanded(page, "lights")).toBe("false");
        expect(await rowsIn(page, "lights")).toBe(0);
        expect(await rowsIn(page, "security"), "the other groups stay open").toBeGreaterThan(0);
        await clickHead(page, "lights");
        expect(await expanded(page, "lights")).toBe("true");
        expect(await rowsIn(page, "lights")).toBe(2);
      });

      test("the fold is remembered after a reload", async ({ page }) => {
        await boot(page, width, { theme });
        await clickHead(page, "security");
        expect(await expanded(page, "security")).toBe("false");
        await boot(page, width, { theme }, false);
        expect(await expanded(page, "security")).toBe("false");
        expect(await expanded(page, "lights")).toBe("true");
      });

      test("a header works from the keyboard: Enter folds, Space opens, and it is a button with aria-expanded", async ({ page }) => {
        await boot(page, width, { theme });
        const head = card(page).locator('css=.fp-active-group[data-cat="security"] > button.fp-cat');
        expect(await head.evaluate((b) => b.tagName)).toBe("BUTTON");
        await head.focus();
        await page.keyboard.press("Enter");
        expect(await expanded(page, "security")).toBe("false");
        await page.keyboard.press("Space");
        expect(await expanded(page, "security")).toBe("true");
      });

      test("a row inside a group still opens the popup and operates nothing", async ({ page }) => {
        await boot(page, width, { theme });
        await card(page).locator("css=.fp-active-row", { hasText: "Living light" }).click();
        await expect(card(page).locator("css=.fp-pop")).toHaveAttribute("aria-label", "Living light");
        expect(await calls(page)).toEqual([]);
      });

      test("the header looks like a label, not a browser button, and fits the panel (computed style pair)", async ({ page }) => {
        await boot(page, width, { theme });
        const s = await card(page).locator('css=.fp-active-group[data-cat="lights"] > button.fp-cat').evaluate((b) => {
          const cs = getComputedStyle(b), panel = getComputedStyle(b.closest(".fp-active")!), body = b.closest(".fp-active-body") as HTMLElement;
          const r = b.getBoundingClientRect();
          return { size: cs.fontSize, border: cs.borderTopStyle, bg: cs.backgroundColor, cursor: cs.cursor, color: cs.color, panelBg: panel.backgroundColor, h: r.height, overflow: body.scrollWidth > body.clientWidth };
        });
        expect(s.size).toBe("10px");
        expect(s.border).toBe("none");
        expect(s.bg).toBe("rgba(0, 0, 0, 0)");
        expect(s.cursor).toBe("pointer");
        expect(s.color, "label colour reads against the panel").not.toBe(s.panelBg);
        expect(s.h).toBeGreaterThanOrEqual(28);
        expect(s.overflow).toBe(false);
      });
    });
  }
}

test.describe("the Room panel is grouped too", () => {
  for (const width of [1100, 375]) {
    test(`at ${width} px a picked room lists its devices by category and folds them apart from the Active list`, async ({ page }) => {
      await boot(page, width);
      const p = await card(page).evaluate((el) => {
        const poly = el.shadowRoot!.querySelector<SVGPolygonElement>('svg polygon[data-r="0"]')!;
        const r = poly.getBoundingClientRect();
        for (let y = r.top + 6; y < r.bottom; y += 6) for (let x = r.left + 6; x < r.right; x += 6) {
          if (x > window.innerWidth || y > window.innerHeight) continue;
          if (el.shadowRoot!.elementFromPoint(x, y) === poly) return { x, y };
        }
        return null;
      });
      expect(p).not.toBeNull();
      await page.mouse.click(p!.x, p!.y);
      const room = ".fp-room-devices > .fp-active-group";
      const cats = await card(page).locator(`css=${room} .fp-cat-name`).allTextContents();
      expect(cats.length).toBeGreaterThan(1);
      expect(cats[0]).toBe("Lights");
      const before = await rowsIn(page, "lights", room);
      expect(before).toBeGreaterThan(0);
      await clickHead(page, "lights", room);
      expect(await rowsIn(page, "lights", room)).toBe(0);
      expect(await expanded(page, "lights", room)).toBe("false");
      // the Active list below shows the same category, and it is still open: the two lists fold apart
      expect(await expanded(page, "lights", ".fp-filtered > .fp-active-group")).toBe("true");
    });
  }
});
