# Temperature range warnings (Sprint 42)

Status: approved by Diego, 2026-10-31, with its defaults. Decisions 1 to 4 are his answers; 5 to 15 are the defaults he approved.

## Goal

A room that is too cold or too hot shows it on the plan and in Attention, so a window left open in winter or a
server room running hot is seen without reading numbers. From the 2026-10-29 field report.

## Decided (Diego, 2026-10-31)

1. **Where the range lives:** one house range in the layout; a room may override it. No card YAML key, so the
   surface freeze (`docs/WORKFLOW.md`) holds.
2. **Hysteresis:** a 0.5 °C band, and a hold time: the reading must stay out for `hold` minutes before the room
   warns. `hold` is a layout setting, default 5 minutes; 0 warns at once.
3. **On the plan:** the room gets a tint, cold or hot, and Attention lists it.
4. **Bytes:** at most 1,000 gzip bytes on the card file, of the 3,015 left under the 124,650 cap.

## Defaults (change any of them)

5. **The reading** is the one the heat map uses: `roomHeat(f, i, "temperature", state)`, the mean of the room's
   `temps`, else of the temp devices standing in it; °F is converted to °C, junk and out-of-scale values drop out. A
   room with no reading never warns. One rule, so the readout, the heat map and the warning cannot disagree.
6. **The comparison is in °C.** The range is stored in °C. The tint and Attention show the reading in the sensors'
   own unit (`roomHeat`'s `text`) and the bound converted to it, rounded to 0.5.
7. **The band:** a room goes out when its reading is under `min` or over `max`, and comes back in only at
   `min + 0.5` or `max - 0.5`. The band is fixed, not a setting.
8. **The hold:** the room warns once it has been out, without a break, for `hold` minutes. Coming back in clears the
   warning at once (no hold on the way back). On the live card the onset is kept in the card's memory, so after a page
   load a room already out waits the hold again. The cheaper choice over a history call on every load; an alternative
   is to fetch the room sensors' last `hold` minutes once, if Diego wants it.
9. **A room override** replaces the house range whole. `tempRange: {}` on a room means it never warns (a garden,
   a sauna, a freezer room). A room with no `tempRange` uses the house range; with no house range, nothing warns.
10. **Room kinds:** only kinds `ROOM_OWNS` lets read temperature (as the heat map); a fill, structure or zone never warns.
11. **The tint:** `--fp-cold` and `--fp-hot`, new theme variables with values in every theme (finding 9), a wash at
    low opacity over the room's fill. Under the heat map (`heat_map: temperature`) the room is already coloured by its
    reading, so the tint gives way to a 2 px solid border in the same colour. Not the motion border: that is red and
    pulses; this one is steady. Reduced motion changes nothing; nothing here moves.
12. **Attention:** two kinds, `too-hot` and `too-cold`, after `smoke` and before `battery-low`. The line reads
    "Kitchen 27.4 °C, above 26" and "Bedroom 15.5 °C, below 17"; the row taps to the room. In all ten languages.
13. **One draw path** (finding 8): `renderFloor` draws the tint from a new `StateOverlay` field, so the studio's live
    view shows it too (studio and card parity).
14. **Replay** (replay 2, item 19): the flag is a pure function of the drawn state, the layout, and the previous
    frame's flag and onset. The replay passes them frame to frame and resets on a seek by reading the series from the
    window's start. So Sprints 43 and 44 show the warning in a replay with no new code in the card.
15. **The editor:** the house range and `hold` sit in the layout settings; a room's panel has "Use house range",
    min and max. Shown in the user's unit (HA's `unit_system`), stored in °C.

## Schema (additive, v2 stays valid)

- `Layout.tempRange?: { min?: number; max?: number; hold?: number }`: °C, °C, minutes.
- `Room.tempRange?: { min?: number; max?: number }`: °C; `{}` turns warnings off for the room.

`validate` (finding 1): an object, never an array; `min` and `max` finite numbers in -50..100 °C; when both are set,
`max - min >= 1` (twice the band, else a reading could be in and out at once); `hold` an integer 0..120. Junk is an
error with the room's name in it, never a throw. `migrate` copies neither shape it does not know.

## Acceptance criteria

1. A test over every combination (finding 12) of: house range set or not, room override absent, `{}` or set, `min`
   only, `max` only, both; reading under, on, inside, over, missing, °F; previous flag in or out; held or not. Each
   gives the flag and the onset the defaults above say.
2. On a bound: a reading that crosses `max` and sits at `max - 0.2` stays out; at `max - 0.5` it comes in. Asymmetric
   values (finding 4): `min` 17, `max` 26.
3. The hold: out for 4 min 59 s does not warn; 5 min warns; a reading back in for one sample resets the onset.
   `hold: 0` warns on the first sample. The clock is faked, and spies are restored before the clock (finding 15).
4. `validate` refuses each junk shape (array, string, NaN, `min` above `max`, a gap under 1, `hold` 2.5 or 500,
   `__proto__` as a key) with a message, and never throws.
5. The tint: a computed-style pair per rule (finding 10), cold and hot, with and without the heat map, in a light and a
   dark theme. A test iterates `THEMES` and fails for a theme with no `--fp-cold` or `--fp-hot` (finding 17).
6. Attention: a test iterates `ATTENTION_KINDS` and pins the order; the line text in English and one other language;
   the Attention row taps to the room.
7. `npm run shots` with a cold and a hot room in the demo, both themes, with and without the heat map, and looked at
   (finding 16).
8. The editor: setting the house range and a room override is one undo step each; a room's "Use house range" removes
   its override; values typed in °F are stored in °C.
9. The card file grows by at most 1,000 bytes gzip, measured in DECISIONS; `size-budget.spec.ts`'s limit moves by the
   measured figure only.

## Non-goals

- Humidity ranges. The same shape could carry them later; not asked for.
- A notification or an HA event when a room goes out. The card shows; HA automations alert.
- A range per placed temp sensor. A sensor counts toward its room's mean (default 5).
- A schedule (night and day ranges).

## Tasks (Sprint 42)

- S42.1 Core: schema, `validate`, `migrate`, and a pure `tempWarn(room, layout, reading, prev, now)` with the full
  combination test (criteria 1 to 4).
- S42.2 Render: the `StateOverlay` field, the tint and the heat-map border, `--fp-cold` and `--fp-hot` in every theme,
  CSS pairs, demo rooms, shots (criteria 5 and 7).
- S42.3 Attention: the two kinds, the lines in ten languages, the tap (criterion 6).
- S42.4 The card: the onset memory, passing the flag to the plan and Attention; the studio's live view the same.
  `roomHeat` gains `c`, the mean in °C, which `tempWarn` takes (S42.1 left the °F conversion to the caller: `roomHeat`
  returned only `text` and `t`).
- S42.5 The editor: house range, hold and the room override, °F in and out (criterion 8).
- S42.6 Bytes measured, DECISIONS, README; then the Opus review of the sprint.

S42.1 first; S42.2, S42.3 and S42.5 can run in parallel after it; S42.4 needs S42.1 to S42.3.
