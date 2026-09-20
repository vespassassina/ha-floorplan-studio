# Decisions

Newest first. A change supersedes; nothing is edited.

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
