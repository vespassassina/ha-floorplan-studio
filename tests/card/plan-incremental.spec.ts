import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// S25.6 exit test of the sprint: one sensor update writes only its device. A MutationObserver on the real plan <svg> in the
// built card, a real `hass` update through the setter Home Assistant uses. Same harness as card-tooltip-stale.spec.ts.

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));
const stress = JSON.parse(readFileSync("tests/fixtures/stress-layout.json", "utf8"));
const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");

const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-04T09:30:15Z" });
const STATES = () => ({
  "light.demo_living": st("on", { friendly_name: "Living light", supported_color_modes: ["onoff"] }),
  "light.demo_kitchen": st("on", { supported_color_modes: ["onoff"] }),
  "switch.demo_hall": st("off"), "switch.demo_tv_plug": st("on"),
  "sensor.demo_living_temperature": st("21.5", { unit_of_measurement: "°C" }),
  "climate.demo_living": st("heat"), "camera.demo_hall": st("idle"),
});

type Seen = { dev: string | null; tag: string; cls: string };
async function boot(page: Page, layout: unknown, floor: string, states: Record<string, unknown>) {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto(URL_);
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(([config, states]) => {
    const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(config);
    el.hass = { states, callService: () => {} };
    return el.updateComplete;
  }, [{ layout, floor }, states] as const);
}
/** Set `hass` to `states` and return what changed under the plan <svg>: which device group (or none) each mutated node sits in. */
async function update(page: Page, states: Record<string, unknown>) {
  return page.evaluate(async (states) => {
    const el = document.getElementById("card") as unknown as HTMLElement & { hass: unknown; updateComplete: Promise<unknown> };
    const svg = el.shadowRoot!.querySelector("svg")!;
    const seen: Seen[] = [];
    const describe = (n: Node) => { const e = n instanceof Element ? n : n.parentElement; return { dev: e?.closest("g[data-x]")?.getAttribute("data-x") ?? null, tag: e?.tagName ?? "?", cls: e?.getAttribute("class") ?? "" }; };
    const mo = new MutationObserver((l) => l.forEach((r) => seen.push(describe(r.target))));
    mo.observe(svg, { subtree: true, childList: true, attributes: true, characterData: true });
    const t0 = performance.now();
    el.hass = { states, callService: () => {} };
    await el.updateComplete;
    const ms = performance.now() - t0;
    await new Promise((r) => setTimeout(r, 0));
    mo.takeRecords().forEach((r) => seen.push(describe(r.target)));
    mo.disconnect();
    return { seen, ms };
  }, states);
}

test.describe("S25.6 incremental render, demo", () => {
  test("one lamp changing writes its own group and its dependents, nothing else", async ({ page }) => {
    await boot(page, structuredClone(demo), "ground", STATES());
    const before = await page.evaluate(() => { const svg = document.getElementById("card")!.shadowRoot!.querySelector("svg")!; (window as unknown as { __g1: Element }).__g1 = svg.querySelector('g[data-x="2"]')!; return svg.querySelectorAll("*").length; });
    const { seen } = await update(page, { ...STATES(), "light.demo_kitchen": st("off", { supported_color_modes: ["onoff"] }) });
    expect(seen.length, "something did change").toBeGreaterThan(0);
    expect(seen.length, `of ${before} nodes`).toBeLessThan(25);
    // The kitchen light is device 1. Any other device group in the list is a defect; the rest are its dependents (aura, room glow, badge, night).
    for (const s of seen) if (s.dev !== null) expect(s.dev, JSON.stringify(s)).toBe("1");
    for (const s of seen) if (s.dev === null) expect(s.cls + " " + s.tag, "a dependent of a lamp").toMatch(/aura|room|badge|night|lit|glow|defs|clip|mask|circle|text|polygon|^\s?g$/i);
    // The node of another device is the same node as before: nothing was replaced.
    expect(await page.evaluate(() => (window as unknown as { __g1: Element }).__g1 === document.getElementById("card")!.shadowRoot!.querySelector('svg g[data-x="2"]'))).toBe(true);
  });
  test("an entity that no device reads writes nothing at all", async ({ page }) => {
    await boot(page, structuredClone(demo), "ground", STATES());
    const { seen } = await update(page, { ...STATES(), "sensor.not_on_any_plan": st("5") });
    expect(seen).toEqual([]);
  });
  test("the same states again write nothing", async ({ page }) => {
    await boot(page, structuredClone(demo), "ground", STATES());
    const { seen } = await update(page, STATES());
    expect(seen).toEqual([]);
  });
  test("a theme change still redraws (a full render happens for what is not a state)", async ({ page }) => {
    await boot(page, structuredClone(demo), "ground", STATES());
    await page.evaluate(() => { const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; _config: object }; el.setConfig({ ...el._config, theme: "light" }); });
    await expect.poll(() => page.evaluate(() => document.getElementById("card")!.shadowRoot!.querySelector("svg > g")!.getAttribute("data-theme"))).toBe("light");
  });
});

