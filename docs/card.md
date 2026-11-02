# The card

`custom:floorplan-studio-card` draws one floor of your plan as a live Lovelace
card: rooms, walls, stairs, furniture and every device you attached to a Home
Assistant entity, in one glance, at scale.

![The card showing the demo ground floor, two lights and the hall motion sensor on.](img/card-overview.png)

## Adding it to a dashboard

Nothing to install by hand — the integration serves the card's script to every
dashboard. (The card is one file plus one more, `floorplan-studio-3d-<hash>.js`,
the 3D view, which the browser fetches only the first time someone picks 3D.
HACS delivers both. If you ever copy `www/` by hand, copy both.) Add the card by its type:

```yaml
type: custom:floorplan-studio-card
```

With no other keys it draws your plan's floors as a switcher — one chip per
floor, the first one shown — when your plan has more than one; with only one
floor there is nothing to switch, so it just draws that. Either way: the
`blueprint` theme, motion fading over 120 seconds, `room_glow` off, darker
after sunset.

In Home Assistant 2026.6 and later, the dashboard's card picker (Add card, By entity) lists the card under Community when you pick a light, switch, sensor, climate, cover, camera, fan, lock, media player, person, vacuum, siren or alarm entity, with a live preview of your plan; the suggestion is the config above.

The editor itself can write this for you: File → Install code opens a panel
with a whole dashboard, matching your plan as it currently stands — theme,
floors — ready to paste. See "A premade dashboard" below.

## Config keys

