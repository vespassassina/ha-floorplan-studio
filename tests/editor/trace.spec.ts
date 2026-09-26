import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { validate, MAX_TRACE_BYTES, MAX_LAYOUT_BYTES, type Layout } from "../../src/core/schema";

// S7.11: View, Trace image. Every pointer action goes through page.mouse at real coordinates (finding 3).

const EDITOR = "floorplan-studio-editor";
const IMG = `${EDITOR} svg image.trace`;
const layoutOf = (page: Page) => page.evaluate((tag) => JSON.parse(JSON.stringify((document.querySelector(tag) as any).layout)) as Layout, EDITOR);

async function menu(page: Page, name: string) {
  await page.locator(`details.menu > summary:text-is("${name}")`).click();
}
/** A PNG drawn in the page: left half red, right half blue, or random noise (which no codec can shrink much). */
async function png(page: Page, w: number, h: number, noise = false): Promise<Buffer> {
  const b64 = await page.evaluate(([w, h, noise]) => {
    const c = document.createElement("canvas");
    c.width = w as number; c.height = h as number;
    const g = c.getContext("2d")!;
    if (noise) {
      const d = g.createImageData(c.width, c.height);
      for (let i = 0; i < d.data.length; i++) d.data[i] = i % 4 === 3 ? 255 : (Math.random() * 256) | 0;
      g.putImageData(d, 0, 0);
    } else {
      g.fillStyle = "#e00"; g.fillRect(0, 0, c.width / 2, c.height);
      g.fillStyle = "#00e"; g.fillRect(c.width / 2, 0, c.width / 2, c.height);
    }
    return c.toDataURL("image/png").split(",")[1];
  }, [w, h, noise] as const);
  return Buffer.from(b64, "base64");
}
async function openTrace(page: Page) {
  await menu(page, "Edit"); // S8.1: Trace image moved from View to Edit
  await page.locator("#traceBtn").click();
  await expect(page.locator("#tracePanel")).toBeVisible();
}
/** Loads an image and, unless told not to, waits until it is drawn: Load is asynchronous (FileReader, decode, canvas). */
async function load(page: Page, buf: Buffer, name = "scan.png", mimeType = "image/png", wait = true) {
  await openTrace(page);
  await page.locator("#traceFile").setInputFiles({ name, mimeType, buffer: buf });
  if (wait) await expect(page.locator(IMG)).toHaveCount(1, { timeout: 15000 });
}
/** The natural size of the stored image, decoded by the browser. */
const natural = (page: Page, src: string) => page.evaluate((s) => new Promise<[number, number]>((ok, no) => {
  const i = new Image(); i.onload = () => ok([i.naturalWidth, i.naturalHeight]); i.onerror = () => no(new Error("bad image")); i.src = s;
}), src);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
});

test("S7.11: no trace, no image: the demo draws none", async ({ page }) => {
  await expect(page.locator(IMG)).toHaveCount(0);
});

test("S7.11: Load a 20x10 PNG: the image is drawn first, at 2:1, and the layout still validates", async ({ page }) => {
  await load(page, await png(page, 20, 10));
  await expect(page.locator(IMG)).toHaveCount(1);
  const t = (await layoutOf(page)).floors.ground.trace!;
  expect(t.src.startsWith("data:image/png;base64,")).toBe(true);
  expect(t.on).toBe(true);
  expect(t.alpha).toBe(0.5);
  expect(t.w).toBeGreaterThan(0);
  expect(validate(await layoutOf(page)).ok).toBe(true);
  expect(await natural(page, t.src)).toEqual([20, 10]); // small images are not scaled up
  // First in the plan: every room is painted over it.
  const first = await page.evaluate((tag) => (document.querySelector(tag) as any).renderRoot.querySelector("svg g[data-theme] > :first-child, svg g[data-theme] > g.plan-turn > :first-child")?.getAttribute("class"), EDITOR);
  expect(first).toBe("trace");
  const box = (await page.locator(IMG).boundingBox())!;
  expect(box.width / box.height).toBeCloseTo(2, 1); // height follows the aspect ratio
});

test("S7.11: two-point Scale on a full-width pair, 500 cm, sets w to 500", async ({ page }) => {
  await load(page, await png(page, 20, 10));
  const before = (await layoutOf(page)).floors.ground.trace!;
  expect(Math.abs(before.w - 500)).toBeGreaterThan(20); // the demo's outline is not 500 cm wide, so the test can fail
  const box = (await page.locator(IMG).boundingBox())!;
  await page.locator("#traceScale").click();
  await page.mouse.click(box.x, box.y + box.height / 2);
  await page.mouse.click(box.x + box.width, box.y + box.height / 2);
  await page.locator("#traceDist").fill("500");
  await page.locator("#traceApply").click();
  const t = (await layoutOf(page)).floors.ground.trace!;
  expect(Math.abs(t.w - 500)).toBeLessThan(5);
  expect([t.x, t.y, t.src]).toEqual([before.x, before.y, before.src]);
});

