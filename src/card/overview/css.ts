// The Overview's stylesheet (B52.2). It is the chunk's, not the card's: the card adopts it onto its shadow root once the chunk is in (card-overview.ts),
// after its own sheets, which is the place these rules had in the card's list. A plain string: the chunk imports nothing, lit's `css` included.
// The touch block at the end is the Overview's share of TOUCH_CSS (touch-css.ts). It has to follow the base rules above, as it did there: the two
// sit at the same specificity (`.fp-sheet-top .fp-back`), and a coarse pointer wins by order.
export const OVERVIEW_CSS = `
  /* S9.5: the active-devices panel, card chrome like .fp-floors/.fp-zoom above (CLAUDE.md finding 8 — nothing here
     is drawn inside the plan's <svg>). Default position clears the floor chips' own top-left corner; a drag
     overrides top/left with an inline style, clamped in TS against the card's own box so it can never be lost
     off-screen (S9.5 spec). */
  /* Opus review finding 5: min(200px, 45%) instead of a flat 200px, so a narrow (phone-width) card gets a panel
     that fits it rather than one that is most of the card's own width at 200px on a ~380px card. */
  .fp-active { grid-area: stage; position: absolute; top: 8px; left: 8px; z-index: 1; width: min(200px, 45%); max-width: calc(100% - 16px); max-height: calc(100% - 16px); display: flex; flex-direction: column; overflow: hidden; background: var(--fp-room); color: var(--fp-ink); border: 1px solid var(--fp-idle); border-radius: 8px; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25); }
  .fp-active-head { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; padding: 6px 8px; user-select: none; font: 600 12px/1.2 var(--fp-font, system-ui, sans-serif); border-bottom: 1px solid var(--fp-idle); }
  .fp-active-title { flex: 1; }
  .fp-active-count { font-weight: 400; color: var(--fp-text); }
  .fp-active-collapse { border: none; background: transparent; color: inherit; font: inherit; line-height: 1; cursor: pointer; padding: 2px 4px; }
  .fp-active-body { overflow-y: auto; padding: 4px 8px 8px; }
  .fp-active-group-label { font: 600 10px/1.6 var(--fp-font, system-ui, sans-serif); color: var(--fp-text); text-transform: uppercase; letter-spacing: 0.04em; margin-top: 6px; }
  .fp-active-group-label:first-child { margin-top: 0; }
  /* S14.6: a category header is a button (keyboard, aria-expanded); it keeps the label's look. */
  button.fp-cat { display: flex; align-items: center; gap: 4px; width: 100%; min-height: 28px; text-align: left; border: none; background: transparent; padding: 0 2px; cursor: pointer; border-radius: 4px; }
  .fp-cat-name { flex: 1; min-width: 0; }
  .fp-cat-chev { flex: 0 0 10px; }
  .fp-active-row { display: flex; align-items: center; gap: 6px; width: 100%; text-align: left; border: none; background: transparent; color: inherit; font: 12px/1.3 var(--fp-font, system-ui, sans-serif); padding: 4px 2px; cursor: pointer; border-radius: 4px; }
  .fp-active-row svg { width: 16px; height: 16px; flex: 0 0 16px; fill: var(--fp-active-row-color, var(--fp-ink)); }
  .fp-active-empty { margin: 4px 2px; font: 12px/1.3 var(--fp-font, system-ui, sans-serif); color: var(--fp-text); }
  /* S11.3/S11.4: the room section and the details under a row. Same card chrome and tokens as the list above. */
  /* S31.5: from 640 px the Overview is the side sheet: the whole sheet cell of the grid, beside the plan, not over it.
     It is absolute inside its cell (inset 0), so a long list scrolls in the body and never makes the card taller. */
  .fp-active.fp-side { inset: 0; width: auto; max-width: none; max-height: none; border-radius: 0; border-width: 0 1px 0 0; box-shadow: none; z-index: 0; grid-area: sheet; }
  .fp-active.fp-side .fp-active-body, .fp-active.fp-bottom .fp-active-body { flex: 1 1 auto; min-height: 0; }
  /* S31.8: the phone's sheet: along the bottom, over the plan above its 64 px peek (the peek has its own grid row). The stops are
     lengths on the host (\`_measureFrame\`); a drag writes the height inline, with the transition off. Reduced motion: it jumps. */
  .fp-active.fp-bottom { grid-area: 1 / 1 / 4 / -1; inset: auto 0 0 0; width: auto; max-width: none; max-height: none; box-sizing: border-box; border-radius: 12px 12px 0 0; border-width: 1px 0 0; z-index: 2; height: var(--fp-sheet-peek, 64px); transition: height 0.2s ease; }
  .fp-active.fp-bottom[data-stop="half"] { height: var(--fp-sheet-half, 50%); }
  .fp-active.fp-bottom[data-stop="full"] { height: var(--fp-sheet-full, 100%); }
  .fp-active.fp-bottom.fp-dragging { transition: none; }
  @media (prefers-reduced-motion: reduce) { .fp-active.fp-bottom { transition: none; } }
  .fp-sheet-top { flex: 0 0 64px; box-sizing: border-box; height: 64px; display: flex; align-items: stretch; }
  .fp-sheet-top .fp-back { align-self: center; flex: 0 0 auto; margin-left: 4px; font-size: 18px; min-width: 40px; min-height: 40px; }
  .fp-handle { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 0 12px; border: 0; background: transparent; color: inherit; font: 600 13px/1.2 var(--fp-font, system-ui, sans-serif); text-align: left; cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; }
  .fp-handle:focus-visible { outline: 2px solid var(--fp-primary); outline-offset: -2px; }
  .fp-grab { flex: 0 0 4px; width: 36px; height: 4px; border-radius: 2px; background: var(--fp-idle); }
  .fp-handle-line { max-width: 100%; box-sizing: border-box; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fp-handle-line .fp-active-title { flex: none; }
  .fp-handle-line .fp-ov-chips { flex: none; display: inline; }
  .fp-handle-line .fp-ov-chips::before { content: " · "; }
  .fp-active.fp-rail { align-items: center; padding-top: 8px; }
  .fp-rail-open { position: relative; width: 36px; height: 36px; border: 1px solid var(--fp-idle); border-radius: 8px; background: var(--fp-bg); color: var(--fp-ink); font: 14px/1 var(--fp-font, system-ui, sans-serif); cursor: pointer; }
  .fp-rail-count { position: absolute; top: -6px; right: -6px; min-width: 16px; padding: 0 4px; box-sizing: border-box; border-radius: 999px; background: var(--fp-warn); color: var(--fp-on-light); font: 600 11px/16px var(--fp-font, system-ui, sans-serif); text-align: center; }
  .fp-back { flex: 0 0 auto; border: none; background: transparent; color: inherit; font: inherit; line-height: 1; cursor: pointer; padding: 2px 6px; border-radius: 4px; }
  .fp-item { display: flex; flex-wrap: wrap; align-items: center; }
  .fp-item .fp-active-row { flex: 1 1 0; width: auto; min-width: 0; }
  .fp-row-state { margin-left: auto; padding-left: 6px; flex: 0 0 auto; white-space: nowrap; font-size: 11px; color: var(--fp-text); overflow-wrap: anywhere; text-align: right; }
  .fp-active-row.fp-off svg { opacity: 0.6; }
  .fp-room-facts > div { display: flex; gap: 6px; }
  .fp-room-facts dt { flex: 0 0 88px; color: var(--fp-text); }
  .fp-room-facts dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
  /* S24.7: the Overview. The header's chips sit under the title; the alerts chip in the warn colour. */
  .fp-crumb { font-weight: 400; color: var(--fp-text); }
  .fp-ov-chips { flex: 0 0 100%; font: 400 11px/1.3 var(--fp-font, system-ui, sans-serif); color: var(--fp-text); }
  .fp-chip-warn { color: var(--fp-warn); font-weight: 600; }
  /* Folded, the header is one line so it covers as little plan as before S24.7; the crumb goes, the chips end in an ellipsis. */
  .fp-ov-search:empty { display: none; }
  /* S24.8: the search at the top of the sheet; its list drops over the rows below. */
  .fp-ov-search { margin: 2px 0 6px; font: 12px/1.3 var(--fp-font, system-ui, sans-serif); }
  /* S24.8: one row of tools: Turn off on this floor…, Layers, All floors. */
  .fp-ov-scopes { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 6px; margin-bottom: 6px; }
  .fp-ov-scopes .fp-floor-off { margin-right: auto; }
  /* S24.8: the note for a kept thing (the family chips are the ⋯ menu's Layers section since S31.6). */
  .fp-ov-layers:empty { display: none; }
  .fp-ov-layers { margin: 0 0 6px; }
  .fp-layer-note button { border: 1px solid var(--fp-idle); background: transparent; color: var(--fp-ink); font: 11px/1.4 var(--fp-font, system-ui, sans-serif); border-radius: 999px; padding: 2px 8px; cursor: pointer; min-height: 24px; }
  .fp-layer-note button:hover, .fp-layer-note button:focus-visible { border-color: var(--fp-primary); }
  .fp-layer-note { margin: 4px 0 0; font: 12px/1.4 var(--fp-font, system-ui, sans-serif); color: var(--fp-ink); }
  .fp-floor-off:disabled { opacity: 0.5; cursor: default; }
  .fp-floor-off:disabled:hover { border-color: var(--fp-idle); }
  .fp-ov-scope { border: 1px solid var(--fp-idle); background: transparent; color: var(--fp-ink); font: 11px/1.4 var(--fp-font, system-ui, sans-serif); border-radius: 999px; padding: 2px 10px; cursor: pointer; min-height: 24px; }
  .fp-ov-scope[aria-pressed="true"] { background: var(--fp-ink); color: var(--fp-bg); border-color: var(--fp-ink); }
  .fp-ov-section + .fp-ov-section { margin-top: 8px; }
  .fp-ov-head { font: 600 11px/1.6 var(--fp-font, system-ui, sans-serif); color: var(--fp-ink); }
  .fp-ov-attn .fp-ov-head { color: var(--fp-warn); }
  .fp-ov-row { align-items: flex-start; }
  .fp-ov-row svg, .fp-ov-mark { margin-top: 1px; }
  .fp-ov-mark { flex: 0 0 16px; width: 16px; text-align: center; color: var(--fp-warn); font-size: 13px; line-height: 16px; }
  .fp-ov-text { display: flex; flex-direction: column; min-width: 0; flex: 1 1 auto; }
  .fp-ov-name { overflow-wrap: anywhere; }
  .fp-ov-where { font-size: 10px; color: var(--fp-text); display: flex; gap: 4px; flex-wrap: wrap; }
  .fp-row-floor { border: 1px solid var(--fp-idle); border-radius: 4px; padding: 0 3px; line-height: 1.3; }
  .fp-ov-row .fp-row-state { white-space: normal; max-width: 45%; }
  .fp-ov-age { white-space: nowrap; }
  /* S34.4: a favourite row is the Active row and the popup's button. The button sits right; Confirm and Cancel take their own line so a phone's row never squeezes the name. */
  .fp-fav-row { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 2px 6px; }
  .fp-fav-row .fp-active-row { flex: 1 1 9em; width: auto; min-width: 0; }
  .fp-fav-gone { opacity: 0.5; }
  .fp-fav-act, .fp-fav-cancel { flex: 0 0 auto; border: 1px solid var(--fp-idle); background: transparent; color: var(--fp-ink); font: 11px/1.4 var(--fp-font, system-ui, sans-serif); border-radius: 999px; padding: 2px 10px; cursor: pointer; min-height: 24px; margin-top: 3px; }
  .fp-fav-act:hover, .fp-fav-cancel:hover, .fp-fav-act:focus-visible, .fp-fav-cancel:focus-visible { border-color: var(--fp-primary); }
  .fp-fav-confirm { flex: 1 1 100%; display: flex; gap: 6px; padding-left: 22px; }
  .fp-fav-confirm button { flex: 1 1 0; }
  .fp-fav-confirm .fp-fav-act { color: var(--fp-on-dark, #fff); background: var(--fp-primary); border-color: var(--fp-primary); font-weight: 600; }
  .fp-ov-hint { margin: 8px 2px 0; font: 10px/1.3 var(--fp-font, system-ui, sans-serif); color: var(--fp-text); }
  .fp-room { padding-bottom: 6px; margin-bottom: 6px; border-bottom: 1px solid var(--fp-idle); }
  .fp-room-head { display: flex; align-items: center; gap: 6px; font: 600 13px/1.3 var(--fp-font, system-ui, sans-serif); }
  .fp-room-name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .fp-room-clear { flex: 0 0 24px; width: 24px; height: 24px; border: none; background: transparent; color: inherit; font: 14px/1 var(--fp-font, system-ui, sans-serif); border-radius: 4px; cursor: pointer; }
  /* S20.1: the same look as a scene button, with classes of its own so the Scenes section's tests and counts stay about scenes. */
  /* one hover grey for the panel rows and buttons: ink 12 % into bg keeps text above 4.5:1 in every theme (G23) */
  button.fp-cat:is(:hover, :focus-visible),
  .fp-active-row:is(:hover, :focus-visible),
  .fp-back:is(:hover, :focus-visible),
  .fp-room-clear:is(:hover, :focus-visible),
  .fp-show-all:is(:hover, :focus-visible) { background: color-mix(in srgb, var(--fp-ink) 12%, transparent); }
  .fp-alloff-row { margin: 2px 0 6px; display: flex; flex-wrap: wrap; gap: 6px; }
  .fp-alloff, .fp-floor-off { min-height: 32px; padding: 0 10px; font: 12px/1.2 var(--fp-font, system-ui, sans-serif); color: var(--fp-ink); background: var(--fp-bg); border: 1px solid var(--fp-idle); border-radius: 8px; cursor: pointer; }
  .fp-alloff:hover, .fp-alloff:focus-visible, .fp-floor-off:hover, .fp-floor-off:focus-visible { border-color: var(--fp-primary); }
  .fp-room-facts { margin: 4px 0 6px; font: 12px/1.4 var(--fp-font, system-ui, sans-serif); }
  .fp-filter { display: flex; align-items: center; gap: 6px; font: 600 10px/1.6 var(--fp-font, system-ui, sans-serif); color: var(--fp-text); text-transform: uppercase; letter-spacing: 0.04em; }
  .fp-show-all { margin-left: auto; border: 1px solid var(--fp-idle); background: transparent; color: var(--fp-ink); font: 11px/1.4 var(--fp-font, system-ui, sans-serif); text-transform: none; letter-spacing: 0; border-radius: 4px; padding: 1px 6px; cursor: pointer; }
  @media (pointer: coarse) {
    .fp-back, .fp-sheet-top .fp-back, .fp-active-collapse { min-width: 44px; min-height: 44px; }
    .fp-rail-open { width: 44px; height: 44px; }
    .fp-rail-count { top: -4px; right: -4px; }
    .fp-active-row { min-height: 44px; }
    button.fp-cat { min-height: 44px; }
    .fp-room-clear { flex-basis: 44px; width: 44px; height: 44px; }
    .fp-alloff, .fp-floor-off, .fp-fav-act, .fp-fav-cancel, .fp-ov-scope, .fp-layer-note button, .fp-show-all { min-height: 44px; min-width: 44px; }
  }
`;