| Key | Default | What it does |
|---|---|---|
| `floor` | the switcher, if the layout has more than one floor; its only floor otherwise | which floor to pin to, by its id (`ground`, `first`, ...) — no switcher, just that floor; `all` shows the switcher explicitly; an id the layout doesn't have is treated the same as leaving `floor` unset |
| `floors` | unset | an array of floor ids: shows a switcher over only these floors, in this order, defaulting to the first one. Takes precedence over `floor`. An id the layout doesn't have is dropped; if none of them match, this is the same as leaving `floors` unset |
| `theme` | `blueprint` | `blueprint`, `midnight`, `light`, `slate`, `terminal`, `solarized`, `ha`, `coffee`, `a-team`, `space`, `cyberpunk`, `carpenter-brut` or `beach-house` (see Themes, below) |
| `layout` | unset | a whole layout object, written inline in the card's YAML. It is migrated and validated like any file; if it fails, the card shows the first problem. Checked first, so it wins over `layout_url` and the saved plan. Mostly for tests and one-off cards: a real plan is long |
| `layout_url` | unset | a URL the card fetches once for a layout (JSON, the same shape as a saved layout file). Used when `layout` is not set; with neither, the card asks the integration for the plan saved in Home Assistant. A failed fetch reads "No layout" |
| `fade` | `120` | seconds a motion sensor takes to fade from red to nothing after it goes off |
| `plug_heat_from`, `plug_heat_to` | `0`, `2000` | the draw range a plug's colour runs over, in watts: blue at the low end, amber half way, red at the high end. Two numbers with from below to; anything else is `0` and `2000`. See Plugs |
| `plug_watts` | `2` | a plug is active from this many watts of measured power, not merely while switched on — see Plugs, below. A number `0` or more; anything else is `2` |
| `room_glow` | `false` | tint a room's fill when any light inside it is on |
| `zoom` | `true` | pinch, drag and double-tap on a phone; Ctrl/Cmd+wheel and drag on a desktop; +, − and fit buttons in the zoom cluster at the top right of the plan. Fit to 8×. `"wheel"` also zooms on a plain wheel (the dashboard then does not scroll over the plan). At fit a vertical swipe over the plan scrolls the dashboard; zoomed in, it pans the plan. `false` fixes the plan and gives every touch back to the page |
| `night` | `auto` | `auto` darkens the plan after sunset (see Night, below); `on` always, `off` never |
| `sun` | `sun.sun` | the entity `night: auto` reads: `below_horizon`, or `on` for a binary sensor, is night |
| `view` | `2d` | `2d` draws the flat plan, `2.5d` draws it with depth (see 2.5D view, below), `3d` draws it as a real 3D model you can turn (see 3D view, below). Anything else is `2d` |
| `view_switch` | `true` | `false` drops View, Tilt, Walls, Floor below, Theme, Labels and Device names from the ⋯ menu (Detail, Layers, Rotate and Reset view stay). `kiosk` hides the menu too |
| `rotate_switch` | follows the other controls | the Rotate left and Rotate right items of the ⋯ menu and the Left/Right keys. Unset: shown on every card that draws zoom or the View controls, hidden under `kiosk` and on a card with `zoom: false` and `view_switch: false`. `false` hides them, `true` shows them even under `kiosk` |
| `names` | `false` | `true` writes every device's name under its icon, the studio's Names toggle. The Device names item of the ⋯ menu changes it for as long as the card is on screen |
| `tilt` | `0.5` | how steeply 2.5D looks down, `0` (top-down, no lift, reads as 2D) to `1` (side-on). A number outside that clamps; anything else is `0.5`, the look before this key existed. Only read in 2.5D, and the control is hidden in 3D. See Tilt, below |
| `ghost_floor` | `false` | `true` draws the floor under the shown one as faint lines, at its place in the house (the floors' `offset`s and `rotation`s, so a floor drawn turned a few degrees on the one below lines up). Only `true` counts; junk is off. The Floor below item of the ⋯ menu (2D and 2.5D) changes it for one viewer and the card remembers the pick; the lowest floor has none |
| `floors_below` | `off` | 3D only: `ghost` draws every floor under the shown one translucent, `solid` in its own colours, `off` none. Junk is `off`. The Floors below radios of the ⋯ menu change it for one viewer; the pick is remembered |
| `detail` | `auto` | how much of the plan is drawn at each zoom (Detail, below): `auto` follows the zoom, `full` always draws everything, `minimal` always draws only rooms and what needs attention. Unset or anything else is `auto`, but `full` where the viewer can neither zoom nor reach the Detail button (kiosk, or `active_list: false` with `zoom: false`). The Detail items of the ⋯ menu change it for one viewer, and a viewer's own pick wins over this key |
| `camera_thumb` | `off` | `on` draws a small live picture beside each camera icon, in 2D, 2.5D and 3D (see Camera thumbnail, below). `off`, absent and anything else draw none and make no request. YAML turns an unquoted `on` into `true`; both work. The Camera thumbnail items of the ⋯ menu and the visual editor change it, and a viewer's own pick wins |
| `camera_thumb_size` | `medium` | `small`, `medium` or `large` (64, 96 or 144 cm wide at the icon's scale, 16:9). Anything else is `medium` |
| `camera_thumb_pos` | `below` | `above`, `below`, `left` or `right` of the icon. Anything else is `below`. The picture is pulled back inside the card when the camera is near an edge |
| `heat_map` | `off` | `off`, `temperature` or `humidity`: fills each room that has a reading by a fixed scale and draws a legend (see Heat map, below). Anything else is `off`, with one console warning. The Heat map items of the ⋯ menu change it for one viewer, and a viewer's own pick wins over this key |
| `favourites` | unset | a list of entity ids (`favorites` is read too; `favourites` wins when both are set). They get a Favourites section at the top of the Overview (see Overview, below). Up to 24; anything that is not an entity id and every repeat is dropped, with one console warning per card |
| `walls` | `cut` | how 2.5D and 3D draw wall heights: `full` every wall at its real height, no cutaway; `cut` the doll's house look, walls facing you lowered so the rooms show; `low` every wall at the cutaway height. Anything else is `cut`. Read in 2.5D and 3D. See Walls, below |
| `labels` | `true` | `false` hides every name and value on the plan (rooms, zones, structures, device names, sensor values), so only icons and state are left. Anything but `false` shows them |
| `rotation` | `0` | degrees the plan starts turned, in steps of 45: `0`, `45`, `90` ... `315`. Any other number rounds to the nearest step; anything that is not a number is `0`. Text and icons stay upright. A viewer's own turn is remembered over this — see View memory and reset, below |
| `kiosk` | `false` | `true` shows only the plan, nothing else — see Kiosk mode, below |
| `open_color` | red | `#rrggbb`: colours an open door or window, or a door whose vibration sensor triggered (and either one's pulsing alert line), instead of red. An invalid value is ignored |
| `icon_size` | `1` | grows icons, names, values and radar dots by this factor, on top of the automatic scale-up on a large plan (see Size, below). A number from `0.5` to `3`; anything else clamps into that range, and a missing or non-numeric value is the default, `1` |
| `tap_action` | `popup` | what a tap on a device icon does, in 2D and 3D: `popup`, `more-info`, `toggle` or `none` (see Tap, hold and hover, below). Written as `tap_action: {action: toggle}`; a bare string (`tap_action: toggle`) counts too. Anything else, including Home Assistant's `navigate`, `url`, `perform-action`, `call-service`, `assist` and `fire-dom-event`, is `popup`, with one console warning per card |
| `hold_action` | `more-info` | what a long press (500 ms) on a device icon does: `more-info` or `none`. Anything else is `more-info`, with one console warning. `kiosk` never holds |
| `active_list` | `true` | `false` hides the Overview sheet and Search; the popup floats at every width — see Overview, below |
| `center` | unset | `[x, y]`, plan cm: the point a pinned card zooms in on — see A card for one room, below. A non-array, wrong length, or non-finite value is ignored, silently, and the card shows the whole floor |
| `zoom_level` | `1` | how far in a pinned card starts: `1` is the whole floor, `2` is half its width and height, and so on up to `8`. Anything other than a finite number is the default, `1`; an in-range-but-odd number (`0`, negative, past `8`) clamps instead of being refused |

```yaml
type: custom:floorplan-studio-card
floors:
  - ground
  - first
fade: 120
room_glow: true
theme: blueprint
zoom: true
kiosk: false
icon_size: 1
active_list: true
```

## Updates

A state change from Home Assistant redraws only what it changes. The card builds the plan the same way every time, then compares it to
what is on screen and rewrites the nodes that differ: the device's icon, and what hangs on it (a lamp's light, its room's glow, the
room badge). Other icons are not replaced, so a fade or a glide runs on the same element. An update that changes nothing writes nothing.

## Loading the plan

With no `layout` and no `layout_url`, the card asks the integration for the saved plan.

- **One request per page.** Cards on the same dashboard share one request, and a config change that keeps the source (the card form
  calls it on every keystroke) keeps the plan on screen. The reply has no trace images; only the Studio, for an admin, gets those.
- **It says why it failed.** The card shows the integration's own message. "No layout: install the Floorplan Studio integration" shows
  only when Home Assistant does not know the command. After a failure it tries once more on the next `hass` update and again when the
  connection is ready; it never loops.
- **Nothing saved yet.** "No plan saved yet. Open Floorplan Studio in the sidebar to draw one." with a link to the Studio for admins.
- **Follows a save.** An open card reloads the plan after a save in the Studio, for any user, through the integration's
  `floorplan_studio/subscribe`. Against an integration older than that, only admin sessions follow a save (Home Assistant lets only admins
  subscribe to the `floorplan_studio_updated` event); anyone else needs a page reload.
- **A page older than the server.** If the plan is refused and the installed version differs from the page's, the card says "Floorplan
  Studio was updated. Reload this page."

## 2.5D view

`view: 2.5d` draws the same plan with depth: walls rise, furniture becomes
boxes, stairs become steps. The floor itself stays true to the plan, so
rooms, icons and taps sit where they do in 2D; only what stands up is drawn
up and to the right (a vertical oblique projection, seen from the south-west).

Three devices also get a body in 2.5D, beside their icon (which stays the tap
target): a **radiator** (a heater drawn as a bar) is a box 8 cm deep, from 10 cm
up to 70 cm (just under a window sill), tinted orange while heating; a
**speaker** or media player is a 20 x 20 x 30 cm cabinet at its point, with
two round drivers that light while it plays; a **TV** is a flat panel 100 cm
wide and 6 thick on the nearest wall within 150 cm (free-standing, facing you,
when there is none), its screen lit while it is on. `z` on a device moves the
radiator's top and the TV's bottom.

A device's `fx` (the editor's "effect size (%)", 25 to 300, default 100) scales
the effect it draws: a lit lamp's aura, a playing speaker's or media player's
waves, a triggered motion or contact sensor's ring and a siren's rings, in 2D,
2.5D and 3D (a lamp's floor pool and wall light too). A **siren** (any device
whose entity is `siren.*`) that is on sends out two red rings, twice as far as a
speaker's waves, on a thicker line and a faster beat; with reduced motion they
hold still at twice the size. Each type keeps its own base size, so 100 is what
the card drew before the field existed.

In the ⋯ menu (**View options**, in the header) the **View** radios switch between `2D` and
`2.5D` for as long as the card is on screen. It keeps your zoom and pan, and a
reload goes back to `view:`. `view_switch: false` removes the radios and
`kiosk: true` does too; the configured `view` still applies.

A **Tilt** section (five presets, flat to steep) sits in the menu while the view is 2.5D, and
disappears in 2D (and with `view_switch: false` or `kiosk`). Left is top-down,
right is side-on; the middle is the default look. Picking a preset redraws the plan
only: zoom and pan stay, and like the View pick it is forgotten when the
config changes. The `tilt` key sets where it starts. The near walls are cut
lower as the tilt grows, so a room is as visible at a steep tilt as at the
default; at `0` nothing is lifted, so nothing hides anything.

**Walls** sets how tall the walls are drawn. `cut` (the default) keeps a wall at
its real height unless it faces you or hides a room behind it; those ease down
to the cutaway height, so walls at different angles do not all stand equally
tall, and a plan turned a little shows tall side walls and low front walls.
`full` draws every wall at its real height: nothing is cut, and the near walls
can hide the rooms behind them. `low` draws every wall at the cutaway height
(a wall that is shorter anyway, such as a fence, stays as it is): all equal,
every room visible. One straight wall made of several edges (rooms side by
side along one line) always has one height in `cut`.

Depth in 2.5D (always on, no key): a soft stepped shadow band lies along both sides of every wall and a patch under
every piece of furniture, appliance and device body, so things sit on the floor; there is none at tilt `0`, none under
something hung on a wall, and it darkens with the rest of the floor at night. A tree stands: a trunk rises to 60 % of its
height under a crown hung at 75 %, with its shade at the foot. Doors, glass doors, windows, slits and full-height windows
have a frame (a jamb each side, a head, a sill on a raised window); a doorway, a plain opening and a sealed panel do not.

In 2.5D a wall face is lit by which way it looks on screen (lit, plain, dim),
with a darker foot and a thin lit top edge; the cap on top is thinner than the
flat wall. A door is a painted leaf (`--fp-door`) and a glass door is glass only while closed:
every contact sensor says off, or a lock says locked. With neither, or any other state, it is a hole. An open door or
window, a lock left unlocked or a vibrating door is red (`--fp-open-door`) on
the face and the frame, as its line is in 2D; closed, unavailable or without a
sensor it is not. A cover left open on a plain door stays orange. A room whose
motion sensor is on draws a thin border just inside its walls in the sensor's
colour, and it fades with the icon over `fade` seconds. A radar counts as a
motion sensor here and in the Active list.

A **Walls** section (Full height, Cutaway, Low) sits next to Tilt in the menu
while the view is 2.5D, and goes with it in 2D, with `view_switch: false` and
in `kiosk`. A pick redraws the plan only and the card remembers it (below). The
Edit-card form has the same list; the `walls` key sets where it starts.

![Tilt 0, top-down.](img/card-2-5d-tilt-0.png)
![Tilt 1, side-on.](img/card-2-5d-tilt-1.png)

`labels: false` is for a card that should show only what is on: no room names,
no zone names, no sensor values, no leader lines. Icons, auras, state, fades
and taps are unchanged. It works in 2D and 2.5D.

![A card with labels: false.](img/card-labels-off.png)

- Walls are drawn at their height (250 cm by default). The walls on the
  near, south-facing side of the house are cut down to 90 cm, like a doll's
  house with the front taken off, so they never hide the rooms behind them.
  So is any wall facing north whose lift would cover another room's floor (the
  Hall's north wall over the Living room); a back wall with nothing behind it,
  or only a garden, pavement or zone, keeps its full height. A wall seen
  side-on keeps its height; while you rotate, the cut eases in and out.
  A fence keeps its own height; kerbs and boundary lines stay flat.
- A door is a gap in the wall, a window is a band of glass above its sill, a
  slit window is a band of glass 60 cm high against the ceiling, a
  full-height window is a window from the floor to 40 cm under the ceiling, a
  glass door is glass from the floor, a sealed door is a solid panel, an open
  doorway is a gap with nothing in it (while its sensor trips, a solid alert-colour band fills the gap: no dash, no pulse; in 3D a thin glass-like slab). The
  door line at floor level still shows open, closed and alert.
- Furniture and appliances that no entity runs are boxes with their symbol
  on the lid. Heights come from the layout (`height`) or a default per kind.
- Mount heights (S14.5): a ceiling light hangs at 215 cm, a camera, motion sensor, radar and access point at 205, an air conditioner at 195, a cover motor at 175, a thermostat or temperature sensor at 135; the editor's mount height field shows the preset and a device with its own `z` keeps it. In 3D an icon also stays 25 cm under the top of the walls.
- A device mounted at 100 cm or more (a ceiling light, a camera, a smoke alarm)
  is drawn where it hangs, lifted with the walls, with its light radius, camera
  cone, rings, name and value. A small pin stays on the floor under it, joined by
  a thin stem. Tap the lifted icon; the pin takes no taps. A person, a heater bar
  and anything under 100 cm stay on the floor. A radar's target dots stay on the
  floor too: they are positions in the room.
- Heights are set in the editor's inspector (see `docs/editor.md`).

## A card for one room

`center` and `zoom_level` pin a card to a room, corridor or part of a home
instead of the whole floor, so a dashboard can show several cards, each
zoomed into a different place. `zoom_level` alone zooms in about the plan's
own centre; `center` alone (or `zoom_level` at `1`) changes nothing — a
centre with nothing to zoom into has no effect. `center` is always the plan's
own cm, the same coordinates a room or device sits at, whether or not the
layout is rotated.

The pinned view becomes the card's own "home": a double-tap and the
zoomed-in indicator both return here, not to the whole floor. The Fit button
reads **Home view** on a pinned card, since it no longer fits the whole
floor, and is disabled only when the view is already home — pan or pinch it
away and Home view lights back up. (**Reset view** is a different control, an item of the header's ⋯
menu: it also drops the remembered turn, view and theme — see View memory and
reset, below.) The − button is never gated by the pin:
it is disabled only once the whole floor is on screen, so a pinned card can
still zoom all the way out to see the rest of the house.

The demo's kitchen sits around plan `(650, 200)` — two cards, one on the
whole ground floor and one pinned to just the kitchen:

```yaml
type: custom:floorplan-studio-card
floor: ground
```

```yaml
type: custom:floorplan-studio-card
floor: ground
center: [650, 200]
zoom_level: 2.5
```

The easiest way to get the two numbers for your own home: open the editor,
zoom and pan to the room you want, then View → **Copy card view**. It copies
the `center:`/`zoom_level:` lines straight from what the editor is showing,
ready to paste into the card's YAML. A pinned card is meant for one floor —
set `floor:` alongside `center`/`zoom_level` if the layout has more than one.

## Size

The card fills whatever space a dashboard gives it and never crops the plan.

In the sections layout, the card's resize handle starts at a row count taken
from your plan's own aspect ratio, and dragging it taller or shorter
letterboxes the plan (empty space above and below, or left and right) rather
than cutting it off. It won't go narrower than 6 columns or shorter than 3
rows, so the plan stays legible.

In the masonry layout, and anywhere the card's parent gives it no height of its own (a stack, `rows: auto`), the card is
the plan's height at its width plus the 52 px header, **cut to the screen**: never taller than the visual viewport less
Home Assistant's header (`--header-height`, 56 px when there is none) and 16 px. A tall plan letterboxes in what is left
instead of running past the bottom edge. With the Overview as a side sheet (640 px and up) the plan is drawn in the card less the sheet, so the card is sized from the sheet's resting state: its open width from 900 px, where it opens by default, and the 52 px rail below that or after you fold it by hand. Picking a room never changes the height. The plan letterboxes only while a pick has opened the sheet over a rail (a tablet under 900 px, or a card folded by hand), never from the sheet at rest. The card follows a window resize and a phone's address bar. On a phone (under
640 px wide) it is at least 640 px tall, or the room that fit allows, so the bottom sheet's half stop has room. A sections
row, a panel view and a height set by hand on the card keep their own height, as they did before 0.29. There is no key
for this.

On a plan over 1000 cm on its longest side, icons, names, values and radar
dots stop shrinking with it and grow instead, so they stay legible in a big
house. `icon_size` scales them further on top of that, from half size to
three times, for a plan that still reads small, or a tablet viewed from
across the room.

## Language

The card's own text (buttons, the Overview, the room panel, search, the View menu) follows `hass.language`: Italian, Spanish, Portuguese (`pt` and `pt-BR`), French, German, Dutch, Simplified Chinese (`zh-Hans`) and Polish. Any other language, and Traditional Chinese for now, reads English. Home Assistant's own words (state names, units, area and entity names) are left as Home Assistant gives them. Each language is a small file (about 3 KB) fetched when needed, so an English dashboard loads nothing extra. Change the profile language and the card follows at the next update, with no reload. No native speaker has reviewed the translations yet.

## Studio and card

The card's chrome sits around the plan, not over it: a 52 px header (floor tabs, Search, ⋯), one sheet (the Overview, see
below) beside the plan from 640 px or under it on a phone, and a small zoom cluster on the plan (+, −, Fit; Reset camera in
3D), the only thing that floats over it. Everything about how the plan looks is in the header's ⋯ menu ("View options"): View, Tilt,
Walls, Floor below, Theme, Labels, Device names, Detail, Layers, Heat map, Rotate left, Rotate right
and Reset view. Each item writes what the old control wrote, into the same view memory.
Theme is one drop-down with every theme in it (a native select: click it, or Arrow to it and press Enter, Space or
Alt+Down), not a row of radios. A pick sets the theme, closes the menu and returns focus to the ⋯ button. The Studio's own Theme control is unchanged.
`view_switch: false` drops the look items and keeps Detail, Layers, Heat map, Rotate and Reset; a
kiosk has no menu, except that `rotate_switch: true` shows one with Rotate and Reset.