test.describe("S25.6 incremental render, 400 devices", () => {
  const key = Object.keys(stress.floors)[0]!;
  const big = () => {
    const l = structuredClone(stress), f = l.floors[key];
    const base = f.devices.filter((d: Record<string, unknown>) => typeof d.x === "number" && typeof d.y === "number");
    f.devices = Array.from({ length: 400 }, (_, i) => ({ id: `gen-${i}`, type: i % 4 ? "light" : "motion", entity: `light.gen_${i}`, name: `Gen ${i}`, x: base[i % base.length].x + (i % 7), y: base[i % base.length].y + (i % 5) }));
    return l;
  };
  const states = (flip: number[] = [], all?: string) => Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`light.gen_${i}`, st(all ?? (flip.includes(i) ? "on" : "off"), { friendly_name: `Gen ${i}` })]));
  test("one device of 400: its group and dependents only; timing of a full update recorded", async ({ page }, info) => {
    await boot(page, big(), key, states());
    const count = await page.evaluate(() => document.getElementById("card")!.shadowRoot!.querySelectorAll("svg g[data-x]").length);
    expect(count).toBeGreaterThanOrEqual(300);
    await page.evaluate(() => { (window as unknown as { __g7: Element }).__g7 = document.getElementById("card")!.shadowRoot!.querySelector('svg g[data-x="7"]')!; });
    const one = await update(page, states([5]));
    expect(one.seen.some((s) => s.tag.toLowerCase() === "svg"), "the plan's root is not rewritten").toBe(false);
    expect(await page.evaluate(() => (window as unknown as { __g7: Element }).__g7 === document.getElementById("card")!.shadowRoot!.querySelector('svg g[data-x="7"]')), "device 7 is the same node").toBe(true);
    expect(one.seen.length).toBeGreaterThan(0);
    for (const s of one.seen) if (s.dev !== null) expect(s.dev, JSON.stringify(s)).toBe("5");
    expect(one.seen.length, "nodes written").toBeLessThan(40);
    const none = await update(page, { ...states([5]), "sensor.elsewhere": st("1") });
    expect(none.seen).toEqual([]);
    const all = await update(page, states([], "on"));
    const back = await update(page, states([], "off"));
    info.annotations.push({ type: "timing", description: `400 devices: one change ${one.ms.toFixed(1)} ms (${one.seen.length} nodes), all 400 on ${all.ms.toFixed(1)} ms (${all.seen.length} nodes), all off ${back.ms.toFixed(1)} ms` });
    console.log(`TIMING 400 devices: one change ${one.ms.toFixed(1)} ms (${one.seen.length} nodes), all 400 on ${all.ms.toFixed(1)} ms (${all.seen.length} nodes), all off ${back.ms.toFixed(1)} ms`);
  });
});
