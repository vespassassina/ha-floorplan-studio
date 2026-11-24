# Sprint 51 — Dynamic scenes

## Goal
Extend the shared lazy scene editor (`src/card/scene/index.ts`) with multi-step dynamic scenes saved as Home Assistant `script.*` entities in the room's area, prioritizing native light effects (`effect_list`), enforcing a Zigbee traffic budget, and showing/stopping playing dynamic scenes on the card.

## 1. Steps, native effects, and Zigbee traffic budget (`src/card/scene/index.ts`)
- **Mode toggle**: Static (`scene.*`) vs Dynamic (`script.*`) inside the shared scene editor popup (`floorplan-studio-scene-<hash>.js`, zero runtime imports, 0 extra bytes in card language chunks).
- **Steps**: each dynamic scene is an ordered list of steps (`DynamicStep`: `items: SceneItem[]`, `duration: number` seconds, optional `transition?: number` seconds), with `loop: boolean` (play once or loop). Selecting a step updates the magnified WYSIWYG `renderFloor` preview and device controls for that step.
- **Native light effects first**: `lightEffectsFor(targets, liveStates)` reads `attributes.effect_list` on lights in the room (e.g., `candle`, `fire`, `colorloop`) and offers them first as one-click chips (zero Zigbee loop traffic). `SceneItem` supports optional `effect?: string` on lights.
- **Traffic budget (`checkDynamicBudget`)**:
  - `MIN_LOOP_SEC_PER_LIGHT = 2`: in a looping scene, any step whose duration is under `2 s × number of lights in that step` is refused with the exact reason.
  - `MAX_CALLS_PER_MIN = 30`: any scene exceeding 30 service calls per minute is refused with the exact reason so it cannot flood the Zigbee network.
  - Maximum 20 steps; every step must have at least one item and non-negative finite duration (looping scenes require total duration > 0).

## 2. Running in Home Assistant as `script.*` (`haDynamicScriptPayload`, `saveHaDynamicScene`)
- Saves via `POST /api/config/script/config/<id>` (`id` prefixed `fp_dyn_`) with `alias`, `mode: "restart"`, and a `sequence` of service actions (`transition` applied per step) + `delay` steps (wrapped in `repeat.while` when `loop: true`).
- Polls `config/entity_registry/list` for `unique_id === id` and updates `area_id` (the room's HA area) and the `floorplan-studio` label via `config/entity_registry/update`.
- Admin-only writes; missing `script: !include scripts.yaml` (404/405/501) surfaces an actionable error naming `script: !include scripts.yaml`.

## 3. Showing and stopping a playing dynamic scene on the card
- `haScenesFor` (`src/core/room-scenes.ts`) includes `script.fp_dyn_*` entities in the room's HA area alongside `scene.*`, flagging `playing: true` when `state === "on"`.
- On the card (`src/card/room-scenes-ui.ts` & `src/card/overview/panel.ts`), a playing dynamic scene button is highlighted (`.fp-scene-play`) with a stop indicator (`■`), and tapping it calls `script.turn_off` to stop it (tapping when idle calls `script.turn_on`).
- Main card bundle remains `<= 138,000` B gzipped; `floorplan-studio-scene-<hash>.js` remains `<= 14,000` B gzipped with zero runtime imports.