"Everything you do in the studio you can do in the card", for **viewing**. Each
control of the editor's View menu, its zoom group and its Layers tab, and what
the card does about it. A test (`tests/card/view-parity.spec.ts`) reads the
editor and fails on a control that has no row here, so a new one gets a decision.

| Studio control | In the card | Why |
|---|---|---|
| `#labelsSub` Labels submenu | yes | holds the two rows below; the Labels and Device names items of the ⋯ menu |
| `#labels` Names and values | yes | the Labels item of the ⋯ menu |
| `#names` Names | yes | the Device names item of the ⋯ menu, config `names` |
| `#thSub` Theme | yes | the Theme drop-down of the ⋯ menu (the Studio's own control is unchanged) |
| `#fit` Fit to window | yes | the Fit button (Home view on a pinned card) |
| `#recenter` Re-center | yes | the same Fit button |
| `#zin` `#zout` Zoom | yes | the + and − buttons in the cluster, the Up and Down keys, pinch and wheel |
| `#zreset` Reset view | yes | the Reset view item of the ⋯ menu, and Space |
| `#vrotl` `#vrotr` Rotate view | yes | the Rotate left and Rotate right items of the ⋯ menu (and the Left and Right keys) |
| `#snap` Snap grid | no | an editing aid: a viewer places nothing |
| `#mgrid` Measure grid | no | an editing aid, drawn by the editor over the plan, not by `renderFloor` |
| `#lens` Lengths | no | an editing aid |
| `#ghostFloor` Floor below | yes | the Floor below item of the ⋯ menu (2D and 2.5D), kept per viewer; config `ghost_floor`. In 3D the same choice is the Floors below radios (off, ghost, solid); config `floors_below` |
| `#night` Preview night | no | a preview of what the card already does by itself (`night`, `sun`) |
| `#viewsSub` Saved views | yes | the Views section of the ⋯ menu, one item per view of the layout on a floor the card shows; a pick sets floor, mode, turn, zoom and centre like any viewer's pick (a view with no turn turns the plan to 0, in 3D the floor's framed camera stands), kept per viewer; Reset view goes back to the config. A view is saved in the Studio, into the layout |
| `#saveView` Save current view | no | authoring: it writes a view into the layout, which a card never does |
| `#viewsNone` No saved views on this floor | no | the empty-state note of the Studio's submenu |
| `#copyCardView` Copy card view | no | authoring: it writes the card's `center` and `zoom_level` |
| `#camSub` Camera thumbnail (On/Off, size, position) | yes | the Camera thumbnail, Thumbnail size and Thumbnail position items of the ⋯ menu (also in 3D); kept per viewer; config `camera_thumb`, `camera_thumb_size`, `camera_thumb_pos`. Inside Home Assistant the picture is live; standalone the Studio has no camera state, so none is drawn |
| `#heatSub` Heat map (Off, Temperature, Humidity) | yes | the Heat map radios of the ⋯ menu, same three choices; kept per viewer; config `heat_map`. Not in 3D. Inside Home Assistant both show live readings; standalone the Studio has none, so no room is heated and its status bar says so |
| `#detailSub` Detail (Auto, Full, Minimal) | yes | the Detail radios of the ⋯ menu, same three choices; kept per viewer; config `detail`. The Studio starts on Full, the card on Auto. Not in 3D |
| `#tabLayers` Layers (hide a family) | yes | the Layers section of the ⋯ menu has a check per family: a pick hides it, Alt-click shows it alone; kept per viewer. Not in 3D |
| Favourites | card only, on purpose | the `favourites` key and its Overview section are card chrome, not a view control; the Studio has its Outline and Search. The Edit-card form sets the key |
| Plan view, Tilt, Walls | card only | the View radios, the Tilt presets (flat to steep) and the Walls radios of the ⋯ menu. The studio has no 2.5D since 0.14 (S12.1); the card keeps 2D and 2.5D, and gets 3D |
| Room facts and device details panel | card only | the card's sheet (Picking a room); the studio already has its own selection panel with the room's fields and each device's entity |

Also the same in both: the floor switcher (chips and tabs), pan and zoom by
pointer, the view remembered per browser, and Reset view clearing it. The
editor's other menus (Add, which also holds Draw, Floors, Edit, File, Help, Undo) change the plan,
which a card does not.

## Kiosk mode

`kiosk: true` is for a tablet fixed to a wall: nobody there should be able to
switch floors, zoom out past what fits, or reach Home Assistant's more-info
dialog by holding a finger on a device. It hides the header (floor tabs,
Search and ⋯), the Overview sheet and the zoom +/−/fit buttons and the rotate buttons (`rotate_switch: true` brings
those back, with a ⋯ menu that holds only Rotate and Reset view), and a long press does nothing — a plain tap still
opens the device's popup, whose button operates it, as without kiosk mode, but the popup has no
**More info** link: nothing in kiosk mode reaches Home Assistant's dialog. A **linked piece** (a car, a tv, a speaker or a
computer drawn as furniture with an entity) does nothing at all on a tap or a hold in kiosk, since its tap is more-info.
Before 0.33.0 a tap on one opened more-info in kiosk; that was a leak and is fixed. The same holds on every other path: an
unlinked speaker or TV with a media player, and a media player icon, do nothing on a tap in kiosk, and `tap_action: more-info`
opens the popup instead (it has no More info link there).

Kiosk is the plan alone: the card is as tall as the screen allows (see Size), the plan is one Tab stop and its keys work
(see Keys on the plan), and a tap on a device opens the popup on every width.

`kiosk: true` shows the first floor and draws no switcher whatever would
otherwise have produced one — `floors`, `floor: "all"`, or simply a
multi-floor plan with neither key set — since there is nothing to switch
with. For several floors on one wall tablet, use one card per floor
instead — for example a view with a tab per floor:

```yaml
title: Floorplan
views:
  - title: Ground floor
    path: ground
    cards:
      - type: custom:floorplan-studio-card
        floor: ground
        kiosk: true
  - title: First floor
    path: first
    cards:
      - type: custom:floorplan-studio-card
        floor: first
        kiosk: true
```

## Overview

One sheet that says what is wrong before what is on. It is also the card's one place for
detail: its levels are **Overview › Floor › Room › Device**, with **Back** (and Escape) one level up and a crumb that
reads "Home › Ground". The header counts: alerts first, then one chip per category ("2 alerts · 6 lights · 1 plug"), or
"Nothing on".

Where it sits depends on the card's own width, not the screen's:

- **640 px and up: a side sheet** in its own column beside the plan, `clamp(260, 32 %, 320)` px wide. Nothing is drawn over the
  plan. **Fold overview** (▾) shrinks it to a 52 px **rail**: one button, **Open overview**, with the alert count. The sheet
  starts open from 900 px and as a rail below, until the viewer folds or opens it; a room or floor pick opens it either way.
  A tap on a device on the plan still opens the small popup beside the icon; a row tap opens the same popup.
