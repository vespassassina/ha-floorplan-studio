# Sprint 47 — Attention acts

## Goal
Let users act on Attention items directly:
1. **Attention snooze** (card + core): mark an Attention item as intentional so the Overview, floor pills, room badges, and plan dots stop flagging it until its state changes.
2. **Attention to notify** (Studio, 0 card bytes): from an Attention row, create a Home Assistant notification automation built by `src/editor/automations.ts`.

## 1. Core snooze (`src/core/attention.ts`)
- Export `attentionSnoozeKey(it: Pick<AttentionItem, "floor" | "kind" | "entity">): string` returning `${it.floor}\0${it.kind}\0${it.entity}`.
- Extend `attention(layout, state, reg?, tempWarn?, snooze?: Readonly<Record<string, string>>)`:
  - An item whose `snooze[attentionSnoozeKey(it)] === it.state` is omitted before `items`, `unavailable`, `floors[key].count`, and `floors[key].alarm` are computed.
  - Because `renderFloor` (`attentionDevices`), `rollup`, floor pills, and the Overview all read `attention()`, all four stay in agreement.
  - As soon as the entity's state changes to any value other than the snoozed state, `snooze[key] === it.state` becomes false and the item reappears automatically if it still needs attention.

## 2. Card snooze persistence & UI (`src/card/`)
- Stored per browser in `localStorage` under `fp-snooze-v1` (JSON `Record<string, string>`, guarded against storage errors and untrusted JSON).
- `attentionOf(c)` passes `c._snooze` to `attention(...)` and invalidates its memo whenever `c._snooze` reference changes.
- In `src/card/overview/panel.ts`, each Attention row renders a quiet **Snooze** button (`.fp-ov-snooze`) beside the row; when any snoozes are active, the Attention header shows a **Clear snooze** action (`.fp-ov-snooze-clear`).

## 3. Attention to notify (`src/editor/automations.ts` + Studio)
- `attentionNotify(opts: { name: string; entity: string; toState: string; target?: string; forMinutes?: number; message?: string }): AutomationConfig` builds a single HA automation with a `state` trigger (`entity_id`, `to`, optional `for: { minutes }`) and a `notify.notify` (or custom `target`) service action.
- In the Studio:
  - `Edit > Attention…` (`#mAttention`, `#attentionPanel`) lists current Attention items from `attention(st.layout, hassState, st.ha)` with a 1-click **Notify…** button on each row.
  - Clicking **Notify…** calls `attentionNotify` + `writer.createAutomation(cfg)` and opens the created automation in HA.
