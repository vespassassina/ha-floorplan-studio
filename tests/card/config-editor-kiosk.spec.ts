import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { loadCard } from "./form-harness";

// G10: the form's boxes tell the truth under kiosk. The card hides the rotate pair, the View switch and the Active list in
// kiosk unless a key says otherwise (floorplan-studio-card.ts `_rotateOn`, `_viewSwitchOn`, `_activeListVisible`). Harness as config-editor-walls.spec.ts.
const demo = JSON.parse(readFileSync("demo/layout.json", "utf8"));

async function mount(page: Page, config: Record<string, unknown>) {
  await loadCard(page);
  await page.evaluate(async (config) => {
    const Ctor = customElements.get("floorplan-studio-card") as unknown as { getConfigElement(): Promise<HTMLElement> };
    const el = await Ctor.getConfigElement();
    (window as unknown as { __events: unknown[] }).__events = [];
    el.addEventListener("config-changed", (e) => (window as unknown as { __events: unknown[] }).__events.push((e as CustomEvent).detail.config));
    el.id = "editor";
    document.body.appendChild(el);
    (el as unknown as { setConfig(c: unknown): void }).setConfig(config);
  }, config);
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card-editor"));
}
const events = (page: Page) => page.evaluate(() => (window as unknown as { __events: Record<string, unknown>[] }).__events);
const box = (page: Page, id: string) => page.locator(`#editor input#${id}`);

test("Rotate buttons: under kiosk the box is unticked, ticking writes true, unticking again drops the key", async ({ page }) => {
  await mount(page, { layout: demo, kiosk: true });
  await expect(box(page, "rotate_switch")).not.toBeChecked();
  await box(page, "rotate_switch").check();
  expect((await events(page)).at(-1)).toMatchObject({ kiosk: true, rotate_switch: true });
  await box(page, "rotate_switch").uncheck();
  expect((await events(page)).at(-1)!.rotate_switch).toBeUndefined();
});

test("Rotate buttons: without kiosk the box is ticked, unticking writes false, ticking again drops the key", async ({ page }) => {
  await mount(page, { layout: demo });
  await expect(box(page, "rotate_switch")).toBeChecked();
  await box(page, "rotate_switch").uncheck();
  expect((await events(page)).at(-1)).toMatchObject({ rotate_switch: false });
  await box(page, "rotate_switch").check();
  expect((await events(page)).at(-1)!.rotate_switch).toBeUndefined();
});

test("Rotate buttons: an explicit rotate_switch: true under kiosk shows ticked; with zoom and View switch both off the default is unticked", async ({ page }) => {
  await mount(page, { layout: demo, kiosk: true, rotate_switch: true });
  await expect(box(page, "rotate_switch")).toBeChecked();
  await mount(page, { layout: demo, zoom: false, view_switch: false });
  await expect(box(page, "rotate_switch")).not.toBeChecked();
});

test("View switch and Active list: kiosk hides them for good, so the boxes show unticked and cannot be ticked", async ({ page }) => {
  await mount(page, { layout: demo, kiosk: true });
  for (const id of ["view_switch", "active_list"]) {
    await expect(box(page, id), id).not.toBeChecked();
    await expect(box(page, id), id).toBeDisabled();
  }
  await mount(page, { layout: demo });
  for (const id of ["view_switch", "active_list"]) {
    await expect(box(page, id), id).toBeChecked();
    await expect(box(page, id), id).toBeEnabled();
  }
});