- **Under 640 px: a bottom sheet.** At rest it is a 64 px **peek** under the plan, one line ("Home › Ground · 2 alerts · 6
  lights"). Drag its handle (or tap it) to the **half** stop, `max(50 %, 340 px)` of the card, or to **full**; a fast flick
  goes one stop. A room, a device tap, a locate or Search opens it higher and pans the plan so what it opened for stands in the
  part the sheet leaves; a tap on a device opens the **Device level** in the sheet (the popup's content: nothing floats on a
  phone). Back and Escape step up one level, and from the Overview to the peek. With reduced motion the sheet jumps.
  Neither the level nor the height is remembered across reloads.
- **No sheet** with `kiosk: true` or `active_list: false`: the header keeps the floor tabs and ⋯, the popup floats at every width,
  and Search (which opens in the sheet) is not offered.


From the top:

- **Search.** The **Search** button in the header, or ⌘K, Ctrl+K or `/` while the card is focused or under the
  pointer (on a phone it opens the sheet at full). Type a few letters of a device, room or floor; Enter goes to it.
  Accents do not matter ("soren" finds "Søren"). Escape closes it.
- **Turn off on this floor…** A checklist of what is on, grouped as Lights
  (with the switch that powers them), Switches, Plugs and Media. Everything
  starts ticked; untick what should stay on. "Turn off 4" sends exactly the
  ticked ones. Cancel or Escape sends nothing.
- **Layers** are in the ⋯ menu, not here: a check per family on this floor. A pick hides the
  family on the plan; Alt-click shows it alone. Kept per viewer, in this
  browser. Not in 3D. Search still finds a hidden device and draws it.
  (A note with **Show** stays in the sheet while a located device of a hidden family is drawn anyway.)

- **All floors.** Lists every floor, each row badged with its floor. By
  default the list shows the floor on show.
- **Favourites.** The entities in the `favourites` key, above Attention, in the key's order, on every floor the card shows
  (a floor badge when it shows more than one). A row is an Active row with the popup's button beside it: Turn on acts; Turn
  off asks first (**Confirm turn off**, **Cancel**, on their own line under the row) for everything but a light; Lock, Unlock,
  Open and Close as in the popup; a sensor or a camera has none. An unavailable one is dimmed with no button. A tap on the
  row goes to the thing. An entity that is not drawn on a floor the card shows has no row. It folds like a category. Search
  lists a favourite before a shorter name of the same rank. It is an Overview level section only: no sheet under `kiosk` or
  `active_list: false`, and not on a Floor or Room level. A card cannot write its own YAML, so there is no star in the popup:
  set the key in YAML or in the Edit-card form.
- **Attention.** Alarm triggered or armed, open doors and contacts, jammed
  and unlocked locks, leak, smoke and gas, low batteries, each with its age
  ("open · 12 min"). Unavailable devices sit in one folded row with a count.
- **Active.** Lights on (a light bound to a switch counts when the switch
  is), motion and contact on, media playing, heating, plugs drawing
  `plug_watts` or more (see Plugs), computers on, people home, vacuums
  cleaning, garage doors and gates open. Grouped by category; each group
  folds. Cameras are never listed. Something already in Attention is not
  repeated here, except a lamp that is on with a low battery.

A row tap goes to the thing: the plan switches floor, centres on it, rings it
and opens its popup (the Device level on a phone). Device details (model, firmware, area) are under
"Details" in that popup.

Floor tabs count the things that need attention on that floor ("Ground · 3").
A tab turns warning-coloured while an alarm on that floor is triggered.

**Low battery.** A device counts as low under 20 %. The card reads, in
order: the entity itself if it is a battery sensor; its `battery_level` or
`battery` attribute; else a battery sensor on the same Home Assistant device
that HA files as *diagnostic*. ZHA, Zigbee2MQTT, Matter and Shelly do that.
ESPHome does not unless you set `entity_category: diagnostic` in the YAML; or
place the battery sensor as its own icon. Home batteries, inverters, UPSes
and cars never raise it: their charge is a reading, not an alert.

**Folding.** The sheet can no longer be dragged; a position stored by an older card is ignored. The fold, the
scope ("All floors") and the folded groups are kept per card in this browser
(`localStorage`, `fp-active-panel:`), keyed to the layout's source and the card's own
`floor`/`floors`, so two cards on one dashboard do not share them. A Home Assistant update keeps the level, the scroll and
the fold.

**Touch.** On a touch screen (`pointer: coarse`) every control in the card is at least 44 x 44 px: header buttons, floor
tabs, Search and its results, the rail, Back, the handle, rows, ⋯ items, popup buttons and sliders, dialog buttons and check
rows, and the zoom cluster. A mouse keeps the smaller sizes.

## Picking a room

Tap a room, on its floor, its name, its readout or its furniture (not a device, a
door or a stair), and the room is outlined with a dashed line. The sheet goes to the **Room level**, with a room section on top (in the side sheet,
Back clears the pick; on a phone the sheet rises to half):

- the name and a cross that clears the pick;
- area in m², worked out from the room's corners;
- temperature and humidity, the same mean the plan prints under the name;
- motion, on or off, and since when;
- the open doors and windows on the room's walls (an unlocked lock counts), and the lights that are on;
- **Scenes** (S14.7): a button for each Home Assistant `scene.*` entity of the room (dashed border), for each custom scene saved on the
  room, then **Lights off** and **All on**. See below;
- the room's devices, then the sensors the room owns that have no icon on the plan, grouped by the same collapsible categories as the Overview.

**Scenes.** A scene button is one tap, no popup. A Home Assistant scene calls `scene.turn_on`. A scene belongs to the room when its
area is the room's area (the scene entity's own `area_id` in `hass.entities`, else its device's `area_id` in `hass.devices`; the Hue
integration puts its scenes on the Hue room's device, so Hue scenes appear on their own), or when the studio lists it in the room's
`haScenes`. A custom scene is a name and a list of lights and switches, each on or off, a light with an optional brightness (1 to
100 %), colour temperature (K) or colour (`hs`); it calls `light.turn_on` or `light.turn_off` per light and `switch.turn_on` or
`switch.turn_off` per switch, with only the fields it sets. **Lights off** and **All on** are one `light.turn_off` or `light.turn_on` over the lights drawn
in the room. They are lights only, so they do not ask first, the same as a light's popup (S14.2). A custom scene that turns a
switch off asks first: its button turns into **Confirm: name** with a Cancel next to it. A room with no scene and no light shows no
Scenes label. Scenes are in the Room section, so they need the Overview (not `kiosk`, not `active_list: false`).

A tap on a row opens the same popup as the icon on the plan, for every type (a radiator's has only **More info**); a hold opens
Home Assistant's more-info. On a phone the room level is the bottom sheet at half, and the plan pans so the room stays in view above it. Below, the lists are cut to the room's
entities; **Show all** brings the rest back and keeps the room picked.

Tap the room again, tap off any room, press Escape (with the pointer over the
card or the card focused, as for the view keys), press Back or (on a phone) the cross to clear it.
Escape and Back go up one level, to the floor, and again to the Overview, at every width.
Changing floor clears it too. A tap on a device, a door or an appliance keeps its
meaning and never picks a room. A double tap zooms and leaves the pick as it
was. Under `kiosk: true` or `active_list: false`
there is no sheet, so a tap picks nothing. A side sheet folded to its rail opens while a room is picked.

A device's popup has a folded **Details**: manufacturer, model, firmware, area,
entity id, state and when it last changed, from Home Assistant's device
registry. A device with no registry entry shows the entity id, state and last
changed. Not in kiosk.

## Detail

A house with hundreds of devices is unreadable whole. The card draws less when you are far out and more as you zoom in.
Zoom 1 is the whole floor at fit.

| Level | Zoom | What is drawn |
|---|---|---|
| far | below 1.6, and the plan under 400 px wide (below) | rooms, room names and room badges; a device that is on, alerting or unavailable stays as a dot, and so does one the Overview lists under Attention (an unlocked or jammed lock, a low battery, an open contact; it wears a thin ink outline so it never reads as a lit lamp); other idle devices go |
| mid | 1.6 to below 3.2 | device icons, room names and badges; no device names or readings |
| near | 3.2 and up | everything, with device names and readings |

The thresholds are fixed. In `auto`, the plan draws icons (the `mid` level) at zoom 1 too, and drops to dots (`far`) only
when the floor at fit is under 400 px wide on screen. That width is the floor's own rendered width, not the window's
and not the card's: a wide card in a tall, narrow house can still be small. A card on a phone is dots; one in a 1280 px
dashboard is icons. `full`, `minimal`, a `detail` key and the viewer's menu pick all win over the width. **Detail** (a section of the ⋯ menu) picks the mode: **Auto** follows the zoom,
**Full** is always near, **Minimal** is always far. The config key `detail: auto | full | minimal` sets the card's
default (anything else counts as no key; the Edit-card form has a Detail select). With no key the default is `auto`, unless the viewer could not change the level: with `kiosk`, or with `active_list: false` and `zoom: false` (no Detail item, no zoom buttons), it is `full`, so no idle device is out of reach. A key you write always wins, `detail: auto` in a kiosk included. A viewer's own pick is remembered in that
browser and wins over the YAML; Reset view clears it. With storage blocked the pick lasts until the page closes. Live 3D
draws every level.

## Camera thumbnail

`camera_thumb: "on"` draws a small live picture beside every camera icon, in 2D, 2.5D and 3D. Size and side come from `camera_thumb_size` and
`camera_thumb_pos`. The picture is the camera's `entity_picture` attribute, Home Assistant's own authenticated proxy path; the card adds `fp_t=<time>`
so the browser asks again, every 10 seconds. It asks for nothing while the tab is hidden or the card is off the page, and at once when you come back.
Only a path on your Home Assistant (or an inline `data:image/` picture) is used; a full address to another site is ignored, so the card makes no request
to a third party. A camera that is unavailable, or a picture that does not load, draws nothing (no broken-image icon) until the next refresh.

A tap on the picture opens the camera's more-info (live stream, controls), not the popup, whether you tap or hold; in kiosk it does nothing. The picture is
kept inside the card: a camera near an edge has its picture pulled back in. The ⋯ menu has Camera thumbnail (Off, On), Thumbnail size and Thumbnail
position for one viewer; the visual editor has the same three rows.

## Heat map

`heat_map: temperature` or `humidity` fills every room that has a reading by a fixed scale, and prints the value under the
room's name (also with `labels: false`; a colour with no number would fail the reader). The scale is absolute, so a colour
means the same thing every day: 16 to 26 °C (blue, amber at 21, red) and 30 to 70 % (sand, pale green at 50, blue). A value
past an end takes the end colour; the number printed is the real one. A legend strip sits at the plan's bottom left.

- **Which sensors.** The room's own `temps` (or `humidity`) list when any of it reads, the same mean the room's readout
  prints. Otherwise the `temp` (or `humidity`) devices placed in the room (the smallest room that owns the point; a sensor
  inside a zone feeds the room under it). A `climate` device's current temperature is not a source.
- **What is not a reading.** Unavailable, unknown, a comma decimal, a unit that does not belong (`K`, `%` on a temperature),
  and values outside -60 to 90 °C or 0 to 100 %. Each sensor is judged alone, so one faulty probe is left out and the room
  is read from the others. `°F` is converted for the colour and stays `°F` in the number. A room with no reading keeps its
  own fill and prints nothing. Fills, structures and zones never take heat; a garden or a pond does.
- **Over paint and night.** The heat covers a room's glow, its own paint or texture and water's colour (55 % ramp mixed
  into the room kind's colour, so a pond is still a pond), and no night veil is drawn, so the scale reads true. Lines
  (the lit room's outline, the motion perimeter, the picked room), auras and icons are drawn over it as before.
- **The menu.** A Heat map section in the ⋯ menu, after Layers: Off, Temperature, Humidity. It follows Detail and Layers:
  shown where they are (a floor, not in 3D) and so hidden under `active_list: false` and in kiosk, where `heat_map` in YAML
  still heats the plan and draws the legend. It stays under `view_switch: false`. Not in 3D: the items and the legend go and
  the pick is kept for 2D. The pick is the viewer's, remembered like Detail; an explicit Off beats a YAML mode; Reset view
  clears it; editing `heat_map` in YAML starts a clean memory.
- **The Studio** has the same choice under View, Heat map, and shows live readings inside Home Assistant. Standalone it has
  no states, so no room is heated and its status bar says "Heat map: no readings" (per floor on show).

## View memory and reset

Two items of the ⋯ menu turn the plan: **Rotate left** and
**Rotate right**, 45 degrees a press. They are their own control (`rotate_switch`):
`view_switch: false` hides the View, Theme and text items, not them. They turn the 2D plan
too; rotation does not need 2.5D. The plan turns smoothly (about 0.35 s a
step, longer for several quick presses, none with `prefers-reduced-motion`);
names and icons stay upright. Pan, zoom and taps wait until it has settled.
The ⋯ menu also has Theme and the Labels and Device names checks beside View.


The card remembers, per browser, the viewer's zoom, the spot they zoomed to,
the rotation, 2D, 2.5D or 3D, the tilt, the wall heights, the theme, whether
text shows, which layer chips are off, the Detail mode and the Heat map. Come
back, reload or switch dashboard tab and the plan is as it was left, with no
flash of the configured look. The floor and the Overview are remembered
as before.

**Zoom, spot, rotation and the 3D camera are remembered per floor.** Zoom in
on the ground floor, turn the first floor, orbit the 3D model on either:
switch floors and back and each is as you left it. A floor you never touched
shows the config's look (in 3D, the way of looking carried over from the floor
before, framed for itself). Reset view, and Reset camera in 3D, clear the
floor on show and leave the others alone. With storage blocked the floors
still remember until the page closes. Entries written by an older card (one
zoom and turn for the whole card) move to the floor they were saved on.

- **A remembered value wins over the config** for as long as the config is the
  same. Edit `view`, `rotation`, `theme`, `tilt`, `walls`, `labels`, `names`, `detail`, `kiosk`, `center`,
  `zoom_level`, the layout source or the floors in the card's YAML and that
  card starts with a clean memory: the new YAML is what you meant.
- **Reset view** (the last item of the ⋯ menu, greyed while nothing differs) puts
  every one of these back to the card's config and forgets the memory (zoom,
  turn and camera: of the floor on show only). The
  turn goes back the short way round. The floor stays. It is not the Fit
  button: Fit, or Home view on a pinned card, only changes zoom and position.
- **Keys.** The card you hover or have focused listens; another card on the
  page does not. The arrows pan (see Keys on the plan for the one case they do not), `+` and `-` zoom (neither with `zoom: false`),
  `[` and `]` turn the plan (when the rotate buttons are there), Space is
  Reset view. The
  keys work with the pointer over the card, no click needed, and after one
  click on it even when the pointer has moved off. The card tracks its own
  focus because in Home Assistant it sits inside several shadow roots, where
  the page's `document.activeElement` is never the card. Nothing fires while
  you type in a field, and Space on a focused button presses that button. Cover,
  vacuum and chooser dialogs take the keys while they are open. Under `kiosk`
  there are no buttons and no rotation keys; the zoom and pan keys still work, as the
  zoom gestures do.
- **Keys on the plan.** The plan is one Tab stop (`role="group"`, "Floor plan, Ground"). Tab in and a ring marks the device
  nearest the middle of the visible plan; a hidden status line reads "name, type, state" for screen readers. Then the
  arrows move the ring to the nearest drawn device in that direction **on screen** (a turned plan works; devices hidden by
  Layers or Detail are skipped), **Enter** or **Space** opens its popup (the Device level on a phone), **Escape** leaves
  the device, and **Shift + arrows** always pan. While no device has the ring, the arrows pan and Space resets the view as
  above. A device off the visible part pans in. The ring survives a Home Assistant update and is dropped by a floor switch,
  a click on the plan, Tab leaving it and a new config. A key reaches only the card that has the focus, and a text field
  keeps its keys.
- **When it is saved.** 150 ms after you touch zoom, focus, turn, view, tilt,
  walls, theme, names or floor, and again when the tab is hidden or closed. The
  floor is remembered with the rest, so a reload does not return you to the
  first floor.
- The memory sits in the browser's `localStorage`, under `fp-view:` and a
  short hash of the card's config. It holds numbers, one 2D/2.5D/3D word, a theme
  name and a flag, nothing else. Anything in it that does not parse is
  dropped field by field, and a browser that blocks storage just forgets.
- It is per browser, not per Home Assistant user, and not synced.

![The demo turned 45 degrees.](img/card-rotated-45.png)

## Saved views

A saved view is a named way of looking at the plan. It is made in the Studio (View, Saved views, Save current view) and kept in the layout, so every card offers it to every viewer; a card cannot write one. See "Saved views" in `editor.md`.

When the layout has any, the ⋯ menu has a **Views** section (after Device names, before Detail): one item per view, in the layout's order. A view on a floor the card does not show (`floors`, or its one pinned `floor`) is not offered, and nothing is offered under `kiosk` (no menu). Under `view_switch: false` the section stays. A view whose id is `2d`, `2.5d` or `3d` is not offered either, so a stranger's file cannot shadow the View items.

A pick is a viewer's pick, like any other: the floor, then the mode if the view names one (otherwise the viewer's own stays), then the turn (a view with none turns the plan to 0), then the zoom and the centre. The zoom is a ratio against this card's own fit, so a view looks alike on a phone and a wall tablet. In 3D the floor's framed camera stands. It is remembered per browser as any pick is, and a Home Assistant update keeps it. **Reset view** returns to the card's config, not to a saved view. A layout holds at most 24 views.

A card older than 0.31.0 drops `views` when it loads the layout and shows no Views section.

## The Edit-card form

No YAML needed: adding or editing the card in the Lovelace UI (the pencil
icon, or "Edit" on an existing card) shows a form instead of raw code —
theme, a Floor selector, fade, the plug watts, room glow, zoom, view, view switch, rotation (with a note that viewers' views are remembered), kiosk, icon size, the
open-door colour (with a Clear button, distinct from picking the theme's
own default colour by hand), the Active list toggle, night and the sun
entity, Tap and Hold (what a tap and a long press on a device do), Favourites (type or pick an entity, Add, Remove per row; a repeat, a non-entity or a 25th is refused with a line that says why; it writes `favourites` and drops `favorites`) and a Heat map select (Off, Temperature, Humidity; Off leaves the key out). The Floor selector picks "All floors (switcher)" (the default — it
writes no `floor` key at all) or one specific floor, by name, once the
card's own layout has loaded (`layout`, `layout_url`, or the plan stored in
Home Assistant); until then it offers only "All floors". Choosing a single
floor there hides the "Switcher shows" checkboxes below it (they would do
nothing) and drops any `floors` list from the config; choosing "All floors"
brings them back. The checkboxes themselves narrow the switcher to only the
ticked floors, in the layout's own order, defaulting to every floor when
none are ticked. A field left at its default is left out of the saved YAML,
so the card config stays as short as if you had typed it by hand.

## A premade dashboard

To get a whole dashboard rather than one card: in the editor, File, Install
code. It shows a dashboard — one view, this card, your plan's current theme
and floors — ready to paste as-is:

```yaml
title: Floorplan
views:
  - title: Floorplan
    path: floorplan
    cards:
      - type: custom:floorplan-studio-card
        theme: blueprint
        floors:
          - ground
          - first
```

Settings, Dashboards, Add dashboard, New dashboard from scratch, then its ⋮
menu, Edit in YAML, and paste this over what's there. To add the card to a
dashboard you already have instead, paste only the `cards:` entry into an
existing view.

### As a strategy

The same panel closes with "Or as a strategy": three lines that make Home Assistant build the dashboard each time it loads, so a floor you add in the Studio shows up without pasting again.

```yaml
title: Floorplan
strategy:
  type: custom:floorplan-studio
```

Paste them over a dashboard's raw configuration (⋮, Edit in YAML). The card's script defines the strategy (`ll-strategy-dashboard-floorplan-studio`), asks the integration for the layout (`floorplan_studio/load`) and returns one panel view per floor, in the layout's order, titled with the floor's title, each holding one card pinned to its floor (`floor: <id>`). The view's path is a slug of the floor id.

- `title` renames the dashboard (default `Floorplan`).
- `card:` is an object of card options (`theme`, `view`, ...) merged into every card, never over `type` or `floor`: `card: {theme: slate, view: 2.5d}`. Anything that is not an object is ignored.
- With no saved layout, a failed load, or a layout that does not validate, the dashboard is one view with a note that says what failed and what to do (install the integration, save from the Studio once).
- Home Assistant's custom strategy interface is not part of its documented, versioned card API, so a future release may change how it calls this. The Install code snippet above does not depend on it.

## Themes

Thirteen themes, chosen with `theme:` — never by your dashboard's own light/dark
mode, which the card ignores.

- **`blueprint`** (default) — dark blue ground, cool white linework, a
  terminal-green measurement grid, one saturated orange for anything "on".
- **`light`** — the paper-and-ink set: light ground, dark ink.
- **`midnight`** — the project's original dark theme, kept under its own name.
- **`slate`** — light neutral grey, dark ink, burnt-orange accent.
- **`terminal`** — near-black, terminal green throughout, amber accent.
- **`solarized`** — the real Solarized dark palette; unlike the others, each
  device type keeps its own Solarized hue instead of collapsing to one accent.
- **`ha`** — inherits your dashboard's own theme variables (background, text,
  secondary background for rooms) instead of a fixed palette. Falls back to
  `light` or `midnight` (by `hass.themes.darkMode`) for anything your
  dashboard's theme doesn't define.
