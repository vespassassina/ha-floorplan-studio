import { test, expect, type Page } from "@playwright/test";
import { demo, open, holder, drawn, serve, ORIGIN } from "./helpers-3d";

// S19.E3 in 3D: the view and its icons resolve `--fp-dev-*` from the .fp-3d box, so layout.colors goes on that box.
test("3D: layout.colors reaches the 3D box and the icons inside it", async ({ page }) => {
  await open(page, { layout: { ...structuredClone(demo), colors: { light: "#123456" } }, floor: "ground", view: "3d" });
  await drawn(page);
  expect(await holder(page).evaluate((el) => getComputedStyle(el).getPropertyValue("--fp-dev-light").trim())).toBe("#123456");
  expect(await holder(page).evaluate((el) => { const i = el.querySelector(".fp3-dev"); return i ? getComputedStyle(i).getPropertyValue("--fp-dev-light").trim() : "no icon"; })).toBe("#123456");
});

test("3D: a layout with no colours leaves the box on the theme's own colour", async ({ page }) => {
  await open(page, { layout: structuredClone(demo), floor: "ground", view: "3d" });
  await drawn(page);
  expect(await holder(page).evaluate((el) => el.getAttribute("style") ?? "")).not.toContain("--fp-dev-");
});

// The CSS var reaching the box is not the lamp mesh wearing it: a lit lamp with no colour of its own resolves `var(--fp-dev-light)`
// on a probe inside the card (view3d.ts resolveColour), then paints its floor pool with it. The pool is the colour lifted and
// warmed, not the raw value (the demo's amber lamp gives #ffc262), so the check is on what follows the entry: two entries with
// the same channels in a different order give pools in that order, and the plain layout gives a warm one. Read from the test hook
// (`__fp3d.live()`, dist-test only).
test("3D: a lit lamp's pool takes its colour from the layout.colors entry", async ({ context }) => {
  const poolOf = async (colors?: Record<string, string>) => {
    const page = await context.newPage(); // a page per layout: `open` routes the page once
    await open(page, { layout: { ...structuredClone(demo), ...(colors ? { colors } : {}) }, floor: "ground", view: "3d" });
    await page.evaluate(() => {
      const el = document.getElementById("card") as unknown as { hass: unknown };
      el.hass = { states: { "light.demo_living": { state: "on", attributes: {}, last_changed: new Date(Date.now() - 600000).toISOString() } }, callService: () => undefined };
    });
    await drawn(page);
    type Hook = { __fp3d: { live(): { pools: { visible: boolean; colour: string }[] } } };
    await expect.poll(() => page.evaluate(() => (window as unknown as Hook).__fp3d.live().pools.some((p) => p.visible))).toBe(true);
    const c = await page.evaluate(() => (window as unknown as Hook).__fp3d.live().pools.find((p) => p.visible)!.colour);
    await page.close();
    return [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16)); // r, g, b
  };
  const [plain, blue, green] = [await poolOf(), await poolOf({ light: "#123456" }), await poolOf({ light: "#125634" })];
  expect(plain[0], "no entry: warm, red over blue").toBeGreaterThan(plain[2]);
  expect(blue[2], "#123456: blue over green over red").toBeGreaterThan(blue[1]);
  expect(blue[1]).toBeGreaterThan(blue[0]);
  expect(green[1], "#125634: green over blue over red").toBeGreaterThan(green[2]);
  expect(green[2]).toBeGreaterThan(green[0]);
});


const HA_DARK = "--primary-text-color:#e1e1e1;--secondary-text-color:#9b9b9b;--card-background-color:#1c1c1c;--secondary-background-color:#282828";
const hook = <T, A = undefined>(page: Page, fn: (h: any, a: A) => T, arg?: A) => page.evaluate(`(${fn.toString()})(window.__fp3d, ${JSON.stringify(arg ?? null)})`) as Promise<Awaited<T>>;
async function rgbAt(page: Page, p: { x: number; y: number }, half = 2) {
  const buf = await page.screenshot({ clip: { x: Math.round(p.x - half), y: Math.round(p.y - half), width: 2 * half, height: 2 * half } });
  return page.evaluate(async (b64) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const g = c.getContext("2d")!; g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data; let r = 0, gg = 0, b = 0; const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
    return [Math.round(r / n), Math.round(gg / n), Math.round(b / n)];
  }, buf.toString("base64"));
}
const L = (c: number[]) => Math.round(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]);

