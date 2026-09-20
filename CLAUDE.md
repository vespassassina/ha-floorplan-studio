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

## Findings from the Sprint 1.6 reviews (Opus)

10. **A CSS rule asserted as a string proves nothing.** The `FLOORPLAN_CSS`
    tests match text, so they are blind to specificity. Twice a correct rule
    never reached the pixel: `.room:not([fill])` outranked `.room-fill` and
    the hatch vanished; `.dev.on path` beat `.dev-motion path` and a motion
    sensor that was on never faded. Every rule that matters now has a
    `getComputedStyle` test in `editor.spec.ts` ("Opus review CSS pair"). Add
    the pair when you add a rule.
11. **The test server must be ours.** `npm run dev` bound localhost (IPv6)
    while Chromium resolved 127.0.0.1, and `reuseExistingServer` handed the
    suite a stranger's vite on 5173. The suite was then green or red for
    reasons that had nothing to do with this code. The config binds
    127.0.0.1, never reuses, and defaults to port 5273. Do not loosen it.
12. **A writer can commit an invalid layout.** `EditorState.edit` does not
    call `validate`, on purpose. So new code that builds schema objects (the
    ring conversion, for one) needs a test over every combination of its
    inputs, not one happy path: the first version made a zone with a wall
    edge, autosaved it, and Save refused it later, where the user cannot
    connect the error to what they did.
13. **A flaky test is a product bug.** A rotation test failed three runs in
    five because `onFocusOut` queued a clear that wiped a newer selection.
    Never add a wait or a retry; find the race. Run a new Playwright test
    with `--repeat-each=10` before you commit it.
14. **Run the command bare; read `$?` on its own line.** Never
    `cmd | tail; echo $?` or `cmd | grep ...; echo $?` — that `$?` is `tail`'s
    or `grep`'s exit code, not the command's, and it is almost always 0. If
    you must page the output, read `${PIPESTATUS[0]}` instead, or write the
    log to a file and check the status separately. On 2026-09-20 two agents
    reported `npm test` green on `task/S2.4` this way while it exited 1 with
    two unhandled errors; a verifier reproduced the same mistake on itself
    before catching it.
15. **Restore spies before you restore the clock.** `vi.restoreAllMocks()`
    comes before `vi.useRealTimers()`, always. A spy left on `setInterval` or
    `clearInterval` wraps the fake clock's own function, so `uninstall()` no
    longer recognises what it installed and deletes the global instead of
    putting the real one back. Every later test in that file then runs with
    no `clearInterval` at all, and the failure surfaces far from its cause —
    here as an unhandled error inside a `disconnectedCallback` during
    teardown, which read as a bug in the card and was not one.

## Domain notes

- Schema v2 is in `docs/SPEC.md`. A `light` device may have `bound`, the
  switch or plug that powers it. The card toggles the light entity. Several
  lights may name one switch, and the switch may be an icon of its own.
- Motion fade is computed from `last_changed`; the card passes the last `on`
  time so a sensor that already went off keeps fading.
