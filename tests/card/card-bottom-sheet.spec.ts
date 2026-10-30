import { test, expect, type Page } from "@playwright/test";
import { sheetStops } from "../../src/card/frame";
import { SIZES, bootTouch, boxOf, calls, deviceIndex, roomIndex, tapPlan, tapRole, STATES } from "./touch-helpers";

// S31.8 (docs/specs/card-layout-touch.md, D2, criterion 6): under 640 px the Overview is a bottom sheet. Peek (64 px) sits under
// the plan; half and full lie over it. The handle is dragged with a real `page.mouse` (down, ten moves, up) and tapped with a real
// finger; a room, a floor tab, a device tap and a locate open it at half; Back and Escape step up; the plan pans so what the
// sheet opened for stands above it. The stops come from `frame.ts`, the one source (the card and this file read the same maths).
// A drag that ends in a rest (the finger stops, then lifts) is not a fling; a drag that ends moving is. The rest is a few animation
// frames, a wait on time passing in the page, not a timeout.

const phone = SIZES.phone;
test.use({ viewport: phone, hasTouch: true, isMobile: true });

type Box = { x: number; y: number; width: number; height: number };
const SHEET = { selector: ".fp-bottom" };
const HANDLE = { role: "button", name: "Overview" } as const;
const sheet = (page: Page) => boxOf(page, SHEET) as Promise<Box>;
const host = (page: Page) => page.evaluate(() => { const r = document.getElementById("card")!.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
const stops = async (page: Page) => sheetStops((await host(page)).height, 52);
const frames = (page: Page, n: number) => page.evaluate((n) => new Promise<void>((done) => { let k = 0; const f = () => (++k >= n ? done() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const centre = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
/** A settled sheet height: the box stops moving (a CSS transition may be running). */
const settled = async (page: Page) => { let last = -1, same = 0; await expect.poll(async () => { const h = (await sheet(page)).height; same = Math.abs(h - last) < 0.01 ? same + 1 : 0; last = h; return same; }, { timeout: 4000 }).toBeGreaterThanOrEqual(3); return last; };

/** Handle point, then ten moves to `toY`, optionally a rest, then up. Real mouse. */
async function drag(page: Page, toY: number, rest: boolean) {
  const h = centre((await boxOf(page, HANDLE))!);
  await page.mouse.move(h.x, h.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(h.x, h.y + ((toY - h.y) * i) / 10);
  if (rest) await frames(page, 10);
  await page.mouse.up();
}
/** The y at which the handle's centre must be for the sheet to be `height` high: the sheet grows upward, the handle with it. */
const yFor = async (page: Page, height: number) => { await settled(page); const s = await sheet(page), h = (await boxOf(page, HANDLE))!; return h.y + h.height / 2 + (s.height - height); };

const region = (page: Page) => stateOf(page).then((x) => x.region);
const stateOf = (page: Page) => page.evaluate(() => {
  const root = document.getElementById("card")!.shadowRoot!;
  return {
    expanded: root.querySelector(".fp-handle")?.getAttribute("aria-expanded"),
    region: root.querySelector(".fp-bottom")?.getAttribute("aria-label"),
    pop: root.querySelector(".fp-pop") !== null,
    popInSheet: root.querySelector(".fp-bottom .fp-pop") !== null,
    back: root.querySelector(".fp-back") !== null,
  };
});

test.describe("S31.8 the phone bottom sheet", () => {
  test("a cold card: peek, 64 px, under the plan, named Overview, folded", async ({ page }) => {
    await bootTouch(page, phone);
    const s = await sheet(page), plan = (await boxOf(page, { selector: "svg.fp-zoomable" }))!, h = await host(page);
    expect(s.height).toBeCloseTo(64, 0);
    expect(s.y + s.height, "the sheet ends where the card does").toBeCloseTo(h.y + h.height, 0);
    expect(plan.y + plan.height, "the plan ends above the peek: it is not over the plan").toBeLessThanOrEqual(s.y + 0.5);
    expect(await stateOf(page)).toMatchObject({ expanded: "false", region: "Overview", back: false });
    const line = await page.evaluate(() => document.getElementById("card")!.shadowRoot!.querySelector(".fp-handle")!.textContent!.replace(/\s+/g, " ").trim());
    expect(line, "one line: where, then the counts").toMatch(/^Home › Ground/);
  });

  test("a drag on the handle, down, ten moves, up, rests on half, then full, then peek", async ({ page }) => {
    await bootTouch(page, phone);
    const st = await stops(page);
    await drag(page, await yFor(page, st.half), true);
    expect(await settled(page)).toBeCloseTo(st.half, 0);
    expect((await stateOf(page)).expanded).toBe("true");
    await drag(page, await yFor(page, st.full), true);
    expect(await settled(page)).toBeCloseTo(st.full, 0);
    // The nearest stop wins: a rest 40 px under half goes to half, not on to peek.
    await drag(page, await yFor(page, st.half - 40), true);
    expect(await settled(page)).toBeCloseTo(st.half, 0);
    await drag(page, await yFor(page, st.peek), true);
    expect(await settled(page)).toBeCloseTo(st.peek, 0);
    expect((await stateOf(page)).expanded).toBe("false");
  });

  test("the sheet follows the finger while it is down, and a drag past full or under peek is held at the stops", async ({ page }) => {
    await bootTouch(page, phone);
    const st = await stops(page);
    const h = centre((await boxOf(page, HANDLE))!);
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(h.x, h.y - (200 * i) / 10);
    expect((await sheet(page)).height, "64 + 200 px, live, with no transition lag").toBeCloseTo(st.peek + 200, 0);
    for (let i = 1; i <= 10; i++) await page.mouse.move(h.x, h.y - 200 - (900 * i) / 10);
    expect((await sheet(page)).height, "never above full").toBeCloseTo(st.full, 0);
    await page.mouse.up();
  });

  test("a fling goes one stop its way, never two", async ({ page }) => {
    await bootTouch(page, phone);
    const st = await stops(page);
    // Fast, no rest: up from peek, the finger lets go at 64 + 150, under half: half.
    await drag(page, (await yFor(page, st.peek + 150)), false);
    expect(await settled(page)).toBeCloseTo(st.half, 0);
    // From full, a fast drag down 150 px (the mouse needs about that to beat 0.5 px/ms) goes one stop, to half, not peek.
    await drag(page, await yFor(page, st.full), true);
    expect(await settled(page)).toBeCloseTo(st.full, 0);
    await drag(page, await yFor(page, st.full - 150), false);
    expect(await settled(page)).toBeCloseTo(st.half, 0);
  });

  test("a tap on the handle goes peek, half, peek; from full it goes to half", async ({ page }) => {
    await bootTouch(page, phone);
    const st = await stops(page);
    await tapRole(page, "button", "Overview");
    expect(await settled(page)).toBeCloseTo(st.half, 0);
    await tapRole(page, "button", "Overview");
    expect(await settled(page)).toBeCloseTo(st.peek, 0);
    await drag(page, await yFor(page, st.full), true);
    await tapRole(page, "button", "Overview");
    expect(await settled(page)).toBeCloseTo(st.half, 0);
  });

  test("a drag that ends is not also a tap", async ({ page }) => {
    await bootTouch(page, phone);
    const st = await stops(page);
    await drag(page, await yFor(page, st.full), true);
    expect(await settled(page), "the click after the drag did not take it back to half").toBeCloseTo(st.full, 0);
  });

  // PR 5, CI shard 3: a finger on a room picks it on pointerup, and the sheet rises. Chromium sends the tap's click later, hit-tested
  // where the finger was, and on a slow machine the risen sheet is there by then: the click took the sheet back to peek from the
  // handle, and the Opus review showed it pressing a control inside the sheet too. On a fast machine the click lands first, so these
  // tests send that click themselves: a click whose pointer id no press in the sheet had (Chromium's click is a PointerEvent with
  // the tap's id), at the real top element there.
  // A finger's own tap and Enter (a click with detail 0) still act.
  const lateClick = (page: Page, p: { x: number; y: number }) => page.evaluate(({ x, y }) => {
    let top = document.elementFromPoint(x, y);
    while (top?.shadowRoot) { const inner = top.shadowRoot.elementFromPoint(x, y); if (!inner || inner === top) break; top = inner; }
    top?.dispatchEvent(new PointerEvent("click", { bubbles: true, composed: true, cancelable: true, detail: 1, clientX: x, clientY: y, pointerId: 9999, pointerType: "touch" }));
    return top?.closest("button")?.getAttribute("aria-label") ?? top?.closest("button")?.className ?? null;
  }, p);

  test("the click a room tap sends after the sheet rose does not move the handle; Enter still does", async ({ page }) => {
    await bootTouch(page, phone);
    const st = await stops(page);
    await tapPlan(page, `svg polygon[data-r="${roomIndex("ground", "Kitchen")}"]`);
    expect(await settled(page)).toBeCloseTo(st.half, 0);
    expect(await lateClick(page, centre((await boxOf(page, HANDLE))!)), "the click reached the handle").toBe("Overview");
    expect(await settled(page), "the late click left the sheet at half").toBeCloseTo(st.half, 0);
    await page.evaluate(() => document.getElementById("card")!.shadowRoot!.querySelector<HTMLElement>(".fp-handle")!.focus());
    await page.keyboard.press("Enter");
    expect(await settled(page), "Enter on the handle goes half to peek").toBeCloseTo(st.peek, 0);
  });

  test("the late click does not press a control in the sheet; a finger on it does", async ({ page }) => {
    await bootTouch(page, phone);
    await tapPlan(page, `svg polygon[data-r="${roomIndex("ground", "Kitchen")}"]`);
    await settled(page);
    const before = (await calls(page)).length;
    const off = centre((await boxOf(page, { role: "button", name: /^Lights off in Kitchen$/ }))!);
    expect(await lateClick(page, off), "the click reached Lights off").toBe("Lights off in Kitchen");
    expect((await calls(page)).length, "no call from a click with no press").toBe(before);
    await tapRole(page, "button", /^Lights off in Kitchen$/);
    await expect.poll(async () => (await calls(page)).length, { message: "the finger's own tap calls" }).toBeGreaterThan(before);
  });

  test("after a finger drags the handle, a later late click still does not move it", async ({ page }) => {
    await bootTouch(page, phone);
    const st = await stops(page);
    const h = centre((await boxOf(page, HANDLE))!), to = h.y - (st.half - st.peek);
    // A touch drag sends no click afterwards; a flag set on the press and cleared on the click stayed set (Opus review, S41).
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: h.x, y: h.y }] });
    for (let i = 1; i <= 10; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: h.x, y: h.y + ((to - h.y) * i) / 10 }] });
    await frames(page, 10);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    expect(await settled(page)).toBeCloseTo(st.half, 0);
    expect(await lateClick(page, centre((await boxOf(page, HANDLE))!))).toBe("Overview");
    expect(await settled(page), "the late click left the sheet at half").toBeCloseTo(st.half, 0);
  });

  test("a room opens the Room level at half; Back goes to Floor, then Overview, then peek", async ({ page }) => {
    await bootTouch(page, phone);
    const st = await stops(page);
    await tapPlan(page, `svg polygon[data-r="${roomIndex("ground", "Kitchen")}"]`);
    expect(await settled(page)).toBeCloseTo(st.half, 0);
    expect(await stateOf(page)).toMatchObject({ region: "Kitchen", back: true });
    await tapRole(page, "button", "Back");
    await expect.poll(() => region(page), { message: "Floor level: the floor's own name" }).not.toBe("Kitchen");
    expect(await region(page)).not.toBe("Overview");
    await tapRole(page, "button", "Back");
    await expect.poll(() => region(page)).toBe("Overview");
    expect(await settled(page), "Back up to the Overview keeps the height").toBeCloseTo(st.half, 0);
    await tapRole(page, "button", "Back");
    expect(await settled(page)).toBeCloseTo(st.peek, 0);
    expect((await stateOf(page)).back, "nothing above peek on the Overview").toBe(false);
  });

  test("Escape steps up the same way", async ({ page }) => {
    await bootTouch(page, phone);
    const st = await stops(page);
    await tapPlan(page, `svg polygon[data-r="${roomIndex("ground", "Kitchen")}"]`);
    await tapRole(page, "button", "Back"); // focus is in the card now: the Floor level
    await expect.poll(() => region(page)).not.toBe("Kitchen");
    await page.keyboard.press("Escape");
    await expect.poll(() => region(page)).toBe("Overview");
    await page.keyboard.press("Escape");
    expect(await settled(page)).toBeCloseTo(st.peek, 0);
  });

  test("a device tap opens the Device level at half, the popup inside the sheet, the icon above it; Back and Escape close it", async ({ page }) => {
    await bootTouch(page, phone);
    const st = await stops(page);
    const sel = `svg g[data-x="${deviceIndex("ground", "light.kitchen_spot_1")}"]`;
    await tapPlan(page, sel);
    expect(await settled(page)).toBeCloseTo(st.half, 0);
    expect(await stateOf(page)).toMatchObject({ pop: true, popInSheet: true, back: true });
    const s = await sheet(page), icon = (await boxOf(page, { selector: sel }))!, plan = (await boxOf(page, { selector: "svg.fp-zoomable" }))!;
    expect(icon.y + icon.height, "the icon ends above the sheet").toBeLessThanOrEqual(s.y);
    expect(icon.y, "and is inside the plan").toBeGreaterThanOrEqual(plan.y);
    await tapRole(page, "button", "Back");
    await expect.poll(() => stateOf(page)).toMatchObject({ pop: false, region: "Overview" });
    await tapPlan(page, sel);
    await expect.poll(() => stateOf(page).then((x) => x.pop)).toBe(true);
    await page.keyboard.press("Escape");
    await expect.poll(() => stateOf(page).then((x) => x.pop)).toBe(false);
  });

  test("the popup does not float on a phone, and still does without a sheet (active_list: false)", async ({ page }) => {
    await bootTouch(page, phone, { active_list: false });
    await tapPlan(page, `svg g[data-x="${deviceIndex("ground", "light.kitchen_spot_1")}"]`);
    await expect.poll(() => stateOf(page).then((s) => s.pop)).toBe(true);
    expect((await stateOf(page)).popInSheet).toBe(false);
    expect(await boxOf(page, SHEET)).toBeNull();
  });

  test("a room low on the plan is panned above the sheet", async ({ page }) => {
    await bootTouch(page, phone);
    const st = await stops(page);
    // The room whose centre is lowest on the screen: the one the half sheet would cover.
    const idx = await page.evaluate(() => {
      const root = document.getElementById("card")!.shadowRoot!;
      let best = -1, y = -1;
      root.querySelectorAll<SVGPolygonElement>("svg polygon[data-r]").forEach((p) => { const r = p.getBoundingClientRect(); if (r.width > 20 && r.height > 20 && r.y + r.height / 2 > y) { y = r.y + r.height / 2; best = Number(p.getAttribute("data-r")); } });
      return best;
    });
    expect(idx).toBeGreaterThanOrEqual(0);
    await tapPlan(page, `svg polygon[data-r="${idx}"]`);
    expect(await settled(page)).toBeCloseTo(st.half, 0);
    await expect.poll(async () => { const r = (await boxOf(page, { selector: "svg polygon.room-picked" }))!, s = await sheet(page); return r.y + r.height / 2 <= s.y; }, { message: "the picked room's centre is above the sheet" }).toBe(true);
  });

  test("the Search button opens the sheet to full", async ({ page }) => {
    await bootTouch(page, phone);
    const st = await stops(page);
    await tapRole(page, "button", "Search");
    expect(await settled(page)).toBeCloseTo(st.full, 0);
  });

  test("a floor switch at the Device level goes to the Floor level", async ({ page }) => {
    await bootTouch(page, phone);
    await tapPlan(page, `svg g[data-x="${deviceIndex("ground", "light.kitchen_spot_1")}"]`);
    expect((await stateOf(page)).pop).toBe(true);
    await tapRole(page, "button", "First");
    await expect.poll(() => stateOf(page).then((s) => s.pop)).toBe(false);
    await expect.poll(() => region(page), { message: "the Floor level, not the Overview and not the lamp" }).not.toBe("Kitchen spot 1");
    const s = await stateOf(page);
    expect(s.region).not.toBe("Overview");
    expect(s.back, "one Back up").toBe(true);
    await tapRole(page, "button", "Back");
    await expect.poll(() => region(page)).toBe("Overview");
  });

  test("a hass update in the middle of a drag keeps the drag", async ({ page }) => {
    await bootTouch(page, phone);
    const st = await stops(page);
    const h = centre((await boxOf(page, HANDLE))!);
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) await page.mouse.move(h.x, h.y - (100 * i) / 5);
    await page.evaluate(() => {
      const el = document.getElementById("card") as unknown as HTMLElement & { hass: { states: Record<string, unknown> }; updateComplete: Promise<unknown> };
      el.hass = { ...el.hass, states: { ...el.hass.states, "light.kitchen_spot_1": { state: "off", attributes: {}, last_changed: "2026-10-08T09:31:00Z" } } };
      return el.updateComplete;
    });
    expect((await sheet(page)).height, "still where the finger put it").toBeCloseTo(st.peek + 100, 0);
    for (let i = 1; i <= 5; i++) await page.mouse.move(h.x, h.y - 100 - ((st.half - st.peek - 100) * i) / 5);
    await frames(page, 10);
    await page.mouse.up();
    expect(await settled(page)).toBeCloseTo(st.half, 0);
  });

  test("a hass update leaves the sheet at its level", async ({ page }) => {
    await bootTouch(page, phone);
    const st = await stops(page);
    await tapPlan(page, `svg g[data-x="${deviceIndex("ground", "light.kitchen_spot_1")}"]`);
    await page.evaluate(() => {
      const el = document.getElementById("card") as unknown as HTMLElement & { hass: { states: Record<string, unknown> }; updateComplete: Promise<unknown> };
      el.hass = { ...el.hass, states: { ...el.hass.states, "light.study_desk_lamp": { state: "off", attributes: {}, last_changed: "2026-10-08T09:31:00Z" } } };
      return el.updateComplete;
    });
    expect(await settled(page)).toBeCloseTo(st.half, 0);
    expect(await stateOf(page)).toMatchObject({ pop: true, popInSheet: true });
  });

  test("reduced motion: the sheet jumps, nothing runs; with motion the same sheet has a transition", async ({ page }) => {
    await bootTouch(page, phone);
    const dur = () => page.evaluate(() => getComputedStyle(document.getElementById("card")!.shadowRoot!.querySelector(".fp-bottom")!).transitionDuration);
    expect(parseFloat(await dur()), "with motion: a transition").toBeGreaterThan(0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await dur()).toBe("0s");
    const st = await stops(page);
    await page.evaluate(() => (document.getElementById("card")!.shadowRoot!.querySelector(".fp-handle") as HTMLElement).click());
    // Read in the same turn the click landed: no animation is running, and the height is already the stop.
    const now = await page.evaluate(() => { const s = document.getElementById("card")!.shadowRoot!.querySelector(".fp-bottom") as HTMLElement; return { anims: s.getAnimations().length, h: s.getBoundingClientRect().height }; });
    expect(now.anims).toBe(0);
    expect(now.h).toBeCloseTo(st.half, 0);
  });

  test("a stops-sized card: half shows a room's Lights off without scrolling the body", async ({ page }) => {
    await bootTouch(page, phone);
    await tapPlan(page, `svg polygon[data-r="${roomIndex("ground", "Kitchen")}"]`);
    await settled(page);
    const b = await boxOf(page, { role: "button", name: /^Lights off in Kitchen$/ }), s = await sheet(page);
    expect(b, "the button exists").not.toBeNull();
    expect(b!.y + b!.height, "inside the half sheet").toBeLessThanOrEqual(s.y + s.height);
    expect(b!.y).toBeGreaterThanOrEqual(s.y);
  });

  test("the lit lamp of the sheet's own call stays callable: Turn off at the Device level sends the call", async ({ page }) => {
    await bootTouch(page, phone, {}, STATES());
    await tapPlan(page, `svg g[data-x="${deviceIndex("ground", "light.kitchen_spot_1")}"]`);
    await tapRole(page, "button", "Turn off");
    expect(await calls(page)).toEqual([["light", "turn_off", { entity_id: "light.kitchen_spot_1" }]]);
  });
});
