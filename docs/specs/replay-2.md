# Replay 2: events, a longer window, jumps and filters

Status: approved by Diego, 2026-10-30, with the defaults of the open questions. Plan: `docs/PLAN.md`, Sprint 41, task S41.r. Builds on
`docs/specs/replay-s39.md` and `docs/specs/quick-wins-s40.md` section A.

## Why

The replay shows the past, but it does not say where in the past to look. A user scrubs 24 hours blind to find the
moment a door opened. Diego asked (2026-10-30) for event markers on the slider, a longer window, a jump to the next
event, filters, and more cues on the live plan that a replay could then show.

## Evidence (measured on Diego's Home Assistant, 2026-10-30)

Home Assistant 2026.10.4. Read-only websocket calls from the LXC; aggregates only. Three floors: 21, 93 and 134 entities
as the card asks them (`replayEntities`: devices, bound relays, doors, room sensors, the sun). Times are the median of
three calls; "wire" is the JSON deflated, which is what the browser receives: HA's aiohttp answers
`Sec-WebSocket-Extensions: permessage-deflate` (checked in the handshake).

**Retention.** `recorder/info` does not expose `purge_keep_days`, and no config entry holds it (the recorder is
configured in YAML). The oldest state row in the recorder was 10 days and 14 hours old, written minutes after the
04:12 purge's cut-off ten days earlier: `purge_keep_days` is the default, 10. The replay can never reach further than that.

**Today's call** (`history/history_during_period`, the flags of `historyRequest`: `include_start_time_state: true`,
`significant_changes_only: false`, `minimal_response: false`, `no_attributes: false`):

| Floor | Window | Rows | Server time | JSON | Wire |
|---|---|---|---|---|---|
| 134 entities | 24 h | 15,458 | 268 ms | 3.6 MiB | 298 KiB |
| 134 entities | 48 h | 30,530 | 400 ms | 7.1 MiB | 576 KiB |
| 134 entities | 7 d | 110,605 | 2,638 ms | 25.2 MiB | 2.0 MiB |
| 93 entities | 24 h | 23,825 | 233 ms | 3.6 MiB | 226 KiB |
| 93 entities | 7 d | 180,981 | 2,972 ms | 27.2 MiB | 1.6 MiB |
| 21 entities | 24 h | 10,667 | 99 ms | 1.6 MiB | 99 KiB |

Every row of this reply carries the full attributes (15,458 of 15,458): HA leaves `a` out of the later rows only
with `minimal_response`, and out of every row with `no_attributes`. The parser's carry-forward is right but never used today.

**What fills it.** On the 134-entity floor, cameras are 77 % of the bytes (2.8 of 3.6 MiB) with 6 state changes in
24 h: their attributes change every few minutes, and the card cannot draw a recorded camera picture anyway. On the
93-entity floor, one power sensor writes 13,001 rows a day (one every 6.6 s), 55 % of the rows.

**A leaner call.** Two calls per floor: (A) the domains whose changing attributes the card draws (`light`, `climate`,
`media_player`, `cover`, `fan`, `vacuum`, `water_heater`, `humidifier`) with today's flags; (B) every other entity with
`significant_changes_only: true, minimal_response: true`. In (B) the first row keeps `a` (unit, device class) and
later rows are `{ s, lu }` (observed: 92 first rows with `a`, 3,685 later rows without), which the S39 parser
already reads.

| Floor | Window | Rows | Server time (A + B) | JSON | Wire |
|---|---|---|---|---|---|
| 134 entities | 24 h | 4,730 | 70 ms | 434 KiB | 53 KiB |
| 134 entities | 48 h | 8,830 | 114 ms | 792 KiB | 91 KiB |
| 134 entities | 7 d | 32,725 | 407 ms | 2.8 MiB | 317 KiB |
| 93 entities | 24 h | 21,292 | 155 ms | 1.0 MiB | 185 KiB |
| 93 entities | 48 h | 37,778 | 231 ms | 1.8 MiB | 326 KiB |
| 93 entities | 7 d | 162,415 | 1,639 ms | 7.4 MiB | 1.3 MiB |

