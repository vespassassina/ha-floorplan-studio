import { test, expect, type Page } from "@playwright/test";
import { demo, open, card } from "./helpers-3d";

// S23 review S3: on a 375 px card "Garden pond" read "Garden": names clipped at the card's right edge and sat under
// the control stack. The card now gives renderFloor its fit box less the strip its stack covers. Read off the page:
// every room name's measured box lies inside the plan's svg and clear of the stack's buttons.

const boxes = (page: Page) => card(page).locator("css=svg.fp-zoomable").evaluate((svg) => {
  const root = svg.getRootNode() as ShadowRoot, r = (el: Element) => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
  const stack = root.querySelector(".fp-stack");
  return {
    svg: r(svg), stack: stack && !stack.classList.contains("fp-stack-row") ? r(stack) : null,
    names: [...svg.querySelectorAll("text.lbl[data-rl]")].map((t) => ({ name: t.textContent, ...r(t) })),
    size: Number(svg.querySelector("text.lbl[data-rl]")?.getAttribute("font-size")),
  };
});

for (const view of ["2d", "2.5d"]) {
  test(`${view}, a 375 px card: every room name is inside the plan and clear of the control stack`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page, { layout: structuredClone(demo), floor: "ground", view, theme: "blueprint" });
    await page.evaluate(() => { (document.getElementById("wrap") as HTMLElement).style.width = "375px"; });
    // The card measures its plan and its stack after a render, then draws again once: wait for the names to settle.
    let last = "";
    await expect.poll(async () => { const b = JSON.stringify((await boxes(page)).names); const same = b === last; last = b; return same; }, { timeout: 5000, intervals: [200] }).toBe(true);
    const b = await boxes(page);
    expect(b.stack, "the stack is a column at the right").not.toBeNull();
    expect(b.names.length).toBe(7);
    for (const n of b.names) {
      expect(n.l, `${n.name} left`).toBeGreaterThanOrEqual(b.svg.l - 0.5);
      expect(n.r, `${n.name} right`).toBeLessThanOrEqual(b.svg.r + 0.5);
      expect(n.t, `${n.name} top`).toBeGreaterThanOrEqual(b.svg.t - 0.5);
      expect(n.b, `${n.name} bottom`).toBeLessThanOrEqual(b.svg.b + 0.5);
      expect(n.r, `${n.name} runs under the control stack`).toBeLessThanOrEqual(b.stack!.l);
    }
  });
}
