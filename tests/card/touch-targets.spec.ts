import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { SIZES, deviceIndex, layout, roomIndex } from "./touch-helpers";
import { ORIGIN, drawn, serve } from "./helpers-3d";

// S31.9 (docs/specs/card-layout-touch.md, criterion 3): under `pointer: coarse` every control of the card is at least 44 x 44 CSS px,
// in every state the card can be in, and under a fine pointer the same controls keep the size they had. The check is a walk, not a
// list: every button, [role], a, input, select, summary and textarea reachable in the card's shadow root and in every shadow root
// below it (<fp-search>, <fp-menu>) is measured, so a control added tomorrow fails here until it is sized. A walk of the resting card
// alone would miss what only exists open (the menu, the search list, the popup, the dialogs, the sheet at half and full), so each
// state is opened with a real finger (`page.touchscreen.tap`) or, on the fine pointer, a real mouse, and walked.
//
// A checkbox or radio is measured by its row (its label), as the spec says "checkbox row": the 18 px box is a mark, the row is the target.
// A text field, a select and a slider are fields: their height must be 44, their width is whatever the layout gives them.
// A control under something that is meant to cover it (the open menu, a dialog's backdrop, the bottom sheet over the plan, the popup)
// is not a defect; a control covered by anything else is, and so are two controls that overlap.

const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = readFileSync(resolve("dist/floorplan-studio-card.js"), "utf8");
const MIN = 44;

type Size = keyof typeof SIZES;
const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-08T09:30:15Z" });
/** The states of `touch-helpers.STATES`, plus a light that dims, warms and colours (the popup then has all three sliders). The attribute names
 *  are Home Assistant's own light attributes (`supported_color_modes`, `brightness`, `color_temp_kelvin`, `hs_color`). */
const STATES = () => ({
  "light.kitchen_spot_1": st("on", { supported_color_modes: ["color_temp", "hs"], brightness: 180, color_temp_kelvin: 3000, min_color_temp_kelvin: 2000, max_color_temp_kelvin: 6500, hs_color: [30, 60] }),
  "light.living_floor_lamp": st("off", { friendly_name: "Living floor lamp" }), "switch.living_relay_1": st("on", { friendly_name: "Living relay 1" }),
  "switch.living_wall_switch": st("on"), "switch.kitchen_kettle_plug": st("on"), "switch.pantry_wall_switch": st("on"),
  "media_player.living_tv": st("on"), "media_player.kitchen_echo": st("playing"), "media_player.living_apple_tv": st("standby"),
  "light.living_spot_1": st("unavailable"),
  "light.study_desk_lamp": st("on"), "light.guest_bedroom_bedside_left": st("off"),
  "vacuum.roborock_ground": st("docked"),
});

async function boot(page: Page, size: Size, touch: boolean, config: Record<string, unknown> = {}) {
  await page.addInitScript(() => { (window as unknown as { __realDetailDefault: boolean }).__realDetailDefault = true; });
  // The 3D code is a lazy chunk the plain file:// harness cannot load: that view is served the way Home Assistant serves it (helpers-3d).
  const threeD = config.view === "3d";
  if (threeD) { await serve(page); await page.goto(`${ORIGIN}/harness.html`); } else await page.goto(URL_);
  await page.evaluate(() => { const m = document.createElement("meta"); m.name = "viewport"; m.content = "width=device-width, initial-scale=1"; document.head.append(m); const w = document.getElementById("wrap"); if (w) w.style.width = "100%"; });
  if (!threeD) await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(([cfg, s]) => {
    try { localStorage.clear(); } catch { /* file: origin without storage */ }
    const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
    el.setConfig(cfg);
    el.hass = { states: s, callService: () => undefined };
    return el.updateComplete;
    // S37.6: the stress house has 437 devices. At a tablet's 768 px, auto now draws every one, and the spot lies in a stack that
    // fans out on its first tap. These tests judge the popup, not the stack, so they pin the old far-at-fit picture.
  }, [{ layout, theme: "light", detail: "minimal", ...config }, STATES()] as const);
  if (threeD) await drawn(page);
  const env = await page.evaluate(() => ({ w: innerWidth, h: innerHeight, coarse: matchMedia("(pointer: coarse)").matches, fine: matchMedia("(pointer: fine)").matches }));
  expect(env, "the pointer of the test is the pointer the test says it is").toEqual({ w: SIZES[size].width, h: SIZES[size].height, coarse: touch, fine: !touch });
}

