import { describe, expect, it } from "vitest";
import { BANNER_MS, bannerLevel, isQuiet } from "../../src/editor/banner";

describe("banner", () => {
  it("is quiet for nothing and for Ready", () => {
    expect(isQuiet("")).toBe(true);
    expect(isQuiet("Ready")).toBe(true);
    expect(isQuiet("Saved")).toBe(false);
  });
  it("colours by situation", () => {
    expect(bannerLevel("The plan is locked. Unlock it to change it")).toBe("error");
    expect(bannerLevel("Could not create the light: boom. Nothing was changed.")).toBe("error");
    expect(bannerLevel("Drawing cancelled")).toBe("warning");
    expect(bannerLevel("Created area X in Home Assistant, but the room is gone.")).toBe("warning");
    expect(bannerLevel("Saved")).toBe("info");
  });
  it("lasts 20 seconds", () => { expect(BANNER_MS).toBe(20000); });
});
