# Contributing

This is Diego's project, public and open to pull requests. It's the maintainer
who merges and pushes to `main` — a PR gets reviewed, not landed automatically.

## Setup

```bash
git clone https://github.com/vespassassina/ha-floorplan-studio.git
cd ha-floorplan-studio
npm ci
```

## Before you write code

- Read [`docs/SPEC.md`](docs/SPEC.md) (what the project is and does) and
  [`docs/PLAN.md`](docs/PLAN.md) (what's built, what's next, by sprint).
- For anything beyond a small fix, open an issue first — it's cheaper to
  agree on the approach before the diff exists than after.
- A decision that changes the spec belongs in [`docs/DECISIONS.md`](docs/DECISIONS.md),
  newest entry first, in the same commit as the work.

## Commands

```bash
npm run lint         # eslint . && tsc --noEmit
npm test             # vitest, unit tests over src/core, src/editor, src/card
npm run build        # dist/: floorplan-studio-card.js, floorplan-studio-panel.js, editor.html
npx playwright test  # the editor, end to end; PW_PORT=<port> to run beside another checkout
npm run shots        # renders the demo through the card and editor to shots/current/, diffs against shots/baseline/
```

`npx playwright test`'s `globalSetup` rebuilds `dist/` on every run, so a
stale build is never the cause of a failing test. `npm run shots` exists
because a passing test suite has still shipped a wrong pixel three times in
this project's history (see `CLAUDE.md`, findings 16–19) — run it, and look,
on any change that touches `src/core/render.ts` or a stylesheet.

Open `dist/editor.html` directly in a browser (no server) to try the
standalone editor after a build.

## Making a change

1. Branch off `main`: `git checkout -b task/<short-topic>`.
2. Small commits, an imperative subject line, the body says *why* — not what
   the diff already shows.
3. Write the failing test first, watch it fail, then make it pass. A test
   that still passes with the fix reverted proves nothing; CLAUDE.md's
   findings list (in this repo's root) is full of examples where that went
   wrong and how it was caught — read it once before your first PR.
4. Run the full command list above before opening the PR. Don't report a
   green suite you didn't personally see run.

## What never goes in a commit

- A token, an API key, or a private Home Assistant URL.
- A real house's layout. The only layout in this repo is
  [`demo/layout.json`](demo/layout.json) — every test, screenshot and
  example draws that one, never a personal file.
- A skipped or loosened test to make CI pass.

## Opening the PR

- English in every file, metric units, ISO 8601 dates.
- Describe *why*, not a restatement of the diff.
- Note any test you skipped and why, and any command you couldn't run.
- If your change is visible in the editor or the card, say what you looked
  at (a screenshot, or `npm run shots` output) — a green suite is not
  evidence that the pixel is right.

## Style

KISS: the simplest design that meets the spec; a third repetition earns a
helper, not before. Shallow functions, names that say what they hold,
comments only where the *why* isn't obvious from the code. No hidden
behaviour, no network calls at runtime beyond `hass` itself.

## Questions

Open an issue. `docs/WORKFLOW.md` describes the AI-assisted process this
project is built with, if you're curious how the existing code came to be —
it's background, not a requirement for contributing by hand.
