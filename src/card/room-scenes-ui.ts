// S14.7: the scene buttons of the card's Room section. The card owns the state (which scene waits for its confirm);
// this draws it. Names go through lit's text bindings, which escape them (CLAUDE.md finding 2).
import { css, html, nothing } from "lit";
import type { RoomSceneMenu } from "../core";

export const SCENES_CSS = css`
  .fp-scenes { display: flex; flex-wrap: wrap; gap: 6px; margin: 2px 0 6px; }
  .fp-scene { min-height: 32px; max-width: 100%; padding: 0 10px; font: 12px/1.2 var(--fp-font, system-ui, sans-serif); color: var(--fp-ink); background: var(--fp-bg); border: 1px solid var(--fp-idle); border-radius: 8px; cursor: pointer; overflow-wrap: anywhere; }
  .fp-scene:hover, .fp-scene:focus-visible { border-color: var(--fp-primary); }
  .fp-scene.fp-scene-ha { border-style: dashed; }
  .fp-scene.fp-scene-ask { color: var(--fp-on-dark, #fff); background: var(--fp-primary); border-color: var(--fp-primary); font-weight: 600; }
`;

export interface ScenesView {
  menu: RoomSceneMenu;
  /** The key (`ha:<entity>`, `custom:<id>`) of the scene that waits for its confirm, or null. */
  asking: string | null;
  /** `key` is `ha:<entity>`, `custom:<id>` or `preset:on`. */
  run: (key: string) => void;
  cancel: () => void;
  /** Whether the section is open. It starts folded (Diego, 2026-10-07). */
  open: boolean;
  toggle: () => void;
}

/** Nothing for a room with no scene and no light, so the section never prints an empty label. */
export function scenesTemplate(v: ScenesView) {
  const { ha, custom, lights } = v.menu;
  if (!ha.length && !custom.length && !lights.length) return nothing;
  const btn = (key: string, label: string, cls = "") => v.asking === key
    ? html`<button type="button" class="fp-scene fp-scene-ask" data-scene=${key} @click=${() => v.run(key)}>Confirm: ${label}</button><button type="button" class="fp-scene" @click=${v.cancel}>Cancel</button>`
    : html`<button type="button" class="fp-scene ${cls}" data-scene=${key} @click=${() => v.run(key)}>${label}</button>`;
  const count = ha.length + custom.length + (lights.length ? 1 : 0);
  return html`<div class="fp-active-group">
    <button type="button" class="fp-active-group-label fp-cat fp-scenes-head" aria-expanded=${v.open ? "true" : "false"} @click=${v.toggle}>
      <span class="fp-cat-chev" aria-hidden="true">${v.open ? "▾" : "▸"}</span><span class="fp-cat-name">Scenes</span><span class="fp-active-count">${count}</span>
    </button>
    ${v.open ? html`<div class="fp-scenes">
      ${ha.map((s) => btn(`ha:${s.entity}`, s.name, "fp-scene-ha"))}
      ${custom.map((s) => btn(`custom:${s.id}`, s.name))}
      ${/* S24.8 (C2): no preset All off: the room's Lights off button does it, relays too. */ lights.length ? btn("preset:on", "All on") : nothing}
    </div>` : nothing}
  </div>`;
}
