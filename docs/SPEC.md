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
5. **Skill**: `prompts/SKILL.md` and `prompts/SCHEMA.md`, portable instructions
   any assistant (Claude, ChatGPT, Gemini, Grok, Copilot) can follow to turn
   photos, architect drawings or a sketch into a first `layout.json`, and
   `scripts/validate-layout.mjs`, the check it runs on its own answer.
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
      "outline": [[x, y], ...], "owk": ["external", ...],
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
  `colors.ac` is stored and valid but has no visible effect: the air
  conditioner's colours come from its state (`--fp-dev-ac-cool`, blue, and
  `--fp-dev-ac-heat`, orange), one knob cannot name two of them. Decided in
  S2.10; a cool and a heat knob can come later if anyone asks.
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
  zone is `boundary` on every edge. An edge can also be `none`: not drawn, and
  no white twin. The room stays closed, so area, snapping and hit tests do
  not change. The card draws nothing there; the editor draws a faint dotted
  guide so the edge can be picked and brought back. Delete in the edge panel
  sets `none` on every room that shares the edge; a door or window on it asks
  first and stays.
- `floor.owk` (optional) is the kind of each outline edge, one entry per point,
  same meaning and order as `room.wk`: the edge from `outline[i]` to
  `outline[i+1]` is `owk[i]`. Missing or short, `migrate` fills it with
  `external` for every edge, at v1 and at v2, so an old file gains a proper
  perimeter; a stored `owk` whose length does not match `outline` is refused.
  The outline keeps bounding the house whatever the kinds are: the view box,
  content bounds, area and snapping ignore it. A perimeter edge is selectable
  and editable in the editor exactly like a room edge, kind select and orange
  Delete included, even where no room's own edge spans it (S1.52). The demo
  shows external walls where the house meets outside.
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
  steps and is derived, never typed: one per 40 cm of the long side (a round
  stair: of the mean circumference), at least 2, at most 40; `migrate`
  recomputes it and ignores a stored value that disagrees. `rot` the rotation in degrees. Stairs are placed on every floor at
  the same position.
- `door.kind`: door, glass, window, sealed. `sensor` is a binary_sensor entity;
  `cover` is a cover entity for doors that HA can open.
- `device.type`: heater, light, switch, plug, temp, humidity, motion, contact,
  camera, climate, ac, tv, computer, media, cover, battery, inverter, server,
  access_point, other. Heaters have `a`/`b`
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

