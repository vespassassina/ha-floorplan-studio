# Changelog

## Unreleased

- Card: floor textures in 3D. A room or stair with a texture shows it on its floor, at the same size, turn and scale as in 2D; the flat colour shows until the tile is ready. A bad texture id or rotation falls back to the flat colour.
- Card: a lit lamp now lights the walls of its own room in 3D, a soft glow in the lamp's colour out to about 3 m, only on faces that look at it and only up to the height the wall is drawn at.
- Card: 3D shows one floor at a time. The dimmed stack of lower floors is gone (on a real layout the floors drifted out of line); the camera frames the floor you picked.
- Card: 3D icons no longer float over the house. A device's icon and its ball stay at most 10 cm under the top of the floor's walls (a ceiling light or camera at 250 cm on a 250 cm floor now sits at 240); a low device, a socket say, keeps its own height.
- Card: panning is back in 3D. Drag with the **middle mouse button**, or hold **Space** and drag with the left button (while the pointer is over the view; Space no longer scrolls the page there). Right-drag, Shift-drag and two fingers still pan; a plain drag still turns the house. A pan is never a tap.

## 0.14.0 - 2026-10-05

- Card: 3D now recovers. A failed load of the 3D code is tried again the next time you pick 3D; a lost graphics context (a driver reset, a tab left in the background) is waited for three seconds, and if it does not come back the card shows 2D and tries 3D once more when the tab is shown again or the card is placed again. A frame that cannot be drawn gives the 2D plan and one line, never a blank canvas.
- Card: a house no longer shrinks at phone width in 3D: a folded Active list takes no room from it.
- Layout: a coordinate further than 10 000 000 cm (100 km) from the origin is refused with a readable message, in the card and in the editor.
- Card: **3D view** (`view: 3d`, or 3D in the View dropdown). The floor as a model with real wall thickness and height, floors, doors, windows, stairs, furniture and device bodies, in the theme's colours. Drag turns it, wheel or pinch zooms, right-drag or two fingers pan, and you cannot go under the floor. No WebGL, a lost graphics context or a failed load show the 2D plan and one line why. Tilt is hidden in 3D; 2D and 2.5D are unchanged.
- Card: **live state in 3D**. A lit lamp lights its own room (floor, furniture, walls) and gets a pool of light, for the 8 lamps nearest the middle of the house; night darkens the rest. Doors swing open about their hinge, a window's pane goes when it opens, a playing speaker lights its drivers, a TV that is on lights its screen, a heating radiator turns heater-coloured, and a room with motion gets a red edge that pulses three times, holds and fades as in 2D. Room names, readouts and device icons are an HTML layer over the model; icons tap like in 2D, labels behind a wall hide. Updates change the scene in place. The Labels and Names buttons now show in 3D.
- Card: **Walls in 3D** (the same select and `walls` key as 2.5D). `cut`, the default, lowers the walls that face the camera to 30 cm so the rooms show and keeps the far ones tall; `low` lowers all, `full` none. Which walls drop follows the camera as you turn the house, with a margin so none flickers.
- Card: **taps in 3D**. Tap a device to toggle it (cameras, media and the other no-toggle types open more-info), hold for more-info, tap a door, window or stair as in 2D. Tap a room's floor to pick it: dashed outline, room panel, Active list cut to the room; tap it again, tap off or press Escape to clear. A drag, a double tap or the wheel never picks. Devices without a body show as small balls.
- Card: the 3D camera frames the house in the part of the view the Active list leaves free.
- Card: 3D wall corners and T-joints are closed; a partition no longer ends short of the outer face and leaves a dark sliver at a door gap.
- Card: **floors in 3D**. The floor you picked is solid; the floors under it stand dimmed beneath it at their real height (no lights, no icons, not tappable), and the floors above are not drawn. Switching floors keeps the angle you were looking from and frames the new floor. A lamp downstairs never lights a room upstairs.
- Card: the 3D view draws only when something changes: a still model, a settled pulse and an unchanged Home Assistant update draw nothing. The card shows the 2D plan instead of failing on a layout it cannot draw. On a wall tablet or any device without a good GPU, 2.5D is the fast view.
- Card: the 3D code is a second file, `floorplan-studio-3d-<hash>.js` (about 186 KB gzipped), loaded only when 3D is first picked; the card file itself grew by about 3.5 KB gzipped. The HACS download and the release zip include it; a manual install must copy `www/` whole.
- Dependency: three.js (MIT), bundled into that chunk, never fetched at runtime.
- Editor: 2.5D preview removed (Plan view, Tilt, Walls and the preview note); the editor draws and edits flat only. A stored 2.5D view opens flat. The card still has 2D, 2.5D and, soon, 3D.

## 0.13.0 - 2026-10-04

