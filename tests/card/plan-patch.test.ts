import { describe, expect, it } from "vitest";
import { renderFloor } from "../../src/core/render";
import { DEVICE_TYPES } from "../../src/core/schema";
import type { Floor } from "../../src/core/schema";
import { patchPlan } from "../../src/card/plan-patch";

// S25.6: a state update rewrites only what changed, and the result is the fresh render byte for byte (one draw path:
// the markup always comes from renderFloor; the patch only decides which nodes of the live DOM to touch).
const rooms = [{ id: "r", name: "Room", kind: "living", pts: [[0, 0], [500, 0], [500, 500], [0, 500]] }, { id: "s", name: "Side", kind: "bath", pts: [[500, 0], [1000, 0], [1000, 500], [500, 500]] }];
const devices = DEVICE_TYPES.map((type, i) => ({ id: `d${i}`, type, entity: `x.d${i}`, name: `Dev ${i}`, x: 40 + (i % 12) * 75, y: 80 + Math.floor(i / 12) * 90 }));
const FLOOR = { title: "T", outline: [[0, 0], [1000, 0], [1000, 1000], [0, 1000]], walls: [], stairs: [], doors: [], openings: [], extras: [], furniture: [], unlinked: [], rooms, devices } as unknown as Floor;

type St = Record<string, { state: string; attributes: Record<string, unknown>; last_changed?: string }>;
const states = (s: string): St => Object.fromEntries(devices.map((d) => [d.entity, { state: s, attributes: { friendly_name: d.name } }]));
const draw = (state: St) => renderFloor(FLOOR, { scale: 1, state, now: 1_800_000_000_000, roomGlow: true, theme: "light", detail: "near", labels: true, showNames: true } as never);
const svg = () => document.createElementNS("http://www.w3.org/2000/svg", "svg");

describe("patchPlan equals a fresh render", () => {
  it("covers every device type, for every state change of each", () => {
    expect(devices.length).toBe(DEVICE_TYPES.length);
    for (const [i, d] of devices.entries()) {
      for (const [from, to] of [["off", "on"], ["on", "off"], ["on", "unavailable"], ["unavailable", "on"], ["off", "alert"], ["alert", "off"], ["on", "playing"]] as const) {
        const a = states("off"); a[d.entity]!.state = from;
        const b = { ...a, [d.entity]: { ...a[d.entity]!, state: to } };
        const el = svg();
        patchPlan(el, draw(a));
        expect(el.innerHTML, `first ${d.type}`).toBe(svgOf(draw(a)));
        patchPlan(el, draw(b));
        expect(el.innerHTML, `${d.type} ${i} ${from} -> ${to}`).toBe(svgOf(draw(b)));
      }
    }
  });
  it("a sequence of changes lands where a fresh render does", () => {
    const el = svg();
    let s = states("off");
    patchPlan(el, draw(s));
    for (const [i, d] of devices.entries()) {
      s = { ...s, [d.entity]: { ...s[d.entity]!, state: i % 3 ? "on" : "unavailable" } };
      patchPlan(el, draw(s));
      expect(el.innerHTML, d.type).toBe(svgOf(draw(s)));
    }
  });
  it("junk markup does not throw and still ends equal", () => {
    const el = svg();
    for (const m of ["", "<g>", "<g/><g/>", 'text<g a="1"></g>', '<g b="2" a="1"/>', '<g a="1" b="2"/>', "<b>x</b>"]) {
      expect(() => patchPlan(el, m)).not.toThrow();
      expect(el.innerHTML).toBe(svgOf(m));
    }
  });
});

describe("the edit script is right for any two lists of nodes", () => {
  it("random lists, with moves, inserts and deletes, end equal to the target", () => {
    let seed = 7;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const list = () => Array.from({ length: rnd(40) }, () => `<g id="n${rnd(12)}" class="${rnd(2) ? "a" : "b"}"><circle r="${rnd(3)}"/></g>`).join("");
    for (let t = 0; t < 300; t++) {
      const el = svg(), a = list(), b = list();
      patchPlan(el, a);
      patchPlan(el, b);
      expect(el.innerHTML, `${a} -> ${b}`).toBe(svgOf(b));
    }
  });
});

function svgOf(markup: string): string {
  const t = svg();
  t.innerHTML = markup;
  return t.innerHTML;
}

describe("patchPlan touches only what changed", () => {
  const record = (el: Element) => { const seen: Node[] = []; const mo = new MutationObserver((l) => l.forEach((r) => seen.push(r.target))); mo.observe(el, { subtree: true, childList: true, attributes: true, characterData: true }); return { done: () => { mo.takeRecords().forEach((r) => seen.push(r.target)); mo.disconnect(); return seen; } }; };
  it("no change, no mutation", () => {
    const el = svg();
    patchPlan(el, draw(states("off")));
    const r = record(el);
    patchPlan(el, draw(states("off")));
    expect(r.done()).toEqual([]);
  });
  it("a node that did not change keeps its identity", () => {
    const el = svg();
    const a = states("off");
    patchPlan(el, draw(a));
    const keep = el.querySelector('[data-x="1"]')!, flip = el.querySelector('[data-x="0"]')!;
    patchPlan(el, draw({ ...a, [devices[0]!.entity]: { ...a[devices[0]!.entity]!, state: "on" } }));
    expect(el.querySelector('[data-x="1"]')).toBe(keep);
    expect(el.querySelector('[data-x="0"]')).toBe(flip); // same element, class changed in place
  });
  it("one device changing mutates a handful of nodes, none of them another device's", () => {
    const el = svg();
    const a = states("off");
    patchPlan(el, draw(a));
    const r = record(el);
    patchPlan(el, draw({ ...a, [devices[3]!.entity]: { ...a[devices[3]!.entity]!, state: "on" } }));
    const seen = r.done();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.length).toBeLessThan(12);
    for (const n of seen) { const g = (n as Element).closest?.("g[data-x]") ?? n.parentElement?.closest("g[data-x]"); if (g) expect(g.getAttribute("data-x")).toBe("3"); }
  });
});