Every wall and edge line has a white twin under it, so a dark line stays visible on a dark floor.
Every text on the plan (room, zone, device and extra names, values, edge lengths) is dark grey (`--fp-text`, #3a3a3a) with a white outline (`--fp-outline`), on any background.
Every device icon sits on a white disc at 75 % alpha with a 1 px grey border,
three units wider than the icon, and is drawn
above everything else on the plan, room names included. A room name that would
sit under a device moves down, or up, by 32 units; if both spots are taken it
stays where it is. When a device is active, the icon and its halo (the disc)
take the colour of its type (S2.9): one `--fp-dev-<type>` variable per type,
set on the device group as `--fp-dev` when it carries the `on` class and read
by both the icon fill and the halo fill (the halo keeps its 25 % alpha). A
switch or a humidity sensor falls back to idle grey, so those two look the
same on and off. A contact device draws red whether it is a device icon or a
door sensor. An unavailable device keeps its struck-through, 45 % opacity
styling regardless of the colour rule. The camera cone stays at 25 % alpha,
its own grey. A room with an `entity` (never a room with an `area`) draws an
outline in `--fp-active` while that entity is on, open or playing; the fill
never moves. An earlier version tinted the fill instead, mixing 25 %
`--fp-glow` into the room's own kind colour, but a fill has to compete with
a colour that already carries meaning: mixing a pale warm yellow into a pale
cool blue desaturates rather than brightens, so an "on" pond read as a
duller, greyer blue than an "off" one — confidently wrong, not obviously
wrong. An outline never fights the fill, shows on every kind including
`zone` (whose fill is `none`, so a fill tint there was a silent no-op), and
reuses `--fp-active`, the same token furniture already wears when on, so
"on" is one colour across the whole plan. Because a room's own boundary is
almost always also a wall, and a wall's white halo paints on top of the room
along that same line, the outline is drawn a second time after every wall
line, so it is actually on top and visible rather than hidden under the
wall's own stroke. A piece of furniture with an `entity` takes `--fp-active`
(an amber tuned per theme for contrast) so it reads as more present, not
fainter, when it is on. `room_glow` (below) keeps the fill-mix mechanism: it
is a distinct signal, light spilling into a room, and a warm tint is the
honest metaphor there.

| Entity domain / device type | Idle | Active | Colour | Click |
|---|---|---|---|---|
| light | grey icon | yellow icon and halo, brightness as opacity, plus a round aura 200 cm across in the same colour at 25 % alpha | `--fp-dev-light` (#e0a800) | toggle; long press: more-info |
| smart light (`rgb_color`) | grey icon | icon, halo and aura in the light's own colour from HA, yellow when it reports none | the light's own `rgb_color`, or `--fp-dev-light` | toggle; long press: more-info |
| light with `bound` switch | grey icon | active when the light or the switch is on; unavailable only if every known state is | as light | toggle the light entity; long press: more-info for it (the switch is reachable from that dialog) |
| switch (wall switch) | grey | grey icon and halo, no brighter than off | `--fp-idle` (#8b8578) | toggle |
| plug | grey | blue icon and halo | `--fp-dev-plug` (#2c7fb8) | toggle |
| binary_sensor on a door or window | door drawn normally | door drawn red | `--fp-dev-contact` (#d64545) | more-info |
| contact (device icon) | grey | red icon and halo | `--fp-dev-contact` (#d64545) | more-info |
| motion (binary_sensor motion/occupancy) | grey | icon red, fading to grey over `fade` seconds from `last_changed`; halo red at once | `--fp-dev-motion` (#d64545) | more-info |
| temp, humidity (sensor) | grey icon, value as a label next to it | humidity: grey icon and halo, no brighter than off | `--fp-idle` (#8b8578) | more-info |
| temp or humidity sensor inside a room of kind garden | green icon (class `outdoor`, from the centre of the icon) | as its type | `--fp-dev-garden` (#3f8f4f) idle, as its type when on | more-info |
| heater, climate (TRV, thermostat) | heater bar grey with target; icon and halo grey | orange icon and halo when heating | `--fp-dev-heater` / `--fp-dev-climate` (#e8801a) | more-info |
| ac (air conditioner, heat pump, fan, air cleaner) | grey | blue while `hvac_action` is cooling, orange while heating, grey otherwise | `--fp-dev-ac-cool` (#2c7fb8) / `--fp-dev-ac-heat` (#e8801a) | more-info |
| tv | grey | blue icon and halo when the player is on or playing | `--fp-dev-tv` (#2c7fb8) | more-info |
| battery, inverter, server, access_point | grey icon on the round disc, `on` or off | grey, unchanged | — (idle grey `--fp-idle`; `layout.colors` can name one) | more-info |
| computer | grey | blue icon and halo | `--fp-dev-computer` (#2c7fb8) | more-info |
| camera | dark grey icon with a 120° cone of view in dark grey at 25 % alpha, turned by `rot` | — | `--fp-dev-camera` (#4a4a48) | more-info (live view) |
| cover on a door | door normal | door open state shown, orange | `--fp-open` (#f28c28) | confirm dialog naming the action, then `cover.open_cover`, or `close_cover` when it is already open |
| media (media_player) | grey | blue icon and halo while the player is playing (any other state, including paused, is idle) | `--fp-dev-media` (#2c7fb8) | more-info |
| cover (device icon, not a door) | grey | orange icon and halo while the cover is open | `--fp-dev-cover` (#f28c28) | more-info |
| other | grey | grey icon and halo, no brighter than off | `--fp-idle` (#8b8578) | more-info |
| room with `entity` | own kind colour, no outline | own kind colour, unmoved, plus an outline when the entity is on, open or playing | `--fp-active` stroke (#8a5117 light / #e0a800 dark) | none (S2.9 adds no click behaviour) |
| furniture with `entity` | idle grey (`currentColor`) | `--fp-active`, chosen per theme for at least 3:1 contrast against both `--fp-room` and `--fp-bg` | `--fp-active` (#8a5117 light / #e0a800 dark) | none (S2.9 adds no click behaviour) |
| unavailable / unknown | icon struck through, 45 % opacity | — | — | more-info |

Rooms tint when any light in them is on (`room_glow: true`). Card config:

```yaml
type: custom:floorplan-studio-card
floor: ground          # or "all" with a floor switcher
fade: 300              # motion fade, seconds
room_glow: true
theme: blueprint         # blueprint (default), light, or ha
```

`theme` is blueprint unless the dashboard says otherwise: a dark navy ground with blue linework. `light` is the paper-and-ink set. `ha` inherits the dashboard's own theme: ground from `--card-background-color`, rooms from `--secondary-background-color`, walls and text from `--primary-text-color`, measure marks from `--secondary-text-color`. Each has the plain light or dark set as its fallback, chosen by `hass.themes.darkMode`, so a dashboard that defines none of them still draws. Device and state colours (on, danger, warn, primary) never follow the dashboard: an amber light stays amber. The card ignores the OS colour scheme.

## Editor

- Toolbar: floor chips (plus "+" to add a floor), device filter, Names toggle,
  menus Add / Draw / Device / Group / View / File. Group and the organise
  controls exist only in the HA panel.
- Add places one finished item: door, window, opening, wall of any of the five
  kinds, structure, zone, stairs, furniture (symbol picker). Water is a room
  kind, not an Add item: draw it, or change a room's kind.
- Draw is its own menu: room, zone, water, outline, wall of any kind, opening,
  structure line, by clicking points (double-click or Enter ends, Esc cancels).
  Walls that close, a click back on the first corner after three or more,
  become a room (wall, external), a zone (dotted) or a garden (fence, edge)
  and the walls go. It has no HA area yet, is selected, and its name field
  has focus. One undo removes it. The perimeter outline is not converted.
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
  slide along their wall. A wall, an opening and an extra (the dashed named
  shape) also resize by dragging either end; a furniture piece (S1.51) has no
  such loose ends, so it is sized by its four corner handles instead (below).
- Everything can be rotated. A room or a zone that shares a corner with
  another shape cannot: unsnap it first (a button in its panel), which frees
  its corners from snapping. Rotating a room rewrites its points; a device,
  furniture or stairs keeps an angle in `rot`. Rotation is set with buttons,
  not a text field: 30, 45, 60 or 90 more degrees, clockwise or counter-
  clockwise (a toggle), and Reset to 0 (not for a room, which has no stored
  angle). Walls, doors and openings keep their angle field.
- View: rotate the whole plan in 45 degree steps, to line it up with north.
  View, Re-center: zoom and pan go back to show everything on the floor (rooms,
  stairs, walls, furniture, devices), not only the outline as Fit to window
  does; nothing is written to the layout.
  View, Device colours: one colour input per device type with a reset, and
  Reset all; each change is one undo step and is saved in `colors`.
  All floors turn together. Names and icons stay upright.
- Selection panel per kind: corner, edge and wall (length, angle, kind, and on
  a free wall the conversion to an opening), door (name, kind, length, sensor,
  cover), room (name or area, label, kind, colour, unsnap, rotation; the colour
  is a swatch of one of twelve floor materials, White ceramic, Marble, Sand,
  Terracotta, Light oak, Warm wood, Dark oak, Walnut, Light grey, Grey floor,
  Belgian stone or Lava, or any colour typed in), stairs
  (name, shape, steps shown read only, diameter, rotation), device (entity, rotation, length
  for heaters), furniture (name, symbol, size, rotation, entity).
- A selected piece of furniture (a table, a bed, a tree, a patio — never a
  device, a door, a window or stairs) also draws a small handle at each of its
  four corners. Dragging one resizes it: the opposite corner stays put, Shift
  keeps the width/depth ratio the piece had when the drag started, the grid
  snap applies as elsewhere and Alt disables it. Width and depth are clamped
  to 5 to 2000 cm, in the drag and in the panel fields alike; a stored value
  outside that range is refused. (S1.51)
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
- Measure grid: a faint 50 cm grid behind the plan, metres numbered along the
  top and left edges, turning with the plan while its numbers stay upright.
  On a huge floor the step grows to 100 or 500 cm so no axis needs more than
  400 lines. A chip in the View menu, next to Grid; kept in the browser, not
  in the layout, and never an undo step.
- Theme (S1.53, reworked S2.12): every colour in `FLOORPLAN_CSS` is a `--fp-*`
  custom property. Three themes. **Blueprint**, the default and the base
  selector: ground `#0d1522`, room fill `#14213a`, walls `#8fb4f0`, ink
  `#d8e2f2`. **Light**: ground `#f4f0e6`, room fill `#e9e3d3`, walls
  `#2b2a27`. **Home Assistant**: the neutrals are `var(--card-background-color)`,
  `var(--secondary-background-color)`, `var(--primary-text-color)` and
  `var(--secondary-text-color)`, each with the plain light or dark set as its
  fallback (dark when `data-mode="dark"`). A `data-theme` attribute, on the
  editor's own host or on one plan's root, picks one; none means blueprint. The
  OS colour scheme is not read by the card or the plan. The standalone editor
  page has a blueprint ground; the editor's `ha` theme follows the host's
  `haDark` property when the panel sets it, the OS when it does not. Device
  colours and the accent buttons (primary, warn, danger) keep the same hex in
  every theme: each already clears 4.5:1 against the theme-invariant text
  tokens `--fp-on-dark`/`--fp-on-light` it is paired with (orange was tried for
  primary and failed 4.5:1 with white text). A three-way chip (Blueprint /
  Light / Home Assistant) in the View menu, default Blueprint, kept in the
  browser under `floorplan-studio:theme`, never in the layout and never an undo
  step; a blocked store, an unknown value, or an old `auto` or `dark` falls back
  to Blueprint. The editor's own chrome follows the same theme as the plan, and
  every button keeps its 4.5:1 contrast (S1.40) in all three. A per-room colour
  keeps its own hue in every theme; only the room's name ink/outline flips to
  stay readable. The card takes `theme` from its config.
- Undo/redo, autosave in the browser, Open/Save file. File, Reset erases the plan to a blank one (asks first, one undo step; in HA nothing stored changes until Save). File, Load demo puts the demo home in, only while nothing is drawn, so it never asks and never overwrites; it is greyed out otherwise with the reason. A blank plan is not a valid layout (an outline needs 3 points), so it cannot be saved until something is drawn, and a panel with nothing stored opens on the editor's own blank start.
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

## Skill

`prompts/SKILL.md` has the assistant ask first for one real measurement and for
north, work out the scale, draw outline, rooms, doors, windows and stairs per
floor in that order, and leave `devices` and `catalog` empty (a drawing holds no
entities). `prompts/SCHEMA.md` is the v2 format written for a reader. Before it
answers, the assistant runs `node scripts/validate-layout.mjs`, which wraps
`validate()` and adds three checks a model needs: units are centimetres, a room
lies inside the outline, a door lies on a wall. It ends with a short list of
everything it guessed. `prompts/README.md` explains loading it into each
assistant.

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
