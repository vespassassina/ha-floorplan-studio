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
      "rooms":   [{"id", "name", "area", "kind", "pts", "wk", "color"?, "texture"?, "textureRot"?, "free"?, "entity"?, "temps"?, "humidity"?, "motion"?, "scenes"?, "haScenes"?}],
      "walls":   [{"id", "a", "b", "kind"}],
      "stairs":  [{"id", "name", "pts", "shape", "steps", "rot", "dia"?, "inner"?, "color"?, "texture"?, "textureRot"?}],
      "doors":   [{"id", "name", "kind", "a", "b", "sensor", "cover"}],
      "openings":[{"id", "a", "b"}],
      "extras":  [{"id", "name", "a", "b"}],
      "devices": [{"id", "type", "entity", "x", "y", "rot"?, "bound"?} | {"id", "type", "entity", "a", "b"}],
      "furniture":[{"id", "symbol", "x", "y", "rot", "w", "h", "name"?, "entity"?}],
      "trace"?:  {"src", "x", "y", "w", "rot", "alpha", "on"}
    }
  },
  "catalog": [{"id", "floor", "room", "type", "name", "entity"}]
}
```

- Units are cm, y grows downwards. `north` (degrees, 0 to 359, default 0) is the
  angle clockwise from the plan's up direction to true north: 0 means the top
  of the plan is north, 90 means north is to the right. It is in layout
  coordinates, before `rotate`, and it never moves a point. It places the
  compass rose (S15.3) and gives the sun its direction: the sun's compass
  bearing `azimuth` (from `sun.sun`) points, on the plan, at `azimuth + north`
  clockwise from up. Both the studio and the card draw the rose, from the same
  `renderFloor`, and it turns with `rotate`. The studio sets `north` (View,
  North, a number field, or by dragging the rose); one undo step.
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
  `room.area` is the HA area id. A zone is a dashed subdivision inside a room
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
- `room.color` (optional) overrides the fill of that room or zone; it must be
  `#rrggbb`. Stairs take `color` too.
- `room.texture` (optional, also on stairs) is one of `wood-light`, `wood-warm`,
  `wood-dark`, `stone-white`, `stone-grey`, `stone-bluegrey`, `stone-black`: a
  repeating pattern (boards 20 x 80 cm, tiles 50 cm). It wins over `color`; the
  editor removes one when it sets the other. The render writes only
  `url(#fp-tex-<id>)` from this fixed list and declares only the patterns in use.
- `room.textureRot` (optional, also on stairs, S4.22) is the texture pattern's
  own rotation in whole degrees, `[0, 360)`; it never appears without a
  `texture` and is dropped whenever the texture or colour changes. 0 (no
  rotation) is never stored — the field is simply absent. The editor's paint
  panel shows a slider once a texture is chosen; dragging it previews live but
  writes one undo step for the whole drag, same as a furniture corner drag. A
  hostile or non-finite value never throws: the render wraps it into `[0, 360)`
  and treats anything that is not a finite number as 0.
- `palette` (optional, top level) is a list of `#rrggbb`, at most 24: the custom
  colours used so far. The editor adds a colour picked on the free colour input
  when it is not one of the twelve built-in swatches, and offers the list as
  swatches on every room and staircase. Colours in `colors` (per device type)
  are separate and are not added to it.
- `room.free` (optional): the user has unsnapped this room, so its corners are
  no snap, stitch or merge target and it can be rotated even where it still
  touches a neighbour.
- `wall.kind`: wall (internal), boundary (no wall: the line between two rooms
  of an open plan), external, fence, edge (outdoor boundary such as a property
  line), parapet (a balcony's half wall: 120 cm tall, 20 cm thick as an
  external wall). The same six are the kinds of a room edge. A boundary is a
  1.5 cm dash (8 6) over its white twin. On a zone it is fainter: a 1 px dash
  (4 3) at 35 %, the same width at any zoom, with no twin (S23.7). A boundary
  edge of a garden, terrace, pavement or water draws nothing; the editor keeps
  its faint guide (S23.7).
- `stairs.shape`: straight (a polygon with treads drawn across it) or round (a
  spiral of outer diameter `dia` around an empty well of diameter `inner`,
  treads drawn as spokes). There is no curved shape: an angled or curved
  flight is several straight sections placed end to end. `steps` is the number of
  steps and is derived, never typed: one per 40 cm of the long side (a round
  stair: of the mean circumference), at least 2, at most 40; `migrate`
  recomputes it and ignores a stored value that disagrees. `rot` the rotation in degrees. Stairs are placed on every floor at
  the same position.
- `stairs.direction` (optional, `up`, `down` or `both`) is which way the flight
  goes from the floor it is drawn on. Absent means auto: up when a floor lies
  above, else down when a floor lies below, else up. So the top floor shows its
  stairs coming from below, with no edit; auto never gives `both`. Each floor
  keeps its own copy of a stair, so the field is per floor. 2D marks it with a
  chevron arrow along the flight (none for an up stair, so those draw as ever),
  and shades the treads for down. 2.5D: up is the rise; down is a stairwell, a
  sunken opening with treads below the floor and a short rim on the near edges;
  both is the rise with a low kerb round the foot. Resolver: `src/core/stairs.ts`.
- `door.kind`: door, glass, window, sealed, slit (a window 60 cm high, its head 40 cm under the ceiling of its wall like a window's, 2026-10-06; before that it touched the ceiling; shown as "slit window"), open (a doorway: a door's cut, nothing drawn while closed; tripped, a solid alert band in the gap in 2D, 2.5D and 3D, 2026-10-05, S14.5). `sensor` is a binary_sensor entity;
  `cover` is a cover entity for doors that HA can open.