- Card: tap a room to pick it (its floor, its name, its readout or its furniture). It gets a dashed outline and the left panel opens with a room section: name, area (m², from the room's own corners), temperature and humidity (the same mean the plan shows), motion with when it changed, the open doors and windows on its walls, the lights on, and its devices and own sensors as rows. A light, switch, plug or cover row toggles on a tap and opens more-info on a hold; every other row opens more-info. The Active list below is cut to the room's entities, with a Show all button. Tap the room again, tap off any room, press Escape or press the cross to clear. A device, door or stair tap never picks a room, and a double tap (zoom) leaves the pick as it was. Enter or Space on a light row that names more than one entity opens the chooser, as a tap does. The panel is labelled with the room name.
- Card: a chevron on every row of the panel, in the room section and in the Active list, opens that device's details: manufacturer, model, firmware, area, entity id, state and last changed, read from Home Assistant's device registry. A device with no registry entry shows entity, state and last changed.
- Core: a room can own temperature, humidity and motion sensors (`temps`, `humidity`, `motion`). Their icons are not drawn on the card (the editor still shows them), the room shows the mean reading under its name, and a room with motion draws a red border that pulses three times when a sensor trips, holds steady while it is on, and fades after it (no endless blinking; reduced motion keeps the steady edge only).
- Editor: a room's panel has a Sensors section with three pickers (temperature, humidity, motion), built like a door's contact sensors. Each lists only entities of its kind and none another room already owns. A pick is one undo step and takes the sensor's loose icon off the plan; Remove only detaches. A loose temperature, humidity or motion icon inside a room gets an **Attach to room** button: one undo step moves its entity onto the room and deletes the icon. Outside a room, with no entity, or already on the room, the button is disabled and says why. A sensor that is on a room and still has an icon says "Attached to <room>". Sensors on a room's list no longer show up in Add as unplaced.
- 2.5D: a radiator (heater bar) is a box under the window, a speaker or media player is a small cabinet with two drivers, and a TV is a flat panel against the nearest wall with its screen lit when on. The icons stay the tap targets, and a speaker's icon sits on top of its cabinet (30 cm) unless the device sets its own `z`. 2D is unchanged.
- A lit lamp's glow is clipped to the room it hangs in. It no longer washes through a wall into the next room. A lamp in no room (a garden lamp) keeps the free circle, and a zone, a structure or a fill does not count as a room. In 2.5D the clip is lifted with the lamp. The camera cone is unchanged.

## 0.12.26

- Card: the zoom, Fit, rotate and Reset view buttons are one vertical stack under the toolbar, as in the studio. The toolbar keeps View, Tilt, Walls, Theme, Labels and Device names, so the rotate buttons no longer get lost among them. Same conditions as before (`zoom`, `view_switch`, `rotate_switch`, `kiosk`). The Active list moves below the stack if they would meet, and on a card too short for the column the stack becomes a row.

## 0.12.25

- 2.5D walls read as solids. Each face is lit by which way it looks on screen (lit, plain, dim) with a darker foot and a thin lit top edge, and the cap on top is thinner than the flat wall (12 cm external, 7 cm inner, scaling with the tilt). Tilt 0 and 2D are unchanged. The default `walls` stays `cut`: `full` hides 137 cm (tilt 0.5) to 275 cm (tilt 1) of floor behind a front wall.
- An open door or window is red in 2.5D too, on the face and the frame, in the card and the editor preview. A lock left unlocked or a vibrating door reads the same. Closed, unavailable or without a sensor it is not red. A cover left open on a plain door keeps its orange.
- A closed door is a painted leaf (`--fp-door`) in 2.5D, in internal walls as well as outer ones; open, it is a red frame.
- A cover left open on a plain door is red too in 2.5D and 2D, like a contact door. It was orange.
- Motion border: it fades with the sensor icon (a sensor that just went off keeps a fading border while its icon is still red), counts a wall-mounted sensor for the nearest room, and the innermost room wins. Radar is a motion type everywhere: perimeter, Active list. One `MOTION_TYPES` list.

## 0.12.24

- README: three photos of a real card in 2.5D (Home Assistant, Cyberpunk and Space themes), room and device names blurred.

## 0.12.23

- 2.5D: a ceiling light, camera or other high mount is drawn where it hangs, not on the floor. The icon rises with the walls, and so do its light radius, camera cone, motion and speaker rings, name and value. The small pin now stays on the floor, joined to the icon by the stem. Tap the lifted icon. Persons, heater bars, devices under 100 cm, radar target dots and all of 2D are unchanged.
- Card: the two rotate buttons and the Left/Right keys are their own control now. `view_switch: false` used to hide them along with the View dropdown while the zoom buttons stayed; they now show on every card that draws zoom or the View controls, in 2D and 2.5D. New `rotate_switch` key (`false` hides them and the keys, `true` shows them under `kiosk` too) and a Rotate buttons field in the Edit-card form.
- Card keys: one click on the card and the keys keep working with the pointer moved away. Inside Home Assistant's shadow roots the card never looked focused to the page, so only the hover worked. The pointer resting over a card that has just appeared counts as hovering.
- Card: the studio's Names toggle. A Device names button (`Aa`) beside Labels, config key `names`, a field in the Edit-card form; remembered per browser and cleared by Reset view.
- The card prints its version in the browser console (`Floorplan Studio card 0.12.22`), and warns when another script already owns `<floorplan-studio-card>`, the way an older copy kept as a manual dashboard resource would, so a dashboard that does not show a new feature can be diagnosed.
- Card toolbar: on a card narrower than the toolbar, with the floor chips showing, the chips covered the first controls (the View select, the Tilt slider) and a click landed on a chip. The toolbar now moves below the chips when it would reach them, and the Active list below the toolbar. The zoom + and − wrap as one pair, like the rotate pair.
- docs/card.md "Studio and card": every studio View control against the card, with a test that fails when the editor gets a view control nobody decided about.

## 0.12.22

- 2.5D stairs going down read as stairs. The well draws its treads as steps, each lower one darker, risers in shadow, clipped to the footprint. Everything below the floor (ground, walls, treads) is now drawn before any wall, and the hole's border on top, so nothing overlaps. 2D is unchanged.
- A cover is active only when it is a garage door, a gate or a door: HA `device_class` `garage`, `gate` or `door`, while open, opening or closing. Curtains, blinds, shades, shutters, awnings, windows, dampers and a cover with no class stay idle grey and off the Active list. Replaces 0.12.20's "every cover is idle".

- 2.5D: one straight wall is one height. A wall made of several edges (rooms side by side along one line, a vertex in the middle of a wall) was cut per edge, so part of it could stand tall and part low. It now takes the largest cut of its pieces.
- New `walls` option for the 2.5D view: `full` (every wall at its real height), `cut` (the default, as before) or `low` (every wall at the cutaway height). Card config key `walls`, a Walls select next to the Tilt slider (2.5D only), a field in the Edit-card form, and View > Walls in the editor. Both remember the pick per browser; Reset view returns the card to its config.
- Editor: Rotate view left and right, next to the zoom buttons. 45 degrees a press, animated (none under `prefers-reduced-motion`), added on top of the plan's own Rotate. This is how you look at the plan: it is never written to the layout and never an undo step.
- Keyboard, editor and card. Up and Down arrows zoom, Left and Right turn the view 45 degrees, Space shows the whole floor again and turns the plan upright. They do nothing while you type in a box, a menu list or a text field, and Space still presses a focused button. In the card only the card you hover or have focused listens. Alt+arrows always work.
- Cmd/Ctrl+S saves in the editor, from anywhere, a text box included. It is the Save button: same checks, same message. An empty plan says there is nothing to save.
- The editor keeps its view across reloads: zoom and centre per floor, the turn, 2D or 2.5D, tilt, the names toggle and the floor on show (theme, grid, measure and night already were). Saved 150 ms after you touch them, and when the tab is hidden or closed. Reset view (the 0 button or Space) clears the zoom and turn.
- The card now remembers the floor you were on, saves 150 ms after a touch (was 400 ms) and again when the tab is hidden. A reload no longer drops you back on the first floor, and a change made just before closing the tab is no longer lost.
- Help gains a step for the view keys, and the Save step names Cmd/Ctrl+S.

## 0.12.21

- Plugs are active only while they draw power, not while they are merely switched on: from 2 W (card config `plug_watts`, also in the Edit-card form). A plug idling at 0.4 W draws grey. The Active list, the tooltip (`plug: TV plug, 14 W`) and a room that shows a plug's switch follow the same rule.
- New optional `power` on a plug: the `sensor.*` (device class `power`) that measures it. The editor writes it when you place a plug whose HA device has exactly one power sensor, and the plug panel has a Power sensor picker. A plug with no `power` is linked at runtime by the card from the same rule, if Home Assistant gives it the entity registry. W and kW are read; another unit, an unavailable sensor or no sensor at all leaves a switched-on plug on, as before.
- 2.5D walls keep their height. A garden, pavement, terrace, fill, water, structure or zone behind the house no longer cuts its back walls down: only a room (a floor you stand on) behind a wall lowers it. Before, a lawn round the house flattened every back wall while the side walls stayed tall.
- The cutaway eases in instead of snapping. A wall seen side-on keeps its height, one facing you is lowered to the cutaway, and in between it blends over about 8 degrees of turn, so the walls no longer pop while the plan rotates. Free walls follow the same rule.
- Stairs have a direction: up, down or both. A Direction select in the editor (Auto, Up, Down, Up and down). Auto is up, but down on the top floor, so the top floor of a two-floor house no longer shows stairs going up. 2D adds a chevron arrow (none for up, so existing plans draw as before); 2.5D draws a down flight as a stairwell and a both flight as the rise with a low kerb. Schema stays v2; `direction` is optional.

## 0.12.20

- Place popup, Add and the room menu: a device with several motion, occupancy or presence sensors now offers each one as its own row (before, only its main entity showed, so extra zones were missing). A `group` whose members are all motion sensors is typed motion and offered; mixed or empty groups stay out.
- Motion perimeter. A room with a motion sensor or radar that is on gets one thin solid line just inside its walls, in the sensor's colour, for as long as it is on. 2D and 2.5D, every theme.
- Covers (curtains, blinds, shutters, garage doors) draw idle when open, not orange, and are no longer on the Active list. Door lines are unchanged.

## 0.12.19

- Rotate. Two toolbar buttons turn the plan 45 degrees a press, left or right, animated (about 0.35 s a step, none under `prefers-reduced-motion`; pan, zoom and taps wait until it settles). Names and icons stay upright. Config `rotation` (0 to 315, rounded to a step) sets the start; the Edit-card form has it.
- View memory. The card remembers, per browser, zoom, focus point, rotation, 2D or 2.5D, tilt, theme and the names toggle, and restores them before the first draw. A remembered value wins over the config until the config changes (then the card starts clean). Reading is defensive: a bad field is dropped, blocked storage just forgets.
- New toolbar controls: Theme dropdown, names toggle, rotate left and right, and Reset view (back to the config, memory cleared, floor kept). On a pinned card the Fit button is now called Home view, so it is not mistaken for Reset view.
- Shots and doc images gain rotated cards (45, 90) and narrow ones.

## 0.12.18

- A room drawn inside a bigger one now paints after it, whatever the array order, so a garden house no longer sits under its garden. Rooms that are not nested keep their order; zones still paint last.

## 0.12.17

- 2.5D: a wall that faces north is now cut to the cutaway when its lift would cover another room or zone (the Hall's north wall over the Living room, the Office's over the Bedroom and Bathroom). Before, only walls facing south and edges shared with them were cut, so these hid the rooms behind them, badly at tilt 1. A back wall with nothing behind it stays full. 2D output is unchanged; the default 2.5D picture changes.
- Tilt. The 2.5D view can look down more or less steeply: a Tilt slider beside the card's View dropdown (only in 2.5D), config `tilt` from `0` (top-down, no lift) to `1` (side-on), default `0.5`, which is exactly the 2.5D look of before. The near walls are cut lower as the tilt grows so rooms stay visible. The box widens by the actual lift. The Edit-card form has a slider; the editor has View, Tilt, enabled in 2.5D, session only.
- Hide text. Card config `labels: false` (form: "Show names and text") and the editor's View, Show names and text draw no names, values or leader lines, leaving icons, auras and state. It is a `renderFloor` option, so the card and the editor cannot differ. Default shown; output with it on is unchanged.
- Shots and doc images gain tilt 0 and 1 and a no-text card.
- 2.5D view. The card has `view: 2d | 2.5d` (default `2d`) and `view_switch` (default `true`): a small View dropdown beside the zoom buttons, hidden by `view_switch: false` and by `kiosk`. A pick keeps your zoom and pan and is forgotten when the config changes. The Edit-card form has both. The editor has View, Plan view, where 2.5D is a read-only preview (no handles, no selection, no drag; edit menus and shortcuts inert; selection and zoom come back with 2D).
- 2.5D draws what the heights say: walls are extruded, the near (south-facing) walls cut down to 90 cm like a doll's house so no room is hidden; doors, windows and openings are cut out of them; furniture and unlinked appliances are boxes with the symbol on the lid; stairs are steps; a device mounted at 100 cm or more gets a stem. Floor-level things (room fills, icons, door lines, taps) keep their plan position, and 2D output is byte for byte what it was.
- `npm run shots` and the doc images draw the demo in 2.5D. README gets a 2.5D picture.
- Heights in the model (cm, all optional, schema stays version 2): floor `height` (250) and `slab` (25), room `height` (ceiling), wall `height`, door and opening `height` and `sill` (a window defaults to 120 from 90), furniture and unlinked `height`, device `z` (mount height). Defaults live in `src/core/heights.ts` and are read, never stored.
- The editor has a field for each (placeholder shows the default, empty removes it, junk is refused with the reason, out of range is clamped to 0 to 1000).
- The assistant prompts tell it to read ceiling heights, sills and door heights from sections and notes, and to list which it read and which it defaulted. The two-floor example carries a few.
- A room name wider than its room now shrinks to fit (down to 7, zones 6). If it still does not fit, it goes just outside the room on a thin leader line back to the room. A name also keeps off a smaller room drawn inside its own: in the demo, "Garden" and "Garden pond" no longer overprint.
- The Active list starts folded on a card narrower than 480 px (it was 500 px, and only when nothing was stored, so a list that had merely been dragged stayed open over the plan). The card's width decides until you fold or unfold the list by hand; from then on your choice stays.
- README and docs images regenerated from the current build (the garden was clipped at the right edge); a phone-width card picture added.
- docs/WORKFLOW.md: release steps run one at a time, the tag last.

## 0.12.16

- Room names are smaller (11 instead of 14, zones 8 instead of 10) and drawn at half opacity.
- A room name now stays inside its own room. The vertex average of an L- or U-shaped room can fall outside it; the name is now anchored on the widest stretch of the room, and a free spot inside the room is tried before any spot outside.

## 0.12.15

- The card's default view no longer clips content outside the outline (a garden, a shed, a free-standing wall): the default and "fit" view now bound on every structural element, not the outline alone.
- The card's plan can be dragged even with `zoom: false` set, whenever it is pinned narrower than the fit view (`center`/`zoom_level`); zoom in, zoom out and the zoom buttons are unaffected.
- Zooming out is no longer capped at the fit view: the "−" button and pinch/wheel zoom-out now go 2.5x past it before holding.

## 0.12.14

- A window's or glass door's `cover` (electric curtains) no longer turns the opening orange, the security-warning colour meant for a shutter or garage opener; an attached lock left unlocked now shows that alert instead, on doors and windows alike.
- A newly added device now spawns at the current viewport's centre instead of off in the top-right corner of the house.
- A room or zone can be sent to back or brought to front from its right-click menu, so a shape drawn over another one's fill can be restacked without redrawing it.
- Removed `Room.label`, a schema field the editor never had a control to set or clear; a stray value from an old or hand-edited file (`office` reading `BURO`, say) is now dropped silently on load instead of being shown.

## 0.12.13

- The editor now displays live Home Assistant device state while connected: active lights, locks, device states, and room glows render live directly in the editor.
- Motion sensors in the editor track motion fade with their own timer, mirroring the card's fade behaviour across state updates and floor switches.

## 0.12.12

- Six new themes: `coffee` (rich espresso dark), `a-team` (matte black with red and gold), `space` (deep navy with cyan and purple), `cyberpunk` (neon cyan, magenta and yellow), `carpenter-brut` (blood red, hot pink and dark crimson), and `beach-house` (warm sand, sea-teal and palm green), bringing the total to 13 themes.
- Saturated dark themes (`a-team`, `space`, `cyberpunk`, `carpenter-brut`) now render unpainted rooms with a theme-matched dark background (`roomEmpty`) instead of shared light grey.
- Visual theme gallery in the README showcasing all 13 themes.

## 0.12.11

- Fixed: a door's smart sensor/vibration/lock picker only ever listed
  entities already in the plan's catalog, so one that was never placed as
  its own icon (a lock straight from Home Assistant, say) could not be
  attached at all. It now also offers matching entities that exist in Home
  Assistant but were never placed, catalogued or attached anywhere.

## 0.12.10

- Attaching a placed sensor to a door, heater, ac or other item now pulls its
  icon off the plan — it is shown through the thing it is attached to, not
  doubled. Detaching sends it back to Add, not back onto the plan.
- Fixed: an entity attached to a door, heater, ac or unlinked item no longer
  shows in Add (or any other "place this entity" list) while it stays
  attached, so it can no longer be placed a second time next to what already
  reads it.
- Tapping something with more than one entity attached (a heater with TRVs,
  an ac with a linked unit, a door with a contact and a vibration sensor, an
  unlinked item with attachments) opens a small chooser to pick one. With
  exactly one entity, a tap opens its more-info as before. Such a heater or
  ac no longer toggles on tap; a long press opens its own more-info. A door
  with a cover still opens the cover dialog on tap; a long press opens the
  chooser (not in kiosk mode, which has no long press).
- A door with a vibration sensor attached now turns red — the same colour an
  open contact sensor gets, and `open_color` still applies — with the same
  pulsing alert line, but solid instead of dashed, so dashed keeps meaning
  "open". A door that is open and vibrating at the same time stays dashed.
- A contact or vibration sensor attached to a door now shows on the active
  devices panel under the door's own name, even when it isn't placed as its
  own icon on the plan.

## 0.12.9

- Every entity picker in the editor is now a filterable combo box: type to
  narrow by name, entity id or room/domain, arrow keys and Enter to pick,
  Escape to back out without picking.

## 0.12.8

- A card can pin a `center: [x, y]` (plan cm) and a `zoom_level` (1 is the
  whole floor, up to 8) to show one room, corridor or part of the home. Put
  several such cards on a dashboard, one per room. The pinned view is the
  card's home: double-tap and the **Reset view** button return to it, and
  − still zooms out to the whole floor. The editor's **View → Copy card
  view** copies the two lines for what it is showing, rotated plans included.
- An open door or window with a contact sensor is dashed and red. The new
  `open_color` option sets another colour. A cover door is unchanged.
- A TV is blue whenever it is on, in every theme, also when it reports
  `playing`, `paused` or `idle`.
- A speaker is blue and sends out waves while it plays. Paused, idle or off,
  it is grey. Reduced motion holds the waves still. A tap opens more-info.
- Icons no longer shrink to nothing on a big house: past 10 m on the plan's
  longest side they grow with it. `icon_size` (0.5 to 3, default 1) scales
  them further.
- A floating **Active** panel lists every device that is on, on every floor:
  lights, motion and contact sensors, TVs, speakers and media players that
  play, heaters, climate and AC, plugs, computers, open covers, people at
  home, vacuums that are cleaning, and every camera. Tap a row for more-info. Drag the header to
  move it; fold it away. It stays inside the card, starts folded on a card
  under 500 px wide, and remembers its place per card. `active_list: false`
  or `kiosk: true` hides it.

## 0.12.7

- A lit lamp's aura is 50% larger (3 m across instead of 2 m). It now draws
  under walls, doors and names, so it never tints them. The plan only gets
  extra margin where an aura actually passes the edge.
- A triggered motion or contact sensor is much easier to spot: a strong red
  disc and a ring that pulses out from it. An open door or window with a
  contact sensor gets a wide pulsing red line under it. Nothing pulses when
  the device asks for reduced motion.

## 0.12.6

- The card now shows a floor switcher (a chip per floor) by default whenever
  your plan has more than one floor and neither `floor` nor `floors` is set
  in its config — previously a card with no floor config could only ever
  show its first floor, with no way to switch. A single-floor plan still
  shows no chips.
- The Edit-card form gained a Floor selector (theme row and above the
  Floors checkboxes, now labelled "Switcher shows"): pick "All floors" for
  the switcher or one specific floor to pin the card to it, with no YAML
  needed.

## 0.12.5

- The toolbar's Filter through Redo cluster now sits flush against the
  toolbar's right edge (floor chips stay left), instead of floating in the
  middle. It wraps as one block below 769px wide, Undo and Redo always wrap
  onto their row together, and every dropdown (Filter, Add, Draw, View, Edit,
  File) clamps itself to stay fully inside the viewport, however narrow.
- The room panel's Home Assistant Devices list is now one collapsible
  "Devices (N)" block, collapsed by default, with a collapsed sub-group per
  device type (Lights, Wall switches, Motion, and so on), sorted by name,
  unmapped entities last under "Other". Helpers, Automations, Scripts and
  Scenes get the same treatment. Open/closed state survives switching rooms
  and a Home Assistant update.
- Fixed: an opening (a gap in a wall) painted a light-grey band over the
  wall instead of a real hole, so it looked wrong over any room with its
  own colour or texture. The wall (and its halo) is now actually cut where
  an opening sits, in both the card and the editor, whatever is under it.

## 0.12.4

- Fixed: placing a device the Place popup or Add > Device offered from a
  stale-but-catalogued entry (its original device deleted from the plan)
  could hand it an id a different device had since taken, so re-placing the
  original later produced a duplicate device id.
- Walls draw thicker and read more like walls: an internal wall is now
  10 cm, an external one 20 cm (were 3 and 6). A door, window or opening
  now takes the thickness of the wall it actually sits on, instead of one
  fixed size.
- The editor sidebar groups every panel's fields under small section
  headings — Identity, Home Assistant, Links, Appearance, Automations,
  Danger — in that fixed order, a panel showing only the ones it has
  content for. Hints are rewritten short so each fits its own line, not
  clipped; a hint built from a live name or measurement keeps the full
  text on hover. A confirm question and the trace-image instructions
  wrap instead, in full, rather than clip.
- Fixed: a device imported into the catalog but never placed on a floor
  used to vanish from the room's Place popup and from Add > Device (it
  showed only as a raw entity row there instead of its own device row).
  Add > Device, the Place popup and a room's "Add device from" now always
  show one row per device, named by the device, whether or not it has been
  placed yet.