// ---- in the page ------------------------------------------------------------------------------------------------------------------

const DEEP = `
  const cardRoot = () => document.getElementById("card").shadowRoot;
  const deepAll = (sel, root = cardRoot(), out = []) => { for (const e of root.querySelectorAll(sel)) out.push(e); for (const e of root.querySelectorAll("*")) if (e.shadowRoot) deepAll(sel, e.shadowRoot, out); return out; };
  const up = (n) => n.parentElement ?? (n.getRootNode() instanceof ShadowRoot ? n.getRootNode().host : null);
  const deepTop = (x, y) => { let top = document.elementFromPoint(x, y); while (top && top.shadowRoot) { const inner = top.shadowRoot.elementFromPoint(x, y); if (!inner || inner === top) break; top = inner; } return top; };
  const deepContains = (t, n) => { for (; n; n = n.parentNode instanceof ShadowRoot ? n.parentNode.host : n.parentNode) if (n === t) return true; return false; };
  const norm = (s) => (s ?? "").replace(/\\s+/g, " ").trim();
  const shown = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
`;

/** A point on the first visible element matching `sel` (and `text`, a case-insensitive part of its text, label or title) where it is the real top element. */
const pointScript = (sel: string, text: string | null, nth: number) => `(() => { ${DEEP}
  const want = ${JSON.stringify(text)};
  const hits = deepAll(${JSON.stringify(sel)}).filter((e) => shown(e) && (want === null || norm(e.textContent + " " + (e.getAttribute("aria-label") ?? "") + " " + (e.getAttribute("title") ?? "")).toLowerCase().includes(want.toLowerCase())));
  const t = hits[${nth}]; if (!t) return { missing: hits.length };
  t.scrollIntoView({ block: "center", inline: "center" });
  const r = t.getBoundingClientRect();
  for (let a = 1; a < 8; a++) for (let b = 1; b < 8; b++) {
    const x = r.x + (r.width * a) / 8, y = r.y + (r.height * b) / 8;
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
    if (deepContains(t, deepTop(x, y))) return { p: { x, y } };
  }
  return { covered: true };
})()`;

interface Ctx { page: Page; size: Size; touch: boolean }
type Target = { sel: string; text?: string; nth?: number };

/** One real press: a finger when the test is a touch device, the mouse otherwise. Waits on the point holding still (a sheet slides for 0.2 s). */
async function press(c: Ctx, t: Target) {
  const script = pointScript(t.sel, t.text ?? null, t.nth ?? 0);
  type Probe = { missing?: number; covered?: boolean; p?: { x: number; y: number } };
  let res: Probe = {};
  await expect.poll(async () => {
    const a: Probe = await c.page.evaluate(script);
    if (!a.p) { res = a; return a.covered ? "covered" : "missing"; }
    await c.page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
    const b: Probe = await c.page.evaluate(script);
    res = b;
    return b.p && Math.abs(b.p.x - a.p.x) < 0.5 && Math.abs(b.p.y - a.p.y) < 0.5 ? "ready" : "moving";
  }, { message: `${t.sel}${t.text ? ` "${t.text}"` : ""} in the card`, timeout: 4000 }).toBe("ready");
  if (c.touch) await c.page.touchscreen.tap(res.p!.x, res.p!.y);
  else await c.page.mouse.click(res.p!.x, res.p!.y);
}

