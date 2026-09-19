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
6. **Organise** (panel only): create HA areas from rooms and zones, put devices
   into areas by placing them, make a light helper from a switch, make light
   and motion groups, link a switch or a motion group to what it turns on, set
   a schedule, and see everything HA holds in a room (helpers, automations,
   scripts, scenes). Basic control of the home from the plan, visually.

## Non-goals

- 3D, isometric views, rendering photos of the house.
- Replacing HA's more-info dialogs. The card opens them.
- Replacing HA's automation editor. The plan creates an automation and opens
  it in HA; HA is where it is finished and where it lives.
- Silent writes to HA. Every write is confirmed, labelled `floorplan-studio`,
  and never happens on load or save.
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
- `room.kind`: room, outdoor, fill, terrace, structure, zone, water. `room.area`
  is the HA area id; `name` is free text. A zone is a dotted subdivision inside
  a room (a reading corner, a kitchen in an open living room): no walls (`w`
  all false), may carry its own HA area. Water is a pool, pond or lake.
- `wall.kind`: wall (internal), boundary (dotted), external, fence, edge
  (outdoor boundary such as a property line).
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

- Toolbar: floor chips (plus "+" to add a floor), device filter, Names toggle,
  menus Add / Device / Group / View / File. Group and the organise controls
  exist only in the HA panel.
- Add: door, window, wall, structure, furniture (symbol picker), zone, water,
  stairs; Draw: room, zone, water, outline, wall of any kind, opening,
  structure line, by clicking points (double-click or Enter ends, Esc cancels).
- Device: entities not yet placed, grouped by type then area, with a search.
- Floors: add, rename, reorder, delete (never the last one).
- Selection panel per kind: corner, wall, door (name, kind, length, sensor,
  cover), room (name, area, label, kind), device (entity, length for heaters),
  furniture (symbol, size, rotation).
- Snapping: corners, T-snap onto edges with stitch, neighbour alignment, 5 cm
  grid; Alt disables; Shift unsnaps.
- Pan: drag background, or middle/right/Ctrl drag anywhere. Wheel zooms.
- Undo/redo, autosave in the browser, Open/Save file, Reset to stored layout.
- In HA: Load and Save go through the integration. Standalone: file only.

## Organise (panel only)

- Rooms and zones: "Create area in HA" when the plan's area id is unknown to
  HA; HA areas with no room are listed so they can be drawn.
- Devices: dropping one into a room offers to move its HA device (or entity)
  into that area. A device whose HA area differs from where it sits is marked.
- Switch or plug: "Create light from this switch" makes a Switch-as-X light
  helper, places it bound to the switch, and removes the switch icon.
- Groups: several lights or several motion sensors become a group helper. The
  Group menu dims everything not in the chosen group.
- Automations: a switch controls many targets; a motion group turns on a light
  group, off after N minutes; a device gets an on/off schedule. Each is created
  in HA, then HA's editor opens on it. One switch to one light is not an
  automation: it is the light helper above.
- Room box: for the selected room, everything in its HA area by domain, with
  Run on scenes, Edit in HA on automations and scripts, and "Add to area" for
  entities that have none.
- Every write: confirm dialog naming what will be created, label
  `floorplan-studio` on the result, and the note that HA cannot undo it.
- Look: the panel maps `--fp-*` to HA theme variables and uses HA's own form
  elements and pickers, so it follows the user's theme, light or dark.

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