- Add > Device rows and Place popup rows now show the name on one line
  (ellipsised if long, full name on hover) with a smaller type · room
  subtitle underneath, and both panels are 50% larger.
- Fixed, from an Opus review of the whole branch: placing an area's devices
  a second time no longer duplicates the catalog entry; a multi-gang switch
  is offered once per gang, not once per device; a door or opening on a
  wall that is also, at that point, external now always reads its width as
  external, whichever edge happened to tie for nearest; the door
  preview-open overlay takes the wall's own thickness instead of a fixed
  22 cm; a door's click target shows a move cursor; a panel's first heading
  no longer keeps a stray top border when it follows two hints instead of
  zero or one; and a device's Links heading no longer shows over an empty
  section.

## 0.12.3

- The room panel's Place popup now opens with nothing ticked instead of
  everything, so a click on the wrong row can no longer place something by
  accident; a Select all / Deselect all button ticks or clears every row
  shown by the current type filter in one click.
- Add > Device and Add > Entities are now one panel: search by name or
  entity id, and filter by Floor, Room, Area or Type. Picking a device on
  another floor switches to that floor and drops it in its own room.
- Add > Device, the room panel's Place popup, and a room's "Add device from"
  menu now list a device once, not once per entity — a plug shows itself, not
  its power sensor or its diagnostic connectivity sensor. A device with
  nothing but diagnostic entities is not offered at all.
