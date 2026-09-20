# Workflow: execute with Sonnet, verify with Sonnet, decide with Opus

One task at a time, from `docs/PLAN.md`. Three roles. Each role gets the task
block from PLAN.md plus this file. Nobody skips a step.

Models: Sonnet executes and verifies (two separate sessions; the verifier never
sees the author's reasoning). Opus decides: it reviews, settles any design
choice, picks between two readings of the spec, and judges every disagreement
between author and verifier. Anything that needs judgement goes to Opus, not
to a cheaper model.

## Rules for every role

- Read `docs/SPEC.md`, `docs/PLAN.md` (the task block), `docs/DECISIONS.md`.
- Work on branch `task/<id>` (example `task/S1.2`). Commits are small,
  imperative subject, body says why. No push, no merge: Diego does that.
- Never commit a token, a URL of a private HA, or a personal layout. The only
  layout in the repo is `demo/`.
- English in files. Metric. ISO dates.
- A task closes only when its "Done when" list is all true and the tests named
  in it pass in a real run. Never report green you did not see.
- A decision that changes the spec goes into `docs/DECISIONS.md` in the same
  commit, newest first.

## Role: Execute (Sonnet)

Prompt to paste:

> Execute task `<id>` from docs/PLAN.md in this repo. Follow docs/WORKFLOW.md.
> Write the failing test first, then the code, then run the test. Stop when the
> task's "Done when" list is true. Report: files changed, commands run with
> their output, anything you could not do.

Steps:

1. Create the branch. Read the task block. Do not widen it.
2. Write the test(s) named in the block. Run them; they must fail.
3. Implement the interface exactly as written in the block (names, signatures,
   file paths). If the block is wrong or impossible, stop and say why; do not
   improvise a different interface.
4. Run the task tests, then the full suite (`npm test`, and `pytest` for Python
   tasks). Fix until green.
5. Commit. Tick the task in `docs/PLAN.md` in the same commit.
6. Report as above. No summary of how great it went; facts only.

## Role: Verify (Sonnet)

Prompt to paste:

> Verify task `<id>` on branch `task/<id>`. Follow docs/WORKFLOW.md, role Verify.
> Do not change source code. Run every command listed and paste the output.
> Go through the task's "Done when" list and mark each line true or false with
> the evidence. End with PASS or FAIL.

Steps:

1. `git status` must be clean and on `task/<id>`.
2. Run, and paste output of: `npm ci`, `npm run lint`, `npm test`,
   `npm run build`. For Python tasks also `pip install -r requirements_test.txt`
   and `pytest`. For editor tasks also `npm run test:e2e`.
3. Open the task block. For each "Done when" line, state true/false and the
   command or file that proves it.
4. Try to break it: one wrong input, one wrong order, one empty case, from the
   "Break it" line of the task. Write and run your own script for each; citing
   an existing test does not count. A script must reach the state it claims to
   test (draw mode entered, file loaded); say how you know. Report what
   happened.
5. Read anything visual with `getComputedStyle` in Chromium, never from the
   CSS text or the markup. Two Sprint 1.6 bugs (the hatch that vanished, the
   motion sensor that never faded) were CSS specificity: the rule was in the
   sheet, the string test passed, the pixel was wrong.
6. To prove a test fails without its feature, revert the source file in a
   throwaway worktree (`git worktree add /tmp/wt`), not by reverting the
   commit: in a stack of branches the commits conflict. Remove it after.
7. Check the exit code of every command: run it bare and read `$?` on its own
   line, never `cmd | tail; echo $?` (that reports `tail`'s exit code, not
   the command's — see CLAUDE.md finding 14).
8. Verdict: PASS only if every "Done when" line is true and all suites are
   green. Otherwise FAIL with the first failing line quoted.

## Role: Review (Opus)

Prompt to paste:

> Review task `<id>` on branch `task/<id>` against docs/SPEC.md and its block
> in docs/PLAN.md. Follow docs/WORKFLOW.md, role Review. Read the diff
> (`git diff main...task/<id>`). Do not fix; report.

Checklist:

1. Does the diff do the task, all of it, and nothing else?
2. Interface matches the block exactly (names, signatures, paths, JSON shapes).
3. Tests would fail if the feature were removed. Point at any test that
   passes trivially.
4. Spec conformance: schema, behaviours table, non-goals.
5. Simplicity: a simpler design that meets the block? Say it.
6. Safety: no secrets, no personal data, no network at runtime except `hass`.
7. Docs: DECISIONS.md updated if a decision was made; PLAN.md ticked.

Output: a list of findings, each with file:line, severity (block / should /
nit), and the fix in one sentence. End with APPROVE or CHANGES.

## After review

Diego merges `task/<id>` into `main` (squash or merge, his call), pushes, and
deletes the branch. CHANGES go back to Execute with the findings pasted in.

## At the end of a sprint

Review the sprint as a whole (Opus) before the merge, then close it: README
state table, a closing block at the end of the sprint in `docs/PLAN.md` (what
landed, real test counts, what the reviews found, what is carried over), a
`docs/DECISIONS.md` entry, and every lesson written into this file or
`CLAUDE.md` so the next agent does not repeat it.

## Commands (fixed in S1.1)

| Command | Does |
|---|---|
| `npm ci` | install |
| `npm run lint` | eslint + tsc --noEmit |
| `npm test` | vitest, unit |
| `npm run test:e2e` | playwright, editor |
| `npm run build` | vite: `dist/floorplan-studio-card.js`, `dist/floorplan-studio-panel.js`, `dist/editor.html` |
| `npm run dev` | vite dev server for the standalone editor |
| `pytest` | integration tests (from repo root, `custom_components/` on path) |
