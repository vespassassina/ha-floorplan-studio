import { describe, expect, it, vi } from "vitest";
import demo from "../../demo/layout.json";
import type { Layout } from "../../src/core/schema";
import { FloorplanStudioCard } from "../../src/card/floorplan-studio-card";

const L = demo as unknown as Layout;

async function wait(el: FloorplanStudioCard) {
  for (let i = 0; i < 6; i++) { await el.updateComplete; await new Promise((r) => setTimeout(r, 10)); }
}

describe("S76: Card right-click context menu", () => {
  it("opens on a device for quick toggle and inspect, and on canvas for view controls", async () => {
    const callService = vi.fn(async () => undefined);
    const el = new FloorplanStudioCard();
    document.body.appendChild(el);
    el.setConfig({ layout: structuredClone(L) });
    el.hass = {
      states: { "light.demo_kitchen": { state: "on", attributes: { friendly_name: "Kitchen light" }, last_changed: "2026-11-25T10:00:00Z" } },
      themes: { darkMode: false },
      callService,
    } as never;
    await wait(el);

    const dev = el.shadowRoot!.querySelector('g[data-x="1"]')!;
    dev.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 120, clientY: 140 }));
    await wait(el);

    const menu = el.shadowRoot!.querySelector(".fp-ctx");
    expect(menu).toBeTruthy();
    expect(menu!.textContent).toContain("Turn off");
    expect(menu!.textContent).toContain("More info");
    expect(menu!.textContent).toContain("History");

    menu!.querySelector<HTMLButtonElement>('button[data-ctx="toggle"]')!.click();
    await wait(el);
    expect(callService).toHaveBeenCalledWith("light", "turn_off", { entity_id: "light.demo_kitchen" });
    expect(el.shadowRoot!.querySelector(".fp-ctx")).toBeNull();

    // Canvas right-click offers Fit, 3D, Labels
    const svg = el.shadowRoot!.querySelector("svg")!;
    svg.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
    await wait(el);
    const canvasMenu = el.shadowRoot!.querySelector(".fp-ctx");
    expect(canvasMenu).toBeTruthy();
    expect(canvasMenu!.textContent).toContain("Fit");
    expect(canvasMenu!.textContent).toContain("3D");
    expect(canvasMenu!.textContent).toContain("Labels");
    el.remove();
  });
});