- **`coffee`** — espresso-brown ground, cream linework, caramel-orange accent.
- **`a-team`** — near-black, cherry-red grid, gold accent.
- **`space`** — near-black navy, cyan grid, violet accent.
- **`cyberpunk`** — near-black violet, cyan text, magenta grid, acid-yellow accent.
- **`carpenter-brut`** — near-black maroon, crimson grid, hot-pink accent.
- **`beach-house`** — a light sand ground, driftwood-brown linework, sea-teal grid, palm-green accent.

## What a device looks like, on and off

Every device sits on a white disc, above rooms and their names. An idle
device is grey; an active one takes its type's own colour — one
`--fp-dev-<type>` accent per type. A handful of types behave a little
differently:

- **Light** — grey when off; on, it turns amber (or the bulb's own colour, if
  it reports one) and grows a soft aura, 3 m across, on the plan. A tap opens its popup (Turn on or off, sliders); a long
  press opens Home Assistant's more-info dialog.
- **Light with a bound switch** — one icon that lights up if either the light
  or its switch is on. A tap's button always acts on the light itself; the switch is
  never one of the S10.4 chooser's entities (below) — it stays reachable from
  inside the light's own more-info dialog instead.
- **Motion sensor** — red the moment it triggers, with a strong red disc and
  a ring pulsing out from it while it stays on. It then fades back to grey
  over `fade` seconds from when it last went off — even if it's already off
  by the time the card loads.
