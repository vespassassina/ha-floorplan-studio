# Sprint 46 — The plan and Home Assistant agree

## Goal
Keep the floorplan layout and Home Assistant registries in sync from Floorplan Studio, with **0 card bytes** and **one-click admin confirmation** per registry write, and ensure the Studio fits cleanly at `1024 × 720` (`1024` wide, `< 800` high).

## 1. Pure sync analysis (`src/editor/ha-sync.ts`)
All discrepancy detection is pure and unit-tested, taking `(layout: Layout, ha: HaData | undefined)`:

### 1.1 Orphaned / renamed entities (`findOrphans`)
Walk every entity reference across all floors:
- `device.entity` and `device.attached[]`
- `room.temp`, `room.hum`, `room.power`, `room.water`, `room.scenes[]`
- `furniture.entity` and `furniture.attached[]`
- `unlinked.attached[]`
- `floor.sensors[]`

When `ha` is present and `ha.entities.length > 0`, any non-empty entity ID absent from `ha.entities` is reported as an `HaOrphan`:
- `floorKey`, `kind` (`device` | `room` | `furniture` | `unlinked` | `floor`), `index`, `field`, `entityId`, `label`
- `suggested`: if a unique entity in `ha.entities` of the same domain matches by slug/name or shares the same room HA area + domain + `device_class`, suggest it for 1-click replacement.
- Fixes (each 1 undo step in `EditorState`):
  - **Use `<suggested>`** (replaces all occurrences of `entityId` or the targeted field)
  - **Replace…** (domain-filtered entity `<select>` + **Apply**)
  - **Remove / Unlink** (clears optional sensor/link field, removes from `attached`/`scenes`/`sensors`, or deletes an orphaned `device`)

### 1.2 Area check (`findAreaChecks`)
- **Rooms with no HA area**: every room across all floors where `!room.area`:
  - If `ha.areas` already has an area matching `room.name` (case-insensitive): 1-click **Link `<area.name>`** (plan edit, 1 undo step).
  - Otherwise (when `writer` is available): 1-click **Create area in HA** (`writer.createArea(room.name)` + sets `room.area`).
- **Devices in wrong HA area**: every device inside a room with `room.area` where `areaMove(ha, entity, room.area)` reports a mismatch:
  - 1-click **Move to `<roomArea.name>` in HA** (`writer.setDeviceArea` or `writer.setEntityArea`).

### 1.3 Plan floors to HA floors (`findFloorChecks`)
For each plan floor `(floorKey, floor, index)`:
- Match `ha.floors` by `floor.title || floorKey` (case-insensitive).
- If no HA floor matches: 1-click **Create floor `<title>` in HA** (`config/floor_registry/create`, `name`, `level: index`).
- If an HA floor matches: check every room on that floor with `room.area` whose HA area has `floor_id !== haFloor.id`, and offer 1-click **Assign `<area.name>` to `<haFloor.name>`** (`config/area_registry/update`, `{ area_id, floor_id }`).

## 2. HA writer extensions (`src/editor/hass-write.ts`)
- `createFloor(hass, name, level?)` → `config/floor_registry/create`
- `setAreaFloor(hass, areaId, floorId)` → `config/area_registry/update`

## 3. Studio UI (`Edit > Check HA sync…`, `#haSyncPanel`)
- Opened from `Edit > Check HA sync…` (`#mEditHaSync`), from `#haPanel` ("Check HA sync…"), or `Cmd/Ctrl+K` command search.
- Floating draggable dialog `#haSyncPanel` listing Orphans, Areas, and Floors with a 1-click action per item, refreshing `haData` after HA registry writes.

## 4. Studio at 1024 × <800
- At `1024` px wide (e.g. `1024 × 720`), the top toolbar (`.bar`) stays on a single row without wrapping.
- At `< 800` px high (`1024 × 720`), the Align panel (`#alignPanel`) fits cleanly within the sidebar without clipping controls.
