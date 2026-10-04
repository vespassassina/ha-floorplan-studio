# Room sensors, room motion, room and device info

Status: built, 2026-10-04 (Sprint 11, S11.1 to S11.4; docs and review in S11.5).
The assumptions below held, with the final decisions listed at the end.

## Goal

Temperature, humidity and motion sensors belong to a room, the way contact
sensors belong to a door. The room shows its readings and lights up when
motion trips. Selecting a room in the card, or a device, shows what is known
about it in the card's existing left panel, and lets you act on it.

## Decided (Diego, 2026-10-04)

1. An attached sensor has no icon on the plan. The room shows its readout
   (temperature, humidity) as text under its name.
2. Motion: a red border that pulses three times when motion trips, then a
   steady red edge that fades as the sensor goes quiet. No endless blinking
   while a sensor stays on. Reduced motion: no pulse, edge only. (Pulse count
   decided by the coordinator on Diego's wording "a pulsing red border that
   fades out", 2026-10-04; open to his change.)
3. Room info goes in the left panel we already have (the Active list), not a
   new popup. It adds the room readouts and filters the entities to the room,
   rows you can act on.

## Assumptions (change any of them)

- A. Loose `temp`, `humidity` and `motion` devices keep working. Nothing is
  removed from an existing layout. The editor gains a button on such a device
  inside a room, "Attach to room", that moves it into the room and deletes the
  icon (one undo step).
- B. Tapping empty room floor in the card selects the room. A device tap keeps
  its meaning (toggle, hold = more-info). Tap off a room, or Escape, clears.
- C. Device info (manufacturer, model, firmware, area, entity id, state, last
  changed) appears when a device row in the left panel is expanded. It comes
  from `hass.devices`; a device with no registry entry shows entity and state.
  The plan's own device tap is not changed.
- D. Several sensors of one kind in a room: temperature and humidity show the
  mean, rounded to 0.1; the panel lists each. Any motion entity on means motion.
- E. The editor draws the same readouts and motion through `renderFloor`
  (CLAUDE.md finding 8). The left panel is card-only; the editor already has
  its own selection panel, so this is a stated difference, not a gap.

## Schema (additive, v2 stays valid)

`Room` gains optional `temps?: string[]`, `humidity?: string[]`,
`motion?: string[]` (entity ids, `sensor.*` / `binary_sensor.*`). `validate`
checks arrays, strings, entity-id shape, count caps; never throws (finding 1).
`migrate` ignores them.

## Acceptance criteria

1. A room with `motion: ["binary_sensor.x"]` draws the red perimeter and one
   three pulses when the entity turns on (a redraw does not replay them), in the card and the editor preview, 2D and
   2.5D; it fades after off like the icon fade does today.
2. A room with `temps` and `humidity` shows the means under its name; a missing
   or `unavailable` state shows nothing, never `NaN`.
3. The editor's room panel has three pickers listing only entities of the right
   kind; a pick is one undo step; the same pick again is none.
4. "Attach to room" moves a loose sensor into its room, one undo step, and the
   room readout then shows what the icon showed.
5. Tapping a room in the card opens the room section in the left panel with:
   name, area, temperature, humidity, motion, open doors and windows, lights on,
   and its devices as rows; light and switch rows toggle, others open more-info.
6. Expanding a device row shows manufacturer, model, firmware, area, entity id,
   state, last changed, with fallbacks when the registry has no entry.
7. A hostile layout (room with `motion: 5`, entity `"><script>`) neither
   throws nor injects (findings 1, 2).
8. Every new CSS rule has a `getComputedStyle` pair (finding 10); run
   `npm run shots` and look (finding 16).

## Non-goals

No new backend. No battery or signal rows. No change to the tap on a device.
No 3D.

## Final decisions (built, 2026-10-04)

Each is in `docs/DECISIONS.md` with its reasons.

- One rule for the room a point is in: `roomAt`, the smallest room of a kind that
  can own a point (room, garden, pavement, terrace, water; never zone, structure
  or fill). The aura clip, Attach to room, the readout, the Sensors section, the
  motion edge and the card's room summary all use it (assumption A).
- Motion: three pulses when a sensor trips, then the steady edge, fading after it
  goes off. A redraw does not replay the pulses; the ring carries its trip age.
  Decided by the coordinator on Diego's wording, open to his change.
- A mean reading takes only the readings in the first unit seen (assumption D).
- A tap picks the room under the finger, through its name, readout and furniture;
  a zone or structure is looked through; a double tap leaves the pick alone
  (assumption B). Enter on a toggling row decides like a tap.
- The room section is in the left panel and is labelled with the room's name
  (assumption C). Card only; the studio has its own selection panel (assumption E).
