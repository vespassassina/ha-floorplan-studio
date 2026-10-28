# Changelog

## Unreleased

The 3D view follows the sun. By day the light comes from where `sun.sun` puts the sun, weaker and warmer when it is low, and a soft patch of sunlight falls on the floor behind each window the sun shines through (at most 24, the largest first). At night, with no sun, or on the floors below, the light is as before.

- Card: the hover title of a device names its type in the card's language ("Licht: Küche"). In English, and in the Studio, it reads as before.
- Card: the switch between device icons and dots has a dead band. Icons from a plan 420 px wide, dots at 380 and under, the last level in between, so a plan resting near the bound stops flipping.
- Card: the 3D view takes the sun's `azimuth` and `elevation` from `sun.sun` (or the entity named in `sun:`) and the plan's `north`, and lights the house from there; a hass update that moves only the sun moves the light. With no usable sun the light is the old fixed one.
- Card: on a floor you turned with Hand align (`rotation`), the 3D sun now shines from the right side of the house. It used to ignore the floor's turn.
- Card: an error line ("The plan could not be used", "Could not load the plan") follows a change of Home Assistant language without a reload.
- Card: the Edit-card form loads only when you open Edit card, as a file of its own beside the card (`floorplan-studio-form-<hash>.js`). The card file is 5.3 KB smaller gzipped. Nothing changes in how the form works. Update the integration as well as the card: the card needs the new file in `www/`.
- Card: if the Edit-card form fails to load once (a network blip), Edit card works again on the next try instead of staying broken until you reload the page; if it keeps failing, the dialog says to reload the page.

## 0.36.0 - 2026-10-25

A first plan from your Home Assistant areas, and a card in your language. With no saved plan, the Studio offers the demo home, your areas or a blank plan. The card now speaks nine more languages, shows device icons at its default size, and wall tablets signed in as a normal user follow a saved plan. Update the integration as well as the card.

- Studio: the first time you open it with no saved plan, it offers three ways in: load the demo home, start from your Home Assistant areas, or a blank plan. Start from your areas draws one 4 x 4 m room per area that has a device the plan can draw, with those devices inside; drag the corners afterwards. Undo takes the whole thing back in one step.
- Studio: when the Studio is under 700 px wide it now says "The Studio needs a wider screen." (with a link to the dashboard in Home Assistant) instead of showing a cramped, half-working layout. The plan, selection, zoom and undo history are kept and come back when the window is wider; nothing is saved or changed meanwhile.
- Card: the 2D plan now draws device icons at the default zoom, idle devices included. Dots only when the plan is under 400 px wide (a phone). A `detail` key (`full`, `minimal`) or a Detail pick in the menu still wins.
- Card: speaks your Home Assistant language: Italian, Spanish, Portuguese (also Brazilian), French, German, Dutch, Simplified Chinese and Polish. Other languages read English. The translations were written without a native speaker's review; corrections are welcome. The Studio is still English.
- Card: wall tablets signed in as a normal user now follow a saved plan, without a page reload. Update the integration as well as the card.
- Studio: messages ("Plan unlocked", "Saved") now show low in the plan, above the status bar. At the top they covered the open Floors menu (Add floor) and, when the toolbar wraps on a narrow window, the search box.
- Studio: the length label of a wall is drawn over the handle dots, not under them. A short wall has its two end dots on its own label.
- Studio (standalone page): the page behind the Studio takes the Studio's theme, so a light Studio is no longer framed in dark.
- Studio: the Align panel's buttons are a little shorter, so its angle-step row shows in full on an 800 px high window instead of being cut off at the bottom.
- Card: with "Floor below" on, the plan stops short of the zoom buttons, so they no longer sit on the faint outline of the floor below. The plan is 40 px narrower then (60 px on a touch screen).

## 0.35.0 - 2026-10-24

A demo home to start from: File > Load demo in the Studio now opens a furnished house with a basement and two floors. The README and every picture are rebuilt from it. Home Assistant 2026.6's card picker offers the card when you pick an entity it can draw. Smaller things: a selected zone has a dashed outline, the room panel prints Home Assistant's own state text, and hover contrast is fixed.

- Docs: README and every image rebuilt from the demo home (hero in 3D, phone sheet, Studio, a grid of all 13 themes, a new demo GIF); the pictures of a real house and the "from before 0.29" notes are gone.
- Studio: a selected zone is outlined with a heavier dashed line (3 px, dash 6 4); a selected room keeps the solid 2 px outline.
- Card: Home Assistant 2026.6's "By entity" card picker now lists Floorplan Studio under Community when you pick an entity a plan can draw.
- Demo: a furnished three-level demo home (basement, ground, first; about 10 x 8 m, aligned stairs, every device type, a car on the drive, a vacuum). File > Load demo in the Studio offers it, with a pleasant evening's states in `demo/home-states.json`.
- Card: the room panel's device and sensor rows, and the Details State line, print Home Assistant's own state text (precision, translated state), as the plan and the popup already did.
- Accessibility: the hover and focus background of the card's panel rows and buttons no longer drops light text to 2.9:1 contrast. "Lights off" and the Studio's reset-view button now carry their visible text in their accessible name, so voice control can say it. The Studio's shortcut hints meet 4.5:1.

## 0.34.0 - 2026-10-21

- The Studio's update banner only trusts a release URL that starts with this repository's GitHub address, so a look-alike URL gets no banner and no link.
- Studio, safety (review): Reload after a conflict (and Overwrite) now asks the server for the trace images. Before, the reloaded plan had none, and the next Save erased them from the stored plan.
- Studio, safety (review): a successful Save clears this browser's autosave draft, so the "Restore unsaved draft" bar no longer offers an old plan that another device has since replaced. A draft that only lost its trace images (the autosave drops them when browser storage is full) is no longer offered for that alone, and Restore keeps the stored images.
- Studio: pressing Save twice before the first reply no longer ends in a false conflict. The second press waits, then saves the newest state against the new revision.
- 3D: sensor readings use the same display text as the 2D plan (21.5 °C, not 21.456789 °C).

- Card: on a narrow card, the leader line from a small room's name keeps off other rooms and off other names where there is room to do so.
- Card: a window's lines read at 3:1 or better against the pane in every theme (light and solarized were 2.4 and 2.8). The pane is a lighter tint of the board.
- Docs: theme gallery images regenerated.
- Studio, safety: a change of Home Assistant's theme no longer resets the editor (edits, undo, zoom). After a Save the panel also holds what was saved, so a later redraw cannot bring the old plan back.
- Studio: closing the tab with unsaved edits asks first. When the panel opens and this browser holds an autosave draft that differs from the stored plan, a bar offers "Restore unsaved draft from <time>?" (one undo step) or Discard.
- Integration: the stored plan has a revision. `floorplan_studio/load` returns `rev`; `floorplan_studio/save` takes an optional `expected_rev`, answers the error `conflict` and writes nothing when it is stale, and returns the new `rev`. The Studio shows Reload and Overwrite on a conflict. A save without `expected_rev` still overwrites. Storage written by older versions reads as revision 0.
- Studio: on a narrow screen the panel shows HA's menu button.

- Card and Studio: a small live camera picture beside each camera icon, in 2D, 2.5D and 3D. Off by default. Options `camera_thumb`, `camera_thumb_size` (small, medium, large) and `camera_thumb_pos` (above, below, left, right), also in the card's visual editor, the card's View menu and the Studio's View menu. The picture comes from the camera's own `entity_picture` through Home Assistant, refreshes every 10 s, and pauses while the tab is hidden. A tap on it opens the camera's more-info. A picture that does not load is not drawn.

- Card: a failed load shows the integration's own message instead of "install the integration"; a store with nothing saved says "No plan saved yet" and links admins to the Studio. One retry on the next update and when the connection is ready again.
- Card: after an update, a cached page that cannot read the new plan says "Floorplan Studio was updated. Reload this page."
- Card: cards on one dashboard share one load, a config change that keeps the source keeps the plan, and the load no longer carries trace images (only the Studio asks for them, and only an admin gets them).
- Card: a save in the Studio fires `floorplan_studio_updated`, and open cards reload the plan. Only admin sessions can subscribe to it.
- Release notes on GitHub are now the CHANGELOG entry. `render_readme` (ignored by HACS) is gone from `hacs.json`. Removing the integration no longer fails when the dashboard resource store errors.

- Card: sensor readings, the popup line and the tooltip use Home Assistant's own display text when the frontend offers `formatEntityState`: 21.5 °C, not 21.456789 °C; Heat/Cool, not heat_cool. Studio keeps the raw state.
- Card form: under kiosk the Rotate buttons box shows what the card does (unticked) and ticking it writes `rotate_switch: true`. View switch and Active list show unticked and disabled under kiosk, which hides them for good.
- Card: a service call that Home Assistant rejects now shows HA's toast (`hass-notification`, "switch.turn_on: message") instead of failing silently. One helper makes every call the card sends.
- Card: the popup of a device on a scene, button, script or valve has its button: Activate (`scene.turn_on`), Press (`button.press`), Run (`script.turn_on`), Open or Close by state (`valve.open_valve`, `valve.close_valve`). None asks first; a tap with `tap_action: toggle` still opens the popup rather than acting.
- Studio: Trace image, Load checks the whole plan against the 3.5 MB save limit, not only the 4 MB per image. The scan is encoded to fit what the other floors leave; if it cannot fit, Load says so with what to do and changes nothing. Before, a 3.8 MB scan loaded and Save then refused.

## 0.33.3 - 2026-10-20

- Studio, safety (HACS review): the cleanup list in Edit, Home Assistant, lists and removes only what the editor created. The `floorplan-studio` label alone no longer counts: a light, automation or area you labelled yourself is never listed, and Remove checks the item again before it deletes anything. Helpers must come from `switch_as_x` or `group`, automations must have an `fp_` id, areas must be ones this browser created.
- Studio: opening the panel no longer creates the `floorplan-studio` label. It is created the first time the editor makes something.

## 0.33.2 - 2026-10-19

- Card: a tap on a car piece opens the card's popup (name, `Home · Charging · 78 %`, More info), in 2D, 2.5D and 3D, and from its Active row. It was Home Assistant's more-info of the tracker. A hold still opens the chooser.

## 0.33.1 - 2026-10-18

- Studio: every Remove in a list is now the small round red X, placed before the name (door, Controls, TRV, sensors, the car's attached entities, scenes offered, radar targets, the card's Favourites). It keeps its name in the tooltip and for screen readers.

## 0.33.0 - 2026-10-18