- **Motion perimeter** — while a motion sensor (or a radar) stands in a room
  and is on, the room gets one thin solid line just inside its walls, in the
  sensor's own colour (red by default; a radar takes the radar colour). The
  smallest room that holds the sensor gets it, so a house in a garden lights
  the house; with several sensors on in a room the first in layout order
  names the colour. It shows exactly while the sensor is on (the icon's fade
  is separate), in 2D and 2.5D (flat at floor level, under the walls), with
  names off, at night and in every theme. Zones and structures never get one.
  A group of motion sensors works the same through its own entity.
  A room that lists its own `motion` sensors draws the same line, and it pulses
  three times when the sensor trips, then holds steady while the sensor is on
  and fades once it is off. A redraw (any state change on the plan) does not
  replay the pulses. With reduced motion set on the device, it is the steady
  line only. Zones, structures and fills never get one.
- **Cover** — active (orange, on the Active list) only while open, opening or
  closing AND its HA `device_class` is `garage`, `gate` or `door`. Every other
  class (`curtain`, `blind`, `shade`, `shutter`, `awning`, `window`, `damper`),
  and a cover that reports no class, draws idle grey in every state. The class
  is read from the entity's state at draw time; nothing is stored in the layout.
  A room that shows a cover entity follows the same rule. A tap opens its popup
  (Open or Close). A door line with a `cover` draws orange when that cover is open (below).
- **Contact sensor** — open shows the same red disc and pulsing ring. A door
  or window with a contact sensor turns red and dashed when open, over a wide
  pulsing red line; `open_color` recolours both to something other than red.
  With reduced motion set on the device, nothing pulses. A cover door's own
  open state (see Cover, above) is separate: it stays its plain orange,
  undashed, whatever `open_color` says.
- **Vibration sensor** — a door with a vibration sensor attached turns the
  same colour as an open contact (`open_color` applies here too) and gets
  the same pulsing alert line, but the door itself stays solid, not dashed:
  dashed still means "open". A door that is open and vibrating at once
  stays dashed (open wins the dash) and only ever shows one alert line. A
  contact or vibration sensor attached to a door — not placed as its own
  icon — still shows on the Active panel, under the door's own name.
- **Speaker (media_player)** — a fixed blue in every theme (the same
  exception a TV is: a TV or speaker's icon turns blue whenever the player
  reports anything other than off, standby, unavailable or unknown — not
  only its plain `on`, since a Cast, Android TV or webOS device reports
  `playing`/`paused`/`idle` while genuinely powered on), the speaker one
  only while its state is exactly `playing`: paused, idle, off,
  on-but-not-playing, unavailable and unknown all stay idle grey. A plain
  `media` device is a separate type: it keeps each theme's own colour (its
  accent, or Solarized's own magenta — never speaker/TV's fixed blue)
  rather than being fixed itself. Playing, two arcs pulse out from under
  its disc in its own colour, so a speaker mid-song reads as radiating
  sound on the plan. Reduced motion holds the arcs still, the same as a
  motion sensor's ring. The popup has More info only: `media_player.toggle`
  is play/pause or power, never a clean on/off, so guessing which one you
  meant would be worse than always asking.
- **Camera** — a dark cone of view, turned to match the device's own
  rotation.
- **Person** — a green icon at full opacity while home; away (`not_home`, or
  any zone) it dims to 35% with a small grey "away" mark. Point `entity` at a
  `person.*` or `device_tracker.*` entity. Optionally point the device panel's
  Room sensor field at a second entity — a BLE room-presence sensor such as a
  Bermuda or ESPresense area sensor — whose state, or `area_id`/`area`
  attribute, names one of your rooms; the icon then glides there over 600 ms
  each time the sensor changes, and several people in the same room spread on
  a ring instead of stacking. No room sensor, or one that names no room on
  the plan, leaves the icon where you placed it. The popup has More info only,
  never a toggle.
- **Radar (mmWave presence)** — a purple icon while its presence entity is on,
  plus one small dot per tracked target, turned by the device's own `rot` (0
  is "ahead is screen-up"). Point `entity` at the presence binary sensor, and
  each `targets` pair at that target's own x/y sensors — an ESPHome LD2450
  gives one x/y pair per target it can track, named by its own YAML:

  ```yaml
  # ESPHome, an LD2450 on a UART: exposes an occupancy binary sensor and, per target
  # (1 to 3, one block each), the x/y sensors floorplan-studio's device.targets wants.
  binary_sensor:
    - platform: ld2450
      has_target:
        name: "Office radar occupancy"
        id: office_radar_occupancy

  sensor:
    - platform: ld2450
      target_1:
        x:
          name: "Office radar target 1 x"
          id: office_radar_t1_x
        y:
          name: "Office radar target 1 y"
          id: office_radar_t1_y
  ```

  In the device panel, `entity` is `binary_sensor.office_radar_occupancy`, and
  the first `targets` pair is `sensor.office_radar_target_1_x` /
  `sensor.office_radar_target_1_y` (Home Assistant's own generated entity ids
  for the `name`s above — repeat the `target_2`/`target_3` blocks and add a
  pair each for more than one tracked person).
- **Fan** — grey when off; on, it takes its own colour (`--fp-dev-fan`, in every theme) as a solid disc. A tap opens its popup (Turn on, Turn off; OFF asks first). A fan that reports a `percentage` and supports speed (`supported_features` bit 1) also has a **Speed** slider, 0 to 100 %, stepped by `percentage_step` (1 without it); moving it changes the number, release makes one `fan.set_percentage`. It is listed in Active, counted in **All off** under Fans, and hangs at the ceiling in 3D like a light (`z` overrides). A `fan.*` entity placed from a room's area menu or the entity list is typed `fan`; a device already typed `other` or `ac` on a `fan.*` entity keeps its type, change it in the device panel.
- **Cover on a door** — an open door draws orange; tapping it opens the popup,
  and its button asks before opening or closing.
- **Vacuum** — grey while docked, idle or paused; a teal icon while cleaning,
  its icon spinning slowly; teal, not spinning, while returning to dock; and
  `--fp-danger` red on an error state, neither on nor off. A tap opens a
  dialog with Start, Pause and Return to dock, each a plain `vacuum.*` service
  call on the device's own `entity` — no toggle, so a stray tap never starts
  or stops a robot by accident. Point `entity` at the vacuum's own
  `vacuum.*` entity; there is no field for its position or map, since most
  vacuum integrations expose that as a camera entity or a proprietary blob,
  not a pair of coordinates a plan could place. `unavailable` or `unknown`
  still opens the dialog, with Start, Pause and Return to dock disabled and
  Cancel enabled, so an unreachable vacuum can always be dismissed.
