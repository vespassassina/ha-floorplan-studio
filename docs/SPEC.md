# ha-floorplan-studio — specification

Draw your home inside Home Assistant, attach devices, use it as a live dashboard.

## Goal

A HACS package that gives Home Assistant users a floor plan editor and a floor
plan card. No external drawing tool, no YAML per element, no payment.

## Audience

Home Assistant users who can install HACS. No drawing skill assumed. A plan
starts from a photo of the architect's drawing, traced by an LLM with the prompt
in `prompts/`, then fixed in the editor.

## Scope

1. **Core** (`core/`): the layout schema, geometry (snap, stitch, merge), an SVG
   renderer, an icon set. Framework-free, used by both editor and card.
2. **Editor**: draw floors, rooms, walls, doors, windows, stairs, structures,
   furniture. Attach rooms to HA areas, devices to HA entities, contact sensors
   to doors and windows. Runs as an HA panel; also builds as a standalone HTML
   file for offline use.
3. **Card**: a Lovelace card that renders the layout and animates it from `hass`.
4. **Integration**: a small Python component with websocket `load` and `save`
   for the layout, so the editor and the card share one file under
   `.storage`.
5. **Prompt**: `prompts/trace-from-photos.md`, a prompt for Claude, ChatGPT,
   Gemini or Grok that turns photos of plans into a first `layout.json`.

## Non-goals

- 3D, isometric views, rendering photos of the house.
- Replacing HA's more-info dialogs. The card opens them.
- Editing HA areas, devices or entities. The editor reads them.
- Mobile-first editing. The card must work on phones; the editor is desktop.

## Layout schema v2

```json
{
  "version": 2, "unit": "cm", "north": 0,
  "floors": {
    "ground": {
      "title": "Ground",
      "outline": [[x, y], ...],
      "rooms":   [{"id", "name", "area", "label", "kind", "pts", "w"}],
      "walls":   [{"id", "a", "b", "kind"}],
      "stairs":  [{"id", "name", "pts"}],
      "doors":   [{"id", "name", "kind", "a", "b", "sensor", "cover"}],
      "openings":[{"id", "a", "b"}],
      "extras":  [{"id", "name", "a", "b"}],
      "devices": [{"id", "type", "entity", "x", "y", "bound"?} | {"id", "type", "entity", "a", "b"}],
      "furniture":[{"id", "symbol", "x", "y", "rot", "w", "h"}]
    }
  },
  "catalog": [{"id", "floor", "room", "type", "name", "entity"}]
}
```

- Units are cm, y grows downwards, north is up (`north` is degrees for the
  compass rose only).
- `room.kind`: room, outdoor, fill, terrace, structure. `room.area` is the HA
  area id; `name` is free text.
- `door.kind`: door, glass, window, sealed. `sensor` is a binary_sensor entity;
  `cover` is a cover entity for doors that HA can open.
- `device.type`: heater, light, switch, plug, temp, humidity, motion, contact,
  camera, climate, media, cover, other. Heaters have `a`/`b` (a bar), the rest
  `x`/`y`.
- `device.bound` (lights only, optional): the switch or plug entity that powers
  the same lamp. One icon on the plan, two entities in HA. `entity` stays the
  primary one. A bound entity may not be another device's `entity`, and no two
  devices share one.
- `furniture.symbol`: table, sofa, bed, cabinet, chair, sink, toilet, shower,
  bathtub, tv, computer, tree, patio-wood, patio-concrete, car.
- v1 files (no `version` or `version: 1`) are migrated on load.

## Card behaviours

| Entity domain / device type | Idle | Active | Click |
|---|---|---|---|
| light | grey icon | icon in the light's colour, brightness as opacity | toggle; long press: more-info |
| light with `bound` switch | grey icon | active when the light or the switch is on; unavailable only if every known state is | toggle the light entity; long press: more-info for it (the switch is reachable from that dialog) |
| switch, plug | grey | accent colour | toggle |
| binary_sensor on a door or window | door drawn normally | door drawn orange | more-info |
| motion (binary_sensor motion/occupancy) | grey | red, fading to grey over `fade` seconds from `last_changed` | more-info |
| temp, humidity (sensor) | value as a label next to the icon | — | more-info |
| climate (TRV, thermostat) | heater bar grey with target | orange when heating | more-info |
| camera | icon | — | more-info (live view) |
| cover on a door | door normal | door open state shown | confirm dialog, then `cover.open_cover` |
| media_player | icon | accent when playing | more-info |
| unavailable / unknown | icon struck through | — | more-info |

Rooms tint when any light in them is on (`room_glow: true`). Card config:

```yaml
type: custom:floorplan-studio-card
floor: ground          # or "all" with a floor switcher
fade: 300              # motion fade, seconds
room_glow: true
```

## Editor

- Toolbar: floor chips, device filter, Names toggle, menus Add / View / File.
- Add: door, window, wall, structure, furniture (symbol picker), device (only
  entities not yet placed, grouped by type then area).
- Selection panel per kind: corner, wall, door (name, kind, length, sensor,
  cover), room (name, area, label, kind), device (entity, length for heaters),
  furniture (symbol, size, rotation).
- Snapping: corners, T-snap onto edges with stitch, neighbour alignment, 5 cm
  grid; Alt disables; Shift unsnaps.
- Pan: drag background, or middle/right/Ctrl drag anywhere. Wheel zooms.
- Undo/redo, autosave in the browser, Open/Save file, Reset to stored layout.
- In HA: Load and Save go through the integration. Standalone: file only.

## Integration

- Domain `floorplan_studio`. Config flow, no options.
- Websocket: `floorplan_studio/load` → layout; `floorplan_studio/save`
  (layout) → ok. Stored in `.storage/floorplan_studio.layout`.
- Registers the editor panel (`/floorplan-studio`) and serves the card JS as a
  Lovelace resource.

## Prompt

`prompts/trace-from-photos.md` asks the LLM for: one known dimension for scale,
north direction, then a v2 layout with outline, rooms, doors and windows per
floor. Output only JSON. README explains the steps.

## Acceptance criteria

1. `npm test` passes: schema validation, v1→v2 migration, snap and stitch
   geometry, renderer snapshot for the demo layout.
2. The standalone editor opens by double-click offline and round-trips the demo
   layout without loss.
3. In a fresh HA (dev container), install via HACS, open the panel, load the
   demo, move a light, save, reload: the position persists.
4. The card shows the demo; toggling a demo light changes its icon within one
   state update; a demo door with a contact sensor turns orange when the sensor
   is `on`.
5. Motion fade: with `fade: 10`, a motion `on` shows red and is grey again
   after 10 s without a new trigger.
6. Prompt: on the maintainer's own photos, Claude produces a layout that loads
   in the editor with no schema errors.
7. No token, URL or personal layout in the repository.
