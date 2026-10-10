# Decisions

Newest first. A change supersedes; nothing is edited.

## 2026-10-10: the card's ghost floor is `ghost_floor` plus a Floor below button (S27.13)

- `ghost_floor: true` in YAML (only `true`; junk is off) and a Floor below button in the view controls, 2D and 2.5D. The pick is the viewer's, kept in the view memory (`ghost`, a boolean; anything else in storage is dropped) and wins over the YAML; Reset view clears it. `ghost_floor` joins the storage seed like `detail`, so editing it starts a clean memory.
- The card hands `renderFloor` `ghost: { floor: below, shift: floorShift(layout, below, shown) }` and draws nothing else itself. The lowest floor has no floor below: no ghost, and the button is disabled with a title that says why. In 3D there is no button: the floors below are the `floors_below` select (S27.14).
- The button's icon is an inlined path in the card file (Material layers-outline), not an import (finding 9). A tap on a spot where only the ghost is drawn opens nothing, because the ghost is `pointer-events:none` by class rule and carries no `data-*`; the test walks the ghost's lines for a point whose top element is the bare plan and clicks it with the real mouse.

## 2026-10-10: furniture Lock works under Lock plan (S27.1)

- `EditorState.plan()` drops a furniture piece's `locked` from the compare, so ticking Lock in the panel or the context menu is one undo step under Lock plan. Moving, resizing or turning a piece is still refused. Diego, 2026-10-10: "furniture Lock must work under Lock plan". It supersedes the "known edge" of 'Lock in every panel (S26.16)' and the furniture line of S26.3, which listed Lock with the geometry.
## 2026-10-10: a floor has an offset; the stack helpers read it (S27.2, S27.3)

- `Floor.offset?: [number, number]`, cm: where the floor sits in the house. Stored points never change; a point's place in the house is the point plus the offset. Chosen over rewriting every point so Align is one key and one undo step, the card's `center` pins, saved views and the trace image stay valid, and repeated aligns cannot drift by rounding. Schema stays v2.
- Bound: two finite numbers, each within `COORD_LIMIT`. `validate` reports anything else; `migrate` drops it (as `dropBadHeights`), so a hand-edited file opens. A good value is kept as written, `[0, 0]` included; writers (S27.8) delete the key at `[0, 0]`.
- `floorBelow`, `floorsBelow`, `floorShift` live in `src/core/floor-stack.ts`. Order is `Object.keys(floors)`, as `floorElevation` stacks. They never throw: junk layout means no floors, a junk or unknown-key offset reads as `[0, 0]`, and a key must be an own key (`toString` is not a floor).
## 2026-10-10: how Align finds the move (S27.4)

- `alignFloor` follows the Sprint 27 assumption. Choices the plan left open: structure lines skip zones in the room fallback; a duplicate corner within 1 cm is one corner, ranked by the total length of the edges at it; candidates are scored coarsely first (48 samples against the 150 longest lower lines), the best three plus the no-move case are refined, then all are scored in full and the tie rule (within 1 point, smaller move) picks.
- Caps for huge input, so a 10 000-point outline answers in about a second and never hangs: at most 1500 samples (the 10 cm step grows past that), 800 lower lines in the full score, 600 in the fit. A normal floor meets none of them. `t` is rounded to 0.1 cm and the score to 0.1 point; the caller rounds the offset to whole cm.
- Any exception returns `null`, the same as "nothing to match".
## 2026-10-10: the floor switch is `data-switch` plus two keyframes, and `floorSwitch` decides (S27.6)

- `floorSwitch(keys, from, to, reduced)` in `render.ts` returns `{ dir }` or null. `keys` is the floors lowest first; a higher new floor is "up". Null for the same floor, an unknown key, a non-array or non-string input, and `reduced === true` (a truthy junk value is not reduced, so a typo does not silently kill the motion). `indexOf` on an array, so `__proto__` is only a key like any other.
- The host sets `data-switch="up|down"` on the plan root; the stylesheet does the rest: 16 px and opacity 0 to rest over 220 ms, from above when going up. Under `prefers-reduced-motion: reduce` a later `[data-switch]{animation:none}` of equal specificity wins, so the attribute can stay and nothing moves. No copy of the old floor is kept.
- Pair test on the card (`card-floor-switch-css.spec.ts`): name, duration and the first keyframe's transform for each direction, and `none` with `reducedMotion: "reduce"`; removing the media rule fails it. The host that sets the attribute and clears it after the animation comes in S27.12 and S27.15.

## 2026-10-10: the ghost floor is one `g.ghost` of paths, first in the plan (S27.5)

- `renderFloor` draws `RenderOpts.ghost` as one `<g class="ghost">` before everything else, even before the trace image: the outline, every room, stair and wall as `path.gl`, each point moved by the shift. No fill, text, title, device, `data-*` or `use`, so it cannot be hit-tested or select anything, and no string of the ghost floor is read, so a name cannot reach the markup. The look and `pointer-events:none` are class rules (finding 18); `--fp-ghost` is 35 % of `--fp-wall` into `--fp-bg` in the generic defaults, so every theme has it.
- Junk draws nothing: a shift that is not two finite numbers within `COORD_LIMIT`, a ring or wall with a non-finite point (skipped alone), rings over 100 000 points. With no valid path no `g` is written. The ghost sits inside the plan turn, so it rotates with the plan.
- Rooms and stairs are drawn as outlines only; a room's own fill covers the ghost inside the room. That is the "under everything" the plan asks for, and it shows in the shots: the ghost reads outside the current floor's footprint and through unfilled areas.
## 2026-10-10: floors below in 3D are separate meshes, set by `setBelow` (S27.7)

- `View3D.setBelow(floors, mode)` takes `{ floor, elevation, shift }` entries: `elevation` is the lower floor's walking surface in the current floor's frame (negative), `shift` is the `floorShift` in cm. `SceneOpts.shift` moves every solid in plan x and y in the one `add` choke point; anything but two finite numbers means none.
- The lower floors are meshes of their own, outside `clear` and `build`, so a rebuild of the current floor never touches them and the `Picker` never sees them (a tap through them finds nothing). They carry no devices, no textures and no live state. Ghost: transparent, opacity at most .25, no depth write. Solid: their own colours, every wall at full height (no cut).
- `setFloor` keeps them; the card calls `setBelow` after it. The built scene of a floor is cached per floor object, elevation and shift; the meshes are rebuilt on every call and on a theme change, because the palette is read per theme.
- Why not one scene of all floors: pick, walls cut and live state are built for one floor; mixing would have made every one of them aware of floors below.

## 2026-10-09: a disabled Undo or Redo is dimmer than an enabled one (Opus re-check 5)

- `.btn:disabled{opacity:.5}` and `.btn.light{opacity:.6}` have the same specificity and the second comes later, so a disabled Undo was .6 like an enabled one, and under the pointer `.btn.light:hover` took it to 1. Added `.btn.light:disabled{opacity:.35}` and put `:not(:disabled)` on the light hover and focus rule; the other hover rules in the editor (`.lockplan`, `.lrow`, `.ti`, `.opt`, `.door-hit-open`) are not on buttons that can be disabled. Computed-style pair in `editor.spec.ts` for light, ha and blueprint: disabled lower than enabled, and unchanged under the pointer. It supersedes (e) of 'small defects' for the `.light` buttons only.

## 2026-10-09: Escape cancels a device drag first, one device or many (Opus re-check 3 and 4)

- The Escape chain asked Help and Place before the drag, so with either open the group kept dragging and committed. A drag of devices is now the first thing Escape checks after the menus (`cancelDeviceDrag`). It supersedes (a) of 'small defects of the Sprint 26 review', which handled the group only after the panels.
- A single-device drag took its undo snapshot on the first move, and Escape only cleared the selection. Now Escape puts the device back, drops the drag and takes the snapshot back (`EditorState.dropSnapshot`); the selection stays. The redo stack that snapshot cleared stays cleared: a drag that began is an edit that began.

## 2026-10-09: a typed length follows the exact ray and ends on whole cm (Opus re-check 1 and 2)

- The typed direction came from the whole-cm aim point, so the nearer the pointer the further off the wall went: zoomed in, a pointer 40 cm out typed 350 and gave 14.38 degrees. It now comes from the unrounded ray point (`rayPoint`, kept as `rayAim` by `snapDraw`; `snapRay` is `rayPoint` rounded). It supersedes 'a typed length takes its direction from the rounded aim' of R1a.
- The typed end was fractional (`[789.03, 536.93]`). `Draw.placeTyped` now rounds the end point, as every snapped point is. Cost: the length differs from the typed one by under 0.71 cm (each coordinate is off by up to half a cm) and the angle by up to 0.116 degree over 350 cm; so the tests allow 0.12 degree, not the 0.05 asked. Along 0 and 90 degrees the end is whole already and stays exact (0.01 kept). The schema asks for finite numbers only, so whole cm is a choice for consistency, not a rule.

## 2026-10-09: small defects of the Sprint 26 review (a to g)

- (a) Escape during a group drag puts the devices back (`replaceFloor(base)`), drops the drag and keeps the selection; the history was never touched, so there is no undo step. A second Escape clears the selection as before.
- (b) A right-click on an Outline row that is a member of the multi-selection keeps the selection and opens the multi-selection menu, as the plan does. Any other row selects its object first, as before.
- (e) A disabled `.btn` is dimmed (opacity .5) with a not-allowed cursor, for every button, so "Link 0" no longer looks live. It was already disabled; nothing said so to the eye. Computed-style pair in `link-mode.spec.ts`.
- (f) The docstring of `planLocked` in `state.ts` says Lock plan, not Fix plan.
- (g) Not fixed, reported: the status bar sits over the foot of the canvas (S26.22) and covers the bottom row of the ruler (about 20 px at 1024 wide, the label "8" in the demo). The ruler spans the view, so a roomier fit would not clear it; only a shorter canvas or a ruler that skips the bar would, and the first one broke two specs in S26.22. Left as it is.
- (c) The multi-device heading counts the devices that exist (`mine`), as Delete does; a stale index or a repeat no longer makes them differ.
- (d) Controlled by counts the lights that change, not all of them: ten already bound and ten not says "Bound 10". When none would change it says "Nothing to bind: the lights already have it" ("Nothing to clear: no light is linked" for the clear), writes nothing and makes no undo step.

## 2026-10-09: a context menu near the foot shifts up instead of shrinking (Opus review R5)

- The menu top was clamped to `innerHeight - 120` and the height then capped to what was left, so at 1024x768 a right-click near the canvas foot gave a 112 px scrolling strip. The cap is now the window (`100vh - 16px`) and `fitCtxMenu`, run from `updated()`, moves the menu up by how far its foot is past the window, to 8 px at most from the top. Only a menu taller than the window scrolls. The height is only known after the render, so a measure-and-move is simpler than guessing it from the item count.

## 2026-10-09: Help shows in every Inspector mode (Opus review R3)

- Help was drawn only in the Selection mode, so `?` and the Help button did nothing visible in Add, Place or Link. `asideView` now puts the guide first whatever the mode is. Escape closes Help before it closes the mode (the order of the keys moved up), and a click on a tab closes Help and goes to that tab. The mode and its state are kept under Help.

## 2026-10-09: any edit, Undo or Redo closes Link mode (Opus review R2)

- The Link scope is device indices. Select Alpha and Beta of four, open Link, press Delete: Gamma and Delta slid into indices 0 and 1 and the preview offered them; Apply would have bound lights nobody chose. Undo did the same. The mode now remembers the floor object it opened on and closes in `willUpdate` when `st.f` is another object (every edit, Undo, Redo and drag makes one). This supersedes 'an Undo or an edit shows at once' of S26.23: a preview that cannot survive its own scope is closed, not repaired. Scoping by device id was the alternative; it would still leave a room scope pointing at a moved room.

## 2026-10-09: a ray-snapped point is whole centimetres (Opus review R1a)

- `snapRay` returned `200.00000000000003` for a vertical wall. It now rounds the point to whole cm, as `round()` does for every other draw snap. The cost: the angle is exact only to half a cm over the run, so the tests that read an angle at 0.01° now allow 0.1° (0.3° for a typed length, which takes its direction from the rounded aim), and assert `Number.isInteger` on the ends.

## 2026-10-09: a corner beats the 15 degree ray; every free click while drawing lands on a ray (Opus review R1b)

- The 15° ray snap read "the corner snap gave the plain grid point" as "nothing caught the pointer". A corner on a grid point, 18° off the ray, was thrown to (509, 283) and the walls did not join. `snapDraw` now asks the corner search itself (`cornerHit`, split out of `snapCorner`), so a corner always wins.
- **Intent, recorded:** every free click while drawing is forced onto a 15° ray from the last point unless Alt is held or a corner or an alignment caught it. That is the design of S26.12, not a side effect. It moved the Backspace room test's input from [200,668] to [295,700].

## 2026-10-09: Sprint 26 in one place: multi-select, Lock, Inspector modes, status bar, typed length, snap (S26.24, S26.25)

The decisions below, each in its own entry, add up to this. Summary so a later reader need not read twelve entries.

- **Multi-select.** Shift on the plan is a marquee; Shift+click toggles any device; a group moves, locks and deletes as one undo step through `bulk.ts`. Selecting writes nothing.
- **Lock.** One word. The plan toggle holds geometry; a device, furniture piece or unlinked appliance has a Lock box; wall, door and opening say "Lock (keeps its length)". No rendered string says Fix, Unfix or "length locked". The banner reads "The plan is locked." with an Unlock button. Ids (`#fixPlan`, `#bannerUnfix`, `cmd:fix`) stay: they are not read by anyone, and renaming them would churn 30 tests for no reader's gain. `bannerLevel` matches "is locked" as an error, where it matched "is fixed".
- **Inspector modes.** Selection, Place, Add and Link are tabs of the aside; nothing floats over the plan.
- **Status bar.** Facts on the canvas foot from `statusFacts`; messages stay in the banner.
- **Typed length and snap.** 15 degree rays after the corner snaps, Alt off; digits typed while drawing place the next point at that length.
- **The sweep.** `one-word.spec.ts` walks every shadow root after opening each menu, the Help guide, the command search, the banner, each context menu and each panel, in both plan states, and fails on the words. The scene-save refusal text is not reachable from the DOM (Save works under the lock since S26.3), so it is changed in the source and not swept.
- **Exit test.** `bind-twenty.spec.ts`: Shift+drag, Controlled by, the switch; 20 lights bound; one Undo unbinds all 20. The three actions are counted in the test.

## 2026-10-09: Link lights with a preview (S26.23)

- Edit, Link lights to switches no longer writes at once. It opens a fourth Inspector mode, Link (a tab that shows only while the mode is open). The rows are `linkSuggestions(st, scope)` in `bulk.ts`: the same rule `autoLinkLights` used (unbound light, not a `switch_as_x` wrapper, a uniquely suggested switch), so the preview and the old one-shot cannot disagree. `EditorState.autoLinkLights` stays, with its tests; no button calls it now.
- **Scope is fixed when the mode opens** (`linkScopeFor`): selected devices, else the selected room (lights whose point `roomAt` puts in it), else the floor. Any other selection is the floor. The rows themselves are recomputed from the live layout on every render, so an Undo or an edit shows at once. Ticks are kept by device id, all on at the start.
- Apply is one `st.edit` over `applyLinks`: one undo step, none when nothing is ticked (the button is off). A refusal by the plan lock goes through `refused()`. The mode closes after Apply, Escape, the X or a floor change, and falls back to Selection when Home Assistant data is gone.
- The old Playwright test of S8.7 clicks Apply now; it is the one test changed.

## 2026-10-09: the status bar (S26.22)

- `statusFacts(st, { alt, drawing })` in `status-bar.ts` is the one source of the text; the host only draws it and keeps `altDown`. Order: selection (a name for one, "N selected" for several), its room (the one room they all stand in; none when they span rooms; a selected room is named once), snap, the 15° step, "Turned n°", the floor, the zoom, then "Plan locked".
- **The 15° step shows only while drawing and without Alt.** It has no meaning on a plain pointer, and a permanent "15°" would read as a setting. Alt shows "Snap off", as the pointer does with it held; a grid of 0 reads the same.
- **Zoom 100 % is the whole floor in view** (`viewBoxFor` against the view, the same ratio `centreOn` uses), so a fit reads 100 % on any plan.
- **The bar sits on the foot of the canvas, over the plan, with `pointer-events:none`** (the Unlock button takes clicks). A first version was a row under the editing area; it made the host taller, so a click below the canvas, which used to land outside the editor and let go of the selection, landed inside it. Two older specs (`editor.spec.ts` "wall under an opening", "rotated flight") click there and failed. The bar now adds no height and passes clicks to the plan under it. Facts only: refusals and messages stay in the banner.
- Alt is heard on the host (keydown and keyup, finding 6) and forgotten when the window loses focus.

## 2026-10-09: the Outline offers the plan's menu (S26.21)

- A right-click on a device or room row selects that object (through `goTo`, as a click on the row does) and opens the menu `ctxTargetFor` gives for it, at the pointer. The Menu key or Shift+F10 on a focused row opens it under the row. No new menu code: `ctxMenuView` and `ctxItems` are the only source, so the two lists cannot differ.
- Floor, "No room", area and unplaced-entity rows have no menu; the browser's own shows. A room of a kind with no menu (`ctxTargetFor` returns canvas) opens none either.
- Side effect, same as a click on the row: the view centres on the object.

## 2026-10-09: `?` opens Help (S26.13)

- The key is handled in the editor host's `onKey`, after the text-field check (INPUT, SELECT, TEXTAREA) and guarded by `takesTyping`, so the Outline filter and every other field keep the character. It toggles, like the Help button, and works while drawing too (it is not a typed character). Ctrl, Cmd and Alt chords are left alone.
- The test presses `?` itself: Playwright's `Shift+/` sends the key `/`, which is the search chord.

## 2026-10-09: typed lengths and 15 degree steps while drawing (S26.12)

- **`snapDraw` runs `snapCorner` first, then `snapRay` only when that returned the plain grid point.** A corner, a T onto an edge or an alignment with an earlier point of the shape changes the result, so it wins inside its 14 px reach; otherwise the point goes on the nearest 15 degree ray from the last point. Alt turns the ray off with the other snaps. Shift keeps its meaning. The ray point is not rounded to whole cm (its length is on the grid).
- **Typing belongs to draw mode once a point exists.** Digits, a dot and `m` go to `Draw.type`; a letter or a second dot is ignored. Enter with typed text places the point (`placeTyped`) toward the last aim of the pointer (`aim`, kept because a click clears `hover`); without typed text it finishes as before. A refused value (0, over 10 000 cm, no direction) keeps the field and says why in the status line. Escape clears the typed text first, a second Escape cancels; Backspace takes back a digit before it takes back a point.
- The field is `.dr-typed` text in the overlay, upright under a turned view, with a halo, `pointer-events:none` by class rule.
- Tests draw on a plan made blank through Reset: a blank layout cannot be loaded (an outline needs 3 points).

## 2026-10-09: select many on the plan (S26.10, S26.11)

- **Shift on the plan is a marquee.** Shift+press on the background, a room, stairs or furniture starts it; Shift on a corner, wall, door or device keeps its meaning (detach a corner, toggle a device). A Shift+click without a drag selects what a plain click would (a room, stairs, furniture) and leaves a device selection alone. Furniture starts it too, since lights sit among furniture.
- **The rectangle is taken back through the view's turn**: four client corners through `toSvg`, then `marqueeHits`. The overlay draws the same four plan-space points as `.marquee`, so a turned plan shows it upright. A device counts as drawn when its icon exists and is not `display:none` (Layers, and the far detail level that drops idle icons); the DOM is the one source for "drawn", so the hit-test cannot disagree with the pixels.
- **Shift+click toggles any device**, not only lights and motion of one kind. The group panel already says "Shift+click more of the same kind to group" for a mixed set, and `groupKind` decides.
- **A drag on a member moves every unlocked member** with `moveDevices`, the delta rounded to the snap grid (Alt: 1 cm), 4 px before it starts. It records its step with `commitLiveEdit`, so a drag that ends where it began leaves none. A click on a member without a drag narrows the selection to it. A group of only locked members, or one locked device, takes the press (selection) and no drag.
- **Escape** drops a marquee in progress, otherwise clears any selection. **Ctrl or Cmd+A** is ignored in a text field and while drawing.
- `.marquee` and the typed-length field live in the host's `static styles` beside `.dr`, since the overlay is the host's.
## 2026-10-09: Lock in every panel (S26.16)

- The device, furniture and unlinked panels get a Lock box in Appearance (`lockBox`): ticked writes `locked: true`, unticked deletes the key, one undo step each. A wall, door and opening keep `lockField`, now worded "Lock (keeps its length)". No panel says Fix or "length locked".
- Known edge, not changed here: `EditorState.plan()` counts a furniture piece's `locked` as geometry, so under Lock plan the furniture box (and the context-menu Lock) is refused. A device's and an unlinked appliance's `locked` are outside the compare. Left for Diego to call; it is one key in `plan()`.

## 2026-10-09: the Inspector on a multi-selection (S26.15)

- `devsPanel` counts by type (most first), then Controlled by when a light is in the selection, Create group as before, Lock, Delete n. Each action is a single `commit` over `bulk.ts`, so one undo step; the note is `Bound 20 lights; 2 others left alone` (`Cleared` for none). "Others" are the non-lights, plus a light that is the pick itself.
- Controlled by offers the first selected light's choices (floor-scoped, so the same for every light) and shows the switch the lights share, "(mixed)" when they differ. No Motion entries in bulk: that flow is per light.
- Lock is a checkbox: ticked when every device is locked, half-ticked when some are; a click on a mixed box locks all. The name list folds into a closed "Devices" section; 22 names pushed the actions out of view.

## 2026-10-09: the Inspector has modes (S26.14)

- The aside gets three tabs: Selection, Place, Add. `asideMode` in the host replaces `placePos` and `addDevPos`; Place and Add are no longer floating, draggable panels (`.fpanel`), they are bodies of the aside (`.imode`), so opening one moves nothing on the canvas. Ids (`#placePanel`, `#addDevPanel`, `#placeClose`, `#addDevClose`, `#placeGo`) are kept.
- Place needs a room: its tab is off until the selection is a room with something to place, or a Place mode already holds one. Leaving for Selection keeps the ticks; the Escape key and the X return to Selection. Switching floor closes Place, as before.
- Add stays a mode after a pick (S8.5: place many in a row); the Selection tab shows what was placed. The Left column tablist label is now named in `studio-layers.spec.ts`, since the aside has a tablist too.
- State stays in the host, which `hass` updates do not reset (panel test). Dropped with the popups: the drag by the head, and the 780/660 px widths (S8.8); two tests changed with them, on purpose.
## 2026-10-09: menu clean-up, keys, Lock plan (S26.17-19)

- Menus: a box gets `max-height` from the room under its button (minus its padding and border, since max-height is the content box) and scrolls. Sibling subs close through one `onSubToggle`. Add has no `select`: Furniture and Unlinked device are submenus of buttons (`#addFurn-<symbol>`, `#addUnlDev-<type>`); furniture names come from `FURNITURE_LABELS`. The Group light picker (`#motLightGrp`) is a sub too.
- View keeps one Labels submenu (`#names`, `#labels`). The installed version is in the Help panel (`#version`), so `panels.ts` took two lines; `editor-app.ts` was not touched.
- Keys: `MENU_KEYS` and `chordLabel` in `guide.ts`; `Mod` is ⌘ on a Mac, Ctrl elsewhere. Only Undo, Redo, Save and Fit to window carry one. Left out: Search, Select all, Delete, Help "?" (not menu items yet, or their keys land in other lanes), and the context menu (lane D owns `ctxItems`). Space is shown on Fit to window; it also turns the view upright.
- Lock plan: the lock is a CSS mask (a data-URI SVG on a span), not an inline `<svg>`: an inline one came first in the shadow root and 105 tests, helpers included, take `querySelector("svg")` to be the plan. A test pins the plan as the first svg. Label and tooltip change with the state; the id `#fixPlan` stays so other tests still find it. Accessible name is the constant "Lock plan", state is `checked`. On is ink on paper, hover is the warning colour. The command list and the banner still say Fix plan (S26.24).
## 2026-10-09: every context menu comes from `ctxItems` (S26.20)

- `ctxMenuView` builds each menu from `ctxItems(kind, facts)` and maps an item id to an action in `runItem`; labels, order, keys and disabled state are the model's. Twelve targets, all open a menu: a hit with no menu of its own (a room kind with none, a hidden edge, the background) opens the canvas menu, a corner handle opens none. `ctxTargetFor` (in `ctx-menu.ts`) turns a hit into the target and sets the selection; the host only keeps `hitOf` and `edgeNear`.
- Supersedes the menus of S4.18, S4.27 and S4.31 where they differ: Change colour is gone from the room menu (the panel has it); Add an opening, a submenu of five, is three items (Add door, Add window, Add opening), so Open doorway and Slit window are in the Add menu only; Fix and Unfix are Lock and Unlock; a door, opening, furniture piece and unlinked object gain Delete.
- A right-click on a device that belongs to the selection keeps the selection (target `devs`); on any other device it selects that one. Lock on a selection unlocks only when every member is locked.
- A locked device selects but does not start a drag.
- The room's unplaced Home Assistant entities stay as buttons under its items (a quick Place); they are not model items.
- Rename, Controlled by... focus the panel field (`#rn`, `#vbound`...); a device has no name field, so Rename says the name comes from Home Assistant. The F2 key shown on Rename is not bound here.
- Add device here... keeps the click point in the host (`addAt`) for the next device the Add panel places; closing the panel clears it.

## 2026-10-09: the editor host is split (S26.9)

- `toolbar.ts`, `ctx-menu.ts` and `inspector.ts` take the host as `h` and export their own `css`; `static styles` is an array. Pure move: no test edited.
- Members these modules call lost `private`. The pointer, key and focus handlers stay in the host.
- Kept in the host: `openCtxMenuAt` (it needs `hitOf`) and the Place and Add device state (the Escape, focus-out and drag handlers read it).
- CSS order is kept inside each block; the blocks moved only past rules that never share an element and a property with them.

## 2026-10-09: bulk device writers (S26.2)

- `src/editor/bulk.ts`: `bindLights`, `removeDevices`, `moveDevices`, `lockDevices`, `reindexAfterRemove`. Each returns a new floor (`bindLights` also `skipped`), never touches its input, and returns an equal floor when nothing changes, so `EditorState.edit` records no step. Indices are cleaned first: integers in range, distinct.
- `skipped` counts the listed devices left alone: non-lights, and a light whose own entity is the one asked for (`validate` refuses `bound === entity`). Junk entity text changes nothing and is not counted.
- `moveDevices` also leaves a device where it is when the move would pass `COORD_LIMIT`, so no result fails `validate` (finding 12). `lockDevices(false)` deletes `locked: true` and leaves a stored `false` as written, so unlocking an unlocked device is not a change.

## 2026-10-09: devices can be locked (S26.1)

- `Device.locked?: boolean`, schema stays v2: an old card ignores the field. Same key as a wall, door, opening, furniture piece and unlinked object, so Lock is one word everywhere. `validate` reports anything but a boolean (`"yes"`, `1`, `null`); `migrate` leaves the value as written and `validate` judges it, as it does for the other `locked` fields. What a lock stops is decided in later tasks (a drag, alone or in a group).
## 2026-10-09: Fix plan holds geometry only (S26.3)

Supersedes the `plan()` rule of 2026-10-06 ("Fix plan": nothing of the plan changes) and the scenes carve-out of 2026-10-07, which this generalises.
- **What stays locked:** points, walls, openings, edge and room kinds, heights, stairs, furniture, the outline. A change to any of them is refused with `planBlocked`, as before.
- **What goes through:** every name and title (room, floor, door, extra, stairs, furniture), colour and texture, the HA area and floor id, and every entity link (a room's `entity`, sensors and scenes; a door's sensors, locks and cover; a piece of furniture's `entity`). One undo step each. Reason (Studio review, U3): the lock told a person they could not rename a room, and names and colours are not what a lock protects.
- **How:** `EditorState.plan()` serialises the floor without those fields. `renameFloor` and `paint` no longer ask `planOpen()`. Order, add, delete and rotate of floors stay refused.
- **Not done here:** `editor-app.ts` still refuses the texture rotation and scale sliders under the lock (`rotateTexture`, `scaleTexture`), and `replaceFloor` still drops a live non-device change under the lock, so those two sliders stay blocked until the Inspector tasks rewire them.
## 2026-10-09: the plan draws a multi-selection (S26.4)

- `RenderOpts.selection` is a `PlanSel` (`layers.ts`): `{ t, i }` as before, or `{ t: "devs", is }`. One helper, `devsHave`, answers "is device i in it" for both the draw (`.sel`) and `layerHides` (a selected member is drawn under a hidden layer), so the plan and the hit-test cannot differ.
- A list with junk (not an array, `NaN`, 1.5, strings) selects only its integer members that exist; a non-list selects nothing. Without `devs` the markup is byte for byte as before.
## 2026-10-09: one context-menu model (S26.6)

- `ctxItems(target, facts)` in `src/editor/ctx-items.ts` is pure: ids and labels only, the host maps an id to an action. Twelve targets in `CTX_TARGETS`, so a new one fails the iterating test until its list is written.
- Lock is offered on device, devices, wall, door, opening, furniture and unlinked; not on room, edge, stairs or extra (no `locked` field, and Lock plan holds geometry). Stairs and extras get Delete only.
- Items that read HA (Place devices from area, Add device here) are `disabled` without it, not hidden, so the menu keeps its shape.
- "Delete n" only for two or more devices; junk counts give plain "Delete".
- Not wired into `editor-app.ts` here: that is the later host split.
## 2026-10-09: typed length lives in `Draw` (S26.8)

- `Draw.typed` is the buffer. `type(ch)` takes digits, one dot and a closing `m` (false otherwise, buffer capped at 8 characters); a minus cannot be typed. `untype()` drops the last character. `typedCm` reads it: "350" is cm, "3.5m" metres; empty, 0, over 10 000 cm (10 000 itself is fine) is null.
- `placeTyped(toward)` goes through `click`, so an opening still finishes on its second point and the 1 cm duplicate rule holds. Refused (returns "ignore", nothing added, buffer kept) with no length, no point yet, or the pointer on the last point (no direction). A point added by `click`, `cancel` or `finish` clears the buffer.
- The point is not rounded: a typed 350 along a diagonal has fractional coordinates, so the segment is 350 cm to float precision.

## 2026-10-09: `snapRay` snaps to the nearest ray (S26.7)

- `snapRay(from, p, stepDeg, grid)` in `src/editor/draw.ts` takes the nearest multiple of `stepDeg` by plain rounding of the angle, then rounds the length to the grid (0 means 1 cm). The plan's example "352 gives 0" is wrong for a 15 degree step: 352 is 8 from 360 and 7 from 345, so it gives 345; 353 and up give 0. The test says so.
- Junk (non-finite numbers, a step of 0 or less) and `p` on `from` return `p` unchanged. Nothing throws.

## 2026-10-09: Sprint 25 re-check fixes (Opus)

Supersedes B and D of the entry below, and "`detail` is not part of the view-memory storage key" in the entry after it.
- **One attention result.** `attentionDevices` ran the rule without HA's entity registry, so a Zigbee2MQTT contact whose battery is a diagnostic `sensor.*_battery` on the same device showed in the Overview and was hidden at far. `RenderOpts.attention` ({ floor, result }) carries the card's own `attention(layout, states, hass.entities)`; the `needs-attention` class and the room badges (`floorRollups`) read its items for that floor. Without it (the Studio, which has no registry) both run the rule on the floor alone, as before. The Hall badge showing 2 against 3 Overview rows had the same cause: the missing battery item.
- **Storage key seeds `detail` and `kiosk`.** A stored pick beat a card that became kiosk (stuck at far, no button) and an edited YAML `detail`. Both join the seed when set, so changing either starts a clean memory, as docs/card.md already promised. This reverses the earlier choice that `detail` stays out of the key: the pick is still the viewer's, but a config change now outranks it.
- **A jammed lock is not closed.** `closed` needs `!jammed` beside `!unlocked` (one locked and one jammed lock read as closed).
- **Far attention dot outline.** `--fp-warn` equals the lit lamp colour in Solarized and the open cover colour elsewhere. The dot gets a 1.5 px `--fp-ink` outline (`vector-effect: non-scaling-stroke`, so it is 1.5 screen px at any zoom).
- **Known gaps, not fixed:** duplicate-entity icons (one entity on two icons) and 2.5D stack detection for the spider.

## 2026-10-09: Sprint 25 review fixes (A, B, C, D)

Supersedes parts of the two entries below.
- **A. The `auto` default needs a way out.** With no `detail` in the YAML and no stored pick, the card is `auto` only if the viewer can change the level: the Detail button (Overview shown: not `kiosk`, not `active_list: false`) or zoom (`zoom` not `false`, not `kiosk`; a kiosk zooms by gesture only, which is not something a wall panel is told about). Otherwise it is `full`. Reason: at fit `auto` is `far`, which hides idle devices, and a kiosk viewer had no control to bring them back. An explicit YAML `detail` and a stored pick still win, so `detail: auto` in a kiosk gives `far`. `_detailMode()` in the card.
- **B. Far keeps what needs attention, by the one rule.** `renderFloor` marks every device `attention()` reports on with `needs-attention` (`attentionDevices`, run over the floor alone), and the far rule spares that class. Before, the rule keyed on the `on` class, so an unlocked or jammed lock and a battery-low contact (class `off`) vanished at far, when they matter most. No second copy of the rules. An idle disc has no fill, so at far the class also paints the dot in `--fp-warn` (found only by looking at the render: the first version drew an invisible dot). Cost: without `hass.entities` the render cannot read a hub's battery sensor; the device's own state and attributes decide.
- **C. A badge keeps its screen size.** `badges()` took `k`, not the zoom-corrected `kt`, so it grew with the zoom while room names did not. Now `kt`.
- **D. A locked lock is closed evidence.** A door is closed when every contact sensor says off or a lock says locked, and no sensor is on and no lock is unlocked. A door whose only sensor is a lock read as a hole while the lock said locked. An unlocked lock alone still does not close it.

## 2026-10-09: the detail mode in the menus, the YAML key and the defaults (S25.7, S25.8, S25.9)

Supersedes "Mode is `full` for now" in the entry below.
- **Card default `auto`, Studio default `full`.** Semantic zoom is the feature, so a card with no key and no stored pick runs `auto`. The Studio stays `full` while editing: placing a device must not hide it. The Studio's constant is `DEFAULT_DETAIL` in `src/editor/state.ts`.
- **Priority in the card:** the viewer's stored pick, then `detail:` in the YAML, then `auto`. Junk in either place is `auto` (`parseDetailMode`; the stored value is dropped by `parseStoredView`). `detail` is not part of the view-memory storage key: editing it in YAML must not start a card with a clean memory, and the pick is the viewer's, not the config's. Reset view clears the pick.
- **Kept per viewer, every storage access in try/catch.** Studio: `floorplan-studio:detail`, like the theme; card: a `detail` field in the view memory. Blocked storage means the pick lasts for the session.
- **Tests that click idle devices at fit.** 144 card tests would miss them under `auto`. `tests/card/harness.html` and `harness-static.html` wrap `setConfig` to add `detail: "full"` when the config has no `detail`; a test sets `window.__realDetailDefault` with `addInitScript` to see the real default (`tests/card/detail-menu.spec.ts` does). No assertion changed. Alternative rejected: editing each of 50 files.
- **Not in 3D.** The Detail button hides in live 3D, as Layers does; 3D draws every level.
## 2026-10-09: incremental render by diffing the markup, not by patching per device (S25.6)

- The card still calls `renderFloor` for the whole plan on every `hass` update and gets markup back. `src/card/plan-patch.ts`
  parses that markup and makes the live `<svg>` equal to it, touching only the nodes that differ: a Myers edit script over
  each parent's children (keyed by serialisation), and an in-place rewrite of an element whose tag and attribute names match.
  Lit's `unsafeSVG` replaced every node whenever the string changed. The card now uses a `planPatch` directive on the `<svg>`.
- Why not a per-device render function. A device change reaches the aura, the room's glow and `on` class, the night overlay,
  the motion edge, the rollup badge, a linked furniture piece and the 3D solids. Patching "the device's nodes" and listing
  those dependents by hand would be a second set of rules next to `renderFloor`, and the two would drift (finding 8). The diff
  has no list to forget: whatever the one draw path says changed is what gets written. A patched plan equals a fresh render byte
  for byte by construction; the unit test checks every `DEVICE_TYPES` member over on, off, unavailable, alert and playing.
- What it does not save: `renderFloor` runs in full and its string is parsed (400 devices: about 15 ms for one change, 35 ms
  for all 400 flipped, in Chromium). It saves DOM writes, style recalculation, layout, transitions restarting and the loss of
  node identity (a hover target, a CSS fade). If the string build itself shows up as the cost, the next step is memoising
  per device inside `renderFloor`, with the same byte-for-byte test already in place.
- Full replacement still happens where the structure changes: an element whose attribute names or their order differ is
  replaced whole, as is a tag change. Layout, floor, theme, zoom, detail and layer changes are ordinary diffs against the new
  markup, and may touch most of the plan; nothing special-cases them.
- The Attention and Active rows are Lit templates; Lit already updates only the parts that changed. The panel's editor is not
  affected: it never used `unsafeSVG`, and the guard on its `layout` setter is unchanged.

## 2026-10-09: spiderfy, card only; the ring is `renderFloor`'s (S25.5)

- **A stack is two device discs that overlap: centres under `STACK_PX` = 32 screen px, not the 44 px of the brief.** 32 is a disc's width (32k plan units, never under 29 px, S23.2); 44 would call two icons side by side a stack, and a tap on either already reaches it. The members of a ring sit at least `SPIDER_GAP_PX` = 44 px apart, which is the touch target. `stackGroups(points, minDist)` links points closer than `minDist` and chains them (a-b, b-c close, a-c far: one group); junk points and junk distances give none. `spiderLayout(spots, unit, box)` puts the members on one ring about their mean, first one straight up, radius at least 40 px, `unit` = plan units per screen px so the ring is one size at any zoom; the centre moves until the ring, 24 px above and below and up to 110 px at the sides (names), lies in the view box.
- **One draw path.** `renderFloor` takes `spider: [{ i, at }]`. A member's icon is drawn at `at` (still `g[data-x]`, so the tap, the hover and the popup are unchanged), a leader and a pin go under every icon, the name is drawn beside it. Rules are classes (`.spider-leader`, `.spider-pin`, `.spider-lbl`, none takes a click) and a `.spider` member is exempt from the far-level hiding. The 2.5D lift of a high device is not applied to a member; the leader replaces its stem.
- **The card decides when.** `bindDeviceActions` asks `opts.stack(i)` on a tap of a device icon, before the popup; true means the card opened a ring and nothing else happens. A tap on a member of the open ring, or on a lone device, is not a stack tap. The members are the devices that are drawn (computed `display` is not `none`), so at far an idle device does not join a stack it is not in. Escape folds (after the popup, if one is open), as does a press on the plan that is not a ring member, a floor change and a new layout. Hold is unchanged (more-info).
- **A ring takes at most `SPIDER_MAX` = 8.** Overlaps chain, so a packed grid is one group of dozens (the Sprint 23 tag-tap test's 60 switches, 20 cm apart, at 375 px). The card then fans the tapped device and its 7 nearest neighbours. That test now taps twice at 375 px: the stack, then the device.
- **The Studio gets no ring.** It picks the top element (`hitOf`), so the device under another is not clickable there, but the Outline tab and the search select any device by name (S24.5), and the inspector then moves it. A ring would clash with drag-to-move on the same icons. Not done; say so if a ring is wanted there too.
- **Known limits.** A card turned by Rotate does not clamp the ring to the view (the view box is in the turned frame). The ring is not kept clear of the Active panel or the control strip.
## 2026-10-09: detail levels in `renderFloor`; mode is `full` until the menu (S25.1, S25.2)

- `detailLevel(zoom, mode)` and `detailFor(fit, shown, mode)` live in `src/core/detail.ts`. Far below 1.6, mid to 3.2, near
  from there; zoom is the smaller of `fit.w / shown.w` and `fit.h / shown.h`, as "Copy card view" takes it. Junk zoom is
  near; junk mode is auto. The card and the Studio both call `detailFor`.
- `renderFloor` writes `data-detail` only when `detail` is one of the three names; with none, the markup is byte for byte as
  before. All hiding is CSS keyed on it. Far: `.dev` that is not on, danger, unavailable or selected is `display:none`; the
  rest lose glyph and badges and keep the disc at half size. Far and mid: `text.lbl:not([data-rl]):not(.extra + .lbl)` and
  `text.val:not([data-rv])` go (device names and readings; room names, room readings and extras stay). That selector leans
  on an extra's name being drawn right after the extra; S25.4 must keep it or add a class.
- **Mode is `full` for now (`detailMode` on the card and the Studio), not `auto`.** The brief said auto. Run that way, 144
  Playwright tests fail: at fit every idle device is gone, and the tests (and the Studio's editing) click idle devices at
  fit. Hiding idle devices while someone places them is also a real editing problem. S25.7 and S25.8 set the mode from the
  menu and the YAML key; the Studio's default there needs Diego's call (suggest `full` while editing).
## 2026-10-09: labels keep their screen size at any zoom (S25.4)

Supersedes "Not done here: placing labels in CSS px outright" in "an 11 px floor on the card (S23.2)". `renderFloor` takes `zoom`, the view's zoom over the whole floor at fit (1 = fit). Text uses `kt = k / zoom`: every label size, its offsets, the name search steps, the leader width and the tag plate. Absent, 1 or junk (not a finite number above 0): byte for byte as before, so no snapshot changed.
- **Labels only; icons and discs still grow with the view.** The brief is the label. `k` stays for discs, stems, the collision radii of icons and the label anchor on a device's disc edge (16k above the centre), so the label sits on the icon's rim whatever the zoom. Moving the icons too is sprint 25's detail work, not this task.
- **The 11 px floor moves with the view.** `nameMin` is `NAME_MIN_PX / (px * zoom)`: 11 px on screen at the view on show, not only at fit. A name shrunk to fit its room can shrink back in plan units as the room grows on screen.
- **The card passes `fit.w / box.w` on every render.** A zoom already re-renders the card's markup (the view box is in it), so this costs no second render; names are placed again at each zoom, which is how a name that did not fit at fit can sit inside its room once zoomed. A card pinned by `zoom_level` or `center` now draws its labels at the size of the whole-floor card, no longer enlarged with the pin.
- **The Studio passes nothing.** Its `scale` is already the live view scale (`k = 1/scale`), so its labels were screen-sized already.
- Test: `tests/core/label-zoom.test.ts` (zoom 2.5 and 4 and 6, junk input, discs unchanged) and `card-label-zoom.spec.ts` (a real wheel to 6x, `getBoundingClientRect` heights within 0.5 px, a 320 px card for the floor); it fails with the `zoom` line removed.
## 2026-10-09: room badges and their rollup (S25.3)

- **`roomRollup(f, i, state)` / `floorRollups(f, state)`** in `src/core/rollup.ts`: lights on (`classOf`, so an unavailable lamp is not on and a bound lamp counts through its relay), motion on (icons and the room's own `motion` list, once per entity), and from `attention()` run over the one floor: `open` (kind `open`: a contact sensor, door, window or garage door standing open) and `alerts` (every other kind but unavailable, which has its own folded row there). One thing counts once per class. Alert items are put in a room by what they name (device point, piece point, `doorRoomIndex`, a new index twin of `doorRoomName`).
- **Badges are drawn by `renderFloor` (`badges()` in the same file), hidden by CSS.** `.room-badge{display:none}`; shown only under `[data-detail="far"]` or `"mid"`. No attribute, or `near`, shows none. The rule is a class rule with `pointer-events:none` (finding 18).
- **With `labels: false` no badge is drawn.** `labels: false` is the contract "no `<text>` at all" and a count is text. The S7.1 overprint test excludes the badge's `rb-t` text from its label count; the badge's own test checks the plate against its room's name and readout.
- **Placement is a plain rule, not label placement**: the plate sits under the room's name (and under the readout when there is one), centred on the name's anchor. Sprint 25's CSS-px placement task (S25.4) may move it.
## 2026-10-09: full-height window (S25.D3)

Diego: "allow for full height windows (we have those) so that i do not need to use a glass door for them."
- New `DoorKind` `fullwindow`, read "Full-height window". A window in every respect (pane, jambs, sensor, cover is curtains,
  `--fp-window`, the pane goes when open) except its span: sill 0, head `SLIT_HEAD_GAP` (40 cm) under the ceiling of its wall,
  210 on 250. That is a glass door's top and a window's head distance, so all three line up. Chosen over a head exactly at
  the ceiling: a window whose head touches the ceiling reads as a gap in the slab, and Diego's slit was moved off the ceiling
  for the same reason (2026-10-06). An own `sill` or `height` wins, clamped to the wall; on a wall lower than 40 cm the head is the wall.
- Per-kind tables: `DOOR_KINDS`, `DOOR_DEFAULTS`, `doorSpan`, `OPENING_FILL`, `PANE_KINDS`, the palette `glass-fullwindow`, the
  curtain rule, the Studio names and sill field. A test walks `DOOR_KINDS` so a new kind fails until it is in each.
- No migration; a stored `glass` door stays a glass door.

## 2026-10-09: the glass kind is read "Glass door" (S25.D2)

Diego: "rename glass into glass doors."
- Visible name only: the type selector, the docs and SPEC say "Glass door". The stored value stays `glass`; no migration,
  no schema change.

## 2026-10-09: a closed door is a thick line (CLOSED_DOOR_BAND)

Refines "closed doors a thin line (S25.D1)" below. Diego: "a closed door is a thick line."
- In 2D a closed door or glass door (`doorStateOf(...).closed`, kinds `door` and `glass`) draws its `.door` line at
  `CLOSED_DOOR_BAND` (1.6) times the wall width, centred, butt caps: 16 cm on an internal wall. Capped at
  `WALL_WIDTH_EXTERNAL` (20): 1.6x on an external wall (32 cm) stuck 6 cm out each side and covered the room's border in
  the render, so there the door is flush with the wall. 1.6 was the first value tried; the internal-wall render looked right (a slab 3 cm proud each side), so no other was tried.
- Unchanged: the open hole and its quiet line, the red alert, windows, slit, full-height window, selection, hit line, 2.5D
  (4 cm threshold). No new CSS rule, so no new computed-style pair. Test: `plan-symbols.test.ts`.

## 2026-10-09: doors are holes, closed doors a thin line (S25.D1)

Supersedes the leaf in "no door swing arcs (S23.F6)" and the leaf and "closed door's line is quiet" in "plan symbols (S23.7)".
Diego: "for doors do not show the open close line at all, it is ugly and pollutes the diagram. open doors are just holes and
closed doors are closed. doors with no sensor are left open (so just a hole)."
- `doorSymbol` returns "" for `door` and `glass`; the leaf code and the room-side probe are gone. A `door-sym` path exists
  only for a window or slit.
- Closed = `doorStateOf(...).closed`: the door has a `sensors` list, every sensor reads `off`, no attached lock is unlocked.
  `on`, `unavailable`, `unknown`, `""`, a missing entry, no sensor: open, a hole. With several sensors one that is not
  `off` makes the door a hole (a dead sensor never reads as closed); one that is `on` is the red alert.
- The thin line is the door's existing `.door` line (wall width, `--fp-door`; `.door-glass` gives `--fp-glass`). It was `quiet`
  (transparent) when closed; now `quiet` is the hole, and it shows when closed. No new CSS rule, so the computed-style pair
  moved (`plan-symbols-css.spec.ts`).
- The red alert for a sensor that reports OPEN (the dashed `.door.open` line, `door-alert` band, pulse) is unchanged: Diego
  did not ask to remove it. Vibration and an open cover on a plain door keep theirs.
- `sealed` and the `open` doorway keep their behaviour. Windows and slits are unchanged.
- 2.5D (`wallSolids`): a door's leaf and a glass door's glass are drawn only when closed or alerting (`SHUT_KINDS`). 3D
  (`view3d.applyDoors`): the leaf and the glass-door pane are visible only when closed; an alerting door (open, vibrating,
  cover open) keeps its leaf, swung and red, as the alert. The static scene still builds the leaf and glass solids (it has
  no state); only the viewer hides them. Known small leftover: `Picker` BLOCKS still counts a door-leaf solid as hiding a
  label behind it, though a hole no longer has one on screen.
- Editor: no live state, so a door is a hole there; selected, it shows its selection line.
- Tests changed on purpose: `plan-symbols.test.ts`, `door-state.test.ts`, `open-door.test.ts`, `solids-openings.test.ts`,
  `card-3d-live.spec.ts`, `plan-symbols-css.spec.ts`; the render snapshot lost only the three leaf paths.

## 2026-10-08: no door swing arcs (S23.F6)

Supersedes the arc in "plan symbols (S23.7)" below. Diego: "the door arcs are horrendous, remove them all". A door or glass
door is now the gap in the wall and the 1 px leaf from the hinge `a`, square to the wall, `|ab|` long, on the room side as
before. The arc and its sweep flag are gone, in 2D and 2.5D (one draw path). 3D never drew an arc; its leaf, which
turns about the hinge when the door is open, is unchanged. Windows, open doorways and red-when-open are unchanged.
- The leaf stays so a door still reads as a door (the coordinator's call, not Diego's). Dropping it later is one branch
  in `doorSymbol` (`render.ts`); the room-side probe exists only for the leaf and would go with it.
- No CSS rule styled the arc alone: `.door-sym` draws the leaf and the window hairlines, so it stays.
- Tests changed on purpose: `plan-symbols.test.ts` (the leaf is the whole path; no `A`/`a` in any symbol, no circle or
  ellipse, for every door kind in 2D and 2.5D; the gap is still cut; the sweep-flag test is deleted) and the render
  snapshot (only the three arcs removed).
## 2026-10-09: Sprint 24 review fixes, core and card (S24.R)

- **A sibling battery sensor counts only when HA files it `diagnostic`** (S24.R12). Supersedes the assumption in
  "Home battery or device battery" below that siblings need not be diagnostic. The re-check found the case it feared:
  a `switch.batt_grid_charge` or a car charger's plug shares its HA device with the battery's charge sensor, filed
  without a category, and 10 % of that is a normal night. The type check sees only the placed icon, so the registry's
  category decides for the sibling, the rule a `battery` icon already used. Shape from the frontend: `hass.entities`
  carries `entity_category` as the string "config" or "diagnostic", or leaves it out (`connection-mixin.ts` maps the
  display entry's numeric `ec` through `entity_categories`). The cost: an integration that files a device's own battery
  without a category is no longer read through the sibling path; its `battery` attribute still is.
- **A battery sensor is read only in % or with no unit** (S24.R12). A cell in volts at 2.9 is not 2.9 %.

- **Low battery reads what Home Assistant really sends** (S24.R1). Supersedes part of "Low battery is a device's own
  battery" (S24.3). Three paths, the first with a reading decides: the entity is a battery entity itself (a battery
  `binary_sensor` on is low; HA has no level there, so the row says "battery low"); a `battery_level` or `battery`
  attribute (Zigbee2MQTT and some others name it `battery`); else a battery entity of the same HA device, through
  `hass.entities[id].device_id`. The card already read that registry for the plug power link (S14.x), so the shape is
  the frontend's own. A device that reports its own attribute is not second-guessed by a sibling.
- **Home battery or device battery: the type decides, the registry can overrule.** HA gives both `device_class:
  battery` and `%`, so unit and class cannot tell them apart. The storage types (`battery`, `inverter`, `ups`, `car`)
  keep their charge out of Attention and do not look for a sibling (an inverter's device holds the house battery's
  charge). A `battery` icon whose entity HA files `entity_category: diagnostic` is a device's battery: Zigbee2MQTT,
  ZHA and most integrations file a device's own battery so, and a house battery's charge is its device's main reading.
  `typeForEntity` still guesses `battery` for a battery sensor; we did not change the guess, the diagnostic flag covers
  the real case. Assumption, not checked against Diego's HA: siblings are not required to be diagnostic, so an
  integration that files a house battery's charge on the same device as a placed light or switch would raise it.
- **The battery item stays on the placed thing.** `entity` is the motion sensor, not its battery sensor; `source` and
  `level` say where the reading came from. So the row's room, its place on the plan, the room filter and the floor's
  count of things all work as for any other item.
- **Jammed is its own kind, between open and unlocked** (S24.R2). A jammed lock cannot lock; someone must go, which is
  more than an unlocked one and less than a door standing open. Row text "jammed". Locking and unlocking stay calm.
- **Active leaves out only what Attention already says** (S24.R6). An item of kind `battery-low` says nothing about on
  or off, so a lamp that is on and low is listed in both; an open door is listed once.
- **The card's pulse ring keyframes are `fp-pulse-ring`** (S24.R7). They shared `fp-locate` with the plan's own ring
  in one shadow root, where the later rule wins: the card's box-shadow would replace the plan ring's grow-and-fade.
- **`render.ts` imports `layerHides`** from `layers.ts` (S24.R11). Supersedes "render.ts still has its private copy"
  (Studio fixes, below): one rule decides what Layers leaves off the plan and what the Studio's pick skips.
- **`attention().floors` has no prototype** (S24.R9): a floor key `__proto__` is a floor.
- **Search folds a short, explicit list of letters** that Unicode does not decompose: ø o, ß ss, æ ae, ł l, đ d, ð d,
  þ th, œ oe, ı i. A list, not a transliteration library (no dependency, a few bytes in the card). Both sides fold, so
  typing "ø" still finds "Søren". A letter not on the list matches only itself.

## 2026-10-09: Sprint 24 review fixes, Studio (S24.R4, S24.R8, S24.R10a)

- **An Outline row for a device or piece is `d:<floor>:<id>`** (`deviceNodeId`). Validate keeps a piece's id unique on
  its floor only, and a device's id unique among devices only, so the bare id could name two rows. The id, not the
  index, so the active row stays on its thing when another is deleted. Rooms keep `r:<floor>:<index>`, as before.
- **What Layers hides is not pickable; what the plan keeps is.** The rule moved to `layerHides` in `src/core/layers.ts`
  and the Studio's padded pick asks it with the selection, as `renderFloor` keeps the selection drawn. A piece found by
  search while hidden is drawn and can be grabbed; let go, it cannot. `render.ts` still has its private copy of the rule:
  that file was another coder's in this round. It should import `layerHides` when the branches meet.
- **A type in a sentence is its singular label** (`DEVICE_TYPE_LABELS`), lower case unless it starts with two capitals,
  so "UPS", "AC" and "TV" stay as they are. `TYPE_LABELS` is the menu's plural ("Access points"), wrong after "Added".
  Furniture keeps its symbol ("Added sofa"): the Furniture menu lists symbols too, and none has an underscore.

## 2026-10-09: the card's layer chips (S24.8, part 2)

- **Supersedes "Layer chips are not in this part"** (part 1, below). The chips fill the `.fp-ov-layers` slot.
- **Text chips, not eyes.** The eye paths stay in the editor; the card bundle carries no new icon. Pressed means shown;
  a hidden chip is dashed and struck through, so the state does not rest on colour.
- **One chip per family with something on the floor on show**, devices and unlinked appliances by type, pieces as
  Furniture (`layerCounts`). A family the floor lacks has no chip, though it stays hidden if the viewer hid it.
- **Per viewer, not per floor.** The hidden list sits in the card's view memory beside the theme and the names toggle,
  and holds on every floor, as the Studio's does. Junk in storage is dropped by `parseLayers`.
- **Not in live 3D.** The 3D view draws every family; chips that did nothing there would lie. They come back with 2D.
- **Search and row taps do not follow Layers**, as in the Studio. The located thing is drawn by `keep` and the chips
  end in "Hidden by Layers: lights" with Show. A note in the sheet, not a banner: the card has no banners. A floor change
  or any chip click drops the kept thing, so it never lingers as an exception nobody asked for.
- **The chips fold under a Layers button**, in one row with "Turn off on this floor…" and "All floors". Eleven chips
  are three lines in a 260 px sheet; always open, the taller sheet covered plan points the popup and wheel tests use,
  which a viewer would hit too. Folded, the button still counts what is hidden ("Layers · 2 hidden"; the Studio's
  `layersSummary` sentence is its title, too long for one line beside All floors). The fold is not
  remembered: a sheet starts folded. This supersedes part 1's place for "Turn off on this floor…" (under the scope
  toggle): it now starts the tools row, so the Overview is one row shorter than in part 1.
- **Chips are in the Overview only.** A picked room's section is about that room; the chips return with the Overview.
- **The parity row `#tabLayers` is now "yes"**, checked by the Layers button on the 2.5D demo card.

## 2026-10-09: the card's search, "Turn off on this floor…" and "Lights off" (S24.8, part 1)

- **The chord is taken under the view keys' gate**: the card focused, else hovered, as the arrows are. The card's key
  listener has been on `window` with that gate since S11.3, because in Home Assistant a hovered card has no focus and a
  listener on the host would never hear the key. Finding 6 is about the editor; here one card of several acts, never two.
  `/` in any text field is a slash (`takesTyping`). No sheet (kiosk, `active_list: false`) leaves the key to the page.
- **The chord goes back to the Overview**: a picked room or floor is cleared, a popup closes, a folded sheet opens and the
  search takes focus. Opening the fold this way counts as the person's choice, as a tap on the fold button does; otherwise
  a phone's width default folds it again on the next render.
- **The index is built once per layout**, with whether states are known and the floors on offer as the rest of the key, so
  `<fp-search>` sees the same array between keystrokes and state updates.
- **Devices on every floor are searchable; floors and rooms only where the card can show them.** A pinned card opens another
  floor's popup, as a row tap does (S24.7), but cannot show another floor or its room.
- **Enter on a device or piece is a row tap** (`_locate`), with the popup beside the sheet. **On a floor**, the floor is
  shown and focus stays in the box. **On a room**, its floor is shown and the room's section opens, highlighted, with no pan;
  focus goes to the section's close button, since the box goes with the Overview. Escape then returns to the Overview.
- **A popup opened from the sheet stands beside the sheet's edge**, not the row's: 8 px past the row's edge still overlapped
  the sheet's padding and border by a pixel. Rows move 9 px right with it.
- **"Turn off on this floor…" acts on the floor on show.** It sits under the scope toggle in the Overview and beside
  "Lights off" in the floor's panel, not in a room's. Disabled, with the title "Nothing is on on this floor", when the list
  would be empty.
- **On means not off, standby, unavailable or unknown.** A paused speaker and an idle TV are listed: they have something to
  turn off. A plug counts by its switch, not its watts. Heaters, covers, vacuums and climate are not offered: none is "off"
  in one safe tap (`FLOOR_OFF_GROUP`, a decision per type, finding 17).
- **A lamp's row turns off its light and its bound relay when on** (`lampOffEntities`, S22.1), and reads "with" the relay.
  A relay that is also a switch row is sent once. Unticking the switch row does not keep a ticked lamp's relay on.
- **The rows are a snapshot taken at open**, so a row does not vanish under the finger. The calls are one `turn_off` per
  domain: `light`, `switch`, `media_player`, anything else `homeassistant`.
- **"All off" in a room or floor panel reads "Lights off".** It always turned off lights and their relays only. The
  aria-label already said "Turn off all lights in …" and is unchanged.
- **"The preset All off leaves Scenes where the room button exists", read plainly: it leaves.** Scenes shows only in a
  room's panel, and that panel has the Lights off button whenever a lamp of the room is on, relays included. Dropping the
  preset only while the button shows would make it appear and vanish with state. "All on" stays. A custom scene a person
  named "All off" is theirs and stays.
- **Layer chips are not in this part.** A marked empty slot (`.fp-ov-layers`, `data-slot="layers"`) waits beside the scope
  toggle and hides while empty.

## 2026-10-09: Studio Layers replace Filter (S24.6)

- **A view keeps the hidden families, not the shown ones.** Empty is the default, so a family added later starts
  visible and an old remembered view needs nothing.
- **Families are the card's categories plus Furniture** (`src/core/layers.ts`), so the Studio and the card (S24.8) group
  alike. An unlinked appliance follows its type: hiding lights hides an unlinked lamp too. Every furniture piece, a
  linked tv or speaker piece included, is Furniture: it draws as furniture.
- **The selection is always drawn**, a device by `selection`, a piece or unlinked appliance by the new `keep`. Hiding the
  family of what is selected lets the selection go: an invisible handle helps nobody.
- **Alt-click on the family that is already the only one shown shows all again**, so one gesture undoes itself.
- **Summary wording**: one hidden names it, all but one says "only X shown", all says "all hidden", else "N of 11".
- **The note is a toolbar button, not a banner.** It stays while anything is hidden and opens the tab. Banners are for
  events: a pick or a placement under a hidden layer, each with Show, which shows only the families concerned.
- **Fit ignores Layers**, as Filter did. A view setting must not move the frame.
- **The room's right-click uses Place's filter** (`areaMenuEntities`), not `areaToPlace`: `addFromArea` takes an HA
  entity, and a catalogued one is refused there.
- **A repeated area name gets the HA floor name, else the id.** Names are trimmed and compared without case.
- **The eye paths live in the editor**, not in core's `UI_ICONS`, which the card bundle carries whole.
- **The card's view-parity row is `#tabLayers`, "no" for now**, with why: the card's chips are S24.8.
## 2026-10-09: the S7.15 swipe flake was a fling in the test (S24.F1)

- **Cause.** The test drove its swipes through CDP without timestamps, so Chromium stamped each touch with its
  dispatch time and turned the lift into a fling whose speed was whatever the load made it. The page kept scrolling
  for up to a second after `touchEnd`. The test reset the page with `scrollTo(0, 0)` while the fling still ran; its
  tail, or Playwright scrolling Zoom in back into view, left `scrollY` at 1 or 2 before the second swipe began. A probe
  logging every scroll event caught 7 failures in 400 runs under load, all already off 0 before the second
  touchstart; `touch-action` read `none` at every one. The card never let the page move. The probe also showed a
  fling backwards to 0, which the old `scrollY > 50` poll passed mid-swipe and never saw.
- **Superseded: S8.2's two-frame wait.** It assumed `fp-zoomed` reached the compositor a frame late. It was the same
  fling. Removed; 400 runs with no frame wait never scrolled during the second swipe.
- **Fix, in the test only.** The swipe carries its own clock (16 ms a step) and rests 100 ms before it lifts, so it
  has no speed and no fling; the test waits for `scrollend` and asserts `scrollY` is 0 before the second swipe.
  200 of 200 at load 22 to 27, where the old test failed 1 in 80 at load 7. With `fp-zoomed` set to `pan-y` the test
  still fails (`scrollY` 240). `toucher` takes an optional `timestamp`.
- **Lesson.** A synthetic touch gesture stamped by dispatch time has load-dependent speed. Give it a clock and wait
  for `scrollend`, not for a scroll position. Log every scroll event before blaming the product.

## 2026-10-08: Studio search and Outline (S24.5)

- **"Centres at no less than 1:1" means never zoomed out further than fit.** The plan has no fixed px-per-cm; fit is the
  only scale a person knows. A pick keeps the zoom when it is closer than fit, else zooms in to fit, and centres.
- **An unplaced entity opens Add > Device listing only it, its row focused**, rather than placing it at once. Placing
  is an edit and lands where the viewport is; one Enter more keeps that edit a choice.
- **After a pick, focus goes back to the editor host**, so Delete, the arrows and the next `/` act at once. Add device…
  keeps its own focus.
- **Six commands only**: Fix or Unfix plan, Draw room, Add device…, Zoom to fit, Undo, Save. Each calls the code its menu
  calls. More can follow when a menu item is asked for twice.
- **The tree is flat rows** with `aria-level`, `aria-setsize` and `aria-posinset`, not nested groups, so only open
  branches render and the 437 devices of the stress house cost nothing while their rooms are shut. Roving tabindex.
- **The floor on show starts open**; the rest are shut. A pick opens the branches above it and scrolls its row into the
  tree's own view (not the page's), without taking focus.
- **The ring is in `renderFloor`** (`locate`), one draw path, so the card can use it (S24.7). Three pulses, then gone
  after 2.4 s; under reduced motion a still ring. Its own `@media` block: the existing reduced-motion rule is pinned.
- **The column takes canvas width.** Four editor tests that measure in screen px (snap radius, icon overlap, the HA
  popover over a plan point) shut it first (`shutSide` in `editor.spec.ts`), and wait for the editor to measure again.

## 2026-10-08: the card's Overview sheet (S24.7)

- **Active leaves out what Attention lists.** A triggered alarm or an open garage would otherwise be two rows. The Active count and chips count the rest.
- **The alerts chip counts Attention rows; a floor tab counts things** (S24.3's `floors.count`). A lock that is unlocked and low on battery is two rows, one thing on the tab.
- **Alerts come first in the chips** ("2 alerts · 6 lights"), against the wireframe's order. Folded, the header is one line that ends in an ellipsis; what is wrong must survive the cut.
- **Folded, the header is one line and the crumb hides.** Two lines covered a device and a door at 375 px that a person could tap before S24.7 (`card-room-select`, `label-tag-tap`).
- **The panel stays `min(200px, 45%)` wide.** A wider panel (250 px) hid plan icons that existing tests tap at 375 px. Rows wrap their name and room instead; the age never breaks.
- **The category labels stay** ("Lights", "Security"), not the wireframe's "Lights on": the folds and their stored ids are S14.6's.
- **The pulse is card chrome**, a `.fp-pulse` ring placed over the icon after each render, not a `renderFloor` option. Nothing on the plan changes, so the studio needs no twin (finding 8 holds: the plan is still drawn by one path).
- **3D: a row tap switches floor and opens the popup, no pan, no ring.** The 3D camera has no "centre on a point" yet; the ring looks for the 2D svg and hides without it.
- **A card pinned to one floor with "All floors" on** opens another floor's popup and does not switch, since it cannot show that floor.
- **A linked piece's row locates it, then opens more-info**, as its tap on the plan does.
- **`zoom: false` keeps the zoom on show**; otherwise the locate zooms to 2× or closer, never out.
- **Unavailable is folded by default** (`a:unavailable:open` in the fold set, the "opened" pattern of Scenes).
- **The scope toggle shows only when the card can show more than one floor**, and `all` is kept in `fp-active-panel:` beside the position.
- **The search slot is an empty `div` that hides itself** (`:empty`), so S24.8 adds the box without moving the rest.
- **A phone's popup may cover the thing it located.** On a 390 x 410 card the popup beside the row overlaps the centred lamp; the ring shows once the popup closes. Left for review; a bottom sheet is the likely fix.

## 2026-10-08: the search box's keys and focus (S24.2)

- **`isSearchChord` lives in `view-keys.ts`**, beside `isSaveChord` and `takesTyping`, and `search-box.ts` re-exports it. A host can test the chord without loading the element, and "/" in a text field uses the same `takesTyping` rule as the view keys.
- **"/" is allowed with Shift.** On an Italian or German keyboard "/" is Shift-7. Alt and Ctrl or Cmd with "/" are not the chord. Cmd-K and Ctrl-K are, without Alt or Shift, also from a text field.
- **Escape on an empty box closes it: focus goes back to where it was when the host called `focus()`, and `fp-close` fires.** So the host's chord works again at once, and a host that shows the box as a popover can hide it. Both Escapes stop there; the host's own Escape (deselect, cancel a tool) does not also run.
- **A pick clears the query and keeps focus in the box**, ready for the next search; the host moves focus if it wants to.
- **Hover is a light tint, the active option is inverted** (`--fp-ink` on `--fp-bg`, as in `<fp-combo>`). Two inverted rows, one under the mouse and one under the keyboard, read as two choices.
- **The Playwright harness is served by the test dev server through Vite's `/@fs/` path** (`tests/card/search-harness.html`), so the element is compiled from this tree with no extra build entry.

## 2026-10-08: one search index, ranked in tiers (S24.1)

`src/core/search.ts` builds the entries once and ranks a query by tier, not by a score.
- **Ties go to the shorter name, then layout order.** The plan named one "guest bedroom bedside lamp"; the stress house has two (left, right) and a bedside plug, all on the same tier for "bedside guest". The shorter name first puts the left lamp on top, and a room ("Guest bedroom") before the devices named after it.
- **An exact entity id is tier 0**, beside an exact name: pasting an id must land on its device.
- **The last tier searches name, entity, room, floor and type together**, so "second light bedside" works. Words split on anything that is not a letter or digit in any script.
- **Rooms of every kind with a name are entries**, zones too: a zone is a named place a person looks for. Their type label is "Room".
- **A linked piece (tv, speaker, computer) is a device entry**, flagged `piece`, its index into `furniture`; the same rule as the Active list.
- **A person has no room**: its drawn spot comes from sensors, not its stored point (as in the room summary).
- `room-info.ts`'s private `centre` is now exported as `deviceCentre`, so search finds a device's room with the same point and `roomAt` as the room summary.
## 2026-10-08: the shipped code loses its comments and its whitespace (S24.4, S23.F5)

Sprint 24 adds a search box and an Overview sheet to the card, and the card was 109229 gzip against its 115000 limit. The
limit stays. What still shipped: Vite's lib mode minifies names and syntax but, for the `es` format, never whitespace,
because that would drop the `/* @__PURE__ */` marks a library's users tree-shake with. Without whitespace minification
esbuild keeps every JSDoc and `//` comment, and every indent.
- **The fix is at the build.** `scripts/minify-output.mjs`, last in the card and panel builds, runs esbuild's whitespace
  minify over each finished chunk (`generateBundle`, after Vite's own minify, which would print the code out again).
  Our files are the end of the line, not a library anyone bundles again, so the pure marks have no use. Licence comments
  (`@license`, `/*!`) stay where they are. Template contents are not touched; the stylesheet comments go earlier, as before.
- **Whitespace too, not comments only.** esbuild has no "comments only" switch, and dropping comments while keeping
  indents means a second parser of our own. Whitespace is also the bigger share.
- **Measured** (`gzip -9`, as the size test): card 109229 to 84469, panel 157897 to 130719, 3D chunk 195527 to 145058.
  The comments in the source stay, where they are read.
- Supersedes the "Not done" line of 2026-10-08 "stylesheet comments do not ship".
- Test: `size-budget.spec.ts` parses each shipped file and fails on any comment that is not a licence, and on two known
  JSDoc sentences.

## 2026-10-08: every theme group sets its own outdoor ink (S24.4, S23.F3)

`--fp-text-out` was set by solarized alone and read with a fallback to `--fp-text`. A plan group of another theme inside a
solarized one inherited solarized's base2 for its outdoor names. The generic defaults, before the theme blocks, now set
`--fp-text-out:var(--fp-text)` on `:host,.fp,[data-theme]`, so each group resolves it from its own text; solarized's own
rule comes later and still wins on its group. Test: `labels-css.spec.ts`, every other theme nested in solarized reads as
it does alone.
## 2026-10-08: the 3D view keeps its shader programs across floors (S22.F1)

The "20 switches" test in `card-3d-floors.spec.ts` took 23 to 29 s alone and timed out under the full suite. A CPU profile put the time in native code, not JS: three.js destroys a shader program when the last material using it is disposed, and a floor switch disposed every material of the old floor before the new one was drawn. So every switch compiled its programs again, four of them, about 0.7 s a switch in the tests' software GL. Compile time is CPU time in software GL, so the test slows with machine load: the same code took 23 s and 29 s alone on 2026-10-08, against 12 s when first logged. Not bisected.
- **The fix is in the product.** `view3d.ts` `retire`: the first material to give up a program is kept, unused and out of the scene, until the view ends or its context is restored; any other is disposed as before. One material per program, no buffers and no maps. Geometries and textures still go at once, so the leak check reads the same counts.
- **Not chosen:** disposing the old materials one frame later. It saves a program the next floor uses, but a program one floor needs and the next does not (the textured top on ground and first, none on test) still dies in between: 35 compiles in 21 switches instead of 84. Sharing materials across floors would need every part to stop mutating its own colour.
- The test now also reads the live program ids (a test-hook read, `programs()`) and requires them unchanged after 21 switches. The test's own work is unchanged: 21 switches, the same memory, children and renderer checks. Alone it takes about 4.5 s.
## 2026-10-08: what needs attention, and open is not unlocked (S24.3, G1, G2, G3)

The review found one "Active" number holding ten idle cameras, an armed alarm with no state, and a door called open because its lock was unlocked. `src/core/attention.ts` now lists what is wrong, apart from what is on. Pure; the panel that shows it comes next.
- **Cameras leave the Active list.** `ACTIVE_LIST_RULE.camera` is `"never"`; the `"always"` rule is gone. Supersedes S9.5's "listed whatever its state". Tests that leaned on the Hall camera row now use other rows; the S9.5 camera row colour pair is replaced by a test that no camera state makes a row. `COLOR_VAR.camera` stays.
- **Open and Unlocked are separate facts.** `doorStateOf` adds `contact` and `unlocked`; `open` stays their union and still drives the plan's red (2026-09-28 holds). `RoomSummary.openings` holds contact-open doors only; `unlocked` and `hasLocks` are new. "Unlocked" shows only where a door in scope has a lock, so a room without locks does not read "Unlocked: none".
- **Kinds and order:** triggered alarm, armed alarm, open, unlocked, leak, smoke, low battery, unavailable. Pending (the entry delay) counts as armed, not triggered.
- **Unavailable means `unavailable`.** `unknown` and a missing state are not counted: HA reports `unknown` for sensors that have simply not reported since a restart, and counting them would bury the list.
- **A floor's count is things, not items** (coordinator): a device, piece or door with at least one item counts once, so an unlocked lock with a low battery is one on its tab while the list shows both. It leaves unavailable out, which has its own number; it includes an armed alarm. `alarm` is true only for a triggered one.
- **Water and smoke** are `other` devices, since HA has no type for them: a `binary_sensor` that is on, by device class. `moisture` is a leak; `smoke`, `carbon_monoxide` and `gas` are smoke.
- **Low battery is a device's own battery** (coordinator's call). The `battery` type is a home storage battery, with inverter and UPS; its charge under 20 % is not an alert, so it enters Attention only when unavailable. Low means a placed device whose `battery_level` attribute is a number under 20, or an `other` device with `device_class: battery` whose state is a number under 20. Anything else, missing or not a number, is not low. A door's own locks and contact sensors are read too, the most common real case, one item per entity; an entity that is also an icon is reported by the icon only. A lock can be unlocked and low at once: two items.
- **A cover is open** only as the plan says (`coverActive`: garage, gate, door). A door's own garage opener counts as open; a window's curtain does not.
- **Not in Attention:** a sounding siren, a vibration sensor, a vacuum in error. Not asked for; each is a one-line change in `ATTENTION_RULE`.
- **Each thing is reported once.** An entity placed as its own icon is reported by the icon, not again by its door. A door's room is the first room in layout order on whose edge it sits.

## 2026-10-08: the faint dash is a zone's only (Opus review of Sprint 23, S4)

S23.7 said "a zone is a 1 px dash at 35 % with no halo", but the rule sat on `.e.nw`, which every `boundary` edge carries. An open plan's line between two real rooms went faint too. A zone's edges now carry `zn` as well, and the S23.7 style is `.e.nw.zn` and `.eh.nw.zn`. A boundary between rooms, on a free wall or on the outline goes back to what it drew before: a 1.5 cm dash 8 6 over a 3.5 cm halo.
- Tests changed on purpose: the zone class strings in `tests/core/render.test.ts` and `plan-symbols.test.ts` (` zn` added), S8.9's boundary thickness back to 1.5, S1.35b's edge regex, and the render snapshot (only ` zn` added). `plan-symbols-css.spec.ts` reads both a zone and a room boundary.

## 2026-10-08: HA dark 2.5D walls are dark slabs (Opus review of Sprint 23, S2)

In Home Assistant's dark mode `--fp-wall` is HA's primary text colour, a light grey, so a wall's side face, 55 % of it into the card background, was a light grey slab. S23.6 made the rooms dark and showed it. `--fp-wall-side` now takes `--fp-wall-side-share` of the wall: 55 % on every theme, 30 % on HA dark. The share is a variable of its own, so the generic rule, which comes after THEME_EXTRAS at the same specificity, cannot beat it; every theme sets 55 % so a theme group inside an HA dark host does not inherit 30 %. Every other theme's side is unchanged (a computed-style pair checks each). 3D walls still mix 55 % (`three/palette.ts`); not changed here.

## 2026-10-08: stylesheet comments do not ship (Opus review of Sprint 23, M2)

The card was 117123 gzip against its 115000 budget. The limit stays. Vite's lib mode does not minify template contents, so every `/* */` inside a `css` block and inside `FLOORPLAN_CSS` shipped. `scripts/strip-css-comments.mjs`, a Vite plugin on the card, panel and editor builds, removes them before esbuild: the card is 107924 gzip.
- **What it touches.** A template tagged `css`, or one assigned to a const whose name ends in `CSS`. The source is parsed with TypeScript, so no other template, string or regex is read. Inside a stylesheet a comment is a `/*` outside a quoted string, a `url()` and a `${}`; a comment that spans a `${}` goes with it. An unclosed comment fails the build, naming the file.
- **The comments stay in the source**, where they are read. Nothing else changes in the output.
- **Not done:** the JSDoc comments of the code still ship (about 16 KB gzip more). Lib mode keeps them; removing them is a separate change.
- Tests: `tests/card/strip-css-comments.test.ts` (strings, `url()`, substitutions, other templates, the real `render.ts`) and a check in `size-budget.spec.ts` that the built card holds the rules and not the comments.

## 2026-10-08: every name clears 4.5:1, midnight and solarized too (S23 review S6)

S23.6 left six pairs as `test.fixme`: water in midnight and Home Assistant dark (which falls back to midnight), and solarized's garden, terrace, pavement and water. They are real tests now; there is no exception list.
- **Midnight takes its outdoor and fill colours from its own ramp.** Water was light's #a9cfe3 (a light name on it, 1.2:1); it is #1f4a78, a deeper blue that still reads as water. The stair fill was light's #c4c0b8, a pale block on navy, by the same copy; it is #1a2a46 with a #3a5684 hatch.
- **Midnight's glass and window are #5fa8e8.** Light's #2c7fb8 was 2.8:1 on the dark window pane, under the 3:1 a line needs (WCAG 1.4.11). The TV keeps #2c7fb8 (S9.3). Light (2.4:1) and solarized (2.8:1) are under 3:1 too; not changed here, the test lists them.
- **A theme may give outdoor names their own ink, `--fp-text-out`.** `.lbl[data-rl].out` mixes it, falling back to `--fp-text`, so no other theme changes. Solarized sets base2 #eee8d5: base1 is near 3.2:1 on its outdoor shades, and darkening those shades enough would make them the room's colour.
- **Solarized water is #15608c**, Solarized blue 55 % over base03. On the full blue no Solarized text colour reaches 4.5:1. Windows keep the full blue.

## 2026-10-08: labels keep inside the card at 375 px (S23 review S3)

At 375 px "Garden" ran under the button stack and the stress layout put names below the view box. Placement knew the plan, not the frame it is shown in.
- **`bounds` in `RenderOpts`.** A rect in plan units. Every name, tag and leader box must lie inside it, inset k/2 so rounding cannot push an edge out. The editor and the 3D overlay pass none. (Corrected by the re-check: the bare-ground step below is not gated on bounds, so the editor moves too, e.g. demo Garden and Pavement at scale 0.25 leave their leaders. That is wanted; one draw path.)
- **The card passes the fit box minus the stack.** `_measurePx` reads `.fp-stack`. A column at the right covers a strip of the plan; its width in plan units, plus 4 px of air, comes off the right. A stack laid out as a row sits above the plan and costs nothing. The card re-renders only when the strip moves by more than 0.5 % of the fit width.
- **An outdoor name may use bare ground.** A garden, terrace, pavement or water too small for its name first tries the space beside or above or below it that no other room covers, close enough to still overlap its width or height, before a leader. Demo ground at 375 px went from 4 leaders to 2.
- **A leader is pulled into bounds**, its foot clamped to a spot still in the room.
- **The disc floor stays at 28 px.** The leaders left at 375 px come from areas too small for an 11 px name (the reading-corner zone, the garden, the pond), not from crowded discs. Lowering discs to 24 px would split `k` between text and discs and shrink values and extras with them, for no label gained.

## 2026-10-08: a window fills its cut (S23 review S1)

The wall is cut `wallWidthAt + OPENING_EXTRA` wide, but a room polygon stops at the wall's centre line. On an outer wall the outer half of a window's gap showed the board, and three bare hairlines read as a hole.
- **A pane over the whole cut.** `.win-pane`, opaque, `color-mix(--fp-window 22%, --fp-room-empty)`; red-tinted the same way while open or alarmed. Drawn under the door line and the hairlines, `data-dp`, no clicks. A window and a slit both get it: the cut does not narrow for a slit.
- **Jambs.** A hairline across each end of the cut (`.win-jamb`, `data-dj`), window colour, red with the state like the symbol.
- **2D only.** In 2.5D the raised wall carries the glass on its face and hides the floor-level cut; a floor pane there read as a box in front of the wall.
- **Doors stay a gap.** A door or glass door in an outer wall shows the board in the outer half of its gap. That is a doorway to the outside and reads as one, so it is left as is.

## 2026-10-08: names stay in their room (S23.3)

The old search tried rows above and below the centroid and took a free spot in the next room before a covered one in its own. The 2.5D Hall name landed in the Cloakroom; names sat under discs. Now a name is placed only where its whole box (padded 2k, eight points) is in its room and in no smaller named room.
- **Candidates.** The centroid, or the pole of inaccessibility (a 16 by 16 grid, computed only when the centroid is not clear), then offsets of up to 144 left and right and 64 up and down, nearest first, horizontal moves cheaper than vertical. Sizes step down by 0.85 to 7k (6k for a zone; the S23.2 floor still holds) before the name leaves its room.
- **A tag when every spot is covered.** The largest spot in the room that touches no other text gets the name on an `--fp-outline` plate, drawn after the icons. A tag may cover icons, never text. The leader stays only for a room too small for its name at the floor size.
- **2.5D stem feet are obstacles**, a 4k disc where the stem meets the floor.
- **Smallest room first**, so a small room is not crowded out by a big neighbour's name. Zones after rooms.
- **The baseline stays at the anchor**, not the box centre, to keep every other label where it was. Pavement shrinks a step at scale 0.5 for it.
- Tests changed on purpose: S1.42 (a name now slides sideways, not to a row), the S7.1 break-it test (a covered Store gets a tag), the zone size test, the card's lamp-pin test (the name keeps off the pin; a tap on it picks the room), the editor's rotation test (a tag may sit over icons). `rows()` stays for extras.

## 2026-10-08: an 11 px floor on the card (S23.2)

`renderFloor` takes `px`, screen px per plan unit. With it, `k` is never under `NAME_MIN_PX / (12 * px)` (11 px for a 12k name), and a name shrunk to fit its room is never under `NAME_MIN_PX / px`. One `k` for text and discs, so the plan keeps its proportions and a 32k disc lands at 29 px or more. Without `px` (the editor, the 3D overlay) nothing changes, byte for byte. The floor lives in `renderFloor`, so the editor could use it the day it wants to (finding 8).
- **The card measures at fit, not at the view on show.** `px` is the svg's box over the fit view box. Like S9.2's icon scale it follows the card's size, never its zoom: zooming in only enlarges, a pinned card draws icons at the same scale as the whole-floor card, and a pinch costs no second render. Zooming out past fit can still draw under 11 px; that is the user's choice.
- **When the card renders twice.** After a render and on a resize the card measures, and re-renders only when the floor changes `k` or binds a shrunk name now or did before. The first card at 1000 px kept a name at 8.5 px because only `k` was compared; the wide-card test caught it.
- Not done here: placing labels in CSS px outright (sprint 25).

## 2026-10-08: one label style (S23.1)

Supersedes the 0.12.16 "small and half transparent" names. A name is never faded. `--fp-label` is `color-mix(in srgb, var(--fp-text) 92%, var(--fp-under))`, where `renderFloor` sets `--fp-under` on each name to what it sits on: the room's own `#rrggbb` paint, else its kind's token (`SURFACE` in render.ts; a zone takes the room under it). 92% is the least text that clears 4.5:1 on every theme surface that S23.6 does not change; 85% failed light's garden and terminal's pavement. Room names 12k, outdoor and zone names 10k, weight 500, outdoor in italic. `--fp-font` is Home Assistant's body font (`--ha-font-family-body`, then the older paper variable), else system-ui; it is used for names, values and the card chrome, not for the studio or the config editor. Values use tabular figures and U+202F before the unit (`meanReading`, a sensor's value, the live overlay); the popup's own state line keeps its plain space.
- **Contrast pairs that wait for S23.6, marked `test.fixme` (labels-css.spec.ts), never a lower bar.** The `#d6d6d2` empty room on blueprint, midnight, terminal, solarized, coffee and HA dark (light text on light grey, 1.1 to 1.8:1). Midnight's and HA dark's fixed light outdoor hexes. Solarized's outdoor hexes (`#586e75`, `#657b83`, `#268bd2`): no colour of its palette clears 4.5:1 on them, so they need a theme decision, not only the ramp.
- The 3D overlay's room names take weight 500 and the font, to match.
- The mix applies to room and zone names only (`.lbl[data-rl]`). Device and extra names sit on a disc or anywhere, so they keep `--fp-text`.

## 2026-10-08: plan symbols (S23.7)

Details of V19 and V20.

- A door or glass door is a gap in the wall, a 1 px leaf from the hinge `a`, `|ab|` long and square to the wall, and a
  90° arc back to `b`. The leaf swings to the room side: probe half a leaf out on each side; an indoor room (`room`)
  wins, then any room, then the smaller one; with no room on either side it goes left of `a`→`b`.
- A window is three hairlines along the opening, at the wall's two faces and its middle. A slit spans its narrower
  band (`SLIT_BAND`).
- Doors, glass doors, windows and slits now cut the wall (the opening mask). Sealed doors do not, and draw no symbol.
- A closed, unselected door's own line paints nothing (`.door.quiet`). Open, alarm and cover-open keep the red line and
  turn the symbol red; selection keeps the line. The hit line and `data-d` are unchanged; the symbol carries `data-ds`
  and takes no clicks.
- `--fp-glass` is the window blue. Per theme: light and midnight #2c7fb8 (was #1b9e77), solarized #268bd2 (was
  #2aa198), the generated themes already used fg for both. Doors stay `--fp-door`.
- Garden, terrace, pavement and water draw no boundary outline. The editor keeps its faint `e none` guide. A real wall
  kind on an outdoor room (a fence) still draws.
- A zone is a 1 px dash (4 3), non-scaling, at 35 % opacity, with no halo.
- 2.5D draws the same symbols on the floor. 3D openings stay for sprint 28.

Tests changed on purpose: `tests/core/open-door.test.ts` (quiet class; doors are cut, sealed not),
`tests/core/render.test.ts` (zone 1 px; mask count includes doors; no-mask cases drop the doors; edge count leaves out
outdoor boundaries), `tests/core/slit.test.ts` and `tests/core/solids-openings.test.ts` (quiet class), the render
snapshot, and `tests/card/card.spec.ts` S8.11 (card2 drops the window too, since a window now makes a mask).

## 2026-10-08: every surface follows the theme (S23.6)

Details of the V16 and V23 decisions below. The values, per theme:

| Theme | Empty room | Furniture | Garden / terrace / pavement |
|---|---|---|---|
| blueprint | #132237 | #3975cf | ramp |
| terminal | #1d2d28 | #63a68f | ramp |
| coffee | #30231a | #b17a57 | ramp |
| a-team | #282222 | #8e7a7a | ramp |
| space | #141b36 | #3a58ce | ramp |
| cyberpunk | #280842 | #8e1ced | ramp |
| carpenter-brut | #391115 | #da2e40 | ramp |
| midnight | #14213a (`var(--fp-room)`) | #3f66b0 | #1d2a42 / #21304c / #233352 |
| ha, dark | `var(--fp-room)`, HA's secondary background | #3f66b0 | as midnight |
| solarized | #06323d | #586e75 | #11424f / #124c5b / #135161 |
| light, ha light | #d6d6d2 | #79766e | unchanged |
| slate | #d6d6d2 | #7b7b69 | ramp |
| beach-house | #d6d6d2 | #b28a32 | ramp |

- **Empty room.** `rolesToTokens` gives a dark theme its room shade (ramp .08), the colour 3D already paints floors with. The four hand-set `roomEmpty` values went; the option stays. Solarized is #06323d, not base02 #073642: a name (`--fp-text` 92 % into the room, the S23.1 label) measured 4.33:1 on base02 and 4.57:1 here, and the room still stands 1.09:1 off the board.
- **Furniture.** A ramp shade at .62, a step past the wall edge (.55): at .55 beach-house's sand measured 1.77:1 on the grey room, under the 1.8 the test asks. The body is still 45 % of that into the empty room.
- **Paint.** `--fp-paint-dim` is `brightness(.62) saturate(.85)` on a dark theme and `none` on a light one, applied as a filter to a room or stair with its own `fill`. The colour itself is never changed. The on ring (`fill="none"`) is left alone. Not in 3D yet.
- **Checker.** #cfccc4 on #8a877f, about 2:1 (was #eeece5 on #2a2b2d, about 12:1).
- **Not changed.** Midnight water (#a9cfe3) and fill (#c4c0b8) stay light; the brief named garden, terrace and pavement only.

Tests changed on purpose: theme-roles.test.ts ("room-empty is the one fixed grey"); editor.spec.ts, the blueprint room in the theme table and the furniture-token pair (midnight is no longer #79766e); card-3d-tex-glow.spec.ts, the checkerboard's luma spread (238 over 42 is now 204 over 135) and its square counter, which now reads the 10th to 90th percentile so a lamp on the line no longer sets the band.

## 2026-10-08: light is light (S23.8, V13, V14)

Supersedes the flat 25 % aura (`--fp-alpha`, S2.8) and, on light themes, the lamp-coloured 3D wall glow.
- **2D falloff.** Each aura circle takes `mask="url(#fp-lamp-falloff)"`, one shared mask written once before the first aura: a radial gradient, alpha 1 at the lamp, .33 at 60 %, 0 at the reach, in `objectBoundingBox` units so it fits every circle. `mask-type:alpha` is set in CSS (`mask.fp-falloff`), not as an attribute (finding 18). The ids avoid the word "glow", which tests use to find the room glow class.
- **Clip.** Unchanged: the aura keeps the room clip it already had (S21.1). The new pixel test proves it holds.
- **Strength.** `fill-opacity` is `.55` times the lamp's brightness. The mask thins it, so the core is brighter than the old flat .25 and the edge is gone.
- **Blend.** `mix-blend-mode: var(--fp-glow-blend)`. `themeExtras` writes `screen` for a dark theme and `multiply` for a light one, so a new theme gets the right blend with no new token. HA's own theme follows its mode.
- **3D.** view3d reads `--fp-glow-blend` off its probe; `multiply` means a light theme. There `glowTint` paints the walls `#ffd9a0` warm white, capped at .35, whatever the boost (night is 3.5x). A dark theme keeps the lamp's own colour, uncapped.
Tests changed on purpose (finding 19): the aura markup regexes in render.test.ts and room-at.test.ts (the mask attribute), the `.aura` rule string, and the editor's aura pair, which pinned `0.25` and now pins `0.55` and `screen`. New: tests/card/light-glow.spec.ts (pixel probes just outside the wall, the same distance inside, near and far; the blend per theme against the background's luminance), a 3D wall-colour test in card-3d-tex-glow.spec.ts, and `glowTint` units.

## 2026-10-08: unavailable is its own mark (S23.5, V12)

Supersedes "Unavailable lights and switches read as off" (2026-10-06) and the 45 % opacity of S2.6. "Off" and "I don't know" are different facts; drawing a dead lamp as off told the user it was off.
- `classOf` returns `unavailable` for every type whose state is `unavailable` or `unknown`. A bound light is unavailable only when every state it has is dead: a relay that says off still says the lamp is off, and one that says on lights it. No state at all is still off.
- The mark: no disc (the halo stays painted at 0 so it takes the click), a dashed `--fp-warn` ring, the glyph at `--fp-idle` .7, and `<g class="gone-mark">`, a circle in `--fp-bg` and a slash in `--fp-warn` at the disc's top right, with no pointer events. A circle and a line, not a path, so no glyph rule paints it. The group is no longer at 45 %.
- `g.dev.unavailable path` (0,2,2) outranks the per-type tints; weakened to `.dev.unavailable path`, the Playwright pair fails on the motion glyph.
- In 3D the ball of an unavailable device is idle like an off one; its HTML icon carries the ring and badge.
Tests changed on purpose (finding 19): the dead light, plug and bound-light classes in render.test.ts, card.test.ts, live.test.ts and plug-power.test.ts; three editor Playwright pairs that pinned the 45 % ghost; one comment in card-3d-live.spec.ts.

## 2026-10-08: off is quiet, on is solid (S23.4, V9 first rule, V10, V11)

Supersedes "an off icon's disc is 50 % in every theme" (2026-09-23) and the 60 % disc of an on motion or contact sensor (S8.13).
- **Off and idle.** No disc: the halo is still painted at fill-opacity 0 so it takes the click, with no ring. The glyph is `--fp-idle` at .7.
- **On.** The disc is `--fp-dev` (or the lamp's rgb, the plug's heat, a layout colour) at full opacity. The glyph is `--fp-dev-ink`. Per theme, `themeExtras` (src/core/ink.ts) writes an `-ink` for every `--fp-dev-*`, idle and danger: the theme's own dark ink, else its light ink, if it reaches 4.5:1, else pure black or white (one always clears 4.58:1). A colour only the state knows gets black or white at render time, as `var(--fp-pure-black|white)` so the markup carries no hex. The heat ramp's ink is picked from the same oklch mix the stylesheet does.
- **Brightness** moved from the glyph to the glow: the aura's alpha is scaled by the lamp's brightness (`--fp-dev-opacity`). A dim lamp keeps a solid disc.
- **Motion and contact** on: the solid disc plus an outline ring (`--fp-outline`, 2 px) and the ping, so a trigger still stands out from a lit lamp.
- **Blueprint idle** is `color-mix(ink 55 %, bg)`, #888f99, saturation under .15 (it was #2b5697, about .5). Tokens that equalled the old idle (camera, garden tints) follow it.
- The on glyph rule is `g.dev.on path` (0,2,2) so it beats `.dev.dev-motion path` and the outdoor and camera tints; the camera cone (0,3,1) keeps its own fill.
- 3D: a ball takes the disc's colour when the disc shows, else the glyph's.
Tests changed on purpose (finding 19): 21 Playwright tests read the on colour off the glyph or pinned the 50 % disc, the 60 % motion disc, a 25 % lamp halo or blueprint's old idle. They now read the disc, the ink, 0 and #888f99. Unit: the aura, halo and on rules in render.test.ts, the colour-and-ink style strings in render.test.ts and card-colors.test.ts, and the plug's heat style.

## 2026-10-08: the popup is placed inside what the user sees (S22.2)

`placeNear` (popup-ui.ts) clamps to the host's box cut to the visual viewport (`window.visualViewport`, else the window), not to the host alone. Below the point first, above it when there is no room below, then clamped into that box. Its height is capped to the box less 16 px (the CSS cap the popup had for a host in full view), so in a very short window the sliders scroll and the button stays on screen. A host with less than 40 px showing falls back to its own box, the old rule. Not chosen: `position: fixed` (it would escape the card's stacking and need its own z-index and theme scope). The popup is placed when it opens and on each render, not on a page scroll.

## 2026-10-08: how a relay-lit lamp is turned off (S22.1)

Details of the change the entry below records. One rule, `lampOffEntities` (room-info.ts): a lamp's light entity when it is `on`, then its `bound` relay when that is `on`. The popup's Turn off (`lampOffCalls`) and the room and floor All off (`RoomSummary.offEntities`, which replaces `lightsOnEntities`) both send it through `presetCalls`, so a `switch.*` relay gets `switch.turn_off` and any other domain `homeassistant.turn_off`. A relay several lamps share is in the list once.
- **No confirm.** A switch's Turn off normally asks first. Here the relay is the lamp, so it acts at once, as a light's and as All off do.
- **State line.** Only when the relay is on and the light entity is not, the popup and the tooltip read "on · via <relay friendly name or entity id>". With the light on, its own line stays (brightness). With the relay on and the light unavailable, the button is still Turn off.
- **More info.** A new `moreInfoEntities` adds `bound` after `entitiesOfDevice`, so the chooser lists the light, then the relay. `entitiesOfDevice` is unchanged: it also says which entities a room owns, and a relay elsewhere is not that room's.
- Turn on is as before: `light.turn_on` on the light. A room panel row still shows the light entity's own state; not changed here.
Tests changed on purpose: three S20.1/S20.2 Playwright tests (card-floor-select.spec.ts) and one unit test (room-info.test.ts) that pinned "a relay-lit lamp is not a target"; the Active row test in card-room-select.spec.ts, whose More info now opens the chooser for the demo's bound Living light.

## 2026-10-08: the 2026-10-08 review becomes sprints 22 to 30, and three earlier decisions change

Diego said yes to the review's plan (docs/PLAN.md, "Roadmap after the 2026-10-08 review"). He did not answer the open questions, so the defaults the review proposed stand:
- **Relay-lit lamps (C1, sprint 22).** Supersedes "a lamp lit only by its relay is not a target" (2026-10-07, All off). A lamp drawn on must be one the card can turn off. All off and the lamp's popup call `switch.turn_off` on a bound relay that is on. The relay joins the More info chooser. The stress run left 6 of 25 lamps on after All off, with no way to turn them off.
- **Dark-theme empty rooms (V16, sprint 23).** Supersedes the 2026-09-21 choice of `#d6d6d2` for every theme. Each dark theme takes its empty-room colour from its own ramp. Blueprint room names measured 1.15:1 on it.
- **Furniture colour (V23, sprint 23).** Supersedes the 2026-09-23 flat grey. Furniture takes its colour from the theme ramp.
- **Name.** Two other repos are called Floorplan Studio. We keep the name.
- **Digital Twin app.** A separate repo in `~/Documents/XCode/FloorPlanTwin`. A spike only, after sprint 24.

## 2026-10-08: the cone's room is the one it looks into (S21.1, supersedes the room rule of the entry below)

Opus review: the entry below took the room holding the camera's own point (`roomAt(floorAt)`). A camera is mounted on a wall, which is the room's edge, and `inside` counts the north and west edge in and the south and east edge out. So a camera on a wall aiming out lost its cone or kept it by which wall it hung on, and one on a wall two rooms share took whichever room `inside` favoured, not the one it faced.
Rule now: probe a point 15 cm ahead of the camera, `floorAt + 15 * [sin(rot), -cos(rot)]` (rot 0 looks up, 90 looks right; the plan's turn is outside the group and does not enter). `roomAt(probe)` is the holder: aiming into a room clips to it, aiming out finds no room and keeps the free cone, and on a shared wall the room faced wins. The clip polygon and its transform are unchanged. Tests: a 300 x 300 room, a camera on each of four walls aiming out (no clip) and in (clipped); a shared wall both ways; the transform round trip also with the plan turned 90 degrees. The demo snapshot did not change.
Remaining edge: a camera within 15 cm of a wall it faces probes past that wall, so it loses its cone or clips to the next room. A camera sits on its wall or well clear of the one it faces, so this is rare; not handled. A zone, a structure and a fill still do not count as rooms.

## 2026-10-08: the camera cone is clipped to its room, and four sensor types stop toggling (S21.1, S21.2)

**Cone clip.** Supersedes "the camera cone is not clipped (not asked)" (2026-10-04, the aura entry). Nothing in the docs says what a clip should be, so I took the simplest meaningful rule, the one the lamp already has: the cone is clipped to the polygon of the smallest real room holding the camera (`roomAt`; a zone, a structure and a fill are not rooms). No room, no clip. No margin: the cone's tip sits on the camera, and the wall is drawn over the edge. Not chosen: the floor's viewBox (the cone never reached beyond it, the box widens for it), and a clip to the camera's side of a wall (needs wall geometry nobody asked for).
Mechanism: an inline `<clipPath>` before the device group, in the same svg, named by a `clip-path` attribute on the cone path. An attribute, not a CSS `url()`: it resolves in the shadow root of the card and the editor, which share `renderFloor` (finding 8), and no stylesheet rule sets `clip-path`, so none can outrank it (finding 18; a unit test pins that). A clip applies in the referencing element's frame, and the cone lives in the device group's (translate, scale, turn about the icon). So the clipPath carries `transform="rotate(-rot 12 12) scale(1/k) translate(...)"`, the inverse of the group's, and its polygon stays in plan coordinates. In 2.5D the translate includes the icon's lift, as the aura's clip does. The id is `fp-cone-` and a hash of polygon and transform: equal ids mean equal definitions, so two cards (two shadow roots) or two cameras in one room cannot collide. A camera on the outer wall aiming out of its room shows no cone; the cone is not painted past the room at all. Known edge, accepted.
Tests changed on purpose: the two `renderFloor` snapshots (the demo Hall camera gains a clipPath and an attribute); the cone regex in "camera cone (S1.31)" accepts the optional `clip-path` attribute, as the aura tests already do; "leaves the aura unclipped" asserted no `<clipPath` at all and now names `fp-aura-`, since the demo camera has one.

**Sensors.** `humidity`, `motion`, `contact` and `vibration` join `NO_TOGGLE`, as `temp` did (S19.E4): the popup button follows the entity's domain, so one on a switchable entity offered "Turn off". A new test iterates `DEVICE_TYPES`: each is in `NO_TOGGLE` or in a written list of toggling types with a reason. Lights, switches, plugs, climate types, tv, computer, lock, cover, siren (toggle) and the rest keep their behaviour; alarm stays no-toggle.

## 2026-10-07: All off in the panel, and a floor pill that selects its floor (S20.1, S20.2)

Diego asked for both in the card; the editor is not touched.

**All off.** A button in the room panel, under the facts. It is hidden when no light of the room is on (a disabled button would sit there saying nothing; the "Lights on" line already says "none"). Press: `presetCalls("off", lightsOnEntities)`, the builder the Scenes section's All off already uses, so the routing by domain is one piece of code. In practice it is one `light.turn_off` with the entity ids. `lightsOnEntities` comes from the same loop as `lightsOn` and is a subset of it. A target is a light whose own entity is `on` (Opus review, changed from the first version). The plan's rule is wider: a light bound to a relay is drawn on while either is on, and "Lights on" still names such a lamp. But `light.turn_off` on a light entity that is already off does nothing, so a lamp lit only by its relay is not a target, and does not show the button by itself; the call never names the relay (the card toggles light entities). The spec test that pinned the first behaviour was rewritten on purpose. Two buttons say "All off" in a room panel (this one and the Scenes preset, which stays): this one has the accessible name "Turn off all lights in <room or floor>" and keeps the visible text. No confirm (lights only, as the preset). No `callService` (read-only HA) means no call and no error.

**Floor select.** One subject for the panel: `_pickedRoom` or `_pickedFloor`, never both; a room pick clears the floor, a floor pick clears the room, every clear path (`_pickRoom(null)`, Escape, empty plan, x) clears both. The pill still switches floor; if the floor is already shown it only selects. The selected floor's pill, pressed again, lets go. `aria-pressed` still means "this floor is shown"; the selection is `aria-expanded` (the pill opens the panel) and the class `fp-floor-picked`, a 2 px ring in `--fp-primary` with a gap in `--fp-bg`, so it reads next to the fill of the shown pill. A double tap on the plan restores the floor pick as well as the room's. The selection is card state: a `hass` update keeps it, a floor switch by any other means drops it. `setConfig` now clears the room pick too; it did not before (a new config with the same floor kept the old room).

**What the floor summary counts.** `floorSummary` and `roomSummary` are one function (`summarise`) over a set of rooms and a membership test. Floor: every room's temperature, humidity and motion lists (each entity once), every door on any room's edge (each once), every device with an entity and every linked piece on the floor, also one that stands in no room (it is on the floor, and All off must reach it). A person never has a row, as in a room. Name is the floor title (the key if empty). Area is left out: rooms, zones and structures overlap, so a sum would lie. The Scenes section is not shown for a floor (scenes belong to rooms). Side effect: a room that lists one sensor twice now lists it once.

With `active_list: false` there is no panel, so a pill only switches floor and selects nothing (a room tap does nothing there either). Kiosk has no pills, so nothing changes there. README does not list card interactions; not touched.

## 2026-10-07: SPEC and README bring in siren, alarm, linked pieces and the type menu (S19.D)

Supersedes the spec text on `device.type`, `furniture.symbol`, the colour table and the editor's type picker. The spec is fixed, so this is a change record, not an edit in secret. Nothing new was decided: each addition restates an entry below (S18.11, S18.12, S18.14, S18.15). Added: `speaker`, `siren`, `alarm` in the `device.type` list (speaker was missing); `speaker` in `furniture.symbol`; a linked-piece paragraph; table rows for siren, alarm and a linked piece; the grouped type menu. No schema change, no behaviour change.

## 2026-10-07: rooms nest by overlap, not by corners (S19.A)

Supersedes the 30 cm corner rule of the entry "a shed over the border still nests". Diego's garden house floor was not reproduced on the demo, nor confirmed on his layout. Instead of a bigger tolerance, a variant sweep: a shed 40 and 60 cm over the corner, half over the border, turned, bigger than the garden, across the notch of an L garden, two rooms crossing like a plus, two copies of one outline. All eight left both fills at one height. Rule: rooms are taken biggest first (equal areas by array order); a room sits one step above the highest bigger drawn room it overlaps (a vertex deeper than 1 cm inside the other, a middle inside, or two edges crossing), and at 0 if it overlaps none. Zones, structures and unnamed fills are not drawn in 3D and are not candidates. Rooms that only share a border stay level. The first version counted every bigger room it overlapped; Opus review showed that is not transitive (a shed on a terrace on a garden, clear of the garden, got the terrace's height and z-fought it; a zone under a room lifted it for nothing). Cost: the same bound as before (`NEST_WORK`). Every pair is a bounding-box test first, and only boxes that meet get the exact test. Measured on 300 rooms of 10 points: about 10 ms on main (count of overlaps, no box test), about 51 ms with the exact test on every pair, and 10 to 12 ms now (10 ms for a grid of separate rooms, 12 ms for 300 concentric ones). Side effect: a neighbour drawn a few cm into another is lifted 1 cm; not visible.

## 2026-10-07: the padded grab box is for a tv, speaker or computer, and the edge reach goes first (S18.10, review)

Opus review: the S18.10 box took too much. Two changes, same pointer path.
- Only a tv, speaker or computer is padded (`PADDED` in `ops.ts`). A toilet, sink or shower under 28 px at fit zoom took a click meant for its room; those have no thin shape the hand misses.
- The edge reach (8 px, `edgeNear`) now runs before the pad when the real element is the background, a room or stairs. A thin tv lying flush on a wall no longer swallows the wall's edge within its box. A handle, device, door or wall element really under the pointer still wins, as before.
- `addHaEntity` asks `placedEntities` (devices and linked pieces) instead of devices alone, so an entity a piece already tracks is not placed a second time, even when the catalog does not list it.

## 2026-10-07: a linked piece carries device behaviour in the card (S18.15)

Opus review of S18.8 to S18.14: a tv, speaker or computer piece with an entity did nothing in the card, and "every editor feature is in the card" did not hold. Diego's design: a linked piece behaves like a device there. One path, not copies:
- `pieceDevice(m)` (`solids.ts`, next to `furnitureLinked`, which now calls it) builds the device a linked piece stands for: same type, entity, name, place. Never stored, so the layout file is unchanged. `pieceOn` (`render.ts`) is the one on rule: a linked piece follows `classOf` of that device (a paused or idle tv reads on, a speaker only while playing, unavailable never); any other piece keeps `entityOn` (on, open, playing). A plug's switch keeps the plug's rule. The plan, the Active list, room rows and 3D all call it. Side effect, wanted: a speaker piece whose entity is `on` but not `playing` is no longer lit; it was before, and the speaker device never was.
- Active list, room rows (`roomSummary`, flagged `piece`, index in `furniture`) and scene targets take the piece as a device of its type; an entity already listed by a device, or by an earlier piece, is not listed again.
- Tap and hold are the entity's more-info, no popup: `bindDeviceActions` takes `g[data-f][data-linked]` (selector `THINGS`, shared with hover and the outside-press test) and `getPiece`. Not `NO_TOGGLE`: that set is by device type, tv and computer are not in it, and a piece must never toggle by a tap whatever its entity. Its Active row and its room row do the same. An unlinked piece still picks the room. Hover shows the device's name and state line (`_targetOf("f", i)`).
- 3D: the scene marks a linked piece (`ref.entity`, role `furniture-linked`), `liveOf` gives `pieces[i].on` from `pieceOn`, the view draws it as a mesh of its own (the merged furniture mesh skips it) in `furniture-linked` (the tv blue mixed 70% into the furniture colour) at rest and `piece-on` (`--fp-active`, as the plan's on colour) when on, and the picker returns `{ type: "piece" }`, which the card hands to the gesture code. No screen or driver glow on a piece, only the colour.

## 2026-10-07: siren and alarm are device types, and the type menu has a popular block (S18.14)

Diego: allow "alarm" and "siren" in a device's type; the most popular on top, a separator, the rest A to Z.

**Menu.** One helper, `typeMenu` / `typeOptions` (`panels.ts`), builds every device type select: the device panel's `#vtype`, the Add > Device panel's type filter and the Add > Unlinked device list. Popular, in this order: light, switch, motion, contact (labelled "Window / door sensor"), temp (Temperature), speaker, tv. These are Diego's proposal from the open question; nobody countered it. Then one `<hr>`, then every other type A to Z by the label shown (localeCompare, English). `<hr>` is not an option: it has no index, cannot be picked and is not reached by `selectOption` or the arrow keys; Lit renders it inside `<select>` and Chromium shows a rule. No separator when a block is empty (a filtered list). A digit sorts before a letter, so "3D printer" opens the second block; the label is Diego's and I left it. The unlinked list keeps its curated subset (`UNLINKED_TYPES`) and gains no siren or alarm: an unlinked one has no state to show.

**Types.** Both are real `DeviceType` members, appended to `DEVICE_TYPES` (the order the Active list groups by). The other design, mapping the menu entry onto an existing type, would have made "alarm" and "other" indistinguishable and left the entity picker with no rule. Every per-type table now decides them (finding 17), and the tests that pin those tables got a siren and an alarm row, nothing else changed in them:
- `typeForEntity`: `siren.*` is siren, `alarm_control_panel.*` is alarm (both were `other`; no test pinned that). `TYPE_RULES` offers each its own domain; both are placeable from an area.
- Icons: MDI `alarm-light` for the siren, `shield-home` (what HA shows) for the alarm, inlined (finding 9). Category: security. Heights: siren 205 cm mount, 230 cm unlinked top; alarm 120 (keypad). No 2.5D solid.
- State: a siren is on while its entity is on (the default rule). An alarm is on in every state but `disarmed` (armed_*, arming, pending, triggered); `unavailable` stays unavailable. Both wear `--fp-danger`, the red every theme already has, so no new token and no theme-roles change. The Active list shows both when on and uses the same token.
- Tap: a siren is not in `NO_TOGGLE`, so its popup offers on/off (the `siren` domain was already switchable). An alarm is in `NO_TOGGLE`: it opens more-info. Room-panel row tap stays more-info for both; that table's pin is four toggling types.
- Rings: `isSiren` is unchanged, it still keys on the `siren.*` entity. A siren-typed device on a plain entity is red when on and draws no rings. Making the type draw them would have put `siren` in `FX_TYPES` and changed the size control for a case nobody asked for.

Seen in `npm run shots`: siren with rings, a siren on a switch entity, an alarm armed (red) and disarmed (grey), in blueprint, light and Home Assistant dark.

## 2026-10-07: a linked tv, speaker or computer wears its own idle colour (S18.12)

"Connected" means the piece has an `entity`: it tracks that device. `furnitureLinked` (`solids.ts`, one function for the 2D and 2.5D draw paths) adds `data-linked` to a tv, speaker or computer piece with an entity (an attribute, not a class: the class list is pinned by S18.9 tests). `.furn[data-linked]` sets `color: var(--fp-dev-tv)`, before `.furn.on`, so the on colour (S18.9) still wins; the filled body follows `currentColor`. One token for the three symbols, not a new variable: it is the blue every theme already gives the tv, and the shots in light, Home Assistant dark and blueprint show it apart from the plain grey. Not by state (a player that is off or unavailable is still linked). Other symbols with an entity (a patio gate) are not linked: their entity drives on/off only. Shots now draw six such pieces in the Kitchen.

## 2026-10-07: a tv, speaker or computer is added as furniture (S18.11)

The rule is small. An HA entity is placed as a piece when it is a `media_player` whose `device_class` is `tv` or `speaker` (`furnitureForEntity`). A plain media player stays a `media` icon. HA has no computer class, so no entity is guessed as a computer: a catalog entry typed `tv`, `speaker` or `computer` is placed as a piece (`furnitureForType`), which is how a computer the user typed gets there. The piece has the symbol's default size, the entity and the name, sits where a device would (the area's room centre, else the viewport), is selected and is one undo step, with a catalog entry of the same id so a deleted piece can be placed again. `placedEntities` now counts a furniture piece's entity, or the placed piece would be offered again at once; as a side effect an entity already used by a furniture piece in an old layout is no longer offered as a device (the layout file is unchanged). Not changed: the batch place of a room's area (`placeArea`) still makes icons, and `typeForEntity` still says `media` (the list groups it under Media).

## 2026-10-07: small furniture is grabbed from a padded box (S18.10)

A tv is 10 cm deep: at the default zoom a few pixels, and the drawn shape took clicks only on that. `furnitureNear` (`ops.ts`) gives a piece under 28 screen px on a side a box 8 px bigger each way, at least 28 px across, turned with the piece. It is a fallback in code, as `edgeNear` is, not an invisible element: an overlay rect would sit above devices, doors and walls and take their clicks. It beats the room, the background and a bigger piece under it; any handle, device, door or wall really under the pointer still wins. Big pieces get no padding. Editor only; the card is not touched.

## 2026-10-07: 375 px bare-floor threshold 0.87 to 0.85

Filled furniture takes the pointer over its body (S18.8), so the kitchen table no longer counts as bare floor: room 1 measures 86.1 %. Diego's coordinator decided to lower `card-s14-review.spec.ts` from 0.87 to 0.85 at 375 px. Supersedes the "needs a decision" line of the entry below.

## 2026-10-07: furniture is filled, lit and loud (S18.8, S18.9, S18.13)

A body shape in a furniture symbol carries class `ff`; `.furn .ff` fills it with 45% of the piece's `currentColor` in `--fp-room-empty` (the plain room most furniture stands on; `--fp-room` is dark in the dark themes and gave dark blobs on a light room, seen in the shots). On, `currentColor` is `--fp-active`, as before, so body and edge go amber. Filled furniture takes clicks over its whole body, where the outline took them only on its stroke; that is the point of S18.10. A tv or speaker piece whose entity is `playing` (exactly, as a speaker device) gets two `.wave` circles in `.furn-waves`, a sibling of the scaled symbol group (a non-uniform scale would squash them) and, in 2.5D, inside the piece's group at the lid; one helper, `furnitureWaves`, serves both paths. Waves take `--fp-active`, not the device's blue, so the piece reads one colour. Radius a quarter of the longer side, at least 15 cm. The computer symbol is a desk, monitor, keyboard and case, default 120 x 60 cm (was 60 x 40); stored sizes are untouched. Side effect: `card-s14-review.spec.ts` "room 1 keeps at least 87 %" now measures 86.1 % (557 of 647), because the kitchen table covers floor that used to count as bare; main measures above 87 %. Test left as is; needs a decision.

## 2026-10-07: a shed over the border still nests (3D)

Supersedes the 1 cm edge tolerance of 2026-10-06. A room nests above a bigger one when its middle is inside it and every corner is inside or within 30 cm of its edge. The middle test keeps a narrow room beside the garden from nesting. Diego's garden house floor was missing in 3D; not checked against his layout, the cause is inferred from the screenshot.

## 2026-10-07: scenes are not the plan

Fix plan compares the floor with devices and objects taken out; a room's `scenes` and `haScenes` sat inside that, so a fixed plan refused Save and the designer closed as if it had saved. `EditorState.plan` now leaves both out. `saveSceneDraft` keeps the designer open with a message when a save is refused. Found by Diego: the scene was made with Fix plan on.

## 2026-10-07: Sprint 18a, scene designer fixes

Popups centre on the viewport (`panelPos` takes the panel's largest height): the old top came from the toolbar's rectangle, which is off-screen once the page scrolls. Try keeps a per-popup `sceneOrigin`, the first-seen state of each device, across Restore; before, Restore cleared the backup and the next Try could record a stale `on` as the original (the likely cause of an off light coming back white; not reproduced on a real HA). Covers of doors and windows join `roomSceneTargets` (a curtain is a door field, not a device). Climate leaves the designer; the schema and `customCalls` still accept it, so old files run. Colours from a picture still capped at 6; the report of four was not reproduced and needs the picture.

## 2026-10-07: Try and Restore (S17.7)

`HaWriter.callService` is one service call; `tryScene` keeps each entity's first-seen state as a scene item (`itemFromState`) and sends `customCalls`, `restoreScene` sends the kept items. A second Try keeps the first backup. Closing the popup without Save restores; Save does not (the devices are as the saved scene says). Try asks no confirmation, unlike a card tap that turns a fan off: it is a preview and Restore undoes it. Unknown or unavailable devices are tried but cannot be restored, and the popup says so.

## 2026-10-07: Picture colours (S17.6)

`dominantColours` (`image-colours.ts`) is a pure k-means over RGBA bytes: seeds are one pixel from a fixed LCG, then the farthest pixel from the seeds so far; 12 passes; at most 4096 sampled pixels; transparent pixels skipped; result by cluster size then hex. `readImageColours` draws the file to a canvas of at most 64 px and calls it. Choosing a picture fills the palette; Apply is still the separate press the spec asks for.

## 2026-10-07: Palette apply (S17.5)

`spreadColours(palette, n)` in `scene-colour.ts`: invalid and repeated colours dropped, the brightest six kept and ordered by luminance (so pick order does not matter), light j gets colour j mod n. Supersedes the spec line "brightest to the largest area": a light has no area on the plan, so lights take colours in the order the room lists them. Round-robin, so neighbours differ.

## 2026-10-07: Scenes list replaces the inline editor (S17.4)

The room panel lists HA scenes (marked, not editable) then custom ones with Edit and Delete; Delete asks nothing because Undo restores it. Supersedes the inline per-light editor and the one-click Add scene of S14.7. The writers `addScene`, `renameScene`, `addSceneItem`, `removeSceneItem` and `setSceneItem` are no longer used by the panel; they stay, with their tests, until a later clean-up.

## 2026-10-07: Scene designer popup (S17.3)

The popup edits a draft held by the editor host; `saveScene` (room-scenes-ops) is the only writer and runs inside one `commit`, so Save is one undo step and Cancel none. A refused Save (no name, no device, duplicate name) keeps the popup open with the reason. A light holds a colour or a kelvin, never both: setting one clears the other. The old inline scene editor stays until S17.4 replaces it with the list.

## 2026-10-07: Scene item types (S17.2)

`SCENE_DOMAINS` and `SCENE_FIELDS` in `schema.ts` are the one list of types and what each may set. `customCalls` turns an item into calls: cover off is `close_cover` (no confirm), climate is mode then temperature, media_player is on, volume (0-1), source. Unknown types are ignored by the card and refused by `validate`. `addScene` still seeds lights and switches only.

## 2026-10-07: Editor room panel sections fold (S17.1)

Each section header is a controlled `<summary>`: the click flips `EditorState.folded` and re-renders, no native toggle event (a render between click and event reopened it). Stored in localStorage `floorplan-studio:folds`, per browser, never in the layout.

## 2026-10-07: Furniture bottom (`z`), TV and speaker at 100 cm

`Furniture.z` is the bottom of a piece, `height` stays its own size, top = z + height. Defaults in `FURNITURE_Z`: tv 100, speaker 100, others 0. A new `speaker` symbol (25 x 25). The TV furniture is not snapped to a wall: Diego places it, `z` lifts it. Attaching a device is the existing furniture `entity` ("shows the state of"). Supersedes the TV standing on the floor at 60 cm top. The unlinked TV and speaker keep scale and height, and the panel now shows H x W x L.

## 2026-10-07: Room panel order, folded Scenes, media players open more-info

Scenes folds by default (the fold set holds `r:scenes:open` for "opened", the reverse of the other groups). "Active in this room" moved into the room section between Scenes and Devices. A tap on any device whose entity is a `media_player.*` opens its more-info, as a speaker or TV placed as an appliance already did; the popup stays for a TV on a switch. Why (Diego): the player's own panel is better than a one-button popup.

## 2026-10-07: Arrows pan both ways, + - zoom, [ ] rotate

Diego, after 0.17.0. All four arrows pan (`PAN_STEP` 0.1 of the view width or height). `+`/`=` zoom in, `-`/`_` zoom out, `[` and `]` turn the plan by `ROTATION_STEP`. Supersedes "Up and Down zoom" (0.12.x) and the Left/Right-only pan of the entry below. Space still resets. Same map in card and editor (`view-keys.ts`); `[` `]` need the rotate buttons in the card, as the buttons do. Why: zoom and rotate get keys that say what they do, and the arrows stay for moving.

## 2026-10-07: Arrows pan, banners replace the status line, the plan opens fixed

Diego asked for six things; three are done here. **Left and Right pan** (`PAN_STEP` 0.1 of the view width) in card and editor; they supersede "Left and Right turn the plan" (2026-09, 0.12.x). Rotation stays on the buttons. Why: turning on a key press was an accident waiting for anyone who scrolled sideways. **Banners:** `editor/banner.ts` classifies a message (info, warning, error) from its text; the editor shows it at the top for `BANNER_MS` (20 s) with a close button; "Ready" shows nothing. The old toolbar span is gone, the banner keeps the id `status` so the tests read it. The classification is a guess from words; a caller that knows passes the level (`planFixed` does). **Fix plan** now starts ticked when a plan with something drawn is loaded into a blank editor (the host's `layout`, and Open file). Furniture stays part of the plan (it is locked); devices, objects and lights stay editable. Open file ignores the lock: it is an explicit replace of everything.

## 2026-10-07: New things land in the middle of the selected room

Diego: with a room, zone or area selected, a new furniture, object, device, door, zone or stairs is placed in the middle of it. `roomMiddle` (src/editor/ops.ts) gives the middle on the grid, a point inside even for an L-shaped room; furniture and objects are nudged 40 cm right when a point already stands there, so they never stack. With no room selected the old spots stay: furniture, stairs and zones outside the house at the top right, devices and doors at the view centre. Walls and structures keep theirs. His "lost tree" was this: furniture spawned outside the house, off screen. The tree is drawn above room textures in 2D (tested).

## 2026-10-06: Sprint 16 planned: car, camera thumbnail, vacuum path

Diego asked for a car with attached sensors and devices, shown at home or away by its position; a floating camera thumbnail in every view with size and position set in the View menu; and vacuum paths for Roborock, Dreame and Roomba. Planned as S16.1 to S16.5 in `docs/PLAN.md`. The vacuum path is research first: the "Later" note says no common integration exposes coordinates, so S16.5 is built only if S16.4 finds data. Away is drawn as a person's is (35 %, away mark), never by moving the car with GPS.

## 2026-10-06: Unavailable lights and switches read as off; a shed on the garden's edge keeps its floor in 3D

Diego: unavailable lights and switches show them off. `classOf` returns `off`, not `unavailable`, for a `light`, `switch` or `plug` whose state is `unavailable` or `unknown` (a bound light too), so the plan, 3D and the Active list draw no 45 % ghost. Other types keep the `unavailable` class. Supersedes S2.6 for those three types. Diego: in 3D the garden shed's floor was invisible. A room is nested above a bigger one only if all its corners are inside it, and a corner on the bigger room's edge counted as outside, so the shed stayed at the garden's height. A corner within 1 cm of an edge now counts as inside.

## 2026-10-06: Rotation slider; a speaker or TV object stands in for its media player

Diego: rotate furniture and objects with a slider, not only by fixed steps; a speaker object linked to a media player showing its waves and clickable instead of the player; the same for a TV. Decisions: (1) Furniture and unlinked objects get a 0-359 degree slider (`#frotsl`, `#uurotsl`) above the turn buttons, preview every tick, one undo step per drag (the texture slider's live/commit gesture, `rotateItem`). (2) The speaker and TV objects are the existing *unlinked* objects of type `speaker` and `tv`, not new furniture symbols: they already have the icons, the picking in 2D, 2.5D and 3D, and `attached`. Their linked player is the first attached `media_player.*` (`playerOf`); no schema change. (3) Playing shows the same two waves a speaker device draws and the type's active tint; paused, idle, off or unavailable show neither. (4) A tap or hold on such an object opens the player's own more-info, no popup; Diego chose this over play/pause because `media_player.toggle` is play/pause or power and guessing is worse (see `NO_TOGGLE`). With no player attached, or any other type, the popup is unchanged. (5) The attach picker for these two types lists media players first, including ones the plan has not met. Not done: the 3D view draws these objects without live state, so no waves there yet (a tap works).

## 2026-10-06: A door's Delete moves above its sensors

Diego, same rule as the room: the door and window panel's red Delete is now the first control after Identity, above Home Assistant. The "Danger" heading is gone. Test helpers `clickCm` and `dragCm` now scroll the plan into view first: a taller panel makes the page scroll when a panel control is clicked, which put plan coordinates off the viewport.

## 2026-10-06: Room sensors sit in framed boxes; every humidity sensor is filed by floor and room

Diego: group the dropdown and its list so it is clear where they are, smaller names, and humidity sensors "organized by floor and room same as the others". Each of the three kinds (temperature, humidity, motion) is now one `.sens-box` (thin frame, rounded, faint tint); names in it are 11 px. The cause of the humidity order: a sensor the plan had not met yet came from Home Assistant with no floor or room, so the picker put all of them under "Elsewhere". `EditorState.withPlanRoom` now gives such an entity the floor and room of the drawn room that has its HA area (first match, the rule `availableEntities` uses). No area, or an area with no drawn room, stays loose. Only the room sensor picker uses it.

## 2026-10-06: A room's Delete moves under its name

Supersedes the earlier "Delete stays next to Unsnap" exception. Diego: the red Delete in the room panel belongs before the sensors. It is now the first control after the name block, above Home Assistant, Sensors and Scenes; Unsnap stays with the rotation. The spec test now asserts order (Delete before `#rtemp` and `#runsnap`) and that it still deletes.

## 2026-10-06: Stale panel guard (0.16.3)

Twice a cached old panel after an update looked like a product crash ("layout was not used", a locked 3D drag). The panel now asks `floorplan_studio/version` (any user, `{ version }`) at load and on every `visibilitychange` to visible, compares it with `CARD_VERSION` (injected at build; a `dev` build never compares) and, on a mismatch, shows a Reload banner and refuses Save. A failed or odd reply says nothing, so the guard cannot break an older integration. It cannot help a page that was already open before this release.

## 2026-10-06: North in the layout, sun from its real direction, folding panel sections

Diego asked for the sun to come from the right angle, for the studio to show where north is, and for the right-hand panel sections to fold, closed at start. `north` already exists (schema, 0-359) but only "for the compass rose", which nothing draws. It is now defined as degrees clockwise from plan-up to true north, in layout coordinates before `rotate`; the sun's plan bearing is `azimuth + north`. The rose is drawn by `renderFloor` so studio and card cannot differ (finding 8). No schema change, no migration: layouts already carry `north: 0`. Panel folds are view state, like Fix plan: not in the layout, not an undo step. Planned as S15.3a-d and S15.7, plus patch 0.16.3 (stale panel guard) first.

## 2026-10-06: Motion fades 120 s after motion ends

Supersedes S2.4 ("fade counts from the last time the sensor was on") and the 300 s default. Diego: the garden stayed highlighted for hours; it should go 2 minutes after motion ends. Two causes found: the card remembered the sensor's *on* moment (`_lastOn`) and faded from there, so motion that lasted longer than the window had no fade after it ended; and the fade timer watched only motion devices, never a room's own `motion` list, so nothing redrew a garden's border when its window closed. Now the fade starts at the sensor's own `last_changed` while it is off (the moment motion ended), the timer covers devices and room lists of the shown floor and runs one tick past the window so the last render is clean, and `DEFAULT_MOTION_FADE_S = 120` is the one default (core, card form, studio). A sensor that stays `on` stays lit and runs no timer. `_lastOn` and `_recordLastOn` are gone from the card and the studio.

## 2026-10-06: 3D lamp budget 8 to 32

Supersedes the S13 budget of 8 (`MAX_POOLS`). Diego saw lit lights in the Kitchen and Office with no glow while the Living Room used all 8 pools. Asked to choose between one pool per lit room first and a higher cap, he chose the cap: 32. Slots are meshes hidden until used, so an idle slot costs nothing; weak devices can use 2D or 2.5D. A per-room guarantee is not built.

## 2026-10-06: Parapet wall kind and the Fix plan lock

- **`parapet`** is a sixth `WallKind`, appended last. 120 cm (`WALL_KIND_HEIGHT`), 20 cm thick (`WALL_THICKNESS`, drawn at the external width, same colour token as an external wall, so no new theme role). Not "balcony" or "half wall": a parapet is the word for exactly this. Layouts that use it do not open in 0.16.0 (the validator lists the kinds); no schema bump, as with `slit` and `open`.
- **Fix plan** lives in `EditorState` (`planLocked`), not in the layout and not an undo step, off on load: a lock that survives a reload would hide why a click does nothing. The gate is in the state, not in each control: `edit` refuses any change whose floor differs once `devices` is set aside; `replaceFloor` (live drags) keeps the plan and takes the devices; floor add, rename, move, delete, stairs on all floors, rotation and paint refuse; the editor refuses draw, Open and Reset, and a press on a plan item selects but starts no drag. A change that touches a device and the plan together is refused whole. Undo and Redo stay allowed. Chosen over disabling controls one by one, which misses the next control someone adds.

## 2026-10-06: Sprint 14 review: rows open the popup, a narrow room panel is a sheet, a popup is bound to its card

Supersedes the S14.2 row rule ("a type that never toggled goes straight to more-info") and the unbounded popup.
- **Room-panel rows are the plan icon's twin.** Every row carries `data-x`, so a tap opens the popup whatever the type (a heater, a TV,
  a lock: a button where the type has one, else name, state and More info); a hold opens more-info. `ROOM_ROW_TAP` stays as the old table
  but the card no longer reads it. Before, the plan icon and its row of one device did two different things.
- **Narrow room panel.** Under `ACTIVE_FOLD_BELOW_PX` (480 px, the card's own width, not the viewport's) an open room panel gets
  `max-height: 45%` (its body already scrolls) and, if never dragged, docks at the bottom when the picked room's centre is in the upper half.
  Measured at 375 px: 253x209 over a 359x259 plan, hiding 85 % of the picked room's bare floor; now 251x116, the room keeps at least
  60 % of it (the test holds that). Chosen over docking below the plan, which would grow the card and move the plan under the finger.
- **Popup height.** `max-height: calc(100% - 16px)` of the card; the sliders sit in their own scrolling block, so the primary button and
  More info are always on screen (374 px tall in a 259 px card before).
- **Kiosk.** The popup drops More info: a tap must not reach Home Assistant's dialog on a wall tablet.

## 2026-10-06: Active list and Room panel by collapsible category (S14.6, item 12)

Supersedes "grouped by type" (S9.5). **Categories** are a new pure module, `src/core/categories.ts`: `CATEGORY_OF` is a
`Record<DeviceType, CategoryId>`, so a new device type does not compile until it is placed, and a test iterates `DEVICE_TYPES`.
Ten fixed groups: lights, climate, security (camera, lock, motion, contact, vibration, radar), media, power (switch, plug, battery,
inverter, UPS), covers, computers and network, sensors (temp, humidity), people, other. Order is the list's order, not
`DEVICE_TYPES`'. Rows keep their input order inside a group.
**State.** Every group starts open (nothing in the request asked for a default fold; a phone already folds the whole Active list).
The fold is per card, in `localStorage` in try/catch, one key apart from the panel's position key (a bad entry in one costs not the
other), with separate ids for the Active list (`a:`) and the Room panel (`r:`): folding Lights in a room must not hide them in the
list below. **Studio parity:** none needed. The editor has no Active list and no Room panel (they are card chrome over live state);
the editor's own Add > Unlinked list keeps its type grouping. Stated exception, like item 16.
## 2026-10-06: S14.8, a plug is coloured by its draw (item 24)

- **One source, three views.** `deviceMarkup` writes `--fp-heat` (0..1, rounded to 0.01) on the plug's icon group when the plug is
  active and its power sensor reads; the 2D plan, the 2.5D plan and the 3D overlay all draw that same group, so one stylesheet rule
  (`.dev-plug.on[style*="--fp-heat"]`) colours all three. A plug has no 3D body, so there is nothing else to tint.
- **Opt-in in core, on in the card.** `RenderOpts.plugHeat` (a pair) turns it on; the card always passes it (default 0 and 2000 W),
  the editor passes nothing. With the option absent the markup is byte for byte as before (hashed over the demo, 2D and 2.5D,
  before and after: equal). A plug with no reading, or off, writes nothing and keeps `--fp-dev-plug`.
- **Fixed ramp, not the accent.** Blue, amber, red as three tokens (`--fp-heat-cool/-mid/-hot`) declared once, ahead of the themes.
  Reading `--fp-dev-plug` for the cool end failed in blueprint, where one-accent themes make the plug orange and the ramp
  vanished. A theme may override the tokens. `colors.plug` still colours a plug that has no reading.
- **Colour is not the only signal.** The tooltip and the popup already print the watts (S14.2's state text).
- **Config.** `plug_heat_from` and `plug_heat_to`, two numbers, from below to, else 0 and 2000 (`heatRange`). Two keys, not a
  list, so the visual editor has two plain fields.
- **Not done, stated.** Only plugs: the schema allows `power` on a plug only, and a switch has no sensor field. Widening that is
  a schema change for Diego to ask for.
## 2026-10-06: S14.4, the card remembers its view per floor, 2D and 3D

Spec item 8. Supersedes "one zoom, focus and turn per card" of the 0.12 view memory; everything else in that entry stands.

- **Where.** The card's existing `fp-view:` entry gains `floors`, a list of `[floor key, {zoom, focus, rotation, cam}]` (a list, so a floor called `__proto__` is a string, as in the editor's `zooms`). `view`, `tilt`, `walls`, `theme`, `labels`, `names` and the shown `floor` stay per card. Same key, so two cards still do not clash. No second key: one write, one read.
- **Turn per floor.** The spec says rotation is per floor. A floor stored without one starts at the config's `rotation`.
- **3D camera as relative numbers.** `cam` is azimuth, polar, distance as a multiple of the framing distance, and the look-at offset from the floor's centre in cm. Absolute numbers would be wrong after a resize, a panel inset or a floor of another size. `Orbit.restore` bounds each number the way a drag does.
- **What counts as touched.** The camera is stored only after the person moved it (`onCamera` from a drag, wheel or pinch). Not doing so would store the default camera for every floor visited and make Reset look like it did nothing. A floor with no stored camera keeps the old behaviour: the look carries over, the floor is framed.
- **Reset.** Reset view and Reset camera clear the shown floor's zoom, turn and camera, not another floor's. Reset view still clears the card-wide choices as before.
- **Blocked storage.** The map lives in memory too, so floors remember within the page; storage is the second copy.
- **Old entries.** A stored entry with top-level `zoom`, `focus`, `rotation` moves to the floor it names in `floor`; with no floor named it is dropped (whose view it was cannot be said). One lost zoom at worst.
- **Parity with the studio.** The editor already remembers a zoom per floor (`view-memory.ts`) and draws flat only, so it has no camera. Its one turn for all floors stays: the editor edits one layout across floors and a turn there is a viewpoint on the house, not on a floor. Not changed. If Diego wants a turn per floor in the editor too, it is a small change to `ViewMemory`.
- **Not done.** A turn in 3D is not remembered apart from the camera azimuth. The 3D "top view" and "frame a room" (S15.5) will store through the same `cam`.
## 2026-10-06: S14.7, room scenes: area first, an explicit list as the exception, lights-only presets without a confirm

Diego, Sprint 14 item 19 (Hue scenes included).

- **Which Home Assistant scene belongs to a room.** The room's area, as the spec says: a `scene.*` whose entity `area_id` (`hass.entities`),
  else whose device's `area_id` (`hass.devices`), is the room's `area`. Hue scenes sit on the Hue room's device, so they come by the
  second way with no setup. Nothing is stored for it: no schema change, and it follows the area in Home Assistant. For a scene with no
  area, or in another one, the room has an optional explicit `haScenes` list (entity ids, `scene.*` only, edited under *also offer*
  in the room panel). Alternative considered: an explicit list only. Rejected: every Hue room would need its scenes ticked by hand.
- **Custom scenes** are `room.scenes`, optional, no version bump: `{ id, name, items: [{ entity, on, brightness?, kelvin?, hs? }] }`,
  light or switch entities only, 12 scenes and 40 items at most. An older card never reads the field; `validate` checks every part
  and never throws (the same discipline as the sensor lists). They are applied with the existing services, one call per item.
- **All off needs no confirm.** The brief for this task asked for a confirm "consistent with S14.2". S14.2's rule (and the spec row for
  item 19) says a light is exempt, and All off is lights only, so it follows the rule: no confirm. The rule is kept where it bites: a
  custom scene that turns a *switch* off asks first (its button turns into "Confirm: name"). A Home Assistant scene is never confirmed:
  the card cannot know what it switches off, and Home Assistant owns it. If Diego wants All off to ask, it is one line.
- **Presets** act on the lights drawn in the room (`roomSummary`, the one rule for "a device of this room"), in one call each.
  A room with no lights shows neither.
- **The studio cannot capture live state.** The editor holds no entity states, so a new scene starts as every light and switch of the
  room, on, and the person edits it. Capturing from the lamps is a possible later addition.
- **Parity.** The editor lists and edits; the card shows and runs. A scene is not drawn on the plan, so there is nothing for the
  two views to disagree about.

## 2026-10-06: a slit window's head sits 40 cm under the ceiling, and is called "slit window" everywhere

Diego, Sprint 14 items 1 and 2. Supersedes the "head at the ceiling" rule of the 2026-10-05 slit entry below (the rest of that
entry stands: a kind, not a flag; read from the wall, never stored; no schema bump; the 2D band).

**Gap.** `SLIT_HEAD_GAP` in `heights.ts` is `DEFAULT_FLOOR_HEIGHT - (window.sill + window.height)` = 250 - 210 = 40, derived from
`DOOR_DEFAULTS.window` so the two cannot drift. A slit's head is `ceiling - 40`, its height stays 60, so its sill is
`ceiling - 100`: 150 and 210 on 250, 200 and 260 on 300. It is per wall (`doorCeiling`), as before. An own `height` keeps that
head, an own `sill` wins and the head follows it, clamped to the ceiling. On a wall too low for the gap the head is
`min(ceiling, max(ceiling - 40, height))`: a 40 cm wall gives glass from 0 to 40, a 100 cm wall from 0 to 60, a 120 cm wall from 20 to 80;
the sill is never negative and the head never over the wall. The 2.5D and 3D builders already took the span from `doorSpan`, so
they now leave 40 cm of wall over the glass with no change of their own.

**Existing layouts.** Nothing is stored for the defaults, so a slit with no own sill moves down 40 cm on update. Accepted: the
slit was one day old, and a slit with an own sill is untouched.

**The name.** Add, Openings and the wall menu already said "Slit window". The door type select listed the raw id `slit`; it now
shows "slit window" (value still `slit`; the other kinds keep their ids as labels).
## 2026-10-06: S14.2, a tap opens a popup; OFF asks; one state text

- **A tap never operates.** On an icon, a door, an unlinked appliance or an Active row, in 2D and 3D, a tap opens a popup. The
  popup's button does what the tap used to do. A hold still opens more-info. `bindDeviceActions` no longer calls a service at all;
  `toggleEntity` is gone.
- **`tap_action`.** It is not read anywhere in the card or the docs, so there was no config meaning to keep. None is added.
- **Explicit services.** The button calls `turn_on` or `turn_off` by the entity's state, not `domain.toggle`. A lock calls
  `lock.lock` or `lock.unlock` (the old `lock.toggle` does not exist in Home Assistant). A cover calls `open_cover` or
  `close_cover`; a cover door still goes through its confirm dialog.
- **Confirm before OFF** is an inline step in the popup (the button becomes Confirm turn off, with Cancel), for every type except a
  light. A light's OFF is immediate. ON is immediate. `tests/card/popup-rules.test.ts` iterates `DEVICE_TYPES` and records the answer
  per type, so a new type fails until someone decides.
- **No toggle stays no toggle.** Media, speaker and the other `NO_TOGGLE` types get a popup with name, state and More info only
  (`media_player.toggle` is ambiguous, S9.4). A vacuum tap still opens its own dialog.
- **A device with several entities.** The primary button acts on the device's own entity. More info opens the chooser.
- **Light controls.** Brightness only if `supported_color_modes` has a mode beyond `onoff` (or, with no modes listed, an own
  `brightness` attribute); temperature only with `color_temp` (kelvin range from the entity, else 2000-6500); hue only with a colour
  mode. `input` moves the shown number; `change` makes the one `light.turn_on`.
- **One state text** (`src/core/state-text.ts`): the plan's rule everywhere, the state plus its unit, raw. A room mean drops its
  trailing ".0" (48 %, not 48.0 %). A light on shows brightness as a percent, a cover its position, a plug its watts.
- **Hover** is mouse only. In 3D it uses the pick on pointermove, once per animation frame, with no per-move allocation.
  Anchor of the popup: the pointer, or the element's box for a keyboard or row activation.
## 2026-10-06: effect size is a per-device percent, read by CSS and by the 3D pool; a siren is an entity domain

S14.3, spec items 7 and 6. `Device.fx` is optional, a finite number in [25, 300] (percent of the type's own size, absent is 100).
No schema bump: it is optional, the card ignores what it does not know, and a file without it draws as before. `validate` refuses
a value outside the range; `migrate` drops it, as it does a bad height, so the file opens.
**2D.** The aura's radius is `LIGHT_REACH * fx / 100`, and `viewBoxFor` widens by it. The rings and waves are CSS animations that
scale about the icon, so the end size reads a custom property the icon group carries, `--fp-fx` (the fraction): the keyframes are
`scale(calc(1 + k * var(--fp-fx, 1)))` with k 1.2 for the ping and 1.4 for the wave, which is today's 2.2 and 2.4 at the default.
Scaling the end and not the start keeps every ring born at the disc; a small `fx` shortens the ring's reach, not its start. The
property is written only when `fx` is not 100 and the device draws an effect, so unused, the demo's markup hashes the same
before and after (sha256 524d66b3...a880 over every floor, bare and with live state, 2D and 2.5D, editor and card).
**3D.** `LiveLight` carries `scale` (absent at 100, so the JSON is unchanged), and the floor pool (`POOL_REACH` 220) and the wall
light (`GLOW_REACH` 300) reach that much further or shorter; a wall still cuts them. The icons are the 2D markup, so they scale too.
`fxScale` reaches the chunk through `liveDeps`, as the other helpers do: the chunk still imports nothing from core.
**Which types draw one.** `FX_TYPES` (light, speaker, media, motion, contact) plus any siren; a test iterates `DEVICE_TYPES` and
fails for a new type until it says whether it draws one. The editor shows the field exactly there. A stored `fx` on a type that
draws nothing is ignored, not cleared when the type changes.
**Sirens.** HA has a `siren` domain and the schema has no siren type, so a siren is a device whose entity starts with `siren.`,
whatever type it was given (an `other`, say). On, it draws two `.siren-ring` circles, like the waves but with an end scale of 4.8
(twice the speaker's 2.4), a 3.5 px line against 2, a 1 s beat against 1.6 s, and the danger colour (the group takes class `siren`,
which sets `--fp-dev` to `--fp-danger`, so the disc and glyph go red too). Reduced motion holds the rings at 3 times the icon
against 1.5 (twice), opacity .8 against .6. This is also spec item 6; S14.2 keeps the siren's tap and its confirm-OFF.
**The editor field** reuses the height field's behaviour (empty removes the key, junk is refused with the reason, a value out of
range is clamped and says so), now one `optionalField` behind both. The existing height messages are unchanged.
Tests: core (validate and migrate against hostile values, 2D scale at 50, 100, 150, 300 with asymmetric numbers, an iteration over
every type), a Chromium pair that reads `getComputedStyle` and the running animation's end frame, the 3D pool and glow reach on
the demo's living lamp, and the editor with a real mouse, run ten times.
## 2026-10-06: S14.5, the open doorway is a solid band, devices hang lower, low walls are 110 cm

Spec items 9, 10, 11. Supersedes the dashed, pulsing look of a tripped `open` door, and the line in 0.15 that 3D shows no
state for it.

- **Doorway band.** A tripped `open` door (contact open, unlocked, vibration, cover open) is a solid `--fp-open-door` band
  across the gap: no dash, no pulse, no door look. 2D: the door line gets class `band` (dash none, opacity 1) and the
  `door-alert` pulse line is not drawn for a doorway; `.door.door-open.band` has three classes so it beats `.door.open` and
  the selected-faint rule (computed-style pair in `open-door.spec.ts`). 2.5D: the red frame polygon is the same band
  (`.opn.band`, fill-opacity 1). 3D: a thin slab in the gap, tag `band`, 0.6 opacity, so the room behind still reads; it is
  visible only while the door is tripped (`applyDoors`, no rebuild). A plain door keeps its dashes and pulse.
- **Pickable when closed.** The slab is always in the scene and only toggled visible, so a tap there is a door tap even
  when nothing is drawn, as 2D's always-present `door-hit` is. Cheaper than rebuilding picks on every state change. The
  slab never blocks labels (`BLOCKS`).
- **Mount heights (`DEVICE_Z`).** Ceiling: light 215 (was 250), camera, motion, radar, access point 205 (was 230); wall-high:
  ac 195 (was 220), cover 175 (was 200); temp, humidity, climate 135 (was 150). A ceiling device hangs 35 cm under a 250
  wall, 45 for a wall unit; a thermostat sits at switch height. Everything else was not floating, from the demo renders, and
  is unchanged. Own `z` values stay. `ICON_MARGIN` 10 -> 25 so an icon on a lower ceiling still sits clear of the wall
  top. `tests/core/heights.test.ts` pins every `DEVICE_TYPES` member.
- **Wall height.** The spec said "low is about 60". It was 30. One constant, `CUT_WALL_HEIGHT`, now 110 for both low and the
  cutaway's lowered walls. Looked at in the demo renders in all three wall modes: 110 reads as a wall you see over, a door
  still shows its head, and lamps at 215 stay above it. 90 was not rendered; 110 was the spec's lean and looked right. 2D and 2.5D walls keep their own cutaway
  heights; only 3D changed.

## 2026-10-06: the size budget is raised for Sprints 14 and 15

Diego said yes to +20 KB on the card and +40 KB on the 3D chunk (card 95,076 -> 115,000 gz, chunk 193,707 -> 233,000 gz)
for the tap popup, effect sizes, scenes, view memory, and the light-through-windows and daylight maths. The limits in
`tests/card/size-budget.spec.ts` are `CARD_GROWTH_LIMIT` 24,220 over the 90,780 pre-3D card and `CHUNK_LIMIT` 233,000.
This supersedes the 5 KB / 200 KB figures of `docs/specs/real-3d.md` criterion 9. The scene builder stays injected, so
a user of the 2D card never pays for three.js.

## 2026-10-06: the wall glow is clipped to the lamp's room, face by face

Supersedes the "face looks into the lamp's room" test of the entry below. That test looked at one point, 2 cm in front of the
face's midpoint. An outer wall is one long face shared by several rooms (`collectWalls` merges only identical edges), so the
midpoint decided for the whole face: in a 1000 x 400 outline split at x=500, a lamp in the east room lit the outline from
x=407 to 793, 93 cm of it in the west room, and a lamp in the west room lit none of its own stretch. On the demo the
first-floor Bedroom lamp lit 31 vertices outside its room. Now `facing` cuts the face wherever the line 2 cm in front of it
crosses a room's edge, keeps the stretches whose middle is in the lamp's room, and `glowGrid` meshes each stretch (the 300 cm
reach and the drawn height are unchanged; the cost is one small grid per stretch, still bounded). The room of a point is
`roomOfPoint`'s (the highest room, then the smallest), so the inside face of a room nested in the lamp's room is not lit
through the inner room. Tests: the two-room outline both ways, a nested room, a face in a neighbour's room that faces the
lamp (fails without the room check), and a pixel-side check on the demo that no glow vertex lies more than 6 cm outside
the lamp's room.

Also: the 3D view no longer listens for `mousedown`. A cancelled `pointerdown` stops the compatibility mousedown in Chromium
(the pan test now records it and sees none), and the autoscroll starts from that mousedown, so the listener was unreachable.

## 2026-10-05: textures and wall light in 3D

**Textures.** A room's or stair's top face wears its `Paint.texture` in 3D, at the size, turn and scale 2D uses. The tile is
the same inline SVG, drawn through an `Image` onto a canvas (4 px per cm, longest side at most 512, least 32) and used as a
`CanvasTexture` with repeat wrapping, mipmaps and anisotropy 4; no network, no new dependency. The UVs are plan cm over the
tile's size times scale, turned by the texture's own rotation about the plan origin, as the SVG `patternTransform` does
(the canvas is uploaded flipped, so v is negative). Only triangles that face up take the texture; sides and undersides keep
the flat colour. Until the tile has loaded the face shows the texture's preview colour, then swaps and asks for a frame.
Rasters are cached per (id, scale); each `texture()` call makes its own `CanvasTexture`, so a floor switch disposes
the textures and the materials' maps and three's texture count returns to where it was (tested over repeated switches).
The chunk does not import core (see `palette.ts`), so the card passes `textureTile` in through `three-deps.ts`. An unknown id,
a non-string id, a NaN or huge rotation or scale give `null`, which is the flat colour: layout files are untrusted input,
and `validate` does not see a layout handed to the view by other routes. The vertex-colour lift of a lit room still
multiplies the texture (the textured material's colour is white and its vertex colours carry the lift). Cost: a lit lamp
over very light wood washes the grain a little; the pattern still reads (looked at in both themes).

**Light on the walls: a vertex-coloured additive patch, not a decal.** Alternatives: (1) a gradient texture per wall face,
(2) real `PointLight` shading on the walls (already there, but it lights every wall, has no reach limit and does not respect
the lamp's room), (3) per-lamp additive geometry. Chosen: 3. For each of the (at most `MAX_POOLS` = 8) lamps one mesh holds a
small grid per wall face that looks into the lamp's own room and lies within 300 cm; each vertex carries the lamp's colour
times `(1 - d/R)^2 * (0.35 + 0.65 * cos)`, with d the distance to the lamp and cos the angle to the face. It needs no
textures to create, upload or free; it stops exactly at the drawn wall height, so a cut (lowered) wall has a low patch only;
and it counts the distance across the room, which a flat decal does not. Face ownership uses the true outward normal of the
wall ring: a face is lit when a point 2 cm in front of its middle falls in the lamp's room polygon. Door-jamb end caps sit on the room
boundary and may take a sliver; accepted, they are a few cm wide. Off lamp, or a room that is not lit: the slot is hidden.
Cost: a face is meshed in 25 cm cells (at most 12 by 6), so a very large wall gets a coarser patch. Test hook:
`window.__fp3d.muteGlow(on)` (dist-test build only) hides the patches, because the pool light also brightens the wall and a
pixel test of on against off proved nothing about the patch (it passed with the gain at 0 until this was found).

## 2026-10-05: 3D fixes after 0.14.0 on the real layout

**One floor at a time (supersedes "Floors" in the S12.6 entry).** The card draws only the selected floor. The dimmed floors
below were built from each floor's own `floorElevation`, and on Diego's layout (garage, office, outdoor, 3 floors) they sat
out of line with the selected floor. `BelowFloor`, `setFloor`'s third argument, `belowPlans`, `data-below`, the `DIM`
opacity and the card's `_view3dBelow` are gone. The camera frames the one floor. `buildScene`'s `elevation` option stays in
core (it is the plan's own, tested, and costs nothing). Cost: you no longer see the floor under you as context.

**Icons stay under the walls.** A point device (light, camera, motion, radar, access point at 230 to 250 cm by default) was
placed at its own `z`, which on a 250 cm floor is the wall top, so the icon read as flying over the house. `buildScene`
now holds a point's `z` to the highest wall of the floor less `ICON_MARGIN` (10 cm), never below the slab; with no walls
it is the floor's storey height. A body's icon (radiator, speaker, TV: top plus 6 cm) is held by the same margin in
`anchorsOf` (`view3d.ts`). It is the one rule for the ball, the tap proxy and the icon, because all three read the point.
2D and 2.5D do not use the scene: unchanged. Cost: a device the user mounted above the wall top is drawn lower than
its `z`; the plan's number is untouched.

**Panning: middle button and Space.** The view pans on a middle-button drag, on a left drag while Space is held, and as
before on a right drag, Shift-drag and two fingers. The middle button's `pointerdown`, `mousedown` and `auxclick` are
prevented (no browser autoscroll). Space is a window `keydown`/`keyup` pair, but it acts only while the pointer is over
the canvas (`pointerenter`/`pointerleave`), not when the key starts in a control that Space activates (a button, a field),
and with no Ctrl, Cmd or Alt; it is the same gate the card's own view keys use. It is taken (`preventDefault`) only then,
so the page scrolls as usual elsewhere. Keyup and window `blur` end it. The mode is read at `pointerdown`, so releasing
Space mid-drag does not turn the pan into a turn. The card's own Space (Reset view) never fires in 3D
(`_doViewKey` returns false there), so the two do not collide. Pan moves past `DRAG_PX` set `dragged`, so it is never a tap,
and the card already ignores a non-left button. Cost: a window-level listener per 3D view; chosen over a focusable canvas
because Space must work from a plain hover, with no click first.

**Item 1 of the field report (the office with no walls) was a data error in Diego's layout file, not a code defect.**
`lowerWalls` and `wallZ` are unchanged: nothing was reproduced on the demo layout, so nothing was changed on a hunch.
## 2026-10-05: room Sensors section, add menu order and Remove button

The room panel's three sensor pickers group their options "<floor title> · <room>" and sort them (`groupSensorChoices`,
`src/editor/sensor-order.ts`): the edited room, then the other rooms of its floor in the floor's room order, then the
other floors in layout order. An entry with a floor but no room sits last in its floor under "<floor> · No room"; an entry
with no known floor (an HA entity not catalogued yet, `unattachedHaChoices`, or a stale floor key) goes last under its
room name or "Elsewhere". Never throws. Order inside a group is the incoming order. Door, heater and other lists keep the
old room-name groups; `multiAttachField` takes an opt-in `look` argument.
Remove on a room sensor is a round red icon-only button (`.btn.rm-x`, `--fp-danger`, white X, 26 px). The name is in
`aria-label` and `title` ("Remove <room> - <sensor>"); the id `<picker>-rm<k>` is unchanged. The X path is `UI_ICONS.close` (mdiClose, inlined).
## 2026-10-05: open doorway (`door.kind` `open`)

**What.** A door that is only a hole in the wall: cut like a door (210 high from 0, width a to b, the same editable
Length, height and sill), with nothing drawn in it. Diego: "to doors add as door type: open and do not draw the door."

**Why not the existing `Opening`.** An `Opening` is its own list: no name, no sensors, no state. `open` is a real `Door`,
so a doorway can carry a name, contact sensors, vibration, locks and a cover, and tell you when it is crossed or left
unlocked. Use `Opening` for a plain gap, `open` when the gap has to talk to Home Assistant.

**A kind.** `DoorKind` and `DOOR_KINDS` gain `open`; `DOOR_DEFAULTS.open` is a door's (210, 0); `OPENING_FILL.open` is a
new value, `void`: a gap that draws nothing closed. `doorStateOf` is unchanged: it is not curtains, so an open `cover`
colours it as it does a plain door. No schema bump (as for `slit`): a card older than this release refuses a layout that
holds an `open` door (`kind must be one of ...`). The CHANGELOG says so.

**How live state shows (decided).** Closed, unselected: nothing at all. Open (contact on, lock unlocked), vibrating or
cover open: the same as any door, the dashed open-door line and the pulsing alert line in 2D, the red frame in the gap in
2.5D. The sensor would be useless otherwise. In 3D nothing shows: the 3D live state lives on the door's leaf, and
`open` has none (a known gap; `three/*` is left alone here).

**2D.** The wall is cut by the same mask as an `Opening`, over `[...openings, ...open doors]`, so the plan shows a clean
gap, not a coloured line over the wall. No visible `<line>`, no `<title>`. The invisible `door-hit` twin stays (finding
3), with a class `door-hit-open`. A line is drawn only while selected (`door door-open sel`, 35 % opacity by a rule that
excludes `.open`, `.alarm`, `.cover-open`, so state keeps its full colour) or showing state. The editor adds a faint
outline on hover (`.door-hit-open:hover`, editor stylesheet only; the card has no hover). A layout with no `open` door
draws byte for byte what it drew before (the demo's sha1, both floors, 2D and 2.5D, checked).

**2.5D and 3D.** The span is the door's. `wallSolids` and `scene-build` cut between sill and head, add no leaf, glass or
panel; the red frame appears in 2.5D only while open.

## 2026-10-05: slit window (`door.kind` `slit`)

**What.** A window 60 cm high whose head meets the ceiling of the wall it sits in. Width is the length from `a` to `b`
(the editor's Length field, as for any door). Diego: "to the window type add a 'slit window', configurable width but
only 60 cm high, starting from the ceiling."

**A kind, not a flag.** `DoorKind` gains `slit` and `DOOR_KINDS` its member, so every per-kind table decides it
(finding 17): `DOOR_DEFAULTS.slit` (60 high), `OPENING_FILL.slit` is glass, `doorStateOf` counts it as curtains (an open
`cover` never colours it), the 3D palette gives `glass-slit` the window colour. Everything else is shared with `window`.

**No schema bump.** Version stays 2. A bump exists for a change old files cannot be read through; this one only adds an
enum member, so every old layout is still valid and migrates unchanged. The cost is one-way: a card or editor older than
this release refuses a layout that holds a `slit` (`kind must be one of ...`), and nothing in the file says why. The
CHANGELOG says so. Bumping would not help: the old validator rejects an unknown version just as hard.

**The default is read from the wall, never stored.** `doorSpan(door, ceiling)` takes the top of the wall the door sits
in (default: the storey, 250). Only a slit reads it: no own value gives sill `ceiling - 60`, head the ceiling; an own
`height` keeps the head at the ceiling; an own `sill` wins and the head follows it, clamped to the ceiling; a wall under
60 cm gives a slit as high as the wall. A wall's height is per wall and per room, so `solids.ts` and `scene-build.ts`
resolve the span per wall (`Span.at(w.h)`), with `w.h` the model height, not the cutaway one: a lowered front wall hides
the slit with the rest of the wall, as it hides a window. The panel's placeholders use `doorCeiling(floor, door)`: the
highest of the walls under the door's middle, as the scene keeps the tallest of coincident walls. 2D is unaffected.

**2D symbol.** The window line, class `door door-slit door-window` (so the window's colour rule applies, and no CSS rule
was added or changed), at 0.4 of its wall's thickness (`SLIT_BAND` in `render.ts`, by the stroke-width attribute). A
layout with no slit draws byte for byte what it drew before; the computed-style pair is in `tests/card/slit.spec.ts`.

**Radiator.** `radiatorSpan` reads `DOOR_DEFAULTS.window.sill`, not a slit's, so a slit never lowers a radiator.

## 2026-10-05: Sprint 12 review fixes

**Coordinate bound.** `validate` refuses any coordinate beyond +-1e7 cm (100 km) from the origin, on every point,
wall, door, opening, extra, device, furniture piece and unlinked item (`COORD_LIMIT`, `src/core/schema.ts`). A layout
of 1.7e308 made the camera distance Infinity and a blank canvas. Real houses are under 1e4 cm; the bound leaves room
for any survey. The message names the floor and the limit. As a second guard `Orbit.finite` is false when the framing
distance still overflows, and the view falls back with "it could not start".

**Nest budget.** `nest()` in `scene-build.ts` stops when rooms times points exceeds 1e7 pair tests (`NEST_WORK`), as
it already stopped at `NEST_LIMIT` rooms; the rooms are then drawn without nesting. `meet` finds wall ends through a
grid of cell JOINT_TOLERANCE instead of comparing all pairs. Cost: a layout over the budget loses the nesting of
fills, not the model.

**Retry of a failed chunk.** A browser caches a failed `import()` per URL, so the second pick failed the same way.
The build puts the chunk's hashed name into the card (`chunkName` plugin in `vite.config.ts`, placeholder
`__FP3D_CHUNK__`); the first load is the plain import, each retry asks `<card dir>/<hash>.js?r=<n>`, the same file
under a new URL. It is built as a string, not `new URL(.., import.meta.url)`, which Vite rewrites as an asset.
Unbuilt (vitest, dev) the placeholder stays and the plain import is used.

**Lost context.** The view calls `preventDefault` on `webglcontextlost`, pauses, and waits 3000 ms for
`webglcontextrestored`; three.js rebuilds its own state. If it does not come, `onFail(reason, true)` and the card shows
the note, then tries once more on `visibilitychange` to visible or on `connectedCallback`.

**Test hook flag.** `window.__fp3d` is behind `__FP3D_TEST__`, a compile-time define: true only in `dist-test/`, an
extra card build `scripts/build.mjs` makes when `FP_TEST_BUILD=1` (the Playwright globalSetup, `npm run shots`). The
shipped `dist/` and `www/` contain no hook; `size-budget.spec.ts` greps for it. Two cards stack their hooks; removing
one republishes the other's.

**Folded Active list.** `_apply3dInset` insets only when the panel has its body (open). A folded 36 px header spans half
a phone's width and hid almost nothing.

Not done: the card does not pass `layout.colors` to the 3D view (the dead `Live3D.colours` is gone); 3D takes its
colours from the stylesheet variables only, as 2D does.

## 2026-10-05: floors, size budget and performance in 3D (S12.6)

**The size budget is met, with the limits unchanged.** Card gzip 98690 -> 94341 (+3561 over the pre-3D 90780; limit
+5120). Chunk 199927 -> 190424 (limit 200000; the aim of 190000 is missed by 424 bytes). Two moves. (1) `buildScene` and
`liveOf` are factories in the chunk (`makeBuildScene`, `makeLiveOf`) that take the 2D helpers as an argument; the card
passes them (`core/three-deps.ts`). The chunk may not import the card's modules, or Rollup makes a shared chunk and the
card file shrinks to 129 bytes, which games the budget; importing the card entry loads it twice (`?v=`). `core/scene.ts`
and `core/live.ts` stay as thin wrappers, so tests and the API did not move. (2) `scripts/trim-three.mjs`, a Vite plugin
for the card and panel builds, swaps three's WebXR manager, environment-map cache and shadow-map renderer for inert
stand-ins (about 15.8 KB gzip off the chunk). Each patch must match exactly once or the build fails, so a three.js
upgrade that moves the line is a build error, not a silent size jump. `tests/card/trim-three.test.ts` covers the plugin.
Cost: a shadow, an environment map or WebXR in 3D would need the patch removed. Guard: `tests/card/size-budget.spec.ts`
fails over either limit, on a second chunk, and when the builder or `WebGLRenderer` is in the card file.

**Floors.** The scene is built for the selected floor at 0; each floor below is built by the same `buildScene` with
`elevation = floorElevation(below) - floorElevation(selected)` (negative), drawn as merged meshes at 0.3 of their own
opacity, no depth write, drawn first, no devices, no live state, not in the picker and not in the occlusion test. The
floors above are not built. The camera is one `Orbit` for the life of the view; a floor switch calls `Orbit.reframe`:
azimuth and polar stay, distance and target frame the new floor, the panel inset stays. It frames the stack (the
selected floor and the ones under it): framing the selected floor alone cut the dimmed floor off at the edge of the
view, which the S12.6 shots showed. Old meshes go through `clear()`: 21 switches leave `renderer.info.memory.geometries` where 2 did
(the test fails when the below meshes are not disposed).

**Performance needed no code.** Idle, a settled pulse, and 100 unchanged `hass` updates already drew nothing (one
`rAF` per burst; `setLive` skips an equal signature). The tests make it a promise: with the signature skip removed, 100
updates a frame apart draw 100 frames and the test fails. One trailing frame after a pulse is expected: the card's
one-second fade tick tells the view the pulse is over. A fade is at most one frame a second, from that tick, and none
once its window ends. The hostile layouts all drew or fell back with no `pageerror` and no `console.error`. The ones the
checker refuses (a NaN size, a device of an unknown type) fall back with the checker's own line; a 5000-furniture tap
answers in well under 1 s.

**To confirm.** Floors below use a fixed 0.3 opacity; no config key. The chunk is 424 bytes over the 190000 aim.

## 2026-10-05: live state in 3D (S12.5)

**Light model.** Which room a lamp lights is the 2D `roomAt` rule, computed in core (`liveOf`) and handed to the chunk
as JSON. The chunk gives every vertex an owner room (a wall face belongs to the room it faces, within 12 cm) and
multiplies its colour by that room's lift, so floor, furniture and walls of the lit room change and the neighbour does
not move by a grey level. A pool of light is a soft disc under a lamp, and costs a draw: **8 pools at most**, the lamps
nearest the middle of the house, stable on ties; the room lift is free, so it applies to every lit room. The view
publishes `data-pools="shown/lit"`. Daytime lift is modest (1.3), because 1.6 washed a lit room to white in the light
theme; night is strong (3.5) against dimmed lights.

**Overlay tap path: one path, the raycast plus the icon disc.** The HTML layer is `pointer-events:none`, so it can
never block an orbit drag. `pick()` asks the overlay first whether the point is inside an icon's 16 px disc (the icon
the eye sees), then the raycast `Picker`. The card's `bindDeviceActions` `resolve` is unchanged, so taps, holds and
NO_TOGGLE are the 2D code.

**Occlusion rule.** A label or icon is hidden when the segment from the camera to its anchor crosses a wall, stair or
door leaf or panel (`Picker.blocked`), or when it is behind the camera. Floors, furniture, glass and device bodies do
not hide it. A lowered wall blocks only up to its lowered height.

**Pulse follows 2D.** Only a room with its own `motion` list pulses, three times of 1.4 s, then holds and fades. The
card remembers the last time each motion sensor was on, so one that just went off keeps its strength and fades from
there (2D does the same). The view's draw loop runs only while a pulse plays.

**Media has no drivers.** A speaker gets two lit drivers; a `media` device is a box with none, so playing lights only
its icon. A TV's screen is assumed to face out of the wall along the base edge, as in 2.5D.

**Size budget was already gone at S12.4, and S12.5 spent more.** Card gzip: pre-3D 90818, S12.3 95583, S12.4 97283,
S12.5 98690 (+7872; goal +5120). Chunk 199927 gzip (goal 200000). The card has to carry `liveOf` and the helpers
extracted from `render.ts`, because the chunk may import nothing from core at run time. Ways to get back under: lazy
`import()` of `live.ts` from the chunk's loader, and replacing `CylinderGeometry` for the drivers. Not done here.

## 2026-10-05: picking and taps in 3D (S12.4, part B)

**One gesture code, two sources of "what was hit".** `bindDeviceActions` takes an optional `resolve(e)`; in 3D it
asks the view's ray pick and answers with a stand-in `g[data-x]`, `line[data-d]` or `g[data-u]`. Tap, hold, the
NO_TOGGLE set (finding 20), the chooser and the cover dialog are therefore the 2D code, not a copy. Room taps are the
card's own small handler, because 2D has none to share (its rooms are DOM polygons).

**The pick is `src/card/three/pick.ts`, pure.** A bounding-box prefilter, then ray against prism or ball. A device is a
ball of 12 cm (drawn) with an unseen 24 cm hit proxy. The proxy is a test in the picker, not a mesh, so a miss
reaches the room behind. 5000 furniture pieces pick in well under a second (a test holds it).

**What a tap clears.** A device, door or unlinked hit never picks a room (as in 2D). A tap on a full-height wall, a
stair, the slab, or furniture on no room is "other" and clears the pick: the 2D rule "anything else clears". A "fill"
room (garden, pavement and the like) is looked through. A lowered wall is looked over, using the same cut set the
view draws. Furniture picks the highest room under its hit point.

**Drag threshold 6 px, the same as `TAP_SLOP_PX`.** It was 4 in the view. A test holds the two equal, so no press is
a tap on one side and a drag on the other. A double tap (350 ms, 24 px) restores the pick as it was; 3D has no zoom
on double tap.

**The ring is drawn over the walls (no depth test).** The room outline lies inside the walls' footprint, so with depth
it was hidden; the shot showed no ring at all. Drawn over the walls it is thin but visible.

**The test hook** `globalThis.__fp3d` (`project`, `where`, `pick`) exists only when `globalThis.__FP3D_TEST__ ===
true`. Playwright uses it for coordinates and then drives `page.mouse`.

**Side effect to confirm.** Picking a room widens the Active list (room section), and the inset moves the camera, so
the model slides a little. Left as is; the alternative is to fix the inset at the widest width.

**Found, not changed.** `temp` is not in `NO_TOGGLE`, so a tap on a temperature icon calls a toggle in 2D as well as 3D.
Partly overlapping duplicate walls are not merged in the scene (same colour, invisible).

## 2026-10-05: 3D walls mode, wall corners, framing beside the list (S12.4, part A)

**Walls in 3D is the 2.5D select and its stored value.** One `walls` setting (config key, Walls select, saved view),
read by both views. `cut` is the default. Say so if you want 3D to remember its own.

**Cut is decided by the camera, in `src/card/three/cut.ts`, pure and without three.js.** The outline faces out of the
house: it drops to `CUT_WALL_HEIGHT` (30 cm, `scene.ts`) while the camera is past its plane by more than 20 cm, and
stands again only when the camera is 20 cm back inside (the margin stops a flicker on a threshold). The far side of the
house stands in full. An inner wall (a room's edge, a free wall), whatever faces it kept, drops when it hides more than
60 cm of floor behind it (`h*d/(camZ-h)` across the wall) and stands when that is under 40 cm; a camera lower than the
wall's top hides everything. `full` lowers none, `low` all. The scene stays pure: the wall meshes are the only ones
rebuilt, and only when the set changes, never per frame. The card passes the cut height in, so the chunk still shares no
code. `wall` and `faces` ride in the solid's `ref` for this.

**First try was wrong and is why inner walls use depth.** One-sided rule only: the wide south room's north edge (it
overlaps two small rooms' south edges in part, so it is not merged with them) faced north, was "far" from a southern
camera, and stood at 250 cm in front of the north rooms. The shot showed it.

**Dark slivers at a door gap were a corner bug, not a shading bug.** A partition drawn as two collinear room edges, or
ending on a through wall, was extended as if it met a corner, and stopped flush with the outer face; wall colours then
z-fought there. `meet()` now gives no extension to a wall that runs through a joint or ends on a through wall (a T).

**The grey tile beside the house on the ground floor is not a stray solid.** It is the demo's Garden and Pavement
rooms, 1 cm tiles outside the slab, as the plan has them. A test says so. They look odd in the blueprint theme (dark
navy tokens); not changed.

**The Active list moves the framing.** The card measures the list against the 3D host after a render and when the
panel moves, and tells the view the covered fractions of the left and right. `Orbit.setInset` fits the house to the
free width and `camera.setViewOffset` slides the picture; the two together never take more than 60 percent.

## 2026-10-05: the card's 3D view, chunk delivery and three.js (S12.3)

**Dependency.** `three` ^0.186 (MIT) and `@types/three`, dev dependencies, bundled into the chunk; never fetched at
runtime (finding 9). Diego approved it on 2026-10-05. Only named imports are used, so the bundler drops the rest.

**Chunk delivery (gate K): the chunk works, no inlining.** `import("./three/view3d")` in the card emits
`floorplan-studio-3d-<content hash>.js` in `dist/` and `www/`, resolved by the browser relative to the card module
(`import.meta.url`), so the `?v=` on the card's URL does not matter and a new build is a new file name. A Playwright
test serves `www/` at `/floorplan_studio_static/?v=` and shows no 3D request before 3D is picked, exactly one after,
and none to another origin. Numbers: card 296271 -> 310732 bytes, 90818 -> 95581 gzip (+4763, limit 5120); chunk
856137 bytes, 182.8 KB gzip (limit 200). `release.yml` insists on exactly one chunk, `build.mjs` removes stale ones from
`www/`, and a pytest checks it is served.

**The chunk shares no code with the card.** First build: Rollup moved the card's own code into a shared hashed chunk
and left a 99-byte card, so the card loaded two files up front. The view modules (`palette.ts`, `view3d.ts`) now import
nothing from `src/core` at run time (the union lists are copied and a test iterates the core unions; `buildScene` is
passed in by the card). Then the card stays whole and only three.js and the view are lazy.

**Own orbit controller, no OrbitControls.** `src/card/three/orbit.ts`, about 100 lines, pure and unit-tested: azimuth,
polar clamp 0.1 to 1.45 rad (never under the floor), zoom 0.15x to 4x of the fit distance, pan in the view plane. The
addon would add code and a second place for the clamp to differ from our own tests.

**Mesh.** Each prism is triangulated by three's `ShapeUtils` (earcut: concave bases work); a base that cannot be drawn
is skipped, never thrown on (finding 1). Points (devices with no body) are skipped until S12.5.

**Colour.** `paint.role` maps to a CSS expression of `--fp-*` tokens, read once per theme change through
`getComputedStyle`; a user `paint.color` is used as written. Walls are the ink token mixed 55% over the background,
as the 2.5D side faces are: raw ink is near black in the light theme and read as a hole.

**Wall corners** are now closed in `scene.ts`: a wall end that meets another wall's end extends by half that wall's
thickness. Four tests. The first look showed a notch at every outer corner.

**Test hooks.** `FloorplanStudioCard.liveRenderers` (static getter, a counter, not a global) and data attributes on
the 3D holder (`data-az`, `data-polar`, `data-dist`, `data-target`, `data-drawn`, `data-dragged`); S12.4 reads
`dragged`.

**Fallback.** No WebGL, a lost context or a failed chunk load: the 2D plan and one line why. A failed load is retried
at the next pick.

## 2026-10-05: the editor loses 2.5D (S12.1)

Diego: "remove the 2.5d from the editor, it doesn't work well". Removed: View > Plan view, Tilt and Walls, the
preview note and the read-only preview mode (inert menus, no hit-test, no keys) with `EditorState.viewMode`, `tilt`,
`walls`, `preview` and their setters; `viewBoxFor` is called flat. `ViewMemory` drops `mode`, `tilt`, `walls` and the
zoom `aspect` (it existed only because the fit changed shape with the tilt). An old stored entry is read without them
and opens flat; the entry is rewritten at the next view change, not before. Kept: everything in `src/core` and
`src/card` (`renderFloor` with `view`, `tilt`, `walls`), and the editor's door "preview open" box, which is 2D. The
parity test now lists Plan view, Tilt and Walls as card only (an exception, as in the entry below).

## 2026-10-05: the 3D scene module (S12.2, core)

`buildScene(floor, opts)` in `src/core/scene.ts` returns the raw solids of one floor, in cm, z up, as plain JSON. No
three.js, no DOM. It reads the same resolvers (`heights.ts`) and the same fixed sizes (`solids.ts`) as 2.5D, so the
two views cannot disagree (spec R3). Choices:

- **Two shapes only.** `prism` (a polygon from `z0` to `z1`; every box is one) and `point` (a device with no body).
  Winding is not fixed. Each solid has `id` (by index, never by user text), `kind`
  (floor, room, wall, opening, furniture, unlinked, stair, device), `tag` (wall kind, symbol, device type, `glass`,
  `door-leaf`, `panel`, `kerb`, `stair-down`), `ref` (what to find again) and `paint` (a `role` token, plus the
  user's own `color` and `texture` as written; never a theme hex).
- **Opening is a kind of its own.** A door, window or opening is a gap in its wall: a block under the sill, a
  header over the head, nothing between. A plain door gets a 4 cm `door-leaf`, a window or glass door a 2 cm
  `glass` pane, a sealed one a `panel` as thick as the wall. `ref.index` is the door's index and `ref.entity`
  its first sensor, lock or cover; `entities` has all of them. One infill per opening, even when two
  coincident walls carry it.
- **Wall thickness** (the plan draws a line, 3D needs a width): wall 10, external 20, fence 4, edge 10, centred on
  the edge line. Corners have no mitre: two meeting walls leave a notch of half a thickness. Known, left to the
  viewer or a later task.
- **Same edge twice is one wall**: the taller wins, and `external` wins on a tie, as in `collectWalls` (solids.ts).
- **Rooms.** A zone has no fill (it is an overlay) and no walls; a structure has no fill but keeps its walls (neither
  owns a point, `ROOM_OWNS`); a `fill` with no name is skipped, as in `renderFloor`. Every other kind gets a 1 cm
  fill on the slab, lifted 1 cm per bigger room it sits inside (garden house over garden), up to 300 rooms; past
  that all sit at 0. Unknown kinds get none. The slab is `-slab..0`, so the walking surface is z 0.
- **Furniture** by `FURNITURE_SOLID`: box and flat are the rotated rectangle at `furnitureHeight`; a pole (tree) is a
  12 cm trunk and `ref.size` carries [w, h] for the viewer's crown. A piece with a non-finite number, a size of
  zero or less, a height of zero or an unknown symbol is skipped (2.5D draws the unknown as flat 2D; 3D has nothing to draw).
- **Unlinked** is a 40 cm block times `scale`, at `unlinkedHeight`, rotation not drawn, as in 2.5D.
- **Stairs**: a step per `stairSteps`, each as high as the flight has climbed by then (last = storey height). Down:
  treads sunk below the floor (`stair-down`; the viewer may cut the slab). Both ways: the rising flight plus a kerb.
  `opts.around` is `floorsAround`, so an unmarked stair resolves as in 2.5D.
- **Devices** by `DEVICE_SOLID`: radiator (8 cm deep, `radiatorSpan`), speaker and media (20 x 20 x 30, turned by
  `rot`), TV (`tvPlacement`: 100 x 6 x 60, flush on the nearest wall within 150 cm at `deviceZ`, else free-standing
  30 cm up looking toward +y). A heater with no bar, a TV or speaker with no usable position, and every other
  type, is a `point` at `deviceZ` (a bar: at its middle). Nothing is skipped for want of a body.
- **Exports added, behaviour unchanged**: from `solids.ts` `within`, `turnAbout`, `stairBlocks`, `wallFace`, the
  device sizes, `KERB_*`, `WELL_DEPTH`, `HOST_TOL`, and a new `tvPlacement` (the placement half of `tvSolid`,
  moved out so 2.5D and 3D share it); from `heights.ts` `floorSlab`. `within`'s parameter types are narrowed to the
  fields it reads.
- **Never throws.** Every piece builds inside its own guard and one `add` refuses a shape with a non-finite
  number or no thickness. Heights that are junk fall back to the default, as in `heights.ts` (a wall of height -5
  stands at the storey height; height 0 is no wall).
- No CHANGELOG line: no user-visible change.

## 2026-10-05: real 3D in the card, view-only; 2.5D leaves the editor

Diego asked for real 3D. Chosen: a three.js view in the card, built from a new raw-solid scene module
(`src/core/scene.ts`), because `solids.ts` returns projected SVG and cannot feed a 3D engine. View-only; the editor
stays 2D and loses 2.5D (it "doesn't work well"). The chunk loads on first use (about 170 KB gzipped, accepted). The
card keeps 2.5D for good, as the fast low-power view for weak devices (Diego, 2026-10-05). This is a stated exception to studio and card parity. Spec:
`docs/specs/real-3d.md`.

## 2026-10-04: second review round of Sprint 11 (card, core, editor)

The pin rule of commit 6b1214c (a point inside a pin picks nothing) is withdrawn.

- A tap on a point where a room's name lies over a lamp's pin picks the room. The pin lets events through, so the name
  is the real top element; that is the common 2.5D case (Kitchen, rotation 270). The tap on the lifted icon is the
  device's: it toggles and never picks. `card-lifted-icons.spec.ts` now taps the icon first and the pin point after,
  because a room panel opened by the pin point covers the icon; it also asserts the icon tap picks no room.
- Only the room's own text is its floor: the name (`data-rl`, new on the room's `<text>`) and the readout
  (`data-rv`), and `g.furn`. A device's value or name and a structure line's name are not (they used to match
  `text.lbl, text.val`). The one attribute is added to 2D output; the two demo snapshots changed by it and nothing else.
- A fill is looked through to the room below, like a zone or a structure (it used to clear the pick).
- Changing a room's kind to zone, structure or fill deletes its temps, humidity and motion lists in the same undo step:
  nothing could show them and no Sensors section is left to remove them. Undo brings them back.
- `roomAt` breaks a tie in area toward the highest index, the polygon drawn last, which a tap reaches.

## 2026-10-04: a speaker's icon sits on top of its cabinet (Opus review of Sprint 11, core)

The 2.5D speaker is a 30 cm cabinet, but its icon still floated at 150 cm (speaker) or 100 cm (media), a hook
on the wall above a box on the floor. Decided by the coordinator, **open to Diego's change**:

- `DEVICE_Z.speaker` and `.media` are 30, the top of the cabinet (`SPEAKER_HEIGHT`). An explicit `z` on the device
  still wins for the icon (the editor's mount height field shows 30 now).
- Below `STEM_MIN_Z` an icon normally stays on the floor point. A speaker's is lifted anyway (`DEVICE_SOLID` says
  "speaker"), so the icon rides the cabinet; no stem, as it stands on the box. 2D is unchanged.

## 2026-10-04: the room's motion border pulses three times per trip (Opus review of Sprint 11, core)

Diego: "animate the motion highlight of a room when motion trips ... pulsing red border that fades out". The
coordinator took that as three pulses, then a steady edge, and **Diego may change it**; so may the count (3 pulses
of 1.4 s, `MOTION_PULSES` and `MOTION_PULSE_S` in render.ts). Calls made in code, change any:

- The S11.1 pulse was endless (`infinite`). It is now three, then the steady edge that holds while the sensor is on
  and fades with `fade` after it. Reduced motion is unchanged: no pulse, edge only.
- The card redraws the plan on every state update and a redraw restarts a CSS animation, so three pulses would have
  replayed on every unrelated change. The ring carries the age of the trip, `--fp-pulse-age` (seconds since the
  newest listed sensor that is on changed), and the stylesheet starts the animation that far in with a negative
  `animation-delay`. A redraw mid-pulse carries on. Past 4.2 s the ring has no `.motion-pulse` class. An unreadable
  `last_changed` pulses nothing (it could not be told from a fresh trip on every redraw). The render stays a pure
  function of layout, state and `now`.
- An icon-made ring (a loose motion icon) still does not pulse, as before.

## 2026-10-04: small fixes from the Sprint 11 review (card, core)

- A mean reading takes only the readings in the first unit seen: 21 C and 70 F read "21.0 C", not "45.5 C". No
  conversion (supersedes "first unit seen" in the S11.1 entry, which averaged the numbers anyway).
- A tap picks the first room polygon among everything stacked under the finger (`elementsFromPoint`), not only
  when the polygon itself is the target. A room's name, its readout and its 2D furniture are its floor; a zone or
  a structure is looked through to the room below (it is not a room, see the `roomAt` entry). A device, door or
  stair tap still never picks.
- A double tap restores the pick as it was before its first tap. The code used to let the first tap pick or clear
  and the second only zoom, against the S11.3 entry. Known edge: the room section opens at the top left of the
  card, so a double tap on a room under it lands its second tap on the panel and is two taps, not a zoom.
- A toggling row in the room section asks what a tap on the plan's icon asks: a device that names more than one
  entity opens the chooser on Enter or Space too, instead of toggling.
- The panel's label is the room's name while a room is shown, "Active devices" otherwise.

## 2026-10-04: one rule for "the room a point is in" (Opus review of Sprint 11, core, editor, card)

The review found three rules for one question: the aura clip took the smallest non-zone room (a structure
counted), the editor's Attach did the same, the Sensors section hid only zones and structures, the readout hid
zones and fills, the card's room summary took every room whose ring held the point. So Attach could move a
sensor into a 40 x 40 structure that had no panel to remove it, and a lamp in a small structure was clipped to it.
Calls made in code, change any:

- `roomAt(f, p)` (core/render.ts) is the smallest room whose kind is in `ROOM_OWNS`: room, garden, pavement,
  terrace, water. Zone, structure and fill never own a point. A test lists every `RoomKind`.
- Used by the lamp aura clip, `EditorState.roomAttach`, `roomSummary` (a device counts in exactly one room, so a
  closet's lamp is no longer also under the hall's "Lights on"), the readout, the motion edge and the editor's
  Sensors section. A lamp inside a structure with no room around it keeps the free circle.
- A named fill no longer draws a motion edge (the spec said unnamed only); it has no Sensors section either.

## 2026-10-04: room sensor pickers and "Attach to room" (S11.2, editor)

Diego: "instead of having them around, lets add them to a room, like the windows
and doors can add contact sensors." Calls made in code, change any:

- The room panel's three pickers are `multiAttachField`, the door's own widget,
  so a pick pulls a loose icon of that entity off the plan in the same undo step
  (S10.2 rule) and Remove only detaches. That is why the editor rarely holds both
  an icon and a room entry; the "Attached to <room>" line covers a hand-edited
  layout and an icon dragged back. No new draw path.
- One room per sensor, like one door per contact sensor: a picker does not offer
  an entity another room lists. HA entities never placed are offered too
  (`unattachedHaChoices`). A full list (20) offers nothing. `setRoomList` is the
  only writer: first occurrence wins, capped at 20, an empty list deletes the key,
  so no pick can make a layout `validate` refuses.
- `attachedEntities` (core/bind.ts) now counts a room's three lists, so an entity
  on a room is "in use" and Add stops offering it as unplaced.
- "Attach to room" goes to the smallest non-zone room holding the icon's point
  (the aura-clip rule). It never writes to a zone, and it is disabled with the
  reason when the point is outside every room, the entity is empty, already
  listed, or the list is full.
- Zones and structures get no Sensors section: nothing reads there.

## 2026-10-04: picking a room and device details live in the left panel (S11.3, S11.4, card)

Diego: "also when selecting a room in card view, show all the stats and info of
that room in a side popup. also for every device when selecting them, add the
info like manufacturer, model etc." Then, answering where: "use the left pane we
have already, add the room readouts and filter the entities shown to allow
interaction". So the room is **not** a right-hand popup; it is a section at the
top of the existing Active panel. Calls made in code, change any:

- A tap on bare room floor picks the room. The same room again, a tap off any
  room, Escape or the section's cross clears it. A device, door or appliance tap
  keeps its own meaning and never picks. A stair tap counts as
  "off a room"; a fill is looked through (2026-10-04, second round). A double tap (zoom) leaves the pick alone. Kiosk and
  `active_list: false` pick nothing: there is no panel to show it in. Switching
  floor clears it. Escape uses the card's existing key gate (hover or focus), the
  same as the view keys.
- The outline is `.room-picked` (ink, dashed), added by `renderFloor` from a new
  `selectedRoom` option, so there is one draw path. The editor draws its own
  selection in its overlay and does not pass it.
- Area is the polygon's area from the room's corners, to 0.1 m2. The room's
  `area` field is a Home Assistant area id, not a size, and the editor shows no
  area figure, so there was nothing else to match.
- Temperature and humidity are the plan's own `meanReading`, moved out of
  `renderFloor` into `src/core/readings.ts` so both read one function.
- "Devices" are the devices whose point (a heater's midpoint) is inside the
  room, plus the room's own sensors that have no icon. A person never has a row:
  its drawn position comes from a room sensor, not from x and y. Open doors and
  windows are those whose line lies on one of the room's edges (`onEdge`), open
  or unlocked as `doorStateOf` says.
- Row taps: light, switch, plug and cover toggle (tap) and open more-info (hold),
  through the same `bindDeviceActions` the plan uses, bound a second time on the
  panel (`button[data-x]`). Every other type opens more-info. `ROOM_ROW_TAP` lists
  every device type and a test keeps it inside `NO_TOGGLE`'s refusals.
- The list below is cut to the room's entities (its devices and what they attach,
  its sensors, its doors' sensors, locks and cover). "Show all" drops the filter
  and keeps the room picked. With nothing picked the list is unchanged.
- While a room is picked the panel is open even where it is folded by default
  (under 480 px) and is wider (`min(260px, 70%)`); the fold button is hidden.
- Details (S11.4) read `hass.entities[id].device_id` and `.area_id`,
  `hass.devices[...]` (manufacturer, model, sw_version, area_id) and
  `hass.areas[...].name`: checked against the Home Assistant frontend source
  (`src/types.ts`, `device_registry.ts`, `area_registry.ts`, `entity_registry.ts`),
  2026-10-04. An empty field is left out. The chevron is a sibling of the row's
  button, so it never taps the row. Open details are card state keyed by entity.
- The panel is card-only. The studio has its own selection panel with all of
  this and more, so this is a stated difference (docs/card.md, "Studio and card").

## 2026-10-04: a room owns its temperature, humidity and motion sensors (S11.1, core)

Diego: "instead of having them around, lets add them to a room, like the windows
and doors can add contact sensors. then animate the motion highlight of a room
when motion trips." `Room` gains `temps`, `humidity`, `motion` (entity id lists,
at most 20 each; `sensor.*`, and `binary_sensor.*` or `group.*` for motion, since
a motion group is a motion device). Calls made in code, change any:

- A device of type temp, humidity or motion whose entity is on any room's list is
  not drawn on the card, in 2D or 2.5D. It stays in the layout. The editor
  (`editor: true`) still draws it, so it can be selected, moved and deleted; the
  S11.2 "Attach to room" button will remove it.
- The readout is one small `.val` line under the room name: the mean of the
  readable states, rounded to 0.1, with the first unit seen (a mix of C and F is
  not converted). Temperature and humidity join with a dot. Nothing readable,
  nothing drawn. It follows `labels:false`.
- The room's border is the existing `.motion-perimeter`, now also fed by the
  room's own list: red (the theme's motion colour) and pulsing while a listed
  sensor is on (`.motion-pulse`, an opacity pulse), then steady and fading with
  `fade` like the icon does. One ring per room; an attached icon does not make a
  second one. Reduced motion: the pulse is off, the steady edge stays. Zones,
  structures and unnamed fills draw none.

## 2026-10-04: 2.5D gives radiators, speakers and TVs a body

Diego: "radiators ... add them some height ... under the windows. for sonos and
multimedia players use a speaker 3d, for tvs add a tv that goes against the wall".
`DEVICE_SOLID` (solids.ts) lists every `DeviceType`: heater with a bar is a
"radiator", `speaker` and `media` a "speaker", `tv` a "tv", the rest none. All are
drawn by `renderFloor` after the furniture, only when `view` is 2.5d; 2D bytes are
unchanged. Icons keep their lift, stem and tap.
- Radiator: box 8 cm deep along the bar, from 10 cm up to `z` (device `z`, already
  validated; default 70 = window sill 90 less 20). Tinted `--fp-heater` while
  heating, idle grey otherwise. A heater given as a point, not a bar, has no box.
- Speaker: 20 x 20 x 30 cm at the floor point, turned by `rot`. Two driver marks
  go on the face that looks most at the viewer (not a fixed front, so a turned
  plan still shows them). Lit with `--fp-dev-speaker` (`--fp-dev-media` for media)
  while playing. `z` is ignored: the icon hangs where `z` says, the cabinet stands.
- TV: panel 100 x 6 x 60 cm, bottom at `z` (100 by default). It sits on the nearest
  room edge, outline edge or free wall within 150 cm, flush with the wall's room
  face (5 cm off the line for a wall, 10 external, 0 for none/fence), centred on the
  TV's projection onto it, on the TV's side. The screen is drawn only when the
  face looks toward the viewer (a TV on a south wall shows its back). No wall near:
  free-standing at its point, facing down the screen, bottom 30 cm (or `z`).
- A thing on a wall sorts after that wall (a wall is keyed by its nearer end and
  would otherwise cover a TV far along it).
- Colours come from existing tokens by `color-mix`; no new theme token. No schema
  change: `height` is not allowed on a device, only `z`, which exists.

## 2026-10-04: a lamp's aura is clipped to the smallest room that holds it

Diego: "clip the light cones to the room they are in". The aura is a 150 cm
circle; it crossed walls. Now it is clipped to the floor polygon of the smallest
non-zone room containing the lamp (a lamp in a closet inside a hall lights the
closet). No room, no clip: the garden lamp keeps its circle. In 2.5D the clip
carries the same lift as the aura. The camera cone is not clipped (not asked).

## 2026-10-04: the card's view buttons are a vertical stack, like the studio's

Diego: the rotate buttons are lost in the crowded top-right toolbar; "do them
like in studio". The card now draws two groups: `.fp-zoom` (`.fp-viewonly`
with zoom off), a wrapping toolbar for View, Tilt, Walls, Theme, Labels and
Names, and `.fp-stack`, a column of 28 px buttons: zoom in, zoom out, fit,
rotate left, rotate right, Reset view. Conditions are unchanged; zoom off
leaves rotate and Reset in the stack. `_positionToolbar` puts the stack under
the toolbar, wherever that sits, and the Active list clears the stack when
they would meet. A card too short for the column (about 200 px wide, where
the toolbar alone is 90 px of 144) lays the stack out as a row under the
chips and moves the toolbar below it: zoom and rotate stay reachable, the
toolbar's last row is clipped. Tests that looked for the zoom buttons inside
`.fp-zoom` now look in `.fp-stack`. No editor change.
## 2026-10-04: a cover left open on a plain door is red; walls default stays `cut`

Diego confirmed three calls on 0.12.25. `.door.cover-open`, `.opn.cover-open`
and the glass and sealed cover-open rules now use `--fp-open-door`, not
`--fp-open` (orange), so every open opening reads the same. Supersedes the S9.1
"cover keeps orange". The `walls` default stays `cut` (`full` hides 137 cm of
floor at tilt 0.5). Internal doors are painted leaves; open ones a red frame.

## 2026-10-04: 2.5D walls shaded, open doors red, motion border follows the icon

Diego on 0.12.23: walls look like "2d + hat", open doors and windows should be
red, no motion border in the Living room.

- Walls: the default `walls` stays `cut`. `full` hides 137 cm of floor behind a
  front wall at tilt 0.5 and 275 cm at tilt 1; the doll's house look is the
  point of the view. The look is fixed by shading instead: faces lit by screen
  orientation (`.ws.lit`, `.ws.dim`, mixed from `--fp-wall-side` with
  `--fp-on-dark` and `--fp-on-light`), a foot, a top edge, a thinner cap.
  Everything is gated on `rise > 0`, so tilt 0 and 2D are byte-identical.
- Open openings: 2.5D reads the same state as 2D (`doorStateOf`). Open and
  alarm are `--fp-open-door`. A cover left open on a plain door keeps
  `--fp-open` (orange), as 2D and the existing tests pin. Supersedes nothing;
  confirm if Diego wants it red too.
- "Internal doors paint them", read as: a closed door is a painted leaf in
  `--fp-door` in every wall, internal included. Open it is a red frame.
- Motion: the red icon is a fade of a sensor already off, and the border
  ignored it. The border now fades with the icon (`--fp-fade`). A sensor in a
  wall counts for the nearest room within the wall reach; the innermost room
  wins. `MOTION_TYPES` (motion, radar) is the one list; radar is now on the
  Active list. A radar icon does not fade, so neither does its border.

## 2026-10-04: three photos of the maintainer's card go in the README, blurred

CLAUDE.md says the maintainer's house layout never enters the repo. Diego chose
to show his real card anyway, with every room, device and entity name blurred
(the Active list and each plan label). The shape of the house stays visible.
The files are `docs/img/card-house-*.png`. This is an exception for these three
images only; no layout JSON, entity id or URL goes in.

## 2026-10-03: a high device is drawn lifted; the pin stays on the floor

Diego, in 2.5D: "instead of moving the icons with the walls, it moves the pin."
Supersedes the 2.5D entry's "floor-level things keep their plan position" for
devices: the icon no longer stays on the floor with a stem up to a dot.

A device with z at or above `STEM_MIN_Z` (100 cm), not a person, not a heater
bar, is drawn at `px.lift(c, z)` (`iconAt` in `renderFloor`). Everything it
carries moves with it: the lit lamp's aura (unclipped, as before; walls still
draw over it), the camera cone, ping and wave rings, away mark, name, value, and
the label-placement obstacle. Only the small pin and the stem stay at the floor
point `c`. Radar target dots stay on the floor: they are positions in the room.
Taps follow the icon (`g[data-x]` is the real top element); the pin and stem take
no pointer events. The editor's 2.5D view is a read-only preview (no selection,
drag, handles or overlay), so it needed no change. Unlinked appliances were
already lifted whole as solids, with no pin: unchanged. 2D output is identical.
## 2026-10-03: studio and card agree on every view control

Diego, on 0.12.22: "i have buttons in the studio but not in the card ... arrow
keys work in studio but not card. RULE: everything you do in studio must also
be done in card."

What a Chromium run, with the card mounted as Home Assistant mounts it (bare
config, `hass` without `config`, inside nested shadow roots, from 200 to 1280
px wide), found:

- Default configs (`type` only, `view: 2.5d`, `floor`, `labels: false`) already
  drew the rotate buttons, reachable by a real pointer, and took the keys with
  the pointer over the card. The 0.12.19 and 0.12.22 code is in the build.
- `view_switch: false` hid the rotate buttons and Left/Right while the zoom
  buttons stayed. The pair lived inside the View controls.
- After a click on the card the keys worked only while the pointer stayed on
  it, in Home Assistant. The card looked for focus in `document.activeElement`,
  which in nested shadow roots is the outermost host, never the card. A flat
  test page hid this. The card now tracks its own focusin and focusout.
- Not reproducible in a browser: a dashboard that shows none of it. The one
  cause left outside the card's own logic is the browser running another build:
  `defineElement` keeps the first owner of the element name silently, so an
  older copy kept as a manual dashboard resource would win. The card now
  prints its version and warns once when it lost the name. If Diego's console
  shows an older version, or the warning, that is it; the fix is in Settings >
  Dashboards > Resources.

Decided. The rotate pair is a control of its own, `rotate_switch`: unset it
follows the other controls (shown when the card draws zoom or the View
controls, hidden under `kiosk`); `false` hides it and the keys; `true` shows it
under `kiosk` too. `rotation` is taken by the start angle. Kiosk keeps its zoom
keys (the zoom gestures stay) and has no rotation keys unless `rotate_switch:
true`. Rotation does not depend on 2.5D, as in the editor.

The Names button made the 2.5D toolbar wide enough to run under the floor chips
at 700 px, where the chips (higher z-index) covered the View select and the
Tilt slider; a Playwright test over 375 to 1280 px found it already broken at
375 and 500. The toolbar is now measured after each render and moves below the
chips when it would reach them (`_positionToolbar`); the Active list follows
it. CSS alone cannot know the chips' width.

Parity audit (docs/card.md, "Studio and card"). The one viewing control the card
lacked was Names: added as the Device names button and config key `names`,
remembered and reset like Labels, and passed to `renderFloor` as `showNames` (no
change to the renderer). Deliberately not in the card: Snap, Measure grid and
Lengths (editing aids; the measure grid is drawn by the editor, not by
`renderFloor`), Preview night (the card goes dark by itself), Copy card view
(authoring), Filter (the Active list does that job), the version line (the
console). A Playwright test reads the editor's View menu, zoom group and Filter
and fails on any id without a decision (finding 17).

## 2026-10-03: the Walls select, in the card and the editor

The `walls` option now has controls. Card: config key `walls` (junk is "cut"),
a Walls select next to the Tilt slider in 2.5D only, a field in the Edit-card
form. Editor: View > Walls beside Tilt, enabled in the 2.5D preview only. Both
pass it to `renderFloor`, so there is still one draw path.

Remembered like tilt. The card stores `walls` in its view entry (picked, saved
at once, restored before the first render, wins over the config until Reset
view); the editor stores it in `floorplan-studio:view`. Each reader checks it
against `WALLS_MODES` and drops anything else on its own, leaving the config's
(card) or "cut" (editor). The card's view-memory key gains `walls` only when
the config sets it, as for `tilt`, so cards without it keep their memory.
Chosen not to coerce a bad stored value to "cut": dropping it lets the config
decide, which is what the person set last.

## 2026-10-03: a stairwell lies below everything that stands

Diego, on 0.12.21: the first-floor stairs "just render a hole, not the stairs
going down, they are overlapping weirdly".

Cause. The well's pieces (ground, walls, treads, tread edges) were depth-sorted
together with walls, so a tread or stripe could be drawn over a wall or over the
hole's own border. Fix. A `Solid` may be `under`: drawn first, in key order among
its own kind, then the standing solids. The border of the opening (`well-edge`)
is drawn last among them. Each tread is veiled darker with depth, and each riser
twice as dark as the tread above it, so the flight reads as steps going down.
Only the rim (6 cm up) still sorts with the walls. 2D is unchanged.

## 2026-10-03: a straight wall has one cut; walls get a mode

Diego, again, on 0.12.21: "walls are still not all growing the same in the
designer".

Measured. The editor and the card call `renderFloor` with the same view, tilt,
rotation and `around`, and it draws walls from one function, so there is no
editor/card difference. Over the demo, every 5 degrees, tilt 0.5 and 1: the only
unequal pairs of overlapping walls differ by 0.06 in cut (about 10 cm). A
constructed layout showed the real defect: the cut was decided per edge, so one
straight wall that is several edges (a vertex in the middle of a line, rooms side
by side along it) could be cut at one end and tall at the other. The examples in
tests/core/walls-modes.test.ts fail without the fix at most turns.

Fix. Pieces on one line (3 cm), overlapping, or touching and facing the same
way, share the largest cut among them (`evenRuns`, solids.ts). Two walls on one
line that face opposite ways (an L-shaped house) stay two.

Not a defect, and left as is. In "cut" a wall at 0 degrees facing the viewer is
lowered to the cutaway while the side walls stay tall; at 30 degrees the two
sides differ again (the ease). That is the doll's house rule: it is how the
rooms stay visible. It reads as unequal walls, so the user now chooses.

Option. `walls` = "full" | "cut" | "low" (`WALLS_MODES`, `WALLS_LABELS`,
`wallsModeOf` in solids.ts; `RenderOpts.walls`; junk is "cut"). Full: model
height, no cutaway. Low: every wall at the cutaway height, never raised above its
own (a 110 cm fence at tilt 0.5 is 90; a 40 cm wall stays 40). 2D is byte for
byte unchanged. Default stays "cut": unequal heights are the rule working, not a
fault. Card key and the View menus come from the UI task.

## 2026-10-03: a cover is active only as a garage door, a gate or a door

Supersedes 0.12.20 ("a cover draws idle in every state"). Diego: "curtains
should NOT show active (they are covers but not the same as a garage door)".

Rule, in one function (`coverActive`, core/cover.ts; `classOf`, the Active list
and the room `on` class all read it): a cover is
on while its state is `open`, `opening` or `closing` and its `device_class`
attribute is `garage`, `gate` or `door`. Every other class, a missing or junk
class, and every other state read idle. Unavailable and unknown still read
unavailable. `COVER_CLASSES` lists HA's ten classes, so a class HA adds is idle
until someone writes it down (finding 17).

Where the class comes from. The `device_class` attribute of the entity's state,
read at draw time, which the overlay already carries. Chosen over a layout field
(`cover: "door" | "curtain"`): a layout field is a second source that can
disagree with HA, and the editor would need a select for what HA already knows.
No state, no attributes, or a state that has not arrived: idle. We do not guess
from the entity id (a "garage" in a name is not a class). Door lines are
unchanged: a door with a `cover` still draws orange when that cover is open.

On 0.12.21 itself a cover was never on in `classOf`; if a curtain still drew
orange on a dashboard, that was a cached 0.12.19 or older bundle.
## 2026-10-03: the view is remembered, saved on touch, and driven by keys

Diego, on 0.12.21: no rotate buttons in the editor; add Cmd/Ctrl+S, arrow
keys for zoom and turn, Space to reset; "the template and view resets between
reloads"; two editor dashboards in the sidebar. Decisions.

Cause of the reset, with evidence. The card's key (`fp-view:` plus a hash of
the config seed) is stable across reloads, and a Playwright reload of the
built card with the Home Assistant lifecycle (repeated `setConfig`, element
re-attach) kept zoom, centre, turn, view, tilt, theme and names. Those tests
pass on unmodified code, so the bug is not a moving key. What the card did
lose: the floor (never stored, so every reload landed on the first floor and
read as a reset), anything touched within 400 ms of leaving (the debounce
outlived the page, and nothing flushed on `visibilitychange`), and in the
editor everything: zoom, centre, turn, 2D or 2.5D, tilt and names were
session state and there was no memory at all. Fix: the card stores `floor`,
debounces 150 ms and flushes when hidden; the editor gets its own memory.

Editor memory. One key, `floorplan-studio:view`, per origin and not per
document: it says nothing about the plan, so an edited, opened or reset plan
keeps its view. Holds floor, mode, tilt, labels, the turn and, per floor, a
zoom against that floor's fit, a centre in plan cm and the box's aspect. A
floor shown whole is not stored, so a plan that grows is not clipped by an old
fit. Parsed field by field, capped at 50 floors, floor names as list entries
(a floor may be called `__proto__`). Read once, with the first layout; a floor
the host asks for wins. Theme, grid, measure and night keep their own keys.
Walls mode: not included. Its exports are not in this branch.

The turn. `EditorState.viewRot` (0..315) is added to `layout.rotate`. It is
not an edit: no undo step, never in the layout. Plan rotate (Edit) stays a
document edit and drops the views, as before. Animation is rAF, 350 ms per
step, none under reduced motion; a zoomed view keeps centre and zoom, a whole
view is refitted per frame.

Keys, one rule shared by card and editor (`src/card/view-keys.ts`). Cmd/Ctrl+S
first and everywhere (editor only). Then a typing target (input except
checkbox/radio/button types, select, textarea, contenteditable) owns
everything; a button, summary, link, checkbox or ARIA button also owns Space.
Ctrl/Cmd chords are never view keys. Alt and Shift are allowed. Editor keys
are heard on the editor host, never `window`. The card listens on `window`
but acts only for the card focused or hovered. No arrow nudge exists, so there
is no clash with a selection.

Sidebar. The integration registers one panel (`panel_custom`, url
`floorplan-studio`) and one config entry (`single_config_entry`). A second
"editor" in the sidebar is not made here: it is a dashboard Diego created
(Settings, Dashboards) or a leftover `panel_custom` / `panel_iframe` in YAML.
Remove it there. No code change in `custom_components`.

## 2026-10-03: plugs are active by watts, not by switch

Diego: "the plugs, show them active only if they are consuming power, not if
they are just on. from 2 watts and up." Decisions.

Field. Optional `power?: string` on a `plug` device (schema stays version 2),
an entity id of a power sensor, validated like `bound`: an entity id, plug
only, not the plug itself. Chosen over a card-side name guess: the layout
names the sensor, so the card works without a registry.

Auto-link. `findPowerSensor` (core/power.ts): same HA device, `sensor.*`,
device class `power`, no `entity_category`; only when exactly one. Two is a
guess and a wrong one paints a plug by another's draw, so the answer is none.
The editor writes it when a plug is placed (Add, area, catalog), in the same
undo step. The card repeats the search at runtime for plugs with no `power`,
from `hass.entities` (`device_id`, `entity_category`) plus the sensor's
`device_class` state attribute; an explicit `power` wins. `hass.entities` is
read as HA's frontend provides it; nothing is invented, and a frontend
without it just does not link.

The rule (one place, `classOf`; the Active list, the room ring and the
tooltip read it). Switch off: idle. Unavailable or unknown switch:
unavailable. Switch on and a readable sensor: watts >= threshold, so 2 W is
active and 1.99 W is not. Switch on and the sensor is unavailable, unknown,
junk or in another unit: active, as today. No sensor at all: active, as
today. We cannot know, and a flaky sensor must not hide a plug. Not marked
specially. Units: W and kW (x1000); a missing unit counts as W (HA power
sensors always carry one, so a bare number is a hand-made sensor); anything
else is unreadable.

Threshold. `PLUG_ACTIVE_WATTS = 2`, card config `plug_watts` (number >= 0,
anything else is 2), in the Edit-card form. 0 means any reading counts.

Not done. A light `bound` to a plug's switch still follows the bound light
rule (on if either entity is on): it is a lamp, not an appliance. A room or
furniture `entity` that is a plug's switch follows the rule only when that
plug is on the same floor as the room. The tooltip shows watts rounded to
one decimal, always in W.
## 2026-10-03: walls keep their height; the cutaway eases and only counts inner rooms

Supersedes the cutaway rule of 2026-10-02 ("the cutaway follows what a wall
covers") and the hard `ny` gates in `collectWalls`. From Diego's report on his
own Home Assistant, 2.5D: "some scale too much, others stay fixed, the walls
are not 3d anymore". Measured with a harness over the demo and hostile layouts
(grid, row, stacked, L, free walls, per-room heights), every user turn, tilt
0 to 1; the viewBox always held every face (57 216 points, 0 outside), and the
rule was covariant under a 90 degree turn of the layout. Two causes held:

1. A lawn behind the house cut the back wall. `coversFloor` counted every room
   and zone, so a garden, pavement, terrace, fill, water, structure or zone
   behind a wall made it "hide a floor". Put a garden round the 3x3 grid and
   all four back walls went from 250 to 90 cm, with the sides at 250.
2. The cut was a step. `ny > 0.3` flipped a wall from 250 to 90 in one frame:
   at 17 degrees of turn ten walls of the grid jumped 160 cm, and from 18 to 72
   degrees every inner wall was flat. During the 350 ms turn the walls popped.

Rule now (`solids.ts`): a wall has its model height, from `heights.ts`, wherever
it stands. It is lowered toward the one `cutaway` height by `cut` in 0..1.
- Facing the viewer (outward normal `ny > 0` in the screen frame, the same
  frame `renderFloor` turns by): `cut = ease(ny)`.
- Facing away: `cut = ease(-ny)` times how deep its lifted face reaches over the
  floor of a room of kind `room`, over 30 cm. Only `kind: "room"` is a floor
  to uncover; a zone, garden, pavement, terrace, fill, water or structure
  behind a wall never counts.
- A free wall: `cut = ease(|dx| / length)` on screen, so 45 degrees is judged
  like a room wall.
- `ease` is a smoothstep from `ny` 0.2 (side-on: full) to 0.6 (facing: cut), so
  sides, backs and 45 degree plans land on 0 or 1 and a turn in between eases
  over about 8 degrees. A shared edge takes the larger cut of its two sides.
- Drawn height is `h - cut * max(0, h - cutaway)`: a wall lower than the cutaway
  is never raised.
`obliqueFor` is unchanged, so the cutaway still hides about 50 cm on screen at
every tilt. 2D output and hit-testing are untouched. One test is superseded,
`backwall-cutaway.test.ts`: "a zone behind a back wall counts too" now says it
does not.

Stairs, not changed. A straight flight rises to the storey (250 cm by default),
by the spec and `solids-objects.test.ts`, and climbs along +x or -y of the PLAN,
so what faces the viewer depends on the turn: at 180 degrees the tall end is
nearest and hides up to 137 screen cm of floor. Proposed default, not done:
cap a straight flight's rise at the cutaway by `ease` of its screen climb
direction, like a wall. Say if you want it.

The first-floor Office is blue because `demo/layout.json` gives that room
`color: "#4a6fa5"`, in 2D as well. Not a bug.
## 2026-10-03: stair direction

Diego: the top floor shows stairs going up, not down, and stacked stairs
need both.

Field. Optional `direction`: `up`, `down`, `both` on a stair. Schema stays v2,
a missing field is valid, junk is a validate error and migrate leaves it.

Default. One resolver, `resolveStairDirection` in `src/core/stairs.ts`: an
explicit value wins; else up when a floor lies above; else down when one lies
below; else up. A lone floor and every lower floor draw as before. Auto never
gives `both`: a middle floor going both ways is a choice. Proposed default;
say if the top floor should stay up until set.

Marks. 2D adds an arrow only for down and both, so up stairs stay byte for
byte. Down also shades the treads. 2.5D: down is a stairwell (clipped to the
footprint, treads sinking, walls darkened by `--fp-night`, short rim on the
near edges); both is the rise plus a kerb. Chosen over a hole cut in the
floor polygon, which would touch room and wall code another change is editing.

Context. `renderFloor` knows one floor, so it takes `around: {above, below}`
(`floorsAroundKey`). No `around` reads as up.

## 2026-10-03: motion zones and groups, a motion perimeter, idle covers

From Diego's field report. Four calls.

Rows. A device with two or more live (non-`cat`) motion binary_sensors lists
each as its own row, like switch gangs, named by `asGangRow`. The device's
main entity keeps its row when it is not a motion entity. A device with one
motion entity is unchanged (its main entity, named by the device), so a
light plus one motion sensor still shows the light only. Proposed default;
say if a lone motion sensor beside a light should show too.

Groups. `typeForEntity(e, ha?)` takes the entity list; a `group.*` is
`motion` when every member is motion (nested groups count, depth cap 4, a
cycle or unknown member means no). Without `ha` it is `other`, as before.

Perimeter. One class, `.motion-perimeter`, drawn after the wall lines. The
room outline is stroked wide and masked to a band between the wall reach
(widest wall plus halo, plus 2 cm) and 2.5 cm further, so a concave room needs
no offset-polygon arithmetic. Colour `--fp-dev-motion`, `--fp-dev-radar` for a
radar. Chosen over a computed inset polygon, which breaks on narrow or
self-touching shapes.

Covers. `classOf` reads a cover as off in every live state; `.dev-cover.on`
is gone; the Active list rule is `never`. Furniture and rooms bound to a
cover entity still ring when it is open (a gate), and doors with a `cover`
keep their orange line: Diego asked about curtains. `--fp-dev-cover` stays a
token for old configs but nothing paints with it.

## 2026-10-02: the card turns in 45 degree steps and remembers its view

Asked for by Diego: rotation, memory of the view, a reset button. Four calls.

Animation. A requestAnimationFrame loop re-renders the plan with the angle
eased (cubic in-out), about 350 ms a 45 degree step, scaled 0.4x to 2x by the
steps outstanding so a tap on a tap does not crawl. Chosen over a CSS
transform on the SVG because `renderFloor` rotates geometry and keeps text and
icons upright, and a CSS turn would spin them. Measured in headless Chromium
on the demo, a 45 degree turn held 60 fps (mean 16.7 ms, worst 16.8 ms) in 2D
and 2.5D. The loop is skipped under
`prefers-reduced-motion`. The delta is the short way (315 to 0 is +45).
Pointer events are off on the plan while it turns, so no tap lands on a moving
target.

Storage. Key `fp-view:` plus the hash of the Active list's seed, extended with
`view`, `rotation`, `theme`, `tilt`, `labels` when set in the config. Value
`{v:1, rotation, view, tilt, theme, labels, zoom, focus}`, each optional.
Zoom is a ratio to the fit and focus a point in plan cm, so the view survives
a resize and a rotation. Saves are debounced (400 ms) and flushed on
`pagehide` and disconnect. It is a separate key from the Active list so a bad
entry in one costs nothing in the other. Parsing is field by field: a bad
field drops alone, zoom and focus only as a pair.

Stored wins over config. A remembered pick is the viewer's last word; the
config is the author's default. When the author edits the config the seed
changes and the memory starts clean, so a deliberate edit is never hidden by
an old pick. Cost: editing any seed key forgets viewers' views once.

Reset returns to the config, not to zero. Reset view sets rotation, view,
tilt, theme and labels back to what the YAML says and clears the memory; the
floor stays. A card the author turned to 90 resets to 90. On a pinned card
the Fit button is renamed Home view, since two buttons both named Reset would
differ in meaning (zoom only against everything).

## 2026-10-02: a room inside a bigger room paints after it

Diego's garden house was still under the garden: fills paint in `Floor.rooms`
array order, and "Bring to front" (2026-09-28) fixed one file by hand, not the
cause. Decided: `renderFloor` sorts fills by nesting depth (how many larger
rooms contain every vertex of this one), after the zone-last rule, stable
otherwise. Not-nested rooms keep array order, so existing layouts change only
where a small room was hidden by its parent. A degenerate or non-finite ring
has depth 0 and never counts as a parent. Bring to front and Send to back stay
for rooms that overlap without containing each other.

## 2026-10-02: the cutaway follows what a wall covers

Supersedes the "known limit" in the tilt entry below. A wall is cut to
`cutaway` when it would hide a room, not when its own room is in front of it.
Rule, in `collectWalls` (`solids.ts`): an edge whose outward normal points up
the screen (`ny < -0.3`) is also cut when its sweep, the parallelogram from its
base along the lift `h * (rise * skew, -rise)`, overlaps the floor of any room
or zone by more than 25 cm squared. Only the outward side counts, so a room
never cuts itself. Overlap is a Sutherland-Hodgman clip of the room outline
against the sweep, so an L-shaped room works. The whole segment takes the cut
when part is covered: a wall that steps along its length reads as a fault.
Side walls (`|ny| <= 0.3`) and free walls keep today's rule. Why not by edge
owner: the Hall's north wall and the Living room's south wall are different
edges of different length, so dedupe never paired them. The default 2.5D output
changes (walls between a back room and a front room); 2D does not. At tilt 0
the sweep has no area and nothing is cut, which is invisible. `Proj` gains
`rise`.

## 2026-10-02: tilt, and labels as a render option

**Tilt.** One function, `obliqueFor(tilt)` in `render.ts`, maps a 0..1 tilt to
`{ rise, skew, cutaway }`, and `renderFloor`, `viewBoxFor` and the solids all
read it, so the box cannot disagree with the drawing. `rise = tilt * 1.1`:
linear, so the default `DEFAULT_TILT = 0.5` gives exactly 0.55 and the old
`OBLIQUE` (returned as is, so default output is byte for byte what it was).
Tilt 0 is rise 0: nothing lifts, faces have no area, tops sit on the plan, and
it reads as 2D. Tilt 1 is rise 1.1: steep, a 250 cm wall is drawn 275 units tall, more than
most rooms are deep, so the slider stops there. `skew` stays
0.3; it decides which faces show, not how tall they are. `cutaway` holds what
a front wall may hide on screen constant: `round(49.5 / rise)` cm (90 at the
default, 45 at 1), capped at 200 where there is no lift to hide anything.
`viewBoxFor` widens by `tallest * rise` and `* skew`, the actual lift. Junk
is the default, a number clamps. The slider is session state in the card and
the editor; only `tilt` in the card config persists.

Known limit, not changed: a room's back wall that is longer than the front
wall of the room it borders is a different edge, so it is not de-duplicated
and keeps its full height. At a steep tilt it hides the front of the rooms
behind it (the Hall's north wall over the Living room). Fixing it changes the
default output too.

**Labels.** `labels?: boolean` is a `renderFloor` option, not a card CSS rule
or an editor filter, because every text on the plan is made in that one
function (finding 8): the card and the editor then cannot differ, and a test
can walk every text-producing kind. `false` skips the `<text>` and leader
elements; the text placer still runs, so nothing else moves. The editor's own
overlay text (the measure grid numbers and the lengths) is an aid, not plan
text, and stays; the Names button keeps its meaning. Absent means true.

## 2026-10-02: the 2.5D view (docs/specs/heights-and-2-5d.md)

2.5D is drawn by `renderFloor`, the one draw path, for the card and the editor.
No `view`, or `"2d"`, is byte-identical to before; every 2.5D addition sits
behind `view === "2.5d"`.

**Projection.** A vertical oblique: a point `(x, y)` at height `h` is drawn at
`(x + h*rise*skew, y - h*rise)`, with `OBLIQUE = { rise 0.55, skew 0.3, cutaway
90 }` in one place. Horizontal planes are not distorted, so a floor is still a
true plan and a distance on it still reads in cm. An isometric or perspective
view would shear the floor and every icon with it. Back-to-front order is the
depth `y - skew*x` of the screen position, nearest last. A turned plan turns
the lift vector back so up stays up on screen. `viewBoxFor` widens the box by
the tallest thing drawn.

**Cutaway.** A wall whose outward normal points down the screen (`ny > 0.3`) is
drawn at most 90 cm. Without it every house hides its front rooms behind its
front wall. Back and side walls keep their height. A free wall has no outside,
so one that runs mostly across the screen counts as front. A doubled wall is
drawn once: the taller wins, front is OR-ed, external wins. 90 cm keeps a sill
(90) just visible; it is a tunable.

**Floor-level things keep their plan position.** Room fills, flat edges,
device icons, labels and door lines are not lifted. A tap, a hit-test, a drag
and the plan coordinates all stay true, and the editor needs no inverse
projection. The cost: an icon for a ceiling light sits on the floor with a stem
up to the lamp (from 100 cm), not at the ceiling. That is a choice for
legibility and taps. Solids are drawn between floor-level things and labels and
take no taps (CSS classes, not presentation attributes, CLAUDE.md finding 18).

**The editor preview is read-only.** Editing a 2.5D picture needs the inverse
of the projection for every gesture, and a click on a lid or a wall face is
ambiguous: which height did the user mean? A preview that cannot edit is honest
and costs one guard per entry point. View mode is session state: no undo step,
not in the layout, not stored.

**3D is a different renderer.** True 3D needs a depth buffer, perspective and an
orbiting camera, which SVG does not paint. It will be its own renderer reading
the same heights, behind the same `view` option as a third entry. Nothing here
is written to be stretched into it.

## 2026-10-02: heights are in the model, as optional fields (docs/specs/heights-and-2-5d.md)

First step toward 2.5D: every solid thing can carry a height, with no drawing
change yet. Fields, all cm, 0 to 1000, all optional: `Floor.height` (250),
`Floor.slab` (25), `Room.height` (the floor's), `Wall.height` (by kind: fence
110, edge and boundary 0, wall and external the storey), `Door` and `Opening`
`height` and `sill` (door 210 from 0, window 120 from 90, opening 210 from 0),
`Furniture.height` (by symbol), `Unlinked.height` (by type), `Device.z` (by
type). `Stairs` and `Extra` get none: a rise is the floor's, an extra is flat.

Defaults are read through resolvers in `src/core/heights.ts`, never stored. If
the editor wrote 250 into every wall, changing the default later would change
nothing on old plans, and a file from an assistant would be full of numbers it
never read. A missing field is the honest value for "the drawing does not say".
The editor therefore removes the property on an empty field and shows the
default as a placeholder.

Schema stays version 2. Every field is optional, so an old file is a valid new
file and a new file with no heights is a valid old one; a version bump would
only force a migration that does nothing. `validate` refuses a value that is not
a finite number from 0 to 1000; `migrate` drops one so the file still opens.
Every resolver also falls back to the default on junk, since layouts are
untrusted input. `DEVICE_Z`, `UNLINKED_HEIGHTS`, `FURNITURE_HEIGHTS`,
`DOOR_DEFAULTS` and `WALL_KIND_HEIGHT` are tested against their unions, so a new
member fails until someone decides its height.

## 2026-10-02: small-room names shrink then go outside on a leader; Active list folds under 480 px (0.12.17)

Diego: "fix small room collision". In the demo "Garden" sat on the pond inside
it and "Garden pond" (72 wide) ran over the garden's edge. The rule now, per
room name: measure the room's horizontal chord at the anchor row in the screen
frame; if the text box (len x 0.6 x size) is wider, shrink to a floor of 7k
(zones 6k), centred. Still too wide: place it just outside the room, below or
above, on a thin `lbl-leader` line back to the anchor, drawn under the text and
chosen so the line crosses no other text. The leader exists only in that case.
A name's spots also skip any smaller named room inside its own. A name that fits
but finds no free row still keeps its centroid (the documented last resort,
unchanged). Costs: three old tests pinned superseded values and were adjusted
(zone label 16 became 14.29 at scale 0.5; the rotation test no longer compares
label positions, which depend on the screen frame; the two-zones test uses 60
wide zones, since a 40 wide one now sends its name outside).

Active list: the old default (collapsed under 500 px, once, only with nothing
stored) left the list open over a phone plan as soon as a drag had written a
position. Now the card's width decides, under 480 px folded, and follows a
resize, until the user folds or unfolds it by hand; storage keeps `chosen` and
a drag alone does not set it. An old entry saying collapsed counts as chosen.
The 500 px assumption in the 2026-09 entry is superseded; 480 px is the new
guess (a 375 px phone, a narrow column), checked in Chromium only.

## 2026-10-02: room names smaller, half transparent, inside their room (0.12.16)

Diego's screenshot: "Laundry" sat on the edge of the next area. Cause: the
label anchor was the vertex mean, which is outside an L or U room, and the
candidate spots were never checked against the room. Now `centroid` falls back
to the middle of the widest stretch along the mean's row, and `rows` puts spots
inside the room first; outside spots stay as a last resort, so a name longer
than a tiny room (the demo's pond) still avoids doors and icons. Sizes 14 to
11 (zones 10 to 8). Room names get `opacity=".5"` as an attribute (device labels
share `.lbl` and must not fade); zones use `.lbl.zone{opacity:.5}`. Not
reproduced on Diego's own layout (private); the fix is tested on an L shape.

## 2026-09-28: card default view, pan and zoom-out fixed (field report, 0.12.14)

Diego's screenshot: the card's default zoom clipped a garden shed, with no
way to drag or zoom out to see it. Three separate bugs, traced to
`viewBoxFor` (`src/core/render.ts`) and `src/card/viewport.ts`:

1. **The default view bounded only on `f.outline`.** A garden, a shed, a
   structure outside the walls — anything a room, wall, stair or piece of
   furniture drew past the outline — was clipped, with no way back to it.
   `viewBoxFor` now bounds on a new `structuralPoints(f)` (outline, rooms,
   stairs, walls/doors/openings/extras, furniture, unlinked). Devices still
   widen the box only by their own reach (a lit lamp, a camera), and only
   when already near the rest of the plan — a device dragged or imported far
   outside stays off view, unchanged from before (S5.7, S8.13's own
   regression test). `contentPoints` (used by the editor's Re-center) is now
   `structuralPoints` plus devices, keeping its own wider contract.
2. **Zooming out never went past `fit`.** `clamp()` (`src/card/viewport.ts`)
   hard-floored at exactly `fit`'s own width. A new `MIN_ZOOM` (0.4, so the
   view can widen to 2.5x `fit`'s own box) replaces that floor, the same way
   `MAX_ZOOM` already bounds zooming in.
3. **`zoom: false` disabled panning along with zoom.** `_bindZoom`'s
   `onDown`/`onUp` (`src/card/floorplan-studio-card.ts`) now gate only
   pinch, wheel and double-tap zoom off `_zoomMode()`; a one-finger drag
   always reaches `_setView` regardless. Note this only moves the view when
   there is somewhere to go — a card pinned narrower than `fit` via
   `center`/`zoom_level` — since `clamp()` correctly snaps a pan straight
   back to `fit` when the whole floor is already on screen (nothing to
   reveal, not a bug; see `viewport.test.ts`, "at fit zoom there is nothing
   to pan").

## 2026-09-28: `Room.label` removed from the schema

Diego noticed the plan still showing an internal label under a room's name
(office read "BURO") with no way to change or clear it. `Room.label` had no
editor UI to set or edit it — confirmed by reading `roomPanel()`
(`src/editor/panels.ts`) — so any value in it came from a hand-edited or
LLM-written file, or stale data from before the field went dead; the two
shipped demo layouts (`demo/layout.json`, `demo/layout.v1.json`) carried it
as an empty string on every room, confirming it was already orphaned.

Decided: drop the field entirely rather than keep hiding it. Removed from
the `Room` interface and its validation (`src/core/schema.ts`); `migrate`
now deletes a stray `label` from an old file instead of defaulting it to
`""` (`src/core/migrate.ts`); `renderFloor` no longer computes or draws a
second line of text under the room name (`src/core/render.ts`); the editor's
room-creation paths stopped setting it (`src/editor/draw.ts`,
`src/editor/editor-app.ts`); `docs/SPEC.md` and the demo layouts were
updated to match. A layout an LLM or a stranger wrote may still carry the
field (finding 1, untrusted input) — `migrate` strips it silently rather
than erroring, so an old file still loads, just without the dead text.

## 2026-09-28: rooms and zones can be sent to back or brought to front

The problem: a room's fill paints in `Floor.rooms` array order (the array
index doubles as paint order — see `renderFloor`, `src/core/render.ts`), and
there was no way to change that order from the editor. Diego drew a garden
zone that landed after the garden house in the array, so its pavement fill
covered the garden house's own pavement; only the walls (a separate, later
draw pass) stayed right — the room fills stacked wrong with no fix short of
deleting and redrawing.

Decided: the room right-click menu (`roomCtxItems`, `src/editor/editor-app.ts`)
gets two new items, "Bring to front" and "Send to back", next to the
existing "Change colour" and "Delete". Each moves the room to the end or the
start of `f.rooms` (`ctxBringToFront`/`ctxSendToBack`), one undo step, a
no-op when the room is already there. This is a plain array reorder, so a
`zone`-kind room's own always-paints-last rule (`renderFloor`'s stable sort)
is untouched — the new items still let two zones (or two non-zone rooms)
swap order relative to each other, which is what fixed the reported bug.

## 2026-09-28: a new device spawns at the viewport centre, not right of the house

The problem: every "Add device" flow (`Add > Entities`, `Add > Device` from the
catalog with no matching room, `Add > Unlinked device`) placed the new item
outside the house's outline, top right (`spawnPoint`) — off in a corner the
person then had to scroll or zoom out to find, on a plan that already fills
the screen (Diego).

Decided: a new function, `spawnInView` (`src/editor/ops.ts`), places a device
at the current viewport's centre instead, snapped to the grid; it still
nudges right in 40 cm steps to clear a point already on the floor within 20
cm, so adding several devices in a row without moving the view does not stack
them past reach — the same anti-stack idea `spawnPoint` already used, just
anchored to the screen instead of the house. `spawnPoint` itself is
unchanged and still used for a wall, a structure, a zone, stairs or
furniture — this only affects a device or an unlinked appliance.

## 2026-09-28: a window's or glass door's own `cover` is curtains, not a security state

The field problem: Diego's office window has electric curtains wired as a
`cover` entity (schema.ts's own field doc: `cover` doubles as the
electric-curtain field on a glass door or window). Opening the curtains
turned the window orange (`.cover-open`), reading as a security warning for
an action that carries none — a plain door's or sealed opening's `cover` is a
shutter or garage opener, where that colour is earned.

Decided: `renderFloor` (`src/core/render.ts`) only sets `.cover-open` on a
`door` or `sealed` kind; a `window` or `glass` door's cover state never
colours the opening, no schema change needed. At the same time, an attached
`lock` (`Door.locks`) left `unlocked` now marks the opening `open`, the same
dashed red and pulsing alert line as a triggered contact sensor — an unlocked
door or window is exactly that kind of security state, and it had no visual
before this. `docs/SPEC.md`'s device table (binary_sensor/lock row, cover
rows) documents both.

## 2026-09-28: `roomEmpty` role override, and a sixth theme, beach-house

The field problem: `a-team`, `space`, `cyberpunk` and `carpenter-brut`
(below) all render their unpainted rooms in the one fixed light grey every
theme has shared since 2026-09-21 (`--fp-room-empty`, `#d6d6d2`) — against
their own dark, saturated walls it read as a hole punched through the plan,
not a neutral "not yet painted" room (Diego, field review). `terminal` and
`blueprint` are dark too but never had this complaint; `coffee`'s own warm
base carries the plan enough that the shared grey still sits fine there.

Decided: `ThemeRoles` (`src/core/theme-roles.ts`) gets an optional
`roomEmpty` field, defaulting to the classic `#d6d6d2` so every existing
theme is unchanged. `a-team`, `space`, `cyberpunk` and `carpenter-brut` each
now set their own dark shade of their own base instead
(`src/core/render.ts`). `coffee` keeps the default, deliberately, and so do
every light theme.

Also decided, same request: a sixth new theme, `beach-house` — sand for the
base (light, not dark), sea teal for the measurement line, palm green as the
accent. It is a light theme, so the shared `roomEmpty` grey is not a problem
for it, same as `light`/`slate`.

`docs/SPEC.md`'s theme count, config comment, role table and prose are
updated in the same commit as the code, and `scripts/theme-shots.mjs` is
re-run for all thirteen themes.

## 2026-09-28: five more role-generated themes, Diego's picks

Decided: add `coffee`, `a-team`, `space`, `cyberpunk` and `carpenter-brut` to
`THEMES`, each a `rolesToTokens()` preset like `blueprint`/`slate`/`terminal`
— pick base, foreground, line and accent, get a whole theme. Twelve built-in
themes now. `docs/SPEC.md`'s theme count, config comment, role table and
prose are updated in the same commit as the code
(`378c3e7`/`6c0b2f4`/`fc4e83e`), and the README gets a gallery image per
theme (`scripts/theme-shots.mjs`), on a neutral grey page background rather
than white — a light theme's own plan otherwise has no visible edge against
GitHub's white page and the gallery loses its card framing.

## 2026-09-28 the editor shows live Home Assistant device state, always on

Until now the editor never received `hass.states` at all (`renderFloor` was
called with no `state:` key), so every device drew idle/off and no room ever
glowed — deliberate, per the "Preview night" button's own tooltip ("the
editor has no live lights") and several `editor.spec.ts` CSS-pair tests that
hand-inject `.on`/`.lit`/`.aura` classes to test the rules in the absence of
real state. Diego asked to see actual device colours and status while
editing, not just the layout.

Decided: always-on, not a toggle and not tied to Preview Night — whenever the
editor runs inside Home Assistant (a live `hass`), studio mode looks exactly
like the card: lit lights, motion fade, room glow, everything `renderFloor`
already draws from a `state` overlay. `panel.ts` pushes `hass.states` into
the editor element imperatively (`ed.hassState = ...`, `panel.ts:100`-ish),
the same pattern already used for `ed.ha`/`ed.writer` — never through a
template binding, because the render `guard([layout, dark])` (CLAUDE.md
finding: "the panel must never re-run the editor's layout setter") must stay
narrow, and a state-carrying binding inside that guard would either never
update or defeat the guard's whole purpose. `editor-app.ts` gained its own
`_lastOn`/`stateForRender`/`motionFading`/`syncFadeTimer`, mirroring the
card's `_recordLastOn`/`_stateForRender`/`_motionFading`/`_syncTimer`
exactly, so a motion sensor keeps fading in the editor the same way it does
on the card. The core render layer needed no change — `RenderOpts.state` and
`editor: true` already worked together (`tests/core/render.test.ts:330`
already exercised both). `roomGlow: true` is now always passed by the
editor, since it has no `room_glow` config to read the way the card does.

## 2026-09-27 S10.6: a door's sensor/vibration/lock picker offers live HA entities too, not catalog-only

The field bug: a Yale Linus lock existed in Home Assistant, as domain
`lock.*`, and never showed in the front door's "smart locks" dropdown.
`doorAttachChoices` filtered `layout.catalog` only, and nothing put a lock's
catalog entry there except placing it as its own icon on the plan first — a
round trip through Add that a switch bound under a light never needed
(`lightFromSwitch` catalogues that derived light with no icon step).

Decided: `doorAttachChoices` now also offers HA entities of the matching type
that are neither placed, catalogued nor attached (`unplacedHaEntities`),
shaped as a placeholder `CatalogEntry` the same way `controlsChoices` already
does for HA groups. Picking one still goes through `attachEntity`, which now
creates the real catalog entry at that moment if none exists yet, in the same
undo step as the attachment — so undoing the attach removes both. This covers
sensors, vibration and locks, the three fields `doorAttachChoices` serves;
`coverChoices`, `deviceAttachChoices` (heater trvs/tempSensors, ac linked) and
`unlinkedAttachChoices` share the same catalog-only gap and are not fixed
here — a separate task.

## 2026-09-27 S10.5: "in use" beats "unplaced" — an attached entity is never offered in Add either

The field bug: S10.2 pulls an attached entity's icon off the plan (it is now
shown through the door/heater/ac/unlinked item it is attached to), so the
entity drops out of `placedEntities`. Every list that offers an entity to
place ("not yet placed") only ever checked `placedEntities`, so the same
entity re-appeared in Add, the room's "Add device from &lt;area&gt;" menu and the
Place popup — a user could place a second icon right next to the door that
already reads the sensor.

Decided: "not yet placed" means neither placed **nor attached**. A new core
helper, `attachedEntities(layout)`, collects every entity named in a door's
`sensors`/`vibration`/`locks`/`cover`, a device's `trvs`/`tempSensors`/
`linked`, or an unlinked item's `attached` — across every floor — and every
placing list (`unplacedCatalog`, `unplacedHaEntities`, `placeableDevicesInArea`,
`unplacedDevicesInArea`, `addCandidates`, and the `placed` flag in
`availableEntities`, the File > Export snapshot) subtracts it, the same way
each already subtracts `placedEntities`.

Two fields that look like attachments are deliberately excluded:

- A light's `bound` switch. It never loses its own icon (CLAUDE.md's domain
  notes: "a switch may keep its own icon") — it was never pulled by
  `attachEntity` to begin with, so nothing here needs to change for it.
- A light's `motion` link, a person's `room` sensor, and a radar's `targets`
  pairs. All three are set through a plain commit, never `EditorState.attachEntity`
  — none of them removes an icon, so each stays independently placeable, same
  as before S10.2.

The attach pickers themselves (`doorAttachChoices`, `deviceAttachChoices`,
`unlinkedAttachChoices`, `coverChoices`) are unchanged: they already handle
"attached elsewhere on this kind of list" their own way, and still offer a
placed entity labelled "(on plan)" — that label is informational, not a
placing list, so S10.5 leaves it alone.

## 2026-09-27 S10.2: detaching an attached sensor returns it to Add, never back onto the plan

Diego's request: attaching a placed sensor to a door (or a heater, ac, or
unlinked item) pulls its icon off the plan — it is shown through the thing
it senses, not doubled. The open question was what happens on the way back:
does Remove put the icon back where it stood, or send the entity to Add like
any other removed device?

Decided with Diego: **Add**, same as "Remove from plan" on a device panel.
Reasons:

- The plan has no record of where the icon used to be once it is gone — the
  device panel's own "Remove from plan" already forgets a device's `x, y`
  for exactly this reason, and reusing that one behaviour (rather than a
  second one that reconstructs a position) is the simpler design (CLAUDE.md
  section 8: KISS, a helper only at a real boundary).
- A user who detaches a sensor rarely wants it back exactly where it was —
  they are usually reattaching it elsewhere, or done with it on the plan
  altogether. Add is one click away either way; guessing a placement wrong
  costs more than asking again.
- Symmetry: attach removes an icon the same way delete does (`f.devices`
  splice), so detach restoring it the same way delete's "returns to Add"
  does is the one behaviour to test and explain, not two.

The catalog entry itself is never touched by either direction — only
`f.devices` (or `f.floors[k].devices`) gains or loses an entry, exactly like
placing and removing any other catalogued device.
## 2026-09-27 S10.4: tapping always picks an entity, never guesses; a light's `bound` switch is left out on purpose

The brief: "tapping an object with attachments (heater/ac/etc.) should open
more-info directly if it has exactly one entity, else open a chooser dialog
listing all of them." Three decisions followed from applying that literally
— the third corrects the first build of this feature, reviewed the same day.

**Why a chooser, not the first entity, not a cycling tap.** A heater with
two TRVs, or a radar's own x/y target pair, has no entity that is obviously
"the" one — picking the first silently hides the rest, and a second tap
cycling through them needs the person to already know how many there are
and to keep tapping to find the one they wanted. A dialog costs one extra
tap on the two-or-more case and nothing on the overwhelmingly common
one-entity case, and it is the same shape the project already trusts for a
"more than one plausible action" moment (S2.7's cover confirm, S7.10's
vacuum dialog) — Escape, Cancel, one dialog at a time, focus on open.

**Why `entitiesOfDevice` leaves out `light.bound`, `light.motion` and
`person.room`, even though each is a real, schema-defined attachment
(finding 17 says every member of a union is a decision, not a default).**
All three already have an existing, documented path to the same information:
- `light.bound` — docs/SPEC.md already says a long press on a light opens
  more-info for the light itself, and the switch is reachable *from inside
  that dialog* (Home Assistant's own more-info shows related entities). A
  chooser offering the switch again here would be a second, competing route
  to the exact same place, and would silently change an existing, working
  behaviour that nobody asked to change — the brief's own examples were
  "heater/ac/etc.", not light.
- `light.motion` and `person.room` — both name the *sensor* an automation or
  the room-presence feature reacts to, a different real-world device from
  the light or the person themselves (normally already its own icon on the
  plan). Listing it here would blur "this is another entity of this light"
  with "this is the thing that tells this light when to react," which are
  not the same claim.

Each exclusion is written down at the one place a future device type would
need to make the same call — `src/core/attachments.ts`'s own doc comment —
and covered by a dedicated `actions.test.ts`/`attachments.test.ts` test per
exclusion, so a later change that adds `bound` back in has to delete a test
that says why it isn't there, not just add a line.

**Why the chooser's backdrop closes on a click, unlike the cover/vacuum
dialogs' backdrop (no click handler at all).** The chooser is reached by a
tap or hold that the person did not necessarily intend as "open a dialog" —
holding a heater to see one TRV's more-info should not trap them behind a
modal with no low-effort way out if what they actually meant was the
device sitting right behind it. Escape and Cancel already exist on every
dialog; adding backdrop-click here (and only here) costs nothing on the
cover/vacuum dialogs, which stay exactly as they were.

**Review fix, same day: the chooser lived on the wrong gesture for a
toggling device, and a cover door's other attachments and an unlinked
appliance were unreachable by any gesture at all.** The first build kept a
plain tap toggling a heater or an ac and put the chooser on the long press.
That is backwards: a bare tap is exactly the gesture that guesses which of
several entities was meant — the thing this whole feature exists to stop —
so the chooser now lives on the tap for any device that names more than
one entity, and the long press instead opens more-info for the device's own
entity, the same thing a long press always did before this feature existed.
A device naming exactly one entity is untouched either way.

The same review found that a door with a `cover` returned before any
long-press timer started, so a door's other attachments (a sensor, a
vibration sensor, a lock) were reachable by no gesture at all once it also
had a cover — only the tap's own confirm dialog ever opened. `cover` was
until now deliberately left out of `entitiesOfDoor`'s list, on the reasoning
that only a tap read that list and a cover door's tap never reaches it. Once
a long press reads it too, that reasoning no longer holds: `cover` now comes
first in the list, and a long press on a cover door opens the chooser (the
cover entity included) instead of doing nothing. A plain tap is unaffected —
it still always opens the confirm dialog first (S2.7) — and kiosk mode
(no long press anywhere) still only ever opens that dialog.

Last, an unlinked appliance (S4.25 — a plan icon placed by type, with no
linked entity of its own, only an optional `attached` list) had no gesture
wired to it at all: a tap did nothing, whatever it named. It gets the same
tap resolution as everything else in this feature — one entity opens
more-info, more than one the chooser, none does nothing — but no toggle and
no long press, since it names no on/off state of its own to guess at in the
first place.

## 2026-09-27 S10.3: a vibrating door is solid red, not a new dash pattern

A triggered vibration sensor on a door needed a visual distinct from "open"
but related to it — Diego's brief named the colour ("whatever colour is
decided, on contact sensor / vibration / crash") but left the line style
open. Two options:

- **A second dash pattern** (say, a tighter dash, or dots) for "vibrating".
  Rejected: the plan already carries one dashed line meaning "open"
  (S9.1); a second, different dash reads as a subtly broken version of the
  first at a glance, and a door that is open and vibrating at once would
  need a third pattern or an arbitrary tie-break between two dash styles.
- **Solid red**, reusing `--fp-open-door` (so `open_color` still applies to
  both states) and the same pulsing alert line as an open contact. Solid vs.
  dashed is the strongest visual contrast the plan already has, needs no new
  token, and settles the open+vibrating case for free: dashed still means
  "open" whenever it is present, solid or not.

Implementation follows from the choice: `render.ts` adds one `.door.alarm`
CSS rule (stroke colour only, no dasharray) placed before the existing
`.door.open` rule in source order, so when both classes are present,
`.door.open`'s own dasharray declaration — asserted after, same
specificity — wins on that one property while the shared stroke colour
agrees either way; the alert line is drawn once when the door is open,
vibrating, or both, never twice.

## 2026-09-27 S10.1: a custom `<fp-combo>`, not `<datalist>` or `ha-entity-picker`; device entities lose one level of nesting

Diego asked for a filterable combo box on every entity picker. Two off-the-
shelf options were rejected:

- **`<input list>` / `<datalist>`.** No group headings, no keyboard control
  over which match Enter commits (the browser's own, inconsistent across
  engines), and no way to intercept Escape before it reaches the editor's
  own shortcut handler. It would have looked filterable and behaved like a
  worse `<select>`.
- **Home Assistant's own `ha-entity-picker`.** It ships inside `frontend`,
  which this project deliberately does not depend on (CLAUDE.md finding 9:
  no runtime lock-ins beyond `--fp-*` variables and inlined icon paths); the
  standalone editor and the demo run with no Home Assistant frontend at all.

`fp-combo` (`src/editor/combo.ts`) is a small Lit element instead: a plain
text input, a flat `<ul role="listbox">` of options and group headings, and
its own keyboard handling. `filterCombo` (the matching itself) is a pure
function, unit-tested with no DOM; everything DOM-shaped (focus, Escape,
undo-step timing, the editor's own shortcut guard) is a Playwright test,
since CLAUDE.md finding 4 rules out DOM behaviour proven only by a pure
function's test passing.

**Deliberate deviation from the brief's literal shape:** a device's entity
list (`#ve`, `deviceEntity` in `panels.ts`) used to nest two `<optgroup>`
levels — a tier (In room / Elsewhere / Everything else), each holding one
`<optgroup>` per device that owns several entities. `<optgroup>` cannot
nest, so the original picker faked it with two separate group elements at
different visual indents; `fp-combo`'s own groups are one flat level by
design (a group is just an option's `group` string, matched by the filter
too). Nesting is flattened into one label per row: a device's entities get
`"<tier> · <device name>"` (for example `"In Kitchen · Kitchen light"`), and
a tier's own loose entities (no owning device) keep just the tier's label.
The list still reads top-to-bottom in the same order as before; a user
loses the visual double-indent, not the information. Migrated tests read
this via a new `comboGroupOptionLabels` helper that walks the flat list by
heading text, in place of the old `optgroup[label="X"] option` selector.

A `<select>`'s options are always in the DOM; `fp-combo` only renders its
`<li>` rows while open (closed, it shows the current value's label, plain
text). Every helper that used to read `<option>` — count, value, label — now
opens the combo, reads the `<li>` rows, and closes it again with Escape, so
a read never leaves a list open behind it for the next assertion.

## 2026-09-27 S9.6 review: − reaches the whole floor, Fit becomes Reset view, center is plan cm under rotation

A second Opus review, of S9.6 (the pinned card) on top of the first S9 review,
found the zoom buttons' disabled state, `center`'s handling under a rotated
layout, and three smaller bugs. Why each fix is what it is:

- **"−" and Fit/Reset must not share one condition.** The old `atFit` compared
  only the current box's width against home's, so it answered two different
  questions ("can I zoom out more?" and "is there anything to reset?") with
  one number and got both wrong on a pinned card: "−" disabled the moment the
  card loaded (there was more floor to see), and Fit disabled after a
  same-width pan or a pinch past home, with no button left to bring the pin
  back. "−" now stops only at the whole floor; Fit/Reset is disabled only
  when the view has not moved from home (`_view === null`). A pinned card's
  reset button reads "Reset view", since "Fit" would claim it shows the whole
  floor, which it does not.
- **`center` is plan cm, so it must survive rotation.** The editor keeps
  `st.view` unrotated and rotates only the drawing; the card bakes rotation
  into `fit`/`pinnedView` directly. Rotating the config's `center` by the
  layout's own `rotate` before pinning (in the card, not the editor, since
  `copyCardView` already emits unrotated plan cm) keeps "plan cm" true on
  every layout, not only an unrotated one.
- **`zoom_level` from Copy card view takes the smaller of the width/height
  ratio**, not the width alone, so a card never shows less of the editor's
  own view than the editor did, whatever its aspect.
- **The Active panel's storage key adds `center`/`zoom_level`, only when
  set**, so several cards pinned to different rooms on one floor stop
  sharing one panel position, without changing the key — and so the stored
  state — of any card that does not use the pin.
- **The Edit-card form keeps a draft of the Center X/Y pair** so clearing one
  box to retype it does not drop `center` and wipe the other box on the next
  render.

## 2026-09-27 Opus review of the integrated Sprint 9 build: nine fixes

An Opus review of the whole `task/S9` branch (S9.1 through S9.5, the entries
below) found nine real defects, fixed on `task/S9-fix`. In finding order:

1. **A TV that is playing was not blue and not listed.** `classOf` treated
   `tv` like a plain switch — only the literal state `"on"` counted — but a
   Cast, Android TV or webOS device reports `"playing"`/`"paused"`/`"idle"`
   while genuinely powered on. `tv` is now on for any state other than
   `off`/`standby` (`unavailable`/`unknown` were already excluded upstream),
   the same rule the S9.5 device table already documented in words, just not
   in code.
2. **A playing speaker pulsed on the plan but never appeared in the S9.5
   Active list.** `ACTIVE_LIST_RULE.speaker` was left at `"never"`, a stale
   default from before S9.4 gave `speaker` its own on-state — `COLOR_VAR` had
   no entry for it either. Both now match `speaker`'s real S9.4 behaviour.
3. **A saved panel position could put the panel outside the card.** The old
   code clamped only while dragging and stored raw pixels, so a resize (the
   card's own or the window's) after a drag could leave it clipped, and
   collapsing then re-expanding could leave it below the card entirely (a
   collapsed panel is shorter, so a position clamped for the tall panel is no
   longer valid once it grows back). Position is now a fraction (0–1) of the
   card's free width/height, reapplied imperatively after every render and
   on a `ResizeObserver` of the host — not only at the end of a drag — so it
   is always back inside the card's current box, whatever just changed
   its size.
4. Same fix as 3: collapse, drag to the bottom, expand no longer leaves the
   panel hanging off the card — re-clamping after every render catches the
   size change collapse/expand causes, the same as any other resize.
5. **Assumption, flagged for Diego to overrule:** with nothing yet stored
   for a card, and the card narrower than 500px, the panel now starts
   collapsed and takes `min(200px, 45%)` of the width rather than a flat
   200px. 500px is a guess at "phone width in a dashboard column", checked
   only against Chromium's viewport emulation at 380px, not a real device.
6. (No finding 6 in the review.)
7. **The storage key could collide or churn.** It used to hash the layout's
   own *content* (`layout_url`, or the inline `layout` verbatim). In
   websocket mode — no `layout`/`layout_url` configured, the default
   install — that content is always `""`, so two cards pinned to different
   floors of the same layout shared one saved position; an inline layout's
   own autosave rewrote `layout` on every edit, so the key (and the saved
   position under it) changed every time. The key now hashes the layout's
   *source* (`layout_url`, else `"inline"`, else `"ws"`) plus the card's own
   `floor`/`floors`, which is stable under autosave and distinguishes two
   cards on one layout by the floor each pins.
8. **The speaker/media wave's two arcs were not concentric with the halo.**
   Supersedes part of the S9.4 entry below: the arcs were `<path>`
   semicircles under `transform-box:fill-box`, and a semicircle's own
   bounding box sits off to one side of the disc it belongs to, not centred
   on it — so each arc scaled from a different point than the halo (same
   `cx`/`cy`/`r`) sharing its group. They are `<circle cx="12" cy="12"
   r="16">` now, like `.ping`: a circle's bbox is always the square centred
   on its own centre, so it is concentric with the halo automatically,
   whatever arc `stroke-dasharray` (with `pathLength="100"`, so "50 50"
   always means half the circumference regardless of `r`) leaves visible.
   Because `.wave` is a `<circle>` and not a `<path>` any more, it no longer
   needs the `.dev.on path.wave` specificity repeat the S9.4 entry describes
   (that rule only ever matches a `<path>`) — dropped.
9. **A camera with an empty `entity` was always listed, of every type, and a
   click fired `hass-more-info` with an empty entity id.** `isActive` now
   excludes any device (not only `camera`) whose `entity` is empty, and an
   `unavailable`/`unknown` camera as well — neither has a real more-info to
   open.

Two more, smaller: Solarized's `--fp-dev-speaker` was `#2c7fb8`, the generic
fixed blue, while Solarized's own TV already used `#268bd2` — speaker now
matches TV's own Solarized blue, keeping Solarized's "every type its own
hue" rule (S9.3's decision) consistent for the one other fixed-blue type.
And the camera row in the Active list took `--fp-dev-camera`, the token
`theme-roles.ts` sets to the same shade as `--fp-idle` for a generated
theme — legible on the plan, against a room's own fill, but the panel's row
sits on `--fp-room` instead, where in blueprint (a dark navy base) that
shade read as a dark blue icon on navy. The row now takes `--fp-ink`, the
same token its own text already reads by.

## 2026-09-27 S9.6: a card pinned to one room, `center`/`zoom_level`, not a `home:` shorthand

Diego asked for cards that can each pin a different room, corridor or part of
a home. Two new keys, `center: [x, y]` (plan cm) and `zoom_level` (1 = the
whole floor, up to `MAX_ZOOM`): `zoom` was already taken by the pinch/wheel
switch, so a room's "resting" view needed its own name rather than folding
into it. Untrusted config (CLAUDE.md finding 1): unlike `zoom`/`kiosk`, a
malformed `center` or `zoom_level` never throws — it falls back silently to
the whole floor, the same as `icon_size`/`open_color`, because a wrong number
here is a typo in a coordinate, not a closed enum where a bad value should be
caught. `zoom_level` alone zooms about the plan's own centre; `center` alone
(or `zoom_level` at 1) is a no-op, since a centre with nothing to zoom into
changes nothing to look at.

The pin becomes the card's "home": the fp-zoomed class, the zoom buttons'
disabled state, the reset button and a double-tap all return here now, not to
the whole-floor fit, so a pinned card that is pinch-zoomed out to see the rest
of the house comes back to its own room, not the plan's edge. `zoom` (pinch,
wheel, buttons) still works on a pinned card and can still reach the whole
floor — the pin only changes where "home" is. The S9.2 icon scale keeps
reading the whole-floor fit, not the pinned box, so a room card's icons are
the same size as the equivalent whole-floor card's, not blown up by the extra
zoom. The editor's View menu gets a "Copy card view" button that reads the
same `viewBoxFor` fit the card itself uses (pad 60, not the editor's own pad
80) so pasting its two YAML lines reproduces exactly what the editor shows.

## 2026-09-27 Sprint 9 integration: an open door is red in every theme

Supersedes the default in the S9.1 entry below. `--fp-open-door` defaulted to
the contact colour, and the role-generated themes collapse that to their one
accent, so in blueprint, the default theme, an open door was orange. The
brief asked for red. It is now a fixed `#d64545` in every generated theme;
light and midnight already resolve to it, Solarized keeps its own red.
`open_color` still overrides it.

## 2026-09-27 S9.3: TV is the one exception to one accent

Every role-generated theme (blueprint, slate, terminal) collapses its device
colours to one accent unless `devices` names an override. A TV kept doing
that too, so a blueprint TV turned the same orange as a lit lamp — nothing
told the two apart at a glance, and Solarized's TV was violet, which read as
blue-ish without being blue. `--fp-dev-tv` is now a fixed `#2c7fb8` in every
theme (Solarized keeps its own blue, `#268bd2`, since it already gives every
device type its own hue rather than collapsing to one), read directly rather
than through `devices`, so no theme — generated or not — can opt out. Warn,
danger and primary already worked this way; TV joins them as UI meaning, not
device-on state.

## 2026-09-27 S9.1: an open contact door is dashed, in a colour the card can set

A door or window is glass and a hinge; "open" used to look like nothing more
than red, the same red a triggered motion sensor wears. Dashing the line on
`.door.open` (a class rule, not a presentation attribute — finding 18) gives
open its own silhouette independent of colour, and the colour itself moves
to a new token, `--fp-open-door` (default `var(--fp-dev-contact)`), so a
card author can repaint it with the new `open_color` option without also
overriding the contact sensor's own disc and ping. The S8.13 door-alert line
moves to the same token, so the two always match. A cover door's own open
state is unrelated to a contact sensor and keeps its plain orange, undashed
— `.door.cover-open` sets `stroke-dasharray:none` explicitly, since a door
with both `sensors` and `cover` set (the schema allows it, even if the demo
fixture doesn't) would otherwise inherit `.open`'s dash on that property
alone, CSS resolving per property rather than per rule.

## 2026-09-27 S9.2: icons scale by the plan's own view box, plus an `icon_size` option

Icons, names, values and radar dots are drawn at a fixed size in plan
centimetres, scaled by `renderFloor`'s `scale`/`k`; the editor passes its own
zoom, but the card always passed `1`, so a big house left them shrinking
with everything else on screen. The card now computes
`scale = 1 / (auto * icon_size)`, where `auto = max(1, longest side of the
view box in cm / 1000)` — reusing `viewBoxFor`, the same box the card
already draws, rather than reading the layout's own geometry a second way.
A plan of 1000 cm or less keeps `auto` at 1, so it renders byte-identical to
before this change (tested). `icon_size` is a new card option, 0.5 to 3,
default 1; out of that range it clamps rather than being refused, and a
missing or non-numeric value is the default — a slider or a stray digit
should never break the card. The editor is unchanged.

## 2026-09-27 S9.4: a speaker radiates while it plays

Ticket: `speaker` gets an on colour (blue, like `media`) and pulses two arcs
while its entity is exactly `playing`.

`classOf` treats `speaker` exactly like `media`: `playing` is the only "on"
state, so an idle or on-but-not-playing media_player never lights up its
icon. `--fp-dev-speaker` is fixed at `#2c7fb8` in every theme, the same
exception `--fp-dev-tv` already is (S9.3) — a generated theme's `devFor()`
would otherwise let the role's own accent colour through, and a speaker
should read the same blue everywhere a `media` device already can.

The arcs are two `<path>` semicircles, class `.wave`/`.wave.w2`, staggered
by `animation-delay`, following the `.ping` pattern from S8.13 (a shape
inside the device group, `transform-box:fill-box`, held still under
`prefers-reduced-motion`). First pass used the arc's own 8px radius (half
the halo's 16px) and the shots showed nothing: the arc sat entirely inside
the halo's own fill and never crossed its edge, on or off. Radius now
matches the halo's 16px, the same radius `.ping` already uses, so the arc
visibly clears the disc — caught only by rendering the shots and looking at
them (CLAUDE.md finding 16), not by any test.

`.wave` is a `<path>`, unlike `.ping`'s `<circle>`, so a plain `.wave{fill:
none}` and the reduced-motion `.wave{opacity:.6}` both lost to `.dev.on
path{fill:...;opacity:...}` (specificity 0,2,1 beats 0,1,0 — CLAUDE.md
finding 10). Both properties are repeated at `.dev.on path.wave`, which
ties or beats that selector.

Tap: `speaker` joins `NO_TOGGLE` (`src/card/actions.ts`), the same reasoning
as `media` — `media_player.toggle` is play/pause or power, never a clean
on/off, so a tap opens more-info rather than guessing which one was meant.

Not touched: `src/core/ha.ts`'s `TYPE_RULES` has no domain-mapping entry for
`speaker` (pre-existing; `media` has none either), so `entitiesForType`
matches every entity for that type rather than filtering to `media_player.*`
domain entities. Out of scope for this ticket, which only asked for the
colour, arcs and tap.

No new demo device: `demo/layout.json`'s existing `media-office` device
(type `media`, entity `media_player.demo_office`) is already driven to
`playing` for the "on" shots state, so it exercises the arcs without adding
a `speaker` fixture. The Playwright CSS-pair tests add their own throwaway
`speaker` fixture via `addCssFixtures`, same as several other types already
do, to test the fixed colour and the arcs on the type itself.

## 2026-09-27 S9.5: the active list narrows a vacuum below classOf, and keys its storage to the layout

The brief said two things that pull against each other: "base active on the
same classOf result the plan uses" and, in the same sentence, "vacuums that
are cleaning". `classOf` (S7.10) treats "cleaning" and "returning to base" as
one on-plan colour — a robot on its way home still glows the same as one at
work. The active list does not: `src/core/active.ts`'s `ACTIVE_LIST_RULE`
gives `vacuum` its own `"cleaning"`-only membership, reading `state` directly
rather than through `classOf`, the one deliberate gap between what lights up
on the plan and what earns a row on the list. Every other type on the list
(`"on"`) still goes through `classOf` unchanged, so the plan and the list can
never otherwise disagree, and a light with `bound` is picked up the same way
on both. Every `DeviceType` is written down in `ACTIVE_LIST_RULE`
(`"on"`/`"always"`/`"cleaning"`/`"never"`), tested by iterating `DEVICE_TYPES`
(CLAUDE.md finding 17), so a new type is a decision made on purpose.

The panel's position and collapsed state are kept in `localStorage` under a
key hashed (`tag()`, already used for mask and pattern ids in render.ts) from
the card's own `layout_url` or inline `layout`, not from a fixed name — two
`floorplan-studio-card`s on one dashboard, each with a different plan, keep
separate panel state rather than one overwriting the other's position every
time either re-renders.

## 2026-09-26 S8.13 review: the viewBox pads only lamps near the plan

Supersedes part of the S8.13 viewBox entry below. The Opus review found
two gaps. A light placed by `a` and `b` was padded nowhere, while its aura
is drawn at their midpoint, so the aura was clipped. And a stray lamp far
outside the plan (a layout in mm, a bad drag) pulled the box out to it and
shrank the house to a speck. `viewBoxFor` now uses the aura's own centre
rule, and counts a lamp or camera only when its centre lies within its
reach of the outline's box. One further out stays off view, as it did
before S8.13. The door alert line uses butt caps, so it no longer paints
over the wall past the door's ends.

## 2026-09-26 HACS default list: the HACS action runs with no ignores

Diego asked to submit the repository to the HACS default list. hacs/default
requires the HACS action to pass "without any errors or ignores", and our
Validate workflow ignored `brands topics`, which were only needed for a
custom repository. The repository now has topics, and the integration ships
its own `brand/icon.png`, which HACS accepts in place of an entry in
home-assistant/brands. So the ignore is gone, and a failing check now fails
Validate.

## 2026-09-26 S8.13: a 150 cm light aura; alerts for motion and contact

Maintainer request: "for the lights make the area lighting up 50% larger.
for motion sensors make it more visible when it triggers, same for contact
sensors."

Light: the aura radius is now `LIGHT_REACH` = 150 cm, split from
`DEVICE_REACH` (100 cm), which the camera cone keeps. This supersedes the
S2.8 radius. At 150 cm the aura reached walls, doors and names and tinted
an open door's red, so the aura pass moved from just before the devices to
just after the rooms, stairs and night overlay: it now draws under walls,
openings, doors, furniture and names, and still under every icon.

`viewBoxFor` (S5.7) used to pad the whole plan by the largest reach
whenever a light or camera existed. At 150 cm that shrinks every plan with
a lamp. It now takes the union of the padded outline and each light's or
camera's own circle, turned with the plan, so the box grows only where an
aura or cone passes the edge. The demo ground floor's box moves from
-100,-100,1000x800 to -80,-60,940x740.

Motion and contact: when on, the disc fills at 60 % (other on discs stay at
`--fp-alpha`, 25 %) with a 2 px ring in the sensor's colour, and a `ping`
circle under the disc scales to 2.2x and fades out every 1.6 s. An open
door with a contact sensor draws a `door-alert` line, the door's width plus
16 cm, in `--fp-dev-contact`, pulsing between 20 % and 60 % opacity, under
the door's own line. Under `prefers-reduced-motion` nothing animates: the
ping holds at 1.5x, 60 %, and the door line at 45 %. The ping follows the
state, not the fade: it stops when the sensor goes off, and the icon then
fades as before.

## 2026-09-26 S8.12: floor chips by default on a multi-floor layout; a Floor selector in the card form

Maintainer feedback: "in the card i cannot switch floor." / "There are no
chips. with more the one floor and no setting show all floors with chips.
add floor selector in the configuration." A card added with the stub config
(`{ type }` only) drew only the layout's first floor and had no switcher at
all — `floor: "all"` or a `floors` list were the only ways to get one, and
neither is set by a card the Lovelace UI adds for you.

What changed: `FloorplanStudioCard._floorList()` (`src/card/floorplan-studio-card.ts`)
now also returns every floor, in layout order, when `floors` names nothing
usable, `floor` is not `"all"`, and `floor` is not pinned to a real floor id
the layout actually has — but only when the layout holds more than one
floor; a single floor still gets no chip of its own (one chip is noise, not
a switcher). Everything explicit is unchanged: `floor: <a real id>` still
pins with no switcher, `floor: "all"` and `floors: [...]` still work as
before, and `kiosk: true` still hides the switcher outright, whatever would
otherwise have produced one.

Decision: an unknown `floor` id (a typo, or a floor since deleted from the
layout) now counts as *unset* rather than a silent pin to the first floor —
so on a multi-floor layout it now also gets the switcher, not a single
frozen floor. The old behaviour quietly hid the fact that the configured
id no longer matched anything; showing the switcher instead is at least as
safe a fallback and better tells a person that `floor` did not do what they
typed. `_floorKey()` (unchanged) still resolves to the layout's first floor
inside that switcher, same as any other unresolved `_shownFloor`.

Edit-card form (`src/card/config-editor.ts`): a new `<select id="floor">`
sits above the floor checkboxes (renamed "Switcher shows", with a "None
ticked: every floor" hint) — "All floors (switcher)" (the default, value
`""`, which removes `floor` from the config rather than writing `floor:
"all"`, since the card already treats the two the same) or one option per
loaded floor, by title, which writes `floor: <id>` and drops any `floors`
list in the same `config-changed` event (a `floors` list only matters to a
switcher, and this pins to one floor with none). Picking a single floor
hides the checkboxes, since they would then do nothing.

Tests: 6 new Vitest cases in `tests/card/card.test.ts` (`describe("S8.12: chips
by default...")`) plus one existing case updated (`floors: ["attic", "loft"]`
with no `floor` set now falls into the new default, so it was asserting the
opposite of what the fix is for); 5 new Playwright cases in
`tests/card/config-editor.spec.ts` for the Floor select; 1 new Playwright
case in `tests/card/card.spec.ts` driving a real `page.mouse` click on the
second chip with no floor config at all, at `--repeat-each=10`. All
confirmed to fail first, and the vitest case and one editor case again after
reverting just their own source file with `git stash push -- <file>`.

Supersedes the three-role flow in `docs/WORKFLOW.md` (2026-09-21: Sonnet
executes, a separate Sonnet session verifies each sprint, and Opus reviews
each task). Sprint 8 ran differently, and Diego asked that the process and
dev guide follow his global rules. The new flow:

- A coordinating session briefs a Sonnet coder per task. Coders work in
  their own worktree and on their own Playwright port when two run at once.
- The coordinator re-runs the suites and opens the screenshots itself before
  anything else happens.
- One Opus review covers the integrated build. Opus then re-checks only the
  fixes.
- With Diego's yes, the coordinator merges, pushes and tags, and finishes
  the install on Home Assistant.

Why: in Sprint 8, the coordinator's own look at the screenshots caught
defects that green suites and the coder's report both missed: clipped
hints, round-capped opening cuts, and a split toolbar. The single Opus pass
over the integrated build caught the real logic bugs: a duplicated catalog
entry, a hidden gang, and a recycled id. A per-task Opus review and a
separate verifier session cost more and found less. `CONTRIBUTING.md`
gains the evidence rules that apply to everyone:

- run commands bare;
- run a new Playwright test with `--repeat-each=10`;
- check any visible change at two widths and in two themes;
- commit with a no-reply author.

## 2026-09-26 S8.10 Toolbar right-aligned; Devices list collapsible and typed

Maintainer feedback: the toolbar's Filter through Help cluster "floated in
the middle" instead of sitting at the right edge, and the room panel's
Devices list was one flat block, unreadable once an area had more than a
few entities.

Toolbar: the dead `class="grow"` spacer (a zero-basis flex item whose own
absence of size let the menu cluster wrap onto its own line with nothing to
push it right) is gone. Everything from Filter through Help is now one
`.bar-right` flex item, `flex:1 1 0%;min-width:0;justify-content:flex-end`,
so it fills whatever room the floor chips leave on the .bar's own line and
right-aligns its own wrapped rows in turn; a `margin-left:auto` on a
shrink-to-fit box was tried first and rejected — nesting a flex-wrap
container as a flex item sized by its own content left Chromium free to
settle on two different widths (668px vs 740px) for byte-identical content,
depending only on what triggered the most recent layout pass, which flipped
the toolbar between one row and two on an unrelated status update. `.status`
lost its `flex-grow` (now `flex:0 1 12em`, capped `max-width:12em`) so a long
message can no longer widen the toolbar and push Help onto a new line. Help
moved to be the cluster's last item, its own right edge is what the
alignment test pins.

Devices: the room panel's HOME ASSISTANT section is one `<details>` "Devices
(N)", collapsed by default, holding one `<details>` sub-group per
`typeForEntity` type (the one existing entity→`DeviceType` mapping, reused
from `src/core/ha.ts`, not duplicated), each also collapsed, sorted by name
within a group, unmapped entities in "Other" last, groups in a fixed order
(`DEVICE_GROUP_ORDER`, `src/editor/panels.ts`). Helpers, Automations,
Scripts and Scenes get the same collapsible/closed treatment. Open/closed
state lives in `EditorState.haGroups` (a `Set<string>` keyed
`grp:<label>`/`dev:<type>`), not in `layout` or undo history, so it survives
a room switch and a `hass` update (the state instance itself is never
swapped) without an extra undo step or an unsaved-changes mark.

Done, 2026-09-26. Tests first, real `page.mouse` clicks: a computed-style
pair over `.bar-right` (`justifyContent`, `flexGrow`, `flexBasis`) at 1280
and 380, no horizontal scroll at 380 — failed against the pre-fix CSS,
proved via `git stash` on the src changes alone; a stubbed mixed-entity area
showing collapsed "Devices (7)", opening it to seven correctly-labelled and
-counted collapsed sub-groups, opening "Lights" to show only the two light
rows sorted by name; a persistence test switching room then back and
calling the test harness's `hass`-update helper, checking both a group's and
a device-type sub-group's open state survive. All new tests also run at
`--repeat-each=10`. Two pre-existing S7.2 tests ("status line sits right of
Redo", "a 200-character status ... toolbar does not grow") pinned the old
`flex-grow` layout and were updated, not reverted, to the new one (finding
19) — confirmed via a second `git stash` comparison that they passed on
pre-S8.10 code and only broke because Help now sits after status by design.
The dropdown-stays-in-viewport test passes on the pre-fix CSS too — `.box`
was already `position:absolute;right:0` inside its own `position:relative`
menu, so it could never overflow the flex-wrapped toolbar regardless of the
`.bar-right` bug; it is kept as a regression guard, not a red-to-green proof.

Follow-up, same day, from the maintainer's own look at the screenshots above:
the first pass still left an empty gap after "Ready" before Help (`.status`'s
fixed `flex:0 1 12em` always reserved 12em even for a short message), and at
380 the cluster squeezed into a narrow column beside the floor chips instead
of taking its own row. Fixed: `.status` is now `flex:0 1 auto;max-width:16em`
(content-sized, capped only for an extreme message) and moved to be the
cluster's first item — `justify-content:flex-end` anchors the packed block's
right edge, so every item after status keeps a fixed distance from that right
edge and growing status moves only its own left edge, never Filter's x. The
dead `<div class="vsep">` is gone (it was widening the gap before Undo/Redo
past the flex `gap`). Order is now status, Filter, Add, Draw, View, Edit,
File, Help, Undo, Redo — Undo/Redo are the cluster's own last items now, so
Redo's right edge is what the alignment test pins (Help no longer sits alone
at the end). Below 768px a `@media` rule sets `.bar-right{flex-basis:
100%}`, forcing it onto its own full-width row instead of shrinking to fit
beside the chips (a literal percentage, not a shrink-to-fit result, so it
carries none of the width-instability risk from the first S8.10 pass — a
determinism check re-ran the render twice at 380 and compared the cluster's
own width). Tests first, real `page.mouse`: equal 6px gaps between every
visible cluster item, Redo within a few px of the toolbar's right edge, and
a status-text change proved to move nothing else — all three failed against
the first-pass CSS via `git stash`; a 380px test for the cluster's own
full-width row, right-aligned, chips top-aligned on the first row, no
horizontal scroll, also failed the same way. Two pre-existing tests (the
Help-right-edge alignment test, and "status line sits ... right of Redo")
pinned the superseded order and are updated, not reverted, confirmed via the
same `git stash` technique that they broke only because of this reorder. All
new/updated tests green at `--repeat-each=10`.

Second Opus review, same day: two real defects past the two passes above.
(1) `haDeviceGroups`/`haGroupBlock` (`src/editor/panels.ts`) built each
`<details>` from an unkeyed `.map`, so switching to a room whose device types
differ at some index reused another type's DOM node at that position, and the
reused node kept its old `open` state under the new type's key — Kitchen
(Switch, Temp) could show "Wall switches" open and record `dev:switch` in
`haGroups` from having merely displayed it, not opened it. Fixed with
`repeat(list, (t) => t, ...)` for both the sub-groups and the top-level
groups, and `.open=${live(...)}` in place of `?open=`, so the binding always
reads the DOM's real state rather than lit-html's last-committed value.
(2) `.box{position:absolute;right:0}` anchors a dropdown to its own button,
not the viewport, so a mid-toolbar button (View, Edit, Filter) carried a box
that ran off the left edge once the box was wider than the room to that
button's left — measured at 380 (View -96..128px) and even 600 (Filter
-10..214px); the previous viewport test only ever opened File, the
cluster's rightmost and safest item, so it passed throughout. Fixed with
`onMenuToggle`, wired to every menu's own `toggle` event: it resets to
`right:0`, measures the box's real `getBoundingClientRect().left`, and when
that is negative switches to `right:auto` with an inline `left` that pins the
box's screen position to the viewport's own left edge (0), regardless of the
box's width or which button opened it. The dropdown-viewport test itself had to move off a plain
`boundingBox()` read: the `<details>` `toggle` event is a queued task per the
HTML spec, not synchronous with the click, so Playwright's `click()` can
resolve a tick before the clamp runs — reading immediately caught the box
mid-flight for exactly the cases that needed clamping. It now polls the real
on-screen position (`expect(...).toPass({ timeout: 1000 })`) rather than a
guessed sleep or a stale style-attribute sentinel (closing a menu already
leaves `right` non-empty, so that sentinel would read as "already clamped"
before the next open's own toggle fires). Nits from the same review: Undo and
Redo are now one `.btnpair` flex item (`flex-wrap:nowrap`) so the pair always
wraps together instead of splitting across rows; the Device colours and
Install code panels now open at `panelTop()` (the toolbar's own measured
`getBoundingClientRect().bottom`, plus a 10px gap) instead of a fixed 90px,
which the taller narrow toolbar had started to overlap. All four fixes have a
red-first Playwright test, run at `--repeat-each=10`.

## 2026-09-26 S8.11: an opening cuts a real hole in the wall

Maintainer feedback: an opening (a door-less gap) was a light-grey `.opening`
band painted over the wall — it happened to read as a hole only because it
was stroked with `--fp-room-empty`, the same colour a plain uncoloured room
falls back to. Over any room with its own colour or texture the band was
visibly wrong: still grey, not the room's own fill.

Fix: `renderFloor` (`src/core/render.ts`) now wraps the wall-lines group
(`.eh` halo lines and `.e` stroke lines, internal and external alike) in an
SVG `<mask>` that erases each opening's own footprint —
`wallWidthAt(f, op.a, op.b) + OPENING_EXTRA` wide, round-capped so no sliver
survives at the ends. `.opening`'s own stroke is now `transparent`; it keeps
`pointer-events:none` in the card and `pointer-events:stroke` in the editor,
unchanged, so it still hit-tests on top of the (now invisible) wall. Whatever
sits under the cut — a room's fill, texture, or nothing at all outside the
building — shows straight through.

The mask's `id` is not a counter: `renderFloor` must stay pure (called twice
on equal input, byte-identical output — many existing tests depend on it), so
a global incrementing id would have broken it the moment two floors both
carried an opening. The id is instead a short hash of the mask's own cut-line
markup (`tag()`, FNV-1a, mirroring `texturePatternId()`'s existing precedent
in `src/core/textures.ts`): identical opening geometry mints the same id
(safe — each card or editor instance is its own shadow root, so a `url(#id)`
reference never resolves outside it), and different geometry mints a
different one. The mask paints with SVG keyword colours (`white`/`black`),
not hex, to keep the "no literal hex colours in generated markup" invariant.

The demo's ground floor is exercised by too many fixtures (`render.test.ts`,
`migrate.test.ts`, `paint.test.ts`, `draw.test.ts`, and roughly a dozen
Playwright tests in `editor.spec.ts` that assume it starts with zero
openings) to safely add its first opening there. `demo/layout.json`'s
**first** floor gets one instead, on the Office's south/outline wall
(`a:[600,600] b:[700,600]`), and the Office now carries its own colour
(`#4a6fa5`) so the hole is visibly distinct from the old grey band, not
coincidentally matching it. Mirrored into `demo/layout.v1.json` (no `id` —
`migrate()` assigns one).

Tests, each written first and confirmed to fail with the mask removed (or,
for the two-cards case, with `src/core/render.ts` reverted to its
pre-S8.11 state): six `render.test.ts` cases (mask presence/content, no mask
with no openings, same-floor-twice-same-id, different-floors-different-id,
cut width); an `editor.spec.ts` Playwright test that screenshots the editor,
decodes the PNG with a new dependency-free reader
(`tests/core/util/png.ts`, itself round-tripped against a hand-built PNG in
`tests/core/util/png.test.ts` — no image-decoding dependency existed in the
repo) and asserts the opening's centre pixel equals the Office's own fill,
never the wall colour; another confirming a real `page.mouse` click at the
opening's real screen coordinates still selects it, on top of the masked
wall; a `card.spec.ts` test mounting two `<floorplan-studio-card>` elements
with the same layout, confirming they mint the identical (content-derived)
mask id without interfering with each other's rendering. A pre-existing CSS
pair (`editor.spec.ts`, "an opening's erase stroke matches a plain room's own
fill") tested the old design's own premise and is rewritten to the new one:
the opening's stroke is transparent in every theme, whatever the room's
colour — proved against a room now given an explicit colour, so a
regression back to the old grey-matching band cannot pass by coincidence.

Follow-up (2026-09-26, Diego's own 4x crops of the shipped card): two more
defects. (1) The mask's cut line was round-capped, so each end eroded a
full disc (radius = half the cut width) around `a`/`b` in every direction,
not only along the wall — an opening's ends read as concave arcs, and the
erosion reached past the opening's own span. Now `stroke-linecap="butt"`:
the cut is exactly `a`-to-`b`, wider across only. (2) A room's own polygon
edge coincides exactly with an external wall's centreline (that is the
room's own boundary), so it was always antialiased there; an opaque wall
used to sit on top of that seam, and the new mask exposed it as a thin
boundary line running across the hole. `renderFloor` now adds an unmasked
"seam patch" per opening — found the bordering room the same way
`room_glow` finds a light's room (`inside()`, probed 5cm off the
centreline each side) and repaints the seam with that room's own
`paintAttr()` fill, bled 2cm past the centreline into the hole. Both
fixed with a failing-first pixel test in `card.spec.ts` (the card, not the
editor: the editor draws its own measurement-grid line exactly along
`y=600` at low opacity, which blends the exact pixel these tests need and
makes the editor an unreliable place to pin them down).

Opus review (2026-09-26) of the follow-up above found a blocker and two more
defects. (1) BLOCKER: the `<mask>` element carried `maskUnits="userSpaceOnUse"`
but no `x`/`y`/`width`/`height` of its own, so its region defaulted to
-10%/120% of the *viewport*, anchored at the coordinate system's own `0,0` —
never at the viewBox's own `x`/`y`. Any floor viewed away from the origin (the
editor zoomed in, the card zoomed in, or a floor simply drawn somewhere else
in plan space) then had its entire masked wall-lines group erased outright
wherever it fell outside that accidental rectangle: real walls vanished, not
only the opening. Fixed by giving the `<mask>` its own explicit region
(`x="-100000" y="-100000" width="200000" height="200000"`, matching the inner
rect it already carried for the same reason). (2) The cut and the wall's own
halo (`.eh`) were the same width (`wallWidthAt(...) + 2`), so their two edges
landed on the identical plan coordinate; two independently antialiased edges
on one line do not reliably cancel, leaving a faint blended line along the
hole, reproducible once rendered through a tight enough viewBox. `OPENING_EXTRA`
is now `WALL_HALO_EXTRA + 2` (4, not 2), putting the cut's edge a clean
centimetre past the halo's. (3) With that wider cut in place, the seam patch
above turned out to be papering over a seam that no longer exists: checked at
4x in light, blueprint and ha-dark, on an outline-wall opening and on an
opening between two differently-coloured rooms (a test layout, never the
demo or the repo), and by scanning pixels across the full width of each
opening, both rooms' polygons already meet exactly at the shared wall
centreline with no gap and no blended sliver. The patch, its now-orphaned
`.room.seam` CSS rule and its old pixel test are removed; `card.spec.ts`
keeps a regression test on the internal-opening case instead (fails, as
proved by hand, if the opening is removed from that same test layout).

## 2026-09-26 Opus re-check of task/S8.9: newId ignored the catalog and other floors

A further Opus re-check of task/S8.9 found that `newId` (`src/editor/state.ts`)
only looked at the current floor's own objects. A device's id survives its own
delete from the plan in its (still catalogued) `layout.catalog` entry, so
`newId` could hand that same id to an unrelated device placed afterward.
`placeArea` (`state.ts`) and `placeDevice` (`editor-app.ts`) then made it worse:
both reused a catalog entry's stored id unconditionally, so re-placing the
original device later collided with the one that had recycled its id —
`validate` then failed with a duplicate device id.

Fix, one commit:

- `newId` takes an optional `layout`; when given, it also avoids every
  `layout.catalog` id and every device id on every floor (a device can also
  move floors and keep its id, via `placeDevice`'s own floor switch).
- `placeArea` and `placeDevice` now reuse a catalog entry's id only when no
  floor's device already carries it; otherwise they mint a fresh id via
  `newId` and update the catalog entry to match, in the same undo step already
  open (both already snapshot before touching anything).
- Two unit tests run the coordinator's own 4-step repro end to end (via
  `placeArea` and via `placeDevice`) and assert `validate(layout).ok`; both
  failed on the prior code. Two Playwright tests fill coverage gaps the
  review also flagged: the Trace panel's own hint wraps instead of clipping,
  and a rotated stairs flight shows "Rotated: set 0 to reshape." — both
  already worked, so these two only needed writing, not a fix; fail-first was
  proved by reverting the relevant line and re-running each.

## 2026-09-26 Opus review of task/S8.9: seven defects fixed, one on its own contract

An Opus review of the whole S8.9 branch (which includes S8.8) found seven
issues. Six were fixed here, each with its own commit and a test written
first and watched fail before the fix:

1. `placeArea` (`src/editor/state.ts`) reused an existing catalog entry for
   a room instead of always pushing a new one, so placing the same area
   twice no longer duplicated it.
2. A multi-gang switch (several gangs, one device) is now placed once per
   gang, not once per device, in `deviceRows` and `addCandidates`
   (`src/core/ha.ts`).
3. Fixed together with 2 (one commit, `25a6fcd`, not two): the two are
   coupled through the same shared functions (`deviceRows`, `addCandidates`,
   `placeableDevicesInArea`, `unplacedDevicesInArea`) and splitting the diff
   would have left one half red on its own. Disclosed here since the review
   asked for one commit per defect.
4. `wallWidthAt` (`src/core/render.ts`) now takes the widest of every edge
   coincident with a door or opening (via the new `edgeKindsNear`,
   `src/core/geometry.ts`), not whichever edge `nearestEdge` happened to
   keep on a tie — a door on a wall that is also, at that point, external,
   now always reads as external.
5. Sidebar hint clipping is scoped to a dedicated `.hint.fit` class
   (`editor-app.ts`), not the global `.hint`: a confirm question and the
   trace-image instructions wrap in full instead of clipping. Restored
   stairs' rotated-flight hint and NOT_IN_HA's "or leave it".
6. Four nits: the door preview-open overlay now takes the wall's own
   thickness via the now-exported `wallWidthAt`, instead of a fixed 22 cm;
   `.door-hit` gets `cursor:move`; `h4.pnl-h`'s no-top-border exemption now
   covers two leading hints before a panel's first heading (the stairs
   panel), not only zero or one; `devicePanel`'s Links heading now also
   requires `moveArea`, matching what `areaDiffField` already needed to
   render anything under it.

The seventh — a reported round-cap bump where an internal wall meets an
external one (demo, top, x≈500) — was investigated and not fixed. Precise
CTM-mapped pixel inspection of the actual rendered card (`npm run shots`
output and a fresh screenshot, both checked column-by-column) shows the
wall's top edge perfectly flat at that junction in every theme (geometry is
theme-independent). Not reproduced, so left alone, per "fix it only if
visible" — it was not visible.

## 2026-09-26 S8.9 follow-up: hints are rewritten short, not clipped

Diego reported the sidebar hints added in S8.9 part 2 were clipped by CSS
ellipsis, cutting sentences mid-word ("Drag it to place it. Removed devices
go back to the ..."). Clipping hid meaning instead of removing it.

Every static hint in `src/editor/panels.ts` is now a complete sentence,
about 45 characters or fewer, written to fit the sidebar's own width. Detail
that mattered but did not fit moved into a `title` attribute on the
relevant control, or was dropped where it only repeated the UI (the
device-type line under a device's own name is gone). A hint built from a
live Home Assistant name or a measurement is marked `dyn` and stays exempt:
it may still run long, and `white-space:nowrap; text-overflow:ellipsis`
remains only as its safety net, not the primary way hints are shortened.
How-to-use hints (drag, resize, reshape) now sit directly under the panel's
title, never inside or after Danger.

A Playwright test asserts `scrollWidth <= clientWidth` for every non-`dyn`
`#panel .hint`, across the floor, a room, a wall edge, a door, stairs,
furniture and every device on the demo ground floor, at the sidebar's
default 1280x800 width.

## 2026-09-26 S8.9 part 2: the sidebar groups fields under six section headings, in a fixed order

Every selection panel (floor, room, wall, door/window, opening, stairs,
furniture, an unlinked entity, a corner, a structure line, a device of any
type) now renders its fields under small headings, added through one shared
`heading(label)` helper in `src/editor/panels.ts`, styled once in
`editor-app.ts` (`h4.pnl-h`, a divider above each heading but the first). The
order is fixed and never varies: Identity, Home Assistant, Links,
Appearance, Automations, Danger — Danger always last. A panel renders only
the headings it has content for; a light shows all but Automations in the
demo (no automation writer wired into `standalone.html`), a plain wall shows
only Appearance and Danger, and so on. `tests/editor/editor.spec.ts` ("S8.9:
the device panel's section headings appear in the stated order for a
light") pins the order for the type with the most sections and checks it
generically (every heading shown is one of the six names, in that relative
order), so it holds regardless of which optional sections a given layout
triggers.

One deliberate exception: the room panel's Delete button stays inside
`roomTurn()`, next to Unsnap, not moved into a bottom Danger section. This
was already a pinned decision (`editor.spec.ts` "a room's Delete button sits
next to Unsnap, not at the bottom of the panel") from an earlier sprint, and
S8.9 keeps it rather than fighting an existing, deliberate test.

Every hint (`hint()`) now also carries the full text on the element's own
`title`, and its CSS caps it at one line with an ellipsis
(`white-space:nowrap;overflow:hidden;text-overflow:ellipsis`) — multi-line
hints from earlier sprints (the floor panel's texts, in particular) read as
one line now, the rest reachable on hover or already stated elsewhere. The
one hint that carries its own interactive control (the floor panel's "Need
help? Open Help" button) opts out via a second class, `.hint.help-line`,
so the button is never clipped: it wraps instead of ellipsising.

No before/after screenshot pair exists for this change: the "before" shots
were not taken before the code was written (a process slip — the diff is
plain enough to review from the code itself and from
`shots/current/editor-*.png` after). The "after" state was checked for
every selection kind, in blueprint, light and the (visually flat, since the
demo has no live HA vars for the editor) `ha` themes, and at a 380px
viewport where the sidebar drops below the plan: headings and dividers hold
up, the help-line hint is not clipped, and the room panel's Delete-next-to-
Unsnap exception is visibly intact.

## 2026-09-26 S8.9 part 1: thicker walls, and a door or window takes the thickness of its own wall

A plain internal wall (`.e`) goes from 3 cm to 10 cm (`WALL_WIDTH`,
`src/core/render.ts`); an external wall (`.e.external`) goes from 6 cm to
20 cm (`WALL_WIDTH_EXTERNAL`). Both were too thin to read as walls once the
rest of the plan (furniture, device icons) was drawn to scale. Fence,
boundary/no-wall and deleted-edge lines are unchanged at 1.5. Each wall's
white halo (`.eh`) stays 2 cm wider than its own wall, on both kinds
(`WALL_HALO_EXTRA`), same rule as before.

A door, window or opening now takes the thickness of the wall segment it
actually sits on — 10 on an internal wall, 20 on an external one, 10 if it
is off any wall (a zone/boundary edge, or free-floating) — instead of a
fixed value. It finds that wall the same way the editor's own door-snap
does: `edgeKindAt(f, poly, i)` (new, `src/core/geometry.ts`) is the one
place that decides an edge's kind from its `wk`/`owk`/free-wall `kind`, and
both `wallWidthAt` (render) and the editor's drag/place snapping read it, so
the two can never disagree about which wall a door is on. An opening's
erase stroke is that wall's thickness plus 2 cm, so it still fully erases
the wall under it (unchanged rule, now wall-aware). A selected door/window
draws at its own thickness plus 8.

The old fixed 22 cm click target (`DOOR_HIT_WIDTH`) is kept, but split into
its own invisible `<line class="door-hit">` twin drawn just under the
visible door line, `stroke:transparent;pointer-events:stroke` — so Playwright
and unit tests that click or measure a door by `data-d` must now exclude
`.door-hit` (`:not(.door-hit)`) to reach the visible one. This keeps the
existing S7.1 label-avoidance math and hit-test size untouched while the
visible stroke now varies by wall.

Corner and T-join choice: internal walls (`.e`, `.eh`) keep `stroke-linecap:
round`, external walls keep `stroke-linecap: square` (both unchanged from
before). At 10/20 cm this was checked at 4x zoom (`npm run shots`): a round
cap on the internal 10 cm wall still closes a T-join cleanly against
whatever it meets, because the crossing wall's own halo/wall paint each
edge independently at each edge's full thickness, covering the round cap's
curve; a square cap on the thicker 20 cm external wall keeps its exterior
corner sharp. No SVG marker or dedicated join element was added — order of
drawing (each polygon and free wall as its own line) was already enough at
the new thicknesses.

Pinned tests updated on purpose (values changed, not loosened):
`tests/core/render.test.ts` (opening stroke-width, wall-kind thickness
table), `tests/editor/editor.spec.ts` (`S1.52` perimeter-edge external width
6px→20px, plain-wall width after re-kinding 6px(sic, was mislabelled
3px)→10px), `tests/card/card.spec.ts` / `tests/card/card.test.ts` (door
locators disambiguated from the new `.door-hit` twin). New tests: a unit
test iterating every `WallKind` pinning its own thickness
(`render.test.ts`), a unit test for a door on an internal vs. external wall
(`render.test.ts`), and a Playwright computed-style pair for both wall
kinds' widths, their halos, and a door on each (`editor.spec.ts`, "S8.9 CSS
pair").

## 2026-09-25 S8.8: a catalogued entry does not count as placed; catalog entries with an HA device show as the device's row

Field report from Diego's own Home Assistant: 34 real Living Room devices
(Hue lights, two-gang wall switches, plugs, RGB spots) that were imported
into `layout.catalog` but never dragged onto a floor vanished from the
room's Place popup entirely, and showed only as raw per-entity `catalog:`
rows — not device rows — in Add > Device. Cause: `placedDeviceIds`
(`src/core/ha.ts`) counted a device as placed when any of its entities was
either placed on a floor or merely catalogued. This supersedes the S8.6
wording above ("A device already placed through any one entity does not
reappear through a sibling") wherever it implied a catalogued entity counts
as placed — it never did and never should. "Placed" now means on a floor
only (`placedEntities`), checked via the entity ids in `placedEntities(l)`,
never via `layout.catalog` membership.

A catalogued-but-unplaced device is now never hidden. `addCandidates` and
`placeableDevicesInArea` build one row per device (`deviceRows`,
`src/core/ha.ts`): an unplaced catalog entry whose entity belongs to an HA
device becomes that device's row, named by the device, placing the catalog
entry itself (its id/type/room carried over unchanged). The device gets no
second row from HA. When several catalog entries share one device, the
device's main entity's own catalog entry is preferred; if none of the
catalog entries is the main entity, the first catalogued sibling is used
instead — either way only one row, unless the device is a multi-gang switch
(two or more bare `switch.*` entities on one `dev`, no `entity_category`),
which still gets one row per gang per the S8.4-S8.7 finding above. Standalone
catalog entries with no matching HA device are unchanged. `unplacedDevicesInArea`
(room right-click "Add device from") follows the same rule via the same
`deviceRows` helper. See `src/core/ha.ts` (`placedDeviceIds`, `deviceRows`,
`gangEntities`) and `tests/core/ha.test.ts` ("S8.8" describe blocks).

Row layout also changed for both the Add > Device panel and the room's
Place popup: name on its own line, no wrap, ellipsised with the full name in
`title`; a smaller muted subtitle line below with type label and room/area
(e.g. "Light · Living Room"). Both panels are 50% larger in width and list
height (measured at 1280x800 with a 40-row fixture: Add panel 522x642 to
782x762, rows 520x486.5 to 780x606.5; Place popup 442x642 to 662x762, rows
440x380.6 to 660x518.8), clamped to the viewport with `min(..., 100vw/100vh - margin)`
so small screens are not broken.

## 2026-09-25 Opus review of S8.4-S8.7: "Link lights to switches" moves out of Edit > Group

Finding 14 of the review: the button lived inside the Group submenu, but it
acts on every unbound light on the floor at once, not the group chosen
there — nesting it under Group read as if it were scoped to one. It is now
a top-level Edit item, right after Group, and closes the menu on click like
Add's own one-shot items. `tests/editor/editor.spec.ts`'s S8.1 test pinning
Edit's item order is updated for the new position, with a comment saying
why, per finding 19 of the Sprint 2 reviews (a pinned order changed on
purpose needs a deliberate test update, not a loosened assertion). See
`src/editor/editor-app.ts` (the Edit menu template, `autoLinkLights`).

## 2026-09-25 Opus review of S8.4-S8.7: switch candidates list every switch entity, not one per device

Findings 5 and 6: `switchChoicesForLight`'s "Controlled by" candidates were
built one row per HA device (`mainEntitiesByDevice`'s main entity), so a
multi-gang wall switch device (`switch.wall_l1`, `switch.wall_l2`) offered
only one of its two switches, and a `switch_as_x` helper light — ranked
above a plain switch by `mainEntity`'s own domain order — hid its own
physical switch sibling entirely. The candidate list now walks every
switch-domain, non-`entity_category` entity directly, with no device
grouping: a multi-gang device offers a row per gang, and a switch_as_x
light (domain `light`) is simply never a candidate, so it can never shadow
its sibling switch. `EditorState.autoLinkLights` also now skips a light
whose own HA entity has `platform: "switch_as_x"` — it is a switch wrapped
as a light, not a light with a switch of its own to find. See
`src/core/ha.ts` (`switchChoicesForLight`) and `src/editor/state.ts`
(`autoLinkLights`).

## 2026-09-25 Opus review of S8.4-S8.7: camera/climate/media_player/vacuum outrank light/switch in mainEntity

Finding 7 of the review: `mainEntity`'s domain ranking put light and switch
above camera, climate, media_player and vacuum, so a camera with a floodlight
(a `light.*` entity on the same device) showed as a light, and a climate
device with a boost relay switch showed as a switch — both wrong in the
device rows the Add panel, Place popup and room menu build. New order:
camera > climate > media_player > vacuum > light > switch > cover > fan >
lock > binary_sensor > sensor. See `src/core/ha.ts` (`DOMAIN_PRIORITY`).

## 2026-09-25 Opus review of S8.4-S8.7: drop the sole-candidate suggestion rule

Finding 4 of the review: `switchChoicesForLight`'s suggestion rule offered a
switch as "(suggested)" whenever it was the *only* switch or plug candidate in
the light's own HA area, whatever its name, score 0 included. A living room
with one light and one unrelated switch (a "TV plug" next to a "Ceiling
light") suggested the plug, and "Link lights to switches" would have bound it.
Being the sole candidate is no longer sufficient: a candidate is `suggested`
only when it scores at least 1 shared name token with the light and is the
unique top scorer in its area, the same rule that already applied when there
was more than one candidate. `autoLinkLights` uses the same function, so it
inherits the fix. See `src/core/ha.ts` (`switchChoicesForLight`) and
`tests/core/ha.test.ts`.

## 2026-09-25 S8.7 linking a light: floor switches, a name-match suggestion, motion

Diego's feedback: "when linking lights, only show the floor related switches,
add also motion groups and motion sensors, or map them automatically, e.g.
basement dumb light is managed by basement light switch." Three related
changes to the light panel's "Controlled by" field.

Floor scoping: `bound`'s select used to offer every switch and plug in the
whole plan's catalog (`bindChoices`), so a basement light could be bound to an
attic switch by mistake. `switchChoicesForLight` (`src/core/ha.ts`) restricts
the candidates to the light's own plan floor: the floor's own catalogued
switches/plugs, union, with HA connected, every HA switch-domain entity
(one row per device, `mainEntity`) whose HA area sits on an HA floor this
plan floor's own rooms map to (via each room's `area`'s own `floor_id` — the
same room-to-area matching S8.5 already uses, just followed one step further
to the area's floor). The light's current `bound` value always stays offered
even off-floor, so a value set before this scoping existed does not vanish.

Suggestion: within the switches offered, one may be marked `suggested` — the
select shows it first, labelled "(suggested)". A candidate can only be
suggested when its own HA area equals the light's own HA area (never a
same-floor, different-room guess), and only when it is the *unique* top
scorer there by shared name tokens (lowercased, split on non-alphanumeric
runs, "switch"/"plug"/"socket"/"relay"/"the"/"and"/"of" dropped, then set
intersection size) — or the sole switch/plug candidate in that area, any
score including zero. A tie at the top suggests nobody: a wrong guess is
worse than no guess. Edit, Group holds "Link lights to switches", visible
whenever HA is connected: it links every unbound light on the current floor
to its suggested switch, one undo step for the whole floor, so it reverts as
a single gesture; a light that already has `bound` is never touched, and it
never touches `motion`.

Motion: the same "Controlled by" select gains a second, `motion:`-prefixed
optgroup listing this floor's own motion/occupancy/presence binary_sensors
and any `group.*` entity whose every member is such a sensor with at least
one on this floor — same area as the light first. Picking one never writes
`bound`; it opens a small "Turn on with X, off after N min, Create
automation" row that reuses the existing motion-group automation builder,
generalised (`EditorApp.motionAutomation`) to take a concrete light entity
and, only when called from this per-light flow, record `motion` on that
device in the same undo step the automation write is not part of (HA writes
are never undoable; the plan edit is). Unlinking removes only `motion`; the
automation stays in HA, on purpose — same reasoning as `bound` recording a
link the editor does not own. `device.motion` (`src/core/schema.ts`) is the
new field, validated exactly like `bound`: light-only, an entity id, must
differ from `entity`. Without a writer the whole Motion optgroup and row are
left out — nothing to link to.

## 2026-09-25 S8.6 devices, not entities, in every add list

Diego's own feedback: "in the device list i see plug network indicator and not
the plug itself. just add the devices not the entities, and this applies
everywhere." A plug is one physical thing to HA's user, several entities to
its registry — the switch, a power sensor, an energy sensor, a diagnostic
connectivity sensor. Every list that adds a new icon to the plan from a raw HA
entity (Add > Device, the room panel's Place popup, a room's right-click "Add
device from") now offers one row per HA device, not one per entity.

`mainEntity` (`src/core/ha.ts`) is the ranking that picks which entity stands
for the device: drop anything with a truthy `entity_category` first (a plug's
network indicator is exactly this — "config" or "diagnostic"), then rank what
is left by domain (light > switch > climate > cover > fan > lock >
media_player > vacuum > camera > binary_sensor > sensor > everything else), a
device name match or the shortest id breaking a tie. A device whose entities
are all diagnostic gets no row at all — it has nothing of its own to place. A
device already placed through any one of its entities does not reappear
through a sibling (a plug placed via its switch does not resurface via its
power sensor), so "placed" is now tracked per device, not per entity.

The one picker this does not touch is the already-placed device's own entity
field (`deviceEntity`, `src/editor/panels.ts`): someone may deliberately want
the power sensor instead of the switch once the icon already exists, so it
still lists every entity, only grouped under a `<optgroup>` per device within
its existing In room/Elsewhere/Everything else tiers.

`HaData` gained `devices` (the HA device registry: id, name, area) and `cat`
on an entity (its `entity_category`). Both are optional — an older HA with no
device registry, or a registry call that fails, falls back to grouping by the
raw `dev` field on each entity and labelling the row with the main entity's
own name, so the feature degrades rather than disappears.

## 2026-09-25 S8.4/S8.5 Place starts empty; Add > Device is one panel with Floor/Room/Area/Type filters

Two related changes to how a device gets onto the plan, both from a day of use
on Diego's own house.

S8.4: the room panel's Place popup ticked every entity by default and let a
user untick what they did not want. Diego place a room and the popup placed
things he had not meant to. It now opens with nothing ticked (`placeOn`, not
the old `placeOff`), Place stays disabled at zero, and a single button toggles
between "Select all" and "Deselect all" for whatever the type chip currently
shows, so a filtered batch is still one click.

S8.5: Add held two separate submenus, Device (the plan's own catalog) and
Entities (every other HA entity), because they grew at different times. A user
placing a device does not care which list it lives in, and the entity they
want (say the study's temperature sensor) took scanning both. They merge into
one floating panel, filtered by Floor, Room, Area and Type. Floor and Room are
plan concepts, not HA's: a candidate's floor and room are found by matching its
HA entity's area to the plan room that already has that area (any floor), so
an entity with no room drawn yet has no floor or room to filter by, only an
Area (HA's own name for it) if HA knows one. Each select lists only the values
actually present among candidates passing every *other* active filter, so
picking one narrows the rest instead of showing dead options; a select with no
value anywhere in the full candidate list (typically Area, with no HA
connected) does not appear at all. Picking a candidate whose room lives on
another floor switches to that floor first, so a bedroom sensor lands in the
Bedroom room, not wherever the editor happened to be looking. The panel stays
open after a pick, since a HA install has more than one thing to add at once.

## 2026-09-25 S8.3 the card loads as a dashboard resource in storage mode

Supersedes how the card is loaded, not the re-define below. Diego asked why the
registry is replaced and whether the card could load like the other cards.
Resources (Settings, Dashboards, Resources) load after HA's core, so a define
there always lands in the polyfilled registry. The integration now adds one
`module` resource for `/floorplan_studio_static/floorplan-studio-card.js?v=<version>`
when dashboard resources are in storage mode, and rewrites the `?v=` on the
same entry after an upgrade so browsers fetch the new file. It never touches a
resource at another URL. The resource is deleted when the integration is
removed, not on unload, so a reload or an options change does not churn the
user's list. With YAML resources (read-only to us) it keeps `add_extra_js_url`,
and the re-define watch covers the race there. `lovelace` joins the manifest
dependencies so its data exists before setup.

## 2026-09-25 S8.3 card: re-define after HA swaps the registry; panel view fits the screen

Diego saw "Custom element doesn't exist: floorplan-studio-card" on about half
of hard reloads. Traced in his browser: the file loaded with a 200 every time
and evaluated without error, `document.createElement` built our class, yet
`customElements.get` returned undefined. HA's core installs a
scoped-custom-element-registry polyfill that replaces `customElements`. The
integration loads the card with `add_extra_js_url`, in parallel with core, so
when the card won the race it defined itself only in the native registry.
Cards loaded as Lovelace resources run after core and never see this.

Fix: `defineElement` (`src/card/define.ts`) defines at once, then checks every
500 ms for 30 s and defines again if the current registry lacks the name.
Tried live first: a second define on the polyfilled registry does not throw,
and HA's own `whenDefined` rebuilds the error card into the real one. Rejected:
waiting for `home-assistant` to be defined before defining at all, which would
never define the card outside HA (tests, the harness).

Also: in a panel view the plan drew 1951 px tall on a 902 px window, so "fit"
looked zoomed in and the zoom-out button was disabled. hui-panel-view gives the
card no definite height, so S8.2's `height: 100%` fell back to width times
aspect. HA sets `layout = "panel"` on the card; the card reflects it as a
`panel` attribute, and `:host([panel])` takes `100vh` minus
`--header-height` (56 px default).

## 2026-09-25 S8.2 card sizing: height:100% on host and svg, getGridOptions from the plan's aspect

Diego reported the card cropped in Home Assistant's sections layout dashboard.
Cause: the card had no `getGridOptions()`, so a resized row got `.card.fit-rows`
(a fixed pixel height) while the card's own `svg { height: auto }` still sized
from its width, so it overflowed the row and was clipped.

Fix: `:host` and `svg` both get `height: 100%`, the pattern Home Assistant's own
cards (thermostat, map) use. In an "auto" row (no fixed height above the card)
a percentage height resolves to `auto` by the CSS spec, so nothing changes there;
in a fixed-height row it fills it, and the svg's default `preserveAspectRatio`
(`xMidYMid meet`) keeps the whole plan visible, letterboxed rather than cropped
or stretched. `getGridOptions()` returns `columns: 12`, a numeric `rows` from
the same aspect math `getCardSize()` already used (so masonry and sections
views agree), and `min_columns: 6` / `min_rows: 3` so a manual resize can't
squeeze the plan illegibly.

Found during this: a plain percentage height requires a parent with no height
of its own to correctly fall back to `auto` — `tests/card/harness.html` had
`<floorplan-studio-card>` as a direct child of `<body>`, and one Playwright
test sets `document.body.style.height` to give the page room to scroll. That
leaked straight into the card and stretched the plan to the whole page. Fixed
by wrapping the card in a plain, unstyled `<div>` in the harness, matching how
Home Assistant actually nests a card (several divs, none height-styled, until
the one HA itself sizes). Also found: two zoom-button taps followed immediately
by a touch swipe raced Chromium's compositor-thread commit of the new
`touch-action: none` about 1 swipe in 10, letting a stray pixel of page scroll
through before it took effect; the S7.15 Playwright test now waits two
rendered frames after the taps before swiping — a real rendering milestone,
not a blind sleep.

## 2026-09-25 Docs clean-up after 0.12.0

Diego: "clean the docs". Housekeeping, no behaviour change:

- `docs/LIVE-TEST.md` removed. It told a tester to copy the card into
  `www/` and add a Lovelace resource, which was the way before Sprint 3 gave
  the integration a panel and a resource of its own. The README's install
  section is the current path; `docs/PLAN.md` S3.0 keeps the pointer.
- `docs/PLAN.md`: Sprint 8 sat above Sprint 7 (an insertion anchored on the
  wrong heading); it now follows it. The S7.12 block said the 0.11.0
  release was "not started"; it says when it went out.
- `docs/SPEC.md` and `prompts/SCHEMA.md` still named the Group and Trace
  image controls under their pre-S8.1 menus; they say Edit now.
- `docs/WORKFLOW.md`'s command table gains `demo-gif`, `docs:schema` and
  `docs:check`, and says why `npm test` sets `NODE_OPTIONS`.
- Kept: `docs/REVIEW-2026-09-24.md` and `docs/REVIEW-2026-09-25.md` are the
  sources Sprint 7 and its decisions cite, so they stay where the links point.

## 2026-09-25 S8.1 An Edit menu, the Home Assistant popover, a Place popup

Diego, after a day on 0.11.1: the toolbar mixed how the plan looks with what
changes it, the Home Assistant menu gave no clue what its rows were, and
"Place N devices of this area" dumped every sensor of the area on the room,
power and battery readings included.

- **View keeps the look, Edit holds the changes.** Edit sits after View:
  Add floor, Home Assistant, Group, Rotate, Device colours, Trace image….
  Names joined View. The theme stays in View (Diego's call: it is a look).
  The `+` chip is gone; "Add floor" says what it does.
- **Home Assistant is a popover, not a menu.** A menu closes on the first
  click, which is wrong for a list you clean up row by row. The popover is
  the Device colours pattern (fixed, draggable by its head, above the plan
  at z-index 30, under an open menu at 40), with the X top-left as asked and
  one sentence saying what the rows are. A name opens the item where HA
  edits it, not more-info for everything: the automation editor for an
  automation, the area page for an area, more-info for a helper (it has no
  page of its own). The button is disabled while the list is empty, so the
  list loads when the writer is set and after every create or remove, not
  only on open.
- **Place asks which, and offers only what has an icon.** The popup lists
  the area's unplaced entities with a tick each and a chip per type; Place
  takes the ticked rows that are shown. `AREA_PLACEABLE_TYPES` and
  `AREA_NOISE_TYPES` in `core/ha.ts` partition `DEVICE_TYPES` (finding 17:
  a test iterates the union, so a new type fails until it is decided).
  Noise is `other` (anything the plan has no icon for: power, energy,
  illuminance, a group, a script), `battery` (a reading of another device)
  and `person` (not a thing in a room). Add, Entities still offers
  everything, one at a time, for the cases the rule gets wrong.
- **Three draggable panels earned one helper.** `dragHead(get, set)` in
  `editor-app.ts` replaces the Device colours handlers and serves the two
  new panels.
- **The place-area unit fixture changed.** Its twelve classless `sensor.*`
  entities are noise under the new rule, so the "large area in a small
  room" test now uses lights. The test's point (every icon inside the room)
  is unchanged.

## 2026-09-25 S7.16 The card read the websocket reply's wrapper as the plan

Every dashboard card on a real Home Assistant said "No layout: install the
Floorplan Studio integration or set layout_url" while the plan was there.
`websocket.py` answers `floorplan_studio/load` with `{ layout }`; the panel
reads `r.layout`; the card passed the whole reply to `migrate`, which saw no
`floors` object and threw. The unit test's mock returned a bare layout, so
the test matched the card and not the boundary. Finding 21 for `CLAUDE.md`:
**a mock at a real boundary is copied from the other side of it**, here from
the Python that sends the reply, never from what the caller would like.

- **The card unwraps `r.layout`**, and a `null` (nothing saved) keeps the
  install hint.
- **A plan that arrived but failed says why**: "The plan could not be used:
  <first problem>". Before, an invalid plan and a missing integration read
  the same, and the message sent the maintainer to reinstall an integration
  that was fine.
- **`scripts/validate-layout.mjs` migrates before it validates**, as the
  editor and the card do. It refused the maintainer's stored plan for a
  missing `unlinked` that migrate fills in, which cost a wrong turn in the
  diagnosis. A v1 file now opens there too; the CLI test's "schema error"
  is a bad `north`, which migrate cannot repair.

## 2026-09-25 S7.15 The page scrolls over a plan at fit; doors are label obstacles

Two of the items the Sprint 7 review deferred, taken up after the maintainer
tried 0.11.0 on a phone.

- **`touch-action: pan-y` at fit, `none` once zoomed.** This supersedes the
  S7.4 line "`touch-action: none` on the plan". At fit there is nothing to
  pan, so a vertical swipe that starts on the plan scrolls the dashboard as
  it would over any other card. `pan-y` still leaves a pinch and a double-tap
  to the plan (neither is a vertical pan), so zooming in from fit works as
  before; once zoomed, `.fp-zoomed` takes every touch so a pan never scrolls
  the page under the plan. The cost: a two-finger pinch whose fingers move
  mostly up and down together may start a page scroll instead; the browser
  decides that, and the + button and a double-tap are the fallback. A
  horizontal swipe at fit does nothing, as before. `zoom: false` is unchanged.
- **A door is an obstacle for text placement.** `place()` in `render.ts`
  saw icons and other texts, not doors, so the demo's "Garden pond" ran
  across the garage door. A door's box is its line widened by half its
  stroke, in the screen frame; a turned plan's door box is the box of its
  turned endpoints, a little generous off-axis, which only pushes a label
  further off. The demo clash test now counts doors, and the two garden
  names moved: "Garden pond" above the pond, "Garden" below it. Openings,
  walls and furniture stay out of it: a name over a wall line is normal on a
  plan, and furniture sits under names by design (S5.1).

## 2026-09-25 Sprint 7 review: save size cap, empty radar slots, the rest deferred

The Opus review of the integrated build (`docs/REVIEW-2026-09-25.md`) said
"ship after fixes". Fixed before the tag:

- **Save refuses a plan over 3.5 MB** (`MAX_LAYOUT_BYTES`). Home Assistant's
  websocket takes 4 MiB in one message and `floorplan_studio/save` sends the
  whole layout in one; one trace image may already be 4 MB. The error names
  the floors that carry an image and what to do. The per-floor trace cap
  stays at 4 MB: it bounds what the editor holds, the save cap bounds what
  Home Assistant will take.
- **A radar pair at 0/0 draws nothing.** An LD2450 reports 0/0 for an empty
  slot, and `Number("")` is 0, so an idle radar drew its targets on itself.
  A blank reading is not a number, and 0/0 is "no target".
- **The autosave says when it dropped the trace image**, so a reload before
  Save does not lose the scan silently.
- **The fade field falls back to its default** when emptied or negative.
- **The ESPHome snippet uses `has_target`**; `target_count` is a sensor key.

Deferred, on purpose: `touch-action: none` on the card even at fit (phones
cannot scroll the dashboard from the plan; the S7.4 decision stands until a
user reports it), kiosk changes reaching the long-press only when the SVG is
replaced, a `pointer-events` class rule for the trace image, cards
downloading trace images they never draw, and the "Garden pond" label
crossing the garden door. Each is in the review with its file and line.

## 2026-09-24 S7.10 vacuum: no map position, dialog instead of toggle

- **No map position field.** Most vacuum integrations expose their current
  spot, if at all, as a camera entity streaming a proprietary map image, or as
  attributes with no fixed coordinate system across brands — not a pair of
  sensors a plan could place a dot from, the way S7.9's radar targets do. A
  device this schema cannot draw honestly is a device it leaves undrawn: the
  icon shows state, not position. A later task could read a vendor-specific
  x/y attribute pair the way S7.9 reads target sensors, if a common enough
  shape shows up; nothing here forecloses it.
- **A tap opens a dialog, never toggles.** `vacuum.toggle` does not exist as a
  clean single action a user would expect from one tap (unlike a light or a
  switch), and blind service calls on a robot that moves through the house
  are exactly the case S2.7's cover dialog already exists for. The dialog
  offers Start, Pause and Return to dock, modelled directly on
  `_coverDialogTemplate`/`_openCoverDialog` in `floorplan-studio-card.ts`
  (same focus-in/out-once rule, same "ignore a second tap while open" guard,
  extended so opening either dialog also checks the other is closed — the
  two share one keydown handler and query `.fp-dialog-actions button`
  generically, which only works because exactly one dialog is ever open).
- **`docked`/`idle`/`paused` are all idle grey, not three shades.** None of
  the three needs its own colour: what matters to someone glancing at the
  plan is "doing something" (cleaning, returning) versus "not" (everything
  else) versus "broken" (error). Collapsing the three saves a decision no one
  asked for and keeps `--fp-dev-vacuum` meaning one thing: active.
- **`cleaning` spins the icon; `returning` does not.** Both are the "on"
  colour (`--fp-dev-vacuum`), but returning-to-dock is not the vacuum doing
  its job in a room, so the spin — the strongest "look, it's moving" signal
  the icon has — is reserved for actual cleaning.
- **`error` is a fourth CSS class, `danger`, not a fourth on/off combination.**
  `Cls` grew from `"on" | "off" | "unavailable"` to include `"danger"` rather
  than overloading `on` with a colour swap, so `.dev.danger path{fill:var(--fp-danger)}`
  reads as its own rule next to `.dev.on`/`.dev.off`, not a special case
  bolted onto one of them.
- **`unavailable`/`unknown` disables the three action buttons, not the whole
  dialog.** Cancel stays clickable so the dialog can always be dismissed —
  the same reasoning S2.7's cover dialog never needed, since a cover has no
  disabled state of its own; a vacuum genuinely can be unreachable.
- **`prompts/SCHEMA.md` needed no edit**, same finding S7.9 already recorded:
  it has no `DeviceType` enumeration of its own.

## 2026-09-24 S7.8/S7.9 People and radar targets: frame math, drawing path, and one environment fix

Five decisions past the brief, plus a Node/vitest fix that blocked a clean `npm test` and is recorded here since it touches every test file, not this feature alone.

- **Radar target frame.** The brief gives one worked example (x=0, y=2000mm, `rot`
  90 draws 200 cm screen-right) and leaves the general formula implicit. Derived
  and checked against SVG's own clockwise `rotate()` convention: with `xl, yl` in
  centimetres and `rad` the device's `rot` in radians, `dx = xl·cos(rad) +
  yl·sin(rad)`, `dy = xl·sin(rad) − yl·cos(rad)`, added to the sensor's own
  `x, y`. At `rot` 0 this keeps "ahead" (positive `yl`) pointing screen-up, matching
  "0 is ahead is screen-up" in `docs/SPEC.md`.
- **Targets are drawn as plan-coordinate `<circle>`s, not nested inside the
  device's own local-frame `<g>`.** The device group is scaled and (for other
  types) rotated in its own 24×24 icon space; a target's position is already a
  real plan point once the frame math above runs, so pushing it straight into
  the same `out` array as rooms and other devices lets it pick up the ambient
  `plan-turn` wrapper for free, with no double-transform to undo.
- **`typeForEntity` does not guess `radar`.** An occupancy `binary_sensor` reads
  as `motion`, same as before S7.9 — nothing in a bare entity id or device class
  says "this is an mmWave sensor with target sensors, not a plain PIR". The
  device panel's own type picker is the correction path; guessing wrong here
  would be worse than not guessing (finding 1: layouts stay untrusted, and a
  bad auto-type would need to be un-set by hand anyway).
- **`prompts/SCHEMA.md` needed no edit.** It has no `DeviceType` enumeration of
  its own — it points at `docs/schema.md`, generated from `src/core/schema.ts`'s
  own JSDoc by `npm run docs:schema`, which already picked up `room` and
  `targets` once their doc comments were in place. One of the "eight places" a
  new type touches turned out to already be covered by generation.
- **The demo's own radar (`radar-office`, first floor) got explicit on/off/gone
  states in `scripts/shots.mjs`**, matching the pattern already used for
  `person.demo_alex`, so the first-floor shots show it doing something instead
  of sitting permanently idle for want of a state — caught only by looking at
  the rendered PNG (finding 16), not by any test.
- **Node 22+'s own global `localStorage`/`sessionStorage`** (gated behind
  `--localstorage-file`, unset here) shadows jsdom's working implementation:
  vitest's jsdom environment only patches a global key that is not already `in
  global` or on its own hardcoded override list, and `localStorage` is neither.
  Every test touching storage failed with "Cannot read properties of undefined
  (reading 'clear')" — a version-skew gap between Node and this vitest version,
  not a bug in this repo. Fixed with `tests/setup-storage.ts` (`setupFiles` in
  `vitest.config.ts`), which reassigns both globals from jsdom's own `window`
  once the jsdom environment installs. This was required to get a clean `npm
  test` run at all, so it is recorded here rather than left as a silent
  workaround; it touches no product code.

## 2026-09-24 S7.7 Card config form: kiosk, night and sun added ahead of their tasks

S7.5 (kiosk) and S7.6 (night, sun) had not landed yet when this task was
done, so `FloorplanStudioCardConfig` does not carry those three keys. The
form's own `EditorConfig` extends it locally with `kiosk?: boolean`,
`night?: "auto" | "on" | "off"` and `sun?: string`, with the defaults those
tasks' PLAN blocks already commit to (`false`, `"auto"`, `"sun.sun"`), so the
form does not need a second pass once S7.5 and S7.6 merge. The card itself
does not read any of the three yet; a hint line in the form says so. `docs/card.md`
notes it too.

No `ha-form`: it would need Home Assistant's own elements loaded at test
time, and this repo's Playwright tests run the built card module under plain
Chromium, not inside HA. The form is a plain Lit element instead
(`src/card/config-editor.ts`), imported into `floorplan-studio-card.ts` for
its side effect (registering the custom element) so it ships inside the same
`dist/floorplan-studio-card.js` the vite config already builds — no second
built file, no change to `vite.config.ts`.


## 2026-09-24 S7.5 Kiosk mode: how the brief was read

- **"No version"** was already moot: the card has never shown a version
  anywhere on its own face (that line is in the editor's View menu, not the
  card — see 0.10.0 in `CHANGELOG.md`). `kiosk` hides nothing there because
  there was nothing to hide; the phrase stays in the brief's own wording
  above `FloorplanStudioCardConfig.kiosk` and in `docs/card.md` for whoever
  adds a card-level version line later.
- **`bindDeviceActions`'s `opts.longPress`** defaults to `true` (unset or
  explicit) rather than requiring the card to pass it on every call, so
  every other caller — tests included — keeps working unchanged. The card
  passes `{ longPress: !this._kiosk() }` on every bind.
- **`setConfig` also refuses an unrecognised `zoom`.** S7.4 left an unknown
  `zoom` value falling back to `true` (recorded in its own entry below,
  "Four places, not five"); that is exactly the silent-typo failure this
  block's "Break it" line calls out for `kiosk`. Fixed in the same commit,
  with its own test, rather than leaving one sibling key sloppy next to a
  strict one.
- **Every other config key stays permissive** (CLAUDE.md finding 1): an
  unknown floor id, theme or fade value still falls back quietly, as
  documented. Only `zoom` and `kiosk` throw, because both have a small,
  closed set of valid values where a stray string is almost certainly a
  typo, not an intentional new value.
- **Four places, not five,** for `kiosk`, same reason as `zoom` in S7.4: the
  config form (S7.7) does not exist yet.


## 2026-09-24 S7.6 Night: four departures from the brief

- The overlay is a `<polygon class="room-night">` with the room's own points,
  not a `<rect>`. A rect is the room's bounding box: on an L-shaped room it
  would darken the neighbour's corner, and a lit room would be clear over
  ground that is not its own. Each overlay carries `data-night="<room index>"`
  for tests, never `data-r`, so it is not a pick target.
- It is drawn after the room fills and the stairs, before walls, names and
  devices, so lines, text and icons stay crisp. Stairs are veiled by their
  room's overlay; they get none of their own, like zones and structures.
  `fill` rooms are overlaid (a solid mass darkens too); a `fill` with no name
  is not drawn, so it gets none.
- `.room-night` also sets `pointer-events:none` in the stylesheet (finding
  18). Without it the overlay took the click and the editor could not select
  a room with Preview night on; a Playwright test proves it with the rule
  removed.
- `sun: <entity>` counts `on` as night as well as `below_horizon`. A user who
  points `sun` at their own "is it dark" binary sensor gets what they meant;
  `sun.sun` never reports `on`, so the default is untouched.

`--fp-night` is the same `rgba(4,10,30,.45)` in every theme for now. On
blueprint it turns the grey rooms to a slate grey, on light to a mid grey;
both read as night next to the lit kitchen in `npm run shots`.

## 2026-09-24 S7.11 Trace image: where it departs from the brief

Built as the brief says (`Floor.trace`, drawn first only with `opts.trace`,
View, Trace image…, the Export tick, `setTrace`). Departures, and why:

- **Room fills go see-through while a trace is shown (editor only).** Drawn
  first, the scan sat under every room fill, which is opaque: the first room
  traced hid its part of the scan, and a plan with rooms hid it all. Seen in a
  render, not in a test. `svg.tracing .room { fill-opacity: .4 }` in the
  editor's stylesheet; the card and `render.ts` are untouched. A CSS pair test
  holds it.
- **`src` is PNG, JPEG or WebP only.** No SVG: it is a document that can carry
  script and links. The base64 alphabet has no quote, so a `src` that passes
  `TRACE_SRC` goes into the `href` attribute as it is. `render.ts` checks the
  same rule again; the layout is untrusted.
- **`rot` turns about `x`, `y`, and is `[0, 360)`.** The brief named the field,
  not the pivot. The top-left corner is what the editor stores and places, so
  it is the pivot. No UI sets `rot` yet; a file may.
- **`on: false` draws nothing.** Not an image at opacity 0, so a hidden scan
  costs nothing to paint.
- **Load places the image anew,** fitted into the outline's box (the view on a
  blank floor) at opacity 0.5. Replacing an image does not keep the old
  scale: a new scan has its own.
- **Scale keeps `x`, `y`.** Only `w` changes, as the brief says; the image
  grows or shrinks from its top-left corner.
- **Undo history interns the image.** `EditorState` keeps 100 undo steps, each
  the whole layout as JSON. With a 4 MB image that is 400 MB. The history now
  stores each distinct `src` once and a token in each step.
- **Autosave falls back to a plan without traces.** A 4 MB image can exceed
  the browser's localStorage quota (about 5 MB). `persist()` then saves the
  plan without `trace` rather than nothing; the live plan and Save keep it.
- **Risk, not handled: Home Assistant's websocket message size.** Save sends
  the layout over HA's websocket. aiohttp's default maximum message is 4 MB,
  so a layout near the trace cap may be refused on Save. Not verified against
  a real HA. If it bites, lower `MAX_TRACE_BYTES` or cap the JPEG harder.
## 2026-09-24 S7.4 Zoom and pan in the card: how the brief was read

Where the S7.4 block left room, or could not be done as written:

- **Pan bounds.** "At least one third of the plan stays visible" cannot hold
  past 3×: at 8× the view is an eighth of the plan wide. The rule is a third
  of the smaller of view and plan, per axis. Zoomed in, that is a third of
  the view on the plan. At fit there is nothing to pan: `clamp` returns fit.
  A view within 1e-6 of fit counts as fit, so zooming in and back out does
  not leave a pannable 1.0000001×.
- **Double-tap.** At fit it zooms 2× about the tap; zoomed, it returns to
  fit. Only off a device or a door: two taps on a light still toggle it
  twice (S2.2 "Break it", no debounce).
- **The 6 px slop lives in `actions.ts`, for every card.** A press that
  moves more than `TAP_SLOP_PX` drops its tap and its hold timer, with zoom
  on or off. A second pointer down drops it too. Before this, the hold timer
  kept running through a drag and a drag ended in a toggle.
- **Half a pinch.** "A pinch that starts with one finger outside the svg is
  ignored" is detected by `isPrimary`: a pointer that goes down on the svg
  while none is tracked, and is not primary, has a first finger elsewhere.
  The card ignores it; it neither pans nor zooms.
- **`touch-action: none`** on the plan, as the block says. The cost: on a
  phone a swipe that starts on the plan no longer scrolls the dashboard.
  `zoom: false` gives it back; `docs/card.md` says so.
- **The zoom buttons follow the plan's `<svg>` in the DOM.** Their fit icon
  is an `<svg>` too, and every `querySelector("svg")` in the card and its
  tests must keep finding the plan first.
- **Four places, not five,** for the `zoom` key: the config form (S7.7) does
  not exist yet.

## 2026-09-24 S7.2 Status line in the toolbar; open menus draw above floating panels

S7.2 moved `#status` from the side panel into the toolbar, right of Redo, and
the snapping manual into Help. Three departures from the brief:

- The toolbar is `.bar`, not `header`/`.toolbar`. No such element exists; the
  tests target `.bar #status`.
- The status line takes toolbar width, so the menus moved left. File's box
  then opened under the centred Device colours panel (`position:fixed`,
  z-index 30) and Save could not be clicked. The same was already true on a
  narrower window. Menu boxes now use z-index 40: a menu just opened is on
  top. A test checks Save is the top element with Device colours open.
- "One short hint each at most" is not forced on the floor panel. It keeps
  its two floor hints (a test pins one) and gains "Need help? Open Help.".
  Only hints that restate Alt were cut: the device, furniture and unlinked
  panels no longer say "Alt disables the grid". "Shift+click more lights" in
  the multi-select panel stays: it is the only place that says how to build a
  group.

## 2026-09-24 S7.1 Label placement: three details the brief left open

The S7.1 brief places room names, room labels, zone labels and sensor values
against one `placed` list. Three choices went past it.

- A sensor value's first spot moved from 24k to about 26k below its icon
  (16k disc, 2k gap, then the text's ascent). With the brief's own box (size
  tall, baseline 0.75 of the size down) the old spot overlapped the disc by a
  sliver, so "no text on an icon" could not hold. Above and right use the
  same 2k gap.
- Extras' names go through the same candidates, after zone labels and before
  values, and unlinked appliances count as icons. Leaving either out would
  let a text land on them with the rule claiming it could not.
- Device names (the editor's Names toggle, a selected device's name) are not
  placed. They sit on their own icon by design, and only in the editor.

Walls, doors and zone edges are not obstacles: a name can still cross a
line. "23.5" on the demo sits on the Reading corner's dashed edge, clear of
its name.

## 2026-09-24 S6.7 File, Export carries an entity snapshot (`Layout.available`), for an agent working with no HA connection

Diego asked how an agent (Claude Code, local or a stranger's) could automate
plan configuration end to end — not just geometry (`prompts/SKILL.md`) but
placing and binding devices too. The first answer was "add a separate 'Export
entity catalog' button, gated on `hass`, kept out of `layout.json`" (recorded
in `docs/PLAN.md`'s backlog at the time), reasoning that a live HA snapshot
baked into the saved plan would go stale the moment someone renamed an area
or added a device in HA afterwards.

Diego overrode that: bake it into the existing File, Export download instead,
so an agent can work from one file with no HA connection of its own. Reversed
for three reasons. First, Export already means "a point-in-time copy, not the
live plan" — unlike Save, nobody expects an exported file to track HA after
the fact, so the staleness objection doesn't apply the way it would to Save
or to the live editor state. Second, a second button is a second thing to
find, name and document; the existing one already means "give me the plan as
a file". Third, `migrate()` already builds its output from a fixed, named set
of keys, so an unknown key like `available` is silently dropped the moment
the file is re-opened in the editor — nothing keeps the snapshot around past
its usefulness.

`AvailableEntity` (`src/core/schema.ts`) and `availableEntities()`
(`src/core/ha.ts`) build the list; `editor-app.ts`'s `exportJson()` merges it
into the download only when `this.ha` is set (the HA panel), and leaves it
out entirely on the standalone `file://` build, where there is no registry to
snapshot. Save (`save-request`) and the live editor state never carry it —
only this one download. `validate()` needed no change: it already never
rejects an unrelated top-level key.

Added `floors` (an ordered array of floor ids) alongside the existing `floor`
key: it restricts the card's floor switcher to just those floors, in that
order, first is the default, and it wins over `floor` when at least one of
its ids matches a real floor — an unknown id is dropped, and if none match
it behaves as though `floors` were unset (layouts, and by extension a
hand-written config, are untrusted input; see CLAUDE.md finding 1). Built on
the existing `_floorChips()`/`floor: "all"` switcher rather than a second
mechanism.

Diego asked for both "a premade dashboard template with the card installed"
and "a textbox in the editor with the install code" in the same message.
Decided these are one feature, not two: File, Install code now generates a
complete, pasteable Home Assistant dashboard (`title:`/`views:`/`cards:`,
reflecting the plan's current theme and floor order) rather than a bare card
config block — a working dashboard is the premade template once pasted. Not
confirmed with Diego before building (Auto Mode); flagged for review once
done. If a bare card snippet turns out to be wanted too (e.g. for pasting
into an existing dashboard), split into two outputs rather than replacing
this one.

## 2026-09-23 S5.6 unavailable entities: dimming is right, the spec's strikethrough is wrong

`docs/SPEC.md` said an unavailable device is "struck through, 45 % opacity"; the code (`.dev.unavailable{opacity:.45}`, `src/core/render.ts`) has only ever dimmed it. Decided the code is right and fixed the spec, not the CSS: a literal line drawn across a device icon at this size (roughly 24–32 px in the plan) reads as visual noise, not a clean "this one is unavailable" signal, and Home Assistant's own dashboards dim an unavailable entity rather than strike it through — matching that convention is worth more here than matching a spec line nobody had implemented.

## 2026-09-23 S4.8 rescoped: no automatic theme, no native widgets — confirmed with Diego

S4.8's plan text ("the panel looks like the rest of HA... form controls are HA's own elements... panel chrome uses `ha-top-app-bar-fixed`") predates the 2026-09-21 decision below, which already settled this the other way: blueprint stays the default everywhere, `ha` is opt-in, and `primary`/`danger`/`warn`/device colours never follow the dashboard. Asked Diego directly rather than build against a since-superseded sketch or silently reinterpret it; confirmed the scope is the smallest of three offered: formalize what's genuinely still missing (`panel.ts`'s own outer wrapper — background, text, one accent — was three inline `var(..., fallback)` literals with nothing testing they matched what they claimed to follow) into a small, tested `theme.ts`, and stop there. No automatic HA-follow, no `ha-top-app-bar-fixed`, no native-picker adapter (`ha-textfield`/`ha-select`/`ha-area-picker`/`ha-entity-picker`/`mwc-button`) — the last of those would touch every field helper across `panels.ts` (~700 lines) and is a separate undertaking if ever wanted, not started here.

## 2026-09-23 S4.7 room box: plain `<select>` for "Add to area...", `platform`/`uid` added to `HaData`

The spec sketch had "Add to area..." open `ha-entity-picker`, but that element is only available inside real Home Assistant (it's an HA frontend component, not something the standalone build can import) and S4.8 ("Native look") is exactly where the editor gets an adapter that picks a real picker inside HA versus a plain control standalone. Until then, `haBox` uses a plain `<select>` limited to entities with no area — the same deviation, and the same reasoning, as S4.2's area field.

`HaData.entities[]` gained two optional fields read from the entity registry in `hass-pickers.ts`: `platform`, captured only for `light`-domain entities, tells a `switch_as_x` helper light apart from a physical one (both are plain `light.*` entities; only the registry says which integration made them). `uid`, captured only for `automation`/`script` domains, is the id an automation or script's own HA editor URL takes (`/config/automation/edit/<uid>`) — it is not the same as the entity id's object_id, which is what "Edit in HA" falls back to when a stub or an older HA has no `unique_id` on the entry.

"Run" (a scene row's button, `scene.turn_on`) does not go through the `askHa` confirm dialog that every other HA write in this codebase uses. It is reasoned as equivalent to an ordinary card tap — a scene turning on is not a registry change, and the person is already looking at the plan to do exactly this. Every other room-box action that writes the HA registry ("Add to area...") does use `askHa`.

## 2026-09-23 S4.6 automations: one config with `choose`, `openAutomation` moved out of `hass-write.ts` for build safety

Each of the three builders (`switchControls`, `motionLights`, `schedule`) returns one `AutomationConfig` with two triggers (ids "on"/"off") and a single `choose` action, not two separate automations — one POST, one entity, one thing for the user to find and edit in HA's own editor.

`openAutomation(id)` (a `history.pushState` plus a `location-changed` event, no `hass` involved) was first written in `hass-write.ts` alongside `createAutomation`. That broke the file's own header rule — "the editor never imports this file" — the moment `editor-app.ts` needed to call it after a successful write: any value import from `hass-write.ts` pulls it into the standalone bundle, which the build already guards against (`grep hass-write dist/editor.html` must find nothing, per S4.1's Done note). Moved `openAutomation` into `automations.ts` (pure, already safe to import) and re-exported it from `hass-write.ts` so nothing else had to change. The `AutomationConfig` interface, previously declared once in each file, now lives only in `automations.ts`; `hass-write.ts` imports the type and re-exports it.

## 2026-09-23 S4.5 groups: Shift+click never mixes kinds, group membership rides on `HaData.entities[].members`, dimming is a new render mechanism

Shift+click builds a `{t: "devs", is: number[]}` selection, but only by accumulating devices `groupKind` (`src/core/bind.ts`) already agrees share a kind; clicking a device of a different kind than the current selection starts a fresh single selection instead of joining or refusing. So a mixed selection can never reach the panel through normal use — `groupKind`'s own guard (unit-tested for every shape: single device, empty, mixed, non-groupable type, out-of-range index, unbound entity) is the only place "which kinds may group" is decided, and the panel is Playwright-tested with a forced mixed selection too, to confirm it stays silent even if that guard were ever bypassed elsewhere.

Group membership has no home in HA's device/entity/area registries the editor already reads through `hass-pickers.ts` — a `group.*` entity's members live only in `attributes.entity_id` on its live state. `HaData.entities[]` gained an optional `members?: string[]`, populated only for `domain === "group"`. This is the first place the editor's `HaData` snapshot carries anything from `hass.states` rather than a registry, and it stays read-only: the plan never stores group membership, and creating a group (`createHelper(hass, "group", ...)`) always asks Home Assistant to build it, never writes it to the layout.

Dimming devices outside the chosen group needed a mechanism `render.ts` didn't have: the only existing de-emphasis, `RenderOpts.filter`, hides a device outright rather than fading it. Added `RenderOpts.dimmed?: ReadonlySet<string>` (entity ids) and a `dim` class with `.dev.dim{opacity:.3}`, mirroring the existing `.dev.unavailable{opacity:.45}` rule and carrying its own `getComputedStyle` pair per Finding #10.

## 2026-09-23 S4.2 areas from the plan: a room-panel button and an unplaced-areas box, `ha-area-picker` deferred to S4.8

PLAN specced the area field itself becoming `ha-area-picker`, the native HA picker component. That belongs to S4.8 ("native look"), which is not started and adds nothing this task needs — the plain `<select>` from S1.38 already filters to unused areas and marks an unknown one. Kept as-is; noted as a deviation rather than silently dropped.

Two pieces: a custom room (or one whose stored `area` HA no longer has) gets "Create area `<name>` in Home Assistant" in its panel, confirming creates the area with the `floorplan-studio` label and links the room to it — mirrors S4.4's `createHelper`/`makeLight` shape exactly (ask, write, find the room again by id in case the plan changed meanwhile, one undo step, the HA side stays on undo). The floor panel (nothing selected) gets "Areas not on the plan": every HA area no room or zone anywhere uses, each a button that starts Draw, Room with that area preset so the finished shape takes the area's id and name directly, instead of "New room" waiting to be relinked by hand.

## 2026-09-23 An off icon's disc is 50 % in every theme

Diego's call. The disc behind an icon was 75 % in light, midnight, solarized and blueprint, 70 % in slate and 60 % in terminal. It is now 50 % everywhere, including the two `ha` variants, which inherit light and midnight. `fgAlpha` stays a theme role, so a later theme can still differ, but every shipped theme uses .5. A Playwright pair walks all seven themes and reads the computed `fill-opacity`; a unit test rejects any other `--fp-disc-alpha` in the stylesheet. Supersedes the 75 % of S1.45 and the per-theme values of S4.21. Rendered with `npm run shots` and looked at: the discs are fainter, the icons still read.

## 2026-09-23 S4.15 place an area's entities: a room-panel button, spread on a grid that avoids the label and existing devices

One button in the room panel, as PLAN sketched, not a context-menu item: the right-click menu (S4.18) already adds one entity at a time. The button places only entities that are neither drawn nor in the catalog, the same rule as S4.14's palette, so it never duplicates and disappears when nothing is left. All land in one undo step.

Placement is a 60 cm grid about the room's centre, nearest cells first, skipping the centre (the room label) and any cell within 0.7 of a step of a device already on the floor. The first version, a plain grid centred on the room, passed its tests and was visibly wrong once rendered: it covered the label and the ceiling light. The rule was tightened and a test for it added. Nothing is written to Home Assistant; the entities are already in that area.

## 2026-09-23 S4.25 unlinked devices: own schema array, fixed icon, no counter-rotation — a copy-pasted device pattern silently broke `rot`

Diego asked for a menu of unlinked-but-linkable appliances (heater, ac, heatpump, boiler, battery, lamp, computer, tv, car, server, UPS, inverter, speaker, 3D printer): placed with a fixed icon, not a swappable furniture symbol, scalable, colourable, rotatable, and attachable to zero or more HA entities for reference only. Pre-resolved before any code: a new `Floor.unlinked: Unlinked[]` array (not `furniture`, not a `Device` variant — the point is "this is a heater", which reuses the existing `DEVICE_ICONS` set rather than a furniture shape); no live-drag gesture machinery, scale/rotation/position are committed panel fields like `furniturePanel`; multi-entity attach reuses S4.24's `multiAttachField`; selection draws inside `renderFloor` via `.sel`, parallel to devices, so the editor's `overlay()` needs no new branch.

Icons for the 5 new `DeviceType`s (`boiler`, `car`, `ups`, `printer`, `speaker`; heatpump reuses `ac`, lamp reuses `light`) are real MDI paths fetched from the upstream `Templarian/MaterialDesign` repo, not invented — matching how every existing icon in `DEVICE_ICONS` was sourced.

A real defect, caught only by rendering and looking (Finding #16), not by the test written alongside the code: the render pass for unlinked items copied the device icon's transform verbatim — outer group rotates by `rot`, inner icon group counter-rotates by the same amount so the glyph stays upright. That is correct for a device (a camera's cone should point where `rot` says while the icon face stays legible) and wrong here, where nothing else sits in the group to justify it. The result validated, saved, round-tripped through undo, and passed its own unit test (which asserted the counter-rotation as the expected behaviour) — but `rot` had zero visible effect on the icon. Caught by feeding a synthetic floor with sample unlinked items into `renderFloor` directly and looking at the SVG, since `demo/layout.json` can't carry sample unlinked items itself: it's a golden fixture kept in exact `migrate(v1) === v2` equivalence with a parallel v1 test file, and even one demo-only unlinked item broke that equality test.

Fixed: an unlinked appliance is a placed object, closer to furniture than to a live-state device. `rot` now turns the glyph itself, with no counter-rotation — matching `Furniture.rot`, which already just rotates the whole group. The test that had locked in the wrong behaviour was rewritten to assert the opposite (`not.toContain` the counter-turn), and the render snapshot (built from the untouched demo) was regenerated after confirming by inspection that it changed for no other reason.

Three pre-existing Playwright tests pinned exact counts that a genuinely new `DeviceType` group is supposed to move — the Add menu's select count, the Tab-reachable item order, and the "Device colours has a row per type" count (22 → 27) — and were updated to the new, correct numbers, not loosened. No new Playwright coverage was added for the unlinked item's own place/drag/select/delete interactions; left open rather than rushed.

## 2026-09-22 S4.19 more textures and a scale slider: one input pattern, four new textures, and a real `Texture.w`/`h` fix

Diego picked S4.19 next and answered two design questions before any code: the scale control is a slider (25–200%) placed right under S4.22's rotation slider, not a separate numeric board-width field — one input pattern is enough, and a percentage is precise enough for visual matching; the four new textures are herringbone wood, parquet wood, terracotta tiles and a classic checkerboard, the spread already sketched in the plan entry.

Building it surfaced a real latent bug worth fixing rather than working around: `texturePatterns` picked each tile's declared size by testing `t.id.startsWith("wood")` (80×40 cm) versus everything else (50×50 cm) — true only because every texture happened to fit one of those two buckets. The two new wood variants (herringbone, parquet) are natively 40×40, not 80×40; keeping the guess would have silently mis-sized their patterns. Fixed by giving `Texture` its own explicit `w`/`h`, set once by each tile factory, and having `texturePatterns` read it directly. This removes the guess project-wide, not just for the new textures.

Scale composes with rotation the same way rotation composes with the plain id: a pattern id carries whichever of `-r<rot>`/`-s<percent>` actually differs from the default, so an unscaled, unrotated texture still resolves to the same bare `fp-tex-<id>` it always has (nothing already pinned to that id breaks). A scaled tile grows its declared `width`/`height` to `w*scale`/`h*scale` and gets a `viewBox="0 0 w h"` so the tile's own SVG content maps onto the new size — the pattern's box changes, not the coordinate system its drawing commands are written in.

Process note, said plainly rather than glossed over: the new core/vitest tests for this task were written after the implementation, not before, breaking the project's own TDD discipline for this one task. Caught and partly offset by stashing the six touched source files and re-running the five new Playwright tests immediately after — all five failed for the right reason (a missing `#rscale` slider, missing new swatches) before the source was restored — so the tests are confirmed load-bearing even though they weren't written first.

## 2026-09-22 S4.14 entity palette: click-to-place, a new Add submenu, S4.18's shortcut stays

Diego picked S4.14 (the full HA entity palette) next and answered three design questions (CLAUDE.md section 6) before any code:

1. **Click-to-place, not real drag-and-drop.** Every existing placement path in the editor — the Device menu, S4.18's "Add device from `<area>`" — is click, spawn, then drag into position; nothing anywhere does pointer drag-and-drop. Inventing gesture code to be the first would have been complexity with no precedent to justify it, for the same end result.
2. **A new "Entities" item in the Add menu**, alongside its existing Openings/Wall/Areas submenus, not a new root toolbar menu. Add is already "things that create something new"; the palette fits the same drawer.
3. **Keep S4.18's context-menu shortcut as it is**, don't fold it into or replace it with the new palette. It stays the fast, room-scoped path for the common case (right-click a room, add one of its area's entities); the new palette is the general path (any entity, any area, no room needs to exist or be right-clicked first).

Built as `unplacedHaEntities` (core: everything neither a device on any floor nor already in `layout.catalog`) and `EditorState.addEntity` (state: places at a matching room's centroid when one exists, else a spawn point clear of the floor). `addFromArea` (S4.18) was refactored onto the same shared private mutation the new method uses, with its existing tests left unchanged and still green, so the two paths can never drift apart on what "adding an entity" actually does to the layout.

## 2026-09-22 S4.18 right-click menu: one shared list, colour reuses the panel, a minimal S4.14 slice now, and a permanent device-type fix

Diego picked S4.18 (the right-click context menu on a room, zone or structure) from the open backlog and answered four design questions (CLAUDE.md section 6) before any code:

1. **One shared menu list**, not a menu that differs by kind — room/zone/structure all see the same items, with whatever doesn't apply (there was nothing kind-specific to hide by the time the item list was drawn up) simply not shown. Keeps future menu items from needing a per-kind branch to add.
2. **Change colour opens the existing room side panel** and reuses its own swatches, rather than a new inline colour popover. The panel is already the one place a room's colour is set; a second, parallel colour picker in the context menu would be two UIs doing the same job.
3. **Ship a minimal slice of S4.14 now**, rather than deferring the whole "drag an HA entity onto the plan" feature: the menu's "Add device from `<area>`" section lists the current room's linked HA area's entities not yet placed, and adding one places it at the room's centroid. S4.14's own drag-and-drop palette (any entity, any drop point) is still open work; this only covers the one-room, one-click case the context menu naturally offers.
4. **A risk raised mid-design, turned into a fourth decision**: `typeForEntity` (added to guess a device's type from its HA domain) can't be right for every domain — `climate`, `switch` and `media_player` cover several distinct device types each (`heater`/`ac`/other for climate; `switch`/`plug` for switch; `media`/`tv` for media_player), and until now nothing could correct a device's type once placed, whether the wrong guess came from this feature or from a hand-typed catalog entry. The device panel gets a permanent type `<select>` (`deviceTypeField` in `panels.ts`) so any device's type is always fixable, not just entities placed through this new path. Changing type drops the fields the old type used that the new one doesn't (a light's `bound`, a heater's `trvs`/`tempSensors`, an ac's `linked`), in the same undo step, so the layout never sits invalid in between.

Two platform-level bugs surfaced building the menu itself, worth recording so they aren't rediscovered: the editor's `onDown` already calls `preventDefault()` on every right-button `pointerdown` (to let a right-drag pan the canvas), and that suppresses the browser's own subsequent `contextmenu` DOM event too — so the menu has no `contextmenu` event to hook and opens instead from a stationary right-button press-release detected in `onUp`. And once `setPointerCapture` runs on `pointerdown` (as it does for every drag), `ev.target` on every later event for that pointer — including the terminating `pointerup` — reports the captured element, not whatever is visually under the cursor; hit-testing at that point has to go through `elementFromPoint` on the shadow root instead.

## 2026-09-22 S4.24 built: `cover` stays unrestricted by door kind, despite the request's wording

Building the multi-attach schema below, the first pass restricted `Door.cover` (the electric-curtain/blind field) to `kind === "glass" | "window"`, matching the request's literal phrasing ("glass doors and windows have another dropdown to attach electric curtains"). That broke `demo/layout.json`'s own "Garage door" (`kind: "door"`), which has a pre-existing, legitimate `cover: "cover.demo_garage_door"` for its garage opener — a general-purpose use of the field that predates S4.24 and has nothing to do with curtains. Caught by inspecting the fixture before running any test, not by a test failure.

Reverted: `cover` validates on every door kind, exactly as before this task — it was already a free-text field with no kind restriction. S4.24 only upgrades it from free text to a `<select>` filtered to `cover`-type catalog entries, and the panel's *label* switches cosmetically — "electric curtain" on a glass door or window, "cover" otherwise — with no change to what the field accepts or where it's offered. A curtain and a garage opener are the same kind of thing to Home Assistant (a `cover` entity); splitting them into two schema fields would have been unjustified complexity for a distinction that only exists in the panel's wording.

## 2026-09-22 Door/window sensors, heater and AC bindings: all multi-attach, one shared panel component

Diego asked for a batch of device-binding UI in one message: doors/windows attach several contact sensors, several vibration sensors and several smart locks; heaters attach TRV/climate entities and temperature sensors; ACs attach AC or TRV entities; glass doors/windows get a curtain dropdown. Two points needed a design interview (CLAUDE.md section 6) before touching schema, since guessing wrong here means redoing a schema change, not just a UI tweak.

First: "heater... and other heater specific stuff" didn't say what the "other stuff" was. Asked directly; Diego confirmed TRV + temperature sensor is the whole scope — an open-window cutoff (linking a heater to a door/window sensor so it turns off when open) was floated as an alternative and explicitly declined for now, not silently dropped.

Second: whether heater/AC bindings are single-entity (like the light's existing `bound` field: one switch powers one light) or multi-attach (like the door/window sensors Diego explicitly said "can attach more than one" for). Diego chose multi-attach for all of them. That collapses five separately-designed dropdowns into one reusable "attach several entities, filtered by type" panel component — worth doing once, well, rather than as five near-duplicate pieces of UI. Two new `DeviceType`s follow from this: `lock` (a smart door latch is not a `contact` sensor) and `vibration` (a different HA `device_class` from `motion`, and a different physical thing — room presence versus a door/window being tampered with).

This item (S4.24 in `docs/PLAN.md`) is recorded here as a design decision only; implementation has not started. The existing single-entity `Door.sensor`/`Door.cover` fields and the `bound` pattern on lights are the mechanical precedent the new multi-attach fields build on, not something this decision replaces.

## 2026-09-22 Undo/Redo move to the toolbar; a `.light` button class that doesn't touch computed colour

Diego asked for Undo/Redo to move out of the File dropdown into the top toolbar (a separator after Home Assistant, "lighter" colour) so undoing doesn't need opening a menu first. The first implementation reached for the obvious "lighter" styling — `background:transparent`, muted text colour — and it broke the pinned S1.53 accessibility test (every `.btn`'s computed colour/background pair needs ≥4.5:1 contrast; a transparent background resolves to black for that check, same failure mode Finding #10 already named once for a different rule). Caught by running the full suite before calling the task done, not by the new test alone, which only checked placement and behaviour, not styling.

Fixed with `opacity:.6` (`1` on hover/focus) instead of new colour values. Opacity doesn't change what `getComputedStyle` reports for `color`/`background-color` — only how the element composites against the page behind it — so the contrast pair stays exactly what a plain `.btn` already passes with, and the button still reads as visually lighter. Any future "lighter" or "muted" button variant in this project should use `opacity`, not a transparent or desaturated colour pair, unless a new `getComputedStyle` contrast test is written for it.

## 2026-09-22 A texture's own rotation: rooms and stairs only, a full 0–360° slider, one undo step per drag

S4.22, raised by Diego as a backlog item: "as backlog we had the option to rotate the texture of the rooms, furniture and other non functional objects. add a slider to rotate. save the rotation." The phrasing didn't map onto the schema as written — furniture has no texture/fill concept at all, only tinted line-art icons — so this went through a design interview (CLAUDE.md section 6) before any code. Three questions, three explicit answers: scope is rooms/stairs only (furniture's rendering is untouched); the slider lives in the existing paint panel, appearing once a texture is chosen; the range is the full 0–360° at 1° steps, which Diego chose explicitly over a recommended 0–90°/15° — honour that choice exactly, don't "simplify" it back down later.

`Room`/`Stairs` gain `textureRot?: number`, validated the same way stairs' own `rot` already is (`typeof === "number" && Number.isFinite && >= 0 && < 360`, so a hostile or non-finite value is refused by `validate()` and, if it slips through anyway, `render.ts` wraps it into range rather than throwing). The field is dropped whenever the texture or colour changes (a fresh texture starts unrotated) and is never stored at 0 — the project's standing "don't write the default" convention, matched by `paint()`'s existing `color`/`texture` reset line growing a third `delete`.

Rendering keeps the plain, unrotated pattern id (`fp-tex-<id>`) byte-for-byte unchanged for `rot === 0`, so every test and every layout already pinned to it keeps working; only a non-zero rotation gets its own distinct id (`fp-tex-<id>-r<rot>`) with a `patternTransform="rotate(<rot>)"`, exactly the mechanism the pre-existing 45° hatch pattern already used. Multiple shapes sharing a (texture, rotation) pair share one `<pattern>` declaration — `texturePatterns()` now dedupes by that composite key instead of by texture id alone.

The slider needed a new undo primitive. Every other continuous gesture in the editor (a dragged corner, a resized sofa) snapshots once on the first real pointer movement, then previews freely via `replaceFloor` until release. A range input's gesture is shaped differently — "before" needs capturing at drag start, "after" is whatever the input is showing when it fires `change` — so `EditorState` gained `commitLiveEdit(before: Layout): boolean`, which pushes the given `before` onto history (rather than the current layout, as `snapshot()` does) and returns `false`, recording nothing, if the layout it's given already matches where things stand now. That covers a drag that ends back at its starting value with no extra bookkeeping in the caller. The editor wires this up defensively: a `commit` phase captures its own "before" if no prior "live" tick already did, so a bare click on the slider track (no drag) or a keyboard-driven change still commits correctly, not just a real drag.

Files: `src/core/schema.ts`, `src/core/textures.ts` (`normTextureRot`, `texturePatternId`, `texturePatterns()` now over `{id, rot}` pairs), `src/core/render.ts` (`paintAttr`), `src/editor/state.ts` (`paint()`'s `rot` param, `commitLiveEdit`), `src/editor/editor-app.ts` (`rotateTexture`, the live/commit gesture), `src/editor/panels.ts` (the slider itself), `docs/SPEC.md`. TDD: 5 vitest cases in `tests/core/paint.test.ts` written and run against no implementation first — 4 failed for the expected reasons (missing `commitLiveEdit`, `rot` silently dropped, no rotated `<pattern>`), 1 passed incidentally (pure schema validation was already correct). 4 new Playwright tests in `tests/editor/editor.spec.ts` cover the slider's visibility, live preview, the single undo step, the no-op-drag case (run `--repeat-each=10` clean, per Finding #13), and a save/reload round trip. `npm run shots` run and looked at — the demo paints no texture by default so nothing moved there, but a manual check (a room painted "Light wood", dragged live to 35° in the running editor) showed the board grain turn correctly, not just a passing assertion. Full suite green: lint/tsc clean, 752 vitest (5 new), 372 Playwright passed / 1 skipped (4 new).

## 2026-09-22 Theme picker moves into a View submenu; a submenu-toggle bug fixed at the root

S4.21 follow-up, same day. Diego, on seeing the built editor: "why not a menu item with a submenu?" — seven theme chips flat in the View menu was the same crowding S4.11 fixed for Add's Openings/Wall/Areas. Moved to a `Theme` submenu (`<details class="sub" id="thSub">`, summary text shows the current theme), same markup pattern as Add's submenus.

This surfaced a real bug, not just a test-authoring nuisance: a theme button carries `.keep` (so clicking it never auto-closes the menu, letting you flip themes without reopening View each time), and `onWindowClick`'s close logic only fires for a click outside the menu, or a click on a button lacking `.keep` inside it. Closing `View` by clicking its own summary a second time — plain native `<details>` toggle behaviour — hits neither branch, so the nested `Theme` submenu was left open underneath a closed View menu. Reopening View then showed Theme already open, and driving it as "click summary to open" instead closed it. Fixed at the source with an `onOptToggle` handler on `#mOpt` that calls the existing `closeSubs` whenever the menu itself closes, mirroring `onDevToggle`'s existing "closing by any route" handling for the Device menu's search field. Files: `src/editor/editor-app.ts` (`onOptToggle`, `#thSub`), `tests/editor/editor.spec.ts` (`setTheme()` and one direct-assertion test open `#thSub` before touching a `[data-th]` button). Full suite green: lint/tsc clean, 747 vitest, 368 Playwright passed / 1 skipped; the test that caught the bug also run `--repeat-each=10` clean, since a menu-state bug like this is exactly the kind of thing that reads as flaky rather than as a defect (Finding #13).

## 2026-09-22 Themes are built from four colour roles; blueprint gets a new palette, the old one is renamed midnight

S4.21. Diego's brief, verbatim: four roles for a theme — a base hue shaded across every structural surface (ground, walls, garden, doors...), white (or whatever the theme picks) for text/icons/detail, a line colour for the measurement grid, and one saturated accent for anything "live". "Collapse to one accent (but depending on the theme they can be all different or not, in the theme config allow for each device and entity type to have his colour)" settled the device-colour question: default to the accent, but let a theme's definition override specific types. New module `src/core/theme-roles.ts` (`ThemeRoles`, `rolesToTokens`, a small dependency-free hex↔HSL shader, stdlib only per CLAUDE.md section 8) turns four roles into the full `--fp-*` token string a theme needs, so a new theme is four colours and a light/dark direction, not ~50 hexes kept in step by hand. Three themes are generated this way: `blueprint` (Diego's description — replaces the old default), `slate` (light grey) and `terminal` (near-black, terminal green). `solarized` is bespoke on purpose (Diego: real Solarized fidelity matters more than reuse here) — the actual Solarized dark palette, with every device type kept in its own hue as the worked example of the `devices` override, since none of the three generated themes use it. The project's original dark theme, previously the `blueprint` id, is renamed `midnight`; its hex values are untouched. `ha` stays untouched by this system entirely (confirmed default): its fallback is midnight's fixed hexes, not blueprint's new ones — a deliberate split from the new default, not an oversight, and `tests/core/render.test.ts`'s theme test was rewritten to check against midnight rather than the CSS's base `:host,.fp` block for exactly this reason.

Mid-task correction (Opus review): the first pass also folded warn/danger/primary and their on-dark/on-light text into the accent role, reasoning they were "live" UI too. That broke a standing 4.5:1 contrast test (white text on an orange Save button read 2.1:1) and would have repainted every warn/danger button in every generated theme — something never asked for; Diego's brief was about the plan's own colours, not UI chrome. Reverted: those five tokens are one fixed literal pair in `rolesToTokens`, exactly as `MIDNIGHT_TOKENS`/`LIGHT_TOKENS` already defined them, in every theme, generated or not. `--fp-room-empty` (the unpainted-room grey) is likewise never role-derived, per the earlier 2026-06 decision that it is one fixed colour in every theme.

Files: `src/core/theme-roles.ts` (new), `src/core/render.ts` (`THEMES`/`Theme` now seven entries; `DARK_TOKENS` renamed `MIDNIGHT_TOKENS`; `BLUEPRINT_TOKENS`/`SLATE_TOKENS`/`TERMINAL_TOKENS` via `rolesToTokens`; `SOLARIZED_TOKENS` bespoke; a `FLOORPLAN_CSS` block per new theme), `src/editor/editor-app.ts` (`THEME_LABELS`), `src/card/floorplan-studio-card.ts` (doc comment), `docs/SPEC.md`. TDD: `tests/core/theme-roles.test.ts` written first (7 tests: every token a hand-written theme defines is present; room-empty and the warn/danger/primary/on-dark/on-light pair are fixed regardless of the roles given; device colours default to the accent unless overridden; camera/garden are neutral, never accent, because they are static icon tints, not `.on`-gated state; dark vs. light flips the shade ramp's direction; the line role is independent of the foreground). Load-bearing: reverting the accent-collapse fallback failed the "device colours default to the accent" test, then was restored. `npm run shots` run and the blueprint card/editor actually looked at: a legible dark-blue plan, white text, a faint green measurement grid, orange "on" icons. Repointed pins in `tests/card/card.spec.ts`, `tests/editor/editor.spec.ts`, `tests/editor/theme-css.spec.ts`, `tests/core/render.test.ts` to blueprint's new hexes or midnight's old ones, whichever the test was actually pinning. Full suite green: lint/tsc clean, 747 vitest (7 new), 368 Playwright passed / 1 skipped.

## 2026-09-22 A structure line (`Extra`) is selectable, movable and deletable, like a wall

S4.13. Diego's report ("the ones in basement I cannot do anything with them") read like a zone bug but was `Extra`: the free-standing annotation kind used for things like a boiler or a tech area. It had no entry anywhere in the `Hit`/`Sel` type system — no selection, no panel, no delete, ever, on any floor — because `render.ts`'s `.extra` CSS rule set `pointer-events:none` and its shapes carried no `data-ex` attribute, so an extra's own body could never receive a click. Fixed by mirroring the existing, proven loose-entity pattern used for `Wall`: `pointer-events:all` (matches `.room`'s own rationale for the same problem), a `data-ex` index attribute, `"extra"` added to `Hit` and `Sel`, a panel (name, length, Delete), whole-body drag via the shared `LooseRef` mechanism, and — new — auto-select on finish, matching `Opening`'s existing behaviour (extras previously stayed unselected after being drawn, on purpose; that asymmetry with Opening had no stated reason and is now removed). `spawnPoint` (`src/editor/ops.ts`) also changed in the same branch: it now reads every point already on the floor (`contentPoints`), not only the outline, so successive spawned items land clear of everything already placed. Files: `src/core/render.ts`, `src/editor/state.ts`, `src/editor/editor-app.ts`, `src/editor/draw.ts`, `src/editor/panels.ts`, `src/editor/ops.ts`. TDD: `tests/editor/editor.spec.ts` (drawn over a room on purpose, deselect, click the line's own midpoint, still selectable and deletable), load-bearing verified by reverting the CSS/attribute change and watching the new test fail. Full suite green: 740 vitest, 368 Playwright, tsc and eslint clean. Separately, a specific "wall I can't delete" report turned out to be a data/UX ambiguity (a loose `Wall` sitting almost exactly on a room's own boundary edge in Diego's real layout, not on `demo/`) — no code defect, no fix made.

## 2026-09-22 S4.10's cleanup list reads only entities and areas, not devices

The spec sketch called for scanning `config/device_registry/list` too, alongside entities and areas. Dropped when building: `createHelper` (S4.1) labels the helper's own *entity* (`config/entity_registry/update`), never its device, so a device-registry scan would never turn anything up — every helper this tool makes is found through the entity list already. `createArea` and `createAutomation` (S4.2, S4.6, both still unbuilt) don't create devices either: an area is its own registry row, and an automation is an entity. Adding the device scan back is a one-line change (`hass.callWS({type: "config/device_registry/list"})`, filter by `labels`, map to `kind: "helper"`) if a future writer ever labels a device instead of its entity — nothing about the `Labelled` shape or `removeLabelled` needs to change for it. `listLabelled`/`removeLabelled` in `src/editor/hass-write.ts`, the "Home Assistant" toolbar menu in `src/editor/editor-app.ts`. TDD: `tests/editor/hass-write.test.ts` (listing groups by kind, an unlabelled row is left out, each kind's delete call), `tests/editor/editor.spec.ts` (the menu lists grouped by kind, Remove asks then deletes and the row is gone on reopen, a failing delete changes nothing, no writer means no menu). Full suite green: 739 vitest, 363 Playwright, 24 pytest, tsc and eslint clean.

## 2026-09-22 A locked wall, door or opening pivots on drag; it does not translate

S4.9. Diego's own words on the open design question: "when you drag a wall it moves the wall, when you drag a point of a locked wall it just moves in an arch of fixed radius. the length is fixed." So a `locked` segment's dragged end is projected onto the circle of that fixed radius (its length when locked) around the other, un-dragged end (`pivotOnArc` in `src/editor/ops.ts`) — not clamped along the segment's own line, and not a rigid translate or rotate of the whole segment. Wired into two separate drag paths in `editor-app.ts`: the shared `"corner"` case (walls and openings, both loose two-point segments hit via `data-hp`) and the door-specific `"dend"` case (doors have their own hit and drag type because a door also snaps along its host wall). Typing a length into an unlocked segment's panel field locks it, by default (`wallPanel`, `doorPanel`, `openingPanel` in `panels.ts`); a typed length always applies regardless of lock state; unticking the new "length locked" checkbox frees the segment for an ordinary length-changing drag again. Out of scope: room/zone polygon edges (`edgePanel`) have no per-edge `locked` field — locking one would need a `locked?: boolean[]` array parallel to a room's `wk`, a bigger schema change than this slice justified — and `Extra` (no selection or panel infrastructure exists for it at all) and the `{a,b}` `Device` variant (heater runs drag as a rigid whole body only, with no per-endpoint handle to intercept, so length is already preserved on every drag). `locked?: boolean` added to `Wall`, `Door` and `Opening` in `schema.ts`, validated like `Room.free`. TDD: `pivotOnArc` unit-tested in `tests/editor/ops.test.ts`, schema validation in `tests/core/schema.test.ts`, drag behaviour end to end in `tests/editor/editor.spec.ts` (wall arc, wall type-locks then unlock frees the drag, door arc, opening arc).

## 2026-09-22 The demo layout carries a "Test" floor, one plain room

Diego wants a stable fixture for demos and for quick manual checks: a third floor, "test", with one square unpainted room (`area: "test"`), added to both `demo/layout.json` and `demo/layout.v1.json` at the end so key order stays `ground, first, test`. Flagged as risky before building it: `demo/layout.json` backs ~350 Playwright tests and most of the vitest suite, and every hardcoded floor-key array or chip count in those tests now needed a fourth entry (`state.test.ts`, `card.test.ts`, `editor.spec.ts`, `card.spec.ts`). Root cause of the first two failures after adding it: `migrate()` derives a room's `area` from `slug(name)` when the field is absent, so the v1 fixture needed an explicit `area: "test"` to match v2, and the v2 floor needed the `owk` (outline wall kinds) array `migrate()` adds to every floor. All three files' expectations were walked through by hand and updated to match the new floor order and the selection/undo semantics around it (deleting the newly-`test`-adjacent floor no longer selects the same neighbour it used to). Full suite green after: 730 vitest, 357 Playwright, 24 pytest, tsc and eslint clean.

## 2026-09-22 An unpainted room is one light gray, in every theme

Diego: an unpainted room ("kind: room" or "structure", no `color` or `texture`) looked light gray to him whatever theme he ran, not the theme's own tint. New token `--fp-room-empty` (`#d6d6d2`, fixed in `LIGHT_TOKENS` and `DARK_TOKENS`, so `ha` never overrides it from `--secondary-background-color` the way `--fp-room` still does everywhere else) replaces `--fp-room` in the base `.room:not([fill])` rule only. `--fp-room` itself is unchanged and keeps doing its other jobs (editor and card chrome backgrounds, the opening stroke). Garden, terrace, pavement, water and zone keep their own kind colour; only the plain, unpainted room reads as "not yet painted". `tests/core/render.test.ts`, `tests/card/card.spec.ts` (S2.6 glow), `tests/editor/editor.spec.ts` (S2.12, S1.53) updated for the new fixed value.

## 2026-09-21 Sprint 4a: writes to Home Assistant go through one module the editor never imports

The first Sprint 4 slice is S4.1 (write layer), S4.4 (a light from a placed switch) and S4.3 (a dropped device into the room's HA area). Every write lives in `src/editor/hass-write.ts` and every question in `src/editor/confirm.ts`. The panel builds a writer from `hass` (late-bound, because `hass` is replaced on every state change) and sets it on the editor as a property; the editor only knows the `HaWriter` type. The standalone build has no writer, so it shows no button that needs one, and `dist/editor.html` holds none of the write code (checked by grep). Nothing writes on load or save. Tests use a stub `hass`; the one live write on Diego's HA needs his yes first. Every dialog ends "Home Assistant cannot undo this." and focus starts on Cancel. Asked every time, except a device-to-area move, which offers "Don't ask again this session" (kept in memory, not stored). Rules: a light made from a switch is a `switch_as_x` helper labelled `floorplan-studio`, the plan swaps the switch for the light 30 cm to its right, bound to the switch, in one undo step, and undo does not remove the helper from HA (the status line says so). A device move writes the device when the entity is its only one, else the entity alone so its siblings stay (`areaMove` in `core/ha.ts`). If the person declines, the device panel keeps a note and a button to move it later. `createArea` and `createAutomation` wait for the tasks that need them.

## 2026-09-21 The catalog is not rebuilt from Home Assistant on Save

S3.3 said the catalog would be rebuilt from HA's entity list on Save. Dropped. Diego's HA has 3185 entities; his catalog is a curated 235 of them, and a rebuild would flood the Device menu and undo that curation. The Device menu keeps drawing from the catalog; the entity picker on a device draws from HA. An entity picked there is not added to the catalog (a placed device does not need one). If a way to add HA entities to the catalog by hand is wanted, it is its own task. The picker also hides entities already on the plan, except the device's own.

## 2026-09-21 The panel feeds the editor Home Assistant's data; a device's entity is a picker

Until now `editor.ha` (floors, areas, entities) was only set by tests, so the area and entity dropdowns never showed in the panel. `haData(hass)` (`src/editor/hass-pickers.ts`) reads the floor, area, entity and device registries once after the load; the entity's own area wins over its device's; disabled entities are left out; a registry that fails leaves its part empty, and if neither the area nor the entity registry answers there is no data and the text fields stay. The panel hands the data to the editor as a property set on the element, never through the template, so a late answer cannot re-run the layout setter (the reset bug of 0.5.1). A device's entity is a select: entities that suit its type (`entitiesForType`: domain and device class), those in the room's area first, then everything else so nothing is out of reach, plus "(not connected)" which writes `entity: ""`. An id HA does not know stays selected. Devices with `entity: ""` are drawn with a dashed orange outline in the editor only, and listed as "Needs an entity" on the floor panel. Not done: hiding entities already placed, and rebuilding the catalog from HA on save.

## 2026-09-21 Custom colours are kept in `layout.palette`; rooms and stairs may have a texture

A colour picked on the free input that is not one of the twelve built-in swatches is added to `layout.palette` (lower-case, newest last, at most 24, no duplicates), so it is offered as a swatch on every room and staircase and survives a save. It is in the layout, not the browser, because the plan is the one place Diego's colours already live. `texture` on a room, zone or staircase names one of seven built-in patterns (three woods, four stone tiles); a texture and a colour exclude each other, and painting one removes the other. Textures are fixed ids, not free SVG: the render writes only `url(#fp-tex-<id>)` from a whitelist, and declares only the patterns in use. Zones already took a colour (they are rooms); stairs gained `color` and `texture`. Not done: uploaded images, per-texture scale or rotation.

## 2026-09-21 The drawing board ignores Home Assistant; the grid starts at the plan's corner

HA sets `hass` on the panel at every state change. Lit re-sets object properties on every render, so `.layout=${obj}` re-ran the editor's `layout` setter each time and reset zoom, selection, undo and every unsaved edit. The panel now renders the editor through `guard([layout, dark])`: it re-renders only when the loaded layout or the theme changes. The editor is a drawing board; it does not follow HA. A test fails without the guard. The measure grid now has zero at the outline's min x and min y (top-left corner of the plan), lines every 50 cm (steps grow so no axis exceeds 400 lines), and covers the whole visible region, also when the plan is rotated. Zoom buttons (+, -, 0) sit top right of the canvas; none is an edit. Lesson: a panel test must check that the editor's state survives a `hass` update, not only that `load` is called once.

## 2026-09-21 A device may have an empty entity

`validate()` accepted only an entity id for `device.entity`. Diego's home has lights that are plain wired fittings: they exist on the plan and are not in Home Assistant until he wires them to a switch. Dropping them loses the plan; inventing an id breaks the rule in `SCHEMA.md`. So `entity: ""` is now valid on a device (`bound` still must be an id). The catalog was never checked, so it is unchanged. The card already ignores an empty id on tap. The editor's entity field is free text, so an unbound device can be attached by typing; the picker in S3.3 will make it easy (PLAN note added). `prompts/SCHEMA.md` still tells a drawing-reading model to leave devices empty; that is unchanged.

## 2026-09-21 Update banner reads HACS's update entity; icon ships in the integration

The panel does not call GitHub. It finds the HACS update entity by its
`release_url` (so a renamed entity still works), shows the banner while it is
`on`, and installs through `update.install`. It can only show what HACS has
already noticed; HACS polls on its own timer. After an install HA needs a
restart, and the banner says so. Brand images live in
`custom_components/floorplan_studio/brand/` (source: `assets/brand/icon.svg`),
which HA 2026.3 and later reads with no brands-repository entry.

## 2026-09-21 Reset means blank; Load demo is separate and only on a blank plan

Supersedes the `seed` entry below: File, Reset used to return to the starting
layout. It now erases to a blank plan (confirm, one undo step), which is what
"start from scratch" means. `seed` is gone; a `demo` property drives File,
Load demo, greyed out unless nothing is drawn. Found on the way: the panel gave
the editor `emptyLayout()` when nothing was stored, and the editor refused it
(outline needs 3 points), so a fresh install showed an error list. The panel
now leaves `layout` unset then, and Reset bypasses the validator for the same
reason. Its test now reads the editor's own `errors`, not just the panel text.

## 2026-09-21 The sidebar link is an option, on by default

Configure on the integration has one switch, `show_in_sidebar`. Off removes the
sidebar link only; the card script and the websocket stay. Changing it reloads
the entry. The link is not auto-created: Home Assistant loads a custom
integration only once it has an entry, so the README carries a one-click setup
link. Hiding through HA's own sidebar editor still works per user.

## 2026-09-21 Install and update through HACS releases, never by copying files

The maintainer will not copy files into Home Assistant by hand. A `v*` tag
builds the card, panel and editor, zips the integration with them in `www/`,
and publishes it as a release asset. HACS installs that zip (`zip_release` in
`hacs.json`). Built files stay out of git. The integration adds the card script
to every dashboard, so there is no Lovelace resource to add. This replaces the
own-HA route of S3.0 for live checks: first release, then install by button.

## 2026-09-21 Panel: a failed load shows an error, never an empty editor

The panel is the editor plus two websocket calls. If `load` fails it shows the
error and a Retry button. An editor opened on an empty layout would let one
Save overwrite the stored plan. With nothing saved yet (`layout: null`) the
editor opens empty, which is not an error. The sidebar entry is admin only.

## 2026-09-21 Integration: one layout in `.storage`, the door checks only `version`

`load` is open to every user, `save` to admins. `save` rejects anything that is
not an object with `version == 2` as `invalid_format`. The full schema check
stays in the editor (`src/core/schema.ts`), so Python does not carry a second
copy that drifts. Adding the integration creates the entry at once, with no
form, and `single_config_entry` in the manifest allows one instance.

## 2026-09-21 Sprint 2 closed; monitored devices are grey and open more-info

Sprint 2 is done: card, themes, air conditioner, screenshot harness. Two calls
made on the way. An air conditioner's colour comes from its state, so
`colors.ac` stays inert: one knob cannot name cool and heat. Battery, inverter,
server and access point are watched, not switched: idle grey always, and a tap
opens more-info, never a toggle. A low-battery colour waits for someone to ask.

## 2026-09-21 Themes: blueprint default, light, and Home Assistant's own; Auto is gone

Diego's call. Supersedes the Auto/Light/Dark choice of S1.53 and the
"follow hass.themes.darkMode" rule of S2.1. Blueprint is the default everywhere.
`light` stays. `ha` inherits the dashboard's variables for neutrals only, with the
plain light or dark set as fallback. Assumptions, stated to Diego: blueprint
replaces the old dark; nothing follows the OS scheme any more, because a default
that changes with the viewer's OS is not a default; primary, danger, warn and the
device colours do not follow the dashboard, because HA's primary colour with white
text can fail 4.5:1 and a light must stay amber. Cost: the dashboard's dark mode no
longer darkens the card by itself. Set `theme: ha`.

## 2026-09-21 The agent path is a skill and a schema, pulled forward; dark theme becomes blueprint

Diego's call. Most people will never type a layout: it comes from an architect's
drawing, a photo or a sketch, through an assistant. So S5.2's one-shot prompt is
replaced by S5.8, pulled ahead of Sprint 3: `prompts/SKILL.md` (procedure),
`prompts/SCHEMA.md` (format for a reader), two examples, and
`scripts/validate-layout.mjs`, which wraps the existing `validate()` and adds
what a model gets wrong: metres for centimetres, a room outside the outline, a
door on no wall. The skill keeps `devices` and `catalog` empty: a drawing holds
no entities, and an invented entity id is worse than none. The README's "Open in
Claude / ChatGPT / Grok" buttons pointed at `prompts/trace-from-photos.md`, which
never existed; they are replaced by a link to `prompts/README.md`, which
explains loading the skill into each assistant.

Same message: the dark theme is to be a blueprint style (navy ground, blue
linework, one orange accent), taken from a reference screenshot Diego supplied.
Assumed: it replaces the dark theme rather than adding a third; light stays.

## 2026-09-21 Verify moves from every task to sprint close

Diego's call, for throughput. Until now every task ran Execute → Verify →
Review, three sessions each. Across Sprint 2 the Opus reviews caught the design
defects (three separate visible-but-green bugs in S2.9 alone) and the verifier
caught one real thing: three device types with no active colour. One session
per task was not buying enough.

From now Verify runs once per sprint, over every task in it at once: the full
suite, then each task's "Done when" list and "Break it" line, then a per-task
PASS/FAIL table. Only the failing tasks go back to Execute and get re-verified.
Execute and Review stay per task, unchanged.

What is deliberately not relaxed: a task still closes only when its own tests
pass in a real run, and nobody reports green they did not see. The accepted
trade is that a defect surfacing at close can touch several tasks at once, so
the fix is bigger when it lands.

## 2026-09-20 task/S2.9: media and cover get an active colour, and every type must have one

The S2.9 verifier found that `media`, `cover` and `other` had no
`.dev-<type>.on` rule, so they fell through the catch-all and read idle grey
when active, while the behaviours table promised a media player an accent when
playing. Grey by omission and grey on purpose look identical on screen, which
is how three types went undecided through a task whose done-when is "one row
per type with its colour".

`media` takes `--fp-dev-media` (#2c7fb8), the same blue as `tv` — it is the
same thing to a reader glancing at the plan, and a separate token means the
two can part company later without a second edit. `cover` takes
`--fp-dev-cover` (#f28c28), the orange a door's cover already shows when it is
open, so an open blind and an open garage door read the same. `other` stays
`--fp-idle` and now says so in the table. `ac` is still idle: S2.10 gives it
cool and heat.

`DEVICE_COLOURS` moved with them (#8b8578 to the new values). That map is what
the editor's colour picker offers as each type's default, so a value that
disagrees with the palette variable shows the user a swatch the plan will not
draw.

Two tests hold this shut: every member of `DEVICE_TYPES` must either name its
own `--fp-dev` variable or appear in a written list of types that are idle on
purpose, and every type whose palette variable exists must equal its
`DEVICE_COLOURS` entry.

Side effect, recorded rather than changed: the editor's "preview open"
checkbox reuses the class string `"door open"`, so it moved from orange to red
with the contact rule. That is correct — it previews what an open door looks
like — but nobody chose it, and it has no test.

## 2026-09-20 task/S2.9: a device wears its colour when it is on

One `--fp-dev` custom property, set per type (`.dev-<type>.on{--fp-dev:...}`)
and read by two shared rules, `.dev.on path{fill:var(--fp-dev-fill,var(--fp-dev))}`
and the new `.dev.on .halo{fill:var(--fp-dev);fill-opacity:var(--fp-alpha)}`.
This reuses S2.2's `--fp-dev-fill` fallback chain (a smart light's own colour
still wins) instead of adding a second source of truth, and reuses S2.8's
`--fp-alpha` (25 %) for the halo tint rather than the disc's own 75 %
(`--fp-disc-alpha`) — that one stays untouched so an inactive device keeps its
plain white disc. `.dev-switch.on` and `.dev-humidity.on` set `--fp-dev` to
`--fp-idle`, matching Diego's list: those two read the same on and off. The
motion fade rule (`.dev.dev-motion path{fill:color-mix(...)}`) is unchanged
and still wins on the icon `path` (same specificity, later in source, the
S1.6 fix); only the halo reads `--fp-dev` for motion, so a fading-out motion
sensor's disc is red at once while its icon fades.

Changed the task text's literal reading of "a contact device draws red
whether it is a device icon or a door sensor": a door's `sensor` field
(`.door.open`) used to draw orange (`--fp-open`, the same colour as a plain
open cover). It now draws `--fp-dev-contact` (red), matching the SPEC table
row for "binary_sensor on a door or window". `.door.cover-open` (driven by a
`cover` entity, not a contact sensor) keeps `--fp-open`; the two were never
the same kind of open and now read differently on the plan.

`.room.on` and `.furn.on` (S1.37, wired here for the first time) tint when
that entity is on, open or playing. `.room.on` keeps the established
`:not([fill])` guard (S2.6's pattern) so a room's own `color` still wins.
`renderFloor` never puts `on` on a room that has an `area` (only `entity`
rooms tint), even if both fields happen to be set — the schema allows it,
the render guards it.

Coordinator block, after looking at a real render: the first version of
`.room.on`/`.room.glow` read `fill:var(--fp-glow)` outright. `:not([fill])`
gives that rule (0,3,0) specificity, which outranks every room-kind rule
(`.room-water` etc., (0,2,0)), so it did not tint the room's own colour, it
replaced it — a water room with its pump on went plain pale yellow, and the
same bug already existed in `room_glow` (S2.6), untouched until now because
nobody had looked at a lit water room next to an idle one. Fix: every kind
rule now names its own fill as `--fp-room-fill` (`.room-water:not([fill])
{--fp-room-fill:var(--fp-water);fill:var(--fp-room-fill)}`, and so on for
room, garden, terrace, pavement and the hatch); `.room.glow` and `.room.on`
read `fill:color-mix(in srgb,var(--fp-glow) 25%,var(--fp-room-fill))` —
a tint of the room's own colour, never a value with no idea what was under
it. 25 %, not 50 %: at 50 % a water room's own blue was already outweighed
by the warm glow and read closer to yellow than blue; 25 % (the same
fraction as `--fp-alpha` elsewhere) keeps the kind colour recognisable.
Both the pre-existing `room_glow` bug and the new `.room.on` rule are fixed
in this same change, not two rules carrying one flaw forward.

Same block, second finding: `.furn.on{color:var(--fp-glow)}` painted the
symbol's `currentColor` stroke with a token built to be a room *fill* sitting
close to the room's own colour — against a room, a lit sofa nearly vanished
in both themes (measured: 1.01:1 in light, 1.65:1 in dark; WCAG's floor for
a graphical object is 3:1). Fix: a new token, `--fp-active`, amber like
`--fp-on` but chosen per theme for contrast — `#8a5117` in light (5.0:1
against `--fp-room`, 5.6:1 against `--fp-bg`), `#e0a800` in dark (6.8:1 /
8.0:1, the same hex as `--fp-on` there, which already read well on a dark
floor). `.furn.on{color:var(--fp-active)}`. Turning something on now makes
it more present in both themes, not less.

Every rule above has a `getComputedStyle` pair in `tests/editor/editor.spec.ts`
("Opus review CSS pair"), read in real Chromium, including the break-it case
(a light that is `on` and `unavailable` keeps `opacity: 0.45`), the water
room staying blue-ish on (not the raw glow value, not the plain kind colour),
the same fix applied to `room_glow`, and the furniture accent's exact value.
A rendered screenshot (demo ground floor, a water room and a piece of
furniture carrying an `entity`, on/off, light/dark) was the check that found
both bugs — the string and computed-style tests passed the whole time.

Second coordinator block, after cropping the same render at 4x: the fix above
closed the "went plain yellow" bug but opened a subtler one. `--fp-glow` is a
pale warm yellow and `--fp-water` is a pale cool blue at nearly the same
lightness, so mixing them desaturates rather than brightens — on screen a
pond that was ON read as a *duller, greyer* blue than the same pond OFF. A
pump that starts running made its pond look switched off: confidently wrong,
not obviously wrong, and worse than the first bug for it. A fill tint is the
wrong mechanism for an "on" signal on a room: it has to compete with a fill
that already carries meaning (the room's own kind colour), and it will lose
or muddy that meaning for some kind every time — `zone`'s fill is `none`, so
even a correct tint there is a silent no-op, invisible regardless.

Fix: `.room.on` no longer touches `fill`. It strokes the polygon in
`--fp-active` instead — the same token furniture already wears when on, so
"on" reads as one colour across the whole plan, and an outline never fights
whatever is underneath it. `.room.glow` is untouched, still the `color-mix`
fill: glow is light spilling into a room, an honestly warm tint, a different
signal from "on" and kept as one.

Two things fell out of moving to a stroke. First, `.sel{stroke:var(--fp-ink)}`
is one class (0,1,0); `.room.on{stroke:...}` is two (0,2,0), which always
outranks it regardless of source order (CLAUDE.md finding 10 again) — a
selected room that was also on would stop showing its ink selection outline.
`.room.on.sel{stroke:var(--fp-ink)}` (0,3,0) wins over both, defensively,
whether or not the current code ever actually puts `.sel` on a room polygon
today (it doesn't — the editor draws room selection as a separate `.hl`
overlay in `editor-app.ts`, not a class on the room itself). Second, and not
anticipated by the coordinator's suggested rule: a room's own boundary is
almost always also a wall, and every wall gets a white halo drawn on top of
the room, right along that same line, after the room in DOM order. A
same-width stroke on the room polygon itself sat *under* that halo and was
nearly invisible — only slivers showed through a dashed wall's gaps, found by
re-rendering and cropping the pond again after the first fix, the same way
the coordinator found the original two bugs. `renderFloor` now draws the
ring a second time, as an undecorated `fill="none" pointer-events="none"`
polygon, after every wall line — genuinely on top, and taking no clicks of
its own (the original polygon underneath still does).

Every rule has a `getComputedStyle` pair in `tests/editor/editor.spec.ts`:
the water room's `fill` is now unchanged by `.on` while its `stroke` becomes
`--fp-active`; a `zone` room (fill:none) still strokes on `.on`, closing the
silent-no-op case; a room that is both `on` and `sel` (constructed by hand,
the same technique the motion-fade pair uses) strokes with `--fp-ink`, not
`--fp-active`. `tests/card/card.spec.ts` adds one more, against the real
card with a live entity, not hand-toggled classes: the ring polygon exists,
its DOM index is after the last wall line, its `pointer-events` is `none`,
and the room's own fill never moved. A rendered screenshot (same ground
floor, pond and sofa, on/off, light/dark) was looked at again: the ON pond
now shows a solid amber ring around a plain water-blue fill; the OFF pond
shows only its ordinary dashed boundary and no ring, in both themes.

## 2026-09-20 task/S2.7: the confirm dialog's text follows the action, not the PLAN block's literal wording

Opus review found the bug the entry below missed: the PLAN block fixed the dialog's words ("Open
`<name>`?") before anyone thought about the closing case, so a cover already `open` got a dialog
that said "Open" while its button called `close_cover`. The text lied about what pressing it would
do, on the one control in this card that moves something in the real house. A confirmation that
misstates the action is worse than no confirmation at all, because the person has been trained to
read and trust it — a dialog that lies is worse than silence.

Fix: one method, `_coverService(door)`, reads `hass.states[door.cover].state` and returns which
service a press would call. The dialog's question, its button's own label, and the actual
`callService` call all derive from that one method, never from three separate reads that could
drift apart. Not `"open"` (closed, `opening`, `closing`, `unknown`, `unavailable`, or missing from
`hass.states`) reads "Open"; `"open"` reads "Close" — the same split the service call always made,
now driving the words too.

The reviewer asked directly whether a cover that flips state while the dialog is open can both (a)
act on the state at press time and (b) never act against its own label, and told me to say which I
chose if I could not have both. I can have both, and did: `hass`'s setter calls `requestUpdate()`
on every assignment, Lit's re-render for that change completes (a microtask) before the browser can
deliver the next user click (a later macrotask/event), and `_coverService` is read fresh at render
time and again, separately, at the moment `_confirmCoverDialog` runs. A click can only land after
the label the person is looking at reflects the state that produced it, so the two hold together;
there is no path where a stale render is still on screen with a click already in flight. This is a
property of the browser's event loop plus Lit's synchronous-relative-to-input update scheduling, not
a coincidence to keep re-checking by hand — the new mid-dialog-state-change test in
`tests/card/card.test.ts` pins it so a later change that broke the ordering would fail loudly.

`role="dialog"`, `aria-modal="true"` and `aria-labelledby` (pointing at the question paragraph) were
already in the markup from the first S2.7 commit; they were just never mentioned in the report or
covered by a test, both now fixed.

## 2026-09-20 task/S2.7: a cover that is `opening`, `closing`, `unknown`, `unavailable` or missing from `hass.states` still opens the dialog, and Open still calls `open_cover`

The PLAN block's interface line is literal: "Open calls `cover.open_cover` (or `close_cover` if
`state === "open"`)". It names one state, `open`, that flips the service; it says nothing about a
cover mid-motion. Two readings were possible: gate the tap so a moving cover cannot be tapped at
all, or leave the tap open and let the one comparison already in the interface decide the service
for every other state. The second is what got built, for three reasons: it needs no new state
machine (KISS, CLAUDE.md finding 8's spirit applied to logic, not only markup); it matches finding
1 (untrusted `hass`, never throw) without a special case for `opening`/`closing`; and pressing Open
on a door that is already opening or closing calling `open_cover` again is a same-direction repeat
call to Home Assistant, not a wrong one — a cover mid-open told to open again does not reverse.
`state === "open"` is the only state that must flip to `close_cover`, so it is the only one checked.
The dialog's own text stays literally "Open `<name>`?" in every case, as the block says, even when
the door line does not carry `cover-open` because the cover has not finished opening yet.

## 2026-09-20 task/S2.4: the suite was red and undetected; two agents' exit codes were `tail`'s, not vitest's

`npm test` on `task/S2.4` exited 1: 559 tests passed, then two unhandled
`ReferenceError: clearInterval is not defined`, raised inside jsdom's
custom-element `disconnectedCallback` reaction when `afterEach` clears
`document.body.innerHTML` while a card's motion-fade timer is still live.
Two separate agents reported this suite green anyway, because both ran
`npm test | tail; echo $?` — `$?` after a pipeline is the last command's exit
code, `tail`'s, always 0, never vitest's.

Two real bugs, not one:

1. `src/card/floorplan-studio-card.ts` used the bare `setInterval`/
   `clearInterval` identifiers, which can fail to resolve depending on the
   realm jsdom runs a custom-element reaction in. Fixed by calling
   `globalThis.setInterval`/`globalThis.clearInterval` explicitly.
2. That alone turned the crash into `TypeError: globalThis.clearInterval is
   not a function`, still red. `tests/card/card.test.ts` spies on
   `globalThis.setInterval`/`clearInterval` inside `vi.useFakeTimers()`
   blocks and never restored the spies before `vi.useRealTimers()`.
   `@sinonjs/fake-timers`' `uninstall()` only restores the real timers when
   it finds its own fake function still in place; wrapped by a leaked spy,
   it silently `delete`s the global instead, leaving `clearInterval`
   undefined for the rest of the file. Fixed by calling
   `vi.restoreAllMocks()` before `vi.useRealTimers()` in both `afterEach`
   hooks.

A review also showed the suite gives no signal at all if `_stopTimer()` is
deleted from `disconnectedCallback` — a real leaked timer was invisible,
since no test removed a card from the DOM while its fade timer was running.
Added one (`tests/card/card.test.ts`, "Break it: stops the interval and
renders no more when the card is removed from the DOM mid-fade"), confirmed
to fail with the call removed, in a throwaway worktree.

What changed so this can't repeat the same way: CLAUDE.md finding 14 and
`docs/WORKFLOW.md` Verify step 7 now say to run every command bare and read
`$?` on its own line, never `cmd | tail; echo $?`, and to use
`${PIPESTATUS[0]}` or a log file when the output must be paged.

## 2026-09-20 S2.2 review: a light's colour and brightness are drawn by `renderFloor`, not painted onto the DOM by the card

S2.2's PLAN block names only the card, `actions.ts` and `actions.test.ts` as files. An Opus
review found the first implementation put `lightFill`/`lightOpacity` in the card as a
post-render DOM-manipulation pass (`_paintLights`, run after every `updated()`), reasoning that
the editor never passes `state` into `renderFloor` so putting the logic there would be dead code
for the editor. That reasoning does not hold: `renderFloor` already reads `o.state` and computes
per-device values from it for the motion fade (`src/core/render.ts`, the `--fp-fade` branch);
with no `state` the branch simply does not fire, which is the editor correctly drawing an unlit
plan, not dead code. This also breaks CLAUDE.md finding 8, "One draw path": everything visible on
the plan is drawn by `renderFloor` in core, so editor and card cannot differ, and S2.8's aura is
specified to read `rgb_color` through that same `style` mechanism — a fill computed in the card
and an aura computed in core could disagree, and only in the card.

Moved `lightFill`/`lightOpacity` into `src/core/render.ts`, in the same inline-`style` block the
motion-fade branch already uses on the device group, emitted as CSS custom properties
(`--fp-dev-fill`, `--fp-dev-opacity`) rather than literal `fill`/`opacity` attributes, consumed by
`.dev.on path{fill:var(--fp-dev-fill,var(--fp-on));opacity:var(--fp-dev-opacity,1)}` in
`FLOORPLAN_CSS`. `rgb_color` present sets `--fp-dev-fill`; absent leaves it unset so `--fp-on`
applies through the cascade. Brightness becomes `--fp-dev-opacity` as `brightness/255`, floored at
0.35. Deleted `_paintLights` and its invocation from `floorplan-studio-card.ts`; `lightFill`/
`lightOpacity` no longer exist in `actions.ts`, which now only wires tap/hold. This changes S2.2's
file list to include `src/core/render.ts` and `tests/core/render.test.ts`.

## 2026-09-20 S1.53 review: a real `removePoint` kind assertion, and two missing "Break it" tests

Three small findings from an Opus review of the S1.53 stack:

`removePoint`'s `owk`/`wk` test only asserted the surviving array's *length*, which would pass
even if the kinds came back shuffled or wrong. Strengthened it (`tests/core/geometry.test.ts`)
with an asymmetric `wk` (`["fence","wall","boundary","edge"]`, so a uniform array could not hide a
shuffle) and an exact `toEqual` on the survivors.

Added the two "Break it" Playwright tests PLAN called for and this review flagged as missing:
a theme switch mid-drag does not lose the drag (drives `st.setTheme()` + `requestUpdate()` via
`page.evaluate` while the mouse button is still down from a real `page.mouse.down()`, since a
real menu click would release the button before the drag could be interrupted; asserts the
dragged corner and its coincident neighbour both commit, not reset), and a measure grid on an
all-negative layout numbers its axes with negative metres (shifts the whole demo floor to negative
coordinates via `page.evaluate`, asserts at least one `.mg-n` label matches `/^-\d/`).

## 2026-09-20 S1.53 review: `addFloor` clones the source floor's `owk` along with its `outline`

An Opus review of the S1.53 stack found: `addFloor` (`src/editor/state.ts`) cloned the source
floor's `outline` for the new floor's perimeter, but not its `owk`, so a new floor dropped the
perimeter wall kinds it should have inherited. Cloned `owk` too, when the source has one. Test
updated to assert the new floor's `owk` matches the ground floor's.

## 2026-09-20 S1.53 review: `migrate` clamps furniture w/h into 5-2000 cm instead of leaving `validate` to reject the file

An Opus review of the S1.53 stack found: every other out-of-range value in `migrate.ts` is
normalised on open, but a piece of furniture outside the 5-2000 cm bound (an old file with, say, a
25 m patio table) had no repair path — it just failed later in `validate` with no way to open the
file at all. Added a clamp in `migrate` (`src/core/migrate.ts`) alongside the existing per-field
repairs, `Math.max(5, Math.min(2000, m[k]))` for `w` and `h`. `validate`'s own check is unchanged
and still refuses a *stored* out-of-range value — `migrate` is the repair path on open, not a
relaxed validator.

Tests: a file with `w: 2500` opens and comes back clamped to 2000 and validates; a value below 5
clamps to 5; an in-range value is untouched; `validate` on a layout with a stored 2500 (not run
through migrate) still fails.

## 2026-09-20 S1.53 review: a `[data-theme="light"]` block for a nested light plan under a dark host; dark tokens built from one shared constant; a browser test for the nested path

Three related findings from an Opus review of the S1.53 stack, all in `src/core/render.ts`
(`FLOORPLAN_CSS`), fixed together since they touch the same block:

CSS custom properties inherit down the DOM. A nested `<g data-theme="light">` (the
`RenderOpts.theme` path a plan can set independent of its host) had no matching selector, only
`[data-theme="dark"]`, so a plan marked light inside a host under OS or explicit dark silently
inherited the dark tokens from its ancestor. Added a `[data-theme="light"]` block beside the dark
one with the light values.

The dark token block was duplicated verbatim between the explicit `:host([data-theme="dark"])`
selector and the `@media (prefers-color-scheme:dark)` query — 47 tokens, byte-identical, two
places to update and forget. Pulled both the light and dark sets into `LIGHT_TOKENS`/`DARK_TOKENS`
template-literal constants, interpolated wherever the CSS needs them (now three places: the base
rule, `[data-theme="light"]`, and both dark selectors share `DARK_TOKENS`).

The nested `<g data-theme>` path had no computed-style test at all — the old test matched
`FLOORPLAN_CSS` as a string, which cannot see cascade or inheritance. Added
`tests/editor/theme-css.spec.ts`: a standalone Chromium page (`page.setContent`, `FLOORPLAN_CSS`
imported directly, no editor) with a nested light `<g>` and a nested dark `<g>` under an emulated
dark and an emulated light scheme, asserting `getComputedStyle` on each. Also strengthened the
existing token-parity test in `render.test.ts`, which compared token *names* only (a dark block
copied from light would have passed): it now compares values too, and asserts the structural
neutrals (ink, bg, room, wall, disc, outline, measure, wall-external) actually differ between
light and dark.

## 2026-09-20 S1.53 review: Delete on a perimeter edge clears the outline's collinear edge too, whichever poly was clicked

`deleteEdge` cleared `owk[i]` only when the selected poly was the outline itself. In the shipped
demo a room edge and the outline edge lie on the same segment, and the room's line paints after
the outline's, so a click on a perimeter wall selects the room's edge (`r0:0`), not the outline's
(`o:0`); Delete then left the outline's line drawn underneath, looking broken on exactly the walls
that matter. Generalized `deleteEdge` in `src/core/geometry.ts`: the cut/clear logic that already
handled two rooms sharing a segment (the F1 fix) now runs against `g.outline` unconditionally,
alongside every non-zone room, regardless of which poly was originally clicked. Undo restores
both kinds in one step, since this returns a single new floor.

Playwright test on the unmodified demo (no `rooms = []` first, which is what hid the bug): click
a perimeter wall, Delete, assert neither `r0:0` nor `o:0` draws a line, then Undo restores both.
All 61 pre-existing geometry.test.ts cases still pass unchanged after the refactor.

## 2026-09-20 S1.53 review: Draw > Outline rebuilds `owk` to the new point count

`applyShape`'s outline branch replaced `g.outline` without touching `g.owk`. Any redraw that
changed the point count left `owk` the old length; `validate` then refused the file and File >
Save died with "owk must have 5 entries" (found by an Opus review of the S1.53 stack, findings
numbered against that review). Fixed by rebuilding `owk` in `applyShape` (`src/editor/draw.ts`):
kept unchanged when the new outline has the same point count as before (the old kinds still line
up corner for corner), filled `external` otherwise, since a reshaped outline has no way to know
which old edge a new one corresponds to. Unit test on the redraw (5-point outline over the demo's
4-point one) and a Playwright test that draws with real clicks and Saves without an error dialog,
both confirmed failing before the fix.

## 2026-09-20 S1.53: `:host,.fp` not `:root` for theme selectors; two fixed on-accent tokens; `data-th` not `data-theme` on the chip

The block's CSS was written in `:root` terms; Shadow DOM does not match `:root`, so every
selector became `:host,.fp` (the base FLOORPLAN_CSS pattern already in use). Dark uses two
selectors at once: `:host([data-theme="dark"])` for a whole-editor override (attribute on the
custom element itself, cascades through the shadow tree to chrome and plan together) and the
plain `[data-theme="dark"]` (no `:host()`) for a nested override (a `<g data-theme="dark">` a
plan can carry on its own root, so one plan can be dark while its host is not, per the block).
Auto is the same pair under `@media (prefers-color-scheme:dark)`, guarded with
`:not([data-theme="light"]):not([data-theme="dark"])` so an explicit choice always wins.

`renderFloor` gained `RenderOpts.theme?: "light"|"dark"`; when set it wraps the whole plan in
`<g data-theme="...">`, omitted writes nothing (inherits, i.e. Auto). Nothing else in core reads it.

Found while pairing dark values to CSS: `.btn.primary`/`.btn.danger` used `color:var(--fp-bg)`
and `.btn.warn` used `color:var(--fp-ink)` as a light-mode-only trick (bg was cream, ink was dark
grey, so a light-fill accent button got dark text and vice versa). That trick breaks the moment
those tokens flip for dark mode. Added two theme-invariant tokens, `--fp-on-dark:#fff` and
`--fp-on-light:#2b2a27`, same value in both the light and dark CSS blocks, and repointed those
three button classes at them. Hand-checked WCAG contrast (relative luminance) for the three
accent hexes against these fixed tokens: primary `#1f6699` vs white ≈6.15:1, danger `#b02a2a` vs
white ≈6.53:1, warn `#f28c28` vs `#2b2a27` ≈5.84:1 — all already clear 4.5:1, so no accent or
device colour needed a dark-mode variant; only the structural neutrals (bg, room, wall, ink,
disc, outline, measure, wall-external/-fence, halo, tread) got real dark values.

The View-menu chip buttons that choose the theme use `data-th="auto|light|dark"`, not
`data-theme`, on purpose: `data-theme` is also the CSS trigger attribute, so a `data-theme="dark"`
chip button would match `[data-theme="dark"]` and paint itself with dark-theme tokens.

Consequence: the `.btn.danger` colour change (from cream `--fp-bg` to white `--fp-on-dark`) broke
3 pre-existing S1.28 Playwright assertions that hard-coded the old cream RGB as `LIGHT`. Updated
the `LIGHT` test constant in `tests/editor/editor.spec.ts` to `rgb(255, 255, 255)`, with a comment
explaining why; no behaviour outside the intended theme work changed.

Added a `readTheme`/`setTheme` pair in `state.ts` mirroring the existing grid/measure
localStorage pattern exactly (try/catch, safe default on any failure) rather than inventing a new
shape, and a unit test for the blocked-storage case (S1.53's own "break it" requirement) alongside
the existing grid/measure ones in `state.test.ts`.

## 2026-09-20 S1.52: the outline gets its own `owk`, touched wherever `Room.wk` already was

Treated the perimeter as "just another poly with a wk-like array": a new `ensureOwk(g)` helper
(`if (!g.owk) g.owk = g.outline.map(() => "external"); return g.owk;`) is called at every point
`Room.wk` was already read or written — `stitch`, `insertPoint`, `removePoint`, `setEdgeKind`,
`deleteEdge`, `mergeCorners` — gated by `poly === "o"` / `P.id === "o"` / `P.outline`, alongside
the existing room-cascade logic, never replacing it. `renderFloor`'s outline poly now carries
`wk: f.owk`, and its kind fallback is `external` (not the room default `wall`) when `owk` is
absent, so a hand-built floor with no `owk` still renders correctly before `migrate` runs.

No `editor-app.ts` change was needed despite the task block listing it as a file to touch: every
edge line, including the outline's, already carried `data-e="o:i"`, and `hitOf()`'s
`el.closest("[data-e]")` was already generic across every poly. The only real gap was `edgePanel`
in `panels.ts`, which hid the kind select and Delete whenever `edgeRooms(...).length === 0` — true
for every outline edge in the demo, since each is shared by multiple partial room walls, never one
room edge spanning it whole. Fixed with `editable = rooms.length > 0 || isOutline`.

Demo curation (`demo/layout.json`, `demo/layout.v1.json`): `owk` is `external` on all four
perimeter edges of both floors, and every room edge that geometrically coincides with an outline
segment (checked by collinearity and range against each rectangular room) is also set `external`;
interior room edges stay `wall`, and zone/garden/pavement/water rooms keep `boundary` untouched —
this marking is a manual authoring choice for the starter template, not something `migrate` or
`renderFloor` derives on their own. `demo/layout.v1.json` needed the same `wk` values written by
hand, because its boolean `w` arrays only ever migrate to `wall`/`boundary`, never `external`; the
alternative (a v1 fixture that no longer round-trips to the same v2 demo) would have weakened a
real invariant, so the test kept its strength and the fixture gained the missing kind.

Pre-existing tests updated in this commit, as flagged by the task: `schema.test.ts`'s demo `wk`
assertion for `room-ground-1` (now `["external","wall","wall","external"]`, was uniform `"wall"`),
`migrate.test.ts`'s v1-vs-demo round-trip (needed the `layout.v1.json` fix above), and
`render.test.ts`'s snapshot (perimeter lines now render with the `external` class). One further
existing test needed a deliberate behaviour-change update, not just a data fix: "an outline edge of
a floor with no rooms has no kind select" asserted `#ek` absent by design before this task; it is
now present and external by default, so the test was renamed and its assertion flipped rather than
kept as a regression.

Deviation in the Playwright test: the block's Test section describes the stroke-width changing
"from 8 to the internal width" on External to Internal. The actual selectable `[data-e]` line runs
6 px (`.e.external`) to 3 px (`.e`); "8" is `.eh.external`, the non-selectable white halo twin with
no `data-e` attribute. The test asserts the real, selectable element's width (6 to 3) and notes the
discrepancy inline rather than chasing the illustrative number.

## 2026-09-20 S1.51: scaleFurniture works in the piece's own local frame, and three small gaps closed along the way

`scaleFurniture(m, corner, to, opts)` holds the opposite corner fixed and recomputes `w`, `h`, `x`, `y`
from the two corners, all worked out in the piece's own (unrotated) frame relative to its OLD centre —
the dragged corner is un-rotated into that frame, the new centre is the midpoint of the two corners in
that same frame, then rotated back to world space. A first draft computed the new (post-clamp) corner as
an independent half-extent from an unknown new centre, which double-counted the centre shift; caught by
hand with concrete numbers (a `se` drag from `(500,500,w=200,h=100)` to `(650,600)` should centre at
`(525,525)`, the buggy formula gave `(512.5,512.5)`) before any test ran, then fixed by deriving the new
corner from `oppLocal + sx*w`/`sy*h` instead.

Three small deviations from the S1.51 block, all in scope of "Bounds... in the drag and in the panel":
- The panel's `#fw`/`#fh` fields had no upper clamp before this task (only a 5 cm floor). Closed it
  alongside the new 2000 cm ceiling, since the block requires both bounds "in the drag and in the panel".
- `validate`'s "refuses a stored w or h... of NaN" is met by the pre-existing "must be a number" check,
  not the new S1.51 "must be between 5 and 2000" message — NaN fails the type check first, so the new
  bounds message never fires for it. The unit test asserts the message it actually gets.
- `render.ts` needed no change: the block lists it as "CSS only" and the corner handles reuse the
  existing `.h` circle class the other drag handles already use, so no new rule was required.

## 2026-09-20 fix/heater-bar-under-icon: the heater bar has no per-end drag, only a whole-device drag

The bug report asked to verify "dragging a bar end still works" after the reorder. It does not exist as
a feature: `LooseRef` (the per-end drag handles drawn by `looseEnds()`) only covers `walls`, `openings`
and `extras`, never `devices`; a heater's `a`/`b` line is dragged as one piece, via the `"dev"` hit case,
which moves the whole bar (magnetised to the nearest wall within 80 cm, else keeping its length and
heading). So the regression test drags a point on the bar body instead, chosen far enough from every
wall and room edge (over 80 cm) that the wall-magnet does not fire, and checks both ends move by the
same offset. No code changed for this; it is a test-scope note, not a behaviour change.

## 2026-09-20 fix/heater-bar-under-icon: the bar now draws before the icon group

`renderFloor()` pushed the icon group (`<g data-x>`) before the heater bar (`<line data-xbar>`), so the
8/12 px bar painted over the icon's white disc and halo. Swapped the two pushes: the bar now draws
first, the icon group last, so it always sits on top. `data-xbar`, its width (8 idle / 12 selected) and
every other attribute are unchanged. Clicking the bar's middle now resolves to the icon group and
selects the same device — correct per finding 3 (`closest("g[data-x]")` is the real top element). A
pre-existing Vitest snapshot of the demo ground floor changed order and was regenerated (`vitest -u`);
no other snapshot changed.

## 2026-09-20 S1.50: the measure grid method is named `measureGrid`; only the x-axis origin reads "0 m"

Two deviations from the S1.50 block. First, `editor-app.ts` already has a private `measure()` (the `ResizeObserver` callback that reads the SVG's screen rect); the block's own `measure(k: number): string` would have been a duplicate implementation, which `tsc` refuses. The new method is `measureGrid(k)`. Second, the block says "the origin label reads `0 m` so the unit is stated once", but the grid numbers both axes independently, so a layout whose box crosses (0,0) — the demo does — gets one "0" label on the top edge and one on the left edge; giving both the " m" suffix states the unit twice, and a Playwright test matching the text "0 m" then finds two elements. Only the x-axis's zero (the one the block's own test line names) carries " m"; the y-axis's zero, like every other number, is bare. `FLOORPLAN_CSS` gains `.mg`/`.mg.m` and `--fp-measure:#3a3a3a`, paired with a `getComputedStyle` test in `editor.spec.ts` per finding 10; `stroke-opacity` is set inline per line (0.12 / 0.22), not in CSS, since it depends on the line's own value, not its class alone.

## 2026-09-20 Sprint 1.6 closed and merged; the lessons become rules

S1.14 to S1.49 merged into `main` and pushed, 60 commits. Measured on `main`
after the merge: lint clean, 457 unit tests, 284 Playwright tests, build green.
The sprint ran with Sonnet executing and verifying and Opus deciding, and the
split paid: the suites were green at every hand-off and verify and review
still found seven real defects (the lost hatch, a flaky rotation test whose
cause was a product race, a partly shared edge surviving Delete, a wall chain
closing on an intermediate corner, a silent cap on long rings, a motion sensor
that never faded, and a drawn ring that produced a layout `validate` refuses).

Four of the seven were invisible to the tests as written, so the lessons are
written down rather than remembered: CSS is read with `getComputedStyle` and
never as text (`CLAUDE.md` 10), the Playwright server is ours and never a
stranger's (11), code that builds schema objects is tested over every input
combination because `edit()` does not validate (12), a flaky test is a product
bug (13), and every command's exit code is read (14). `docs/WORKFLOW.md` gains
the same points in the Verify role, plus a closing step for a sprint.

Left open on purpose: the demo "Garden" and "Garden pond" names overlap (it
predates the sprint), furniture width has no upper bound, and the turn
direction is stated both in the button name and in its pressed state.

## 2026-09-20 Opus review: browser pairs for the CSS string tests; motion fade was overridden

`tests/core/render.test.ts` checks many CSS rules only as text. Each now has a computed-style test in `editor.spec.ts` ("Opus review CSS pair"). Already paired: zone and water fill, room colour override, halo and cone, text outline, twin colour. Missing and added: wall kind colour, width and dash; garden, terrace, pavement and fill (hatch) fills; the `.e.none` guide; tread colour; the `--fp-dev-*` palette against `DEVICE_COLOURS`; camera and garden-sensor fill; motion fade. The motion pair found a real bug: a motion sensor that is on carries `.dev.on`, whose specificity beat `.dev-motion path`, so the fade never showed and the icon stayed the "on" yellow. The rule is now `.dev.dev-motion path` (same specificity, later in the sheet). The string test was blind to this.

## 2026-09-20 Opus review: colors.ac is stored, its state colours come in Sprint 2

`layout.colors.ac` passes `validate` and is written as `--fp-dev-ac`, but the air conditioner draws with `--fp-dev-ac-cool` and `--fp-dev-ac-heat`, which the knob does not set. Chosen: document it in SPEC, no behaviour change. Sprint 2, which adds the state colours, decides what `ac` drives.

## 2026-09-20 Opus review: turn buttons are a labelled group; no orphan label

`rotateButtons` is `role="group"` with `aria-label="Turn by degrees"`, and each button's name carries the direction ("Turn 30 degrees clockwise", or counter-clockwise), because the visible "30" says neither. The stairs panel's `<label>steps</label>` pointed at a span, not a control; it is a plain span now.

## 2026-09-20 Opus review: validate checks room area and device entity; migrate rejects odd versions

`validate` now requires `room.area` to be text and `device.entity` to be an entity id like the other entity fields. Deviation from the brief: an empty `area` stays valid, because the schema says empty means a custom shape and the editor makes such rooms (drawn rings, water); rejecting it would break Open and restore of the editor's own output. `migrate` reads `version` only as a number or a string of digits (as before, `"2"` passes); `true`, `null`, arrays, `""`, `"two"`, `1.5` and the like throw "Layout version must be a number". A missing version is still v1.

## 2026-09-20 Opus review: a drawn ring's kind follows its wall kinds

`closedLoop` may take older walls of another kind into the ring. The room kind came from the last drawn wall while `wk` came from each wall, so a dotted chain closing over an old wall made a zone with a `wall` edge, which `validate` rejects, and `EditorState.edit` committed it. Now `roomKindFor(kinds)` in `draw.ts` derives the kind from the ring: all boundary is a zone, all fence or edge a garden, anything else a room. `wk` stays the truth. A room and a garden accept every wall kind in `wk`; only a zone is limited to boundary, so no edge needs mapping. No validate-and-rollback in `edit()`. Supersedes "Room kind follows the last wall" in "Closed walls become a room".

## 2026-09-20 Opus review: Playwright never meets a stranger's server

`webServer` now binds 127.0.0.1 (`--host` in `npm run dev` and in the config), `baseURL` is `http://127.0.0.1:<port>`, and `reuseExistingServer` is always false. Before, another vite on 5173 (a different project) answered on 127.0.0.1 while ours listened on localhost, and the suite ran against the wrong code. The default port is now 5273, not 5173: with `--strictPort` and 127.0.0.1, a foreign server on 5173 would make ours fail to start. `PW_PORT` still overrides. Deviation from the brief, which kept 5173.

## 2026-09-20 S1.46 and S1.48 docs: equal text outline, and what undo does

The edge length label had a stroke width of 3 x zoom while every other text has 3, so at the default zoom it read 3.51. It is now 3 in the `.len` rule, the same as `.lbl`. This supersedes "its stroke width keeps scaling with the zoom" in S1.46. The PLAN S1.48 test line said one undo brings the four walls back; the walls never exist as separate steps, since a draw commits once, so one undo removes the room and no wall returns (the DECISIONS entry "Closed walls become a room" already said so).

## 2026-09-20 S1.42 fix: name collision is tested in the screen frame

In a turned plan the names are counter-turned to stay upright, but the device test ran in plan coordinates, so at 45 degrees the Living name touched a halo. Now the vector from the name's anchor to each device is turned by the plan angle before the box test, and "down one line" (and "up") is screen-down, moved in plan units as (d sin a, d cos a). The x of the name can change with it. The second line of a room (its label) follows the same screen-down offset. At rotation 0 the numbers are unchanged. The Playwright test runs the demo at 0, 45, 90 and 135. Supersedes the plan-frame test in S1.42.

## 2026-09-20 S1.41 test: the clamped-width test kept, and made stricter

The verifier said the S1.41 test "a clamped furniture width shows the clamped value" passes without the fix. Checked: with `live()` removed, with `c.refresh()` removed, and with both removed it fails on the second `#fw` entry (the state is already 5, so only `refresh` plus `live` reset the field). It stays, not deleted. It now also covers an accepted 137, an empty entry that is refused and goes back to 137, and the depth field clamped from 2 to 5, so it fails on each of those paths too. The stairs test in the same block still passes without the fix (its value changes the state, so lit redraws anyway); it is left as the "accepted value stays" case.

## 2026-09-20 S1.48 fix: the ring cap is 12, and a bigger ring says so

A ring of 13 or more walls stayed walls and the status said "Added the shape", which hid why nothing became a room. The cap stays at 12 (`MAX_RING` in `ops.ts`); a chain that closes on its first corner with more walls than that now reports "N walls, too many to make a room (max 12)". The walls stay. Supersedes the silent cap in "Closed walls become a room".

## 2026-09-20 S1.47 fix: Delete removes every overlapping edge

Delete on a room edge used to match only edges with the same two ends. The demo Hall edge (0,400)-(800,400) is shared in halves by Living and Kitchen, so the halves stayed drawn. `deleteEdge` in `geometry.ts` now sets "none" on every room edge that lies on the selected segment (within 2 cm of its line, overlapping it by more than 2 cm). An edge that reaches past the segment is cut at the segment's ends first, kinds copied, as `stitch` does; the whole change is one commit, so one undo restores it exactly. Zones are skipped. `setEdgeKind` and the kind select are unchanged and still act on exact matches only. Supersedes "Delete sets none on all rooms that share the edge" in S1.47.

## 2026-09-20 S1.48 fix: a chain converts only when it closes on its first corner

Closing on an intermediate corner also converted: the chain (105,630),(295,630),(295,670),(200,670),(295,630) made a 3-point room and left a stray wall, and a figure-eight converted one lobe. `closedLoop(f, w, tol, through)` now takes an optional point the ring must pass, and `applyShape` gives it the chain's first point. A ring that misses it stays walls. Supersedes "finds the shortest ring through the last wall" in the entry below for the case of a ring that does not include the chain's start.

## 2026-09-20 Closed walls become a room

A wall chain closes when a click lands within snap distance of its first corner, with three or more corners. The last click is replaced by an exact copy of the first point. `closedLoop(f, w, tol=2)` in `ops.ts` finds the shortest ring of 3 to 12 walls through the last wall, and returns wall indices and corners, not only points, so the walls can be removed. Room kind follows the last wall: dotted a zone, fence or edge a garden, else a room. The room keeps the wall kinds as `wk`, has an empty area, and the name field takes focus. Conversion happens in the draw flow only. Walls dragged or added one by one stay walls. Because a draw commits at its end, one undo removes the room and no walls come back. This supersedes the S1.11 rule that walls do not close.

## 2026-09-20 S1.47: a room edge can be not drawn

New EdgeKind = WallKind | none, valid on room wk only; walls and zones still reject it. Deviation from the plan: the editor draws a faint dotted guide (.e.none) with data-e, so a deleted edge can be picked again; the card draws nothing. Delete sets none on all rooms that share the edge; a door or window on it asks first (onEdge).

## 2026-09-20 S1.46: one text style

All SVG text is --fp-text (#3a3a3a) with a white --fp-outline stroke, painted under the fill. It replaces the cream --fp-bg outline and the black-ish --fp-ink fill. The zone name stays muted by opacity only. The edge length label in the editor follows the same style; its stroke width keeps scaling with the zoom.

## 2026-09-20 S1.45: the icon disc is white, 75 percent

The disc is r=16 (icon 12, plus 3 and the border), white at 75 %, 1 px grey non-scaling border. The camera cone keeps --fp-alpha .25. New variables --fp-disc and --fp-disc-alpha. The S1.42 collision uses 16k and steps 32k; this supersedes the 28k of that entry. The SPEC line about an active circle taking the type colour was dropped: the code never did it.

## 2026-09-20 S1.44: stair steps are derived

steps = round(run / 40), 2 to 40; round stairs use the mean circumference. Kept in the file so old readers load it, but migrate, every edit and the renderer recompute it. The panel shows it read only (#sstn). The demo stairs went from 12 to 4 steps (160 cm).

## 2026-09-20 S1.43: rotation is buttons

One helper draws 30, 45, 60, 90, a direction toggle and Reset for rooms, stairs, furniture and devices (cameras are devices). Ids are per panel: srot30, frotreset, vrotdir. Deviation from the plan: the toggle id is per panel, not one #rdir. Rooms have no Reset. Walls, doors and openings keep their absolute angle field. Reset at 0 adds no undo step.

## 2026-09-20 S1.42: names step 28k, not 24k, clear of a device

The plan's box was centred on the SVG y, which is the baseline. The real text box sits above it, and the demo Living name still touched a halo by 3 px in Chromium. The box is now 1.2 x size, centred 0.35 x size above the baseline, and the step is 28k. Supersedes the 24k in the S1.42 plan block.

## 2026-09-20 S1.41: number fields re-render after every change

number() takes the panel context, binds with live() and calls refresh after each change. A refused or clamped value snaps back to the state.

## 2026-09-20 S1.40: buttons get their own colours

Warn, danger and primary buttons stop borrowing the plan's colours. New variables --fp-warn, --fp-danger, --fp-primary. Warn takes dark text. All three reach 4.5:1, measured in Chromium. Supersedes the colours chosen in S1.28.

## 2026-09-20 S1.39: names refresh on load, not an undo step

Names of linked floors, rooms and furniture refresh whenever Home Assistant data arrives, after undo, Open and Reset. It is never a snapshot. Unlinked rooms are never renamed. The match button links a room whose name equals exactly one HA area. Code shipped with S1.38; this commit adds its tests.

## 2026-09-20 S1.38: HA things are picked, not typed

Floors, room areas, room entities and furniture entities are dropdowns when Home Assistant data is present. Picking an area writes id and name together; the entity link is dropped. Free text stays only for custom things and for standalone use. Unknown ids stay as an extra option, so a stale link is visible and never erased. The S1.39 name refresh landed in this commit too, since it shares the ha setter.

## 2026-09-20 S1.37: HA links are optional fields; applyHaNames returns a copy

`Floor.ha`, `Room.entity`, `Furniture.name` and `Furniture.entity` are validated for shape only (`ha` non-empty text, `entity` an id with a dot, the name text); `migrate` already clones, so it passes them through and adds none. `src/core/ha.ts` holds `HaData` and `applyHaNames`. The function always returns a fresh clone, even when nothing changed, and counts only names that differ. It ignores an HA entry whose name is not non-empty text, so hostile host data cannot blank a title. A floor with no `ha` and a room with an empty or unknown `area` are never touched.

## 2026-09-20 S1.35 docs corrected; walls and edges get a white twin

Supersedes the bullet "dark floors switch label and outline to light" in "More Sprint 1.6 tasks" and the `dark` class text of the PLAN S1.35 block; DECISIONS "S1.35: swatches only" is what was built, and the PLAN block now says so. New (S1.35b): on a dark floor (Lava, Belgian stone) a dark wall or edge nearly vanished. Every room edge and free wall now has a white twin line under it (`line.eh`, colour `--fp-outline`, 2 units wider, same dashes), all twins first so one never covers a neighbour's edge. It is the line version of the text outline, and S1.46 uses the same `--fp-outline`. A CSS `filter: drop-shadow` was rejected: on a horizontal SVG line the filter box has no height in some engines and the line disappears. The twin has no `data-e` and `pointer-events:none`, so hit testing is unchanged. Stairs edges get none. The demo snapshot changed by the twins only.

## 2026-09-20 S1.49: Re-center fits everything, Fit to window keeps the outline

After a zoom and a pan there was no way back to the whole floor when parts of it (a pond, a sensor in the garden, stairs beside the house) lie outside the outline: "Fit to window" fits the outline only, so it left them off screen. Re-center is a second button in View, not a change to Fit, because Fit is what the editor shows on first load and the tests depend on that box. `contentPoints(floor)` in `render.ts` lists every point; `EditorState.recenter()` fits them with an 80 cm margin in the turned frame, like `fit()`. It is a view change: no layout write, no undo step. The block asked for View menu and/or toolbar next to zoom; the editor has no zoom buttons, so it is the View menu only.

## 2026-09-20 One alpha, 25 %, for the halo and the camera cone

Supersedes 33 % for the cone (S1.31) and 50 % for the halo (S1.29), and fixes the alpha of the S2.8 aura and the S2.9 halo tint to the same value. Diego: both were too heavy over the plan. One variable, `--fp-alpha: .25` in `FLOORPLAN_CSS`, is read by `.dev .halo` and `.cone`, so the two cannot drift; S2.8's `.aura` is written to read it too. PLAN (S1.29, S1.31, S2.8, S2.9), SPEC and the tests follow. The Chromium test reads the computed fill-opacity of the cone and of every halo.

## 2026-09-20 Camera cone is 100 cm deep

Supersedes S1.31's 300 cm. Diego: 3 m runs through the whole flat and hides the plan; 1 m is the reach worth showing. `renderFloor` uses `R = 100 / k`; the panel hint says "1 m deep"; the S1.31 PLAN text, the render and Chromium tests and the snapshot follow. The Chromium test now measures the cone's box against 100 cm on screen.

## 2026-09-20 S1.36: device colours ride on a group, and only camera and garden sensors show them yet

`layout.colors` is validated (device-type keys, `#rrggbb`), passed through by `migrate` and never invented. `renderFloor` takes it as `opts.colors` (it never saw the layout) and wraps its output in `<g class="dev-colours" style="--fp-dev-<type>:...">` when there is at least one valid entry; no colours, no wrapper, the snapshot is unchanged. Custom properties inherit, so this reaches every device. This is a group, not "the root svg" as the block said: the svg belongs to the host, and one place serves editor and card. Only known types and strict colours reach the attribute. `DEVICE_COLOURS` (render.ts) holds the default per type for the colour inputs; types with no colour of their own default to the idle grey, and `ac` shows the cool colour, since the palette has `ac-cool` and `ac-heat` and the key is `ac`. Deviation from the block's test: it wants every light icon's computed fill to change, but a light's fill still comes from `--fp-idle` and `--fp-on` until S2.9 wires `--fp-dev-<type>` into the on-colour. The Playwright test therefore reads the computed `--fp-dev-light` on every light icon, and the computed fill on the camera, which does use its variable. Whoever does S2.9 should add the light fill check.

## 2026-09-20 S1.35: swatches only; no `dark` class

`FLOOR_COLOURS` (twelve, in the PLAN order) lives in `schema.ts`; the room panel shows them as `.sw` buttons (title and aria-label are the name, the pressed one is marked) next to the free colour input, which stays. This supersedes the part of the block that gave a dark floor's label and edge lines a `dark` class and light `--fp-label-on-dark` and `--fp-wall-on-dark` colours: it is not built. Reason: S1.46 gives all text a white outline, which keeps a label readable on any floor. The swatch backgrounds are the data colours of the floors, like the room fill itself, so they are inline style, not `--fp-*` variables.

## 2026-09-20 S1.34: the grid is a viewer setting, default 10 cm

`EditorState.snapGrid` is 0, 5, 10 or 50 (default 10), read from `localStorage` key `floorplan-studio:grid` with try/catch; anything else stored falls back to 10. It is not in the layout: two people opening the same file may want different grids. `gridRound(n, grid)` in `ops.ts` is the one rounding; the editor's snap, drags and the `stairsAt`, `squareAt` and `spawnPoint` helpers take the grid as a parameter (default 10). Alt gives grid 0 for one gesture. The View menu group "Grid" replaces the "Snap 5 cm" chip and stays open, so a choice can be compared. Tests that assumed 5 now choose 5 in View, Grid (the default changed, not their subject); two unit tests (`spawnPoint`, `stairsAt`) now expect the 10 cm result and also check 5.

## 2026-09-20 S1.33: the view is kept in plan coordinates; only the icon is counter-turned

`layout.rotate` (0 to 315, steps of 45) turns the drawing in one group about the centre of the box round every floor's outline. The editor view stays in plan coordinates: `x,y,w,h` is the box the screen shows once un-turned about the pivot, so rotating needs no view conversion; `toSvg`, pan, wheel zoom, `ensureVisible` and `fit` turn points into screen space first. Rotating drops the stored per-floor views so each floor refits. The overlay (handles, highlights, rubber band, `len` texts) sits in the same turned group; texts and icons are counter-turned so they stay upright. Deviation from the block: a device group is not counter-turned as a whole, only its icon, because the camera cone must turn with the plan. The wrappers carry `class="plan-turn"` so tests find the turned group and not a stairs group (also a `rotate()` child of the svg). The View menu stepper buttons carry `.keep`, so the menu stays open for repeated steps. `demo/layout.json` gets `"rotate": 0` (migrate writes it, so the idempotence tests need it). Tests use real mouse events at 45 and 90 degrees.

## 2026-09-20 S1.32: `bound` is a link, not a claim

A light's `bound` no longer reserves its switch. `validate` lost both uniqueness rules (one switch for many lights; a switch that is also a device); `placedEntities` counts only `entity`, so a bound switch stays in the Device menu until someone places it. `bindChoices` offers every switch and plug except the light's own entity, and the light's current one, even if it is not in the catalog, is still added by the panel. Nothing else changed: `renderFloor` already read each entity's own state. A light bound to its own entity is still refused. Older tests assumed the old rule (the relay leaving the menu with its light, the picker hiding taken switches, the Device search counts); they now say the new one.

## 2026-09-20 S1.31: the cone rule is `.dev.dev-camera path.cone`

The cone is a `path` inside the device group, so `.dev path`, `.dev.on path` and `.dev-camera path` all match it and out-rank a plain `.cone` rule (it rendered idle grey until the rule was written with three classes; the Chromium test reads the computed fill, opacity and pointer-events). Its radius is `300 / k` in the group's scaled frame, so it stays 300 cm at any zoom. The device panel's rotation field already existed (S1.23); S1.31 only adds the camera hint.

## 2026-09-20 Names come from Home Assistant; custom shapes keep a plan name (S1.37 to S1.42)

Diego: "we are mapping not inventing... no custom names for things that are connected to HA. HA is authoritative. custom things can be deployed and named and also have a dropdown to attach them to an HA entity."

- A floor links to an HA floor with the new `floor.ha` (the HA floor id). A room or a zone links to an HA area with the `area` id it already has; no second field, because one already points at the right registry. Both keep their name (`floor.title`, `room.name`) as a stored copy of what HA said. It is a cache, not a second source of truth: the editor refreshes it whenever it has HA data.
- The name is stored, not resolved while drawing. `renderFloor` is untouched and takes no HA data, so the card before `hass` arrives, the standalone editor and the render snapshots all keep working. The alternative, looking the name up in the renderer, would push `hass` into core for nothing.
- The refresh is one pure function, `applyHaNames(layout, ha)` in the new `src/core/ha.ts`, returning a copy and a count. The editor runs it when `ha` is set and says "<n> names updated from Home Assistant" in the status line. It is not an undo step: it is loading, not editing. It touches a linked floor or room only; an unlinked one is never renamed, and when its name matches one HA area the panel offers a one-click link instead.
- A custom shape — no `area` — keeps its plan name and gains `room.entity`, one HA entity whose state the card can show on it. `furniture` gains `name` and `entity` for the same reason. Choosing an area clears `entity`, so a shape is either HA's or the plan's, never half of each.
- Every room kind gets the area picker, not only `room` and `zone`: a garden or a terrace is often a real HA area, and one rule is simpler than a list of exceptions. Custom is the absence of an area, not a kind.
- Schema stays version 2. All four fields are optional, `validate` only checks their shape and looks nothing up, `migrate` invents none. An old file opens unchanged.
- An area already used by another room stays selectable, under an "Already on the plan" group, with a warning in the status line. Two shapes for one area is unusual, not wrong, and blocking it would cost more than it saves.
- The editor takes the HA data as one property, `ha: HaData`, injected by the host (S3.3 fills it from `hass`; standalone leaves it undefined and shows free text). Tests set the same property. So core, editor and panel share one small shape and no editor code talks to `hass`.
- S4.2 keeps "Create area in HA" as an explicit choice for a custom room, and nothing more: no area is ever created by picking a name, on load or on save.
- Three defects the verifiers found become their own tasks. S1.40: `.btn.warn` measured 2.16:1, `.btn.danger` 3.85:1 and `.btn.primary` 3.82:1, so the buttons stop borrowing the plan's door, motion and window colours and take `--fp-warn` (#f28c28, dark text, 5.9:1), `--fp-danger` (#b02a2a, light text, 6.6:1) and `--fp-primary` (#1f6699, light text, 5.4:1). S1.41: a refused number stayed on screen because the field was bound by property and the state never changed; `number()` now binds with `live()` and refreshes after every change. S1.42: a device halo hid "Living" and "Kitchen", and devices must stay on top (S1.29), so the name moves instead — down one line, else up one line, else stay: three candidates, no search, and the render test can name the expected y.

## 2026-09-20 S1.30: palette variables; outdoor means temp or humidity in a garden room

The `--fp-dev-*` variables are in `FLOORPLAN_CSS`; S1.30 uses only `--fp-dev-camera` and `--fp-dev-garden`, the rest wait for S2.9 and S2.10. `outdoor` is set for `temp` and `humidity` only, not for every sensor: motion and contact have a state colour of their own, and `.dev.outdoor path` would out-rank it and turn them green for good. Any garden room counts, whatever its place in the array, and a zone on top does not matter. SPEC's behaviours table now says blue when on for plug and computer (Diego's amendment) and names the two types. `TYPE_LABELS` stays in `src/editor/panels.ts`, where it already lived.

## 2026-09-20 S1.29: devices paint after room names; the halo is a class

Room names moved ahead of the device loop in `renderFloor`, so a device is the last thing drawn (only the editor's corner handles follow). The halo circle carries `class="halo"` and takes fill and opacity from CSS (`--fp-halo`), so Sprint 2 can recolour it with one rule. Room names are click-through in the editor, so `elementFromPoint` cannot prove the order alone; the e2e test also compares DOM order, and fails without the change. A device's own name label (shown with "names") still follows its device, as before.

## 2026-09-20 S1.28: red for what destroys the floor or the layout, orange for one item

`.btn.danger` (`--fp-motion`) is on Reset, Delete floor and its confirmation; `.btn.warn` (`--fp-open`) on every Delete of a selected item, including "Delete corner" and "Remove from plan". Both also set the border to the same colour, as `.btn.primary` does. The furniture delete is `#fudel`; `#fdel` is the floor panel's alone. The tests read the computed background and text colour in Chromium, not the class name.

## 2026-09-20 S1.27: a new floor copies the first floor's outline and stairs; the floor panel says so

`addFloor` copies `outline` and `stairs` from the first floor in the key order, deep, with stairs ids from `newId` against the new floor; a first floor without them gives none. The floor panel gains one hint that says this and points to Delete floor for a clean start. Three older Playwright tests assumed an empty new floor (no host edge, no outline, view centre): they now make one bare with `addBareFloor`, which clears the outline in the editor's state, because the public `layout` setter refuses a floor with fewer than three outline points. That refusal is old and unchanged: a layout with a bare floor cannot be loaded or saved until it has an outline; that is a gap in Sprint 1, not made by this task.

## 2026-09-20 S1.26: Add, Stairs is one undo step across all floors; the view follows the current floor only

`EditorState.addStairsEverywhere` snapshots the whole layout once and pushes a deep copy into every floor, even one that already has stairs. The stairs sit beside the house, outside the outline each floor's view is fitted to, so on another floor they may be off screen until the user zooms out; `ensureVisible` still works on the current floor only. Delete is per floor, as the block says.

## 2026-09-20 S1.25: a stairs object is one group; only a plain flight keeps its edge lines

`renderFloor` draws each stairs as `<g data-s="i" transform="rotate(rot cx cy)">` holding the polygon (round: one even-odd path with the well cut out), the treads and the edge lines, painted where the polygon was (under the walls). The stored `pts` are the unturned shape, so only a straight flight with `rot` 0 gets `data-e` on its edge lines; for a turned or round one the lines are drawn but not pickable, and a click on any part of the group selects the stairs (tested with a real click at a point inside the turned flight and outside the stored one). The block said renderFloor skips corner handles; it never drew any, so the rule lives in the editor overlay alone. Round stairs: `steps - 1` spokes at `360 / steps` degrees from the east, from the inner to the outer rim. Straight: treads across the short side of the box. The shape select goes straight to round with `dia` 200 (well 60), and back to a 100 x 300 flight, about the centre the stairs had; name, steps and rotation are kept. Known gap, not widened: snapping still sees the unturned corners of a turned stairs.

## 2026-09-20 S1.20: a new item comes into view whole

`ensureVisible` takes the points of the whole new shape (wall ends, structure, zone and stairs corners, the furniture box), not the spawn point alone. It pans by the least amount that puts them 100 cm inside the visible area, and zooms out, about the view centre, only if they do not fit. Where the item is placed does not change. Found by the verifier: stairs at `[[900,-150]..[1000,150]]` lost their top at the default view, and a structure had two corners out after zooming in. Water and rooms are not in the Add menu (S1.21), so they are not covered; a zone changed to water is the same polygon. Device placement is unchanged (it centres the view on the device).

## 2026-09-20 The focus-out clear only clears the selection that lost focus

`onFocusOut` queues its clear one task later and now remembers `st.sel` at that moment; if the selection is another object when the task runs, it does nothing. Before, a click that blurred the editor (in the S1.23 device test, at 900 cm, below the 800 px viewport) left a queued clear that could run after the next click had selected a device: the panel read "Nothing selected" and `#vrot` was detached (7 of 10 runs). The test now clicks empty ground inside the view; a new test covers the gap with a synthetic pointer, the only way to hit one task.

## 2026-09-20 More Sprint 1.6 tasks: grid, floor colours, device colours

- S1.34 grid setting (none, 5, 10, 50; default 10), kept in the browser, not the layout: it is an editing habit, not part of the house.
- S1.35 twelve floor-material swatches (ceramic, marble, sand, terracotta, oaks, walnut, greys, Belgian stone, lava) replace the pastel set proposed earlier; dark floors switch label and outline to light.
- S1.36 device colours per type, stored in `layout.colors`, so the card follows the editor. No per-device override: it costs a lot of UI for little gain.
- The snap-back of a dropped room is already in S1.22 (13fb9b8).

## 2026-09-20 S1.24: a free room is "apart", like a zone

`geometry.ts` gets `apart(P)` = zone or `room.free`, used wherever a zone was excluded (snap corner and T targets, `stitch`, `movePoints` grouping, `mergeCorners`). `snapped(f, poly)` counts the outline and stairs as neighbours, so a room on an outline corner is snapped; only a free polygon is ignored. Zones count as neighbours too, as the block says. `snapRoomTo` (S1.22) skips a free room, dragged or as a target, and the editor's no-stitch-on-drop check for zone corners covers free rooms. `rotatePoly` normalises -0 to 0. The rotation field is a turn that resets to 0 after use; a multiple of 360 or rubbish records nothing. Added one hint beyond the block: "This room shares a corner with a neighbour. Unsnap it to rotate." shown while the field is disabled. Snap back only clears `free`; it moves nothing.

## 2026-09-20 S1.23: angles are typed as a target, applied as a turn about the midpoint

The wall, door and opening panels show `#wrot`, `#drot`, `#orot`: the segment's angle in degrees, clockwise on screen, 0 to 360. Typing a value turns the segment by the difference about its midpoint (`rotateSegment`, ends rounded to 1 cm, length kept within 1 cm). The same value, or rubbish, records nothing. A device has `rot` (degrees, stored modulo 360, key deleted at 0), shown as `#vrot` for every device including heaters. `renderFloor` turns the device group and turns the icon back, so the glyph stays upright and the click target turns with the device. Also fixed: `onFocusOut` no longer clears the selection when the focused control was removed by a panel swap (choosing "Opening" in the wall kind select did that); the check waits one task so the removal is visible.

## 2026-09-20 S1.22: a dropped room snaps corner on corner, then stitches

Diego's addition: a connected room dragged away and put back near its place must reconnect. `snapRoomTo(f, i, radius)` (ops.ts) picks the closest pair of one own corner and one corner of another room, the outline or stairs, within 14 px worth of cm, translates the whole room by that one offset, then stitches each corner. Zones neither snap nor are snapped to; stairs are not snapped; Alt skips the snap (the stitch still runs). Side effect, kept: dropping a room with a corner or edge touching a neighbour or the outline adds a point to that edge, as a corner drag does, so a round trip leaves the room exact but can leave extra collinear points on the outline or a neighbour. This supersedes the plan's "never stitches" for the drop.

## 2026-09-20 S1.21: Add loses Water, one wall button per kind

The Add menu has no Water item: water is a room kind, drawn (Draw, Draw water) or picked in the room panel. The Add wall item becomes five, `#addWall-<kind>`, each a 200 cm wall of that kind at the spawn point. The Draw menu keeps the old ids. SPEC already listed both menus (S1.20 wrote them), so it is unchanged.

## 2026-09-20 S1.20: the spawn point is a centre, except for a structure

`spawnPoint` gives `[maxX + 150, minY]` of the outline. Wall, zone, water, stairs and furniture are centred there, as they were centred on the view. A structure is 400 cm wide, so centred there its west half would sit inside the house (the block's own test wants every point outside the box): its top-left corner goes on the spawn point instead. `ensureVisible` keeps the zoom and pans by the least amount that puts the point 100 cm inside the visible area; for a structure it is called for the far corner too, so the whole box shows. A floor with no outline (a new floor) falls back to the view centre.

## 2026-09-20 S1.19: the conversions take the floor key

`wallToOpening(f, i, floor)` and `openingToWall(f, i, kind, floor)` take the floor key as a last argument, because `newId` needs it to build `<prefix>-<floor>-<n>`. Both return `f` itself for a missing index or a zero-length segment; the panel then says so in the status line (`PanelCtx.say`) and writes nothing. The new opening or wall goes last in its list and is selected. The structure hint no longer says "wall and dotted": it points at the edge kind select.

## 2026-09-20 The hatch beats the kind rules

- S1.16 made the kind fills `:not([fill])`, which raised their specificity above `.room-fill`, so a fill room lost its hatch (found by the Sonnet verifier in Chromium; unit tests only read the CSS string). The rule is now `.room.room-fill`, later in the sheet. A fill room keeps its hatch with or without a colour of its own. Browser test added.

## 2026-09-20 S1.17: migrate pads wk, and the edge button stays until S1.18

`migrate` builds `wk` from `w` (`false` is boundary, anything else wall), pads a short list with `wall`, and leaves a `wk` that is already there alone, so an unknown entry reaches `validate`. A missing `wk` on a zone becomes all `wall` and `validate` then refuses it, as it refused a missing `w` before. Until S1.18 the edge panel keeps its one button: it sets `boundary` when any matching room edge is `wall`, else `wall`. `toggleWall` is gone; `setEdgeKind` replaces it.

## 2026-09-20 S1.16: a room colour needs `:not([fill])` rules

A `fill` attribute loses to a class rule, so `.room{fill:...}` hid every colour. The block asks for the attribute, and it stays. The class rules for room, garden, terrace, pavement, zone and water now read `:not([fill])`, so an own colour shows. `.room-fill` keeps its hatch and stays unconditional: a fill room with a colour still draws the hatch. `renderFloor` writes the attribute only when the value matches `#rrggbb`, so a layout that skipped `validate` cannot inject markup.

## 2026-09-20 S1.14: where the demo garden and pavement sit

The demo garden is 100 by 160 cm at the east wall, around the pond. The pavement is a 30 cm strip along the south of the house, from x 400 to 800. It stops short of x 400 on purpose: the editor tests draw and snap in the free space south-west of the house, and a full-width strip took their snap points. `mergeCorners` skips `garden` (the old `outdoor` rule); `pavement` is not skipped, because its corners may sit on the house corner and must then merge like a room's.

## 2026-09-20 Answers to the Sprint 1.6 questions

- Room colour overrides the kind colour; aura 2 m across, to try; plan rotation is kept beside `north`; Delete floor keeps its confirm; the demo gains a garden and a pavement. All as planned.
- Plugs and computers turn blue when on, grey when off (supersedes "grey on and off" for those two in S1.30 and S2.9). Wall switches and humidity sensors stay grey.
- Round stairs have an outer diameter `dia` and an inner diameter `inner` (the empty well); treads run between the two rims. Supersedes the single `dia` in S1.25.
- Curved stairs stay out, as Opus decided. Diego's reading: "curved" means an angled flight built from several sections. So it is several straight stairs placed end to end, and the trace prompt (S5.2) says so.

## 2026-09-20 Sprint 1.6, the editor rework (Opus, from Diego's change list)

The list is in Diego's words in the Sprint 1.6 preamble of `docs/PLAN.md`.
What follows is what was decided, and what was refused.

**Schema stays version 2.** Every change here is an added enum value, an
optional field, a renamed enum value or one array replaced by a richer one,
and `migrate` fills all of them from an older file. Nothing is released yet
(no tag, S3.5 is the release), so `migrate` is the only compatibility surface
there is. A bump to 3 would force `migrate`, `validate`, the integration's
save check and the prompt to carry two shapes for no reader's benefit. So:
`migrate` accepts v1 and v2, rewrites `outdoor` to `garden` at either version
(the rename is not a v1 rule), and is idempotent as before.

**Room kinds.** `outdoor` is renamed `garden` because that is what it is, and
the palette needed a second outdoor kind: `pavement` (grey). Garden is a
darker green than the old `outdoor`, terrace is light brown, fill is grey with
diagonal hatching so it reads as "floor, not a room". The hatch is an SVG
`<pattern>` in a `<defs>` emitted by `renderFloor` with the fixed id
`fp-hatch`. Two cards on one page then declare the same id twice; the two
patterns are identical, so the reference resolves either way. A unique id per
render would make the snapshot test useless for no gain.

**A room edge has a kind, and `w` goes.** Diego wants to change a wall's type,
not only draw it, and room edges were booleans while free walls had five
kinds. `Room.w: boolean[]` becomes `Room.wk: WallKind[]`, one entry per point,
the same five kinds as a free wall. `migrate` maps `true` to `wall` and
`false` to `boundary`, which is exactly what the two values meant. Rejected:
keeping `w` and adding a parallel `wk`. Two arrays that must stay in step
through `stitch`, `insertPoint`, `removePoint` and `mergeCorners` is the kind
of duplication the Sprint 1 reviews already caught once.

**Opening is not a wall kind.** An opening is a gap drawn over a wall and it
is its own list; that is how the card erases the wall under it. So the kind
select of a *free* wall offers a sixth entry, "Opening", which deletes the
wall and writes an opening with the same ends, and the opening panel offers
the five wall kinds, which converts back. A room edge has no such entry: a gap
in a room edge is an `openings` entry laid over it, as today.

**Room colour is the one colour a layout may hold.** `room.color` is optional
and must match `#rrggbb` exactly; `validate` rejects anything else. This is a
stated exception to the rule "colours only through `--fp-*` variables" in
`CLAUDE.md`: a user's choice is data, not a theme value. The strict pattern is
the guard, because the value is written into a `fill` attribute.

**Unsnapping is a stored flag, not a guess.** "Snapped" has never been stored;
it is only shared coordinates. Rotating a room that shares corners would tear
its neighbour's wall, so rotation is offered when the room shares no corner
with anything, or when the user has pressed Unsnap, which sets
`room.free: true`. While `free`, the room's corners are no snap, stitch or
merge target and do not drag a neighbour's corner along. Rejected: unsnapping
by moving the room 20 cm away, which is the only way to break coincidence
without a field, and which moves the drawing without being asked.

**A rotated room rewrites its points; a rotated plan does not.** There is no
per-room transform and adding one would touch every geometry function, so
rotating a room, a zone or water rounds its new points to 1 cm in one undo
step. The user sees the result and can undo it. The whole-plan rotation is the
opposite case: it is a view of the same data, it happens repeatedly, and
rounding would drift every time, so it is stored as `layout.rotate` (a
multiple of 45) and applied by `renderFloor` around one pivot shared by all
floors (`planPivot(layout)`, the centre of the union of the floor outlines).
Names and icons counter-rotate about their own anchor so they stay upright.
The editor un-rotates the pointer in `toSvg`, which is the single place plan
coordinates are made. This is the lossless option and it is the one chosen.

**Devices carry `rot`, stairs carry `rot`, rooms do not.** One optional number
on a device serves the camera cone today and anything directional later.

**Stairs stay one element with a shape.** `Stairs` gains `shape`
(`straight` | `round`), `steps` and `rot`, and `dia` for a round one. `pts`
stays the footprint, so `polys`, hit testing and `viewBoxFor` are unchanged; a
round stair's `pts` is the 24-gon of its circle, regenerated when `dia`
changes. A stair with `rot` other than 0, and any round stair, shows no corner
handles: the handles are drawn from `pts`, and un-rotating a second set of
hit targets is not worth it. Set the rotation back to 0 to reshape.

**Curved and quarter-turn stairs are refused for now.** Diego asked for
curved, round and straight. Round (a spiral) and straight are in. A
quarter-turn needs a second geometry, its own handles, its own tread maths and
its own tests, for one shape that two straight stairs at an angle already draw
well enough now that stairs rotate. If it is still wanted after using the
rework, it gets its own task.

**Stairs are placed on every floor, and deleted from one.** Add, Stairs writes
the same footprint into every floor, with an id per floor, as one undo step. A
house has one stairwell in one place. Delete removes it from the current floor
only, because stairs often stop below the top floor. A new floor inherits the
outline and the stairs of the *first floor in the chip order* (the lowest),
not the most recently edited one, so the result does not depend on what the
user touched last.

**One wall switch can power several lamps.** `bound` stays on the light and
loses two rules: two lights may name the same switch, and a bound entity may
also be a device of its own (the grey wall switch on the wall). It keeps: only
on a light, different from `entity`. Rejected: `switch.controls: string[]`.
Every reader (`renderFloor`, `bind.ts`, the panel) already looks the other
way, from the lamp to its switch, and one direction is enough.

**Three new device types, and no "garden sensor" type.** `DeviceType` gains
`tv`, `computer` and `ac`. A garden sensor is not a kind of device: it is a
sensor standing in a room of kind `garden`, which the plan already knows, so
`renderFloor` colours it green from where it is. An `ac` is an air
conditioner, heat pump, fan or air cleaner; whether it is cooling, heating or
only moving air comes from the entity at render time (`hvac_action` cooling →
blue, heating → orange, anything else, or no such attribute, → grey), not from
a field in the layout. A layout that claims what a device is doing would go
stale the first time the user changes the mode.

**Static colour in Sprint 1.6, state colour in Sprint 2.** The circle behind
every icon (grey, 50 % alpha), the icon drawn above everything including room
names, the fixed colours (camera dark grey, humidity and computer and switch
grey, a sensor in a garden green) and the camera's 120° cone are drawn from
the layout alone, so they belong to the editor sprint. Every colour that needs
`hass` — on/off colours, the light aura, a smart light's own colour, the AC
mode, the TV blue — is a card task in Sprint 2 (S2.8 to S2.10). The palette
itself (`--fp-dev-*`) is defined once in Sprint 1.6 so both sprints use the
same values.

**Everything drags by its body.** Only a `structure` room did. Now every room,
zone, water, structure and stairs does. The cost is that a press on a room
body no longer starts a pan: panning stays on the background, the middle or
right button, and Ctrl or Cmd held, which the hint already says.

**New items land outside the house.** `spawnPoint(f)` is 150 cm right of the
outline's bounding box, at its top; with no outline it is the middle of the
view. Walls, structures, zones, stairs, furniture and a device whose room is
unknown go there, and the view scrolls to show it. Doors, windows and openings
keep the nearest-edge rule: one placed off the house is of no use.

**Delete is orange, Delete floor and Reset are red.** Removing one item is
undoable; throwing away a floor or every edit in the browser is the pair that
costs most, so those two are the only red buttons.

## 2026-09-20 Floor Move up goes to a higher floor

- Supersedes "Move up: earlier in the list" in the floors entry. Chips run left to right, lowest floor first, so Move up now moves a floor one place later (a higher floor) and Move down one place earlier. Diego found the buttons inverted. `moveFloor(key, delta)` is unchanged; only the buttons and the undo message swapped.

## 2026-09-20 Sonnet verifies, Opus decides

- The Test role moves from Haiku to Sonnet and is renamed Verify. Haiku's break-it runs in Sprint 1.5 cited existing tests instead of running its own, and one script never reached the state it claimed to test. Verification is where a weak model costs most.
- Opus owns every decision and judgement call: review, design choices, spec ambiguities, author-versus-verifier disputes. Sonnet executes and verifies.
- Break-it scripts must be the verifier's own and must show they reached the state under test. `docs/WORKFLOW.md` updated. Supersedes the Haiku test role in the Sprint 1 to 1.5 entries.

## 2026-09-19 Sprint 1.5 review fixes, round 2

- Only a zone polygon's own edge hides the wall toggle. The first bullet of the entry below says it also hides on a room edge that a zone edge lies on top of; the code and the geometry test "toggleWall on a room edge that a zone edge lies on" say otherwise: a room edge under a zone edge still toggles, and the zone stays dotted. That parenthetical is wrong. On an exact tie between a zone edge and a room edge, the pointer pick (`nearestEdge` with `zones: true`) now takes the room edge, whichever is listed first, so that toggle stays reachable.
- The host finder keeps offering free walls (`{ walls: true }`), so Add, Door can put a door on a fence. Kept on purpose: a gate is a door on a fence. No code change.
- `migrate` fills `name` with "" on stairs and extras. `validate` demands text there since round 1, and an older or hand-written file without them was refused on Open and its autosave dropped. Door names were already required before the branch; no other field `validate` added can be missing from an older file (room label is filled, device name is optional).
- The dblclick after a finishing press is swallowed only when exactly one press followed it. The phantom pair is the finishing press plus one; a deliberate double-click is that press plus two. This refines the guard entry below.
- A zone drag never stitches, on the ends of the drag rather than the coordinate: with a third polygon's corner at the drop point the old check (every polygon at that point is a zone) let `stitch` insert a point into the rooms either side.

## 2026-09-19 Sprint 1.5 review fixes (Opus findings on S1.8 to S1.13)

- A zone edge is never a wall toggle. `edgeRooms` returns nothing for a zone polygon and skips zones as matches, so the panel hides "Make this edge a wall" on a zone edge (and on a room edge that a zone edge lies on top of), and `toggleWall` returns the floor unchanged. Before, the toggle wrote `w[i] = true` into a zone, which `validate` rejects: Save refused and a reload dropped the autosave.
- Zone and room corners at one spot: the owner is passed, not guessed. Two corners at one coordinate cannot be told apart from the coordinate, so the polygon that owns `from` cannot be derived from it. `movePoints` treats "no `only`" as "not a zone corner", so a call site that forgets the owner leaves a zone corner behind (visible, safe) rather than dragging it. `setSecondEnd` now takes the reference of the second end as a required argument (TypeScript flags a caller that omits it); the corner panel passes its selection, the edge panel `{ poly, j: i + 1 }`, the wall panel `{ k: "walls", i, end: "b" }`. The drag paths already passed one. Chosen over deriving from the coordinate (ambiguous) and over an optional argument (a forgotten one would look fine).
- The double-click after a finishing click (supersedes the last line of the S1.11 entry, which said there is no guard). Measured in Chromium with a probe on the svg: the press that finishes a shape is not captured, the plan is redrawn under it, so its mouseup lands on another element and the click count restarts; the pair sends no `click` and no `dblclick`. That much of the S1.11 note holds, but its conclusion was wrong: only Chromium is installed here, so nothing shows that Firefox or Safari send none, and a dblclick that does arrive inserts a corner into the wall under it (a second undo step). Now `drawClick` records when and where the finishing press happened and `onDblClick` returns once for a dblclick within 500 ms and 10 px of it. A press that is late or elsewhere clears the record. Tests send the dblclick as a synthetic event after real `page.mouse` clicks, and say so; the real `page.mouse.dblclick` variants are kept as regressions and pass with or without the guard.
- `nearestEdge` is the host finder for doors, windows, openings and heater alignment, so it skips zones by default (it already skipped stairs). The pointer's edge pick (`edgeNear`) passes `{ zones: true }` and still finds zone edges. Snap and stitch do not call it. Default chosen for placement because four call sites place things and one picks.
- Names are text, checked twice. `validate` now requires `name` as a string on rooms (zones and water too), stairs, doors and extras, `label` as a string on rooms, and `name` as a string when a device has one. `migrate` fills a missing room `name` and `label` with `""` (it already filled `area`); it leaves a wrong type alone, so `validate` reports it. Door names were already checked. `esc` in `render.ts` calls `String()` first, so a layout that reaches `renderFloor` without `validate` shows `[object Object]` instead of throwing.
- One host finder (supersedes the `hostEdge` line of the S1.13 entry). `hostEdge` is gone; `nearestEdge` takes `{ walls: true }` to offer free walls too (`poly` "w", `i` the wall index). Add, Door, Add, Opening, the door drag and the heater alignment all use it, so a door, window or heater can sit on a free wall as an opening already could. Zones stay excluded (previous entry). The pointer's edge pick keeps asking for zones and picks free walls itself.
- Water gets no HA area by default: `area` is `""`. Add, Water and Draw, Water already did this; the demo pond said `garden-pond` and `migrate` filled a slug for a water room with no area. Now `migrate` fills `""` for kind water (zones and every other kind still get a slug), and the demo pond is `""`. A pond is scenery, not a place to bind devices to; a zone is a place, so it keeps a slug. `migrate(v1)` still equals the demo.
- The `floor` attribute is looked up with `hasOwnProperty`, as `state.ts` does. The editor's own layout has null-prototype floors, so a name like `constructor` cannot match there today; the check guards a plain-object layout. The test swaps in a plain object to reach it.
- One snap rule for a zone corner (supersedes the S1.8 line "A zone corner still snaps to room corners" and the S1.11 line that a dragged zone corner differs from a drawn one). A zone corner, drawn or dragged, never snaps to a room, outline or stairs corner, a wall end or an edge. It lands on the grid (5 cm) and lines up on x or y with the other corners of its own zone. Other shapes still ignore zone corners (unchanged). `snapCorner` takes a `zone` flag: the drag derives it from the polygon that owns the dragged corner, draw passes `kind === "zone"`; the zone path snaps against an empty floor plus its own corners. A zone often sits on a room's edge or corner on purpose, so a snap that pulled it onto that corner made it hard to place a zone anywhere near one. Removed the geometry test "a zone corner still snaps to a room corner": it pinned the old rule, and `snapPoint` alone does not know what is being dragged, so the rule is tested in the browser.

## 2026-09-19 Opening tool fixed in S1.13

- Hit-testing: core CSS keeps `.opening{pointer-events:none}` and its markup keeps no data attribute, so the card is unchanged. The editor's own stylesheet sets `.opening{pointer-events:stroke}` (it loads after `FLOORPLAN_CSS`), which makes the 9 cm stroke hittable in the editor only. `hitOf` identifies the element by `closest("line.opening")` and takes its index among the plan's `line.opening` siblings, which is its index in `floor.openings` because core emits them in array order. Chosen over a hit path in the overlay: an overlay line is painted last, so it would sit above doors, furniture and devices and steal their clicks. The plan's paint order is the hit order.
- Openings are painted after every wall and edge line, so a click on the wall under a gap selects the gap, and the wall is not visible there (the stroke is the room colour, 9 wide against 3). Playwright asserts the real top element at the middle of the segment; a core test pins the paint order.
- `Sel` gains `{ t: "opening", i }`. Panel: length in cm (min 20, as for a door; midpoint and direction kept through `resizeSegment`) and Delete (`#ol`, `#odel`). An opening has no name, no body drag; its end handles (`data-hp`) drag and snap as before.
- Add, Opening (`#addGap`, `addOpeningGap(len = 120)`) uses `hostEdge`: the nearest polygon edge or free wall. `nearestEdge` alone ignores free walls, and the task needs a free wall to work as host. `addDoor` (renamed from `addOpening`) keeps `nearestEdge`, so a door still ignores free walls: not changed here. No edge on the floor: horizontal at the view centre.
- Draw, Opening now selects the opening it made. Draw, Structure line still selects nothing: extras have no selection type.
- The hint text under the panel lists opening among the things Delete removes.

## 2026-09-19 Device menu fixed in S1.12

- Device is a toolbar menu after Add (order: floor chips, filter, Names, Add, Device, View, File). It replaces the `#addDev` select in Add with a search field (`#devSearch`) and one button per unplaced catalog entry (`button[data-dev=<id>]`), under a heading per type in `TYPE_LABELS` order. `unplaced()` is unchanged, so a bound pair still leaves together.
- The search matches the trimmed, lower-cased text against `name` and `entity` (substring). Nothing left to place shows "Every device in the catalog is on the plan" (`#devNone`); a search with no match shows "No device matches".
- The search text is state (`devQuery`) and is cleared when the `<details>` closes by any route (click outside, item chosen, another menu opened, Escape), through its `toggle` event. Opening the menu focuses the field.
- Keys: the field is an `INPUT`, and the host's `onKey` already returns for inputs, so letters, Delete, Backspace and Ctrl+Z belong to the field and reach no editor shortcut. The only key the field handles is Escape, which closes the menu and gives focus back to the host. Nothing is on `window`.
- Placing takes focus to the host before the edit. The clicked button leaves the list on the next render, and Lit renders between two listeners of one click; without this the focus-out handler saw the button vanish and cleared the new selection.
- Panel hints say "Device menu" where they said "Add, Device". Add keeps its Furniture select.

## 2026-09-19 Draw mode fixed in S1.11

- The mode logic is `src/editor/draw.ts`, no DOM: `Draw` (kind, points, `click`, `backspace`, `cancel`, `finish`, `rubber`) and `applyShape`, which returns the new floor and the selection. The editor snaps the pointer, feeds `click`, and draws the overlay.
- Nothing is written until the shape is finished. A wall chain is one undo step because it is one `edit`; Esc therefore has nothing to undo. While drawing, the overlay shows the points and a dashed path only.
- Zone points snap to the grid and to the shape's own earlier points (axis line-up) only. This differs from dragging a zone corner, which S1.8 lets snap to room corners: the S1.11 task says a zone drawn on a room corner must not snap to it, and a freshly drawn zone has no reason to join a neighbour. Other kinds use `snapCorner` (corner, T, line-up, grid) and gain the shape's earlier points as line-up targets. Alt is plain rounding, as for a corner drag.
- Closing: a click within 14 px of the first point ends a polygon when it has 3 or more points; with fewer the click is ignored, so a 2-point polygon cannot close. The test uses the raw pointer, not the snapped point. A click on the last point (the second click of a double-click) adds nothing. Walls do not close on the first point.
- Opening and Structure line are single segments: the second click finishes them. Only walls chain.
- Finish with too few points (polygon under 3, line under 2) writes nothing and leaves no undo step; the status says so.
- Room: name "New room", area `new-room`, all walls on. Zone and water: names "New zone" and "New water", all edges dotted; zone area `new-zone`, water area empty (as `addArea`). Outline replaces `floor.outline`. A room, water or outline corner on another polygon's edge is stitched in, as when a corner is dropped; `stitch` leaves zones alone.
- Selection after finishing: room, zone, water and the last wall of a chain are selected. The outline selects its first edge (there is no outline selection type). Openings and structure lines have no selection type until S1.13; their end handles show.
- Entering draw mode clears the selection. Leaving it (finish, Esc, another Draw or Add item, floor change, Undo or Redo, Open, Reset, a new layout) drops the points and the rubber band. Draw mode owns Enter, Esc and Backspace; Delete does nothing in it. Ctrl/Cmd+Z ends the mode and then undoes.
- Pan (middle or right button, Ctrl/Cmd) and wheel zoom work as before. The cursor is a crosshair; the overlay uses `--fp-window` and `--fp-bg`.
- The Add menu lists 11 Draw items (wall kinds by their panel labels) and scrolls when the window is short (`max-height: 75vh`).
- A dblclick after a click that closed a polygon does not fire in Chromium (the plan is redrawn between the clicks), so there is no guard for it. If another browser fires it, the double-click handler would add a point to the new edge.

## 2026-09-19 Floor operations fixed in S1.10

- `addFloor("")` (or whitespace) returns `""` and changes nothing; the plan's `string` return has no other room for a refusal. The stored title is trimmed. A title with no letter or digit gets the key `floor` (then `floor-2`). `renameFloor`, `moveFloor` and `deleteFloor` return `false`, with no undo step, for an unknown key, an unchanged title, an empty title, a move off either end, or the last floor.
- Key clashes and "does this floor exist" use own-key checks, not `floors[key]`, so a floor called `constructor` is not a clash and `setFloor("constructor")` cannot select a prototype member. `deleteFloor` and `moveFloor` rebuild `layout.floors` as a prototype-less object with `defineProperty`, so a floor named `__proto__` (allowed by `migrate`) stays an own floor.
- Floor operations are methods of `EditorState`, not `edit()`: `edit` is per floor and compares the floor, these change the layout. Each snapshots the whole layout once before it changes, so undo restores content, order and titles together.
- Move up means earlier in the key order (left in the chips); Move down means later. The buttons are disabled at the ends. Delete floor is disabled while one floor is left.
- The delete confirm is inline in the floor panel (`#fdelyes`, `#fdelno`), kept in `EditorState.confirmDelete`; changing floor, undo/redo, or a pointer press on the plan cancels it.
- The floor panel is what the side panel shows when nothing is selected. It keeps the line "Nothing selected." above its fields.
- The "+" chip is replaced by a title input while it is open; Enter adds, Esc or leaving the input cancels, Enter on a blank title keeps it open with a hint in the status line. The editor's own click handler that returns focus to the editor skips the "+" chip, or it would take focus from the new input.

## 2026-09-19 Wall kinds fixed in S1.9

- `migrate` sets a missing `wall.kind` to `wall` (v1 and v2). An unknown kind is left as it is; `validate` rejects it with the list of the five.
- `renderFloor` gives class `e` to `wall`, `e nw` to `boundary`, and `e <kind>` to any other kind, escaped, so an unvalidated kind cannot break out of the attribute.
- New variables `--fp-wall-external` (#1a1917, 6 wide), `--fp-wall-fence` (#7a5c3a, 1.5 wide, dash-dot `10 4 2 4`, butt caps so the dashes stay visible), `--fp-wall-edge` (#a29e94, 1.5 wide, solid). Defaults live in `FLOORPLAN_CSS`; the markup has no colour.
- Panel labels: Internal wall, Dotted boundary, External wall, Fence, Outdoor edge. The panel title shows the label of the current kind.
- The demo layout gets no new wall: it has no free walls and the snapshot stays as it is. Unit tests use a fixture; Playwright loads five walls into the editor.
- Hit-testing needed no change: a click on a thin line hits it, and the editor picks the nearest wall within 8 px on screen otherwise.

## 2026-09-19 Zone details fixed in S1.8

- A zone edge is always drawn dotted, whatever `w` says; `validate` rejects a zone with a `w` entry that is not `false`, so the render rule only guards a layout that skipped validation.
- A zone's corners are never a snap, T or stitch target, and a zone corner dropped on a wall is not stitched into it. Zone and room corners at one spot do not drag together: `movePoints` with `only` moves zone corners only when `only` is a zone corner, and room corners only when it is not. A zone corner still snaps to room corners, so a zone can be aligned to a room.
- Water is an ordinary polygon: it snaps, stitches and merges like a room. Its `w` flags are free; the editor and demo use all `false` (dotted edge). Fill is `--fp-water`, default `#a9cfe3`.
- `viewBoxFor` still fits the outline only, so the demo pond sits within the 60 cm pad right of the house.
- `renderFloor` paints zone polygons after all other rooms, whatever the array order, so a zone is always the top polygon and a click inside it selects the zone (room panel: kind, area, name). The editor already gives `.room` `pointer-events:all`, so the zone's `fill:none` needs no transparent fill and the card's markup is unchanged. Devices, furniture and edges are drawn after the polygons and keep priority.
- A zone has a plan label of its own class (`lbl zone`, 10 cm text) and no second line.

## 2026-09-19 Drawing before the card; organising the home is a goal

- Sprint 1.5 (zones, water, wall kinds, floors, draw mode, Device menu) runs before the card. Each changes what `renderFloor` draws; done first, the card gets them with no rework. Schema stays version 2: only added enum values and optional fields, so `migrate` needs no new rule.
- "Zone" is the schema name for a dotted subdivision inside a room (`room.kind: "zone"`, `w` all false). Not "area": `room.area` already means the HA area id, and a room and a zone both map to one.
- `wall.kind` keeps `wall` and `boundary` (their meaning is unchanged) and gains `external`, `fence`, `edge`. No migration.
- The non-goal "editing HA areas, devices or entities" is dropped. Epic E6 (Sprint 4) creates areas, moves devices into them, makes helpers, groups and automations from the plan. It runs only in the HA panel, after the integration (Sprint 3), because every step needs `hass` and the registry websocket commands. Prompt and docs move to Sprint 5.
- Every HA write is confirmed in a dialog, labelled `floorplan-studio` (HA label, created once) so the user can find and remove what the tool made, and never triggered by load or save. HA registries have no undo; the dialog says so.
- One switch to one light is the Switch-as-X helper plus `bound`, not an automation. Automations are for many-to-one, group-to-group and schedules.
- An automation is created through `POST config/automation/config/<id>` and then HA's own editor is opened on it. Prefilling HA's editor without saving first is not possible from a custom panel (the initial data lives in a module variable of the frontend), and `history.state` hacks break across releases. Create, then open.
- The panel uses HA's own elements (`ha-area-picker`, `ha-entity-picker`, `ha-textfield`, `mwc-button`) and maps `--fp-*` to HA theme variables. The standalone build keeps plain controls behind the same panel code.

## 2026-09-19 Review fixes for S1.7 (Opus review)

- Openings, extras and stairs edges are drawn by `renderFloor`, not by the editor overlay, so the card (S2.1) gets them for free. Paint order: rooms, stairs, outlines, walls, stairs edges, openings, extras, furniture, doors, devices, room names. The editor keeps only handles. Extra names are escaped. Snapshot changed by the four stairs edge lines only (the demo has no openings or extras).
- `save-request` keeps the Layout as `detail`. The element gains `saveDone(ok, message?)`: status stays "Saving..." until the host calls it; `true` gives "Saved", `false` gives the message. With no `save-request` listener at all the editor says "Saved" itself. `standalone.html` calls `saveDone(true)` after the download.
- A dragged corner never snaps to its two neighbours (an edge could collapse to zero length). If the pointer lands on one anyway, the corner stays where the pointer is.
- The selection clears when focus leaves the editor (unless it moved into the side panel), so a highlighted item always means Delete works. Panel buttons that remove something hand focus back to the editor so Ctrl+Z works.
- `build.mjs` copies `dist/editor.html` to `custom_components/floorplan_studio/www/` next to the JS bundles, so the integration serves the same single file. Playwright's globalSetup runs the build, so a test run rewrites `dist/` and `www/`.
- The v1 demo's garage contact catalog entry uses the v1 name `window`, so migration's catalog rename is exercised.

## 2026-09-19 Bound light and switch (assumption, maintainer request)

- One lamp can be two HA entities: a smart switch and a light helper on top of it. A `light` device may carry `bound`, the switch or plug entity id. `entity` (the light) stays the click target; the card toggles it and long press opens its more-info. The switch is reached from that dialog.
- `validate`: `bound` is an entity id, only on type light, differs from `entity`, unique across devices, and never another device's `entity`. Each problem is reported. `migrate` passes it through untouched.
- `renderFloor`: the icon is `on` if either entity is on, `unavailable` only if every present state is unavailable or unknown, else `off`. Class token `bound` is added. The title is `light: <name> + <bound friendly_name, else bound id>`; the renderer has no catalog, so it cannot look up a name otherwise.
- `core/bind.ts`: `placedEntities` and `unplacedCatalog`, so a bound pair leaves the Add, Device list together. The editor still has to use them.
- Demo: `light-living` is bound to `switch.demo_living_relay` (catalog id `switch-living-relay`). The v1 demo carries both. The render snapshot changed on that one device only.
- Editor: `unplaced()` uses `unplacedCatalog`. The Device panel of a light has "Controlled by" (`#vbound`): (none) plus unplaced switch and plug catalog entries that are no other device's `bound` and not the light's own entity; the current one always shows. It writes `bound` through `commit` (one undo step, none when unchanged; the key is deleted for none) and names the pair. Deleting a light drops `bound` with it, so the switch returns to Add. The editor has no device type field, so no type change can leave `bound` behind; `validate` would reject it.

## 2026-09-19 Add and remove stairs in the editor

- Add, Stairs places a 100 x 300 cm rectangle on the 5 cm grid, centred in the view, id `stairs-<floor>-<n>` from `newId`, name "Stairs", and selects it. `Sel` gains `{ t: "stairs", i }`; the panel has a name field and Delete. Delete and Backspace remove it (keys stay scoped to the editor). Undo restores index and id because history is whole-layout snapshots. Corners, add point and remove corner already worked for `s<i>` polygons. Core untouched.
- `playwright.config.ts` reads `PW_PORT` (default 5173; the stairs branch called it FP_PORT) so a second checkout does not reuse another checkout's dev server.

## 2026-09-19 Review fixes for the editor (S1.6, Opus review)

- Stairs are editable: the overlay draws their edges (`data-e="s<i>:<j>"`) and corner handles (`data-h`), and `hitOf` knows `data-s`. Openings and extras are drawn by the overlay (extra names escaped) so their end handles have a body. Core stays untouched.
- `room.label` is drawn under the room name by `renderFloor` (escaped). The demo has no labels, so the snapshot did not change.
- Keys are heard on the element, not on `window`. The element is focusable (`tabindex=0`) and takes focus on pointer down, so Delete and Ctrl+Z elsewhere in a page do nothing.
- `snapCorner` ranks loose ends and polygon corners in one list; the nearest wins.
- `EditorState.edit` returns false and records no undo step when the floor did not change; the element then fires no `layout-changed`.
- Save ends at "Saved" unless the host's `save-request` handler set its own status.
- `panel.ts` is renamed `panels.ts`: S3.2 owns `panel.ts`. The `floorplan-studio-panel.js` bundle keeps its name and now builds from `panels.ts` until S3.2.
- The demo catalog gained one unplaced contact sensor (`contact-garage`) so the door sensor picker has an option; the v1 demo carries it too.
- Add, Device groups by type only until S3.3 supplies areas to group by.

## 2026-09-19 Editor on the core (S1.6)

- The editor is a Lit element with shadow DOM. Hit-testing takes the real top element under the pointer (`g[data-x]` for a device icon, then handles, doors, furniture, edges, rooms). Where the top element is a room or the background, the nearest wall or edge within 8 px wins, so thin walls stay clickable without a wide overlay hiding icons.
- Edits are copy-on-write. A drag keeps the floor as it was at pointer down and recomputes the moved floor from it on every move; the undo step is recorded on the first real change. Shift is read on every move: with it, `movePointAll(..., detach, only)` moves just the grabbed corner.
- `ops.ts` (not in the S1.6 file list) holds the edits geometry.ts does not cover: loose wall, opening and extra ends. Core stays untouched.
- Loose ends (wall, opening, extra) are drawn as extra handles by the editor (`data-hp`), selected door ends as `data-dh`; `renderFloor` only draws polygon corners.
- The element never downloads or posts anything. File, Save validates, autosaves, and fires `save-request` (detail: the layout); the host writes it. `standalone.html` downloads `layout.json`; S3 will send it over the websocket.
- `seed` property (default: the first layout set) is what File, Reset returns to. `standalone.html` restores the autosave from `localStorage` (`floorplan-studio:layout`) before setting `layout`; a host in HA sets its own.
- Open and Reset validate first (`loadLayout`: migrate, then validate, never throws). A bad file shows the error list and leaves the layout as it was. Both keep undo history.
- `panel.ts` is now the selection panels, but `vite.config.ts` still builds it as the `floorplan-studio-panel.js` entry. S3 replaces that entry with the HA panel element; until then the bundle only carries the panel views.
- Grid snap for devices and furniture is a real 5 cm grid. The vanilla editor divided by 5 and multiplied by 5 without rounding, so it never snapped.
- `@types/node` is a dev dependency: the Playwright spec reads files and needs node typings for `tsc`.
- Playwright: `webServer` waits on `/standalone.html` because the dev root has no `index.html`.

## 2026-09-19 Review fixes for S1 (Opus review)

- `validate` never throws and checks every array field, the enums (room and door kind, device type, furniture symbol), finite numbers (north, coordinates) and door names. Layout files are untrusted input.
- `migrate` also normalises v2 files (missing arrays and ids, version "2"). Floors are stored without a prototype so a floor named `__proto__` stays a floor. The v1 renames (sensor, window) apply to v1 only.
- `render` escapes every interpolated string, including `kind` and `type`, and skips devices without finite coordinates. An unreadable `last_changed` counts as just changed.
- The heater bar carries `data-xbar`, not a second `data-x`, so `g[data-x]` is one element per device.
- The `.dev-motion.on` colour rule is gone. It beat the fade while a sensor was on.
- `@mdi/js` is a dev dependency: the icon paths are inlined in `icons.ts`, nothing imports the package at runtime.
- `websocket_api` stays in the manifest dependencies. The integration registers websocket commands (S3.1), which need it loaded first.
- Demo ground floor gained two furniture items so the renderer snapshot covers furniture. The v1 demo carries them too.

## 2026-09-19 Renderer choices (S1.4)

- Colours come from CSS classes and `--fp-*` variables. `FLOORPLAN_CSS` (exported from `render.ts`) holds the defaults; the host element overrides them. The markup has no literal colours.
- Motion fade is `1 - age/fade` from the state's `last_changed`, for any state that exists. The card (S2.4) passes the last `on` time as `last_changed` so a sensor that already went off keeps fading.
- Room glow is accepted in the options but drawn in S2.6.
- Icons are 24 px on screen at any zoom (`scale = 1 / opts.scale`), a 13 px backing circle keeps them readable on room fills.

## 2026-09-19 Geometry port (S1.3)

- `movePoints` takes an optional fifth argument `only: { poly, i }` naming the point to move when `detach` is true. Without it, detach moves the first match. A pure function cannot know which of several coincident points the user grabbed.
- `mergeCorners` ports the clustering and de-duplication of `simplify.py`. It does not pull corners onto edges or re-seat doors; the editor does that when a point is dropped (`stitch`).

## 2026-09-19 Untrusted JSON is typed `any` at the boundary

- ESLint `no-explicit-any` is off. `validate` and `migrate` read files nobody typed; they inspect them as `any` and return the typed `Layout`.
- `validate` requires every object to have an `id` (the spec says so) and reports all errors, not the first.

## 2026-09-19 Founding decisions

- Render the layout natively in a custom card. No picture-elements export: it cannot do motion fade, door geometry highlights or per-type behaviour without YAML per element.
- Popups are HA's more-info dialogs. Custom dialogs only for confirmed actions (open a door).
- Two repos. This one is public with a demo layout. The maintainer's house stays in a private repo that consumes this library.
- Stack: TypeScript and Lit for editor and card, core in TypeScript without a framework, Vite build, Vitest tests. Vanilla was considered and rejected: a card and a panel by hand means manual re-render on every `hass` update and no types on a growing schema.
- A small integration ships with the package for load and save over websocket, so the editor and card share one stored layout. File drop into `www/` remains a fallback.
- Name `ha-floorplan-studio`, licence MIT. `ha-floorplan` is taken by another project.
- Icons: Material Design Icons (Apache 2.0), the set HA uses, inlined as paths.
- A prompt for LLMs (Claude, ChatGPT, Gemini, Grok) produces the first layout from photos. It lives in `prompts/` and the README explains the steps.
