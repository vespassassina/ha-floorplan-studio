import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// S7.7: the card config form. Same file:// injection trick as tests/card/card.spec.ts — a plain <script src>
// fails under file:// (Chromium refuses a cross-origin module fetch between two file:// URLs), so the built
// module's own source is injected as inline content. config-editor.ts is imported for its side effect (defining
// floorplan-studio-card-editor) from src/card/floorplan-studio-card.ts, so it ships in the same dist file the vite
// config already builds (vite.config.ts: the card's entry is src/card/floorplan-studio-card.ts) — no second file.
const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));

const URL_ = pathToFileURL(resolve("tests/card/config-editor-harness.html")).href;
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");

/** Loads the harness fresh, injects the built module, and waits for both custom elements to upgrade. */
async function open(page: Page) {
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => Promise.all([customElements.whenDefined("floorplan-studio-card"), customElements.whenDefined("floorplan-studio-card-editor")]));
}

/** Calls FloorplanStudioCard.getConfigElement(), appends the result to the body, calls setConfig, and returns
 * a handle to it. Collects every config-changed event fired after this point into window.__events. */
async function mount(page: Page, config: Record<string, unknown> = {}) {
  await page.evaluate((config) => {
    const Ctor = customElements.get("floorplan-studio-card") as unknown as { getConfigElement(): HTMLElement };
    const el = Ctor.getConfigElement();
    (window as unknown as { __events: unknown[] }).__events = [];
    el.addEventListener("config-changed", (e) => {
      (window as unknown as { __events: unknown[] }).__events.push((e as CustomEvent).detail);
    });
    el.id = "editor";
    document.body.appendChild(el);
    (el as unknown as { setConfig(c: unknown): void }).setConfig(config);
  }, config);
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card-editor"));
}

function events(page: Page) {
  return page.evaluate(() => (window as unknown as { __events: unknown[] }).__events);
}

test("walls field: lists the three modes, default dropped from the payload, picks written, junk shows Cutaway", async ({ page }) => {
  await open(page);
  await mount(page, { layout: demo });
  const editor = page.locator("#editor");
  expect(await editor.locator("select#walls option").allTextContents()).toEqual(["Full height", "Cutaway", "Low"]);
  await expect(editor.locator("select#walls")).toHaveValue("cut");
  await editor.locator("select#walls").selectOption("full");
  let detail = (await events(page)).at(-1) as { config: Record<string, unknown> };
  expect(detail.config.walls).toBe("full");
  await editor.locator("select#walls").selectOption("cut");
  detail = (await events(page)).at(-1) as { config: Record<string, unknown> };
  expect("walls" in detail.config).toBe(false);
  await page.evaluate(() => document.getElementById("editor")!.remove());
  await mount(page, { walls: "<b>", layout: demo });
  await expect(page.locator("#editor select#walls")).toHaveValue("cut");
  await page.evaluate(() => document.getElementById("editor")!.remove());
  await mount(page, { walls: "low", layout: demo });
  await expect(page.locator("#editor select#walls")).toHaveValue("low");
});
