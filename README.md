# ha-floorplan-studio

Draw your home inside Home Assistant, attach your devices, use it as a live
dashboard. No external drawing tool, no YAML per element.

Status: usable, still young. The editor, the card, the HA integration and the
organise tools (areas, groups, automations from the plan) are built, tested
and installable through HACS (see `CHANGELOG.md` for the current release).
See `docs/SPEC.md` and `docs/PLAN.md`.

![The demo house, live as a card, then open for editing.](docs/img/demo.gif)

| Part | State |
|---|---|
| Core: schema v2, v1 migration, geometry, SVG renderer, icons | done |
| Editor (standalone `dist/editor.html`, works from `file://`, offline) | done |
| Zones, water, wall kinds, floors, draw mode | done |
| Stairs, gardens, plan rotation, colours, HA names, closed walls to rooms | done |
| Lovelace card (seven themes, one that follows Home Assistant) | done; its script is served by the integration, on the author's dashboards daily |
| HA integration, panel, pickers, HACS releases | done, running on the author's Home Assistant |
| Organise: areas, helpers, groups, automations from the plan | done (0.10.0) |
| Person, mmWave radar and vacuum device types | done (0.11.0) |
| Night fill after sunset, zoom and pan, kiosk mode, card config form | done (0.11.0) |
| Trace a scan or photo under the plan in the editor | done (0.11.0) |
| Skill and schema for LLMs, validator (`scripts/validate-layout.mjs`) | done |
| Docs (`docs/schema.md`, [`docs/card.md`](docs/card.md), [`docs/editor.md`](docs/editor.md), `CONTRIBUTING.md`) | done |

## What you get

- An editor panel in HA: draw floors, rooms, walls, doors, windows, stairs,
  furniture. Attach rooms to areas and devices to entities from pickers.
- A dumb light on a smart switch is one icon: bind the switch to the light
  ("Controlled by") and the plan shows both as one lamp.
- A Lovelace card: lights, switches, sensors, cameras, thermostats, doors,
  people, mmWave radar targets and vacuums shown live. Motion fades from red
  to grey; open doors turn orange; the plan darkens after sunset, and a light
  keeps its room clear. Pinch, drag and double-tap to zoom and pan on a
  phone, Ctrl/Cmd+wheel and drag on a desktop; a kiosk mode strips the card
  down to the plan for a wall tablet.
- Adding or editing the card shows a form, not raw YAML: theme, floors, fade,
  room glow, zoom, kiosk, night, all in the Lovelace UI.
- One click, File, Install code, and it writes you a whole pasteable
  dashboard — not just the card — matching your plan's theme and floors.
- A scanned or photographed plan can be traced: load it in the editor, scale
  it to a real measurement, draw over it, then hide or drop it. It never
  reaches the card.
- A skill that turns photos of your architect's plans into a first draft.
- File, Export also hands an AI assistant every entity you have in Home
  Assistant, so it can place and wire up your devices from that one file,
  offline, without inventing an entity id. See below.

## Install

[![Open your Home Assistant instance and open this repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=vespassassina&repository=ha-floorplan-studio&category=integration)

The button opens HACS on your Home Assistant with this repository ready to add. It needs HACS installed, and a published release. Or by hand:

1. HACS → Integrations → add this repository → install, then restart Home Assistant.
2. Add the integration: [![Set up Floorplan Studio.](https://my.home-assistant.io/badges/config_flow_start.svg)](https://my.home-assistant.io/redirect/config_flow_start/?domain=floorplan_studio) (one click, no fields). Home Assistant does not load a custom integration until it has an entry, so this step cannot be skipped.
3. Open **Floorplan Studio** in the sidebar and draw, or load a draft (below).
4. Add the card: `type: custom:floorplan-studio-card`. No resource to add; the integration does it. For a whole premade dashboard, or the exact code for your plan's theme and floors, use File, Install code in the editor — see [`docs/card.md`](docs/card.md#a-premade-dashboard).

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

To check what an assistant gave you, run `node scripts/validate-layout.mjs layout.json`. It prints `ok`, or one line per problem: metres written as centimetres, a room outside the walls, a door on no wall.

## Let an assistant place your devices too

Tracing gets the walls right; it never touches devices, on purpose — a
drawing does not know which lamp is which. Once your plan is drawn and
connected to Home Assistant, **File, Export** downloads a `layout.json` that
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

Open `dist/editor.html` in a browser to use the editor with no server.
Work is split in tasks (`docs/PLAN.md`), run with the three-role flow (Sonnet executes and verifies, Opus decides) in
`docs/WORKFLOW.md`. Decisions are in `docs/DECISIONS.md`. Notes for AI
assistants working on the code are in `CLAUDE.md`. Contributing by hand: see
[`CONTRIBUTING.md`](CONTRIBUTING.md). The layout format itself:
[`docs/schema.md`](docs/schema.md).

## Licence

MIT. Icons are Material Design Icons (Apache 2.0).