- A light's "Controlled by" switch list now shows only the switches and plugs
  on its own floor, with a likely match (same area, matching name) labelled
  "(suggested)". The Edit menu has a new "Link lights to switches" item that
  links every unbound light on the floor to its suggested switch in one go.
  The same select can also link a light to a motion sensor or motion group:
  pick one, set the off delay, Create automation — it builds the automation
  in Home Assistant and remembers the link so the panel can show and undo it,
  without touching the automation itself.

## 0.12.2

- Fixed "Custom element doesn't exist: floorplan-studio-card" on about half
  of page loads. The integration now adds the card to your dashboard
  resources (Settings, Dashboards, Resources), which load after Home
  Assistant has started, and updates that entry on each upgrade. Removing
  the integration removes it. With YAML resources it still loads the card
  as before, and the card registers again if Home Assistant swaps its
  element registry while starting.
- In a panel view the card fits the screen below the header instead of
  drawing the plan taller than the window.

## 0.12.1

- The card fills whatever space a dashboard gives it instead of cropping.
  `getGridOptions()` tells Home Assistant's sections layout a starting row
  count from the plan's own aspect ratio, and the plan's `<svg>` now fills
  the card's full height, so resizing the card by its grid handle
  letterboxes the plan rather than cutting it off.

## 0.12.0

