# Decisions

Newest first. A change supersedes; nothing is edited.

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
