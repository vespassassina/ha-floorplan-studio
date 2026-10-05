# Real 3D view in the card; 2.5D leaves the editor

Status: proposed, 2026-10-05 (Sprint 12). Waiting for Diego's yes.

## Goal

The card can show the house as a real 3D model: orbit, zoom, perspective,
walls that hide what is behind them, lamps that light the room. It is
view-only. Editing stays flat. The 2.5D preview in the editor goes, because it
does not work well.

## Decided (Diego, 2026-10-05)

1. 3D is view-only. The editor loses 2.5D (view select, tilt, walls mode,
   "2.5D is a preview" note). It keeps 2D only.
2. A lazy-loaded three.js chunk of about 170 KB gzipped is fine.
3. What he wants is real 3D, not a nicer 2.5D.

## Assumptions (change any of them)

- A. The card gets a third view, "3D", next to 2D and 2.5D. The card's 2.5D
  stays until Diego has seen 3D and says it can go (task S12.6). The editor's
  2.5D goes first (S12.1).
- B. Parity: this is an exception to "studio and card show the same". The
  editor draws 2D only; the card draws 2D, 2.5D and 3D. Same status as the
  card-only left panel.
- C. The 3D scene is built from the same layout and the same height
  resolvers (`src/core/heights.ts`) as 2.5D. No new schema fields. A layout
  made today renders in 3D with no change.
- D. `src/core/solids.ts` cannot be reused as is: it returns projected SVG
  strings. A new pure module, `src/core/scene.ts`, returns raw solids in cm
  (box, prism, extruded polygon) with their kind, entity and state hooks.
  The three.js code only turns those into meshes. A test iterates every
  `DEVICE_TYPES` and `FurnitureSymbol` member (finding 17).
- E. No runtime network (finding 9): three.js is bundled, never fetched. The
  bundle imports only what it uses (tree shaken). Colours come from the
  `--fp-*` tokens, read once per theme change.
- F. WebGL missing or context lost: the card falls back to 2D and says so in
  one line. It never shows a blank canvas.
- G. Interaction: drag orbits, wheel and pinch zoom, right drag or two fingers
  pan. A tap and a hold mean what they mean in 2D (device toggles, hold opens
  more-info, room tap picks the room and opens the room panel). A drag never
  counts as a tap.
- H. Live state in 3D: a lit lamp lights its room (a light, not a flat
  circle); an open door or window opens; a heating radiator is tinted; a room
  with motion gets the red edge; room readouts show as labels over the room.
  Icons and labels are HTML laid over the canvas, so they stay crisp and
  clickable and use the existing `data-x` hit rules (finding 3).
- I. Floors: the selected floor is drawn solid; floors below are drawn
  dimmed; floors above are hidden. An "all floors" stack is a later option.
- J. Performance: 60 fps on a mid laptop, 30 on a wall tablet. Render on
  demand (on change, drag, state update), not in a constant loop. Reduced
  motion: no camera easing.
- K. Delivery: the card is one built file. Whether the chunk can sit beside it
  in `www/` (HA serves that folder) or must be inlined is the first thing the
  S12.3 spike settles; it is a gate for the sprint.

## Non-goals

Editing in 3D. Placing devices in 3D. Textures beyond the existing room
paint colours. Real shadows from sunlight. Exporting a 3D model.

## Risks

- R1. Removing 2.5D from the editor breaks many Playwright tests that drive
  it. Each is moved to the card (if it tests `renderFloor` 2.5D) or deleted
  (if it tests the editor preview itself). Counted in S12.1.
- R2. Headless Chromium draws WebGL in software: slow and not pixel exact.
  Tests assert scene content (mesh count, kinds, positions, which entity a ray
  hits) from the scene module and a debug hook, plus a few screenshots by
  eye. No pixel-diff on a canvas.
- R3. A second renderer can drift from the first. The scene module is tested
  against `heights.ts` numbers, and the card's 2.5D and 3D read the same
  resolvers.
- R4. three.js needs a GPU path on some wall tablets that lack it; F covers it.

## Acceptance criteria

1. The editor has no 2.5D: no view select, tilt, walls select or preview note;
   `ViewMemory` ignores a stored `"2.5d"` and opens 2D; the card is unchanged.
2. `buildScene(floor)` returns for the demo: every wall, floor slab, room,
   furniture piece, stair, and the appliance solids of 2.5D, with heights equal
   to `heights.ts`; a door or window is a gap in its wall; a test iterates all
   device and furniture kinds.
3. The card shows a "3D" option. It loads the chunk on first use, not before.
   No request leaves the card for it.
4. Orbit, zoom and pan work with a mouse and with touch; a drag is not a tap.
5. A tap on a device toggles it, a hold opens more-info, a tap on a room picks
   it, with the same panel as 2D. Real `page.mouse` coordinates.
6. A lit lamp lights its room and not the next one. Open door or window,
   heating radiator, room motion edge and room readout show as in 2D.
7. WebGL unavailable: the card shows 2D and one line saying why.
8. The selected floor is solid, floors below are dimmed, floors above hidden.
9. The chunk is at most 200 KB gzipped; the card's own file does not grow by
   more than 5 KB.
10. Adversarial: a layout with 5000 furniture, a zero-height wall, `NaN` size
    and a floor named `__proto__` renders or falls back; it never throws or
    hangs.