/** Runs `fn(card, arg)` on the card element: state set-up that has no control of its own (a dialog only a door tap or a locate opens). */
const onCard = <A>(c: Ctx, fn: (el: Record<string, (...a: unknown[]) => unknown> & HTMLElement, arg: A) => unknown, arg: A) =>
  c.page.evaluate(([src, a]) => { const el = document.getElementById("card") as never; return (new Function("return " + src)())(el, a); }, [fn.toString(), arg] as const);

/** The settled sheet: the box stops moving. */
const settle = (page: Page) => page.evaluate(() => new Promise<void>((done) => {
  const sheet = () => document.getElementById("card")!.shadowRoot!.querySelector(".fp-active")?.getBoundingClientRect().height ?? 0;
  let last = -1, same = 0;
  const f = () => { const h = sheet(); same = Math.abs(h - last) < 0.01 ? same + 1 : 0; last = h; if (same >= 4) done(); else requestAnimationFrame(f); };
  requestAnimationFrame(f);
}));

// ---- the walk ---------------------------------------------------------------------------------------------------------------------

interface Rec { desc: string; field: boolean; w: number; h: number; covered: string | null; overlaps: string[]; onScreen: boolean }

const WALK = `(() => { ${DEEP}
  const SEL = 'button, select, input, textarea, summary, a[href], [role=button], [role^=menuitem], [role=checkbox], [role=radio], [role=switch], [role=tab], [role=option], [role=combobox], [role=slider], [role=link]';
  const OVERLAY = '[role=listbox], [role=menu], [role=dialog], .fp-dialog-backdrop, .fp-bottom, .fp-pop';
  const describe = (e) => { const n = norm(e.getAttribute("aria-label") ?? e.textContent).slice(0, 28); return e.tagName.toLowerCase() + (e.tagName === "INPUT" ? "[" + (e.getAttribute("type") ?? "text") + "]" : "") + (e.getAttribute("role") ? "[" + e.getAttribute("role") + "]" : "") + (e.className && typeof e.className === "string" ? "." + e.className.split(" ").filter(Boolean)[0] : "") + ' "' + n + '"'; };
  const clipped = (e, r0) => {
    let r = { l: Math.max(0, r0.left), t: Math.max(0, r0.top), r: Math.min(innerWidth, r0.right), b: Math.min(innerHeight, r0.bottom) };
    let abs = false;
    for (let n = e; n; n = up(n)) {
      const cs = getComputedStyle(n);
      if (n !== e && (cs.overflowX !== "visible" || cs.overflowY !== "visible") && !(abs && cs.position === "static")) {
        const b = n.getBoundingClientRect(); r = { l: Math.max(r.l, b.left), t: Math.max(r.t, b.top), r: Math.min(r.r, b.right), b: Math.min(r.b, b.bottom) };
      }
      if (cs.position === "absolute" || cs.position === "fixed") abs = true; else if (cs.position !== "static" && n !== e) abs = false;
    }
    return r;
  };
  const inert = (e) => { for (let n = e; n; n = up(n)) if (n.hasAttribute && n.hasAttribute("inert")) return true; return false; };
  const items = [];
  for (const e of deepAll(SEL)) {
    if (e.closest("svg.fp-zoomable")) continue;
    if (!shown(e)) continue;
    let hid = false; for (let n = e; n; n = up(n)) if (n.hasAttribute && n.hasAttribute("hidden")) hid = true;
    if (hid) continue;
    const tag = e.tagName.toLowerCase(), ty = (e.getAttribute("type") ?? "").toLowerCase();
    const target = tag === "input" && (ty === "checkbox" || ty === "radio") ? (e.closest("label") ?? e) : e;
    const rect = target.getBoundingClientRect();
    const field = (tag === "input" && ty !== "checkbox" && ty !== "radio") || tag === "select" || tag === "textarea" || e.getAttribute("role") === "combobox" || e.getAttribute("role") === "slider";
    const vis = clipped(target, rect);
    items.push({ e, target, rect, vis, field, area: Math.max(0, vis.r - vis.l) * Math.max(0, vis.b - vis.t), inert: inert(target) });
  }
  const overlayOf = (n) => { for (; n; n = up(n)) if (n.matches && n.matches(OVERLAY)) return n; return null; };
  const intended = (over, under) => { const o = overlayOf(over); return !!o && !deepContains(o, under); };
  const out = [];
  for (const a of items) {
    let covered = null;
    if (a.area >= 4 && !a.inert) {
      const x = (a.vis.l + a.vis.r) / 2, y = (a.vis.t + a.vis.b) / 2, top = deepTop(x, y);
      if (top && !deepContains(a.target, top) && !intended(top, a.target)) covered = describe(top);
    }
    const overlaps = [];
    for (const b of items) {
      if (a === b || a.area < 4 || b.area < 4 || a.inert || b.inert) continue;
      const w = Math.min(a.vis.r, b.vis.r) - Math.max(a.vis.l, b.vis.l), h = Math.min(a.vis.b, b.vis.b) - Math.max(a.vis.t, b.vis.t);
      if (w <= 0 || h <= 0 || w * h <= 4) continue;
      if (deepContains(a.target, b.target) || deepContains(b.target, a.target)) continue;
      if (intended(b.target, a.target) || intended(a.target, b.target)) continue;
      overlaps.push(describe(b.e));
    }
    out.push({ desc: describe(a.e), field: a.field, w: a.rect.width, h: a.rect.height, covered, overlaps, onScreen: a.area >= 4 });
  }
  return out;
})()`;

