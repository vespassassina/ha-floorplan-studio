# Furniture, worktops, room badges, floor heating, energy counters, 3D Studio (Sprints 52 to 61)

Status: approved by Diego, 2026-11-01. Decisions 1 to 12 are his answers in the design interview; 13 on are the
defaults he approved.

## Goal

Seven requests from 2026-11-01, plus three replay requests from the same interview:

1. Four furniture pieces: an L-shaped sofa (its L on either side), a coffee table, a bookcase, a buffet.
2. A worktop: a counter of any polygon shape, at counter height in 3D.
3. Room badges: four small icons per room (lights, heating or cooling, motion, energy), placed in a corner, with
   details on hover or tap.
4. Underfloor heating seen while it heats, in 2D and 3D.
5. A charging car that is louder: a glow and a slow pulse.
6. Energy counters in the replay: electricity, water, gas and solar, use and cost climbing with replay time.
7. A 3D designer in the Studio, in stages, up to editing in 3D.
8. A card key that keeps the replay bar always visible.
9. Counter chips with sparklines, each opening a draggable, see-through chart of 5-minute bars.

## Bytes today

- Card: 123,672 gzip, cap 124,650: 978 left.
- Replay chunk: 3,656 of 6,000. R2.4 to R2.7 (Sprints 43 and 44) still spend from it.
- Replay 2's card allowance: 485 left of its +600.

This batch needs about 3.7 KB on the card. 978 bytes are not enough, so Sprint 52 frees room first (decision 1).

## Decided (Diego, 2026-11-01)

1. **Card room first.** Following the S41.b rule, the first sprint moves the popup, the dialogs or the overview into lazy
   chunks. The cap stays 124,650. No feature task here starts before that sprint has measured what it freed.
2. **A worktop is a piece of furniture with points.** It uses the symbol `worktop` and carries `pts`, a polygon.
   Furniture pieces cannot be reshaped today, so this needs new vertex editing (see C).
3. **Underfloor heating is a device flag.** A `climate` or `heater` device may carry `underfloor: true`. The room that
   holds the icon shows the cue while the entity's `hvac_action` is `heating`.
4. **Charging car: a glow plus a slow pulse.** The pulse is off under `prefers-reduced-motion`.
5. **Badges on touch: a tap shows a bubble.** A tap on a badge icon opens the hover tooltip as a bubble. A tap
   elsewhere, or 4 s, closes it. A tap on the room outside the badge still opens the room.
6. **Badge readings come from room sensor lists.** `room.power[]` and `room.water[]` work like `temps` and `humidity`:
   picked in the room panel and suggested from the HA area.
7. **Energy counters use HA's Energy preferences and 5-minute statistics.** The device tree follows a sprint later.
8. **The 3D designer goes all the way to editing in 3D, in stages.** Stage 1 is a preview pane, stage 2 is pick and
   move, stage 3 is structure editing. Diego reviews after each stage, and any stage can be the last.
9. **The queue:** after Sprint 51. Sprints 46 to 51 keep their place.
10. **Always-visible replay bar:** a card key, `replay: always`. The bar rests at "now". This needs a DECISIONS entry
    under the surface freeze.
11. **No sync with other cards in this batch.** HA's stock graph cards cannot be told what time to show.
12. **The counters' look:** compact chips. Each chip has a sparkline, can be shown or hidden, and shows use, cost or
    both. A tap on a chip opens a draggable, see-through overlay chart with integral bars at a 5-minute grain.

## Behaviour and defaults

### A. Card room (Sprint 52)

13. **Target: free at least 4,000 bytes gzip.** Candidates, largest first, each measured before it is chosen: the
    popup (`card-popup.ts`, `popup.ts`, `popup-ui.ts`), the dialogs (`card-dialogs.ts`), the overview
    (`card-overview.ts`). Each goes into a chunk loaded on first open, with the same retry-by-URL rule as the 3D and
    replay chunks. A chunk imports nothing from the card; the card hands it helpers, as `DEPS_3D` does.
14. **First open is slower.** A chunk is fetched on the first tap. The cost is measured on a 4x CPU-throttled run and
    recorded. The popup must open within 300 ms of the tap on that run, or it stays in the card and the next candidate
    goes instead.

### B. Furniture (Sprint 53)

