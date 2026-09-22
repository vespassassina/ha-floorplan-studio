/**
 * A confirmation dialog for a write to Home Assistant. Resolves true on OK and false on Cancel, Escape or a click outside. The last line
 * is always the warning: HA has no undo for these. A plain element, not `<dialog>`, so it works the same in every host.
 */
export const NO_UNDO = "Home Assistant cannot undo this.";

export interface ConfirmOpts { okLabel?: string; /** Adds a checkbox with this label; `onRemember` runs when it is ticked and the answer is OK. */ remember?: string; onRemember?: () => void }

export function confirm(host: HTMLElement | ShadowRoot, title: string, lines: string[], opts: ConfirmOpts = {}): Promise<boolean> {
  return new Promise((resolve) => {
    const root = host instanceof ShadowRoot ? host : (host.shadowRoot ?? host);
    const box = document.createElement("div");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", title);
    box.id = "fp-confirm";
    box.style.cssText = "position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5)";
    const card = document.createElement("div");
    card.style.cssText = "background:var(--fp-bg,#fff);color:var(--fp-ink,#000);border:1px solid var(--fp-idle,#888);border-radius:8px;padding:16px;max-width:420px;font:14px/1.4 system-ui,sans-serif";
    const h = document.createElement("strong");
    h.textContent = title;
    card.append(h);
    for (const l of [...lines, NO_UNDO]) { const p = document.createElement("p"); p.textContent = l; card.append(p); }
    let tick: HTMLInputElement | undefined;
    if (opts.remember) {
      const lab = document.createElement("label");
      tick = document.createElement("input"); tick.type = "checkbox"; tick.id = "fp-confirm-remember";
      lab.append(tick, ` ${opts.remember}`);
      card.append(lab);
    }
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;justify-content:flex-end";
    const mk = (id: string, text: string) => { const b = document.createElement("button"); b.id = id; b.type = "button"; b.textContent = text; b.style.cssText = "font:inherit;padding:4px 12px;cursor:pointer"; return b; };
    const cancel = mk("fp-confirm-no", "Cancel"), ok = mk("fp-confirm-yes", opts.okLabel ?? "Create");
    row.append(cancel, ok);
    card.append(row);
    box.append(card);
    const done = (v: boolean) => { box.removeEventListener("keydown", key); box.remove(); resolve(v); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); done(false); } };
    cancel.addEventListener("click", () => done(false));
    ok.addEventListener("click", () => { if (tick?.checked) opts.onRemember?.(); done(true); });
    box.addEventListener("click", (e) => { if (e.target === box) done(false); });
    box.addEventListener("keydown", key);
    root.append(box);
    cancel.focus(); // the safe answer holds focus, so Enter cannot create by accident
  });
}
