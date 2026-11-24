# Sprint 50 — The scene editor in the card

## Goal
Ship one lazy WYSIWYG scene editor popup shared by both the dashboard card (opened from a room's **Scenes** section) and Studio (replacing the S17 list-only popup), saving scenes as real Home Assistant `scene.*` entities in the room's area.

## 1. New per-item scene fields (`src/core/schema.ts`, `src/core/room-scenes.ts`, `src/editor/room-scenes-ops.ts`, `src/editor/scene-try.ts`)
- `SceneItem` gains:
  - `transition?: number` (seconds, `0..300`, lights only): passed as `transition` to `light.turn_on` / `light.turn_off` and stored on HA scene entity metadata.
  - `tilt?: number` (`0..100` %, covers only): calls `cover.set_cover_tilt_position` (`{ entity_id, tilt_position }`) and writes `current_tilt_position` in HA scene payloads.
  - `fan_mode?: string` (`1..80` chars, climate only): calls `climate.set_fan_mode` (`{ entity_id, fan_mode }`) and writes `fan_mode` in HA scene payloads.
- `SCENE_FIELDS` updated to include `transition` on `light`, `tilt` on `cover`, and `fan_mode` on `climate`.
- `validate()` checks numeric ranges (`transition` 0..300, `tilt` 0..100) and `fan_mode` length (1..80).
- `itemFromState()` captures `current_tilt_position` -> `tilt` and `fan_mode` -> `fan_mode`.

## 2. One lazy zero-import chunk (`src/card/scene/index.ts`)
- Built as `floorplan-studio-scene-<hash>.js` (marker `SCENE_EDITOR_CHUNK = "fp-scene-v1"`, cap `<= 14,000` B gzip, zero runtime imports; receives `{ html, nothing, unsafeSVG, renderFloor }` via deps).
- **Magnified room preview**: renders `renderFloor` cropped to the room's bounding box (with small padding) using a synthesized `StateOverlay` built from the draft's `items` overlaid on live states (WYSIWYG without touching the real house).
- **Tap on a device in the preview**: clicking any `[data-x]` device or `[data-d]` door/cover in the room preview selects it and focuses its in-place control panel (on/off, brightness, kelvin, colour, transition for light; position + tilt for cover; on/off for switch/plug; volume + source for speaker/media_player; hvac mode + target temp + fan_mode for climate; speed % for fan).
- **Capture the room now** (`#sceneCapture`): populates the draft from current live `hass.states` for the room's target devices.
- **Try it / Restore** (`#sceneTry`, `#sceneRestore`): runs `customCalls` against live devices, backs up pre-Try states, and restores on Restore or Cancel/Close (leaving devices as tried on Save).
- **Palette**: keeps the S17 colour palette + "Colours from a picture" + "Apply to lights".
- **English authoring UI**: like `config-editor.ts` and `three/`, the scene editor chunk is English so it adds zero bytes to the 9 card language chunks (staying under the 5,000 B cap on `lang-pl`).

## 3. Saving as Home Assistant `scene.*` (`haScenePayload`, `saveHaScene`)
- Writes via `POST /api/config/scene/config/<id>` with `{ id, name, entities }` (mapping each `SceneItem` to HA's scene entity state + attributes: `state`, `brightness` 0..255, `color_temp_kelvin` / `hs_color`, `transition`, `current_position`, `current_tilt_position`, `temperature`, `fan_mode`, `volume_level`, `source`, `percentage`).
- After creation, polls `config/entity_registry/list` for `unique_id === id` and calls `config/entity_registry/update` to set `area_id` (the room's HA area when present) and add the `floorplan-studio` label.
- **Permissions**: admin only (`hass.user?.is_admin === true` + `callApi` present). Non-admins open the editor in read-only mode with **Try it** / **Restore** available and **Save** disabled with a note.
- **Missing `scene: !include scenes.yaml`**: if HA returns 404/405/501 or an error indicating scenes config is not writable, the editor stays open and displays an actionable message explaining to add `scene: !include scenes.yaml` to `configuration.yaml` and reload.
- **Legacy custom room scenes**: when a room has legacy `room.scenes` and admin HA write access is available, offers a non-silent **"Move custom scenes to HA"** button (`#sceneMigrate`) that writes each custom scene as an HA `scene.*` in the room's area (never silent). In standalone Studio (no HA connection), Save continues writing to `room.scenes` in one undo step.

## 4. Card & Studio integration and size budget
- **Card**: adds a small `.fp-scene-ed-btn` button inside the room **Scenes** section (`room-scenes-ui.ts`, not `.fp-scene` so existing scene button lists are unchanged; hidden in kiosk mode) and a lazy loader in `src/card/card-extras.ts`. Card bundle stays `<= 138,000` B gzip.
- **Studio**: replaces the S17 popup view with the shared `sceneEditorView` from `src/card/scene/index.ts`, passing Studio's `renderFloor`, live `hassStates`, and HA scene writer (falling back to layout `room.scenes` when offline/standalone).
