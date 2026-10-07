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
