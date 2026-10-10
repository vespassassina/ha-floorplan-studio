import { test, expect, type Page } from "@playwright/test";

// S27.12: a floor chip animates the switch in the Studio: data-switch on the plan root (floorSwitch), the keyframes of
// S27.6 do the rest. Reduced motion: nothing runs. The end condition is the animation's own `finished`, never a sleep.

const EDITOR = "floorplan-studio-editor";
const switching = (page: Page) => page.locator(`${EDITOR} svg`).first().evaluate((svg) => svg.getAnimations().filter((a) => (a as CSSAnimation).animationName?.startsWith("fp-floor-in")).length);
const wait = (page: Page, n: number) => expect.poll(() => switching(page)).toBe(n);
/** Holds the running switch animation half way, so a click lands in the middle of it; returns what it is. */
const hold = (page: Page) => page.locator(`${EDITOR} svg`).first().evaluate((svg) => {
  const a = svg.getAnimations().find((x) => (x as CSSAnimation).animationName?.startsWith("fp-floor-in")) as CSSAnimation;
  a.pause(); a.currentTime = 110;
  return { name: a.animationName, from: String((a.effect as KeyframeEffect).getKeyframes()[0].transform), state: a.playState, attr: svg.getAttribute("data-switch") };
});
const release = (page: Page) => page.locator(`${EDITOR} svg`).first().evaluate((svg) => Promise.all(svg.getAnimations().map((a) => { a.play(); return a.finished; })).then(() => svg.getAttribute("data-switch")));

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
});

test("default motion: a chip click animates the plan root, up from above, down from below, and a real click during it selects on the new floor", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  expect(await switching(page)).toBe(0);
  await page.locator('.chip[data-f="first"]').click();
  await wait(page, 1);
  expect(await hold(page)).toEqual({ name: "fp-floor-in-up", from: "translateY(-16px)", state: "paused", attr: "up" });
  // a real click, mid-animation, on a room of the new floor
  // (a point where the room itself is the top element, not a device icon: finding 3)
  const pt = await page.locator(`${EDITOR} svg polygon[data-r]`).first().evaluate((poly) => {
    const r = poly.getBoundingClientRect();
    for (let fy = 0.2; fy < 0.9; fy += 0.1) for (let fx = 0.2; fx < 0.9; fx += 0.1) {
      const x = r.x + r.width * fx, y = r.y + r.height * fy;
      if (document.querySelector("floorplan-studio-editor")!.shadowRoot!.elementFromPoint(x, y) === poly) return { x, y };
    }
    return null;
  });
  expect(pt).not.toBeNull();
  await page.mouse.click(pt!.x, pt!.y);
  const got = await page.evaluate((tag) => { const el = document.querySelector(tag) as any; return { floor: el.st.floor, sel: el.st.sel?.t, name: el.st.sel?.t === "room" ? el.st.f.rooms[el.st.sel.i].name : null, inFloor: el.st.sel?.t === "room" ? el.st.f.rooms.length : 0 }; }, EDITOR);
  expect(got.floor).toBe("first");
  expect(got.sel).toBe("room");
  expect(got.name).toBeTruthy();
  expect(await switching(page)).toBe(1); // the click did not end it
  await release(page);
  // finished: the attribute is cleared (animationend follows `finished` by a task), so the next switch can start again
  await expect.poll(() => page.locator(`${EDITOR} svg`).first().getAttribute("data-switch")).toBeNull();
  await page.locator('.chip[data-f="ground"]').click();
  await wait(page, 1);
  expect(await hold(page)).toMatchObject({ name: "fp-floor-in-down", from: "translateY(16px)", attr: "down" });
  await release(page);
  // the same direction twice restarts it
  await page.locator('.chip[data-f="first"]').click();
  await wait(page, 1);
  expect(await hold(page)).toMatchObject({ name: "fp-floor-in-up" });
  await page.locator('.chip[data-f="test"]').click();
  await wait(page, 1);
  expect(await hold(page)).toMatchObject({ name: "fp-floor-in-up", state: "paused", attr: "up" });
  await release(page);
});

test("a click on the floor already shown starts no animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.locator('.chip[data-f="ground"]').click();
  expect(await switching(page)).toBe(0);
  await expect(page.locator(`${EDITOR} svg`).first()).not.toHaveAttribute("data-switch", /.*/);
});

test("reduced motion: no animation is ever running after the click, and the new floor is drawn at once", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator('.chip[data-f="first"]').click();
  await expect(page.locator(`${EDITOR} svg`).first()).toHaveAttribute("aria-label", /First/);
  expect(await switching(page)).toBe(0);
  await expect(page.locator(`${EDITOR} svg`).first()).not.toHaveAttribute("data-switch", /.*/);
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  await page.locator('.chip[data-f="ground"]').click();
  await expect(page.locator(`${EDITOR} svg`).first()).toHaveAttribute("aria-label", /Ground/);
  expect(await switching(page)).toBe(0);
  await expect(page.locator(`${EDITOR} svg`).first()).not.toHaveAttribute("data-switch", /.*/);
});
