import { test, expect, type Page } from "@playwright/test";
import { MENU_KEYS, chordLabel } from "../../src/editor/guide";

// S26.18 (Studio review U22): every toolbar item that has a key shows it at its right edge, and the key does what the item does.
// Both platforms: navigator.platform is set before the page loads, and the keys are pressed with the modifier that platform shows.

const EDITOR = "floorplan-studio-editor";
const focusEditor = (page: Page) => page.evaluate((tag) => (document.querySelector(tag) as HTMLElement).focus(), EDITOR);
const layoutJson = (page: Page) => page.evaluate((tag) => JSON.stringify((document.querySelector(tag) as any).layout), EDITOR);

for (const mac of [true, false]) {
  const mod = mac ? "Meta" : "Control";
  test.describe(mac ? "on a Mac" : "on Windows or Linux", () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((p) => Object.defineProperty(navigator, "platform", { get: () => p }), mac ? "MacIntel" : "Win32");
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto("/standalone.html");
      await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
    });

    const ITEMS: { name: string; sel: string; key: string; open?: string }[] = [
      { name: "Undo", sel: "#undo", key: MENU_KEYS.undo },
      { name: "Redo", sel: "#redo", key: MENU_KEYS.redo },
      { name: "Save", sel: "#save", key: MENU_KEYS.save, open: "#mFile" },
      { name: "Fit to window", sel: "#fit", key: MENU_KEYS.fit, open: "#mOpt" },
    ];
    for (const it of ITEMS) {
      test(`${it.name} ends in its key, at its right edge`, async ({ page }) => {
        if (it.open) await page.locator(`${it.open} > summary`).click();
        const want = chordLabel(it.key, mac);
        const text = (await page.locator(it.sel).textContent())!.trim();
        expect(text.endsWith(want), `${text} should end in ${want}`).toBe(true);
        expect(text.startsWith(it.name)).toBe(true);
        const k = (await page.locator(`${it.sel} .kbd`).boundingBox())!, b = (await page.locator(it.sel).boundingBox())!;
        expect(k.x + k.width, "the key sits against the right edge").toBeGreaterThan(b.x + b.width - 24);
        expect(k.x, "after the label").toBeGreaterThan(b.x + b.width / 3);
      });
    }

    test("Undo and Redo keys do what the buttons do", async ({ page }) => {
      await page.locator("#fixPlan").uncheck();
      const before = await layoutJson(page);
      const d = (await page.locator(`${EDITOR} svg g[data-x]`).first().boundingBox())!;
      const cx = d.x + d.width / 2, cy = d.y + d.height / 2;
      await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 40, cy + 30, { steps: 6 }); await page.mouse.up();
      const moved = await layoutJson(page);
      expect(moved).not.toBe(before);
      await page.keyboard.press(`${mod}+z`);
      expect(await layoutJson(page)).toBe(before);
      await page.keyboard.press(`${mod}+Shift+z`);
      expect(await layoutJson(page)).toBe(moved);
    });

    test("Save key sends the save request the Save item sends", async ({ page }) => {
      await page.evaluate((tag) => { (window as any).__saves = 0; document.querySelector(tag)!.addEventListener("save-request", () => { (window as any).__saves++; }); }, EDITOR);
      await focusEditor(page);
      await page.keyboard.press(`${mod}+s`);
      await expect.poll(() => page.evaluate(() => (window as any).__saves)).toBe(1);
    });

    test("Space does what Fit to window does", async ({ page }) => {
      const fit = await page.evaluate((tag) => JSON.stringify((document.querySelector(tag) as any).st.view), EDITOR);
      await page.mouse.move(640, 400);
      await page.mouse.wheel(0, -400);
      await focusEditor(page);
      await expect.poll(() => page.evaluate((tag) => JSON.stringify((document.querySelector(tag) as any).st.view), EDITOR)).not.toBe(fit);
      await page.keyboard.press("Space");
      await expect.poll(() => page.evaluate((tag) => JSON.stringify((document.querySelector(tag) as any).st.view), EDITOR)).toBe(fit);
    });
  });
}