- The toolbar has an Edit menu after View: Add floor (the `+` chip is
  gone), Home Assistant, Group, plan rotation, Device colours and Trace
  image… moved there. Names moved into View, next to Lengths. The device
  filter reads "Filter:".
- Home Assistant is a button that opens a draggable popover, X top-left,
  saying what the list is: the helpers, automations and areas Floorplan
  Studio created. A name opens the item where Home Assistant edits it;
  Remove deletes it from there. The button is disabled while there is
  nothing to list.
- The room panel's "Place N Home Assistant devices" opens a popup to pick
  which: one tick per entity, a chip per type to narrow the list. Power,
  energy, illuminance and battery readings, groups, scripts and people are
  no longer placed as grey "other" icons.

## 0.11.2

- The card drew nothing on a real Home Assistant and said "No layout": it
  read the websocket reply's wrapper as the plan. Fixed; a plan that arrives
  but fails validation now says which problem, instead of the install hint.
- `scripts/validate-layout.mjs` migrates before it validates, like the editor
  and the card, so an older stored plan passes.

## 0.11.1

- On a phone, a vertical swipe over a plan at fit scrolls the dashboard again;
  once zoomed in, the plan takes the swipe as a pan, as before.
- A room or zone name no longer runs across a door: doors count as obstacles
  when names are placed. The demo's "Garden pond" moved above the pond.

