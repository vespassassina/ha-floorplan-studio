# Changelog

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
