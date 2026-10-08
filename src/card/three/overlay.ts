// The HTML layer over the 3D canvas (S12.5): the room names and readouts, and one icon per device, each at a point of the
// model that the view projects to the screen whenever the camera or the size changes. The icons are the plan's own markup
// (core/live.ts hands the inner SVG, classes and custom properties the plan writes), so the card's stylesheet colours them
// and 2D and 3D cannot differ. The whole layer is `pointer-events:none`: the canvas under it takes every pointer, and a tap on
// an icon is answered by `hit()` through the same `pick` a tap anywhere else gets (DECISIONS S12.5). Nothing is imported from
// core at run time (types only). Every string that reaches the DOM goes through textContent or setAttribute, never markup,
// except the icon's inner SVG, which core builds from its own inlined table (CLAUDE.md finding 2).
import type { Live3D } from "../../core/live";

type P3 = readonly [number, number, number];
export interface Anchors { devices: Map<number, P3>; rooms: Map<number, P3> }
/** Where a point is on the screen (px from the layer's top left), and whether it is in front of the camera at all. */
export type Projector = (p: P3) => { x: number; y: number; front: boolean };

const NS = "http://www.w3.org/2000/svg";
/** px. An icon is a 32 px box (the plan's halo is 32 units across); a tap lands on it within this radius of its centre. */
const ICON_PX = 32, HIT_PX = 16;
const CSS = `.fp3-ov{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:0}
.fp3-ov *{pointer-events:none}
.fp3-dev,.fp3-rm{position:absolute;left:0;top:0;will-change:transform}
.fp3-dev{width:0;height:0}
.fp3-ic{position:absolute;left:-${ICON_PX / 2}px;top:-${ICON_PX / 2}px;width:${ICON_PX}px;height:${ICON_PX}px;overflow:visible}
.fp3-dv,.fp3-dn{position:absolute;left:0;transform:translateX(-50%);white-space:nowrap;font:11px/1.2 var(--fp-font,system-ui,sans-serif)}
.fp3-dv{top:${ICON_PX / 2 + 1}px}
.fp3-dn{top:${ICON_PX / 2 + 13}px;opacity:.85}
.fp3-dv,.fp3-dn,.fp3-name,.fp3-val{color:var(--fp-text);text-shadow:0 0 2px var(--fp-outline),0 0 2px var(--fp-outline),0 0 3px var(--fp-outline),0 0 5px var(--fp-outline)}
.fp3-rm{text-align:center;white-space:nowrap;font:500 12px/1.25 var(--fp-font,system-ui,sans-serif)}
.fp3-name,.fp3-val{display:block}
.fp3-val{font-weight:400;font-size:11px}`;

interface Item { el: HTMLElement; at: P3; sig: string; shown: boolean; x: number; y: number }

