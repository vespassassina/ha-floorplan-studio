import { css } from "lit";

// S31.9: 44 x 44 CSS px on a touch screen (docs/specs/card-layout-touch.md, criterion 3). One file, one media query: a coarse pointer
// grows the card's controls, a fine pointer keeps the sizes they have always had. Nothing here shrinks anything (a rule only raises a
// minimum, or sets a size that is 44 or more), and nothing is a presentation attribute (finding 18): every size is a class rule that
// `tests/card/touch-targets.spec.ts` measures under both pointers (finding 10), and that spec walks every control in the card, so a
// control added without a size here fails it.
//
// These rules sit after the card's own and use the same selectors (`.fp-sheet-top .fp-back` where the card's rule is that specific), so
// they win by order, not by weight. The ⋯ menu (`more-menu.ts`) carries its own coarse rule, being a component with its own shadow
// root; so does `<fp-search>` (`SEARCH_TOUCH_CSS` below). A checkbox row is the target, not the 18 px box in it.

/** Sizes for the card's own shadow root: header, tabs, zoom cluster, rail, sheets, rows, scene and floor buttons, popup, dialogs. */
export const TOUCH_CSS = css`
  @media (pointer: coarse) {
    .fp-head-btn, .fp-floors button { min-height: 44px; min-width: 44px; }
    .fp-stack button { width: 44px; height: 44px; }
    svg.fp-zoomable.fp-clear-stack { width: calc(100% - 60px); }
    .fp-back, .fp-sheet-top .fp-back, .fp-active-collapse { min-width: 44px; min-height: 44px; }
    .fp-rail-open { width: 44px; height: 44px; }
    .fp-rail-count { top: -4px; right: -4px; }
    .fp-active-row { min-height: 44px; }
    button.fp-cat { min-height: 44px; }
    .fp-room-clear { flex-basis: 44px; width: 44px; height: 44px; }
    .fp-alloff, .fp-floor-off, .fp-fav-act, .fp-fav-cancel, .fp-scene, .fp-ov-scope, .fp-layer-note button, .fp-show-all { min-height: 44px; min-width: 44px; }
    .fp-dialog-actions button { min-height: 44px; min-width: 44px; }
    .fp-chooser-list button { min-height: 44px; }
    .fp-off-row { min-height: 44px; }
    .fp-pop button.fp-pop-more, .fp-pop-info summary { min-height: 44px; }
    /* The hue bar was a 20 px input with the gradient on the input itself; a 44 px input would be a 44 px bar. The input is the touch
       target, the gradient moves to its track (20 px, as before), and the thumb stays centred on it. Same gradient as popup-ui.ts. */
    .fp-pop input.fp-pop-hue { height: 44px; margin: 0; background: none; border-radius: 0; }
    .fp-pop input.fp-pop-hue::-webkit-slider-runnable-track { height: 20px; border-radius: 8px; background: linear-gradient(90deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00); }
    .fp-pop input.fp-pop-hue::-webkit-slider-thumb { margin-top: -4px; }
    .fp-pop input.fp-pop-hue::-moz-range-track { height: 20px; border-radius: 8px; background: linear-gradient(90deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00); }
  }
`;

/** Sizes inside `<fp-search>`'s own shadow root: the field and each result row (the Studio uses the same box). */
export const SEARCH_TOUCH_CSS = css`
  @media (pointer: coarse) {
    input { min-height: 44px; }
    .opt { min-height: 44px; justify-content: center; }
  }
`;
