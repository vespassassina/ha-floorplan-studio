import { test, expect, type Page } from "@playwright/test";
import { demo, serve, ORIGIN, card, drawn } from "./helpers-3d";
import { FLOORPLAN_CSS, THEMES } from "../../src/core/render";

// S14.8 (spec item 24): a plug is tinted from idle to hot by its draw, in 2D, 2.5D and 3D, in every theme. Colours are read back from
// Chromium (CLAUDE.md finding 10), taps and states go through the real card. Demo ground floor: device 3 is the TV plug.

const layoutWith = (power = "sensor.tv_power") => { const l = structuredClone(demo); l.floors.ground.devices[3].power = power; return l; };

async function boot(page: Page, config: Record<string, unknown>) {
  await serve(page);
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto(`${ORIGIN}/harness.html`);
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate((config) => {
    const el = document.getElementById("card") as unknown as { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(config);
    el.hass = { states: {}, callService: () => undefined };
    return el.updateComplete;
  }, { floor: "ground", active_list: false, ...config });
}
async function draw(page: Page, watts: number | null, sw = "on") {
  await page.evaluate(([w, sw]) => {
    const el = document.getElementById("card") as unknown as { hass: unknown; updateComplete: Promise<unknown> };
    const s = (state: string, a: object = {}) => ({ state, attributes: a, last_changed: "2026-10-06T09:00:00Z" });
    el.hass = { states: { "switch.demo_tv_plug": s(sw as string), ...(w === null ? {} : { "sensor.tv_power": s(String(w), { unit_of_measurement: "W" }) }) }, callService: () => undefined };
    return el.updateComplete;
  }, [watts, sw] as const);
}
/** Any CSS colour Chromium reports (rgb(), color(srgb ..), oklch(..) for a mix) as 0..255, read back off a one-pixel canvas. */
const rgb = (page: Page, css: string): Promise<number[]> => page.evaluate((c) => {
  const x = document.createElement("canvas").getContext("2d")!;
  x.fillStyle = c; x.fillRect(0, 0, 1, 1);
  return Array.from(x.getImageData(0, 0, 1, 1).data).slice(0, 3);
}, css);
// S23.4: an on plug is a solid disc in the heat colour; the glyph on it is ink. Read the disc.
const plugFill = (page: Page, view: string) => (view === "3d" ? card(page).locator('css=.fp3-ic[data-i="3"] .halo') : card(page).locator("css=g.dev-plug .halo")).first().evaluate((p) => getComputedStyle(p).fill);
/** What `--fp-dev-plug` resolves to for this plug: the colour a plug with no reading wears. */
const ownPlugColour = async (page: Page, view: string) => rgb(page, await (view === "3d" ? card(page).locator('css=.fp3-ic[data-i="3"] .halo') : card(page).locator("css=g.dev-plug .halo")).first().evaluate((p) => { p.setAttribute("style", "color:var(--fp-dev-plug)"); return getComputedStyle(p).color; }));
const settle = async (page: Page, view: string) => { if (view === "3d") await drawn(page, 2); else await page.waitForTimeout(0); };

for (const theme of ["light", "blueprint"]) for (const view of ["2d", "2.5d", "3d"]) {
  test(`${theme} ${view}: 100 W reads cool, 1000 W warm, 2000 W hot; no sensor is today's colour`, async ({ page }) => {
    await boot(page, { layout: layoutWith(), view, theme });
    if (view === "3d") await drawn(page);
    await draw(page, 100); await settle(page, view);
    const cool = await rgb(page, await plugFill(page, view));
    await draw(page, 1000); await settle(page, view);
    const warm = await rgb(page, await plugFill(page, view));
    await draw(page, 2000); await settle(page, view);
    const hot = await rgb(page, await plugFill(page, view));
    await draw(page, null); await settle(page, view);
    const none = await rgb(page, await plugFill(page, view)); // switch on, no sensor: on as before, no heat
    // asymmetric: three distinct colours, blue falls and red rises along the ramp, and the cool end is the plug's own colour (plus 5 % of the way)
    expect(new Set([cool.join(), warm.join(), hot.join()]).size).toBe(3);
    expect(cool[2]).toBeGreaterThan(cool[0]); // bluish
    expect(hot[0]).toBeGreaterThan(hot[2]); // reddish
    expect(warm[0]).toBeGreaterThan(cool[0]);
    expect(hot[2]).toBeLessThan(cool[2]);
    expect(none, "no sensor: the theme's own plug colour, as before").toEqual(await ownPlugColour(page, view));
    expect(none.join()).not.toBe(hot.join());
  });
}

test("the card options move the range; junk is the default range", async ({ page }) => {
  await boot(page, { layout: layoutWith(), view: "2d", theme: "light", plug_heat_from: 0, plug_heat_to: 200 });
  await draw(page, 200);
  const narrowHot = await rgb(page, await plugFill(page, "2d"));
  await boot(page, { layout: layoutWith(), view: "2d", theme: "light" });
  await draw(page, 200);
  const defaultCool = await rgb(page, await plugFill(page, "2d"));
  expect(narrowHot.join()).not.toBe(defaultCool.join());
  expect(narrowHot[0]).toBeGreaterThan(defaultCool[0]);
  await boot(page, { layout: layoutWith(), view: "2d", theme: "light", plug_heat_from: 900, plug_heat_to: 100 }); // from > to: the default
  await draw(page, 200);
  expect((await rgb(page, await plugFill(page, "2d"))).join()).toBe(defaultCool.join());
});

test("colour is not the only signal: the tooltip and the popup say the watts", async ({ page }) => {
  await boot(page, { layout: layoutWith(), view: "2d", theme: "light" });
  await draw(page, 1234);
  expect(await card(page).locator("css=g.dev-plug title").first().textContent()).toContain("1234 W");
});

test("every theme: the ramp runs from a blue end to a red end on the plan's own stylesheet", async ({ page }) => {
  for (const theme of THEMES) for (const mode of ["light", "dark"]) {
    await page.setContent(`<style>${FLOORPLAN_CSS}</style><svg><g data-theme="${theme}" data-mode="${mode}">${[0, 0.5, 1].map((h) => `<g class="dev dev-plug on" style="--fp-heat:${h}"><circle class="halo" r="5"/><path d="M0 0h5v5z"/></g>`).join("")}</g></svg>`);
    const fills = await page.locator(".halo").evaluateAll((ps) => ps.map((p) => getComputedStyle(p).fill));
    const [cool, mid, hot] = [await rgb(page, fills[0]), await rgb(page, fills[1]), await rgb(page, fills[2])];
    expect(cool[2], `${theme} ${mode} cool`).toBeGreaterThan(cool[0]);
    expect(hot[0], `${theme} ${mode} hot`).toBeGreaterThan(hot[2]);
    expect(new Set([cool.join(), mid.join(), hot.join()]).size, `${theme} ${mode}`).toBe(3);
  }
});
