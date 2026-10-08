// S14.2: the tap popup's markup and its placement. The card owns the state (floorplan-studio-card.ts); this draws it.
import { css, html, nothing } from "lit";
import type { Device, Door } from "../core";
import type { LightCaps, PopupOp } from "./popup";

/** What a popup is about: a device, a door or an appliance, reduced to what the popup reads. `key` tells one subject from another (a second tap on the same one closes). */
export interface PopupSubject {
  key: string;
  name: string;
  type: string;
  /** The device's own entity: what the button operates and the state line reads. */
  entity?: string;
  /** Every entity it names: More info opens the one, or the chooser for several. */
  entities: string[];
  /** A door with a cover: its button opens the card's confirm dialog. */
  door?: Door;
  /** A plug's power sensor, for the state line. */
  powerEntity?: string;
  /** S22.1: a light with a `bound` relay: its state line and its button count the relay (`lampOp`). */
  lamp?: Device;
}

export type SliderKind = "b" | "t" | "h";

export interface PopupView {
  subject: PopupSubject;
  /** The state line (`stateText`), the same text the tooltip shows. */
  text: string;
  op: PopupOp | null;
  /** A cover door's button label ("Open" or "Close"). */
  doorLabel: string | null;
  confirming: boolean;
  /** Kiosk mode: More info is left out, so a tap cannot reach Home Assistant's dialog. */
  kiosk: boolean;
  caps: LightCaps | null;
  /** brightness percent, kelvin, hue degrees; null when the light does not say. */
  level: Record<SliderKind, number | null>;
  act(): void;
  cancel(): void;
  more(): void;
  key(e: KeyboardEvent): void;
  /** `input` moves the shown value only; `change` (a release) is the one service call. */
  slide(kind: SliderKind, value: number, commit: boolean): void;
}

export const POPUP_CSS = css`
  /* S14.2: the tap popup and the hover tooltip are card chrome like the dialogs, outside the plan. The popup's buttons are 44 px tall, a touch target. */
  .fp-pop { position: absolute; z-index: 3; box-sizing: border-box; width: min(240px, calc(100% - 8px)); max-height: calc(100% - 16px); display: flex; flex-direction: column; gap: 8px; padding: 12px; color: var(--fp-ink); background: var(--fp-room); border: 1px solid var(--fp-idle); border-radius: 10px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35); font: 13px/1.3 var(--fp-font, system-ui, sans-serif); }
  /* The sliders scroll inside the card-high cap; the name, the state and the buttons stay put. */
  .fp-pop-sliders { display: flex; flex-direction: column; gap: 8px; min-height: 0; overflow-y: auto; flex: 0 1 auto; }
  .fp-pop > * { flex-shrink: 0; }
  .fp-pop > .fp-pop-sliders { flex-shrink: 1; }
  .fp-pop-name { font-weight: 600; font-size: 14px; overflow-wrap: anywhere; }
  .fp-pop-state { opacity: 0.8; overflow-wrap: anywhere; }
  .fp-pop button { min-height: 44px; font: 14px/1.2 var(--fp-font, system-ui, sans-serif); color: var(--fp-ink); background: var(--fp-bg); border: 1px solid var(--fp-idle); border-radius: 8px; padding: 0 12px; cursor: pointer; }
  .fp-pop button.fp-pop-primary { color: var(--fp-on-dark, #fff); background: var(--fp-primary); border-color: var(--fp-primary); font-weight: 600; }
  .fp-pop button.fp-pop-more { background: transparent; border-color: transparent; text-decoration: underline; min-height: 36px; }
  .fp-pop-confirm { display: flex; gap: 8px; }
  .fp-pop-confirm button { flex: 1; }
  .fp-pop label { display: flex; flex-direction: column; gap: 2px; font-size: 12px; }
  .fp-pop label span { display: flex; justify-content: space-between; opacity: 0.8; }
  .fp-pop input[type="range"] { width: 100%; height: 44px; margin: 0; accent-color: var(--fp-primary); cursor: pointer; }
  .fp-pop input.fp-pop-hue { background: linear-gradient(90deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00); border-radius: 8px; height: 20px; margin: 12px 0; -webkit-appearance: none; appearance: none; }
  .fp-pop input.fp-pop-hue::-webkit-slider-thumb { -webkit-appearance: none; width: 22px; height: 28px; border-radius: 6px; background: var(--fp-ink); border: 2px solid var(--fp-room); }
  .fp-pop input.fp-pop-hue::-moz-range-thumb { width: 22px; height: 28px; border-radius: 6px; background: var(--fp-ink); border: 2px solid var(--fp-room); }
  .fp-tip { position: absolute; left: 0; top: 0; z-index: 3; pointer-events: none; max-width: min(260px, 90%); padding: 4px 8px; color: var(--fp-ink); background: var(--fp-room); border: 1px solid var(--fp-idle); border-radius: 6px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3); font: 12px/1.3 var(--fp-font, system-ui, sans-serif); display: flex; flex-direction: column; }
  .fp-tip[hidden] { display: none; }
  .fp-tip b { font-weight: 600; overflow-wrap: anywhere; }
  .fp-tip span { opacity: 0.8; }
`;

