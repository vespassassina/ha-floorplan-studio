import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { viewBoxFor } from "../../src/core/render";
import type { Layout } from "../../src/core/schema";

// S24.5 (U9, U20): find a named device on the stress house in two actions, by keyboard alone. Real page.keyboard and
// page.mouse (finding 3); the device's own icon box is measured against the canvas, not a computed number.

const EDITOR = "floorplan-studio-editor";
const stress = JSON.parse(readFileSync("tests/fixtures/stress-layout.json", "utf8")) as Layout;
const TARGET = "Guest bedroom bedside left"; // on Second; the editor opens on Ground

async function load(page: Page, w = 1440, h = 900) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  await page.evaluate(([tag, l]) => { (document.querySelector(tag as string) as any).layout = l; }, [EDITOR, stress] as const);
  await expect(page.locator(`${EDITOR} .chip[data-f="ground"]`)).toHaveAttribute("aria-pressed", "true");
}

/** The editor's own state: what is selected, on which floor, and the view. */
const state = (page: Page) => page.evaluate((tag) => {
  const st = (document.querySelector(tag) as any).st;
  return { floor: st.floor as string, sel: st.sel as { t: string; i: number } | null, view: st.view as { w: number; h: number }, undo: st.canUndo as boolean };
}, EDITOR);

/** The selected icon's box centre and the canvas's, in screen pixels. */
async function centres(page: Page) {
  const icon = (await page.locator(`${EDITOR} .canvas > svg g.dev.sel`).boundingBox())!;
  const svg = (await page.locator(`${EDITOR} .canvas > svg`).boundingBox())!;
  return { icon: [icon.x + icon.width / 2, icon.y + icon.height / 2], canvas: [svg.x + svg.width / 2, svg.y + svg.height / 2] };
}

async function expectFound(page: Page) {
  const s = await state(page);
  expect(s.floor).toBe("second");
  expect(s.sel).toEqual({ t: "dev", i: stress.floors.second.devices.findIndex((d) => d.name === TARGET) });
  await expect(page.locator(`${EDITOR} .chip[data-f="second"]`)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(`${EDITOR} .canvas > svg g.dev.sel title`)).toContainText(TARGET);
  const { icon, canvas } = await centres(page);
  expect(Math.abs(icon[0] - canvas[0])).toBeLessThan(3);
  expect(Math.abs(icon[1] - canvas[1])).toBeLessThan(3);
  // no less than 1:1: at least as close as the whole floor
  const fit = viewBoxFor(stress.floors.second as never, 80);
  expect(s.view.w).toBeLessThanOrEqual(fit.w + 1e-6);
  expect(s.undo).toBe(false); // going somewhere is not an edit
}

/** Tab from the page until focus is on a row of the tree; keyboard only. */
async function tabIntoTree(page: Page) {
  for (let n = 0; n < 60; n++) {
    await page.keyboard.press("Tab");
    const role = await page.evaluate(() => { let a: Element | null = document.activeElement; while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement; return a?.getAttribute("role"); });
    if (role === "treeitem") return;
  }
  throw new Error("Tab never reached the tree");
}
const focusedRow = (page: Page) => page.evaluate(() => { let a: Element | null = document.activeElement; while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement; return a?.querySelector(".tl")?.textContent ?? ""; });

test("search: /, a few letters, Enter selects the device on its floor and centres its icon in the canvas", async ({ page }) => {
  await load(page);
  await page.locator(`${EDITOR} .canvas > svg`).click({ position: { x: 5, y: 5 } }); // focus in the editor, nothing selected
  await page.keyboard.press("/");
  await page.keyboard.type("bedside guest");
  await expect(page.locator(`${EDITOR} fp-search [role="option"]`).first()).toContainText(TARGET);
  await page.keyboard.press("Enter");
  await expectFound(page);
  // the pulse marks the found icon for a moment
  await expect(page.locator(`${EDITOR} .canvas > svg g.dev.sel .locate`)).toHaveCount(1);
  // the Outline shows where it is: its floor and room open, its row marked and scrolled into the tree's view
  const row = page.locator(`${EDITOR} #outlineTree [role="treeitem"][aria-selected="true"]`);
  await expect(row.locator(".tl")).toHaveText(TARGET);
  await expect(row).toBeInViewport();
  const inTree = await row.evaluate((r) => { const t = r.closest("#outlineTree")!.getBoundingClientRect(), b = r.getBoundingClientRect(); return b.top >= t.top - 1 && b.bottom <= t.bottom + 1; });
  expect(inTree).toBe(true);
  await expect(row).toHaveAttribute("tabindex", "0"); // Tab into the tree lands on it
});

test("Cmd or Ctrl+K opens the search from the plan too", async ({ page }) => {
  await load(page);
  await page.locator(`${EDITOR} .canvas > svg`).click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("bedside guest");
  await page.keyboard.press("Enter");
  await expectFound(page);
});

