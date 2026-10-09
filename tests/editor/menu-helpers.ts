import type { Page } from "@playwright/test";

/** S26.17: Furniture and Unlinked device are submenus of buttons, not selects. These helpers open the submenu (the Add menu
 *  must already be open) and click the item, with real clicks. */
async function pickFromSub(page: Page, sub: string, item: string) {
  const open = await page.locator(`#${sub}`).evaluate((e) => (e as HTMLDetailsElement).open);
  if (!open) await page.locator(`#${sub} > summary`).click();
  await page.locator(`#${sub}-${item}`).click();
}
export const pickFurniture = (page: Page, symbol: string) => pickFromSub(page, "addFurn", symbol);
export const pickUnlinked = (page: Page, type: string) => pickFromSub(page, "addUnlDev", type);
/** Opens View, then its Labels submenu (the Device names and Names and values toggles live there). */
export async function openLabels(page: Page) {
  const view = page.locator("#mOpt");
  if (!(await view.evaluate((e) => (e as HTMLDetailsElement).open))) await page.locator("#mOpt > summary").click();
  if (!(await page.locator("#labelsSub").evaluate((e) => (e as HTMLDetailsElement).open))) await page.locator("#labelsSub > summary").click();
}