const RANGE: Record<SliderKind, { label: string; unit: string }> = { b: { label: "Brightness", unit: " %" }, t: { label: "Colour temperature", unit: " K" }, h: { label: "Colour", unit: "°" } };

/** The popup, drawn from `v`. Every string reaches the page through lit's text bindings, which escape it (finding 2). */
export function popupTemplate(v: PopupView) {
  const s = v.subject;
  const slider = (kind: SliderKind, min: number, max: number, step: number, cls = "") => {
    const val = v.level[kind];
    return html`<label>
      <span>${RANGE[kind].label}<output>${val === null ? "–" : `${val}${RANGE[kind].unit}`}</output></span>
      <input type="range" class=${cls} aria-label=${RANGE[kind].label} min=${min} max=${max} step=${step} .value=${String(val ?? min)}
        @input=${(e: Event) => v.slide(kind, Number((e.target as HTMLInputElement).value), false)}
        @change=${(e: Event) => v.slide(kind, Number((e.target as HTMLInputElement).value), true)} />
    </label>`;
  };
  const label = v.doorLabel ?? v.op?.label ?? null;
  const primary = label === null ? nothing
    : v.confirming && v.op?.confirm
      ? html`<div class="fp-pop-confirm"><button type="button" class="fp-pop-primary fp-pop-do" @click=${v.act}>${v.op.confirm}</button><button type="button" class="fp-pop-cancel" @click=${v.cancel}>Cancel</button></div>`
      : html`<button type="button" class="fp-pop-primary fp-pop-do" @click=${v.act}>${label}</button>`;
  return html`<div class="fp-pop" role="dialog" aria-label=${s.name} data-pop @keydown=${v.key}>
    <div class="fp-pop-name">${s.name}</div>
    <div class="fp-pop-state">${v.text}</div>
    ${v.caps && (v.caps.brightness || v.caps.temp || v.caps.hue) ? html`<div class="fp-pop-sliders">
      ${v.caps.brightness ? slider("b", 1, 100, 1) : nothing}
      ${v.caps.temp ? slider("t", v.caps.temp.min, v.caps.temp.max, 50) : nothing}
      ${v.caps.hue ? slider("h", 0, 360, 1, "fp-pop-hue") : nothing}
    </div>` : nothing}
    ${primary}
    ${s.entities.length && !v.kiosk ? html`<button type="button" class="fp-pop-more" @click=${v.more}>More info</button>` : nothing}
  </div>`;
}

/** The part of the page the user sees, in client coordinates: the visual viewport (pinch zoom, an on-screen keyboard) when the
 *  browser has one, else the window. */
function visibleBox(): { left: number; top: number; right: number; bottom: number } {
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  if (vv && vv.width > 0 && vv.height > 0) return { left: vv.offsetLeft, top: vv.offsetTop, right: vv.offsetLeft + vv.width, bottom: vv.offsetTop + vv.height };
  return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
}

/**
 * Puts `el` (absolutely positioned in `host`) just below the point (client x, y), above it when there is no room below, and
 * inside the host either way. S22.2: "inside" is the host cut to what the user can see (`visibleBox`), so on a card taller than
 * the screen a tap low on the plan opens the popup above the point, not under the bottom edge. The popup's height is capped to
 * that box, and its sliders scroll (POPUP_CSS). A host scrolled almost out of sight (less than 40 px showing) falls back to the
 * host's own box, the rule before S22.2.
 */
export function placeNear(el: HTMLElement, host: HTMLElement, x: number, y: number, gap = 14, beside: DOMRect | null = null): void {
  const h = host.getBoundingClientRect(), v = visibleBox();
  let L = Math.max(h.left, v.left), T = Math.max(h.top, v.top), R = Math.min(h.right, v.right), B = Math.min(h.bottom, v.bottom);
  if (R - L < 40 || B - T < 40) ({ left: L, top: T, right: R, bottom: B } = h);
  el.style.maxHeight = `${Math.max(0, Math.round(B - T - 16))}px`; // the CSS cap (100% - 16px) for a host in full view
  const w = el.offsetWidth, ht = el.offsetHeight;
  const clampTop = (t: number) => Math.max(T + 4, Math.min(B - ht - 4, t));
  // Beside a list row, the popup goes to the side of the list and lines up with the row, so the rows under it stay reachable.
  if (beside) {
    const right = beside.right + 8, room = right + w + 4 <= R;
    el.style.left = `${Math.round(Math.max(L + 4, room ? right : beside.left - w - 8) - h.left)}px`;
    el.style.top = `${Math.round(clampTop(beside.top + beside.height / 2 - ht / 2) - h.top)}px`;
    return;
  }
  const left = Math.max(L + 4, Math.min(R - w - 4, x - w / 2));
  let top = y + gap;
  if (top + ht > B - 4) top = y - gap - ht;
  el.style.left = `${Math.round(left - h.left)}px`;
  el.style.top = `${Math.round(clampTop(top) - h.top)}px`;
}
