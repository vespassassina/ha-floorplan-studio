// The HTML layer over the 3D canvas (S12.5): the room names and readouts, and one icon per device, each at a point of the
// model that the view projects to the screen whenever the camera or the size changes. The icons are the plan's own markup
// (core/live.ts hands the inner SVG, classes and custom properties the plan writes), so the card's stylesheet colours them
// and 2D and 3D cannot differ. The whole layer is `pointer-events:none`: the canvas under it takes every pointer, and a tap on
// an icon is answered by `hit()` through the same `pick` a tap anywhere else gets (DECISIONS S12.5). Nothing is imported from
// core at run time (types only). Every string that reaches the DOM goes through textContent or setAttribute, never markup,
// except the icon's inner SVG, which core builds from its own inlined table (CLAUDE.md finding 2).
import type { Live3D } from "../../core/live";
import type { RoomKind } from "../../core/schema";
import { declutter, type Box } from "./declutter";

type P3 = readonly [number, number, number];
/** `roomInfo` (optional) says what each room is and how large, for the label priority (S28.11): a room over a garden, a garden over water. */
export interface Anchors { devices: Map<number, P3>; rooms: Map<number, P3>; roomInfo?: Map<number, { kind: string; area: number }> }
/** Where a point is on the screen (px from the layer's top left), and whether it is in front of the camera at all. */
export type Projector = (p: P3) => { x: number; y: number; front: boolean };

const NS = "http://www.w3.org/2000/svg";
/** px. An icon is a 32 px box (the plan's halo is 32 units across); a tap lands on it within this radius of its centre. */
const ICON_PX = 32, HIT_PX = 16;
/** S28.11. A label that loses to another fades out; the answer is taken once the camera has been still this long (ms), never mid-drag. */
const SETTLE_MS = 160, LEAD = 1;
/** Who keeps the room when boxes meet: a device icon, then a room's name (a room over a garden over water), its readout, a device's value, its name. */
const P_ICON = 100, P_ROOM = 80, P_ZONE = 75, P_GARDEN = 70, P_PAVEMENT = 65, P_WATER = 60, P_FILL = 55, P_READOUT = 50, P_VALUE = 30, P_DNAME = 20;
/** One rank per room kind (a Record, so a new kind fails to compile). Indoor names (room, structure) win; a zone is a named area on top of rooms, just under them; outdoor ground (garden, terrace) is
 *  next, then pavement and water; a fill is decoration and ranks last of the names, still over a readout. */
