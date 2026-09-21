# Testing on your own Home Assistant

Until the integration exists (Sprint 3) the card runs as a plain Lovelace resource. Nothing here needs a token in the repo.

1. Build: `npm run build`.
2. Draw your plan: open `dist/editor.html`, draw, then File, Save. Name the file `floorplan.local.json` (the `*.local.json` pattern is gitignored, so your layout never reaches the repo).
3. Copy two files into your HA config folder `www/` (create it if missing; restart HA once if you just created it):
   - `dist/floorplan-studio-card.js`
   - your `floorplan.local.json`, renamed to `floorplan.json`
4. Settings, Dashboards, three dots, Resources, Add: URL `/local/floorplan-studio-card.js`, type JavaScript module. Hard-refresh the browser.
5. Add a manual card:

```yaml
type: custom:floorplan-studio-card
layout_url: /local/floorplan.json
theme: ha          # or blueprint (default) or light
```

6. Check: lights toggle on tap, a hold opens more-info, motion fades, the theme follows your dashboard.

Your HA URL and token, if a script ever needs them, live in `.local/ha.env` (gitignored) or the Keychain, read by name, never printed.