/** The defects of one walk: a control under 44 (a field only in height), a control covered by something that is not meant to cover it, an overlap. */
function defects(recs: Rec[]): string[] {
  const out: string[] = [];
  for (const r of recs) {
    if (r.h < MIN - 0.01 || (!r.field && r.w < MIN - 0.01)) out.push(`${r.desc} is ${r.w.toFixed(1)} x ${r.h.toFixed(1)}`);
    if (r.covered) out.push(`${r.desc} is covered by ${r.covered}`);
    for (const o of r.overlaps) out.push(`${r.desc} overlaps ${o}`);
  }
  return out;
}

// ---- the states -------------------------------------------------------------------------------------------------------------------

const KITCHEN = `svg polygon[data-r="${roomIndex("ground", "Kitchen")}"]`;
const SPOT = `svg g[data-x="${deviceIndex("ground", "light.kitchen_spot_1")}"]`;
// A switch whose icon is big enough to hit on a phone at fit (the Detail default hides the small ones until the plan is zoomed).
const PANTRY_SWITCH = `svg g[data-x="${deviceIndex("ground", "switch.pantry_wall_switch")}"]`;
const HANDLE = { sel: "button.fp-handle" };

/** The Overview open: the side sheet on a tablet (folded to a rail until opened), the bottom sheet at half on a phone. */
async function overview(c: Ctx) {
  if (c.size === "tablet") await press(c, { sel: "button.fp-rail-open" });
  else { await press(c, HANDLE); await settle(c.page); }
}

interface State {
  name: string;
  sizes?: Size[];
  config?: Record<string, unknown>;
  open(c: Ctx): Promise<void>;
  /** Controls that must be in the walk, so a state that did not open fails here and not as a green walk of nothing. */
  must: string[];
  /** Selectors of the rules this state shows (the pair check below). */
  rules?: string[];
}