export const ROOM_PRIORITY: Record<RoomKind, number> = { room: P_ROOM, structure: P_ROOM, zone: P_ZONE, garden: P_GARDEN, terrace: P_GARDEN, pavement: P_PAVEMENT, water: P_WATER, fill: P_FILL };
/** The rank of a room's name. The kind comes from layout data, so an unknown one ranks as a room. */
export const roomPriority = (kind: string): number => (Object.prototype.hasOwnProperty.call(ROOM_PRIORITY, kind) ? ROOM_PRIORITY[kind as RoomKind] : P_ROOM);
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
.fp3-val{font-weight:400;font-size:11px}
.fp3-ic,.fp3-dv,.fp3-dn,.fp3-name,.fp3-val{transition:opacity .12s linear}
.fp3-ov .fp3-lose{opacity:0}
@media (prefers-reduced-motion:reduce){.fp3-ic,.fp3-dv,.fp3-dn,.fp3-name,.fp3-val{transition:none}}`;

interface Item { el: HTMLElement; at: P3; sig: string; shown: boolean; x: number; y: number }
const LOSE = "fp3-lose";

export function createOverlay(container: HTMLElement) {
  const root = document.createElement("div");
  root.className = "fp3-ov";
  const style = document.createElement("style");
  style.textContent = CSS;
  root.appendChild(style);
  container.appendChild(root);
  const icons = new Map<number, Item & { svg: SVGSVGElement; g: SVGGElement; dv: HTMLElement | null; dn: HTMLElement | null }>(), rooms = new Map<number, Item & { name: HTMLElement; val: HTMLElement; kind: string; area: number }>();
  /** Measured size of an element (px), kept until its text changes: reading it is a layout, so it is done once, not per frame. */
  const sizes = new Map<Element, [number, number]>();
  const sizeOf = (e: HTMLElement): [number, number] => { let s = sizes.get(e); if (!s) { const r = e.getBoundingClientRect(); sizes.set(e, (s = [r.width, r.height])); } return s; };
  // The declutter: `dirty` is set by anything that can change the answer, `lastMove` by a label that moved on the screen.
  let dirty = false, decided = false, lastMove = 0, timer: ReturnType<typeof setTimeout> | null = null, gone = false;
  // A pointer held down on the view is a drag (or a pinch) in progress: nothing is decided until it is up, however slow a frame is.
  const down = new Set<number>();
  const onDown = (e: PointerEvent) => { down.add(e.pointerId); };
  const onUp = (e: PointerEvent) => { if (down.delete(e.pointerId) && !down.size) { lastMove = performance.now(); if (dirty) arm(SETTLE_MS); } };
  container.addEventListener("pointerdown", onDown, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", onUp, true);
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
        dirty = true;
      }
      if (it.at[0] !== at[0] || it.at[1] !== at[1] || it.at[2] !== at[2]) dirty = true;
      it.at = at;
      const sig = [d.klass, d.style, d.icon].join("\u0000");
      if (sig !== it.sig) { it.sig = sig; it.g.setAttribute("class", d.klass); it.g.setAttribute("style", d.style); it.g.innerHTML = d.icon; }
      const val = live.labels ? d.value : "", name = live.labels && live.names ? d.name : "";
      if (val) { if (!it.dv) { it.dv = text("fp3-dv", ""); it.el.appendChild(it.dv); dirty = true; } if (it.dv.textContent !== val) { it.dv.textContent = val; sizes.delete(it.dv); dirty = true; } } else if (it.dv) { sizes.delete(it.dv); it.dv.remove(); it.dv = null; dirty = true; }
      if (name) { if (!it.dn) { it.dn = text("fp3-dn", ""); it.el.appendChild(it.dn); dirty = true; } if (it.dn.textContent !== name) { it.dn.textContent = name; sizes.delete(it.dn); dirty = true; } } else if (it.dn) { sizes.delete(it.dn); it.dn.remove(); it.dn = null; dirty = true; }
      if (it.dn) it.dn.style.top = `${ICON_PX / 2 + (val ? 13 : 1)}px`;
    });
    for (const [i, it] of icons) if (!seenD.has(i)) { it.el.remove(); icons.delete(i); dirty = true; }
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
          rooms.set(r, (it = { el, name, val, at: a, sig: "", shown: false, x: NaN, y: NaN, kind: "room", area: 0 }));
          dirty = true;
        }
        const info = anchors.roomInfo?.get(r);
        it.kind = info?.kind ?? "room"; it.area = info?.area ?? 0;
        if (it.at[0] !== lr.at[0] || it.at[2] !== lr.at[1]) dirty = true;
        it.at = [lr.at[0], a[1], lr.at[1]];
        const sig = `${lr.name}\u0000${lr.readout}`;
        if (sig !== it.sig) { it.sig = sig; it.name.textContent = lr.name; it.val.textContent = lr.readout; it.name.hidden = !lr.name; it.val.hidden = !lr.readout; sizes.delete(it.el); sizes.delete(it.name); sizes.delete(it.val); dirty = true; }
      });
    }
    for (const [r, it] of rooms) if (!seenR.has(r)) { it.el.remove(); rooms.delete(r); dirty = true; }
  }

  /** Moves every element to where its point is on the screen, and hides the ones that are behind the camera, off the view or behind a wall. */
  function place(project: Projector, blocked: (p: P3) => boolean, w: number, h: number) {
    let moved = false;
    const put = (it: Item, centred: boolean) => {
      const s = project(it.at), shown = s.front && s.x > -ICON_PX && s.x < w + ICON_PX && s.y > -ICON_PX && s.y < h + ICON_PX && !blocked(it.at);
      if (shown !== it.shown) { it.shown = shown; it.el.style.visibility = shown ? "" : "hidden"; dirty = true; }
      if (shown && (Math.abs(s.x - it.x) > 0.05 || Math.abs(s.y - it.y) > 0.05 || Number.isNaN(it.x))) {
        moved = true;
        it.x = s.x; it.y = s.y;
        it.el.style.transform = `translate(${s.x.toFixed(1)}px,${s.y.toFixed(1)}px)${centred ? " translate(-50%,-50%)" : ""}`;
      }
    };
    for (const it of icons.values()) put(it, false);
    for (const it of rooms.values()) put(it, true);
    if (moved) { lastMove = performance.now(); dirty = true; }
    // The first answer is at once (nothing is on show before it); later ones wait for the camera to be still, so no label flips mid-drag.
    if (!decided) { if (dirty) decide(); } else if (dirty) { if (!down.size && performance.now() - lastMove >= SETTLE_MS) decide(); else arm(SETTLE_MS); }
  }

  const arm = (ms: number) => { if (!timer && !gone) timer = setTimeout(() => { timer = null; if (!dirty) return; const wait = SETTLE_MS - (performance.now() - lastMove); if (down.size || wait > 0) arm(down.size ? SETTLE_MS : wait); else decide(); }, ms); };
  /** Every label on show, with its box on the screen: the icon, a device's value and name, a room's name and readout. */
  function decide() {
    dirty = false; decided = true;
    const boxes: Box[] = [], els: Element[] = [];
    const add = (e: Element | null, x: number, y: number, w: number, h: number, priority: number, area: number, index: number) => {
      if (!e) return;
      els.push(e);
      // A line of text is taller than its glyphs: its box leaves `LEAD` px of leading at the top and the bottom, so a device's value
      // and name, which are stacked one under the other, and the icon above them, do not count as meeting.
      const lead = priority === P_ICON ? 0 : LEAD;
      boxes.push({ x, y: y + lead, w, h: Math.max(0, h - 2 * lead), priority, area, index });
    };
    for (const [i, it] of icons) {
      if (!it.shown) continue;
      add(it.svg, it.x - ICON_PX / 2, it.y - ICON_PX / 2, ICON_PX, ICON_PX, P_ICON, 0, i);
      if (it.dv) { const [w, h] = sizeOf(it.dv); add(it.dv, it.x - w / 2, it.y + ICON_PX / 2 + 1, w, h, P_VALUE, 0, i); }
      if (it.dn) { const [w, h] = sizeOf(it.dn); add(it.dn, it.x - w / 2, it.y + ICON_PX / 2 + (it.dv ? 13 : 1), w, h, P_DNAME, 0, i); }
    }
    for (const [r, it] of rooms) {
      if (!it.shown) continue;
      const [w, h] = sizeOf(it.el), nameH = it.name.hidden ? 0 : sizeOf(it.name)[1], valH = it.val.hidden ? 0 : sizeOf(it.val)[1];
      if (!it.name.hidden) add(it.name, it.x - w / 2, it.y - h / 2, w, nameH, roomPriority(it.kind), it.area, r);
      if (!it.val.hidden) add(it.val, it.x - w / 2, it.y - h / 2 + nameH, w, valH, P_READOUT, it.area, r);
    }
    const keep = declutter(boxes);
    els.forEach((e, k) => e.classList.toggle(LOSE, !keep[k]));
  }

  return {
    set, place,
    /** The device whose icon is under (x, y) in the layer's pixels, the nearest one within `HIT_PX`, or null. Hidden icons do not count. */
    hit(x: number, y: number): number | null {
      let best: number | null = null, d2 = HIT_PX * HIT_PX;
      for (const [i, it] of icons) {
        if (!it.shown || it.svg.classList.contains(LOSE)) continue;
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
    state: () => ({ icons: [...icons].map(([i, it]) => ({ i, shown: it.shown, kept: !it.svg.classList.contains(LOSE) })), rooms: [...rooms].map(([r, it]) => ({ r, shown: it.shown, kept: !it.name.classList.contains(LOSE) })) }),
    dispose() { gone = true; if (timer) clearTimeout(timer); timer = null; container.removeEventListener("pointerdown", onDown, true); window.removeEventListener("pointerup", onUp, true); window.removeEventListener("pointercancel", onUp, true); root.remove(); icons.clear(); rooms.clear(); sizes.clear(); },
  };
}
