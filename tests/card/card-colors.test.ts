import { afterEach, describe, expect, it } from "vitest";
import demo from "../../demo/layout.json";
import type { Layout } from "../../src/core/schema";
import { FloorplanStudioCard } from "../../src/card/floorplan-studio-card"; // also defines the element

// S19.E3. `layout.colors` is one colour per device type, set as `--fp-dev-<type>` on a group round the drawing; the editor passes it to
// renderFloor, the card did not, so a colour picked in the studio never reached the dashboard (spec: "the editor and the card use the same palette").
const withColors = (colors: unknown) => ({ ...structuredClone(demo as unknown as Layout), colors }) as Layout;
async function mount(layout: Layout) {
  const el = document.createElement("floorplan-studio-card") as FloorplanStudioCard;
  expect(customElements.get("floorplan-studio-card")).toBe(FloorplanStudioCard);
  document.body.appendChild(el);
  el.setConfig({ layout });
  el.hass = { states: {}, themes: { darkMode: false } } as never;
  await el.updateComplete;
  return el;
}

describe("the card draws layout.colors (S19.E3)", () => {
  afterEach(() => { document.body.innerHTML = ""; });
  it("sets each device type's colour on a group round the plan, as the editor does", async () => {
    const el = await mount(withColors({ light: "#123456", tv: "#abcdef" }));
    const g = el.shadowRoot!.querySelector<SVGGElement>("svg g.dev-colours")!;
    expect(g, "a dev-colours group").toBeTruthy();
    expect(g.getAttribute("style")).toBe("--fp-dev-light:#123456;--fp-dev-tv:#abcdef");
    expect(g.querySelector('[data-x="0"]'), "the plan is inside it").toBeTruthy();
  });
  it("draws no group when the layout has no colours: the plan is as it was", async () => {
    expect((await mount(withColors(undefined))).shadowRoot!.querySelector("svg g.dev-colours")).toBeNull();
  });
});
