import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { serve, ORIGIN } from "./helpers-3d";

// Diego, 0.12.22: "everything you do in studio must also be done in card". The rule for what is VIEWING: every
// control the editor's View menu, its zoom group and its Filter menu draw is listed here with a decision, so a new
// editor view control fails this test until someone writes down what the card does about it (CLAUDE.md finding 17).
// The same table is in docs/card.md ("Studio and card"); the last test keeps the two together.

type Decision = { card: "yes"; has: string } | { card: "deliberate"; why: string };
const EDITING_AID = "an editing aid: it helps place and measure things, and a dashboard viewer places nothing";
/** Editor control id -> what the card does. `has` is a selector in the card's shadow root. */
const PARITY: Record<string, Decision> = {
  snap: { card: "deliberate", why: EDITING_AID },
  mgrid: { card: "deliberate", why: EDITING_AID },
  lens: { card: "deliberate", why: EDITING_AID },
  // S26.17: the Labels submenu holds Device names and Names and values; the version moved to the Help panel.
  labelsSub: { card: "yes", has: 'button[aria-label="Labels"]' },
  names: { card: "yes", has: 'button[aria-label="Device names"]' },
  labels: { card: "yes", has: 'button[aria-label="Labels"]' },
  night: { card: "deliberate", why: "a preview of what the card already does: it goes dark after sunset by itself (`night`, `sun`)" },
  // S27.11: the card's Floor below button (2D and 2.5D); in 3D the same choice is the Floors below select, checked below.
  ghostFloor: { card: "yes", has: 'button[aria-label="Floor below"]' },
  thSub: { card: "yes", has: 'select[aria-label="Theme"]' },
  recenter: { card: "yes", has: 'button[aria-label="Fit"]' },
  fit: { card: "yes", has: 'button[aria-label="Fit"]' },
  copyCardView: { card: "deliberate", why: "authoring: it writes the card's own `center` and `zoom_level`" },
  // S24.6: Layers replaced the Filter menu; S24.8 gives the card a text chip per family in its Overview, unfolded by this button.
  // S25.8: the Detail button beside Layers, same three choices; the card starts on Auto, the Studio on Full.
  detailSub: { card: "yes", has: ".fp-ov-scopes button.fp-detail-toggle" },
  tabLayers: { card: "yes", has: ".fp-ov-scopes button.fp-layers-toggle" },
  zin: { card: "yes", has: 'button[aria-label="Zoom in"]' },
  zout: { card: "yes", has: 'button[aria-label="Zoom out"]' },
  zreset: { card: "yes", has: 'button[aria-label="Reset view"]' },
  vrotl: { card: "yes", has: 'button[aria-label="Rotate left"]' },
  vrotr: { card: "yes", has: 'button[aria-label="Rotate right"]' },
};

/** S12.1: the editor has no 2.5D, so these three are card only (the card keeps 2.5D as its low-power view). They are not
 * in PARITY, which is keyed by editor control; the card must still have them, and the editor must not. */
const CARD_ONLY: Record<string, string> = {
  "view-mode": 'select[aria-label="View"]',
  tilt: 'input[aria-label="Tilt"]',
  walls: 'select[aria-label="Walls"]',
};

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");
const HARNESS = pathToFileURL(resolve("tests/card/harness.html")).href;

test("every view control of the editor has a decision for the card", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await expect(page.locator("floorplan-studio-editor svg polygon[data-r]").first()).toBeVisible();
  const ids = await page.evaluate(() => {
    const root = document.querySelector("floorplan-studio-editor")!.shadowRoot!;
    return [...root.querySelectorAll("#mOpt [id], .zoom [id], #tabLayers")].map((e) => e.id).filter(Boolean);
  });
  expect(ids.length).toBeGreaterThan(15); // the scrape found the menus at all
  const undecided = ids.filter((id) => !(id in PARITY));
  expect(undecided, `New editor view control(s) with no card decision: add them to PARITY here and to docs/card.md ("Studio and card"): ${undecided.join(", ")}`).toEqual([]);
  for (const id of Object.keys(CARD_ONLY)) expect(ids, `#${id} is card only: the editor has no 2.5D`).not.toContain(id);
  const gone = Object.keys(PARITY).filter((id) => !ids.includes(id));
  expect(gone, `PARITY names editor controls that no longer exist: ${gone.join(", ")}`).toEqual([]);
});

test("every control the card is said to have is on a 2.5D card", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(HARNESS);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(async (layout) => {
    const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig({ type: "custom:floorplan-studio-card", view: "2.5d", layout });
    el.hass = { states: {}, themes: { darkMode: false } };
    await el.updateComplete;
  }, demo);
  for (const [id, d] of Object.entries(PARITY)) {
    if (d.card !== "yes") continue;
    await expect(page.locator("floorplan-studio-card").locator(`css=${d.has}`), `${id}: ${d.has}`).toHaveCount(1);
  }
  for (const [id, has] of Object.entries(CARD_ONLY)) await expect(page.locator("floorplan-studio-card").locator(`css=${has}`), `${id}: ${has}`).toHaveCount(1);
});

test("in 3D the Floor below choice is the Floors below select, and the button is gone", async ({ page }) => {
  await serve(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${ORIGIN}/harness.html`);
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate((layout) => {
    const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig({ type: "custom:floorplan-studio-card", view: "3d", layout, floor: "first", active_list: false });
    el.hass = { states: {}, callService: () => undefined };
    return el.updateComplete;
  }, demo);
  await expect(page.locator("floorplan-studio-card").locator('css=select[aria-label="Floors below"]')).toHaveCount(1);
  await expect(page.locator("floorplan-studio-card").locator('css=button[aria-label="Floor below"]')).toHaveCount(0);
});

test("docs/card.md lists every control and its decision", () => {
  const doc = readFileSync("docs/card.md", "utf8");
  for (const [id, d] of Object.entries(PARITY)) {
    const row = doc.split("\n").find((l) => l.includes(`\`#${id}\``));
    expect(row, `docs/card.md "Studio and card" has no row for #${id}`).toBeTruthy();
    const cells = row!.split("|").map((c) => c.trim());
    expect(cells[2], `#${id}: the "In the card" cell`).toBe(d.card === "yes" ? "yes" : "no");
  }
});
