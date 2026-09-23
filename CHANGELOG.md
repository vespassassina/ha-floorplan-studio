# Changelog

## Unreleased

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