test("S7.11: the Scale clicks do not select or move anything on the plan", async ({ page }) => {
  await load(page, await png(page, 20, 10));
  const before = await layoutOf(page);
  const box = (await page.locator(IMG).boundingBox())!;
  await page.locator("#traceScale").click();
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.6);
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.6);
  expect(await layoutOf(page)).toEqual(before);
  expect(await page.evaluate((tag) => (document.querySelector(tag) as any).st.sel, EDITOR)).toBeNull();
  await page.locator("#traceDist").press("Escape"); // cancels: no change, the next click is an ordinary one
  await expect(page.locator("#traceDist")).toHaveCount(0);
  expect(await layoutOf(page)).toEqual(before);
});

test("S7.11: Opacity 0.3 reaches the image's opacity attribute, in one undo step", async ({ page }) => {
  await load(page, await png(page, 20, 10));
  await page.locator("#traceAlpha").fill("0.3");
  await expect(page.locator(IMG)).toHaveAttribute("opacity", "0.3");
  expect((await layoutOf(page)).floors.ground.trace!.alpha).toBe(0.3);
  await page.locator(EDITOR).focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(IMG)).toHaveAttribute("opacity", "0.5");
});

test("S7.11: Show off hides the image and the layout keeps the trace; Show on brings it back", async ({ page }) => {
  await load(page, await png(page, 20, 10));
  await page.locator("#traceOn").uncheck();
  await expect(page.locator(IMG)).toHaveCount(0);
  const t = (await layoutOf(page)).floors.ground.trace!;
  expect(t.on).toBe(false);
  expect(t.src.startsWith("data:image/png")).toBe(true);
  await page.locator("#traceOn").check();
  await expect(page.locator(IMG)).toHaveCount(1);
});

test("S7.11 CSS pair: while a trace is shown, room fills are see-through, so a traced room does not hide the scan", async ({ page }) => {
  const roomOpacity = () => page.evaluate((tag) => getComputedStyle((document.querySelector(tag) as any).renderRoot.querySelector("svg polygon[data-r]")).fillOpacity, EDITOR);
  expect(await roomOpacity()).toBe("1");
  await load(page, await png(page, 20, 10));
  expect(await roomOpacity()).toBe("0.4");
  await page.locator("#traceOn").uncheck();
  await expect.poll(roomOpacity).toBe("1");
});

test("S7.11: Remove drops the trace from the layout", async ({ page }) => {
  await load(page, await png(page, 20, 10));
  await page.locator("#traceRemove").click();
  await expect(page.locator(IMG)).toHaveCount(0);
  expect((await layoutOf(page)).floors.ground.trace).toBeUndefined();
});

test("S7.11: Export leaves the trace out unless Include trace image is ticked", async ({ page }) => {
  await load(page, await png(page, 20, 10));
  const src = (await layoutOf(page)).floors.ground.trace!.src;
  const exported = async () => {
    await menu(page, "File");
    const dl = page.waitForEvent("download");
    await page.locator("#exp").click();
    return JSON.parse(readFileSync((await (await dl).path())!, "utf8")) as Layout;
  };
  const plain = await exported();
  expect(plain.floors.ground).toBeDefined();
  expect("trace" in plain.floors.ground).toBe(false);
  expect((await layoutOf(page)).floors.ground.trace).toBeDefined(); // the plan itself keeps it

  await menu(page, "File");
  await page.locator("#expTrace").check();
  await menu(page, "File");
  const full = await exported();
  expect(full.floors.ground.trace?.src).toBe(src);
  expect(validate(full).ok).toBe(true);
});

test("S7.11: Ctrl/Cmd+Z after Load removes the image", async ({ page }) => {
  await load(page, await png(page, 20, 10));
  await expect(page.locator(IMG)).toHaveCount(1);
  await page.locator(EDITOR).focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(IMG)).toHaveCount(0);
  expect((await layoutOf(page)).floors.ground.trace).toBeUndefined();
});