15. **New symbols:** `sofa-l`, `coffee-table`, `bookcase`, `buffet`. Each has an inlined symbol in `icons.ts` on the
    0-100 box the others use, no runtime network (finding 9).
16. **Heights** in `heights.ts`: `sofa-l` 85, `coffee-table` 40, `bookcase` 200, `buffet` 85. **Default sizes**
    (w × h cm): 280 × 180, 110 × 60, 100 × 35, 180 × 50.
17. **The L's side:** `mirror?: true` on a piece flips it about its own vertical axis in 2D and 3D. It is valid on
    `sofa-l` only; `validate` refuses it on any other symbol, with the piece's name. Default: no `mirror`, so the
    chaise is on the left as seen in the symbol.
18. **The L in 3D:** the chaise and the back run are two blocks, both at the piece's height. The back run's depth is
    45 % of `h`; the chaise's width is 35 % of `w`. One shape function feeds 2.5D (`solids.ts`) and the 3D scene
    (`scene-build.ts`), so the two views cannot differ. The other three new pieces are boxes.
19. **Every symbol decided:** `FURNITURE_SOLID`, the 3D palette's role per symbol, `furnitureHeight` and the symbol
    picker each have an entry for each new symbol. A test walks `FURNITURE_SYMBOLS` (finding 17).

### C. Worktop (Sprint 54)

20. **Shape:** `symbol: "worktop"` with `pts: Pt[]` in plan cm, from 3 to 64 points, a simple polygon (no
    self-crossing). The writers keep `x`, `y`, `w` and `h` as the bounding box's centre and size, and `rot` at 0, so
    every reader that knows only the box (search, the align tools, hit-tests) still works. `pts` is the truth.
21. **Draw:** in 2D, the polygon is filled with `--fp-furniture` and a top edge, like the other pieces. In 2.5D and 3D
    it is a prism from the floor to its height, default 90 (in `heights.ts`). Its `color` overrides, as on other
    furniture. A sink or a hob stays a piece of its own, set on top.
22. **Editing:** a new worktop is drawn by clicking its points, as a room is (double-click or Enter ends, Esc cancels).
    A selected worktop shows vertex handles. Drag moves a point; a click on an edge adds one; Delete on a selected
    point removes it, never below 3. Moving the whole piece moves every point. Each gesture is one undo step, and none
    when nothing changed (finding 6). The room panel's polygon code is shared, not copied.
23. **Every writer tested over its inputs** (finding 12): a point drag, an add, a remove, a move and an undo. Each one
    is followed by `validate`, which must pass.

### D. Underfloor heating (Sprint 54)

24. **The flag:** `underfloor?: true` on a `climate` or `heater` device; `validate` refuses it on other types. The
    device panel shows it as "Underfloor" for those two types.
25. **The room** is the one whose polygon holds the icon, using the same rule that gives a device its room today. A
    flagged device outside any room has no cue.
26. **2D:** while `hvac_action` is `heating`, the room's floor gets a warm wash (`--fp-floor-heat`, a new variable with
    a value in every theme) and a faint serpentine pattern, the pipe run, in the same colour. Under the heat map the
    pattern stays and the wash gives way. Nothing moves.
27. **3D:** the room's floor colour is multiplied toward `--fp-floor-heat`. This is the path that warms a lit room's
    floor today (`view3d.ts`), so no second mechanism.
28. **Replay** shows it with no new code: the cue is a pure function of the drawn state.

### E. Car charging (Sprint 53)

29. **2D:** `.furn-car.charging` keeps its 3 px `--fp-dev-car` outline and gains a glow (a blurred copy of the body
    outline in `--fp-dev-car`). The glow breathes from 35 % to 80 % opacity over 2.4 s. Under reduced motion it holds
    at 60 %. Class rules, not attributes (finding 18), with a computed-style pair for each (finding 10).
30. **3D:** the car body's emissive goes toward `--fp-dev-car`, on the same 2.4 s breath, and holds still under
    reduced motion.
31. **Checked in both themes:** `npm run shots` shows a charging car in light and blueprint. The glow must read on both
    without washing out the bolt, checked at 4x (finding 16).

### F. Room badges (Sprint 55)

32. **Schema:** `room.badges?: { corner: "nw" | "ne" | "sw" | "se" }`. When it is present, the room shows its badges.
    It is a layout setting, not a config key. `room.power?: string[]` and `room.water?: string[]` hold at most
    `MAX_ROOM_SENSORS` entries each.
