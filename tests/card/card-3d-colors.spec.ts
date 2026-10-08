import { test, expect } from "@playwright/test";
import { demo, open, holder, drawn } from "./helpers-3d";

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
