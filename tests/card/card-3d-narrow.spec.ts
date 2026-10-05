import { test, expect, type Page } from "@playwright/test";
import { demo, open, card, canvas, holder, drawn } from "./helpers-3d";

// S12 review S4: at phone width the Active list folds to a 36 px header. The camera must not give half the card's width
// to that header; it frames the house in the whole width. An open list (a wide card, or one the user opened) still gets its inset.

/** The model's left and right edge in the canvas, as shares of its width (the list is hidden so it is not read as model). */
const spread = async (page: Page) => {
  await card(page).locator("css=.fp-active").evaluate((el: HTMLElement) => { el.style.visibility = "hidden"; });
  const png = await canvas(page).screenshot();
  return page.evaluate(async (b64) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const g = c.getContext("2d")!; g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let min = c.width, max = 0;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      if (Math.abs(d[i] - d[0]) + Math.abs(d[i + 1] - d[1]) + Math.abs(d[i + 2] - d[2]) > 24) { min = Math.min(min, x); max = Math.max(max, x); }
    }
    return { min: min / c.width, max: max / c.width, width: max / c.width - min / c.width };
  }, png.toString("base64"));
};
const inset = async (page: Page) => ((await holder(page).getAttribute("data-inset")) ?? "0,0").split(",").map(Number);

for (const [w, h] of [[375, 700], [260, 800]] as const) {
  test(`${w}x${h}: a folded Active list takes no width from the house`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await open(page, { layout: structuredClone(demo), floor: "ground", view: "3d", active_list: true });
    await page.evaluate((w) => { (document.getElementById("wrap") as HTMLElement).style.width = `${w}px`; }, w);
    await drawn(page);
    await expect(card(page).locator("css=.fp-active-body")).toHaveCount(0); // folded: the header only
    await expect.poll(async () => (await inset(page)).join()).toBe("0,0");
    const s = await spread(page);
    expect(s.width, JSON.stringify(s)).toBeGreaterThan(0.7); // the house fills the width; half of it was lost before
  });
}

test("375x700: an opened Active list still keeps the house clear of it", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await open(page, { layout: structuredClone(demo), floor: "ground", view: "3d", active_list: true });
  await page.evaluate(() => { (document.getElementById("wrap") as HTMLElement).style.width = "375px"; });
  await drawn(page);
  await card(page).getByRole("button", { name: /Expand the active devices list/ }).click();
  await expect(card(page).locator("css=.fp-active-body")).toHaveCount(1);
  await expect.poll(async () => (await inset(page))[0] + (await inset(page))[1]).toBeGreaterThan(0.05);
});
