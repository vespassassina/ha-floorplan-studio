# ha-floorplan-studio

Draw your home inside Home Assistant, attach your devices, use it as a live
dashboard. No external drawing tool, no YAML per element.

Installable through HACS. Needs Home Assistant 2025.6 or later. Releases are
in [`CHANGELOG.md`](CHANGELOG.md). The author runs it on their own Home
Assistant every day.

![The demo house as a live card: lights come on, a door opens, the plan zooms, switches floor and darkens at dusk; then the editor, dragging a device.](docs/img/demo.gif)

| The card, live | The editor |
|---|---|
| ![The card: the demo ground floor, two lights and the hall motion sensor on.](docs/img/card-overview.png) | ![The editor with the demo house loaded.](docs/img/editor-overview.png) |

## What you get

- An editor panel in HA: draw floors, rooms, walls, doors, windows, stairs,
  furniture. Attach rooms to areas and devices to entities from pickers.
- A dumb light on a smart switch is one icon: bind the switch to the light
  ("Controlled by") and the plan shows both as one lamp.
- A Lovelace card: lights, switches, sensors, cameras, thermostats, doors,
  people, mmWave radar targets and vacuums shown live. A lit lamp throws a
  pool of light; motion pings and fades from red to grey; an open door or
  window turns red and dashed; a TV turns blue; a playing speaker sends out
  waves. The plan darkens after sunset. Icons grow with a large house, and
  `icon_size` scales them further.
- A floating **Active** list on the card: every light, sensor, camera, TV and
  speaker that is on, on any floor. Tap a row for its more-info dialog; drag
  the list aside or fold it away.
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