33. **The four icons**, left to right, each shown only when the room has a source for it:
    - lights: the room has a `light` device. The icon is lit while any of them is on.
    - climate: the room has a `climate`, `heater` or `ac` device. Orange while heating, blue while cooling, grey
      otherwise.
    - motion: the room has `motion` sensors, or `motion` or `radar` devices. Red while any of them is on.
    - energy: the room has `power` or `water` sensors. Lit while the room draws more than `plug_watts`.
    A table `BADGE_OF: Record<DeviceType, ...>` decides each device type, and a test walks `DEVICE_TYPES`
    (finding 17).
34. **Where:** in the chosen corner of the room's bounding box, inset 8 screen px. If that point is outside the room
    polygon (an L-shaped room), it slides along the diagonal toward the room's label point until it is inside. The
    icons stay upright and at screen size in a turned or zoomed plan, as device icons do.
35. **The tooltip,** one per icon. Its rows come from a core function, `badgeInfo`:
    - lights: "2 of 5 on" and the names of those on.
    - climate: the current temperature, the setpoint and the action ("Heating to 21 °C, now 19.5 °C").
    - motion: "Motion now", or the time since the last motion ("12 min ago").
    - energy: power summed in kW (two decimals) and water as its sensors report it (flow or today's total, in its own
      unit).
    A desktop shows the bubble on hover. On touch it opens on tap (decision 5).
36. **One draw path** (finding 8): `renderFloor` draws the badges, so the Studio's live view shows them (parity).
    The bubble is the card's, and the Studio's live view uses the same component.
37. **Editor:** the room panel gets "Badges" (off or a corner) and the Power and Water sensor lists, suggested from
    the room's HA area.
38. **Replay** draws the badges from the replayed states. In a replay, "last motion" counts back from replay time.

### G. Replay: always visible and the energy counters (Sprints 56 and 57)

39. **`replay: always`** (a card key; DECISIONS gives the reason under the freeze: it is per tablet, and no layout
    setting or existing key can carry it). The bar shows at "now", with no history fetched. Dragging the thumb back
    fetches the history and starts a replay. A "Live" button returns. After 5 minutes with no touch, the bar returns to
    live on its own. Any other value of `replay`, or none, keeps today's Replay button.
40. **The counters' chunk:** the counters live in a new lazy chunk, `floorplan-studio-energy-*.js`, with a limit of
    6,000 gzip. It loads when a replay opens in a house that has Energy preferences. The card keeps only the loader.
    The chunk imports nothing from the card.
41. **Data:** `energy/get_prefs` provides the sources. The counters read the grid's import, export and cost, solar
    production, gas with its cost, and water with its cost. Battery is not shown. Then one
    `recorder/statistics_during_period` call, with `period: "5minute"` and `types: ["change"]`, covers every stat in the
    window. Short-term statistics are kept for `purge_keep_days` (default 10), so a 7-day window fits; a gap reads as no
    data, never as zero.
42. **The counter at time t** is the sum of 5-minute changes from the window's start to t. The bucket that holds t is
    interpolated linearly, so the counter climbs smoothly while the replay plays.
43. **What each chip shows:**
    - Electricity: house use, computed as HA does: grid import + solar − export. Battery is ignored, and the tooltip
      says so.
    - Solar: production.
    - Gas and water: their use.
    - Cost: the source's `stat_cost` when it has one. Otherwise its fixed price × use. Otherwise its price entity's
      5-minute mean × use. With no price at all, the chip shows use only. For solar, the cost line is the export
      compensation. The currency is `hass.config.currency`.
44. **Chips:** one row at the top of the bar's left side. Each chip has an icon, its value and a sparkline (the rate up
    to t). A narrow card wraps the row to two lines. A chip appears only for a source the house has.
45. **Settings** (layout settings, made in the Studio): show or hide per chip, `use` / `cost` / `both` (default both),
    sparkline on or off (default on).
46. **The overlay chart:** a tap on a chip opens a see-through panel over the plan (`--fp-bg` at 75 %). It shows the
    chip's 5-minute bars for the whole window; bars after t are faded, and a line marks t. It is dragged by its header
    and kept inside the card. Its place is kept until the card reloads. A tap on another chip switches the chart; a tap
    on the same chip, or on its ×, closes it. One chart at a time.
