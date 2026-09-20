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
- Naming what Home Assistant already names. A floor, room or zone linked to HA
  takes its name from HA; the plan maps, it does not invent. Only a custom
  shape — a pond, a pavement, a structure, furniture, a zone with no area —
  carries a plan name of its own.

## Layout schema v2

```json
{
  "version": 2, "unit": "cm", "north": 0, "rotate": 0,
  "floors": {
    "ground": {
      "title": "Ground", "ha": "downstairs",
      "outline": [[x, y], ...],
      "rooms":   [{"id", "name", "area", "label", "kind", "pts", "wk", "color"?, "free"?, "entity"?}],
      "walls":   [{"id", "a", "b", "kind"}],
      "stairs":  [{"id", "name", "pts", "shape", "steps", "rot", "dia"?, "inner"?}],
      "doors":   [{"id", "name", "kind", "a", "b", "sensor", "cover"}],
      "openings":[{"id", "a", "b"}],
      "extras":  [{"id", "name", "a", "b"}],
      "devices": [{"id", "type", "entity", "x", "y", "rot"?, "bound"?} | {"id", "type", "entity", "a", "b"}],
      "furniture":[{"id", "symbol", "x", "y", "rot", "w", "h", "name"?, "entity"?}]
    }
  },
  "catalog": [{"id", "floor", "room", "type", "name", "entity"}]
}
```

- Units are cm, y grows downwards, north is up (`north` is degrees for the
  compass rose only).
- `rotate` turns the whole plan on screen, in steps of 45 degrees (0, 45, …,
  315), so the drawing can be lined up with north. It is applied by the
  renderer around one pivot shared by every floor; the stored coordinates never
  change, and names and icons stay upright. Editor and card must show the same.
- `colors` (optional) is one colour per device type, `{ "light": "#e0a800", ... }`:
  keys are device types, values `#rrggbb`. The renderer sets each as
  `--fp-dev-<type>` on a group round the drawing, so the editor and the card
  use the same palette. Missing means the defaults; it is never invented.
- `room.kind`: room, garden, pavement, fill, terrace, structure, zone, water.
  `room.area` is the HA area id. A zone is a dotted subdivision inside a room
  (a reading corner, a kitchen in an open living room): every edge is a
  `boundary`, may carry its own HA area. Water is a pool, pond or lake. Fill is
  drawn grey with diagonal hatching: floor area that is not a usable room.
  `outdoor` is the old name of `garden`; `migrate` renames it.
- Home Assistant is authoritative for names. `floor.ha` (optional) is the HA
  floor id; when it is set, `floor.title` is the name HA gave that floor.
  When `room.area` is set and HA knows it, `room.name` is the name HA gave that
  area. Both names are stored, not looked up while drawing, so the card before
  `hass` has loaded and the offline editor never render blank. The editor
  refreshes them from HA when it has HA data (`applyHaNames` in `core/ha.ts`).
- A custom shape has no `area`: a pond, a pavement, a structure, a piece of
  furniture, a zone with no area. It keeps a plan name of its own (`room.name`,
  `furniture.name`) and may name one HA entity in `entity`, so the card can
  show that entity's state on it. Giving a room an area clears its `entity`.
  `validate` checks the shape of these fields and looks nothing up: it knows
  nothing of Home Assistant, and every one of them is optional, so an older
  file stays valid.
- `room.wk` is the kind of each edge, one entry per point, same order as `pts`:
  the edge from `pts[i]` to `pts[i+1]` is `wk[i]`. It replaces the booleans
  `w`, which `migrate` reads as `wall` for true and `boundary` for false. A
  zone is `boundary` on every edge.
- `room.color` (optional) overrides the fill of that room or zone. It is the
  one place a colour is stored in a layout, and it must be `#rrggbb`.
- `room.free` (optional): the user has unsnapped this room, so its corners are
  no snap, stitch or merge target and it can be rotated even where it still
  touches a neighbour.
- `wall.kind`: wall (internal), boundary (dotted), external, fence, edge
  (outdoor boundary such as a property line). The same five are the kinds of a
  room edge.
- `stairs.shape`: straight (a polygon with treads drawn across it) or round (a
  spiral of outer diameter `dia` around an empty well of diameter `inner`,
  treads drawn as spokes). There is no curved shape: an angled or curved
  flight is several straight sections placed end to end. `steps` is the number of
  treads, `rot` the rotation in degrees. Stairs are placed on every floor at
  the same position.
- `door.kind`: door, glass, window, sealed. `sensor` is a binary_sensor entity;
  `cover` is a cover entity for doors that HA can open.
- `device.type`: heater, light, switch, plug, temp, humidity, motion, contact,
  camera, climate, ac, tv, computer, media, cover, other. Heaters have `a`/`b`
  (a bar), the rest `x`/`y`. `ac` is an air conditioner, heat pump, fan or air
  cleaner; what it is doing comes from the entity, not from the layout.
- `device.rot` (optional, degrees): which way the device faces. Only a camera
  uses it so far, for its cone of view.
- `device.bound` (lights only, optional): the switch or plug entity that powers
  the same lamp. `entity` stays the primary one. Several lights may name the
  same switch: one wall switch can power several lamps. The switch may also be
  a device of its own on the plan.
- `furniture.symbol`: table, sofa, bed, cabinet, chair, sink, toilet, shower,
  bathtub, tv, computer, tree, patio-wood, patio-concrete, car.
- v1 files (no `version` or `version: 1`) are migrated on load. So are v2 files
  written by an earlier build: `outdoor` becomes `garden`, `w` becomes `wk`.

