import { expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { cardSource } from "../../scripts/card-source.mjs";

// S31.1: helpers for the tap tasks of Sprint 31 (docs/specs/card-layout-touch.md, K1 to K5). Real taps only: every tap is one
// `page.touchscreen.tap` at a point where the target is the real top element (finding 3), and every tap is counted.
// The spec file that uses these sets `hasTouch` and `isMobile` with `test.use` (a browser context option, not a page one);
// `bootTouch` asserts they took effect.

export const SIZES = { tablet: { width: 768, height: 1024 }, phone: { width: 390, height: 844 } } as const;
export type TouchSize = { width: number; height: number };

const URL_ = pathToFileURL(resolve("tests/card/harness.html")).href;
const CARD_JS = cardSource(); // the card with its Overview chunk inlined (scripts/card-source.mjs)
/** The stress house (three floors, 437 devices), the layout of the spec's acceptance criteria. */
export const layout = JSON.parse(readFileSync("tests/fixtures/stress-layout.json", "utf8"));

const st = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes, last_changed: "2026-10-08T09:30:15Z" });
/** The states of `card-find.spec.ts`: Ground has lamps, a relay, the kettle plug and the kitchen speaker on; First has
 *  `light.study_desk_lamp` on; Second has the guest bedside lamp off. */
export const STATES = () => ({
  "light.kitchen_spot_1": st("on"),
  "light.living_floor_lamp": st("off", { friendly_name: "Living floor lamp" }), "switch.living_relay_1": st("on", { friendly_name: "Living relay 1" }),
  "switch.living_wall_switch": st("on"), "switch.kitchen_kettle_plug": st("on"),
  "media_player.living_tv": st("on"), "media_player.kitchen_echo": st("playing"), "media_player.living_apple_tv": st("standby"),
  "light.living_spot_1": st("unavailable"),
  "light.study_desk_lamp": st("on"), "light.guest_bedroom_bedside_left": st("off"),
});

const tapCount = new WeakMap<Page, number>();
const typedCount = new WeakMap<Page, number>();
/** Taps made through these helpers on this page since `bootTouch`. */
export const taps = (page: Page) => tapCount.get(page) ?? 0;
/** Letters typed through `typeText` since `bootTouch`, counted apart from taps. */
export const typed = (page: Page) => typedCount.get(page) ?? 0;
/** Types into the focused field, one counted letter per character. */
export async function typeText(page: Page, text: string) {
  await page.keyboard.type(text);
  typedCount.set(page, typed(page) + text.length);
}

/** Boots the card as a touch device of `size`: the stress layout, the states above, the real Detail default, storage
 *  cleared, ground floor shown. Asserts the viewport, `pointer: coarse` and `hover: none`, so a test that runs without
 *  `hasTouch` and `isMobile` fails here, not three taps later. */
export async function bootTouch(page: Page, size: TouchSize, config: Record<string, unknown> = {}, states: Record<string, unknown> = STATES()) {
  tapCount.set(page, 0);
  typedCount.set(page, 0);
  await page.addInitScript(() => { (window as unknown as { __realDetailDefault: boolean }).__realDetailDefault = true; });
  await page.goto(URL_);
  // A mobile browser lays a page out 980 px wide unless it has a viewport meta; the harness has none.
  await page.evaluate(() => { const m = document.createElement("meta"); m.name = "viewport"; m.content = "width=device-width, initial-scale=1"; document.head.append(m); });
  await page.addScriptTag({ content: CARD_JS, type: "module" });
  await page.evaluate(() => customElements.whenDefined("floorplan-studio-card"));
  await page.evaluate(
    ([cfg, s]) => {
      try { localStorage.clear(); } catch { /* file: origin without storage */ }
      const w = window as unknown as { __calls: unknown[] };
      w.__calls = [];
      const el = document.getElementById("card") as unknown as HTMLElement & { setConfig(c: unknown): void; hass: unknown; updateComplete: Promise<unknown> };
      el.setConfig(cfg);
      // The reply shape of the card's own `callService(domain, service, data)` (finding 21: copied from the card's calls, not invented).
      el.hass = { states: s, callService: (domain: string, service: string, data: unknown) => { w.__calls.push([domain, service, data]); } };
      return el.updateComplete;
    },
    [{ layout, theme: "light", ...config }, states] as const,
  );
  const env = await page.evaluate(() => ({ w: innerWidth, h: innerHeight, coarse: matchMedia("(pointer: coarse)").matches, none: matchMedia("(hover: none)").matches, touch: navigator.maxTouchPoints > 0 }));
  expect(env, "a touch device of the requested size (test.use hasTouch and isMobile)").toEqual({ w: size.width, h: size.height, coarse: true, none: true, touch: true });
}

export const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: unknown[] }).__calls);

/** In the page: the shadow-root walk that every finder below shares. Kept as a string so it runs in the page unchanged. */
const FINDER = `
  const norm = (s) => (s ?? "").replace(/\\s+/g, " ").trim();
  const roleOf = (e) => {
    const r = e.getAttribute("role"); if (r) return r;
    const t = e.tagName.toLowerCase();
    if (t === "button") return "button";
    if (t === "select") return "combobox";
    if (t === "summary") return "button";
    if (t === "a" && e.hasAttribute("href")) return "link";
    if (t === "input") { const ty = (e.getAttribute("type") ?? "text").toLowerCase(); return ty === "checkbox" ? "checkbox" : ty === "radio" ? "radio" : ty === "range" ? "slider" : "textbox"; }
    return null;
  };
  const nameOf = (e) => {
    const a = e.getAttribute("aria-label"); if (a) return norm(a);
    const by = e.getAttribute("aria-labelledby");
    if (by) { const root = e.getRootNode(); const n = by.split(/\\s+/).map((id) => norm(root.getElementById?.(id)?.textContent)).join(" ").trim(); if (n) return n; }
    return norm(e.textContent);
  };
  const walk = (root, fn) => { for (const e of root.querySelectorAll("*")) { fn(e); if (e.shadowRoot) walk(e.shadowRoot, fn); } };
  /** elementFromPoint through every shadow root: the real top element at a point. */
  const deepTop = (x, y) => { let top = document.elementFromPoint(x, y); while (top && top.shadowRoot) { const inner = top.shadowRoot.elementFromPoint(x, y); if (!inner || inner === top) break; top = inner; } return top; };
  const deepContains = (t, top) => { for (let n = top; n; n = n.parentNode ?? n.host) if (n === t) return true; return false; };
  const hidden = (e) => { const s = getComputedStyle(e); return s.visibility === "hidden" || s.display === "none" || e.closest("[hidden]") !== null; };
`;

