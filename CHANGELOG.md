# Changelog

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