**Long-term statistics.** 20 of the 134 entities have statistics, all sensors with a mean (temperature, humidity,
power). None of the lights, binary sensors (motion, doors, windows), switches, locks or alarms have any: statistics
hold numbers, not events. Hourly statistics do reach past the purge (30 days asked, 30 days returned, 77 ms). Using
5-minute statistics for the mean sensors in place of their states saves bytes only where a sensor reports more often
than every 5 minutes: on the 93-entity floor 7 days fell to 60,353 rows, 409 ms, 543 KiB wire; on the 134-entity floor
it doubled the rows. So statistics cannot replay a floor past the purge, and a second parser for them pays only on
some homes.

**How many events.** State changes in 24 h, by what the device is on the plan:

| | 134-entity floor | 93-entity floor |
|---|---|---|
| Room motion sensors | 2,565 | 676 |
| Lights | 363 | 283 |
| Doors and windows with an entity | 111 | 38 |
| Locks, alarms, sirens | 4 | 0 |
| Room temperatures (not events) | 522 | 431 |

About 1,300 motion onsets a day on a slider 300 to 1,000 px wide: motion cannot be markers. Lamps, openings and alarms
can, clustered.

**Bytes today.** The card is 121,511 bytes gzip against a cap of 124,650 (3,139 left; DECISIONS 2026-10-30, the room is
for temperature warnings and the next card features). The replay chunk is 1,455 bytes gzip against its own limit of
1,500 (`REPLAY_CHUNK_LIMIT`, `tests/card/size-budget.spec.ts`). Anything new in the replay must go into the chunk, and
the chunk's limit must rise.

## Goal

1. The slider shows where things happened: lamps, motion, openings and alarms.
2. One key or tap jumps to the next or previous event, of the kinds and rooms the user picked.
3. The replay reaches 48 hours back, and 7 days if a browser can hold it.
4. The fetch costs a tenth of today's bytes, so the longer window is affordable.

## Non-goals

- Anything past the recorder's purge (10 days by default). Statistics have no events; see Evidence.
- Long-term statistics in the replay at all, in this spec. Revisit only if 7 days fails its gate (item 10).
- A date picker or a custom range. The window is one of three lengths, ending at the moment of opening.
- Busy rooms tinted on the plan, and motion trails on the live plan (see Live cues). Out-of-range values are Sprint 42's.
- A config key (surface freeze, S41.d). Window and filters are the bar's own, not saved.
- Person positions and vacuum trails (still S39's non-goal).
- The Studio. The replay stays card-only.

## Behaviour

### A. A leaner fetch

1. **Two calls per floor.** On open and on a floor switch, the replay sends (A) one `history/history_during_period`
   for the floor's entities in the attribute domains (`light`, `climate`, `media_player`, `cover`, `fan`, `vacuum`,
   `water_heater`, `humidifier`) with today's flags, and (B) one for all the others with
   `significant_changes_only: true, minimal_response: true, no_attributes: false`. Both start together; the floor is
   ready when both have answered; either failing fails the floor, as today. An empty list sends no call.
