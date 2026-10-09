import { LitElement, html, css, nothing } from "lit";

/**
 * S10.1: one entity in the combo's list. `group` is the visible sub-heading (a room, a device, a tier label such
 * as "Elsewhere") — options with the same `group` string, in the order they first appear, form one `role="group"`
 * block; an option with no `group` sits ungrouped, above any grouped ones. `group` is also searched, so typing a
 * room, area or device name narrows to it even when no option's own label or id matches.
 */
export interface ComboOption {
  value: string;
  label: string;
  group?: string;
  /** false for an option that starts a side flow rather than setting the field (S8.7's "Motion" entries in
   *  "Controlled by"): the `change` event still fires, with `detail` carrying this option's value, but the combo's
   *  own displayed value is left alone, so it keeps showing whatever the caller's `value` property already said. */
  commit?: boolean;
  /** S24.6 (U16): small text after the label, such as the entity id behind a friendly name. Shown only; the filter already matches the value. */
  sub?: string;
}

/** How many matches are drawn before the list stops and shows "N more, keep typing" instead of rendering them. */
export const COMBO_CAP = 200;

/**
 * The pure filter: every space-separated word in `query` must appear (case-insensitively) somewhere in an option's
 * own label, its value (an entity id), or its group label. No dependency on the DOM, so it is unit-tested directly.
 */
