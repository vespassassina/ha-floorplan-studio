import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { validate, type Layout, type Floor } from "../../src/core/schema";

// Every pointer action goes through page.mouse at real screen coordinates, so the
// real top element decides what is hit (icons, handles, walls), as for a user.

const demo = JSON.parse(readFileSync("demo/layout.json", "utf8")) as Layout;
const EDITOR = "floorplan-studio-editor";
const layoutOf = (page: Page) => page.evaluate((tag) => JSON.parse(JSON.stringify((document.querySelector(tag) as any).layout)) as Layout, EDITOR);
const groundOf = async (page: Page): Promise<Floor> => (await layoutOf(page)).floors.ground;
const unplaced = (page: Page) => page.locator('#addDev option:not([value=""])');

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

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
});

test("loads the demo and draws the ground floor", async ({ page }) => {
  const l = await layoutOf(page);
  expect(l.floors.ground.rooms).toHaveLength(5); // three rooms, the Reading corner zone and the pond
  await expect(page.locator("svg polygon[data-r]")).toHaveCount(5);
  await expect(page.locator(".chip[data-f]")).toHaveCount(2);
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

test("Add, Device places one and the list shrinks; removing it makes the list grow", async ({ page }) => {
  // the demo catalog holds one contact sensor not on the plan; the relay leaves the list with its light.
  await expect(unplaced(page)).toHaveCount(1);
  await page.mouse.click(...Object.values(await centre(page, 'g[data-x="0"]')) as [number, number]);
  await page.locator("#vdel").click();
  // the light and its relay come back together
  await expect(unplaced(page)).toHaveCount(3);
  expect((await groundOf(page)).devices).toHaveLength(7);
  await menu(page, "Add");
  await page.locator("#addDev").selectOption({ label: "Living light — Living" });
  await expect(unplaced(page)).toHaveCount(2);
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
  await page.locator("#fr").fill("90");
  await page.locator("#fr").press("Enter");
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

test("a reload restores the edit from localStorage and Reset returns to the demo", async ({ page }) => {
  await drag(page, 'circle[data-h="r0:1"]', 0, 50);
  const edited = await groundOf(page);
  await page.reload();
  await expect(page.locator("svg polygon[data-r]").first()).toBeVisible();
  expect((await groundOf(page)).rooms[0].pts[1]).toEqual(edited.rooms[0].pts[1]);
  page.once("dialog", (d) => d.accept());
  await menu(page, "File");
  await page.locator("#reset").click();
  expect(await layoutOf(page)).toEqual(demo);
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
    const q = new DOMPoint(px as number, py as number).matrixTransform(svg.getScreenCTM()!);
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

test("a device snaps to the 5 cm grid, and Alt places it freely", async ({ page }) => {
  await dragCm(page, [250, 200], [263, 207]);
  let d = (await groundOf(page)).devices[0] as any;
  expect([d.x, d.y]).toEqual([265, 205]);
  expect(d.x % 5).toBe(0);
  await dragCm(page, [265, 205], [263, 207], ["Alt"]);
  d = (await groundOf(page)).devices[0] as any;
  expect([d.x, d.y]).toEqual([263, 207]);
});

test("Alt turns snapping off for a corner", async ({ page }) => {
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

test("the contact sensor picker follows the selected door", async ({ page }) => {
  // A behaviour check only: in Chromium it also passes with the .value binding removed (tried, incl. changing one door before selecting another), because every change re-renders the option attributes.
  const pick = async (i: number) => { const c = await centre(page, `line[data-d="${i}"]`); await page.mouse.click(c.x, c.y); };
  await pick(0);
  await expect(page.locator("#dsens")).toHaveValue("binary_sensor.demo_front_door");
  await pick(2);
  await expect(page.locator("#dsens")).toHaveValue("");
  await expect(page.locator('#dsens option[value="binary_sensor.demo_garage_door"]')).toHaveCount(1);
  await pick(1);
  await expect(page.locator("#dsens")).toHaveValue("binary_sensor.demo_patio_door");
  // choose a sensor for the garage door, then go back to a door with another one and to one with none
  await pick(2);
  await page.locator("#dsens").selectOption("binary_sensor.demo_garage_door");
  expect((await groundOf(page)).doors[2].sensor).toBe("binary_sensor.demo_garage_door");
  await pick(0);
  await expect(page.locator("#dsens")).toHaveValue("binary_sensor.demo_front_door");
  await pick(2);
  await expect(page.locator("#dsens")).toHaveValue("binary_sensor.demo_garage_door");
  await page.locator("#dsens").selectOption("");
  await pick(1);
  await pick(2);
  await expect(page.locator("#dsens")).toHaveValue("");
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

const stairsCount = (page: Page) => page.locator("svg polygon[data-s]");
const savedValid = async (page: Page) => {
  await menu(page, "File");
  const dl = page.waitForEvent("download");
  await page.locator("#save").click();
  const res = validate(JSON.parse(readFileSync(await (await dl).path(), "utf8")));
  expect(res.ok).toBe(true);
  return res.ok ? res.layout : null;
};
const addStairs = async (page: Page) => { await menu(page, "Add"); await page.locator("#addStairs").click(); };

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
  for (const n of [...xs, ...ys]) expect(n % 5).toBe(0);
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

test("two stairs get distinct ids after one is deleted and another added; a floor with none takes the first id", async ({ page }) => {
  await addStairs(page);
  await addStairs(page);
  expect((await groundOf(page)).stairs.map((s) => s.id)).toEqual(["stairs-ground-1", "stairs-ground-2", "stairs-ground-3"]);
  await page.locator("#sdel").click();
  await addStairs(page);
  const ids = (await groundOf(page)).stairs.map((s) => s.id);
  expect(new Set(ids).size).toBe(ids.length);
  // the upper floor has an empty stairs array
  await page.locator('.chip[data-f="first"]').click();
  await expect(stairsCount(page)).toHaveCount(0);
  await addStairs(page);
  await expect(stairsCount(page)).toHaveCount(1);
  expect((await layoutOf(page)).floors.first.stairs[0].id).toBe("stairs-first-1");
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
  await expect(unplaced(page)).toHaveCount(1);
  await page.locator("#vbound").selectOption("");
  expect(await bound(page, 0)).toBeUndefined();
  expect("bound" in (await groundOf(page)).devices[0]).toBe(false);
  await expect(unplaced(page)).toHaveCount(2);
  await menu(page, "File");
  await page.locator("#undo").click();
  expect(await bound(page, 0)).toBe(RELAY);
  await expect(unplaced(page)).toHaveCount(1);
  // choosing the same value again records no step
  await selectDev(page, 0);
  await page.locator("#vbound").selectOption(RELAY);
  await menu(page, "File");
  await expect(page.locator("#undo")).toBeDisabled();
});

test("choosing another free switch updates the list and the saved layout validates", async ({ page }) => {
  await setCatalog(page, [{ id: "plug-free", floor: "ground", room: "Living", type: "plug", name: "Free plug", entity: "switch.free_plug" }]);
  await selectDev(page, 0);
  await expect(page.locator("#vbound option")).toHaveText(["(none)", "Living - Living lamp relay", "Living - Free plug"]);
  await page.locator("#vbound").selectOption("switch.free_plug");
  expect(await bound(page, 0)).toBe("switch.free_plug");
  // the relay is free again, the plug is not
  await expect(page.locator('#addDev option[value="switch-living-relay"]')).toHaveCount(1);
  await expect(page.locator('#addDev option[value="plug-free"]')).toHaveCount(0);
  expect(validate(await layoutOf(page)).ok).toBe(true);
  await savedValid(page);
});

test("a switch already bound elsewhere or placed is not offered", async ({ page }) => {
  await setCatalog(page, [], "l.floors.ground.devices[1].bound = l.floors.ground.devices[0].bound; delete l.floors.ground.devices[0].bound;");
  await selectDev(page, 0);
  const opts = page.locator("#vbound option");
  await expect(opts).toHaveText(["(none)"]); // relay is the kitchen light's; hall switch and TV plug are placed
});

test("a device that is not a light has no Controlled by field", async ({ page }) => {
  await selectDev(page, 2);
  await expect(page.locator("#panel")).toContainText("Hall switch");
  await expect(page.locator("#vbound")).toHaveCount(0);
});

test("deleting the light returns its switch to the Add list", async ({ page }) => {
  await selectDev(page, 0);
  await page.locator("#vdel").click();
  await expect(page.locator(`#addDev option[value="switch-living-relay"]`)).toHaveCount(1);
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

test("Ctrl+Z works right after the Delete button in the panel", async ({ page }) => {
  const c = await screenOf(page, 740, 500);
  await page.mouse.click(c.x, c.y);
  await page.locator("#sdel").click();
  await expect(stairsCount(page)).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(stairsCount(page)).toHaveCount(1);
});

test("a selection made from the Add menu survives the menu closing, then Delete works", async ({ page }) => {
  await menu(page, "Add");
  await page.locator("#addDev").selectOption({ index: 1 });
  await expect(page.locator("g.dev.sel")).toHaveCount(1);
  await expect(page.locator("#panel")).not.toContainText("Nothing selected");
  const n = (await groundOf(page)).devices.length;
  await page.keyboard.press("Delete");
  expect((await groundOf(page)).devices.length).toBe(n - 1);
});

// ---- S1.8 zones and water ----------------------------------------------------
const addKind = async (page: Page, id: "#addZone" | "#addWater") => { await menu(page, "Add"); await page.locator(id).click(); };
const roomPolys = (page: Page) => page.locator("svg polygon[data-r]");

test("Add, Zone places a 200 x 200 cm zone on the grid, centred, selected, dotted, with all w false; one undo step removes it", async ({ page }) => {
  const before = await groundOf(page);
  await addKind(page, "#addZone");
  await expect(roomPolys(page)).toHaveCount(before.rooms.length + 1);
  const g = await groundOf(page), z = g.rooms[g.rooms.length - 1], n = g.rooms.length - 1;
  expect(z.kind).toBe("zone");
  expect(z.w).toEqual([false, false, false, false]);
  expect(new Set(g.rooms.map((r) => r.id)).size).toBe(g.rooms.length);
  const xs = z.pts.map((p) => p[0]), ys = z.pts.map((p) => p[1]);
  expect(Math.max(...xs) - Math.min(...xs)).toBe(200);
  expect(Math.max(...ys) - Math.min(...ys)).toBe(200);
  for (const v of [...xs, ...ys]) expect(v % 5).toBe(0);
  const view = await page.evaluate((tag) => ({ ...(document.querySelector(tag) as any).st.view }), EDITOR);
  expect(Math.abs((Math.min(...xs) + 100) - (view.x + view.w / 2))).toBeLessThanOrEqual(5);
  expect(Math.abs((Math.min(...ys) + 100) - (view.y + view.h / 2))).toBeLessThanOrEqual(5);
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

test("Add, Water places a 200 x 200 cm water polygon filled from --fp-water, selected", async ({ page }) => {
  await addKind(page, "#addWater");
  const g = await groundOf(page), w = g.rooms[g.rooms.length - 1], n = g.rooms.length - 1;
  expect(w.kind).toBe("water");
  const xs = w.pts.map((p) => p[0]);
  expect(Math.max(...xs) - Math.min(...xs)).toBe(200);
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
  expect(options).toEqual(expect.arrayContaining(["zone", "water"]));
  expect((await groundOf(page)).rooms[0].w).toEqual([true, true, true, true]);
  await page.locator("#rk").selectOption("zone");
  const z = (await groundOf(page)).rooms[0];
  expect(z.kind).toBe("zone");
  expect(z.w).toEqual([false, false, false, false]);
  await menu(page, "File");
  await page.locator("#undo").click();
  const back = (await groundOf(page)).rooms[0];
  expect(back.kind).toBe("room");
  expect(back.w).toEqual([true, true, true, true]);
});

test("dragging a zone corner onto a wall does not insert a point into the wall or the rooms", async ({ page }) => {
  await addKind(page, "#addZone");
  const g0 = await groundOf(page), zi = g0.rooms.length - 1, z = g0.rooms[zi];
  const counts = (g: Floor) => ({ o: g.outline.length, rooms: g.rooms.slice(0, 3).map((r) => r.pts.length), w: g.rooms.slice(0, 3).map((r) => r.w.length), walls: g.walls.length });
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

test("a thin fence stays clickable a few pixels off its line, and the nearest wall wins", async ({ page }) => {
  await withWallRow(page);
  const c = await screenOf(page, 60 + 3 * 150, 650); // the fence
  await page.mouse.click(c.x, c.y + 5);
  await expect(page.locator("#wk")).toHaveValue("fence");
  await page.mouse.click(c.x, c.y - 6);
  await expect(page.locator("#wk")).toHaveValue("fence");
});

test("the wall panel has a kind select with five human labels and no toggle button", async ({ page }) => {
  await withWallRow(page);
  await clickCm(page, 60, 650);
  await expect(page.locator("#wk")).toHaveJSProperty("tagName", "SELECT");
  expect(await page.locator("#wk option").evaluateAll((o) => o.map((x) => [(x as HTMLOptionElement).value, x.textContent]))).toEqual([
    ["wall", "Internal wall"], ["boundary", "Dotted boundary"], ["external", "External wall"], ["fence", "Fence"], ["edge", "Outdoor edge"],
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