## 0.11.0

- A new `person` device type: an icon placed where the person usually is. Home
  is full brightness; away dims to 35 % with a small "away" mark. An optional
  `room` sensor (state, `area_id` or `area` matching a room) moves the icon to
  that room's centroid, gliding there over 600 ms; several people in one room
  spread on a ring. Tap opens more-info; the entity is `person.*` or
  `device_tracker.*`.
- Save refuses a plan whose JSON is over 3.5 MB, naming the floors that carry
  a trace image, instead of letting Home Assistant drop the connection. The
  autosave says when the browser had no room for the trace image.
- A new `radar` device type for mmWave presence sensors (an ESPHome LD2450, or
  any sensor exposing target x/y): up to any number of `targets` pairs (two
  entities each, x right and y ahead of the sensor, in millimetres) draw as
  small dots turned by the device's own `rot`. The presence entity (a
  `binary_sensor.*occupancy`) colours the icon. `docs/card.md` has a worked
  ESPHome snippet.
- A new `vacuum` device type for `vacuum.*` entities: grey while docked, idle
  or paused; teal and slowly spinning while cleaning; teal, not spinning,
  while returning to dock; red on an error state. A tap opens a dialog with
  Start, Pause and Return to dock, never a toggle; `unavailable`/`unknown`
  disables the three actions but the dialog still opens, so it can be
  dismissed. No field for the vacuum's position on the map — most
  integrations expose that as a camera or a proprietary blob, not coordinates.
- Help: each step showed two chevrons, the browser's own and ours. One now.
- The card's Edit-card dialog shows a form instead of raw YAML: theme, floors, fade, room glow, zoom, kiosk, night and the sun entity. The floor list comes from the layout the card already loaded. A field left at its default is left out of the saved config.
- Night: after sunset the card darkens every room, outdoor areas included, and leaves a room with a light on clear. `night: auto` (default) reads `sun.sun` or the entity `sun` names; `on` and `off` force it. The editor previews it under View, Preview night.
- View, Trace image: load a scan or photo of a floor plan under the current floor, scale it with two clicks and a real distance, set its opacity, hide or remove it, then draw over it. Only the editor shows it, never the card. File, Export leaves it out unless Include trace image is ticked.
- The card zooms and pans: pinch, drag and double-tap on a phone, Ctrl/Cmd+wheel and drag on a desktop, and +, − and fit buttons in its top-right corner. From fit to 8×. A drag that moves more than 6 px is a pan, never a tap, so it no longer toggles the light it started on. New config key `zoom`: `true` (default), `"wheel"` to zoom on a plain wheel too, `false` for the old fixed plan.
- New config key `kiosk`: `true` shows only the plan, for a tablet fixed to a wall — no floor chips, no zoom buttons; a long press does nothing, a plain tap still acts. With `floors` or `floor: "all"`, the first floor shows and there is no switcher: use one card per floor instead.
- `setConfig` now refuses an unrecognised `zoom` value (it used to silently fall back to `true`) and an unrecognised `kiosk` value, naming the key in both cases.

## 0.10.3