export function createOverlay(container: HTMLElement) {
  const root = document.createElement("div");
  root.className = "fp3-ov";
  const style = document.createElement("style");
  style.textContent = CSS;
  root.appendChild(style);
  container.appendChild(root);
  const icons = new Map<number, Item & { svg: SVGSVGElement; g: SVGGElement; dv: HTMLElement | null; dn: HTMLElement | null }>(), rooms = new Map<number, Item & { name: HTMLElement; val: HTMLElement }>();
  const text = (cls: string, s: string) => { const e = document.createElement("span"); e.className = cls; e.textContent = s; return e; };

  /** Brings the elements in line with the live state: made, changed or removed in place. A change of nothing writes nothing. */
  function set(live: Live3D, anchors: Anchors) {
    const seenD = new Set<number>(), seenR = new Set<number>();
    anchors.devices.forEach((a, i) => {
      const d = live.devices[i];
      if (!d) return;
      seenD.add(i);
      const at: P3 = d.at ? [d.at[0], a[1], d.at[1]] : a; // a person's room sensor puts the icon at the room's centre, as in 2D
      let it = icons.get(i);
      if (!it) {
        const el = document.createElement("div"), svg = document.createElementNS(NS, "svg"), g = document.createElementNS(NS, "g");
        el.className = "fp3-dev";
        el.style.visibility = "hidden"; // until `place` has put it somewhere
        svg.setAttribute("class", "fp3-ic");
        svg.setAttribute("data-i", String(i));
        svg.setAttribute("viewBox", "-4 -4 32 32");
        svg.appendChild(g);
        el.appendChild(svg);
        root.appendChild(el);
        icons.set(i, (it = { el, svg, g, dv: null, dn: null, at, sig: "", shown: false, x: NaN, y: NaN }));
      }
      it.at = at;
      const sig = [d.klass, d.style, d.icon].join("\u0000");
      if (sig !== it.sig) { it.sig = sig; it.g.setAttribute("class", d.klass); it.g.setAttribute("style", d.style); it.g.innerHTML = d.icon; }
      const val = live.labels ? d.value : "", name = live.labels && live.names ? d.name : "";
      if (val) { if (!it.dv) { it.dv = text("fp3-dv", ""); it.el.appendChild(it.dv); } if (it.dv.textContent !== val) it.dv.textContent = val; } else if (it.dv) { it.dv.remove(); it.dv = null; }
      if (name) { if (!it.dn) { it.dn = text("fp3-dn", ""); it.el.appendChild(it.dn); } if (it.dn.textContent !== name) it.dn.textContent = name; } else if (it.dn) { it.dn.remove(); it.dn = null; }
      if (it.dn) it.dn.style.top = `${ICON_PX / 2 + (val ? 13 : 1)}px`;
    });
    for (const [i, it] of icons) if (!seenD.has(i)) { it.el.remove(); icons.delete(i); }
    if (live.labels) {
      anchors.rooms.forEach((a, r) => {
        const lr = live.rooms[r];
        if (!lr || (!lr.name && !lr.readout)) return;
        seenR.add(r);
        let it = rooms.get(r);
        if (!it) {
          const el = document.createElement("div"), name = text("fp3-name", ""), val = text("fp3-val", "");
          el.className = "fp3-rm";
          el.style.visibility = "hidden";
          el.setAttribute("data-r", String(r));
          el.append(name, val);
          root.appendChild(el);
          rooms.set(r, (it = { el, name, val, at: a, sig: "", shown: false, x: NaN, y: NaN }));
        }
        it.at = [lr.at[0], a[1], lr.at[1]];
        const sig = `${lr.name}\u0000${lr.readout}`;
        if (sig !== it.sig) { it.sig = sig; it.name.textContent = lr.name; it.val.textContent = lr.readout; it.name.hidden = !lr.name; it.val.hidden = !lr.readout; }
      });
    }
    for (const [r, it] of rooms) if (!seenR.has(r)) { it.el.remove(); rooms.delete(r); }
  }

  /** Moves every element to where its point is on the screen, and hides the ones that are behind the camera, off the view or behind a wall. */
  function place(project: Projector, blocked: (p: P3) => boolean, w: number, h: number) {
    const put = (it: Item, centred: boolean) => {
      const s = project(it.at), shown = s.front && s.x > -ICON_PX && s.x < w + ICON_PX && s.y > -ICON_PX && s.y < h + ICON_PX && !blocked(it.at);
      if (shown !== it.shown) { it.shown = shown; it.el.style.visibility = shown ? "" : "hidden"; }
      if (shown && (Math.abs(s.x - it.x) > 0.05 || Math.abs(s.y - it.y) > 0.05 || Number.isNaN(it.x))) {
        it.x = s.x; it.y = s.y;
        it.el.style.transform = `translate(${s.x.toFixed(1)}px,${s.y.toFixed(1)}px)${centred ? " translate(-50%,-50%)" : ""}`;
      }
    };
    for (const it of icons.values()) put(it, false);
    for (const it of rooms.values()) put(it, true);
  }

  return {
    set, place,
    /** The device whose icon is under (x, y) in the layer's pixels, the nearest one within `HIT_PX`, or null. Hidden icons do not count. */
    hit(x: number, y: number): number | null {
      let best: number | null = null, d2 = HIT_PX * HIT_PX;
      for (const [i, it] of icons) {
        if (!it.shown) continue;
        const d = (it.x - x) ** 2 + (it.y - y) ** 2;
        if (d <= d2) { d2 = d; best = i; }
      }
      return best;
    },
    /** What an icon is filled with now, as the browser computes it from the card's own stylesheet: a CSS colour and an opacity 0..1. */
    fill(i: number): { css: string; opacity: number } | null {
      const it = icons.get(i), path = it?.g.querySelector("path");
      if (!it || !path) return null;
      const op = (e: Element) => { const v = parseFloat(getComputedStyle(e).opacity); return Number.isFinite(v) ? v : 1; };
      // S23.4: an on device is a solid disc with an ink glyph, so its colour is the disc's; off has no disc and the glyph is the colour.
      const halo = it.g.querySelector(".halo"), src = halo && parseFloat(getComputedStyle(halo).fillOpacity) > 0 ? halo : path;
      return { css: getComputedStyle(src).fill, opacity: op(it.g) * op(src) };
    },
    /** Test and debug: which devices and rooms have an element, and whether it is on show. */
    state: () => ({ icons: [...icons].map(([i, it]) => ({ i, shown: it.shown })), rooms: [...rooms].map(([r, it]) => ({ r, shown: it.shown })) }),
    dispose() { root.remove(); icons.clear(); rooms.clear(); },
  };
}