47. **The device tree** (Sprint 57): the chart panel lists the devices that make up its source, from the Energy prefs'
    `device_consumption`. They are nested by `included_in_stat`, each with its use up to t. "Untracked" is the
    remainder. The car charger appears here once its sensor is in HA's device consumption (the car-energy work in its
    own session); nothing in this batch depends on it.
48. **Admin:** if `energy/get_prefs` is refused for a non-admin user, the chips do not show, and nothing else changes.
    This is checked on Diego's HA in the first task.

### H. 3D Studio (Sprints 58 to 61)

49. **Stage 1, the preview pane (Sprint 58):** a "3D" button in the Studio toolbar splits the canvas: 2D on the left,
    3D on the right, the divider draggable. The pane loads the card's 3D chunk, the same file, so the 3D views cannot
    differ. It is built from the editor's layout in memory and rebuilt 200 ms after the last edit, on the edited floor
    only. In the HA panel it shows live states (parity). The 2D selection is outlined in 3D, and the camera orbits as
    in the card. Read-only.
50. **Stage 2, pick and move (Sprint 59):** a click in 3D selects in both panes; the selection is one state.
    Furniture, devices and unlinked appliances drag on their floor plane (a ray onto `z = floor`), with the 2D grid
    snap. R rotates by 15°. Shift-drag changes a piece's or a device's `z` within its valid range. One undo step per
    drag; none when nothing moved. Every write goes through `EditorState`, as in 2D.