export function filterCombo(options: readonly ComboOption[], query: string): ComboOption[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...options];
  return options.filter((o) => {
    const hay = `${o.label} ${o.value} ${o.group ?? ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** One row the list actually renders: either a group heading or a matched option, in display order. */
type Row = { kind: "heading"; group: string } | { kind: "option"; option: ComboOption };

function toRows(options: readonly ComboOption[]): Row[] {
  const rows: Row[] = [];
  const seen = new Set<string>();
  for (const o of options) {
    if (o.group !== undefined && !seen.has(o.group)) { seen.add(o.group); rows.push({ kind: "heading", group: o.group }); }
    rows.push({ kind: "option", option: o });
  }
  return rows;
}

/**
 * S10.1: `<fp-combo>` — a filterable combobox replacing the native `<select>` on every entity picker in the editor
 * (see `panels.ts`). WAI-ARIA combobox pattern (see docs/DECISIONS.md for why not `<datalist>` or `ha-entity-picker`).
 *
 * Usage mirrors a controlled `<select>`: the caller passes `options` (flat, `group` optional) and `value` (the
 * current entity id, `""` for none); a pick fires one `change` event, `detail` and `.value` both set to the new
 * value, but only when it differs from the current one (CLAUDE.md finding 6: no undo step for an unchanged value).
 * The host itself carries the field's `id` (so an existing `<label for="ve">` keeps labelling it — `delegatesFocus`
 * moves focus into the internal input when the label is clicked or the id is focused programmatically) and an
 * `aria-label` mirrors the same text onto the input directly, since `aria-labelledby` does not cross the shadow
 * boundary reliably. The internal input keeps no id of its own; existing test helpers reach it as `#id input`
 * (Playwright's CSS engine pierces shadow roots).
 */
export class FpCombo extends LitElement {
  static properties = {
    options: { attribute: false },
    value: { attribute: false },
    label: { attribute: false },
    disabled: { type: Boolean },
    open: { state: true },
    query: { state: true },
    active: { state: true },
  };
  declare options: ComboOption[];
  declare value: string;
  /** Accessible name, mirrored as `aria-label` on the internal input (see class doc). */
  declare label: string;
  declare disabled: boolean;
  private declare open: boolean;
  private declare query: string;
  /** Index into the filtered *option* list (headings are not selectable), or -1 when nothing is active. */
  private declare active: number;
  private listId = `fp-combo-list-${Math.random().toString(36).slice(2)}`;

  static shadowRootOptions = { ...LitElement.shadowRootOptions, delegatesFocus: true };

  constructor() {
    super();
    this.options = [];
    this.value = "";
    this.label = "";
    this.disabled = false;
    this.open = false;
    this.query = "";
    this.active = -1;
  }

  /** The option matching the current value, if any. */
  private get current(): ComboOption | undefined {
    return this.options.find((o) => o.value === this.value);
  }

  private get filtered(): ComboOption[] {
    const matches = filterCombo(this.options, this.query);
    return matches.slice(0, COMBO_CAP);
  }
  private get overflow(): number {
    return Math.max(0, filterCombo(this.options, this.query).length - COMBO_CAP);
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("pointerdown", this.onDocPointerDown, true);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("pointerdown", this.onDocPointerDown, true);
  }

  private onDocPointerDown = (ev: PointerEvent) => {
    if (!this.open) return;
    const path = ev.composedPath();
    if (path.includes(this)) return;
    this.closeAndRestore();
  };

  private openList() {
    if (this.disabled || this.open) return;
    this.open = true;
    this.query = "";
    this.active = this.filtered.findIndex((o) => o.value === this.value);
  }
  private closeAndRestore() {
    this.open = false;
    this.query = "";
    this.active = -1;
  }

  private pick(option: ComboOption) {
    const commit = option.commit !== false;
    const changed = option.value !== this.value;
    if (commit) this.value = option.value;
    this.closeAndRestore();
    // Focus stays on the input, same as a native <select> keeps focus after a pick: no blur, so the editor host's
    // own `onFocusOut` (clears the selection when focus truly leaves) never fires from an ordinary pick.
    if (changed) this.dispatchEvent(new CustomEvent("change", { detail: option.value, bubbles: true, composed: true }));
  }

  private onFocus = () => this.openList();
  private onInput = (ev: Event) => {
    this.query = (ev.target as HTMLInputElement).value;
    if (!this.open) this.open = true;
    this.active = this.filtered.length ? 0 : -1;
  };
  private onClick = () => { if (!this.open) this.openList(); };

  private moveActive(delta: number) {
    const n = this.filtered.length;
    if (!n) return;
    this.active = this.active < 0 ? (delta > 0 ? 0 : n - 1) : (this.active + delta + n) % n;
    this.renderRoot.querySelector(`[data-idx="${this.active}"]`)?.scrollIntoView({ block: "nearest" });
  }

  private onKeydown = (ev: KeyboardEvent) => {
    if (ev.key === "ArrowDown") { ev.preventDefault(); if (!this.open) this.openList(); else this.moveActive(1); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); if (!this.open) this.openList(); else this.moveActive(-1); }
    else if (ev.key === "Enter") {
      if (this.open && this.active >= 0) { ev.preventDefault(); const o = this.filtered[this.active]; if (o) this.pick(o); }
    } else if (ev.key === "Escape") {
      if (this.open) { ev.preventDefault(); ev.stopPropagation(); this.closeAndRestore(); this.requestUpdate(); }
    } else if (ev.key === "Home" && this.open) { ev.preventDefault(); this.active = 0; }
    else if (ev.key === "End" && this.open) { ev.preventDefault(); this.active = this.filtered.length - 1; }
    // Tab: close without picking, let focus move on normally (no preventDefault).
    else if (ev.key === "Tab" && this.open) { this.closeAndRestore(); }
  };

  render() {
    const shown = this.query ? "" : (this.current?.label ?? this.value);
    const displayValue = this.open ? this.query : shown;
    const rows = toRows(this.filtered);
    const activeOpt = this.active >= 0 ? this.filtered[this.active] : undefined;
    const activeId = activeOpt ? `${this.listId}-opt-${this.options.indexOf(activeOpt)}-${this.active}` : undefined;
    return html`
      <input
        type="text"
        role="combobox"
        aria-expanded=${this.open ? "true" : "false"}
        aria-controls=${this.listId}
        aria-autocomplete="list"
        aria-activedescendant=${activeId ?? nothing}
        aria-label=${this.label || nothing}
        ?disabled=${this.disabled}
        .value=${displayValue}
        placeholder=${this.current?.label ?? ""}
        @focus=${this.onFocus}
        @click=${this.onClick}
        @input=${this.onInput}
        @keydown=${this.onKeydown}
      >
      ${this.open ? html`
        <ul id=${this.listId} role="listbox" class="list">
          ${rows.length ? nothing : html`<li class="empty">No match</li>`}
          ${rows.map((row) => {
            if (row.kind === "heading") return html`<li class="grouphead" role="group" aria-label=${row.group}>${row.group}</li>`;
            const idx = this.filtered.indexOf(row.option);
            const selected = row.option.value === this.value;
            const isActive = idx === this.active;
            return html`<li
              role="option"
              data-idx=${idx}
              data-value=${row.option.value}
              aria-selected=${selected ? "true" : "false"}
              class="opt${isActive ? " active" : ""}"
              @pointerdown=${(ev: Event) => ev.preventDefault()}
              @click=${() => this.pick(row.option)}
            >${row.option.label}${row.option.sub ? html` <small class="sub">${row.option.sub}</small>` : nothing}</li>`;
          })}
          ${this.overflow > 0 ? html`<li class="more">${this.overflow} more, keep typing</li>` : nothing}
        </ul>` : nothing}
    `;
  }

  static styles = css`
    :host{display:block;position:relative;box-sizing:border-box;width:100%}
    input{font:inherit;color:var(--fp-ink);background:var(--fp-room);border:1px solid var(--fp-idle);border-radius:4px;padding:4px 8px;width:100%;box-sizing:border-box}
    input:disabled{opacity:.6}
    .list{position:absolute;z-index:50;left:0;right:0;top:calc(100% + 2px);margin:0;padding:2px;list-style:none;
      max-height:min(320px, 60vh);overflow:auto;background:var(--fp-bg);border:1px solid var(--fp-idle);border-radius:4px;box-shadow:0 4px 16px rgba(0,0,0,.35)}
    .grouphead{padding:4px 8px 2px;font-size:.8em;font-weight:600;opacity:.7;text-transform:uppercase;letter-spacing:.02em}
    .opt{padding:4px 8px;cursor:pointer;border-radius:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .opt.active,.opt:hover{background:var(--fp-ink);color:var(--fp-bg)}
    .opt .sub{font-size:.8em;opacity:.7}
    .opt[aria-selected="true"]:not(.active)::after{content:" ✓";opacity:.7}
    .empty,.more{padding:4px 8px;font-size:.85em;opacity:.7}
  `;
}

if (!customElements.get("fp-combo")) customElements.define("fp-combo", FpCombo);

declare global {
  interface HTMLElementTagNameMap { "fp-combo": FpCombo }
}
