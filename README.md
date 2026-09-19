# ha-floorplan-studio

Draw your home inside Home Assistant, attach your devices, use it as a live
dashboard. No external drawing tool, no YAML per element.

Status: in design. See `docs/SPEC.md` and `docs/PLAN.md`.

## What you get

- An editor panel in HA: draw floors, rooms, walls, doors, windows, furniture.
  Attach rooms to areas and devices to entities from pickers.
- A Lovelace card: lights, switches, sensors, cameras, thermostats and doors
  shown live. Motion fades from red to grey; open doors turn orange.
- A prompt that turns photos of your architect's plans into a first draft.

## Install (planned)

1. HACS → Integrations → add this repository → install.
2. Settings → Devices & services → add **Floorplan Studio**.
3. Open **Floorplan Studio** in the sidebar and draw, or load a draft (below).
4. Add the card: `type: custom:floorplan-studio-card`.

## Start from photos

1. Photograph or scan each floor plan.
2. Open `prompts/trace-from-photos.md`, paste it into Claude, ChatGPT, Gemini
   or Grok, attach the photos, and answer its two questions (one known
   dimension, where north is).
3. Save the JSON it returns as `layout.json`.
4. In the editor: File → Open, fix what is off, Save.

## Licence

MIT. Icons are Material Design Icons (Apache 2.0).
