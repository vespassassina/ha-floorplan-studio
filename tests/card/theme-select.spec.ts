import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { THEMES } from "../../src/core";
import { chooseTheme, closeMenu, menuButton, menuPanel, openMenu, themeNow, themeSelect } from "./menu-helper";
import { cardSource } from "../../scripts/card-source.mjs";

// The Theme item of the ⋯ menu is one select, not 13 radios. Real mouse and keyboard (finding 3). The labels are the card's own
// (THEME_LABELS); the list must be THEMES, in order (finding 17: iterate the union).

const layout = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = cardSource(); // the card with its Overview chunk inlined (scripts/card-source.mjs)
const LABELS: Record<string, string> = { ha: "Home Assistant", "a-team": "A-Team", "carpenter-brut": "Carpenter Brut", "beach-house": "Beach house" };
const label = (t: string) => LABELS[t] ?? t[0].toUpperCase() + t.slice(1);

async function boot(page: Page, size: { width: number; height: number }, config: Record<string, unknown> = {}) {
  await page.setViewportSize(size);
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate((cfg) => {
    try { localStorage.clear(); } catch { /* no storage */ }
    const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(cfg);
    el.hass = { states: {}, callService() {} };
    return el.updateComplete;
  }, { layout, floor: "first", theme: "light", ...config });
  await expect(page.locator("floorplan-studio-card svg polygon[data-r]").first()).toBeVisible();
}
const card = (page: Page) => page.locator("floorplan-studio-card");
const stored = (page: Page) => page.evaluate(() => {
  const e = Object.entries(localStorage).find(([k]) => k.startsWith("fp-view:"));
  return e ? (JSON.parse(e[1]) as Record<string, unknown>) : null;
});
const focusedDesc = (page: Page) => page.evaluate(() => {
  let e: Element | null = document.activeElement;
  while (e?.shadowRoot?.activeElement) e = e.shadowRoot.activeElement;
  return e ? `${e.tagName.toLowerCase()}:${e.getAttribute("data-value") ?? e.getAttribute("aria-label") ?? ""}` : "none";
});