test("S7.11: a 3000 px PNG comes out 2000 px on its long side, still PNG", async ({ page }) => {
  await load(page, await png(page, 3000, 1500));
  await expect(page.locator(IMG)).toHaveCount(1);
  const t = (await layoutOf(page)).floors.ground.trace!;
  expect(t.src.startsWith("data:image/png;base64,")).toBe(true);
  expect(await natural(page, t.src)).toEqual([2000, 1000]);
});

test("S7.11: a 3000 px PNG of noise becomes a JPEG of 2000 px, under the 4 MB limit", async ({ page }) => {
  await load(page, await png(page, 1200, 3000, true));
  const t = (await layoutOf(page)).floors.ground.trace!;
  expect(t.src.startsWith("data:image/jpeg;base64,")).toBe(true);
  expect(t.src.length).toBeLessThanOrEqual(MAX_TRACE_BYTES);
  expect(await natural(page, t.src)).toEqual([800, 2000]);
  expect(validate(await layoutOf(page)).ok).toBe(true);
});

test("S7.11: a file that is not an image changes nothing and says why", async ({ page }) => {
  const before = await layoutOf(page);
  await load(page, Buffer.from("\"><script>alert(1)</script>"), "scan.png", "image/png", false);
  await expect(page.locator("#status")).toContainText("not an image");
  expect(await layoutOf(page)).toEqual(before);
  await expect(page.locator(IMG)).toHaveCount(0);
});

test("S7.11: Escape closes the Trace panel", async ({ page }) => {
  await openTrace(page);
  await page.locator(EDITOR).focus();
  await page.keyboard.press("Escape");
  await expect(page.locator("#tracePanel")).toHaveCount(0);
});

// Opus re-check of S8.9: the sidebar's own static hints got a wrap-not-clip test (editor.spec.ts, "Opus review: a
// free wall..."), but the trace panel's own <p class="hint"> lives outside #panel and was never checked.
test("S7.11: the Trace panel's own hint wraps fully visible, not clipped", async ({ page }) => {
  await openTrace(page);
  const hint = page.locator("#tracePanel p.hint");
  await expect(hint).toBeVisible();
  const [scrollWidth, clientWidth, text] = await hint.evaluate((e) => [e.scrollWidth, e.clientWidth, e.textContent]);
  expect(scrollWidth as number, `trace panel hint clipped: "${text}"`).toBeLessThanOrEqual(clientWidth as number);
});

// Opus review, 2026-09-25 (M3): Home Assistant's websocket takes 4 MiB in one message, and one trace may already be
// 4 MB. Save refuses a plan over MAX_LAYOUT_BYTES and says which floors carry an image, before any host is asked.
test("Save refuses a plan whose JSON is over the save limit and names the traced floors", async ({ page }) => {
  const big = "data:image/png;base64," + "A".repeat(MAX_LAYOUT_BYTES); // valid by TRACE_SRC, under the per-trace cap only if the cap allows; the sum is what matters
  expect(MAX_LAYOUT_BYTES).toBeLessThan(MAX_TRACE_BYTES); // otherwise this test would need two floors
  await page.evaluate(([tag, src]) => {
    const el = document.querySelector(tag) as any;
    const l = JSON.parse(JSON.stringify(el.layout));
    l.floors.ground.trace = { src, x: 0, y: 0, w: 800, rot: 0, alpha: 0.5, on: true };
    el.layout = l;
  }, [EDITOR, big] as const);
  await expect(page.locator(IMG)).toHaveCount(1);
  await menu(page, "File");
  await page.locator("#save").click();
  await expect(page.locator("#errors")).toContainText("Ground");
  await expect(page.locator("#errors")).toContainText("MB");
  await expect(page.locator("#status")).not.toHaveText(/Sav/);
});

// Opus review, 2026-09-25 (m1): when the browser's storage cannot hold the image, the autosave keeps the plan without
// it. The user must hear that, or a reload before Save loses the scan silently.
test("when the autosave has no room for the trace image, the status says so", async ({ page }) => {
  await page.addInitScript(() => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) { if (v.includes("data:image")) throw new DOMException("quota", "QuotaExceededError"); return real.call(this, k, v); };
  });
  await page.goto("/standalone.html");
  await expect(page.locator(`${EDITOR} svg polygon[data-r]`).first()).toBeVisible();
  await load(page, await png(page, 20, 10));
  await expect(page.locator("#status")).toContainText("no room for the trace image");
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("floorplan-studio:layout") ?? localStorage.getItem(Object.keys(localStorage).find((k) => (localStorage.getItem(k) ?? "").includes('"floors"')) ?? "") ?? "null"));
  expect(stored?.floors?.ground && "trace" in stored.floors.ground).toBe(false); // the plan itself is still autosaved, without the image
});