test("outline: Tab into the tree, arrows, Enter selects the device and centres it", async ({ page }) => {
  await load(page);
  await tabIntoTree(page);
  expect(await focusedRow(page)).toBe("Ground");
  await page.keyboard.press("ArrowLeft"); // the floor on show starts open: close it
  await page.keyboard.press("ArrowDown"); // First
  await page.keyboard.press("ArrowDown"); // Second
  expect(await focusedRow(page)).toBe("Second");
  await page.keyboard.press("ArrowRight"); // open Second
  await page.keyboard.press("ArrowRight"); // Guest bedroom
  expect(await focusedRow(page)).toBe("Guest bedroom");
  await page.keyboard.press("ArrowRight"); // open it
  await page.keyboard.press("ArrowRight"); // its first device
  for (let n = 0; n < 3; n++) await page.keyboard.press("ArrowDown");
  expect(await focusedRow(page)).toBe(TARGET);
  await page.keyboard.press("Enter");
  await expectFound(page);
  expect(await focusedRow(page)).toBe(TARGET); // focus stays in the tree for the next one
});

test("outline: the arrows move in the tree, not the plan", async ({ page }) => {
  await load(page);
  await tabIntoTree(page);
  const before = await page.evaluate((tag) => JSON.stringify((document.querySelector(tag) as any).st.view), EDITOR);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowLeft");
  expect(await page.evaluate((tag) => JSON.stringify((document.querySelector(tag) as any).st.view), EDITOR)).toBe(before);
});

test("outline: the filter narrows the tree and opens the branches it found", async ({ page }) => {
  await load(page);
  await page.locator("#outlineFilter").fill("bedside guest");
  const rows = page.locator(`${EDITOR} #outlineTree [role="treeitem"] .tl`);
  await expect(rows).toHaveText(["Second", "Guest bedroom", TARGET, "Guest bedroom bedside right", "Guest bedroom bedside plug"]);
  await page.locator(`${EDITOR} #outlineTree [role="treeitem"]`, { hasText: TARGET }).click();
  await expectFound(page);
});

test("the plan svg is an image named after its floor", async ({ page }) => {
  await load(page);
  const svg = page.locator(`${EDITOR} .canvas > svg`);
  await expect(svg).toHaveAttribute("role", "img");
  await expect(svg).toHaveAttribute("aria-label", "Floor plan, Ground");
  await page.locator(`${EDITOR} .chip[data-f="second"]`).click();
  await expect(svg).toHaveAttribute("aria-label", "Floor plan, Second");
});

test("the column collapses with a button; the canvas takes the width and keeps the plan where it was", async ({ page }) => {
  await load(page);
  const side = page.locator(`${EDITOR} #side`);
  const svg = page.locator(`${EDITOR} .canvas > svg`);
  await expect(page.locator("#outlineTree")).toBeVisible();
  const open = (await svg.boundingBox())!;
  const view = () => page.evaluate((tag) => JSON.stringify((document.querySelector(tag) as any).st.views), EDITOR);
  const before = await view();
  await page.locator(`${EDITOR} #sideToggle`).click();
  await expect(page.locator("#outlineTree")).toHaveCount(0);
  await expect(page.locator(`${EDITOR} #sideToggle`)).toHaveAttribute("aria-expanded", "false");
  await expect.poll(async () => (await svg.boundingBox())!.width).toBeGreaterThan(open.width + 150);
  const shut = (await svg.boundingBox())!;
  expect(shut.y).toBeCloseTo(open.y, 0);
  expect(shut.height).toBeCloseTo(open.height, 0);
  // the view keeps its centre and zoom: the plan point in the middle of the canvas is the same one
  expect(await view()).toBe(before);
  await page.locator(`${EDITOR} #sideToggle`).click();
  await expect(page.locator("#outlineTree")).toBeVisible();
  await expect(side).toBeVisible();
});

test("under 1100 px the column starts collapsed", async ({ page }) => {
  await load(page, 1024, 768);
  await expect(page.locator(`${EDITOR} #sideToggle`)).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#outlineTree")).toHaveCount(0);
});

test("Unplaced from HA: grouped by area; a click opens Add > Device with that entity", async ({ page }) => {
  await load(page);
  await page.evaluate((tag) => {
    (document.querySelector(tag) as any).ha = {
      floors: [], areas: [{ id: "shed", name: "Shed" }],
      entities: [{ id: "light.shed_lamp", name: "Shed lamp", domain: "light", area: "shed" }, { id: "light.shed_strip", name: "Shed strip", domain: "light", area: "shed" }],
    };
  }, EDITOR);
  const last = page.locator(`${EDITOR} #outlineTree [role="treeitem"]`).last();
  await expect(last.locator(".tl")).toHaveText("Unplaced from HA");
  await expect(last.locator(".tc")).toHaveText("2");
  await last.click(); // a branch: opens
  await page.locator(`${EDITOR} #outlineTree [role="treeitem"]`, { hasText: "Shed" }).first().click();
  await page.locator(`${EDITOR} #outlineTree [role="treeitem"]`, { hasText: "Shed strip" }).click();
  const panel = page.locator("#addDevPanel");
  await expect(panel).toBeVisible();
  await expect(panel.locator("button[data-add]")).toHaveCount(1);
  await expect(panel.locator("button[data-add]")).toContainText("Shed strip");
  await expect(panel.locator("button[data-add]")).toBeFocused();
});

