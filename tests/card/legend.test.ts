import { describe, expect, it, vi } from "vitest";
import { html, render } from "lit";
import { LEGEND_CSS, legendOverlayView } from "../../src/card/legend";

describe("plan legend chunk (S48)", () => {
  it("renders Glow, Rings, and Attention sections using theme CSS vars only and handles Close", () => {
    expect(LEGEND_CSS).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    const onClose = vi.fn();
    const host = document.createElement("div");
    render(legendOverlayView({ html, t: (k) => k }, "M0,0L1,1", onClose), host);

    const dlg = host.querySelector(".fp-legend-ov");
    expect(dlg).not.toBeNull();
    expect(dlg!.textContent).toContain("Plan legend");
    expect(dlg!.textContent).toContain("Glow");
    expect(dlg!.textContent).toContain("Rings");
    expect(dlg!.textContent).toContain("Attention");
    expect(dlg!.querySelectorAll(".fp-legend-sw").length).toBe(8);
    expect(dlg!.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b/i);

    host.querySelector<HTMLButtonElement>(".fp-legend-x")!.click();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