type Matcher = { source: string; flags: string } | { exact: string };
const matcher = (name: string | RegExp): Matcher => (typeof name === "string" ? { exact: name } : { source: name.source, flags: name.flags });

/** A control by its accessible name, inside the card's shadow root and every shadow root below it (`<fp-search>`). The card's
 *  own role and name, not its class: the spec's names are the contract (docs/specs/card-layout-touch.md, Accessible names). */
function findScript(role: string, name: Matcher) {
  return `(() => {
    ${FINDER}
    const m = ${JSON.stringify(name)}; const role = ${JSON.stringify(role)};
    const ok = (n) => ("exact" in m ? n === m.exact : new RegExp(m.source, m.flags).test(n));
    const found = [];
    walk(document.getElementById("card").shadowRoot, (e) => { if (roleOf(e) === role && !hidden(e) && ok(nameOf(e))) found.push(e); });
    return found;
  })()`;
}

/** Scrolls `target` into view and returns a point where it, or a descendant, is the real top element. */
const POINT_FN = `
  const pointOn = (t) => {
    t.scrollIntoView({ block: "center", inline: "center" });
    const r = t.getBoundingClientRect();
    for (let a = 1; a < 8; a++) for (let b = 1; b < 8; b++) {
      const x = r.x + (r.width * a) / 8, y = r.y + (r.height * b) / 8;
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
      if (deepContains(t, deepTop(x, y))) return { x, y };
    }
    return null;
  };
`;

async function tapAt(page: Page, p: { x: number; y: number }) {
  await page.touchscreen.tap(p.x, p.y);
  tapCount.set(page, taps(page) + 1);
}

/** One tap on the control with this role and accessible name. A missing control fails at once with its name, after a short
 *  wait on the state (not a timeout of the whole test), so a red task says what is missing. */
export async function tapRole(page: Page, role: string, name: string | RegExp) {
  const label = `${role} "${name}"`;
  const script = `(() => { ${FINDER} ${POINT_FN} const found = ${findScript(role, matcher(name))}; if (found.length === 0) return { missing: true }; if (found.length > 1) return { many: found.length }; const p = pointOn(found[0]); return p ? { p } : { covered: true }; })()`;
  type Probe = { missing?: boolean; many?: number; covered?: boolean; p?: { x: number; y: number } };
  let res: Probe = {};
  // S31.8: a sheet slides for 0.2 s when it opens, so a point read now may be elsewhere when the finger lands. Ready means the same
  // point twice, two animation frames apart; a finger waits for a control to hold still, as a person does.
  await expect.poll(async () => {
    const a: Probe = await page.evaluate(script);
    if (!a.p) { res = a; return a.missing ? "missing" : a.many ? "many" : "covered"; }
    await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
    const b: Probe = await page.evaluate(script);
    res = b;
    return b.p && Math.abs(b.p.x - a.p.x) < 0.5 && Math.abs(b.p.y - a.p.y) < 0.5 ? "ready" : "moving";
  }, { message: `${label} in the card`, timeout: 3000 }).toBe("ready");
  await tapAt(page, res.p!);
}

/** One tap on a plan element (a room polygon, a device icon) by selector inside the card's shadow root. */
export async function tapPlan(page: Page, selector: string) {
  const script = `(() => { ${FINDER} ${POINT_FN} const t = document.getElementById("card").shadowRoot.querySelector(${JSON.stringify(selector)}); if (!t) return { missing: true }; const p = pointOn(t); return p ? { p } : { covered: true }; })()`;
  let res: { missing?: boolean; p?: { x: number; y: number } } = {};
  await expect.poll(async () => { res = await page.evaluate(script); return res.p ? "ready" : res.missing ? "missing" : "covered"; }, { message: `${selector} on the plan`, timeout: 3000 }).toBe("ready");
  await tapAt(page, res.p!);
}

/** The box of the first control with this role and name, or of a plan element by selector; `null` when absent. */
export function boxOf(page: Page, what: { role: string; name: string | RegExp } | { selector: string }) {
  const script = "role" in what
    ? `(() => { ${FINDER} const f = ${findScript(what.role, matcher(what.name))}; const r = f[0]?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null; })()`
    : `(() => { const r = document.getElementById("card").shadowRoot.querySelector(${JSON.stringify(what.selector)})?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null; })()`;
  return page.evaluate(script) as Promise<{ x: number; y: number; width: number; height: number } | null>;
}

/** Where `device` (an index in the floor's `devices`) sits in the layout: used to find its `g[data-x]` icon. */
export const deviceIndex = (floor: string, entity: string) => (layout.floors[floor].devices as { entity: string }[]).findIndex((d) => d.entity === entity);
export const roomIndex = (floor: string, name: string) => (layout.floors[floor].rooms as { name: string }[]).findIndex((r) => r.name === name);
