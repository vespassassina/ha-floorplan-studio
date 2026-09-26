# Workflow: Sonnet codes, the coordinator checks, Opus reviews the build

Rewritten 2026-09-26 to match Diego's global rules and the way Sprint 8 was
actually run. It supersedes the three-role flow of 2026-09-21 (see
`docs/DECISIONS.md`).

## Roles

- **Diego** decides. He sets the goal, answers when two readings differ, and
  says yes to merge, push, tag and release. Each yes covers one release.
- **Coordinator**: the main Claude session. It turns feedback into a task,
  briefs the coder, checks the result like a PR, runs the review, reports,
  and releases after the yes. It does not write feature code itself.
- **Coder** (Sonnet): implements one task on its branch, test first. Every
  coding agent runs on Sonnet, even when the task needs design judgement.
- **Reviewer** (Opus): reviews the finished, integrated build once, then
  re-checks only the fixes. Opus is spent here and nowhere else.

## Size decides the path

- **Small change** (feedback on a screen, a bug): straight to a task, test
  first.
- **Major feature or new sprint**: design, then spec, then plan, then test,
  in that order. Interview Diego a few questions at a time, each with a
  default. Write the spec (`docs/SPEC.md` or `docs/specs/<name>.md`, with
  acceptance criteria) and the plan (`docs/PLAN.md`: epics, tasks, sprints;
  a task is one outcome and one test). Get a yes on both. One sprint at a
  time.
- **Two readings of a request**: ask. Otherwise state the assumption in the
  reply and go.

## The loop

1. **Branch.** `task/<id>` off `main`. When two coders run at once, each
   gets its own git worktree and its own `PW_PORT`, so neither switches the
   other's checkout.
2. **Brief.** The coder's prompt is complete on its own:
   - Diego's words, verbatim;
   - the files to read;
   - what "done" looks like;
   - the tests to write, and how to prove each one fails first;
   - the commands to run;
   - where screenshots go;
   - what not to touch.
3. **Code.** The coder:
   1. writes the test and watches it fail;
   2. implements;
   3. runs every suite bare;
   4. for any visible change, renders the result and looks at it (`npm run shots`, screenshots of the changed UI);
   5. commits in small steps, with the DECISIONS, PLAN and CHANGELOG lines in the same commits;
   6. reports the commits, the proof each test failed first, the exit codes, and what it skipped.
4. **Check.** The coordinator re-runs `npm run lint`, `npx vitest run` and
   `npx playwright test` itself, and opens the screenshots itself. A report
   is a claim, not evidence. What is wrong goes back to the same coder, with
   the exact defect and the test that must catch it.
5. **Integrate.** Parallel branches merge into one review branch. Doc
   conflicts are usually two new entries: keep both. The suites run again on
   the merge.
6. **Review.** One Opus pass over `git diff main...<branch>`, against the
   checklist below. Its defects go back to the coder, test first. Opus then
   re-checks the fixes only, and says release or not.
7. **Report.** Tell Diego what changed, the evidence, what was skipped, and
   what is still open. Ask before merge, push or tag.
8. **Release.** After his yes, run the steps under "Release" below without
   asking again.
9. **Learn.** A defect a review caught becomes a numbered finding in
   `CLAUDE.md`. A process lesson goes into this file. A preference Diego states goes
   into the assistant's memory. Stopping mid-task leaves `docs/HANDOFF.md`
   (done, next, blocked, how to resume); delete it when done.

## Evidence, per artefact

Write the check first, run the work for real, show the evidence. Name what
was skipped. Never report green you did not see.

| Artefact | Check | Evidence |
|---|---|---|
| Code | A test that fails with the feature removed | The failing run, then the passing run |
| Plan pixel (`render.ts`, any stylesheet) | `npm run shots`; a crop at 4x on the changed spot | The images, looked at, in every theme |
| Editor UI | States, flows, 1280 and 380 wide, dark and light | One screenshot per state, looked at |
| CSS rule that matters | A `getComputedStyle` pair in Chromium | The pair's failing run |
| Release | The version read back from Home Assistant | The installed version, and the field case retested |

Break it as a hostile user would: bad input, the wrong order, an empty case,
a second card on the page, a `hass` update in the middle. Say what held.

## Rules for checking

