# Card polish and real light (Sprints 14 and 15)

Source: Diego's field requests after 0.15.0, 2026-10-06. Answers given: open doorway = alert only; confirm OFF = all
but lights; size budget raised (+20 KB card, +40 KB chunk over the 0.15.0 figures: card 95,076 -> 115,000 gz, chunk
193,707 -> 233,000 gz, to be written into `tests/card/size-budget.spec.ts` and DECISIONS).

## Sprint 14: interaction and polish (0.16.0)

| # | Request | What it means (assumption in italics) | Acceptance |
|---|---|---|---|
| 1 | Rename slit to slit window | Every label, menu entry and doc says "Slit window". *The stored kind stays `slit`: no layout break.* | No visible "Slit" alone in the editor or docs |
| 2 | Slit windows lower | Same distance from the ceiling as a normal window: head = wall height - 40 cm at the default (window 90 sill + 120 high under a 250 wall). *Per wall, like today.* Height stays 60. | Slit on 250 and 300 walls: head 210 and 260; explicit sill still wins |
| 3 | Tap opens a popup, never operates | A tap on an icon (2D and 3D) opens a small popup: the item name, its state, one button for the default operation ("Turn on", "Turn off", "Open", ...), and "More info". The operation runs only from the button. Hold keeps more-info. *Doors with a cover keep their confirm dialog; no-toggle types (sensors) show name and state and a More info button only.* | No service call on a tap alone; one on the button; Escape or outside tap closes |
| 4 | Hover shows the name | A name tooltip on pointer hover (2D and 3D, mouse only; touch has the popup). | Tooltip text = device name, in both views |
| 5 | Confirm before OFF | Turning OFF asks first for every device except lights (plugs, switches, AC, heaters, TV, speakers, media, fans, sirens, pumps). ON is immediate. Applies to the popup button and to anything else that toggles. *Locks and covers keep today's behaviour.* | OFF of each such type shows a confirm; ON does not; a light's OFF does not |
| 6 | Sirens louder | A siren's alert animation is larger than other devices' (about 2x radius, stronger pulse), reduced-motion still steady. | Computed size ratio test |
| 7 | Size of halo and waves | A per-device size multiplier (editor field, 25-300 %, default 100) for the light halo, speaker waves, siren/alarm waves and other effect rings; each type keeps its own base size; stored optional on the device, 2D and 3D. | Field in the editor; 2D and 3D scale with it; absent field = today's pixels |
| 8 | Remember view per floor | The card remembers zoom, pan and rotation (2D) and the 3D camera (azimuth, polar, distance, target) per floor, per viewer (browser storage, wrapped in try/catch), restored on load and floor switch; Reset clears the floor's memory. | Switch floor away and back: same view; reload: same view |
| 9 | Open doorway alert | `open` kind when its sensor trips: a solid alert-colour band across the gap, no dash, no pulse, no door look. Closed: nothing. 2D, 2.5D and 3D. | Computed-style pair; 3D shows the band |
| 10 | Icons and lights lower in 3D | New lower mount-height presets (`DEVICE_Z`): ceiling devices 250 -> 215, high wall fittings lower by about 20-30 cm; the icon anchor sits at the device. The editor's "mount height" field already sets a per-device height; keep it, and show the preset as its placeholder. | Presets changed and pinned; iteration test over every type |
| 11 | Low walls less low; cutaway higher | The "low" height rises (about 60 -> 110 cm; value fixed by a look at renders), and the cutaway's lowered walls use the same figure. | One constant; pixel test on wall top in cut and low |
| 12 | Active and Room menus by category, collapsible | The Active list and the room panel group by category (lights, climate, security, media, ...), categories in a fixed order, each collapsible, state remembered per viewer. | Click header toggles; order test over the union |

## Sprint 15: light (0.17.0)

| # | Request | What it means | Acceptance |
|---|---|---|---|
| 13 | Light cast by the device itself | A lit light's glow comes from its own position and mount height, not the room's centre or a room-level pool. | Move the device: the light moves with it |
| 14 | Light passes windows, glass doors, open passages | Light is computed by plain maths in core: for each light a visibility polygon on the floor plan against the walls, where windows, glass doors, slit windows and `open` doors are gaps (a closed solid door blocks; an open door passes). The result paints floor and wall light maps (a few ms, redone only when a light or door state changes). | A lamp next to a window lights the floor outside it; a closed solid door blocks it; asymmetric test with two rooms and one gap |
| 15 | Daylight | Sun light enters through windows, glass doors, slit windows and open passages. Driven by the HA `sun.sun` entity (elevation, azimuth) when the card has it, else off; a card option `daylight: auto/on/off` and an intensity. The same visibility maths with a parallel source: patches of light on the floor and walls inside. Sky colour and brightness follow the elevation; night = none. | Noon sun shows window patches on the floor; sun below horizon shows none; option off hides it |
| 16 | 2D | Light through windows is a 3D feature. *2D keeps its aura. Stated exception to card/studio parity: the editor has no 3D view.* | - |

## Suggestions (not in scope until Diego picks)

1. Tooltip and popup show live values (temperature, power, brightness) next to the name.
2. Brightness and colour slider for lights inside the popup.
3. A "scene" button: one tap sets a room's lights (all off, evening) from the Room menu.
4. Per-room lights summary in the Room menu: "3 of 5 on", with a master switch (confirm OFF).
5. Door and window state in 3D: open leaf swung, window sash open; open doorways in 3D get the alert band (item 9).
6. Keyboard: arrow keys move between icons, Enter opens the popup (accessibility).
7. A 3D "reset view" and "top view" button; double tap a room to frame it.
8. Night/day follow the sun entity for the whole card (already `auto`), plus a warm indoor evening tint.
9. Shadows of furniture on the floor (cheap blob shadows), so a lit room reads as lit.
10. Energy view: colour plugs by power draw.

## Non-goals

Shadow maps and a shadow engine; light through closed solid doors; light bouncing; a 3D editor.

## Risks

- Light visibility cost on big layouts: cap lights (8) and the wall edges considered; fall back to the old glow above the cap.
- A tap-popup changes muscle memory on wall tablets: the popup button is large (44 px) and the default op is one tap away.
- Size: the raised budget is spent mostly by items 3, 7, 12 (card) and 14, 15 (chunk).
