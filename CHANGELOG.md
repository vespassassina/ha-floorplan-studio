# Changelog

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
