import { test, expect, type Page } from "@playwright/test";
import { resolve } from "node:path";

// S24.2: <fp-search>, the one search box of the Studio and the card, on a harness page with the stress house's 437
// devices. Real keyboard and real mouse at every step (finding 3). The harness host binds the chord on itself
// (finding 6) and records every fp-pick and fp-close.
const URL_ = `/@fs${resolve("tests/card/search-harness.html")}`;

const input = (page: Page) => page.locator("#box input");
const options = (page: Page) => page.locator("#box [role=option]");
const listbox = (page: Page) => page.locator("#box [role=listbox]");
const activeId = (page: Page) => input(page).getAttribute("aria-activedescendant");
const picks = (page: Page) => page.evaluate(() => (window as unknown as { picks: { detail: Record<string, unknown>; bubbles: boolean; composed: boolean }[] }).picks);
const closes = (page: Page) => page.evaluate(() => (window as unknown as { closes: number }).closes);
/** Whether keyboard focus is in the box's own input (the host element is the document's active element, its input the shadow's). */
const inBox = (page: Page) => page.evaluate(() => document.activeElement?.id === "box" && document.activeElement.shadowRoot?.activeElement?.tagName === "INPUT");

async function open(page: Page) {
  await page.goto(URL_);
  await page.waitForFunction(() => (window as unknown as { ready?: boolean }).ready === true);
  await page.locator("#box").evaluate((el) => (el as unknown as { updateComplete: Promise<unknown> }).updateComplete);
}
/** Put focus on the host the way a user does: a real click on its empty plan area. */
async function focusHost(page: Page) {
  const b = (await page.locator("#host .plan").boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}

test.describe("S24.2 <fp-search>", () => {
  test("/ opens it, typing lists ranked results, arrows move, Enter picks", async ({ page }) => {
    await open(page);
    await focusHost(page);
    expect(await inBox(page)).toBe(false);
    await page.keyboard.press("/");
    expect(await inBox(page)).toBe(true);
    await expect(input(page)).toHaveValue(""); // the chord's slash is not typed
    await expect(listbox(page)).toHaveCount(0); // an empty query shows nothing
    await expect(input(page)).toHaveAttribute("aria-expanded", "false");

    await page.keyboard.type("bedside guest");
    await expect(options(page)).toHaveCount(3);
    await expect(input(page)).toHaveAttribute("aria-expanded", "true");
    await expect(input(page)).toHaveAttribute("role", "combobox");
    const listId = await listbox(page).getAttribute("id");
    await expect(input(page)).toHaveAttribute("aria-controls", listId!);
    const first = options(page).nth(0);
    await expect(first.locator(".name")).toHaveText("Guest bedroom bedside left");
    await expect(first.locator(".detail")).toHaveText("Guest bedroom · Second · Light");
    const ids = await options(page).evaluateAll((els) => els.map((e) => e.id));
    expect(new Set(ids).size).toBe(3);
    expect(await activeId(page)).toBe(ids[0]);
    await expect(first).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("ArrowDown");
    expect(await activeId(page)).toBe(ids[1]);
    await expect(options(page).nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(first).toHaveAttribute("aria-selected", "false");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp"); // wraps to the last
    expect(await activeId(page)).toBe(ids[2]);
    await page.keyboard.press("ArrowDown"); // and back round to the first
    expect(await activeId(page)).toBe(ids[0]);
    await page.keyboard.press("ArrowDown");
    const second = await options(page).nth(1).locator(".name").textContent();

    await page.keyboard.press("Enter");
    const p = await picks(page);
    expect(p).toHaveLength(1);
    expect(p[0].bubbles).toBe(true);
    expect(p[0].composed).toBe(true);
    expect(p[0].detail).toMatchObject({ kind: "device", name: second, floor: "second", floorName: "Second", roomName: "Guest bedroom" });
    expect(typeof p[0].detail.device).toBe("number");
    // Picked: the box clears and closes, focus stays for the next search.
    await expect(input(page)).toHaveValue("");
    await expect(listbox(page)).toHaveCount(0);
    expect(await inBox(page)).toBe(true);
    expect(await activeId(page)).toBeNull();
  });

  test("no match says so; Escape clears, then closes", async ({ page }) => {
    await open(page);
    await focusHost(page);
    await page.keyboard.press("/");
    await page.keyboard.type("zzqx");
    await expect(options(page)).toHaveCount(0);
    await expect(page.locator("#box .empty")).toHaveText("No match");
    expect(await activeId(page)).toBeNull();
    await page.keyboard.press("Enter"); // nothing to pick
    expect(await picks(page)).toHaveLength(0);

    await page.keyboard.press("Escape");
    await expect(input(page)).toHaveValue("");
    await expect(listbox(page)).toHaveCount(0);
    expect(await inBox(page)).toBe(true);
    expect(await closes(page)).toBe(0);

    await page.keyboard.press("Escape");
    expect(await inBox(page)).toBe(false);
    expect(await closes(page)).toBe(1);
    // Focus went back to the host, so the chord works again at once.
    await page.keyboard.press("/");
    expect(await inBox(page)).toBe(true);
  });

  test("Ctrl-K and Cmd-K open it; / typed in another text field stays a slash", async ({ page }) => {
    await open(page);
    await focusHost(page);
    await page.keyboard.press("Control+k");
    expect(await inBox(page)).toBe(true);
    await page.keyboard.press("Escape");
    expect(await inBox(page)).toBe(false);
    await focusHost(page);
    await page.keyboard.press("Meta+k");
    expect(await inBox(page)).toBe(true);

    const note = (await page.locator("#note").boundingBox())!;
    await page.mouse.click(note.x + 5, note.y + note.height / 2);
    await page.keyboard.type("a/b");
    await expect(page.locator("#note")).toHaveValue("a/b");
    expect(await inBox(page)).toBe(false);
    // In the box itself a slash is part of the query too.
    await focusHost(page);
    await page.keyboard.press("/");
    await page.keyboard.type("a/b");
    await expect(input(page)).toHaveValue("a/b");
  });

  test("shows at most `limit`, 10 by default; the active option stays in view", async ({ page }) => {
    await open(page);
    await focusHost(page);
    await page.keyboard.press("/");
    await page.keyboard.type("light");
    await expect(options(page)).toHaveCount(10);
    await page.locator("#box").evaluate((el) => { (el as unknown as { limit: number }).limit = 40; });
    await page.keyboard.type(" ");
    await expect(options(page)).toHaveCount(40);
    await page.keyboard.press("ArrowUp"); // wraps to the 40th, far below the list's visible height
    const ids = await options(page).evaluateAll((els) => els.map((e) => e.id));
    expect(await activeId(page)).toBe(ids[39]);
    const inView = await page.locator("#box").evaluate((el) => {
      const list = el.shadowRoot!.querySelector("[role=listbox]")!.getBoundingClientRect();
      const opt = el.shadowRoot!.querySelector("[role=option][aria-selected=true]")!.getBoundingClientRect();
      return { list: [list.top, list.bottom], opt: [opt.top, opt.bottom], scroll: el.shadowRoot!.querySelector("[role=listbox]")!.scrollTop };
    });
    expect(inView.scroll).toBeGreaterThan(0);
    expect(inView.opt[0]).toBeGreaterThanOrEqual(inView.list[0] - 0.5);
    expect(inView.opt[1]).toBeLessThanOrEqual(inView.list[1] + 0.5);
  });

  test("a real click on an option picks it", async ({ page }) => {
    await open(page);
    await focusHost(page);
    await page.keyboard.press("/");
    await page.keyboard.type("server room");
    const opt = options(page).nth(0);
    await expect(opt.locator(".name")).toHaveText("Server room");
    const b = (await opt.boundingBox())!;
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    const p = await picks(page);
    expect(p).toHaveLength(1);
    expect(p[0].detail).toMatchObject({ kind: "room", name: "Server room", floor: "second" });
    expect(await inBox(page)).toBe(true);
  });

  test("a name is text, never markup (finding 2)", async ({ page }) => {
    await open(page);
    await page.locator("#box").evaluate((el) => {
      (el as unknown as { entries: unknown[] }).entries = [{ kind: "device", id: "x", name: `"><img src=x onerror="window.pwned=1">`, roomName: "<b>R</b>", typeLabel: "Light" }];
    });
    await focusHost(page);
    await page.keyboard.press("/");
    await page.keyboard.type("img");
    await expect(options(page)).toHaveCount(1);
    await expect(options(page).nth(0).locator(".name")).toHaveText(`"><img src=x onerror="window.pwned=1">`);
    await expect(options(page).nth(0).locator(".detail")).toHaveText("<b>R</b> · Light");
    expect(await page.locator("#box").evaluate((el) => el.shadowRoot!.querySelectorAll("img, b").length)).toBe(0);
  });

  // Finding 10: the active option must look active in the pixel, not only in a class. Read back from Chromium, in a
  // light and a dark theme: the active row is inverted (ink background, page text), the others are not.
  for (const theme of ["light", "midnight"]) {
    test(`CSS pair: the active option is inverted, others plain (${theme})`, async ({ page }) => {
      await open(page);
      await page.locator("#host").evaluate((el, t) => el.setAttribute("data-theme", t), theme);
      await focusHost(page);
      await page.keyboard.press("/");
      await page.keyboard.type("bedside guest");
      await expect(options(page)).toHaveCount(3);
      const read = await page.locator("#box").evaluate((el) => {
        const probe = document.createElement("span");
        probe.style.cssText = "color:var(--fp-ink);background-color:var(--fp-bg)";
        el.parentElement!.appendChild(probe);
        const tokens = getComputedStyle(probe);
        const ink = tokens.color, bg = tokens.backgroundColor;
        probe.remove();
        const opts = [...el.shadowRoot!.querySelectorAll("[role=option]")].map((o) => getComputedStyle(o));
        return { ink, bg, active: { bg: opts[0].backgroundColor, fg: opts[0].color }, rest: { bg: opts[1].backgroundColor, fg: opts[1].color } };
      });
      expect(read.active.bg).toBe(read.ink);
      expect(read.active.fg).toBe(read.bg);
      expect(read.rest.bg).toBe("rgba(0, 0, 0, 0)");
      expect(read.rest.fg).toBe(read.ink);
    });
  }
});
