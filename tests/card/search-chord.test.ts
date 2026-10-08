import { describe, expect, it } from "vitest";
import { isSearchChord } from "../../src/card/view-keys";

// S24.2: one rule for "open the search", shared by the Studio and the card. Cmd-K or Ctrl-K anywhere; "/" only when the
// key does not start in a text field (there it is a slash). The event is dispatched for real so `composedPath()` holds
// its true target, as it does in the browser.

function fire(target: Element, init: KeyboardEventInit): boolean {
  let got = false;
  const on = (ev: Event) => { got = isSearchChord(ev as KeyboardEvent); };
  document.body.addEventListener("keydown", on);
  target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, composed: true, cancelable: true, ...init }));
  document.body.removeEventListener("keydown", on);
  return got;
}
function el(html: string): Element {
  document.body.innerHTML = html;
  return document.body.firstElementChild!;
}

describe("S24.2 isSearchChord", () => {
  it("Cmd-K and Ctrl-K, either case, from anywhere, even a text field", () => {
    const div = el(`<div tabindex="0"></div>`);
    expect(fire(div, { key: "k", metaKey: true })).toBe(true);
    expect(fire(div, { key: "k", ctrlKey: true })).toBe(true);
    expect(fire(div, { key: "K", ctrlKey: true })).toBe(true); // Caps Lock
    const input = el(`<input type="text">`);
    expect(fire(input, { key: "k", metaKey: true })).toBe(true);
  });

  it("not K alone, nor with Alt or Shift, nor another letter with Cmd", () => {
    const div = el(`<div tabindex="0"></div>`);
    expect(fire(div, { key: "k" })).toBe(false);
    expect(fire(div, { key: "k", metaKey: true, altKey: true })).toBe(false);
    expect(fire(div, { key: "K", ctrlKey: true, shiftKey: true })).toBe(false);
    expect(fire(div, { key: "j", metaKey: true })).toBe(false);
  });

  it('"/" outside a text field, also typed with Shift (Shift-7 on an Italian or German keyboard)', () => {
    expect(fire(el(`<div tabindex="0"></div>`), { key: "/" })).toBe(true);
    expect(fire(el(`<button>b</button>`), { key: "/" })).toBe(true);
    expect(fire(el(`<input type="checkbox">`), { key: "/" })).toBe(true);
    expect(fire(el(`<div tabindex="0"></div>`), { key: "/", shiftKey: true })).toBe(true);
  });

  it('"/" in a text field, a textarea, a select or an editable region is a slash', () => {
    for (const h of [`<input type="text">`, `<input type="search">`, `<input>`, `<textarea></textarea>`, `<select></select>`, `<div contenteditable="true"></div>`]) {
      expect(fire(el(h), { key: "/" }), h).toBe(false);
    }
  });

  it('"/" inside a shadow root\'s text field is a slash too', () => {
    const host = el(`<div></div>`);
    const input = host.attachShadow({ mode: "open" }).appendChild(document.createElement("input"));
    expect(fire(input, { key: "/" })).toBe(false);
  });

  it('"/" with Ctrl, Cmd or Alt is not the chord; a handled or composing key is never one', () => {
    const div = el(`<div tabindex="0"></div>`);
    expect(fire(div, { key: "/", ctrlKey: true })).toBe(false);
    expect(fire(div, { key: "/", metaKey: true })).toBe(false);
    expect(fire(div, { key: "/", altKey: true })).toBe(false);
    expect(fire(div, { key: "/", isComposing: true })).toBe(false);
    let got = true;
    const pre = (ev: Event) => ev.preventDefault();
    const on = (ev: Event) => { got = isSearchChord(ev as KeyboardEvent); };
    div.addEventListener("keydown", pre);
    document.body.addEventListener("keydown", on);
    div.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true }));
    document.body.removeEventListener("keydown", on);
    expect(got).toBe(false);
  });
});