51. **Stage 3, structure (Sprints 60 and 61, outlined; re-planned after Stage 2's review):**
    - Points: wall ends, room points, worktop points and stair corners drag on the floor plane.
    - Heights: wall and room heights drag by their top edge; a door's or window's sill and head drag by its frame.
    - Floors: the floor height and slab drag at the edge.
    - Drawing new shapes stays in 2D unless that review says otherwise. The 3D pane draws only handles; the scene
      stays `scene-build`'s (the 3D form of finding 8).
52. **Bytes:** the editor only, for all stages. 0 on the card and 0 in the 3D chunk, apart from what the pane needs
    exported. That export goes through the chunk's existing deps object, never as an import of the editor.

## Schema (additive; v2 stays valid)

- `Furniture.symbol` gains `sofa-l`, `coffee-table`, `bookcase`, `buffet`, `worktop`.
- `Furniture.mirror?: true` (on `sofa-l` only). `Furniture.pts?: Pt[]` (on `worktop` only, and required there).
- `Device.underfloor?: true` (on `climate` and `heater` only).
- `Room.badges?: { corner }`, `Room.power?: string[]`, `Room.water?: string[]`.
- `Layout.energy?: { hide?: ("electricity" | "solar" | "gas" | "water")[]; show?: "use" | "cost" | "both"; spark?: boolean }`.

`validate` never throws (finding 1). It checks enums, finite numbers, array lengths, entity id shapes, the worktop's
point count and simple-polygon rule, and that each field sits on the type that may carry it. `migrate` copies none of
these fields from a shape it does not know. `npm run docs:schema` regenerates `docs/schema.md`.

## Acceptance criteria

1. Sprint 52 frees at least 4,000 bytes gzip on the card, with the full suite green. The popup opens within 300 ms
   of the tap at 4x CPU throttle, and the figure is in DECISIONS.
2. Each new symbol renders in 2D, 2.5D and 3D. A test walks `FURNITURE_SYMBOLS` against every per-symbol table and
   fails when one lacks an entry.
3. A mirrored `sofa-l` draws its chaise on the other side in 2D, in 2.5D and in the 3D scene. One test checks all
   three on asymmetric sizes (finding 4). `mirror` on another symbol fails `validate` with the piece's name.
4. A worktop of 3, 6 and 64 points draws in 2D and builds a prism at 90 cm in 3D. A self-crossing polygon, 2 points,
   65 points or a non-finite point fails `validate` and never throws.
5. Worktop editing: drag, add, remove (never below 3), move and undo are each one undo step, and the result passes
   `validate` (finding 12). The tests drive `page.mouse` on real handles (finding 3).
6. Underfloor: a flagged device whose `hvac_action` is `heating` tints and patterns its room in 2D and warms its floor
   in 3D. `idle`, `off`, `unavailable` and a missing attribute do not. The flag on a `light` fails `validate`.
   There is a computed-style pair for the wash.
7. Car: there is a computed-style pair for the glow, its animation runs, and under emulated reduced motion it does not.
   Shots of both themes are looked at, at 4x.
8. Badges: one test over every combination of corner, room shape (rectangle and L), each source present or absent,
   and on or off. Icons appear only for present sources. The bubble opens on hover (mouse) and on tap (touch, with
   each engine's event shapes, finding 22), and closes on a tap elsewhere and after 4 s. A tap on the room outside the
   badge opens the room. An escaped room name is tested with `"><script>` (finding 2).
9. `BADGE_OF` covers `DEVICE_TYPES`; a new type fails the test until decided.
10. `replay: always`: the bar shows at live with no history call. A drag back makes one fetch. Live returns, and so
    does 5 minutes idle on a fake clock. `surface-freeze.test.ts` lists the key, and DECISIONS gives the reason.
11. Counters: a stub copied from HA's own `energy/get_prefs` and `statistics_during_period` replies, with each source
    noted (finding 21), gives the expected kWh and cost at three replay times, including one inside a bucket. A source
    the house lacks shows no chip. A stat gap shows "no data".
12. Cost rules: one test each for `stat_cost`, a fixed price, a price entity and no price.
13. The overlay chart: opens from a chip, switches, closes, drags within the card bounds with `page.mouse`, and fades
    the bars after t. Tested in both themes.
14. The device tree nests by `included_in_stat`, and its untracked remainder is exact on a stub.
15. The energy chunk stays under 6,000 gzip and imports nothing from the card. The card gains only the loader.
16. 3D pane: opens, follows an edit within 500 ms, follows the selection, and costs the card 0 bytes.
    `size-budget.spec.ts` shows it.
17. 3D move: a drag in 3D moves the piece in 2D by the same cm (within 1 cm), as one undo step. No step when the
    pointer did not move.
18. Every new Playwright test passes `--repeat-each=10` (finding 13). `npm run shots` is run and looked at for every
    pixel task (finding 16).

## Sizes (estimates, gzip; each task measures and records the real figure)

| Feature | Card | Chunk |
|---|---|---|
| Sprint 52: lazy popup, dialogs, overview | −4,000 or more | new chunks |
| Furniture: 4 symbols, `mirror` | +900 | 3D +600 |
| Car glow and pulse | +120 | 3D +150 |
| Worktop: draw, schema | +350 | 3D +250; editor +3,000 |
| Underfloor: wash, pattern, flag | +250 | 3D +150 |
| Room badges: draw, info, bubble, schema | +1,800 | language chunks +300 each |
| `replay: always` and the energy loader | +300 | replay chunk +300 |
| Energy counters, chips, sparkline | 0 | energy chunk +3,500 |
| Overlay chart and device tree | 0 | energy chunk +2,000 |
| 3D Studio, stages 1 to 3 | 0 | editor only |
| **Total on the card** | **+3,720** | |

With Sprint 52's 4,000 freed, the card ends near 123,400 against the 124,650 cap. If Sprint 52 frees less, the order
of the feature sprints holds, and the first that does not fit stops and asks Diego.

## Non-goals

- Syncing HA's stock graph cards, or the Energy dashboard's date picker, to the replay (decision 11).
- A battery counter, and energy for single devices outside HA's Energy preferences.
- Drawing new walls or rooms in 3D (unless Stage 2's review asks for it).
- New themes or car models (surface freeze).
- Badges as a card key: they are per room, in the layout.

## Risks

- **Moving the popup out of the card** touches the most used path. A slow first open on a wall tablet is the risk;
  criterion 1 measures it.
- **`energy/get_prefs` for non-admins:** unknown until it is tried on Diego's HA (item 48).
- **Short-term statistics** stop at `purge_keep_days`. A house that keeps 3 days gets counters on 3 days of a 7-day
  window, shown as "no data" before that.
- **The 3D chunk in the Studio:** the standalone `editor.html` is one file; the HA panel can fetch the chunk by URL.
  Stage 1's first task proves both, or `editor.html` drops the pane.
- **3D editing** is a second way to change the same layout. Every write goes through `EditorState`, and Stage 2's
  review decides whether Stage 3 is worth its cost.