// S28.9: the 3D lighting reads as one scene in every theme, and user paint is dimmed on a dark theme as the 2D plan dims it.
// Probe: the Living room painted, furniture and openings cleared, az 0, polar 0.45, walls full. Points: a wall top, the sun-side
// (south) face, the shade-side (west) face, bare floor, and the painted floor.
type Shot = { top: number; sun: number; shade: number; floor: number; painted: number[] };
async function probe(page: Page, theme: string, dark: boolean, night: boolean): Promise<Shot> {
  const layout = structuredClone(demo); const g = layout.floors.ground; Object.assign(g, { furniture: [], devices: [], unlinked: [], doors: [], openings: [] }); g.rooms[0].color = "#3a7bd5";
  await serve(page); await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto(`${ORIGIN}/harness.html`);
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(([config, vars, isDark, isNight]) => {
    document.body.setAttribute("style", vars as string);
    const el = document.getElementById("card") as any; el.setConfig(config);
    el.hass = { states: isNight ? { "sun.sun": { state: "below_horizon", attributes: {}, last_changed: new Date().toISOString() } } : {}, themes: { darkMode: isDark }, callService: () => undefined }; return el.updateComplete;
  }, [{ layout, floor: "ground", view: "3d", theme, walls: "full", active_list: false }, dark ? HA_DARK : "", dark, night] as const);
  await drawn(page); await page.waitForTimeout(800);
  await hook(page, (h) => h.look(0, 0.45)); await page.waitForTimeout(600);
  const pr = (x: number, y: number, z: number) => hook(page, (h, a) => h.project(a[0], a[1], a[2]), [x, y, z]);
  const painted = await rgbAt(page, await pr(100, 100, 0));
  return { top: L(await rgbAt(page, await pr(400, 0, 250))), sun: L(await rgbAt(page, await pr(400, 10, 125))), shade: L(await rgbAt(page, await pr(10, 300, 125))), floor: L(await rgbAt(page, await pr(650, 100, 0))), painted };
}
const THEMES = [["blueprint", false], ["light", false], ["ha", true]] as const;
for (const [theme, dark] of THEMES) {
  test(`3D lighting, ${theme} by day: top, sun face and shade face step down by 6 percent or more`, async ({ page }) => {
    const s = await probe(page, theme, dark, false);
    expect(s.top, `top ${s.top} over sun ${s.sun}`).toBeGreaterThan(s.sun * 1.06);
    expect(s.sun, `sun ${s.sun} over shade ${s.shade}`).toBeGreaterThan(s.shade * 1.06);
    if (!dark && theme === "light") expect(s.floor, "on the light theme the floor is the lightest").toBeGreaterThan(s.top);
  });
  test(`3D lighting, ${theme}: night is darker than day`, async ({ page }) => {
    const day = await probe(page, theme, dark, false); const night = await probe(await page.context().newPage(), theme, dark, true);
    expect(night.top).toBeLessThan(day.top);
    expect(night.shade).toBeLessThan(day.shade);
  });
}
test("3D paint: a dark theme dims user paint as the 2D plan does, a light theme does not", async ({ page }) => {
  const light = await probe(page, "light", false, false);
  const mid = await probe(await page.context().newPage(), "midnight", false, false);
  const l = L(light.painted), m = L(mid.painted);
  expect(m / l, `midnight ${m} over light ${l}`).toBeGreaterThan(0.45);
  expect(m / l).toBeLessThan(0.78); // brightness .62 and a little saturation off; lighting is the same in both
  expect(light.painted[2], "light keeps the picked blue").toBeGreaterThan(190);
});
