import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validate, type Layout } from "../../src/core/schema";

// S1.7: dist/editor.html is the whole editor in one file. These tests open it from
// file://, the way a user double-clicks it. dist/ is built by tests/setup/build.ts.

const FILE = resolve("dist/editor.html");
const URL_ = pathToFileURL(FILE).href;
const EDITOR = "floorplan-studio-editor";
const KEY = "floorplan-studio:layout";
const layoutOf = (page: Page) => page.evaluate((tag) => JSON.parse(JSON.stringify((document.querySelector(tag) as any).layout)) as Layout, EDITOR);

/** Collects every request that is not local (file:, data:, blob:). */
function watchNetwork(page: Page) {
  const remote: string[] = [];
  page.on("request", (r) => { if (!/^(file|data|blob):/.test(r.url())) remote.push(r.url()); });
  return remote;
}
async function open(page: Page) {
  await page.goto(URL_);
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
}

test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1280, height: 800 }); });

test("the build is one small file with nothing external", () => {
  expect(statSync(FILE).size).toBeLessThan(1_000_000);
  const html = readFileSync(FILE, "utf8");
  // the integration serves the same file from its www/ folder
  expect(readFileSync("custom_components/floorplan_studio/www/editor.html", "utf8")).toBe(html);
  expect(html).not.toMatch(/<script[^>]*\ssrc=/i);
  expect(html).not.toMatch(/<link[^>]*rel=["']?(stylesheet|modulepreload)/i);
  expect(html).not.toMatch(/<(img|iframe|source)[^>]*\ssrc=["']?(?!data:)/i);
  expect(html).not.toMatch(/\bimport\s*\(?\s*["']\.{0,2}\//); // no import of a sibling file
  expect(html).not.toMatch(/https?:\/\/[^"'\s]*\.(js|css|woff2?)\b/);
});

test("opens from file://, draws the demo, opens a v1 file, saves v2, and makes no request", async ({ page }) => {
  const remote = watchNetwork(page);
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await open(page);
  await expect(page.locator("svg polygon[data-r]")).toHaveCount(7);
  expect((await layoutOf(page)).version).toBe(2);

  await page.locator("#file").setInputFiles("demo/layout.v1.json");
  await expect(page.locator("#errors")).toHaveCount(0);
  const migrated = await layoutOf(page);
  expect(migrated.version).toBe(2);
  await expect(page.locator("svg polygon[data-r]")).toHaveCount(7);

  await page.locator("details.menu > summary", { hasText: "File" }).click();
  const dl = page.waitForEvent("download");
  await page.locator("#save").click();
  const saved = JSON.parse(readFileSync(await (await dl).path(), "utf8"));
  expect(saved.version).toBe(2);
  expect(validate(saved).ok).toBe(true);

  expect(remote).toEqual([]);
  expect(requests.every((u) => u.startsWith("file:") || /^(data|blob):/.test(u))).toBe(true);
  expect(errors).toEqual([]);
});

test("autosave key and Reset work under file://", async ({ page }) => {
  await open(page);
  await page.locator("#file").setInputFiles("demo/layout.v1.json");
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), KEY)).not.toBeNull();
  const stored = JSON.parse((await page.evaluate((k) => localStorage.getItem(k), KEY))!);
  expect(stored.version).toBe(2);

  await page.reload();
  await expect(page.locator("svg polygon[data-r]").first()).toBeVisible();
  expect(await layoutOf(page)).toEqual(stored);

  page.once("dialog", (d) => d.accept());
  await page.locator("details.menu > summary", { hasText: "File" }).click();
  await page.locator("#reset").click();
  const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
  expect(await layoutOf(page)).toEqual(demo);
});

test("break it: offline still loads", async ({ browser }) => {
  const context: BrowserContext = await browser.newContext();
  await context.setOffline(true);
  const page = await context.newPage();
  const remote = watchNetwork(page);
  await open(page);
  await expect(page.locator("svg polygon[data-r]")).toHaveCount(7);
  expect(remote).toEqual([]);
  await context.close();
});

test("break it: localStorage that throws does not stop the editor", async ({ page }) => {
  await page.addInitScript(() => {
    const boom = () => { throw new DOMException("blocked", "SecurityError"); };
    Object.defineProperty(window, "localStorage", { get: boom, configurable: true });
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await open(page);
  await expect(page.locator("svg polygon[data-r]")).toHaveCount(7);
  // edits and Save still work without storage
  await page.locator("#file").setInputFiles("demo/layout.v1.json");
  await expect(page.locator("#errors")).toHaveCount(0);
  await page.locator("details.menu > summary", { hasText: "File" }).click();
  const dl = page.waitForEvent("download");
  await page.locator("#save").click();
  expect(validate(JSON.parse(readFileSync(await (await dl).path(), "utf8"))).ok).toBe(true);
  expect(errors).toEqual([]);
});

test("break it: a file with rooms:5 shows errors and keeps the layout", async ({ page }) => {
  await open(page);
  const before = await layoutOf(page);
  const bad = JSON.parse(readFileSync("demo/layout.json", "utf8"));
  bad.floors.ground.rooms = 5;
  await page.locator("#file").setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(bad)) });
  await expect(page.locator("#errors")).toBeVisible();
  await expect(page.locator("#errors li").first()).toContainText("rooms");
  expect(await layoutOf(page)).toEqual(before);
  await expect(page.locator("svg polygon[data-r]")).toHaveCount(7);
});
