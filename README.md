# ha-floorplan-studio

Draw your home inside Home Assistant, attach your devices, use it as a live
dashboard. No external drawing tool, no YAML per element.

Status: early. The core library and the standalone editor work and are
tested. The card, the HA integration and the photo prompt are not built yet.
See `docs/SPEC.md` and `docs/PLAN.md`.

| Part | State |
|---|---|
| Core: schema v2, v1 migration, geometry, SVG renderer, icons | done |
| Editor (standalone `dist/editor.html`, works from `file://`, offline) | done |
| Zones, water, wall kinds, floors, draw mode | Sprint 1.5 |
| Lovelace card | Sprint 2 |
| HA integration, panel, HACS release | Sprint 3 |
| Organise: areas, helpers, groups, automations from the plan | Sprint 4 |
| Prompt for LLMs, docs | Sprint 5 |

## What you get

- An editor panel in HA: draw floors, rooms, walls, doors, windows, stairs,
  furniture. Attach rooms to areas and devices to entities from pickers.
- A dumb light on a smart switch is one icon: bind the switch to the light
  ("Controlled by") and the plan shows both as one lamp.
- A Lovelace card: lights, switches, sensors, cameras, thermostats and doors
  shown live. Motion fades from red to grey; open doors turn orange.
- A prompt that turns photos of your architect's plans into a first draft.

## Install (planned)

[![Open your Home Assistant instance and open this repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=vespassassina&repository=ha-floorplan-studio&category=integration)

The button opens HACS on your Home Assistant with this repository ready to add. Or by hand:

1. HACS → Integrations → add this repository → install.
2. Settings → Devices & services → add **Floorplan Studio**.
3. Open **Floorplan Studio** in the sidebar and draw, or load a draft (below).
4. Add the card: `type: custom:floorplan-studio-card`.

## Start from photos

Open your assistant with the prompt already filled in, then attach your photos:

<a href="https://claude.ai/new?q=Read%20the%20instructions%20at%20https%3A%2F%2Fraw.githubusercontent.com%2Fvespassassina%2Fha-floorplan-studio%2Fmain%2Fprompts%2Ftrace-from-photos.md%20and%20follow%20them%20exactly.%20I%20will%20attach%20photos%20of%20my%20floor%20plans."><img alt="Open in Claude" src="https://img.shields.io/badge/Open%20in-Claude-D97757?style=for-the-badge"></a> <a href="https://chatgpt.com/?q=Read%20the%20instructions%20at%20https%3A%2F%2Fraw.githubusercontent.com%2Fvespassassina%2Fha-floorplan-studio%2Fmain%2Fprompts%2Ftrace-from-photos.md%20and%20follow%20them%20exactly.%20I%20will%20attach%20photos%20of%20my%20floor%20plans."><img alt="Open in ChatGPT" src="https://img.shields.io/badge/Open%20in-ChatGPT-10A37F?style=for-the-badge"></a> <a href="https://grok.com/?q=Read%20the%20instructions%20at%20https%3A%2F%2Fraw.githubusercontent.com%2Fvespassassina%2Fha-floorplan-studio%2Fmain%2Fprompts%2Ftrace-from-photos.md%20and%20follow%20them%20exactly.%20I%20will%20attach%20photos%20of%20my%20floor%20plans."><img alt="Open in Grok" src="https://img.shields.io/badge/Open%20in-Grok-000000?style=for-the-badge"></a> <a href="https://gemini.google.com/app"><img alt="Open in Gemini" src="https://img.shields.io/badge/Open%20in-Gemini-4285F4?style=for-the-badge"></a>

The buttons send a short message that tells the assistant to read the full
prompt from this repository, so the assistant needs web access. Gemini has no
way to pre-fill a message: open it, then paste that message yourself:

> Read the instructions at https://raw.githubusercontent.com/vespassassina/ha-floorplan-studio/main/prompts/trace-from-photos.md and follow them exactly. I will attach photos of my floor plans.

If your assistant cannot open links, copy `prompts/trace-from-photos.md` and paste it instead.

1. Photograph or scan each floor plan.
2. Open `prompts/trace-from-photos.md`, paste it into Claude, ChatGPT, Gemini
   or Grok, attach the photos, and answer its two questions (one known
   dimension, where north is).
3. Save the JSON it returns as `layout.json`.
4. In the editor: File → Open, fix what is off, Save.

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
assistants working on the code are in `CLAUDE.md`.

## Licence

MIT. Icons are Material Design Icons (Apache 2.0).
