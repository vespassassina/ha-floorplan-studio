# Changelog

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
