import type { BadgeInfo } from "./room-badges";

/** B55.4 (docs/specs/batch-s52.md F37): the bubble a room badge opens. One component, bound by the card and by the Studio's live view. */
export const BUBBLE_TAP_MS = 4000;
/** A finger that moved farther than this between press and lift panned; it did not tap. */
const TAP_SLOP_PX = 10;
const HIT_PAD_PX = 2;

export interface BubbleHost {
  /** The plan. Badges are found in it by `g[data-cb="room:kind"]`. */
  svg: Element;
  /** Where the bubble element goes. In the card this is the shadow root; in the Studio the canvas. */
  mount: Node;
  /** The positioned box the bubble is placed in, as a rect in client px. */
  rect: () => DOMRect;
  /** What badge `kind` of room `ri` says now, or undefined when the room has no such badge. */
  info: (ri: number, kind: string) => BadgeInfo | undefined;
}
export interface Bubble { refresh(): void; close(): void; destroy(): void }

/**
 * Hover opens it for a mouse or a pen. A finger taps a badge to open it and taps anywhere else, or waits 4 s, to close it.
 * The badge is found by where the pointer is, not by the event's target and not by pointer id (finding 22): a click is
 * hit-tested after the pointerup and may land elsewhere, a WebKit tap clicks with the mouse id and every Firefox touch is 0.
 * Anything that is not a mouse or a pen counts as a finger, so an engine that reports no type still gets the tap (fails open).
 */
export function bindBadgeBubble(h: BubbleHost): Bubble {
  const doc = h.svg.ownerDocument, el = doc.createElement("div");
  el.className = "fp-bubble"; el.setAttribute("role", "tooltip"); el.hidden = true;
  // Inline, so the card and the Studio need no shared stylesheet. The colours are the plan's own tokens (finding 9).
  Object.assign(el.style, { position: "absolute", left: "0", top: "0", zIndex: "4", pointerEvents: "none", maxWidth: "min(260px, 90%)", padding: "4px 8px", color: "var(--fp-ink)", background: "var(--fp-room)", border: "1px solid var(--fp-idle)", borderRadius: "6px", boxShadow: "0 2px 8px rgba(0, 0, 0, 0.3)", font: "12px/1.3 var(--fp-font, system-ui, sans-serif)", flexDirection: "column", overflowWrap: "anywhere" });
  h.mount.appendChild(el);
  let key: string | null = null, timer: ReturnType<typeof setTimeout> | null = null, down: { x: number; y: number } | null = null;

  const badgeAt = (x: number, y: number): Element | null => {
    for (const g of Array.from(h.svg.querySelectorAll("g[data-cb]"))) {
      const r = g.getBoundingClientRect();
      if (x >= r.left - HIT_PAD_PX && x <= r.right + HIT_PAD_PX && y >= r.top - HIT_PAD_PX && y <= r.bottom + HIT_PAD_PX) return g;
    }
    return null;
  };
  const infoOf = (k: string): BadgeInfo | undefined => {
    const [ri, kind] = k.split(":");
    return h.info(Number(ri), kind);
  };
  const place = (g: Element) => {
    const b = g.getBoundingClientRect(), host = h.rect(), w = el.offsetWidth, ht = el.offsetHeight;
    const left = Math.max(4, Math.min(host.width - w - 4, b.left - host.left + b.width / 2 - w / 2));
    const below = b.bottom - host.top + 6;
    el.style.transform = `translate(${Math.round(left)}px, ${Math.round(below + ht > host.height - 4 ? Math.max(4, b.top - host.top - ht - 6) : below)}px)`;
  };
  const fill = (i: BadgeInfo) => {
    el.replaceChildren();
    const title = doc.createElement("b"); title.textContent = i.title; title.style.fontWeight = "600";
    el.append(title, ...i.rows.map((r) => { const s = doc.createElement("span"); s.textContent = r; s.style.opacity = "0.85"; return s; }));
  };
  const close = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null; key = null; el.hidden = true; el.style.display = "";
  };
  const open = (g: Element, hold: boolean) => {
    const k = g.getAttribute("data-cb") ?? "", i = infoOf(k);
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (!i) { close(); return; }
    key = k; fill(i); el.hidden = false; el.style.display = "flex"; place(g);
    if (hold) timer = setTimeout(close, BUBBLE_TAP_MS);
  };
  const isFinger = (e: PointerEvent) => e.pointerType !== "mouse" && e.pointerType !== "pen";

  const onMove = (e: Event) => {
    const p = e as PointerEvent;
    if (isFinger(p)) return;
    const g = p.buttons ? null : badgeAt(p.clientX, p.clientY);
    if (!g) { if (key !== null) close(); return; }
    if (g.getAttribute("data-cb") !== key) open(g, false);
  };
  const onDown = (e: Event) => {
    const p = e as PointerEvent;
    down = { x: p.clientX, y: p.clientY };
    if (!badgeAt(p.clientX, p.clientY)) close(); // a press anywhere else, in the plan or out of it, closes: the tap away
  };
  const onUp = (e: Event) => {
    const p = e as PointerEvent, d = down;
    down = null;
    if (!isFinger(p) || !d || Math.hypot(p.clientX - d.x, p.clientY - d.y) > TAP_SLOP_PX) return;
    const g = badgeAt(p.clientX, p.clientY);
    if (!g) return;
    if (g.getAttribute("data-cb") === key) close(); else open(g, true);
  };
  const onLeave = (e: Event) => { if (!isFinger(e as PointerEvent)) close(); };

  h.svg.addEventListener("pointermove", onMove);
  h.svg.addEventListener("pointerleave", onLeave);
  h.svg.addEventListener("pointerup", onUp);
  doc.addEventListener("pointerdown", onDown, true); // the whole page: a tap outside the plan closes too
  return {
    refresh() {
      if (key === null) return;
      const g = h.svg.querySelector(`g[data-cb="${key}"]`), i = infoOf(key);
      if (!g || !i) { close(); return; } // the badge was drawn away (a floor switch, the badges turned off)
      fill(i); place(g);
    },
    close,
    destroy() {
      close();
      h.svg.removeEventListener("pointermove", onMove);
      h.svg.removeEventListener("pointerleave", onLeave);
      h.svg.removeEventListener("pointerup", onUp);
      doc.removeEventListener("pointerdown", onDown, true);
      el.remove();
    },
  };
}
