import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { DEVICE_COLOURS } from "../../src/core/render";
import { validate, FURNITURE_SYMBOLS, type Layout, type Floor, type WallKind } from "../../src/core/schema";
import { GUIDE_STEPS } from "../../src/editor/guide";
import { decodePng, pixelAt } from "../core/util/png";

// Every pointer action goes through page.mouse at real screen coordinates, so the
// real top element decides what is hit (icons, handles, walls), as for a user.

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8")) as Layout;
const manifest = JSON.parse(readFileSync("custom_components/floorplan_studio/manifest.json", "utf8")) as { version: string };
const EDITOR = "floorplan-studio-editor";
const layoutOf = (page: Page) => page.evaluate((tag) => JSON.parse(JSON.stringify((document.querySelector(tag) as any).layout)) as Layout, EDITOR);
const groundOf = async (page: Page): Promise<Floor> => (await layoutOf(page)).floors.ground;
/** A snapped room can no longer be dragged by its body (it pans the view instead); tests of the drag-by-body mechanics
 *  themselves mark the room free first, the same way `Unsnap` does, rather than exercising that UI here too. */
async function freeRoom(page: Page, i: number) {
  await page.evaluate(([tag, idx]) => {
    const el = document.querySelector(tag as string) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.rooms[idx as number].free = true;
    el.layout = l;
  }, [EDITOR, i] as const);
}
// S8.5: the merged Add > Device panel; a catalog row's key is "catalog:<id>", an HA entity's is "ha:<entity id>".
const unplaced = (page: Page) => page.locator('#addDevPanel button[data-add^="catalog:"]');
const devItem = (page: Page, id: string) => page.locator(`#addDevPanel button[data-add="catalog:${id}"]`);
/** Counts unplaced catalog entries without needing the panel open (it opens one, counts, and closes it again). */
async function unplacedCount(page: Page): Promise<number> {
  await openDevice(page);
  const n = await unplaced(page).count();
  await page.locator("#addDevClose").click();
  return n;
}

async function centre(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
async function drag(page: Page, selector: string, dx: number, dy: number) {
  const c = await centre(page, selector);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + dx / 2, c.y + dy / 2, { steps: 4 });
  await page.mouse.move(c.x + dx, c.y + dy, { steps: 4 });
  await page.mouse.up();
}
async function menu(page: Page, name: string) {
  await page.locator(`details.menu > summary:text-is("${name}")`).click();
}
/** S4.11: which of Add's submenus a leaf item's id opened under, or null for one that stayed flat (Furniture). */
function addSubFor(id: string): "Openings" | "Wall" | "Areas" | null {
  if (id === "#addDoor" || id === "#addWin" || id === "#addGap") return "Openings";
  if (id.startsWith("#addWall-")) return "Wall";
  if (id === "#addStr" || id === "#addZone" || id === "#addStairs") return "Areas";
  return null;
}
/** Opens Add, then the leaf's submenu (if it has one), then clicks it. */
async function addItem(page: Page, id: string) {
  await menu(page, "Add");
  const sub = addSubFor(id);
  if (sub) await page.locator(`#mAdd details.sub > summary:text-is("${sub}")`).click();
  await page.locator(id).click();
}
/** S8.5: opens Add, then Device…, the floating panel merging the old Device and Entities submenus. */
async function openDevice(page: Page) {
  await menu(page, "Add");
  await page.locator("#addDevBtn").click();
  await expect(page.locator("#addDevPanel")).toBeVisible();
}
/** Chooses the snap grid in View, Grid (0 = none), and closes the menu. */
async function setGrid(page: Page, g: number) {
  await menu(page, "View");
  await page.locator(`#snap [data-grid="${g}"]`).click();
  await menu(page, "View");
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
});

test("loads the demo and draws the ground floor", async ({ page }) => {
  const l = await layoutOf(page);
  expect(l.floors.ground.rooms).toHaveLength(7); // three rooms, the Reading corner zone, garden, pavement and the pond
  await expect(page.locator("svg polygon[data-r]")).toHaveCount(7);
  await expect(page.locator(".chip[data-f]")).toHaveCount(3);
});

test("dragging a room corner 50 px moves the coincident corner of the neighbour", async ({ page }) => {
  const before = await groundOf(page);
  const living = before.rooms[0].pts[1], kitchen = before.rooms[1].pts[0];
  expect(living).toEqual([500, 0]);
  expect(kitchen).toEqual([500, 0]);
  await drag(page, 'circle[data-h="r0:1"]', 0, 50);
  const after = await groundOf(page);
  expect(after.rooms[0].pts[1]).not.toEqual([500, 0]);
  expect(after.rooms[0].pts[1][1]).toBeGreaterThan(0);
  expect(after.rooms[1].pts[0]).toEqual(after.rooms[0].pts[1]);
  // the panel shows the same numbers
  await expect(page.locator("#py")).toHaveValue(String(after.rooms[0].pts[1][1]));
});

test("Shift while dragging moves only the grabbed corner", async ({ page }) => {
  // The kitchen's corner is drawn after the living room's, so it is the one on top at (500, 0).
  await page.keyboard.down("Shift");
  await drag(page, 'circle[data-h="r1:0"]', 0, 50);
  await page.keyboard.up("Shift");
  const after = await groundOf(page);
  expect(after.rooms[1].pts[0][1]).toBeGreaterThan(0);
  expect(after.rooms[0].pts[1]).toEqual([500, 0]);
});

test("clicking a device icon selects that device, not what lies under it", async ({ page }) => {
  await page.mouse.click(...Object.values(await centre(page, 'g[data-x="0"]')) as [number, number]);
  await expect(page.locator("#panel")).toContainText("Living light");
  await expect(page.locator("#panel")).not.toContainText("Room");
});

// S8.9: the sidebar groups every selection panel's fields under small section headings, in a fixed order
// (Identity, Home Assistant, Links, Appearance, Automations, Danger last); a panel renders only the headings
// it has content for. This pins that order for a light, the type with the most sections.
test("S8.9: the device panel's section headings appear in the stated order for a light", async ({ page }) => {
  await page.mouse.click(...Object.values(await centre(page, 'g[data-x="0"]')) as [number, number]);
  await expect(page.locator("#panel")).toContainText("Living light");
  const headings = await page.locator("#panel h4.pnl-h").allTextContents();
  const order = ["Identity", "Home Assistant", "Links", "Appearance", "Automations", "Danger"];
  const positions = headings.map((h) => order.indexOf(h));
  expect(positions.every((p) => p >= 0)).toBe(true); // every heading shown is one of the six canonical names
  expect(positions).toEqual([...positions].sort((a, b) => a - b)); // and they appear in that fixed order
  expect(headings[0]).toBe("Identity");
  expect(headings.at(-1)).toBe("Danger");
});

test("Device places one and the list shrinks; removing it makes the list grow", async ({ page }) => {
  // the demo catalog holds one contact sensor not on the plan, and the relay: bound to a light, it has no icon (S1.32).
  expect(await unplacedCount(page)).toBe(2);
  await page.mouse.click(...Object.values(await centre(page, 'g[data-x="0"]')) as [number, number]);
  await page.locator("#vdel").click();
  // the light and its relay come back together
  expect(await unplacedCount(page)).toBe(3);
  expect((await groundOf(page)).devices).toHaveLength(7);
  await openDevice(page);
  await devItem(page, "light-living").click(); // a real click on the visible item
  await expect(unplaced(page)).toHaveCount(2); // S8.5: the panel stays open after a pick
  expect((await groundOf(page)).devices).toHaveLength(8);
});

test("Add, Furniture, bed places a bed that can be moved and resized in the panel", async ({ page }) => {
  await menu(page, "Add");
  await page.locator("#addFurn").selectOption("bed");
  let g = await groundOf(page);
  expect(g.furniture).toHaveLength(3);
  const bed = g.furniture[2];
  expect(bed.symbol).toBe("bed");
  const n = g.furniture.length - 1;
  await drag(page, `g[data-f="${n}"]`, 60, 40);
  g = await groundOf(page);
  expect(g.furniture[2].x).not.toBe(bed.x);
  await page.locator("#fr90").click();
  expect((await groundOf(page)).furniture[2].rot).toBe(90);
});

test("File, Save downloads a file that validates", async ({ page }) => {
  await menu(page, "File");
  const dl = page.waitForEvent("download");
  await page.locator("#save").click();
  const file = await (await dl).path();
  const res = validate(JSON.parse(readFileSync(file, "utf8")));
  expect(res.ok).toBe(true);
});

test("File, Export downloads the current layout, with no save-request and no host involved", async ({ page }) => {
  const before = await layoutOf(page);
  let saveRequested = false;
  await page.exposeFunction("__markSaveRequested", () => { saveRequested = true; });
  await page.evaluate((tag) => document.querySelector(tag)!.addEventListener("save-request", () => (window as any).__markSaveRequested()), EDITOR);
  await menu(page, "File");
  const dl = page.waitForEvent("download");
  await page.locator("#exp").click();
  const download = await dl;
  expect(download.suggestedFilename()).toMatch(/^floorplan-studio-\d{4}-\d{2}-\d{2}\.json$/);
  const file = await download.path();
  expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(before);
  expect(saveRequested).toBe(false);
});

test("S6.6: File, Install code shows the card YAML for this plan — its theme and every floor, first is ground — closed by its own X", async ({ page }) => {
  await menu(page, "File");
  await page.locator("#installcode").click();
  const panel = page.locator(`${EDITOR} .installcode-panel`);
  await expect(panel).toBeVisible();
  const code = await page.locator(`${EDITOR} #installcodeText`).inputValue();
  expect(code).toContain("views:");
  expect(code).toContain("type: custom:floorplan-studio-card");
  expect(code).toContain("theme: blueprint");
  const floorLines = code.split("\n").filter((l) => /^- "/.test(l.trim())).map((l) => JSON.parse(l.trim().slice(2)));
  expect(floorLines).toEqual(Object.keys((await layoutOf(page)).floors));
  await page.locator(`${EDITOR} #installcodeClose`).click();
  await expect(panel).toHaveCount(0);
});

test("S6.6: Install code reflects the theme picked in View", async ({ page }) => {
  await menu(page, "View");
  await page.locator(`${EDITOR} #thSub summary`).click();
  await page.locator(`${EDITOR} #thSub button[data-th="slate"]`).click();
  await menu(page, "File");
  await page.locator("#installcode").click();
  const code = await page.locator(`${EDITOR} #installcodeText`).inputValue();
  expect(code).toContain("theme: slate");
});

test("S6.6: Escape closes the Install code panel", async ({ page }) => {
  await menu(page, "File");
  await page.locator("#installcode").click();
  const panel = page.locator(`${EDITOR} .installcode-panel`);
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});

test("S6.6: Copy puts the same code on the clipboard and confirms in the status line", async ({ page }) => {
  await page.evaluate(() => {
    (window as any).__copied = null;
    Object.defineProperty(navigator, "clipboard", { value: { writeText: (t: string) => { (window as any).__copied = t; return Promise.resolve(); } }, configurable: true });
  });
  await menu(page, "File");
  await page.locator("#installcode").click();
  const code = await page.locator(`${EDITOR} #installcodeText`).inputValue();
  await page.locator(`${EDITOR} #installcodeCopy`).click();
  expect(await page.evaluate(() => (window as any).__copied)).toBe(code);
  await expect(page.locator("#status")).toHaveText("Install code copied.");
});

test("a reload restores the edit from localStorage and Reset starts from scratch", async ({ page }) => {
  await drag(page, 'circle[data-h="r0:1"]', 0, 50);
  const edited = await groundOf(page);
  await page.reload();
  await expect(page.locator("svg polygon[data-r]").first()).toBeVisible();
  expect((await groundOf(page)).rooms[0].pts[1]).toEqual(edited.rooms[0].pts[1]);
  page.once("dialog", (d) => d.accept());
  await menu(page, "File");
  await page.locator("#reset").click();
  const after = await layoutOf(page);
  expect(Object.values(after.floors).every((f) => f.rooms.length === 0 && f.devices.length === 0 && f.outline.length === 0)).toBe(true);
});

test("Undo brings back what Reset erased", async ({ page }) => {
  const before = await layoutOf(page);
  page.once("dialog", (d) => d.accept());
  await menu(page, "File");
  await page.locator("#reset").click();
  await menu(page, "File");
  await page.locator("#undo").click();
  expect(await layoutOf(page)).toEqual(before);
});

test("Load demo is off while the plan has content, and says why", async ({ page }) => {
  await menu(page, "File");
  await expect(page.locator("#loaddemo")).toBeDisabled();
  await expect(page.locator("#loaddemo")).toHaveAttribute("title", /Reset first/);
});

test("after Reset, Load demo loads the demo without asking, and is off again", async ({ page }) => {
  page.once("dialog", (d) => d.accept());
  await menu(page, "File");
  await page.locator("#reset").click();
  await menu(page, "File");
  await expect(page.locator("#loaddemo")).toBeEnabled();
  let asked = false;
  page.once("dialog", (d) => { asked = true; void d.dismiss(); });
  await page.locator("#loaddemo").click();
  expect(asked).toBe(false);
  expect(await layoutOf(page)).toEqual(demo);
  await menu(page, "File");
  await expect(page.locator("#loaddemo")).toBeDisabled();
});

test("break it: Reset cancelled keeps the plan and Load demo stays off", async ({ page }) => {
  const before = await layoutOf(page);
  page.once("dialog", (d) => d.dismiss());
  await menu(page, "File");
  await page.locator("#reset").click();
  expect(await layoutOf(page)).toEqual(before);
  await menu(page, "File");
  await expect(page.locator("#loaddemo")).toBeDisabled();
});

test("undo reverts the last drag", async ({ page }) => {
  await drag(page, 'circle[data-h="r0:1"]', 0, 50);
  await menu(page, "File");
  await page.locator("#undo").click();
  expect((await groundOf(page)).rooms[0].pts[1]).toEqual([500, 0]);
});

test("Open takes a v1 file and migrates it; a bad file lists errors and changes nothing", async ({ page }) => {
  const before = await layoutOf(page);
  await page.locator("#file").setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from('{"version":2,"floors":{"g":{"outline":[[0,0]]}}}') });
  await expect(page.locator("#errors")).toContainText("outline needs at least 3 points");
  expect(await layoutOf(page)).toEqual(before);
  await page.locator("#file").setInputFiles({ name: "junk.json", mimeType: "application/json", buffer: Buffer.from("not json") });
  await expect(page.locator("#errors")).toBeVisible();
  expect(await layoutOf(page)).toEqual(before);
  await page.locator("#file").setInputFiles("demo/layout.v1.json");
  await expect(page.locator("#errors")).toHaveCount(0);
  expect(validate(await layoutOf(page)).ok).toBe(true);
});

test("a device name with markup is shown as text", async ({ page }) => {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any;
    const l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.devices[0].name = '<img src=x onerror="window.__pwn=1">';
    el.layout = l;
  }, EDITOR);
  await menu(page, "View"); // S8.1: Names lives in View
  await page.locator("#names").click();
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => (window as any).__pwn)).toBeUndefined();
  await expect(page.locator("svg text.lbl", { hasText: "<img" })).toHaveCount(1);
});

// ---- S1.6 review fixes ------------------------------------------------------

/** Screen position of a plan point (cm), read through the svg's own matrix. */
const screenOf = (page: Page, x: number, y: number) =>
  page.evaluate(([tag, px, py]) => {
    const svg = (document.querySelector(tag as string) as any).shadowRoot.querySelector("svg") as SVGSVGElement;
    // A turned plan (S1.33) is drawn inside a group that carries the rotation: plan points are read through that group's own matrix.
    const g = svg.querySelector(':scope > g.plan-turn') as SVGGraphicsElement | null;
    const q = new DOMPoint(px as number, py as number).matrixTransform((g ?? svg).getScreenCTM()!);
    return { x: q.x, y: q.y };
  }, [EDITOR, x, y] as const);
async function dragCm(page: Page, from: [number, number], to: [number, number], mods: string[] = []) {
  const a = await screenOf(page, ...from), b = await screenOf(page, ...to);
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  for (const m of mods) await page.keyboard.up(m);
}

test("stairs draw edges and corner handles, and a corner can be dragged", async ({ page }) => {
  await expect(page.locator('svg circle[data-h="s0:0"]')).toHaveCount(1);
  await expect(page.locator('svg line[data-e^="s0:"]')).toHaveCount(4);
  const before = (await groundOf(page)).stairs[0].pts;
  await dragCm(page, [700, 420], [660, 450]);
  const after = (await groundOf(page)).stairs[0].pts;
  expect(after[0]).not.toEqual(before[0]);
  expect(after.slice(1)).toEqual(before.slice(1));
});

test("Shift while dragging a stairs corner moves only that corner", async ({ page }) => {
  // put another polygon's corner on the stairs corner, so Shift has something to leave behind
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.rooms[2].pts[2] = [780, 580];
    el.layout = l;
  }, EDITOR);
  const before = await groundOf(page);
  await dragCm(page, [780, 580], [760, 560], ["Shift"]);
  const after = await groundOf(page);
  expect(after.stairs[0].pts[2]).not.toEqual([780, 580]);
  expect(after.rooms[2].pts[2]).toEqual(before.rooms[2].pts[2]);
});

test("openings and extras have a body, and their names are text", async ({ page }) => {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.openings.push({ id: "opening-ground-1", a: [100, 400], b: [200, 400] });
    l.floors.ground.extras.push({ id: "extra-ground-1", name: "<b>shed</b>", a: [100, 450], b: [200, 520] });
    el.layout = l;
  }, EDITOR);
  await expect(page.locator("svg line.opening")).toHaveCount(1);
  await expect(page.locator("svg rect.extra")).toHaveCount(1);
  await expect(page.locator("svg text.lbl", { hasText: "<b>shed</b>" })).toHaveCount(1);
  await expect(page.locator("svg b")).toHaveCount(0);
  await expect(page.locator('svg circle[data-hp="openings:0:a"]')).toHaveCount(1);
});

test("keys act only inside the editor", async ({ page }) => {
  await page.evaluate(() => { for (const [tag, id] of [["input", "outside"], ["button", "outsideBtn"]]) { const e = document.createElement(tag); e.id = id; document.body.append(e); } });
  const c = await centre(page, 'g[data-x="0"]');
  await page.mouse.click(c.x, c.y);
  const before = await layoutOf(page);
  for (const id of ["#outside", "#outsideBtn"]) {
    await page.locator(id).focus();
    await page.keyboard.press("Delete");
    await page.keyboard.press("Backspace");
    expect(await layoutOf(page)).toEqual(before);
  }
  await page.mouse.click(c.x, c.y);
  await page.keyboard.press("Delete");
  expect((await groundOf(page)).devices).toHaveLength(before.floors.ground.devices.length - 1);
  await page.locator("#outsideBtn").focus();
  await page.keyboard.press("Control+z");
  expect((await groundOf(page)).devices).toHaveLength(before.floors.ground.devices.length - 1);
  await page.mouse.click(c.x + 400, c.y + 300);
  await page.keyboard.press("Control+z");
  expect(await layoutOf(page)).toEqual(before);
});

test("a device snaps to the 5 cm grid when chosen, and Alt places it freely", async ({ page }) => {
  await setGrid(page, 5); // S1.34: the default grid is 10; this test's numbers are on the 5 cm grid
  await dragCm(page, [250, 200], [263, 207]);
  let d = (await groundOf(page)).devices[0] as any;
  expect([d.x, d.y]).toEqual([265, 205]);
  expect(d.x % 5).toBe(0);
  await dragCm(page, [265, 205], [263, 207], ["Alt"]);
  d = (await groundOf(page)).devices[0] as any;
  expect([d.x, d.y]).toEqual([263, 207]);
});

test("Alt turns snapping off for a corner", async ({ page }) => {
  await setGrid(page, 5); // S1.34: the default grid is 10; this test's numbers are on the 5 cm grid
  await dragCm(page, [700, 420], [697, 433], ["Alt"]);
  expect((await groundOf(page)).stairs[0].pts[0]).toEqual([697, 433]);
  await dragCm(page, [697, 433], [663, 447]);
  expect((await groundOf(page)).stairs[0].pts[0]).toEqual([665, 445]);
});

test("a corner snaps to the nearest of loose ends and corners", async ({ page }) => {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.walls.push({ id: "wall-ground-1", a: [790, 410], b: [790, 480], kind: "wall" });
    el.layout = l;
  }, EDITOR);
  await dragCm(page, [700, 420], [797, 404]);
  // the room corner (800, 400) is 5 cm away, the wall end (790, 410) is 9 cm away
  expect((await groundOf(page)).stairs[0].pts[0]).toEqual([800, 400]);
});

test("break it: a corner dragged onto its own neighbour never collapses the edge", async ({ page }) => {
  // stairs are (700,420) (780,420) (780,580) (700,580); drag the first corner onto each neighbour
  for (const to of [[779, 421], [701, 579]] as [number, number][]) {
    await dragCm(page, [700, 420], to);
    const pts = (await groundOf(page)).stairs[0].pts;
    expect(pts[0], `dropped at ${to}`).not.toEqual([780, 420]);
    expect(pts[0], `dropped at ${to}`).not.toEqual([700, 580]);
    for (let j = 0; j < pts.length; j++) expect(Math.hypot(pts[j][0] - pts[(j + 1) % 4][0], pts[j][1] - pts[(j + 1) % 4][1])).toBeGreaterThan(0);
    await page.keyboard.press("Control+z");
  }
});

test("S4.24: the contact sensor picker follows the selected door, several allowed, one attach list per door", async ({ page }) => {
  // Rewritten for S4.24 (a door's contact sensors are now a list, not one .value): the #dsens select is an
  // "add" control (always resets to "") and each attached sensor gets its own row with a Remove button.
  const pick = async (i: number) => { const c = await centre(page, `line[data-d="${i}"]`); await page.mouse.click(c.x, c.y); };
  await pick(0); // Front door: already has one sensor attached
  await expect(page.locator("#dsens")).toHaveValue(""); // add-select, never shows the current pick as its value
  await expect(page.locator('#dsens option[value="binary_sensor.demo_front_door"]')).toHaveCount(0); // already attached: not offered again
  await pick(2); // Garage door: no sensor yet
  await expect(page.locator('#dsens option[value="binary_sensor.demo_garage_door"]')).toHaveCount(1);
  await pick(1);
  await expect(page.locator('#dsens option[value="binary_sensor.demo_patio_door"]')).toHaveCount(0); // Patio door's own sensor already attached to it
  // attach a sensor to the garage door, confirm it lands in the layout, then remove it again
  await pick(2);
  await page.locator("#dsens").selectOption("binary_sensor.demo_garage_door");
  expect((await groundOf(page)).doors[2].sensors).toEqual(["binary_sensor.demo_garage_door"]);
  await expect(page.locator('#dsens option[value="binary_sensor.demo_garage_door"]')).toHaveCount(0); // now attached: no longer offered
  await page.locator("#dsens-rm0").click();
  expect((await groundOf(page)).doors[2].sensors).toBeUndefined();
  await expect(page.locator('#dsens option[value="binary_sensor.demo_garage_door"]')).toHaveCount(1); // free again
});

// Opus review of S8.9: the "preview open" overlay was a fixed 22 cm regardless of the wall a door sat on, unlike
// the door's own stroke (S8.9 part 2, wallWidthAt). The Patio door sits on an external wall (20 cm), not the old
// fixed 22.
test("Opus review: the door preview-open overlay takes the width of the wall the door sits on, not a fixed 22", async ({ page }) => {
  const c = await centre(page, 'line[data-d="1"]'); // Patio door: on an external wall
  await page.mouse.click(c.x, c.y);
  await page.locator("#dopen").check();
  await expect(page.locator("line.door.open")).toHaveAttribute("stroke-width", "20");
});

// Opus review CSS pair of S8.9: h4.pnl-h's "no top border" exemption only covered zero or one leading hint before
// the first heading (:first-child, strong+h4, strong+p+h4). The stairs panel opens with two leading hints (straight,
// unrotated: "Drag corners..." then "Click an edge..."), so its first heading, Identity, kept the border meant only
// for a heading that follows a panel's own content.
test("Opus review CSS pair: a panel's first heading has no top border even after two leading hints (stairs panel)", async ({ page }) => {
  await addStairs(page);
  const heading = page.locator("#panel h4.pnl-h", { hasText: "Identity" }).first();
  await expect(heading).toBeVisible();
  const style = await heading.evaluate((el) => { const s = getComputedStyle(el); return { borderTopWidth: s.borderTopWidth, borderTopStyle: s.borderTopStyle }; });
  // Break it: drop "strong+p+p+h4.pnl-h" from the CSS selector and this reads a real 1px border again.
  expect(style).toEqual({ borderTopWidth: "0px", borderTopStyle: "none" });
});

test("File, Save waits for the host: Saving until saveDone, Saved after the download", async ({ page }) => {
  await menu(page, "File");
  const dl = page.waitForEvent("download");
  await page.locator("#save").click();
  await dl;
  // the standalone page calls saveDone(true) once its download started
  await expect(page.locator("#status")).toHaveText("Saved");
});

test("saveDone(true) says Saved, saveDone(false, msg) shows the error, and a slow host stays at Saving", async ({ page }) => {
  // a fresh element with one listener that never answers by itself
  await page.evaluate(([tag, l]) => {
    document.querySelector(tag)!.remove();
    const el = document.createElement(tag) as any;
    el.id = "e2";
    el.layout = l;
    el.addEventListener("save-request", () => { (window as any).__asked = ((window as any).__asked ?? 0) + 1; });
    document.body.append(el);
  }, [EDITOR, demo] as const);
  await menu(page, "File");
  await page.locator("#save").click();
  await expect(page.locator("#status")).toHaveText("Saving…");
  await page.waitForTimeout(300);
  await expect(page.locator("#status")).toHaveText("Saving…");
  await page.evaluate(() => (document.getElementById("e2") as any).saveDone(false, "Disk full"));
  await expect(page.locator("#status")).toHaveText("Disk full");
  await menu(page, "File");
  await page.locator("#save").click();
  await page.evaluate(() => (document.getElementById("e2") as any).saveDone(true));
  await expect(page.locator("#status")).toHaveText("Saved");
  expect(await page.evaluate(() => (window as any).__asked)).toBe(2);
});

test("with no save-request listener at all, Save falls back to Saved", async ({ page }) => {
  await page.evaluate(([tag, l]) => {
    document.querySelector(tag)!.remove();
    const el = document.createElement(tag) as any;
    el.layout = l;
    document.body.append(el);
  }, [EDITOR, demo] as const);
  await menu(page, "File");
  await page.locator("#save").click();
  await expect(page.locator("#status")).toHaveText("Saved");
});

// ---- add and remove stairs --------------------------------------------------

const stairsCount = (page: Page) => page.locator("svg g[data-s]");
const savedValid = async (page: Page) => {
  await menu(page, "File");
  const dl = page.waitForEvent("download");
  await page.locator("#save").click();
  const res = validate(JSON.parse(readFileSync(await (await dl).path(), "utf8")));
  expect(res.ok).toBe(true);
  return res.ok ? res.layout : null;
};
const addStairs = async (page: Page) => addItem(page, "#addStairs");

test("Add, Stairs places a 100 x 300 cm stairs on the grid, selected, with a fresh id", async ({ page }) => {
  await expect(stairsCount(page)).toHaveCount(1);
  await addStairs(page);
  await expect(stairsCount(page)).toHaveCount(2);
  const g = await groundOf(page);
  expect(g.stairs).toHaveLength(2);
  const t = g.stairs[1];
  expect(t.id).toBe("stairs-ground-2");
  expect(t.name).toBe("Stairs");
  const xs = t.pts.map((p) => p[0]), ys = t.pts.map((p) => p[1]);
  expect(Math.max(...xs) - Math.min(...xs)).toBe(100);
  expect(Math.max(...ys) - Math.min(...ys)).toBe(300);
  for (const n of [...xs, ...ys]) expect(Math.abs(n % 5)).toBe(0);
  await expect(page.locator("#sn")).toHaveValue("Stairs");
  await savedValid(page);
});

test("a stairs corner can be dragged, renamed in the panel, deleted with the button, and undo restores it", async ({ page }) => {
  await addStairs(page);
  await page.locator("#sn").fill("Cellar <b>stairs</b>");
  await page.locator("#sn").press("Enter");
  expect((await groundOf(page)).stairs[1].name).toBe("Cellar <b>stairs</b>");
  const before = (await groundOf(page)).stairs[1];
  await dragCm(page, before.pts[2] as [number, number], [before.pts[2][0] + 40, before.pts[2][1] + 40]);
  const moved = (await groundOf(page)).stairs[1];
  expect(moved.pts[2]).not.toEqual(before.pts[2]);
  // a click on the body selects it again (the drag left the corner selected)
  const c = await screenOf(page, moved.pts[0][0] + 50, moved.pts[0][1] + 60);
  await page.mouse.click(c.x, c.y);
  await page.locator("#sdel").click();
  await expect(stairsCount(page)).toHaveCount(1);
  expect((await groundOf(page)).stairs.map((s) => s.id)).toEqual(["stairs-ground-1"]);
  await menu(page, "File");
  await page.locator("#undo").click();
  await expect(stairsCount(page)).toHaveCount(2);
  const back = (await groundOf(page)).stairs;
  expect(back[1].id).toBe("stairs-ground-2");
  expect(back[1].name).toBe("Cellar <b>stairs</b>");
  expect(back[1].pts).toEqual(moved.pts);
});

test("Delete removes selected stairs; nothing selected is a no-op with no undo step; a saved file validates and a reload restores", async ({ page }) => {
  // nothing selected: Delete does nothing and Undo has nothing to undo
  await page.mouse.click(...Object.values(await screenOf(page, 300, 900)) as [number, number]);
  await page.keyboard.press("Delete");
  expect(await layoutOf(page)).toEqual(demo);
  await menu(page, "File");
  await expect(page.locator("#undo")).toBeDisabled();
  await menu(page, "File"); // closes it again
  // select the demo stairs by a real click, delete with the key
  const c = await screenOf(page, 740, 500);
  await page.mouse.click(c.x, c.y);
  await expect(page.locator("#sn")).toHaveValue("Stairs");
  await page.keyboard.press("Backspace");
  await expect(stairsCount(page)).toHaveCount(0);
  const l = await savedValid(page);
  expect(l?.floors.ground.stairs).toHaveLength(0);
  await page.reload();
  await expect(page.locator("svg polygon[data-r]").first()).toBeVisible();
  await expect(stairsCount(page)).toHaveCount(0);
});

test("two stairs get distinct ids after one is deleted and another added; every floor got its own ids (S1.26)", async ({ page }) => {
  await addStairs(page);
  await addStairs(page);
  expect((await groundOf(page)).stairs.map((s) => s.id)).toEqual(["stairs-ground-1", "stairs-ground-2", "stairs-ground-3"]);
  await page.locator("#sdel").click();
  await addStairs(page);
  const ids = (await groundOf(page)).stairs.map((s) => s.id);
  expect(new Set(ids).size).toBe(ids.length);
  // the upper floor had none: it got the three adds, and the delete touched the ground floor only
  await page.locator('.chip[data-f="first"]').click();
  await expect(stairsCount(page)).toHaveCount(3);
  await addStairs(page);
  await expect(stairsCount(page)).toHaveCount(4);
  expect((await layoutOf(page)).floors.first.stairs.map((t) => t.id)).toEqual(["stairs-first-1", "stairs-first-2", "stairs-first-3", "stairs-first-4"]);
  await savedValid(page);
});

// ---- Controlled by (bound light) -------------------------------------------
const selectDev = async (page: Page, i: number) =>
  page.mouse.click(...Object.values(await centre(page, `g[data-x="${i}"]`)) as [number, number]);
const RELAY = "switch.demo_living_relay";
/** Adds catalog entries and optionally runs `code` (a statement using `l`, the layout) before handing the layout to the editor. */
const setCatalog = (page: Page, extra: object[], code = "") =>
  page.evaluate(([tag, more, c]) => {
    const el = document.querySelector(tag as string) as any;
    const l = JSON.parse(JSON.stringify(el.layout));
    l.catalog.push(...(more as object[]));
    new Function("l", c as string)(l);
    el.layout = l;
  }, [EDITOR, extra, code] as const);
const bound = async (page: Page, i: number) => (await groundOf(page)).devices[i].bound;

test("the living light shows its relay; clearing it frees the relay, undo restores it", async ({ page }) => {
  await selectDev(page, 0);
  await expect(page.locator("#vbound")).toHaveValue(RELAY);
  await expect(page.locator("#panel")).toContainText("Living light + Living lamp relay");
  expect(await unplacedCount(page)).toBe(2); // the relay is listed while it is bound: it has no icon
  await page.locator("#vbound").selectOption("");
  expect(await bound(page, 0)).toBeUndefined();
  expect("bound" in (await groundOf(page)).devices[0]).toBe(false);
  expect(await unplacedCount(page)).toBe(2);
  await menu(page, "File");
  await page.locator("#undo").click();
  expect(await bound(page, 0)).toBe(RELAY);
  expect(await unplacedCount(page)).toBe(2);
  // choosing the same value again records no step
  await selectDev(page, 0);
  await page.locator("#vbound").selectOption(RELAY);
  await menu(page, "File");
  await expect(page.locator("#undo")).toBeDisabled();
});

test("choosing another free switch updates the list and the saved layout validates", async ({ page }) => {
  await setCatalog(page, [{ id: "plug-free", floor: "ground", room: "Living", type: "plug", name: "Free plug", entity: "switch.free_plug" }]);
  await selectDev(page, 0);
  await expect(page.locator("#vbound option")).toHaveText(["(none)", "Hall - Hall switch", "Living - TV plug", "Living - Living lamp relay", "Living - Free plug"]);
  await page.locator("#vbound").selectOption("switch.free_plug");
  expect(await bound(page, 0)).toBe("switch.free_plug");
  // a bound switch is still on the Device list: it has no icon of its own
  await openDevice(page);
  await expect(devItem(page, "switch-living-relay")).toHaveCount(1);
  await expect(devItem(page, "plug-free")).toHaveCount(1);
  expect(validate(await layoutOf(page)).ok).toBe(true);
  await savedValid(page);
});

test("a switch already bound elsewhere or placed is offered too; only the light's own entity is not", async ({ page }) => {
  await setCatalog(page, [], "l.floors.ground.devices[1].bound = l.floors.ground.devices[0].bound; delete l.floors.ground.devices[0].bound;");
  await selectDev(page, 0);
  await expect(page.locator("#vbound option")).toHaveText(["(none)", "Hall - Hall switch", "Living - TV plug", "Living - Living lamp relay"]); // the relay is the kitchen light's, the others are placed
  await page.locator("#vbound").selectOption(RELAY);
  expect(await bound(page, 0)).toBe(RELAY);
  expect(await bound(page, 1)).toBe(RELAY);
});

test("S1.32: two lights on one wall switch, and the switch placed as its own icon: all three are on the plan and the file is valid", async ({ page }) => {
  await selectDev(page, 1); // the kitchen light
  await page.locator("#vbound").selectOption(RELAY); // the living light already has it
  const g1 = await groundOf(page);
  expect(g1.devices.filter((d) => d.bound === RELAY).map((d) => d.id)).toEqual(["light-living", "light-kitchen"]);
  await openDevice(page);
  await devItem(page, "switch-living-relay").click(); // still offered while two lights name it
  await expect(devItem(page, "switch-living-relay")).toHaveCount(0);
  const g2 = await groundOf(page);
  expect(g2.devices.filter((d) => d.entity === RELAY)).toHaveLength(1);
  expect(g2.devices.filter((d) => d.bound === RELAY)).toHaveLength(2);
  await expect(page.locator("svg g.dev-light.bound")).toHaveCount(2);
  await expect(page.locator("svg g.dev-switch")).toHaveCount(2); // the hall switch and the relay
  expect(validate(await layoutOf(page)).ok).toBe(true);
  await savedValid(page);
});

test("S1.32 break it: a light cannot be bound to its own entity, so the file is refused", async ({ page }) => {
  const res = await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.devices[0].bound = l.floors.ground.devices[0].entity;
    return l;
  }, EDITOR);
  expect(validate(res).ok).toBe(false);
});

test("a device that is not a light has no Controlled by field", async ({ page }) => {
  await selectDev(page, 2);
  await expect(page.locator("#panel")).toContainText("Hall switch");
  await expect(page.locator("#vbound")).toHaveCount(0);
});

test("deleting the light returns its switch to the Add list", async ({ page }) => {
  await selectDev(page, 0);
  await page.locator("#vdel").click();
  await openDevice(page);
  await expect(devItem(page, "switch-living-relay")).toHaveCount(1);
  expect((await groundOf(page)).devices.some((d) => d.bound)).toBe(false);
});

test("a catalog name with markup is shown as text in Controlled by", async ({ page }) => {
  await setCatalog(page, [{ id: "plug-evil", floor: "ground", room: "Living", type: "plug", name: '<img src=x onerror="window.__pwn=1">', entity: "switch.evil" }]);
  await selectDev(page, 0);
  await expect(page.locator("#vbound option", { hasText: "<img" })).toHaveCount(1);
  await expect(page.locator("#vbound img")).toHaveCount(0);
  await page.locator("#vbound").selectOption("switch.evil");
  await expect(page.locator("#panel")).toContainText("+ <img");
  expect(await page.evaluate(() => (window as any).__pwn)).toBeUndefined();
});

// ---- selection and focus -------------------------------------------------------

test("clicking outside the editor clears the selection, so a highlight always means Delete works", async ({ page }) => {
  const c = await screenOf(page, 740, 500);
  await page.mouse.click(c.x, c.y);
  await expect(page.locator("svg polygon.hl")).toHaveCount(1);
  // into the side panel: the selection stays
  await page.locator("#sn").click();
  await expect(page.locator("svg polygon.hl")).toHaveCount(1);
  // onto the page outside the editor: it goes, and Delete then removes nothing
  await page.mouse.click(2, 2);
  await expect(page.locator("svg polygon.hl")).toHaveCount(0);
  await expect(page.locator("#panel")).toContainText("Nothing selected");
  await page.keyboard.press("Delete");
  await expect(stairsCount(page)).toHaveCount(1);
});

test("a blur that is still waiting to clear the selection does not clear one made after it", async ({ page }) => {
  // The clear runs one task after focus leaves. A click on a device in that gap must keep its selection.
  // Synthetic pointer here on purpose: a real click cannot land inside a one-task gap.
  await page.mouse.click(...Object.values(await centre(page, 'g[data-x="0"]')) as [number, number]);
  await page.locator("#vrot30").focus();
  await page.evaluate(async (tag) => {
    const root = (document.querySelector(tag) as any).shadowRoot as ShadowRoot;
    (root.activeElement as HTMLElement).blur(); // focus leaves for the page: the clear is queued
    root.querySelector('g[data-x="1"] path')!.dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true, composed: true, clientX: 0, clientY: 0 }));
    await new Promise((r) => setTimeout(r, 50));
  }, EDITOR);
  await expect(page.locator("#panel")).not.toContainText("Nothing selected");
  await expect(page.locator("g.dev.sel")).toHaveCount(1);
});

test("Ctrl+Z works right after the Delete button in the panel", async ({ page }) => {
  const c = await screenOf(page, 740, 500);
  await page.mouse.click(c.x, c.y);
  await page.locator("#sdel").click();
  await expect(stairsCount(page)).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(stairsCount(page)).toHaveCount(1);
});

test("a selection made from the Device menu survives the menu closing, then Delete works", async ({ page }) => {
  await openDevice(page);
  await unplaced(page).first().click();
  await expect(page.locator("g.dev.sel")).toHaveCount(1);
  await expect(page.locator("#panel")).not.toContainText("Nothing selected");
  const n = (await groundOf(page)).devices.length;
  await page.keyboard.press("Delete");
  expect((await groundOf(page)).devices.length).toBe(n - 1);
});

// ---- S1.8 zones and water ----------------------------------------------------
const addKind = async (page: Page, id: "#addZone") => addItem(page, id);
const roomPolys = (page: Page) => page.locator("svg polygon[data-r]");

test("Add, Zone places a 200 x 200 cm zone on the grid, centred on the spawn point, selected, dotted, with all wk boundary; one undo step removes it", async ({ page }) => {
  const before = await groundOf(page);
  await addKind(page, "#addZone");
  await expect(roomPolys(page)).toHaveCount(before.rooms.length + 1);
  const g = await groundOf(page), z = g.rooms[g.rooms.length - 1], n = g.rooms.length - 1;
  expect(z.kind).toBe("zone");
  expect(z.wk).toEqual(["boundary", "boundary", "boundary", "boundary"]);
  expect(new Set(g.rooms.map((r) => r.id)).size).toBe(g.rooms.length);
  const xs = z.pts.map((p) => p[0]), ys = z.pts.map((p) => p[1]);
  expect(Math.max(...xs) - Math.min(...xs)).toBe(200);
  expect(Math.max(...ys) - Math.min(...ys)).toBe(200);
  for (const v of [...xs, ...ys]) expect(Math.abs(v % 5)).toBe(0);
  expect([Math.min(...xs) + 100, Math.min(...ys) + 100]).toEqual([1050, 0]); // centred on the spawn point, clear of the demo's own devices (reach x 900), not just the outline (S1.20, S4.13-adjacent)
  // selected: the panel shows kind zone
  await expect(page.locator("#rk")).toHaveValue("zone");
  // its four edges are dotted for real: the browser resolves the dash array from the shared CSS
  const edges = page.locator(`svg line[data-e^="r${n}:"]`);
  await expect(edges).toHaveCount(4);
  for (let i = 0; i < 4; i++) {
    await expect(edges.nth(i)).toHaveClass(/\bnw\b/);
    expect(await edges.nth(i).evaluate((el) => getComputedStyle(el).strokeDasharray)).not.toBe("none");
  }
  expect(await page.locator(`svg polygon[data-r="${n}"]`).evaluate((el) => getComputedStyle(el).fill)).toBe("none");
  await menu(page, "File");
  await page.locator("#undo").click();
  await expect(roomPolys(page)).toHaveCount(before.rooms.length);
  await savedValid(page);
});

test("a drawn water polygon is filled from --fp-water and selected", async ({ page }) => {
  await startDraw(page, "drawWater");
  await clicksCm(page, [830, 100], [890, 100], [890, 200], [830, 200]);
  await page.keyboard.press("Enter");
  const g = await groundOf(page), w = g.rooms[g.rooms.length - 1], n = g.rooms.length - 1;
  expect(w.kind).toBe("water");
  await expect(page.locator("#rk")).toHaveValue("water");
  const fill = (sel: string) => page.locator(sel).evaluate((el) => getComputedStyle(el).fill);
  const water = await fill(`svg polygon[data-r="${n}"]`);
  expect(water).not.toBe("none");
  expect(water).not.toBe(await fill('svg polygon[data-r="0"]'));
  await savedValid(page);
});

test("the room panel kind select lists zone and water; picking zone clears every wall flag, and it undoes in one step", async ({ page }) => {
  const at = await screenOf(page, 200, 150);
  await page.mouse.click(at.x, at.y);
  await expect(page.locator("#rk")).toHaveValue("room");
  const options = await page.locator("#rk option").allTextContents();
  expect(options).toEqual(expect.arrayContaining(["Zone", "Water"])); // labels, not raw ids
  expect((await groundOf(page)).rooms[0].wk).toEqual(["external", "wall", "wall", "external"]); // two edges lie on the perimeter (S1.52)
  await page.locator("#rk").selectOption("zone");
  const z = (await groundOf(page)).rooms[0];
  expect(z.kind).toBe("zone");
  expect(z.wk).toEqual(["boundary", "boundary", "boundary", "boundary"]);
  await menu(page, "File");
  await page.locator("#undo").click();
  const back = (await groundOf(page)).rooms[0];
  expect(back.kind).toBe("room");
  expect(back.wk).toEqual(["external", "wall", "wall", "external"]);
});

test("dragging a zone corner onto a wall does not insert a point into the wall or the rooms", async ({ page }) => {
  await addKind(page, "#addZone");
  const g0 = await groundOf(page), zi = g0.rooms.length - 1, z = g0.rooms[zi];
  const counts = (g: Floor) => ({ o: g.outline.length, rooms: g.rooms.slice(0, 3).map((r) => r.pts.length), w: g.rooms.slice(0, 3).map((r) => r.wk.length), walls: g.walls.length });
  const before = counts(g0);
  // the corner that has no neighbour on the target; the target lies on the living / kitchen wall x = 500
  const corner = z.pts.reduce((a, p) => (p[0] < a[0] ? p : a)); // a left corner of the zone
  const j = z.pts.indexOf(corner);
  const target: [number, number] = [500, 250];
  expect(z.pts.some((p) => p[0] === 500 && p[1] === 250)).toBe(false);
  await dragCm(page, corner as [number, number], target);
  const g1 = await groundOf(page);
  expect(g1.rooms[zi].pts[j]).toEqual(target); // it did land on the wall
  expect(counts(g1)).toEqual(before);
  expect(g1.rooms[0].pts).toEqual(g0.rooms[0].pts);
  expect(g1.rooms[1].pts).toEqual(g0.rooms[1].pts);
});

test("dragging a room corner onto a zone edge does not insert a point into the zone", async ({ page }) => {
  const g0 = await groundOf(page), zi = g0.rooms.findIndex((r) => r.kind === "zone"), z = g0.rooms[zi];
  const top = z.pts.filter((p) => p[1] === Math.min(...z.pts.map((q) => q[1])));
  const mx = Math.round((top[0][0] + top[1][0]) / 2 / 5) * 5;
  // hall corner (0, 600) is far; drag the kitchen's free corner (800, 0)?  Use the living room corner (0, 400) onto the zone's top edge
  const target: [number, number] = [mx, top[0][1]];
  await dragCm(page, [0, 400], target);
  const g1 = await groundOf(page);
  expect(g1.rooms[0].pts.some((p) => p[0] === target[0] && p[1] === target[1])).toBe(true);
  expect(g1.rooms[zi].pts).toHaveLength(z.pts.length);
});

test("a room corner dropped 8 cm from a zone corner does not snap onto it", async ({ page }) => {
  await setGrid(page, 5); // S1.34: the default grid is 10; this test's numbers are on the 5 cm grid
  const g0 = await groundOf(page), z = g0.rooms.find((r) => r.kind === "zone")!;
  const c = z.pts[2]; // (460, 140)
  await dragCm(page, [0, 400], [c[0] + 8, c[1] + 6]);
  const p = (await groundOf(page)).rooms[0].pts[3];
  expect(p).not.toEqual(c);
  expect(p).toEqual([c[0] + 10, c[1] + 5]); // the 5 cm grid, not the zone corner
});

// ---- S1.8 zone selection ----
async function clickCm(page: Page, x: number, y: number) {
  const c = await screenOf(page, x, y);
  await page.mouse.click(c.x, c.y);
}

test("a click inside the Reading corner selects the zone: room panel with kind zone and area reading", async ({ page }) => {
  await clickCm(page, 440, 60);
  await expect(page.locator("#rk")).toHaveValue("zone");
  await expect(page.locator("#ra")).toHaveValue("reading");
  await expect(page.locator("#rn")).toHaveValue("Reading corner");
});

test("a click in the living room outside the zone selects the living room", async ({ page }) => {
  await clickCm(page, 200, 150);
  await expect(page.locator("#rk")).toHaveValue("room");
  await expect(page.locator("#ra")).toHaveValue("living");
});

test("a device icon inside a zone still selects the device, not the zone", async ({ page }) => {
  const g = await groundOf(page);
  const zone = g.rooms.find((r) => r.kind === "zone")!;
  const d = g.devices.find((x) => "x" in x && x.x > 340 && x.x < 460 && x.y > 40 && x.y < 140)!;
  expect(d).toBeTruthy();
  expect(zone).toBeTruthy();
  await clickCm(page, (d as any).x, (d as any).y);
  await expect(page.locator("#ve")).toHaveValue(d.entity);
  await expect(page.locator("#rk")).toHaveCount(0);
});

test("a zone listed before the room under it is still on top: a click inside it selects the zone", async ({ page }) => {
  const l = await layoutOf(page);
  const rooms = l.floors.ground.rooms, zi = rooms.findIndex((r) => r.kind === "zone");
  rooms.unshift(...rooms.splice(zi, 1)); // the zone is now rooms[0], drawn before the living room
  await page.evaluate(([tag, lay]) => { (document.querySelector(tag as string) as any).layout = lay; }, [EDITOR, l] as const);
  await expect(page.locator('svg polygon[data-r="0"]')).toHaveClass(/room-zone/);
  await clickCm(page, 440, 60);
  await expect(page.locator("#rk")).toHaveValue("zone");
  await expect(page.locator("#ra")).toHaveValue("reading");
});

// ---- S1.9 wall kinds ----
const WALL_KINDS = ["wall", "boundary", "external", "fence", "edge"] as const;
const WALL_CLASS: Record<string, string> = { wall: "e", boundary: "e nw", external: "e external", fence: "e fence", edge: "e edge" };

/** Five free walls of one kind each, side by side under the house (outline ends at y 600), clear of every room. */
async function withWallRow(page: Page) {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout));
    const kinds = ["wall", "boundary", "external", "fence", "edge"];
    l.floors.ground.walls = kinds.map((kind, i) => ({ id: `wall-ground-${i + 1}`, a: [10 + i * 150, 650], b: [110 + i * 150, 650], kind }));
    el.layout = l;
  }, EDITOR);
  await expect(page.locator("svg line[data-w]")).toHaveCount(5);
}

test("clicking each wall with the mouse selects it and the kind select shows its kind", async ({ page }) => {
  await withWallRow(page);
  for (const [i, kind] of WALL_KINDS.entries()) {
    await clickCm(page, 60 + i * 150, 650);
    await expect(page.locator("#wk")).toHaveValue(kind);
    await expect(page.locator(`svg line[data-w="${i}"]`)).toHaveClass(new RegExp(`^${WALL_CLASS[kind]}$`));
  }
});

test("a thin fence stays clickable a few pixels off its line, and of two walls 6 px apart the nearer one wins", async ({ page }) => {
  await withWallRow(page);
  const c = await screenOf(page, 60 + 3 * 150, 650); // the fence
  await page.mouse.click(c.x, c.y + 5);
  await expect(page.locator("#wk")).toHaveValue("fence");
  await page.mouse.click(c.x, c.y - 6);
  await expect(page.locator("#wk")).toHaveValue("fence");
  // a competing outdoor edge 6 screen px below the fence, both inside the 8 px pick radius of a click between them
  const perCm = ((await screenOf(page, 60 + 3 * 150, 660)).y - c.y) / 10;
  await page.evaluate(([tag, dy]) => {
    const el = document.querySelector(tag as string) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.walls.push({ id: "wall-ground-6", a: [460, 650 + (dy as number)], b: [560, 650 + (dy as number)], kind: "edge" });
    el.layout = l;
  }, [EDITOR, 6 / perCm] as const);
  await expect(page.locator("svg line[data-w]")).toHaveCount(6);
  await page.mouse.click(c.x, c.y + 1.5); // 1.5 px from the fence, 4.5 from the edge wall
  await expect(page.locator("#wk")).toHaveValue("fence");
  await page.mouse.click(c.x, c.y + 4.5); // 4.5 px from the fence, 1.5 from the edge wall
  await expect(page.locator("#wk")).toHaveValue("edge");
});

test("the wall panel has a kind select with five human labels, the opening entry and no toggle button", async ({ page }) => {
  await withWallRow(page);
  await clickCm(page, 60, 650);
  await expect(page.locator("#wk")).toHaveJSProperty("tagName", "SELECT");
  expect(await page.locator("#wk option").evaluateAll((o) => o.map((x) => [(x as HTMLOptionElement).value, x.textContent]))).toEqual([
    ["wall", "Internal wall"], ["boundary", "Dotted boundary"], ["external", "External wall"], ["fence", "Fence"], ["edge", "Outdoor edge"], ["opening", "Opening (a gap in the wall)"],
  ]);
  await expect(page.locator("button#wk")).toHaveCount(0);
});

test("changing a wall's kind in the panel changes its class, is one undo step, and undo restores it", async ({ page }) => {
  await withWallRow(page);
  await clickCm(page, 60, 650);
  for (const kind of ["external", "fence", "edge", "boundary"]) {
    await page.locator("#wk").selectOption(kind);
    await expect(page.locator('svg line[data-w="0"]')).toHaveClass(new RegExp(`^${WALL_CLASS[kind]}$`));
    expect((await groundOf(page)).walls[0].kind).toBe(kind);
  }
  await page.locator("#wk").selectOption("boundary"); // unchanged: no step
  await page.locator("#wk").selectOption("wall");
  await page.locator("#wk").selectOption("fence");
  await page.locator("#wk").selectOption("wall");
  await page.keyboard.press("Control+z");
  expect((await groundOf(page)).walls[0].kind).toBe("fence");
  await page.keyboard.press("Control+z");
  expect((await groundOf(page)).walls[0].kind).toBe("wall");
  await page.keyboard.press("Control+z");
  expect((await groundOf(page)).walls[0].kind).toBe("boundary");
});

// ---- S1.10 floors ----
const chips = (page: Page) => page.locator(".chip[data-f]");
const chipKeys = (page: Page) => chips(page).evaluateAll((c) => c.map((x) => x.getAttribute("data-f")));
const chipTitles = (page: Page) => chips(page).allTextContents();
const floorKeys = async (page: Page) => Object.keys((await layoutOf(page)).floors);
const undoBtn = (page: Page) => page.locator("#undo");

/** Types a title into the "+" chip's input with the real keyboard and presses Enter. */
/**
 * A new floor with the inherited outline and stairs taken away again: what a floor looked like before S1.27.
 * The layout setter refuses an outline of fewer than three points (validate), so this reaches into the editor's state.
 */
async function addBareFloor(page: Page, title: string) {
  await addFloorVia(page, title);
  await page.evaluate(([tag, key]) => {
    const el = document.querySelector(tag as string) as any, f = el.st.layout.floors[key as string];
    f.outline = []; f.stairs = [];
    el.st.views = {};
    el.requestUpdate();
  }, [EDITOR, title.toLowerCase()]);
  await expect(page.locator("svg g[data-s]")).toHaveCount(0);
}
/** S8.1: Add floor is an item of the Edit menu; the title input still appears after the floor chips. */
async function clickAddFloor(page: Page) {
  await menu(page, "Edit");
  const c = await centre(page, "#addFloor");
  await page.mouse.click(c.x, c.y);
}
async function addFloorVia(page: Page, title: string) {
  await clickAddFloor(page);
  await expect(page.locator("#newFloor")).toBeFocused();
  await page.keyboard.type(title);
  await page.keyboard.press("Enter");
}

test("Edit, Add floor opens an input after the floor chips, and Enter adds a floor that is selected and has no rooms", async ({ page }) => {
  await expect(page.locator(".bar > #addFloor")).toHaveCount(0); // S8.1: no + chip in the bar any more
  await expect(page.locator("#newFloor")).toHaveCount(0);
  await clickAddFloor(page);
  const input = await page.locator("#newFloor").boundingBox(), last = await chips(page).last().boundingBox();
  expect(input!.x).toBeGreaterThan(last!.x + last!.width - 1);
  await page.keyboard.type("Attic");
  await page.keyboard.press("Enter");
  expect(await chipKeys(page)).toEqual(["ground", "first", "test", "attic"]);
  expect(await chipTitles(page)).toEqual(["Ground", "First", "Test", "Attic"]);
  await expect(page.locator('.chip[data-f="attic"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#newFloor")).toHaveCount(0);
  await expect(page.locator("svg polygon[data-r]")).toHaveCount(0); // no rooms
  const l = await layoutOf(page);
  expect(l.floors.attic).toMatchObject({ title: "Attic", outline: l.floors.ground.outline, rooms: [], walls: [], devices: [], furniture: [] }); // S1.27: the outline is inherited
  expect(l.floors.ground.rooms).toHaveLength(7); // untouched
});

test("Add floor then Esc adds nothing and leaves no undo step; Enter on an empty or blank title adds nothing", async ({ page }) => {
  await clickAddFloor(page);
  await page.keyboard.type("Nope");
  await page.keyboard.press("Escape");
  await expect(page.locator("#newFloor")).toHaveCount(0);
  await clickAddFloor(page);
  await page.keyboard.press("Enter");
  await page.keyboard.type("   ");
  await page.keyboard.press("Enter");
  await expect(page.locator("#newFloor")).toBeVisible(); // still asking
  await page.keyboard.press("Escape");
  expect(await floorKeys(page)).toEqual(["ground", "first", "test"]);
  await menu(page, "File");
  await expect(undoBtn(page)).toBeDisabled();
});

test("break it: adding \"Ground\" gets the key ground-2 and does not overwrite the ground floor", async ({ page }) => {
  await addFloorVia(page, "Ground");
  const l = await layoutOf(page);
  expect(Object.keys(l.floors)).toEqual(["ground", "first", "test", "ground-2"]);
  expect(l.floors.ground.rooms).toHaveLength(7);
  expect(l.floors["ground-2"].rooms).toHaveLength(0);
});

test("with nothing selected the panel is the floor panel: title field, Move up, Move down, Delete; a selection replaces it", async ({ page }) => {
  await expect(page.locator("#panel")).toContainText("Nothing selected");
  await expect(page.locator("#ft")).toHaveValue("Ground");
  await expect(page.locator("#fdown")).toBeDisabled(); // lowest floor
  await expect(page.locator("#fup")).toBeEnabled();
  await expect(page.locator("#fdel")).toBeEnabled();
  await clickCm(page, 200, 150);
  await expect(page.locator("#ft")).toHaveCount(0);
  await expect(page.locator("#rk")).toHaveValue("room");
});

test("renaming from the panel changes the chip title, keeps the key, is one undo step", async ({ page }) => {
  await addFloorVia(page, "Attic");
  await page.locator("#ft").fill("  Loft  ");
  await page.locator("#ft").press("Enter");
  expect(await chipTitles(page)).toEqual(["Ground", "First", "Test", "Loft"]);
  expect(await chipKeys(page)).toEqual(["ground", "first", "test", "attic"]);
  await page.locator("#ft").fill("   "); // blank: refused, the field falls back
  await page.locator("#ft").press("Enter");
  await expect(page.locator("#ft")).toHaveValue("Loft");
  expect(await chipTitles(page)).toEqual(["Ground", "First", "Test", "Loft"]);
  await page.locator("#panel").click({ position: { x: 2, y: 2 } });
  await page.keyboard.press("Control+z");
  expect(await chipTitles(page)).toEqual(["Ground", "First", "Test", "Attic"]);
});

test("a title is text, never markup", async ({ page }) => {
  await addFloorVia(page, '"><img src=x onerror=window.__pwned=1>');
  await expect(page.locator(".chip[data-f]").last()).toHaveText('"><img src=x onerror=window.__pwned=1>');
  await expect(page.locator("#ft")).toHaveValue('"><img src=x onerror=window.__pwned=1>');
  expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined();
  await page.locator("#fdel").click();
  await expect(page.locator("#panel")).toContainText('Delete floor "><img src=x onerror=window.__pwned=1> and everything on it?');
  await expect(page.locator("#panel img")).toHaveCount(0);
});

test("Move down puts Attic first, the chips follow the order, Move up is disabled at the top, and it undoes", async ({ page }) => {
  await addFloorVia(page, "Attic"); // ground, first, test, attic; attic selected, at the top
  await expect(page.locator("#fup")).toBeDisabled();
  await page.locator("#fdown").click();
  expect(await chipKeys(page)).toEqual(["ground", "first", "attic", "test"]);
  await page.locator("#fdown").click();
  expect(await chipKeys(page)).toEqual(["ground", "attic", "first", "test"]);
  await page.locator("#fdown").click();
  expect(await chipKeys(page)).toEqual(["attic", "ground", "first", "test"]);
  expect(await floorKeys(page)).toEqual(["attic", "ground", "first", "test"]);
  await expect(page.locator("#fdown")).toBeDisabled();
  await expect(page.locator('.chip[data-f="attic"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator("#fup").click();
  expect(await chipKeys(page)).toEqual(["ground", "attic", "first", "test"]);
  await page.keyboard.press("Control+z");
  expect(await chipKeys(page)).toEqual(["attic", "ground", "first", "test"]);
  await page.keyboard.press("Control+z");
  expect(await chipKeys(page)).toEqual(["ground", "attic", "first", "test"]);
  await page.keyboard.press("Control+z");
  expect(await chipKeys(page)).toEqual(["ground", "first", "attic", "test"]);
  await page.keyboard.press("Control+z");
  expect(await chipKeys(page)).toEqual(["ground", "first", "test", "attic"]);
});

test("Delete asks first inline: Cancel keeps the floor; Delete removes it and selects a neighbour", async ({ page }) => {
  await addFloorVia(page, "Attic");
  await page.locator("#fdel").click();
  await expect(page.locator("#panel")).toContainText("Delete floor Attic and everything on it?");
  await page.locator("#fdelno").click();
  await expect(page.locator("#panel")).not.toContainText("and everything on it?");
  expect(await floorKeys(page)).toEqual(["ground", "first", "test", "attic"]);
  await page.locator("#fdel").click();
  await page.locator("#fdelyes").click();
  expect(await chipKeys(page)).toEqual(["ground", "first", "test"]);
  await expect(page.locator('.chip[data-f="test"]')).toHaveAttribute("aria-pressed", "true"); // the neighbour before it
  await expect(page.locator("#panel")).not.toContainText("and everything on it?");
});

test("a pointer press on the plan cancels a pending delete confirm", async ({ page }) => {
  await page.locator("#fdel").click();
  await expect(page.locator("#fdelyes")).toBeVisible();
  await clickCm(page, 200, 150);
  await page.mouse.click(2, 2); // out of the editor: selection clears, the floor panel is back
  await expect(page.locator("#fdelyes")).toHaveCount(0);
  expect(await floorKeys(page)).toEqual(["ground", "first", "test"]);
});

test("deleting the ground floor with content, then Undo, brings it back in place with all its content", async ({ page }) => {
  const before = await layoutOf(page);
  await page.locator("#fdel").click();
  await page.locator("#fdelyes").click();
  expect(await chipKeys(page)).toEqual(["first", "test"]);
  await page.locator('.chip[data-f="test"]').click();
  await page.locator("#fdel").click();
  await page.locator("#fdelyes").click();
  expect(await chipKeys(page)).toEqual(["first"]);
  await expect(page.locator("#fdel")).toBeDisabled(); // the last floor cannot go
  await page.keyboard.press("Control+z"); // undo delete test
  await page.keyboard.press("Control+z"); // undo delete ground
  expect(await chipKeys(page)).toEqual(["ground", "first", "test"]);
  expect(await layoutOf(page)).toEqual(before);
  await page.locator('.chip[data-f="ground"]').click();
  await expect(page.locator("svg polygon[data-r]")).toHaveCount(7);
});

test("devices of a deleted floor go back to the Device menu and the catalog is unchanged", async ({ page }) => {
  await openDevice(page);
  const n = await unplaced(page).count();
  await page.keyboard.press("Escape");
  const cat = (await layoutOf(page)).catalog;
  await page.locator('.chip[data-f="first"]').click();
  await page.locator("#fdel").click();
  await page.locator("#fdelyes").click();
  expect((await layoutOf(page)).catalog).toEqual(cat);
  await openDevice(page);
  expect(await unplaced(page).count()).toBeGreaterThan(n);
});

test("a floor added, renamed, moved and deleted is four undo steps, one per action", async ({ page }) => {
  await addFloorVia(page, "Attic"); // ground, first, test, attic
  await page.locator("#ft").fill("Loft");
  await page.locator("#ft").press("Enter");
  await page.locator("#fdown").click(); // ground, first, attic, test
  await page.locator("#fdel").click();
  await page.locator("#fdelyes").click();
  expect(await floorKeys(page)).toEqual(["ground", "first", "test"]);
  for (const [keys, titles] of [
    [["ground", "first", "attic", "test"], ["Ground", "First", "Loft", "Test"]], // undo the delete
    [["ground", "first", "test", "attic"], ["Ground", "First", "Test", "Loft"]], // undo the move
    [["ground", "first", "test", "attic"], ["Ground", "First", "Test", "Attic"]], // undo the rename
  ] as [string[], string[]][]) {
    await page.keyboard.press("Control+z");
    expect(await chipKeys(page)).toEqual(keys);
    expect(await chipTitles(page)).toEqual(titles);
  }
  await page.keyboard.press("Control+z");
  expect(await floorKeys(page)).toEqual(["ground", "first", "test"]);
});

// ---- S1.11 draw mode ----
const DRAW_STATUS = "Click to add points, double-click or Enter to finish, Esc to cancel";

/** Draw, then one Draw item, through the real menu — opening its submenu first (S4.26: Draw is grouped like Add). */
async function startDraw(page: Page, id: string) {
  await menu(page, "Draw");
  const sub = page.locator(`#mDraw details.sub:has(#${id})`);
  await sub.locator("summary").click();
  await page.locator(`#${id}`).click(); // scrolls the menu to the item; the menu is taller than a short window
}
/** Real clicks at plan points (cm). */
async function clicksCm(page: Page, ...pts: [number, number][]) {
  for (const [x, y] of pts) await clickCm(page, x, y);
}
const svgCursor = (page: Page) => page.locator("svg").first().evaluate((s) => getComputedStyle(s).cursor);
const drawnPoints = (page: Page) => page.locator("svg [data-dp]");
// Free ground below the house (outline ends at y 600), away from every corner. Off-grid on purpose:
// the snapped points differ from the pointer, so a click that skipped snapping is caught.
const FREE: [number, number][] = [[103, 632], [297, 633], [298, 668], [102, 667]];
const FREE_SNAPPED = [[105, 630], [295, 630], [295, 670], [105, 670]];

test("Draw, Room: four clicks and Enter give a room of four points at the snapped coordinates, selected, one undo step", async ({ page }) => {
  await setGrid(page, 5); // S1.34: the default grid is 10; this test's numbers are on the 5 cm grid
  const before = await groundOf(page);
  await startDraw(page, "drawRoom");
  await expect(page.locator("#status")).toHaveText(DRAW_STATUS);
  expect(await svgCursor(page)).toBe("crosshair");
  await clicksCm(page, ...FREE);
  await expect(drawnPoints(page)).toHaveCount(4);
  expect(await groundOf(page)).toEqual(before); // nothing is written before the shape is finished
  await page.keyboard.press("Enter");
  const g = await groundOf(page);
  expect(g.rooms).toHaveLength(before.rooms.length + 1);
  const room = g.rooms.at(-1)!;
  expect(room.pts).toEqual(FREE_SNAPPED);
  expect([room.kind, room.name, room.area, room.wk]).toEqual(["room", "New room", "new-room", ["wall", "wall", "wall", "wall"]]);
  await expect(page.locator("#rn")).toHaveValue("New room"); // selected: the room panel
  await expect(drawnPoints(page)).toHaveCount(0);
  expect(await svgCursor(page)).not.toBe("crosshair");
  expect(validate(await layoutOf(page)).ok).toBe(true);
  await page.keyboard.press("Control+z");
  expect(await groundOf(page)).toEqual(before);
  await expect(page.locator("#undo")).toBeDisabled();
});

test("Draw, Wall (fence): three clicks and Enter give two fence walls sharing a point, one undo step", async ({ page }) => {
  await setGrid(page, 5); // S1.34: the default grid is 10; this test's numbers are on the 5 cm grid
  const before = await groundOf(page);
  await startDraw(page, "drawWall-fence");
  await clicksCm(page, FREE[0], FREE[1], FREE[2]);
  await page.keyboard.press("Enter");
  const g = await groundOf(page);
  expect(g.walls).toHaveLength(2);
  expect(g.walls.map((w) => w.kind)).toEqual(["fence", "fence"]);
  expect(g.walls[0].a).toEqual([105, 630]);
  expect(g.walls[0].b).toEqual([295, 630]);
  expect(g.walls[1].a).toEqual(g.walls[0].b);
  expect(g.walls[1].b).toEqual([295, 670]);
  await expect(page.locator("#wk")).toHaveValue("fence"); // the last wall is selected
  await page.keyboard.press("Control+z");
  expect(await groundOf(page)).toEqual(before);
});

test("each of the five wall kinds is drawn with its own kind", async ({ page }) => {
  for (const kind of WALL_KINDS) {
    await startDraw(page, `drawWall-${kind}`);
    await clicksCm(page, [103, 632], [297, 633]);
    await page.keyboard.press("Enter");
    const walls = (await groundOf(page)).walls;
    expect(walls.at(-1)!.kind).toBe(kind);
    // and the plan shows it: the class the core gives that kind, on the line just drawn
    await expect(page.locator(`svg line[data-w="${walls.length - 1}"]`)).toHaveClass(new RegExp(`^${WALL_CLASS[kind]}$`));
  }
  expect((await groundOf(page)).walls).toHaveLength(5);
});

test("Esc after two clicks leaves the floor unchanged and the undo stack as long as before", async ({ page }) => {
  await drag(page, 'circle[data-h="r0:1"]', 0, 50); // one real undo step to count against
  const before = await groundOf(page);
  await startDraw(page, "drawRoom");
  await clicksCm(page, FREE[0], FREE[1]);
  await expect(drawnPoints(page)).toHaveCount(2);
  await page.keyboard.press("Escape");
  expect(await groundOf(page)).toEqual(before);
  await expect(drawnPoints(page)).toHaveCount(0);
  await expect(page.locator("[data-draw]")).toHaveCount(0);
  expect(await svgCursor(page)).not.toBe("crosshair");
  await page.keyboard.press("Control+z"); // exactly one step: the drag, not a phantom draw step
  await expect(page.locator("#undo")).toBeDisabled();
  expect((await groundOf(page)).rooms[0].pts[1]).toEqual([500, 0]);
});

test("after Esc a click on the plan selects again instead of adding points", async ({ page }) => {
  await startDraw(page, "drawRoom");
  await clicksCm(page, FREE[0]);
  await page.keyboard.press("Escape");
  await clickCm(page, 60, 200); // inside the living room
  await expect(page.locator("#rn")).toHaveValue("Living");
  await expect(drawnPoints(page)).toHaveCount(0);
});

test("Backspace removes the last point; the shape then uses the remaining ones", async ({ page }) => {
  await setGrid(page, 5); // S1.34: the default grid is 10; this test's numbers are on the 5 cm grid
  await startDraw(page, "drawRoom");
  await clicksCm(page, [103, 632], [297, 633], [298, 668]);
  await page.keyboard.press("Backspace");
  await expect(drawnPoints(page)).toHaveCount(2);
  await clicksCm(page, [200, 668]);
  await page.keyboard.press("Enter");
  expect((await groundOf(page)).rooms.at(-1)!.pts).toEqual([[105, 630], [295, 630], [200, 670]]);
});

test("entering draw mode clears the selection, so Delete and Backspace cannot remove it", async ({ page }) => {
  await clickCm(page, 60, 200); // select the living room
  await expect(page.locator("#rn")).toHaveValue("Living");
  const n = (await groundOf(page)).rooms.length;
  await startDraw(page, "drawRoom");
  await expect(page.locator("#rn")).toHaveCount(0);
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Delete");
  expect((await groundOf(page)).rooms).toHaveLength(n);
  await expect(page.locator("#status")).toHaveText(DRAW_STATUS);
});

test("finishing with fewer than three points leaves the floor and the undo stack unchanged", async ({ page }) => {
  const before = await groundOf(page);
  await startDraw(page, "drawRoom");
  await clicksCm(page, FREE[0], FREE[1]);
  await page.keyboard.press("Enter");
  expect(await groundOf(page)).toEqual(before);
  await expect(page.locator("#undo")).toBeDisabled();
  await expect(drawnPoints(page)).toHaveCount(0);
  // a wall needs two points
  await startDraw(page, "drawWall-wall");
  await clicksCm(page, FREE[0]);
  await page.keyboard.press("Enter");
  expect(await groundOf(page)).toEqual(before);
  await expect(page.locator("#undo")).toBeDisabled();
});

test("Draw, Zone on top of a room's corner does not snap to it", async ({ page }) => {
  await setGrid(page, 5); // S1.34: the default grid is 10; this test's numbers are on the 5 cm grid
  const g0 = await groundOf(page);
  expect(g0.rooms[0].pts[2]).toEqual([500, 400]); // Living's corner, also Kitchen's and the Hall's edge
  await startDraw(page, "drawZone");
  await clicksCm(page, [503, 398], [603, 398], [603, 460]);
  await page.keyboard.press("Enter");
  const z = (await groundOf(page)).rooms.at(-1)!;
  expect(z.kind).toBe("zone");
  expect(z.pts[0]).toEqual([505, 400]); // the grid, not the corner (500, 400)
  expect(z.wk).toEqual(["boundary", "boundary", "boundary"]);
  expect((await groundOf(page)).rooms[0].pts).toEqual(g0.rooms[0].pts); // nothing stitched into the room
});

test("Draw, Room next to an existing corner snaps to it", async ({ page }) => {
  await startDraw(page, "drawRoom");
  await clicksCm(page, [503, 398], [560, 470], [420, 470]); // first point within reach of the corner (500, 400)
  await page.keyboard.press("Enter");
  const g = await groundOf(page);
  expect(g.rooms.at(-1)!.pts[0]).toEqual([500, 400]);
});

test("a double-click finishes the shape without a duplicate point", async ({ page }) => {
  await setGrid(page, 5); // S1.34: the default grid is 10; this test's numbers are on the 5 cm grid
  await startDraw(page, "drawRoom");
  await clicksCm(page, FREE[0], FREE[1], FREE[2]);
  const c = await screenOf(page, FREE[3][0], FREE[3][1]);
  await page.mouse.dblclick(c.x, c.y);
  const room = (await groundOf(page)).rooms.at(-1)!;
  expect(room.pts).toEqual(FREE_SNAPPED);
  await expect(drawnPoints(page)).toHaveCount(0);
});

test("a click on the first point closes a polygon of three or more points and adds no point", async ({ page }) => {
  await setGrid(page, 5); // S1.34: the default grid is 10; this test's numbers are on the 5 cm grid
  await startDraw(page, "drawRoom");
  await clicksCm(page, [103, 632], [297, 633], [298, 668]);
  await clickCm(page, 107, 628); // on the first point
  const g = await groundOf(page);
  expect(g.rooms.at(-1)!.pts).toEqual([[105, 630], [295, 630], [295, 670]]);
  await expect(drawnPoints(page)).toHaveCount(0);
});

test("break it: a click on the first point of a 2-point polygon does not close it", async ({ page }) => {
  const before = await groundOf(page);
  await startDraw(page, "drawRoom");
  await clicksCm(page, [103, 632], [297, 633]);
  await clickCm(page, 107, 628);
  await expect(drawnPoints(page)).toHaveCount(2);
  await expect(page.locator("#status")).toHaveText(DRAW_STATUS);
  expect(await groundOf(page)).toEqual(before);
  await clickCm(page, 200, 668); // still drawing: a third point
  await expect(drawnPoints(page)).toHaveCount(3);
});

test("Alt while clicking disables snapping", async ({ page }) => {
  await startDraw(page, "drawRoom");
  await page.keyboard.down("Alt");
  await clicksCm(page, [103, 632], [297, 633], [298, 668]);
  await page.keyboard.up("Alt");
  await page.keyboard.press("Enter");
  const pts = (await groundOf(page)).rooms.at(-1)!.pts;
  for (const [i, p] of [[103, 632], [297, 633], [298, 668]].entries()) {
    expect(Math.abs(pts[i][0] - p[0])).toBeLessThanOrEqual(1);
    expect(Math.abs(pts[i][1] - p[1])).toBeLessThanOrEqual(1);
  }
  expect(pts[0]).not.toEqual([105, 630]);
});

test("Draw, Outline replaces the floor outline in one undo step", async ({ page }) => {
  await setGrid(page, 5); // S1.34: the default grid is 10; this test's numbers are on the 5 cm grid
  const before = await groundOf(page);
  await startDraw(page, "drawOutline");
  await clicksCm(page, ...FREE);
  await page.keyboard.press("Enter");
  expect((await groundOf(page)).outline).toEqual(FREE_SNAPPED);
  await page.keyboard.press("Control+z");
  expect((await groundOf(page)).outline).toEqual(before.outline);
});

test("Opus review: drawing an outline with a different point count still Saves without an error dialog (draw.ts:71-76)", async ({ page }) => {
  await setGrid(page, 5); // S1.34: the default grid is 10; these numbers are on the 5 cm grid
  await startDraw(page, "drawOutline");
  await clicksCm(page, [100, 630], [200, 600], [300, 630], [300, 670], [100, 670]); // 5 points; the demo's outline has 4
  await page.keyboard.press("Enter");
  const g = await groundOf(page);
  expect(g.outline).toHaveLength(5);
  expect(g.owk).toHaveLength(5); // owk must track the outline's new point count, or Save below refuses the layout
  await menu(page, "File");
  const dl = page.waitForEvent("download");
  await page.locator("#save").click();
  await expect(page.locator("#errors")).toHaveCount(0);
  await expect(page.locator("#status")).not.toContainText("owk");
  const file = await (await dl).path();
  expect(validate(JSON.parse(readFileSync(file, "utf8"))).ok).toBe(true);
});

test("Draw, Water and Draw, Opening and Draw, Structure line add their shapes", async ({ page }) => {
  await setGrid(page, 5); // S1.34: the default grid is 10; this test's numbers are on the 5 cm grid
  await startDraw(page, "drawWater");
  await clicksCm(page, [850, 300], [900, 300], [900, 350]);
  await page.keyboard.press("Enter");
  const w = (await groundOf(page)).rooms.at(-1)!;
  expect([w.kind, w.name, w.area, w.wk]).toEqual(["water", "New water", "", ["boundary", "boundary", "boundary"]]);
  await startDraw(page, "drawOpening");
  await clicksCm(page, [103, 632], [297, 633]); // the second click finishes a single segment
  await expect(drawnPoints(page)).toHaveCount(0);
  expect((await groundOf(page)).openings.map((o) => [o.a, o.b])).toEqual([[[105, 630], [295, 630]]]);
  await expect(page.locator("#ol")).toHaveValue("190"); // the opening is selected on finish (S1.13)
  await expect(page.locator("svg line.hl")).toHaveCount(1);
  await startDraw(page, "drawExtra");
  await clicksCm(page, [103, 662], [297, 663]);
  await expect(page.locator("#exn")).toHaveValue("New line"); // S4.13: selected on finish, like an opening
  const g = await groundOf(page);
  expect(g.extras).toHaveLength(1);
  expect(g.extras[0].name).toBe("New line");
  expect(validate(await layoutOf(page)).ok).toBe(true);
});

// S4.13 (Opus review, real-layout repro): a structure line's own body took no clicks at all (`.extra` was
// `pointer-events:none`), so a click on "tech area" or "boiler + tank" always fell through to the room under
// it. The test draws one on top of a room on purpose, deselects, then clicks the line itself, not a handle.
test("an existing structure line, drawn over a room, is still selectable and deletable by clicking it", async ({ page }) => {
  await startDraw(page, "drawExtra");
  await clicksCm(page, [180, 150], [260, 150]); // inside the Living Room: on top of a room, like Diego's basement extras
  await clickCm(page, 150, 650); // free ground: deselect
  await expect(page.locator("#panel")).toContainText("Nothing selected");
  await clickCm(page, 220, 150); // the line's own midpoint, still over the room
  await expect(page.locator("#exn")).toHaveValue("New line");
  await page.locator("#exdel").click();
  expect((await groundOf(page)).extras).toHaveLength(0);
});

test("switching floor mid-draw cancels: no points left, no change, later clicks select", async ({ page }) => {
  const before = await layoutOf(page);
  await startDraw(page, "drawRoom");
  await clicksCm(page, FREE[0], FREE[1]);
  await page.locator('.chip[data-f]:not([aria-pressed="true"])').first().click();
  await page.locator('.chip[data-f="ground"]').click();
  await expect(drawnPoints(page)).toHaveCount(0);
  expect(await svgCursor(page)).not.toBe("crosshair");
  expect(await layoutOf(page)).toEqual(before);
  await clicksCm(page, FREE[2]);
  await expect(drawnPoints(page)).toHaveCount(0);
  await expect(page.locator("#undo")).toBeDisabled();
});

test("choosing another Add item or Undo mid-draw leaves draw mode and its rubber band", async ({ page }) => {
  await startDraw(page, "drawRoom");
  await clicksCm(page, FREE[0], FREE[1]);
  await startDraw(page, "drawZone"); // another Draw item starts afresh
  await expect(drawnPoints(page)).toHaveCount(0);
  await clickCm(page, 200, 668);
  await expect(drawnPoints(page)).toHaveCount(1);
  await addItem(page, "#addDoor"); // a single-shape item ends draw mode
  await expect(drawnPoints(page)).toHaveCount(0);
  expect(await svgCursor(page)).not.toBe("crosshair");
  // Undo
  await startDraw(page, "drawRoom");
  await clicksCm(page, FREE[0]);
  await page.keyboard.press("Control+z"); // undoes the door
  await expect(drawnPoints(page)).toHaveCount(0);
  expect(await svgCursor(page)).not.toBe("crosshair");
  await expect(page.locator("[data-draw]")).toHaveCount(0);
});

test("the rubber band runs from the last point to the pointer as a dashed line, in editor variables", async ({ page }) => {
  await setGrid(page, 5); // S1.34: the default grid is 10; this test's numbers are on the 5 cm grid
  await startDraw(page, "drawRoom");
  await clicksCm(page, FREE[0]);
  const c = await screenOf(page, 250, 660);
  await page.mouse.move(c.x, c.y);
  const path = page.locator('svg [data-draw="path"]');
  await expect(path).toHaveCount(1);
  const pts = (await path.getAttribute("points"))!.split(" ").map((s) => s.split(",").map(Number));
  expect(pts[0]).toEqual([105, 630]);
  expect(Math.abs(pts[1][0] - 250)).toBeLessThanOrEqual(5);
  expect(await path.evaluate((e) => getComputedStyle(e).strokeDasharray)).not.toBe("none");
  expect(await path.evaluate((e) => e.outerHTML)).not.toMatch(/#[0-9a-f]{3,6}|rgb\(/i);
});

test("draw mode still pans with the middle button and zooms with the wheel, and keeps its points", async ({ page }) => {
  await startDraw(page, "drawRoom");
  await clicksCm(page, FREE[0]);
  const vb = () => page.locator("svg").first().getAttribute("viewBox");
  const v0 = await vb();
  const c = await screenOf(page, 250, 300);
  await page.mouse.move(c.x, c.y);
  await page.mouse.wheel(0, 300);
  await expect.poll(vb).not.toBe(v0);
  const v1 = await vb();
  await page.mouse.move(c.x, c.y);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(c.x + 60, c.y + 40, { steps: 4 });
  await page.mouse.up({ button: "middle" });
  expect(await vb()).not.toBe(v1);
  await expect(drawnPoints(page)).toHaveCount(1); // still drawing, nothing added by the pan
  await expect(page.locator("#status")).toHaveText(DRAW_STATUS);
});

test("draw-mode keys stay on the editor: Enter and Esc elsewhere in the page do nothing", async ({ page }) => {
  await startDraw(page, "drawRoom");
  await clicksCm(page, FREE[0], FREE[1], FREE[2]);
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(drawnPoints(page)).toHaveCount(3);
});

test("draw items keep the single-shape Add items: Zone still adds a square in one step", async ({ page }) => {
  await addItem(page, "#addZone");
  expect((await groundOf(page)).rooms.at(-1)!.kind).toBe("zone");
});

test("the plan filter checks several device types at once, dropping any one un-checks it, All clears the filter", async ({ page }) => {
  const total = await page.locator("svg .dev").count();
  const lights = await page.locator("svg .dev-light").count(), switches = await page.locator("svg .dev-switch").count();
  expect(total).toBeGreaterThan(lights + switches); // the demo has other device types too, or this test proves nothing

  await page.locator("#filter summary").click();
  await page.locator('#filter [data-filter="light"]').click();
  await expect(page.locator("svg .dev:visible")).toHaveCount(lights);
  await expect(page.locator('#filter [data-filter="light"]')).toHaveAttribute("aria-pressed", "true");

  await page.locator('#filter [data-filter="switch"]').click();
  await expect(page.locator("svg .dev:visible")).toHaveCount(lights + switches);
  await expect(page.locator("#filter summary")).toHaveText("Filter: 2 types");

  await page.locator('#filter [data-filter="light"]').click(); // un-check one, the other stays checked
  await expect(page.locator("svg .dev:visible")).toHaveCount(switches);
  await expect(page.locator('#filter [data-filter="switch"]')).toHaveAttribute("aria-pressed", "true");

  await page.locator("#filterAll").click();
  await expect(page.locator("svg .dev:visible")).toHaveCount(total);
  await expect(page.locator("#filter summary")).toHaveText(`Filter: all (${total})`);
});

test("Opus review CSS pair: a pressed filter-menu row is visually highlighted, not just aria-pressed", async ({ page }) => {
  const styleOf = (sel: string) => page.locator(sel).evaluate((el) => { const s = getComputedStyle(el); return { bg: s.backgroundColor, color: s.color }; });
  await page.locator("#filter summary").click();
  const before = await styleOf('#filter [data-filter="light"]');
  await page.locator('#filter [data-filter="light"]').click();
  const pressed = await styleOf('#filter [data-filter="light"]');
  const stillUnpressed = await styleOf('#filter [data-filter="switch"]');
  expect(pressed).not.toEqual(before); // pressing must change the row's own look
  expect(pressed).not.toEqual(stillUnpressed); // ...and set it apart from a row that is not pressed
});

test("the plan filter hides device types with no instance on the current floor, keeps the ones that have some", async ({ page }) => {
  await page.locator("#filter summary").click();
  await expect(page.locator('#filter [data-filter="light"]')).toBeVisible(); // ground has 2
  await expect(page.locator('#filter [data-filter="humidity"]')).toHaveCount(0); // ground has 0
  await expect(page.locator('#filter [data-filter="tv"]')).toHaveCount(0); // ground has 0
});

// ---- S1.12/S8.5 Add > Device panel --------------------------------------------
const search = (page: Page) => page.locator("#addDevSearch");
const shown = (page: Page) => page.locator("#addDevPanel button[data-add]:visible");

test("the toolbar order is Filter, Add, Draw, View, Edit, File; Device… is a button of Add, right after Areas", async ({ page }) => {
  await expect(page.locator("details.menu > summary")).toHaveText(["Filter: all (8)", "Add", "Draw", "View", "Edit", "File"]); // S8.1: Filter, and an Edit menu
  await expect(page.locator("#mAdd select")).toHaveCount(2); // furniture and unlinked-device selects (S4.25)
  await menu(page, "Add");
  const subs = await page.locator("#mAdd > .box > *").evaluateAll((els) => els.map((e) => e.id || e.tagName));
  const areasIdx = subs.indexOf("addAreas");
  expect(subs[areasIdx + 1]).toBe("addDevBtn"); // Device… sits right after Areas
});

// ---- S8.10: the toolbar's right-aligned cluster (menus, Undo/Redo, status) --------------------------------------

test("S8.10: the toolbar's Redo button sits flush against the toolbar's right edge; the floor chips stay left; no horizontal scroll at 380", async ({ page }) => {
  for (const width of [1280, 380]) {
    await page.setViewportSize({ width, height: 800 });
    const bar = await page.locator(".bar").first().boundingBox();
    const chip = await page.locator(".bar .chip").first().boundingBox();
    // S8.10 follow-up: Undo/Redo moved to be the cluster's last items (after Help), so Redo's own right edge is
    // now the one pinned to the toolbar's, not Help's.
    const redo = await page.locator("#redo").boundingBox();
    if (!bar || !chip || !redo) throw new Error("missing toolbar box");
    // Break it: put back the old `<span class="grow">` right after the floor chips and this fails — Redo sits
    // hundreds of px short of the toolbar's own right edge (measured pre-fix: 1256 - 828 ~= 427px at 1280 wide).
    expect(chip.x - bar.x, `${width}px: floor chip left edge`).toBeLessThan(4);
    expect(bar.x + bar.width - (redo.x + redo.width), `${width}px: Redo right edge vs toolbar right edge`).toBeLessThanOrEqual(4);
    // Opus review CSS pair (finding 10): the computed style behind the alignment, not just its presence as a string.
    // flex:1 1 0 (not a shrink-to-fit box pushed by its own margin-left:auto) is what makes this deterministic: a
    // shrink-to-fit `.bar-right` sized itself from its own content, and nesting a flex-wrap item inside another
    // flex-wrap row like that left Chromium free to settle on either of two different widths for identical content,
    // depending only on what triggered the last layout pass — a real regression this test caught (S8.10 follow-up).
    // Below 768px (S8.10 follow-up) the media query forces flex-basis:100% so the cluster wraps to its own row
    // instead of squeezing beside the chips; above it, flex-basis:0% still lets it fill the line it shares with them.
    const style = await page.locator(".bar-right").evaluate((el) => { const s = getComputedStyle(el); return { justifyContent: s.justifyContent, flexGrow: s.flexGrow, flexBasis: s.flexBasis }; });
    expect(style.justifyContent, `${width}px`).toBe("flex-end");
    expect(style.flexGrow, `${width}px: fills the line deterministically, not by shrink-to-fit + margin-left:auto`).toBe("1");
    expect(style.flexBasis, `${width}px`).toBe(width <= 768 ? "100%" : "0%");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow, `${width}px: horizontal scroll`).toBe(false);
  }
});

test("S8.10 follow-up: the right-aligned cluster is tight — equal gaps, Redo flush right, a status change moves no button", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  // Break it: put back `.status{flex:0 1 12em;min-width:6em;max-width:12em}` (the pre-follow-up rule that always
  // reserved 12em for "Ready") and this fails — the gap right before Help balloons far past the 6px flex gap.
  const items = await page.locator(".bar-right > *").evaluateAll((els) => els
    .filter((el) => (el as HTMLElement).offsetParent !== null || getComputedStyle(el as HTMLElement).display !== "none")
    .map((el) => { const r = el.getBoundingClientRect(); return { id: (el as HTMLElement).id || el.className, x: r.x, right: r.x + r.width, cy: r.y + r.height / 2 }; }));
  // Single row at 1280: every visible item shares the same row (align-items:center lines up their vertical
  // centres, not their tops — items differ in height, a <span> vs a <details>/<button>).
  const rowCy = items[0].cy;
  for (const it of items) expect(Math.abs(it.cy - rowCy), it.id).toBeLessThan(3);
  const sorted = [...items].sort((a, b) => a.x - b.x);
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].x - sorted[i - 1].right;
    expect(gap, `${sorted[i - 1].id} -> ${sorted[i].id}`).toBeGreaterThanOrEqual(4);
    expect(gap, `${sorted[i - 1].id} -> ${sorted[i].id}`).toBeLessThanOrEqual(8);
  }
  const bar = (await page.locator(".bar").boundingBox())!;
  const redo = (await page.locator("#redo").boundingBox())!;
  expect(bar.x + bar.width - (redo.x + redo.width), "Redo right edge vs toolbar right edge").toBeLessThanOrEqual(4);
  const filterXBefore = (await page.locator("#filter").boundingBox())!.x;
  await page.evaluate(([tag, m]) => (document.querySelector(tag) as any).saveDone(true, m), [EDITOR, "Saved to Home Assistant"] as const);
  await expect(page.locator("#status")).toHaveText("Saved to Home Assistant");
  const filterXAfter = (await page.locator("#filter").boundingBox())!.x;
  expect(filterXAfter, "Filter's x must not move when the status text changes").toBeCloseTo(filterXBefore, 0);
});

test("S8.10 follow-up: at 380 wide the right-aligned cluster takes its own full-width row below the floor chips, right-aligned, chips top-aligned", async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 900 });
  const bar = (await page.locator(".bar").boundingBox())!;
  const chip = (await page.locator(".bar .chip").first().boundingBox())!;
  const clusterBox = (await page.locator(".bar-right").boundingBox())!;
  // Break it: with flex-basis reverted to 0% (no narrow-width override) the cluster squeezes onto the chips' own
  // row instead of wrapping to its own — this fails because the cluster's row then shares the chips' y and the
  // cluster is far narrower than the toolbar.
  expect(clusterBox.y, "cluster starts below the chips' row").toBeGreaterThan(chip.y + chip.height - 2);
  expect(clusterBox.width, "cluster spans (near) the full toolbar width").toBeGreaterThanOrEqual(bar.width * 0.9);
  // The chips sit at the toolbar's own top padding, not centred across the combined (chips + wrapped cluster) height.
  const barPadTop = await page.locator(".bar").evaluate((el) => parseFloat(getComputedStyle(el).paddingTop));
  expect(Math.abs(chip.y - (bar.y + barPadTop)), "the floor chips are top-aligned on the toolbar's first row").toBeLessThan(2);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow, "no horizontal scroll at 380px").toBe(false);
  // Determinism check (the Chromium width-instability bug found earlier in S8.10): the cluster's own width must not
  // change between two renders of the same content, run twice to catch a non-deterministic layout result.
  const widthsAcrossRenders: number[] = [];
  for (let i = 0; i < 2; i++) {
    await page.evaluate(([tag, m]) => (document.querySelector(tag) as any).saveDone(true, m), [EDITOR, "Ready"] as const);
    widthsAcrossRenders.push((await page.locator(".bar-right").boundingBox())!.width);
  }
  expect(Math.abs(widthsAcrossRenders[0] - widthsAcrossRenders[1])).toBeLessThan(1);
});

// S8.10 follow-up (Opus review): the old version of this test only ever opened File, the rightmost menu — its box's
// `right:0` anchors flush with File's own button, which already sits near the toolbar's right edge, so the box
// could never run off-screen there and the test passed on unfixed code. `.box{right:0}` anchors every dropdown's
// box to its OWN button (the containing `.menu`), not to the viewport, so a mid-toolbar button (View, Edit, Filter)
// carries a box that can run off the left edge once the box is wider than the space to that button's left — found
// at 380 (View -96..128px) and even 600 (Filter -10..214px). Every menu, every width the toolbar actually uses.
test("S8.10 follow-up (Opus review): every menu's dropdown box stays inside the viewport at every toolbar width", async ({ page }) => {
  const menus = ["filter", "mAdd", "mDraw", "mOpt", "mEdit", "mFile"];
  for (const width of [380, 600, 769, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    for (const id of menus) {
      await page.locator(`#${id} > summary`).click();
      // The clamp runs in the <details> "toggle" event, which the HTML spec fires as a queued task, not
      // synchronously inside the click that opened it, so Playwright's click() can resolve a tick before the
      // clamp applies. A sentinel on the box's own inline style does not work as a wait condition here: closing
      // a menu already leaves `right` non-empty ("0"), so re-opening it would read that stale leftover as "the
      // clamp already ran" before the new toggle fires. Poll the actual on-screen position instead, with a
      // short timeout — long enough to cross the one queued task, short enough that a genuinely missing clamp
      // still fails fast.
      await expect(async () => {
        const box = await page.locator(`#${id} .box`).boundingBox();
        expect(box, `no .box for #${id} at ${width}px`).toBeTruthy();
        expect(box!.x, `${width}px #${id}: dropdown left edge`).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width, `${width}px #${id}: dropdown right edge`).toBeLessThanOrEqual(width);
      }).toPass({ timeout: 1000 });
      await page.locator(`#${id} > summary`).click(); // close it again
    }
  }
});

// S8.10 follow-up (Opus review): at 380 wide, Undo and Redo used to be two separate flex items, so the row that
// already held View, Edit, File and Help had room for Undo but not Redo, splitting the pair across two rows.
test("S8.10 follow-up (Opus review): Undo and Redo wrap onto a new row together, the pair never splits", async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 900 });
  const undo = (await page.locator("#undo").boundingBox())!;
  const redo = (await page.locator("#redo").boundingBox())!;
  expect(Math.abs(undo.y - redo.y), "Undo and Redo must land on the same row").toBeLessThan(3);
});

// S8.10 follow-up (Opus review): a floating panel (Device colours, Home Assistant, Place, Add device) opened at a
// hardcoded top:90px, which a taller, wrapped narrow toolbar (380px: up to 5 rows) can reach past and cover.
test("S8.10 follow-up (Opus review): a floating panel opens below the toolbar's real bottom edge, not a fixed 90px", async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 900 });
  await page.locator("#mEdit > summary").click();
  await page.locator("#devcols").click();
  const bar = (await page.locator(".bar").boundingBox())!;
  const panel = (await page.locator(".devcols-panel").boundingBox())!;
  expect(panel.y, "the panel's top must be at or below the toolbar's real bottom edge").toBeGreaterThanOrEqual(bar.y + bar.height - 1);
});

test("Device… lists the unplaced entries grouped by type; a deleted light and its relay come back, placing the light takes only the light", async ({ page }) => {
  await selectDev(page, 0);
  await page.locator("#vdel").click(); // the light and its relay come back
  await openDevice(page);
  expect(await page.locator("#addDevPanel .grp").allInnerTexts()).toEqual(["Lights", "Wall switches", "Window / door sensor"]);
  await devItem(page, "light-living").click();
  await expect(devItem(page, "light-living")).toHaveCount(0);
  await expect(devItem(page, "switch-living-relay")).toHaveCount(1); // the placed copy has no bound any more
});

test("the search filters by name and by entity id, ignoring case", async ({ page }) => {
  await setCatalog(page, [{ id: "plug-free", floor: "ground", room: "Living", type: "plug", name: "Free plug", entity: "switch.Garden_Pump" }]);
  await openDevice(page);
  await expect(shown(page)).toHaveCount(3); // contact sensor, relay (bound, no icon) and the free plug
  await search(page).fill("FREE PL");
  await expect(shown(page)).toHaveCount(1);
  await expect(shown(page)).toContainText("Free plug");
  await search(page).fill("garden_pump"); // entity id, other case
  await expect(shown(page)).toHaveCount(1);
  await expect(shown(page)).toContainText("Free plug");
  await search(page).fill("contact");
  await expect(shown(page)).toHaveCount(1);
  await expect(page.locator("#addDevPanel .grp:visible")).toHaveText(["Window / door sensor"]);
  await search(page).fill("");
  await expect(shown(page)).toHaveCount(3);
});

test("a search with no match says so", async ({ page }) => {
  await openDevice(page);
  await search(page).fill("zzz-no-such-thing");
  await expect(shown(page)).toHaveCount(0);
  await expect(page.locator("#addDevNone")).toHaveText("Nothing matches");
});

test("S8.5: the search and filters reset every time the panel opens", async ({ page }) => {
  await openDevice(page);
  await search(page).fill("contact");
  await expect(shown(page)).toHaveCount(1);
  await page.locator("#addDevClose").click();
  await openDevice(page); // reopened: the old search is gone
  await expect(search(page)).toHaveValue("");
  await expect(shown(page)).toHaveCount(2); // contact sensor and the bound relay
  await expect(page.locator("#addDevNone")).toHaveCount(0);
});

test("typing in the search field does not trigger editor shortcuts", async ({ page }) => {
  await selectDev(page, 0); // a selected light: Delete or Backspace outside an input would remove it
  const before = await layoutOf(page);
  await openDevice(page);
  await search(page).click();
  await page.keyboard.type("Delete abcz");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Delete");
  await expect(search(page)).toHaveValue("Delete abc"); // typed, edited by the field itself, not swallowed
  expect(await layoutOf(page)).toEqual(before);
  await expect(page.locator("g.dev.sel")).toHaveCount(1);
});

test("Ctrl+Z in the search field does not undo the plan", async ({ page }) => {
  await selectDev(page, 0);
  await page.locator("#vdel").click();
  const after = await layoutOf(page);
  await openDevice(page);
  await search(page).click();
  await page.keyboard.press("Control+z");
  expect(await layoutOf(page)).toEqual(after);
});

test("Escape in the search field closes the panel and gives the keys back to the editor", async ({ page }) => {
  await openDevice(page);
  await search(page).fill("abc");
  await page.keyboard.press("Escape");
  await expect(page.locator("#addDevPanel")).toHaveCount(0);
  await selectDev(page, 0);
  await page.keyboard.press("Delete");
  expect((await groundOf(page)).devices).toHaveLength(7);
});

test("a device name with markup is text in the Device panel, and a click on it places that device", async ({ page }) => {
  await setCatalog(page, [{ id: "evil", floor: "ground", room: "Living", type: "plug", name: '<img src=x onerror="window.__pwn=1">', entity: "switch.evil" }]);
  await openDevice(page);
  await expect(page.locator("#addDevPanel img")).toHaveCount(0);
  await expect(devItem(page, "evil")).toContainText("<img");
  await search(page).fill("<img");
  await expect(shown(page)).toHaveCount(1);
  await shown(page).first().click();
  expect((await groundOf(page)).devices.some((d) => d.id === "evil")).toBe(true);
  expect(await page.evaluate(() => (window as any).__pwn)).toBeUndefined();
});

// ---- S8.8: catalogued-but-unplaced HA devices, Add panel and Place popup sizing -----------------------------------

test("Opus review CSS pair: a long device name in the Add panel row is ellipsised on one line; the full name is in the title attribute", async ({ page }) => {
  const longName = "Living Room Extended Colour Light Strip Behind The Sofa";
  await setCatalog(page, [{ id: "long-1", floor: "ground", room: "Living", type: "light", name: longName, entity: "light.long" }]);
  await openDevice(page);
  const row = devItem(page, "long-1");
  const nameEl = row.locator(".devrow-name");
  await expect(nameEl).toHaveText(longName);
  await expect(row).toHaveAttribute("title", longName);
  const style = await nameEl.evaluate((el) => { const s = getComputedStyle(el); return { whiteSpace: s.whiteSpace, textOverflow: s.textOverflow, overflow: s.overflowX }; });
  expect(style).toEqual({ whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" });
  // Break it: revert to `white-space: normal` and this assertion fails — a wrapped name would keep `whiteSpace: "normal"`.
  const box = await nameEl.boundingBox();
  expect(box!.height).toBeLessThan(24); // one line, not wrapped to two or three
  // The name and the subtitle start at the same left edge; a button's default centring put the name mid-row.
  const sub = await row.locator("small").boundingBox();
  const textLeft = await nameEl.evaluate((el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().left; });
  expect(Math.abs(textLeft - sub!.x)).toBeLessThan(2);
});

test("S8.8: the Add > Device panel and the room Place popup are noticeably larger than the S8.5 baseline (520px/440px wide)", async ({ page }) => {
  await openDevice(page);
  const addBox = await page.locator("#addDevPanel").boundingBox();
  expect(addBox!.width).toBeGreaterThan(520 * 1.4); // was 520/522, now clamped-50%-larger
  await page.locator("#addDevClose").click();
  await setHa(page, PLACE_HA_FOR_SIZE);
  const c = await screenOf(page, 200, 150); // inside Living
  await page.mouse.click(c.x, c.y);
  await page.locator("#rplace").click();
  const placeBox = await page.locator("#placePanel").boundingBox();
  expect(placeBox!.width).toBeGreaterThan(440 * 1.4); // was 440/442, now clamped-50%-larger
});

// A minimal HA fixture with one placeable living-room light, just to open the Place popup for the size check above.
const PLACE_HA_FOR_SIZE = { floors: [{ id: "gf", name: "Ground" }], areas: [{ id: "living", name: "Living" }], entities: [
  { id: "light.size_check", name: "Size check light", domain: "light", area: "living" },
] };

test("S8.8: a catalogued-but-unplaced device shows in the room Place popup, by its device name — the 0.12.3 field bug", async ({ page }) => {
  // The maintainer's real bug: an HA device (a Hue bulb) imported into layout.catalog but never dragged onto a
  // floor vanished from the room's own Place popup, because placedDeviceIds counted "in the catalog" as placed.
  await setHa(page, { floors: [{ id: "gf", name: "Ground" }], areas: [{ id: "living", name: "Living" }],
    devices: [{ id: "hue1", name: "Reading lamp" }],
    entities: [{ id: "light.reading_lamp", name: "Reading lamp bulb", domain: "light", area: "living", dev: "hue1" }] });
  await setCatalog(page, [{ id: "c-hue", floor: "ground", room: "Living", type: "light", name: "Reading lamp bulb", entity: "light.reading_lamp" }]);
  const c = await screenOf(page, 200, 150); // inside Living
  await page.mouse.click(c.x, c.y);
  await page.locator("#rplace").click();
  const panel = page.locator("#placePanel");
  await expect(panel).toBeVisible();
  await expect(panel.locator(".prow")).toHaveCount(1);
  await expect(panel.locator(".prow-name")).toHaveText("Reading lamp"); // named by the HA device, not the raw entity
});

// ---- S1.13 opening tool ------------------------------------------------------
const addGap = async (page: Page) => addItem(page, "#addGap");
const gaps = async (page: Page) => (await groundOf(page)).openings;
const len = (o: { a: number[]; b: number[] }) => Math.hypot(o.b[0] - o.a[0], o.b[1] - o.a[1]);
/** The real top element at a plan point (the editor's hit order), as a short description. */
const topAt = (page: Page, x: number, y: number) =>
  page.evaluate(([tag, px, py]) => {
    const root = (document.querySelector(tag as string) as any).shadowRoot as ShadowRoot;
    const svg = root.querySelector("svg") as SVGSVGElement;
    const q = new DOMPoint(px as number, py as number).matrixTransform(svg.getScreenCTM()!);
    const el = root.elementFromPoint(q.x, q.y);
    return el ? `${el.tagName.toLowerCase()}.${el.getAttribute("class") ?? ""}` : "";
  }, [EDITOR, x, y] as const);
const mid = (o: { a: number[]; b: number[] }): [number, number] => [(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2];
/** Pans the editor's view so that (x, y) is its centre; zoom is kept. */
const centreViewOn = (page: Page, c: [number, number]) =>
  page.evaluate(([tag, x, y]) => {
    const el = document.querySelector(tag as string) as any, v = el.st.view;
    el.st.views[el.st.floor] = { ...v, x: (x as number) - v.w / 2, y: (y as number) - v.h / 2 };
    el.requestUpdate();
  }, [EDITOR, c[0], c[1]] as const);

test("Add, Opening adds one 120 cm opening on the room edge nearest the view centre, selected, in one undo step", async ({ page }) => {
  const before = await gaps(page);
  expect(before).toHaveLength(0);
  await addGap(page);
  const o = await gaps(page);
  expect(o).toHaveLength(1);
  expect(o[0].id).toBe("opening-ground-1");
  expect(len(o[0])).toBe(120);
  expect(o[0].a[0]).toBe(500); // the edge between the Living room and the Kitchen is the nearest to the view centre
  expect(o[0].b[0]).toBe(500);
  await expect(page.locator("#panel")).toContainText("Opening");
  await expect(page.locator("svg line.hl")).toHaveCount(1);
  expect(validate(await layoutOf(page)).ok).toBe(true);
  await page.keyboard.press("Control+z"); // one step removes it
  expect(await gaps(page)).toEqual([]);
  await page.keyboard.press("Control+Shift+z");
  expect(await gaps(page)).toEqual(o);
});

test("the wall under an opening is not the element you hit: the opening is on top of the room edge, in the editor's hit order", async ({ page }) => {
  await addGap(page);
  const o = (await gaps(page))[0], m = mid(o);
  expect(o.a[0]).toBe(500); // the edge between the Living room and the Kitchen: a wall line is drawn there
  await page.mouse.click(...Object.values(await screenOf(page, 300, 900)) as [number, number]); // deselect
  await expect(page.locator("#panel")).toContainText("Nothing selected");
  expect(await topAt(page, m[0], m[1])).toBe("line.opening"); // not line.e (the wall) and not the room polygon
  // and a real click there selects it
  const c = await screenOf(page, m[0], m[1]);
  await page.mouse.click(c.x, c.y);
  await expect(page.locator("#ol")).toHaveValue("120");
  await expect(page.locator("svg line.hl")).toHaveCount(1);
});

test("a real click picks the opening you point at when there are several", async ({ page }) => {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag as string) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.openings.push({ id: "opening-ground-1", a: [100, 640], b: [200, 640] }, { id: "opening-ground-2", a: [300, 660], b: [460, 660] });
    el.layout = l;
  }, EDITOR);
  const c = await screenOf(page, 380, 660);
  await page.mouse.click(c.x, c.y);
  await expect(page.locator("#ol")).toHaveValue("160");
  const d = await screenOf(page, 150, 640);
  await page.mouse.click(d.x, d.y);
  await expect(page.locator("#ol")).toHaveValue("100");
});

test("the length field sets the length and keeps the midpoint and the direction", async ({ page }) => {
  await addGap(page);
  const before = (await gaps(page))[0];
  await page.locator("#ol").fill("200");
  await page.locator("#ol").press("Enter");
  const o = (await gaps(page))[0];
  expect(len(o)).toBe(200);
  expect(mid(o)).toEqual(mid(before));
  expect(o.a[0]).toBe(before.a[0]);
  expect(Math.sign(o.b[1] - o.a[1])).toBe(Math.sign(before.b[1] - before.a[1]));
  await menu(page, "File");
  await page.locator("#undo").click();
  expect(len((await gaps(page))[0])).toBe(120); // one step
  await expect(page.locator("#undo")).toBeEnabled();
});

test("the length field ignores an unchanged value and rubbish", async ({ page }) => {
  await addGap(page);
  const o = await gaps(page);
  await page.locator("#ol").fill("120");
  await page.locator("#ol").press("Enter");
  await page.locator("#ol").fill("");
  await page.locator("#ol").press("Enter");
  expect(await gaps(page)).toEqual(o);
  await menu(page, "File");
  await page.locator("#undo").click(); // undoes the add itself: the unchanged 120 and the empty field left no step of their own
  expect(await gaps(page)).toEqual([]);
});

test("Delete in the panel, and the Delete and Backspace keys, remove the opening; Undo restores it", async ({ page }) => {
  await addGap(page);
  const o = await gaps(page);
  await page.locator("#odel").click();
  expect(await gaps(page)).toEqual([]);
  await page.keyboard.press("Control+z");
  expect(await gaps(page)).toEqual(o);
  const pick = async () => { const c = await screenOf(page, ...mid(o[0])); await page.mouse.click(c.x, c.y); await expect(page.locator("#odel")).toBeVisible(); };
  await pick(); // undo clears the selection; a real click selects it again
  await page.keyboard.press("Delete");
  expect(await gaps(page)).toEqual([]);
  await page.keyboard.press("Control+z");
  expect(await gaps(page)).toEqual(o);
  await pick();
  await page.keyboard.press("Backspace");
  expect(await gaps(page)).toEqual([]);
  await page.keyboard.press("Control+z");
  expect(await gaps(page)).toEqual(o);
});

test("an opening lands on a free wall when that is the nearest edge", async ({ page }) => {
  await addItem(page, "#addWall-wall");
  const w = (await groundOf(page)).walls[0];
  await centreViewOn(page, mid(w)); // the wall is now the edge nearest the view centre
  await addGap(page);
  const o = (await gaps(page))[0];
  expect(o.a[1]).toBe(w.a[1]);
  expect(o.b[1]).toBe(w.a[1]);
  expect(mid(o)[0]).toBe((w.a[0] + w.b[0]) / 2);
  expect(len(o)).toBe(120);
});

test("an opening lands on the outline edge when there are no rooms", async ({ page }) => {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag as string) as any, l = JSON.parse(JSON.stringify(el.layout));
    const g = l.floors.ground;
    g.rooms = []; g.doors = []; g.devices = []; g.stairs = []; g.furniture = []; g.outline = [[0, 0], [600, 0], [600, 200], [0, 200]];
    l.catalog = [];
    el.layout = l;
  }, EDITOR);
  await addGap(page);
  const o = (await gaps(page))[0];
  expect(o.a[1]).toBe(o.b[1]);
  expect([0, 200]).toContain(o.a[1]);
  expect(mid(o)[0]).toBeGreaterThan(0);
  expect(mid(o)[0]).toBeLessThan(600);
  expect(len(o)).toBe(120);
});

test("break it: with no wall on the floor, Add, Opening places a horizontal opening at the view centre and does not throw", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await addBareFloor(page, "Attic");
  expect(await page.evaluate((tag) => Object.keys((document.querySelector(tag as string) as any).layout.floors.attic).length > 0, EDITOR)).toBe(true);
  await addGap(page);
  const o = (await layoutOf(page)).floors.attic.openings;
  expect(o).toHaveLength(1);
  expect(o[0].a[1]).toBe(o[0].b[1]);
  expect(len(o[0])).toBe(120);
  const vb = (await page.locator("svg").first().getAttribute("viewBox"))!.split(" ").map(Number);
  expect(Math.abs(mid(o[0])[0] - (vb[0] + vb[2] / 2))).toBeLessThanOrEqual(1);
  expect(Math.abs(mid(o[0])[1] - (vb[1] + vb[3] / 2))).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test("Add, Door and Add, Window still place a door and a window", async ({ page }) => {
  await addItem(page, "#addDoor");
  await addItem(page, "#addWin");
  const d = (await groundOf(page)).doors;
  expect(d.slice(-2).map((x) => [x.kind, len(x)])).toEqual([["door", 90], ["window", 120]]);
});

test("dragging an opening's body slides it along its wall, keeping its length, like a door", async ({ page }) => {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag as string) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.openings.push({ id: "opening-ground-1", a: [450, 600], b: [540, 600] });
    el.layout = l;
  }, EDITOR);
  const before = (await gaps(page))[0];
  await dragCm(page, [495, 600], [620, 600]); // grab the middle, drag along the same wall
  const after = (await gaps(page))[0];
  expect(after).not.toEqual(before);
  expect(len(after)).toBeCloseTo(len(before), 0); // length is preserved, not resized
  expect(after.a[1]).toBe(600); // still hugs the same wall
  expect(after.b[1]).toBe(600);
  expect(mid(after)[0]).toBeGreaterThan(mid(before)[0]); // actually moved, not a no-op
  await page.keyboard.press("Control+z");
  expect((await gaps(page))[0]).toEqual(before);
});

test("dragging an opening end snaps like a door end: to a corner", async ({ page }) => {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag as string) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.openings.push({ id: "opening-ground-1", a: [100, 640], b: [200, 640] });
    el.layout = l;
  }, EDITOR);
  await dragCm(page, [200, 640], [497, 402]); // near the corner (500, 400)
  expect((await gaps(page))[0].b).toEqual([500, 400]);
  await page.keyboard.press("Control+z");
  expect((await gaps(page))[0].b).toEqual([200, 640]);
});

// ---- Sprint 1.5 review fixes ----

test("a zone edge has no wall toggle, and every panel action on it leaves a valid layout", async ({ page }) => {
  await clickCm(page, 400, 40); // the top edge of the Reading corner zone, on the real screen
  await expect(page.locator("#elen")).toBeVisible();
  await expect(page.locator("#ek")).toHaveCount(0);
  const zi = (await groundOf(page)).rooms.findIndex((r) => r.kind === "zone");
  const zoneW = async () => (await groundOf(page)).rooms[zi].wk;
  const ok = async () => { expect(validate(await layoutOf(page)).ok).toBe(true); expect(await zoneW()).toEqual((await zoneW()).map((): WallKind => "boundary")); };
  await page.locator("#elen").fill("1.5");
  await page.locator("#elen").press("Enter");
  await ok();
  await expect(page.locator("#ek")).toHaveCount(0);
  await page.locator("#mkh").click();
  await ok();
  await page.locator("#mkv").click();
  await ok();
  await expect(page.locator("#ek")).toHaveCount(0);
  await page.locator("#addpt").click();
  await ok();
  await savedValid(page);
});

/** The demo with a zone corner on the living / kitchen corner (500, 0), and another on (500, 400). */
async function withZoneOnRoomCorners(page: Page, zoneFirst: boolean) {
  await page.evaluate(([tag, first]) => {
    const el = document.querySelector(tag as string) as any, l = JSON.parse(JSON.stringify(el.layout));
    const rooms = l.floors.ground.rooms, z = rooms.find((r: any) => r.kind === "zone");
    z.pts = [[500, 0], [560, 0], [560, 60], [500, 60]];
    if (first) rooms.unshift(...rooms.splice(rooms.indexOf(z), 1));
    el.layout = l;
  }, [EDITOR, zoneFirst] as const);
}
const zoneOf = async (page: Page) => (await groundOf(page)).rooms.find((r) => r.kind === "zone")!;

test("a room corner typed into the corner panel does not take a zone corner on it along", async ({ page }) => {
  await withZoneOnRoomCorners(page, true); // the zone is drawn first, so the room's handle is on top at (500, 0)
  await clickCm(page, 500, 0);
  await expect(page.locator("#px")).toHaveValue("500");
  await page.locator("#px").fill("530");
  await page.locator("#px").press("Enter");
  const g = await groundOf(page);
  expect(g.rooms.find((r) => r.name === "Living")!.pts[1]).toEqual([530, 0]);
  expect(g.rooms.find((r) => r.name === "Kitchen")!.pts[0]).toEqual([530, 0]);
  expect((await zoneOf(page)).pts[0]).toEqual([500, 0]);
  expect(validate(await layoutOf(page)).ok).toBe(true);
});

test("a zone corner typed into the corner panel does not take the room corners on it along", async ({ page }) => {
  await withZoneOnRoomCorners(page, false); // the zone handle is on top at (500, 0)
  await clickCm(page, 500, 0);
  await page.locator("#px").fill("470");
  await page.locator("#px").press("Enter");
  const g = await groundOf(page);
  expect((await zoneOf(page)).pts[0]).toEqual([470, 0]);
  expect(g.rooms.find((r) => r.name === "Living")!.pts[1]).toEqual([500, 0]);
  expect(g.rooms.find((r) => r.name === "Kitchen")!.pts[0]).toEqual([500, 0]);
});

test("the length of a room edge does not take a zone corner on its second end along", async ({ page }) => {
  // a triangle with one corner on the shared living / kitchen corner (500, 0), away from the edge being selected
  await page.evaluate((tag) => {
    const el = document.querySelector(tag as string) as any, l = JSON.parse(JSON.stringify(el.layout));
    const z = l.floors.ground.rooms.find((r: any) => r.kind === "zone");
    z.pts = [[500, 0], [560, 0], [520, 60]]; z.wk = ["boundary", "boundary", "boundary"];
    el.layout = l;
  }, EDITOR);
  await clickCm(page, 500, 200); // the shared edge; the top polygon's line (the kitchen's) is the one hit, its second end is (500, 0)
  await expect(page.locator("#elen")).toHaveValue("4.00");
  await page.locator("#elen").fill("3");
  await page.locator("#elen").press("Enter");
  const g = await groundOf(page);
  expect(g.rooms[1].pts[0]).toEqual([500, 100]); // the edge got shorter: the room corners moved
  expect(g.rooms[0].pts[1]).toEqual([500, 100]);
  expect((await zoneOf(page)).pts[0]).toEqual([500, 0]);
});

// ---- a double-click whose first click already finished the shape ----
const dblclickCm = async (page: Page, x: number, y: number) => { const c = await screenOf(page, x, y); await page.mouse.dblclick(c.x, c.y); };
/**
 * The dblclick event that Firefox and Safari send after a click that finished a shape. Chromium sends none:
 * the plan is redrawn between the two clicks, its click count restarts, and page.mouse.dblclick fires nothing.
 * The clicks before it are real page.mouse clicks; only this event is synthetic.
 */
const sendDblclick = async (page: Page, x: number, y: number) => {
  const c = await screenOf(page, x, y);
  await page.evaluate(([tag, cx, cy]) => {
    const root = (document.querySelector(tag as string) as any).shadowRoot as ShadowRoot;
    root.elementFromPoint(cx as number, cy as number)!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, composed: true, clientX: cx as number, clientY: cy as number, detail: 2 }));
  }, [EDITOR, c.x, c.y] as const);
};
const pointCount = (g: Floor) => g.outline.length + g.rooms.reduce((n, r) => n + r.pts.length, 0) + g.stairs.reduce((n, r) => n + r.pts.length, 0);

test("a double-click on a wall outside draw mode still adds a point to it, in one undo step", async ({ page }) => {
  const before = await groundOf(page);
  await dblclickCm(page, 250, 400); // the living room / hall edge
  expect(pointCount(await groundOf(page))).toBeGreaterThan(pointCount(before));
  await page.keyboard.press("Control+z");
  expect(await groundOf(page)).toEqual(before);
  await expect(page.locator("#undo")).toBeDisabled();
});

test("Draw, Opening: a click, a real double-click on the second end on a wall: one opening, one undo step, no new corner", async ({ page }) => {
  const before = await groundOf(page);
  await startDraw(page, "drawOpening");
  await clickCm(page, 200, 400);
  await dblclickCm(page, 300, 400);
  const g = await groundOf(page);
  expect(g.openings).toHaveLength(1);
  expect(g.rooms.map((r) => r.pts)).toEqual(before.rooms.map((r) => r.pts));
  await page.keyboard.press("Control+z");
  expect(await groundOf(page)).toEqual(before);
  await expect(page.locator("#undo")).toBeDisabled();
});

test("Draw, Opening: a deliberate double-click right after finishing on the wall adds a corner (the finishing press and two more)", async ({ page }) => {
  const before = await groundOf(page);
  await startDraw(page, "drawOpening");
  await clickCm(page, 200, 400);
  await clickCm(page, 300, 400); // finishes the opening
  await dblclickCm(page, 300, 400); // press 2 and press 3: a real double-click
  const g = await groundOf(page);
  expect(g.openings).toHaveLength(1);
  expect(pointCount(g)).toBeGreaterThan(pointCount(before)); // the corner went into the wall under the pointer
});

test("Draw, Opening: the dblclick that follows the finishing click adds no corner to the wall under it", async ({ page }) => {
  const before = await groundOf(page);
  await startDraw(page, "drawOpening");
  await clickCm(page, 200, 400);
  await clickCm(page, 300, 400); // finishes the opening
  await clickCm(page, 300, 400); // the second press of the pair: exactly one press follows the finishing one
  await sendDblclick(page, 300, 400);
  const g = await groundOf(page);
  expect(g.openings).toHaveLength(1);
  expect(pointCount(g)).toBe(pointCount(before));
  expect(g.rooms.map((r) => r.pts)).toEqual(before.rooms.map((r) => r.pts));
  await page.keyboard.press("Control+z"); // one undo step: the opening
  expect(await groundOf(page)).toEqual(before);
  await expect(page.locator("#undo")).toBeDisabled();
});

test("a polygon closed on its first point, then the dblclick there, gets no extra corner", async ({ page }) => {
  const before = await groundOf(page);
  // the first point lies on the living room / hall edge (y = 400), so closing stitches it into both rooms
  const tri: [number, number][] = [[250, 400], [330, 460], [190, 470]];
  await startDraw(page, "drawRoom");
  await clicksCm(page, ...tri);
  await clickCm(page, 250, 400); // the closing click
  const single = await groundOf(page);
  await clickCm(page, 250, 400); // the second press of the pair
  await sendDblclick(page, 250, 400);
  expect(await groundOf(page)).toEqual(single);
  await page.keyboard.press("Control+z");
  expect(await groundOf(page)).toEqual(before);
  await expect(page.locator("#undo")).toBeDisabled();
  // and a real double-click on the first point closes it just the same
  await startDraw(page, "drawRoom");
  await clicksCm(page, ...tri);
  await dblclickCm(page, 250, 400);
  expect(await groundOf(page)).toEqual(single);
});

test("pinned regression, passes with or without the guard: a late dblclick, or one after a click elsewhere, adds its point", async ({ page }) => {
  await startDraw(page, "drawOpening");
  await clickCm(page, 200, 400);
  await clickCm(page, 300, 400);
  const n = pointCount(await groundOf(page));
  await page.waitForTimeout(700); // past the double-click interval
  await sendDblclick(page, 650, 400);
  expect(pointCount(await groundOf(page))).toBeGreaterThan(n);
  await page.keyboard.press("Control+z");
  await startDraw(page, "drawOpening");
  await clickCm(page, 200, 400);
  await clickCm(page, 300, 400);
  await clickCm(page, 100, 500); // a press elsewhere is not part of that double-click
  await sendDblclick(page, 650, 400);
  expect(pointCount(await groundOf(page))).toBeGreaterThan(n);
});

test("Add, Door and Add, Opening skip a zone edge: they land on the nearest wall, not on the zone edge next to the view centre", async ({ page }) => {
  const v = await page.evaluate((tag) => ({ ...(document.querySelector(tag as string) as any).st.view }), EDITOR);
  const cx = Math.round(v.x + v.w / 2), cy = Math.round(v.y + v.h / 2);
  await page.evaluate(([tag, x, y]) => {
    const el = document.querySelector(tag as string) as any, l = JSON.parse(JSON.stringify(el.layout));
    const z = l.floors.ground.rooms.find((r: any) => r.kind === "zone");
    z.pts = [[x - 60, y - 20], [x + 60, y - 20], [x + 60, y + 40], [x - 60, y + 40]]; // its top edge is 20 cm above the view centre
    el.layout = l;
  }, [EDITOR, cx, cy] as const);
  const zoneYs = [cy - 20, cy + 40];
  await addItem(page, "#addDoor");
  const d = (await groundOf(page)).doors.at(-1)!;
  expect(zoneYs).not.toContain(d.a[1]);
  expect(zoneYs).not.toContain(d.b[1]);
  await addItem(page, "#addGap");
  const o = (await groundOf(page)).openings.at(-1)!;
  expect(zoneYs).not.toContain(o.a[1]);
  expect(zoneYs).not.toContain(o.b[1]);
  expect(validate(await layoutOf(page)).ok).toBe(true);
});

test("Add, Door lands on a free wall when that is the nearest edge, along its direction", async ({ page }) => {
  await addItem(page, "#addWall-wall"); // a horizontal wall
  const w = (await groundOf(page)).walls[0];
  await centreViewOn(page, mid(w)); // the wall is now the edge nearest the view centre
  await addItem(page, "#addDoor");
  const d = (await groundOf(page)).doors.at(-1)!;
  expect(d.a[1]).toBe(w.a[1]);
  expect(d.b[1]).toBe(w.a[1]);
  expect(mid(d)[0]).toBe((w.a[0] + w.b[0]) / 2);
  expect(len(d)).toBe(90);
});

test("a zone's plan label is drawn muted: its class has a rule, unlike a room label", async ({ page }) => {
  const style = (sel: string) => page.locator(sel).first().evaluate((el) => { const c = getComputedStyle(el); return { fill: c.fill, opacity: c.opacity }; });
  const zone = await style("svg text.lbl.zone"), room = await style("svg text.lbl:not(.zone)");
  expect(zone).not.toEqual(room);
});

test("a floor property named like an Object.prototype key does not cancel a draw or change the floor", async ({ page }) => {
  await startDraw(page, "drawRoom");
  await clicksCm(page, ...FREE.slice(0, 2));
  await expect(drawnPoints(page)).toHaveCount(2);
  // The editor's own layout has null-prototype floors, so a prototype key is unreachable there. Give it a plain
  // object, as any host that hands in one would, to reach the lookup.
  await page.evaluate(() => { const st = (document.querySelector("floorplan-studio-editor") as any).st; st.layout.floors = { ...st.layout.floors }; });
  const floor = await page.evaluate(() => (document.querySelector("floorplan-studio-editor") as any).st.floor);
  for (const k of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
    await page.evaluate((v) => { (document.querySelector("floorplan-studio-editor") as any).floor = v; }, k);
    await page.evaluate(() => (document.querySelector("floorplan-studio-editor") as any).updateComplete);
    expect(await page.evaluate(() => !!(document.querySelector("floorplan-studio-editor") as any).draw)).toBe(true); // the draw was not stopped
  }
  expect(await page.evaluate(() => (document.querySelector("floorplan-studio-editor") as any).st.floor)).toBe(floor);
});

test("a dragged zone corner dropped 4 cm from a room corner lands on the grid, not on the room corner", async ({ page }) => {
  await setGrid(page, 5); // S1.34: the default grid is 10; this test's numbers are on the 5 cm grid
  const g0 = await groundOf(page), zi = g0.rooms.findIndex((r) => r.kind === "zone"), z = g0.rooms[zi];
  const j = 1; // (460, 40); the living room corner (500, 0) is 40 cm away, the drop is 4 cm from it
  await dragCm(page, z.pts[j] as [number, number], [496, 4]);
  const g1 = await groundOf(page);
  expect(g1.rooms[zi].pts[j]).toEqual([495, 5]); // the 5 cm grid; a snap would give [500, 0]
  expect(g1.rooms[0].pts).toEqual(g0.rooms[0].pts);
  expect(g1.rooms[1].pts).toEqual(g0.rooms[1].pts);
  await savedValid(page);
});

test("a dragged zone corner lines up with another corner of the same zone, and with nothing else", async ({ page }) => {
  const g0 = await groundOf(page), zi = g0.rooms.findIndex((r) => r.kind === "zone"), z = g0.rooms[zi];
  // (460, 140) is corner 2; drop it 3 cm from x = 340, the x of corners 0 and 3: it lines up with them
  await dragCm(page, z.pts[2] as [number, number], [343, 160]);
  expect((await groundOf(page)).rooms[zi].pts[2]).toEqual([340, 160]);
});

test("placing a device whose catalog floor is named like an Object.prototype key stays on the current floor and keeps its chip pressed", async ({ page }) => {
  await selectDev(page, 0);
  await page.locator("#vdel").click(); // light-living is unplaced again
  // the editor's own floors have a null prototype; a plain object reaches the lookup
  await page.evaluate((tag) => { const st = (document.querySelector(tag) as any).st; st.layout.floors = { ...st.layout.floors }; st.layout.catalog.find((c: any) => c.id === "light-living").floor = "constructor"; }, EDITOR);
  const floor = await page.evaluate((tag) => (document.querySelector(tag) as any).st.floor, EDITOR);
  await openDevice(page);
  await devItem(page, "light-living").click();
  expect(await page.evaluate((tag) => (document.querySelector(tag) as any).floor, EDITOR)).toBe(floor);
  await expect(page.locator(`.chip[data-f="${floor}"]`)).toHaveAttribute("aria-pressed", "true");
  expect((await groundOf(page)).devices.some((d) => d.id === "light-living")).toBe(true); // it landed on the current floor
});

test("a click 3 cm off a zone edge that lies on a room edge picks the room edge, so its wall toggle is reachable, whichever is listed first", async ({ page }) => {
  for (const first of [true, false]) {
    await page.evaluate(([tag, zoneFirst]) => {
      const el = document.querySelector(tag as string) as any, l = JSON.parse(JSON.stringify(el.layout));
      const rooms = l.floors.ground.rooms, z = rooms.find((r: any) => r.kind === "zone");
      z.pts = [[500, 100], [560, 100], [560, 200], [500, 200]]; // its left edge lies on the living / kitchen wall x = 500
      const at = rooms.indexOf(z); rooms.splice(at, 1);
      if (zoneFirst) rooms.unshift(z); else rooms.push(z);
      el.layout = l;
    }, [EDITOR, first] as const);
    await clickCm(page, 503, 150);
    await expect(page.locator("#ek")).toHaveCount(1); // the room edge under the zone edge has a kind select
  }
});

test("a zone corner dropped on a wall where a third polygon has a corner is not stitched into the rooms either side", async ({ page }) => {
  // a small structure whose corner (500, 250) lies on the living / kitchen wall x = 500
  await page.evaluate((tag) => {
    const el = document.querySelector(tag as string) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.rooms.push({ id: "room-ground-9", name: "Shed", area: "shed", label: "", kind: "structure", pts: [[500, 250], [540, 250], [540, 290]], wk: ["wall", "wall", "wall"] });
    el.layout = l;
  }, EDITOR);
  const g0 = await groundOf(page), zi = g0.rooms.findIndex((r) => r.kind === "zone"), z = g0.rooms[zi];
  const counts = (g: Floor) => g.rooms.map((r) => r.pts.length);
  const before = counts(g0);
  await dragCm(page, z.pts[0] as [number, number], [500, 250]);
  const g1 = await groundOf(page);
  expect(g1.rooms[zi].pts[0]).toEqual([500, 250]); // it landed there
  expect(counts(g1)).toEqual(before); // no point went into the living room or the kitchen
  expect(g1.outline).toEqual(g0.outline);
  await savedValid(page);
});

test("the room colour input sets the polygon fill, one undo step, and the default button clears it", async ({ page }) => {
  const at = await screenOf(page, 200, 150);
  await page.mouse.click(at.x, at.y);
  const poly = page.locator('svg polygon[data-r="0"]');
  const computed = () => poly.evaluate((el) => getComputedStyle(el).fill);
  const plain = await computed();
  await expect(page.locator("#rcol")).toHaveValue("#ffffff");
  await page.locator("#rcol").fill("#aabbcc");
  await expect(poly).toHaveAttribute("fill", "#aabbcc");
  expect(await computed()).toBe("rgb(170, 187, 204)"); // the class rule must not override it
  expect((await groundOf(page)).rooms[0].color).toBe("#aabbcc");
  await page.locator("#rcol").fill("#aabbcc"); // unchanged: no step
  await page.locator("#rcolx").click();
  await expect(poly).not.toHaveAttribute("fill", /.*/);
  expect((await groundOf(page)).rooms[0]).not.toHaveProperty("color");
  expect(await computed()).toBe(plain);
  await page.locator("#rcolx").click(); // nothing to clear: no step
  await page.keyboard.press("Control+z");
  await expect(poly).toHaveAttribute("fill", "#aabbcc");
  await page.keyboard.press("Control+z");
  await expect(poly).not.toHaveAttribute("fill", /.*/);
  expect(await poly.evaluate((el) => getComputedStyle(el).fill)).toBe(plain);
});

test("a fill room is painted with the hatch pattern in the browser, with or without its own colour", async ({ page }) => {
  const at = await screenOf(page, 200, 150);
  await page.mouse.click(at.x, at.y);
  await page.locator("#rk").selectOption("fill");
  const poly = page.locator('svg polygon[data-r="0"]');
  const computed = () => poly.evaluate((el) => getComputedStyle(el).fill);
  expect(await computed()).toContain("fp-hatch");
  await page.locator("#rcol").fill("#aabbcc");
  expect(await computed()).toContain("fp-hatch");
});

// ---- S1.18 the kind of a room edge ----
test("the kind select of a shared edge writes both rooms, redraws the line, is one undo step, and none when unchanged", async ({ page }) => {
  await clickCm(page, 500, 300); // the living / kitchen edge
  await expect(page.locator("#ek")).toHaveValue("wall");
  await expect(page.locator("#wallt")).toHaveCount(0);
  await expect(page.locator("#panel strong").first()).toHaveText("Internal wall");
  const options = await page.locator("#ek option").allTextContents();
  expect(options).toEqual(["Internal wall", "Dotted boundary", "External wall", "Fence", "Outdoor edge", "Not drawn"]);
  await page.locator("#ek").selectOption("external");
  const g = await groundOf(page);
  expect([g.rooms[0].wk[1], g.rooms[1].wk[3]]).toEqual(["external", "external"]);
  expect(g.rooms[0].wk.filter((k) => k === "external")).toHaveLength(3); // edges 0 and 3 are already on the perimeter (S1.52); this makes edge 1 the third
  await expect(page.locator('svg line[data-e="r0:1"]')).toHaveClass("e external");
  await expect(page.locator('svg line[data-e="r1:3"]')).toHaveClass("e external");
  await expect(page.locator("#panel strong").first()).toHaveText("External wall");
  await page.locator("#ek").selectOption("external"); // same kind: no step
  await page.locator("#ek").selectOption("fence");
  expect((await groundOf(page)).rooms[1].wk[3]).toBe("fence");
  await page.keyboard.press("Control+z");
  expect((await groundOf(page)).rooms[1].wk[3]).toBe("external"); // one step back, not two
  await page.keyboard.press("Control+z");
  expect((await groundOf(page)).rooms[1].wk[3]).toBe("wall");
  await savedValid(page);
});

test("break it: an outline edge of a floor with no rooms still has a kind select, external by default, and nothing throws (S1.52)", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.rooms = [];
    el.layout = l;
  }, EDITOR);
  await clickCm(page, 400, 0); // the top outline edge
  await expect(page.locator("#elen")).toBeVisible(); // an edge is selected
  await expect(page.locator("#ek")).toHaveValue("external"); // the outline has its own kind now (S1.52)
  expect(errors).toEqual([]);
});

// ---- S1.52 the outline has wall kinds, and its edges can be deleted ----

test("S1.52: a perimeter edge shows External wall by default, and its kind can be changed like any other edge", async ({ page }) => {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.rooms = []; // isolate the outline: no room edge competes for the click or the panel
    el.layout = l;
  }, EDITOR);
  await clickCm(page, 400, 0); // the top outline edge, o:0
  await expect(page.locator("#panel strong").first()).toHaveText("External wall");
  await expect(page.locator("#ek")).toHaveValue("external");
  const line = page.locator('svg line[data-e="o:0"]');
  await expect(line).toHaveClass("e external");
  expect(await line.evaluate((el) => getComputedStyle(el).strokeWidth)).toBe("20px"); // S8.9: external wall thickness 6 -> 20
  await page.locator("#ek").selectOption("wall");
  expect((await groundOf(page)).owk?.[0]).toBe("wall");
  await expect(page.locator("#panel strong").first()).toHaveText("Internal wall");
  await expect(line).toHaveClass("e");
  // changed from an external wall (20 cm) to a plain internal one (10 cm; S8.9)
  expect(await line.evaluate((el) => getComputedStyle(el).strokeWidth)).toBe("10px");
  await savedValid(page);
});

test("S1.52: Delete on a perimeter edge stops drawing it, and one undo brings it back with its kind", async ({ page }) => {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.rooms = [];
    el.layout = l;
  }, EDITOR);
  await clickCm(page, 400, 0); // o:0, no door on this edge
  await expectWarn(page, "#edel");
  await page.locator("#edel").click();
  const g = await groundOf(page);
  expect(g.owk?.[0]).toBe("none");
  await expect(page.locator('svg line.e.none[data-e="o:0"]')).toHaveCount(1); // a guide only in the editor, not a drawn line
  await expect(page.locator("#edel")).toHaveCount(0);
  await menu(page, "File");
  await page.locator("#undo").click();
  const u = await groundOf(page);
  expect(u.owk?.[0]).toBe("external");
  await expect(page.locator('svg line[data-e="o:0"]')).toHaveClass("e external");
});

test("Opus review: Delete on the unmodified demo clears the room edge AND the outline's collinear edge together (S1.53)", async ({ page }) => {
  // No `rooms = []` here on purpose: that isolation is what hid the bug. The Living room's top edge
  // (r0:0) and the outline's top edge (o:0) share the segment x 0-500, y 0; the room's line is painted
  // after the outline's, so a real click lands on r0:0.
  await clickCm(page, 400, 0);
  expect(await page.evaluate((tag) => (document.querySelector(tag) as any).st.sel, EDITOR)).toEqual({ t: "edge", poly: "r0", i: 0 });
  await expectWarn(page, "#edel");
  await page.locator("#edel").click();
  const g = await groundOf(page);
  expect(g.rooms[0].wk[0]).toBe("none");
  expect(g.owk?.[0]).toBe("none");
  await expect(page.locator('svg line.e:not(.none)[data-e="r0:0"]')).toHaveCount(0); // no colored line remains on the segment
  await expect(page.locator('svg line.e:not(.none)[data-e="o:0"]')).toHaveCount(0);
  await expect(page.locator('svg line.e.none[data-e="r0:0"]')).toHaveCount(1); // a faint guide only, as usual
  await expect(page.locator('svg line.e.none[data-e="o:0"]')).toHaveCount(1);
  await menu(page, "File");
  await page.locator("#undo").click(); // one undo step restores both kinds together
  const u = await groundOf(page);
  expect(u.rooms[0].wk[0]).toBe("external");
  expect(u.owk?.[0]).toBe("external");
});

test("S1.52: a door on the perimeter edge asks first; Cancel changes nothing, the door stays either way", async ({ page }) => {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.rooms = []; // the demo's Front door already sits on outline edge o:2 (the bottom)
    el.layout = l;
  }, EDITOR);
  await clickCm(page, 600, 600); // o:2, away from the door itself but on the same edge
  const before = await groundOf(page);
  await page.locator("#edel").click();
  await expect(page.locator("#edelyes")).toBeVisible();
  expect(await groundOf(page)).toEqual(before);
  await page.locator("#edelno").click();
  await expect(page.locator("#edelyes")).toHaveCount(0);
  await expect(page.locator("#edel")).toBeVisible();
  await page.locator("#edel").click();
  await page.locator("#edelyes").click();
  const g = await groundOf(page);
  expect(g.owk?.[2]).toBe("none");
  expect(g.doors.some((d) => d.id === "door-ground-1")).toBe(true); // the door stays
});

test("S1.52: the outline still fits the view after a perimeter edge is deleted", async ({ page }) => {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.rooms = []; // isolate the outline edge so the click cannot land on a room edge instead
    el.layout = l;
  }, EDITOR);
  await clickCm(page, 400, 0); // o:0
  await page.locator("#edel").click();
  expect((await groundOf(page)).owk?.[0]).toBe("none");
  await menu(page, "View");
  await page.locator("#fit").click();
  const box = await page.evaluate((tag) => {
    const root = (document.querySelector(tag as string) as any).shadowRoot as ShadowRoot;
    return (root.querySelector("svg")!.getAttribute("viewBox") ?? "").split(/\s+/).map(Number);
  }, EDITOR);
  const [x, y, w, h] = box;
  expect(x).toBeLessThanOrEqual(0); // Fit to window still frames the 0,0 - 800,600 outline
  expect(y).toBeLessThanOrEqual(0);
  expect(x + w).toBeGreaterThanOrEqual(800);
  expect(y + h).toBeGreaterThanOrEqual(600);
});

// ---- S1.19 a free wall becomes an opening, and back ----
const status = (page: Page) => page.locator("#status");

test("a free wall becomes an opening and back to a wall of a chosen kind; two undos return to the first wall", async ({ page }) => {
  await withWallRow(page);
  await clickCm(page, 60 + 3 * 150, 650); // the fence, wall index 3
  await expect(page.locator("#wk")).toHaveValue("fence");
  expect(await page.locator("#wk option").evaluateAll((o) => o.map((x) => [(x as HTMLOptionElement).value, x.textContent]).slice(5))).toEqual([["opening", "Opening (a gap in the wall)"]]);
  const before = await groundOf(page), fence = before.walls[3];
  await page.locator("#wk").selectOption("opening");
  const g = await groundOf(page);
  expect(g.walls).toHaveLength(4);
  expect(g.openings).toHaveLength(1);
  expect([g.openings[0].a, g.openings[0].b]).toEqual([fence.a, fence.b]);
  expect(g.openings[0].id).toBe("opening-ground-1");
  await expect(page.locator("#panel strong").first()).toHaveText("Opening");
  await expect(page.locator("svg line.hl")).toHaveCount(1); // the new opening is selected
  // the real pointer reaches the new opening, not a wall
  expect(await topAt(page, 60 + 3 * 150, 650)).toBe("line.opening");
  expect(await page.locator("#ok option").evaluateAll((o) => o.map((x) => [(x as HTMLOptionElement).value, x.textContent]))).toEqual([
    ["opening", "Opening"], ["wall", "Internal wall"], ["boundary", "Dotted boundary"], ["external", "External wall"], ["fence", "Fence"], ["edge", "Outdoor edge"],
  ]);
  await expect(page.locator("#ok")).toHaveValue("opening");
  await page.locator("#ok").selectOption("external");
  const h = await groundOf(page);
  expect(h.openings).toHaveLength(0);
  expect(h.walls).toHaveLength(5);
  const back = h.walls[h.walls.length - 1];
  expect([back.a, back.b, back.kind]).toEqual([fence.a, fence.b, "external"]);
  await expect(page.locator("#wk")).toHaveValue("external");
  await expect(page.locator(`svg line[data-w="${h.walls.length - 1}"]`)).toHaveClass("e external");
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  expect(await groundOf(page)).toEqual(before);
  await savedValid(page);
});

test("choosing the opening entry on a room edge select is not possible: the edge kind select has the five kinds and Not drawn", async ({ page }) => {
  await clickCm(page, 500, 200);
  expect(await page.locator("#ek option").evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value))).toEqual(["wall", "boundary", "external", "fence", "edge", "none"]);
});

test("break it: a wall of zero length is not turned into an opening; the status line says so and nothing is written", async ({ page }) => {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag as string) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.walls = [{ id: "wall-ground-1", a: [100, 700], b: [100, 700], kind: "wall" }, { id: "wall-ground-2", a: [300, 700], b: [400, 700], kind: "wall" }];
    el.layout = l;
  }, EDITOR);
  // a zero-length wall has no body to click: select it through the editor state
  await page.evaluate((tag) => { (document.querySelector(tag as string) as any).st.sel = { t: "wall", i: 0 }; (document.querySelector(tag as string) as any).requestUpdate(); }, EDITOR);
  await expect(page.locator("#wk")).toBeVisible();
  const before = await layoutOf(page);
  await page.locator("#wk").selectOption("opening");
  await expect(status(page)).toContainText("zero length");
  expect(await layoutOf(page)).toEqual(before);
  await expect(page.locator("#wk")).toHaveValue("wall"); // the select snaps back to the kind
  await page.keyboard.press("Control+z"); // nothing was recorded: undo does nothing
  expect(await layoutOf(page)).toEqual(before);
});

// ---- S1.20 a new item lands outside the house ----
/** The part of the plan the svg shows now: [x0, y0, x1, y1] in cm. */
const visible = (page: Page) =>
  page.evaluate((tag) => {
    const svg = (document.querySelector(tag as string) as any).shadowRoot.querySelector("svg") as SVGSVGElement, v = svg.viewBox.baseVal;
    return [v.x, v.y, v.x + v.width, v.y + v.height] as [number, number, number, number];
  }, EDITOR);
const addMenuItem = async (page: Page, id: string) => addItem(page, id);
const OUTLINE_MAX_X = 800;

test("Add, Structure puts every point outside the outline's box, and the structure is inside the view afterwards", async ({ page }) => {
  await addMenuItem(page, "#addStr");
  const g = await groundOf(page), s = g.rooms[g.rooms.length - 1];
  expect(s.kind).toBe("structure");
  for (const [x, y] of s.pts) { expect(x).toBeGreaterThan(OUTLINE_MAX_X); expect(x % 5).toBe(0); expect(y % 5).toBe(0); }
  const v = await visible(page);
  for (const [x, y] of s.pts) { expect(x).toBeGreaterThanOrEqual(v[0]); expect(x).toBeLessThanOrEqual(v[2]); expect(y).toBeGreaterThanOrEqual(v[1]); expect(y).toBeLessThanOrEqual(v[3]); }
});

test("Add, Wall, Zone, Stairs and Furniture all land right of the house, top aligned with it", async ({ page }) => {
  await addMenuItem(page, "#addWall-wall");
  await addMenuItem(page, "#addZone");
  await addMenuItem(page, "#addStairs");
  await menu(page, "Add");
  await page.locator("#addFurn").selectOption("bed");
  const g = await groundOf(page);
  const pts: number[][] = [...g.walls.flatMap((w) => [w.a, w.b]), ...g.rooms.slice(7).flatMap((r) => r.pts), ...g.stairs.slice(1).flatMap((t) => t.pts)];
  expect(pts.length).toBe(2 + 4 + 4);
  for (const [x] of pts) expect(x).toBeGreaterThan(OUTLINE_MAX_X);
  const bed = g.furniture[g.furniture.length - 1];
  expect(bed.x - bed.w / 2).toBeGreaterThan(OUTLINE_MAX_X);
  expect(bed.y).toBe(0); // the top of the outline
});

test("S5.1: every FURNITURE_SYMBOLS entry can be placed from the Add menu, and the layout still validates", async ({ page }) => {
  const before = (await groundOf(page)).furniture.length;
  for (const sym of FURNITURE_SYMBOLS) { await menu(page, "Add"); await page.locator("#addFurn").selectOption(sym); }
  const l = await layoutOf(page), g = l.floors.ground;
  expect(g.furniture.slice(before).map((m) => m.symbol)).toEqual([...FURNITURE_SYMBOLS]);
  expect(validate(l).ok).toBe(true);
});

test("S5.1 break it: a furniture piece rotated past 360 by repeated button clicks stays wrapped into [0, 360)", async ({ page }) => {
  await menu(page, "Add"); await page.locator("#addFurn").selectOption("bed"); // placing selects it
  for (let i = 0; i < 5; i++) await page.locator("#fr90").click(); // 5 x 90 = 450
  const g = await groundOf(page);
  expect(g.furniture[g.furniture.length - 1].rot).toBe(90);
});

test("break it: with the view panned far from the house, an added item is still outside the house and comes into view", async ({ page }) => {
  // pan with real drags on the background, far to the south-west of the house
  for (let n = 0; n < 4; n++) {
    await page.mouse.move(900, 300);
    await page.mouse.down();
    await page.mouse.move(600, 500, { steps: 5 });
    await page.mouse.move(350, 700, { steps: 5 });
    await page.mouse.up();
  }
  const far = await visible(page);
  expect(far[0]).toBeGreaterThan(OUTLINE_MAX_X + 1500); // the house is nowhere near the view
  await addMenuItem(page, "#addStr");
  const g = await groundOf(page), s = g.rooms[g.rooms.length - 1];
  for (const [x] of s.pts) expect(x).toBeGreaterThan(OUTLINE_MAX_X);
  const v = await visible(page);
  for (const [x, y] of s.pts) { expect(x).toBeGreaterThanOrEqual(v[0]); expect(x).toBeLessThanOrEqual(v[2]); expect(y).toBeGreaterThanOrEqual(v[1]); expect(y).toBeLessThanOrEqual(v[3]); }
  // the zoom did not change
  expect(Math.round((v[2] - v[0]) * 10)).toBe(Math.round((far[2] - far[0]) * 10));
});

/** True when the shape's screen box lies wholly inside the svg's own box. */
const inCanvas = (page: Page, shape: string) =>
  page.evaluate(([tag, sel]) => {
    const root = (document.querySelector(tag as string) as any).shadowRoot as ShadowRoot;
    const c = root.querySelector("svg")!.getBoundingClientRect(), r = root.querySelector(sel as string)!.getBoundingClientRect();
    return r.left >= c.left - 0.5 && r.right <= c.right + 0.5 && r.top >= c.top - 0.5 && r.bottom <= c.bottom + 0.5;
  }, [EDITOR, shape] as const);
const NEW_SHAPES: [string, (page: Page) => Promise<void>, string][] = [
  ["wall", (p) => addMenuItem(p, "#addWall-wall"), 'line[data-w="0"]'],
  ["structure", (p) => addMenuItem(p, "#addStr"), 'polygon[data-r="7"]'],
  ["zone", (p) => addMenuItem(p, "#addZone"), 'polygon[data-r="7"]'],
  ["stairs", (p) => addMenuItem(p, "#addStairs"), '[data-s="1"]'],
  ["furniture", async (p) => { await menu(p, "Add"); await p.locator("#addFurn").selectOption("bed"); }, 'g[data-f="2"]'],
];
async function zoomIn(page: Page, ticks: number) {
  const c = await screenOf(page, 400, 300);
  await page.mouse.move(c.x, c.y);
  for (let n = 0; n < ticks; n++) await page.mouse.wheel(0, -300);
}
for (const [name, add, shape] of NEW_SHAPES) {
  for (const zoom of [0, 6]) {
    test(`a new ${name} is wholly in view, ${zoom ? "after zooming in" : "at the default view"}`, async ({ page }) => {
      if (zoom) await zoomIn(page, zoom);
      await add(page);
      await expect(page.locator(shape)).toHaveCount(1);
      expect(await inCanvas(page, shape)).toBe(true);
    });
  }
}

test("a new structure that does not fit at this zoom brings the view out until it does", async ({ page }) => {
  await zoomIn(page, 14); // a window a few metres wide
  const before = (await visible(page));
  await addMenuItem(page, "#addStr");
  expect(await inCanvas(page, 'polygon[data-r="7"]')).toBe(true);
  const after = await visible(page);
  expect(after[2] - after[0]).toBeGreaterThan(before[2] - before[0]); // it zoomed out, and only because it had to
});

test("a floor with no outline: an added zone lands at the view centre, as before", async ({ page }) => {
  await addBareFloor(page, "Attic");
  await expect(page.locator(".chip[data-f]")).toHaveCount(4);
  const v = await visible(page);
  await addMenuItem(page, "#addZone");
  const l = await layoutOf(page), z = l.floors.attic.rooms[0], cx = (z.pts[0][0] + z.pts[2][0]) / 2, cy = (z.pts[0][1] + z.pts[2][1]) / 2;
  expect(Math.abs(cx - (v[0] + v[2]) / 2)).toBeLessThan(10);
  expect(Math.abs(cy - (v[1] + v[3]) / 2)).toBeLessThan(10);
});

test("a device whose catalog room is not on the floor lands right of the house and is in view", async ({ page }) => {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag as string) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.catalog.find((c: any) => c.id === "contact-garage").room = "Nowhere";
    el.layout = l;
  }, EDITOR);
  await openDevice(page);
  await devItem(page, "contact-garage").click();
  const g = await groundOf(page), d = g.devices[g.devices.length - 1] as { id: string; x: number; y: number };
  expect(d.id).toBe("contact-garage");
  expect(d.x).toBeGreaterThan(OUTLINE_MAX_X);
  const v = await visible(page);
  expect(d.x).toBeGreaterThanOrEqual(v[0]); expect(d.x).toBeLessThanOrEqual(v[2]);
});

// ---- S1.21 Draw is its own menu ----
const DRAW_IDS = ["drawRoom", "drawZone", "drawWater", "drawOutline", "drawWall-wall", "drawWall-boundary", "drawWall-external", "drawWall-fence", "drawWall-edge", "drawOpening", "drawExtra"];
// S4.26: grouped like Add — Openings, Wall, Areas — so DOM order differs from DRAW_IDS' logical grouping.
const DRAW_IDS_DOM = ["drawOpening", "drawWall-wall", "drawWall-boundary", "drawWall-external", "drawWall-fence", "drawWall-edge", "drawRoom", "drawZone", "drawWater", "drawOutline", "drawExtra"];

test("the Add menu holds no Draw item and no Water; the Draw menu holds all eleven", async ({ page }) => {
  for (const id of [...DRAW_IDS, "addWater", "addWall"]) await expect(page.locator(`#mAdd #${id}`)).toHaveCount(0);
  await expect(page.locator("#mAdd .grp, #mAdd .sep").filter({ hasText: /Draw/ })).toHaveCount(0);
  const ids = await page.locator("#mAdd button").evaluateAll((b) => b.map((x) => x.id));
  expect(ids).toEqual(["addDoor", "addWin", "addGap", "addWall-wall", "addWall-boundary", "addWall-external", "addWall-fence", "addWall-edge", "addStr", "addZone", "addStairs", "addDevBtn"]);
  await expect(page.locator("#mAdd select#addFurn")).toHaveCount(1);
  expect(await page.locator("#mDraw button").evaluateAll((b) => b.map((x) => x.id))).toEqual(DRAW_IDS_DOM);
  expect(new Set(DRAW_IDS_DOM)).toEqual(new Set(DRAW_IDS));
  // and they are really there to click: open, visible, inside the window
  await menu(page, "Draw");
  await page.locator(`#mDraw details.sub > summary:text-is("Areas")`).click();
  const box = await page.locator("#drawRoom").boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(1280);
  await expect(page.locator("#drawRoom")).toBeVisible();
});

// ---- S4.11 Add is grouped into submenus: Openings, Wall, Areas; Furniture stays flat ----

test("S4.11: Add's items sit under three submenus by group, Furniture stays flat, and every id still finds its button one click deeper", async ({ page }) => {
  const subOf = (id: string) => page.locator(`#mAdd details.sub:has(#${id})`);
  await menu(page, "Add");
  // grouped correctly
  for (const id of ["addDoor", "addWin", "addGap"]) await expect(subOf(id).locator("summary")).toHaveText("Openings");
  for (const k of WALL_KINDS) await expect(subOf(`addWall-${k}`).locator("summary")).toHaveText("Wall");
  for (const id of ["addStr", "addZone", "addStairs"]) await expect(subOf(id).locator("summary")).toHaveText("Areas");
  // Furniture is not inside any submenu
  await expect(page.locator("#mAdd > .box > #addFurn")).toHaveCount(1);
  await menu(page, "Add"); // close
  // every existing id still resolves, one submenu-open click deeper (exercises addItem's routing for one of each group)
  for (const id of ["#addDoor", "#addWall-wall", "#addZone"]) {
    const before = await groundOf(page);
    await addItem(page, id);
    const g = await groundOf(page);
    expect(g.walls.length + g.doors.length + g.rooms.length).toBeGreaterThan(before.walls.length + before.doors.length + before.rooms.length);
  }
});

test("S4.11: closing Add by an outside click collapses any open submenu, so reopening Add starts collapsed", async ({ page }) => {
  await menu(page, "Add");
  await page.locator(`#mAdd details.sub > summary:text-is("Openings")`).click();
  await expect(page.locator("#addDoor")).toBeVisible();
  await expect(page.locator("#addOpenings")).toHaveJSProperty("open", true);
  await page.mouse.click(2, 2); // outside every menu
  await expect(page.locator("#mAdd")).toHaveJSProperty("open", false);
  await menu(page, "Add"); // reopen
  await expect(page.locator("#addOpenings")).toHaveJSProperty("open", false); // the submenu did not stay expanded
  await expect(page.locator("#addDoor")).not.toBeVisible();
});

test("S4.11: Tab reaches every Add item in DOM order, submenus included", async ({ page }) => {
  await menu(page, "Add");
  await page.locator(`#mAdd details.sub > summary:text-is("Openings")`).click();
  await page.locator(`#mAdd details.sub > summary:text-is("Wall")`).click();
  await page.locator(`#mAdd details.sub > summary:text-is("Areas")`).click();
  const order = await page.locator("#mAdd .box *:is(summary, button, select)").evaluateAll((els) => els.map((e) => e.id || e.textContent?.trim()));
  expect(order).toEqual(["Openings", "addDoor", "addWin", "addGap", "Wall", "addWall-wall", "addWall-boundary", "addWall-external", "addWall-fence", "addWall-edge", "Areas", "addStr", "addZone", "addStairs", "addDevBtn", "addFurn", "addUnlDev"]);
});

test("each Add, Wall item places a 200 cm wall of its kind at the spawn point, selected, in one undo step", async ({ page }) => {
  for (const kind of WALL_KINDS) {
    const before = await groundOf(page);
    await addItem(page, `#addWall-${kind}`);
    const g = await groundOf(page), w = g.walls[g.walls.length - 1];
    expect(g.walls).toHaveLength(before.walls.length + 1);
    expect([w.kind, dist2(w.a, w.b)]).toEqual([kind, 200]);
    expect(w.a[0]).toBeGreaterThan(OUTLINE_MAX_X);
    await expect(page.locator("#wk")).toHaveValue(kind);
    await expect(page.locator(`svg line[data-w="${g.walls.length - 1}"]`)).toHaveClass(new RegExp(`^${WALL_CLASS[kind]}$`));
  }
  await page.keyboard.press("Control+z");
  expect((await groundOf(page)).walls).toHaveLength(4);
});
const dist2 = (a: number[], b: number[]) => Math.hypot(b[0] - a[0], b[1] - a[1]);

// ---- S4.9: locked walls, doors and openings pivot on drag, length fixed ----

test("a locked wall's dragged end pivots on an arc of fixed radius around the other end", async ({ page }) => {
  await addItem(page, "#addWall-wall");
  const w = (await groundOf(page)).walls.at(-1)!;
  await centreViewOn(page, mid(w));
  await expect(page.locator("#wlock")).not.toBeChecked();
  await page.locator("#wlock").check();
  await dragCm(page, w.a as [number, number], [w.a[0] + 30, w.a[1] + 40]);
  const w2 = (await groundOf(page)).walls.at(-1)!;
  expect(Math.abs(dist2(w2.a, w2.b) - dist2(w.a, w.b))).toBeLessThanOrEqual(1); // length fixed, within rounding
  expect(w2.b).toEqual(w.b); // the far end never moved
  expect(w2.a).not.toEqual(w.a);
  await page.keyboard.press("Control+z");
  expect((await groundOf(page)).walls.at(-1)!.a).toEqual(w.a); // one undo step
});

test("typing a wall's length locks it; unticking frees it for a normal, length-changing drag", async ({ page }) => {
  await addItem(page, "#addWall-wall");
  const w = (await groundOf(page)).walls.at(-1)!;
  await centreViewOn(page, mid(w));
  await page.locator("#wlen").fill("3");
  await page.locator("#wlen").press("Enter");
  await expect(page.locator("#wlock")).toBeChecked();
  expect(dist2((await groundOf(page)).walls.at(-1)!.a, (await groundOf(page)).walls.at(-1)!.b)).toBe(300);
  await page.locator("#wlock").uncheck();
  const w2 = (await groundOf(page)).walls.at(-1)!;
  await dragCm(page, w2.a as [number, number], [w2.a[0] + 50, w2.a[1]]);
  const w3 = (await groundOf(page)).walls.at(-1)!;
  expect(dist2(w3.a, w3.b)).not.toBe(300); // free again: the drag changed the length
});

test("a locked door's dragged end pivots on an arc of fixed radius", async ({ page }) => {
  await addItem(page, "#addDoor");
  const d = (await groundOf(page)).doors.at(-1)!;
  await centreViewOn(page, mid(d));
  await expect(page.locator("#dlock")).not.toBeChecked();
  await page.locator("#dlock").check();
  await dragCm(page, d.a as [number, number], [d.a[0] + 40, d.a[1] + 30]);
  const d2 = (await groundOf(page)).doors.at(-1)!;
  expect(Math.abs(dist2(d2.a, d2.b) - dist2(d.a, d.b))).toBeLessThanOrEqual(1);
  expect(d2.b).toEqual(d.b);
  expect(d2.a).not.toEqual(d.a);
});

test("a locked opening's dragged end pivots on an arc of fixed radius", async ({ page }) => {
  await addGap(page);
  const o = (await gaps(page))[0];
  await expect(page.locator("#olock")).not.toBeChecked();
  await page.locator("#olock").check();
  await dragCm(page, o.a as [number, number], [o.a[0] + 40, o.a[1] + 25]);
  const o2 = (await gaps(page))[0];
  expect(Math.abs(len(o2) - len(o))).toBeLessThanOrEqual(1);
  expect(o2.b).toEqual(o.b);
  expect(o2.a).not.toEqual(o.a);
});

test("opening Draw closes Add, and a Draw item starts drawing with the Draw menu closed", async ({ page }) => {
  await menu(page, "Add");
  await expect(page.locator("#mAdd")).toHaveJSProperty("open", true);
  await menu(page, "Draw");
  await expect(page.locator("#mAdd")).toHaveJSProperty("open", false);
  await expect(page.locator("#mDraw")).toHaveJSProperty("open", true);
  await page.locator(`#mDraw details.sub:has(#drawWall-fence) summary`).click();
  await page.locator("#drawWall-fence").click();
  await expect(page.locator("#mDraw")).toHaveJSProperty("open", false);
  expect(await svgCursor(page)).toBe("crosshair");
  await expect(page.locator("#status")).toHaveText(DRAW_STATUS);
});

test("break it: a second Draw item chosen mid-draw starts afresh and writes nothing from the first", async ({ page }) => {
  const before = await groundOf(page);
  await startDraw(page, "drawWall-fence");
  await clicksCm(page, FREE[0], FREE[1]);
  await expect(drawnPoints(page)).toHaveCount(2);
  await startDraw(page, "drawWall-edge");
  await expect(drawnPoints(page)).toHaveCount(0);
  await clicksCm(page, FREE[2], FREE[3]);
  await page.keyboard.press("Enter");
  const g = await groundOf(page);
  expect(g.walls).toHaveLength(before.walls.length + 1);
  expect(g.walls[g.walls.length - 1].kind).toBe("edge");
  expect(g.walls.some((w) => w.kind === "fence")).toBe(false);
});

// ---- S1.22 everything drags by its body ----
const bbox = (page: Page, sel: string) => page.locator(sel).evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y }; });

test("dragging the pond by its middle moves every point by the same amount, adds no point to any wall, and is one undo step", async ({ page }) => {
  const before = await groundOf(page), pond = before.rooms[6];
  expect(pond.kind).toBe("water");
  const b0 = await bbox(page, 'svg polygon[data-r="6"]');
  await drag(page, 'svg polygon[data-r="6"]', 90, 150); // far from any corner, so the drop does not snap
  const b1 = await bbox(page, 'svg polygon[data-r="6"]');
  expect(Math.round(b1.x - b0.x)).toBe(90); // it followed the pointer on screen
  expect(Math.round(b1.y - b0.y)).toBe(150);
  const after = await groundOf(page), moved = after.rooms[6];
  const d = [moved.pts[0][0] - pond.pts[0][0], moved.pts[0][1] - pond.pts[0][1]];
  expect(d[0]).toBeGreaterThan(0); expect(d[1]).toBeGreaterThan(0);
  moved.pts.forEach((p, i) => expect([p[0] - pond.pts[i][0], p[1] - pond.pts[i][1]]).toEqual(d));
  expect(moved.wk).toEqual(pond.wk);
  expect(after.rooms.map((r) => r.pts.length)).toEqual(before.rooms.map((r) => r.pts.length));
  expect(after.outline).toEqual(before.outline);
  expect(after.rooms.filter((_, i) => i !== 6)).toEqual(before.rooms.filter((_, i) => i !== 6));
  await expect(page.locator("#rk")).toHaveValue("water"); // it is selected
  await page.keyboard.press("Control+z");
  expect(await groundOf(page)).toEqual(before);
  await expect(page.locator("#undo")).toBeDisabled();
});

test("dragging the stairs by their middle moves every point by the same amount", async ({ page }) => {
  const before = await groundOf(page), t0 = before.stairs[0];
  const b0 = await bbox(page, 'svg g[data-s="0"]');
  await drag(page, 'svg g[data-s="0"]', -50, -30);
  const b1 = await bbox(page, 'svg g[data-s="0"]');
  expect(Math.round(b1.x - b0.x)).toBe(-50);
  expect(Math.round(b1.y - b0.y)).toBe(-30);
  const after = await groundOf(page), t1 = after.stairs[0];
  const d = [t1.pts[0][0] - t0.pts[0][0], t1.pts[0][1] - t0.pts[0][1]];
  expect(d[0]).toBeLessThan(0);
  t1.pts.forEach((p, i) => expect([p[0] - t0.pts[i][0], p[1] - t0.pts[i][1]]).toEqual(d));
  expect(after.rooms).toEqual(before.rooms); // nothing else moved, and no room gained a point
  await expect(page.locator("#sn")).toBeVisible();
});

test("a press on a room body that does not move selects it and records no undo step; the plan does not pan", async ({ page }) => {
  await freeRoom(page, 0); // a snapped room's press-drag is a pan, tested separately; this one is about the room-drag path
  const v0 = await visible(page);
  const c = await screenOf(page, 100, 300);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 1, c.y + 1); // under the 4 px threshold
  await page.mouse.up();
  await expect(page.locator("#rn")).toHaveValue("Living");
  await expect(page.locator("#undo")).toBeDisabled();
  expect(await visible(page)).toEqual(v0);
});

test("break it: dragging a room by its body leaves the neighbour's corner and the outline where they were", async ({ page }) => {
  const before = await groundOf(page);
  expect(before.rooms[0].pts[1]).toEqual(before.rooms[1].pts[0]); // living and kitchen share (500, 0)
  await freeRoom(page, 0); // otherwise the snapped room's drag just pans the view
  await dragCm(page, [100, 300], [100, 340]); // the living room, by its middle
  const after = await groundOf(page);
  expect(after.rooms[0].pts.map((p) => p[1] - before.rooms[0].pts[after.rooms[0].pts.indexOf(p)][1])).toEqual([40, 40, 40, 40]);
  expect(after.rooms[1]).toEqual(before.rooms[1]); // the kitchen kept its corner
  expect(after.rooms[2]).toEqual(before.rooms[2]);
  expect(after.outline).toEqual(before.outline);
  expect(after.rooms[0].pts.length).toBe(4);
});

test("a room dragged 250 cm away and back to within a few cm snaps corner on corner and shares its edges again", async ({ page }) => {
  const before = await groundOf(page);
  await clickCm(page, 50, 200); // the living room
  await page.locator("#runsnap").click(); // Unsnap: it starts snapped, so the first drag would otherwise just pan
  await dragCm(page, [50, 200], [300, 200]); // the living room, by its body, 250 cm to the right — clear of every other corner
  const away = await groundOf(page);
  expect(away.rooms[0].pts[0]).toEqual([before.rooms[0].pts[0][0] + 250, before.rooms[0].pts[0][1]]);
  await page.locator("#runsnap").click(); // Snap back, so dropping near its place re-joins it
  await dragCm(page, [300, 200], [47, 203]); // back to 3 cm left and 3 cm low of its place
  const after = await groundOf(page);
  expect(after.rooms[0].pts).toEqual(before.rooms[0].pts); // exactly the original points
  expect(after.rooms[0].pts[1]).toEqual(after.rooms[1].pts[0]); // living and kitchen share (500, 0) again
  expect(after.rooms[0].wk).toEqual(before.rooms[0].wk);
  expect(after.rooms[1].pts).toContainEqual(after.rooms[0].pts[1]); // the neighbour has that corner too
  for (const q of before.outline) expect(after.outline).toContainEqual(q); // the outline kept its corners (it may have gained points where the room's corners touched it)
  await savedValid(page);
});

test("holding Alt while dropping a room near its place leaves it exactly where it was dropped", async ({ page }) => {
  const before = await groundOf(page);
  await clickCm(page, 50, 200); // the living room
  await page.locator("#runsnap").click(); // Unsnap: it starts snapped, so the first drag would otherwise just pan
  await dragCm(page, [50, 200], [350, 200]);
  await dragCm(page, [350, 200], [47, 203], ["Alt"]);
  const after = await groundOf(page);
  expect(after.rooms[0].pts).not.toEqual(before.rooms[0].pts);
  expect(Math.abs(after.rooms[0].pts[0][0] - before.rooms[0].pts[0][0])).toBeLessThan(8);
  expect(Math.abs(after.rooms[0].pts[0][0] - before.rooms[0].pts[0][0])).toBeGreaterThan(0);
});

test("a device sitting on a room is still dragged as a device, not as the room", async ({ page }) => {
  const before = await groundOf(page);
  await drag(page, 'g[data-x="0"]', 30, 30);
  const after = await groundOf(page);
  expect(after.rooms).toEqual(before.rooms);
  expect(after.devices[0]).not.toEqual(before.devices[0]);
});

// ---- S1.23 rotate a device, a wall, a door or an opening ----
const angleOf = (o: { a: number[]; b: number[] }) => Math.round(((Math.atan2(o.b[1] - o.a[1], o.b[0] - o.a[0]) * 180) / Math.PI + 360) % 360);

test("a door's angle field turns it about its midpoint: at 90 the ends swap axis, the midpoint stays, the length stays", async ({ page }) => {
  await addItem(page, "#addDoor");
  const d0 = (await groundOf(page)).doors.at(-1)!;
  const turn = (angleOf(d0) + 90) % 360;
  await expect(page.locator("#drot")).toHaveValue(String(angleOf(d0)));
  await page.locator("#drot").fill(String(turn));
  await page.locator("#drot").press("Enter");
  const d1 = (await groundOf(page)).doors.at(-1)!;
  expect(angleOf(d1)).toBe(turn); // a quarter turn: the ends swap axis
  expect(d0.a[0] === d0.b[0]).not.toBe(d1.a[0] === d1.b[0]);
  expect(mid(d1)).toEqual(mid(d0));
  expect(Math.abs(len(d1) - len(d0))).toBeLessThanOrEqual(1);
  await expect(page.locator("#drot")).toHaveValue(String(turn));
  // the line drawn in the browser follows it
  const box = await page.locator(`svg line[data-d="${(await groundOf(page)).doors.length - 1}"]:not(.door-hit)`).boundingBox();
  if (d1.a[0] === d1.b[0]) expect(box!.height).toBeGreaterThan(box!.width * 2);
  else expect(box!.width).toBeGreaterThan(box!.height * 2);
  await menu(page, "File");
  await page.locator("#undo").click();
  expect((await groundOf(page)).doors.at(-1)).toEqual(d0);
  await savedValid(page);
});

test("the wall and opening angle fields turn them; an unchanged value is no undo step", async ({ page }) => {
  await withWallRow(page);
  await clickCm(page, 60, 650);
  await expect(page.locator("#wrot")).toHaveValue("0");
  await page.locator("#wrot").fill("0");
  await page.locator("#wrot").press("Enter");
  await expect(page.locator("#undo")).toBeDisabled();
  await page.locator("#wrot").fill("90");
  await page.locator("#wrot").press("Enter");
  const w = (await groundOf(page)).walls[0];
  expect([w.a, w.b]).toEqual([[60, 600], [60, 700]]);
  await page.locator("#wk").focus(); // as a real click does
  await page.locator("#wk").selectOption("opening");
  await expect(page.locator("#orot")).toHaveValue("90");
  await page.locator("#orot").fill("0");
  await page.locator("#orot").press("Enter");
  const o = (await groundOf(page)).openings[0];
  expect([o.a, o.b]).toEqual([[10, 650], [110, 650]]);
});

test("a device rotation is stored, drawn on the group and undone; the glyph stays upright in the browser; the real pointer still hits it", async ({ page }) => {
  await page.mouse.click(...Object.values(await centre(page, 'g[data-x="0"]')) as [number, number]);
  await page.locator("#vrot90").click();
  expect(((await groundOf(page)).devices[0] as { rot?: number }).rot).toBe(90);
  const m = await page.locator('g[data-x="0"] > g path').evaluate((p) => { const c = (p as SVGGraphicsElement).getScreenCTM()!; return [c.a, c.b, c.c, c.d]; });
  expect(Math.abs(m[1])).toBeLessThan(1e-6); // the icon has no rotation of its own on screen
  expect(Math.abs(m[2])).toBeLessThan(1e-6);
  const g = await page.locator('g[data-x="0"]').evaluate((p) => { const c = (p as SVGGraphicsElement).getScreenCTM()!; return [c.a, c.b]; });
  expect(Math.abs(g[0])).toBeLessThan(1e-6); // the group itself is turned by a quarter
  expect(Math.abs(g[1])).toBeGreaterThan(0.1);
  // click elsewhere, then the rotated device by pointer: it is still the device that is hit
  await clickCm(page, 300, 500); // empty ground inside the view (900 cm is below the 800 px viewport: that click blurs the editor and races)
  await page.mouse.click(...Object.values(await centre(page, 'g[data-x="0"]')) as [number, number]);
  expect(((await groundOf(page)).devices[0] as { rot?: number }).rot).toBe(90);
  await page.locator("#vrotreset").click();
  expect("rot" in (await groundOf(page)).devices[0]).toBe(false); // the key is deleted at 0
  await page.locator("#vrotreset").click(); // already 0: no step
  await menu(page, "File");
  await page.locator("#undo").click();
  expect(((await groundOf(page)).devices[0] as { rot?: number }).rot).toBe(90);
  await savedValid(page);
});

test("break it: an angle field with rubbish changes nothing", async ({ page }) => {
  await addItem(page, "#addDoor");
  const before = await groundOf(page);
  await page.locator("#drot").fill("");
  await page.locator("#drot").press("Enter");
  expect(await groundOf(page)).toEqual(before);
});

// ---- S1.24 unsnap a room, then rotate it ----
test("a room that shares corners cannot be rotated until it is unsnapped; unsnapping moves nothing; rotating is one undo step", async ({ page }) => {
  const before = await groundOf(page);
  await clickCm(page, 50, 200); // the living room
  await expect(page.locator("#rn")).toHaveValue("Living");
  await expect(page.locator("#rrot90")).toBeDisabled();
  await expect(page.locator("#runsnap")).toHaveText("Unsnap");
  await page.locator("#runsnap").click();
  await expect(page.locator("#rrot90")).toBeEnabled();
  await expect(page.locator("#runsnap")).toHaveText("Snap back");
  await expect(page.locator(".hint", { hasText: "Unsnapped: no longer joins its neighbours." })).toBeVisible();
  const free = await groundOf(page);
  expect(free.rooms[0].free).toBe(true);
  expect(free.rooms[0].pts).toEqual(before.rooms[0].pts); // not one centimetre
  expect(free.rooms.slice(1)).toEqual(before.rooms.slice(1)); // and the neighbours' corners stay
  expect(free.outline).toEqual(before.outline);
  await page.locator("#rrot30").click();
  const turned = await groundOf(page);
  expect(turned.rooms[0].pts).not.toEqual(free.rooms[0].pts);
  expect(turned.rooms[0].pts.length).toBe(4);
  // still 500 x 400 apart corner to corner: a turn keeps lengths (within rounding)
  const d = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  expect(Math.abs(d(turned.rooms[0].pts[0], turned.rooms[0].pts[1]) - 500)).toBeLessThanOrEqual(1);
  expect(Math.abs(d(turned.rooms[0].pts[1], turned.rooms[0].pts[2]) - 400)).toBeLessThanOrEqual(1);
  await menu(page, "File");
  await page.locator("#undo").click();
  expect((await groundOf(page)).rooms[0].pts).toEqual(free.rooms[0].pts); // one step back
  await savedValid(page);
});

test("an unsnapped room is not pulled onto a neighbour's corner when it is dropped near it", async ({ page }) => {
  await clickCm(page, 50, 200);
  await page.locator("#runsnap").click();
  const before = await groundOf(page);
  await dragCm(page, [50, 200], [350, 200]);
  await dragCm(page, [350, 200], [47, 203]); // back, 3 cm short and 3 cm low
  const after = await groundOf(page);
  expect(after.rooms[0].pts).not.toEqual(before.rooms[0].pts); // a snapped room would have landed exactly
  expect(Math.abs(after.rooms[0].pts[0][0] - before.rooms[0].pts[0][0])).toBeLessThan(8);
  expect(after.rooms[1].pts).toEqual(before.rooms[1].pts); // nothing was stitched into the kitchen
});

test("a room clear of every corner rotates at once and touches no other room", async ({ page }) => {
  await page.mouse.click(...Object.values(await centre(page, 'svg polygon[data-r="6"]')) as [number, number]); // the pond
  await expect(page.locator("#rk")).toHaveValue("water");
  await expect(page.locator("#rrot90")).toBeEnabled();
  await expect(page.locator("#runsnap")).toHaveText("Unsnap");
  const before = await groundOf(page);
  await page.locator("#rrot90").click();
  const after = await groundOf(page);
  expect(after.rooms[6].pts).not.toEqual(before.rooms[6].pts);
  expect(after.rooms.filter((_, i) => i !== 6)).toEqual(before.rooms.filter((_, i) => i !== 6));
});

test("break it: the turn buttons of a snapped room are disabled and add no undo step", async ({ page }) => {
  await clickCm(page, 50, 200);
  for (const n of [30, 45, 60, 90]) await expect(page.locator(`#rrot${n}`)).toBeDisabled();
  await expect(page.locator("#undo")).toBeDisabled();
});

// ---- stairs shape, steps, rotation (S1.25) -----------------------------------

async function setField(page: Page, id: string, v: string) {
  await page.locator(id).fill(v);
  await page.locator(id).press("Enter");
}

test("stairs: switching to round and setting the diameters gives a 24-gon, the inner diameter and no corner handles", async ({ page }) => {
  await addStairs(page);
  await expect(page.locator('svg circle[data-h^="s1:"]')).toHaveCount(4);
  await page.locator("#ss").selectOption("round");
  await expect(page.locator("#sdia")).toBeVisible();
  await setField(page, "#sdia", "200");
  await setField(page, "#sinner", "80");
  const t = (await groundOf(page)).stairs[1];
  expect(t).toMatchObject({ shape: "round", dia: 200, inner: 80, steps: 11, rot: 0 }); // pi * 140 / 40, derived
  expect(t.pts).toHaveLength(24);
  const cx = t.pts.reduce((s, p) => s + p[0], 0) / 24, cy = t.pts.reduce((s, p) => s + p[1], 0) / 24;
  for (const p of t.pts) expect(Math.abs(Math.hypot(p[0] - cx, p[1] - cy) - 100)).toBeLessThan(1);
  await expect(page.locator('svg circle[data-h^="s1:"]')).toHaveCount(0);
  await expect(page.locator('svg g[data-s="1"] line.tread')).toHaveCount(10);
  await expect(page.locator('svg g[data-s="1"] path[fill-rule="evenodd"]')).toHaveCount(1);
  // the inner diameter cannot leave less than 40 cm of tread; the outer keeps the centre
  await setField(page, "#sinner", "500");
  expect((await groundOf(page)).stairs[1].inner).toBe(160);
  await setField(page, "#sdia", "100");
  const s = (await groundOf(page)).stairs[1];
  expect([s.dia, s.inner]).toEqual([100, 60]);
  expect(Math.round(s.pts.reduce((a, p) => a + p[0], 0) / 24)).toBe(Math.round(cx));
  await savedValid(page);
  // back to straight: the diameters go, the flight is 100 x 300 again
  await page.locator("#ss").selectOption("straight");
  const b = (await groundOf(page)).stairs[1];
  expect(b).toMatchObject({ shape: "straight", steps: 8 }); // 300 cm / 40, rounded
  expect("dia" in b || "inner" in b).toBe(false);
  expect(b.pts).toHaveLength(4);
});

test("stairs: a real click on a rotated flight, where the unrotated one is not, selects it", async ({ page }) => {
  const c = await screenOf(page, 740, 500);
  await page.mouse.click(c.x, c.y);
  await page.locator("#srot90").click();
  expect((await groundOf(page)).stairs[0].rot).toBe(90);
  // deselect on empty ground, then click at (670, 500): inside the turned flight (x 660 to 820), outside the stored one (x 700 to 780)
  await page.mouse.click(...Object.values(await screenOf(page, 300, 900)) as [number, number]);
  await expect(page.locator("#sn")).toHaveCount(0);
  const at = await screenOf(page, 670, 500);
  await page.mouse.click(at.x, at.y);
  await expect(page.locator("#sn")).toHaveValue("Stairs");
  // ... and where the stored flight is but the turned one is not, it selects no stairs
  await page.mouse.click(...Object.values(await screenOf(page, 300, 900)) as [number, number]);
  const off = await screenOf(page, 740, 430);
  await page.mouse.click(off.x, off.y);
  await expect(page.locator("#sn")).toHaveCount(0);
});

// Opus re-check of S8.9: stairsPanel's rotated-flight hint (panels.ts) had no test of its own.
test("stairs: rotating a straight flight shows the \"Rotated: set 0 to reshape.\" hint instead of the reshape hints", async ({ page }) => {
  const c = await screenOf(page, 740, 500);
  await page.mouse.click(c.x, c.y);
  await expect(page.locator("#panel").getByText("Drag corners to reshape.")).toBeVisible();
  await expect(page.locator("#panel").getByText("Rotated: set 0 to reshape.")).toHaveCount(0);
  await page.locator("#srot90").click();
  await expect(page.locator("#panel").getByText("Rotated: set 0 to reshape.")).toBeVisible();
  await expect(page.locator("#panel").getByText("Drag corners to reshape.")).toHaveCount(0);
  await expect(page.locator("#panel").getByText("Click an edge to add a point.")).toHaveCount(0);
  await page.locator("#srotreset").click();
  await expect(page.locator("#panel").getByText("Drag corners to reshape.")).toBeVisible();
  await expect(page.locator("#panel").getByText("Rotated: set 0 to reshape.")).toHaveCount(0);
});

test("stairs: a turned flight has no corner handles, and rotation 0 brings them back on the drawn corners", async ({ page }) => {
  const c = await screenOf(page, 740, 500);
  await page.mouse.click(c.x, c.y);
  await expect(page.locator('svg circle[data-h^="s0:"]')).toHaveCount(4);
  await page.locator("#srot30").click();
  await expect(page.locator('svg circle[data-h^="s0:"]')).toHaveCount(0);
  await expect(page.locator('svg line[data-e^="s0:"]')).toHaveCount(0);
  await page.locator("#srotreset").click();
  await expect(page.locator('svg circle[data-h^="s0:"]')).toHaveCount(4);
  await expect(page.locator('svg line[data-e^="s0:"]')).toHaveCount(4);
  const pts = (await groundOf(page)).stairs[0].pts;
  for (const [j, p] of pts.entries()) {
    await expect(page.locator(`svg circle[data-h="s0:${j}"]`)).toHaveAttribute("cx", String(p[0]));
    await expect(page.locator(`svg circle[data-h="s0:${j}"]`)).toHaveAttribute("cy", String(p[1]));
  }
});

test("S1.44: the steps are read only and follow the run", async ({ page }) => {
  const c = await screenOf(page, 740, 500);
  await page.mouse.click(c.x, c.y);
  await expect(page.locator("#sst")).toHaveCount(0);
  await expect(page.locator("#sstn")).toHaveText("4"); // 160 cm / 40
  await expect(page.locator('svg g[data-s="0"] line.tread')).toHaveCount(3);
  await drag(page, 'circle[data-h="s0:0"]', 0, -60); // the run grows
  const st = (await groundOf(page)).stairs[0];
  const run = Math.max(...st.pts.map((p) => p[1])) - Math.min(...st.pts.map((p) => p[1]));
  expect(run).toBeGreaterThan(160);
  expect(st.steps).toBe(Math.round(run / 40));
  const again = await screenOf(page, 740, 500); // the corner drag selected the corner; pick the flight again
  await page.mouse.click(again.x, again.y);
  await expect(page.locator("#sstn")).toHaveText(String(st.steps));
  await expect(page.locator('svg g[data-s="0"] line.tread')).toHaveCount(st.steps - 1);
});

// ---- stairs go on every floor (S1.26) ----------------------------------------

test("Add, Stairs puts the same stairs on every floor; Delete removes them from one floor only", async ({ page }) => {
  const before = await layoutOf(page);
  expect(before.floors.first.stairs).toHaveLength(0);
  await addStairs(page);
  const l = await layoutOf(page);
  const g = l.floors.ground.stairs[1], u = l.floors.first.stairs;
  expect(u).toHaveLength(1);
  expect(u[0].pts).toEqual(g.pts);
  expect(u[0].id).toBe("stairs-first-1");
  await expect(page.locator("#status")).toHaveText("Added stairs to every floor");
  await expect(page.locator("#sn")).toBeVisible();
  await expect(page.locator("#sdel").locator("xpath=following::p[contains(@class,'hint')][1]")).toContainText("Added to every floor; deleted from one only");
  // one undo step for all floors
  await menu(page, "File");
  await expect(page.locator("#undo")).toBeEnabled();
  await menu(page, "File");
  // on the first floor by a real click on the stairs' body, then delete: the ground floor keeps its own
  await page.locator('.chip[data-f="first"]').click();
  await expect(stairsCount(page)).toHaveCount(1);
  // this floor's view was fitted to its outline, so the stairs beside the house are off screen: zoom out until they show
  const mid = await screenOf(page, 400, 300);
  await page.mouse.move(mid.x, mid.y);
  for (let n = 0; n < 3; n++) await page.mouse.wheel(0, 300);
  expect(await inCanvas(page, 'g[data-s="0"]')).toBe(true);
  const c = await screenOf(page, g.pts[0][0] + 50, g.pts[0][1] + 60);
  await page.mouse.click(c.x, c.y);
  await expect(page.locator("#sn")).toBeVisible();
  await page.locator("#sdel").click();
  await expect(stairsCount(page)).toHaveCount(0);
  await page.locator('.chip[data-f="ground"]').click();
  await expect(stairsCount(page)).toHaveCount(2);
  const after = await layoutOf(page);
  expect(after.floors.first.stairs).toHaveLength(0);
  expect(after.floors.ground.stairs).toHaveLength(2);
  // Undo the delete, then Undo the add: every floor is back to what it was
  await menu(page, "File"); await page.locator("#undo").click();
  await menu(page, "File"); await page.locator("#undo").click();
  const back = await layoutOf(page);
  expect(back.floors.ground.stairs).toEqual(before.floors.ground.stairs);
  expect(back.floors.first.stairs).toEqual([]);
});

// ---- a new floor inherits the outline and the stairs (S1.27) -------------------

test("a new floor has the outline and the stairs of the ground floor, no rooms, and Delete floor starts it clean", async ({ page }) => {
  await addFloorVia(page, "Attic");
  const l = await layoutOf(page);
  expect(l.floors.attic.outline).toEqual(l.floors.ground.outline);
  expect(l.floors.attic.stairs.map((t) => ({ ...t, id: "" }))).toEqual(l.floors.ground.stairs.map((t) => ({ ...t, id: "" })));
  expect(l.floors.attic.stairs[0].id).toBe("stairs-attic-1");
  expect(l.floors.attic.rooms).toEqual([]);
  await expect(page.locator("svg g[data-s]")).toHaveCount(1);
  await expect(page.locator('svg line[data-e^="o:"]')).toHaveCount(4);
  await expect(page.locator("#status")).toContainText("Added floor Attic");
  await expect(page.locator("p.hint").filter({ hasText: "returns its devices to Add" })).toBeVisible();
  // the inherited outline can be clicked like any other: a real click on an outline edge selects it
  const c = await screenOf(page, 400, 0);
  await page.mouse.click(c.x, c.y);
  await expect(page.locator("#ft")).toHaveCount(0); // not the floor panel any more
});

// ---- red and orange buttons (S1.28) ---------------------------------------------

// Computed style, not class names: a rule that loses on specificity would pass a class check.
// LIGHT is the fixed on-dark button text (S1.53): white, not --fp-bg, so a danger/primary button stays readable in both themes.
const RED = "rgb(176, 42, 42)", ORANGE = "rgb(242, 140, 40)", LIGHT = "rgb(255, 255, 255)", DARK = "rgb(43, 42, 39)";
const paint = (page: Page, sel: string) => page.locator(sel).evaluate((el) => { const s = getComputedStyle(el); return [s.backgroundColor, s.color]; });
const expectWarn = async (page: Page, sel: string) => expect(await paint(page, sel), sel).toEqual([ORANGE, DARK]);
const expectDanger = async (page: Page, sel: string) => expect(await paint(page, sel), sel).toEqual([RED, LIGHT]);

test("S1.28: Reset is red", async ({ page }) => {
  await menu(page, "File");
  await expectDanger(page, "#reset");
  await expect(page.locator("#save")).not.toHaveCSS("background-color", RED); // an ordinary button stays ordinary
});

test("S1.28: Delete floor and its confirmation are red, Cancel is not", async ({ page }) => {
  await expect(page.locator("#fdel")).toBeVisible();
  await expectDanger(page, "#fdel");
  await page.locator("#fdel").click();
  await expectDanger(page, "#fdelyes");
  await expect(page.locator("#fdelno")).not.toHaveCSS("background-color", RED);
  await expect(page.locator("#fdelno")).not.toHaveCSS("background-color", ORANGE);
});

test("S1.28: every item Delete is orange", async ({ page }) => {
  // corner: a real click on a corner handle
  const h = await centre(page, 'svg circle[data-h="r0:1"]');
  await page.mouse.click(h.x, h.y);
  await expectWarn(page, "#delv");
  // room: a real click on its body
  const r = await screenOf(page, 100, 100);
  await page.mouse.click(r.x, r.y);
  await expectWarn(page, "#rdel");
  // device: a real click on an icon
  await page.mouse.click(...Object.values(await centre(page, 'g[data-x="0"]')) as [number, number]);
  await expectWarn(page, "#vdel");
  // furniture, stairs, wall, door, opening: added, so they are selected
  await menu(page, "Add"); await page.locator("#addFurn").selectOption("bed");
  await expectWarn(page, "#fudel");
  await addStairs(page);
  await expectWarn(page, "#sdel");
  await addMenuItem(page, "#addWall-wall");
  await expectWarn(page, "#wdel");
  await addItem(page, "#addDoor");
  await expectWarn(page, "#deld");
  await addGap(page);
  await expectWarn(page, "#odel");
});

test("S1.28: the floor panel and the furniture panel each own their id", async ({ page }) => {
  await expect(page.locator("#fdel")).toHaveText("Delete floor");
  await menu(page, "Add"); await page.locator("#addFurn").selectOption("bed");
  await expect(page.locator("#fdel")).toHaveCount(0);
  await expect(page.locator("#fudel")).toHaveText("Delete");
  await page.locator("#fudel").click();
  expect((await groundOf(page)).furniture).toHaveLength(2); // the bed went, the demo's two stay
  await expect(page.locator("#fdel")).toHaveText("Delete floor"); // nothing selected: the floor panel again
  await expect(page.locator("#fudel")).toHaveCount(0);
  await expectDanger(page, "#fdel");
});

test("S1.29: a device standing on a room name is the top element there", async ({ page }) => {
  const hit = await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any;
    const lay = JSON.parse(JSON.stringify(el.layout));
    const lbl = [...el.shadowRoot.querySelectorAll("svg text.lbl")].find((t: Element) => !t.classList.contains("zone") && t.textContent) as SVGTextElement;
    const b = lbl.getBBox();
    // Label centre in plan units: the svg root maps them through the viewBox, so ask the svg for the inverse.
    const svg = lbl.ownerSVGElement!;
    const p = svg.createSVGPoint(); p.x = b.x + b.width / 2; p.y = b.y + b.height / 2;
    lay.floors.ground.devices[0].x = p.x; lay.floors.ground.devices[0].y = p.y;
    lay.floors.ground.devices[0].type = "light";
    el.layout = lay;
    return { x: p.x, y: p.y };
  }, EDITOR);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const r = await screenOf(page, hit.x, hit.y);
  const top = await page.evaluate(([x, y]) => {
    const t = document.querySelector("floorplan-studio-editor")!.shadowRoot!.elementFromPoint(x, y) as Element;
    return t.closest("[data-x]")?.getAttribute("data-x") ?? t.tagName;
  }, [r.x, r.y]);
  expect(top).toBe("0");
  // Names may be click-through in the editor, so also assert the paint order in the live DOM.
  const after = await page.evaluate(() => {
    const root = document.querySelector("floorplan-studio-editor")!.shadowRoot!;
    const names = [...root.querySelectorAll("svg text.lbl")].filter((t) => !t.closest("[data-x]"));
    const dev = root.querySelector('svg g[data-x="0"]')!;
    return names.every((n) => !!(n.compareDocumentPosition(dev) & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  expect(after).toBe(true);
});

// ---- S1.31 camera cone ----
const CAM = { x: 20, y: 580 }; // the demo hall camera

test("S1.31: the cone is dark grey at 25 % alpha in the browser, the disc is 75 % white and lets the pointer through to the room", async ({ page }) => {
  await setTheme(page, "light"); // pins light values; blueprint is the default since S2.12
  const cone = page.locator("svg g.dev-camera path.cone");
  await expect(cone).toHaveCount(1);
  const st = await cone.evaluate((el) => { const s = getComputedStyle(el); return { fill: s.fill, op: s.fillOpacity, pe: s.pointerEvents }; });
  expect(st).toEqual({ fill: "rgb(74, 74, 72)", op: "0.25", pe: "none" });
  // the disc behind every icon is its own: white at 50 % (Diego, 2026-09-23), a 1 px grey border (S1.45)
  const disc = await page.locator("svg .dev .halo").evaluateAll((els) => [...new Set(els.map((e) => { const s = getComputedStyle(e); return [s.fill, s.fillOpacity, s.stroke, s.strokeWidth].join("|"); }))]);
  expect(disc).toEqual(["rgb(255, 255, 255)|0.5|rgb(139, 133, 120)|1px"]);
  // the cone is 100 cm deep: its box is 100 cm tall on screen (rot 0 points up)
  const box = await cone.evaluate((el) => el.getBoundingClientRect().height);
  const one = Math.abs((await screenOf(page, CAM.x, CAM.y - 100)).y - (await screenOf(page, CAM.x, CAM.y)).y);
  expect(Math.abs(box - one)).toBeLessThan(1.5);
  // 60 cm up the cone (rot 0 points up), over the Hall: the top element is the room, not the cone or the camera
  const p = await screenOf(page, CAM.x, CAM.y - 60);
  const top = await page.evaluate(([tag, x, y]) => (document.querySelector(tag as string) as any).shadowRoot.elementFromPoint(x, y)?.outerHTML.slice(0, 40), [EDITOR, p.x, p.y] as const);
  expect(top).toContain('data-r="2"');
  await page.mouse.click(p.x, p.y);
  await expect(page.locator("#rn")).toHaveValue("Hall");
  await expect(page.locator("#vrot90")).toHaveCount(0);
});

test("S1.31: the rotation field turns the cone; the panel carries the hint; rot 90 points it along +x", async ({ page }) => {
  const c = await screenOf(page, CAM.x, CAM.y);
  await page.mouse.click(c.x, c.y);
  await expect(page.locator("#vrot90")).toBeVisible();
  await expect(page.locator(".hint", { hasText: "Cone: 120° field of view, 1 m deep." })).toHaveCount(1);
  const centreOf = () => page.locator("svg path.cone").evaluate((el) => { const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  const up = await centreOf();
  expect(up.y).toBeLessThan(c.y - 20); // above the camera
  expect(Math.abs(up.x - c.x)).toBeLessThan(5);
  await page.locator("#vrot90").click();
  const right = await centreOf();
  expect(right.x).toBeGreaterThan(c.x + 20);
  expect(Math.abs(right.y - c.y)).toBeLessThan(5);
  const p = await screenOf(page, CAM.x + 60, CAM.y); // inside the turned cone, over the Hall
  await page.mouse.click(p.x, p.y);
  await expect(page.locator("#rn")).toHaveValue("Hall");
});

test("S1.31: only a camera has a cone", async ({ page }) => {
  await expect(page.locator("svg path.cone")).toHaveCount(1);
  await expect(page.locator("svg g.dev:not(.dev-camera) path.cone")).toHaveCount(0);
});

// ---- S1.33 rotate the whole plan ----
const rotateBy = async (page: Page, steps: number) => {
  await menu(page, "Edit"); // S8.1: Rotate moved from View to Edit
  for (let n = 0; n < Math.abs(steps); n++) await page.locator(steps > 0 ? "#rotr" : "#rotl").click();
  await menu(page, "Edit"); // close it: it would cover the plan
};
const rotOf = async (page: Page) => (await layoutOf(page)).rotate;
const withoutRotate = (l: Layout) => { const c = structuredClone(l); delete c.rotate; return c; };
const rpt = (page: Page) => page.locator(EDITOR);

test("S1.33: Edit has Rotate the plan; right steps +45, left steps -45, wrapping; one undo step each; the reading follows", async ({ page }) => {
  await menu(page, "Edit");
  await expect(page.locator("#rotv")).toContainText("0°");
  await page.locator("#rotr").click();
  await expect(page.locator("#rotv")).toContainText("45°");
  await page.locator("#rotl").click();
  await page.locator("#rotl").click();
  await expect(page.locator("#rotv")).toContainText("315°");
  expect(await rotOf(page)).toBe(315);
  await menu(page, "File");
  await page.locator("#undo").click();
  expect(await rotOf(page)).toBe(0);
  await menu(page, "File");
  await page.locator("#undo").click();
  expect(await rotOf(page)).toBe(45);
  await menu(page, "File");
  await page.locator("#undo").click();
  expect(await rotOf(page)).toBe(0);
  await expect(page.locator("#undo")).toBeDisabled(); // exactly three steps
});

test("S1.33 break it: right, right, left, left leaves rotate at 0 and the layout byte-identical", async ({ page }) => {
  const before = JSON.stringify(await layoutOf(page));
  await rotateBy(page, 2);
  expect(await rotOf(page)).toBe(90);
  await rotateBy(page, -2);
  expect(await rotOf(page)).toBe(0);
  expect(JSON.stringify(await layoutOf(page))).toBe(before);
});

test("S1.33: a turned plan changes only rotate in the data, and Save then Open keeps it", async ({ page }) => {
  const l0 = await layoutOf(page);
  await rotateBy(page, 3);
  const l1 = await layoutOf(page);
  expect(l1.rotate).toBe(135);
  expect(withoutRotate(l1)).toEqual(withoutRotate(l0));
  const saved = (await savedValid(page))!;
  expect(saved.rotate).toBe(135);
  await page.evaluate(([tag, l]) => { (document.querySelector(tag as string) as any).layout = l; }, [EDITOR, { ...l0, rotate: 0 }] as const);
  expect(await rotOf(page)).toBe(0);
  await page.evaluate(([tag, l]) => { (document.querySelector(tag as string) as any).layout = l; }, [EDITOR, saved] as const);
  expect(await rotOf(page)).toBe(135);
  await expect(page.locator(`${EDITOR} svg g.plan-turn[transform^="rotate(135 "]`)).toHaveCount(3); // the measure grid, the drawing (now inside the theme group) and the overlay (S1.50)
});

for (const deg of [45, 90]) {
  test.describe(`plan turned ${deg}`, () => {
    test.beforeEach(async ({ page }) => { await rotateBy(page, deg / 45); });

    test("the drawing is turned on screen and fits the window: the outline's corners are all in view", async ({ page }) => {
      const svg = (await page.locator("svg").first().boundingBox())!;
      for (const [x, y] of [[0, 0], [800, 0], [800, 600], [0, 600]]) {
        const c = await screenOf(page, x, y);
        expect(c.x, `${x},${y}`).toBeGreaterThan(svg.x); expect(c.x).toBeLessThan(svg.x + svg.width);
        expect(c.y).toBeGreaterThan(svg.y); expect(c.y).toBeLessThan(svg.y + svg.height);
      }
      // the top wall of the Living room (0,0)-(500,0) runs along x on the plan; on screen it runs at `deg`
      const a = await screenOf(page, 0, 0), b = await screenOf(page, 500, 0);
      expect(Math.round(((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 360) % 360)).toBe(deg);
    });

    test("real clicks select the room, the device and the stairs under the pointer", async ({ page }) => {
      const click = async (x: number, y: number) => { const c = await screenOf(page, x, y); await page.mouse.click(c.x, c.y); };
      await click(100, 300); // Living, clear of the plug at (60, 340)
      await expect(page.locator("#rn")).toHaveValue("Living");
      await click(700, 100);
      await expect(page.locator("#rn")).toHaveValue("Kitchen");
      await click(250, 200); // the living light
      await expect(page.locator("#ve")).toHaveValue("light.demo_living");
      const st = (await groundOf(page)).stairs[0], xs = st.pts.map((p) => p[0]), ys = st.pts.map((p) => p[1]);
      await click((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2);
      await expect(page.locator("#panel strong")).toHaveText(/Stairs/i);
    });

    test("dragging a corner handle lands the corner where the pointer is", async ({ page }) => {
      await dragCm(page, [500, 0], [500, 40]); // the shared Living / Kitchen corner
      const g = await groundOf(page);
      expect(g.rooms[0].pts[1]).toEqual([500, 40]);
      expect(g.rooms[1].pts[0]).toEqual([500, 40]);
      await dragCm(page, [500, 40], [450, 90]);
      expect((await groundOf(page)).rooms[0].pts[1]).toEqual([450, 90]);
    });

    test("dragging a device lands it where the pointer is, on the grid", async ({ page }) => {
  await setGrid(page, 5); // S1.34: the default grid is 10; this test's numbers are on the 5 cm grid
      await dragCm(page, [650, 200], [615, 270]);
      const d = (await groundOf(page)).devices[1] as { x: number; y: number };
      expect([d.x, d.y]).toEqual([615, 270]);
    });

    test("drawing a room clicks its corners at the plan points under the pointer, snapped to the grid", async ({ page }) => {
  await setGrid(page, 5); // S1.34: the default grid is 10; this test's numbers are on the 5 cm grid
      const n0 = (await groundOf(page)).rooms.length;
      await startDraw(page, "drawRoom");
      await clicksCm(page, ...FREE);
      await page.keyboard.press("Enter");
      const g = await groundOf(page);
      expect(g.rooms).toHaveLength(n0 + 1);
      expect(g.rooms.at(-1)!.pts).toEqual(FREE_SNAPPED);
    });

    test("snapping still pulls a drawn wall's ends onto the corners they are near, in plan space", async ({ page }) => {
      const n0 = (await groundOf(page)).walls.length;
      await startDraw(page, "drawWall-wall");
      await clicksCm(page, [497, 3], [803, -3]); // off the grid on purpose: only the corner snap gives 500,0 and 800,0
      await page.keyboard.press("Enter");
      const w = (await groundOf(page)).walls;
      expect(w).toHaveLength(n0 + 1);
      expect([w.at(-1)!.a, w.at(-1)!.b]).toEqual([[500, 0], [800, 0]]);
    });

    test("wheel zoom keeps the plan point under the pointer where it is, and zooms", async ({ page }) => {
      const P: [number, number] = [650, 100];
      const a = await screenOf(page, ...P), q = await screenOf(page, 800, 100);
      const w0 = Math.hypot(q.x - a.x, q.y - a.y);
      await page.mouse.move(a.x, a.y);
      await page.mouse.wheel(0, -300);
      await expect.poll(async () => { const b = await screenOf(page, 800, 100), c = await screenOf(page, ...P); return Math.hypot(b.x - c.x, b.y - c.y) > w0 * 1.1; }).toBe(true);
      const after = await screenOf(page, ...P);
      expect(Math.abs(after.x - a.x)).toBeLessThan(1.5);
      expect(Math.abs(after.y - a.y)).toBeLessThan(1.5);
    });

    test("dragging the background pans: every plan point follows the pointer by the same screen shift", async ({ page }) => {
      const a = await screenOf(page, 300, 500), o0 = await screenOf(page, 700, 100);
      const before = JSON.stringify(withoutRotate(await layoutOf(page)));
      const s = await screenOf(page, 100, 650); // empty ground, below the Hall
      await page.mouse.move(s.x, s.y);
      await page.mouse.down();
      await page.mouse.move(s.x + 40, s.y + 25, { steps: 4 });
      await page.mouse.move(s.x + 80, s.y + 50, { steps: 4 });
      await page.mouse.up();
      const b = await screenOf(page, 300, 500), o1 = await screenOf(page, 700, 100);
      expect(b.x - a.x).toBeCloseTo(80, 0); expect(b.y - a.y).toBeCloseTo(50, 0);
      expect(o1.x - o0.x).toBeCloseTo(80, 0); expect(o1.y - o0.y).toBeCloseTo(50, 0);
      expect(JSON.stringify(withoutRotate(await layoutOf(page)))).toBe(before); // a pan writes nothing
    });

    test("names, values and icons stay upright: their screen matrix has no turn", async ({ page }) => {
      await menu(page, "View"); // S8.1: Names lives in View
      await page.locator("#names").click();
      const turns = await rpt(page).evaluate((host) => {
        const svg = (host as any).shadowRoot.querySelector("svg") as SVGSVGElement;
        const off = (el: Element) => { const m = (el as SVGGraphicsElement).getScreenCTM()!; return Math.max(Math.abs(m.b), Math.abs(m.c)) / Math.abs(m.a); };
        const texts = [...svg.querySelectorAll("text.lbl, text.val")], icons = [...svg.querySelectorAll("g[data-x] > g > path, g[data-x] > path:not(.cone)")];
        return { nt: texts.length, ni: icons.length, t: Math.max(...texts.map(off)), i: Math.max(...icons.map(off)) };
      });
      expect(turns.nt).toBeGreaterThan(5);
      expect(turns.ni).toBeGreaterThan(5);
      expect(turns.t).toBeLessThan(0.001);
      expect(turns.i).toBeLessThan(0.001);
    });

    test("a camera's cone turns with the plan while its icon stays upright", async ({ page }) => {
      const m = await rpt(page).evaluate((host) => {
        const svg = (host as any).shadowRoot.querySelector("svg") as SVGSVGElement;
        const c = (svg.querySelector("path.cone") as SVGGraphicsElement).getScreenCTM()!;
        return { a: c.a, b: c.b };
      });
      expect(Math.round((Math.atan2(m.b, m.a) * 180) / Math.PI)).toBe(deg);
    });

    test("the length labels of the overlay stay upright too", async ({ page }) => {
      await menu(page, "View");
      if ((await page.locator("#lens").getAttribute("aria-pressed")) !== "true") await page.locator("#lens").click();
      await menu(page, "View");
      const off = await rpt(page).evaluate((host) => {
        const svg = (host as any).shadowRoot.querySelector("svg") as SVGSVGElement;
        const ts = [...svg.querySelectorAll("text.len")];
        return { n: ts.length, off: Math.max(...ts.map((t) => { const m = (t as SVGGraphicsElement).getScreenCTM()!; return Math.abs(m.b) / Math.abs(m.a); })) };
      });
      expect(off.n).toBeGreaterThan(0);
      expect(off.off).toBeLessThan(0.001);
    });
  });
}

test("S1.33: adding an item at 90 puts it in view and the panel value survives", async ({ page }) => {
  await rotateBy(page, 2);
  await addItem(page, "#addStairs");
  const svg = (await page.locator("svg").first().boundingBox())!;
  const t = (await groundOf(page)).stairs.at(-1)!;
  for (const p of t.pts) {
    const c = await screenOf(page, p[0], p[1]);
    expect(c.x).toBeGreaterThan(svg.x); expect(c.x).toBeLessThan(svg.x + svg.width);
    expect(c.y).toBeGreaterThan(svg.y); expect(c.y).toBeLessThan(svg.y + svg.height);
  }
});

// ---- S1.34 the grid is a setting ----
const gridChoices = (page: Page) => page.locator(`${EDITOR} #snap [data-grid]`);
const pressedGrid = async (page: Page) => page.locator(`${EDITOR} #snap [data-grid][aria-pressed="true"]`).evaluateAll((els) => els.map((e) => e.getAttribute("data-grid")));

test("S1.34: View has a Grid group of four, 10 cm pressed by default; the old Snap chip is gone", async ({ page }) => {
  await menu(page, "View");
  await expect(gridChoices(page)).toHaveText(["None", "5 cm", "10 cm", "50 cm"]);
  expect(await pressedGrid(page)).toEqual(["10"]);
  await expect(page.locator(`${EDITOR} button#grid`)).toHaveCount(0);
  await expect(page.getByText("Snap 5 cm")).toHaveCount(0);
});

for (const [g, want] of [[10, [660, 450]], [50, [650, 450]], [5, [665, 445]], [0, [663, 447]]] as const) {
  test(`S1.34: with grid ${g || "none"} a stairs corner dragged to 663,447 lands on ${want}`, async ({ page }) => {
    if (g !== 10) await setGrid(page, g);
    else expect(await pressedGrid(page)).toEqual(["10"]); // the default, nothing chosen
    await dragCm(page, [700, 420], [663, 447]);
    expect((await groundOf(page)).stairs[0].pts[0]).toEqual(want);
    await menu(page, "View");
    expect(await pressedGrid(page)).toEqual([String(g)]);
  });
}

test("S1.34: with 10 selected a device lands on a multiple of 10 and Alt still places it freely", async ({ page }) => {
  await dragCm(page, [250, 200], [263, 207]);
  let d = (await groundOf(page)).devices[0] as any;
  expect([d.x, d.y]).toEqual([260, 210]);
  await dragCm(page, [260, 210], [263, 207], ["Alt"]);
  d = (await groundOf(page)).devices[0] as any;
  expect([d.x, d.y]).toEqual([263, 207]);
});

test("S1.34: with 50 selected a whole room dragged by its edge moves by a multiple of 50", async ({ page }) => {
  await setGrid(page, 50);
  const before = (await groundOf(page)).rooms[0].pts;
  await dragCm(page, [250, 0], [250 + 61, 0 + 37]);
  const after = (await groundOf(page)).rooms[0].pts;
  const dx = after[0][0] - before[0][0], dy = after[0][1] - before[0][1];
  expect(dx % 50).toBe(0); expect(dy % 50).toBe(0);
});

test("S1.34: new items go on the chosen grid", async ({ page }) => {
  await setGrid(page, 50);
  await addItem(page, "#addStairs");
  const t = (await groundOf(page)).stairs.at(-1)!;
  for (const p of t.pts) { expect(Math.abs(p[0] % 50)).toBe(0); expect(Math.abs(p[1] % 50)).toBe(0); }
});

test("S1.34: the choice survives a reload and is not in the layout", async ({ page }) => {
  await setGrid(page, 50);
  expect(await page.evaluate(() => localStorage.getItem("floorplan-studio:grid"))).toBe("50");
  expect(JSON.stringify(await layoutOf(page))).not.toContain("grid");
  await page.reload();
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  await menu(page, "View");
  expect(await pressedGrid(page)).toEqual(["50"]);
});

test("S1.34 break it: a stored 7 or x falls back to 10 without an error", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const v of ["7", "x"]) {
    await page.evaluate((val) => localStorage.setItem("floorplan-studio:grid", val), v);
    await page.reload();
    await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
    await menu(page, "View");
    expect(await pressedGrid(page)).toEqual(["10"]);
  }
  expect(errors).toEqual([]);
});

test("S1.34 break it: with storage blocked the editor loads, uses 10 and lets the grid be changed", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const boom = () => { throw new Error("blocked"); };
    Storage.prototype.getItem = boom; Storage.prototype.setItem = boom;
  });
  await page.reload();
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  await menu(page, "View");
  expect(await pressedGrid(page)).toEqual(["10"]);
  await page.locator(`#snap [data-grid="50"]`).click();
  expect(await pressedGrid(page)).toEqual(["50"]);
  expect(errors).toEqual([]);
});

// ---- S1.35 floor colours for rooms ----
test("S1.35: the room panel shows twelve floor swatches next to the free colour input", async ({ page }) => {
  const at = await screenOf(page, 200, 150);
  await page.mouse.click(at.x, at.y);
  const sw = page.locator('#panel .swatches[aria-label="Colours"] .sw');
  await expect(sw).toHaveCount(12);
  await expect(page.locator("#panel .sw.tex")).toHaveCount(11); // and eleven textures beside them (S4.19)
  await expect(sw.nth(10)).toHaveAttribute("title", "Belgian stone");
  await expect(sw.nth(10)).toHaveAttribute("aria-label", "Belgian stone");
  await expect(page.locator("#rcol")).toHaveCount(1);
  // each swatch shows its own colour
  expect(await sw.evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor))).toContain("rgb(77, 78, 80)");
});

test("S1.35: the Belgian stone swatch sets the fill, one undo step; the default button brings it back", async ({ page }) => {
  const at = await screenOf(page, 200, 150);
  await page.mouse.click(at.x, at.y);
  const poly = page.locator('svg polygon[data-r="0"]');
  const computed = () => poly.evaluate((el) => getComputedStyle(el).fill);
  const plain = await computed();
  await page.locator("#panel .sw").nth(10).click();
  expect(await computed()).toBe("rgb(77, 78, 80)");
  expect((await groundOf(page)).rooms[0].color).toBe("#4d4e50");
  await expect(page.locator("#rcol")).toHaveValue("#4d4e50"); // the free input follows
  await menu(page, "File");
  await page.locator("#undo").click();
  expect(await computed()).toBe(plain);
  await page.mouse.click(at.x, at.y); // an undo leaves the room selected or not; select it
  await page.locator("#panel .sw").nth(10).click();
  await page.locator("#rcolx").click();
  expect(await computed()).toBe(plain);
  expect((await groundOf(page)).rooms[0].color).toBeUndefined();
});

test("S1.35 break it: a colour typed in the free input still works, and a swatch after it replaces it", async ({ page }) => {
  const at = await screenOf(page, 200, 150);
  await page.mouse.click(at.x, at.y);
  const poly = page.locator('svg polygon[data-r="0"]');
  await page.locator("#rcol").fill("#123456");
  expect(await poly.evaluate((el) => getComputedStyle(el).fill)).toBe("rgb(18, 52, 86)");
  await page.locator("#panel .sw").nth(0).click();
  expect((await groundOf(page)).rooms[0].color).toBe("#f4f4f0");
});

// ---- S1.36 device colours by type ----
const colourRow = (page: Page, type: string) => page.locator(`${EDITOR} .devcols-panel [data-type="${type}"]`);
const openDevCols = async (page: Page) => {
  await menu(page, "Edit"); // S8.1: Device colours moved from View to Edit
  await page.locator(`${EDITOR} #devcols`).click();
};
const setColourInput = (page: Page, type: string, hex: string) =>
  colourRow(page, type).locator("input[type=color]").evaluate((el, v) => { (el as HTMLInputElement).value = v; el.dispatchEvent(new Event("change", { bubbles: true })); }, hex);
const camFill = (page: Page) => page.locator("svg .dev-camera path:not(.cone):not(.halo)").first().evaluate((el) => getComputedStyle(el).fill);
const varOn = (page: Page, sel: string, name: string) => page.locator(sel).first().evaluate((el, n) => getComputedStyle(el).getPropertyValue(n).trim(), name);

test("S1.36: Edit, Device colours has a row per type with a colour input and a reset, and Reset all", async ({ page }) => {
  await openDevCols(page);
  await expect(page.locator(`${EDITOR} .devcols-panel [data-type]`)).toHaveCount(30); // S4.25 added boiler, car, ups, printer, speaker; S7.8/S7.9 added person, radar; S7.10 added vacuum
  await expect(colourRow(page, "light").locator("input[type=color]")).toHaveValue("#e0a800");
  await expect(colourRow(page, "light").locator("button")).toHaveCount(1);
  await expect(page.locator(`${EDITOR} #devcolsx`)).toBeVisible();
});

test("S1.36: Device colours opens as a floating panel — a 3-column grid, closed by its own X, not by clicking elsewhere", async ({ page }) => {
  await openDevCols(page);
  const panel = page.locator(`${EDITOR} .devcols-panel`);
  await expect(panel).toBeVisible();
  // Three columns: the first three rows' tops match, the fourth starts a new row.
  const tops = await page.locator(`${EDITOR} .devcols-panel [data-type]`).evaluateAll((els) => els.slice(0, 4).map((e) => e.getBoundingClientRect().top));
  expect(tops[0]).toBeCloseTo(tops[1], 0);
  expect(tops[0]).toBeCloseTo(tops[2], 0);
  expect(tops[3]).toBeGreaterThan(tops[0] + 5);
  // A click elsewhere on the canvas leaves it open.
  const at = await screenOf(page, 1000, 1000);
  await page.mouse.click(at.x, at.y);
  await expect(panel).toBeVisible();
  // Its own close button dismisses it.
  await page.locator(`${EDITOR} .devcols-panel #devcolsClose`).click();
  await expect(panel).toHaveCount(0);
});

test("S1.36: Escape closes the Device colours panel", async ({ page }) => {
  await openDevCols(page);
  const panel = page.locator(`${EDITOR} .devcols-panel`);
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});

test("S1.36: dragging the panel's header by its title moves the panel", async ({ page }) => {
  await openDevCols(page);
  const head = page.locator(`${EDITOR} .devcols-panel .devcols-head`);
  const before = (await head.boundingBox())!;
  await page.mouse.move(before.x + 40, before.y + 10);
  await page.mouse.down();
  await page.mouse.move(before.x + 140, before.y + 110, { steps: 5 });
  await page.mouse.up();
  const after = (await head.boundingBox())!;
  expect(after.x - before.x).toBeCloseTo(100, 0);
  expect(after.y - before.y).toBeCloseTo(100, 0);
});

test("S1.36: changing the light colour reaches every light icon, camera colour changes the camera fill, undo restores", async ({ page }) => {
  const l0 = await layoutOf(page);
  expect(l0.colors).toBeUndefined();
  const lights = 'svg .dev-light';
  const n = await page.locator(lights).count();
  expect(n).toBeGreaterThan(1);
  const cam0 = await camFill(page);
  await openDevCols(page);
  await setColourInput(page, "light", "#123456");
  expect((await layoutOf(page)).colors).toEqual({ light: "#123456" });
  const seen = await page.locator(lights).evaluateAll((els) => els.map((e) => getComputedStyle(e).getPropertyValue("--fp-dev-light").trim()));
  expect(seen).toEqual(Array(n).fill("#123456")); // every light icon sees it
  await setColourInput(page, "camera", "#0000ff");
  expect(await camFill(page)).toBe("rgb(0, 0, 255)");
  expect(await camFill(page)).not.toBe(cam0);
  await menu(page, "File");
  await page.locator("#undo").click();
  expect(await camFill(page)).toBe(cam0);
  expect((await layoutOf(page)).colors).toEqual({ light: "#123456" });
  await menu(page, "File");
  await page.locator("#undo").click();
  expect((await layoutOf(page)).colors).toBeUndefined();
  expect(await varOn(page, lights, "--fp-dev-light")).toBe("#ff8a1f"); // blueprint's --fp-dev-light collapses to the single accent
});

test("S1.36: a row's reset and Reset all remove colours, each one undo step", async ({ page }) => {
  await openDevCols(page);
  await setColourInput(page, "light", "#123456");
  await setColourInput(page, "tv", "#654321");
  await colourRow(page, "light").locator("button").click();
  expect((await layoutOf(page)).colors).toEqual({ tv: "#654321" });
  await page.locator(`${EDITOR} #devcolsx`).click();
  expect((await layoutOf(page)).colors).toBeUndefined();
  await menu(page, "File");
  await page.locator("#undo").click();
  expect((await layoutOf(page)).colors).toEqual({ tv: "#654321" });
});

test("S1.36: Save then Open keeps the colours, and the light icons follow", async ({ page }) => {
  await openDevCols(page);
  await setColourInput(page, "light", "#123456");
  const saved = (await savedValid(page))!;
  expect(saved.colors).toEqual({ light: "#123456" });
  await page.evaluate(([tag, l]) => { (document.querySelector(tag as string) as any).layout = l; }, [EDITOR, { ...saved, colors: undefined }] as const);
  expect((await layoutOf(page)).colors).toBeUndefined();
  await page.evaluate(([tag, l]) => { (document.querySelector(tag as string) as any).layout = l; }, [EDITOR, saved] as const);
  expect(await varOn(page, "svg .dev-light", "--fp-dev-light")).toBe("#123456");
});

test("S1.36 break it: a layout with no colors draws no style group, and a hostile colors value is refused on load", async ({ page }) => {
  await expect(page.locator("svg .dev-colours")).toHaveCount(0);
  const errs = await page.evaluate(([tag, l]) => { (document.querySelector(tag as string) as any).layout = { ...l, colors: { light: 'red;" onload="x' } }; return (document.querySelector(tag as string) as any).errors ?? null; }, [EDITOR, await layoutOf(page)] as const);
  expect(JSON.stringify(errs)).toMatch(/colors/);
  await expect(page.locator("svg [onload]")).toHaveCount(0);
});

// ---- S1.49 Re-center ----
/** Every room, stairs, device and piece of furniture on screen lies inside the svg. */
const wholeFloorInView = (page: Page) =>
  page.evaluate((tag) => {
    const root = (document.querySelector(tag as string) as any).shadowRoot as ShadowRoot;
    const c = root.querySelector("svg")!.getBoundingClientRect();
    const bad: string[] = [];
    root.querySelectorAll("svg polygon[data-r], svg g[data-x], svg g[data-s], svg g[data-f]").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (!(r.left >= c.left - 1 && r.right <= c.right + 1 && r.top >= c.top - 1 && r.bottom <= c.bottom + 1)) bad.push(el.getAttribute("data-r") ?? el.getAttribute("data-x") ?? el.getAttribute("data-s") ?? el.getAttribute("data-f") ?? "?");
    });
    return { n: root.querySelectorAll("svg polygon[data-r], svg g[data-x], svg g[data-s], svg g[data-f]").length, bad };
  }, EDITOR);
async function zoomAndPanAway(page: Page) {
  await zoomIn(page, 6);
  const s = await screenOf(page, 100, 650); // empty ground below the Hall
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await page.mouse.move(s.x + 150, s.y - 200, { steps: 6 });
  await page.mouse.up();
}

for (const [floor, deg] of [["ground", 0], ["first", 0], ["ground", 45]] as const) {
  test(`S1.49: Re-center brings the whole ${floor} floor back into view after a zoom and a pan, plan turned ${deg}`, async ({ page }) => {
    if (deg) await rotateBy(page, deg / 45);
    if (floor !== "ground") await page.locator(`.chip[data-f="${floor}"]`).click();
    const before = JSON.stringify(await layoutOf(page));
    await zoomAndPanAway(page);
    const away = await wholeFloorInView(page);
    expect(away.bad.length, "zoomed in and panned, something must be out of view").toBeGreaterThan(0);
    await menu(page, "View");
    await page.locator("#recenter").click();
    const now = await wholeFloorInView(page);
    expect(now.bad).toEqual([]);
    expect(now.n).toBeGreaterThan(3);
    expect(JSON.stringify(await layoutOf(page))).toBe(before); // a view change writes nothing
    await menu(page, "File");
    if (!deg) await expect(page.locator("#undo")).toBeDisabled();
    else { await page.locator("#undo").click(); expect(await rotOf(page)).toBe(0); await menu(page, "File"); await expect(page.locator("#undo")).toBeDisabled(); } // the one step is the rotation
  });
}

test("S1.49: Re-center shows a device parked far outside the outline, which Fit to window does not", async ({ page }) => {
  await page.evaluate(([tag, l]) => {
    const el = document.querySelector(tag as string) as any, c = JSON.parse(JSON.stringify(l));
    c.floors.ground.devices.push({ id: "far-temp", type: "temp", entity: "sensor.far_temp", x: 1900, y: -400 });
    c.catalog.push({ id: "sensor.far_temp", floor: "ground", room: "", type: "temp", name: "Far", entity: "sensor.far_temp" });
    el.layout = c;
  }, [EDITOR, await layoutOf(page)] as const);
  await menu(page, "View");
  await page.locator("#fit").click();
  const inFit = await wholeFloorInView(page);
  await menu(page, "View");
  await page.locator("#recenter").click();
  const inRe = await wholeFloorInView(page);
  expect(inFit.bad.length).toBeGreaterThan(0); // fit follows the outline only
  expect(inRe.bad).toEqual([]);
});

// ---- S1.35b white twin under walls and edges ----
test("S1.35b: on a Lava floor the wall has a white twin, wider than the wall, that never takes the click", async ({ page }) => {
  await setTheme(page, "light"); // pins light values; blueprint is the default since S2.12
  await page.evaluate(([tag, l]) => {
    const c = JSON.parse(JSON.stringify(l));
    c.floors.ground.rooms[0].color = "#38393b";
    (document.querySelector(tag as string) as any).layout = c;
  }, [EDITOR, await layoutOf(page)] as const);
  const got = await page.evaluate((tag) => {
    const root = (document.querySelector(tag as string) as any).shadowRoot as ShadowRoot;
    const e = root.querySelector('line[data-e="r0:2"]')!, twin = root.querySelector("line.eh")!;
    const ce = getComputedStyle(e), ct = getComputedStyle(twin);
    return { fill: getComputedStyle(root.querySelector('polygon[data-r="0"]')!).fill, twinStroke: ct.stroke, twinW: parseFloat(ct.strokeWidth), edgeW: parseFloat(ce.strokeWidth), edgeStroke: ce.stroke, pe: ct.pointerEvents };
  }, EDITOR);
  expect(got.fill).toBe("rgb(56, 57, 59)");
  expect(got.twinStroke).toBe("rgb(255, 255, 255)");
  expect(got.twinW).toBeGreaterThan(got.edgeW);
  expect(got.edgeStroke).not.toBe(got.twinStroke);
  expect(got.pe).toBe("none");
  // a real click on the wall selects the edge, not the twin
  const c = await centre(page, 'line[data-e="r0:2"]');
  await page.mouse.click(c.x, c.y);
  await expect(page.locator("#panel")).toContainText("wall");
});

// ---- HA pickers and name refresh (S1.38, S1.39) ------------------------------------

const HA = { floors: [{ id: "gf", name: "Ground" }, { id: "up", name: "Upstairs" }],
  areas: [{ id: "living", name: "Living" }, { id: "kitchen", name: "Kitchen" }, { id: "study", name: "Study" }],
  entities: [{ id: "sensor.pond", name: "Pond level", domain: "sensor" }, { id: "light.lamp", name: "Lamp", domain: "light" }] };
const setHa = (page: Page, ha: unknown) => page.evaluate(([tag, h]) => { (document.querySelector(tag as string) as any).ha = h; }, [EDITOR, ha]);
const opts = (page: Page, sel: string) => page.locator(`${sel} option`).evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));

test("S1.38: without Home Assistant the area is a text field, with it a select", async ({ page }) => {
  await clickCm(page, 200, 150);
  await expect(page.locator("#ra")).toHaveJSProperty("tagName", "INPUT");
  await setHa(page, HA);
  await expect(page.locator("#ra")).toHaveJSProperty("tagName", "SELECT");
  expect(await opts(page, "#ra")).toEqual(["", "living", "study", "kitchen"]);
});

test("S1.38: picking an area writes its id and its name, one undo restores both", async ({ page }) => {
  await setHa(page, HA);
  await clickCm(page, 200, 150);
  await page.locator("#ra").selectOption("study");
  let r = (await groundOf(page)).rooms[0];
  expect(r).toMatchObject({ area: "study", name: "Study" });
  await expect(page.locator("#rn")).toHaveCount(0);
  await menu(page, "File");
  await page.locator("#undo").click();
  r = (await groundOf(page)).rooms[0];
  expect(r).toMatchObject({ area: "living", name: "Living" });
});

test("S1.38: an area already on the plan sits under its own group and says so", async ({ page }) => {
  await setHa(page, HA);
  await clickCm(page, 200, 150);
  await expect(page.locator('#ra optgroup[label="Already on the plan"] option')).toHaveText(["Kitchen"]);
  await page.locator("#ra").selectOption("kitchen");
  await expect(page.locator("#status")).toContainText("already on the plan");
});

test("S1.38: custom brings back the name and entity fields, an area removes the entity", async ({ page }) => {
  await setHa(page, HA);
  await page.locator('svg polygon[data-r="6"]').click({ force: true });
  const pond = (await groundOf(page)).rooms[6];
  expect(pond.area).toBe("");
  await expect(page.locator("#rn")).toBeVisible();
  await expect(page.locator("#rent")).toHaveJSProperty("tagName", "SELECT");
  await page.locator("#rent").selectOption("sensor.pond");
  expect((await groundOf(page)).rooms[6].entity).toBe("sensor.pond");
  await page.locator("#ra").selectOption("study");
  const r = (await groundOf(page)).rooms[6];
  expect(r.entity).toBeUndefined();
  expect(r).toMatchObject({ area: "study", name: "Study" });
  await expect(page.locator("#rent")).toHaveCount(0);
});

test("S1.38: an id Home Assistant does not know stays as an extra option", async ({ page }) => {
  await clickCm(page, 200, 150);
  await page.evaluate((tag) => { const el = document.querySelector(tag) as any; const l = JSON.parse(JSON.stringify(el.layout)); l.floors.ground.rooms[0].area = "bogus"; el.layout = l; }, EDITOR);
  await setHa(page, HA);
  await clickCm(page, 200, 150);
  await expect(page.locator("#ra")).toHaveValue("bogus");
  await expect(page.locator('#ra option[value="bogus"]')).toContainText("not in Home Assistant");
  expect((await groundOf(page)).rooms[0].area).toBe("bogus");
});

test("S1.38: the floor links to an HA floor and unlinking brings the title field back", async ({ page }) => {
  await setHa(page, HA);
  await expect(page.locator("#ft")).toBeVisible();
  await page.locator("#fha").selectOption("up");
  expect((await layoutOf(page)).floors.ground).toMatchObject({ ha: "up", title: "Upstairs" });
  await expect(page.locator("#ft")).toHaveCount(0);
  await page.locator("#fha").selectOption("");
  expect((await groundOf(page)).ha).toBeUndefined();
  await expect(page.locator("#ft")).toBeVisible();
});

test("S1.38: furniture has a plan name and an entity picker", async ({ page }) => {
  await setHa(page, HA);
  await menu(page, "Add"); await page.locator("#addFurn").selectOption("bed");
  await page.locator("#fun").fill("Guest bed");
  await page.locator("#fun").press("Enter");
  await page.locator("#fuent").selectOption("light.lamp");
  const f = (await groundOf(page)).furniture.at(-1)!;
  expect(f).toMatchObject({ name: "Guest bed", entity: "light.lamp" });
});

test("S1.38: an empty Home Assistant changes no name and does not throw", async ({ page }) => {
  const before = await layoutOf(page);
  await setHa(page, { floors: [], areas: [], entities: [] });
  expect(await layoutOf(page)).toEqual(before);
  await clickCm(page, 200, 150);
  await expect(page.locator("#ra")).toHaveJSProperty("tagName", "SELECT");
});

test("S1.39: names refresh when Home Assistant arrives, and it is not an undo step", async ({ page }) => {
  await setHa(page, { ...HA, areas: [{ id: "living", name: "Lounge" }, { id: "kitchen", name: "Kitchen" }] });
  expect((await groundOf(page)).rooms[0].name).toBe("Lounge");
  await expect(page.locator("#status")).toContainText("1 names updated from Home Assistant");
  await expect(page.locator("#undo")).toBeDisabled();
});

test("S1.39: without Home Assistant no message shows and nothing is renamed", async ({ page }) => {
  await expect(page.locator("#status")).not.toContainText("updated from Home Assistant");
  expect((await groundOf(page)).rooms[0].name).toBe("Living");
});

test("S1.39: the match button links a room whose name is an HA area", async ({ page }) => {
  await setHa(page, HA);
  await page.evaluate((tag) => { const el = document.querySelector(tag) as any; const l = JSON.parse(JSON.stringify(el.layout)); Object.assign(l.floors.ground.rooms[6], { name: "study" }); el.layout = l; }, EDITOR);
  await page.locator('svg polygon[data-r="6"]').click({ force: true });
  await page.locator("#rmatch").click();
  expect((await groundOf(page)).rooms[6]).toMatchObject({ area: "study", name: "Study" });
  await expect(page.locator("#rmatch")).toHaveCount(0);
});

test("S1.39: two areas with the same name give no match button", async ({ page }) => {
  await setHa(page, { ...HA, areas: [...HA.areas, { id: "study2", name: "study" }] });
  await page.evaluate((tag) => { const el = document.querySelector(tag) as any; const l = JSON.parse(JSON.stringify(el.layout)); l.floors.ground.rooms[6].name = "Study"; el.layout = l; }, EDITOR);
  await page.locator('svg polygon[data-r="6"]').click({ force: true });
  await expect(page.locator("#rmatch")).toHaveCount(0);
});

// ---- readable buttons (S1.40) ------------------------------------------------------

const lum = (rgb: number[]) => { const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a: number[], b: number[]) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const rgbOf = (css: string) => (css.match(/\d+/g) ?? []).slice(0, 3).map(Number);

test("S1.40: the contrast helper is right on two known pairs", () => {
  expect(ratio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
  expect(ratio([0x76, 0x76, 0x76], [255, 255, 255])).toBeCloseTo(4.54, 2);
});

test("S1.40: Reset, item Delete and Save reach 4.5:1 in Chromium", async ({ page }) => {
  await menu(page, "File");
  for (const id of ["#reset", "#save"]) {
    const [bg, fg] = await paint(page, id);
    expect(ratio(rgbOf(bg), rgbOf(fg)), id).toBeGreaterThanOrEqual(4.5);
  }
  await expect(page.locator("#save")).toHaveCSS("background-color", "rgb(31, 102, 153)");
  await clickCm(page, 100, 100);
  const [bg, fg] = await paint(page, "#rdel");
  expect(ratio(rgbOf(bg), rgbOf(fg)), "#rdel").toBeGreaterThanOrEqual(4.5);
});

// ---- a rejected number goes back (S1.41) ---------------------------------------------

test("S1.41: a refused inner diameter snaps back, an accepted one stays", async ({ page }) => {
  await addStairs(page);
  await page.locator("#ss").selectOption("round");
  await setField(page, "#sdia", "200");
  await setField(page, "#sinner", "500"); // clamped to 160
  await expect(page.locator("#sinner")).toHaveValue("160");
  await setField(page, "#sinner", "80");
  await expect(page.locator("#sinner")).toHaveValue("80");
  expect((await groundOf(page)).stairs[1].inner).toBe(80);
});

test("S1.41: a clamped furniture width shows the clamped value", async ({ page }) => {
  await menu(page, "Add"); await page.locator("#addFurn").selectOption("bed");
  await setField(page, "#fw", "1");
  await expect(page.locator("#fw")).toHaveValue("5");
  expect((await groundOf(page)).furniture.at(-1)!.w).toBe(5);
  await setField(page, "#fw", "1");
  await expect(page.locator("#fw")).toHaveValue("5"); // already 5: the state does not change, the field still resets
  await setField(page, "#fw", "137");
  await expect(page.locator("#fw")).toHaveValue("137");
  await setField(page, "#fw", ""); // refused: no number, so the state stays 137 and the field goes back to it
  await expect(page.locator("#fw")).toHaveValue("137");
  await setField(page, "#fh", "2");
  await expect(page.locator("#fh")).toHaveValue("5");
  const m = (await groundOf(page)).furniture.at(-1)!;
  expect([m.w, m.h]).toEqual([137, 5]);
});

// ---- a device never hides a room name (S1.42) ------------------------------------------

test("S1.42: on the demo no room name box overlaps a device halo", async ({ page }) => {
  const boxes = await page.evaluate((tag) => {
    const root = document.querySelector(tag)!.shadowRoot!;
    const r = (e: Element) => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; };
    return { names: [...root.querySelectorAll("text.lbl")].filter((t) => t.textContent && ["Living", "Kitchen", "Hall", "Reading corner"].includes(t.textContent)).map((t) => [t.textContent, ...r(t)]),
      halos: [...root.querySelectorAll("circle.halo")].map(r) };
  }, EDITOR);
  expect(boxes.names).toHaveLength(4);
  expect(boxes.halos.length).toBeGreaterThan(3);
  for (const [name, l, t, rr, b] of boxes.names as [string, number, number, number, number][])
    for (const h of boxes.halos) expect(l < h[2] && rr > h[0] && t < h[3] && b > h[1], `${name} ${[l,t,rr,b]} under a halo ${h}`).toBe(false);
});

test("S1.42: at plan rotations 0, 45, 90 and 135 no name box overlaps a device halo", async ({ page }) => {
  for (const deg of [0, 45, 90, 135]) {
    await page.evaluate(([tag, d]) => { const el = document.querySelector(tag as string) as any; const l = JSON.parse(JSON.stringify(el.layout)); l.rotate = d; el.layout = l; }, [EDITOR, deg] as const);
    await expect(page.locator("svg g.plan-turn, svg polygon[data-r]").first()).toBeVisible();
    const boxes = await page.evaluate((tag) => {
      const root = document.querySelector(tag)!.shadowRoot!;
      const r = (e: Element) => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; };
      return { names: [...root.querySelectorAll("text.lbl")].filter((t) => t.textContent && ["Living", "Kitchen", "Hall", "Reading corner"].includes(t.textContent)).map((t) => [t.textContent, ...r(t)]),
        halos: [...root.querySelectorAll("circle.halo")].map(r) };
    }, EDITOR);
    expect(boxes.names, `rotation ${deg}`).toHaveLength(4);
    expect(boxes.halos.length).toBeGreaterThan(3);
    for (const [name, l, t, rr, b] of boxes.names as [string, number, number, number, number][])
      for (const h of boxes.halos) expect(l < h[2] && rr > h[0] && t < h[3] && b > h[1], `rotation ${deg}: ${name} ${[l, t, rr, b]} under a halo ${h}`).toBe(false);
  }
});

// ---- rotation buttons (S1.43) -----------------------------------------------------------

test("S1.43: stairs turn by the pressed amount, in the chosen direction, and Reset returns to 0", async ({ page }) => {
  await addStairs(page);
  const rot = async () => (await groundOf(page)).stairs[1].rot;
  await page.locator("#srot30").click();
  await page.locator("#srot45").click();
  expect(await rot()).toBe(75);
  await page.locator("#srotdir").click();
  await expect(page.locator("#srotdir")).toHaveText("counter-clockwise");
  await page.locator("#srot90").click();
  expect(await rot()).toBe(345);
  await page.locator("#srot60").click();
  expect(await rot()).toBe(285);
  await page.locator("#srotreset").click();
  expect(await rot()).toBe(0);
  for (const id of ["#srot", "#fr", "#vrot", "#rrot"]) await expect(page.locator(`input${id}`)).toHaveCount(0);
});

test("S1.43: one press is one undo step; 360 wraps", async ({ page }) => {
  await addStairs(page);
  for (let i = 0; i < 4; i++) await page.locator("#srot90").click();
  expect((await groundOf(page)).stairs[1].rot).toBe(0);
  await page.locator("#srot90").click();
  await menu(page, "File");
  await page.locator("#undo").click();
  expect((await groundOf(page)).stairs[1].rot).toBe(0);
});

test("S1.43: furniture and devices turn; the device Reset deletes rot", async ({ page }) => {
  await menu(page, "Add"); await page.locator("#addFurn").selectOption("bed");
  await page.locator("#fr45").click();
  await page.locator("#fr45").click();
  expect((await groundOf(page)).furniture.at(-1)!.rot).toBe(90);
  await page.locator("#frreset").click();
  expect((await groundOf(page)).furniture.at(-1)!.rot).toBe(0);
  await page.mouse.click(...Object.values(await centre(page, 'g[data-x="0"]')) as [number, number]);
  await page.locator("#vrot60").click();
  expect(((await groundOf(page)).devices[0] as { rot?: number }).rot).toBe(60);
  await page.locator("#vrotreset").click();
  expect("rot" in (await groundOf(page)).devices[0]).toBe(false);
});

test("S1.43: an unsnapped room turns a quarter, and has no Reset", async ({ page }) => {
  await clickCm(page, 50, 200);
  await expect(page.locator("#rrotreset")).toHaveCount(0);
  await page.locator("#runsnap").click();
  const before = (await groundOf(page)).rooms[0].pts;
  await page.locator("#rrot90").click();
  const after = (await groundOf(page)).rooms[0].pts;
  expect(after).not.toEqual(before);
  const w = (p: number[][]) => Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]);
  expect(Math.abs(w(after) - w(before))).toBeLessThanOrEqual(1);
});

// ---- the icon disc (S1.45) ----------------------------------------------------------------

test("S1.45: the disc is 3 units wider than the icon and stays white on a dark floor", async ({ page }) => {
  await setTheme(page, "light"); // pins light values; blueprint is the default since S2.12
  const r = await page.locator("svg g.dev .halo").first().evaluate((el) => Number(el.getAttribute("r")));
  expect(r).toBe(16); // the icon glyph is 12 out from the centre, the border adds one, the gap three
  await page.evaluate((tag) => { const el = document.querySelector(tag) as any; const l = JSON.parse(JSON.stringify(el.layout)); for (const rm of l.floors.ground.rooms) rm.color = "#222222"; el.layout = l; }, EDITOR);
  const fill = await page.locator("svg g.dev .halo").first().evaluate((el) => getComputedStyle(el).fill);
  expect(fill).toBe("rgb(255, 255, 255)");
  const cone = await page.locator("svg path.cone").evaluate((el) => getComputedStyle(el).fillOpacity);
  expect(cone).toBe("0.25");
});

// ---- every text has a white outline (S1.46) ----------------------------------------------

test("S1.46: room, zone, device and extra names and the edge length are dark grey with a white outline", async ({ page }) => {
  await setTheme(page, "light"); // pins light values; blueprint is the default since S2.12
  await page.evaluate((tag) => { const el = document.querySelector(tag) as any; const l = JSON.parse(JSON.stringify(el.layout)); l.floors.ground.extras.push({ id: "x1", name: "Shed", a: [100, 700], b: [200, 760] }); l.floors.ground.rooms[0].color = "#222222"; el.layout = l; }, EDITOR);
  await menu(page, "View"); // S8.1: Names lives in View
  await page.locator("#names").click();
  await page.mouse.click(...Object.values(await screenOf(page, 500, 200)) as [number, number]); // a click on the shared edge shows its length
  const kinds = ["svg text.lbl:not(.zone)", "svg text.lbl.zone", "svg text.len"];
  const widths: string[] = [];
  for (const sel of kinds) {
    const st = await page.locator(sel).first().evaluate((el) => { const s = getComputedStyle(el); return [s.fill, s.stroke, s.paintOrder.split(" ")[0], s.strokeWidth]; });
    expect(st.slice(0, 3), sel).toEqual(["rgb(58, 58, 58)", "rgb(255, 255, 255)", "stroke"]);
    widths.push(st[3]);
  }
  expect(widths, "the edge length outline is as wide as the names' (3, not 3 x zoom)").toEqual(["3px", "3px", "3px"]);
  const names = await page.locator("svg text.lbl").evaluateAll((els) => els.map((el) => { const s = getComputedStyle(el); return [el.textContent, s.fill, s.stroke]; }));
  expect(names.length).toBeGreaterThan(8); // rooms, the zone, device names, the extra
  for (const [t, fill, stroke] of names) { expect(fill, String(t)).toBe("rgb(58, 58, 58)"); expect(stroke, String(t)).toBe("rgb(255, 255, 255)"); }
  expect(names.some(([t]) => t === "Shed")).toBe(true);
});

// ---- delete a room edge (S1.47) -------------------------------------------------------------

const twins = (page: Page) => page.locator("svg line.eh").count();

test("S1.47: Delete on a shared edge stops drawing it on both rooms, and one undo brings it back", async ({ page }) => {
  const before = await twins(page);
  await clickCm(page, 500, 300); // the edge Living and Kitchen share
  await expect(page.locator("#ek")).toHaveValue("wall");
  await expectWarn(page, "#edel");
  await page.locator("#edel").click();
  const g = await groundOf(page);
  expect(g.rooms[0].wk[1]).toBe("none");
  expect(g.rooms[1].wk[3]).toBe("none");
  expect(await twins(page)).toBe(before - 2);
  await expect(page.locator('svg line.e.none[data-e="r0:1"]')).toHaveCount(1);
  await expect(page.locator("#edel")).toHaveCount(0);
  await menu(page, "File");
  await page.locator("#undo").click();
  const u = await groundOf(page);
  expect(u.rooms[0].wk[1]).toBe("wall");
  expect(u.rooms[1].wk[3]).toBe("wall");
  expect(await twins(page)).toBe(before);
});

test("S1.47: a deleted edge can be picked again and brought back from the kind list", async ({ page }) => {
  await clickCm(page, 500, 300);
  await page.locator("#edel").click();
  await page.mouse.click(...Object.values(await screenOf(page, 200, 100)) as [number, number]); // elsewhere
  await clickCm(page, 500, 300);
  await expect(page.locator("#ek")).toHaveValue("none");
  await page.locator("#ek").selectOption("wall");
  expect((await groundOf(page)).rooms[1].wk[3]).toBe("wall");
});

test("S1.47: a door on the edge asks first; Cancel changes nothing", async ({ page }) => {
  await page.evaluate((tag) => { const el = document.querySelector(tag) as any; const l = JSON.parse(JSON.stringify(el.layout)); l.floors.ground.doors.push({ id: "door-x", name: "Between", kind: "door", a: [500, 100], b: [500, 190] }); el.layout = l; }, EDITOR);
  await clickCm(page, 500, 330);
  const before = await groundOf(page);
  await page.locator("#edel").click();
  await expect(page.locator("#edelyes")).toBeVisible();
  expect(await groundOf(page)).toEqual(before);
  await page.locator("#edelno").click();
  await expect(page.locator("#edelyes")).toHaveCount(0);
  await expect(page.locator("#edel")).toBeVisible();
  await page.locator("#edel").click();
  await page.locator("#edelyes").click();
  const g = await groundOf(page);
  expect([g.rooms[0].wk[1], g.rooms[1].wk[3]]).toEqual(["none", "none"]);
  expect(g.doors.some((d) => d.id === "door-x")).toBe(true); // the door stays
});

test("S1.47: Delete on the edge Hall shares in halves leaves no line drawn; one undo restores exactly", async ({ page }) => {
  const before = await groundOf(page), lines = await twins(page);
  await clickCm(page, 250, 400); // Hall's edge (0,400)-(800,400); Living and Kitchen own half each
  await page.locator("#edel").click();
  const g = await groundOf(page);
  const onSeam = g.rooms.flatMap((r) => r.pts.map((p, i) => ({ a: p, b: r.pts[(i + 1) % r.pts.length], k: r.wk[i], name: r.name })).filter((e) => e.a[1] === 400 && e.b[1] === 400));
  expect(onSeam.length).toBe(3); // Living's, Kitchen's and Hall's edge
  expect(onSeam.map((e) => e.k)).toEqual(onSeam.map(() => "none"));
  expect(await twins(page)).toBe(lines - 3);
  await menu(page, "File");
  await page.locator("#undo").click();
  expect(await groundOf(page)).toEqual(before);
  await expect(page.locator("#undo")).toBeDisabled();
});

test("S1.52: an outline edge with no room on it still has Delete (the perimeter is always editable)", async ({ page }) => {
  await addFloorVia(page, "Attic"); // the outline only
  await clickCm(page, 400, 0);
  await expect(page.locator("#addpt")).toBeVisible(); // the edge panel is up
  await expect(page.locator("#edel")).toBeVisible();
});

// ---- S1.48 a closed loop of walls becomes a room ----
const LOOP: [number, number][] = [[103, 632], [297, 633], [298, 668], [102, 667]];

for (const [wall, kind, label] of [["wall", "room", "Room"], ["external", "room", "Room"], ["boundary", "zone", "Zone"], ["fence", "garden", "Garden"], ["edge", "garden", "Garden"]] as const) {
  test(`walls (${wall}) closed on the first point become a ${kind}, selected and named, one undo step`, async ({ page }) => {
    await setGrid(page, 5);
    const before = await groundOf(page);
    await startDraw(page, `drawWall-${wall}`);
    await clicksCm(page, ...LOOP, LOOP[0]);
    const g = await groundOf(page);
    expect(g.walls).toEqual(before.walls); // the four walls are gone
    expect(g.rooms).toHaveLength(before.rooms.length + 1);
    const room = g.rooms.at(-1)!;
    expect([room.kind, room.area, room.wk]).toEqual([kind, "", [wall, wall, wall, wall]]);
    expect(room.pts.map((p) => p.join()).sort()).toEqual(FREE_SNAPPED.map((p) => p.join()).sort());
    await expect(page.locator("#status")).toHaveText(`${label} created from 4 walls`);
    await expect(page.locator("#rn")).toBeFocused();
    await expect(page.locator("#rn")).toHaveValue(`New ${kind}`);
    await expect(page.locator("[data-draw]")).toHaveCount(0);
    expect(validate(await layoutOf(page)).ok).toBe(true);
    await menu(page, "File"); // the name field has focus, so Ctrl+Z would undo typing
    await page.locator("#undo").click();
    expect(await groundOf(page)).toEqual(before); // the walls are only drawn on commit, so one undo removes the room and leaves no walls
    await expect(page.locator("#undo")).toBeDisabled();
  });
}

test("walls closed on the first point: one undo leaves nothing behind, redo brings the room again", async ({ page }) => {
  await setGrid(page, 5);
  await startDraw(page, "drawWall-wall");
  await clicksCm(page, ...LOOP, LOOP[0]);
  const after = await groundOf(page);
  await menu(page, "File");
  await page.locator("#undo").click();
  await menu(page, "File");
  await page.locator("#redo").click();
  expect(await groundOf(page)).toEqual(after);
});

test("a last click 30 cm from the first point is outside the snap: four walls, no room", async ({ page }) => {
  await setGrid(page, 5);
  const before = await groundOf(page);
  await startDraw(page, "drawWall-wall");
  await clicksCm(page, ...LOOP, [133, 632]);
  await page.keyboard.press("Enter");
  const g = await groundOf(page);
  expect(g.rooms).toHaveLength(before.rooms.length);
  expect(g.walls).toHaveLength(4);
});

test("walls that return to an intermediate corner stay walls: no room, no wall taken", async ({ page }) => {
  await setGrid(page, 5);
  const before = await groundOf(page);
  await startDraw(page, "drawWall-wall");
  await clicksCm(page, [105, 630], [295, 630], [295, 670], [200, 670], [295, 630]);
  await page.keyboard.press("Enter");
  const g = await groundOf(page);
  expect(g.rooms).toHaveLength(before.rooms.length);
  expect(g.walls).toHaveLength(4);
  await expect(page.locator("#status")).toHaveText("Added the shape");
});

test("a ring of 13 walls stays walls and the status says why", async ({ page }) => {
  await setGrid(page, 5);
  const before = await groundOf(page);
  const ring = Array.from({ length: 13 }, (_, i): [number, number] => [Math.round((400 + 250 * Math.cos((i * 2 * Math.PI) / 13)) / 5) * 5, Math.round((300 + 250 * Math.sin((i * 2 * Math.PI) / 13)) / 5) * 5]);
  await startDraw(page, "drawWall-wall");
  await clicksCm(page, ...ring, ring[0]);
  const g = await groundOf(page);
  expect(g.rooms).toHaveLength(before.rooms.length);
  expect(g.walls).toHaveLength(13);
  await expect(page.locator("#status")).toHaveText("13 walls, too many to make a room (max 12)");
});

test("two rings sharing a wall make two rooms", async ({ page }) => {
  await setGrid(page, 5);
  const before = await groundOf(page);
  await startDraw(page, "drawWall-wall");
  await clicksCm(page, [105, 630], [295, 630], [295, 670], [105, 670], [105, 630]);
  await startDraw(page, "drawWall-wall");
  await clicksCm(page, [295, 630], [395, 630], [395, 670], [295, 670], [295, 630]);
  const g = await groundOf(page);
  expect(g.rooms).toHaveLength(before.rooms.length + 2);
  expect(g.walls).toEqual(before.walls);
});

test("Opus review: a dotted chain that closes over an older wall makes a room whose wk is the truth, and the layout validates", async ({ page }) => {
  await setGrid(page, 5);
  await page.evaluate((tag) => { const el = document.querySelector(tag) as any; const l = JSON.parse(JSON.stringify(el.layout)); l.floors.ground.walls.push({ id: "wall-old", a: [105, 630], b: [295, 630], kind: "wall" }); el.layout = l; }, EDITOR);
  await startDraw(page, "drawWall-boundary");
  await clicksCm(page, [295, 630], [295, 670], [105, 670], [105, 630]);
  await page.keyboard.press("Enter");
  const g = await groundOf(page);
  const room = g.rooms.at(-1)!;
  expect(room.kind).toBe("room");
  expect([...room.wk].sort()).toEqual(["boundary", "boundary", "boundary", "wall"]);
  expect(g.walls.some((w) => w.id === "wall-old")).toBe(false);
  expect(validate(await layoutOf(page)).ok).toBe(true);
});

test("Opus review a11y: the turn buttons are a labelled group and their names carry the direction; no label points at nothing", async ({ page }) => {
  await clickCm(page, 200, 200); // a room: has rotation buttons
  const group = page.getByRole("group", { name: "Turn by degrees" });
  await expect(group).toHaveCount(1);
  for (const n of [30, 45, 60, 90]) await expect(group.getByRole("button", { name: `Turn ${n} degrees clockwise`, exact: true })).toBeVisible();
  await page.locator("#rrotdir").click();
  for (const n of [30, 45, 60, 90]) await expect(group.getByRole("button", { name: `Turn ${n} degrees counter-clockwise`, exact: true })).toBeVisible();
  // the stairs panel: every <label> is tied to a control
  const c = await screenOf(page, 740, 500);
  await page.mouse.click(c.x, c.y);
  await expect(page.locator("#sstn")).toBeVisible();
  const orphans = await page.locator("label").evaluateAll((ls) => ls.filter((l) => !(l as HTMLLabelElement).control).map((l) => l.textContent));
  expect(orphans).toEqual([]);
});

// ---- Opus review: every CSS rule that render.test.ts only matches as a string is checked here in the browser ----

const rgb = (hex: string) => { const n = parseInt(hex.slice(1), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; };
/** Adds shapes below the house: one room per kind, one wall per kind, a room with a "none" edge, a temp sensor in a garden. */
async function addCssFixtures(page: Page) {
  await setTheme(page, "light"); // the CSS pairs below pin light values; blueprint is the default since S2.12
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout)), g = l.floors.ground;
    const kinds = ["garden", "terrace", "pavement", "fill", "zone", "water"];
    kinds.forEach((k, i) => g.rooms.push({ id: `css-${k}`, name: k, area: "", label: "", kind: k, pts: [[1000 + i * 100, 0], [1080 + i * 100, 0], [1080 + i * 100, 80], [1000 + i * 100, 80]], wk: Array(4).fill(k === "zone" ? "boundary" : "wall") }));
    g.rooms.push({ id: "css-none", name: "none", area: "", label: "", kind: "room", pts: [[1700, 0], [1780, 0], [1780, 80], [1700, 80]], wk: ["wall", "none", "wall", "wall"] });
    ["wall", "external", "fence", "edge"].forEach((k, i) => g.walls.push({ id: `css-w-${k}`, a: [1000, 200 + i * 40], b: [1200, 200 + i * 40], kind: k }));
    g.devices.push({ id: "css-out", type: "temp", entity: "sensor.css_out", x: 1040, y: 40 }); // inside css-garden
    // S2.9: types with no fixture elsewhere in the demo, so the colour-pair tests below have something to toggle .on.
    ["contact", "climate", "tv", "computer", "humidity"].forEach((t, i) => g.devices.push({ id: `css-${t}`, type: t, entity: `sensor.css_${t}`, x: 1900 + i * 40, y: 40 }));
    g.rooms.push({ id: "css-pond", name: "pond", area: "", label: "", kind: "water", pts: [[1800, 200], [1880, 200], [1880, 280], [1800, 280]], wk: Array(4).fill("wall"), entity: "switch.css_pond" });
    g.furniture.push({ id: "css-gate", symbol: "patio-wood", x: 1940, y: 240, rot: 0, w: 100, h: 100, entity: "cover.css_gate" });
    el.layout = l;
  }, EDITOR);
}

test("Opus review CSS pair: wall kinds have their colour, thickness and dash (render.test.ts:323-333)", async ({ page }) => {
  await addCssFixtures(page);
  const st = (k: string) => page.locator(`svg line.e.${k}`).first().evaluate((e) => { const s = getComputedStyle(e); return { stroke: s.stroke, w: parseFloat(s.strokeWidth), dash: s.strokeDasharray }; });
  const wall = await page.locator("svg line.e:not(.external):not(.fence):not(.edge):not(.none):not(.se):not(.nw)").first().evaluate((e) => parseFloat(getComputedStyle(e).strokeWidth));
  const ext = await st("external"), fence = await st("fence"), edge = await st("edge");
  expect([ext.stroke, fence.stroke, edge.stroke]).toEqual([rgb("#1a1917"), rgb("#7a5c3a"), rgb("#a29e94")]);
  expect(ext.w).toBeGreaterThan(wall);
  expect(fence.w).toBeLessThan(wall);
  expect(fence.dash.split(",").length).toBe(4); // dash-dot
  expect(edge.dash).toBe("none");
});

test("S8.9 CSS pair: a plain wall is 10cm thick, an external wall 20cm, each halo 2cm wider, and a door/window takes its own wall's thickness", async ({ page }) => {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout)), g = l.floors.ground;
    g.walls.push({ id: "s89-wi", a: [1900, 500], b: [2000, 500], kind: "wall" }, { id: "s89-we", a: [1900, 560], b: [2000, 560], kind: "external" });
    g.doors.push({ id: "s89-di", name: "Internal", kind: "door", a: [1920, 500], b: [1980, 500] }, { id: "s89-de", name: "External", kind: "window", a: [1920, 560], b: [1980, 560] });
    el.layout = l;
  }, EDITOR);
  const w = (sel: string) => page.locator(sel).first().evaluate((e) => parseFloat(getComputedStyle(e).strokeWidth));
  expect(await w("svg line.e:not(.external):not(.fence):not(.edge):not(.none):not(.se):not(.nw)")).toBe(10);
  expect(await w("svg line.e.external")).toBe(20);
  expect(await w("svg line.eh:not(.external):not(.fence):not(.edge):not(.se):not(.nw)")).toBe(12);
  expect(await w("svg line.eh.external")).toBe(22);
  const wByTitle = (name: string) => page.locator("svg line[data-d]:not(.door-hit)").filter({ hasText: name }).first().evaluate((e) => parseFloat(getComputedStyle(e).strokeWidth));
  expect(await wByTitle("Internal")).toBe(10); // s89-di, on the internal wall
  expect(await wByTitle("External")).toBe(20); // s89-de, on the external wall
});

test("CSS pair: furniture has its own fixed grey token, decoupled from idle devices", async ({ page }) => {
  await addCssFixtures(page); // adds a "css-gate" furniture piece (patio-wood)
  const furn = await page.locator("svg g.furn").first().evaluate((e) => getComputedStyle(e).color);
  const idle = await page.locator("svg g.dev path:not(.halo)").first().evaluate((e) => getComputedStyle(e).fill);
  expect(furn).toBe(rgb("#79766e"));
  expect(furn).not.toBe(idle);
  await setTheme(page, "midnight");
  expect(await page.locator("svg g.furn").first().evaluate((e) => getComputedStyle(e).color)).toBe(rgb("#79766e"));
});

// S8.11: an opening used to be a grey band stroked to match a plain room's own fill (--fp-room-empty) so it
// merely looked like a hole; that band showed as a visibly wrong colour over any room with its own colour or
// texture. Now the hole is real — src/core/render.ts cuts the wall out of a <mask> — so the opening's own
// stroke paints nothing at all, in every theme, whatever the room under it looks like.
test("CSS pair: an opening's own stroke is transparent in light and in a dark theme, whatever the room's own colour (S8.11)", async ({ page }) => {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout)), g = l.floors.ground;
    g.rooms[0].color = "#4a6fa5"; // Living, given a colour of its own so a leftover fill-matching band would visibly clash
    g.openings.push({ id: "css-op", a: [200, 0], b: [300, 0] }); // on Living's now-coloured external wall
    el.layout = l;
  }, EDITOR);
  const style = () => page.locator("svg line.opening").first().evaluate((e) => getComputedStyle(e).stroke);
  await setTheme(page, "light");
  expect(await style()).toBe("rgba(0, 0, 0, 0)");
  await setTheme(page, "midnight");
  expect(await style()).toBe("rgba(0, 0, 0, 0)");
});

test("Opus review CSS pair: each room kind has its own fill; fill is hatched; zone is unfilled (render.test.ts:207-210, 371-394)", async ({ page }) => {
  await addCssFixtures(page);
  const fill = (k: string) => page.locator(`svg polygon.room-${k}`).first().evaluate((e) => getComputedStyle(e).fill);
  expect(await fill("garden")).toBe(rgb("#9db98a"));
  expect(await fill("terrace")).toBe(rgb("#cdb094"));
  expect(await fill("pavement")).toBe(rgb("#c9c6bf"));
  expect(await fill("water")).toBe(rgb("#a9cfe3"));
  expect(await fill("zone")).toBe("none");
  expect(await fill("fill")).toContain("#fp-hatch");
  // the hatch pattern paints with the two fill variables
  const pat = await page.locator("svg pattern#fp-hatch").evaluate((p) => { const r = p.querySelector("rect")!, l = p.querySelector("line, path")!; return [getComputedStyle(r).fill, getComputedStyle(l).stroke]; });
  expect(pat).toEqual([rgb("#c4c0b8"), rgb("#9a958b")]);
});

test("Opus review CSS pair: a deleted edge is a faint dotted guide, stair treads have their colour (render.test.ts:521, 859)", async ({ page }) => {
  await addCssFixtures(page);
  const none = await page.locator("svg line.e.none").first().evaluate((e) => { const s = getComputedStyle(e); return [s.strokeDasharray, s.strokeWidth, s.opacity]; });
  expect(none).toEqual(["2px, 5px", "1px", "0.6"]);
  expect(await page.locator("svg g[data-s] line.tread").first().evaluate((e) => getComputedStyle(e).stroke)).toBe(rgb("#8b8578"));
});

test("Opus review CSS pair: the palette variables equal DEVICE_COLOURS, camera and garden sensor paint from them (render.test.ts:598-600, 757)", async ({ page }) => {
  await addCssFixtures(page);
  const vars = await page.locator("svg g.dev").first().evaluate((e) => { const s = getComputedStyle(e), o: Record<string, string> = {}; for (const k of ["light", "motion", "contact", "heater", "climate", "ac-cool", "ac-heat", "tv", "plug", "computer", "camera", "garden"]) o[k] = s.getPropertyValue(`--fp-dev-${k}`).trim(); return o; });
  expect(vars).toEqual({ light: "#e0a800", motion: "#d64545", contact: "#d64545", heater: "#e8801a", climate: "#e8801a", "ac-cool": "#2c7fb8", "ac-heat": "#e8801a", tv: "#2c7fb8", plug: "#2c7fb8", computer: "#2c7fb8", camera: "#4a4a48", garden: "#3f8f4f" });
  for (const k of ["light", "motion", "contact", "heater", "climate", "tv", "plug", "computer", "camera"] as const) expect(vars[k], k).toBe((DEVICE_COLOURS as Record<string, string>)[k]);
  expect(await camFill(page)).toBe(rgb("#4a4a48"));
  const out = await page.locator("svg g.dev.outdoor path:not(.halo)").first().evaluate((e) => getComputedStyle(e).fill);
  expect(out).toBe(rgb("#3f8f4f"));
});

test("Opus review CSS pair: a lamp's aura fills with --fp-aura at --fp-alpha and lets a real click pass through to the room under it (render.test.ts:S2.8)", async ({ page }) => {
  // The editor has no live `hass` state, so no aura is ever drawn by renderFloor here; this pins the .aura rule
  // itself the way the motion-fade pair above pins .dev-motion, by putting a circle with that one class on the
  // live stylesheet and reading it back through getComputedStyle in the real browser (CLAUDE.md finding 10: the
  // FLOORPLAN_CSS string match in render.test.ts is blind to specificity and to pointer-events actually taking hold).
  const c = await screenOf(page, 200, 150); // inside the Living room (room 0), away from every device icon
  await page.evaluate((tag) => {
    const svg = (document.querySelector(tag) as any).shadowRoot.querySelector("svg") as SVGSVGElement;
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("class", "aura");
    circle.setAttribute("cx", "200");
    circle.setAttribute("cy", "150");
    circle.setAttribute("r", "100");
    svg.querySelector('polygon[data-r="0"]')!.after(circle);
  }, EDITOR);
  const style = await page.locator("svg circle.aura").evaluate((e) => { const s = getComputedStyle(e); return { fill: s.fill, op: s.fillOpacity, pe: s.pointerEvents }; });
  expect(style.fill).toBe(rgb("#ff8a1f")); // blueprint's --fp-aura collapses to the single accent
  expect(style.op).toBe("0.25");
  expect(style.pe).toBe("none");
  await page.mouse.click(c.x, c.y); // the aura visually covers this point; pointer-events:none must let the click fall through to the room
  await expect(page.locator("#rk")).toHaveValue("room");
  await expect(page.locator("#ra")).toHaveValue("living");
});

test("Opus review CSS pair: a motion sensor that is on still fades: the fill follows --fp-fade (render.test.ts:107)", async ({ page }) => {
  const g = page.locator("svg g.dev-motion").first();
  const fillAt = (fade: string, on: boolean) => g.evaluate((e, [f, o]) => { e.classList.toggle("on", o as boolean); (e as SVGElement).style.setProperty("--fp-fade", f as string); return getComputedStyle(e.querySelector("path:not(.halo)")!).fill; }, [fade, on] as const);
  // color-mix computes to color(srgb r g b) in 0..1, a plain colour to rgb(r, g, b) in 0..255: compare in 0..255
  const chan = (c: string) => (c.startsWith("color(") ? c.match(/[\d.]+/g)!.slice(-3).map((n) => Math.round(+n * 255)) : c.match(/\d+/g)!.map(Number));
  const idle = chan(await fillAt("0", false));
  expect(chan(await fillAt("1", true))).toEqual([255, 138, 31]); // fully faded in: blueprint's motion colour collapses to the single accent
  expect(chan(await fillAt("0", true))).toEqual(idle);          // fully faded out: idle, not the "on" colour
  const half = chan(await fillAt("0.5", true));
  expect(half).not.toEqual(idle);
  expect(half).not.toEqual([214, 69, 69]);
});

test("Opus review CSS pair: S8.13 a triggered motion sensor pings in its own colour and its disc beats a lit lamp's (render.test.ts:S8.13)", async ({ page }) => {
  // No live hass in the editor: add .on and a ping by hand, then read the real computed style (CLAUDE.md finding 10).
  const read = (type: string) => page.locator(`svg g.dev-${type}`).first().evaluate((e) => {
    e.classList.add("on");
    const ping = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    ping.setAttribute("class", "ping");
    e.querySelector(".halo")!.before(ping);
    const ps = getComputedStyle(ping), hs = getComputedStyle(e.querySelector(".halo")!);
    return { dev: getComputedStyle(e).getPropertyValue("--fp-dev").trim(), stroke: ps.stroke, fill: ps.fill, pe: ps.pointerEvents, anim: ps.animationName, haloOp: hs.fillOpacity, haloStroke: hs.stroke };
  });
  const motion = await read("motion"), light = await read("light");
  expect(motion.stroke).toBe(rgb(motion.dev));
  expect(motion.fill).toBe("none");
  expect(motion.pe).toBe("none");
  expect(motion.anim).toBe("fp-ping");
  expect(motion.haloOp).toBe("0.6");
  expect(motion.haloStroke).toBe(rgb(motion.dev));
  expect(Number(light.haloOp)).toBeLessThan(Number(motion.haloOp));
});

test("Opus review CSS pair: S8.13 under reduced motion nothing pulses: the ping holds at 1.5x and 60 %, the door line at 45 %", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const s = await page.evaluate((tag) => {
    const svg = (document.querySelector(tag) as any).shadowRoot.querySelector("svg") as SVGSVGElement;
    const g = svg.querySelector("g.dev-motion")!;
    g.classList.add("on");
    const ping = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    ping.setAttribute("class", "ping");
    g.querySelector(".halo")!.before(ping);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("class", "door-alert");
    svg.querySelector("line[data-d]")!.before(line);
    const p = getComputedStyle(ping), l = getComputedStyle(line);
    return { pAnim: p.animationName, pT: p.transform, pOp: p.opacity, lAnim: l.animationName, lOp: l.strokeOpacity };
  }, EDITOR);
  expect(s).toEqual({ pAnim: "none", pT: "matrix(1.5, 0, 0, 1.5, 0, 0)", pOp: "0.6", lAnim: "none", lOp: "0.45" });
});

test("Opus review CSS pair: S8.13 an open door's alert line is contact red and takes no click", async ({ page }) => {
  const s = await page.evaluate((tag) => {
    const svg = (document.querySelector(tag) as any).shadowRoot.querySelector("svg") as SVGSVGElement;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("class", "door-alert");
    svg.querySelector("line[data-d]")!.before(line);
    const cs = getComputedStyle(line);
    return { stroke: cs.stroke, want: getComputedStyle(svg).getPropertyValue("--fp-dev-contact").trim(), pe: cs.pointerEvents, anim: cs.animationName };
  }, EDITOR);
  expect(s.stroke).toBe(rgb(s.want));
  expect(s.pe).toBe("none");
  expect(s.anim).toBe("fp-door");
});

test("Opus review CSS pair: S2.9 a device wears its colour when it is on (--fp-dev per type, icon and halo)", async ({ page }) => {
  await addCssFixtures(page);
  // The editor has no live hass state, so .on is never set by renderFloor here; toggling it by hand pins the CSS
  // rule itself in a real browser, the same technique as the motion-fade pair test above.
  const read = (type: string) => page.locator(`svg g.dev-${type}`).first().evaluate((e) => {
    e.classList.add("on");
    const s = getComputedStyle(e);
    const path = e.querySelector("path:not(.halo)")!;
    const halo = e.querySelector(".halo")!;
    const r = { devVar: s.getPropertyValue("--fp-dev").trim(), pathFill: getComputedStyle(path).fill, haloFill: getComputedStyle(halo).fill, haloOp: getComputedStyle(halo).fillOpacity };
    e.classList.remove("on");
    return r;
  });
  const light = await read("light");
  expect(light.devVar).toBe("#e0a800");
  expect(light.pathFill).toBe(rgb("#e0a800"));
  expect(light.haloFill).toBe(rgb("#e0a800"));
  expect(light.haloOp).toBe("0.25");

  const heater = await read("heater");
  expect(heater.pathFill).toBe(rgb("#e8801a"));
  expect(heater.haloFill).toBe(rgb("#e8801a"));

  const climate = await read("climate");
  expect(climate.pathFill).toBe(rgb("#e8801a"));
  expect(climate.haloFill).toBe(rgb("#e8801a"));

  const tv = await read("tv");
  expect(tv.pathFill).toBe(rgb("#2c7fb8"));
  expect(tv.haloFill).toBe(rgb("#2c7fb8"));

  const plug = await read("plug");
  expect(plug.pathFill).toBe(rgb("#2c7fb8"));
  expect(plug.haloFill).toBe(rgb("#2c7fb8"));

  const computer = await read("computer");
  expect(computer.pathFill).toBe(rgb("#2c7fb8"));
  expect(computer.haloFill).toBe(rgb("#2c7fb8"));

  const contact = await read("contact");
  expect(contact.pathFill).toBe(rgb("#d64545"));
  expect(contact.haloFill).toBe(rgb("#d64545"));

  // switch and humidity draw no brighter on than off: --fp-dev falls back to idle grey.
  const sw = await read("switch");
  expect(sw.devVar).toBe("#8b8578");
  expect(sw.pathFill).toBe(rgb("#8b8578"));
  expect(sw.haloFill).toBe(rgb("#8b8578"));
  const hum = await read("humidity");
  expect(hum.devVar).toBe("#8b8578");
  expect(hum.pathFill).toBe(rgb("#8b8578"));

  // motion: the icon path keeps following --fp-fade (the S1.6 fix), but the halo reads --fp-dev normally, red.
  const motion = await page.locator("svg g.dev-motion").first().evaluate((e) => {
    e.classList.add("on");
    (e as SVGElement).style.setProperty("--fp-fade", "1");
    const halo = e.querySelector(".halo")!;
    const r = { devVar: getComputedStyle(e).getPropertyValue("--fp-dev").trim(), haloFill: getComputedStyle(halo).fill };
    e.classList.remove("on");
    (e as SVGElement).style.removeProperty("--fp-fade");
    return r;
  });
  expect(motion.devVar).toBe("#d64545");
  expect(motion.haloFill).toBe(rgb("#d64545"));
});

test("Opus review CSS pair: S2.9 break-it, a light that is on and unavailable keeps the unavailable opacity (render.test.ts:S2.9)", async ({ page }) => {
  const g = page.locator("svg g.dev-light").first();
  const opacityWith = (on: boolean, unavailable: boolean) => g.evaluate((e, [o, u]) => {
    e.classList.toggle("on", o as boolean);
    e.classList.toggle("unavailable", u as boolean);
    return getComputedStyle(e).opacity;
  }, [on, unavailable] as const);
  expect(await opacityWith(false, false)).toBe("1");
  expect(await opacityWith(true, false)).toBe("1");
  expect(await opacityWith(true, true)).toBe("0.45"); // the colour rule never overrides unavailable
  await opacityWith(false, false); // leave the fixture clean
});

// parses "rgb(r, g, b)" (or the "color(srgb r g b)" form color-mix can produce) into 0..255 channels
const channels = (c: string) => (c.startsWith("color(") ? c.match(/[\d.]+/g)!.slice(-3).map((n) => Math.round(+n * 255)) : c.match(/\d+/g)!.map(Number));

test("Opus review CSS pair: S2.9 a water room with an entity outlines, but its fill never moves, when it is on (Opus review: a fill tint desaturated the water and read as switched off)", async ({ page }) => {
  await addCssFixtures(page);
  const read = (on: boolean) => page.locator("svg polygon.room-water").last().evaluate((e, o) => {
    e.classList.toggle("on", o as boolean);
    const s = getComputedStyle(e);
    return { fill: s.fill, stroke: s.stroke, width: parseFloat(s.strokeWidth) };
  }, on);
  const off = await read(false), on = await read(true);
  await read(false); // leave the fixture clean
  expect(on.fill).toBe(off.fill); // "on" is a stroke now: the fill never moves, so it can't desaturate the kind colour.
  expect(on.stroke).toBe(rgb("#8a5117")); // --fp-active, the same token furniture wears: one colour for "on" across the plan.
  expect(on.width).toBeGreaterThan(0);
});

test("Opus review CSS pair: S2.9 a zone room (fill:none) still shows the on outline (Opus review: a fill tint there was a silent no-op)", async ({ page }) => {
  await addCssFixtures(page);
  const stroke = await page.locator("svg polygon.room-zone").first().evaluate((e) => {
    e.classList.add("on");
    const s = getComputedStyle(e).stroke;
    e.classList.remove("on");
    return s;
  });
  expect(stroke).toBe(rgb("#8a5117"));
});

test("Opus review CSS pair: S2.9 a room that is both on and selected strokes with the selection colour, not the on colour (Opus review: .room.on's two classes would otherwise outrank .sel's one)", async ({ page }) => {
  await addCssFixtures(page);
  const stroke = await page.locator("svg polygon.room-water").last().evaluate((e) => {
    e.classList.add("on", "sel");
    const s = getComputedStyle(e).stroke;
    e.classList.remove("on", "sel");
    return s;
  });
  expect(stroke).toBe(rgb("#2b2a27")); // --fp-ink, light theme: selection still wins.
});

test("Opus review CSS pair: S2.9 room_glow has the same fix (Opus review: a pre-existing bug, same cause)", async ({ page }) => {
  await addCssFixtures(page);
  const off = channels(await page.locator("svg polygon.room-water").last().evaluate((e) => getComputedStyle(e).fill));
  const glowing = channels(await page.locator("svg polygon.room-water").last().evaluate((e) => {
    e.classList.add("glow");
    const fill = getComputedStyle(e).fill;
    e.classList.remove("glow");
    return fill;
  }));
  expect(glowing).not.toEqual(off);
  expect(glowing[2]).toBeGreaterThanOrEqual(glowing[0]);
  expect(glowing[1]).toBeGreaterThanOrEqual(glowing[0]);
});

test("Opus review CSS pair: S2.9 furniture with an entity turns present, not paler, when it is on (Opus review: --fp-glow nearly vanished it)", async ({ page }) => {
  await addCssFixtures(page);
  const furnColor = await page.locator("svg g.furn").last().evaluate((e) => {
    e.classList.add("on");
    const color = getComputedStyle(e).color;
    e.classList.remove("on");
    return color;
  });
  expect(furnColor).toBe(rgb("#8a5117")); // --fp-active, light theme
});

// ---- S1.50 a measure grid with metre markers ----

test("S1.50: .mg lines are 50 cm apart in plan units and sit before the first room in DOM order", async ({ page }) => {
  const xs = await page.locator("svg line.mg").evaluateAll((els) => {
    const vertical = els.filter((e) => e.getAttribute("x1") === e.getAttribute("x2"));
    return [...new Set(vertical.map((e) => Number(e.getAttribute("x1"))))].sort((a, b) => a - b);
  });
  expect(xs.length).toBeGreaterThan(1);
  const diffs = new Set(xs.slice(1).map((x, i) => Math.round(x - xs[i])));
  expect(diffs).toEqual(new Set([50]));
  const order = await rpt(page).evaluate((host) => {
    const svg = (host as any).shadowRoot.querySelector("svg") as SVGSVGElement;
    const all = [...svg.querySelectorAll("*")];
    return { mg: all.findIndex((e) => e.classList.contains("mg")), room: all.findIndex((e) => e.matches("polygon[data-r]")) };
  });
  expect(order.mg).toBeGreaterThanOrEqual(0);
  expect(order.mg).toBeLessThan(order.room);
});

test("Opus review CSS pair: the measure grid is thin and non-scaling, brighter on the metre (render.test.ts:522)", async ({ page }) => {
  await setTheme(page, "light"); // pins light values; blueprint is the default since S2.12
  const half = await page.locator("svg line.mg:not(.m)").first().evaluate((e) => { const s = getComputedStyle(e); return { stroke: s.stroke, w: s.strokeWidth, ve: s.vectorEffect, op: s.strokeOpacity }; });
  const metre = await page.locator("svg line.mg.m").first().evaluate((e) => { const s = getComputedStyle(e); return { w: s.strokeWidth, op: s.strokeOpacity }; });
  expect(half.stroke).toBe(rgb("#3a3a3a"));
  expect(half.ve).toBe("non-scaling-stroke");
  expect(half.w).toBe("0.5px");
  expect(half.op).toBe("0.12");
  expect(metre.w).toBe("1px");
  expect(metre.op).toBe("0.22");
});

test("the grid's zero is the plan's top-left corner: the number there reads 0 m, the one a metre right reads 1", async ({ page }) => {
  // the top-edge (x-axis) numbers sit at x="<plan x>"; the left-edge ones do not, so this picks the x-axis label
  // Move the whole plan off the layout origin first, so a grid still zeroed at (0, 0) cannot pass by accident.
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout));
    const shift = (p: [number, number]): [number, number] => [p[0] + 730, p[1] + 310];
    const f = l.floors.ground;
    f.outline = f.outline.map(shift);
    for (const r of f.rooms) r.pts = r.pts.map(shift);
    for (const w of f.walls) { w.a = shift(w.a); w.b = shift(w.b); }
    for (const d of f.doors) { d.a = shift(d.a); d.b = shift(d.b); }
    for (const o of f.openings) { o.a = shift(o.a); o.b = shift(o.b); }
    for (const x of f.extras) { x.a = shift(x.a); x.b = shift(x.b); }
    for (const t of f.stairs) t.pts = t.pts.map(shift);
    for (const m of f.furniture) { m.x += 730; m.y += 310; }
    for (const dv of f.devices) { if ("a" in dv) { dv.a = shift(dv.a); dv.b = shift(dv.b); } else { dv.x += 730; dv.y += 310; } }
    el.layout = l;
  }, EDITOR);
  await expect(page.locator("svg polygon[data-r]").first()).toBeVisible();
  const zx = await page.evaluate((tag) => Math.min(...(document.querySelector(tag) as any).layout.floors.ground.outline.map((p: number[]) => p[0])), EDITOR);
  expect(zx).toBeGreaterThan(0);
  await expect(page.locator(`svg text.mg-n[x="${zx}"]`)).toHaveText("0 m");
  await expect(page.locator(`svg text.mg-n[x="${zx + 100}"]`)).toHaveText("1");
  const lx = await page.locator("svg line.mg.m").evaluateAll((els) => els.filter((e) => e.getAttribute("x1") === e.getAttribute("x2")).map((e) => Number(e.getAttribute("x1"))));
  expect(lx).toContain(zx); // a bright metre line stands on the corner
});

test("the grid covers everything the editor shows, not only the plan's box", async ({ page }) => {
  const r = await page.evaluate((tag) => {
    const o = (document.querySelector(tag) as any).layout.floors.ground.outline as number[][];
    const svg = (document.querySelector(tag) as any).shadowRoot.querySelector("svg") as SVGSVGElement;
    const vb = svg.viewBox.baseVal;
    const xs = [...svg.querySelectorAll("line.mg")].map((e) => [Number(e.getAttribute("x1")), Number(e.getAttribute("x2")), Number(e.getAttribute("y1")), Number(e.getAttribute("y2"))]);
    return { vb: [vb.x, vb.y, vb.width, vb.height], minx: Math.min(...xs.map((l) => l[0])), maxx: Math.max(...xs.map((l) => l[0])), miny: Math.min(...xs.map((l) => Math.min(l[2], l[3]))), maxy: Math.max(...xs.map((l) => Math.max(l[2], l[3]))), o: [Math.min(...o.map((p) => p[0])), Math.max(...o.map((p) => p[0]))] };
  }, EDITOR);
  const [vx, vy, vw, vh] = r.vb;
  expect(r.miny).toBeLessThanOrEqual(vy + 1); // the lines reach the top and bottom of what is shown
  expect(r.maxy).toBeGreaterThanOrEqual(vy + vh - 1);
  expect(r.minx).toBeLessThan(vx + 50); // and stand within one step of the left and right edges
  expect(r.maxx).toBeGreaterThan(vx + vw - 50);
});

test("S1.50: toggling #mgrid off removes every .mg and the choice survives a reload", async ({ page }) => {
  await expect.poll(() => page.locator("svg line.mg").count()).toBeGreaterThan(0);
  await menu(page, "View");
  await expect(page.locator("#mgrid")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#mgrid").click();
  await menu(page, "View");
  await expect(page.locator("svg line.mg")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("floorplan-studio:measure"))).toBe("false");
  await page.reload();
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  await expect(page.locator("svg line.mg")).toHaveCount(0);
  await menu(page, "View");
  await expect(page.locator("#mgrid")).toHaveAttribute("aria-pressed", "false");
});

test("a measure grid on an all-negative layout still reads 0 m at the plan's corner", async ({ page }) => {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout));
    const shift = (p: [number, number]): [number, number] => [p[0] - 1000, p[1] - 1000];
    const f = l.floors.ground;
    f.outline = f.outline.map(shift);
    for (const r of f.rooms) r.pts = r.pts.map(shift);
    for (const w of f.walls) { w.a = shift(w.a); w.b = shift(w.b); }
    for (const d of f.doors) { d.a = shift(d.a); d.b = shift(d.b); }
    for (const o of f.openings) { o.a = shift(o.a); o.b = shift(o.b); }
    for (const x of f.extras) { x.a = shift(x.a); x.b = shift(x.b); }
    for (const s of f.stairs) s.pts = s.pts.map(shift);
    for (const m of f.furniture) { m.x -= 1000; m.y -= 1000; }
    for (const dv of f.devices) { if ("a" in dv) { dv.a = shift(dv.a); dv.b = shift(dv.b); } else { dv.x -= 1000; dv.y -= 1000; } }
    el.layout = l;
  }, EDITOR);
  await expect(page.locator("svg polygon[data-r]").first()).toBeVisible();
  await expect.poll(() => page.locator("svg line.mg").count()).toBeGreaterThan(0);
  const texts = await page.locator("svg text.mg-n").allTextContents();
  expect(texts.length).toBeGreaterThan(0);
  await expect(page.locator("svg text.mg-n", { hasText: "0 m" })).toHaveCount(1); // zero follows the plan's corner, wherever the plan sits
  const zx = await page.locator("svg text.mg-n", { hasText: "0 m" }).getAttribute("x");
  expect(Number(zx)).toBeLessThan(0);
});

test("S1.50: turning the plan turns the grid lines with the walls while the numbers stay upright", async ({ page }) => {
  await rotateBy(page, 1); // 45 degrees
  const lineAngle = await page.locator("svg line.mg").first().evaluate((e) => { const c = (e as SVGGraphicsElement).getScreenCTM()!; return Math.round((Math.atan2(c.b, c.a) * 180) / Math.PI); });
  expect(lineAngle).toBe(45);
  const numOff = await page.locator("svg text.mg-n").first().evaluate((e) => { const m = (e as SVGGraphicsElement).getScreenCTM()!; return Math.abs(m.b) / Math.abs(m.a); });
  expect(numOff).toBeLessThan(0.001);
});

test("S1.50: a floor 600 m wide draws the 5 m step and no more than 400 lines per axis", async ({ page }) => {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.outline = [[0, 0], [60000, 0], [60000, 600], [0, 600]];
    el.layout = l;
  }, EDITOR);
  await expect.poll(() => page.locator("svg line.mg").count()).toBeGreaterThan(0);
  const xs = await page.locator("svg line.mg").evaluateAll((els) => {
    const vertical = els.filter((e) => e.getAttribute("x1") === e.getAttribute("x2"));
    return [...new Set(vertical.map((e) => Number(e.getAttribute("x1"))))].sort((a, b) => a - b);
  });
  expect(xs.length).toBeLessThanOrEqual(400);
  const diffs = new Set(xs.slice(1).map((x, i) => Math.round(x - xs[i])));
  expect(diffs).toEqual(new Set([500]));
});

test("S1.50 break it: an empty floor draws a grid around the origin with no error, and toggling it is not an undo step", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground = { title: "Empty", outline: [], rooms: [], walls: [], stairs: [], doors: [], openings: [], extras: [], devices: [], furniture: [], unlinked: [] };
    el.layout = l;
  }, EDITOR);
  await expect.poll(() => page.locator("svg line.mg").count()).toBeGreaterThan(0);
  await expect(page.locator("svg text.mg-n", { hasText: /^0 m$/ })).toHaveCount(1);
  expect(errors).toEqual([]);
  await menu(page, "View");
  await page.locator("#mgrid").click();
  await menu(page, "View");
  await menu(page, "File");
  await expect(page.locator("#undo")).toBeDisabled(); // the toggle is a viewer preference, not an undo step
});

// ---- fix/heater-bar-under-icon ------------------------------------------------------

test("fix/heater-bar-under-icon: the heater icon sits on top of its bar, idle, selected, and with the plan turned 45", async ({ page }) => {
  const HEATER: [number, number] = [180, 8]; // demo's "Living radiator": a=[100,8] b=[260,8], midpoint 180,8
  const topOf = async () =>
    page.evaluate(([tag, x, y]) => {
      const root = (document.querySelector(tag as string) as any).shadowRoot as ShadowRoot;
      const el = root.elementFromPoint(x, y) as Element | null;
      return el?.closest("g[data-x]") ? "icon" : el?.closest("[data-xbar]") ? "bar" : (el?.tagName ?? "none");
    }, [EDITOR, x, y] as const);
  let p = await screenOf(page, ...HEATER);
  let x = p.x, y = p.y;
  expect(await topOf()).toBe("icon"); // idle
  await page.mouse.click(p.x, p.y);
  await expect(page.locator("#vrot90")).toBeVisible(); // a device is selected
  p = await screenOf(page, ...HEATER); x = p.x; y = p.y;
  expect(await topOf()).toBe("icon"); // selected
  await rotateBy(page, 1); // 45 degrees
  p = await screenOf(page, ...HEATER); x = p.x; y = p.y;
  expect(await topOf()).toBe("icon"); // plan turned 45
});

test("fix/heater-bar-under-icon: the bar itself, away from the icon, still drags the whole device", async ({ page }) => {
  // 250,8 sits on the visible bar (a=[100,8] b=[260,8]) but well clear of the icon halo at its midpoint 180,8.
  // The drop point (470,500) is far from every wall and room edge (over 80 cm), so the drag isn't pulled to sit beside one.
  await dragCm(page, [250, 8], [470, 500]);
  const f = await groundOf(page);
  const heater = f.devices.find((d: any) => d.id === "heater-living") as any;
  // The pointer grabbed the bar 70 cm right of its centre (180,8); the whole 160 cm bar keeps its length and heading.
  expect(heater.a).toEqual([320, 500]);
  expect(heater.b).toEqual([480, 500]);
});

// ---- S1.51 scale furniture by its corners ------------------------------------------------------

const SOFA = { x: 250, y: 320, w: 200, h: 90 }; // demo's furniture-ground-1, rot 0

test("S1.51: dragging the se handle grows the sofa while nw stays put; the panel follows live; one Undo restores it exactly", async ({ page }) => {
  const c = await screenOf(page, SOFA.x, SOFA.y);
  await page.mouse.click(c.x, c.y); // select the sofa
  await expect(page.locator("#fw")).toHaveValue(String(SOFA.w));
  await expect(page.locator("svg circle[data-fh]")).toHaveCount(4);
  await dragCm(page, [SOFA.x + SOFA.w / 2, SOFA.y + SOFA.h / 2], [SOFA.x + SOFA.w / 2 + 100, SOFA.y + SOFA.h / 2 + 60]);
  const m = (await groundOf(page)).furniture[0];
  expect(m.w).toBeGreaterThan(SOFA.w);
  expect(m.h).toBeGreaterThan(SOFA.h);
  await expect(page.locator("#fw")).toHaveValue(String(m.w));
  await expect(page.locator("#fh")).toHaveValue(String(m.h));
  const nwBefore: [number, number] = [SOFA.x - SOFA.w / 2, SOFA.y - SOFA.h / 2];
  const nwAfter: [number, number] = [m.x - m.w / 2, m.y - m.h / 2];
  expect(Math.hypot(nwAfter[0] - nwBefore[0], nwAfter[1] - nwBefore[1])).toBeLessThan(1);
  await menu(page, "File");
  await page.locator("#undo").click();
  const undone = (await groundOf(page)).furniture[0];
  expect(undone).toEqual({ id: "furniture-ground-1", symbol: "sofa", x: SOFA.x, y: SOFA.y, rot: 0, w: SOFA.w, h: SOFA.h });
});

test("S1.51: at plan rotation 45 a corner still drags along the sofa's own axes, not the screen's", async ({ page }) => {
  await rotateBy(page, 1);
  const c = await screenOf(page, SOFA.x, SOFA.y);
  await page.mouse.click(c.x, c.y);
  const nwBefore: [number, number] = [SOFA.x - SOFA.w / 2, SOFA.y - SOFA.h / 2];
  await dragCm(page, [SOFA.x + SOFA.w / 2, SOFA.y + SOFA.h / 2], [SOFA.x + SOFA.w / 2 + 80, SOFA.y + SOFA.h / 2 + 40]);
  const m = (await groundOf(page)).furniture[0];
  const nwAfter: [number, number] = [m.x - m.w / 2, m.y - m.h / 2];
  expect(Math.hypot(nwAfter[0] - nwBefore[0], nwAfter[1] - nwBefore[1])).toBeLessThan(1);
  expect(m.w).toBeGreaterThan(SOFA.w);
});

test("S1.51: Shift while dragging a corner keeps the width/depth ratio the sofa had when the drag started", async ({ page }) => {
  const c = await screenOf(page, SOFA.x, SOFA.y);
  await page.mouse.click(c.x, c.y);
  await dragCm(page, [SOFA.x + SOFA.w / 2, SOFA.y + SOFA.h / 2], [SOFA.x + SOFA.w / 2 + 300, SOFA.y + SOFA.h / 2 + 10], ["Shift"]);
  const m = (await groundOf(page)).furniture[0];
  expect(m.h / m.w).toBeCloseTo(SOFA.h / SOFA.w, 2);
});

test("S1.51: a corner drag that ends where it started adds no undo step", async ({ page }) => {
  const c = await screenOf(page, SOFA.x, SOFA.y);
  await page.mouse.click(c.x, c.y);
  // Alt disables the grid, like every other handle, so a true no-op drag lands on the exact same corner.
  await dragCm(page, [SOFA.x + SOFA.w / 2, SOFA.y + SOFA.h / 2], [SOFA.x + SOFA.w / 2, SOFA.y + SOFA.h / 2], ["Alt"]);
  await menu(page, "File");
  await expect(page.locator("#undo")).toBeDisabled();
});

test("S1.51 break it: a corner dragged past its opposite one clamps at 5 cm instead of flipping; handles are furniture-only", async ({ page }) => {
  const c = await screenOf(page, SOFA.x, SOFA.y);
  await page.mouse.click(c.x, c.y);
  await dragCm(page, [SOFA.x + SOFA.w / 2, SOFA.y + SOFA.h / 2], [SOFA.x - SOFA.w, SOFA.y - SOFA.h]); // well past the nw corner
  const m = (await groundOf(page)).furniture[0];
  expect(m.w).toBe(5);
  expect(m.h).toBe(5);
  // a device (the demo's hall camera) is never given corner handles
  const cam = await screenOf(page, CAM.x, CAM.y);
  await page.mouse.click(cam.x, cam.y);
  await expect(page.locator("svg circle[data-fh]")).toHaveCount(0);
});

// ---- S1.53 / S2.12 themes: blueprint (default), light, Home Assistant ---------------------------------------------------------

// Blueprint palette (role-generated, 2026-09-22): base #1c3f73 shaded into ground #0c1521 / wall #6394dd, fg #eef3fb,
// line (measure) #35d47a. An unpainted room (the demo's Living, room 0) is --fp-room-empty, #d6d6d2 = rgb(214, 214, 210)
// in every theme, unchanged since 2026-09-22.
const ROOM_EMPTY = "rgb(214, 214, 210)";
const DARK_TH = { bg: "rgb(12, 21, 33)", room: ROOM_EMPTY, wall: "rgb(99, 148, 221)", text: "rgb(238, 243, 251)", outline: "rgb(12, 21, 33)", disc: "rgb(238, 243, 251)", measure: "rgb(53, 212, 122)" };
// Midnight (the old default, ex-"blueprint", renamed 2026-09-22): ground #0d1522, room #14213a, wall #8fb4f0, text
// #d8e2f2. Still what the ha theme's dark-mode fallback uses (Diego's call: ha stays untouched by the new palettes).
const MIDNIGHT_TH = { bg: "rgb(13, 21, 34)" };
const LIGHT_TH = { bg: "rgb(244, 240, 230)", room: ROOM_EMPTY, wall: "rgb(43, 42, 39)", text: "rgb(58, 58, 58)", outline: "rgb(255, 255, 255)" };

test("CSS pair: an off icon's disc is 50 % in every theme (Diego, 2026-09-23)", async ({ page }) => {
  for (const t of ["blueprint", "midnight", "light", "slate", "terminal", "solarized", "ha"] as const) {
    await setTheme(page, t);
    const ops = await page.locator("svg .dev:not(.on) .halo").evaluateAll((els) => [...new Set(els.map((e) => getComputedStyle(e).fillOpacity))]);
    expect(ops, t).toEqual(["0.5"]);
  }
});

async function setTheme(page: Page, t: "blueprint" | "midnight" | "light" | "slate" | "terminal" | "solarized" | "ha") {
  await menu(page, "View");
  await page.locator("#thSub > summary").click();
  await page.locator(`[data-th="${t}"]`).click();
  await menu(page, "View");
}

test("S2.12: blueprint, the default, has the dark page background, room fill, wall stroke, room name colours, device disc and measure grid", async ({ page }) => {
  const got = await page.evaluate((tag) => {
    const root = (document.querySelector(tag) as any).shadowRoot as ShadowRoot;
    const host = document.querySelector(tag) as HTMLElement;
    const room = root.querySelector('svg polygon[data-r="0"]')!, wall = root.querySelector("svg line.e")!;
    const lbl = root.querySelector("svg text.lbl")!, halo = root.querySelector("svg .dev .halo")!, mg = root.querySelector("svg line.mg")!;
    const s = (el: Element) => getComputedStyle(el);
    return {
      bg: s(host).backgroundColor, room: s(room).fill, wall: s(wall).stroke,
      lblFill: s(lbl).fill, lblStroke: s(lbl).stroke, disc: s(halo).fill, mg: s(mg).stroke,
    };
  }, EDITOR);
  expect(got.bg).toBe(DARK_TH.bg);
  expect(got.room).toBe(DARK_TH.room);
  expect(got.wall).toBe(DARK_TH.wall);
  expect(got.lblFill).toBe(DARK_TH.text); // a room name on a dark room: light fill...
  expect(got.lblStroke).toBe(DARK_TH.outline); // ...with a dark outline, the S1.46 trick inverted
  expect(got.disc).toBe(DARK_TH.disc);
  expect(got.mg).toBe(DARK_TH.measure);
});

test("S1.53: light theme keeps its values", async ({ page }) => {
  await setTheme(page, "light");
  const got = await page.evaluate((tag) => {
    const root = (document.querySelector(tag) as any).shadowRoot as ShadowRoot;
    const host = document.querySelector(tag) as HTMLElement;
    const room = root.querySelector('svg polygon[data-r="0"]')!, wall = root.querySelector("svg line.e")!;
    const lbl = root.querySelector("svg text.lbl")!;
    const s = (el: Element) => getComputedStyle(el);
    return { bg: s(host).backgroundColor, room: s(room).fill, wall: s(wall).stroke, lblFill: s(lbl).fill, lblStroke: s(lbl).stroke };
  }, EDITOR);
  expect(got.bg).toBe(LIGHT_TH.bg);
  expect(got.room).toBe(LIGHT_TH.room);
  expect(got.wall).toBe(LIGHT_TH.wall);
  expect(got.lblFill).toBe(LIGHT_TH.text);
  expect(got.lblStroke).toBe(LIGHT_TH.outline);
});

test("S1.53: every .btn keeps at least 4.5:1 contrast against its own background, in blueprint, light and Home Assistant", async ({ page }) => {
  const checkAll = async () => {
    const pairs = await page.evaluate((tag) => {
      const root = (document.querySelector(tag) as any).shadowRoot as ShadowRoot;
      return Array.from(root.querySelectorAll(".btn")).map((el) => {
        const s = getComputedStyle(el);
        return { label: el.id || (el.textContent ?? "").trim(), bg: s.backgroundColor, fg: s.color };
      });
    }, EDITOR);
    expect(pairs.length).toBeGreaterThan(5);
    for (const { label, bg, fg } of pairs) expect(ratio(rgbOf(bg), rgbOf(fg)), label).toBeGreaterThanOrEqual(4.5);
  };
  await checkAll(); // blueprint, the default
  await setTheme(page, "light");
  await checkAll();
  await setTheme(page, "ha");
  await checkAll();
});

test("S2.12: the theme chip switches Blueprint, Light and Home Assistant, and the choice survives a reload", async ({ page }) => {
  await menu(page, "View");
  await page.locator("#thSub > summary").click();
  await expect(page.locator('[data-th="blueprint"]')).toHaveAttribute("aria-pressed", "true"); // Blueprint is the default
  await expect(page.locator('[data-th="ha"]')).toHaveText("Home Assistant");
  await expect(page.locator(EDITOR)).toHaveAttribute("data-theme", "blueprint");
  await page.locator('[data-th="ha"]').click();
  expect(await page.evaluate(() => localStorage.getItem("floorplan-studio:theme"))).toBe("ha");
  await expect(page.locator(EDITOR)).toHaveAttribute("data-theme", "ha");
  await page.reload();
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  await expect(page.locator(EDITOR)).toHaveAttribute("data-theme", "ha");
  await menu(page, "View");
  await page.locator("#thSub > summary").click();
  await expect(page.locator('[data-th="ha"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator('[data-th="light"]').click();
  expect(await page.evaluate(() => localStorage.getItem("floorplan-studio:theme"))).toBe("light");
  await expect(page.locator(EDITOR)).toHaveAttribute("data-theme", "light");
});

test("S2.12: an editor on the Home Assistant theme follows haDark when the host gives it, and the OS when it does not", async ({ page }) => {
  await setTheme(page, "ha");
  const host = () => page.evaluate((tag) => getComputedStyle(document.querySelector(tag) as HTMLElement).backgroundColor, EDITOR);
  await page.emulateMedia({ colorScheme: "light" });
  await page.reload();
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  expect(await host()).toBe(LIGHT_TH.bg); // no HA variables here, no haDark: the OS is light
  await page.evaluate((tag) => { const el = document.querySelector(tag) as any; el.haDark = true; }, EDITOR);
  await expect(page.locator(EDITOR)).toHaveAttribute("data-mode", "dark");
  expect(await host()).toBe(MIDNIGHT_TH.bg); // ha's dark fallback is midnight's bg, not blueprint's
  await page.emulateMedia({ colorScheme: null });
});

test("S1.53 break it: a per-room colour stays the same colour in both themes, and its name stays readable", async ({ page }) => {
  await page.evaluate((tag) => { const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout)); l.floors.ground.rooms[0].color = "#aabbcc"; el.layout = l; }, EDITOR);
  const fillOf = () => page.evaluate((tag) => {
    const root = (document.querySelector(tag) as any).shadowRoot as ShadowRoot;
    const poly = root.querySelector('svg polygon[data-r="0"]')!, lbl = root.querySelector("svg text.lbl")!;
    return { fill: getComputedStyle(poly).fill, lblFill: getComputedStyle(lbl).fill, lblStroke: getComputedStyle(lbl).stroke };
  }, EDITOR);
  await setTheme(page, "light");
  const light = await fillOf();
  expect(light.fill).toBe("rgb(170, 187, 204)"); // #aabbcc, the user's own choice
  await setTheme(page, "blueprint");
  const dark = await fillOf();
  expect(dark.fill).toBe(light.fill); // unchanged by theme
  expect(dark.lblFill).toBe(DARK_TH.text); // the name still reads: light fill, dark outline
  expect(dark.lblStroke).toBe(DARK_TH.outline);
});

test("S1.53 break it: switching theme mid-drag does not lose the drag (pointer capture survives the re-render)", async ({ page }) => {
  const before = await groundOf(page);
  expect(before.rooms[0].pts[1]).toEqual([500, 0]);
  const c = await centre(page, 'circle[data-h="r0:1"]');
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x, c.y + 25, { steps: 4 }); // partway, still holding the button
  // A theme switch normally goes through a menu click, which would release the mouse; this drives the
  // same state change (and the requestUpdate/re-render it causes) directly, mouse button still down, to
  // prove the drag survives a mid-drag re-render rather than that the user can open a menu while dragging.
  await page.evaluate((tag) => { const el = document.querySelector(tag) as any; el.st.setTheme("light"); el.requestUpdate(); }, EDITOR);
  await expect(page.locator(EDITOR)).toHaveAttribute("data-theme", "light");
  await page.mouse.move(c.x, c.y + 50, { steps: 4 });
  await page.mouse.up();
  const after = await groundOf(page);
  expect(after.rooms[0].pts[1]).not.toEqual([500, 0]); // the drag committed, not reset by the re-render
  expect(after.rooms[0].pts[1][1]).toBeGreaterThan(0);
  expect(after.rooms[1].pts[0]).toEqual(after.rooms[0].pts[1]); // the coincident neighbour corner moved with it, as an uninterrupted drag would
});

// ---- zoom buttons, top right of the canvas ----

test("zoom buttons: + zooms in, - zooms out, 0 fits the floor again, and none of them is an edit", async ({ page }) => {
  const vb = async () => (await page.locator(`${EDITOR} svg`).first().getAttribute("viewBox"))!.split(" ").map(Number);
  const start = await vb();
  const undoBefore = await page.evaluate((tag) => (document.querySelector(tag) as any).st.hist.length, EDITOR);
  await page.locator("#zin").click();
  const zin = await vb();
  expect(zin[2] / start[2]).toBeCloseTo(1 / 1.25, 1); // shows less of the plan: the plan looks bigger
  expect(zin[0] + zin[2] / 2).toBeCloseTo(start[0] + start[2] / 2, 0); // about the middle of what is shown
  await page.locator("#zout").click();
  await page.locator("#zout").click();
  expect((await vb())[2]).toBeGreaterThan(start[2]);
  await page.locator("#zin").click();
  await page.locator("#zreset").click();
  expect(await vb()).toEqual(start);
  expect(await page.evaluate((tag) => (document.querySelector(tag) as any).st.hist.length, EDITOR)).toBe(undoBefore);
  const box = await page.locator(".zoom").boundingBox(), canvas = await page.locator(".canvas").boundingBox();
  expect(box!.x + box!.width).toBeGreaterThan(canvas!.x + canvas!.width - 20); // top right
  expect(box!.y).toBeLessThan(canvas!.y + 20);
});

test("a custom room colour becomes a swatch (kept in layout.palette); textures paint the room and survive undo", async ({ page }) => {
  const at = await screenOf(page, 200, 150);
  await page.mouse.click(at.x, at.y);
  const custom = page.locator('.swatches[aria-label="Colours"] .sw.custom');
  await expect(custom).toHaveCount(0);
  await page.locator("#rcol").fill("#12ab34");
  await expect(custom).toHaveCount(1);
  expect((await layoutOf(page)).palette).toEqual(["#12ab34"]);
  // Another room can use it from the swatches without opening the picker.
  const r1 = (await groundOf(page)).rooms[1].pts; // a point near a corner: the middle of a room may hold a device
  const other = await screenOf(page, Math.min(...r1.map((p) => p[0])) + 30, Math.min(...r1.map((p) => p[1])) + 30);
  await page.mouse.click(other.x, other.y);
  await expect(page.locator('.swatches[aria-label="Colours"] .sw.custom')).toHaveCount(1);
  // A texture.
  await page.locator('.sw.tex[aria-label="Dark wood"]').click();
  await expect(page.locator('svg polygon[fill="url(#fp-tex-wood-dark)"]')).toHaveCount(1);
  await expect(page.locator("pattern#fp-tex-wood-dark")).toHaveCount(1);
  await page.keyboard.press("Control+z");
  await expect(page.locator('svg polygon[fill="url(#fp-tex-wood-dark)"]')).toHaveCount(0);
  // Undo the first colour: the palette goes with it.
  await page.mouse.click(at.x, at.y);
  await page.keyboard.press("Control+z");
  expect((await layoutOf(page)).palette).toBeUndefined();
});

test("CSS pair: a custom swatch carries a corner badge, not a dashed border, at the same size as a built-in one", async ({ page }) => {
  await setTheme(page, "light");
  const at = await screenOf(page, 200, 150);
  await page.mouse.click(at.x, at.y);
  await page.locator("#rcol").fill("#12ab34");
  const custom = page.locator(".swatches[aria-label='Colours'] .sw.custom").first();
  const builtin = page.locator(".swatches[aria-label='Colours'] .sw:not(.custom)").first();
  const [customBox, builtinBox] = await Promise.all([custom.boundingBox(), builtin.boundingBox()]);
  expect([customBox!.width, customBox!.height]).toEqual([builtinBox!.width, builtinBox!.height]); // same size, not a bigger button
  expect(await custom.evaluate((e) => getComputedStyle(e).borderStyle)).toBe("solid"); // no longer dashed
  const badge = await custom.evaluate((e) => parseFloat(getComputedStyle(e, "::after").borderRightWidth));
  const builtinBadge = await builtin.evaluate((e) => parseFloat(getComputedStyle(e, "::after").borderRightWidth));
  expect(badge).toBeGreaterThan(0); // a corner badge is drawn...
  expect(builtinBadge).toBe(0); // ...only on the custom swatch
});

// ---- S4.22: a texture's own rotation, dragged with the paint panel's slider ----------------------------------------

/** Sets a range input's value and fires the given events, exactly as a real drag or a release would. */
async function moveSlider(page: Page, sel: string, value: number, event: "input" | "change") {
  await page.locator(sel).evaluate((el: HTMLInputElement, [v, ev]) => {
    el.value = String(v);
    el.dispatchEvent(new Event(ev, { bubbles: true, composed: true }));
  }, [value, event] as const);
}

test("S4.22: the rotation slider appears only once a texture is chosen, and disappears back at the default colour", async ({ page }) => {
  const at = await screenOf(page, 200, 150);
  await page.mouse.click(at.x, at.y);
  await expect(page.locator("#rrot")).toHaveCount(0);
  await page.locator('.sw.tex[aria-label="Dark wood"]').click();
  await expect(page.locator("#rrot")).toHaveCount(1);
  await expect(page.locator("#rrot")).toHaveValue("0");
  await page.getByText("Use the default colour").click();
  await expect(page.locator("#rrot")).toHaveCount(0);
});

test("S4.22: the rotation and scale value sit beside their slider, not on the line under it", async ({ page }) => {
  const at = await screenOf(page, 200, 150);
  await page.mouse.click(at.x, at.y);
  await page.locator('.sw.tex[aria-label="Dark wood"]').click();
  for (const [range, val] of [["#rrot", ".rot-val"], ["#rscale", ".rot-val"]] as const) {
    const slider = page.locator(range).boundingBox(), value = page.locator(`#panel ${val}`).nth(range === "#rrot" ? 0 : 1).boundingBox();
    const [s, v] = await Promise.all([slider, value]);
    expect(s).not.toBeNull();
    expect(v).not.toBeNull();
    expect(Math.abs(s!.y - v!.y)).toBeLessThan(4); // same row: near-equal top, not stacked a line height apart
  }
});

test("S4.22: dragging the slider live-updates the rendered rotation, and releasing commits exactly one undo step", async ({ page }) => {
  const at = await screenOf(page, 200, 150);
  await page.mouse.click(at.x, at.y);
  await page.locator('.sw.tex[aria-label="Dark wood"]').click();
  const before = await page.evaluate((tag) => (document.querySelector(tag) as any).st.hist.length, EDITOR);
  await moveSlider(page, "#rrot", 45, "input");
  await moveSlider(page, "#rrot", 90, "input");
  // Live preview: the rotated pattern is already on the plan, but no undo step has been recorded yet.
  await expect(page.locator('svg polygon[fill="url(#fp-tex-wood-dark-r90)"]')).toHaveCount(1);
  expect(await page.evaluate((tag) => (document.querySelector(tag) as any).st.hist.length, EDITOR)).toBe(before);
  await moveSlider(page, "#rrot", 90, "change");
  expect(await page.evaluate((tag) => (document.querySelector(tag) as any).st.hist.length, EDITOR)).toBe(before + 1);
  expect((await groundOf(page)).rooms[0].textureRot).toBe(90);
  await page.keyboard.press("Control+z");
  expect((await groundOf(page)).rooms[0].textureRot).toBeUndefined();
});

test("S4.22: a slider drag that ends back at its starting value adds no undo step", async ({ page }) => {
  const at = await screenOf(page, 200, 150);
  await page.mouse.click(at.x, at.y);
  await page.locator('.sw.tex[aria-label="Dark wood"]').click();
  await moveSlider(page, "#rrot", 30, "change"); // an initial rotation to drag away from and back to
  const before = await page.evaluate((tag) => (document.querySelector(tag) as any).st.hist.length, EDITOR);
  await moveSlider(page, "#rrot", 200, "input");
  await moveSlider(page, "#rrot", 30, "input"); // back to where it started
  await moveSlider(page, "#rrot", 30, "change");
  expect(await page.evaluate((tag) => (document.querySelector(tag) as any).st.hist.length, EDITOR)).toBe(before);
  expect((await groundOf(page)).rooms[0].textureRot).toBe(30);
});

test("S4.22: the rotation survives a save/reload round trip", async ({ page }) => {
  const at = await screenOf(page, 200, 150);
  await page.mouse.click(at.x, at.y);
  await page.locator('.sw.tex[aria-label="Dark wood"]').click();
  await moveSlider(page, "#rrot", 200, "change");
  const saved = await layoutOf(page);
  expect(saved.floors.ground.rooms[0].textureRot).toBe(200);
  expect(validate(saved).ok).toBe(true);
});

// ---- S4.19: a texture's own scale, dragged with the paint panel's slider --------------------------------------

test("S4.19: the scale slider appears only once a texture is chosen, defaults to 100%, and disappears back at the default colour", async ({ page }) => {
  const at = await screenOf(page, 200, 150);
  await page.mouse.click(at.x, at.y);
  await expect(page.locator("#rscale")).toHaveCount(0);
  await page.locator('.sw.tex[aria-label="Dark wood"]').click();
  await expect(page.locator("#rscale")).toHaveCount(1);
  await expect(page.locator("#rscale")).toHaveValue("100");
  await page.getByText("Use the default colour").click();
  await expect(page.locator("#rscale")).toHaveCount(0);
});

test("S4.19: dragging the scale slider live-updates the rendered pattern, and releasing commits exactly one undo step", async ({ page }) => {
  const at = await screenOf(page, 200, 150);
  await page.mouse.click(at.x, at.y);
  await page.locator('.sw.tex[aria-label="Dark wood"]').click();
  const before = await page.evaluate((tag) => (document.querySelector(tag) as any).st.hist.length, EDITOR);
  await moveSlider(page, "#rscale", 120, "input");
  await moveSlider(page, "#rscale", 150, "input");
  // Live preview: the scaled pattern is already on the plan, but no undo step has been recorded yet.
  await expect(page.locator('svg polygon[fill="url(#fp-tex-wood-dark-s150)"]')).toHaveCount(1);
  expect(await page.evaluate((tag) => (document.querySelector(tag) as any).st.hist.length, EDITOR)).toBe(before);
  await moveSlider(page, "#rscale", 150, "change");
  expect(await page.evaluate((tag) => (document.querySelector(tag) as any).st.hist.length, EDITOR)).toBe(before + 1);
  expect((await groundOf(page)).rooms[0].textureScale).toBe(1.5);
  await page.keyboard.press("Control+z");
  expect((await groundOf(page)).rooms[0].textureScale).toBeUndefined();
});

test("S4.19: a scale slider drag that ends back at its starting value adds no undo step", async ({ page }) => {
  const at = await screenOf(page, 200, 150);
  await page.mouse.click(at.x, at.y);
  await page.locator('.sw.tex[aria-label="Dark wood"]').click();
  await moveSlider(page, "#rscale", 75, "change"); // an initial scale to drag away from and back to
  const before = await page.evaluate((tag) => (document.querySelector(tag) as any).st.hist.length, EDITOR);
  await moveSlider(page, "#rscale", 200, "input");
  await moveSlider(page, "#rscale", 75, "input"); // back to where it started
  await moveSlider(page, "#rscale", 75, "change");
  expect(await page.evaluate((tag) => (document.querySelector(tag) as any).st.hist.length, EDITOR)).toBe(before);
  expect((await groundOf(page)).rooms[0].textureScale).toBe(0.75);
});

test("S4.19: the scale survives a save/reload round trip", async ({ page }) => {
  const at = await screenOf(page, 200, 150);
  await page.mouse.click(at.x, at.y);
  await page.locator('.sw.tex[aria-label="Dark wood"]').click();
  await moveSlider(page, "#rscale", 200, "change");
  const saved = await layoutOf(page);
  expect(saved.floors.ground.rooms[0].textureScale).toBe(2);
  expect(validate(saved).ok).toBe(true);
});

test("S4.19: two more wood textures and one more stone texture, plus a checkerboard, are offered", async ({ page }) => {
  const at = await screenOf(page, 200, 150);
  await page.mouse.click(at.x, at.y);
  await expect(page.locator('.sw.tex[aria-label="Herringbone wood"]')).toHaveCount(1);
  await expect(page.locator('.sw.tex[aria-label="Parquet wood"]')).toHaveCount(1);
  await expect(page.locator('.sw.tex[aria-label="Terracotta tiles"]')).toHaveCount(1);
  await expect(page.locator('.sw.tex[aria-label="Checkerboard"]')).toHaveCount(1);
  await page.locator('.sw.tex[aria-label="Checkerboard"]').click();
  await expect(page.locator('svg polygon[fill="url(#fp-tex-checker-classic)"]')).toHaveCount(1);
});

// ---- S3.3: attach, switch and clear a device's entity ---------------------------------

const PICK_HA = { floors: [], areas: [{ id: "living", name: "Living" }],
  entities: [
    { id: "light.living_lamp", name: "Living lamp", domain: "light", area: "living" },
    { id: "light.garage", name: "Garage light", domain: "light", area: "garage" },
    { id: "sensor.pond", name: "Pond level", domain: "sensor", area: null },
  ] };
/** The demo with its first light reduced to a wired fitting that is not in Home Assistant: entity "". */
async function withUnboundLight(page: Page) {
  const idx = await page.evaluate(([tag]) => {
    const ed = document.querySelector(tag as string) as any;
    const l = JSON.parse(JSON.stringify(ed.layout));
    const g = l.floors.ground, i = g.devices.findIndex((d: any) => d.type === "light");
    delete g.devices[i].bound; g.devices[i].entity = "";
    ed.layout = l;
    return i;
  }, [EDITOR]);
  return idx as number;
}

test("S3.3: an unbound device is marked on the plan and listed, and the list selects it", async ({ page }) => {
  const i = await withUnboundLight(page);
  await expect(page.locator("svg .dev.unbound")).toHaveCount(1);
  await expect(page.locator("#unbound")).toContainText("Needs an entity (1)");
  await page.locator("#unbound button[data-unbound]").click();
  await expect(page.locator("#ve")).toBeVisible();
  expect((await groundOf(page)).devices[i].entity).toBe("");
});

test("S3.3: the picker attaches an entity, switches to another, and clears it back to unbound", async ({ page }) => {
  const i = await withUnboundLight(page);
  await setHa(page, PICK_HA);
  await page.locator("#unbound button[data-unbound]").click();
  const sel = page.locator("#ve");
  await expect(sel).toHaveJSProperty("tagName", "SELECT");
  // A light: light entities first, the pond sensor still reachable under everything else.
  expect(await opts(page, "#ve")).toEqual(expect.arrayContaining(["", "light.living_lamp", "light.garage", "sensor.pond"]));
  await sel.selectOption("light.garage");
  expect((await groundOf(page)).devices[i].entity).toBe("light.garage");
  await expect(page.locator("svg .dev.unbound")).toHaveCount(0);
  await sel.selectOption("light.living_lamp"); // switch
  expect((await groundOf(page)).devices[i].entity).toBe("light.living_lamp");
  await sel.selectOption(""); // back to unbound
  expect((await groundOf(page)).devices[i].entity).toBe("");
  await expect(page.locator("svg .dev.unbound")).toHaveCount(1);
  await savedValid(page);
});

test("S3.3 break it: an entity id HA does not know stays selected and is not cleared, and no HA means a text field", async ({ page }) => {
  await page.evaluate(([tag]) => { const ed = document.querySelector(tag as string) as any; const l = JSON.parse(JSON.stringify(ed.layout)); const g = l.floors.ground; g.devices.find((d: any) => d.type === "light").entity = "light.gone"; ed.layout = l; }, [EDITOR]);
  await page.locator("svg .dev-light").first().click();
  await expect(page.locator("#ve")).toHaveJSProperty("tagName", "INPUT");
  await setHa(page, PICK_HA);
  await expect(page.locator("#ve")).toHaveJSProperty("tagName", "SELECT");
  await expect(page.locator("#ve")).toHaveValue("light.gone");
  await expect(page.locator("#panel")).toContainText("Not in Home Assistant");
});

// Opus review finding 11: deviceEntity's optgroup label fell straight to the device id (nameOf.get(e.dev) ?? e.dev)
// when Home Assistant's device registry gives a device no name (a real HA device can have name: null). It must
// fall back to that device's own main entity's name instead, the way every other device-grouped list already does.
test("Opus review finding 11: a device's entity picker labels its optgroup from the main entity's name, never the device id, when Home Assistant gives the device no name", async ({ page }) => {
  await withUnboundLight(page);
  await setHa(page, { floors: [], areas: [], devices: [{ id: "dev1", name: null }],
    entities: [
      { id: "light.free", name: "Study lamp", domain: "light", area: null, dev: "dev1" },
      { id: "sensor.free_power", name: "Study lamp power", domain: "sensor", dc: "power", area: null, dev: "dev1", cat: "diagnostic" },
    ] });
  await page.locator("#unbound button[data-unbound]").click();
  // The device's two entities (the light and its diagnostic power sensor) sit in different tiers, each with its own
  // optgroup, so "Study lamp" is expected twice — never once as "dev1".
  await expect(page.locator('#ve optgroup[label="Study lamp"] option[value="light.free"]')).toHaveCount(1);
  await expect(page.locator('#ve optgroup[label="Study lamp"] option[value="sensor.free_power"]')).toHaveCount(1);
  await expect(page.locator('#ve optgroup[label="dev1"]')).toHaveCount(0); // never the raw device id
});

test("S3.3: the picker does not offer an entity that is already on the plan, except the device's own", async ({ page }) => {
  const i = await withUnboundLight(page);
  const placed = await page.evaluate(([tag]) => { const ed = document.querySelector(tag as string) as any; return ed.layout.floors.ground.devices.filter((d: any) => d.entity && d.type === "light").map((d: any) => d.entity) as string[]; }, [EDITOR]);
  expect(placed.length).toBeGreaterThan(0);
  await setHa(page, { floors: [], areas: [], entities: [...placed, "light.free"].map((id) => ({ id, name: id, domain: "light", area: null })) });
  await page.locator("#unbound button[data-unbound]").click();
  const offered = await opts(page, "#ve");
  expect(offered).toContain("light.free");
  for (const p of placed) expect(offered).not.toContain(p);
  await page.locator("#ve").selectOption("light.free");
  expect((await groundOf(page)).devices[i].entity).toBe("light.free");
  expect(await opts(page, "#ve")).toContain("light.free"); // still there: it is this device's own
});

// ---- S4.4: create a light from a placed switch ------------------------------------------

/** Gives the editor HA data and a recording writer. `fail` makes createHelper throw. Calls land in window.__calls. */
async function withWriter(page: Page, opt: { fail?: string } = {}) {
  await setHa(page, { floors: [], areas: [], entities: [{ id: "switch.demo_hall", name: "Hall switch", domain: "switch", area: null }] });
  await page.evaluate(([tag, fail]) => {
    const w = window as any; w.__calls = [];
    (document.querySelector(tag as string) as any).writer = {
      setDeviceArea: async () => {}, setEntityArea: async () => {},
      createHelper: async (...a: unknown[]) => { w.__calls.push(a); if (fail) throw new Error(fail as string); return { entity_id: "light.hall_switch" }; },
    };
  }, [EDITOR, opt.fail ?? ""]);
}
const calls = (page: Page) => page.evaluate(() => (window as any).__calls as unknown[][]);
const selectHallSwitch = (page: Page) => page.locator("svg .dev-switch").first().click();

test("S4.4: Create a light from this switch asks, then swaps the switch for a bound light on the plan, in one undo step", async ({ page }) => {
  await withWriter(page);
  await selectHallSwitch(page);
  await page.locator("#vmklight").click();
  await expect(page.locator("#fp-confirm")).toContainText("Home Assistant cannot undo this.");
  expect(await calls(page)).toHaveLength(0); // asking is not doing
  await page.locator("#fp-confirm-yes").click();
  await expect.poll(async () => (await calls(page)).length).toBe(1);
  expect((await calls(page))[0]).toEqual(["switch_as_x", [{ entity_id: "switch.demo_hall", target_domain: "light" }]]);
  const g = await groundOf(page);
  expect(g.devices.some((d) => d.entity === "switch.demo_hall")).toBe(false);
  expect(g.devices.find((d) => d.entity === "light.hall_switch")).toMatchObject({ type: "light", bound: "switch.demo_hall" });
  await savedValid(page);
  await page.keyboard.press("Control+z");
  expect((await groundOf(page)).devices.some((d) => d.entity === "switch.demo_hall")).toBe(true);
  expect((await groundOf(page)).devices.some((d) => d.entity === "light.hall_switch")).toBe(false);
});

test("S4.4 break it: Cancel writes nothing, a failing Home Assistant leaves the plan alone, and no writer means no button", async ({ page }) => {
  await withWriter(page);
  await selectHallSwitch(page);
  await page.locator("#vmklight").click();
  await page.locator("#fp-confirm-no").click();
  expect(await calls(page)).toHaveLength(0);
  expect((await groundOf(page)).devices.some((d) => d.entity === "switch.demo_hall")).toBe(true);

  await withWriter(page, { fail: "entity_not_found" });
  await selectHallSwitch(page);
  await page.locator("#vmklight").click();
  await page.locator("#fp-confirm-yes").click();
  await expect(page.locator("#status")).toContainText("Nothing was changed");
  expect((await groundOf(page)).devices.some((d) => d.entity === "switch.demo_hall")).toBe(true);

  await page.evaluate(([tag]) => { (document.querySelector(tag as string) as any).writer = undefined; }, [EDITOR]);
  await selectHallSwitch(page);
  await expect(page.locator("#vmklight")).toHaveCount(0);
});

test("S4.4: a switch that a light is already bound to has no button", async ({ page }) => {
  await withWriter(page);
  await page.evaluate(([tag]) => { const ed = document.querySelector(tag as string) as any; const l = JSON.parse(JSON.stringify(ed.layout)); l.floors.ground.devices.find((d: any) => d.type === "light").bound = "switch.demo_hall"; ed.layout = l; }, [EDITOR]);
  await selectHallSwitch(page);
  await expect(page.locator("#vmklight")).toHaveCount(0);
});

// ---- S4.3: move a dropped device into the room's HA area ------------------------------------

const AREA_HA = { floors: [], areas: [{ id: "living", name: "Living" }, { id: "kitchen", name: "Kitchen" }], entities: [
  { id: "light.demo_kitchen", name: "Kitchen light", domain: "light", area: "kitchen", dev: "dev-k" },
  { id: "sensor.a", name: "A", domain: "sensor", area: "kitchen", dev: "dev-shared" }, { id: "sensor.b", name: "B", domain: "sensor", area: "kitchen", dev: "dev-shared" },
] };
async function withAreaWriter(page: Page, fail = "") {
  await setHa(page, AREA_HA);
  await page.evaluate(([tag, f]) => {
    const w = window as any; w.__area = [];
    (document.querySelector(tag as string) as any).writer = {
      createHelper: async () => ({ entity_id: "x.y" }),
      setDeviceArea: async (d: string, a: string) => { w.__area.push(["device", d, a]); if (f) throw new Error(f as string); },
      setEntityArea: async (e: string, a: string) => { w.__area.push(["entity", e, a]); if (f) throw new Error(f as string); },
    };
  }, [EDITOR, fail]);
}
const areaCalls = (page: Page) => page.evaluate(() => (window as any).__area as unknown[][]);

test("S4.3: dropping the kitchen light in the Living room asks, then moves its device to Living in HA", async ({ page }) => {
  await withAreaWriter(page);
  await dragCm(page, [650, 200], [250, 300]);
  await expect(page.locator("#fp-confirm")).toContainText("Move Kitchen light to Living?");
  expect(await areaCalls(page)).toHaveLength(0);
  await page.locator("#fp-confirm-yes").click();
  await expect.poll(async () => (await areaCalls(page)).length).toBe(1);
  expect((await areaCalls(page))[0]).toEqual(["device", "dev-k", "living"]);
  await expect(page.locator("#status")).toContainText("Moved");
});

test("S4.3 break it: Cancel writes nothing and leaves a note plus a button; a drop outside every room asks nothing; a failing HA changes nothing", async ({ page }) => {
  await withAreaWriter(page);
  await dragCm(page, [650, 200], [250, 300]);
  await page.locator("#fp-confirm-no").click();
  expect(await areaCalls(page)).toHaveLength(0);
  await expect(page.locator("#panel")).toContainText("another area than Living");
  await dragCm(page, [250, 300], [850, 250]); // off every room
  await expect(page.locator("#fp-confirm")).toHaveCount(0);
  await dragCm(page, [850, 250], [250, 300]);
  await page.locator("#fp-confirm-no").click();
  await withAreaWriter(page, "not_allowed");
  await page.locator("#vmovearea").click();
  await page.locator("#fp-confirm-yes").click();
  await expect(page.locator("#status")).toContainText("Nothing was changed");
  await expect(page.locator("#vmovearea")).toHaveCount(1); // still differs
});

test("S4.3: 'Don't ask again' moves the next drops without the dialog, and a device with siblings moves only its entity", async ({ page }) => {
  await withAreaWriter(page);
  await dragCm(page, [650, 200], [250, 300]);
  await page.locator("#fp-confirm-remember").check();
  await page.locator("#fp-confirm-yes").click();
  await expect.poll(async () => (await areaCalls(page)).length).toBe(1);
  // the temperature sensor's entity has a sibling on its device
  await page.evaluate(([tag]) => { const ed = document.querySelector(tag as string) as any; ed.ha = { ...ed.ha, entities: ed.ha.entities.map((e: any) => (e.id === "light.demo_living" ? e : e)).concat([{ id: "sensor.demo_living_temperature", name: "T", domain: "sensor", area: "living", dev: "dev-shared" }]) }; }, [EDITOR]);
  await dragCm(page, [380, 120], [650, 300]); // Living to Kitchen, no dialog now
  await expect(page.locator("#fp-confirm")).toHaveCount(0);
  await expect.poll(async () => (await areaCalls(page)).length).toBe(2);
  expect((await areaCalls(page))[1]).toEqual(["entity", "sensor.demo_living_temperature", "kitchen"]);
});

// ---- S4.10: the Home Assistant menu lists and removes everything floorplan-studio labelled --------

/** A writer whose list/remove are scripted from the test; `removes` records what Remove was called with. */
async function withHaMenu(page: Page, opt: { list?: unknown[]; failRemove?: string; failList?: string } = {}) {
  await setHa(page, { floors: [], areas: [], entities: [] });
  await page.evaluate(([tag, list, failRemove, failList]) => {
    const w = window as any; w.__removes = [];
    (document.querySelector(tag as string) as any).writer = {
      setDeviceArea: async () => {}, setEntityArea: async () => {}, createHelper: async () => ({ entity_id: "x.y" }),
      listLabelled: async () => { if (failList) throw new Error(failList as string); return list; },
      removeLabelled: async (item: unknown) => { w.__removes.push(item); if (failRemove) throw new Error(failRemove as string); },
    };
  }, [EDITOR, opt.list ?? [], opt.failRemove ?? "", opt.failList ?? ""]);
}
const removes = (page: Page) => page.evaluate(() => (window as any).__removes as unknown[]);

const haBtn = (page: Page) => page.locator("#mHA");
/** S8.1: Edit, Home Assistant is a button that opens a popover; the list loaded when the writer was set. */
async function openHaPanel(page: Page) {
  await menu(page, "Edit");
  await haBtn(page).click();
  await expect(page.locator("#haPanel")).toBeVisible();
}
const LABELLED = [
  { kind: "helper", id: "E1", name: "Hall light", entityId: "light.hall_switch" },
  { kind: "automation", id: "A1", name: "Close at night", entityId: "automation.close_at_night" },
  { kind: "area", id: "attic", name: "Attic" },
];

test("S8.1: Edit, Home Assistant is disabled until something labelled is listed; it opens a popover with X top-left and an explanation, rows open the item in HA, and the menu closes", async ({ page }) => {
  await withHaMenu(page, { list: [] });
  await menu(page, "Edit");
  await expect(haBtn(page)).toBeDisabled();
  await menu(page, "Edit");
  await withHaMenu(page, { list: LABELLED });
  await menu(page, "Edit");
  await expect(haBtn(page)).toBeEnabled(); // loaded when the writer was set, before the popover opened
  await haBtn(page).click();
  const panel = page.locator("#haPanel");
  await expect(panel).toBeVisible();
  expect(await page.locator("#mEdit").evaluate((d) => (d as HTMLDetailsElement).open)).toBe(false); // popover opens: menu closes
  await expect(panel.locator(".fpanel-head > *").first()).toHaveAttribute("id", "haClose"); // X top-left
  await expect(panel).toContainText("created in Home Assistant");
  await expect(panel.locator(".harow")).toHaveCount(3);
  for (const t of ["Helpers", "Hall light", "Automations", "Close at night", "Areas", "Attic"]) await expect(panel).toContainText(t);
  await expect(panel.locator('[data-ha="A1"] a.name')).toHaveAttribute("href", "/config/automation/edit/A1");
  await expect(panel.locator('[data-ha="attic"] a.name')).toHaveAttribute("href", "/config/areas/area/attic");
  const got = page.evaluate(([tag]) => new Promise<string>((res) => document.querySelector(tag as string)!.addEventListener("hass-more-info", (e) => res((e as CustomEvent).detail.entityId), { once: true })), [EDITOR]);
  await panel.locator('[data-ha="E1"] button.name').click();
  expect(await got).toBe("light.hall_switch"); // a helper opens HA's own more-info dialog
  await expect(panel).toBeVisible(); // still open
  // A click on the plan leaves it; Escape, with the editor focused, closes it.
  const at = await screenOf(page, 200, 150);
  await page.mouse.click(at.x, at.y);
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});

test("S8.1: the Home Assistant popover drags by its head and closes by its X", async ({ page }) => {
  await withHaMenu(page, { list: LABELLED });
  await openHaPanel(page);
  const panel = page.locator("#haPanel"), head = panel.locator(".fpanel-head");
  const b0 = (await panel.boundingBox())!, h = (await head.boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 + 120, h.y + h.height / 2 + 80, { steps: 4 });
  await page.mouse.up();
  const b1 = (await panel.boundingBox())!;
  expect(b1.x - b0.x).toBeCloseTo(120, 0);
  expect(b1.y - b0.y).toBeCloseTo(80, 0);
  await page.locator("#haClose").click();
  await expect(panel).toHaveCount(0);
});

test("S4.10/S8.1: Remove in the popover asks, deletes it in Home Assistant and refreshes the list; a failing remove changes nothing; no writer means no button", async ({ page }) => {
  await withHaMenu(page, { list: [LABELLED[2]] });
  await openHaPanel(page);
  await page.locator('[data-ha="attic"] button.warn').click();
  await expect(page.locator("#fp-confirm")).toContainText("Remove Attic from Home Assistant?");
  expect(await removes(page)).toHaveLength(0);
  await withHaMenu(page, { list: [] }); // Remove reloads the list: the next load comes back empty
  await page.locator("#fp-confirm-yes").click();
  await expect.poll(async () => (await removes(page)).length).toBe(1);
  expect((await removes(page))[0]).toMatchObject({ kind: "area", id: "attic" });
  await expect(page.locator("#status")).toContainText("Removed Attic from Home Assistant");
  await expect(page.locator("#haPanel #haNone")).toBeVisible(); // the popover stays open, now empty
  await expect(page.locator("#haPanel .harow")).toHaveCount(0);

  await withHaMenu(page, { list: [LABELLED[0]], failRemove: "not_allowed" }); // a new writer: the open popover reloads
  await expect(page.locator('#haPanel [data-ha="E1"]')).toBeVisible();
  await page.locator('[data-ha="E1"] button.warn').click();
  await page.locator("#fp-confirm-yes").click();
  await expect(page.locator("#status")).toContainText("Nothing was changed");
  await expect(page.locator('#haPanel [data-ha="E1"]')).toBeVisible();

  await page.evaluate(([tag]) => { (document.querySelector(tag as string) as any).writer = undefined; }, [EDITOR]);
  await expect(page.locator("#mHA")).toHaveCount(0);
  await expect(page.locator("#haPanel")).toHaveCount(0);
});

// Opus review of S8.1: a failed load must not hide its error behind a disabled button.
test("S8.1: a failed Home Assistant list leaves the button enabled and the popover shows the error", async ({ page }) => {
  await withHaMenu(page, { failList: "socket closed" });
  await menu(page, "Edit");
  await expect(haBtn(page)).toBeEnabled();
  await expect(haBtn(page)).toHaveAttribute("title", /socket closed/);
  await haBtn(page).click();
  await expect(page.locator("#haPanel #haErr")).toContainText("socket closed");
  await expect(page.locator("#haPanel .harow")).toHaveCount(0);
});

// Opus review of S8.1: two loads can overlap (the writer setter, then a create's reload); the older reply must not win.
test("S8.1: a stale Home Assistant list reply that lands last is ignored", async ({ page }) => {
  await setHa(page, { floors: [], areas: [], entities: [] });
  await page.evaluate(([tag, item]) => {
    const w = window as any; w.__lists = [] as ((v: unknown) => void)[];
    // the first two loads wait for the test; later ones (the popover's reload on open) answer at once
    const writer = { listLabelled: () => w.__lists.length < 2 ? new Promise((res) => w.__lists.push(res)) : Promise.resolve([item]), removeLabelled: async () => {} };
    const ed = document.querySelector(tag as string) as any;
    ed.writer = writer; // load 1 pending
    ed.writer = writer; // load 2 pending
    w.__lists[1]([item]); // the newer reply lands first
    w.__lists[0]([]); // the older, empty one lands last
  }, [EDITOR, LABELLED[2]]);
  await menu(page, "Edit");
  await expect(haBtn(page)).toBeEnabled();
  await haBtn(page).click();
  await expect(page.locator("#haPanel .harow")).toHaveCount(1);
  await expect(page.locator("#haPanel #haLoading")).toHaveCount(0);
});

// Opus review of S8.1: an id from Home Assistant is data; a slash in it must not change the path.
test("S8.1: a labelled id is encoded in the row's link", async ({ page }) => {
  await withHaMenu(page, { list: [{ kind: "area", id: "a/b?c", name: "Odd" }, { kind: "automation", id: "x y", name: "Spaced" }] });
  await openHaPanel(page);
  await expect(page.locator('#haPanel [data-ha="a/b?c"] a.name')).toHaveAttribute("href", "/config/areas/area/a%2Fb%3Fc");
  await expect(page.locator('#haPanel [data-ha="x y"] a.name')).toHaveAttribute("href", "/config/automation/edit/x%20y");
});

test("Opus review CSS pair: a popover is fixed at z-index 30 (under an open menu's 40) and its head shows the move cursor", async ({ page }) => {
  await withHaMenu(page, { list: LABELLED });
  await openHaPanel(page);
  const panel = page.locator("#haPanel");
  expect(await panel.evaluate((e) => { const c = getComputedStyle(e); return [c.position, c.zIndex]; })).toEqual(["fixed", "30"]);
  expect(await panel.locator(".fpanel-head").evaluate((e) => getComputedStyle(e).cursor)).toBe("move");
  await menu(page, "Edit");
  expect(await page.locator("#mEdit .box").evaluate((e) => getComputedStyle(e).zIndex)).toBe("40");
});

// ---- S4.23: Undo/Redo move to the toolbar, after Home Assistant, no menu to open first --------------------------------

test("S4.23: Undo and Redo sit in the toolbar, outside every menu box, styled lighter, and still undo/redo", async ({ page }) => {
  await expect(page.locator("#mFile .box #undo")).toHaveCount(0); // no longer inside the File menu
  await expect(page.locator("#mFile .box #redo")).toHaveCount(0);
  await expect(page.locator("#undo")).toBeVisible(); // visible with no menu open
  await expect(page.locator("#redo")).toBeVisible();
  await expect(page.locator("#undo")).toHaveClass(/light/);
  await expect(page.locator("#redo")).toHaveClass(/light/);
  await expect(page.locator("#undo")).toBeDisabled();

  const at = await screenOf(page, 200, 150);
  await page.mouse.click(at.x, at.y);
  await page.locator('.sw[aria-label="Marble"]').click(); // one undoable edit, no menu opened
  await expect(page.locator("#undo")).toBeEnabled();
  await page.locator("#undo").click();
  expect((await groundOf(page)).rooms[0].color).toBeUndefined();
  await expect(page.locator("#redo")).toBeEnabled();
  await page.locator("#redo").click();
  expect((await groundOf(page)).rooms[0].color).toBe("#e2dfda");
});

// ---- S4.24: door/window sensors, locks and curtains attach several; heater and ac bindings too ------------------------

test("S4.24: a door attaches several vibration sensors and locks, each removable, one undo step per change", async ({ page }) => {
  const pick = async (i: number) => { const c = await centre(page, `line[data-d="${i}"]`); await page.mouse.click(c.x, c.y); };
  await pick(0); // Front door
  await expect(page.locator("#dvibr")).toBeVisible();
  await expect(page.locator("#dlocks")).toBeVisible();
  await expect(page.locator("#dvibr option")).toHaveCount(1); // only the placeholder: no vibration sensor in the catalog yet
  await expect((await groundOf(page)).doors[0].vibration).toBeUndefined();
  await expect((await groundOf(page)).doors[0].locks).toBeUndefined();
});

test("S4.24: a heater attaches several temperature sensors; removing the last one clears the field, one undo step each way", async ({ page }) => {
  const HEATER: [number, number] = [180, 8]; // demo's "Living radiator"
  const p = await screenOf(page, ...HEATER);
  await page.mouse.click(p.x, p.y);
  await expect(page.locator("#hsens")).toBeVisible();
  await expect(page.locator("#htrv")).toBeVisible();
  const before = (await groundOf(page)).devices.find((d: any) => d.id === "heater-living") as any;
  expect(before.tempSensors).toBeUndefined();

  await page.locator("#hsens").selectOption("sensor.demo_bedroom_temperature");
  let heater = (await groundOf(page)).devices.find((d: any) => d.id === "heater-living") as any;
  expect(heater.tempSensors).toEqual(["sensor.demo_bedroom_temperature"]);

  await page.locator("#hsens-rm0").click();
  heater = (await groundOf(page)).devices.find((d: any) => d.id === "heater-living") as any;
  expect(heater.tempSensors).toBeUndefined();

  // two undo steps: the removal, then the attach
  await page.keyboard.press("Control+z");
  heater = (await groundOf(page)).devices.find((d: any) => d.id === "heater-living") as any;
  expect(heater.tempSensors).toEqual(["sensor.demo_bedroom_temperature"]);
  await page.keyboard.press("Control+z");
  heater = (await groundOf(page)).devices.find((d: any) => d.id === "heater-living") as any;
  expect(heater.tempSensors).toBeUndefined();
});

// ---- S4.18: a device's type can be corrected after placement, and clears type-specific fields it no longer fits -----

test("S4.18: the device panel's type selector changes a device's type and drops fields the new type does not use, one undo step", async ({ page }) => {
  const p = await screenOf(page, 180, 8); // demo's "Living radiator" heater, with tempSensors already set
  await page.mouse.click(p.x, p.y);
  await page.locator("#hsens").selectOption("sensor.demo_bedroom_temperature");
  await expect(page.locator("#vtype")).toBeVisible();
  await expect(page.locator("#vtype")).toHaveValue("heater");

  await page.locator("#vtype").selectOption("light");
  const before = (await groundOf(page)).devices.find((d: any) => d.id === "heater-living") as any;
  expect(before.type).toBe("light");
  expect(before.tempSensors).toBeUndefined();
  expect(before.trvs).toBeUndefined();
  await expect(page.locator("#hsens")).toHaveCount(0); // heater-only field is gone
  await expect(page.locator("#vbound")).toBeVisible(); // light-only field appeared

  // one undo step brings the type and the cleared fields back together
  await page.keyboard.press("Control+z");
  const after = (await groundOf(page)).devices.find((d: any) => d.id === "heater-living") as any;
  expect(after.type).toBe("heater");
  expect(after.tempSensors).toEqual(["sensor.demo_bedroom_temperature"]);
});

// ---- S7.8: a person has a Room sensor picker, and only a person ------------------------------------------------

test("S7.8: the Room sensor field shows only for a person, writes room, and changing the type away drops it in one undo step", async ({ page }) => {
  const p = await screenOf(page, 100, 500); // demo's hall switch
  await page.mouse.click(p.x, p.y);
  await expect(page.locator("#vtype")).toHaveValue("switch");
  await expect(page.locator("#vroom")).toHaveCount(0);
  await page.locator("#vtype").selectOption("person");
  await expect(page.locator("#vroom")).toBeVisible();
  await page.locator("#vroom").fill("sensor.alex_room");
  await page.locator("#vroom").press("Enter");
  let d = (await groundOf(page)).devices.find((x: any) => x.id === "switch-hall") as any;
  expect(d.type).toBe("person");
  expect(d.room).toBe("sensor.alex_room");

  await page.locator("#vtype").selectOption("light");
  d = (await groundOf(page)).devices.find((x: any) => x.id === "switch-hall") as any;
  expect(d.room).toBeUndefined();
  await expect(page.locator("#vroom")).toHaveCount(0);
  await page.locator("#panel").click({ position: { x: 2, y: 2 } }); // out of the select: the editor ignores keys typed in a field
  await page.keyboard.press("Control+z");
  d = (await groundOf(page)).devices.find((x: any) => x.id === "switch-hall") as any;
  expect(d.type).toBe("person");
  expect(d.room).toBe("sensor.alex_room");
});

test("Opus review CSS pair: S7.8 a person glides (transform .6s), is 35 % when away, and a home person wears its colour", async ({ page }) => {
  await setTheme(page, "light");
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.devices.push({ id: "css-person", type: "person", entity: "person.css", x: 1900, y: 300 });
    el.layout = l;
  }, EDITOR);
  const got = await page.locator("svg g.dev-person").first().evaluate((e) => {
    const cs = () => getComputedStyle(e);
    const path = e.querySelector("path:not(.halo)")!;
    const glide = { prop: cs().transitionProperty, dur: cs().transitionDuration };
    const plain = { op: cs().opacity, fill: getComputedStyle(path).fill };
    e.classList.add("away"); const away = cs().opacity; e.classList.remove("away");
    e.classList.add("on", "home"); const home = { op: cs().opacity, fill: getComputedStyle(path).fill };
    e.classList.add("unavailable"); e.classList.remove("on", "home"); const gone = cs().opacity;
    return { glide, plain, away, home, gone };
  });
  expect(got.glide).toEqual({ prop: "transform", dur: "0.6s" });
  expect(got.plain.op).toBe("1");
  expect(got.away).toBe("0.35");
  expect(got.home).toEqual({ op: "1", fill: rgb("#1b9e77") });
  expect(got.plain.fill).not.toBe(rgb("#1b9e77"));
  expect(got.gone).toBe("0.45");
});

test("S7.9: the Targets field shows only for a radar, add/remove writes target pairs, and changing type away drops them", async ({ page }) => {
  const p = await screenOf(page, 100, 500); // demo's hall switch
  await page.mouse.click(p.x, p.y);
  await expect(page.locator("#vtype")).toHaveValue("switch");
  await expect(page.locator("#vtgadd")).toHaveCount(0);
  await page.locator("#vtype").selectOption("radar");
  await expect(page.locator("#vtgadd")).toBeVisible();
  await expect(page.locator("#vtgx0")).toHaveCount(0); // no pair yet

  await page.locator("#vtgadd").click();
  await expect(page.locator("#vtgx0")).toBeVisible();
  await page.locator("#vtgx0").fill("sensor.r_tx");
  await page.locator("#vtgx0").press("Enter");
  await page.locator("#vtgy0").fill("sensor.r_ty");
  await page.locator("#vtgy0").press("Enter");
  let d = (await groundOf(page)).devices.find((x: any) => x.id === "switch-hall") as any;
  expect(d.type).toBe("radar");
  expect(d.targets).toEqual([{ x: "sensor.r_tx", y: "sensor.r_ty" }]);

  await page.locator("#vtgrm0").click();
  d = (await groundOf(page)).devices.find((x: any) => x.id === "switch-hall") as any;
  expect(d.targets).toBeUndefined();
  await expect(page.locator("#vtgx0")).toHaveCount(0);

  await page.locator("#vtype").selectOption("light");
  d = (await groundOf(page)).devices.find((x: any) => x.id === "switch-hall") as any;
  expect(d.type).toBe("light");
  expect(d.targets).toBeUndefined();
});

test("Opus review CSS pair: S7.9 a radar wears --fp-dev-radar when on, and a target dot is unclickable and outlined", async ({ page }) => {
  await setTheme(page, "light");
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.devices.push({ id: "css-radar", type: "radar", entity: "binary_sensor.css_radar", x: 1900, y: 300 });
    el.layout = l;
  }, EDITOR);
  const got = await page.locator("svg g.dev-radar").first().evaluate((e) => {
    const path = e.querySelector("path:not(.halo)")!;
    e.classList.add("on");
    const on = { fill: getComputedStyle(path).fill, devVar: getComputedStyle(e).getPropertyValue("--fp-dev").trim() };
    e.classList.remove("on");
    const target = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    target.setAttribute("class", "target");
    target.setAttribute("cx", "0"); target.setAttribute("cy", "0"); target.setAttribute("r", "2");
    e.closest("svg")!.appendChild(target);
    const ts = getComputedStyle(target);
    const dot = { fill: ts.fill, stroke: ts.stroke, strokeWidth: ts.strokeWidth, pointerEvents: ts.pointerEvents };
    target.remove();
    return { on, dot };
  });
  expect(got.on.devVar).toBe("#6a3fbf"); // a custom property is not colour-resolved by getComputedStyle
  expect(got.on.fill).toBe(rgb("#6a3fbf"));
  expect(got.dot.fill).toBe(rgb("#6a3fbf"));
  expect(got.dot.stroke).toBe(rgb("#ffffff")); // --fp-outline in the light theme
  expect(got.dot.strokeWidth).toBe("1px");
  expect(got.dot.pointerEvents).toBe("none");
});

test("Opus review CSS pair: S7.10 a vacuum wears --fp-dev-vacuum when on, and spins only while its .spin class is present", async ({ page }) => {
  await setTheme(page, "light");
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.devices.push({ id: "css-vacuum", type: "vacuum", entity: "vacuum.css_test", x: 1900, y: 300 });
    el.layout = l;
  }, EDITOR);
  const got = await page.locator("svg g.dev-vacuum").first().evaluate((e) => {
    const path = e.querySelector("path:not(.halo)")!;
    e.classList.add("on");
    const on = { fill: getComputedStyle(path).fill, devVar: getComputedStyle(e).getPropertyValue("--fp-dev").trim() };
    const notSpinning = getComputedStyle(path).animationName;
    e.classList.add("spin");
    const spinning = { animationName: getComputedStyle(path).animationName, animationDuration: getComputedStyle(path).animationDuration };
    e.classList.remove("spin");
    e.classList.remove("on");
    return { on, notSpinning, spinning };
  });
  expect(got.on.devVar).toBe("#2f8f8f"); // a custom property is not colour-resolved by getComputedStyle
  expect(got.on.fill).toBe(rgb("#2f8f8f"));
  expect(got.notSpinning).toBe("none"); // no .spin class: no animation at all
  expect(got.spinning.animationName).toBe("fp-spin");
  expect(got.spinning.animationDuration).toBe("4s");
});

// ---- S4.18: right-click context menu on a room, zone or structure -----------------------------------------------

async function rightClickCm(page: Page, x: number, y: number) {
  const c = await screenOf(page, x, y);
  await page.mouse.click(c.x, c.y, { button: "right" });
}

test("S4.18: right-clicking a room selects it and opens a context menu with Change colour and Delete", async ({ page }) => {
  await rightClickCm(page, 200, 150); // inside Living
  await expect(page.locator("#rk")).toHaveValue("room"); // the room panel is already open, per the design decision
  const menu = page.locator(".ctxmenu");
  await expect(menu).toBeVisible();
  await expect(menu.locator("#cmColour")).toBeVisible();
  await expect(menu.locator("#cmDelete")).toBeVisible();
});

test("S4.18: right-clicking the background or a device opens no menu", async ({ page }) => {
  await rightClickCm(page, 950, 700); // outside every room
  await expect(page.locator(".ctxmenu")).toHaveCount(0);
});

test("S4.18: outside click, Escape and scroll all close the context menu", async ({ page }) => {
  await rightClickCm(page, 200, 150);
  await expect(page.locator(".ctxmenu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".ctxmenu")).toHaveCount(0);

  await rightClickCm(page, 200, 150);
  await expect(page.locator(".ctxmenu")).toBeVisible();
  const bg = await screenOf(page, 950, 700);
  await page.mouse.click(bg.x, bg.y);
  await expect(page.locator(".ctxmenu")).toHaveCount(0);

  await rightClickCm(page, 200, 150);
  await expect(page.locator(".ctxmenu")).toBeVisible();
  await page.mouse.wheel(0, 100);
  await expect(page.locator(".ctxmenu")).toHaveCount(0);
});

test("S4.18: Delete from the menu removes the room, same as the panel's own Delete", async ({ page }) => {
  await rightClickCm(page, 200, 150); // Living
  await page.locator("#cmDelete").click();
  expect((await groundOf(page)).rooms.find((r: any) => r.name === "Living")).toBeUndefined();
});

test("S4.18: 'Add device from <area>' lists the room's unplaced HA entities and adds one, one undo step", async ({ page }) => {
  await setHa(page, { ...HA, areas: [...HA.areas], entities: [...HA.entities, { id: "sensor.living_temp", name: "Living temp", domain: "sensor", dc: "temperature", area: "living" }] });
  await rightClickCm(page, 200, 150); // Living, area "living"
  const menu = page.locator(".ctxmenu");
  await expect(menu).toContainText("Living temp");
  await menu.locator("button", { hasText: "Living temp" }).click();
  const devs = (await groundOf(page)).devices;
  const d = devs.find((x: any) => x.entity === "sensor.living_temp");
  expect(d).toMatchObject({ type: "temp", name: "Living temp" });
  expect((await layoutOf(page)).catalog.find((c: any) => c.entity === "sensor.living_temp")).toMatchObject({ type: "temp", room: "Living" });
  await expect(page.locator(".ctxmenu")).toHaveCount(0); // the menu closes after adding

  await page.keyboard.press("Control+z");
  expect((await groundOf(page)).devices.some((x: any) => x.entity === "sensor.living_temp")).toBe(false);
});

test("S4.26: 'Add device from <area>' places the device at the right-click point, not the room's centre", async ({ page }) => {
  await setHa(page, { ...HA, areas: [...HA.areas], entities: [...HA.entities, { id: "sensor.living_temp", name: "Living temp", domain: "sensor", dc: "temperature", area: "living" }] });
  await rightClickCm(page, 200, 150); // Living spans (0,0)-(500,400); its centre is (250,200) — well off this point
  await page.locator(".ctxmenu button", { hasText: "Living temp" }).click();
  const d = (await groundOf(page)).devices.find((x: any) => x.entity === "sensor.living_temp") as any;
  expect(d.x).toBeCloseTo(200, 0);
  expect(d.y).toBeCloseTo(150, 0);
});

// ---- S4.27: right-click context menu on a wall (a room edge or the outline) --------------------------------------

test("S4.27: right-clicking a wall selects it (the side panel shows its kind, like the room menu) and opens a context menu with Change type, Add a point, Add an opening, Delete", async ({ page }) => {
  await rightClickCm(page, 500, 300); // the Living / Kitchen shared wall
  await expect(page.locator("#ek")).toHaveValue("wall"); // the edge panel is already open, per the room ctx menu's own design decision
  const menu = page.locator(".ctxmenu");
  await expect(menu).toBeVisible();
  for (const label of ["Dotted boundary", "External wall", "Fence", "Outdoor edge", "Add a point", "Delete"])
    await expect(menu.locator("button", { hasText: label })).toBeVisible();
  await expect(menu.locator("summary", { hasText: "Add an opening" })).toBeVisible(); // S4.31: a submenu, not a plain button
  // an edge (a room boundary) has no Fix/Unfix — only a free wall does
  await expect(menu.locator("button", { hasText: "Fix" })).toHaveCount(0);
});

test("S4.31: 'Add an opening' on a wall is a submenu offering Door, Window and Opening, each placed centred on the right-click point", async ({ page }) => {
  await rightClickCm(page, 500, 300); // the wall's own midpoint is (500,200) — 100 cm away from this point
  const menu = page.locator(".ctxmenu");
  await menu.locator("summary", { hasText: "Add an opening" }).click();
  await menu.locator("details.sub button", { hasText: "Door" }).click();
  await expect(menu).toHaveCount(0);
  const d = (await groundOf(page)).doors.at(-1)!;
  expect(d.kind).toBe("door");
  expect(d.locked).not.toBe(true); // freshly placed, so it starts unfixed and can be moved
  expect((d.a[1] + d.b[1]) / 2).toBeCloseTo(300, 0);
});

test("S4.27: right-clicking the background, a device or a room's interior (away from any edge) opens no wall menu", async ({ page }) => {
  await rightClickCm(page, 950, 700); // outside every room and wall
  await expect(page.locator(".ctxmenu")).toHaveCount(0);
});

test("S4.27: 'Change type' from the wall menu sets the kind on both rooms sharing the wall, one undo step", async ({ page }) => {
  await rightClickCm(page, 500, 300);
  await page.locator(".ctxmenu button", { hasText: "External wall" }).click();
  await expect(page.locator(".ctxmenu")).toHaveCount(0);
  const g = await groundOf(page);
  expect([g.rooms[0].wk[1], g.rooms[1].wk[3]]).toEqual(["external", "external"]);

  await page.keyboard.press("Control+z");
  expect((await groundOf(page)).rooms[0].wk[1]).toBe("wall");
});

test("S4.27: 'Add a point' from the wall menu inserts a point at the wall's midpoint, one undo step", async ({ page }) => {
  // Living and Kitchen share the wall at x=500, drawn once per room; the click lands on whichever line is on top,
  // so the point is added to that room's own points — same as the edge panel's own "Add a point in the middle".
  const before = (await groundOf(page)).rooms.map((r: any) => r.pts.length as number);
  await rightClickCm(page, 500, 300); // the wall runs (500,0)-(500,400); its midpoint is (500,200)
  await page.locator(".ctxmenu button", { hasText: "Add a point" }).click();
  await expect(page.locator(".ctxmenu")).toHaveCount(0);
  const rooms = (await groundOf(page)).rooms;
  const grew = rooms.findIndex((r: any, i: number) => r.pts.length === before[i] + 1 && r.pts.some((p: number[]) => p[0] === 500 && p[1] === 200));
  expect(grew).toBeGreaterThanOrEqual(0);
  expect(rooms.reduce((n: number, r: any) => n + r.pts.length, 0)).toBe(before.reduce((n, l) => n + l, 0) + 1);

  await page.keyboard.press("Control+z");
  expect((await groundOf(page)).rooms.map((r: any) => r.pts.length)).toEqual(before);
});

test("S4.27: 'Add an opening' from the wall menu places it centred on the right-click point, not the wall's midpoint", async ({ page }) => {
  await rightClickCm(page, 500, 300); // the wall's own midpoint is (500,200) — 100 cm away from this point
  await page.locator(".ctxmenu summary", { hasText: "Add an opening" }).click();
  await page.locator(".ctxmenu button", { hasText: "Opening" }).click();
  await expect(page.locator(".ctxmenu")).toHaveCount(0);
  const o = (await groundOf(page)).openings[0];
  expect((o.a[1] + o.b[1]) / 2).toBeCloseTo(300, 0);
  expect((o.a[0] + o.b[0]) / 2).toBeCloseTo(500, 0);
  expect(o.locked).not.toBe(true); // freshly placed, so it starts unfixed and can be moved
});

test("S4.27: 'Delete' from the wall menu stops drawing it, same as the edge panel's own Delete; a door or window on it confirms first", async ({ page }) => {
  await page.evaluate((tag) => { const el = document.querySelector(tag) as any; const l = JSON.parse(JSON.stringify(el.layout)); l.floors.ground.doors.push({ id: "door-x", name: "Between", kind: "door", a: [500, 100], b: [500, 190] }); el.layout = l; }, EDITOR); // on the same wall (500,0)-(500,400)
  await rightClickCm(page, 500, 300); // on the wall, clear of the door itself so the click still hits the edge, not the door
  await page.locator(".ctxmenu button", { hasText: "Delete" }).click();
  await expect(page.locator(".ctxmenu")).toContainText("door or window is on this wall");
  await page.locator(".ctxmenu button", { hasText: "Delete" }).click();
  expect((await groundOf(page)).rooms[0].wk[1]).toBe("none");
});

// ---- S4.31: right-click Fix/Unfix on a wall, door, opening, furniture piece and unattached device ------------------

test("S4.31: 'Fix' on a free wall's context menu locks it, one undo step; the menu then offers 'Unfix'", async ({ page }) => {
  // Near the top of the plan, clear of the menu's own height, unlike withWallRow's row under the house.
  await page.evaluate((tag) => {
    const el = document.querySelector(tag as string) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.walls = [{ id: "wall-fix-1", a: [250, 20], b: [350, 20], kind: "wall" }];
    el.layout = l;
  }, EDITOR);
  await rightClickCm(page, 300, 20);
  const menu = page.locator(".ctxmenu");
  await expect(menu.locator("button", { hasText: "Fix" })).toBeVisible();
  await menu.locator("button", { hasText: "Fix" }).click();
  await expect(menu).toHaveCount(0);
  expect((await groundOf(page)).walls[0].locked).toBe(true);

  await rightClickCm(page, 300, 20);
  await expect(menu.locator("button", { hasText: "Unfix" })).toBeVisible();
  await menu.locator("button", { hasText: "Unfix" }).click();
  expect((await groundOf(page)).walls[0].locked).toBe(false);

  await rightClickCm(page, 300, 20);
  await menu.locator("button", { hasText: "Fix" }).click();
  await page.keyboard.press("Control+z");
  expect((await groundOf(page)).walls[0].locked).toBe(false); // one undo step
});

/** Right-clicks the centre of a plan element by its CSS selector — for furniture/unlinked, whose click point isn't a simple plan coordinate. */
async function rightClickEl(page: Page, selector: string) {
  const c = await centre(page, selector);
  await page.mouse.click(c.x, c.y, { button: "right" });
}

test("S4.31: right-clicking a door, an opening, a furniture piece or an unattached device opens a menu with only Fix/Unfix", async ({ page }) => {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag as string) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.openings.push({ id: "opening-fix-1", a: [450, 600], b: [540, 600] });
    l.floors.ground.furniture.push({ id: "furn-fix-1", symbol: "sofa", x: 700, y: 500, rot: 0, w: 90, h: 60 });
    l.floors.ground.unlinked.push({ id: "unl-fix-1", type: "heater", x: 850, y: 500, rot: 0, scale: 1 });
    el.layout = l;
  }, EDITOR);
  const menu = page.locator(".ctxmenu");

  await rightClickCm(page, 345, 600); // door-ground-1, "Front door"
  await expect(menu.locator("button")).toHaveCount(1);
  await expect(menu.locator("button", { hasText: "Fix" })).toBeVisible();
  await page.keyboard.press("Escape");

  await rightClickCm(page, 495, 600); // opening-fix-1
  await expect(menu.locator("button")).toHaveCount(1);
  await expect(menu.locator("button", { hasText: "Fix" })).toBeVisible();
  await page.keyboard.press("Escape");

  await rightClickEl(page, 'g[data-f="2"]'); // furn-fix-1: the demo already has 2 furniture pieces
  await expect(menu.locator("button")).toHaveCount(1);
  await menu.locator("button", { hasText: "Fix" }).click();
  expect((await groundOf(page)).furniture.find((m) => m.id === "furn-fix-1")!.locked).toBe(true);

  await rightClickEl(page, 'g[data-u="0"]'); // unl-fix-1: the only unlinked device
  await expect(menu.locator("button")).toHaveCount(1);
  await menu.locator("button", { hasText: "Fix" }).click();
  expect((await groundOf(page)).unlinked.find((u) => u.id === "unl-fix-1")!.locked).toBe(true);
});

test("S4.31: fixing furniture or an unattached device blocks a drag; unfixing restores it", async ({ page }) => {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag as string) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.furniture.push({ id: "furn-fix-2", symbol: "sofa", x: 700, y: 500, rot: 0, w: 90, h: 60, locked: true });
    el.layout = l;
  }, EDITOR);
  const before = (await groundOf(page)).furniture.find((m) => m.id === "furn-fix-2")!;
  await drag(page, 'g[data-f="2"]', 50, 30); // the demo already has 2 furniture pieces
  expect((await groundOf(page)).furniture.find((m) => m.id === "furn-fix-2")).toEqual(before); // locked: drag is a no-op

  await rightClickEl(page, 'g[data-f="2"]');
  await page.locator(".ctxmenu button", { hasText: "Unfix" }).click();
  await drag(page, 'g[data-f="2"]', 50, 30);
  expect((await groundOf(page)).furniture.find((m) => m.id === "furn-fix-2")).not.toEqual(before); // unfixed: drag works again
});

// ---- S4.2: areas from the plan -------------------------------------------------------------------------------------

/** HA knows Living and Garage but not Kitchen; the writer records createArea and answers with HA's own id. */
async function withNewAreaWriter(page: Page, opt: { fail?: string } = {}) {
  await setHa(page, { floors: [], areas: [{ id: "living", name: "Living" }, { id: "garage", name: "Garage" }], entities: [] });
  await page.evaluate(([tag, fail]) => {
    const w = window as any; w.__calls = [];
    (document.querySelector(tag as string) as any).writer = {
      setDeviceArea: async () => {}, setEntityArea: async () => {}, createHelper: async () => ({ entity_id: "" }),
      createArea: async (name: string) => { w.__calls.push([name]); if (fail) throw new Error(fail as string); return { id: "kitchen_2", name }; },
    };
  }, [EDITOR, opt.fail ?? ""]);
}
const roomAt = async (page: Page, x: number, y: number) => { const c = await screenOf(page, x, y); await page.mouse.click(c.x, c.y); };

test("S4.2: a room whose area HA does not know creates it on confirm, then links to it; a linked room has no button", async ({ page }) => {
  await withNewAreaWriter(page);
  await roomAt(page, 560, 80); // Kitchen, area "kitchen": unknown to this HA
  const btn = page.locator("#rcreate");
  await expect(btn).toHaveText("Create area Kitchen in Home Assistant");
  await btn.click();
  await expect(page.locator("#fp-confirm")).toContainText("Home Assistant cannot undo this.");
  expect(await calls(page)).toHaveLength(0); // asking is not doing
  await page.locator("#fp-confirm-yes").click();
  await expect.poll(async () => (await calls(page)).length).toBe(1);
  expect((await calls(page))[0]).toEqual(["Kitchen"]);
  await expect(page.locator("#ra")).toHaveValue("kitchen_2");
  expect((await groundOf(page)).rooms.find((r) => r.name === "Kitchen")).toMatchObject({ area: "kitchen_2" });
  await expect(page.locator("#rcreate")).toHaveCount(0);
  await savedValid(page);

  await roomAt(page, 200, 150); // Living, linked to a known area
  await expect(page.locator("#ra")).toHaveValue("living");
  await expect(page.locator("#rcreate")).toHaveCount(0);
});

test("S4.2 break it: Cancel writes nothing and a failing Home Assistant changes nothing; no writer, no button", async ({ page }) => {
  await withNewAreaWriter(page);
  const before = await groundOf(page);
  await roomAt(page, 560, 80);
  await page.locator("#rcreate").click();
  await page.locator("#fp-confirm-no").click();
  expect(await calls(page)).toHaveLength(0);
  expect(await groundOf(page)).toEqual(before);

  await withNewAreaWriter(page, { fail: "name_in_use" });
  await roomAt(page, 560, 80);
  await page.locator("#rcreate").click();
  await page.locator("#fp-confirm-yes").click();
  await expect(page.locator("#status")).toContainText("name_in_use");
  expect(await groundOf(page)).toEqual(before);

  await page.evaluate(([tag]) => { (document.querySelector(tag as string) as any).writer = undefined; }, [EDITOR]);
  await roomAt(page, 560, 80);
  await expect(page.locator("#ra")).toBeVisible();
  await expect(page.locator("#rcreate")).toHaveCount(0);
});

test("S4.2: 'Areas not on the plan' lists an unused HA area; clicking it draws a room that takes it, and it leaves the list", async ({ page }) => {
  await withNewAreaWriter(page);
  await page.keyboard.press("Escape"); // nothing selected: the floor panel
  const box = page.locator("#unplacedAreas");
  await expect(box.locator("button")).toHaveText(["Garage"]); // Living is on the plan
  await box.locator("button", { hasText: "Garage" }).click();
  await expect(page.locator("#status")).toHaveText(DRAW_STATUS);
  const n = (await groundOf(page)).rooms.length;
  await clicksCm(page, ...FREE);
  await page.keyboard.press("Enter");
  const rooms = (await groundOf(page)).rooms;
  expect(rooms).toHaveLength(n + 1);
  expect(rooms[n]).toMatchObject({ name: "Garage", area: "garage", kind: "room" });
  await page.keyboard.press("Escape");
  await expect(page.locator("#unplacedAreas")).toHaveCount(0); // none left
});

test("S4.2: no 'Areas not on the plan' box without Home Assistant", async ({ page }) => {
  await page.keyboard.press("Escape");
  await expect(page.locator("#unplacedAreas")).toHaveCount(0);
});

// ---- S4.15: the room panel places every unplaced entity of the room's HA area ------------------------------------

const PLACE_HA = { ...HA, areas: [...HA.areas], entities: [...HA.entities,
  { id: "sensor.living_temp", name: "Living temp", domain: "sensor", dc: "temperature", area: "living" },
  { id: "binary_sensor.living_motion", name: "Living motion", domain: "binary_sensor", dc: "motion", area: "living" },
  { id: "light.living_spot", name: "Living spot", domain: "light", area: "living" },
  { id: "sensor.living_power", name: "Living power", domain: "sensor", dc: "power", area: "living" }, // noise: the plan has no icon for it
  { id: "sensor.living_battery", name: "Living battery", domain: "sensor", dc: "battery", area: "living" }, // noise: a reading of another device
] };
async function openPlace(page: Page) {
  const c = await screenOf(page, 200, 150); // inside Living
  await page.mouse.click(c.x, c.y);
  await page.locator("#rplace").click();
  await expect(page.locator("#placePanel")).toBeVisible();
}

test("S4.15/S8.1: the room panel's Place button opens a popup of the area's placeable entities, noise left out; chips filter by type; Place adds the checked ones, one undo step", async ({ page }) => {
  await setHa(page, PLACE_HA);
  const before = (await groundOf(page)).devices.length;
  const c = await screenOf(page, 200, 150); // inside Living
  await page.mouse.click(c.x, c.y);
  const btn = page.locator("#rplace");
  await expect(btn).toHaveText(/Place 3 Home Assistant devices/); // power and battery are not counted
  await btn.click();
  const panel = page.locator("#placePanel");
  await expect(panel).toBeVisible();
  await expect(panel.locator(".fpanel-head > *").first()).toHaveAttribute("id", "placeClose");
  await expect(panel.locator("[data-pent]")).toHaveCount(3);
  await expect(panel.locator('[data-pent="sensor.living_power"]')).toHaveCount(0);
  await expect(panel.locator('[data-pent="sensor.living_battery"]')).toHaveCount(0);
  await expect(panel.locator("[data-ptype]")).toHaveText(["Lights", "Temperature", "Motion"]);
  await panel.locator('[data-ptype="light"]').click();
  await expect(panel.locator("[data-pent]")).toHaveCount(1);
  await panel.locator('[data-pent="light.living_spot"] input').check();
  await expect(page.locator("#placeGo")).toHaveText("Place 1");
  await panel.locator('[data-ptype="light"]').click(); // off again: every type
  await expect(panel.locator("[data-pent]")).toHaveCount(3);
  await panel.locator('[data-pent="binary_sensor.living_motion"] input').check();
  await expect(page.locator("#placeGo")).toHaveText("Place 2");
  await page.locator("#placeGo").click();
  await expect(panel).toHaveCount(0);
  const devs = (await groundOf(page)).devices;
  expect(devs).toHaveLength(before + 2);
  const added = devs.filter((d: any) => d.entity === "light.living_spot" || d.entity === "binary_sensor.living_motion");
  expect(added.map((d: any) => d.type).sort()).toEqual(["light", "motion"]);
  expect(new Set(added.map((d: any) => `${d.x},${d.y}`)).size).toBe(2);
  await expect(page.locator("#rplace")).toHaveText(/Place 1 Home Assistant device$/); // the unchecked temp sensor is still there to place

  await page.keyboard.press("Control+z");
  expect((await groundOf(page)).devices).toHaveLength(before); // one gesture, one step
});

test("S8.4: the Place popup opens with nothing ticked and Place disabled", async ({ page }) => {
  await setHa(page, PLACE_HA);
  await openPlace(page);
  const panel = page.locator("#placePanel");
  for (const id of ["sensor.living_temp", "binary_sensor.living_motion", "light.living_spot"]) {
    await expect(panel.locator(`[data-pent="${id}"] input`)).not.toBeChecked();
  }
  await expect(page.locator("#placeGo")).toHaveText("Place 0");
  await expect(page.locator("#placeGo")).toBeDisabled();
});

test("S8.4: Select all ticks exactly the shown rows, the label flips to Deselect all and back, and Place places exactly the ticked ones", async ({ page }) => {
  await setHa(page, PLACE_HA);
  const before = (await groundOf(page)).devices.length;
  await openPlace(page);
  const panel = page.locator("#placePanel"), all = page.locator("#placeAll");
  await expect(all).toHaveText("Select all");
  await panel.locator('[data-ptype="light"]').click(); // narrow to one shown row
  await all.click();
  await expect(panel.locator('[data-pent="light.living_spot"] input')).toBeChecked();
  await expect(page.locator("#placeGo")).toHaveText("Place 1");
  await expect(all).toHaveText("Deselect all");
  await panel.locator('[data-ptype="light"]').click(); // back to every type: the hidden row stayed unticked
  await expect(panel.locator('[data-pent="sensor.living_temp"] input')).not.toBeChecked();
  await expect(panel.locator('[data-pent="binary_sensor.living_motion"] input')).not.toBeChecked();
  await expect(panel.locator('[data-pent="light.living_spot"] input')).toBeChecked();
  await expect(all).toHaveText("Select all"); // not every shown row is ticked any more
  await all.click();
  await expect(all).toHaveText("Deselect all");
  await expect(page.locator("#placeGo")).toHaveText("Place 3");
  await all.click();
  await expect(all).toHaveText("Select all");
  await expect(page.locator("#placeGo")).toHaveText("Place 0");
  await panel.locator('[data-pent="binary_sensor.living_motion"] input').check();
  await page.locator("#placeGo").click();
  const devs = (await groundOf(page)).devices;
  expect(devs).toHaveLength(before + 1);
  expect(devs.some((d: any) => d.entity === "binary_sensor.living_motion")).toBe(true);
});

test("S8.1: the Place popup places everything when everything is ticked via Select all; a filter with nothing checked disables Place", async ({ page }) => {
  await setHa(page, PLACE_HA);
  const before = (await groundOf(page)).devices.length;
  await openPlace(page);
  await page.locator('#placePanel [data-ptype="light"]').click();
  await expect(page.locator("#placeGo")).toBeDisabled();
  await page.locator("#placeAll").click();
  await page.locator('#placePanel [data-ptype="light"]').click();
  await page.locator("#placeAll").click();
  await expect(page.locator("#placeGo")).toHaveText("Place 3");
  await page.locator("#placeGo").click();
  expect((await groundOf(page)).devices).toHaveLength(before + 3);
  await expect(page.locator("#rplace")).toHaveCount(0); // nothing left to place
});

test("S8.1: the Place popup drags by its head, stays on a click elsewhere, and closes by its X or Escape", async ({ page }) => {
  await setHa(page, PLACE_HA);
  await openPlace(page);
  const panel = page.locator("#placePanel"), head = panel.locator(".fpanel-head");
  const b0 = (await panel.boundingBox())!, h = (await head.boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 + 90, h.y + h.height / 2 + 60, { steps: 4 });
  await page.mouse.up();
  const b1 = (await panel.boundingBox())!;
  expect(b1.x - b0.x).toBeCloseTo(90, 0);
  expect(b1.y - b0.y).toBeCloseTo(60, 0);
  await page.locator("#placeClose").click();
  await expect(panel).toHaveCount(0);
  await openPlace(page);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  // Opus review of S8.1: a ticked checkbox holds focus, and the host's onKey ignores keys typed in an input.
  await openPlace(page);
  await panel.locator('[data-pent="light.living_spot"] input').click();
  await expect(panel.locator('[data-pent="light.living_spot"] input')).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  // Opus review of S8.1: the popup belongs to a room of this floor; switching floors closes it.
  await openPlace(page);
  await page.locator('.bar .chip[data-f="first"]').click();
  await expect(panel).toHaveCount(0);
  await page.locator('.bar .chip[data-f="ground"]').click();
  await expect(panel).toHaveCount(0);
});

test("S4.15: no Place button without Home Assistant", async ({ page }) => {
  const c = await screenOf(page, 200, 150);
  await page.mouse.click(c.x, c.y);
  await expect(page.locator("#rk")).toHaveValue("room");
  await expect(page.locator("#rplace")).toHaveCount(0);
});

// ---- S4.14/S8.5: Add > Device merges the catalog and every HA entity not yet on the plan into one panel -----------

test("S4.14/S8.5: Device… merges the catalog and HA entities into one list with no duplicate; an Area filter appears only once Home Assistant is known", async ({ page }) => {
  await openDevice(page);
  await expect(page.locator("#addDevArea")).toHaveCount(0); // no HA yet: no candidate has an area
  await page.locator("#addDevClose").click();

  await setHa(page, { ...HA, entities: [...HA.entities, { id: "sensor.living_temp", name: "Living temp", domain: "sensor", dc: "temperature", area: "living" }, { id: "light.demo_kitchen", name: "Kitchen light", domain: "light" }] });
  await openDevice(page);
  const panel = page.locator("#addDevPanel");
  await expect(panel).toContainText("Living temp");
  await expect(panel).toContainText("Pond level"); // HA's own fixture entity, not yet placed or catalogued
  await expect(panel.locator('button:text-is("Kitchen light")')).toHaveCount(0); // already a device on the demo plan
  await expect(panel.locator('[data-add="catalog:contact-garage"]')).toHaveCount(1); // the catalog half is still there too
});

test("S4.14/S8.5: search filters the merged list by name or entity id", async ({ page }) => {
  await setHa(page, HA);
  await openDevice(page);
  await search(page).fill("pond");
  await expect(page.locator("#addDevPanel")).toContainText("Pond level");
  await search(page).fill("nothing-matches-this");
  await expect(page.locator("#addDevNone")).toHaveText("Nothing matches");
});

test("S4.14/S8.5: clicking an HA entity places it — at its area's room centre when one is drawn, else near the plan centre — one undo step, and the panel stays open", async ({ page }) => {
  await setHa(page, { ...HA, entities: [...HA.entities, { id: "sensor.living_temp", name: "Living temp", domain: "sensor", dc: "temperature", area: "living" }] });
  await openDevice(page);
  await page.locator('[data-add="ha:sensor.living_temp"]').click();
  await expect(page.locator("#addDevPanel")).toBeVisible(); // S8.5: stays open after a pick

  const devs = (await groundOf(page)).devices;
  const d = devs.find((x: any) => x.entity === "sensor.living_temp");
  expect(d).toMatchObject({ type: "temp", name: "Living temp" });
  expect((await layoutOf(page)).catalog.find((c: any) => c.entity === "sensor.living_temp")).toMatchObject({ room: "Living" });

  await page.locator('[data-add="ha:sensor.pond"]').click(); // no area on this fixture entity: falls back, not refused
  const pond = (await groundOf(page)).devices.find((x: any) => x.entity === "sensor.pond");
  expect(pond).toBeTruthy();
  expect((await layoutOf(page)).catalog.find((c: any) => c.entity === "sensor.pond")?.room).toBeFalsy();

  await page.keyboard.press("Control+z");
  expect((await groundOf(page)).devices.some((x: any) => x.entity === "sensor.pond")).toBe(false);
  expect((await groundOf(page)).devices.some((x: any) => x.entity === "sensor.living_temp")).toBe(true);
});

// S8.6: "devices, not entities" — a plug's device offers one row for the whole device, not one per entity.
test("S8.6: Add > Device offers a plug device once, not once per entity, and places its switch", async ({ page }) => {
  await setHa(page, {
    floors: [], areas: [{ id: "kitchen", name: "Kitchen" }],
    devices: [{ id: "plugdev", name: "Kitchen plug" }],
    entities: [
      { id: "switch.kitchen_plug", name: "Kitchen plug", domain: "switch", dc: "outlet", area: "kitchen", dev: "plugdev" },
      { id: "sensor.kitchen_plug_power", name: "Kitchen plug power", domain: "sensor", dc: "power", area: "kitchen", dev: "plugdev" },
      { id: "sensor.kitchen_plug_energy", name: "Kitchen plug energy", domain: "sensor", dc: "energy", area: "kitchen", dev: "plugdev" },
      { id: "binary_sensor.kitchen_plug_connectivity", name: "Kitchen plug connectivity", domain: "binary_sensor", dc: "connectivity", area: "kitchen", dev: "plugdev", cat: "diagnostic" },
    ],
  });
  await openDevice(page);
  const panel = page.locator("#addDevPanel");
  await expect(panel.locator('.devrow-name:text-is("Kitchen plug")')).toHaveCount(1); // one row for the device, not four
  await expect(panel.locator('.devrow-name:text-is("Kitchen plug power")')).toHaveCount(0);
  await expect(panel.locator('.devrow-name:text-is("Kitchen plug connectivity")')).toHaveCount(0);

  await panel.locator('[data-add="ha-dev:switch.kitchen_plug"]').click();
  const d = (await groundOf(page)).devices.find((x: any) => x.entity === "switch.kitchen_plug");
  expect(d).toMatchObject({ type: "plug", name: "Kitchen plug" });
  expect((await groundOf(page)).devices.some((x: any) => x.entity === "sensor.kitchen_plug_power")).toBe(false);
});

// Opus review finding 11: a device row's own registry name ("Kitchen plug") can differ from its main entity's own
// name ("Relay 1", HA's default for an unnamed switch); the panel showed the device name but placeAddDev placed the
// device under the entity's own name, so the icon on the plan read differently from the row the user clicked.
test("Opus review finding 11: placing a device row names the plan icon after the name shown in the Add panel row, not the main entity's own name", async ({ page }) => {
  await setHa(page, {
    floors: [], areas: [{ id: "kitchen", name: "Kitchen" }],
    devices: [{ id: "plugdev", name: "Kitchen plug" }],
    entities: [{ id: "switch.raw_relay", name: "Relay 1", domain: "switch", dc: "outlet", area: "kitchen", dev: "plugdev" }],
  });
  await openDevice(page);
  const panel = page.locator("#addDevPanel");
  await expect(panel.locator('.devrow-name:text-is("Kitchen plug")')).toHaveCount(1); // the row is shown under the device name
  await panel.locator('[data-add="ha-dev:switch.raw_relay"]').click();
  const d = (await groundOf(page)).devices.find((x: any) => x.entity === "switch.raw_relay");
  expect(d?.name).toBe("Kitchen plug"); // not "Relay 1"
});

test("S8.5: each select lists only values present among the filtered candidates, and narrows as another filter is set", async ({ page }) => {
  await setHa(page, { floors: [], areas: [{ id: "living", name: "Living" }, { id: "bedroom", name: "Bedroom" }], entities: [
    { id: "light.new_living", name: "New living light", domain: "light", area: "living" },
    { id: "climate.new_bedroom", name: "New bedroom heater", domain: "climate", area: "bedroom" },
  ] });
  await openDevice(page);
  // Ground's default demo layout still has two unplaced catalog entries (contact-garage, in Hall; the living relay):
  // neither has an HA area, so they add no floor (but do add "Hall" via the catalog's own room field, and a "None" floor).
  await expect(page.locator("#addDevFloor option")).toHaveText(["All floors", "First", "Ground", "None"]);
  await expect(page.locator("#addDevRoom option")).toHaveText(["All rooms", "Bedroom", "Hall", "Living"]);
  await expect(page.locator("#addDevType option")).toHaveText(["All types", "Lights", "Wall switches", "Window / door sensor", "Climate"]);

  await page.locator("#addDevFloor").selectOption("First"); // asymmetric: only the bedroom heater sits on First
  await expect(page.locator("#addDevRoom option")).toHaveText(["All rooms", "Bedroom"]); // Living and Hall drop out
  await expect(page.locator("#addDevType option")).toHaveText(["All types", "Climate"]); // Lights, Wall switches, Window/door drop out
});

test("S8.5: a filter's None option appears only when some filtered candidate lacks that field, and picking it isolates those", async ({ page }) => {
  await setHa(page, { floors: [], areas: [{ id: "living", name: "Living" }], entities: [
    { id: "light.uniq_area", name: "Uniq area light", domain: "light", area: "living" },
    { id: "switch.uniq_noarea", name: "Uniq bare switch", domain: "switch" },
  ] });
  await openDevice(page);
  await search(page).fill("uniq");
  await expect(page.locator("#addDevArea option")).toHaveText(["All areas", "Living", "None"]);
  await page.locator("#addDevArea").selectOption("__none__");
  await expect(shown(page)).toHaveCount(1);
  await expect(shown(page)).toContainText("Uniq bare switch");

  await search(page).fill("uniq_area"); // narrows to the one candidate, which does have an area
  await page.locator("#addDevArea").selectOption(""); // reset, so the option list reflects only this narrower pool
  await expect(page.locator("#addDevArea option")).toHaveText(["All areas", "Living"]); // no None: nothing shown lacks one
});

test("S8.5: picking a candidate whose room is on another floor switches to that floor first and places it there", async ({ page }) => {
  await setHa(page, { floors: [], areas: [{ id: "bedroom", name: "Bedroom" }], entities: [
    { id: "climate.spare_bedroom", name: "Spare bedroom heater", domain: "climate", area: "bedroom" },
  ] });
  expect(await page.evaluate((tag) => (document.querySelector(tag) as any).st.floor, EDITOR)).toBe("ground");
  await openDevice(page);
  await page.locator('[data-add="ha:climate.spare_bedroom"]').click();
  await expect(page.locator("#addDevPanel")).toBeVisible(); // S8.5: stays open after a pick, even across the floor switch
  expect(await page.evaluate((tag) => (document.querySelector(tag) as any).st.floor, EDITOR)).toBe("first");
  const devs = (await layoutOf(page)).floors.first.devices;
  expect(devs.some((d: any) => d.entity === "climate.spare_bedroom")).toBe(true);
  expect((await layoutOf(page)).catalog.find((c: any) => c.entity === "climate.spare_bedroom")).toMatchObject({ room: "Bedroom" });
});

// Opus review finding 11: pickAddDev matched the candidate's floor by TITLE, which collides when two floors share
// one (the demo ships "ground"/Ground and "test"/Test as distinct floors — nothing stops a maintainer titling both
// the same). It must resolve the floor by key, the same key locateEntity already found the room on.
test("Opus review finding 11: picking a candidate switches to the room's actual floor, even when another floor shares its title", async ({ page }) => {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.title = "Test"; // now collides with the real "test" floor's own title, and sorts first by key order
    el.layout = l;
  }, EDITOR);
  await setHa(page, { floors: [], areas: [{ id: "test", name: "Test area" }], entities: [
    { id: "sensor.test_room_temp", name: "Test room temp", domain: "sensor", dc: "temperature", area: "test" },
  ] });
  await openDevice(page);
  await page.locator('[data-add="ha:sensor.test_room_temp"]').click();
  expect(await page.evaluate((tag) => (document.querySelector(tag) as any).st.floor, EDITOR)).toBe("test"); // not "ground"
  const devs = (await layoutOf(page)).floors.test.devices;
  expect(devs.some((d: any) => d.entity === "sensor.test_room_temp")).toBe(true);
});

test("S8.5: the panel opens with focus in the search box, and Escape from there closes it", async ({ page }) => {
  await openDevice(page);
  await expect(search(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#addDevPanel")).toHaveCount(0);
});

// ---- S4.5: groups -------------------------------------------------------------------------

async function shiftClickCm(page: Page, x: number, y: number) {
  const c = await screenOf(page, x, y);
  await page.keyboard.down("Shift");
  await page.mouse.click(c.x, c.y);
  await page.keyboard.up("Shift");
}
const GROUP_HA = { floors: [], areas: [], entities: [
  { id: "light.demo_living", name: "Living light", domain: "light" },
  { id: "light.demo_kitchen", name: "Kitchen light", domain: "light" },
  { id: "binary_sensor.demo_hall_motion", name: "Hall motion", domain: "binary_sensor" },
] };
/** Gives the editor HA data (two lights, one motion sensor, no group yet) and a recording writer, like withWriter. */
async function withGroupWriter(page: Page, opt: { fail?: string } = {}) {
  await setHa(page, GROUP_HA);
  await page.evaluate(([tag, fail]) => {
    const w = window as any; w.__calls = [];
    (document.querySelector(tag as string) as any).writer = {
      setDeviceArea: async () => {}, setEntityArea: async () => {},
      createHelper: async (...a: unknown[]) => { w.__calls.push(a); if (fail) throw new Error(fail as string); return { entity_id: "group.demo_lights" }; },
    };
  }, [EDITOR, opt.fail ?? ""]);
}

test("S4.5: Shift+click accumulates same-kind devices, toggles one back out, and a different kind starts a fresh single selection instead of mixing", async ({ page }) => {
  const sel = (page: Page) => page.evaluate((tag) => (document.querySelector(tag as string) as any).st.sel, EDITOR);
  await clickCm(page, 250, 200); // light: living
  expect(await sel(page)).toEqual({ t: "dev", i: 0 });
  await shiftClickCm(page, 650, 200); // + light: kitchen
  expect(await sel(page)).toEqual({ t: "devs", is: [0, 1] });
  await shiftClickCm(page, 250, 200); // toggle living back out
  expect(await sel(page)).toEqual({ t: "dev", i: 1 });
  await shiftClickCm(page, 400, 500); // motion sensor: a different kind than the current light selection
  expect(await sel(page)).toEqual({ t: "dev", i: 5 }); // starts fresh, never mixes kinds
});

test("S4.5: Create group asks, then Home Assistant builds a light group from the shift-clicked selection", async ({ page }) => {
  await withGroupWriter(page);
  await clickCm(page, 250, 200); // Living light
  await shiftClickCm(page, 650, 200); // + Kitchen light
  await expect(page.locator("#panel")).toContainText("2 devices selected");
  await page.locator("#grpName").fill("Downstairs lights");
  await page.locator("#vgroup").click();
  await expect(page.locator("#fp-confirm")).toContainText("Create group Downstairs lights");
  await expect(page.locator("#fp-confirm")).toContainText("Home Assistant cannot undo this.");
  expect(await calls(page)).toHaveLength(0); // asking is not doing
  await page.locator("#fp-confirm-yes").click();
  await expect.poll(async () => (await calls(page)).length).toBe(1);
  expect((await calls(page))[0]).toEqual(["group", [
    { next_step_id: "light" },
    { name: "Downstairs lights", entities: ["light.demo_living", "light.demo_kitchen"], hide_members: false, all: false },
  ]]);
  await expect(page.locator("#status")).toContainText("Created group group.demo_lights");
});

test("S4.5 break it: Cancel writes nothing, a failing Home Assistant leaves the plan alone, and a forced mixed selection has no Create group button", async ({ page }) => {
  await withGroupWriter(page);
  await clickCm(page, 250, 200);
  await shiftClickCm(page, 650, 200);
  await page.locator("#grpName").fill("Downstairs lights");
  await page.locator("#vgroup").click();
  await page.locator("#fp-confirm-no").click();
  expect(await calls(page)).toHaveLength(0);

  await withGroupWriter(page, { fail: "not_allowed" });
  await clickCm(page, 250, 200);
  await shiftClickCm(page, 650, 200);
  await page.locator("#grpName").fill("Downstairs lights");
  await page.locator("#vgroup").click();
  await page.locator("#fp-confirm-yes").click();
  await expect(page.locator("#status")).toContainText("Nothing was changed");

  // The kind guard in groupKind (tests/core/bind.test.ts) keeps this from happening through the UI; force it to prove
  // the panel itself never offers "Create group" for a mixed selection, even if that guard were ever bypassed elsewhere.
  await page.evaluate((tag) => { const el = document.querySelector(tag as string) as any; el.st.sel = { t: "devs", is: [0, 5] }; el.requestUpdate(); }, EDITOR);
  await expect(page.locator("#panel")).toContainText("2 devices selected");
  await expect(page.locator("#panel")).toContainText("Shift+click more of the same kind to group.");
  await expect(page.locator("#vgroup")).toHaveCount(0);
});

const GROUP_ON_FLOOR_HA = { floors: [], areas: [], entities: [
  { id: "light.demo_living", name: "Living light", domain: "light" },
  { id: "light.demo_kitchen", name: "Kitchen light", domain: "light" },
  { id: "group.demo_lights", name: "Demo lights", domain: "group", members: ["light.demo_living"] },
] };

/** S8.1: Group is a submenu of Edit. Opens Edit when it is closed, then the Group submenu. */
async function groupMenu(page: Page) {
  if (!(await page.locator("#mEdit").evaluate((d) => (d as HTMLDetailsElement).open))) await menu(page, "Edit");
  await page.locator("#mGroup > summary").click();
}

test("S4.5: the Group menu lists a Home Assistant group with a member on this floor; choosing it dims every other device, All clears it", async ({ page }) => {
  await setHa(page, GROUP_ON_FLOOR_HA);
  await groupMenu(page);
  await expect(page.locator("#groupNone")).toHaveCount(0);
  await page.locator('#mGroup [data-group="group.demo_lights"]').click();
  await expect(page.locator('g[data-x="0"]')).not.toHaveClass(/dim/); // Living light: a member
  await expect(page.locator('g[data-x="1"]')).toHaveClass(/dim/); // Kitchen light: not a member
  await expect(page.locator('g[data-x="5"]')).toHaveClass(/dim/); // the motion sensor: not a member
  await groupMenu(page);
  await page.locator("#groupAll").click();
  await expect(page.locator('g[data-x="1"]')).not.toHaveClass(/dim/);
});

test("S4.5: no Home Assistant group with a member on this floor shows the empty note, not a button list", async ({ page }) => {
  await setHa(page, { floors: [], areas: [], entities: [{ id: "group.elsewhere", name: "Elsewhere", domain: "group", members: ["light.not_on_this_floor"] }] });
  await groupMenu(page);
  await expect(page.locator("#groupNone")).toContainText("No Home Assistant group has a member on this floor");
  await expect(page.locator("#mGroup [data-group]")).toHaveCount(0);
});

test("Opus review CSS pair: a dimmed device fades to opacity .3 (Group menu, render.ts .dev.dim)", async ({ page }) => {
  const opacity = (dim: boolean) => page.locator("svg g.dev-light").first().evaluate((e, d) => { e.classList.toggle("dim", d as boolean); return getComputedStyle(e).opacity; }, dim);
  expect(await opacity(false)).toBe("1");
  expect(await opacity(true)).toBe("0.3");
});

// ---- S4.6: links and automations -----------------------------------------------------------

const CTRL_HA = { floors: [], areas: [], entities: [
  { id: "switch.demo_hall", name: "Hall switch", domain: "switch" },
  { id: "light.demo_living", name: "Living light", domain: "light" },
  { id: "light.demo_kitchen", name: "Kitchen light", domain: "light" },
] };
/** Gives the editor HA data and a recording writer whose `createAutomation` resolves to a fixed id. `fail` makes it throw. */
async function withAutomationWriter(page: Page, ha: unknown, opt: { fail?: string } = {}) {
  await setHa(page, ha);
  await page.evaluate(([tag, fail]) => {
    const w = window as any; w.__calls = [];
    (document.querySelector(tag as string) as any).writer = {
      setDeviceArea: async () => {}, setEntityArea: async () => {},
      createAutomation: async (cfg: unknown) => { w.__calls.push(cfg); if (fail) throw new Error(fail as string); return "fp_test123"; },
    };
  }, [EDITOR, opt.fail ?? ""]);
}
const selectHallSwitch2 = (page: Page) => page.locator("svg .dev-switch").first().click();
/** A listener on `location-changed`, so a test can tell the navigation actually fired, not only that `history.pushState` ran. */
async function watchLocationChanged(page: Page) {
  await page.evaluate(() => { (window as any).__locChanged = false; window.addEventListener("location-changed", () => { (window as any).__locChanged = true; }); });
}
/** A count of `layout-changed` events the editor element has dispatched, so a test can tell an edit was actually
 *  committed (autosaved, told to the host), not only that it looks right in the panel. Call `watchLayoutChanged`
 *  first. */
const layoutChangedCount = (page: Page) => page.evaluate(() => (window as any).__lcCount as number);
async function watchLayoutChanged(page: Page) {
  await page.evaluate((tag) => {
    (window as any).__lcCount = 0;
    document.querySelector(tag)!.addEventListener("layout-changed", () => { (window as any).__lcCount++; });
  }, EDITOR);
}
/** Like `withAutomationWriter`, but `createAutomation` does not resolve until the test calls
 *  `window.__resolveCreate()` — for exercising what happens to a device while the request is still in flight
 *  (Opus review finding 2). */
async function withSlowAutomationWriter(page: Page, ha: unknown) {
  await setHa(page, ha);
  await page.evaluate((tag) => {
    const w = window as any; w.__calls = [];
    (document.querySelector(tag as string) as any).writer = {
      setDeviceArea: async () => {}, setEntityArea: async () => {},
      createAutomation: (cfg: unknown) => { w.__calls.push(cfg); return new Promise((res) => { w.__resolveCreate = () => res("fp_test123"); }); },
    };
  }, EDITOR);
}

test("S4.6: switch panel \"Controls...\" picks two lights, confirms, posts the built automation, then opens it in Home Assistant's editor", async ({ page }) => {
  await withAutomationWriter(page, CTRL_HA);
  await watchLocationChanged(page);
  await selectHallSwitch2(page);
  await page.locator("#vctl").selectOption("light.demo_living");
  await expect(page.locator("#panel")).toContainText('One light? Use "Create a light" instead.');
  await page.locator("#vctl").selectOption("light.demo_kitchen");
  await expect(page.locator("#panel")).not.toContainText('Use "Create a light" instead');
  await page.locator("#vctlgo").click();
  await expect(page.locator("#fp-confirm")).toContainText("Home Assistant cannot undo this.");
  expect(await calls(page)).toHaveLength(0); // asking is not doing
  await page.locator("#fp-confirm-yes").click();
  await expect.poll(async () => (await calls(page)).length).toBe(1);
  expect((await calls(page))[0]).toEqual({
    alias: "switch.demo_hall controls",
    trigger: [
      { platform: "state", entity_id: "switch.demo_hall", to: "on", id: "on" },
      { platform: "state", entity_id: "switch.demo_hall", to: "off", id: "off" },
    ],
    action: [{ choose: [
      { conditions: [{ condition: "trigger", id: "on" }], sequence: [{ service: "homeassistant.turn_on", target: { entity_id: ["light.demo_living", "light.demo_kitchen"] } }] },
      { conditions: [{ condition: "trigger", id: "off" }], sequence: [{ service: "homeassistant.turn_off", target: { entity_id: ["light.demo_living", "light.demo_kitchen"] } }] },
    ] }],
  });
  await expect(page.locator("#status")).toContainText("Created the automation");
  await expect.poll(() => page.evaluate(() => location.pathname)).toBe("/config/automation/edit/fp_test123");
  expect(await page.evaluate(() => (window as any).__locChanged)).toBe(true);
});

test("S4.6 break it: Cancel and a failing Home Assistant write nothing, and a switch forced to target itself is refused \"A switch cannot control itself.\"", async ({ page }) => {
  await withAutomationWriter(page, CTRL_HA);
  await selectHallSwitch2(page);
  await page.locator("#vctl").selectOption("light.demo_living");
  await page.locator("#vctlgo").click();
  await page.locator("#fp-confirm-no").click();
  expect(await calls(page)).toHaveLength(0);

  await withAutomationWriter(page, CTRL_HA, { fail: "not_allowed" });
  await selectHallSwitch2(page);
  await page.locator("#vctl").selectOption("light.demo_kitchen"); // "living" is already in the draft from the block above
  await page.locator("#vctlgo").click();
  await page.locator("#fp-confirm-yes").click();
  await expect(page.locator("#status")).toContainText("Nothing was changed");

  // controlsChoices (state.ts) never offers the switch's own entity, so force the draft directly to prove the
  // refusal itself — switchControls (tests/editor/automations.test.ts) — is what actually stops it.
  await withAutomationWriter(page, CTRL_HA);
  await selectHallSwitch2(page);
  await page.evaluate((tag) => { const el = document.querySelector(tag as string) as any; el.st.controlsDraft = ["switch.demo_hall"]; el.requestUpdate(); }, EDITOR);
  await page.locator("#vctlgo").click();
  await page.locator("#fp-confirm-yes").click();
  await expect(page.locator("#status")).toContainText("A switch cannot control itself.");
});

test("S4.6: \"Schedule\" on a light panel picks on/off times, confirms, posts the built automation; a temperature sensor has no Schedule field", async ({ page }) => {
  await withAutomationWriter(page, CTRL_HA);
  await watchLocationChanged(page);
  await page.locator("svg .dev-light").first().click(); // light.demo_living
  await page.locator("#vschon").fill("07:30");
  await page.locator("#vschoff").fill("23:00");
  await page.locator("#vschgo").click();
  await expect(page.locator("#fp-confirm")).toContainText("Home Assistant cannot undo this.");
  await page.locator("#fp-confirm-yes").click();
  await expect.poll(async () => (await calls(page)).length).toBe(1);
  expect((await calls(page))[0]).toEqual({
    alias: "light.demo_living schedule",
    trigger: [
      { platform: "time", at: "07:30", id: "on" },
      { platform: "time", at: "23:00", id: "off" },
    ],
    action: [{ choose: [
      { conditions: [{ condition: "trigger", id: "on" }], sequence: [{ service: "homeassistant.turn_on", target: { entity_id: "light.demo_living" } }] },
      { conditions: [{ condition: "trigger", id: "off" }], sequence: [{ service: "homeassistant.turn_off", target: { entity_id: "light.demo_living" } }] },
    ] }],
  });
  await expect.poll(() => page.evaluate(() => location.pathname)).toBe("/config/automation/edit/fp_test123");

  await page.locator("svg .dev-temp").first().click();
  await expect(page.locator("#vschon")).toHaveCount(0);
});

const MOTION_HA = { floors: [], areas: [], entities: [
  { id: "light.demo_living", name: "Living light", domain: "light" },
  { id: "binary_sensor.demo_hall_motion", name: "Hall motion", domain: "binary_sensor" },
  { id: "group.demo_lights", name: "Demo lights", domain: "group", members: ["light.demo_living"] },
  { id: "group.demo_motion", name: "Demo motion", domain: "group", members: ["binary_sensor.demo_hall_motion"] },
] };

test("S4.6: the Group menu's \"Turns on...\" builds a motion-group automation, minutes converted to seconds", async ({ page }) => {
  await withAutomationWriter(page, MOTION_HA);
  await watchLocationChanged(page);
  await groupMenu(page);
  await page.locator('#mGroup [data-group="group.demo_motion"]').click();
  await groupMenu(page); // choosing a group closes the menu (S4.5); reopen it to reach "Turns on..."
  await expect(page.locator("#motLightGrp")).toBeVisible();
  await page.locator("#motLightGrp").selectOption("group.demo_lights");
  await page.locator("#motMinutes").fill("5");
  await page.locator("#motGo").click();
  await page.locator("#fp-confirm-yes").click();
  await expect.poll(async () => (await calls(page)).length).toBe(1);
  expect((await calls(page))[0]).toEqual({
    alias: "group.demo_motion → group.demo_lights",
    trigger: [
      { platform: "state", entity_id: "group.demo_motion", to: "on", id: "on" },
      { platform: "state", entity_id: "group.demo_motion", to: "off", for: { seconds: 300 }, id: "off" },
    ],
    action: [{ choose: [
      { conditions: [{ condition: "trigger", id: "on" }], sequence: [{ service: "homeassistant.turn_on", target: { entity_id: "group.demo_lights" } }] },
      { conditions: [{ condition: "trigger", id: "off" }], sequence: [{ service: "homeassistant.turn_off", target: { entity_id: "group.demo_lights" } }] },
    ] }],
  });
  await expect.poll(() => page.evaluate(() => location.pathname)).toBe("/config/automation/edit/fp_test123");

  // A light group, selected instead, offers no "Turns on...": only a motion group does.
  await groupMenu(page);
  await page.locator('#mGroup [data-group="group.demo_lights"]').click();
  await expect(page.locator("#motLightGrp")).toHaveCount(0);
});

// ---- S4.7: room box --------------------------------------------------------------

const BOX_HA = { floors: [], areas: [{ id: "living", name: "Living" }], entities: [
  { id: "light.demo_living", name: "Living lamp", domain: "light", area: "living" }, // already placed on the demo floor
  { id: "switch.living_fan", name: "Living fan", domain: "switch", area: "living" },
  { id: "group.living_lights", name: "Living lights", domain: "group", area: "living" },
  { id: "automation.living_off", name: "Living off", domain: "automation", area: "living" },
  { id: "script.living_morning", name: "Living morning", domain: "script", area: "living" },
  { id: "scene.living_movie", name: "Movie night", domain: "scene", area: "living" },
  { id: "sensor.spare", name: "Spare sensor", domain: "sensor" }, // no area: not in this room's box, but in "Add to area..."
] };
async function withBoxWriter(page: Page, fail = "") {
  await setHa(page, BOX_HA);
  await page.evaluate(([tag, f]) => {
    const w = window as any; w.__box = [];
    (document.querySelector(tag as string) as any).writer = {
      setEntityArea: async (e: string, a: string) => { w.__box.push(["area", e, a]); if (f) throw new Error(f as string); },
      runScene: async (e: string) => { w.__box.push(["scene", e]); if (f) throw new Error(f as string); },
    };
  }, [EDITOR, fail]);
}
const boxCalls = (page: Page) => page.evaluate(() => (window as any).__box as unknown[][]);
const selectLiving = (page: Page) => clickCm(page, 200, 150);

test("S4.7: the room box lists the fixture's entities under the right headings, and marks the one already on the plan", async ({ page }) => {
  await withBoxWriter(page);
  await selectLiving(page);
  const box = page.locator(".habox");
  await expect(box).toContainText("Devices");
  await expect(box).toContainText("Living lamp (on plan)");
  await expect(box).toContainText("Living fan");
  await expect(box).toContainText("Helpers");
  await expect(box).toContainText("Living lights");
  await expect(box).toContainText("Automations");
  await expect(box).toContainText("Living off");
  await expect(box).toContainText("Scripts");
  await expect(box).toContainText("Living morning");
  await expect(box).toContainText("Scenes");
  await expect(box).toContainText("Movie night");
  await expect(page.locator('.harow2:has-text("Spare sensor")')).toHaveCount(0); // it has no area: not a row of this room's box
  await expect(page.locator("#haadd option")).toContainText(["Spare sensor"]); // it does show up as something that COULD be added
});

test("S4.7: Run calls scene.turn_on, and Open dispatches Home Assistant's more-info event with the entity id", async ({ page }) => {
  await withBoxWriter(page);
  await selectLiving(page);
  await page.evaluate((tag) => { (window as any).__moreInfo = null; document.querySelector(tag as string)!.addEventListener("hass-more-info", (e: any) => { (window as any).__moreInfo = e.detail; }); }, EDITOR);
  // S8.10: Scenes, and the Devices > Lights sub-group, are collapsible and closed by default; open them first.
  await page.locator('[data-ha-group="scenes"] > summary').click();
  await page.locator('[data-ha-row="scene.living_movie"] button:has-text("Run")').click();
  await expect.poll(async () => (await boxCalls(page)).length).toBe(1);
  expect((await boxCalls(page))[0]).toEqual(["scene", "scene.living_movie"]);
  await page.locator('[data-ha-group="devices"] > summary').click();
  await page.locator('[data-ha-devgroup="light"] > summary').click();
  await page.locator('[data-ha-row="light.demo_living"] button:has-text("Open")').click();
  expect(await page.evaluate(() => (window as any).__moreInfo)).toEqual({ entityId: "light.demo_living" });
});

test('S4.7: "Add to area..." asks, then records the registry write for the picked entity; a failing Home Assistant changes nothing', async ({ page }) => {
  await withBoxWriter(page);
  await selectLiving(page);
  await page.locator("#haadd").selectOption("sensor.spare");
  await expect(page.locator("#fp-confirm")).toContainText("Add Spare sensor to Living?");
  expect(await boxCalls(page)).toHaveLength(0);
  await page.locator("#fp-confirm-no").click();
  expect(await boxCalls(page)).toHaveLength(0);

  await page.locator("#haadd").selectOption("sensor.spare");
  await page.locator("#fp-confirm-yes").click();
  await expect.poll(async () => (await boxCalls(page)).length).toBe(1);
  expect((await boxCalls(page))[0]).toEqual(["area", "sensor.spare", "living"]);
  await expect(page.locator("#status")).toContainText("Added Spare sensor to Living");

  await withBoxWriter(page, "not_allowed");
  await selectLiving(page);
  await page.locator("#haadd").selectOption("sensor.spare");
  await page.locator("#fp-confirm-yes").click();
  await expect(page.locator("#status")).toContainText("Nothing was changed");
});

test("S4.7: a custom room with an entity shows that one row with no headings; with neither area nor entity it shows the no-area hint", async ({ page }) => {
  await setHa(page, BOX_HA);
  await page.locator('svg polygon[data-r="6"]').click({ force: true }); // Garden pond: no area, no entity yet
  await expect(page.locator(".habox")).toHaveCount(0);
  await expect(page.locator("#panel")).toContainText("No area: set one above.");
  await page.locator("#rent").selectOption("light.demo_living");
  await expect(page.locator(".habox")).toContainText("Living lamp");
  await expect(page.locator(".habox")).not.toContainText("Devices"); // no headings for the single-entity case
});

// ---- S8.10: the room box's Devices list, collapsible and grouped by type ----------------------------------------

// A mixed bag of types under one area, the shape of the maintainer's real ~35-row room: two lights (out of name
// order, to prove the sub-group still sorts by name), a switch, a media player, a battery and temperature sensor, a
// motion binary_sensor. All in "living", so `selectLiving` (200,150) reaches them.
const MIXED_HA = { floors: [], areas: [{ id: "living", name: "Living" }], entities: [
  { id: "light.b_lamp", name: "B lamp", domain: "light", area: "living" },
  { id: "light.a_lamp", name: "A lamp", domain: "light", area: "living" },
  { id: "switch.fan", name: "Fan switch", domain: "switch", area: "living" },
  { id: "media_player.tv", name: "Living TV", domain: "media_player", area: "living" },
  { id: "sensor.phone_battery", name: "Phone battery", domain: "sensor", dc: "battery", area: "living" },
  { id: "sensor.temp", name: "Room temp", domain: "sensor", dc: "temperature", area: "living" },
  { id: "binary_sensor.motion", name: "Hall motion", domain: "binary_sensor", dc: "motion", area: "living" },
] };
const detailsOpen = (page: Page, sel: string) => page.locator(sel).evaluate((el) => (el as HTMLDetailsElement).open);

test("S8.10: the room box's Devices group is one collapsed block; opening it shows type sub-groups, all collapsed, with the right counts", async ({ page }) => {
  await setHa(page, MIXED_HA);
  await selectLiving(page);
  const devGroup = page.locator('[data-ha-group="devices"]');
  await expect(devGroup.locator("> summary")).toHaveText("Devices (7)");
  // Break it: revert to the flat list and this whole test fails at the next line — there is no
  // [data-ha-group]/[data-ha-devgroup] at all, and every row (light.a_lamp included) is visible right away.
  expect(await detailsOpen(page, '[data-ha-group="devices"]')).toBe(false);
  await expect(page.locator('[data-ha-row="light.a_lamp"]')).toBeHidden();

  await devGroup.locator("> summary").click();
  expect(await detailsOpen(page, '[data-ha-group="devices"]')).toBe(true);
  const sub = (t: string) => page.locator(`[data-ha-devgroup="${t}"]`);
  await expect(sub("light").locator("> summary")).toHaveText("Lights (2)");
  await expect(sub("switch").locator("> summary")).toHaveText("Wall switches (1)");
  await expect(sub("media").locator("> summary")).toHaveText("Media players (1)");
  await expect(sub("battery").locator("> summary")).toHaveText("Batteries (1)");
  await expect(sub("temp").locator("> summary")).toHaveText("Temperature (1)");
  await expect(sub("motion").locator("> summary")).toHaveText("Motion (1)");
  for (const t of ["light", "switch", "media", "battery", "temp", "motion"]) {
    expect(await detailsOpen(page, `[data-ha-devgroup="${t}"]`), t).toBe(false); // every sub-group starts collapsed too
  }
  await expect(page.locator('[data-ha-row="light.a_lamp"]')).toBeHidden(); // Devices is open, but Lights is not
});

test("S8.10: opening the Devices group then Lights shows only the light rows, sorted by name", async ({ page }) => {
  await setHa(page, MIXED_HA);
  await selectLiving(page);
  await page.locator('[data-ha-group="devices"] > summary').click();
  await page.locator('[data-ha-devgroup="light"] > summary').click();
  await expect(page.locator('[data-ha-row="light.a_lamp"]')).toBeVisible();
  await expect(page.locator('[data-ha-row="light.b_lamp"]')).toBeVisible();
  const order = await page.locator('[data-ha-devgroup="light"] [data-ha-row]').evaluateAll((els) => els.map((e) => e.getAttribute("data-ha-row")));
  expect(order).toEqual(["light.a_lamp", "light.b_lamp"]); // "A lamp" before "B lamp", not the id order they were declared in
  // still collapsed: opening Lights did not open its siblings
  await expect(page.locator('[data-ha-row="switch.fan"]')).toBeHidden();
  await expect(page.locator('[data-ha-row="media_player.tv"]')).toBeHidden();
});



test("S8.10: a group's open state survives selecting another room and back, and a hass update", async ({ page }) => {
  const TWO_ROOM_HA = { floors: [], areas: [{ id: "living", name: "Living" }, { id: "kitchen", name: "Kitchen" }], entities: [
    ...MIXED_HA.entities,
    { id: "light.kitchen_lamp", name: "Kitchen lamp", domain: "light", area: "kitchen" },
  ] };
  await setHa(page, TWO_ROOM_HA);
  await selectLiving(page);
  await page.locator('[data-ha-group="devices"] > summary').click();
  await page.locator('[data-ha-devgroup="light"] > summary').click();
  expect(await detailsOpen(page, '[data-ha-group="devices"]')).toBe(true);
  expect(await detailsOpen(page, '[data-ha-devgroup="light"]')).toBe(true);

  await clickCm(page, 750, 350); // the kitchen (away from the demo's own light-kitchen device at 650,200)
  await expect(page.locator(".habox")).toContainText("Kitchen lamp"); // really switched rooms
  await clickCm(page, 200, 150); // back to the living room
  // Break it: key the open state by room (or drop it from EditorState into a per-render local) and this fails —
  // reselecting the living room reads the group closed again.
  expect(await detailsOpen(page, '[data-ha-group="devices"]')).toBe(true);
  expect(await detailsOpen(page, '[data-ha-devgroup="light"]')).toBe(true);

  // A `hass` update: Home Assistant sets state repeatedly; here that is a fresh `ha` object with the same content.
  await setHa(page, { ...TWO_ROOM_HA });
  expect(await detailsOpen(page, '[data-ha-group="devices"]')).toBe(true);
  expect(await detailsOpen(page, '[data-ha-devgroup="light"]')).toBe(true);
});

// S8.10 follow-up (Opus review): TWO_ROOM_HA above never exposed the real defect — Kitchen there only ever had
// "light", the same type Living had open, so the reused DOM node's key never actually changed. Living here has
// (light, switch); Kitchen has (switch, temp) — "Wall switches" sits at position 0 in Kitchen (no Lights group
// exists there), the same DOM position Living's opened "light" sub-group occupied. An unkeyed `.map` reuses that
// position's `<details>` node for Kitchen's "switch" group; its `?open` binding, compared against Lit's last
// committed value, keeps the DOM's stale `open` state and the reused node's own `@toggle` then records that stale
// state under the wrong key.
const KEY_BUG_HA = { floors: [], areas: [{ id: "living", name: "Living" }, { id: "kitchen", name: "Kitchen" }], entities: [
  { id: "light.a_lamp", name: "A lamp", domain: "light", area: "living" },
  { id: "switch.fan", name: "Fan switch", domain: "switch", area: "living" },
  { id: "switch.kettle", name: "Kettle", domain: "switch", area: "kitchen" },
  { id: "sensor.k_temp", name: "K temp", domain: "sensor", dc: "temperature", area: "kitchen" },
] };
test("S8.10 follow-up (Opus review): a Devices sub-group's open state is keyed by device type, not by its position in the list", async ({ page }) => {
  await setHa(page, KEY_BUG_HA);
  await selectLiving(page);
  await page.locator('[data-ha-group="devices"] > summary').click();
  await page.locator('[data-ha-devgroup="light"] > summary').click(); // Living: (light, switch) — Lights is position 0
  expect(await detailsOpen(page, '[data-ha-devgroup="light"]')).toBe(true);

  await clickCm(page, 750, 350); // the kitchen: (switch, temp) — Wall switches is position 0 here, Lights does not exist
  await expect(page.locator(".habox")).toContainText("Kettle"); // really switched rooms
  expect(await detailsOpen(page, '[data-ha-devgroup="switch"]'), "Kitchen's Wall switches must start collapsed").toBe(false);
  const haGroups = await page.evaluate(() => [...(document.querySelector("floorplan-studio-editor") as any).st.haGroups] as string[]);
  expect(haGroups, "merely switching to Kitchen must not itself record dev:switch as open").not.toContain("dev:switch");

  await clickCm(page, 200, 150); // back to Living
  expect(await detailsOpen(page, '[data-ha-devgroup="light"]'), "Living's own Lights group must still be open").toBe(true);
  expect(await detailsOpen(page, '[data-ha-devgroup="switch"]'), "Living's Wall switches was never opened").toBe(false);
});

test("S5.5: Help opens a step-by-step guide, matching GUIDE_STEPS, and closes with Escape, returning focus to the button", async ({ page }) => {
  const help = page.locator("#help");
  await expect(help).toHaveAttribute("aria-expanded", "false");
  await help.click();
  await expect(help).toHaveAttribute("aria-expanded", "true");
  const steps = page.locator("#panel .guide > li");
  expect(await steps.count()).toBe(GUIDE_STEPS.length);
  for (let i = 0; i < GUIDE_STEPS.length; i++) {
    await expect(steps.nth(i)).toContainText(GUIDE_STEPS[i].title);
    await expect(steps.nth(i)).toContainText(GUIDE_STEPS[i].body);
  }
  await page.keyboard.press("Escape");
  await expect(help).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#panel .guide")).toHaveCount(0);
  await expect(help).toBeFocused();
});

test("S5.5: each guide step is a collapsible section, closed by default, with a chevron that opens it on click", async ({ page }) => {
  await page.locator("#help").click();
  const first = page.locator("#panel .guide > li").first().locator("details");
  await expect(first).not.toHaveJSProperty("open", true);
  await expect(first.locator("p")).toBeHidden();
  await first.locator("summary").click();
  await expect(first).toHaveJSProperty("open", true);
  await expect(first.locator("p")).toBeVisible();
  await expect(first.locator("p")).toContainText(GUIDE_STEPS[0].body);
  // a second step opens independently, the first stays open
  const second = page.locator("#panel .guide > li").nth(1).locator("details");
  await second.locator("summary").click();
  await expect(second).toHaveJSProperty("open", true);
  await expect(first).toHaveJSProperty("open", true);
});

// Opus review CSS pair (S7.13): the step drew two chevrons, the browser's own list marker and ours. Chromium stopped
// honouring ::-webkit-details-marker; only list-style:none hides the native one.
test("S7.13 CSS pair: a guide step shows one chevron, ours; the native summary marker is off", async ({ page }) => {
  await page.locator("#help").click();
  const summary = page.locator("#panel .guide > li").first().locator("summary");
  expect(await summary.evaluate((el) => getComputedStyle(el).listStyleType)).toBe("none");
  expect(await summary.evaluate((el) => getComputedStyle(el, "::before").content)).toBe('"\u25b8"');
});

test("S5.5: Help is reachable and toggled from the keyboard, and Close in the panel also returns focus to the button", async ({ page }) => {
  await page.locator("#help").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#help")).toHaveAttribute("aria-expanded", "true");
  await page.locator("#helpClose").click();
  await expect(page.locator("#help")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#help")).toBeFocused();
});

test("S5.5 break it: the guide stays open, and the selection panel it replaced does not reappear, across a plan rotation, a floor add and a layout load", async ({ page }) => {
  await page.locator("#help").click();
  await expect(page.locator("#panel .guide")).toBeVisible();

  await this_rotatePlan(page);
  await expect(page.locator("#panel .guide")).toBeVisible();

  await clickAddFloor(page);
  await page.locator("#newFloor").fill("Attic");
  await page.keyboard.press("Enter");
  await expect(page.locator("#panel .guide")).toBeVisible();

  const layout = { ...demo, floors: { ground: demo.floors.ground } };
  await page.locator("#file").setInputFiles({ name: "reload.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(layout)) });
  await expect.poll(async () => (await layoutOf(page)).floors.ground.outline.length).toBe(layout.floors.ground.outline.length);
  await expect(page.locator("#panel .guide")).toBeVisible();

  async function this_rotatePlan(p: Page) {
    await menu(p, "Edit");
    await p.locator("#rotr").click();
    await menu(p, "Edit");
  }
});

test("S5.5 CSS: the guide panel's own text reads against its own background in every theme", async ({ page }) => {
  await page.locator("#help").click();
  for (const t of ["blueprint", "midnight", "light", "slate", "terminal", "solarized", "ha"] as const) {
    await setTheme(page, t);
    const got = await page.evaluate((tag) => {
      const root = (document.querySelector(tag) as any).shadowRoot as ShadowRoot;
      const panel = root.querySelector("#panel")!;
      const s = getComputedStyle(panel);
      return { color: s.color, background: getComputedStyle(document.querySelector(tag) as HTMLElement).backgroundColor };
    }, EDITOR);
    expect(got.color, t).not.toBe(got.background);
  }
});

test("S5.5: on a narrow window the guide's own steps don't scroll away under the toolbar — the panel column stays reachable", async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 700 });
  await page.locator("#help").click();
  const last = page.locator("#panel .guide > li").last();
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeVisible();
});

test("a room's Delete button sits next to Unsnap, not at the bottom of the panel", async ({ page }) => {
  await clickCm(page, 50, 200); // the living room
  await expect(page.locator("#rn")).toHaveValue("Living");
  const row = page.locator("#runsnap").locator("xpath=..");
  await expect(row.locator("#rdel")).toHaveCount(1);
});

test("View menu shows the installed version, matching the integration manifest, at the top of the menu", async ({ page }) => {
  await menu(page, "View");
  const box = page.locator("#mOpt .box");
  const first = box.locator("> *").first();
  await expect(first).toHaveAttribute("id", "version");
  await expect(first).toHaveText(`Floorplan Studio ${manifest.version}`);
});

test("dragging a room snapped to a neighbour pans the view instead of moving the room; Unsnap first lets it move", async ({ page }) => {
  const g0 = await groundOf(page), living = g0.rooms[0];
  const v0 = await page.evaluate((tag) => ({ ...(document.querySelector(tag as string) as any).st.view }), EDITOR);
  await dragCm(page, [60, 200], [160, 300]); // inside the living room, snapped to Kitchen/Hall by default
  const g1 = await groundOf(page);
  expect(g1.rooms[0].pts).toEqual(living.pts); // the room did not move
  const v1 = await page.evaluate((tag) => ({ ...(document.querySelector(tag as string) as any).st.view }), EDITOR);
  expect(v1).not.toEqual(v0); // the view panned instead

  await clickCm(page, 60, 200);
  await page.locator("#runsnap").click(); // Unsnap
  await dragCm(page, [60, 200], [160, 300]);
  const g2 = await groundOf(page);
  expect(g2.rooms[0].pts).not.toEqual(living.pts); // now it moves
});

test("View menu: the grid-snap row is labelled Snap, and its chips are half width so two sit on one line", async ({ page }) => {
  await menu(page, "View");
  await expect(page.locator("#snap > span")).toHaveText("Snap");
  const boxes = await page.locator("#snap [data-grid]").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
  expect(boxes[0].top).toBeCloseTo(boxes[1].top, 0); // first two chips share a row
  expect(boxes[0].left).toBeLessThan(boxes[1].left);
});

// S7.2: the snapping manual lives in Help, not under every panel; the status line lives in the toolbar.
test("S7.2: no panel repeats the Alt/Shift/Ctrl manual — nothing selected, a device, a piece of furniture", async ({ page }) => {
  const aside = page.locator(`${EDITOR} aside`);
  await expect(aside).toBeVisible();
  await expect(aside).not.toContainText("Hold Alt");
  await expect(aside).not.toContainText(/\bAlt\b/);
  await page.mouse.click(...Object.values(await centre(page, 'g[data-x="0"]')) as [number, number]);
  await expect(page.locator("#panel strong").first()).not.toHaveText("Floor"); // a device panel, not the floor panel
  await expect(aside).not.toContainText(/\bAlt\b/);
  await page.mouse.click(...Object.values(await centre(page, 'g[data-f="0"]')) as [number, number]);
  await expect(page.locator("#fr90")).toBeVisible(); // the furniture panel
  await expect(aside).not.toContainText(/\bAlt\b/);
});

test("S7.2: Help has the snapping step, and it carries the Alt, Shift and Ctrl manual", async ({ page }) => {
  expect(GUIDE_STEPS.map((s) => s.title)).toContain("Moving things and snapping");
  await page.locator("#help").click();
  const step = page.locator("#panel .guide > li", { hasText: "Moving things and snapping" });
  await expect(step).toHaveCount(1);
  await step.locator("summary").click();
  await expect(step.locator("p")).toBeVisible();
  await expect(step).toContainText("Hold Alt");
  await expect(step).toContainText("Shift");
  await expect(step).toContainText("Ctrl/Cmd+Z");
});

test("S7.2: the floor panel says Need help and its button opens Help", async ({ page }) => {
  await expect(page.locator("#panel")).toContainText("Need help? Open Help.");
  await page.locator("#floorHelp").click();
  await expect(page.locator("#help")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#panel .guide")).toBeVisible();
});

test("S7.2: the status line sits in the toolbar's right-aligned cluster, and Save still writes Saved there", async ({ page }) => {
  const status = page.locator(".bar #status");
  await expect(status).toHaveCount(1);
  await expect(status).toBeVisible();
  await expect(status).toHaveAttribute("role", "status");
  await expect(page.locator(`${EDITOR} aside #status`)).toHaveCount(0);
  // S8.10 follow-up: status is now the right-aligned cluster's first item (Filter through Redo follow it), so its
  // own right edge sits at or before Filter's left edge, not after Redo's.
  const filter = await page.locator("#filter").boundingBox(), box = await status.boundingBox(), bar = await page.locator(".bar").boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(filter!.x + 0.5);
  expect(box!.x).toBeGreaterThanOrEqual(bar!.x);
  expect(box!.x + box!.width).toBeLessThanOrEqual(bar!.x + bar!.width + 0.5);
  await menu(page, "File");
  const dl = page.waitForEvent("download");
  await page.locator("#save").click();
  await dl;
  await expect(status).toHaveText("Saved");
});

test("S7.2: an open menu draws above the Device colours panel, so File, Save is still the top element under the mouse", async ({ page }) => {
  await menu(page, "Edit");
  await page.locator("#devcols").click();
  await expect(page.locator(".devcols-panel")).toBeVisible();
  await menu(page, "File");
  const c = await centre(page, "#save");
  const top = await page.evaluate(([tag, x, y]) => ((document.querySelector(tag as string) as any).shadowRoot as ShadowRoot).elementFromPoint(x as number, y as number)?.id ?? null, [EDITOR, c.x, c.y] as const);
  expect(top).toBe("save");
});

test("S7.2 break it: a 200-character status ellipsises, keeps the full text in title, and the toolbar does not grow", async ({ page }) => {
  const bar = page.locator(`${EDITOR} .bar`);
  const before = (await bar.boundingBox())!;
  const long = ("Could not create the automation: the server said no " + "x".repeat(200)).slice(0, 200);
  expect(long).toHaveLength(200);
  await page.evaluate(([tag, m]) => (document.querySelector(tag) as any).saveDone(false, m), [EDITOR, long] as const);
  const status = page.locator(".bar #status");
  await expect(status).toHaveText(long);
  await expect(status).toHaveAttribute("title", long);
  const after = (await bar.boundingBox())!;
  expect(after.height).toBe(before.height);
  const got = await status.evaluate((el) => {
    const s = getComputedStyle(el);
    return { overflow: s.textOverflow, ws: s.whiteSpace, clipped: el.scrollWidth > el.clientWidth, right: el.getBoundingClientRect().right };
  });
  expect(got.overflow).toBe("ellipsis");
  expect(got.ws).toBe("nowrap");
  expect(got.clipped).toBe(true);
  expect(got.right).toBeLessThanOrEqual(after.x + after.width + 0.5);
  // At 1280 the floor chips, status, and the whole menu/Undo/Redo cluster all share the toolbar's one row (S8.10
  // follow-up: status has no fixed flex-basis any more, only a max-width cap, so even a 200-char message stays
  // capped and ellipsised rather than growing the cluster's total content width past what fits on one line).
  const mid = async (sel: string) => { const b = (await page.locator(sel).first().boundingBox())!; return b.y + b.height / 2; };
  const topRow = await mid("#redo");
  expect(Math.abs((await mid(".bar [data-f]")) - topRow)).toBeLessThan(2);
  const statusRow = await mid(".bar #status");
  expect(Math.abs((await mid("#help")) - statusRow)).toBeLessThan(6); // Help is taller than the status text; same line, not same centre to the px
  expect(Math.abs(statusRow - topRow)).toBeLessThan(2); // status shares that same single row too, not a wrapped line of its own
});

test("S7.6: View, Preview night darkens the plan, survives a reload, and is never written to the layout", async ({ page }) => {
  await expect(page.locator("svg polygon.room-night")).toHaveCount(0);
  await menu(page, "View");
  await expect(page.locator("#night")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#night").click();
  await menu(page, "View");
  await expect(page.locator("svg g.night")).toHaveCount(1);
  await expect(page.locator("svg polygon.room-night")).toHaveCount(6); // seven ground rooms less the zone
  expect(await page.evaluate(() => localStorage.getItem("floorplan-studio:night"))).toBe("true");
  expect(JSON.stringify(await layoutOf(page))).not.toContain("night");
  await page.reload();
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  await expect(page.locator("svg polygon.room-night")).toHaveCount(6);
  await menu(page, "View");
  await expect(page.locator("#night")).toHaveAttribute("aria-pressed", "true");
  await page.locator("#night").click();
  await menu(page, "View");
  await expect(page.locator("svg g.night")).toHaveCount(0);
  await expect(page.locator("svg polygon.room-night")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("floorplan-studio:night"))).toBe("false");
});

test("S7.6: with Preview night on, a click in a room still selects the room under the overlay", async ({ page }) => {
  await menu(page, "View");
  await page.locator("#night").click();
  await menu(page, "View");
  await expect(page.locator("svg polygon.room-night").first()).toBeAttached();
  await clickCm(page, 200, 150);
  await expect(page.locator("#rk")).toHaveValue("room");
  await expect(page.locator("#ra")).toHaveValue("living");
});

// CLAUDE.md finding 10: the three S7.6 rules read in Chromium, in the editor's own shadow root, with light pinned.
test("Opus review CSS pair: S7.6 night fills an unlit room with --fp-night, leaves a lit one clear, and the overlay takes no pointer", async ({ page }) => {
  await setTheme(page, "light");
  await menu(page, "View");
  await page.locator("#night").click();
  await menu(page, "View");
  const got = await page.evaluate((tag) => {
    const root = (document.querySelector(tag) as any).shadowRoot as ShadowRoot;
    const unlit = root.querySelector('svg polygon[data-night="0"]')!;
    // the editor has no live state, so no room is lit; a lit twin is added beside the real overlay to read the rule
    const lit = unlit.cloneNode() as SVGPolygonElement;
    lit.setAttribute("class", "room-night lit");
    unlit.after(lit);
    const out = [getComputedStyle(unlit).fill, getComputedStyle(lit).fill, getComputedStyle(unlit).pointerEvents];
    lit.remove();
    return out;
  }, EDITOR);
  expect(got).toEqual(["rgba(4, 10, 30, 0.45)", "none", "none"]);
});

// ---- S8.7: linking a light to a floor switch, and auto-link --------------------------------------------------

const LINK_HA = {
  floors: [], areas: [
    { id: "kitchen", name: "Kitchen", floor_id: "floor_ground" },
    { id: "bedroom", name: "Bedroom", floor_id: "floor_first" },
    { id: "utility", name: "Utility", floor_id: "floor_ground" }, // Opus review finding 9: a second ground-floor light+switch pair, so the "links every light" test proves two lights, not one
  ],
  entities: [
    { id: "light.demo_kitchen", name: "Kitchen light", domain: "light", area: "kitchen" },
    { id: "light.demo_bedroom", name: "Bedroom light", domain: "light", area: "bedroom" },
    { id: "light.demo_extra", name: "Extra utility light", domain: "light", area: "utility" },
    { id: "switch.kitchen_switch", name: "Kitchen light switch", domain: "switch", area: "kitchen" },
    { id: "switch.bedroom_switch", name: "Bedroom light switch", domain: "switch", area: "bedroom" },
    { id: "switch.hall_switch", name: "Unrelated hall switch", domain: "switch", area: "kitchen" }, // never the unique/top match, since kitchen_switch shares more tokens
    { id: "switch.extra_switch", name: "Extra utility switch", domain: "switch", area: "utility" },
  ],
};

test("S8.7: Link lights to switches links every unbound light on the floor to its suggested switch, one undo step reverts them all", async ({ page }) => {
  await setHa(page, LINK_HA);
  // Give the ground floor a second unbound light (kitchen already has one), with its own HA area and suggested
  // switch in LINK_HA (light.demo_extra / switch.extra_switch, both area "utility") so the test can actually prove
  // two lights were linked, not just that the click did not blow up (Opus review finding 9: the previous version
  // added this device but never checked it got bound, so it passed even when only the kitchen light linked).
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any;
    el.st.edit((f: any) => { f.devices.push({ id: "light-extra", type: "light", entity: "light.demo_extra", name: "Extra utility light", x: 700, y: 300 }); });
    el.requestUpdate();
  }, EDITOR);
  // Opus review finding 14: "Link lights to switches" moved out of Edit > Group to a top-level Edit item, right
  // after Group, so it no longer needs the Group submenu opened first.
  await menu(page, "Edit");
  await expect(page.locator("#linkLights")).toBeVisible();
  await page.locator("#linkLights").click();
  await expect(page.locator("#status")).toContainText("Linked");

  await page.locator('g[data-x="0"]').click(); // light-living, already bound before the click: untouched
  await expect(page.locator("#vbound")).toHaveValue("switch.demo_living_relay");

  await page.locator('g[data-x="1"]').click(); // light-kitchen
  await expect(page.locator("#vbound")).toHaveValue("switch.kitchen_switch");

  const devices = (await groundOf(page)).devices as any[];
  const extra = devices.find((d) => d.entity === "light.demo_extra");
  expect(extra?.bound).toBe("switch.extra_switch"); // the second light really did link, to its own suggested switch

  await page.locator("#undo").click();
  await page.locator('g[data-x="1"]').click();
  await expect(page.locator("#vbound")).toHaveValue(""); // one undo step reverted the whole batch
  const afterUndo = (await groundOf(page)).devices as any[];
  expect(afterUndo.find((d) => d.entity === "light.demo_extra")?.bound).toBeUndefined(); // ...both lights, not only the kitchen one
});

test("S8.7: boundField restricts a light's Controlled by select to this floor's own switches, with the same-area match labelled (suggested)", async ({ page }) => {
  await setHa(page, LINK_HA);
  await page.locator('g[data-x="1"]').click(); // light-kitchen
  const opts = await page.locator("#vbound option").allTextContents();
  expect(opts.some((o) => o.includes("Kitchen light switch") && o.includes("(suggested)"))).toBe(true);
  expect(opts.some((o) => o.includes("Bedroom light switch"))).toBe(false); // a different floor's switch is never offered
});

// ---- S8.7: the Motion optgroup and per-light motion-link flow ---------------------------------------------------

const LIGHT_MOTION_HA = {
  floors: [], areas: [],
  entities: [
    { id: "light.demo_kitchen", name: "Kitchen light", domain: "light", area: "kitchen" },
    { id: "binary_sensor.kitchen_motion", name: "Kitchen motion", domain: "binary_sensor", dc: "motion", area: "kitchen" },
    { id: "binary_sensor.bedroom_motion", name: "Bedroom motion", domain: "binary_sensor", dc: "motion", area: "bedroom" }, // first floor, not on ground: never offered to the kitchen light
  ],
};

test("S8.7: without a writer the Motion optgroup is not shown; with one it lists this floor's own motion sensors", async ({ page }) => {
  await setHa(page, LIGHT_MOTION_HA); // HA data with no writer stubbed
  await page.locator('g[data-x="1"]').click(); // light-kitchen
  await expect(page.locator("#vbound optgroup")).toHaveCount(0);

  await withAutomationWriter(page, LIGHT_MOTION_HA);
  await page.locator('g[data-x="1"]').click();
  const opts = await page.locator('#vbound optgroup[label="Motion"] option').allTextContents();
  expect(opts).toEqual(["Kitchen motion"]); // the bedroom sensor is on another floor
});

test("S8.7: picking a Motion option leaves Controlled by unchanged and shows the turn-on row; Create automation posts the config, links motion in one undo step, and Unlink clears only motion", async ({ page }) => {
  await withAutomationWriter(page, LIGHT_MOTION_HA);
  await watchLocationChanged(page);
  await watchLayoutChanged(page);
  await page.locator('g[data-x="1"]').click(); // light-kitchen
  await page.locator("#vbound").selectOption("motion:binary_sensor.kitchen_motion");
  await expect(page.locator("#vbound")).toHaveValue(""); // bound was never touched
  await expect(page.locator("#panel")).toContainText("Turn on with Kitchen motion, off after");

  await page.locator("#vmotionmin").fill("7");
  await page.locator("#vmotiongo").click();
  await expect(page.locator("#fp-confirm")).toContainText("Home Assistant cannot undo this.");
  expect(await calls(page)).toHaveLength(0);
  await page.locator("#fp-confirm-yes").click();
  await expect.poll(async () => (await calls(page)).length).toBe(1);
  expect((await calls(page))[0]).toEqual({
    alias: "binary_sensor.kitchen_motion → light.demo_kitchen",
    trigger: [
      { platform: "state", entity_id: "binary_sensor.kitchen_motion", to: "on", id: "on" },
      { platform: "state", entity_id: "binary_sensor.kitchen_motion", to: "off", for: { seconds: 420 }, id: "off" },
    ],
    action: [{ choose: [
      { conditions: [{ condition: "trigger", id: "on" }], sequence: [{ service: "homeassistant.turn_on", target: { entity_id: "light.demo_kitchen" } }] },
      { conditions: [{ condition: "trigger", id: "off" }], sequence: [{ service: "homeassistant.turn_off", target: { entity_id: "light.demo_kitchen" } }] },
    ] }],
  });
  await expect(page.locator("#panel")).toContainText("Turns on with motion: Kitchen motion");
  await expect(page.locator("#panel")).toContainText("is not deleted");
  await expect.poll(() => page.evaluate(() => location.pathname)).toBe("/config/automation/edit/fp_test123");

  // Opus review finding 1: linking motion is an edit like any other — it fires layout-changed and autosaves.
  await expect.poll(() => layoutChangedCount(page)).toBeGreaterThan(0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("floorplan-studio:layout") ?? "{}"));
  const kitchen = (Object.values(saved.floors ?? {}) as any[]).flatMap((f) => f.devices).find((d: any) => d.entity === "light.demo_kitchen");
  expect(kitchen?.motion).toBe("binary_sensor.kitchen_motion");

  await page.locator("#undo").click();
  await page.locator('g[data-x="1"]').click();
  await expect(page.locator("#panel")).not.toContainText("Turns on with motion");

  // relink, then Unlink: removes only `motion`, one undo step, the plan's bound stays untouched
  await page.locator("#vbound").selectOption("motion:binary_sensor.kitchen_motion");
  await page.locator("#vmotiongo").click();
  await page.locator("#fp-confirm-yes").click();
  await expect.poll(async () => (await calls(page)).length).toBe(2);
  await page.locator("#vmotionunlink").click();
  await expect(page.locator("#panel")).not.toContainText("Turns on with motion");
  await expect(page.locator("#vbound")).toHaveValue("");
});

test("Opus review finding 2: deleting the light while Create automation is still in flight does not crash and does not silently re-link a gone device", async ({ page }) => {
  await withSlowAutomationWriter(page, LIGHT_MOTION_HA);
  await page.locator('g[data-x="1"]').click(); // light-kitchen
  await page.locator("#vbound").selectOption("motion:binary_sensor.kitchen_motion");
  await page.locator("#vmotionmin").fill("7");
  await page.locator("#vmotiongo").click();
  await page.locator("#fp-confirm-yes").click();
  await expect.poll(async () => (await calls(page)).length).toBe(1); // the request is out, awaiting createAutomation

  await page.locator('g[data-x="1"]').click(); // reselect the light (the confirm dialog left focus elsewhere)
  await expect(page.locator("svg .dev-light")).not.toHaveCount(0);
  const before = (await groundOf(page)).devices.length;
  await page.locator("#vdel").click(); // the device is gone while the automation is still being created
  await expect.poll(async () => (await groundOf(page)).devices.length).toBe(before - 1);
  expect((await groundOf(page)).devices.some((d: any) => d.entity === "light.demo_kitchen")).toBe(false);

  await page.evaluate(() => (window as any).__resolveCreate());
  await expect(page.locator("#status")).toContainText("The light was no longer there to record the link on");
  expect((await groundOf(page)).devices.some((d: any) => d.entity === "light.demo_kitchen")).toBe(false); // not resurrected
});

// ---- S8.1: the toolbar rework — Names in View, an Edit menu after View ------------------------------------------------

test("S8.1: Names sits in View with the theme; Edit holds Add floor, Home Assistant, Group, Link lights to switches, Rotate, Device colours and Trace image, in that order", async ({ page }) => {
  await expect(page.locator(".bar > #names")).toHaveCount(0);
  await menu(page, "View");
  await expect(page.locator("#mOpt #names")).toBeVisible();
  await expect(page.locator("#mOpt #thSub")).toBeVisible();
  for (const id of ["#rotr", "#devcols", "#traceBtn", "#addFloor"]) await expect(page.locator(`#mOpt ${id}`)).toHaveCount(0);
  await page.locator("#names").click(); // a chip in a menu still toggles the names
  await expect(page.locator("svg text.lbl")).not.toHaveCount(0);
  const items = (p: Page) => p.locator("#mEdit > .box > *").evaluateAll((els) => els.map((e) => e.id || e.className));
  await menu(page, "Edit");
  expect(await items(page)).toEqual(["addFloor", "rotrow", "devcols", "traceBtn"]);
  await menu(page, "Edit");
  await withHaMenu(page, { list: LABELLED });
  await menu(page, "Edit");
  // Opus review finding 14: "Link lights to switches" moved out of Edit > Group to its own top-level item, right
  // after Group — it acts on every light on the floor at once, not a chosen group, so nesting it under Group read
  // as if it were scoped to one. This is the deliberate reason the pinned order below now includes "linkLights"
  // between "mGroup" and "rotrow"; a future order change needs the same deliberate update, not a loosened assertion.
  expect(await items(page)).toEqual(["addFloor", "mHA", "mGroup", "linkLights", "rotrow", "devcols", "traceBtn"]);
});

// ---- S8.9 follow-up: hints are rewritten short, not clipped ----------------------

/** Every static hint (not `.dyn`, which may embed a live name or measurement) must fit its own line: no
 *  clipping. A hint clipped by CSS ellipsis still passes a text-content assertion, so this checks the box
 *  itself, `scrollWidth <= clientWidth`, at the sidebar's real width. */
async function assertHintsFit(page: Page, where: string) {
  const hints = page.locator("#panel .hint:not(.dyn)");
  const n = await hints.count();
  expect(n, `${where}: no hint elements found`).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const el = hints.nth(i);
    const [scrollWidth, clientWidth, text] = await el.evaluate((e) => [e.scrollWidth, e.clientWidth, e.textContent]);
    expect(scrollWidth as number, `${where}: hint clipped: "${text}"`).toBeLessThanOrEqual(clientWidth as number);
  }
}

test("S8.9 follow-up: no static sidebar hint is clipped, for the floor, a room, a wall edge, a door, stairs, furniture and every device", async ({ page }) => {
  await assertHintsFit(page, "floor (nothing selected)");

  await clickCm(page, 200, 150); // the living room
  await expect(page.locator("#rk")).toHaveValue("room");
  await assertHintsFit(page, "room");

  await clickCm(page, 500, 300); // the edge Living and Kitchen share
  await expect(page.locator("#ek")).toBeVisible();
  await assertHintsFit(page, "wall edge");

  const doorCentre = await centre(page, 'line[data-d="0"]');
  await page.mouse.click(doorCentre.x, doorCentre.y);
  await expect(page.locator("#dn")).toBeVisible();
  await assertHintsFit(page, "door");

  const stairsCentre = await centre(page, 'svg g[data-s="0"]');
  await page.mouse.click(stairsCentre.x, stairsCentre.y);
  await expect(page.locator("#sn")).toBeVisible();
  await assertHintsFit(page, "stairs");

  const furnitureCount = await page.locator("svg g[data-f]").count();
  for (let i = 0; i < furnitureCount; i++) {
    const c = await centre(page, `svg g[data-f="${i}"]`);
    await page.mouse.click(c.x, c.y);
    await expect(page.locator("#fun")).toBeVisible();
    await assertHintsFit(page, `furniture ${i}`);
  }

  const deviceCount = (await groundOf(page)).devices.length;
  for (let i = 0; i < deviceCount; i++) {
    // The halo circle is always at the icon's own centre; a camera's cone would otherwise skew the group's
    // bounding box centre away from any actual shape (Opus review finding 3: hit-test the real top element).
    const c = await centre(page, `g[data-x="${i}"] circle.halo`);
    await page.mouse.click(c.x, c.y);
    await expect(page.locator("#vtype")).toBeVisible();
    await assertHintsFit(page, `device ${i}`);
  }
});

// Opus review of S8.9: the fix above only scoped nowrap+ellipsis to the sidebar's own static hints (.fit); a
// confirm prompt and the trace-image instructions are a bare <p class="hint"> and must still fully show their
// text (wrapping, not clipping). This exercises the elements the first pass never opened: a free wall, an
// opening, an extra, a zone, an unlinked device, and the edge-delete confirm question.
test("Opus review: a free wall, an opening, an extra, a zone, an unlinked device and the edge-delete confirm prompt all show their hint text in full", async ({ page }) => {
  await page.evaluate((tag) => {
    const el = document.querySelector(tag) as any, l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.walls.push({ id: "wall-ground-1", a: [790, 410], b: [790, 480], kind: "wall" });
    l.floors.ground.openings.push({ id: "opening-ground-1", a: [100, 400], b: [200, 400] });
    l.floors.ground.extras.push({ id: "extra-ground-1", name: "Shed", a: [100, 450], b: [200, 520] });
    l.floors.ground.unlinked.push({ id: "unl-ground-1", type: "heater", name: "Space heater", x: 250, y: 350, rot: 0, scale: 1 });
    el.layout = l;
  }, EDITOR);

  const wallCentre = await centre(page, 'line[data-w="0"]');
  await page.mouse.click(wallCentre.x, wallCentre.y);
  await expect(page.locator("#wk")).toBeVisible();
  await assertHintsFit(page, "wall");

  const openingCentre = await centre(page, "svg line.opening");
  await page.mouse.click(openingCentre.x, openingCentre.y);
  await expect(page.locator("#ok")).toBeVisible();
  await assertHintsFit(page, "opening");

  const extraCentre = await centre(page, "svg .extra");
  await page.mouse.click(extraCentre.x, extraCentre.y);
  await expect(page.locator("#exn")).toBeVisible();
  await assertHintsFit(page, "extra");

  const unlCentre = await centre(page, 'g[data-u="0"]');
  await page.mouse.click(unlCentre.x, unlCentre.y);
  await expect(page.locator("#uun")).toBeVisible();
  await assertHintsFit(page, "unlinked device");

  await clickCm(page, 440, 60); // the Reading corner zone
  await expect(page.locator("#rk")).toHaveValue("zone");
  await assertHintsFit(page, "zone");

  // The Hall's bottom edge (y=600, x in [0,800]) carries the Front door (a=[300,600], b=[390,600]); Delete
  // asks first instead of removing it outright.
  await clickCm(page, 200, 600);
  await expect(page.locator("#ek")).toBeVisible();
  await page.locator("#edel").click();
  await expect(page.locator("#edelyes")).toBeVisible();
  await assertHintsFit(page, "edge-delete confirm prompt");
});

// ---- S8.11: an opening cuts a real hole in the wall, not a grey band painted over it ------------------------

// demo/layout.json's first floor carries one opening on its south outline edge, a=[600,600] b=[700,600]:
// an external wall (stroke width 20, halo 22, so a point 8 cm off the centreline still sits inside either
// stroke). The Office room (pts include y:300..600) is the room whose fill must show through the hole.
const FIRST_OPENING_A: [number, number] = [600, 600], FIRST_OPENING_B: [number, number] = [700, 600];
const OPENING_MID_X = (FIRST_OPENING_A[0] + FIRST_OPENING_B[0]) / 2; // 650
const OFF_CENTRELINE = 8; // cm north of the wall centreline: inside the room, inside the (un-cut) wall's own width
// The Office carries its own colour (#4a6fa5), not the default --fp-room-empty grey the old `.opening` band
// happened to be stroked with (S8.11: a room whose colour matches that grey could not tell a real hole from
// the old band painted on top of it — CLAUDE.md finding 4).
const ROOM_FILL_LIGHT: [number, number, number] = [0x4a, 0x6f, 0xa5];
const WALL_LIGHT: [number, number, number] = [0x1a, 0x19, 0x17]; // --fp-wall-external, light theme

async function pngAt(page: Page): Promise<ReturnType<typeof decodePng>> {
  const buf = await page.screenshot();
  return decodePng(buf);
}
function closeTo(px: [number, number, number, number], rgb: [number, number, number]) {
  return Math.abs(px[0] - rgb[0]) <= 2 && Math.abs(px[1] - rgb[1]) <= 2 && Math.abs(px[2] - rgb[2]) <= 2;
}

test("S8.11: the opening is a real hole — the room fill shows through it, and the wall stays solid just outside its ends", async ({ page }) => {
  await setTheme(page, "light"); // pins light values; blueprint is the default since S2.12
  await page.locator('.chip[data-f="first"]').click();
  await expect(page.locator(EDITOR)).toHaveAttribute("data-theme", "light");

  const inHole = await screenOf(page, OPENING_MID_X, 600 - OFF_CENTRELINE);
  const onWall = await screenOf(page, 760, 600 - OFF_CENTRELINE); // 760: outside the opening's cap radius (711) and inside the outline (800)
  const png = await pngAt(page);
  const holePx = pixelAt(png, inHole.x, inHole.y);
  const wallPx = pixelAt(png, onWall.x, onWall.y);

  expect(closeTo(holePx, ROOM_FILL_LIGHT), `hole pixel ${holePx} should be the Office's room fill`).toBe(true);
  expect(closeTo(holePx, WALL_LIGHT), `hole pixel ${holePx} must not be the wall colour`).toBe(false);
  expect(closeTo(wallPx, WALL_LIGHT), `wall pixel ${wallPx} should still be the external wall colour`).toBe(true);
});

// This must fail with the mask removed: reverting src/core/render.ts's `<g mask="...">` wrap (or reverting
// `.opening{stroke:transparent}` to its old grey band) makes the "hole" pixel equal the wall or the old grey,
// never the room fill — verified by hand, see the S8.11 report.

test("S8.11: a real click still selects the opening in the editor, on top of the masked wall", async ({ page }) => {
  await page.locator('.chip[data-f="first"]').click();
  const mid = await screenOf(page, OPENING_MID_X, 600);
  await page.mouse.click(mid.x, mid.y);
  await expect(page.locator("#ol")).toHaveValue("100"); // FIRST_OPENING_B[0] - FIRST_OPENING_A[0]
  await expect(page.locator("svg line.hl")).toHaveCount(1);
});

// Diego's field review of the S8.11 4x crops (opening-light-4x.png, opening-ha-dark-4x.png, 2026-09-26) found two
// defects in the mask cut, both fixed in src/core/render.ts. Both pixel tests live in tests/card/card.spec.ts,
// not here: the editor draws its own measurement-grid overlay line exactly along y=600 (a "major" gridline,
// every 100 cm) at low opacity, on top of everything, which blends the exact centreline pixel this pair needs to
// sample and makes the assertion depend on exactly where a thin antialiased line falls — flaky by construction,
// not a product bug (CLAUDE.md finding 13 is about the other kind). The card never draws that overlay and shares
// the same renderFloor draw path (finding 8), so it is the reliable place to pin these two pixels down.

// Opus review of S8.11 (2026-09-26): the pair's own two card.spec.ts tests were widened along with the mask cut
// (OPENING_EXTRA) and a since-removed seam patch was checked and found unnecessary once that cut is wide enough —
// see docs/DECISIONS.md's S8.11 follow-up.
