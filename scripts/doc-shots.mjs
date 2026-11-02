// node scripts/doc-shots.mjs
//
// Renders the screenshots of README.md, docs/editor.md and docs/card.md into docs/img/, all from the demo home
// (demo/home.json with the evening states of demo/home-states.json; scripts/demo-home.mjs). Only demo/ is ever
// drawn, same rule as scripts/shots.mjs — no personal layout in a committed doc image. Run this again, and commit
// the result, whenever the editor toolbar, a menu shown in the doc, or the card's look changes enough that a
// screenshot would mislead.
import { chromium } from "@playwright/test";
import { cardSource } from "./card-source.mjs";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { home as layout, homeHass } from "./demo-home.mjs";

const CARD = "dist/floorplan-studio-card.js";
const EDITOR = "dist/editor.html";
const CARD_3D_DIR = "dist-test"; // the card with the 3D test hook: FP_TEST_BUILD=1 node scripts/build.mjs, as `npm run shots` does
for (const f of [CARD, EDITOR]) {
  if (!existsSync(f)) { console.error(`Missing ${f}. Run \`npm run build\` first.`); process.exit(1); }
}
if (!existsSync(`${CARD_3D_DIR}/floorplan-studio-card.js`)) { console.error(`Missing ${CARD_3D_DIR}/. Run \`FP_TEST_BUILD=1 node scripts/build.mjs\` first.`); process.exit(1); }
const OUT = "docs/img";
mkdirSync(OUT, { recursive: true });
const cardJs = cardSource(); // the card with its Overview chunk inlined (a page of inline modules cannot fetch the chunk)
const hass = homeHass();
const errors = [];