const STATES_TO_WALK: State[] = [
  { name: "resting card (rail on a tablet, peek on a phone)", open: async () => {}, must: ['"Search"', '"View options"'], rules: [".fp-head-btn", ".fp-floors button", ".fp-stack button"] },
  { name: "rail", sizes: ["tablet"], open: async () => {}, must: ["fp-rail-open"], rules: [".fp-rail-open"] },
  { name: "sheet handle at peek", sizes: ["phone"], open: async () => {}, must: ["fp-handle"], rules: [".fp-handle"] },
  { name: "Overview open", open: overview, must: ["fp-active-row"], rules: [".fp-active-row", "button.fp-cat", ".fp-floor-off", ".fp-ov-scope"] },
  { name: "Overview open, fold button", sizes: ["tablet"], open: overview, must: ["fp-active-collapse"], rules: [".fp-active-collapse"] },
  { name: "the ... menu open", open: (c) => press(c, { sel: "button.btn", text: "View options" }), must: ["menuitem"], rules: [".btn"] },
  { name: "the ... menu open on the 2.5D view (Tilt and Walls radios)", config: { view: "2.5d" }, open: (c) => press(c, { sel: "button.btn", text: "View options" }), must: ["menuitemradio"] },
  {
    name: "search open with results",
    open: async (c) => { await press(c, { sel: "button.fp-head-btn", text: "Search" }); await c.page.keyboard.type("kitchen"); await c.page.waitForFunction(() => { const r = document.getElementById("card")!.shadowRoot!.querySelector("fp-search")?.shadowRoot; return !!r && r.querySelectorAll("[role=option]").length > 0; }); },
    must: ["combobox", "option"], rules: ["input[role=combobox]", ".opt"],
  },
  { name: "search open, no query", open: (c) => press(c, { sel: "button.fp-head-btn", text: "Search" }), must: ["combobox"] },
  { name: "a floor picked (Overview of the floor)", open: (c) => press(c, { sel: ".fp-floors button", nth: 1 }), must: ["fp-back"], rules: [".fp-back"] },
  { name: "a room picked", open: (c) => press(c, { sel: KITCHEN }), must: ["fp-back", "fp-alloff"], rules: [".fp-back", ".fp-alloff", ".fp-active-row", "phone:.fp-room-clear"] },
  { name: "a room picked, Scenes open", open: async (c) => { await press(c, { sel: KITCHEN }); await press(c, { sel: "button.fp-scenes-head" }); }, must: ["fp-scene"], rules: [".fp-scene"] },
  { name: "a room picked, Show all", open: async (c) => { await press(c, { sel: KITCHEN }); }, must: ["fp-show-all"], rules: [".fp-show-all"] },
  { name: "the device popup", open: (c) => press(c, { sel: SPOT }), must: ["fp-pop-primary", ".fp-pop-hue", "input[range]", "summary"], rules: [".fp-pop button.fp-pop-primary", ".fp-pop button.fp-pop-more", ".fp-pop summary", ".fp-pop input.fp-pop-hue"] },
  { name: "the device popup, Details open", open: async (c) => { await press(c, { sel: SPOT }); await press(c, { sel: ".fp-pop summary" }); }, must: ["summary"] },
  { name: "the popup's confirm step (turn off a switch)", open: async (c) => { await press(c, { sel: PANTRY_SWITCH }); await press(c, { sel: ".fp-pop-do" }); }, must: ["fp-pop-cancel"], rules: [".fp-pop-confirm button"] },
  { name: "the off dialog (Turn off on this floor)", open: async (c) => { await overview(c); await press(c, { sel: "button.fp-floor-off" }); }, must: ["input[checkbox]", "confirm"], rules: [".fp-off-row", ".fp-dialog-actions button"] },
  { name: "the chooser dialog", open: async (c) => { await onCard(c, (el) => { (el as never as { _openChooserDialog(t: string, e: string[]): void })._openChooserDialog("Kitchen patio door", ["cover.kitchen_shutter_1", "light.kitchen_spot_1"]); }, null); await c.page.waitForSelector("css=floorplan-studio-card >> css=.fp-chooser-dialog"); }, must: ["Cancel"], rules: [".fp-chooser-list button"] },
  {
    name: "the cover dialog",
    open: async (c) => { await onCard(c, (el, door) => { (el as never as { _openCoverDialog(d: unknown): void })._openCoverDialog(door); }, layout.floors.ground.doors[7]); await c.page.waitForSelector("css=floorplan-studio-card >> css=.fp-dialog"); },
    must: ["confirm"], rules: [".fp-dialog-actions button"],
  },
  {
    name: "the vacuum dialog",
    open: async (c) => { await onCard(c, (el, d) => { (el as never as { _openVacuumDialog(d: unknown): void })._openVacuumDialog(d); }, layout.floors.ground.devices[deviceIndex("ground", "vacuum.roborock_ground")]); await c.page.waitForSelector("css=floorplan-studio-card >> css=.fp-vacuum-dialog"); },
    must: ["Start", "Pause", "Return to dock"], rules: [".fp-dialog-actions button"],
  },
  {
    name: "the layer note (a located thing under a hidden family)",
    open: async (c) => {
      await overview(c);
      await onCard(c, (el, i) => { const e = el as never as Record<string, unknown> & { requestUpdate(): void }; e._hiddenLayers = ["lights"]; e._kept = { floor: "ground", t: "dev", i, fam: "lights" }; e.requestUpdate(); }, deviceIndex("ground", "light.kitchen_spot_1"));
      await c.page.waitForSelector("css=floorplan-studio-card >> css=.fp-layer-note");
    },
    must: ['"Show"'], rules: [".fp-layer-note button"],
  },
  { name: "3D view (Reset camera)", config: { view: "3d" }, open: async () => {}, must: ["Reset camera"], rules: [".fp-stack button"] },
  { name: "kiosk with the rotate menu in the cluster", config: { kiosk: true, rotate_switch: true }, open: async () => {}, must: ["View options"] },
  { name: "sheet at full", sizes: ["phone"], open: async (c) => { await press(c, HANDLE); await settle(c.page); await press(c, HANDLE); await settle(c.page); }, must: ["fp-handle", "fp-active-row"] },
  { name: "a room at half in the sheet", sizes: ["phone"], open: async (c) => { await press(c, { sel: KITCHEN }); await settle(c.page); }, must: ["fp-back", "fp-room-clear"] },
];

