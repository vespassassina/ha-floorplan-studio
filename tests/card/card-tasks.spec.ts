import { test, expect } from "@playwright/test";
import { SIZES, bootTouch, boxOf, calls, deviceIndex, roomIndex, tapPlan, tapRole, taps, typed, typeText, type TouchSize } from "./touch-helpers";

// S31.1 (docs/specs/card-layout-touch.md, K1 to K5): the tap tasks of Sprint 31, on the stress house, from a cold card, with real
// touch taps (`page.touchscreen.tap`) at points where the target is the real top element. Each asserts its tap count and the
// exact `callService` calls. The calls are what 0.28.1 sends today (measured 2026-10-13), not invented (finding 21).
// The tests use the new accessible names of the spec. All five pass on both sizes at their counts (S31.11); none is marked
// `test.fail()`. They stay as the guard for the tap counts.

for (const [name, size] of Object.entries(SIZES) as [keyof typeof SIZES, TouchSize][]) {
  test.describe(`S31 tap tasks, ${name} ${size.width} x ${size.height}`, () => {
    test.use({ viewport: size, hasTouch: true, isMobile: true });
    const phone = name === "phone";

    test("K1 turn off the Kitchen's lights: the room, then Lights off (2 taps)", async ({ page }) => {
      await bootTouch(page, size);
      await tapPlan(page, `svg polygon[data-r="${roomIndex("ground", "Kitchen")}"]`);
      await tapRole(page, "button", /^Lights off in Kitchen$/);
      expect(taps(page)).toBe(2);
      expect(await calls(page)).toEqual([["light", "turn_off", { entity_id: ["light.kitchen_spot_1"] }]]);
    });

    test("K2 find Guest bedroom bedside left and turn it on: Search, letters, first result, Turn on (3 taps)", async ({ page }) => {
      // S31.5 put a Search button in the header; S31.8 gave the phone its sheet, so the lit lamp ends above it (checked below).
      await bootTouch(page, size);
      await tapRole(page, "button", "Search");
      await typeText(page, "guest bedside left");
      await tapRole(page, "option", /^Guest bedroom bedside left/);
      await tapRole(page, "button", "Turn on");
      expect(taps(page)).toBe(3);
      expect(typed(page)).toBe(18);
      expect(await calls(page)).toEqual([["light", "turn_on", { entity_id: "light.guest_bedroom_bedside_left" }]]);
      if (phone) {
        // The S24.7 note: on a phone the lit device is not under the sheet that opened for it.
        const icon = await boxOf(page, { selector: `svg g[data-x="${deviceIndex("second", "light.guest_bedroom_bedside_left")}"]` });
        const plan = await boxOf(page, { selector: "svg.fp-zoomable" });
        const sheet = await boxOf(page, { role: "region", name: /^(Overview|Guest bedroom bedside left)$/ });
        expect(icon && plan && sheet, "icon, plan and sheet all have a box").toBeTruthy();
        expect(icon!.y + icon!.height, "the icon ends above the sheet").toBeLessThanOrEqual(sheet!.y);
        expect(icon!.y, "the icon is inside the plan").toBeGreaterThanOrEqual(plan!.y);
      }
    });

    test("K3 turn off what is on on the First floor: its tab, Turn off on this floor, Turn off 1 (3 taps)", async ({ page }) => {
      await bootTouch(page, size);
      await tapRole(page, "button", "First");
      await tapRole(page, "button", /^Turn off on this floor/);
      await tapRole(page, "button", "Turn off 1");
      expect(taps(page)).toBe(3);
      expect(await calls(page)).toEqual([["light", "turn_off", { entity_id: ["light.study_desk_lamp"] }]]);
    });

    test("K4 show the plan in 2.5D: View options, 2.5D (2 taps)", async ({ page }) => {
      await bootTouch(page, size);
      const before = await page.evaluate(() => document.getElementById("card")!.shadowRoot!.querySelector("svg.fp-zoomable")!.innerHTML);
      await tapRole(page, "button", "View options");
      await tapRole(page, "menuitemradio", "2.5D");
      expect(taps(page)).toBe(2);
      expect(await calls(page)).toEqual([]);
      // The plan really changed, and the choice is the one the card remembers (view memory, `fp-view:`).
      await expect.poll(() => page.evaluate((b) => document.getElementById("card")!.shadowRoot!.querySelector("svg.fp-zoomable")!.innerHTML !== b, before)).toBe(true);
      await expect.poll(() => page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith("fp-view:")).map(([, v]) => (JSON.parse(v) as { view?: string }).view))).toContain("2.5d");
    });

    test("K5 operate a lit device seen on the plan: its icon, Turn off (2 taps)", async ({ page }) => {
      // S37.6: auto now draws all 437 stress devices at 768 px, and the kitchen spot lies in a stack that fans out on its first tap: pin the old far-at-fit picture.
      await bootTouch(page, size, { detail: "minimal" });
      await tapPlan(page, `svg g[data-x="${deviceIndex("ground", "light.kitchen_spot_1")}"]`);
      await tapRole(page, "button", "Turn off");
      expect(taps(page)).toBe(2);
      expect(await calls(page)).toEqual([["light", "turn_off", { entity_id: "light.kitchen_spot_1" }]]);
    });
  });
}
