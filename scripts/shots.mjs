// Renders the demo plan through the built card and editor and writes PNGs to shots/current/, plus a contact
// sheet (shots/current/index.html) so a person or an agent can look at every state in one go.
//
// Why this exists: three S2.9 defects passed lint, unit tests and computed-style pairs while the pixel was
// wrong. Only rendering the plan and looking caught them. This makes the looking cheap enough to do on
// every task that touches render.ts or a stylesheet.
//
//   npm run shots             build, then render; report which images differ from shots/baseline/
//   npm run shots -- --accept copy shots/current/ over shots/baseline/ (after you have looked)
//   npm run shots -- --strict exit 1 when any image differs from the baseline
//
// The baseline is local and gitignored: PNGs differ between machines (fonts, antialiasing), so a committed
// baseline would fail everywhere but where it was made. Only demo/ is ever drawn; no personal layout.
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, copyFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = new Set(process.argv.slice(2));
const OUT = "shots/current";
const BASE = "shots/baseline";
const CARD = "dist/floorplan-studio-card.js";
const EDITOR = "dist/editor.html";
for (const f of [CARD, EDITOR]) {
  if (!existsSync(f)) {
    console.error(`Missing ${f}. Run \`npm run build\` first, or use \`npm run shots\`, which builds.`);
    process.exit(1);
  }
}
const layout = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const cardJs = readFileSync(CARD, "utf8");

// One entity table for the whole demo. `off` is every device at rest; `on` is every device doing its thing.
const now = () => new Date().toISOString();
const st = (state, attributes = {}) => ({ state, attributes, last_changed: now() });
const STATES = {
  off: {
    "light.demo_kitchen": "off", "light.demo_living": "off", "light.demo_bedroom": "off", "switch.demo_hall": "off",
    "switch.demo_tv_plug": "off", "binary_sensor.demo_hall_motion": "off", "climate.demo_living": "off",
    "media_player.demo_office": "idle", "camera.demo_hall": "idle", "sensor.demo_living_temperature": "21.5",
    "sensor.demo_bedroom_temperature": "19", "sensor.demo_bathroom_humidity": "54",
  },
  on: {
    "light.demo_kitchen": ["on", { rgb_color: [255, 170, 60] }], "light.demo_living": "on", "light.demo_bedroom": "on",
    "switch.demo_hall": "on", "switch.demo_tv_plug": "on", "binary_sensor.demo_hall_motion": "on", "climate.demo_living": "heat",
    "media_player.demo_office": "playing", "camera.demo_hall": "streaming", "sensor.demo_living_temperature": "23.5",
    "sensor.demo_bedroom_temperature": "12,5", // a comma decimal: must read as no value, never as a number (S2.5)
    "sensor.demo_bathroom_humidity": "unavailable",
  },
  gone: Object.fromEntries(Object.keys({
    "light.demo_kitchen": 0, "light.demo_living": 0, "light.demo_bedroom": 0, "switch.demo_hall": 0, "switch.demo_tv_plug": 0,
    "binary_sensor.demo_hall_motion": 0, "climate.demo_living": 0, "media_player.demo_office": 0, "camera.demo_hall": 0,
    "sensor.demo_living_temperature": 0, "sensor.demo_bedroom_temperature": 0, "sensor.demo_bathroom_humidity": 0,
  }).map((k) => [k, "unavailable"])),
};
// S7.6: after sunset, every device at rest but the kitchen light, so one room stays bright and the rest go dark.
STATES.night = { ...STATES.off, "light.demo_kitchen": ["on", { rgb_color: [255, 170, 60] }], "sun.sun": "below_horizon" };
function hassFor(which, dark) {
  const states = {};
  for (const [id, v] of Object.entries(STATES[which])) states[id] = Array.isArray(v) ? st(v[0], v[1]) : st(v);
  return { states, themes: { darkMode: dark } }; // no callService: a function cannot be sent into the page, and nothing here clicks
}

// S2.13: the monitored types on their own, on the ground floor, beside the demo's devices. Grey on the disc, in every theme.
const MON = ["battery", "inverter", "server", "access_point"];
const monLayout = structuredClone(layout);
MON.forEach((t, i) => monLayout.floors.ground.devices.push({ id: `mon-${t}`, type: t, entity: `sensor.demo_${t}`, x: 500 + i * 70, y: 500 }));

