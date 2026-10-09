import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { buildSearchIndex, entryDetail, searchIndex, type SearchEntry, type SearchIndex } from "../core/search";

export { isSearchChord } from "./view-keys";
export type { SearchEntry } from "../core/search";

/**
 * S24.2: `<fp-search>`, the one search box of the Studio and the card. A WAI-ARIA combobox: an input, a listbox of at
 * most `limit` ranked results (`searchIndex`), the active one named by `aria-activedescendant`. Arrows move (and wrap),
 * Enter or a click picks: `fp-pick` fires with the entry in `detail`, bubbling and composed, and the box clears for the
 * next search. Escape clears the query; on an empty query it closes: focus goes back where it was before `focus()`
 * (the deepest focused element, through shadow roots), else the input lets go of it, and `fp-close` fires. The host owns the chord: it binds `isSearchChord` on itself and calls `focus()` (finding 6).
 * Matches the idioms of the editor's `<fp-combo>`; colours only through `--fp-*` (finding 9).
 */
export class FpSearch extends LitElement {
  static properties = {
    entries: { attribute: false },
    limit: { type: Number },
    label: { type: String },
    placeholder: { type: String },
    query: { state: true },
    active: { state: true },
    focused: { state: true },
  };
  /** Everything the box can find: `layoutEntries(layout, state)` plus any command entries of the host. */
  declare entries: SearchEntry[];
  declare limit: number;
  /** Accessible name of the input and the listbox. */
  declare label: string;
  declare placeholder: string;
  private declare query: string;
  /** Index into `results`, or -1 when nothing is active. */
  private declare active: number;
  private declare focused: boolean;
  private index: SearchIndex = buildSearchIndex([]);
  private results: SearchEntry[] = [];
  /** Where focus was when the host opened the box, so closing puts it back. */
  private returnTo: HTMLElement | null = null;
  private listId = `fp-search-${Math.random().toString(36).slice(2)}`;

  static shadowRootOptions = { ...LitElement.shadowRootOptions, delegatesFocus: true };

  constructor() {
    super();
    this.entries = [];
    this.limit = 10;
    this.label = "Search";
    this.placeholder = "Search rooms and devices";
    this.query = "";
    this.active = -1;
    this.focused = false;
  }

  private get input(): HTMLInputElement | null {
    return this.renderRoot?.querySelector("input") ?? null;
  }

  /** Focus the input and select what is in it: the host's ⌘K or / handler calls this. */
  override focus(options?: FocusOptions) {
    // The element that really has focus, through every shadow root: `document.activeElement` is only the outermost
    // host (the card, or Home Assistant's app), and focusing a host does nothing (S24.R3).
    let from = document.activeElement;
    while (from?.shadowRoot?.activeElement) from = from.shadowRoot.activeElement;
    if (from instanceof HTMLElement && from !== this && !this.renderRoot?.contains(from) && from !== document.body) this.returnTo = from;
    const input = this.input;
    if (!input) { super.focus(options); return; }
    input.focus(options);
    input.select();
  }

  protected willUpdate(changed: PropertyValues) {
    if (changed.has("entries")) this.index = buildSearchIndex(Array.isArray(this.entries) ? this.entries : []);
    if (changed.has("entries") || changed.has("query") || changed.has("limit")) {
      const limit = Number.isFinite(this.limit) && this.limit > 0 ? Math.floor(this.limit) : 10;
      this.results = searchIndex(this.index, this.query, limit);
      if (this.active >= this.results.length || (this.active < 0 && this.results.length)) this.active = this.results.length ? 0 : -1;
    }
  }

  protected updated(changed: PropertyValues) {
    if (changed.has("active") && this.active >= 0) this.renderRoot.querySelector(`[data-idx="${this.active}"]`)?.scrollIntoView({ block: "nearest" });
  }

  private pick(e: SearchEntry) {
    this.query = "";
    this.active = -1;
    this.dispatchEvent(new CustomEvent("fp-pick", { detail: e, bubbles: true, composed: true }));
  }

