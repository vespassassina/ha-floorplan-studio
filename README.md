# ha-floorplan-studio

Draw your home inside Home Assistant, attach your devices, use it as a live
dashboard. No external drawing tool, no YAML per element.

Installable through HACS. Needs Home Assistant 2025.6 or later. Releases are
in [`CHANGELOG.md`](CHANGELOG.md). I run it on my own Home
Assistant every day.

![The demo house as a live card: lights come on, a door opens, the plan zooms, switches floor and darkens at dusk; then the editor, dragging a device.](docs/img/demo.gif)

| The card, live | On a phone (375 px) | The editor |
|---|---|---|
| ![The card: the demo ground floor, two lights and the hall motion sensor on.](docs/img/card-overview.png) | ![The same card at phone width: the Active list starts folded.](docs/img/card-phone.png) | ![The editor with the demo house loaded.](docs/img/editor-overview.png) |

A real house, on the card in 2.5D, three themes (room and device names blurred):

| Home Assistant theme | Cyberpunk theme | Space theme, first floor |
|---|---|---|
| ![The card in 2.5D on a real ground floor, Home Assistant theme.](docs/img/card-house-ground-ha.png) | ![The same floor in the Cyberpunk theme.](docs/img/card-house-ground-cyberpunk.png) | ![The first floor in the Space theme.](docs/img/card-house-first-space.png) |

## What you get

- An editor panel in HA: draw floors, rooms, walls, doors, windows, stairs,
  furniture. Attach rooms to areas and devices to entities from pickers.
- A dumb light on a smart switch is one icon: bind the switch to the light
  ("Controlled by") and the plan shows both as one lamp.
- A 2.5D view, in the card (`view: 2.5d`, or the View dropdown beside the zoom
  buttons) and as a read-only preview in the editor: walls rise, furniture
  becomes boxes, the near walls are cut down so every room shows. A Tilt
  slider turns it from top-down to side-on.
- A switch to hide every name and value (`labels: false` on the card, View,
  Show names and text in the editor), so only items and sensors are left.
- Turn the plan in 45 degree steps with two buttons on the card (smooth, text
  stays upright; `rotation` sets the start). The card remembers each viewer's
  zoom, position, rotation, 2D or 2.5D and theme in their browser, and a Reset
  view button returns to the card's config.

  ![The card turned 45 degrees, toolbar showing the rotate and reset buttons.](docs/img/card-rotated-45.png)

  ![The card in 2.5D.](docs/img/card-2-5d.png)
- A Lovelace card: lights, switches, sensors, cameras, thermostats, doors,
  people, mmWave radar targets and vacuums shown live. A lit lamp throws a
  pool of light; motion pings and fades from red to grey, and its room gets a
  thin red line inside the walls while it is on; an open door or
  window turns red and dashed; a TV turns blue; a playing speaker sends out
  waves. The plan darkens after sunset. Icons grow with a large house, and
  `icon_size` scales them further.
- A floating **Active** list on the card: every light, sensor, camera, TV and
  speaker that is on, on any floor. Tap a row for its more-info dialog; drag
  the list aside or fold it away. On a card narrower than 480 px it starts
  folded, so it does not cover the plan.
- Pinch, drag and double-tap to zoom and pan on a phone, Ctrl/Cmd+wheel and
  drag on a desktop. A kiosk mode strips the card down to the plan for a
  wall tablet.
- Adding or editing the card shows a form, not raw YAML: theme, floors, fade,
  room glow, zoom, kiosk, night, icon size, open-door colour, the Active
  list, all in the Lovelace UI.
- A card can pin a `center` and `zoom_level` to one room, corridor or part of
  a home, so a dashboard can show several cards, each zoomed to a different
  place. The editor's View menu has a "Copy card view" button that writes
  the two lines for whatever it's currently showing.
- **File → Install code** in the editor writes a whole dashboard, not just
  the card, ready to paste and matched to your plan's theme and floors.
- A scanned or photographed plan can be traced: load it in the editor, scale
  it to a real measurement, draw over it, then hide or drop it. It never
  reaches the card.
- A skill that turns photos of your architect's plans into a first draft.
- **File → Export** also hands an AI assistant every entity you have in Home
  Assistant, so it can place and wire up your devices from that one file,
  offline, without inventing an entity id. See below.

## Colours, themes and customization

Thirteen built-in themes, picked from the card's Edit-card form or written as
`theme:` in YAML. `ha` follows your Home Assistant dashboard's own theme;
the rest are fixed palettes.