const shots = [];
const errors = [];
mkdirSync("shots", { recursive: true });
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
try {
  // Themes: blueprint (the default), light, and Home Assistant's own, drawn under stand-in HA variables in a light and a dark set.
  const HA_VARS = {
    light: "--primary-text-color:#212121;--secondary-text-color:#727272;--card-background-color:#ffffff;--secondary-background-color:#e5e5e5",
    dark: "--primary-text-color:#e1e1e1;--secondary-text-color:#9b9b9b;--card-background-color:#1c1c1c;--secondary-background-color:#282828",
  };
  const THEMES = [
    { id: "blueprint", theme: "blueprint", dark: false, vars: "", page: "#0d1522" },
    { id: "light", theme: "light", dark: false, vars: "", page: "#fff" },
    { id: "ha-light", theme: "ha", dark: false, vars: HA_VARS.light, page: "#fafafa" },
    { id: "ha-dark", theme: "ha", dark: true, vars: HA_VARS.dark, page: "#111111" },
  ];
  const cardShots = [];
  for (const floor of Object.keys(layout.floors)) for (const which of Object.keys(STATES)) for (const t of THEMES) {
    if (which === "night") continue; // below: ground floor, two themes
    cardShots.push({ name: `card-${floor}-${which}-${t.id}`, floor, which, dark: t.dark, theme: t.theme, vars: t.vars, page: t.page });
  }
  for (const t of THEMES.filter((x) => x.id === "blueprint" || x.id === "light"))
    cardShots.push({ name: `card-ground-night-${t.id}`, floor: "ground", which: "night", dark: t.dark, theme: t.theme, vars: t.vars, page: t.page });
  for (const s of cardShots) {
    const ctx = await browser.newContext({ viewport: { width: 900, height: 700 }, colorScheme: "light", reducedMotion: "reduce" });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${s.name}: ${e}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`${s.name}: console.error ${m.text()}`); });
    await page.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0;padding:12px;background:${s.page};${s.vars}"><floorplan-studio-card id="c"></floorplan-studio-card></body>`);
    await page.addScriptTag({ content: cardJs, type: "module" });
    await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
    await page.evaluate(([config, hass]) => {
      const el = document.getElementById("c");
      el.setConfig(config); el.hass = hass;
      return el.updateComplete;
    }, [{ layout: s.floor === "ground" ? monLayout : layout, floor: s.floor, theme: s.theme }, hassFor(s.which, s.dark)]);
    const nodes = await page.evaluate(() => document.getElementById("c").shadowRoot.querySelectorAll("svg *").length);
    if (nodes < 10) errors.push(`${s.name}: the plan drew ${nodes} nodes; something is wrong before you even look`);
    await page.locator("floorplan-studio-card").screenshot({ path: `${OUT}/${s.name}.png` });
    shots.push(s.name);
    await ctx.close();
  }
  for (const theme of ["blueprint", "light", "ha"]) {
    const name = `editor-${theme}`;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "light", reducedMotion: "reduce" });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
    await page.addInitScript((t) => localStorage.setItem("floorplan-studio:theme", t), theme);
    await page.goto(pathToFileURL(resolve(EDITOR)).href);
    await page.locator("floorplan-studio-editor svg polygon[data-r]").first().waitFor();
    await page.screenshot({ path: `${OUT}/${name}.png` });
    shots.push(name);
    await ctx.close();
  }
} finally {
  await browser.close();
}

// Compare with the baseline byte for byte. Same machine, same build, same pixels: any difference is a change.
const same = (n) => existsSync(`${BASE}/${n}.png`) && readFileSync(`${BASE}/${n}.png`).equals(readFileSync(`${OUT}/${n}.png`));
const hasBase = existsSync(BASE);
const changed = hasBase ? shots.filter((n) => !same(n)) : [];
const cell = (n) => {
  const tag = !hasBase ? "" : !existsSync(`${BASE}/${n}.png`) ? " <b>NEW</b>" : same(n) ? "" : " <b>CHANGED</b>";
  return `<figure><img src="${n}.png" alt="${n}"><figcaption>${n}${tag}</figcaption></figure>`;
};
writeFileSync(`${OUT}/index.html`, `<!doctype html><meta charset="utf-8"><title>floorplan shots</title>
<style>body{font:13px system-ui;margin:16px}section{display:flex;flex-wrap:wrap;gap:12px}figure{margin:0;width:440px}img{width:100%;border:1px solid #ccc}b{color:#c33}</style>
<h1>floorplan shots</h1>${hasBase ? `<p>${changed.length} of ${shots.length} differ from shots/baseline.</p>` : "<p>No baseline yet: run with --accept once you have looked.</p>"}
<section>${shots.map(cell).join("")}</section>`);

if (args.has("--accept")) {
  rmSync(BASE, { recursive: true, force: true });
  mkdirSync(BASE, { recursive: true });
  for (const f of readdirSync(OUT).filter((n) => n.endsWith(".png"))) copyFileSync(`${OUT}/${f}`, `${BASE}/${f}`);
  console.log(`baseline updated: ${shots.length} images`);
}

console.log(`${shots.length} images in ${OUT}/ (open ${OUT}/index.html)`);
if (hasBase && !args.has("--accept")) console.log(changed.length ? `differs from baseline: ${changed.join(", ")}` : "identical to baseline");
if (errors.length) {
  console.error(`\n${errors.length} problem(s):\n${errors.join("\n")}`);
  process.exit(1);
}
if (args.has("--strict") && changed.length) process.exit(1);
