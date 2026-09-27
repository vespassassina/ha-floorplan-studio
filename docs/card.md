# The card

`custom:floorplan-studio-card` draws one floor of your plan as a live Lovelace
card: rooms, walls, stairs, furniture and every device you attached to a Home
Assistant entity, in one glance, at scale.

![The card showing the demo ground floor, two lights and the hall motion sensor on.](img/card-overview.png)

## Adding it to a dashboard

Nothing to install by hand — the integration serves the card's script to every
dashboard. Add the card by its type:

```yaml
type: custom:floorplan-studio-card
```

With no other keys it draws your plan's floors as a switcher — one chip per
floor, the first one shown — when your plan has more than one; with only one
floor there is nothing to switch, so it just draws that. Either way: the
`blueprint` theme, motion fading over 300 seconds, `room_glow` off, darker
after sunset.

The editor itself can write this for you: File → Install code opens a panel
with a whole dashboard, matching your plan as it currently stands — theme,
floors — ready to paste. See "A premade dashboard" below.

## Config keys

| Key | Default | What it does |
|---|---|---|
| `floor` | the switcher, if the layout has more than one floor; its only floor otherwise | which floor to pin to, by its id (`ground`, `first`, ...) — no switcher, just that floor; `all` shows the switcher explicitly; an id the layout doesn't have is treated the same as leaving `floor` unset |
| `floors` | unset | an array of floor ids: shows a switcher over only these floors, in this order, defaulting to the first one. Takes precedence over `floor`. An id the layout doesn't have is dropped; if none of them match, this is the same as leaving `floors` unset |
| `theme` | `blueprint` | `blueprint`, `light`, `midnight`, `slate`, `terminal`, `solarized`, or `ha` (see Themes, below) |
| `fade` | `300` | seconds a motion sensor takes to fade from red to grey after it last went off |
| `room_glow` | `false` | tint a room's fill when any light inside it is on |
| `zoom` | `true` | pinch, drag and double-tap on a phone; Ctrl/Cmd+wheel and drag on a desktop; +, − and fit buttons top right. Fit to 8×. `"wheel"` also zooms on a plain wheel (the dashboard then does not scroll over the plan). At fit a vertical swipe over the plan scrolls the dashboard; zoomed in, it pans the plan. `false` fixes the plan and gives every touch back to the page |
| `night` | `auto` | `auto` darkens the plan after sunset (see Night, below); `on` always, `off` never |
| `sun` | `sun.sun` | the entity `night: auto` reads: `below_horizon`, or `on` for a binary sensor, is night |
| `kiosk` | `false` | `true` shows only the plan, nothing else — see Kiosk mode, below |
| `open_color` | red | `#rrggbb`: colours an open door or window, or a door whose vibration sensor triggered (and either one's pulsing alert line), instead of red. An invalid value is ignored |
| `icon_size` | `1` | grows icons, names, values and radar dots by this factor, on top of the automatic scale-up on a large plan (see Size, below). A number from `0.5` to `3`; anything else clamps into that range, and a missing or non-numeric value is the default, `1` |
| `active_list` | `true` | `false` hides the floating panel of active devices — see Active list, below |
| `center` | unset | `[x, y]`, plan cm: the point a pinned card zooms in on — see A card for one room, below. A non-array, wrong length, or non-finite value is ignored, silently, and the card shows the whole floor |
| `zoom_level` | `1` | how far in a pinned card starts: `1` is the whole floor, `2` is half its width and height, and so on up to `8`. Anything other than a finite number is the default, `1`; an in-range-but-odd number (`0`, negative, past `8`) clamps instead of being refused |

```yaml
type: custom:floorplan-studio-card
floors:
  - ground
  - first
fade: 300
room_glow: true
theme: blueprint
zoom: true
kiosk: false
icon_size: 1
active_list: true
```

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
reads **Reset view** on a pinned card, since it no longer fits the whole
floor, and is disabled only when the view is already home — pan or pinch it
away and Reset view lights back up. The − button is never gated by the pin:
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

In the masonry layout, the card sizes to the plan's aspect ratio at the
column's width, as before.

On a plan over 1000 cm on its longest side, icons, names, values and radar
dots stop shrinking with it and grow instead, so they stay legible in a big
house. `icon_size` scales them further on top of that, from half size to
three times, for a plan that still reads small, or a tablet viewed from
across the room.

## Kiosk mode

`kiosk: true` is for a tablet fixed to a wall: nobody there should be able to
switch floors, zoom out past what fits, or reach Home Assistant's more-info
dialog by holding a finger on a device. It hides the floor chips and the
zoom +/−/fit buttons, and a long press does nothing — a plain tap still
toggles the device it lands on, exactly as without kiosk mode.

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

## Active list

A floating panel over the plan, open by default in the top-left, lists
every active device on every floor of the layout — not only the one the
plan is showing. "Active" is lights on (a light bound to a switch counts
when the switch is), motion and contact on, TVs and media players on or
playing, a speaker playing, heaters and climate heating, AC running, plugs,
computers and covers on or open, persons at home, and vacuums that are
cleaning (one that is only returning to its dock is not). Every camera is
listed whatever its state — a camera is a view, not an on/off thing —
except an `unavailable`/`unknown` one, or any device of any type with no
entity configured: neither has a real more-info dialog to open.

Rows are grouped by type, each with the type's own icon and colour — the
camera row's own icon is the panel's ink colour rather than the plan's
camera tint, chosen to stay legible against the panel's background in
every theme — and its name; a tap, click or Enter opens Home Assistant's
more-info for that entity. The header shows the count and a collapse
toggle, and can be dragged to reposition the panel — its position is kept
as a fraction of the card's free space and re-clamped after every render
and resize, so it can never end up off-screen, including after the card
itself is resized or the panel is collapsed then expanded again. On a card
narrower than 500px with nothing yet stored, the panel starts collapsed and
narrower (`min(200px, 45%)`), so it does not crowd a phone-width plan.
Position and collapsed state are kept per browser (`localStorage`), keyed
to the layout's source (its `layout_url`, or "inline" for a config
`layout`, or the websocket fetch) plus the card's own `floor`/`floors`, so
two cards on the same dashboard — even two showing different floors of the
same websocket layout — do not share one position, and an inline layout's
autosave does not reset it.