2. **Nothing on the plan changes.** At any moment the replayed states draw the same plan as with today's single call,
   except that attribute-only changes of (B) entities (a camera's timestamp) are gone, which the plan never drew.
3. **The request lives in the chunk.** `historyRequest` and the split move into the replay chunk; the card calls one
   function and awaits one index.

### B. Events

4. **What counts.** An event is an onset: the moment an entity enters a state worth finding. One table, per
   `DEVICE_TYPES` member and per door, decides it (finding 17):
   - **lamp**: `light` turns on.
   - **motion**: `motion` and `radar` turn on; a room's `motion` sensor turns on.
   - **opening**: `contact` turns on; a door or window with an entity turns open (`doorStateOf`); `cover` turns open
     or opening (`coverActive`); `lock` turns `unlocked` or `jammed`.
   - **alarm**: `alarm` turns `triggered`, or moves between disarmed and armed (`armed_*`); `siren` turns on;
     `vibration` turns on; `other` turns on as a leak or smoke sensor (attention's `hazard` rule).
   - **none**, with the reason that their changes are readings or routine, not things to look for: `heater`,
     `switch`, `plug`, `temp`, `humidity`, `camera`, `climate`, `ac`, `tv`, `computer`, `media`, `battery`,
     `inverter`, `server`, `access_point`, `boiler`, `car`, `ups`, `printer`, `speaker`, `person`, `vacuum`, `fan`.
   A row whose state is `unavailable` or `unknown` is never an onset, and the state after it is compared with the last
   known one, so a sensor dropping out and back is not an event. The start-time row is not an onset.
5. **Markers.** A strip 8 px high above the slider. Lamp, opening and alarm onsets are ticks in their group's colour
   (`--fp-dev-light`, `--fp-open-door`, `--fp-danger`). Motion is a band under the ticks: per bucket, its opacity
   follows the count of motion onsets, so a busy evening reads as a darker stretch.
6. **Clusters.** Ticks closer than 6 px merge into one, drawn in the colour of its highest group
   (alarm, then opening, then lamp), taller with more members (8, 12, 16 px for 1, 2 to 4, 5 or more). Its tooltip
   says what it holds, by group ("3 lamps, 1 door or window"). Clusters are recomputed when the bar's width changes.
7. **Tap a marker.** A tap or click on a tick or cluster moves the thumb to its first onset. The strip is not a
   second slider: a tap between ticks does nothing.
8. **Reading them.** The strip has `role="img"` and an accessible name with the totals ("12 lamps, 4 doors or
   windows, 1 alarm, motion in 9 rooms"). The jumps (C) are the keyboard way to the events.

### C. Jump to an event

9. **Previous and next.** Two buttons beside Play, "Previous event" and "Next event" (translated), and Shift+ArrowLeft,
   Shift+ArrowRight on the bar. Each moves the thumb to the nearest onset strictly before or after the moment on show,
   of the groups and rooms the filters allow; motion counts here. With none that way the button is disabled and the key
   does nothing. A jump pauses play. The value text announces the time and what happened ("21:14, door opened").

### D. A longer window

10. **The choice.** A small selector in the bar: 24 h, 48 h, 7 days. It opens at 24 h, every time (no config key).
    Choosing another length fetches the floor again for it (A) and keeps the moment on show if it lies inside; the
    end stays the moment the bar opened. Only the newest length's histories are kept.
11. **Keys and play.** Arrows move 5 minutes at 24 h, 10 at 48 h, 30 at 7 days; Page Up and Down move one hour at 24
    and 48 h, six hours at 7 days. Play keeps today's speed, 24 hours per minute, at every length.
12. **7 days has a gate.** 7 days ships only if, on a fixture of the measured worst floor (180,000 rows over 93
    entities, the shape of (A) + (B)), parse and index take under 1.5 s in Chromium at 4x CPU throttling on Diego's
    Mac, measured once and recorded, and the index adds under 60 MB to the heap. In CI the same test holds parse and
    index to a ratio of the S41.c `calibrate` workload, fixed from the Mac figure, never an absolute time: CI runs 3 to
    6x slower and absolute ceilings failed there by chance (S41.c). If not, the 7-day choice is left out and DECISIONS says so with the figures.
13. **Purge.** If the reply starts later than the window (the recorder had purged it), the strip greys the part with
    no history and the info line says from when history is kept.

### E. Filters

14. **By group and by room.** A filter button opens a small list: the four groups as toggles, and the floor's rooms
    with at least one onset in the window, by name. All are on when the bar opens. Filters change the strip and the
    jumps only; the plan is drawn as it was, whole (the Group menu already dims devices).
15. **Room of an event.** A device's room is the room it stands in (`roomAt`); a door's is both rooms it joins; a room
    sensor's is its room. An event with no room passes the room filter only when every room is on.

### F. Live cues the replay then shows

16. **Open doors and windows:** already drawn live (S9.1, dashed red, glass and openings) and in the replay, through the
    one draw path. Nothing to build.
17. **Recent motion:** already drawn live as the icon fade and the room's motion border (`fade`). The replay's motion
    band (item 5) is the trail over time. Nothing new on the live plan.
18. **A busy room:** deferred. Live, the card has no history to count from without a fetch on every load; in a replay
    it would need a render option and stylesheet in the card (card bytes). Next after this spec, if Diego wants it.
19. **A value out of its range:** Sprint 42's. To show in a replay for free, its spec must make "out of range" a
    function of the drawn state and the layout (and, for hysteresis, of the previous drawn frame's flag, reset on a
    seek), never of memory the card keeps from live updates. Its onset may later become an alarm-group event; not here.

### G. Bytes

20. **Where code goes.** Everything in A to E lives in the replay chunk, including the new bar CSS (a `<style>` the
    chunk renders inside the bar, colours only through `--fp-*`). The card keeps only what it must: the window length
    in `ReplayState`, the minutes of the slider, and passing the floor to the chunk. The chunk imports nothing of the card
    at runtime (bar.ts says why): `doorStateOf`, `coverActive`, `roomAt` and `MOTION_TYPES` are handed over by the card, as
    `BarTools` hands over lit today.
21. **Limits.** The replay chunk's limit rises from 1,500 to 6,000 bytes gzip (a DECISIONS entry in the first task).
    The card may grow by at most 600 bytes gzip for all of this spec; each task states its own figure.

## Acceptance criteria

Each is a test written first and seen failing (findings 4, 5). Stubbed replies are copied from HA's source and say
where: `homeassistant/components/history/websocket_api.py`, `homeassistant/components/recorder/history/modern.py`
(the minimal rows), `homeassistant/components/recorder/models/state.py` (finding 21). Playwright tests use
`page.mouse` and the keyboard on real elements (finding 3) and run with `--repeat-each=10` (finding 13).

1. The fetch: a floor with a light, a camera, a sensor and a contact sends exactly two calls with the flags of item 1,
   each entity in exactly one; a floor of only sensors sends one. (A1)
2. Equivalence: one fixture as a full reply and as the (A) + (B) pair, rows copied from the real shapes (first row
   `{s, a, lu}`, later `{s, lu}`): `stateAt` gives the same state and the same unit and device class for every entity
   at ten moments, and the lamp's colour at a moment between rows. (A2)
3. Either call failing shows the error line and keeps the plan live; a timeout on (B) alone does too. (A1)
4. The event table: a test iterates `DEVICE_TYPES` and fails on a member that is not in the table; for each group one
   entity's rows give the expected onsets; `unavailable` between two `on` rows gives one onset, not two; the start row
   gives none. Asymmetric times. (B4)
5. Clusters: ticks at 0, 5, 7 and 20 px give two clusters, the first of three; an alarm in a cluster of lamps colours
   it danger; at a wider bar the same events split. (B6)
6. A real click on a cluster moves the thumb to its first onset and the plan draws that moment (a door dashed). A
   click between ticks moves nothing. (B7)
7. Jumps: buttons and Shift+arrows reach the previous and next onset, skip filtered groups and rooms, are disabled at
   the ends, pause play, and the value text names the event. (C9)
8. The window: 48 h asks a 48-hour range; arrows and Page keys move by the item 11 steps; play covers 24 h of replay
   per 60 s of clock (half of 48 h after 60 s). Switching length keeps the moment on show. (D10, D11)
9. The gate: a generated fixture of 180,000 rows is parsed and indexed under the item 12 limits: once on Diego's Mac in
   Chromium with 4x CPU throttling, figures into DECISIONS, and in CI as a ratio to `calibrate` in a Playwright test,
   so the test fails on a 2x slowdown and not on a slow runner. (D12)
10. Purge: a reply that starts 12 hours into a 48-hour window greys that part of the strip; the info line says from
    when. (D13)
11. Filters: turning off "lamp" removes lamp ticks and lamp jumps; a room filter keeps a door between two rooms when
    either is on; the plan's computed styles are unchanged by any filter. (E14, E15)
12. Escaping: a room named `"><script>` in the filter list and the tooltip is text, not markup (finding 2).
13. Every new string is in all nine catalogues (ten languages with English); the raw-English lint passes.
14. Bytes: the card stays under its cap and within +600 of 121,511 for the whole spec; the replay chunk is under its new
    limit; the card does not contain the event table (a marker string only the chunk has). (G20, G21)
15. Shots: `npm run shots` gains the demo replayed with markers, a cluster's tooltip, the filter list and the 48 h bar,
    blueprint and light, 1280 and 380 wide. Looked at (finding 16).

## Sizes (estimates, gzip; each task measures and records the real figure)

| Feature | Card | Replay chunk | Note |
|---|---|---|---|
| A. Leaner fetch | 0 to +50 | +150 to +250 | the request moves into the chunk |
| B. Event table and onsets | 0 | +400 to +600 | |
| B. Markers, band, clusters, tap, CSS | +50 to +100 | +700 to +1,000 | CSS in the chunk (item 20) |
| C. Jumps | +30 to +80 | +200 to +300 | the card routes Shift+arrows |
| D. 48 h and 7 days | +150 to +300 | +300 to +450 | `DAY_MS` becomes the window |
| E. Filters | 0 to +50 | +500 to +800 | |
| Total | +230 to +580 | +2,250 to +3,400 | chunk from 1,455 to about 4,000 to 4,900 |
| Deferred: busy room | +250 to +450 | +200 | render option and stylesheet are card bytes |

New strings cost their bytes in the chunk that uses them, and in each language chunk (each under its 5,000 limit).

## Order of delivery

One task per row; each runs the full suite and the shots. A sprint of R2.1 to R2.4, then one of R2.5 to R2.7. Not before
Sprint 42 (temperature warnings), so the card's 3.1 KB serve it first.

| Task | What | Why this place |
|---|---|---|
| R2.1 | Leaner fetch (A), chunk limit raised, the request into the chunk | A tenth of the bytes today, and the longer window depends on it |
| R2.2 | The event table and onsets (B4), no UI | The model every later task reads; finding 17's test |
| R2.3 | Markers, motion band, clusters, tap (B5 to B8) | The value Diego asked for first |
| R2.4 | Jumps (C9) | Small once events exist |
| R2.5 | 48 h and the length selector (D10, D11, D13) | Cheap after R2.1: 91 to 326 KiB on the wire measured |
| R2.6 | Filters (E14, E15) | Useful only once there are many events |
| R2.7 | The 7-day gate (D12): measure, then ship or cut | Its cost is the open risk |

**What I would cut.** Statistics for ranges past the purge (no events in them). Live motion trails and live open-door
cues (both exist). Busy rooms for now (card bytes, and the motion band shows it). 7 days, if the gate fails.

## Open questions for Diego

1. Play speed at 48 h and 7 days: 24 hours per minute (7 days takes 7 minutes), or the whole window per minute?
   Default: 24 hours per minute; the jumps cover distance.
2. Alarm group: should arming and disarming be events, or only `triggered`? Default: both.
3. Lamp off as an event too? Default: no, onsets only; the plan shows how long it stayed on.
4. 7 days: worth the gate task, or 48 h only? Default: run the gate.
