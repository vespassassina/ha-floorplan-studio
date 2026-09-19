import { describe, it, expect } from "vitest";
import demo from "../../demo/layout.json";

describe("demo layout", () => {
  it("is schema version 2", () => {
    expect(demo.version).toBe(2);
  });
});
