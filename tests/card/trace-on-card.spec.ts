import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { cardSource } from "../../scripts/card-source.mjs";

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = cardSource();
const SRC = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGP4z8DAwPAfAAcAAf9+CLHQAAAAAElFTkSuQmCC";

async function open(page: Page) {
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
}

async function configure(page: Page, config: Record<string, unknown>, hass: Record<string, unknown>) {
  await page.evaluate(
    ([config, hass]) => {
      const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
      el.setConfig(config);
      el.hass = hass;
      return el.updateComplete;
    },
    [config, hass] as const,
  );
}

const card = (page: Page) => page.locator("floorplan-studio-card");

test("S49: card draws trace only when both trace.on and trace.card are true, with translucent rooms and non-blocking pointer-events", async ({ page }) => {
  await open(page);
  const layout = structuredClone(demo);
  layout.floors.ground.trace = { src: SRC, x: 0, y: 0, w: 800, rot: 0, alpha: 0.4, on: true, card: true };
  layout.floors.first.trace = { src: SRC, x: 0, y: 0, w: 800, rot: 0, alpha: 0.4, on: true };
  await configure(page, { layout }, { states: {} });

  const info = () => card(page).evaluate((el) => {
    const svg = el.shadowRoot!.querySelector("svg")!;
    const img = svg.querySelector("image.trace");
    const room = svg.querySelector("polygon[data-r]")!;
    return {
      tracing: svg.classList.contains("tracing"),
      images: svg.querySelectorAll("image.trace").length,
      href: img?.getAttribute("href") ?? null,
      opacity: img?.getAttribute("opacity") ?? null,
      imgPointerEvents: img ? getComputedStyle(img).pointerEvents : null,
      roomFillOpacity: getComputedStyle(room).fillOpacity,
    };
  });

  await expect.poll(async () => (await info()).images).toBe(1);
  expect(await info()).toEqual({
    tracing: true,
    images: 1,
    href: SRC,
    opacity: "0.4",
    imgPointerEvents: "none",
    roomFillOpacity: "0.4",
  });

  // Switching to First floor (where trace.on is true without card: true) hides the trace and restores opaque rooms.
  await card(page).locator("css=.fp-floors button").nth(1).click();
  await expect.poll(async () => (await info()).images).toBe(0);
  expect((await info()).tracing).toBe(false);
  expect((await info()).roomFillOpacity).toBe("1");
});

test("S49: card draws no trace when on is false even if card is true", async ({ page }) => {
  await open(page);
  const layout = structuredClone(demo);
  layout.floors.ground.trace = { src: SRC, x: 0, y: 0, w: 800, rot: 0, alpha: 0.6, on: false, card: true };
  await configure(page, { layout }, { states: {} });

  const state = await card(page).evaluate((el) => {
    const svg = el.shadowRoot!.querySelector("svg")!;
    const room = svg.querySelector("polygon[data-r]")!;
    return {
      tracing: svg.classList.contains("tracing"),
      images: svg.querySelectorAll("image").length,
      roomFillOpacity: getComputedStyle(room).fillOpacity,
    };
  });
  expect(state).toEqual({ tracing: false, images: 0, roomFillOpacity: "1" });
});

test("S49: trace underlay does not block tapping a device on the card", async ({ page }) => {
  await open(page);
  const layout = structuredClone(demo);
  layout.floors.ground.trace = { src: SRC, x: 0, y: 0, w: 800, rot: 0, alpha: 0.5, on: true, card: true };
  await configure(page, { layout }, { states: {} });

  const dev = card(page).locator("css=svg g[data-x]").first();
  const box = (await dev.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(card(page).locator("css=.fp-pop")).toBeVisible();
});