- Review fixes (S35, Opus): a car's hover text and Active row read all its entities (`Home · Charging · 78 %`), not the main one. In 2.5D the away dot, bolt and level sit beside the faded car, as in 2D. Kiosk never opens more-info on any path: an unlinked appliance with a player, a media player icon and `tap_action: more-info` (which opens the popup instead). A charging car with an unavailable tracker is on (2D, 3D, Active). 3D draws the gone mark. Charging is green in every theme, blueprint included. The 2D bolt sits toward the car's tail. Under Lock plan a car's attached entities and colour are not geometry, its model is. Tyres inset 1.2 cm (no seam lines). A car's entity ids must be real ids (`domain.object_id`) in `validate`, `migrate` and the card. The attach list copes with entities that have no name. Docs: hold is 500 ms; Convert to car piece is on an unlinked car appliance and a car device.

- Docs and tests (S35.8): `card.md`, `editor.md`, `SPEC.md` and the README cover the car (models, colour, attached entities, status marks, tap, hold, kiosk, the Studio's Car block). The demo car stands on the Test floor. A card older than 0.33.0 draws a car piece as the old box and ignores `model`, `color` and `attached`. A new Playwright test holds a real press on the car in 3D and checks the chooser. The card file is 120,347 gz (cap 121,000); the 3D chunk 158,439 (cap 233,000).
- Card (S35.6): tap, hold and kiosk for the car. A tap on a car piece opens Home Assistant's more-info of its main entity (the first attached one when `entity` is empty), whatever `tap_action` says. A hold opens the chooser, titled with the name and the car's state line (home or away, charging, level), main entity first, then the attached ones; its title and rows follow `hass`. Fixed: in kiosk a tap on a linked piece (a car, a tv, a speaker, a computer) opened more-info, which kiosk promises never to do. It now does nothing. A car icon whose tracker is away fades to 35 % with the away mark, as a person does.
- Card (S35.5): the car in 3D. A car piece is built from its model, not one box: body, a sloped glass greenhouse (a new `loft` shape, meshed and picked in the viewer), a 4 cm roof, four tyres and a grille (none on the electric). Glass and tyres are near-black in every theme; body and roof wear the piece's colour (default the theme's furniture colour). Any part taps as the car. Charging lights the glass, an alert turns the roof the open-door colour, away is 35 % opacity behind a depth pre-pass so the far wheels do not show through; all change in place with no rebuild. The overlay draws a bolt, an away mark and the level (with labels on). Not in 3D: the gone mark for a dead main entity.
- Core (S35.4): the car piece draws in 2D and 2.5D. Each model has its own top view (`carTop`); in 2.5D a body block and a glass cabin block with its own roof. `color` is a `--fp-car-body` custom property (a forged value draws nothing), away fades the car to 35 % with a mark at the nose, charging outlines it in `--fp-dev-car` with a bolt badge, an unlocked door or open window outlines it in the door colour (charging wins), and the battery level prints under it. The plan's frame now holds a whole car, not only its centre. The demo gains a car beside the house. Shots gain three car states, the nine models, 2D and 2.5D.
- Core (S35.2): `src/core/car.ts` holds the nine car models once: footprint, height and profile per model (`CAR_SPEC`), the plan polygons (`carParts`) and the top-view markup (`carTop`). A new car piece is 470 x 182 cm, a sedan; a car piece with no `height` is as high as its model. Nothing draws the new shape yet (S35.4, S35.5).
- Core (S35.1): a car piece (`symbol: "car"`) may carry `model` (sedan, wagon, suv, offroad, truck, van, utility, citycar, electric), `color` (`#rrggbb`) and `attached` (up to 24 entity ids). `validate` reports junk and the keys on any other piece; `migrate` drops them, so a model from a newer file loads as a sedan. A car's attached entities are not offered again as icons. No schema bump: an older card ignores the keys.
- Core (S35.3): what a car's entities say. `carStatus` reads home or away from the first `device_tracker.*`, charging (a `battery_charging` binary sensor that is on, or a sensor reading `charging` or `charge_in_progress`), the battery or fuel percent, and an alert (an unlocked lock, an open door or window sensor), by domain, device class and state. `carText` prints `Away · Work · Charging · 78 %`. A car piece with an entity or attached entities is now a linked piece (`pieceDevice`); a car is on while it charges and in the Active list only then; a car icon on a tracker fades and wears the away mark like a person; `car` never toggles from the popup. The new `car` class names are inert until the car is drawn (S35.4).
- Studio (S35.7): a car piece has a Car block in the panel. Pick the model (the footprint follows, one undo step) with a top-view swatch, paint it from the palette, a colour input or Theme colour, name the main entity (trackers first, a tap opens it) and attach the rest: the main entity's device first, then entities named like the car, then the car domains, diagnostics last. Add all from this car attaches the device's entities (24 at most). A car icon or an unlinked car can be converted to a car piece in one step. Leaving the car symbol drops the three car keys, so the layout still validates.

## 0.32.1 - 2026-10-17

- Tests only: pixel reads no longer use `page.screenshot`, which fails at random on the CI runner ("Unable to capture screenshot"). Plans are rasterised from the SVG onto a canvas by `tests/helpers/pixels.ts`. Same colours, same tolerances. Converted so far: frame-25d, shade-25d, tree-25d, window-pane, camera-cone-clip, light-glow, card-ghost-turn, hand-align-exit, card.spec (five mask pixel tests), editor.spec (the opening hole), and the 3D specs live, doorway, linked-piece, colors, shade, stair-down, stair-well, tex-glow, plus card-3d and card-3d-narrow, which read the WebGL canvas right after a frame the test hook draws.

## 0.32.0 - 2026-10-17

- Card (S34 review): the Edit-card form read the websocket reply as the layout itself, so on a real dashboard the floor list and the Favourites choices stayed empty; it now reads `{ layout }` as the card does. A favourite that is not a light, switch, input_boolean or fan (a lock, a cover, a group, ...) asks (Confirm unlock, Confirm open, ...) before it acts, turn on included; only those four act on one tap. With the heat map on, the room panel prints the number the plan prints, and the legend says "no readings" when no room on the floor has one. When 3D falls back to 2D the legend moves to the top so it no longer overlaps the note. The Studio's status-bar ramp blends in oklch like the card's.
- Docs (S34.11): `card.md`, `editor.md`, `SPEC.md` and the README cover favourites and the heat map. The card's Heat map items follow Detail and Layers: hidden with `active_list: false` and in kiosk, where `heat_map` in YAML still heats the plan.
- Core (S34.11): with the heat map on, a room's badge plate (lights, motion, alerts) sat on the heat value; it now steps below it. Shots gain favourites and heat states.
- Card (S34.8): the heat map. The `heat_map` key (`off`, `temperature`, `humidity`; anything else is off with one console warning) and a Heat map section in the ⋯ menu, after Layers, fill each room that has a reading by the fixed scale and draw a legend strip at the plan's bottom left. 2D and 2.5D; in 3D the items and the legend are hidden and the pick is kept. The pick is the viewer's, kept in the view memory (`heat`), cleared by Reset view; editing `heat_map` in the YAML starts a clean memory. Like Detail, the section is not in kiosk or under `active_list: false` (the key still applies there).
- Card (S34.9): the Edit-card form has a Heat map select (Off, Temperature, Humidity). It writes `heat_map`; Off leaves the key out; a value the card cannot read shows Off and fires nothing. The card reads the key in S34.8.
- Studio (S34.10): View, Heat map (Off, Temperature, Humidity). Each room that reads is filled on the fixed scale and prints its value; the status bar shows the scale with a ramp, or "Heat map: no readings" when no room on the floor reads (always so standalone, where there are no states). The pick is kept in the view memory, not the layout, and is no undo step. The card's half is S34.8; `view-parity.spec.ts` has the `heatSub` row and fails on its card half until that merges.
- Card (S34.4): a Favourites section at the top of the Overview for the new `favourites` key (alias `favorites`; up to 24 entity ids; Studio none, on purpose). Each row is the Active row plus the popup's button: Turn on acts, Turn off asks first (Confirm turn off, Cancel) except a light's, a sensor has none. A tap on the row goes to the thing. It folds like a category and shows on every floor the card shows, with a floor badge when it shows several. Search lists a favourite before a shorter name of the same tier. One `console.warn` per card when the list had junk. No section in kiosk, with `active_list: false`, or at the Floor or Room level.
- Card (S34.5): the Edit-card form has a Favourites field: type or pick an entity (the datalist lists every device and linked piece on the plan), Add, and a list with a Remove button per row. A repeat, a non-entity or a 25th is refused with a line that says why. It writes `favourites` and drops `favorites`; an empty list drops the key. The Overview section that shows them comes with S34.4.
- Card (internal, S34.1): `src/card/favourites.ts` reads the `favourites` key (alias `favorites`) from untrusted YAML: entity ids only, repeats dropped, at most 24, never throws. The Overview section that uses it comes later in Sprint 34.
- Card (internal, S34.2): `favouriteRefs` finds each favourite on the plan, a device or a linked piece, on the floors the card shows, in the list's order. An entity that is not drawn there is left out.
- Core (S34.3): `searchIndex` takes an optional fourth argument, a set of favourite entities; within a tier a favourite ranks before a shorter name. Nothing passes one yet (the card does in S34.4), so Search is unchanged.
- Core (S34.7, internal): `renderFloor` takes `heat: "temperature" | "humidity" | "off"`. A room that reads fills with the fixed ramp mixed 55 % into its kind's colour, keeps no night veil, and prints the heat value in its readout line, also under `labels: false`. Omitted or `off`, the markup is byte for byte as before. The card and Studio get the option in S34.8 and S34.10.
- Core (S34.6, internal): `src/core/heat.ts`, the heat map's maths. `roomHeat` gives a room's reading and its place (0 to 1) on a fixed scale, 16 to 26 °C or 30 to 70 %; `readings.ts` gains `meanValue`. Nothing draws it yet (S34.7).
- Studio (saved views): after Rename, Save or Delete from the Saved views list, focus stays on Save current view, so Escape still closes the View menu.

## 0.31.0 - 2026-10-15