test("a command from the search runs what the menu runs: Fix plan off", async ({ page }) => {
  await load(page);
  await expect(page.locator("#fixPlan")).toBeChecked();
  await page.locator(`${EDITOR} .canvas > svg`).click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("/");
  await page.keyboard.type("unlock plan");
  await expect(page.locator(`${EDITOR} fp-search [role="option"]`).first()).toContainText("Unlock plan");
  await page.keyboard.press("Enter");
  await expect(page.locator("#fixPlan")).not.toBeChecked();
});

test("picking a room switches floor, selects it and centres it; a floor switches to it", async ({ page }) => {
  await load(page);
  await page.locator(`${EDITOR} .canvas > svg`).click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("/");
  await page.keyboard.type("server room");
  await page.keyboard.press("Enter");
  const s = await state(page);
  expect(s.floor).toBe("second");
  expect(s.sel).toEqual({ t: "room", i: stress.floors.second.rooms.findIndex((r) => r.name === "Server room") });
  await page.keyboard.press("/");
  await page.keyboard.type("first");
  await page.keyboard.press("Enter");
  expect((await state(page)).floor).toBe("first");
});

test("Opus review CSS pair: the pulse ring animates, and stands still under reduced motion", async ({ page }) => {
  await load(page);
  await page.locator(`${EDITOR} .canvas > svg`).click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("/");
  await page.keyboard.type("bedside guest");
  await page.keyboard.press("Enter");
  const ring = page.locator(`${EDITOR} .canvas > svg .locate`);
  expect(await ring.evaluate((el) => getComputedStyle(el).animationName)).toBe("fp-locate");
  expect(await ring.evaluate((el) => getComputedStyle(el).fill)).toBe("none");
  expect(await ring.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await ring.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  expect(Number(await ring.evaluate((el) => getComputedStyle(el).opacity))).toBeGreaterThan(0.5);
});

test("S24.R4: one id on two floors, a search reveals the picked floor's row in the Outline, for a piece and a device", async ({ page }) => {
  // Ids are unique per floor only (validate accepts this; device ids alone are unique in the layout). The Outline used to
  // key a row by the bare id, so "First TV" opened Ground's branch and marked no row. A device may share its id with a
  // piece on another floor too.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  await page.evaluate((tag) => {
    const ed = document.querySelector(tag) as any; const l = JSON.parse(JSON.stringify(ed.layout));
    l.floors.ground.furniture.push({ id: "tv", symbol: "tv", x: 420, y: 200, rot: 0, w: 100, h: 10, entity: "media_player.g_tv", name: "Ground TV" });
    l.floors.first.furniture.push({ id: "tv", symbol: "tv", x: 300, y: 200, rot: 0, w: 100, h: 10, entity: "media_player.f_tv", name: "First TV" });
    l.floors.ground.furniture.push({ id: "twin", symbol: "speaker", x: 420, y: 260, rot: 0, w: 20, h: 20, entity: "media_player.g_twin", name: "Ground twin" });
    l.floors.first.devices.push({ id: "twin", type: "light", entity: "light.f_twin", name: "First twin", x: 300, y: 260 });
    ed.layout = l;
  }, EDITOR);
  for (const [query, name, sel] of [["First TV", "First TV", "furn"], ["First twin", "First twin", "dev"]] as const) {
    await page.locator(`${EDITOR} .canvas > svg`).click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("/");
    await page.keyboard.type(query);
    await expect(page.locator(`${EDITOR} fp-search [role="option"]`).first()).toContainText(name);
    await page.keyboard.press("Enter");
    const s = await state(page);
    expect(s.floor).toBe("first");
    expect(s.sel?.t).toBe(sel);
    const row = page.locator(`${EDITOR} #outlineTree [role="treeitem"][aria-selected="true"]`);
    await expect(row).toHaveCount(1);
    await expect(row.locator(".tl")).toHaveText(name);
    await expect(row).toBeInViewport();
  }
  // every row of the tree has its own id
  const ids = await page.evaluate((tag) => [...(document.querySelector(tag) as any).shadowRoot.querySelectorAll("#outlineTree [data-node]")].map((r: any) => r.dataset.node as string), EDITOR);
  expect(new Set(ids).size).toBe(ids.length);
});