- File, Export now writes an `available` list into the downloaded JSON when Home Assistant is connected: every entity Home Assistant knows about, with its name, domain, device class, area and the room on the plan that area already has, and whether it is already placed. An AI assistant can add and position devices from that one file, offline, using only entity ids that are actually listed. Save and the stored plan never carry it, and it is dropped again the next time the file is opened. Documented in `prompts/SCHEMA.md` ("Placing devices from an export"), `prompts/README.md` and the README.

## 0.10.2

- The card gains a `floors` config key: an ordered array of floor ids that restricts the switcher to just those floors, first is the default. Takes precedence over `floor`.
- The editor's File menu gains Install code: a panel with a whole paste-ready Home Assistant dashboard for the plan as it currently stands — theme, floors, the card itself.

## 0.10.1

- A pressed row in the devices filter menu is now visually highlighted, not only marked `aria-pressed`.
- The devices filter menu hides device types with no instance on the current floor.
- An opening no longer paints a visibly wrong-coloured patch over the wall it erases in a dark theme; its erase colour now matches the room's own fill.

## 0.10.0

- Right-clicking a wall, a door, an opening, a furniture piece or an unattached device offers Fix/Unfix: a fixed wall or opening keeps its length on drag (only its endpoint pivots, as before), fixed furniture or a device can no longer be dragged at all. A wall's "Add an opening" is now a submenu — Door, Window, Opening — instead of one button, and every new door, window or opening it adds starts unfixed.
- An opening can be dragged by its body, sliding it along its wall and keeping its length, the same as a door.
- Right-clicking a room's "Add device from &lt;area&gt;" now places the new device at the point you right-clicked, not the room's centre.
- Right-clicking a wall opens a menu: change its kind, add a point, add an opening, delete — mirroring the room/zone/structure context menu.
- The Draw menu groups its items under Openings, Wall and Areas submenus, matching the Add menu's own layout; Device moved under Add's Areas submenu, ahead of Furniture and Unlinked device.
- The plan's device filter can check several types at once instead of one at a time; its zoom buttons are smaller.
- Dragging a room that's snapped to a neighbour pans the view instead of moving the room, so it can't be dragged loose by accident — Unsnap it first to move it.
- View, Device colours: a row per device type with a colour input and a reset, and a Reset all. It opens as a floating, draggable panel — a 3-column grid, closed by its own X, not by clicking elsewhere.
- A custom colour swatch gets a small corner badge instead of a dashed border, so it reads at a glance among the preset swatches.
- The texture rotation and scale sliders show their value beside the bar, not on the line under it.
- Furniture gets its own fixed grey token (`--fp-furniture`), decoupled from the idle-device colour so the two can no longer drift together by accident.
- Help guide steps collapse behind a chevron, opened on click, instead of all showing open at once.

