import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { loadCard } from "./form-harness";

// S25.8: the card config form offers `detail`. Same harness as config-editor-walls.spec.ts.
const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));

async function mount(page: Page, config: Record<string, unknown> = {}) {
  await loadCard(page);
  await page.evaluate(async (config) => {
    const Ctor = customElements.get("floorplan-studio-card") as unknown as { getConfigElement(): Promise<HTMLElement> };
    const el = await Ctor.getConfigElement();
    (window as any).__events = [];
    el.addEventListener("config-changed", (e) => (window as any).__events.push((e as CustomEvent).detail));
    el.id = "editor";
    document.body.appendChild(el);
    (el as any).setConfig(config);
  }, config);
}
const events = (page: Page) => page.evaluate(() => (window as any).__events);

test("detail field: three choices, auto is the default and dropped from the payload, picks written, junk shows Auto", async ({ page }) => {
  await mount(page, { layout: demo });
  const sel = page.locator("#editor select#detail");
  expect(await sel.locator("option").allTextContents()).toEqual(["Auto (follow the zoom)", "Always full", "Always minimal"]);
  await expect(sel).toHaveValue("auto");
  await sel.selectOption("full");
  expect((await events(page)).at(-1).config.detail).toBe("full");
  await sel.selectOption("auto");
  expect("detail" in (await events(page)).at(-1).config).toBe(false);
  await mount(page, { detail: "<b>", layout: demo });
  await expect(page.locator("#editor select#detail")).toHaveValue("auto");
  await mount(page, { detail: "minimal", layout: demo });
  await expect(page.locator("#editor select#detail")).toHaveValue("minimal");
});