- `device.type`: heater, light, switch, plug, temp, humidity, motion, contact,
  camera, climate, ac, tv, computer, media, cover, battery, inverter, server,
  access_point, other, person, radar, vacuum, speaker, siren, alarm. Heaters have `a`/`b`
  (a bar), the rest `x`/`y`. `ac` is an air conditioner, heat pump, fan or air
  cleaner; what it is doing comes from the entity, not from the layout. A
  `person` has a `person.*` or `device_tracker.*` entity. A `radar`'s own
  `entity` is its presence sensor (typically a `binary_sensor.*occupancy`,
  such as an mmWave sensor's own occupancy binary sensor). A `vacuum`'s own
  `entity` is its `vacuum.*` domain entity; it has no field of its own (S7.10).
- `siren` and `alarm` (S18.14, 2026-10-07). A `siren.*` entity is typed siren and an
  `alarm_control_panel.*` entity alarm when placed from a list (both were `other`). A siren is
  on while its entity is on; an alarm is on in every state but `disarmed` (armed_*, arming,
  pending, triggered), and `unavailable` stays unavailable. Both are drawn in `--fp-danger`
  when on. A tap on a siren offers on/off; a tap on an alarm opens more-info. The rings of
  the siren paragraph below still key on the `siren.*` entity, not on the type: a siren-typed
  device on a plain entity is red when on and draws no rings. No 2.5D solid; 3D draws the icon.
- `device.room` (person only, optional, S7.8): an entity whose state, or whose
  `area_id` or `area` attribute, names the room the person is in (a Bermuda or
  ESPresense area sensor). It must differ from `entity`. The card matches the
  name, ignoring case, against every room's `area`, then every room's `name`,
  and moves the icon there; no match, `not_home`, `unknown` or `unavailable`
  keeps the placed spot.
- `device.targets` (radar only, optional, S7.9): a list of `{x, y}` entity
  pairs, each two sensor entities of an mmWave radar's own tracked target
  (millimetres, `x` to the sensor's right, `y` ahead of it — an ESPHome
  LD2450's own convention). The card turns each pair by the radar's own `rot`
  and draws a dot at the resulting plan point, skipping a pair that is not
  finite (unavailable, unknown, or missing) and one that falls outside the
  floor's own outline. No limit on how many.
- `device.rot` (optional, degrees): which way the device faces. A camera uses
  it for its cone of view; a radar uses it to turn its targets (0 is "ahead is
  screen-up").
- `device.bound` (lights only, optional): the switch or plug entity that powers
  the same lamp. `entity` stays the primary one. Several lights may name the
  same switch: one wall switch can power several lamps. The switch may also be
  a device of its own on the plan.
- `device.power` (plugs only, optional): the `sensor.*` entity, device class
  `power`, that measures the plug. A plug is active only while it reads 2 W or
  more (card `plug_watts`). Must differ from `entity`. Unset, the editor fills
  it in when it places a plug whose HA device has exactly one power sensor,
  and the card does the same at runtime; with no sensor a plug is active
  whenever its switch is on. S14.8: the same reading tints the plug from cool
  blue through amber to red between the card's `plug_heat_from` (default 0 W)
  and `plug_heat_to` (2000 W), in 2D, 2.5D and 3D; no sensor, no tint.
- `device.fx` (optional, S14.3): the size of the effect the device draws, in percent of its
  type's own size: 25 to 300, absent is 100. A lit light's aura (and its floor pool and wall
  light in 3D), a playing speaker's or media device's two waves, a triggered motion or contact
  sensor's ring, and a siren's rings all scale with it; each type keeps its own base size, so
  100 is today's pixels and a layout without the field is drawn byte for byte as before. A
  device that draws no effect ignores it (`FX_TYPES` in `schema.ts` lists the types). `validate`
  refuses anything but a finite number in [25, 300]; `migrate` drops a value that is not. No
  schema bump: it is optional, and an older card ignores it.
- A **siren** is any device whose `entity` is in HA's `siren` domain, whatever its `type`. While
  it is on it sends out two rings in the danger colour, with twice the reach of a speaker's
  waves (4.8 against 2.4 times the icon at the end of the beat), a thicker line and a faster
  beat (1 s against 1.6 s). Under reduced motion the rings hold still at 3 times the icon, not
  1.5, so the siren still reads louder. `fx` scales it like the other effects.
- `device.motion` (lights only, optional, S8.7): the motion sensor or motion
  group entity this light was linked to through the editor's own "Turn on
  with... Create automation" flow. It records the link for the panel to show
  and unlink; the automation it names does the actual work, and unlinking
  removes only this field, never the automation in Home Assistant. Must
  differ from `entity`, same rule as `bound`.
- `furniture.symbol`: table, sofa, bed, cabinet, chair, sink, toilet, shower,
  bathtub, tv, computer, speaker, tree, patio-wood, patio-concrete, car.
- A **linked** furniture piece (S18.12, S18.15, 2026-10-07): a `tv`, `speaker` or `computer`
  piece with an `entity`. It tracks that device and acts as the device of the same type in the
  card, with no new field in the file. Idle it is drawn in `--fp-dev-tv`; on, in `--fp-active`
  (a tv or speaker that is `playing` also sends out two waves). On follows the device rule of
  its type: a paused or idle tv is on, a speaker only while `playing`, unavailable never. A
  piece whose entity a plug device also uses follows the plug's power rule. In the card it is
  listed under Active while on, has a row in its room's device list, can be put in a room
  scene, and a tap or a long press opens the entity's more-info (never a toggle); hover names
  it. In 3D it is its own mesh in the linked colour, then the on colour. A piece with no
  entity stays part of the floor. In the editor, Add > Device places a `media_player` that HA
  calls a tv or speaker, or a catalog entry typed tv, speaker or computer, as the piece itself.
- `floor.trace` (optional, S7.11) is a scan to trace over, drawn under the
  plan in the editor only; the card never draws it. `src` is a
  `data:image/png`, `jpeg` or `webp` base64 URL of at most 4 MB (`validate`
  names the limit when it is over). `x`, `y` is the top-left corner in cm, `w`
  the width in cm (the height follows the image's aspect ratio), `rot` degrees
  in `[0, 360)` about `x`, `y`, `alpha` the opacity in `[0, 1]`, `on` whether
  it is shown. File, Export leaves it out unless Include trace image is ticked.
  An assistant never writes one.
- v1 files (no `version` or `version: 1`) are migrated on load. So are v2 files
  written by an earlier build: `outdoor` becomes `garden`, `w` becomes `wk`.

## Card behaviours

Every wall and edge line has a white twin under it (`--fp-outline`), so a dark line stays visible on a dark floor. A zone's
dashed edge has none.
Every text on the plan has an outline in `--fp-outline` and is never faded with opacity (S23.1). A room or zone name is
`--fp-label`: `--fp-text` mixed 92 % into what the name sits on (the room's own paint, else its kind's colour; a zone
takes the room under it), so it reads at 4.5:1 or better in every theme and on every surface. A theme may give outdoor
names their own ink, `--fp-text-out` (solarized: base2), mixed the same way; every other theme group sets it to its own `--fp-text`, so a
group nested in a solarized one keeps its own ink. Device and
extra names and values keep `--fp-text`. Room names
are 12k, outdoor and zone names 10k, weight 500, outdoor names in italic. The font is `--fp-font`: Home Assistant's body
font, else system-ui. Values use tabular figures and a narrow space before the unit. On the card a name is never under
11 px, and a shrunk name never under that floor either (S23.2; `px` in `renderFloor`, measured at fit, not at zoom).
Every device icon sits on a disc three units wider than the icon (the halo), and is drawn above everything else on the
plan, room names included. A name stays in its own room (S23.3): it goes only where its whole box is inside the room and
inside no smaller named room, clear of icons and other text. It tries the centroid (or the room's pole of
inaccessibility), then spots up to 144 units left and right and 64 up and down, nearest first, then smaller sizes. When
every spot is covered it goes on a tag, an `--fp-outline` plate drawn over the icons; neither plate nor name takes a click,
so a tap there reaches the device under it. A garden, terrace, pavement or water too small for its name first tries the
bare ground beside it that no other room covers; a leader is left only after that, for an area too small for its name at
the floor size. On the card every name, tag and leader stays inside the plan's frame, minus the strip a column of
controls covers (`bounds` in `RenderOpts`); the editor and the 3D overlay pass no bounds.
When a device is active, the icon and its halo (the disc)
take the colour of its type (S2.9): one `--fp-dev-<type>` variable per type,
set on the device group as `--fp-dev` when it carries the `on` class. Since
S23.4 the halo is a solid disc in that colour and the glyph on it wears
`--fp-dev-ink`, the theme's ink that reads at 4.5:1 or better on it (else pure
black or white). An off or idle device has no disc: its glyph alone, in
`--fp-idle` at .7. A switch or a humidity sensor falls back to an idle grey
disc when on. A contact device draws red whether it is a device icon or a
door sensor. An unavailable or unknown device, of any type (S23.5), is its own
mark: no disc, a dashed `--fp-warn` ring, the glyph at idle and a small slashed
badge on the disc's edge, whatever the colour rule says. A bound light is
unavailable only when every state it has is dead. The camera cone stays at 25 % alpha,
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

Plan symbols (S23.7). A door or glass door is a gap cut in the wall with a 1 px leaf, square to the wall and as long as the
opening, and a 90° arc; the leaf swings into the indoor room, else any room, else the smaller one. A window is three
hairlines along the opening, at the wall's two faces and its middle; a slit spans a narrower band. In 2D a window or slit
also fills its whole cut with an opaque pane, a glass tint of the room colour, closed at each end by a hairline jamb, so
the cut never shows the board; 2.5D puts the glass on the wall face instead. Doors, glass doors,
windows and slits cut the wall; a sealed door does not and draws no symbol. Doors wear `--fp-door`, windows and slits
`--fp-window`, glass doors `--fp-glass`, which is the window blue in every theme. A closed door's own line paints nothing;
open, alarm and an open cover draw it and the symbol red. The symbols take no clicks; the hit line under them does. 2.5D draws the same symbols on the floor.

S14.2 (interaction model): a tap on a device, a door, an unlinked appliance or an Active row never operates it. Wherever
the "Click" column below says "toggle", "more-info" or "chooser" for a tap, read: the tap opens a popup (name, state, one
44 px primary button, More info). The button does the old toggle as `turn_on` / `turn_off` / `open_cover` / `close_cover` /
`lock` / `unlock`; More info does the old more-info or chooser; a long press still opens more-info directly. Turning OFF asks
first (a Confirm turn off step in the popup) for every type except a light. A light adds brightness, colour temperature and
hue sliders per its `supported_color_modes`, with one `light.turn_on` on release. A mouse hover shows a tooltip with the name
and the state text. Types without a toggle (`NO_TOGGLE`) show name, state and More info only. The state text is one
formatter (`src/core/state-text.ts`) for the plan, the popup and the tooltip. See `docs/card.md`, "Tap, hold and hover".

| Entity domain / device type | Idle | Active | Colour | Click |
|---|---|---|---|---|
| light | grey icon | a solid yellow disc with the glyph in its ink; brightness scales the aura, not the disc (S23.4); plus a round aura 300 cm across (S8.13) in the same colour, 55 % at the lamp and falling to nothing at its edge (S23.8), clipped to the lamp's room, screen-blended on a dark theme and multiplied on a light one, drawn under walls, doors and names | `--fp-dev-light` (#e0a800) | popup (Turn on/off); long press: more-info |
| smart light (`rgb_color`) | grey icon | icon, halo and aura in the light's own colour from HA, yellow when it reports none | the light's own `rgb_color`, or `--fp-dev-light` | popup (Turn on/off); long press: more-info |
| light with `bound` switch | grey icon | active when the light or the switch is on; unavailable only if every known state is | as light | popup for the light entity; long press: more-info for it (the switch is reachable from that dialog — `bound` is deliberately never one of S10.4's chooser entities, see docs/DECISIONS.md) |
| switch (wall switch) | grey | grey icon and halo, no brighter than off | `--fp-idle` (#8b8578) | popup (Turn on/off) |
| plug | grey | blue icon and halo while it draws `plug_watts` (2 W) or more; a plug switched on but idle stays grey. With no power sensor: while the switch is on | `--fp-dev-plug` (#2c7fb8) | popup (Turn on/off) |
| binary_sensor on a door or window, or an attached `lock` left unlocked | door drawn normally | door drawn red and dashed, over a wide red line pulsing under it (S8.13 line, S9.1 dash; steady under reduced motion), the same for an open contact or an unlocked lock (2026-09-28). A cover door's own open state is undashed and keeps its plain orange, even on a door with both | `--fp-open-door`, default `var(--fp-dev-contact)` (#d64545); card's `open_color` overrides both the door and the line (S9.1) | more-info for its one entity; a door naming more than one (a contact sensor and a vibration sensor, or either plus a `lock`) opens a chooser listing all of them instead (S10.4). Never on a door with a `cover`: a plain tap there always opens its own confirm dialog, but a long press opens the chooser instead, the cover entity included (S10.3 review) |
| door with a `vibration` sensor triggered | door drawn normally | door drawn the same red as an open contact, over the same pulsing alert line, but solid — dashed still means "open" alone. Open and vibrating together stay dashed (open wins the dash) and share one alert line, not two (S10.3) | `--fp-open-door`, same token and `open_color` override as an open contact | more-info (on the vibration sensor; it also joins the Active panel under the door's name); as above, a chooser instead when the door names more than one entity (S10.4), the long-press chooser on a `cover` door (S10.3 review) |
| contact (device icon) | grey | a solid red disc with a 2 px `--fp-outline` ring (S23.4), and a red ring pulsing out from under the disc (S8.13) | `--fp-dev-contact` (#d64545) | more-info |
| motion (binary_sensor motion/occupancy) | grey | icon red, fading to grey over `fade` seconds (default 120) from the moment it goes off (`last_changed`); halo a solid red disc at once with a 2 px `--fp-outline` ring (S23.4), and a red ring pulsing out from under the disc while it is on (S8.13) | `--fp-dev-motion` (#d64545) | more-info |
| temp, humidity (sensor) | grey icon, value as a label next to it | humidity: grey icon and halo, no brighter than off | `--fp-idle` (#8b8578) | more-info |
| temp or humidity sensor inside a room of kind garden | green icon (class `outdoor`, from the centre of the icon) | as its type | `--fp-dev-garden` (#3f8f4f) idle, as its type when on | more-info |
| heater, climate (TRV, thermostat) | heater bar grey with target; icon and halo grey | orange icon and halo when heating | `--fp-dev-heater` / `--fp-dev-climate` (#e8801a) | with `trvs`/`tempSensors` attached: tap opens a chooser listing the heater plus all of them, never a guess (S10.4); long press opens more-info for the heater alone (S10.3 review). With none attached: popup; long press: more-info, unchanged |
| ac (air conditioner, heat pump, fan, air cleaner) | grey | blue while `hvac_action` is cooling, orange while heating, grey otherwise | `--fp-dev-ac-cool` (#2c7fb8) / `--fp-dev-ac-heat` (#e8801a) | with `linked` climate/TRV entities: tap opens the chooser (S10.4), long press opens more-info for the ac alone (S10.3 review). With none: toggle; long press: more-info, unchanged |
| tv | grey | blue icon and halo when the player is on or playing | `--fp-dev-tv` (#2c7fb8) | more-info |
| battery, inverter, server, access_point | grey icon on the round disc, `on` or off | grey, unchanged | — (idle grey `--fp-idle`; `layout.colors` can name one) | more-info |
| computer | grey | blue icon and halo | `--fp-dev-computer` (#2c7fb8) | more-info |
| camera | dark grey icon with a 120° cone of view in dark grey at 25 % alpha, turned by `rot` | — | `--fp-dev-camera` (#4a4a48) | more-info (live view) |
| cover on a `door` or `sealed` opening | door normal | door open state shown, orange | `--fp-open` (#f28c28) | tap: confirm dialog naming the action, then `cover.open_cover`, or `close_cover` when it is already open; long press: chooser listing every entity the door names, the cover included (S10.3 review) |
| cover on a `window` or `glass` door | door normal | never colours the opening — here `cover` is curtains/blinds, not a security state (2026-09-28) | — | same tap/long-press behaviour as above; only the colour is suppressed |
| siren | grey | `--fp-danger` icon and halo while its entity is on; rings only when the entity is in the `siren` domain | `--fp-danger` (#b02a2a) | popup (Turn on/off) |
| alarm (`alarm_control_panel.*`) | grey while `disarmed` | `--fp-danger` icon and halo in every other state but `unavailable` (armed, arming, pending, triggered) | `--fp-danger` (#b02a2a) | more-info (no toggle) |
| linked tv, speaker or computer piece (furniture with `entity`) | blue (`--fp-dev-tv`) body and edge | `--fp-active` body and edge, by the device rule of its type; waves while a tv or speaker is `playing` | `--fp-dev-tv` idle, `--fp-active` on | more-info, no popup; never a toggle |
| media (media_player) | grey | blue icon and halo while the player is playing (any other state, including paused, is idle) | `--fp-dev-media` (#2c7fb8) | more-info |
| speaker (media_player) | grey | blue icon and halo while the player is exactly `playing` (paused, idle, off, on-but-not-playing, unavailable, unknown or no state stay idle), plus two arcs pulsing out from under the disc in the device's own colour (S9.4; held still at 1.5x, 60 % opacity under reduced motion) | `--fp-dev-speaker` (#2c7fb8, fixed in every theme) | more-info (media_player's own toggle is play/pause or power, never a clean on/off) |
| cover (device icon, not a door) | grey | orange icon and halo while the cover is open | `--fp-dev-cover` (#f28c28) | more-info |
| other | grey | grey icon and halo, no brighter than off | `--fp-idle` (#8b8578) | more-info |
| unlinked appliance (Add > Unlinked device, S4.25 — a placed type with no linked entity of its own) | flat idle-grey icon, no on/off state | unchanged — no live state to show | `--fp-dev-fill`/`--fp-idle`, or the item's own colour override | no toggle, no long press. Tap resolves its `attached` list: one entity opens more-info directly, several open the chooser, none does nothing (S10.3 review). A speaker or TV with a `media_player.*` attached stands in for it: playing draws the speaker's two waves and the active tint, and a tap or hold opens that player's more-info, no popup (2D and 2.5D draw; 3D does not yet) |
| person (`person.*`, `device_tracker.*`) | away (`not_home` or any zone): 35 % opacity and a small grey away dot on the disc's edge | `home`: green icon and halo, full opacity. With a `room` sensor that names a room, the icon glides (600 ms CSS transform, none under reduced motion) to the room's centroid, or beside it when another icon sits there; several people in one room stand on a ring | `--fp-dev-person` (#1b9e77) | more-info |
| radar (mmWave presence, `binary_sensor.*occupancy`) | grey icon; no `targets` dots when the pair is not finite or falls outside the floor | purple icon and halo when the presence entity is on; each `targets` pair draws a small dot at its turned, plan-relative position | `--fp-dev-radar` (#6a3fbf) | more-info for the presence entity alone; with one or more `targets` pairs, a tap opens a chooser listing the presence entity then each pair's x then y entity instead (S10.4) |
| vacuum (`vacuum.*`) | `docked`, `idle`, `paused`: grey icon, no brighter than off | `cleaning`: teal icon and halo, slowly spinning; `returning`: teal icon and halo, not spinning; `error`: `--fp-danger` icon, neither on nor off | `--fp-dev-vacuum` (#2f8f8f) / `--fp-danger` (#b02a2a) on error | opens a dialog: Start, Pause, Return to dock, each a `vacuum.*` service call; Cancel closes it. `unavailable`/`unknown` disables the three actions, Cancel stays enabled |
| room with `entity` | own kind colour, no outline | own kind colour, unmoved, plus an outline when the entity is on, open or playing | `--fp-active` stroke (#8a5117 light / #e0a800 dark) | none (S2.9 adds no click behaviour) |
| furniture with `entity` | idle grey (`currentColor`) | `--fp-active`, chosen per theme for at least 3:1 contrast against both `--fp-room` and `--fp-bg` | `--fp-active` (#8a5117 light / #e0a800 dark) | none (S2.9 adds no click behaviour) |
| unavailable / unknown (any type, S23.5) | no disc, a dashed `--fp-warn` ring, the glyph at `--fp-idle` .7, and a small badge (a circle in `--fp-bg` with a `--fp-warn` slash) at the disc's top right; not faded | — | `--fp-warn` | more-info |
| night (S7.6) | day: no overlay | after sunset every room (outdoor kinds too; zones, structures and stairs share their room's) is covered by `--fp-night`; a room with an on light inside it stays clear | `--fp-night` (rgba(4, 10, 30, .45), every theme) | none |

S10.4: wherever the table above says "more-info" or "chooser" for a device,
a door or an unlinked appliance, that is really "more-info, or a chooser,
for the entities this object names" — `entitiesOfDevice`/`entitiesOfDoor`
(`src/core/attachments.ts`) list every entity a tap or long press on that
object could mean, in a fixed order (the object's own `entity` first when it
has one, then its type's own attachment fields — a door's `cover` first
among these since S10.3's review — then any `attached` list). Exactly one,
the common case and every case before S10.4 existed, opens more-info on it
directly, unchanged. More than one — a heater with two `trvs`, an ac
`linked` to another unit, a radar's own `targets` pairs, a door with both a
`sensor` and a `vibration` entry, or an unlinked appliance with two
`attached` entities — opens a chooser dialog instead, naming the object
(`name ?? entity`/`id`) and listing every entity by its own `friendly_name`,
then its catalog name, then the entity id, with its live state and unit on
the right of the row. Picking a row fires `hass-more-info` for that entity
and closes the dialog; Cancel, Escape or a click on the backdrop outside the
dialog's own box close it without firing anything.

S10.3's review of the first S10.4 build found three defects, each fixed in
the same commit as this paragraph:

1. A device that toggles (heater, ac...) had this backwards: a plain tap
   still toggled it and the chooser lived on the long press. The chooser now
   lives on the tap — the gesture that used to guess which entity was meant
   — and a long press opens more-info for the device's own entity alone, the
   same thing a long press always did before S10.4 existed. A device naming
   exactly one entity is unaffected.
2. A door with a `cover` returned before starting any long-press timer, so
   nothing else it named (a sensor, a vibration sensor, a lock) was ever
   reachable by gesture once it also had a cover — only the tap's own confirm
   dialog ever opened. A long press on such a door now opens the chooser,
   `entitiesOfDoor` including the `cover` entity itself precisely because
   this is the one place that reads it; a plain tap is unaffected and always
   opens the confirm dialog first (S2.7). In kiosk mode (no long press
   anywhere) such a door only ever opens the confirm dialog.
3. An unlinked appliance (S4.25, placed by type with no entity of its own)
   had no gesture wired to it at all — a tap did nothing, whatever it named
   in `attached`. A tap now resolves that list the ordinary way: one entity
   opens more-info, more than one opens the chooser, none does nothing. It
   has no toggle and no long press, since it names no on/off state to guess
   at in the first place.

A light's `bound` switch and `motion` link, and a person's `room` sensor, are
deliberately never listed — see docs/DECISIONS.md.

Sun direction (S15.3, planned 0.17.0): the card reads `azimuth` and `elevation` from the
`sun` entity. Sunlight is one parallel direction: in 3D the scene's sun light comes from
bearing `azimuth + north` (see Layout schema, `north`) at that elevation, so a window on the
south wall lights the floor when the sun is in the south. Without those attributes, or with
the sun below the horizon, the light is the fixed daylight of today. The 2D plan shows the
same as a soft wedge through windows and openings.

Rooms tint when any light in them is on (`room_glow: true`). Night (S7.6):
`night: auto` darkens the plan while the `sun` entity (default `sun.sun`) is
`below_horizon`, or `on` for a binary sensor; a missing or `unavailable` sun
is day. `on` and `off` force it. Walls, names and devices are drawn over the
overlay, so they stay crisp. The editor previews it under View, Preview night.
Card config:

```yaml
type: custom:floorplan-studio-card
floor: ground          # or "all" with a floor switcher
floors: [ground, first]  # or an ordered list of floor ids; a switcher over just these, first is the default; wins over `floor`
fade: 120              # motion fade, seconds after motion ends
room_glow: true
theme: blueprint       # blueprint (default), midnight, light, slate, terminal, solarized, ha, coffee, a-team, space, cyberpunk, carpenter-brut, or beach-house
zoom: true             # pinch, drag, double-tap, Ctrl/Cmd+wheel, +/−/fit buttons; "wheel" also zooms on a plain wheel; false fixes the plan
night: auto            # auto (default: from the sun), on, off
sun: sun.sun           # the entity night: auto reads
kiosk: false            # true shows only the plan, for a wall tablet: no floor chips, no zoom buttons, taps still act, holding a device does nothing
icon_size: 1            # 0.5 to 3, default 1: grows icons/names/values/radar dots further, on top of the automatic large-plan scale-up below
active_list: true       # false hides the floating panel of active devices
center: [650, 200]      # plan cm, unset by default: pins the card to a room instead of the whole floor
zoom_level: 2.5         # 1 (default, whole floor) up to MAX_ZOOM; zooms about `center`, or fit's own centre without one
```

`center`/`zoom_level` (S9.6): a card can pin a "home" view — a room, corridor
or part of a home — instead of the whole floor, so several cards can each
point at a different place. `zoom` was already the pinch/wheel switch, so the
resting zoom needed its own key. `pinnedView(fit, center, zoomLevel)`
(`src/card/viewport.ts`) is pure maths: a box `fit.w/zoomLevel` ×
`fit.h/zoomLevel`, centred on `center` (or `fit`'s own centre without one),
clamped to `fit` the same way pinch/pan already is, so it can never leave the
plan. Untrusted config (CLAUDE.md finding 1): unlike `zoom`/`kiosk`, a
malformed `center` or `zoom_level` never throws — a non-array, wrong length,
non-finite `center`, or a non-finite `zoom_level`, falls back silently to the
whole floor, the same as `icon_size`/`open_color`, because a bad value here
is a typo in a coordinate, not a closed enum a card author chose wrong on
purpose. `zoom_level` alone zooms about `fit`'s own centre; `center` alone
(or `zoom_level` at `1`) is a no-op, since `pinnedView` hands back `fit`
exactly whenever there is nothing narrower to zoom into.

The pin becomes the card's "home": `_home()` returns
`pinnedView(fit, center, zoomLevel)`, and every place that used to treat
`fit` as "at rest" — the `fp-zoomed` class, `_zoomed()`, the reset button
(`_fitView`, sets `_view = null`) and a double-tap when already at rest — now
reads `_home()` instead. `_setView`'s own bounds (what pinch/pan/wheel can
reach) still clamp against the whole `fit`, so a pinned card can still zoom
out to see the rest of the floor; only where it rests changes. `_scale`
(S9.2's icon sizing) deliberately keeps reading the whole-floor `fit`, not
the pinned box, so a room card's icons are the same size as the equivalent
whole-floor card's at the same zoom, not inflated by the extra zoom the pin
itself adds.

`center` is documented as plan cm — the same unrotated coordinates a room or
device sits at — but `fit`/`pinnedView` work in the *rendered* frame, which
`renderFloor`/`viewBoxFor` turn by the layout's own `rotate` themselves
(unlike the editor, which draws unrotated coordinates inside a rotated
`<g>`). `_home()` therefore rotates `_center()` by the layout's `rotate`
(`_rotatedCenter()`, `rotateAbout` about `planPivot(layout)`) before handing
it to `pinnedView`, so the pin lands on the same plan point the layout itself
names whether or not it is rotated. `rotate: 0` (or unset) leaves it
unchanged.

Opus review, 2026-09-27: `_zoomButtons`' single `atFit` used to gate both
"−" and Fit off `box.w < home.w`, width only, which is right for neither on a
pinned card — "−" was disabled the moment the card loaded (there was more
floor to see), and Fit was disabled after a same-width sideways pan or a
pinch past home, with no button left to bring the room back. The two are now
separate: "−" is disabled at the whole floor (`box.w >= fit.w*(1-1e-6)`),
Fit/Reset is disabled exactly when there is nothing to undo (`_view ===
null`, i.e. `_zoomed()` is false). On a pinned card (`center`/`zoom_level`
set, so `home` differs from `fit`) the reset button's `aria-label`/`title`
read "Reset view" instead of "Fit", since it no longer fits the whole floor.
Unpinned, `home` equals `fit`, so both conditions coincide and nothing
changes.

The editor's View menu has a "Copy card view" button (`copyCardView`,
`src/editor/editor-app.ts`) that computes `viewBoxFor(st.f, 60, st.rotation)`
— the card's own fit, pad 60, not the editor's own pad-80 `fit()`/
`recenter()` — reads the editor's current view (`st.view`), and writes
`center: [x, y]` (rounded to whole cm) and `zoom_level: z` (two decimals) to
the clipboard, with a "Card view copied." status line. `st.view` is already
unrotated plan cm (the editor's own rotation lives in an outer `<g>`, not in
`st.view`), so no rotation is applied here — only the card's `_home()` needs
to rotate it back on the way in. `zoom_level` is `min(fit.w/v.w, fit.h/v.h)`
(Opus review, 2026-09-27: the width ratio alone could ask for a box narrower
than `v`'s own aspect after Re-center left `st.view` a different shape than
`fit`, cropping what the editor showed top and bottom; the smaller ratio
keeps the card's box at least as tall and as wide as `v`). A pinned card is
meant for one floor; `floor:` picks which one.

`active_list` (S9.5, default `true`): a floating panel over the plan, open by default in the top-left, listing every active device across every floor of the layout, not only the one the plan is showing (since S24.7 the floor on show by default, every floor under "All floors"; see the Overview sheet below). "Active" reuses `classOf` (`src/core/render.ts`, exported for this) — the same function that colours the plan — so the list and the plan can never disagree about a device's on/off state; a `light` with `bound` counts through its switch, the same as on the plan. The one addition beyond `classOf`'s own "on": a `vacuum` is listed only while `cleaning`, narrower than `classOf`'s own on-plan colour (which also covers "returning" to the dock) — a robot heading home is winding down, not something to check. A `camera` is never listed (S24.3, G1): a camera is a view, not something on, and ten idle cameras made the count meaningless. An `unavailable`/`unknown` device, or any device with an empty `entity`, has no real more-info to open, so `isActive` (Opus review finding 9) excludes them regardless of `ACTIVE_LIST_RULE`. `src/core/active.ts`'s `ACTIVE_LIST_RULE` writes down every `DeviceType`'s membership explicitly (`"on"`, `"cleaning"` or `"never"`), tested by iterating `DEVICE_TYPES` (CLAUDE.md finding 17), so a new type is a decision made in the open, not a silent fall-through.

Rows are grouped by category (S14.6, `src/core/categories.ts`: `CATEGORY_OF` places every `DeviceType` in one of ten categories, `CATEGORIES` fixes their order: lights, climate, security, media, power, covers, computers and network, sensors, people, other; a type nobody placed falls to "other"). Each category is a header `<button aria-expanded>` that folds its rows; groups start open and the fold is kept per card (`localStorage`, try/catch, key `fp-active-cats:<hash of the same source seed>`, separate ids for the Active list and the Room panel, which is grouped the same way). Each row has that type's icon and colour — a `camera` row is the one exception, taking `--fp-ink` (the panel's own text colour) rather than `--fp-dev-camera`, since that token is tuned for the plan's own room background and read illegibly close to the panel's `--fp-room` background in the dark themes (Opus review finding 10) — and its `name ?? friendly_name ?? entity`; a click or Enter fires `hass-more-info` for that entity, the same event the plan's own tap already fires. The header shows "Active", a live count and a collapse toggle (since S24.7 a crumb and count chips); dragging the header repositions the panel. Its position is kept as a fraction of the card's own free space and reapplied after every render and on a `ResizeObserver` of the card's host, not only while dragging (Opus review findings 3 and 4), so it can never be lost off-screen — including after the card itself is resized, or after a collapse/drag-to-bottom/expand cycle. With nothing yet stored and the card narrower than 500px, the panel starts collapsed and takes `min(200px, 45%)` of the width instead of a flat 200px (Opus review finding 5, an assumption: 500px as "phone width" is not tested against a real device, only Chromium's viewport emulation). Position and collapsed state are kept in `localStorage`, wrapped in try/catch, under a key hashed from the layout's *source* — `layout_url`, else `"inline"` for a config `layout`, else `"ws"` for the websocket fetch — plus the card's own `floor`/`floors` (Opus review finding 7: the old key hashed the layout's *content*, so two cards in websocket mode, the default install with no `layout`/`layout_url`, shared one key even when pinned to different floors, and an inline layout's own autosave changed the key on every edit). `kiosk: true` hides the panel too — a wall tablet shows only the plan.

**Attention (S24.3, G2 and G3).** `src/core/attention.ts` lists what is wrong in the house, before what is on. `attention(layout, state)` is pure and reads every floor. It returns `items`, `unavailable` and `floors`. Kinds, most severe first (`ATTENTION_KINDS`):

1. `alarm-triggered`: an `alarm` whose state is `triggered`.
2. `alarm-armed`: `armed_*`, `arming` or `pending`.
3. `open`: a `contact` that is `on`; a `cover` only while `coverActive` says so (garage, gate or door, never a blind); a door whose own contact sensor is on, or whose own garage or door cover stands open.
4. `unlocked`: a `lock`, or a door's lock, whose state is `unlocked`.
5. `leak`: an `other` `binary_sensor` that is `on` with device class `moisture`.
6. `smoke`: the same with `smoke`, `carbon_monoxide` or `gas`.
7. `battery-low`: a device's own battery. Any placed device, or any lock or contact sensor a door carries, whose `battery_level` attribute is a number under 20 (`BATTERY_LOW`), one item per entity; or an `other` device with `device_class: battery` whose state is a number under 20. A `battery` device is a home storage battery: its charge is never an alert. A device can raise two kinds, an unlocked lock with a low battery for one.
8. `unavailable`: any device or door entity whose state is `unavailable`. `unknown` and a missing state are not. These go to their own list, sorted by name, for one folded row with a count.

`ATTENTION_RULE` writes down each `DeviceType`'s rule (`alarm`, `open`, `unlocked`, `hazard` or `none`); a test iterates `DEVICE_TYPES`. Items sort by kind, then name. Each carries its floor, where it is (`device`, `piece` or `door` and an index), the entity, a name, its room, its type, the raw state and `last_changed`. An entity placed as its own icon is reported by the icon, not again by its door; an entity on two icons is reported once. A door's room is the first room in layout order that borders it. `floors[key]` holds `count` (the things, a device, piece or door, with at least one item: an unlocked lock with a low battery is two items and one thing; unavailable left out), `unavailable` and `alarm` (an alarm on that floor is triggered), for every floor of the layout. Junk input reports nothing and never throws.

**Open and Unlocked are separate facts (S24.3, G3).** `doorStateOf` returns `contact` (a contact sensor is on) and `unlocked` (a lock is unlocked) as well as `open`. The plan still draws a door red for either (2026-09-28). The Room and floor panels' facts read "Open" (doors and windows whose contact is open) and "Unlocked" (doors with an unlocked lock). "Unlocked" shows only where a door in scope has a lock.

**The Overview sheet (S24.7, G1, G2, F2, F3, A3, S22.F4).** The `active_list` panel is the Overview (`aria-label` "Overview"). Its header reads "Home › Ground" (the floor on show, or "All floors"), a collapse button, and count chips: the alerts first, in `--fp-warn`, then one chip per category with something on ("2 alerts · 6 lights · 1 plug"), or "Nothing on". Folded, the header is one line: the crumb hides and the chips end in an ellipsis, alerts still first. The body is:

1. a slot for the search box, `<div class="fp-ov-search" data-slot="search">`, hidden while empty (S24.8 fills it);
2. an "All floors" toggle (`aria-pressed`), only on a card that can show more than one floor;
3. "Attention · N": `attention()` items in its order, each row with its state ("triggered", "open", "unlocked", "battery 12 %") and its age since `last_changed` ("12 min", `formatAge`), then "Unavailable" with a count, folded until opened;
4. "Active · N": `activeDevices()` by category, the S14.6 folds kept, leaving out any entity already in Attention;
5. the hint "Tap a row: the plan goes to it."

The scope is the floor on show by default; "All floors" lists every floor and badges each row with its floor. The toggle is kept with the panel's position (`all` in `fp-active-panel:`). With a room or floor picked, the lists are cut to it as before (S11.3, S20.2). A row is one `<button>` (at least 40 px under `pointer: coarse`) with the icon, the name, the room and the state; the state is the popup's own text, so a lamp lit by its relay reads "on · via" the relay. The ▸ details chevron is gone from every row, room rows too; the same details (manufacturer, model, firmware, area, entity, state, last changed) are a `<details>` "Details" in the device's popup, not in kiosk.

A row tap locates its thing (`_locate`): it switches to the row's floor when the card can show it, centres the plan on the thing at 2× or closer (with `zoom: false`, at the zoom on show), rings it for 2.4 s (`.fp-pulse`, card chrome outside the svg; under reduced motion it stands still), and opens its popup beside the row. A linked piece opens more-info instead, as its tap on the plan does. In 3D the tap switches floor and opens the popup; it does not pan, and no ring shows. A card pinned to one floor with "All floors" on only opens the popup of another floor's row. A hass update keeps the scope, the folds and the popup.

Floor tabs read "Ground · 3": the floor's attention count, things not items (`attention().floors`), nothing at 0. A floor with an alarm triggered wears `--fp-warn` on its border and count. A single-floor card has no tabs.

Opus review, 2026-09-27: with the same `floor`, several S9.6 cards pinned to
different rooms still shared one storage key, so collapsing or dragging one
card's panel moved every other card's panel on the next reload. `center`/
`zoom_level` now join the seed, but only when the config actually sets them
(`this._config.center !== undefined`, pushed conditionally) — an unpinned
card's key is unchanged from before S9.6, so no existing stored position or
collapsed state is silently orphaned by this fix.

`zoom` (S7.4): the plan zooms between fit and 8×. A drag that moves more than 6 px pans and is never a tap; zoomed in, a third of the view always stays on the plan. A double-tap off any device zooms 2× at fit and returns to fit when zoomed. Without Ctrl/Cmd a wheel scrolls the dashboard, unless `zoom: "wheel"`. The view resets on a config change and a floor change, and survives state updates. With zoom on, the plan's `<svg>` has `touch-action: none`, so a swipe that starts on the plan does not scroll the page; `zoom: false` gives the page its touches back. An unrecognised value (anything but `true`, `false` or `"wheel"`) is refused by `setConfig`, naming the key, the same as `kiosk` below — S7.4 had it falling back to `true` instead, silently hiding a typo.

`kiosk` (S7.5, default `false`): built for a tablet fixed to a wall, where nobody should be able to reach Home Assistant's more-info dialog by holding a finger on a device, or switch floors, or zoom out past what fits. `true` drops the floor chips and the zoom +/−/fit buttons from the card's own chrome, and `bindDeviceActions`'s hold timer never starts, so a long press does nothing — releasing still fires a plain tap, so every device keeps working by tap. With `floors` or `floor: "all"` set alongside `kiosk: true`, the card shows the first floor in the list and draws no switcher; put one card per floor on the dashboard instead. `kiosk` must be exactly `true` or `false` — anything else, `setConfig` refuses it, naming the key.

`icon_size` (S9.2): `renderFloor` draws icons, names, values and radar dots at
a fixed size in plan centimetres, scaled by `1/scale`; the editor passes its
own zoom as `scale`, but the card always passed `1`, so a big house left them
shrinking with everything else. The card now passes
`scale = 1 / (auto * icon_size)`, where `auto = max(1, longest side of the
floor's view box in cm / 1000)` — the same view box the card already draws
(`viewBoxFor`), so a plan of 1000 cm or less keeps `auto` at `1` and renders
byte-identical to before this change. `icon_size` is a number from `0.5` to
`3`, default `1`; anything else (missing, non-numeric, `NaN`) is the default
rather than refused, since a slider or a stray digit should never break the
card. The editor is unchanged — it always passed its own zoom, never `1`.

**View memory per floor (S14.4).** The card remembers, per browser, what each floor was left looking like: in 2D and 2.5D the zoom, the spot zoomed to and the turn; in 3D the camera (azimuth, polar angle, distance, look-at point). Coming back to a floor, by its chip or by a reload, restores it; a floor never touched starts at the config's look. Storage is `localStorage` only, in a `floors` list of `[floor key, view]` inside the card's `fp-view:` entry, wrapped in try/catch; with storage blocked the floors still remember for the life of the page. The 3D distance is stored as a multiple of the distance that frames the floor and the look-at point as an offset from the floor's centre, so a restore in a differently shaped card frames the same. Reset view (and Reset camera, in 3D) clears the shown floor's memory and no other floor's. Every stored number is untrusted and bounded on read. The editor already keeps its own zoom per floor and does not draw 3D; its single turn stays single (see DECISIONS, 2026-10-06 S14.4).

`theme` is blueprint unless the dashboard says otherwise. `light` is the paper-and-ink set; `midnight` is the project's first dark theme, kept under its own name once blueprint moved on to a new palette (2026-09-22). `ha` inherits the dashboard's own theme: ground from `--card-background-color`, rooms from `--secondary-background-color`, walls and text from `--primary-text-color`, measure marks from `--secondary-text-color`. Each has the plain light or midnight set as its fallback, chosen by `hass.themes.darkMode`, so a dashboard that defines none of them still draws. In HA's dark mode a 2.5D wall's side face is 30 % of the wall into the background, not the 55 % every other theme uses, so a light wall colour still makes a dark slab (Opus review of Sprint 23, S2). Warn, danger and primary (the UI chrome, not a device's own colour) never follow the theme: they and their on-dark/on-light text are the same fixed pair everywhere, because they already clear 4.5:1 against it. The card ignores the OS colour scheme.

### Role-generated themes (S4.21, 2026-09-22)

`blueprint`, `slate` and `terminal` are built from four roles instead of ~50 independent hexes (`src/core/theme-roles.ts`, `rolesToTokens`): a **base** hue shaded from background to strongest linework for every structural surface (ground, walls, garden, doors, windows...), a **foreground** colour for text, icons and detail, a **line** colour for the measurement grid only, and one saturated **accent** for anything "on" or "live" — device state, the on-room ring, aura and glow. A device's own colour defaults to the accent (every "on" icon the same colour, Diego's brief: "collapse to one accent"), but a theme's role definition may give specific device or entity types their own colour instead via an optional `devices` map, so a theme can keep its device colours distinct where that reads better. None of the three built-in role-generated themes use that override; `solarized` (below) does, as the worked example.

| Theme | Base | Foreground | Line | Accent |
|---|---|---|---|---|
| `blueprint` | dark blue | cool white | terminal green | saturated orange |
| `slate` | neutral grey (light) | dark ink | muted green | burnt orange |
| `terminal` | near-black | terminal green | terminal green | amber |
| `coffee` | espresso brown | cream | roast tan | caramel orange |
| `a-team` | near-black | light grey | cherry red | gold |
| `space` | near-black navy | starlight white | cyan | violet |
| `cyberpunk` | near-black violet | cyan | magenta | acid yellow |
| `carpenter-brut` | near-black maroon | pale pink | dark crimson | hot pink |
| `beach-house` | sand (light) | driftwood brown | sea teal | palm green |

Every surface follows the theme (S23.6). An unpainted room on a dark theme takes the theme's own room shade from its ramp
(blueprint #132237, midnight and HA dark `--fp-room`, solarized #06323d); a light theme keeps the light grey #d6d6d2. A
theme's role definition may still override `roomEmpty`. Furniture is a ramp shade too, not one flat grey. On a dark theme a
room or stair painted its own colour is dimmed by a filter (`--fp-paint-dim`); the stored colour never changes. Garden,
terrace and pavement take ramp shades on the generated themes. The values per theme are in docs/DECISIONS.md, 2026-10-08
(S23.6).

`solarized` is bespoke, not role-generated: the real Solarized dark palette (base03 ground through base3 linework, its eight accent hues), each device type kept in its own Solarized colour rather than collapsed to one accent — Diego's call, 2026-09-22, real Solarized fidelity over reuse.

`ha` is untouched by this system: its neutrals still come from Home Assistant's CSS variables, with `midnight`'s fixed hexes as the fallback, not blueprint's new palette.

## Search (both apps)

One index, `src/core/search.ts` (S24.1). Entries are every floor, every named room and every device and linked piece
(tv, speaker, computer), each with its name (the plan name, else HA's friendly name, else the entity id), entity id,
room (`roomAt`; none for a person or a device outside every room), floor and type label. An entry carries what going
there needs: floor key, room index, device index (furniture index for a piece). A host may add its own command entries
(`kind: "command"`, an id and a name); they rank like the rest.

Ranking: exact name or entity id, then name prefix, then every word a prefix of a word in the name, then every word in
the name, then every word in the entity id, then every word somewhere in name, entity, room, floor or type. Ties go to
the shorter name, then layout order. Case and accents are ignored; several words must all match; a blank query matches
nothing. A layout of the wrong shape is skipped, never thrown on.

The box is `<fp-search>` (`src/card/search-box.ts`, S24.2), one element for both apps. It takes `entries` and `limit`
(10). An ARIA combobox: the input names the active option with `aria-activedescendant`; each option shows the name and
"room · floor · type". Nothing shows for an empty query; "No match" when nothing matches. Up and Down move and wrap,
the active option stays scrolled into view. Enter or a click fires `fp-pick` (bubbling, composed, the entry in
`detail`) and clears the box. Escape clears the query; on an empty query it closes: focus returns to where it was when
the host called `focus()`, and `fp-close` fires. Each host binds `isSearchChord` (`src/card/view-keys.ts`) on itself:
Cmd-K or Ctrl-K anywhere, `/` outside a text field.

## Editor

- Search and Outline (S24.5). The top bar holds `<fp-search>` after the floor
  chips ("Search or run a command ⌘K"); Cmd-K, Ctrl-K or `/` focuses it,
  bound on the editor host. Its entries are the plan's (search index above)
  and six commands that run the menus' own code: Fix or Unfix plan, Draw
  room, Add device…, Zoom to fit, Undo, Save. A pick goes there: a floor
  switches; a room or device switches floor, is selected, and is centred
  with the zoom kept or raised to fit, never zoomed out further than fit; a
  device or piece is ringed (renderFloor's `locate`: three pulses, a still
  ring under reduced motion). Selecting is not an edit: no undo step. Focus
  returns to the editor after a pick, so Delete and the arrows act on it.
  The Outline shows where the pick is: its floor and room open, its row the
  tree's tab stop and scrolled into view.
- Left column, beside the canvas, never over it: tabs (Outline; Layers is
  S24.6), collapsed to a 36 px rail by a button, open at 260 px. It starts
  open at 1100 px wide and more. Under 900 px it stacks above the canvas.
  The Outline: a filter field (every word, in names and entity ids; the
  branches holding a match open) and an ARIA tree, floors › rooms ›
  devices with device counts, "No room" last on a floor, a light with a
  relay as "Floor lamp → Relay 3". Only open branches render. The floor on
  show starts open. Keys follow the WAI-ARIA tree pattern (Up, Down, Home,
  End, Right opens then enters, Left closes then goes up, Enter or Space
  goes); the arrows stay in the tree and do not pan the plan. A click or
  Enter on a floor, room or device goes there as a search pick does. The
  last node, "Unplaced from HA · N", groups what Place would offer by HA
  area; an entity opens Add > Device listing only it, its row focused, so
  Enter places it.
- The canvas `svg` has `role="img"` and `aria-label="Floor plan, <floor>"`.
- Toolbar: floor chips, the device filter ("Filter: all (N)"), menus Add /
  Draw / View / Edit / File, Help, Undo, Redo, the status line. View holds
  what only changes the look (snap, measure grid, lengths, names, Preview
  night, theme, Re-center, Fit to window). Edit holds what changes the plan
  or Home Assistant: Add floor, the Home Assistant popover, Group, plan
  rotation, Device colours, Trace image…. The Home Assistant button and Group
  exist only in the HA panel.
- Add places one finished item: door, window, opening, wall of any of the five
  kinds, structure, zone, stairs, furniture (symbol picker). Water is a room
  kind, not an Add item: draw it, or change a room's kind.
- Draw is its own menu: room, zone, water, outline, wall of any kind, opening,
  structure line, by clicking points (double-click or Enter ends, Esc cancels).
  Walls that close, a click back on the first corner after three or more,
  become a room (wall, external), a zone (dashed) or a garden (fence, edge)
  and the walls go. It has no HA area yet, is selected, and its name field
  has focus. One undo removes it. The perimeter outline is not converted.
- A new wall, structure, zone, stairs or piece of furniture lands top right,
  outside the house, so it never hides what is already drawn; the view
  scrolls to it. A door, window or opening still lands on the wall nearest
  the middle of the view: it is of no use off the house. A new device or
  unlinked appliance lands at the middle of the current viewport instead
  (2026-09-28), nudged clear of anything already there — already in view, no
  scroll needed.
- Device: entities not yet placed, grouped by type then area, with a search.
  "Not yet placed" (S10.5) excludes an entity attached to a door's
  sensors/vibration/locks/cover, a heater's TRVs/temperature sensors, an ac's
  linked entities, or an unlinked item's attached list: it is in use, not
  unplaced, even though attaching it removed its own icon (S10.2) and it is
  no longer in `placedEntities`. Every other list that offers an entity to
  place (the room's "Add device from &lt;area&gt;" menu, the Place popup) excludes
  it the same way. A light's `bound` switch and its `motion` link are not
  attachments in this sense and stay offered normally.
- The device type menu (S18.14, 2026-10-07) is one list in three places: the device panel's
  type, the Add > Device type filter and the Add > Unlinked device list. The popular types
  come first, in this order: light, switch, motion, contact (shown "Window / door sensor"),
  temp (shown "Temperature"), speaker, tv. Then one separator, then every other type A to Z
  by the label shown. A filtered list with an empty block shows no separator. The unlinked list
  keeps its curated subset and does not offer siren or alarm, which have no state to show there.
- Every field that picks a Home Assistant entity (a device's own entity,
  "Controlled by", a door's cover, room/furniture "shows the state of", room
  sensor, radar targets, and every multi-attach list of sensors or locks) is
  a filterable combo box (`<fp-combo>`, S10.1), not a plain `<select>`.
  Typing narrows the list live by label, entity id or group (room or
  domain); arrow keys move, Enter picks, Escape restores the previous value
  and closes without picking. A pick is one undo step, same as a `<select>`;
  picking the value already set commits nothing.
- Attaching an entity (S10.2) to a door's contact/vibration/lock list or
  cover, a heater's TRVs or temperature sensors, an ac's linked entities, or
  an unlinked item's attached list: if that entity is also placed as an icon
  on the plan, the icon is removed from every floor in the same undo step —
  it is now shown through the thing it is attached to, not doubled on the
  plan. The picker still offers a placed entity, labelled "(on plan)".
  Detaching (Remove, or clearing a cover) only removes the attachment; the
  entity stays in the catalog and shows in Add again, but no icon reappears
  (a placed icon is a deliberate placement the editor does not redo for
  you). A light's `bound` switch is untouched either way.
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
- Edit: rotate the whole plan in 45 degree steps, to line it up with north.
  View, Re-center: zoom and pan go back to show everything on the floor (rooms,
  stairs, walls, furniture, devices), not only the outline as Fit to window
  does; nothing is written to the layout.
  Edit, Device colours: one colour input per device type with a reset, and
  Reset all; each change is one undo step and is saved in `colors`.
  All floors turn together. Names and icons stay upright.
  Edit, Trace image… (S7.11): a panel for this floor's `trace`. Load reads a
  PNG, JPEG or WebP, redraws it at most 2000 px on the long side (a PNG stays
  PNG under 1 MB, else JPEG at 0.85, lower if needed to fit 4 MB) and places
  it over the outline's box, or the view on a blank floor. Scale takes two
  clicks on the image and the real distance between them in cm, and sets `w`;
  the aspect ratio follows. Opacity is a slider, Show a checkbox, Remove drops
  it. Each is one undo step. While it is shown, room fills are see-through in
  the editor so traced rooms do not hide the scan. File, Export has an
  Include trace image tick, off by default and not remembered.
- Selection panel per kind: corner, edge and wall (length, angle, kind, and on
  a free wall the conversion to an opening), door (name, kind, length, sensor,
  cover), room (name or area, kind, colour, unsnap, rotation; the colour
  is a swatch of one of twelve floor materials, White ceramic, Marble, Sand,
  Terracotta, Light oak, Warm wood, Dark oak, Walnut, Light grey, Grey floor,
  Belgian stone or Lava, then the custom colours used before, then seven
  textures: three woods and four stone tiles; or any colour typed in), stairs
  (name, shape, steps shown read only, diameter, rotation, colour and texture
  as for a room), device (entity, rotation, length
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
- Theme (S1.53, reworked S2.12, role system added S4.21, six more added
  2026-09-28): every colour in `FLOORPLAN_CSS` is a `--fp-*` custom property.
  Thirteen themes: **Blueprint**, the default and the base selector,
  **Midnight** (blueprint's old palette, kept under its own name), **Light**,
  the paper-and-ink set, **Slate**, **Terminal** and **Solarized** (see
  "Role-generated themes" above), **Home Assistant**, whose neutrals are
  `var(--card-background-color)`, `var(--secondary-background-color)`,
  `var(--primary-text-color)` and `var(--secondary-text-color)`, each with
  midnight's plain hexes as its fallback (dark when `data-mode="dark"`), and
  six more role-generated presets, Diego's picks: **Coffee**, **A-Team**,
  **Space**, **Cyberpunk**, **Carpenter Brut** and **Beach House** (see
  "Role-generated themes" above for their base/foreground/line/accent). A `data-theme`
  attribute, on the
  editor's own host or on one plan's root, picks one; none means blueprint. The
  OS colour scheme is not read by the card or the plan. The standalone editor
  page has a blueprint ground; the editor's `ha` theme follows the host's
  `haDark` property when the panel sets it, the OS when it does not. The
  accent buttons (primary, warn, danger) keep the same hex in every theme:
  each already clears 4.5:1 against the theme-invariant text tokens
  `--fp-on-dark`/`--fp-on-light` it is paired with (orange was tried for
  primary and failed 4.5:1 with white text; folding them into the new accent
  role repeated the same mistake and was reverted, Opus review 2026-09-22). A
  chip per theme in the View menu, default Blueprint, kept in the browser
  under `floorplan-studio:theme`, never in the layout and never an undo step;
  a blocked store, an unknown value, or an old `auto` or `dark` falls back to
  Blueprint. The editor's own chrome follows the same theme as the plan, and
  every button keeps its 4.5:1 contrast (S1.40) in every theme. A per-room
  colour keeps its own hue in every theme; only the room's name ink/outline
  flips to stay readable. The card takes `theme` from its config.
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
  Edit, Group dims everything not in the chosen group.
- Automations: a switch controls many targets; a motion group turns on a light
  group, off after N minutes; a device gets an on/off schedule. Each is created
  in HA, then HA's editor opens on it. One switch to one light is not an
  automation: it is the light helper above.
- Room box: for the selected room, everything in its HA area by domain, with
  Run on scenes, Edit in HA on automations and scripts, and "Add to area" for
  entities that have none.
- Place (S8.1): the room panel's "Place N Home Assistant devices" opens a
  draggable popup listing the area's entities the plan does not show yet,
  one tick per row and a chip per type to narrow it; Place puts the ticked
  rows on free spots in the room, one undo step. Only types the plan has an
  icon for are offered (`AREA_PLACEABLE_TYPES` in `core/ha.ts`); `other`
  (power, energy, illuminance, groups, scripts...), `battery` and `person`
  are noise (`AREA_NOISE_TYPES`). Every device type is in exactly one list.
- Every write: confirm dialog naming what will be created, label
  `floorplan-studio` on the result, and the note that HA cannot undo it.
- Home Assistant popover (Edit, Home Assistant; S8.1): a draggable panel, X
  top-left, with a line saying what it is, then everything in HA labelled
  `floorplan-studio` — helpers, areas, automations — whole-instance, not just
  the current plan, so an item orphaned by a plan edit still shows up. A
  name opens the item where HA edits it (more-info for a helper, the
  automation editor, the area page); Remove deletes it there; removing
  something from the plan never touches HA on its own. The button is
  disabled while the list is empty; the list loads when the writer is set
  and again after every create or remove. Opening the popover closes the
  menu.
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
