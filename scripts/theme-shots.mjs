// node scripts/theme-shots.mjs
//
// Renders the demo home's ground floor once per theme (docs/SPEC.md's THEMES list) and lays the thirteen shots out as one
// grid, docs/img/themes.png, for the README. The home is demo/home.json with the evening states of demo/home-states.json
// (scripts/demo-home.mjs). Only demo/ is ever drawn, same rule as scripts/shots.mjs — no personal layout in a committed
// doc image. Run this again, and commit the result, whenever a theme is added, removed or re-palette'd.
import { chromium } from "@playwright/test";
import { cardSource } from "./card-source.mjs";
import { readFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { home as layout, homeHass } from "./demo-home.mjs";

const CARD = "dist/floorplan-studio-card.js";
if (!existsSync(CARD)) { console.error(`Missing ${CARD}. Run \`npm run build\` first.`); process.exit(1); }
const OUT = "docs/img";
mkdirSync(OUT, { recursive: true });
const cardJs = cardSource(); // the card with its Overview chunk inlined (a page of inline modules cannot fetch the chunk)
const hass = homeHass();

const THEMES = ["blueprint", "midnight", "light", "slate", "terminal", "solarized", "ha", "coffee", "a-team", "space", "cyberpunk", "carpenter-brut", "beach-house"];
const COLUMNS = 4, CELL = 440; // the grid is 1,760 px wide; the README shows it at the page's width
const errors = [];
const scratch = mkdtempSync(join(tmpdir(), "fp-themes-"));

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 640 }, colorScheme: "light", reducedMotion: "reduce" });
  const shots = [];
  for (const theme of THEMES) {
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${theme}: ${e}`));
    // A neutral grey page background, not white: light/ha/slate's own light plan otherwise has no
    // visible edge against GitHub's white README background, and the gallery loses its card framing.
    // kiosk: the plan alone, no header or sheet, so every cell of the grid is the house and nothing else.
    await page.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0;padding:12px;background:#d8dade"><floorplan-studio-card id="c" style="height:616px"></floorplan-studio-card></body>`);
    await page.addScriptTag({ content: cardJs, type: "module" });
    await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
    await page.evaluate(([config, h]) => {
      const el = document.getElementById("c");
      el.setConfig(config); el.hass = h;
      return el.updateComplete;
    }, [{ layout, floor: "ground", theme, kiosk: true }, hass]);
    const nodes = await page.evaluate(() => document.getElementById("c").shadowRoot.querySelectorAll("svg *").length);
    if (nodes < 10) errors.push(`${theme}: the plan drew ${nodes} nodes`);
    const file = join(scratch, `${theme}.png`);
    await page.locator("floorplan-studio-card").screenshot({ path: file });
    shots.push([theme, readFileSync(file).toString("base64")]);
    await page.close();
  }
  await ctx.close();

  // The grid: one page of <img>s, shot once. The label is the value of `theme:`, as a reader would type it.
  const rows = Math.ceil(THEMES.length / COLUMNS), width = COLUMNS * CELL + (COLUMNS + 1) * 16;
  const cells = shots.map(([theme, b64]) => `<figure><img src="data:image/png;base64,${b64}" alt=""><figcaption>${theme}</figcaption></figure>`).join("");
  const gctx = await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: 1 });
  const gpage = await gctx.newPage();
  await gpage.setContent(`<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; padding: 16px; background: #f4f5f7; font: 600 18px/1.2 ui-monospace, Menlo, monospace; color: #1d2330; }
    .g { display: grid; grid-template-columns: repeat(${COLUMNS}, ${CELL}px); gap: 16px; }
    figure { margin: 0; } img { display: block; width: ${CELL}px; border-radius: 8px; }
    figcaption { padding: 8px 2px 0; }
  </style><div class="g">${cells}</div>`);
  await gpage.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
  await gpage.screenshot({ path: `${OUT}/themes.png`, fullPage: true });
  await gctx.close();
  console.log(`${rows} rows of ${COLUMNS}`);
} finally {
  await browser.close();
  rmSync(scratch, { recursive: true, force: true });
}

if (errors.length) { for (const e of errors) console.error(e); process.exit(1); }
console.log(`wrote ${THEMES.length} themes to ${OUT}/themes.png`);