- Run a command bare and read `$?` on its own line. Never
  `cmd | tail; echo $?` (CLAUDE.md finding 14).
- To prove a test needs its feature, revert only the source file (in a
  throwaway worktree, or a path-scoped `git stash push -- <file>`), run the
  test, watch it fail, and restore.
- A new Playwright test runs `--repeat-each=10` before it is committed. A
  flaky test is a product bug (finding 13).
- Drive real `page.mouse` clicks at real coordinates on the real top element
  (finding 3).
- Read colours and layout from the browser, never from the CSS text
  (finding 10).
- Scratch scripts and screenshots go in the session scratchpad or
  `/private/tmp`, never in the repo.

## Review checklist (Opus)

1. Does the diff do all of the task and nothing else?
2. Would each test fail with its feature removed? Name any that would not.
3. Layout files are untrusted: `validate` never throws, and writers never
   build an invalid layout (findings 1 and 12).
4. Every interpolated string is escaped (finding 2).
5. One draw path: the card and the editor both go through `renderFloor`
   (finding 8).
6. Editor state: one undo step per gesture, none when nothing changed, and
   state survives a `hass` update.
7. No secrets, no private URL, no personal layout, no runtime network beyond
   `hass`.
8. Is there a simpler design that meets the task?
9. DECISIONS, PLAN and CHANGELOG are updated in the same commits.

Output: confirmed defects, most severe first, each with file:line, a
concrete failure scenario, a fix, and how it was confirmed. Nits come
separately. End with a release verdict.

## Release

Only after Diego's yes. Once the push and the tag are approved, finish every
step without asking again.

1. Bump `version` in `custom_components/floorplan_studio/manifest.json`.
   `package.json` stays at 0.1.0.
2. Rename the CHANGELOG `## Unreleased` heading to the version.
3. Commit, then merge into `main` with `git merge --no-ff`.
4. Check that every new commit's author email is the GitHub no-reply
   address, and that no token or private URL is in the tree.
5. `git tag -a vX.Y.Z -m X.Y.Z`, then push `main` and the tag.
6. Watch the Release workflow with `gh run watch <id> --exit-status`.
   Confirm the release carries `floorplan_studio.zip`.
7. On Diego's Home Assistant:
   1. Refresh the repository in HACS. Match it by its exact full name, never by the first "floorplan" hit.
   2. Wait until `update.floorplan_studio_update` shows the new version.
   3. Install it, restart Home Assistant, and read the installed version back.
   4. Then retest the case Diego reported.
8. If Home Assistant cannot be reached, say so and hand Diego the two steps.
   Never sign in for him.

## At the end of a sprint

Review and re-plan with Diego. Close the sprint in `docs/PLAN.md`: what
landed, the real test counts, what the reviews found, and what carries
over. Update the README state table. Every lesson goes into `CLAUDE.md` or
this file, so the next agent does not repeat it.

## Commands

| Command | Does |
|---|---|
| `npm ci` | install |
| `npm run lint` | eslint + tsc --noEmit |
| `npm test` / `npx vitest run` | vitest, unit (sets `NODE_OPTIONS=--no-experimental-webstorage`: Node 26 shadows jsdom's `localStorage`) |
| `npx playwright test` | the editor and card end to end; `PW_PORT=<port>` beside another checkout (default 5273); `globalSetup` rebuilds `dist/` and `www/` |
| `npm run shots` | builds, then renders the demo (card, all floors, three states, every theme, and the editor) to `shots/current/`; open `index.html` and look. `-- --accept` after you have looked, `-- --strict` to fail on any change |
| `npm run build` | vite: `dist/floorplan-studio-card.js`, `dist/floorplan-studio-panel.js`, `dist/editor.html` |
| `npm run dev` | vite dev server for the standalone editor, on 127.0.0.1 |
| `npm run demo-gif` | builds, then records the README GIF to `docs/img/demo.gif` (ffmpeg, under 3 MB) |
| `npm run docs:schema` | regenerates `docs/schema.md` from the schema |
| `npm run docs:check` | checks every link in `docs/*.md`, `README.md`, `CONTRIBUTING.md` |
| `pytest` | integration tests. One-time: `uv venv --python 3.13 .venv && uv pip install --python .venv/bin/python -r requirements_test.txt`, then `.venv/bin/pytest` |