| `blueprint` (default) | `midnight` | `light` |
|---|---|---|
| ![Blueprint theme: dark blue plan, terminal-green grid, orange accents.](docs/img/themes/blueprint.png) | ![Midnight theme: blueprint's original dark palette.](docs/img/themes/midnight.png) | ![Light theme: paper-and-ink plan.](docs/img/themes/light.png) |

| `slate` | `terminal` | `solarized` |
|---|---|---|
| ![Slate theme: light neutral grey plan, burnt-orange accents.](docs/img/themes/slate.png) | ![Terminal theme: near-black plan, terminal-green text, amber accents.](docs/img/themes/terminal.png) | ![Solarized theme: the real Solarized dark palette, each device kept in its own hue.](docs/img/themes/solarized.png) |

| `ha` | `coffee` | `a-team` |
|---|---|---|
| ![Home Assistant theme: colours taken from your own dashboard theme.](docs/img/themes/ha.png) | ![Coffee theme: espresso-brown plan, cream text, caramel-orange accents.](docs/img/themes/coffee.png) | ![A-Team theme: near-black plan, cherry-red grid, gold accents.](docs/img/themes/a-team.png) |

| `space` | `cyberpunk` | `carpenter-brut` |
|---|---|---|
| ![Space theme: near-black navy plan, cyan grid, violet accents.](docs/img/themes/space.png) | ![Cyberpunk theme: near-black violet plan, cyan text, magenta grid, acid-yellow accents.](docs/img/themes/cyberpunk.png) | ![Carpenter Brut theme: near-black maroon plan, crimson grid, hot-pink accents.](docs/img/themes/carpenter-brut.png) |

| `beach-house` |
|---|
| ![Beach House theme: sand-coloured plan, sea-teal grid, palm-green accents.](docs/img/themes/beach-house.png) |

Every room keeps its own paint (colour or texture) in every theme — only the
grid, walls and device icons change. `blueprint`, `slate`, `terminal`,
`coffee`, `a-team`, `space`, `cyberpunk` and `carpenter-brut` are all built
from the same four-role system (base, foreground, line, accent) in
[`src/core/theme-roles.ts`](src/core/theme-roles.ts) — pick four colours and
get a whole theme, no ~50 hexes to hand-tune. See
[`docs/SPEC.md`](docs/SPEC.md#role-generated-themes-s421-2026-09-22).

## Install

[![Open your Home Assistant instance and open this repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=vespassassina&repository=ha-floorplan-studio&category=integration)

The button opens HACS on your Home Assistant with this repository ready to add. You need [HACS](https://hacs.xyz) installed first. Or by hand:

1. In HACS, search for **Floorplan Studio**. If it is not listed, open ⋮ → **Custom repositories**, add `https://github.com/vespassassina/ha-floorplan-studio` with type **Integration**, then search again. Download it and restart Home Assistant.
2. Add the integration: [![Set up Floorplan Studio.](https://my.home-assistant.io/badges/config_flow_start.svg)](https://my.home-assistant.io/redirect/config_flow_start/?domain=floorplan_studio) (one click, no fields). Home Assistant does not load a custom integration until it has an entry, so this step cannot be skipped.
3. Open **Floorplan Studio** in the sidebar and draw, or load a draft (below).
4. Add the card: `type: custom:floorplan-studio-card`. No resource to add; the integration does it. For a whole premade dashboard, or the exact code for your plan's theme and floors, use **File → Install code** in the editor — see [`docs/card.md`](docs/card.md#a-premade-dashboard).

The sidebar link is on by default. To hide it: Settings → Devices & services → Floorplan Studio → Configure → turn off **Show in the sidebar**. The card and your saved plan keep working; turn it back on any time.

Updates arrive through HACS like any other.

A card config, by hand (the Edit-card form in the Lovelace UI does this for
you, no YAML needed — see [`docs/card.md`](docs/card.md#the-edit-card-form)):

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
```

## Start from photos or architect drawings

Give an AI assistant your drawings, it gives you back a `layout.json`, you open it in the editor and fix what is off. No drawing the outside walls by hand.

It works from a **skill** and a **schema**, two files any assistant can follow (Claude, ChatGPT, Gemini, Grok, Copilot):

- [`prompts/SKILL.md`](prompts/SKILL.md): what to do, in order. It asks you for one real measurement and where north is, then draws, then checks its own work.
- [`prompts/SCHEMA.md`](prompts/SCHEMA.md): the file format, written for an assistant to read.
- [`prompts/examples/`](prompts/examples/): a flat and a two-floor house, both valid.

**How to load them into your assistant, step by step: [`prompts/README.md`](prompts/README.md).**

To check what an assistant gave you, run `node scripts/validate-layout.mjs layout.json` from a clone of this repository (Node 20 or later). It prints `ok`, or one line per problem: metres written as centimetres, a room outside the walls, a door on no wall.

## Let an assistant place your devices too

Tracing gets the walls right; it never touches devices, on purpose — a
drawing does not know which lamp is which. Once your plan is drawn and
connected to Home Assistant, **File → Export** downloads a `layout.json` that
also carries `available`: every entity Home Assistant knows about, its name,
its area, and the room on your plan that area already has, if any. Hand that
file and `prompts/SCHEMA.md` to an assistant and it can add and position
devices for you — using only the entity ids actually listed, never a guessed
one — with no Home Assistant connection of its own. Open the result back in
the editor, check it, Save.

The field only appears in a file you exported yourself, with Home Assistant
connected. It is never part of Save or the plan Home Assistant stores; it is
dropped again the next time the file is opened or re-exported.

## Develop

```bash
npm ci
npm run lint        # eslint and tsc
npm test            # unit tests
npm run build       # dist/ and custom_components/floorplan_studio/www/
npx playwright test # editor tests; PW_PORT=5400 to run beside another checkout
```

After a build, open `dist/editor.html` in a browser to use the editor with no
Home Assistant and no server.
Work is split in tasks (`docs/PLAN.md`), run with the flow in
`docs/WORKFLOW.md`. Decisions are in `docs/DECISIONS.md`. Notes for AI
assistants working on the code are in `CLAUDE.md`. Contributing by hand: see
[`CONTRIBUTING.md`](CONTRIBUTING.md). The layout format itself:
[`docs/schema.md`](docs/schema.md).

## Licence

MIT. Icons are Material Design Icons (Apache 2.0).
