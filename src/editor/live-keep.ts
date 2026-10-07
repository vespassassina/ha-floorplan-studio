import { noChange } from "lit";
import { setCommittedValue } from "lit/directive-helpers.js";
import { Directive, PartType, directive, type PartInfo, type PropertyPart } from "lit/directive.js";

/**
 * `live` from lit, except that a box with focus is left alone. `live` writes the bound value whenever the DOM value
 * differs from it, which includes every half-typed number: the editor re-renders on a 1 s timer while a motion sensor
 * fades and on each Home Assistant update, and each render threw away what Diego was typing (2026-10-07). A focused box with typing not yet committed is left
 * alone; once its `change` fires a refused or clamped entry snaps back. A box that is not focused still follows the layout, so undo and a selection change show the true value.
 */
const typing = new WeakSet<Element>(); // boxes with `input` since their last `change`: half-typed, hands off

class LiveKeep extends Directive {
  private bound?: Element;
  constructor(info: PartInfo) {
    super(info);
    if (info.type !== PartType.PROPERTY) throw new Error("liveKeep binds a property, like lit's live");
  }
  render(value: unknown): unknown { return value; }
  override update(part: PropertyPart, [value]: [unknown]): unknown {
    const el = part.element as HTMLElement;
    if (this.bound !== el) {
      this.bound = el;
      el.addEventListener("input", () => typing.add(el));
      el.addEventListener("change", () => typing.delete(el)); // a commit: show what was kept, clamped or refused
    }
    if (part.name === "value" && typing.has(el) && (el.getRootNode() as Document | ShadowRoot).activeElement === el) return noChange;
    if ((el as unknown as Record<string, unknown>)[part.name] === value) return noChange;
    setCommittedValue(part); // lit skips a write equal to its last one; the DOM has drifted, so force it (as `live` does)
    return value;
  }
}
export const live = directive(LiveKeep);