/** Where each rule's control sits under a fine pointer on 0.28.1, pinned: a coarse rule must not leak into the plain pointer. Heights, and widths
 *  where the control is a fixed square. Measured on the unchanged card by running this spec with `PIN=1` (it prints instead of asserting).
 *  A key with `@phone` or `@tablet` is that size's own. */
const FINE: Record<string, { h: number; w?: number }> = {
  ".fp-head-btn": { h: 24.4 }, ".fp-floors button": { h: 24.4 }, ".fp-stack button": { h: 28, w: 28 }, ".fp-rail-open": { h: 36, w: 36 },
  ".fp-handle": { h: 64 }, ".fp-active-collapse": { h: 16 },
  "button.fp-cat": { h: 28 }, ".fp-floor-off": { h: 32 }, ".fp-ov-scope": { h: 24 },
  ".fp-back@tablet": { h: 16 }, ".fp-back@phone": { h: 40, w: 40 }, ".fp-alloff": { h: 32 }, ".fp-room-clear": { h: 24, w: 24 },
  ".fp-scene": { h: 32 }, ".fp-show-all": { h: 19.4 }, ".fp-layer-note button": { h: 24 },
  ".fp-pop button.fp-pop-primary": { h: 44 }, ".fp-pop button.fp-pop-more": { h: 36 }, ".fp-pop summary": { h: 32 }, ".fp-pop input.fp-pop-hue": { h: 20 }, ".fp-pop-confirm button": { h: 44 },
  ".fp-off-row": { h: 32 }, ".fp-dialog-actions button": { h: 29.6 }, ".fp-chooser-list button": { h: 33.6 },
  "input[role=combobox]": { h: 29.6 }, ".opt": { h: 36.1 }, ".btn": { h: 32, w: 32 },
};