- **Car** — a furniture piece with the symbol `car` (Studio: Add > Furniture > Car), drawn from above as one of nine
  models: sedan, wagon, SUV, off-road, pickup truck, van, utility (a hatchback), city car and electric. It is a piece of
  furniture, not a device icon, and it points its nose along +x at turn 0 and turns with the piece in 2D, 2.5D and 3D.
  Its body takes the piece's **colour** (any `#rrggbb`; without one, the theme's furniture colour); the glass and tyres
  are near-black in every theme. In 2.5D it is a body block under a glass cabin with its own roof; in 3D a body, a sloped
  glass greenhouse, a roof, four tyres and a grille (none on the electric). Its `entity` is the **main entity**
  (a `device_tracker.*` is best); `attached` holds up to 24 more, and with no `entity` the first attached one is the main.
  The card reads their states:
  - *Away.* The first `device_tracker.*` among them says `home`, or anything but `unknown`, `unavailable` and empty
    (`not_home`, a zone's name) for away. An away car is drawn at 35 % with a small grey mark at its nose; in 3D every part
    is truly transparent, and the far wheels do not show through the body. A car with no tracker is drawn as home.
  - *Charging.* A `battery_charging` binary sensor that is on, or a sensor reading `charging` or `charge_in_progress`
    (Renault, Tesla, Volvo and the like; `stopped` is not charging). The outline turns `--fp-dev-car` (green in every theme)
    with a bolt badge toward the tail; in 3D the glass lights. A car whose tracker is unavailable but whose charging sensor
    reads charging still counts as on, and is listed under Active.
  - *Level.* A battery sensor in %, else a % sensor with `fuel` in its id, prints under the car, `78 %`.
  - *Alert.* An unlocked lock, or an open door or window sensor, outlines the car in the open-door colour (charging wins
    the colour, the text still says both). In 3D the roof turns that colour. A car never raises an Attention item.
  - *Text.* One line for the hover, the chooser's title and the Active row, read from all the car's entities: `Away · Work · Charging · 78 %`.
  A charging car is listed under Active, with a row that opens its popup; a parked one is not. The demo has one car, on the
  **Test** floor (400 x 400 cm, "demos and manual checks"), not on the ground floor. A **car device icon** (Add > Device,
  type `car`) on a `device_tracker.*` fades and wears the away mark like a person; it never toggles, and its popup has no
  switch button. A card older than 0.33.0 draws a car piece as the old box and ignores the three keys.
  *Later, not planned:* a custom car card (a vendor's own Lovelace card) in a popover on the tap; the design is a
  `car_cards` YAML key, kept out of the layout because a layout is untrusted.
- **Unavailable or unknown** — dims to 45% opacity, in any state, with no
  strikethrough: Home Assistant's own dashboards dim rather than cross out,
  and a struck-through icon this small reads as noise, not signal.

## Plugs

A plug is active only while it draws power: `plug_watts` (default `2`) or
more. A plug switched on and idling at 0.4 W draws grey, is not in the Active
list, and its tooltip says so (`plug: TV plug, 0.4 W`); at exactly 2 W it is
active, at 1.99 W it is not. The reading comes from the plug's `power` sensor
(the `sensor.*` of device class `power`) in the layout. Without one, the card
looks for the plug's sibling at runtime: the one `sensor.*` of device class
`power` that is not a diagnostic entity on the same Home Assistant device,
read from `hass.entities` (a card on an old frontend that does not provide it
simply does not link). Two candidates link nothing: a wrong guess would paint a
plug by another plug's draw, so pick one in the editor. An explicit `power`
always wins.

**Colour by draw (S14.8).** A plug that is active and has a readable power sensor is
tinted by how much it draws: blue at `plug_heat_from` (default 0 W) or less, amber
half way, red at `plug_heat_to` (default 2000 W) or more, in 2D, 2.5D and 3D, in
every theme (the ramp is three fixed tokens, `--fp-heat-cool`, `--fp-heat-mid` and
`--fp-heat-hot`, not the theme's accent). Colour is not the only signal: the plan's
tooltip and the tap popup say the watts (`plug: TV plug, 1500 W`). A plug with no
sensor, an unreadable one, or one that is off keeps its own colour (`--fp-dev-plug`,
or `colors.plug`), as before. Only plugs are tinted; a switch has no `power` field.

What the card does when it cannot be sure:

| Switch | Power sensor | Plug |
|---|---|---|
| off | anything | idle |
| unavailable or unknown | anything | unavailable |
| on | below `plug_watts` | idle |
| on | `plug_watts` or more | active |
| on | unavailable, unknown, not a number, or a unit other than W and kW | active, as before: a flaky sensor does not hide a plug |
| on | none known | active, as before: the card cannot know |

`W` and `kW` are read (kW times 1000); a sensor with no unit counts as W. A
room or a piece of furniture whose `entity` is the plug's switch follows the
same rule for its "on" ring. A light bound to a plug's switch (`bound`) does
not: it is a lamp, and on when its switch is.

## Tap, hold and hover

By default a tap never operates anything (`tap_action: toggle` changes that, below). On a device icon, a door, an unlinked appliance or a row of the Overview,
in 2D and in 3D, it opens a small popup next to the icon (on a card under 640 px it is the Device level of the bottom sheet
instead, with the same content, and the plan pans so the device stays above the sheet):

- the name and one line of state (the same text the hover tooltip and the plan's readouts use: `48 %`, `21.5 °C`,
  a light's brightness as a percent, a cover's position, a plug's watts);
- one primary button, 44 px tall (and every other control 44 px on a touch screen): **Turn on**, **Turn off**, **Open**, **Close**, **Lock** or **Unlock**, a plain
  `turn_on`, `turn_off`, `open_cover`, `close_cover`, `lock` or `unlock` call on the device's own entity;
- a **More info** link, which opens Home Assistant's dialog (or the chooser when the object names several entities).

The popup stays inside the card (on a short card its sliders scroll; the name, the state and the buttons stay in view). With
`kiosk: true` or `active_list: false` it floats at every width. Only one is open at a time, across cards too. It also closes when the floor changes or the layout is replaced. It closes on Escape, on a tap anywhere else, or on a
second tap of the same icon. Tapping another icon moves it. It is a non-modal `role="dialog"` named after the device;
focus goes to its primary button and comes back to what opened it. A **hold** (long press) still opens more-info
directly, as before.

A device that names a `view` (a path such as `/lovelace/terrace`, set in the editor) does not open the popup: a tap goes to that dashboard view, whatever `tap_action` says, and a hold keeps its own action. During a replay a tap does nothing; in kiosk the view is ignored.

- **Turning something OFF asks first**, for every type except a light (a lock and a cover act at once; a media player or speaker has no on/off button): the button turns into **Confirm turn off**
  next to Cancel. Turning ON is immediate. A light's OFF is immediate too. A lock and a cover keep their own
  wording. A door with a `cover` keeps its confirm dialog, opened from the popup's button.
- **A light** with brightness gets a slider (1-100 %); one with colour temperature gets a kelvin slider; one with a
  colour mode (hs, xy, rgb) gets a hue slider. Moving a slider changes only the number shown; releasing it makes the
  one `light.turn_on` call. A light that only switches on and off gets no slider.
- **A car piece** (furniture, symbol `car`) opens this popup on a tap, whatever `tap_action` says, in 2D, 2.5D and 3D: the
  name, the state line (`Home · Charging · 78 %`) and More info (the chooser below, or the more-info of a car with one
  entity). It has no switch button and switches nothing. A hold (500 ms) opens the chooser: the title is the
  car's name and its state line (`Family car · Away · Work · Charging · 78 %`), then one row per entity, the main one first,
  then the attached ones in order, each with its state; tap a row for that entity's more-info. The title and the rows follow
  Home Assistant while the chooser is open. A car with one entity opens its more-info on a hold too. In kiosk both do
  nothing (see Kiosk mode). The Studio's click only selects.
- **No toggle** (car, camera, media player, speaker, battery, inverter, server, access point, person, radar, vacuum):
  name, state and More info only. A vacuum tap still opens its own dialog.
- **`tap_action` and `hold_action`** (card-wide, device icons only; a door, an unlinked appliance, linked furniture and the Active list keep what they do). With no key a tap opens this popup and a hold opens more-info, as above.
  `tap_action: {action: more-info}` opens Home Assistant's dialog at once; `none` does nothing; `toggle` presses the popup's primary button for you, for a light, a switch, an input_boolean or a fan only: **ON acts at once, and so does a light's OFF; any other OFF opens the popup at Confirm turn off** (the rule above stands, so a tap never turns a plug or a fan off without asking). **A lock, a cover and a siren always open the popup**, and so do climate, humidifier, water_heater, automation, remote, media_player and group entities: a stray tap never unlocks a door, moves a garage door or sounds a siren. A device with no button (a sensor, a camera, no state) opens the popup, a vacuum and a media player open what they always open. `hold_action: {action: none}` makes a long press do nothing. The keyboard is not covered: Enter (or Space) on a focused device icon always opens the popup, whatever `tap_action` says.
  A stack still fans out first, whatever the tap action. The Edit-card form has a Tap and a Hold select; a default is left out of the YAML. There is no Studio twin, on purpose: a click in the Studio selects.

**A stack of devices.** Devices whose discs overlap on screen (centres closer than 32 px, drawn ones only) are a stack,
and a tap on any of them does not open a popup. It fans the stack out in a ring about its centre: each member moves to
its own spot, a fixed 44 px or more from the next, with a thin line back to its true place, a pin there, and its name
beside it. The ring keeps its size on screen at any zoom and is moved to stay inside the view (a card turned by Rotate
does not move it). A tap on a member in the ring does what a tap on that device does: the popup, a hold for more-info.
**Escape**, or a press anywhere on the plan that is not a member, folds the ring; while a popup is open, the first
Escape closes the popup and the second the ring. A lone device opens its popup at once. The Studio has no ring: it
picks the device on top, and a device under another is reached from its Outline tab or the search.

**Hover** (mouse only, not touch): over an icon, a door or an appliance a small tooltip shows the name and the state
text, in 2D and in 3D. It goes when the pointer leaves, when you press, drag or scroll, and while a popup is open.
The icon's own browser tooltip is replaced while it shows.

## Tapping an object with more than one entity

A heater's `trvs`, an ac's `linked` units, a radar's own `targets`, a door's
`sensors`/`vibration`/`locks`/`cover`, and an unlinked appliance's `attached`
list can each name more than one entity. Naming exactly one still opens
more-info for it directly, the same gesture as before this ever existed.
Naming two or more opens a chooser dialog instead: a small panel listing the
object's own name at the top and one button per entity, labelled by its Home
Assistant `friendly_name`, else its name in the plan's catalog, else its
entity id, with its current state (and unit) on the right. Picking
a row opens that entity's own more-info and closes the dialog; Cancel,
Escape, or a click on the backdrop outside the dialog itself all close it
without opening anything. Only one dialog — this one, the cover confirm or
the vacuum dialog — is ever open at once.

Which gesture reaches the chooser depends on what the object would otherwise
do with a plain tap:

- **A device that toggles** (a heater, an ac, a switch, a plug...): a tap
  opens the popup (S14.2). Its button acts on the device's own entity only; its
  **More info** link opens the chooser when the device names several entities.
  A **long press** opens more-info for the device's own entity alone.
- **A device with no toggle** (a camera, a radar, a person...) and a
  non-cover door: a tap opens the popup with More info only; More info
  resolves to more-info or the chooser as above.
- **A door with a `cover`**: a tap opens the popup, whose Open or Close button opens the existing confirm
  dialog, whatever else is attached to the door — this is unaffected
  by any of the above. A **long press** on it opens the chooser instead,
  listing every entity the door names, the cover included; with only the
  cover attached, a long press opens the cover's own more-info directly
  (one entity, the ordinary rule). In kiosk mode (`kiosk: true`, no long
  press anywhere) such a door only ever opens the cover dialog, since no
  long press ever starts.
- **An unlinked appliance** (a plan icon placed by type, with no linked
  entity of its own — Add → Unlinked device in the editor): has no toggle.
  A tap opens a popup (name, More info); More info resolves through its `attached` list, the
  ordinary one-entity-more-info/several-entities-chooser rule.
  A **speaker or TV** with a `media_player.*` attached stands in for that player: while it is playing the icon draws
  two waves in its active colour, and a tap or hold opens the player's more-info directly (no popup). Paused, idle,
  off: no waves. In 3D a tap works, the waves are not drawn yet.

A light's `bound` switch is deliberately never offered here; see "Light with
a bound switch" above and docs/DECISIONS.md.

The full type-by-type table — idle look, active look, exact colour token,
what a tap does — is in [`SPEC.md`, "Card behaviours"](SPEC.md#card-behaviours).

## Furniture and rooms

A piece of furniture with no entity is a plain grey silhouette — decoration.
One with an entity takes the same amber "on" accent as a device when its
entity is on, open or playing.

A custom room (no Home Assistant area, drawn free-hand) can carry its own
`entity` too: its outline lights up while that entity is on, open or playing,
its fill never moves. A room linked to an *area* instead reflects every
device placed inside it — that's what `room_glow` tints.

## Night

After sunset the plan darkens: every room, the garden, pavement and pond
included, gets a dark blue veil. A room with a light on inside it stays
clear, so at a glance you see where the lights are. It uses the same test as
`room_glow`: a light counts for the room its icon stands in. Walls, names and
icons stay on top, unveiled.

With `night: auto` (the default) the card reads `sun.sun`, which Home
Assistant has out of the box. No sun entity, or an unavailable one, means day.
Point `sun` at another entity to decide yourself, for instance a binary
sensor that is `on` when it is dark. `night: off` turns it off for good. In
the editor, View, Preview night shows the look; the editor has no live
lights, so every room is dark there.

## 3D view

`view: 3d`, or **3D** in the View radios of the ⋯ menu, draws the floor as a model: walls with
their real thickness and height, floors, doors and windows (glass is see-through),
stairs, furniture, and the radiator, speaker and TV bodies. Colours come from the
theme (the same `--fp-*` variables as 2D), and a room, wall or furniture piece
with its own colour keeps it. There are no textures. Shadows are baked contact shadows, not cast ones: the sun does not move them.

- Drag turns the model around, wheel or pinch zooms. To pan: drag with the
  middle mouse button, or hold Space and drag with the left button (the pointer
  must be over the view), or right-drag or Shift-drag, or use two fingers. A
  pan is never a tap. You cannot go under the floor. The camera starts south of the house at
  about 50 degrees; the card's `rotation` is the starting turn. **Reset camera** in the zoom cluster puts the camera back.
- Tilt does nothing in 3D and is hidden. **Walls** works: `cut` (default) lowers to 110 cm (the same figure as `low`) the walls that face the camera and keeps the far ones at full height, `low` lowers every wall, `full` none. It is the same choice and the same `walls` value as in 2.5D. Turn the house and the walls that face you change. 2D and 2.5D are unchanged.
- **Framing (S32).** The camera fits the house exactly: the eight corners of the floor's box (floor to wall top) land inside the part of the view the chrome leaves, with a margin of 12 px or 5 % of that part's short side, whichever is more. This replaces the rounder fit of 0.29, so the first 3D picture is a little larger or smaller than before, and a plan turned 45 degrees is no longer cut at a corner. The first view, Reset camera and a floor switch frame this way.
  - *Resize.* When the card's size changes (a window, a tablet turned, a phone's width, the side sheet opening or folding) an untouched camera is fitted again at once. A camera you have turned, zoomed or panned keeps its azimuth, polar angle and target; only its distance follows the size, so the house grows or shrinks with the view and nothing jumps. Under 120 px wide or high the view is ignored and the camera stays.
  - *Bottom sheet (phone).* The house is framed in what the sheet leaves. At the peek the sheet covers nothing; at half the whole house sits above it; at full there is too little room, so the camera keeps its half framing. Opening, closing or snapping the sheet glides the camera for 400 ms (ease-out). Dragging the handle moves nothing; the snap does. A resize jumps instead of gliding.
  - *Room focus.* Picking a room (a tap on its floor, or a Search result that is a room) glides the camera to the room: its floor polygon plus 50 cm all round, fitted in the part of the view the sheet leaves, at the sheet's new stop (half on a phone, the side sheet open on a tablet). The azimuth and polar angle stay as you left them; a pick always glides, even when the room is already in view. Pick another room and the camera glides from where it is.
  - *Back.* Back, Escape (from the room), the Overview, a tap on the background that clears the pick, or a floor tab ends the focus. The camera glides back to what it was before the first focus, at the angles it has now (a zoom you made before the pick is kept). Reset camera goes to the first view and drops the focus; the room stays picked.
  - *Your hands win.* A drag, wheel or pinch during a glide stops it where it is, and the camera is yours; the room stays picked, and Back still leaves it. A tap on the plan lets the glide finish first.
  - *Double tap.* A tap on a room's floor picks it and shows the ring and the sheet at once, but the camera waits 350 ms (the double-tap window). A double tap therefore never moves the camera. A Search result glides at once.
  - *Never saved.* The focus is not part of the remembered camera: while focused, what is stored is the floor camera (the pre-focus zoom and pan, the current angles). A reload never opens zoomed on a room.
  - *Reduced motion.* Under `prefers-reduced-motion: reduce` every one of these jumps in one frame.
- The 3D code is loaded the first time you pick 3D, and only then (about 186 KB
  gzipped; the card file grew by about 3.5 KB). It draws only while something
  moves: a still model, a settled pulse and a Home Assistant update that changes
  nothing cost no frame at all. A fade asks for at most one frame a second.
- **Live state in 3D (S12.5).** The same rules as 2D, from the same helpers.
  - *Lights.* A lit light device lights the room it hangs in (the 2D rule): its floor, furniture and walls take a lift toward the lamp's colour, and a soft pool sits under the lamp. The neighbouring room does not change. **At most 8 lamps get a pool**, the 8 nearest the middle of the house; every lit room is lifted whatever the count. The card says so in the view's `data-pools="shown/lit"`. Night (the sun rule) darkens the scene and leaves lit rooms bright.
  - *Doors and windows.* A plain door shows its leaf only while its sensor says closed (no sensor, unavailable or unknown: a hole); an open one (or an open cover door) swings about 70 degrees about its hinge, in red. A window's pane is there while it is closed and gone when it is open; a glass door's pane follows the door rule. Sealed doors do not change. An alarmed door (vibration) stays shut and turns red.
  - *Devices.* The small balls take their colour from the `--fp-dev-*` tokens and the state, as the 2D icons do. Person, radar, vibration and the plug-power rule are the 2D helpers. A speaker that is playing has lit drivers; a TV that is on has a lit screen; a heating radiator is tinted with `--fp-heater`. A device with a body, and a sensor that belongs to a room, shows no ball.
  - *Room motion.* A room with a `motion` list gets a red edge on its floor outline: three pulses when a sensor trips, then steady, then it fades by `last_changed` and the `fade` setting, as in 2D. With reduced motion the edge is steady. The view draws frames only while a pulse plays.
  - *Labels and icons.* An HTML layer over the model shows each room's name and its sensors' mean reading, and a real icon for every visible device. The Labels and Names buttons work in 3D. A label or icon behind a wall, or behind the camera, is hidden. The layer ignores the pointer, so a drag that starts on an icon still turns the model; a tap on an icon toggles or opens more-info as in 2D.
  - A Home Assistant update changes all of this in place: no rebuild, no camera move.
- **Depth in 3D (always on, no key).** The house stands on a ground plane. A soft shadow lies along every wall foot and under furniture, boxes, device bodies and trees, on each floor drawn (floors below too), and none of it is tappable. A tree is a faceted crown on a trunk that ends where the crown starts. Doors, glass doors, windows, slits and full-height windows stand in a frame (a doorway, a sealed panel and a plain opening do not), and a tap on the frame is a tap on the door. A closed door's leaf is quiet; it is red only when open or alarmed. Wall tops, sun faces and shade faces read apart on every theme, and a room or stair with its own paint is dimmed on a dark theme as in 2D.
- **Labels do not overlap.** When two labels in 3D would overlap, the more important one stays (a device icon, then a room name, a room readout, a device value, a device name; a room over a garden over water) and the other fades out in 120 ms (none under reduced motion). This happens when the view is still, never mid-drag, so nothing flickers while you turn the house. A faded icon cannot be tapped; turn the house or zoom and it returns.
- **Floors in 3D.** The selected floor is drawn solid and live. Floors below are drawn only
  with `floors_below` (translucent or solid, never live, each at its place in the house: turned by its `rotation` as well as
  shifted by its `offset`, so the stairs of adjacent floors line up once the Studio's Align has set them); floors above are never shown. Pick another floor and the model is built
  again, the camera keeps its angle and frames the new floor. A lamp on a
  lower floor lights nothing on the upper one.
- **No WebGL, or the graphics context is lost, or the 3D code cannot load:** the
  card shows the 2D plan and one line saying why. Nothing is left blank. A lost
  graphics context is waited for three seconds; if it does not return, the card
  shows the line and tries 3D once more when the tab is shown again or the card
  is attached again. A load that failed is tried again on the next 3D pick. The
  lines are `3D view unavailable: this browser has no WebGL. Showing 2D.`,
  `3D view unavailable: the graphics context was lost. Showing 2D.`,
  `3D view unavailable: its code did not load. Showing 2D.` and
  `3D view unavailable: it could not start. Showing 2D.` A layout the checker
  refuses shows its own line, `The plan could not be used: ...`, in every view.
- **Low-power devices.** A wall tablet with no GPU may fall back, or draw slowly.
  **2.5D is the fast view**: it is the flat plan with depth, no WebGL. Use
  `view: 2.5d` (or `2d`) there; the 3D view keeps its frames low by drawing only
  on change, but a big house still costs a GPU. The choice is remembered per
  browser like the rest of the view.
- **The car in 3D.** Built from its model, not one box (body, glass greenhouse, roof, tyres, grille). Any part taps and holds as the
  car. Charging, an alert, away and the level change in place, with no rebuild; a bolt, the away mark and the level are drawn
  in the overlay, with the plan's gone mark (a ring and a slash) while the main entity is dead.
- **Taps in 3D work as in 2D.** A tap on a device (the small ball, or its body)
  toggles it, except the types that have no on/off (camera, media, speaker and
  the like), which open more-info; a hold opens more-info. A door, a window and
  an unlinked appliance do what they do in 2D. A tap on a room's floor picks the
  room: a dashed outline on its floor, the room section in the sheet, the Overview cut to the room. Tap the room again, tap anything else (the
  background, a tall wall, a stair, furniture standing on no room) or press
  Escape to clear. Furniture picks the room it stands in. A lowered wall is
  looked over, a tall one is not. A drag (moving more than 6 px) is never a tap,
  and a double tap or the wheel neither picks nor clears. The ball is 24 cm wide
  to the eye and 48 cm to the finger. On a phone the sheet rises to half and the
  camera frames the room above it (see Framing, above).

## Known limits

- **A device found by Search, or a row that is a device, does not move the 3D camera.** The device's popup opens; only a room pick (a tap on its floor, or a Search result that is a room) glides the camera.
- **Reset camera during a pending tap hold.** If you tap a room's floor and press Reset camera within 350 ms, the camera goes to the first view and then, when the hold ends, glides to the room, which stays picked. Press Reset camera again, or pick nothing, to leave it.

## Troubleshooting

- **Nothing draws.** Check the integration is installed and a layout has been
  saved from the editor at least once (File → Save inside Home Assistant, not
  the standalone download).
- **A device stays grey.** Confirm its entity id in the editor's device panel
  — an empty or unknown entity id always reads as unavailable.
- **The theme looks wrong on `ha`.** Your dashboard's own theme may not
  define every variable the card reads; it falls back to `light`/`midnight`
  per variable, so a partial theme can look mixed. Pick a fixed theme instead
  if that bothers you.