## Card behaviours

Every device icon sits on a small circle, grey at 25 % alpha, and is drawn
above everything else on the plan, room names included. A room name that would
sit under a device moves down, or up, by one line; if both spots are taken it
stays where it is. When a device is active the icon takes the colour of its
type and the circle takes the same colour at 25 % alpha. A custom shape with an
`entity` (a pond, a structure, a piece of furniture) is tinted while that
entity is on.

| Entity domain / device type | Idle | Active | Click |
|---|---|---|---|
| light | grey icon | yellow icon, brightness as opacity, plus a round aura 200 cm across in the same colour at 25 % alpha | toggle; long press: more-info |
| smart light (`rgb_color`) | grey icon | icon and aura in the light's own colour from HA, yellow when it reports none | toggle; long press: more-info |
| light with `bound` switch | grey icon | active when the light or the switch is on; unavailable only if every known state is | toggle the light entity; long press: more-info for it (the switch is reachable from that dialog) |
| switch (wall switch) | grey | grey | toggle |
| plug | grey | blue | toggle |
| binary_sensor on a door or window | door drawn normally | door drawn orange | more-info |
| contact (device icon) | grey | red | more-info |
| motion (binary_sensor motion/occupancy) | grey | red, fading to grey over `fade` seconds from `last_changed` | more-info |
| temp, humidity (sensor) | grey icon, value as a label next to it | — | more-info |
| temp or humidity sensor inside a room of kind garden | green icon (class `outdoor`, from the centre of the icon) | as its type | more-info |
| heater, climate (TRV, thermostat) | heater bar grey with target | orange when heating | more-info |
| ac (air conditioner, heat pump, fan, air cleaner) | grey | blue while `hvac_action` is cooling, orange while heating, grey otherwise | more-info |
| tv | grey | blue when the player is on or playing | more-info |
| computer | grey | blue | more-info |
| camera | dark grey icon with a 120° cone of view in dark grey at 25 % alpha, turned by `rot` | — | more-info (live view) |
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
  menus Add / Draw / Device / Group / View / File. Group and the organise
  controls exist only in the HA panel.
- Add places one finished item: door, window, opening, wall of any of the five
  kinds, structure, zone, stairs, furniture (symbol picker). Water is a room
  kind, not an Add item: draw it, or change a room's kind.
- Draw is its own menu: room, zone, water, outline, wall of any kind, opening,
  structure line, by clicking points (double-click or Enter ends, Esc cancels).
- A new item lands top right, outside the house, so it never hides what is
  already drawn; the view scrolls to it. A door, window or opening still lands
  on the wall nearest the middle of the view: it is of no use off the house.
- Device: entities not yet placed, grouped by type then area, with a search.
- Floors: add, rename, reorder, delete (never the last one). A new floor
  inherits the outline and the stairs of the first floor in the list. Stairs
  are added to every floor at the same position, and deleted from one floor at
  a time.
- Everything on the plan can be dragged by its body: rooms of every kind,
  zones, water, stairs, structures, furniture, devices. Doors and openings
  slide along their wall.
- Everything can be rotated. A room or a zone that shares a corner with
  another shape cannot: unsnap it first (a button in its panel), which frees
  its corners from snapping. Rotating a room rewrites its points; a device,
  furniture or stairs keeps an angle in `rot`.
- View: rotate the whole plan in 45 degree steps, to line it up with north.
  View, Device colours: one colour input per device type with a reset, and
  Reset all; each change is one undo step and is saved in `colors`.
  All floors turn together. Names and icons stay upright.
- Selection panel per kind: corner, edge and wall (length, angle, kind, and on
  a free wall the conversion to an opening), door (name, kind, length, sensor,
  cover), room (name or area, label, kind, colour, unsnap, rotation; the colour
  is a swatch of one of twelve floor materials, White ceramic, Marble, Sand,
  Terracotta, Light oak, Warm wood, Dark oak, Walnut, Light grey, Grey floor,
  Belgian stone or Lava, or any colour typed in), stairs
  (name, shape, steps, diameter, rotation), device (entity, rotation, length
  for heaters), furniture (name, symbol, size, rotation, entity).
- Names come from Home Assistant when the host gives the editor HA data (the
  panel does, the standalone build does not). The floor title, the room name
  and the zone name are then dropdowns: HA floors for the floor, HA areas for
  the room and the zone. Picking one writes the id and the name together. An
  area another room already uses is shown under "Already on the plan" and can
  still be picked; the status line says so. "(no area — custom)" makes the
  shape custom: a free plan name plus a dropdown of HA entities, "shows the
  state of". Furniture has the same pair. An id the layout holds and HA does
  not know keeps its place in the list, marked, and is never cleared. With no
  HA data every field is free text, as before.
- On load with HA data, the names of linked floors and rooms are refreshed from
  HA and the status line says how many changed. It is not an undo step. A room
  that is not linked is never renamed: when its name matches one HA area, the
  panel offers to link it, one click.
- A numeric field always shows what the layout holds: a value the editor
  refuses or clamps snaps back.
- Buttons that destroy something are coloured: Delete floor and Reset are red,
  every other Delete is orange. Their text meets WCAG AA (4.5:1) against the
  button colour.
- Snapping: corners, T-snap onto edges with stitch, neighbour alignment, and a
  grid of none, 5, 10 (the default) or 50 cm, chosen in the View menu and kept
  in the browser, not in the layout; Alt disables; Shift unsnaps for one drag; a room marked `free` never
  snaps.
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