// ---- the tests --------------------------------------------------------------------------------------------------------------------

/** What a rule's control measures here: the first visible match in the card or its shadow roots. */
const measure = (page: Page, sel: string) => page.evaluate(`(() => { ${DEEP}
  const e = deepAll(${JSON.stringify(sel)}).find(shown); if (!e) return null;
  const t = e.matches("input[type=checkbox], input[type=radio]") ? e.closest("label") ?? e : e;
  const r = t.getBoundingClientRect(); return { w: r.width, h: r.height };
})()`) as Promise<{ w: number; h: number } | null>;

/** A row whose height is its wrapped text. A pinned pixel height came from macOS fonts and read 52 px on the Linux runner (CI, 0.29.0), so under a fine
 *  pointer the rule is pinned by what it must not carry: the 44 px minimum. */
const TEXT_ROWS = new Set([".fp-active-row"]);

for (const touch of [true, false]) {
  for (const size of ["tablet", "phone"] as const) {
    test.describe(`S31.9 ${touch ? "coarse pointer" : "fine pointer"}, ${size} ${SIZES[size].width} x ${SIZES[size].height}`, () => {
      test.use({ viewport: SIZES[size], hasTouch: touch, isMobile: touch });

      for (const s of STATES_TO_WALK) {
        if (s.sizes && !s.sizes.includes(size)) continue;
        test(s.name, async ({ page }) => {
          const c: Ctx = { page, size, touch };
          await boot(page, size, touch, s.config);
          await s.open(c);
          const recs = (await page.evaluate(WALK)) as Rec[];
          const seen = recs.map((r) => r.desc).join("\n");
          for (const m of s.must) expect(seen, `this state did not open: no ${m} in the walk`).toContain(m);
          if (touch) expect(defects(recs), `every control of "${s.name}" at ${size} is 44 x 44 on a coarse pointer, and nothing covers or overlaps it (${recs.length} walked)`).toEqual([]);
          // The pair, per rule: coarse is at least 44, fine is what it was.
          for (const raw of s.rules ?? []) {
            const only = /^(tablet|phone):/.exec(raw)?.[1];
            if (only && only !== size) continue;
            const sel = raw.replace(/^(tablet|phone):/, "");
            const m = await measure(page, sel);
            expect(m, `${sel} is in this state`).not.toBeNull();
            if (touch) {
              expect(m!.h, `${sel} coarse height`).toBeGreaterThanOrEqual(MIN - 0.01);
              if (!/input|\.opt|\.fp-off-row|\.fp-handle/.test(sel)) expect(m!.w, `${sel} coarse width`).toBeGreaterThanOrEqual(MIN - 0.01);
            } else if (process.env.PIN) {
              console.log(`PIN ${JSON.stringify(sel)} ${size} ${m!.w.toFixed(1)} ${m!.h.toFixed(1)}`);
            } else if (TEXT_ROWS.has(sel)) {
              const min = await page.evaluate(`(() => { ${DEEP}
                const e = deepAll(${JSON.stringify(sel)}).find(shown); return getComputedStyle(e).minHeight; })()`);
              expect(min, `${sel} carries no coarse minimum height under a fine pointer`).not.toBe("44px");
            } else {
              const pin = FINE[`${sel}@${size}`] ?? FINE[sel];
              expect(pin, `${sel} has a pinned fine size (got ${m!.w.toFixed(1)} x ${m!.h.toFixed(1)})`).toBeDefined();
              expect(m!.h, `${sel} fine height is unchanged`).toBeCloseTo(pin!.h, 0);
              if (pin!.w !== undefined) expect(m!.w, `${sel} fine width is unchanged`).toBeCloseTo(pin!.w, 0);
            }
          }
        });
      }
    });
  }
}
