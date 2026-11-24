# Sprint 63: Scene round-trip editing and Hue scene migration

**Goal:** Let users load existing Home Assistant `scene.*` and `script.fp_dyn_*` entities back into the shared WYSIWYG scene editor to edit in place, and migrate Philips Hue scenes (`platform === "hue"`) into native Home Assistant scenes while optionally disconnecting (disabling) the original Hue scene entity in Home Assistant.

**Card byte budget:** `0 B` added to `floorplan-studio-card.js` and `0 B` added to all 9 language chunks (`floorplan-studio-lang-*`). All new code lives inside the lazy zero-import `src/card/scene/index.ts` chunk (`<= 14,000 B` gzip) and Studio (`src/editor/`).

---

## 1. Existing HA scenes & scripts discovery (`listRoomHaScenes`)
- Uses `hass.callWS({ type: "config/entity_registry/list" })` (cached per open editor session on `draft.haList`, loaded on open when `room.area` and `hass.callWS` are available).
- Filters to enabled (`!e.disabled_by`) entities in `room.area` matching:
  - `scene.*` (tagged `kind: "hue"` when `platform === "hue"`, else `kind: "scene"` with `configId = e.unique_id || e.entity_id.slice(6)`).
  - `script.fp_dyn_*` (`kind: "dynamic"`, `configId = e.unique_id || e.entity_id.slice(7)`).
- Display name comes from `e.name || e.original_name || hass.states?.[e.entity_id]?.attributes?.friendly_name || e.entity_id`.

## 2. Round-trip load (`loadHaScene`, `loadHaDynamicScene`)
- **Static HA scene (`kind === "scene"`):**
  - `GET config/scene/config/<configId>` returns `{ id, name, entities: Record<string, { state, brightness, color_temp_kelvin, hs_color, rgb_color, effect, transition, percentage, position, current_position, tilt, current_tilt_position, temperature, fan_mode, volume_level, source }> }`.
  - Pure parser `parseHaSceneConfig(cfg)` converts HA's `entities` map back into `{ name, items: SceneItem[] }` (clamping ranges and ignoring unknown/corrupt entries safely).
  - Sets `draft.mode = "static"`, `draft.haSceneId = configId`, `draft.name`, `draft.items`, `draft.replaceHueEntity = null`.
- **Dynamic HA script (`kind === "dynamic"`):**
  - `GET config/script/config/<configId>` returns `{ alias, mode, sequence }`.
  - Pure parser `parseHaDynamicScript(cfg)` detects `repeat: { while: ..., sequence }` (`loop: true`) or flat `sequence` (`loop: false`), splits on `delay: { seconds }` boundaries, and converts each step's service calls (`light.turn_on`, `light.turn_off`, `switch.*`, `fan.*`, `cover.*`, `climate.*`, `media_player.*`) back into `DynamicStepData[]` (`items`, `duration`, `transition`).
  - Sets `draft.mode = "dynamic"`, `draft.haSceneId = configId`, `draft.name`, `draft.steps`, `draft.activeStep = 0`, `draft.items = steps[0].items`, `draft.loop`.
- Errors on missing YAML / read-only / 404 show a clear status message in `#sceneError` without crashing.

## 3. Migrate from Hue & disconnect from HA (`migrateHueScene`, `disableHaEntity`)
- Hue scenes (`kind === "hue"`) are listed in the editor's **Existing & Hue scenes** bar (`#sceneHaBar`) with a **Migrate from Hue** button (admin-only when `canWriteHa`).
- Clicking **Migrate from Hue** on a Hue scene (`entity_id`, `name`):
  1. Calls `hass.callService("scene", "turn_on", { entity_id })` to activate the Hue scene on the room's lights.
  2. Waits briefly (`settleMs`, default `900 ms`, configurable for tests) so HA updates live light states, then runs `captureRoomItems(targets, hass.states)` to snapshot the room's lights into `draft.items`.
  3. Sets `draft.mode = "static"`, `draft.haSceneId = null` (creates a new native HA scene), `draft.name = hueScene.name`, `draft.replaceHueEntity = hueScene.entityId`, `draft.disableHueOnSave = true`, and shows a status note so the user can review/tweak or re-capture before saving.
- **Disconnect Hue scene checkbox (`#sceneDisableHue`):**
  - Shown whenever `draft.replaceHueEntity` is set: *"Disable Hue scene `<entity_id>` in Home Assistant after saving"*, checked by default.
  - On **Save to Home Assistant**: after `saveHaScene(...)` succeeds, if `draft.disableHueOnSave` is checked, calls `disableHaEntity(hass, draft.replaceHueEntity)` → `hass.callWS({ type: "config/entity_registry/update", entity_id, disabled_by: "user" })`.
  - Reversible anytime in HA Settings → Devices & services → Entities. Does not modify or delete anything on the Philips Hue bridge.
  - If disabling fails, the newly saved HA scene is kept and a clear warning is surfaced.

## 4. Done criteria
1. `parseHaSceneConfig` and `parseHaDynamicScript` round-trip every supported domain and field (`brightness`, `kelvin`, `hs`, `effect`, `transition`, `percentage`, `position`, `tilt`, `hvac`, `temperature`, `fan_mode`, `volume`, `source`, multi-step `duration`, `transition`, `loop`) and never throw on hostile/malformed inputs.
2. `listRoomHaScenes` separates native HA scenes, `script.fp_dyn_*` dynamic scenes, and Hue scenes (`platform === "hue"`) for the room's area, ignoring disabled entities and other areas.
3. `disableHaEntity` calls `config/entity_registry/update` with `disabled_by: "user"` and rejects non-admin callers.
4. Both Card and Studio scene editors render `#sceneHaBar` when existing/Hue scenes are loaded, allow loading any native HA scene or dynamic script for in-place edit, and allow migrating a Hue scene with the disconnect checkbox.
5. `npm run lint`, `npm test`, `tests/card/size-budget.spec.ts`, `tests/card/card-room-scenes.spec.ts`, and `tests/editor/scene-designer.spec.ts` all pass, with `floorplan-studio-card.js <= 138,000 B` gzip and `floorplan-studio-scene-*.js <= 14,000 B` gzip.