- Card (S33 review): `tap_action: toggle` no longer acts blind on a lock, a cover or a siren (nor climate, humidifier, water_heater, automation, remote, media_player or group): a tap opens the popup. Only a light, a switch, an input_boolean and a fan toggle at once. Enter on a focused icon always opens the popup, as before.
- Schema (S33 review): a saved view whose id is `2d`, `2.5d` or `3d` is refused by `validate` and dropped by `migrate`: the card never offered it, so the Studio must not list it. The Studio's own ids start `view-` and never clash.
- Card and Studio (S33.1): `fan` is a device type. A `fan.*` entity is typed `fan` when placed from an area menu or the entity list, drawn with the mdi fan glyph in its own colour (`--fp-dev-fan`) when on, switched by Turn on and Turn off (OFF asks first), listed in Active, counted in All off under a new "Fans" group, and shown at ceiling height in 3D. Existing devices already typed `other` or `ac` on a `fan.*` entity keep their type; change it in the device panel. The demo has one fan.
- Card (S33.2): a fan that reports a `percentage` and supports speed (`supported_features & 1`) gets a Speed slider in its popup, 0 to 100 %, stepped by `percentage_step`. Moving it changes the number; release makes one `fan.set_percentage`. A fan without either attribute keeps just its button. No Studio twin: the popup is card chrome.
- Card (internal, S33.3): `src/card/tap-action.ts` reads the `tap_action` and `hold_action` keys (popup, more-info, toggle, none; more-info, none) from untrusted YAML and never throws. S33.4 uses it.
- Card (S33.4): `tap_action` (popup, more-info, toggle, none) and `hold_action` (more-info, none) work on device icons, in 2D and 3D. `toggle` turns a device on at once and a light off at once; any other turn off opens the popup at Confirm turn off. A stack still fans out first, a kiosk never holds, and doors, appliances and the Active list keep what they do. A value the card cannot use is the default, with one console warning.
- Card (S33.5): the Edit-card form has Tap (Popup, More info, Toggle, Nothing) and Hold (More info, Nothing). A default is left out of the YAML.
- Schema (S33.6): a layout may carry `views`, up to 24 saved views (floor, mode, turn, zoom and centre). `migrate` keeps the good ones and drops each bad one, so a stranger's file still opens. An older card (0.30.x) drops `views` when it loads the layout.
- Card (S33.9, internal): `dashboardFor`, the pure builder behind the coming dashboard strategy: one panel view per floor, or one markdown view saying what failed. S33.10 registers it.
- Studio (S33.7): View, Saved views. Save current view asks a name and Open in (Viewer's choice, 2D, 2.5D, 3D) and keeps the floor on show, the turn, and the zoom and centre when the floor is zoomed in; a floor shown whole stores no zoom, so each card fits it to its own window. A click on a view shows it (no undo step); a right-click gives Rename and Delete. Save, rename and delete are one undo step each. Delete floor drops that floor's views in the same step, and Undo brings them back. The card's twin is S33.8.
- Card (S33.8): the ⋯ menu has a Views section when the layout has saved views: one item per view on a floor the card shows (`floors`, or its one pinned floor; `kiosk` has no menu). A pick is a viewer's pick: floor, then mode, then turn (a view with none turns the plan to 0), then zoom (a ratio against the card's own fit) and centre; in 3D the floor's framed camera stands. It is remembered like any pick, a `hass` update keeps it, and Reset view goes back to the config. A view whose id is `2d`, `2.5d` or `3d` is not offered (its menu value would be the View mode's).
- Card and Studio (S33.10): the card's script defines the dashboard strategy `ll-strategy-dashboard-floorplan-studio`. A dashboard whose raw config is `strategy: { type: custom:floorplan-studio }` is built by Home Assistant on every load: one panel view per floor, in order, each with a Floorplan Studio card pinned to its floor, so a floor added in the Studio shows up without pasting again. `title` renames the dashboard and `card:` options (`theme`, `view`, ...) go to every card, never over `type` or `floor`. With no layout, a failed load or an invalid layout it is one view that says what failed. File, Install code in the Studio shows the three lines under "Or as a strategy".

- Docs (S33.11): `card.md`, `editor.md`, `SPEC.md` and the README describe the fan, `tap_action` and `hold_action`, saved views and the strategy. Upgrade notes: a card older than 0.31.0 (an open dashboard page that has not reloaded) reads "No layout" for a layout that has a `fan` device, because its `validate` refuses the new type; reload the page (the version check asks it to). It also drops `views` when it loads a layout, so saved views do not show there; the Studio, from 0.31.0, keeps them.

## 0.30.1 - 2026-10-15

- Tests (internal): `frame-25d.spec.ts` reads the frame pixels from a canvas instead of `page.screenshot`, which failed on the CI runner. No change to the card or the Studio.

## 0.30.0 - 2026-10-14

- Card (S32): the 3D view frames the house exactly. The first view, Reset camera and a floor switch fit the floor's box inside the part of the view the chrome leaves (the old rounder fit is gone, so the first picture is slightly larger or smaller, and a plan turned 45 degrees is no longer cut at a corner). When the card is resized (a window, a tablet turned, the side sheet opening or folding) an untouched camera is fitted again; a camera you have turned, zoomed or panned keeps its angles and target and only its distance follows the size.
- Card (S32): on a phone the 3D house is framed above the bottom sheet. At half the whole house sits above it, at the peek the whole view is used again, and at full the camera keeps its half framing. The camera glides, 400 ms, when the sheet changes stop; dragging the handle moves nothing, the snap does. A resize jumps.
- Card (S32): in 3D a room pick focuses the room. A tap on its floor or a Search result glides the camera to the room's fit in what the sheet leaves, keeping your angles. A canvas tap waits out the 350 ms double-tap window, so a double tap never moves the camera. Back, Escape, the Overview or a tap on the background glide back to the camera from before the first focus; Reset camera and a floor tab drop the focus. A drag, a wheel turn or a pinch stops a glide where it is. The focus is never saved. Reduced motion jumps.
- Docs (S32): the three 3D Known limits (no re-fit on a narrower card, the half sheet covering the house, a room pick not moving the camera) are fixed and removed; `docs/card.md` describes the framing.
- Card (internal, S32): the framing maths (`fitBox`, `project`, `glide`) is a pure module checked against three.js; `coverOf` in `src/card/frame.ts` gives the px the bottom sheet covers; the orbit frames a box and keeps a focus; `setInset` is replaced by `setFrame`.
- Card: the ⋯ menu's Theme is one drop-down with all 13 themes, not a list of 13 radios. It is a native select: a click, or Enter, Space or Alt+Down on it, opens the list; the arrow keys still walk the menu past it. A pick writes the same `theme` into the view memory, closes the menu and returns focus to the ⋯ button. `view_switch: false` still hides it.
- Card (fix, review of S32): a floor tab pressed within 350 ms of a canvas tap no longer zooms into a room of the new floor. The tap's held room index (of the floor just left) reached the new floor, where the same index is another room, and the camera jumped there for about 750 ms before it glided back to the floor.
- Card (fix, review of S32): a camera held at its near limit (a tiny room) is centred in the visible box. The lens shift was worked out for the distance before the clamp.
- Card (fix, review of S32): quick taps on the bottom sheet's handle no longer drift the zoom of a camera you have moved. A tap that landed during a glide scaled the zoom from the mid-glide distance; it now scales from the glide's end.

## 0.29.0 - 2026-10-13

- Card (fix, review of S31): Back and Escape no longer take keyboard focus from another control on the page when the card only has the pointer over it; focus moves to the sheet's control only if it was already in the card.
- Card (fix, review of S31): on a tablet, Back or Escape from the Floor level to the rail keeps keyboard focus, on the rail's open button, instead of dropping it.
- Card (fix, review of S31): the ⋯ menu is never taller than 70 % of the screen, 520 px or the room below its button on screen, whichever is least, and scrolls inside that. A card taller than the screen (a tablet with a tall plan) used to let it run off the bottom.
- Card (fix, review of S31): Escape does what Back does at every width. With a room picked, Escape goes up to its floor, and a second Escape to the Overview; on a tablet it used to jump straight to the Overview. Escape also moves focus to the sheet's own control, as Back does.
- Card (fix, review of S31): on a tablet the card no longer changes height when the side sheet opens or closes. Its height comes from the plan at the sheet's resting width (open from 900 px, the rail below it); a pick never changes it, and the plan has no empty band under it while the sheet rests open.
- Card (S31.11): docs and shots for the new frame. `docs/card.md`, `docs/SPEC.md` and the README describe the header, the side and bottom sheets, the ⋯ menu and the keys on the plan; `npm run shots` adds the phone at peek, half, full, room, Device and menu, and the tablet with the rail, the sheet, a room, the menu, the popup and the focus ring, in blueprint, light and HA dark.
- Card (fix): the pulse ring that marks a device found from the Overview or Search follows the device every frame while it shows. It was placed only after a render, so when the plan moved without one (a pan, a layout settling) the ring stayed up to 16 px off the icon.
- Card (S31.10): keys on the plan. The plan is one Tab stop (`role="group"`, "Floor plan, <floor>"); Tab in puts a ring on the device nearest the middle of the visible plan and a hidden status line reads "name, type, state". Arrows then move to the nearest drawn device that way on screen (a turned plan works; hidden devices are skipped), Enter or Space opens its popup (the Device level on a phone), Escape leaves the device, Shift + arrows pan. Without a device focused the arrows pan as before. A device off the visible part pans in; focus survives a `hass` update and is dropped by a floor switch, `setConfig`, a click on the plan and Tab leaving it. A key reaches only the focused card; a text field keeps every key.
- Card (S31.9): on a touch screen (`pointer: coarse`) every control is at least 44 x 44 px: header chips, floor tabs, Search and its field and results, the zoom cluster, the rail button, Back, the fold button, Overview rows, category and scene buttons, All off, popup buttons, Details and the colour bar, dialog buttons and check rows. A plain pointer keeps its sizes. The rules are in `src/card/touch-css.ts`; a spec walks every control in 25 states at 768 x 1024 and 390 x 844, so a new control fails until it is sized.
- Card (S31.8): under 640 px the Overview is a bottom sheet. It rests at a 64 px peek under the plan; a drag on its handle (pointer capture, a fling goes one stop) or a tap moves it between peek, half and full. Levels: Overview, Floor, Room, Device; a room, a device tap, a locate or Search opens it higher, and the plan pans so the room or device sits above the sheet. The device popup is the Device level inside the sheet and no longer floats on a phone. Back and Escape step up one level. The phone card's fitted height now counts the peek. The floating panel is gone.
- Card (S31.7): the card is never taller than the screen. In a parent with no height of its own (masonry, a stack, `rows: auto`) its height is the plan's height at its width plus the 52 px header, cut to the visual viewport less HA's `--header-height` and 16 px, and on a phone (under 640 px) at least min(that, 640 px); the plan letterboxes in what is left. It follows a window resize and the phone's address bar. A sections row, a panel view and a height set by hand on the card keep their own height as before.
- Card (S31.6): the header's ⋯ ("View options") is a menu that holds the look: View, Tilt (five presets), Walls, Floor below, Theme, Labels, Device names, Detail, Layers (a check per family, Alt shows one alone), Rotate left, Rotate right and Reset view. Each item writes what the old control wrote, into the same view memory. The toolbar, the Layers and Detail buttons and the stack's rotate and reset are gone; the zoom cluster keeps +, - and Fit (Reset camera in 3D). `view_switch: false` keeps Detail, Layers, Rotate and Reset; a kiosk has no menu unless `rotate_switch: true`.
- Card (S31.5): the chrome around the plan is a grid: a 52 px header (floor tabs, Search, View options), the plan as the stage, and from 640 px the Overview as a side sheet beside the plan (a 52 px rail when folded, open from 900 px, with Back and a crumb). The look controls wait in a View options box until S31.6. The overview can no longer be dragged (a stored position is ignored, the fold is kept). Under 640 px the floating panel stays until S31.8.
- Card: `src/card/frame.ts`, the frame's maths (not wired yet): side or bottom sheet by width (640), side width `clamp(260, 32 %, 320)`, card height fitted to the screen with a phone minimum, bottom-sheet stops (peek 64, half, full) and the snap rule (nearest; a fling over 0.5 px/ms goes one stop).
- Card (S31.3, not wired in yet): `<fp-menu>` in `src/card/more-menu.ts`, a menu button with an ARIA menu of radio, check and action items in labelled sections. Keyboard (Enter, Space, ArrowDown, arrows, Home, End, Escape, Tab), a press outside closes it, it opens under the button inside the card (a full-width panel under 640 px), items are 32 px, 44 px on a coarse pointer. A pick fires `fp-menu-pick`.
- Card (unreleased, S31.4): `src/card/plan-focus.ts` gives `nextInDirection` and `firstFocus` (nearest device in a 45 degree half-cone, cost along + 2 x across, ties to the lower index, junk skipped) and `planKeyFor` in `view-keys.ts` decides the plan's keys with and without a focused device. Not wired into the card yet; `viewKeyOf` and `viewKeyFor` answer as before.

