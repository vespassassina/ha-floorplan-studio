# Draw your plan from photos or architect drawings

Floorplan Studio can start from a picture. You give an AI assistant the drawing, it gives you back a `layout.json`, you open that in the editor and fix whatever is off. You do not draw the outside walls by hand.

Two files carry the instructions. Give both to the assistant:

| File | What it is |
|---|---|
| [`SKILL.md`](SKILL.md) | What to do, in order: the two questions to ask, how to work out scale, how to draw, how to check. |
| [`SCHEMA.md`](SCHEMA.md) | The file format, written to be read by an assistant. |

Two finished examples sit in [`examples/`](examples/): a flat, and a house with two floors and a stair. An assistant that reads them draws better.

## Step by step

1. **Get the two files into your assistant** (below).
2. **Attach your drawings**: photos, scans, a PDF, a sketch. One image per floor is best. Say which floor is which.
3. **Answer its two questions**: one real measurement, and where north is.
4. **Save what it gives you** as `layout.json`.
5. **Open the editor** (`dist/editor.html`, or the Floorplan Studio panel in Home Assistant), then **File → Open**, choose `layout.json`.
6. **Fix what is off.** Drag a corner, move a door. The assistant lists everything it guessed; check those first.
7. **Attach your devices** in the editor. The assistant does not touch them, on purpose: a drawing does not know which lamp is which.

## Getting the files into each assistant

Menu names change; the idea is the same everywhere: put the two files where the assistant will read them before you send your images.

- **Claude Code** (in this repository): nothing to copy. Say "use `prompts/SKILL.md` to trace the plan in `~/Desktop/plan.jpg`". To install it as a skill in any project, copy the `prompts/` folder to `.claude/skills/floorplan-trace/`.
- **Claude.ai**: create a Project, add `SKILL.md` and `SCHEMA.md` (and the two examples) as project files, then start a chat inside it and attach your drawings.
- **ChatGPT**: create a Project or a custom GPT, upload the same files as knowledge or project files, and say "follow SKILL.md" in the first message.
- **Gemini**: create a Gem, paste `SKILL.md` into its instructions and upload `SCHEMA.md` and the examples. Or start a chat and attach all the files at once.
- **Grok**: start a chat, attach or paste `SKILL.md` and `SCHEMA.md`, then your drawings.
- **GitHub Copilot**: in the repository, ask Copilot Chat to follow `prompts/SKILL.md`. Elsewhere, paste the two files into the chat.

If your assistant cannot open files, paste `SKILL.md`, then `SCHEMA.md`, into the chat as text.

## Check the result yourself

If you have this repository checked out, run

```
node scripts/validate-layout.mjs layout.json
```

It prints `ok`, or one line per problem: a room drawn outside the walls, a door that is not on a wall, metres written where centimetres belong. Paste the lines back to the assistant and ask it to fix them.

## Your plan stays yours

The layout is a file on your machine. It contains your floor plan and nothing else: no Home Assistant address, no token, no device names. Do not paste your plan into a public issue or commit it to a public repository.