  private close() {
    const back = this.returnTo;
    this.returnTo = null;
    if (back?.isConnected && back !== this) back.focus();
    // Nothing to go back to, or it would not take focus (a host, the page): let go, so the next / is the chord again.
    const input = this.input;
    if (input && this.shadowRoot?.activeElement === input) input.blur();
    this.dispatchEvent(new CustomEvent("fp-close", { bubbles: true, composed: true }));
  }

  private move(delta: number) {
    const n = this.results.length;
    if (n) this.active = this.active < 0 ? (delta > 0 ? 0 : n - 1) : (this.active + delta + n) % n;
  }

  private onInput = (ev: Event) => {
    this.query = (ev.target as HTMLInputElement).value;
    this.active = -1; // willUpdate puts it on the first result
  };

  private onKeydown = (ev: KeyboardEvent) => {
    if (ev.isComposing) return;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") { ev.preventDefault(); this.move(ev.key === "ArrowDown" ? 1 : -1); }
    else if (ev.key === "Enter") {
      const e = this.results[this.active];
      if (e) { ev.preventDefault(); this.pick(e); }
    } else if (ev.key === "Escape") {
      // The host's own Escape (deselect, cancel a tool) must not also run.
      ev.preventDefault();
      ev.stopPropagation();
      if (this.query) { this.query = ""; this.active = -1; } else this.close();
    }
  };

  render() {
    const open = this.focused && this.query.trim() !== "" && this.results.length > 0;
    const activeId = open && this.active >= 0 ? `${this.listId}-${this.active}` : undefined;
    return html`
      <input
        type="text"
        role="combobox"
        autocomplete="off"
        spellcheck="false"
        aria-expanded=${open ? "true" : "false"}
        aria-controls=${open ? this.listId : nothing}
        aria-autocomplete="list"
        aria-activedescendant=${activeId ?? nothing}
        aria-label=${this.label}
        placeholder=${this.placeholder}
        .value=${this.query}
        @input=${this.onInput}
        @keydown=${this.onKeydown}
        @focus=${() => { this.focused = true; }}
        @blur=${() => { this.focused = false; }}
      >
      ${open ? html`
        <ul id=${this.listId} role="listbox" aria-label=${this.label} class="list">
          ${this.results.map((e, i) => html`<li
            role="option"
            id=${`${this.listId}-${i}`}
            data-idx=${i}
            aria-selected=${i === this.active ? "true" : "false"}
            class="opt${i === this.active ? " active" : ""}"
            @pointerdown=${(ev: Event) => ev.preventDefault()}
            @click=${() => this.pick(e)}
          ><span class="name">${e.name}</span><span class="detail">${entryDetail(e)}</span></li>`)}
        </ul>` : nothing}
      ${this.focused && this.query.trim() !== "" && !this.results.length ? html`<div class="list empty" role="status">No match</div>` : nothing}
    `;
  }

  static styles = css`
    :host{display:block;position:relative;box-sizing:border-box;width:100%}
    input{font:inherit;color:var(--fp-ink);background:var(--fp-room);border:1px solid var(--fp-idle);border-radius:6px;padding:6px 10px;width:100%;box-sizing:border-box}
    input::placeholder{color:var(--fp-idle)}
    .list{position:absolute;z-index:50;left:0;right:0;top:calc(100% + 2px);margin:0;padding:2px;list-style:none;box-sizing:border-box;
      max-height:min(360px, 60vh);overflow:auto;background:var(--fp-bg);color:var(--fp-ink);border:1px solid var(--fp-idle);border-radius:6px;
      box-shadow:0 4px 16px color-mix(in srgb, var(--fp-ink) 25%, transparent)}
    .opt{display:flex;flex-direction:column;padding:4px 8px;cursor:pointer;border-radius:4px;color:var(--fp-ink);background:transparent}
    .opt:hover{background:color-mix(in srgb, var(--fp-ink) 14%, transparent)}
    .opt.active{background:var(--fp-ink);color:var(--fp-bg)}
    .name,.detail{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .detail{font-size:.8em;opacity:.75}
    .empty{padding:6px 10px;font-size:.9em} /* no opacity: the box must hide what is under it */
  `;
}

if (!customElements.get("fp-search")) customElements.define("fp-search", FpSearch);

declare global {
  interface HTMLElementTagNameMap { "fp-search": FpSearch }
}