- A room's Delete button moved next to Unsnap, near the top of its panel, instead of at the bottom.
- The View menu now shows the installed version at the top, read from the integration's manifest.
- A demo GIF in the README, recorded from `demo/layout.json`: the card live, then the editor.
- A Help button in the editor's toolbar opens a step-by-step guide — drawing the outline, walls, doors and windows, stairs and zones, furniture, a device, attaching an entity, floors, saving — in a side panel that stays open while you work. It remembers whether you had it open, same as the grid and theme choices.
- Docs: `docs/schema.md` (generated from the schema's own comments), `docs/card.md`, `docs/editor.md` and `CONTRIBUTING.md`, for anyone reading the format or contributing by hand.
- Fix: a hand-edited layout file with a piece of furniture rotated past 360° (or below 0°) now opens with that rotation wrapped into range instead of carrying the raw stored value — the editor's own rotate buttons could never produce one, but an untrusted file can.
- Fix: a lamp or a camera near an outer wall no longer has its aura or its cone cut off by the edge of the plan — the view now leaves as much room as the furthest thing a device paints around itself, not a fixed 60 cm.
- The panel's own background, text and accent colour, when it runs inside Home Assistant, now come from a small, tested map (`src/editor/theme.ts`) instead of three untested inline fallbacks — no visible change, just something that can no longer silently drift.
- Selecting a room shows an "In Home Assistant" box below the panel: everything Home Assistant has in its area, grouped as Devices (placed ones marked "(on plan)"), Helpers, Automations, Scripts and Scenes. Every row opens Home Assistant's more-info dialog; a scene gets "Run"; an automation or script gets "Edit in HA"; "Add to area..." puts an area-less entity into the room's area. A custom room with an `entity` shows that one row instead.
- A switch's panel gets "Controls...", which picks any number of lights, switches, plugs or groups and builds a Home Assistant automation that turns them on and off with it. Light, switch, plug and media panels get "Schedule", two time fields that build a daily on/off automation. Choosing a motion group in the Group menu offers "Turns on...", which picks a light group and a minutes-without-motion field and builds the same kind of automation. Each opens the finished automation in Home Assistant's own editor.
- Shift+click two or more lights, or two or more motion sensors, to select them together; the panel offers "Create group" with a name field, which asks then has Home Assistant build the light or motion group. A new "Group" menu in the toolbar lists every Home Assistant group with a member on the current floor; choosing one fades every device not in it, "All" clears it.
- A custom room, or one whose area Home Assistant no longer has, can create that Home Assistant area and link itself to it with one click. Nothing selected shows an "Areas not on the plan" box, so an existing Home Assistant area can be drawn as a room straight away.
- The disc behind an icon that is off is now 50 % opaque in every theme, so it covers less of the plan.
- A room linked to a Home Assistant area gets a "Place N Home Assistant devices of this area" button in its panel: one click puts every entity of that area not yet on the plan into the room, spread out, one undo step.
- Add > Unlinked device places an appliance icon that isn't tied to one entity's state — heater, ac, heatpump, boiler, battery, lamp, computer, tv, car, server, UPS, inverter, speaker or 3D printer — which can be scaled, rotated, given a colour, and optionally linked to one or more Home Assistant entities for reference.
- Four new floor textures — herringbone wood, parquet wood, terracotta tiles, a checkerboard — join the existing seven, and a room or staircase's texture can now be scaled from 25% to 200% independently of every other room, with a slider in the paint panel next to the rotation one.
- Add > Entities lists every Home Assistant entity not yet on the plan, grouped by type and searchable; clicking one places it at its area's room centre when one is drawn, else near the plan centre.
- Right-clicking a room, zone or structure opens a menu: change colour, delete, and — when the room has a linked Home Assistant area — add one of the area's entities as a new device at a click. A device's type can now be corrected any time from the device panel's own type field.
- A door or window can now attach more than one contact sensor, vibration sensor and smart lock, and its curtain/cover field is a proper dropdown of `cover` entities instead of free text. A heater attaches several TRV/climate entities and temperature sensors; an AC attaches several AC-or-TRV entities. Two new device types, "Door locks" and "Vibration sensors", join the device list and colour settings.
- A room's or staircase's texture can now rotate on its own, independently of the shape: a slider in the paint panel, once a texture is chosen, 0–360°.
- Editor: Undo and Redo moved out of the File menu into the toolbar itself, after Home Assistant, so undoing no longer needs opening a menu first.

## 0.9.0

- Theme, config `theme:`, grows from three to seven: `blueprint` now has a new dark-blue palette with a green measurement grid and one orange accent colour for every "on" device; `midnight` keeps the previous dark theme exactly as it was; `slate` (light grey) and `terminal` (near-black, terminal green) are new; `solarized` is the real Solarized dark palette, each device kept in its own colour. `ha` is unchanged.
- Editor: the theme picker moved into its own Theme submenu under View, next to Grid — seven themes no longer crowd the menu as flat chips.

## 0.8.1

- Fix: a structure line ("boiler + tank", "tech area") could never be clicked, selected or deleted — its own body took no clicks at all, on any floor. It now selects, drags, resizes and deletes like a wall, and is selected as soon as it's drawn.
- New items now spawn clear of everything already on the floor, not only clear of the house outline.

## 0.8.0

- The Add menu groups its detail behind three submenus — Openings (Door/Window/Opening), Wall (kind, as before), Areas (Zone/Structure/Stairs) — with Furniture unchanged below them. Draw, Device, View and File stay flat. Pure reorganisation: every existing item is still there, one click deeper.
- File, Export downloads the current layout as JSON directly, from the HA panel too — Save there only ever wrote to `.storage`, so this was the only way to get the JSON back out.

## 0.7.0

- A "Home Assistant" toolbar menu lists everything floorplan-studio has labelled `floorplan-studio` in this Home Assistant instance — helpers, automations, areas — whole-instance, so something orphaned by a plan edit still shows up. Each row can open in Home Assistant or be removed there. Removing something from the plan never touches Home Assistant on its own; this menu is the one place that does.

## 0.6.0

- A wall, door or opening can have its length locked: dragging an end then only pivots it, on an arc of fixed radius, around the other end. Typing a length locks it by default; untick "length locked" to drag freely again.
- The demo layout has a third floor, "Test", with one plain square room, for demos and manual checks.
- An unpainted room is one light gray in every theme, not the theme's own tint (only a plain room or structure; garden, water and the rest keep their kind colour).

- Sprint 4, first slice: the panel can now write to Home Assistant, always after a confirmation dialog.
- A placed switch or plug has "Create a light from this switch": Home Assistant gets a light helper (labelled `floorplan-studio`) and the plan swaps the switch for it.
- Drop a device in a room and the panel offers to move it to that room's Home Assistant area. "Don't ask again this session" is in the dialog.
- The standalone editor never writes to Home Assistant.

## 0.5.4

- The device entity picker no longer offers an entity that is already on the plan (a device's own stays).
- README status brought up to date.

## 0.5.3

- Room and device pickers now work in the panel: the panel reads areas, floors and entities from Home Assistant.
- A device's entity is a picker (suited to its type, the room's area first). It can attach an unbound device, switch to another entity, or set it back to "not connected".
- Devices with no entity are marked on the plan in the editor and listed on the floor panel as "Needs an entity".

## 0.5.2

- A custom colour picked for a room now becomes a swatch, kept in the layout (`palette`), so you can reuse it.
- Seven textures for floors: light, warm and dark wood; white, grey, dark blue-grey and black stone tiles.
- Stairs can be coloured and textured like rooms. Zones already could.

## 0.5.1

- Fixed: the editor no longer resets (zoom, selection, undo, edits snapping back, lost focus) each time Home Assistant updates a state.
- The blueprint grid covers the whole canvas and its zero is at the plan's top-left corner.
- Zoom buttons top right of the canvas: + in, - out, 0 reset.

## 0.5.0

- A device may have an empty entity: a fitting that is on the plan but not in Home Assistant yet (a wired light, say) no longer makes the whole layout fail to load.

## 0.4.0

- The panel shows a banner when HACS has an update for Floorplan Studio, with an Update button (HACS's own install) and a link to the release notes. Restart Home Assistant afterwards.
- Icon and logo (blueprint style) shipped inside the integration, for Home Assistant 2026.3 and later.

## 0.3.0

- File, Load demo: puts the demo home in, only while the plan is blank.
- File, Reset now erases to a blank plan (asks first, undoable). It used to return to the starting layout.
- Fix: a fresh install (nothing saved) showed an error list instead of a blank canvas.

## 0.2.0

- The sidebar link can be hidden: Configure on the integration, **Show in the sidebar** (on by default).
- README: one-click setup link.

## 0.1.0

First release.

- Floor plan editor, standalone and as a sidebar panel in Home Assistant, saving to `.storage`.
- Lovelace card: lights, switches, sensors, cameras, thermostats, doors, monitored devices. Three themes.
- The card script is added to every dashboard by the integration; no manual resource.
- Installed and updated through HACS.
