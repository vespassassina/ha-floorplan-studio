# CLAUDE.md

Notes for AI assistants working in this repo. Read `docs/SPEC.md`,
`docs/PLAN.md`, `docs/WORKFLOW.md` and the top of `docs/DECISIONS.md` first.

## Rules

- Public repo. Never commit a token, a private HA URL, or the maintainer's
  house layout. The only layout here is `demo/`.
- Branch `task/<id>`, small commits, imperative subject, body says why. The
  maintainer merges and pushes; ask before push, PR or merge.
- English in files, metric units, ISO dates.
- A decision that changes the spec goes into `docs/DECISIONS.md` (newest first)
  in the same commit as the work.
- Scratch scripts go in the scratchpad or `/private/tmp`, never the repo root.

## Commands

`npm run lint`, `npm test`, `npm run build`, `npx playwright test`
(`PW_PORT=<port>` when another checkout runs tests; default 5273). `globalSetup` rebuilds
`dist/` and `custom_components/floorplan_studio/www/` on every Playwright run.

## Findings from the Sprint 1 reviews (Opus)

Each of these was a real defect. Do not repeat them.

1. **Layout files are untrusted input.** Users load JSON that an LLM or a
   stranger wrote. `validate` must never throw and must check array fields,
   enums, finite numbers and names. `migrate` must not trust shapes either
   (a floor named `__proto__`, `rooms: 5`, version `"2"`).
2. **Escape every interpolated string** in SVG or HTML built as a string,
   including `kind` and `type`, not only names. Test with a payload such as
   `"><script>`.
3. **Hit-test the real top element.** Device icons are `<g data-x>`; use
   `closest("g[data-x]")`. Playwright tests must drive `page.mouse` at real
   coordinates. A test that dispatches events on the inner element passed while
   the real click was broken.
4. **A test must fail with the feature removed.** Reviews found tests that
   passed without the fix (weak fade values, `[1,0]` stitch on a 100 cm edge,
   the select `.value` binding). Use asymmetric values, exercise the bound,
   and revert the fix once to see it fail.
5. **Write the test first and watch it fail.** Several tasks skipped this. Say
   so in the report if you did.
6. **Editor state.** One undo step per gesture; no step when a value is
   unchanged; keyboard shortcuts belong to the editor host, not `window`;
   Open, Reset and restore go through `validate` and roll back on failure.
7. **Never report green you did not see.** Agents twice reported figures from
   stale browser state. Run the suite after the last edit.
8. **One draw path.** Everything visible on the plan is drawn by
   `renderFloor` in core, so the editor and the card cannot differ. The editor
   overlay draws only handles.
9. **Vendor lock-ins to avoid:** no runtime network, no `@mdi/js` import at
   runtime (paths are inlined in `icons.ts`), colours only through `--fp-*`
   variables.

## Domain notes

- Schema v2 is in `docs/SPEC.md`. A `light` device may have `bound`, the
  switch or plug that powers it. The card toggles the light entity. Several
  lights may name one switch, and the switch may be an icon of its own.
- Motion fade is computed from `last_changed`; the card passes the last `on`
  time so a sensor that already went off keeps fading.