## The Edit-card form

No YAML needed: adding or editing the card in the Lovelace UI (the pencil
icon, or "Edit" on an existing card) shows a form instead of raw code —
theme, a Floor selector, fade, room glow, zoom, kiosk, icon size, the
open-door colour (with a Clear button, distinct from picking the theme's
own default colour by hand), the Active list toggle, night and the sun
entity. The Floor selector picks "All floors (switcher)" (the default — it
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

## Themes

Seven themes, chosen with `theme:` — never by your dashboard's own light/dark
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

## What a device looks like, on and off

Every device sits on a white disc, above rooms and their names. An idle
device is grey; an active one takes its type's own colour — one
`--fp-dev-<type>` accent per type. A handful of types behave a little
differently:

- **Light** — grey when off; on, it turns amber (or the bulb's own colour, if
  it reports one) and grows a soft aura, 3 m across, on the plan. Tap toggles it; a long
  press opens Home Assistant's more-info dialog.
- **Light with a bound switch** — one icon that lights up if either the light
  or its switch is on. Tap always toggles the light itself; the switch is
  never one of the S10.4 chooser's entities (below) — it stays reachable from
  inside the light's own more-info dialog instead.
- **Motion sensor** — red the moment it triggers, with a strong red disc and
  a ring pulsing out from it while it stays on. It then fades back to grey
  over `fade` seconds from when it last went off — even if it's already off
  by the time the card loads.
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
  motion sensor's ring. Tap always opens more-info: `media_player.toggle`
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
  the plan, leaves the icon where you placed it. Tap always opens more-info,
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
- **Cover on a door** — an open door draws orange; tapping it asks before
  opening or closing.
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
- **Unavailable or unknown** — dims to 45% opacity, in any state, with no
  strikethrough: Home Assistant's own dashboards dim rather than cross out,
  and a struck-through icon this small reads as noise, not signal.

## Tapping an object with more than one entity

A heater's `trvs`, an ac's `linked` units, a radar's own `targets`, a door's
`sensors`/`vibration`/`locks`/`cover`, and an unlinked appliance's `attached`
list can each name more than one entity. Naming exactly one still opens
more-info for it directly, the same gesture as before this ever existed.
Naming two or more opens a chooser dialog instead: a small panel listing the
object's own name at the top and one button per entity, labelled by its Home
Assistant `friendly_name` where it has one, its entity id otherwise. Picking
a row opens that entity's own more-info and closes the dialog; Cancel,
Escape, or a click on the backdrop outside the dialog itself all close it
without opening anything. Only one dialog — this one, the cover confirm or
the vacuum dialog — is ever open at once.

Which gesture reaches the chooser depends on what the object would otherwise
do with a plain tap:

- **A device that toggles** (a heater, an ac, a switch, a plug...): naming
  more than one entity moves the chooser onto the plain **tap** — a tap no
  longer toggles such a device, since guessing which of several entities it
  meant was the exact problem this feature exists to fix. A **long press**
  on it instead opens more-info for the device's own entity alone, the same
  thing a long press always did before this feature existed. Naming exactly
  one entity is untouched: tap toggles, long press opens more-info.
- **A device with no toggle** (a camera, a radar, a person...) and a
  non-cover door: unchanged from a device that toggles with one entity — a
  plain tap resolves straight to more-info or the chooser, with no long
  press involved (these never had one).
- **A door with a `cover`**: a tap always opens the existing open/close
  confirm dialog, whatever else is attached to the door — this is unaffected
  by any of the above. A **long press** on it opens the chooser instead,
  listing every entity the door names, the cover included; with only the
  cover attached, a long press opens the cover's own more-info directly
  (one entity, the ordinary rule). In kiosk mode (`kiosk: true`, no long
  press anywhere) such a door only ever opens the cover dialog, since no
  long press ever starts.
- **An unlinked appliance** (a plan icon placed by type, with no linked
  entity of its own — Add → Unlinked device in the editor): has no toggle
  and no long press. A tap alone resolves through its `attached` list, the
  ordinary one-entity-more-info/several-entities-chooser rule.

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