const browser = await chromium.launch();
try {
  // card-overview.png: the demo ground floor, blueprint theme, a light and the motion sensor on.
  {
    const ctx = await browser.newContext({ viewport: { width: 900, height: 700 }, colorScheme: "light", reducedMotion: "reduce" });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`card-overview: ${e}`));
    await page.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0;padding:12px;background:#fff"><floorplan-studio-card id="c"></floorplan-studio-card></body>`);
    await page.addScriptTag({ content: cardJs, type: "module" });
    await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
    await page.evaluate(([config, h]) => {
      const el = document.getElementById("c");
      el.setConfig(config); el.hass = h;
      return el.updateComplete;
    }, [{ layout, floor: "ground", theme: "blueprint" }, hass]);
    const nodes = await page.evaluate(() => document.getElementById("c").shadowRoot.querySelectorAll("svg *").length);
    if (nodes < 10) errors.push(`card-overview: the plan drew ${nodes} nodes`);
    await page.locator("floorplan-studio-card").screenshot({ path: `${OUT}/card-overview.png` });
    await ctx.close();
  }

  // card-2-5d.png: the same floor with `view: 2.5d`, the View dropdown and Tilt slider showing next to the zoom
  // buttons. The Active list is off so it does not cover the plan. The tilt and labels variants are the same card
  // with one more key: tilt 0 (top-down) and 1 (side-on), and `labels: false` in 2D and 2.5D.
  const variants = [
    ["card-2-5d", {}],
    ["card-2-5d-tilt-0", { tilt: 0 }],
    ["card-2-5d-tilt-1", { tilt: 1 }],
    ["card-labels-off", { view: "2d", labels: false }],
    // Text turns with the plan only as a position, never as an angle, so it stays readable.
    ["card-rotated-45", { view: "2d", rotation: 45 }],
  ];
  for (const [name, extra] of variants) {
    const ctx = await browser.newContext({ viewport: { width: 900, height: 700 }, colorScheme: "light", reducedMotion: "reduce" });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
    await page.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0;padding:12px;background:#fff"><floorplan-studio-card id="c"></floorplan-studio-card></body>`);
    await page.addScriptTag({ content: cardJs, type: "module" });
    await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
    await page.evaluate(([config, h]) => {
      const el = document.getElementById("c");
      el.setConfig(config); el.hass = h;
      return el.updateComplete;
    }, [{ layout, floor: "ground", theme: "blueprint", view: "2.5d", active_list: false, ...extra }, hass]);
    const nodes = await page.evaluate(() => document.getElementById("c").shadowRoot.querySelectorAll("svg *").length);
    if (nodes < 10) errors.push(`${name}: the plan drew ${nodes} nodes`);
    await page.locator("floorplan-studio-card").screenshot({ path: `${OUT}/${name}.png` });
    await ctx.close();
  }

  // The 3D shots. The 3D chunk is a second file the card fetches, so the card is loaded the way Home Assistant loads it, from a
  // URL, with dist-test/ served under a fake origin (tests/card/harness-static.html, the card tests' own page). Nothing else is
  // fetched. The camera glides in: shoot once it has stood still.
  const shoot3d = async (name, { width, height, config, states = hass, sheet = false, touch = false }) => {
    const ctx3 = await browser.newContext({ viewport: { width, height }, colorScheme: "light", reducedMotion: "reduce", hasTouch: touch });
    const p3 = await ctx3.newPage();
    p3.on("pageerror", (e) => errors.push(`${name}: ${e}`));
    await p3.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== "http://fp.test") return route.abort();
      if (url.pathname === "/harness.html") return route.fulfill({ body: readFileSync("tests/card/harness-static.html"), contentType: "text/html" });
      const m = /^\/floorplan_studio_static\/([\w.-]+)$/.exec(url.pathname), file = m && resolve(CARD_3D_DIR, m[1]);
      if (!file || !existsSync(file)) return route.fulfill({ status: 404, body: "not found" });
      return route.fulfill({ body: readFileSync(file), contentType: "text/javascript" });
    });
    await p3.goto("http://fp.test/harness.html");
    await p3.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
    await p3.evaluate(([w, h]) => { const wrap = document.getElementById("wrap"); wrap.style.width = `${w}px`; wrap.style.height = `${h}px`; document.body.style.margin = "0"; }, [width, height]);
    await p3.evaluate(([cfg, h]) => { const el = document.getElementById("card"); el.setConfig(cfg); el.hass = h; return el.updateComplete; }, [config, states]);
    await p3.locator("floorplan-studio-card canvas").waitFor();
    if (sheet) {
      await p3.locator("floorplan-studio-card .fp-handle").click();
      await p3.locator('floorplan-studio-card .fp-bottom[data-stop="half"]').waitFor();
    }
    let prev = "", same = 0;
    for (let i = 0; i < 100 && same < 4; i++) {
      const at = await p3.locator("floorplan-studio-card canvas").evaluate((c) => c.parentElement.getAttribute("data-az") + c.parentElement.getAttribute("data-polar") + c.parentElement.getAttribute("data-dist"));
      same = at === prev ? same + 1 : 0; prev = at; await p3.waitForTimeout(250);
    }
    if (prev.includes("null")) errors.push(`${name}: the 3D test hook is missing, so the shot may be taken mid-glide`);
    await p3.locator("floorplan-studio-card").screenshot({ path: `${OUT}/${name}.png` });
    await ctx3.close();
  };

  // card-3d.png: the README hero, the demo ground floor in 3D on a quiet evening. The Overview is off so the house has the whole card.
  await shoot3d("card-3d", { width: 1100, height: 700, config: { layout, floor: "ground", view: "3d", theme: "blueprint", kiosk: true } });

  // card-phone.png: the card on a phone, 390 px wide, the Overview sheet pulled up to its half stop: what is wrong first (the
  // armed alarm, the open dining window), then what is on. In 3D the camera frames the house above the sheet.
  await shoot3d("card-phone", { width: 390, height: 780, config: { layout, floor: "ground", view: "3d", theme: "blueprint" }, sheet: true, touch: true });

  // editor-overview.png: the full editor, blueprint theme, the demo home loaded the way a user does it (File, Reset, File,
  // Load demo), the ground floor shown, nothing selected. The room and device indices below are the ground floor's:
  // room 0 is Living, device 0 is the Living light (demo/home.json).
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "light", reducedMotion: "reduce" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`editor: ${e}`));
  await page.addInitScript((t) => localStorage.setItem("floorplan-studio:theme", t), "blueprint");
  await page.goto(pathToFileURL(resolve(EDITOR)).href);
  await page.locator("floorplan-studio-editor svg polygon[data-r]").first().waitFor();
  if (await page.locator("#fixPlan").isChecked()) await page.locator("label.lockplan").click(); // a locked plan refuses Reset
  page.once("dialog", (d) => d.accept());
  await page.locator('details.menu > summary:text-is("File")').click();
  await page.locator("#reset").click();
  await page.locator("#loaddemo:enabled").waitFor({ state: "attached" }); // Reset has emptied the plan
  if (!(await page.locator("#loaddemo").isVisible())) await page.locator('details.menu > summary:text-is("File")').click();
  await page.locator("#loaddemo").click();
  await page.locator('.chip[data-f="ground"]').click();
  await page.locator("floorplan-studio-editor svg polygon[data-r]").first().waitFor();
  if ((await page.locator("floorplan-studio-editor svg polygon[data-r]").count()) !== layout.floors.ground.rooms.length) errors.push("editor-overview: the ground floor did not load");
  await page.mouse.click(1000, 780); // off the plan: closes the File menu
  await page.locator("#bannerClose").click(); // the "Demo home loaded" note covers the ruler
  await page.screenshot({ path: `${OUT}/editor-overview.png` });

  // editor-add-menu.png: the Add menu open, showing the furniture/device/area submenus.
  await page.locator('details.menu > summary:text-is("Add")').click();
  await page.screenshot({ path: `${OUT}/editor-add-menu.png` });
  await page.mouse.click(500, 700); // empty canvas: closes the open menu, same as a user clicking away

  // editor-room-panel.png: a room selected, its panel open, the sensor pickers in their framed boxes.
  {
    const room = await page.locator('polygon[data-r="0"]').first().boundingBox();
    if (!room) errors.push("editor-room-panel: no box for polygon[data-r=\"0\"]");
    else {
      // A point no device or furniture stands on: try a few until the panel is the room's (its title is "Room").
      let hit = false;
      for (const [fx, fy] of [[0.9, 0.9], [0.5, 0.5], [0.3, 0.2], [0.7, 0.2], [0.1, 0.5], [0.9, 0.5], [0.2, 0.9]]) {
        await page.mouse.click(room.x + room.width * fx, room.y + room.height * fy);
        await page.locator("#panel").waitFor();
        const first = (await page.locator("#panel").innerText()).trim().split("\n")[0];
        if (first === "Room") { hit = true; break; }
      }
      if (!hit) errors.push("editor-room-panel: no free point in the room, the panel never showed the room");
      await page.screenshot({ path: `${OUT}/editor-room-panel.png` });
      await page.keyboard.press("Escape");
    }
  }

  // editor-device-panel.png: a device selected, its panel open on the right.
  const box = await page.locator('g[data-x="0"]').first().boundingBox();
  if (!box) errors.push("editor-device-panel: no box for g[data-x=\"0\"]");
  else {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.locator("#panel").waitFor();
    await page.screenshot({ path: `${OUT}/editor-device-panel.png` });
  }
  await ctx.close();
} finally {
  await browser.close();
}

if (errors.length) { for (const e of errors) console.error(e); process.exit(1); }
console.log(`wrote the card, phone, 3D and editor screenshots to ${OUT}/`);