## 0.28.1 - 2026-10-13

- Studio: doors are visible again. A door or glass door with no closed sensor is a hole in the card (0.12.x S25.D1), and the Studio has no live state, so every door there was an invisible gap. In the Studio alone such a door now draws a faint dashed guide line (`.door.guide`, thin, 55 % of --fp-door or --fp-glass). The card and 2.5D/3D keep the hole; a selected door, a window and the doorway kind look as before.

## 0.28.0 - 2026-10-12

- Editor state: `alignToBelow` applies the turn the search finds, preferring a small change from the floor's current turn; one undo step, none when the pose is unchanged, refused under Lock plan. On the hand-align house, Align then Apply on the ground and the first floor lands every outline corner within 2 cm and the turn within 0.2 degree.
- Core: `alignFloor(upper, lower, from = 0)` now searches the turn too. It tries every candidate turn, refines turn and shift together, and returns `{ turn, t, score, weak, alt }`: a far turn (more than 10 degrees from `from`) wins only by 25 points and not weak, ties go to the turn nearer `from`, and `alt` names the best other turn that fits nearly as well. `alignCandidates` and `chooseAlign` are exported. Callers that passed a turn now pass it as `from`.
- Core: Align reads the lower floor through an exact line index (a bucket grid), so a distance query looks at a few lines instead of all of them. Every answer is bit for bit what the scan gave (a recorded set of answers checks it); on the heavy stress floor the translation search takes about a tenth of the time.
- Core: `refinePlace` refines the turn and the shift together (robust weighted least squares, linearised about the placed lines' centre, the turn moving at most 2 degrees), so a candidate turn a fraction of a degree off ends within 0.05 degree and 0.5 cm.
- Core: `turnCandidates(upper, lower)` lists the turns worth searching, from the two floors' wall directions (modulo 90 degrees, 0.25 degree bins, at most 13 candidates); `alignShift` is 0.27.0's translation search under its new name. Test helper `tests/fixtures/align-turn.ts`.
- Core: `alignSummary` and `alignStatus` word the Align panel (match, weak, the other fit, the change from the current place, Apply's status). The Studio's Align panel uses them (see the Studio line below).
- Studio: Align finds the turn. The Auto align block says the change in words ("Turn 2.5° anticlockwise, move the centre 38 cm left, 90 cm down"), names another turn that fits as well ("A half turn (177.5°) fits about as well") and Apply writes the turn and the offset in one undo step. A move, a turn press or an undo does not search again; a changed wall does.
- Studio, Align (review fixes): short lines count when the turn is searched (a floor drawn with a click every 15 cm was missed), a weak answer no longer offers another weak fit as "fits about as well", Apply's status says "turned 2.5° anticlockwise" like the panel, and junk in the fits never throws.

## 0.27.0 - 2026-10-11

- Studio, Align to floor below (review fixes): a typed offset or rotation that would pass the coordinate limit now says so in the status line instead of reverting silently.
- Studio, Align to floor below (review fixes): the plan is read-only while Align is open. A press only pans, nothing is selected, dragged or deleted, Delete, Backspace, Ctrl+A, double click and the right-click menu do nothing (nor does the Outline's menu or Menu key, and an Outline click only centres, it selects nothing), starting a draw closes Align, and the Align keys never run in a draw or a text box. A device can no longer be dragged while Align is open.
- Studio, Align to floor below (review fixes): the rotation box turns the floor about the same pivot as the Turn buttons, so a typed angle no longer swings the floor about its stored origin. The offset and rotation boxes take decimals only (`3,5`, `-2.25`; not `0x10` or `1e3`), and a stored rotation of -180 is not rewritten as 180 by a no-op edit. Align stairs and a refused press say "Already aligned" when the pose does not change, and the limit message only when it does pass the limit.
- Studio, Align to floor below (review fixes): Align stairs and the stair list pick the same stair: the one below nearest to the stair above.
- Core: `floorShift` is gone; `floorPlace` (turn and shift) replaces it everywhere. Test-only: an end-to-end test aligns the stairs of the example three-floor house in the Studio, saves, and reads the file in the card: the stairs of every floor lie on the one below within 2 cm in 3D, and the ghost floor is drawn where the poses put it.
- Studio, Align to floor below: a Stairs section lists each stair of this floor with the nearest stair below (distance and angle, live on every press), and Align stairs lays the first stair of this floor on the nearest stair below in one undo step, saying what it did. Round stairs move and do not turn. On a coarse pointer every Align button is 44 px (a more specific rule had held the Move and step buttons at 32 px).
- Studio, Align to floor below: the arrow keys move this floor and `,` `.` turn it, by the chosen steps (a held key is one step; a text box keeps its keys; the arrows still pan outside Align). A rotation box takes typed degrees, and Reset zeroes the offset and the rotation in one undo step. Help lists the keys.
- Studio, Align to floor below: six buttons move this floor up, down, left and right (as drawn on screen, so a turned view still moves the right way) and turn it anticlockwise and clockwise about the centre of its structure, by steps you choose (1, 5, 50 cm; 0.1, 0.5, 1, 3 degrees; the choice is remembered in this browser). One press, one undo step. The floor below is drawn turned as faint lines, the plan shows only a cross at the pivot while the panel is open, and Apply keeps the floor's turn. Fixed on the way: a stored rotation such as 0.1 was written as 0.10000000000002274.
- 3D: the floors below turn with their `rotation`. Slabs, walls, stairs, crowns and contact shadows are placed by the turn and then the shift; the card gives the view `floorPlace`, so a change of rotation alone redraws the ghost and the floors below.
- The ghost floor can turn: `renderFloor`'s `ghost` takes a `turn` (degrees, clockwise) and places every point with it before the shift. No turn, or 0, draws exactly what it drew.
- A floor can carry a `rotation` (degrees, clockwise, about its stored origin, before the offset). The schema and `migrate` accept and check it; the card, the 3D view and the Studio draw floors with it, and the Align panel sets it.
- Core: pose helpers (`floorPlace`, `placePoint`, `composePlace`, `poseFromPlace`, `floorPivot` and friends) turn and shift a floor into another's frame, which the ghost, 3D and the Align panel use. Test fixture `hand-align-house.json`.
- Core: `stairAxis`, `stairReport` and `stairPlace` read the stairs of two floors and answer how far and how crooked they lie, and the place that lays one on the other (a flight drawn the other way round is matched too); the Align panel's Stairs section and Align stairs use them.
- Editor state: `setPose`, `nudgeFloor` and `turnFloor` write a floor's rotation (0.01 degree) and offset (0.1 cm, was whole cm) as one undo step each, from an exact session pose so many small presses do not drift. A new floor copies the lowest floor's rotation. The Align panel's buttons, keys and boxes call them.
- Align to floor below keeps the floor's turn: `alignFloor` takes a turn and searches with the floor's lines turned by it. Still translation only.

## 0.26.2 - 2026-10-11

- 3D: a stair going down shows when it lies on the edge of its room, across two rooms, or under a fill lying over the room. 0.26.1 cut the stairwell only where the flight lay strictly inside a room, so a flight that touched its room's edge (the usual case in a real house) stayed under the room fill. The slab and every room fill are now clipped to the flight's outline.

## 0.26.1 - 2026-10-11

- 3D: a stair going down is drawn again where nothing covers it. Since 0.26.0 the ground plane lay at the slab's bottom (25 cm) and a down flight sinks 60 cm, so most of it was under the ground. The ground now lies a centimetre under the deepest solid. A flight inside the house is shown too: the slab and the room fill now have a hole where a down flight stands (a flight that crosses a room's edge opens the slab and leaves that room's fill whole).
- Test-only: 66 end-to-end tests no longer fail on GitHub CI. They opened the File menu before clicking Undo, which is in the toolbar; on the runner's wider font Undo wraps under File and the open menu covered it. The overview-over-the-plan tests fold the overview first. No product change.

## 0.26.0 - 2026-10-10

- 2.5D door and window trim is drawn over the wall on both sides of the gap; the far jamb was half hidden by the wall after it.
- 2.5D door and window trim stands beside the gap, as in 3D, so a narrow window keeps its glass.
- 2.5D wall shadows reach the wall foot; a strip of bare floor showed under the wall face.
- A sealed panel has no frame in 3D either, as in 2.5D and the spec.
- 2.5D has contact shadows: a soft stepped band along both sides of every wall and a patch under every piece of furniture, appliance and device body, so things sit on the floor instead of floating over it. Baked, no blur, none at tilt 0.
- 3D has a ground plane under the house and soft contact shadows: a band along each wall foot, a patch under furniture, boxes and device bodies, and a soft ellipse under each tree. Never tappable, on every floor drawn. They are not sun shadows; nothing moves with the time of day.
- A tree on the plan is a crown, not a grey disc: an 8-lobed green outline over the garden, a trunk dot and a soft shade patch, in the card and the Studio.
- A tree in 2.5D stands: a 12 cm trunk rises to 60 % of its height, the crown hangs at 75 % and the shade lies at its foot.
- A tree in 3D has a crown: a faceted ball on a 12 cm trunk that ends at 60 % of the tree's height, also on floors drawn below. A tap on a crown reaches what is under it.
- A 3D crown is a round, slightly lumpy blob, no taller than it is wide, standing on 50 % of the tree's height where the trunk enters it. It was a tall pointed lens.
- 3D crowns are lifted toward white on a dark theme (`--fp-crown-lift`, 45 %), so they read against the ground at night, 1.8:1 at least in every theme. They sank into it.
- A 2.5D trunk on a dark theme is the crown's own fill colour (`--fp-trunk`), not a pale grey stick on a dark crown. Light themes keep the crown's edge colour.
- Doors, glass doors, windows, slits and full-height windows are framed in 2.5D and 3D: a jamb each side, a head, and a sill when raised, 5 cm wide and 2 cm proud of the wall. A tap on a 3D frame is a tap on the door. A closed 3D door leaf is quiet; red only when open or alarmed.
- 3D labels no longer pile on each other. When two would overlap, the more important one stays (a device icon, then a room name, a room readout, a device value, a device name; a room over a garden over water, a larger room first) and the other fades out in 120 ms. This happens when the view is still, never mid-drag.
- 3D walls take the theme's own side share (`--fp-wall-side-share`, as the 2.5D sides do), and a room or stair with its own paint is dimmed on a dark theme (`--fp-paint-dim`), as in 2D. Wall tops, sun faces and shade faces step apart by 6 % or more in every theme.
- The floor below dims at night with the rooms it lies on, in the card and in the Studio's Preview night; in a lit room it stays as by day.
- The Align tab no longer searches again on every offset nudge or undo; it searches when the outline, an external wall or the edge kinds change.
- Themes carry `--fp-tree`, `--fp-tree-edge`, `--fp-frame`, `--fp-shade` and `--fp-shade-alpha`. `npm run shots -- --polish` renders the polish set at 4x.
- Docs cover the 2.5D and 3D polish.

## 0.25.0 - 2026-10-10

- Floors have an offset. A floor may carry `offset: [x, y]` (cm): where it sits in the house, so upper floors can sit apart from the one below. Absent is `[0, 0]`; validation reports a bad value and opening a file drops it. The stored points never change.
- Studio: Floors menu with Add floor, Align to floor below, Move up, Move down and Delete floor. Add floor moved here from Edit, and a new floor takes the lowest floor's offset. The Draw menu is gone: Draw opening ends Openings, Wall holds a Draw submenu of the kinds, and Areas ends with Draw room, zone, water, outline and structure line.
- Studio: Align to floor below opens an Align tab. It lays the floor over the one below, which shows as faint lines, and says the match in per cent and the move in words ("137 cm left, 62 cm down"), or that the match is weak. Apply writes the offset in one undo step (refused under Lock plan, with Unlock offered). Two boxes set the offset by hand in cm, and Reset clears it. A smaller floor goes to the corner it sits in, to within 0.5 cm. A floor a few cm off is laid flush, and Apply says so when the offset would pass the 10 000 000 cm limit. The preview does not search while you drag something.
- Studio: View, Floor below draws the floor under the shown one as faint lines at its place in the house. Off by default, remembered in the browser, no undo step; disabled on the lowest floor.
- Studio: switching floors slides the plan in, up from above and down from below (220 ms), and does not move under reduced motion.
- Studio: a furniture piece's Lock can be ticked and unticked while the plan is locked, from the panel and from the context menu. Moving, resizing and turning it are still refused.
- Card: `ghost_floor: true` and a Floor below button in the view controls (2D and 2.5D) draw the floor under the shown one as faint lines, drawn over the room fills and under the walls. The viewer's button wins over the YAML and is remembered; the lowest floor has none. The config form has the checkbox.
- Card: `floors_below: off|ghost|solid` and a Floors below select beside Walls draw the floors under the shown one in 3D, translucent or in their own colours, at their own height and offset. Remembered per viewer; each floor keeps its own camera. The config form has the select.
- Card: switching floors in 2D and 2.5D slides the plan in, up or down with the stack (220 ms), and cuts under reduced motion and in 3D.
- Demo: a full-height window in the Kitchen east wall and four devices stacked on one spot in the Hall, for the window and the spiderfy fan.
- Docs and the Help guide cover floors: offset, Align, the ghost floor, floors below in 3D and the floor switch.

## 0.24.0 - 2026-10-10

- Studio: a disabled Undo or Redo is dimmed, and stays dimmed under the pointer.
- Studio: Escape cancels a drag of one device, or of several, at once, also while Help or Place is open; the device goes back, no undo step is left and the selection stays.
- Studio: a typed wall length goes along the exact 15 degree ray, also with the pointer close to the last point, and ends on whole centimetres.
- Studio: Escape during a drag of several devices cancels the drag and puts them back.
- Studio: a right-click on an Outline row of a selected group keeps the group and gives the same menu as the plan.
- Studio: a disabled button (Link 0, Show all) is dimmed and shows a not-allowed cursor.
- Studio: Controlled by on several devices counts only the lights that change, and says "Nothing to bind" when none would; the heading and Delete count the same devices.
- Studio: a context menu opened near the foot of the window moves up to fit instead of shrinking to a short scrolling box.
- Studio: Help opens in the Add, Place and Link modes too.
- Studio: Link mode closes when the plan changes under it (a delete, an Undo, a Redo), so Apply can never bind lights you did not choose.
- Studio: a wall drawn on a 15 degree ray ends on whole centimetres.
- Studio: drawing a wall onto a corner joins it, also when the corner is off the 15 degree rays.
- Studio: Edit, Link lights to switches now previews first. A Link mode in the Inspector lists each unbound light with the switch it would get, in the selection, else the selected room, else the floor. Untick what should stay, Apply binds the rest in one undo step.
- Studio: a Lock box on a device, a piece of furniture and an unlinked appliance. On a wall, door and opening it now reads "Lock (keeps its length)".
- Studio: menus tidy up. Opening a submenu closes its siblings; a menu box takes the room below its button and scrolls past it. Add holds only buttons and submenus (Furniture and Unlinked device are submenus now; furniture reads "Patio, wood"). View has one Labels submenu, and the version moved to the Help panel.
- Studio: Undo, Redo, Save and Fit to window show their key at the right edge, for the platform (⌘Z on a Mac, Ctrl+Z elsewhere).
- Studio: "Fix plan" is "Lock plan". A neutral pill with a lock reads "Plan locked" or "Plan editable"; the warning colour shows only on hover.

- Studio: one context menu per object on the plan. A right-click on a device, a multi-selection, stairs, a line, a door, an opening, a wall, furniture, a room or the empty canvas opens a menu in the same order. Device and selection menus offer Lock (a locked device does not move when dragged), Delete, Controlled by..., Select same type and Hide this type; the canvas offers Add device here..., Select all devices and Zoom to fit; a room offers Select devices inside. A wall's Add an opening is now Add door, Add window and Add opening; Fix is now Lock.
- Studio (internal): pure bulk edits for devices (bind lights, remove, move, lock), ready for multi-select. No visible change yet.

- Layout: a device may carry `locked: true`, so it will not be moved by a drag. The file check refuses a value that is not true or false.
- Studio: Fix plan holds geometry only. With it on, names, titles, colours, textures, areas and entity links can still be edited (one undo step each); corners, walls, doors and windows, kinds, heights, stairs and furniture stay refused.
- Studio (core): the plan can draw a multi-selection of devices, each with the selection stroke, even on a hidden layer. Nothing in the Studio selects more than one yet.
- Studio: one context-menu model (`ctxItems`) lists what a right-click offers on each of the twelve targets, in one order. Not wired into the menus yet.
- Studio (internal): `snapRay` puts a drawn point on the nearest 15 degree ray from the last point. Not wired to the pointer yet.
- Studio (internal): `Draw` keeps a typed length ("350" cm or "3.5m") and `placeTyped` adds the next point that far along the pointer direction. Not wired to the keys yet.
- Studio: select many devices on the plan. Shift+click toggles any device in or out of the selection (it was lights and motion sensors of one kind); Shift+drag from the plan draws a dashed rectangle and adds every drawn device inside it, also with the view turned; Ctrl or Cmd+A selects every drawn device on the floor; Escape clears the selection. A device on a hidden Layer is not taken. A plain drag still pans.
- Studio: a multi-selection moves and deletes as one. Drag any member and every unlocked member follows, in one undo step; Delete or Backspace removes them all, in one undo step. A locked device does not move, alone or in a group.
- Studio: the Inspector has tabs, Selection, Place and Add. Place devices (a room's Home Assistant area) and Add, Device open in the side panel instead of floating over the plan, so the plan does not move and the buttons stay in view.
- Studio: with several devices selected the panel counts them by type and offers Controlled by (binds every light to one switch, says how many others it left alone), Lock (ticked, unticked or half-ticked when mixed) and Delete n. Each is one undo step.
- Studio: the Outline offers the plan's context menu. Right-click a device or room row, or press the Menu key (or Shift+F10) on it, and the same menu opens as on the plan, with the same items in the same order.
- Studio: a status bar under the canvas reads the facts of the moment: what is selected, its room, the snap, the floor and the zoom ("4 selected · Living · Snap 10 cm · Ground · 100 %"). While you draw it shows the 15° step; with Alt held it says "Snap off"; a turned view says so; a locked plan says "Plan locked" with an Unlock button.

- Studio: one word, Lock. The banner after a refused edit reads "The plan is locked." with an Unlock button, the command list says Lock plan or Unlock plan, and no menu, panel, banner or message says Fix, Unfix or "length locked" any more.
- Studio: the guide has two new steps, drawing to a length (15 degree steps, typed lengths) and working on many devices at once.
- Studio: binding 20 lights to one switch takes three actions (Shift+drag over them, Controlled by, the switch), and one Undo takes it back. A test walks it with the real pointer.

## 0.23.1 - 2026-10-09

- Card and studio: a closed door or glass door is a thick line, 1.6 times the wall it sits in (never thicker than an external wall, so it stays flush there). It was as thin as the wall and read as a hairline. An open door is still a hole; windows, alerts and 2.5D are unchanged.

## 0.23.0 - 2026-10-09

- Card: at far zoom the dots and the room badges now read the same attention result as the Overview, Home Assistant's entity registry included. A Zigbee2MQTT contact whose battery is a separate sensor on the same device keeps its dot, and the Hall badge counts what the Overview lists.
- Card: a viewer's stored Detail pick no longer beats a card that became `kiosk` or whose YAML `detail` changed; both now start a clean memory.
- Card and studio: a door with one locked and one jammed lock is not drawn closed. The far attention dot has a thin ink outline, so it no longer reads as a lit lamp or an open cover.
- Card and Studio: semantic zoom, with a setting. Far out the plan shows rooms, room names and badges, and only the devices that are on, alerting or unavailable (as dots); closer in it adds the icons, closest the device names and readings. View, Detail in the Studio and a Detail button beside Layers in the card pick Auto, Full or Minimal, and each viewer's choice is kept in the browser. The card takes `detail: auto | full | minimal` in its YAML as the default (the Edit-card form has it); a viewer's pick wins. The card starts on Auto, so idle devices are not drawn until you zoom in or pick Full, except where the viewer could not do either: a kiosk card, or one with `active_list: false` and `zoom: false`, starts on Full. An explicit `detail` in the YAML always wins. The Studio starts on Full so that devices you place stay visible.
- Card: a state update rewrites only what changed. One lamp turning on touches its icon, its light and its room, not the other 400 devices; an update that changes nothing touches nothing. Icons keep their place in the page, so a fade or a glide now runs on the same element.
- Card: devices that overlap on screen can be told apart. A tap on a stack fans its members out in a ring, each with a line back to its true spot and its name; a tap on one of them opens that device's popup, Escape or a tap elsewhere folds the ring.
- Plan: the plan root carries `data-detail` (far, mid, near) from the zoom against the floor at fit. Far drops idle devices and keeps lit, alerting and unavailable ones as dots; far and mid drop device names and readings. A device Attention lists (an unlocked or jammed lock, an open contact, a leak, a low battery) stays a dot at far even when its state reads off.
- Card: names and labels keep their size on screen when you zoom in or out. They no longer grow with the plan; the 11 px floor still holds.
- Card and Studio: each room carries a small badge with what is on and what is wrong in it: lights on, alerts, open doors and windows, motion. It shows at far and mid zoom and keeps its size on screen when you zoom, like a room name.
- Card and studio: doors and glass doors lose the leaf line. An open door is a hole in the wall; a closed one, a thin line across the gap. A door is closed only when every contact sensor says off, or a lock says locked; a door with neither is a hole, and an unlocked lock alone does not close it. The red open alert is unchanged. In 2.5D and 3D the leaf and the glass follow the same rule.
- Card and studio: new door kind "Full-height window": a window from the floor to 40 cm under the ceiling, so a floor-to-ceiling window no longer needs a glass door.
- Studio: the glass door kind is now named "Glass door" in the type selector and the docs. The stored value is unchanged.

## 0.22.1 - 2026-10-09

- Card and studio: doors lose their swing arc. A door is the gap in the wall and its thin leaf into the room.

## 0.22.0 - 2026-10-09

- Card: low batteries show up as Home Assistant reports them. A Zigbee2MQTT `battery` attribute, a battery sensor or low-battery sensor placed on the plan, and the battery sensor of a placed device's own HA device all count. A home battery's charge still does not.
- Card: a home battery or car at 10 % no longer reads as a low battery on the switch or plug that shares its Home Assistant device. Only a battery sensor Home Assistant files as diagnostic counts there. A battery sensor in volts is not read as a percentage.
- Card: a jammed lock is in Attention, as "jammed".
- Card: a lamp that is on and low on battery stays under Active as well as in Attention.
- Card: the ring round a located device keeps its own animation; it shared a name with the Studio's ring.
- Card and Studio: closing the search with Escape gives the keyboard back. Before, the box kept focus inside Home Assistant and the next / typed a slash.
- Card and Studio: search finds "Søren" from "soren" and "Große" from "grosse": ø, ß, æ, ł, đ, þ and œ fold to plain letters.
- Studio: adding an appliance names its type as you read it in the menu: "Added UPS; hidden by Layers", not "Added ups".
- Studio: a click no longer picks a small TV, speaker or computer that Layers hides. It used to select the invisible piece and bring it back.
- Studio: a search for a TV or speaker whose id repeats on another floor now marks its own row in the Outline, not the other floor's.
- Card: a search at the top of the Overview, opened with ⌘K, Ctrl+K or / while the card is under the pointer or has focus. Enter on a device goes to it as a row tap does; on a room, opens the room; on a floor, shows it.
- Card: "Turn off on this floor…" lists what is on (lights with their relays, switches, plugs, media), grouped with counts and all ticked. One button turns off what stays ticked.
- Card: a Layers button in the Overview unfolds one chip per family on the floor (Lights, Climate, … Furniture). A click hides that family on the plan, Alt-click shows it alone. Each viewer's choice is remembered. Search still finds a hidden device, draws it, and offers Show.
- Card: the room and floor "All off" button now reads "Lights off", which is what it does. Scenes no longer has its own All off.
- Studio: Layers replace the Filter menu. A Layers tab beside Outline has one eye per family (lights, climate, security and the rest, plus furniture), with a count for the floor on show. A click hides a family, Alt-click shows only that one. The toolbar says what is hidden, and opens the tab. Search and the Outline still find a hidden device; the message offers Show.
- Studio: placing devices under a hidden layer no longer makes them vanish without a word: "Placed 4 devices; 3 hidden by Layers", with Show.
- Studio: a room's right-click offers what Place offers, without loose power sensors, scenes or batteries, each name with its entity id in small type. Sensor lists show the Home Assistant name, not the raw id. The area list shows an area once, and two of one name with their floor.
- Studio: find anything on the plan. Press / or ⌘K, type a few letters, Enter: the Studio switches floor, selects the device or room, centres it and rings it a moment. The same box runs a few commands (Fix plan, Draw room, Add device, Zoom to fit, Undo, Save).
- Studio: an Outline beside the plan lists floors, rooms and devices with counts, filters by name or entity id, and works with the arrow keys. Its last branch, "Unplaced from HA", lists what Home Assistant has that the plan does not, by area; a click starts adding it. The column folds to a thin rail and starts folded on a window under 1100 px.
- Card: the Active list is now the Overview. What needs attention comes first, with how long ago it changed; what is on follows by category. It lists the floor on show; "All floors" lists them all, each row with its floor. The header counts things in short chips ("2 alerts · 6 lights").
- Card: tapping a row in the Overview goes to the device: the plan switches floor, centres on it, rings it and opens its popup. In 3D it switches floor and opens the popup.
- Card: the small ▸ arrow on each row is gone. A device's details (maker, model, firmware, entity, last changed) are under Details in its popup.
- Card: floor tabs show how many things need attention ("Ground · 3") and turn orange while an alarm is triggered.
- Card: a lamp lit by its relay reads "on · via" the relay in every list, not off.
- Card and studio (groundwork): one search index over floors, rooms and devices. A query matches names, entity ids, rooms, floors and types, ignores case and accents, and ranks the exact name first.
- Card and studio (groundwork): one search box, opened with ⌘K, Ctrl+K or /. Arrows move through the results, Enter picks, Escape clears and then closes. Each result shows its room, floor and type.
- Card: the card file is a quarter smaller (109 to 84 KB gzipped). The build drops the code's comments and spaces; the panel (158 to 131 KB) and the 3D view (196 to 145 KB) shrink too.
- Card and Studio: a plan in another theme placed inside a solarized one keeps its own colour for garden, terrace, pavement and water names.
- Card: switching floors in 3D no longer stalls. Each switch compiled the 3D view's shaders again, which took most of a second on a slow tablet; the view now keeps them while it is open.
- Card: a door left unlocked is no longer called open. The room and floor facts read "Open" and "Unlocked" apart; "Unlocked" shows only where a door has a lock. The plan still draws both red.
- Card: cameras are no longer in the Active list. A camera is a view, not something switched on.

## 0.21.0 - 2026-10-08

- Card and studio: room names are solid, not faded. Each name is the text colour mixed into the room it sits on, at 12 px (outdoor names and zones at 10, outdoor in italic), in Home Assistant's own font. Readings keep their number and unit together and line up digit for digit.
- Card: on a phone, room names never drop under 11 px and device icons never under 28 px. A wide card looks as before.
- Card and studio: a room's name stays in its room. It slides beside an icon, shrinks, and when every spot is covered sits on a small plate over the icons.
- Card and Studio: dark themes no longer show empty rooms as light grey boxes. Empty rooms, midnight's garden, terrace and pavement, and furniture take the theme's own colours. Your own room paint is dimmed on dark themes, never changed. The checkerboard is softer.
- Card and Studio: doors and windows look like a floor plan. A door is a gap in the wall with a thin leaf and a swing arc into the room; a window is three thin lines across the wall. Glass doors and windows share one blue. Red still means open. Gardens, terraces, pavement and water lose their outline, and zones are a faint thin dash.
- Card and studio: a lit lamp's glow now looks like light. It is brightest at the lamp and fades to nothing at its edge, stays inside the lamp's room, and blends with the floor: it brightens a dark theme and tints a light one instead of laying a flat disc over it. In 3D on a light theme, the glow on the walls is a capped warm white instead of the lamp's colour, which washed pale walls out.
- Card and studio: a device whose entity is unavailable or unknown now has its own mark: a dashed orange ring, a grey glyph and a small slashed badge. This holds for lights, switches and plugs too, which used to look simply off. A lamp with a relay is marked only when both are dead.
- Card and studio: a device that is off is now its glyph alone, in a quiet grey, with no disc behind it. A device that is on is a solid disc in its colour, and the glyph on it is dark or light, whichever reads (at least 4.5:1 in every theme). A lit lamp's own colour, a plug's heat and a layout's own device colours get their readable glyph too. Blueprint's idle grey is no longer blue.

## 0.20.2 - 2026-10-08

- Card: a device popup now always opens where you can see it. On a card taller than the screen, a tap low on the plan put it below the bottom edge; now it opens above the point, and a very short window makes it scroll inside instead.
- Card: a lamp lit by the relay that powers it can now be turned off from the card. Its popup reads "on · via" the relay, and Turn off switches the relay off (and the light too if it is on). Room and floor All off also switch off such relays, each once. More info offers the relay next to the light.
- Card: when All off would switch off a relay that also powers a lamp outside the room or floor, its tooltip says so: "a shared relay also turns off lamps elsewhere".
- Studio: the Place and Add device popups fit the window. A long list scrolls inside the popup and its Place button stays in view; before, it could sit below the bottom of the screen.
- Studio: the side panel scrolls on its own, so the plan stays where it is. A room with Home Assistant devices left to place shows Place first, under its title.
- Studio: the Help guide names the buttons and menus as they are, shows them in bold, and starts with Fix plan.
- Studio: Escape closes an open toolbar menu and puts focus back on its button.
- Studio: an edit refused because the plan is fixed now puts the old value back in its field, and the message has an Untick Fix plan button.
- Studio: every change the fixed plan refuses now says so, with the Untick Fix plan button: a room colour or texture, a texture or furniture slider, a floor's name, order or removal, Add floor, Add stairs and Rotate the plan. Before, these did nothing without a word, and a picked colour snapped back silently.

## 0.20.1 - 2026-10-08

- Card and studio: a camera's cone stops at the walls of the room the camera stands in, as a lamp's light does. The room is the one the camera looks into, so a camera on a wall aiming out keeps its whole cone, as one in no room does.
- Card: a tap on a humidity, motion, contact or vibration device no longer offers a switch. Like temperature, they open the entity's details only. Before, one set to a switchable entity showed "Turn off".

## 0.20.0 - 2026-10-08

- Card: the room panel has an All off button. It turns off the lights of that room that are on, in one call, and is not shown when none is on. A lamp lit only by its bound relay is left out of the call.
- Card: a floor pill now also selects its floor and opens the side panel on it, as a room does: the lights on, every device, sensor and open door of the floor, and an All off for the whole floor. Picking a room, Escape, a tap on the empty plan, the x or the same pill again lets go. The pill of the selected floor gets a ring.

## 0.19.1 - 2026-10-07

- Card: the device colours picked in the studio (`colors` in the layout) now show on the dashboard, in 2D, 2.5D and 3D. Only the editor drew them before.

- Card: the hover tooltip goes when a zoom key moves its icon from under a pointer that did not move. It named an icon the pointer was no longer on.

- Card: a temperature device on a switchable entity (a thermostat, a plug) no longer offers Turn on / Turn off in its popup. It opens more-info only.

- Room panel: a tv, speaker or computer piece that shares its entity with a plug (in another room) now reads on or off by the plug's power, as the plan draws it. The row used the tv rule and could say on while the plan said off.

- 3D: a room that overlaps a bigger one always sits above it. A garden house or shed that stood more than 30 cm over the garden's border, half over it, turned, across a notch, or was bigger than the garden, had its floor hidden under the other; now it shows. Rooms that only share a border stay level.

## 0.19.0 - 2026-10-07

- Only a tv, speaker or computer takes the padded grab box in the editor; a small toilet, sink or shower no longer takes a click meant for its room. A wall or room edge within 8 px wins over a thin tv lying on it. An entity a piece already tracks is no longer offered to place a second time.
- The device type menu puts the most used types first (light, switch, motion, window / door sensor, temperature, speaker, TV), then a separator, then every other type A to Z. The device panel, the Add device filter and the Unlinked device list all use it.
- Siren and alarm are device types. A `siren.*` entity is placed as a siren and an `alarm_control_panel.*` as an alarm. A siren on is red (and sends rings, as before, when its entity is a siren). An alarm is red while armed, pending or triggered, grey when disarmed, and a tap opens more-info instead of toggling.
- A tv, speaker or computer piece that tracks a device (it has an entity) is drawn in the tv blue when idle, so it reads apart from a plain decorative one. On, it takes the on colour as before. Same in the card and the editor, in 2D and 2.5D.
- Add > Device places a tv, a speaker or a computer as the piece itself, not an icon: a media player Home Assistant calls a tv or speaker, and a catalog entry typed tv, speaker or computer. The piece tracks the entity, sits where a device would, is selected and moves like any furniture.
- A thin tv or a small speaker is easy to pick up in the editor: a piece under 28 px on a side takes the press from 8 px around it, and drags as before.
- Furniture is filled, not an outline: every symbol takes a body colour from the theme (light, dark and every theme), with the stroke kept as the edge. A piece with an entity that is on takes the on colour, body and edge.
- A tv or speaker piece whose media player is playing sends out the same two waves a speaker device does, in 2D and 2.5D, in the on colour.
- The computer is drawn as a desk seen from above, with a monitor, a keyboard and a case. New ones are 120 x 60 cm; computers already on a plan keep their size.
- In the card, a tv, speaker or computer piece that tracks a device acts like that device. It is listed under Active while on (a paused tv counts, as for the tv device), appears in its room's device list and can be put in a room scene, a tap or a click in 3D opens its more-info instead of picking the room, and hovering names it. In 3D it takes the linked colour at rest and the on colour when on. A piece with no entity stays part of the room floor.

## 0.18.2 - 2026-10-07

- 3D: a garden house or shed whose wall stands a few cm over the garden's border now shows its floor. It was hidden under the garden when a corner was just outside. A narrow room beside the garden still does not count as inside it.
- Fix plan no longer blocks scenes. Saving, editing or deleting a room's scene, and offering a Home Assistant scene, work while the plan is fixed. Before, Save closed the designer and stored nothing. A refused save now keeps the designer open and says why.

## 0.18.1 - 2026-10-07

- Popups (scene designer, Place, Home Assistant, Add device) open centred in the viewport and fit it, however far the page is scrolled. The scene designer's name box and Save were cut off before.
- Scene designer: Restore after a second Try still puts back what the device was doing before the first Try, even if the editor's copy of the state is stale. A light that was off no longer comes back on.
- Scene designer: a curtain, blind or garage door (the cover of a door or window) can be set to open, closed or a position. Thermostats are no longer offered; scenes that already hold one still run.
- Room panel: New scene is the highlighted button; "also offer" is now "Offer another scene" with a hint; the area's Home Assistant rows (devices, automations, scripts) sit in their own foldable section.

## 0.18.0 - 2026-10-07

- Scene designer: Try it sends the scene to the real devices; Restore puts back what they were doing before the first Try. Cancel, the X and Escape restore by themselves, Save does not. Needs the studio connected to Home Assistant with write access; without it the buttons are disabled and say so. A device Home Assistant refuses is named, and one with an unknown state is flagged as not restorable.
- Scene designer: Colours from a picture. Choose an image and the palette takes its main colours (up to 6, biggest first); Apply to lights deals them out. Read in the browser, nothing is uploaded, and the same picture always gives the same colours. A file that is not a picture is refused with a message.
- Scene designer: a palette of 2 to 6 colours. Apply to lights gives each ticked light that is on a colour, brightest colour first, dealt round in turn. The same palette always gives the same result. Switches and other types are left alone, and a light's kelvin is replaced by its colour.
- Editor, room panel: Scenes is now a list. Home Assistant scenes come first, marked (this area, or offered, with Remove); custom scenes follow with Edit (opens the designer) and Delete (one undo step). The inline per-light editor and Add scene are gone: New scene opens the designer.
- Editor, scene designer: the room panel's Scenes section has New scene and Edit in designer. A popup lists the room's lights, switches, fans, covers, climate devices and media players; tick, set on or off and the fields of each type (brightness, kelvin or colour for a light), name it and Save. Cancel, the X and Escape change nothing; Save is one undo step.
- Scenes: a scene item may now be a fan (speed), cover (position), climate (mode, temperature) or media player (volume, source), besides lights and switches. Files with these items validate; the card runs them. Turning a fan, climate or player off asks first.
- Editor, room panel: Identity, Sensors, Scenes and Appearance fold by their header; the choice is remembered in the browser.
- New: furniture `z`, the bottom of a piece above the floor. A TV hangs at 100 cm by default and a new `speaker` furniture piece stands at 100 cm; both editable in the panel (bottom, height, and an H × W × L readout), drawn lifted in 2.5D and 3D. Existing TV pieces move up to 100 cm unless you set the bottom to 0.

- Fixed: number boxes in the editor panels (furniture width and depth, heights) no longer lose what you type. A re-render (the 1 s motion fade, a Home Assistant update) used to reset a box you were typing in.
- Height boxes have up and down buttons and respond to the arrow keys: steps of 10 cm.

- Keys, card and editor: the four arrows pan, `+` and `-` zoom, `[` and `]` turn
  the plan 45 degrees, Space still resets. The arrows no longer zoom.
- Card, room panel: Scenes starts folded (its header opens it, and the choice is remembered), and "Active in this room" now sits between Scenes and Devices.
- Card: a tap on a device with a `media_player` entity (media, speaker, TV) opens that player's more-info at once, no popup.
- The editor's Help button is now "? Help" and opens with a controls table.

## 0.17.0 - 2026-10-07

- Card, studio: **Left and Right pan** the view a tenth of its width; they no longer turn the plan. The rotate buttons still do. In the card a key that cannot move anything (not zoomed in, or at the edge) is left to the page.
- Studio: messages are **banners at the top**, coloured by situation (blue info, amber warning, red error), with a close button, gone after 20 seconds. The text in the toolbar is gone.
- Studio: **Fix plan** is on when a plan with something drawn opens, and it is a red pill with a lock while on. Adding furniture while the plan is fixed shows a red banner. Open file replaces the whole plan, so it ignores the lock.
- Studio: with a room selected, a new furniture, object, device, door, zone or stairs is placed in the **middle of that room** (nudged 40 cm when something already stands there). Nothing selected: the old spots.

## 0.16.4 - 2026-10-06

- Card, studio, 3D: a light, switch or plug that is **unavailable or unknown is drawn as off**, no longer a dimmed ghost. Other device types keep the unavailable look.
- 3D: a room built against the edge of a bigger one (a garden shed on the garden's border) is lifted above it, so its **floor shows**.

## 0.16.3 - 2026-10-06

- Studio: furniture and unlinked objects (heater, speaker, TV...) have a **rotation slider**, any angle from 0 to 359, previewed live, one undo step per drag. The turn buttons stay.
- Card, studio: a **speaker or TV object** (Add > Unlinked device) with a `media_player` attached shows its state: two waves and its active colour while playing. A tap or hold on it opens that player's more-info instead of the popup. The attach list offers media players first. 2D and 2.5D; the 3D view does not draw the waves yet.
- Studio, room panel: the temperature, humidity and motion pickers each sit in a framed box with their list, and the sensor names are smaller. Humidity (and any other) sensors not yet on the plan are now listed under the floor and room of their Home Assistant area, like the others, instead of all under "Elsewhere". Delete is the first control under the name, in the door and window panel too.
- Studio: a page left open through an update no longer runs the old panel unnoticed. The panel asks the integration for the installed version (new `floorplan_studio/version` command) when it opens and whenever the tab becomes visible again; if it differs from its own build, a banner says so with a **Reload** button, and Save is refused until you reload. Pages that were open before this version do not have the check; it protects the updates after it.

## 0.16.2 - 2026-10-06

- Card, studio: a motion highlight now fades **120 s after motion ends** (the default `fade` was 300 s) and is then gone. Before, the fade counted from when the sensor turned *on*, so a long motion had no fade at all, and a room's own motion sensors (a garden's, say) had no timer, so their border could stay drawn until something else redrew the card. A sensor that stays `on` stays lit, as before. Set `fade` in the card to change it.
- Card, 3D: up to **32** lit lamps now get a floor pool and wall light (it was 8). With 8, a room full of lit lamps used every slot and the lit lights in other rooms showed no glow. Only lit lamps cost anything; a weak device can use 2D or 2.5D.

## 0.16.1 - 2026-10-06

- Wall kind **parapet** ("Balcony wall (parapet)"): a balcony's half wall, 120 cm tall and 20 cm thick like an external wall, in 2D, 2.5D and 3D. Draw it from the Draw wall and Add wall menus, or set it as the kind of a room or outline edge. A layout that uses it needs this version: an older card or studio rejects the layout, since it does not know the kind.
- Studio: a **Fix plan** checkbox in the top bar, before the status label. While it is ticked nothing of the plan changes (walls, rooms, doors, openings, stairs, furniture, floors, rotation, paint, Open and Reset), by drag, panel, menu or key; a press still selects so you can look. Lights and other devices stay fully editable: move, add, remove, attach. It is a view setting: not saved in the layout, and off again after a reload.

## 0.16.0 - 2026-10-06

- Card: the Active list and the room panel group their rows by category (lights, climate, security, media, power, covers, computers and network, sensors, people, other), always in that order. Each category header is a button that folds its group, from the mouse or the keyboard; the fold is remembered per card in the browser. Groups start open.
- Card: a plug is tinted by how much power it draws, from its power sensor: blue at 0 W, amber half way, red at 2000 W, in 2D, 2.5D and 3D and in every theme. The range is the card options `plug_heat_from` and `plug_heat_to` (also in the visual editor). The tooltip and popup already say the watts, so colour is never the only signal. A plug with no readable sensor keeps its colour; a card that does not use the feature draws byte for byte as before.
- Card: the view is remembered **per floor**. Zoom, the spot zoomed to and the turn in 2D and 2.5D, and the camera in 3D (angle, height, distance, look-at point), come back when you return to that floor and after a reload. Reset view and Reset camera forget the floor on show only. Browser storage only; with storage blocked a floor still remembers while the page is open. A turn used to be one for the whole card; an older entry moves to the floor it was saved on.

- Card: **room scenes**. With a room picked, its section lists scene buttons: the room's Home Assistant `scene.*` entities (by area; Hue scenes come this way), its custom scenes, then All off and All on. A tap is one `scene.turn_on`, or the light and switch services for a custom scene; All off and All on act on the room's lights only and do not ask, a custom scene that turns a switch off does.
- Layout: a room may carry `scenes` (up to 12, each a name and up to 40 lights or switches with on, brightness, kelvin, hs) and `haScenes` (extra `scene.*` entities to offer). Both optional, no schema bump; an older card ignores them. `validate` checks both.
- Editor: a *Scenes* section in the room panel: add, rename, set on or off and brightness, add and remove lights, delete, and offer a Home Assistant scene from elsewhere. One undo step each.
- Editor: the door type select says "slit window" (the stored kind is still `slit`).
- Window type **slit window**: its head now ends 40 cm under the ceiling of its wall, as a normal window's does (sill 90 + 120 high on a 250 wall), not at the ceiling. Default sill 150 and head 210 on a 250 cm wall; 200 and 260 on 300; on a wall too low for that it is as high as the wall allows (never below the floor, never over the wall). Height is still 60 and an own sill or height still wins. Slit windows already in a layout move down 40 cm: nothing is stored, so nothing needs migrating.
- Card: a tap no longer operates a device. On an icon, a door, an appliance or an Active-list row, in 2D and 3D, it opens a small popup with the name, the state, one primary button (Turn on, Turn off, Open, Close, Lock, Unlock) and More info. It closes on Escape, an outside tap or a second tap. A long press still opens more-info. Types without a toggle show name, state and More info only.
- Card: turning something OFF asks first (a confirm step in the popup), but not for lights, locks or covers. Media players and speakers have no on/off button at all (see docs/DECISIONS.md). Turning ON is immediate.
- Card: a light's popup has brightness, colour-temperature and hue sliders where the light supports them. One `light.turn_on` on release, none while dragging.
- Card: a mouse hover shows a tooltip with the name and the state, in 2D and 3D.
- Card: one state text for the plan, the popup and the tooltip. A room's mean humidity reads "48 %", not "48.0 %".
- Card: a lock's button now calls `lock.lock` or `lock.unlock` (the old tap called `lock.toggle`, which Home Assistant does not have).
- Layout: a device may carry `fx`, the size of its effect in percent (25 to 300, absent is 100). It scales a lit lamp's aura, a playing speaker's or media player's waves and a triggered motion or contact sensor's ring, in 2D, 2.5D and 3D (a lamp's floor pool and wall light too). Each type keeps its own base size; a layout without the field draws exactly as before. A value outside 25 to 300 is refused by validation and dropped when a file is opened.
- Editor: an "effect size (%)" field in the device panel, on every device that draws an effect. Empty is 100; one undo step.
- Card: a siren (any device whose entity is `siren.*`) that is on sends out two red rings, twice as far as a speaker's waves, on a thicker line and a faster beat; with reduced motion they hold still at twice the size. The effect size scales them too.
- Card: a tripped **open doorway** (`kind: open`: its contact is open, its lock unlocked, a vibration or its cover open) is now a solid band in the alert colour (`--fp-open-door`) across the gap in 2D, 2.5D and 3D: no dash, no pulse, no door look. In 3D, where the doorway used to show nothing, a thin glass-like slab fills the gap while it is tripped, and a tap on it works like a tap on any door. Closed it still draws nothing. A plain door keeps its dashed line and pulse.
- Card: **lower mount heights** in 3D and 2.5D. A ceiling light now hangs at 215 cm (was 250), a camera, motion sensor, radar and access point at 205 (was 230), an air conditioner at 195 (was 220), a cover motor at 175 (was 200), a thermostat, temperature and humidity sensor at 135 (was 150). An icon also stays 25 cm under the wall top (was 10). A device with its own mount height (`z`) keeps it; the editor's field shows the new preset.
- Card: **walls in 3D**. The `low` walls and the cutaway's lowered walls are now 110 cm high (they were 30), so a low wall still shows into the rooms but reads as a wall. One figure for both modes.

## 0.15.0 - 2026-10-06

- Card: floor textures in 3D. A room or stair with a texture shows it on its floor, at the same size, turn and scale as in 2D; the flat colour shows until the tile is ready. A bad texture id or rotation falls back to the flat colour.
- Card: a lit lamp now lights the walls of its own room in 3D, a soft glow in the lamp's colour out to about 3 m, only on faces that look at it and only up to the height the wall is drawn at.
- Card: a lamp's glow in 3D now lights only the stretch of a wall that is in its own room. A long outer wall shared by several rooms used to light by its middle point, so a lamp lit the neighbour's part of it or none of its own; a room nested in another is no longer lit through.
- Card: 3D shows one floor at a time. The dimmed stack of lower floors is gone (on a real layout the floors drifted out of line); the camera frames the floor you picked.
- Card: 3D icons no longer float over the house. A device's icon and its ball stay at most 10 cm under the top of the floor's walls (a ceiling light or camera at 250 cm on a 250 cm floor now sits at 240); a low device, a socket say, keeps its own height.
- Card: panning is back in 3D. Drag with the **middle mouse button**, or hold **Space** and drag with the left button (while the pointer is over the view; Space no longer scrolls the page there). Right-drag, Shift-drag and two fingers still pan; a plain drag still turns the house. A pan is never a tap.
- Editor: a room's Sensors add menu is grouped by floor and room ("Ground · Kitchen"), the room you are editing first, then its floor's other rooms, then the other floors. Typing still filters by floor or room.
- Editor: Remove on a room's sensor is a round red button with an X (still named "Remove ..." for screen readers and the tooltip).
- Door type **open doorway** (`kind: open`): a door that is only a hole in the wall. The wall is cut as for a door (210 cm high, width a to b, height and sill editable) and nothing is drawn in the gap: no line in 2D, no leaf in 2.5D or 3D. Unlike an Opening it is a real door, so it keeps a name, contact sensors, vibration, locks and a cover. Add, Openings, Open doorway, or right-click a wall, Add an opening. Closed it draws nothing; when its contact says open, or a lock is unlocked, it wears the usual dashed red line and alert pulse in 2D and the red frame in 2.5D (3D shows no state for it). In the editor it shows a faint outline only while selected or hovered. No schema bump (still version 2). **A layout that uses `open` is refused by a card older than this release** (`kind must be one of door, glass, window, sealed`): update the card before saving one.

- Window type **slit window** (`kind: slit`): a window 60 cm high that starts at the ceiling of the wall it sits in. Add, Openings, Slit window; its width is the Length field (a to b), height and sill are optional as for a window. Its default sill is read from the wall (250 cm wall: 190; 300 cm: 240; a wall under 60 cm gives a slit as high as the wall), an own sill or height wins, and the head never passes the wall. Glass in 2.5D and 3D, the same sensors, locks, curtain cover and tap as a window, and a thin band in the window colour in 2D. No schema bump (still version 2). **A layout that uses `slit` is refused by a card older than this release** (`kind must be one of door, glass, window, sealed`): update the card before saving one.

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
- Studio: drawing snaps the segment from the last point to a 15 degree ray (Alt: free). A corner or an alignment with an earlier point still wins. Type digits (or `3.5m`) while drawing: the length shows at the rubber band, Enter places the point that far toward the pointer, Backspace takes back a digit, Escape clears the typed value and a second Escape cancels the drawing.
- Studio: press `?` on the plan to open or close Help. In a text field it types a question mark.
