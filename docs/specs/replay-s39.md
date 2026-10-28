# History replay: Sprint 39

Status: draft, 2026-10-28, waits for Diego's yes. Plan: `docs/PLAN.md`, Sprint 39.

## Why

Review of 2026-10-22, plan C item 14: "a slider that replays the last 24 hours from the recorder
(`history/history_during_period` over the plan's entities). Field report asked; nobody has it."

Diego, 2026-10-28: card only; a bar under the plan, opened from the menu; every device and room sensor on the shown
floor, in 2D and 3D; plan D one item per sprint, the card split in this sprint.

## Goal

From the card, scrub or play back the last 24 hours of the shown floor, drawn exactly as the live plan would have
been drawn at that moment.

## Non-goals

- The Studio. It has no live state; the replay is card-only on purpose (parity rule: an exception, stated).
- A config key (surface freeze, review item 17). The replay is in the menu of every card.
- More than 24 hours, a date picker, or the long-term statistics tables.
- Acting from the past: no tap acts while replaying.
- Vacuum trails and person positions (review item 12).

## Behaviour

1. **Open.** The card's ⋯ menu has "Replay" (translated). It is there when the card has `hass`, and absent in kiosk
   mode, in the Studio and in the standalone page. Choosing it opens the bar under the plan.
2. **The bar.** A range slider over the last 24 hours ending at the moment of opening, the time at the thumb
   (`HH:MM`, the user's locale, 24 or 12 hour as HA's own setting), play/pause, and "Live", which closes the bar.
   Keyboard: arrows move 5 minutes, Page Up/Down one hour, Home/End the ends, Space plays or pauses, Escape is Live.
   The slider has an accessible name and a value text with the time. Under 640 px the bar is one row with the time
   above the slider.
3. **Start.** The bar opens paused at the end (now), so the first frame is the live plan. Play from the end starts
   again from the beginning. Playing moves 24 hours in 60 seconds and stops at the end. Reduced motion changes
   nothing here; it is the user's own play.
4. **Fetch.** On open, and on a floor switch while open, one `history/history_during_period` websocket call for the
   shown floor's entities: every device entity (with `bound` switches and lamp-off rows), every room sensor (`temps`,
   `humidity`, `motion`), and the `sun` entity (config `sun`, default `sun.sun`). `start_time` 24 h before the open,
   `end_time` the open, `include_start_time_state: true`, `significant_changes_only: false`, `minimal_response: false`,
   `no_attributes: false`. While it loads the bar shows a busy state and the slider is disabled. A floor fetched once
   is kept until the bar closes.
5. **Reading the reply.** The reply is HA's compressed state form (`s`, `a`, `lu`, `lc`). The parser is untrusted
   input (finding 1): a non-object, a missing `s`, a non-finite time, an unsorted list or an entity not asked for is
   dropped, never thrown. `a` is carried forward: a row without `a` keeps the last attributes seen. `lc` missing means
   `lc = lu`.
6. **State at a time.** `stateAt(index, t)` gives, for each entity, the last row with `lu ≤ t` as a `HassEntity`
   (`state`, `attributes`, `last_changed` as ISO). An entity with no row at or before `t` (none in history, or excluded
   from the recorder) is absent, so it draws as an unknown entity does today. The bar's info button says how many
   entities on the floor have no history.
7. **One draw path.** While the bar is open, `_stateForRender()` returns the replayed states and every reader of
   time uses the replayed moment: motion fade, the 3D `now`, `_night()` with `night: auto`, and `_sun()`. Nothing else
   in render changes (finding 8). 2D and 3D both follow; switching view while replaying keeps the replayed moment.
8. **Live updates while replaying.** A `hass` update does not move the plan. The card keeps the newest `hass` and
   shows it on Live. The editor-style guard holds: zoom, floor, view and selection survive opening and closing.
9. **Taps.** While replaying, a tap on a device opens nothing and calls no service; the bar shows "Replaying"
   briefly instead. The ⋯ menu and floor switching still work.
10. **Errors.** A failed fetch (no recorder, a permission error, a timeout of 20 s) shows a translated line in the
    bar with the reason and keeps the plan live. Retry is closing and opening again.
11. **Cost.** The parser and `stateAt` live in a lazy chunk (`floorplan-studio-replay-<hash>.js`), loaded on the
    first Replay. `stateAt` is a binary search per entity. A frame is drawn at most once per animation frame, and only
    when the replayed states changed or the minute changed. The card's growth is reported in gzip bytes, under the cap.

## Acceptance criteria

Each is one test. Playwright tests drive the built card in Chromium, use `page.mouse` and the keyboard on the real
elements (finding 3), and run with `--repeat-each=10` before commit (finding 13). Stubbed replies are copied from the
HA source (`homeassistant/components/history/websocket_api.py`, `homeassistant/components/recorder/models/state.py`,
`COMPRESSED_STATE_*`), and the test says where (finding 21).

1. Parser: a reply of three entities, one with junk rows (`null`, `{}`, `lu: "x"`, `lu: NaN`, unsorted), gives the
   expected index; `__proto__` as an entity id and a 5 as a reply give an empty index; nothing throws.
2. `stateAt` at the first row, between rows, exactly on a row, before all rows and after the last; attributes carried
   forward; `lc` missing. Asymmetric values (finding 4).
3. The call: the stubbed websocket receives one `history/history_during_period` with the floor's entities, the sun,
   bound switches and room sensors, and the flags of item 4. A second floor triggers one more call; going back, none.
4. A light off at 08:00 and on from 08:00 to 10:00 in history: the thumb at 09:00 draws it lit in 2D, at 11:00 unlit,
   while the live state says the opposite.
5. The same in 3D: the lamp pool is there at 09:00 and not at 11:00.
6. Motion: a sensor on at 09:00:00, off at 09:01:00; the thumb at 09:03 shows the fade it would have shown at 09:03.
7. `night: auto` follows the replayed `sun.sun`: night at 03:00, day at 12:00, whatever the live sun says.
8. A `hass` update with a light change while replaying leaves the plan as it was; Live shows the new state, and zoom
   and floor are kept.
9. A tap on a device while replaying calls no service (the stub records none) and opens no popup.
10. Play from the end restarts from the start; 60 s of play covers 24 h within 2 s (fake clock); it stops at the end.
11. Keyboard: arrows, Page Up/Down, Home, End, Space, Escape, each with its effect.
12. A failed fetch: the error line shows, translated in German; the plan stays live.
13. No Replay item in kiosk mode, without `hass`, or in the Studio.
14. The card bytes stay under the cap, the replay chunk exists once in the release zip, and the card does not
    contain the parser's code (a marker string only the chunk has).
15. Shots: `npm run shots` gains the demo home replayed at two moments (morning, night), blueprint and light, and the
    bar at 1280 and 380 wide, looked at (finding 16).
