import { describe, expect, it } from "vitest";
import { isSaveChord, takesSpace, takesTyping, viewKeyFor, viewKeyOf } from "../../src/card/view-keys";

type Answer = ReturnType<typeof viewKeyFor>;

/** Dispatches a real KeyboardEvent from `target` and returns what `viewKeyFor` says about it. The answer is taken
 * while the event is in flight: `composedPath()` is empty once dispatch is over. `before` runs first, on the
 * document in the capture phase, like an earlier handler that took the key. */
function press(target: Element, init: KeyboardEventInit, before?: (e: Event) => void): { answer: Answer; seenTarget: EventTarget | null } {
  let answer: Answer = null, seenTarget: EventTarget | null = null;
  const catcher = (e: Event) => { answer = viewKeyFor(e as KeyboardEvent); seenTarget = e.target; };
  if (before) document.addEventListener("keydown", before, true);
  document.addEventListener("keydown", catcher);
  target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, composed: true, cancelable: true, ...init }));
  document.removeEventListener("keydown", catcher);
  if (before) document.removeEventListener("keydown", before, true);
  return { answer, seenTarget };
}
const el = (html: string) => {
  const d = document.createElement("div");
  d.innerHTML = html;
  const e = d.firstElementChild!;
  document.body.appendChild(e);
  return e;
};

describe("viewKeyOf", () => {
  it("maps the four arrows and Space", () => {
    const k = (key: string) => viewKeyOf({ key, ctrlKey: false, metaKey: false });
    expect([k("ArrowUp"), k("ArrowDown"), k("ArrowLeft"), k("ArrowRight"), k(" ")]).toEqual(["zoomIn", "zoomOut", "rotateLeft", "rotateRight", "reset"]);
    expect(k("a")).toBeNull();
    expect(k("Enter")).toBeNull();
  });
  it("leaves Ctrl and Cmd chords to the browser", () => {
    expect(viewKeyOf({ key: "ArrowLeft", ctrlKey: true, metaKey: false })).toBeNull();
    expect(viewKeyOf({ key: "ArrowLeft", ctrlKey: false, metaKey: true })).toBeNull();
    expect(viewKeyOf({ key: " ", ctrlKey: true, metaKey: false })).toBeNull();
  });
});

describe("isSaveChord", () => {
  const s = (init: Partial<KeyboardEvent>) => isSaveChord({ key: "s", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init });
  it("is Cmd-S or Ctrl-S, either case, and nothing else", () => {
    expect(s({ metaKey: true })).toBe(true);
    expect(s({ ctrlKey: true })).toBe(true);
    expect(s({ ctrlKey: true, key: "S" })).toBe(true);
    expect(s({})).toBe(false);
    expect(s({ ctrlKey: true, shiftKey: true })).toBe(false); // Save As belongs to the browser
    expect(s({ ctrlKey: true, altKey: true })).toBe(false);
    expect(s({ ctrlKey: true, key: "a" })).toBe(false);
  });
});

describe("who keeps the keys", () => {
  it("text boxes, selects, textareas, range sliders and contenteditable keep every key", () => {
    for (const h of ['<input type="text">', '<input type="number">', '<input type="range">', "<input>", "<select></select>", "<textarea></textarea>", '<div contenteditable="true"></div>']) {
      const e = el(h);
      expect(takesTyping(e), h).toBe(true);
      expect(press(e, { key: "ArrowUp" }).answer, h).toBeNull();
    }
  });
  it("a checkbox, a button or a plain box does not need the arrows", () => {
    for (const h of ['<input type="checkbox">', "<button></button>", "<div></div>"]) {
      const e = el(h);
      expect(takesTyping(e), h).toBe(false);
      expect(press(e, { key: "ArrowUp" }).answer, h).toBe("zoomIn");
    }
  });
  it("Space stays with whatever it activates, so a focused button still clicks", () => {
    for (const h of ["<button></button>", "<summary></summary>", '<a href="#x">x</a>', '<div role="button"></div>', '<input type="checkbox">']) {
      const e = el(h);
      expect(takesSpace(e), h).toBe(true);
      expect(press(e, { key: " " }).answer, h).toBeNull();
    }
    expect(press(el("<div></div>"), { key: " " }).answer).toBe("reset");
  });
  it("a key already handled, or typed during IME composition, is not a view key", () => {
    expect(press(el("<div></div>"), { key: "ArrowUp" }, (e) => e.preventDefault()).answer).toBeNull();
    expect(press(el("<div></div>"), { key: "ArrowUp", isComposing: true }).answer).toBeNull();
  });
  it("the real target counts when the event comes out of a shadow root", () => {
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = '<input type="text">';
    document.body.appendChild(host);
    const r = press(root.querySelector("input")!, { key: "ArrowLeft" });
    expect(r.seenTarget).toBe(host); // retargeted: only composedPath sees the input
    expect(r.answer).toBeNull();
  });
});