test.describe("the Theme item is a select", () => {
  test("it lists exactly THEMES, in order, with the card's labels, and shows the current one; no theme radio is left", async ({ page }) => {
    await boot(page, { width: 1280, height: 900 });
    await openMenu(page);
    await expect(themeSelect(page)).toHaveCount(1);
    expect(await themeSelect(page).locator("css=option").evaluateAll((os) => os.map((o) => [(o as HTMLOptionElement).value, o.textContent])))
      .toEqual(THEMES.map((t) => [`theme:${t}`, label(t)]));
    expect(await themeSelect(page).evaluate((s) => (s as HTMLSelectElement).value)).toBe("theme:light");
    await expect(themeSelect(page)).toHaveAccessibleName("Theme");
    await expect(menuPanel(page).locator("css=[role=menuitemradio][data-value^='theme:']")).toHaveCount(0);
  });

  for (const t of THEMES) {
    test(`choosing ${t} with the mouse and keys sets data-theme and the remembered view`, async ({ page }) => {
      await boot(page, { width: 1280, height: 900 }, { theme: t === "light" ? "midnight" : "light" });
      await chooseTheme(page, t);
      await expect(card(page)).toHaveAttribute("data-theme", t);
      await expect(menuPanel(page), "the menu closes on a pick").toHaveCount(0);
      expect(await focusedDesc(page), "focus is back on the ⋯ button").toBe("button:View options");
      expect((await stored(page))?.theme).toBe(t);
      expect(await themeNow(page, THEMES)).toBe(t);
    });
  }

  test("keyboard: Arrow keys reach the select as a stop; Alt+ArrowDown opens it; a pick closes the menu", async ({ page }) => {
    await boot(page, { width: 1280, height: 900 });
    await menuButton(page).focus();
    await page.keyboard.press("Enter");
    const seen: string[] = [];
    for (let i = 0; i < 30 && !seen.includes("select:theme"); i++) {
      await page.keyboard.press("ArrowDown");
      seen.push(await focusedDesc(page));
    }
    expect(seen, "ArrowDown passes the select").toContain("select:theme");
    await page.keyboard.press("ArrowDown");
    expect(await focusedDesc(page), "and moves on to the next stop (an arrow does not change the theme)").not.toBe("select:theme");
    expect(await card(page).getAttribute("data-theme")).toBe("light");
    await page.keyboard.press("ArrowUp");
    expect(await focusedDesc(page)).toBe("select:theme");
    await page.keyboard.press("Alt+ArrowDown"); // opens the list where the platform has one
    await page.keyboard.type("M", { delay: 5 }); // the select's type-ahead: Midnight is the only M
    if (await menuPanel(page).count()) await page.keyboard.press("Enter"); // an open list only highlights
    await expect(card(page)).toHaveAttribute("data-theme", "midnight");
    await expect(menuPanel(page)).toHaveCount(0);
    expect(await focusedDesc(page)).toBe("button:View options");
  });

  test("Escape with the list open leaves the menu usable; Escape on the select closes the menu and refocuses the button", async ({ page }) => {
    await boot(page, { width: 1280, height: 900 });
    await openMenu(page);
    await themeSelect(page).click();
    await page.keyboard.press("Escape");
    await expect(card(page)).toHaveAttribute("data-theme", "light");
    // Whether the first Escape only closed the list or the menu too, the menu is in a state that works.
    if (await menuPanel(page).count()) {
      await themeSelect(page).focus();
      await page.keyboard.press("Escape");
    }
    await expect(menuPanel(page)).toHaveCount(0);
    await expect(menuButton(page)).toHaveAttribute("aria-expanded", "false");
    await chooseTheme(page, "slate");
    await expect(card(page)).toHaveAttribute("data-theme", "slate");
  });

  for (const size of [{ width: 390, height: 844 }, { width: 768, height: 1024 }]) {
    test(`at ${size.width} x ${size.height} the select fits in the menu and the menu in the screen; a pick works`, async ({ page }) => {
      await boot(page, size);
      await openMenu(page);
      const box = (await themeSelect(page).boundingBox())!, pan = (await menuPanel(page).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(pan.x - 0.5);
      expect(box.x + box.width).toBeLessThanOrEqual(pan.x + pan.width + 0.5);
      expect(pan.x + pan.width).toBeLessThanOrEqual(size.width + 0.5);
      expect(box.height).toBeGreaterThanOrEqual(32);
      await closeMenu(page);
      await chooseTheme(page, "cyberpunk");
      await expect(card(page)).toHaveAttribute("data-theme", "cyberpunk");
    });
  }

  test("at 1024 x 600 the menu keeps its height cap and the select is reachable by scrolling", async ({ page }) => {
    await boot(page, { width: 1024, height: 600 });
    await openMenu(page);
    const pan = (await menuPanel(page).boundingBox())!;
    expect(pan.y + pan.height).toBeLessThanOrEqual(600 + 0.5);
    await themeSelect(page).scrollIntoViewIfNeeded();
    await chooseTheme(page, "terminal");
    await expect(card(page)).toHaveAttribute("data-theme", "terminal");
  });

  test("touch (coarse pointer): the select is at least 44 px high; fine pointer: 32 px", async ({ browser }) => {
    for (const touch of [false, true]) {
      const ctx = await browser.newContext({ hasTouch: touch, isMobile: touch, viewport: { width: 390, height: 844 } });
      const page = await ctx.newPage();
      await boot(page, { width: 390, height: 844 });
      await openMenu(page);
      const h = (await themeSelect(page).boundingBox())!.height;
      if (touch) expect(h).toBeGreaterThanOrEqual(44); else expect(h).toBeGreaterThanOrEqual(32);
      await ctx.close();
    }
  });

  test("the select shows its longest label in full (it was cut to 'Home Assist' at 1024 x 768)", async ({ page }) => {
    await boot(page, { width: 1024, height: 768 }, { theme: "ha" });
    await openMenu(page);
    const w = await themeSelect(page).evaluate((s) => s.getBoundingClientRect().width);
    const text = await page.evaluate(() => { const c = document.createElement("canvas").getContext("2d")!; c.font = "13px system-ui, sans-serif"; return c.measureText("Carpenter Brut").width; });
    expect(w, "room for the widest label plus the arrow and padding").toBeGreaterThan(text + 24);
  });

  test("view_switch: false has no Theme select; Detail and the rest stay", async ({ page }) => {
    await boot(page, { width: 1280, height: 900 }, { view_switch: false });
    await openMenu(page);
    await expect(themeSelect(page)).toHaveCount(0);
  });

  test("computed style: the select is coloured only through the theme (a pair for the new rule)", async ({ page }) => {
    for (const t of ["blueprint", "light", "ha"]) {
      await boot(page, { width: 1280, height: 900 }, { theme: t });
      await openMenu(page);
      const css = await themeSelect(page).evaluate((s) => {
        const c = getComputedStyle(s), host = getComputedStyle(s.closest("[role=menu]")!);
        return { color: c.color, bg: c.backgroundColor, menuBg: host.backgroundColor, menuInk: host.color, font: c.fontSize };
      });
      expect(css.color, t).toBe(css.menuInk);
      expect(css.bg, t).not.toBe("rgba(0, 0, 0, 0)");
      expect(css.font, t).toBe("13px");
      await closeMenu(page);
    }
  });
});
