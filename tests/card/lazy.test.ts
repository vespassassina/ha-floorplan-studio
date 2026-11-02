import { describe, expect, it, vi } from "vitest";
import { lazy } from "../../src/card/lazy";

// B52.2: the one loader of the card's lazy chunks that the Overview uses. The browser half (a real chunk, a real 503) is in
// tests/card/overview-chunk.spec.ts; here the rules are pinned with a stand-in for the browser's import().

const BUILT = "floorplan-studio-overview-AbC123.js";
const mod = { name: "chunk" };

describe("lazy chunk loader", () => {
  it("loads through the plain import first, once, and remembers the module", async () => {
    const plain = vi.fn(async () => mod), fetchModule = vi.fn();
    const l = lazy(plain, BUILT, "overview", fetchModule);
    expect(l.get()).toBeNull();
    expect(await l.load()).toBe(mod);
    expect(await l.load()).toBe(mod);
    expect(l.get()).toBe(mod);
    expect(plain).toHaveBeenCalledTimes(1);
    expect(fetchModule).not.toHaveBeenCalled();
  });

  it("gives two callers who ask while it loads the same import, not a second try under a new query", async () => {
    let done!: (m: typeof mod) => void;
    const plain = vi.fn(() => new Promise<typeof mod>((r) => { done = r; })), fetchModule = vi.fn();
    const l = lazy(plain, BUILT, "overview", fetchModule);
    const a = l.load(), b = l.load();
    done(mod);
    expect(await a).toBe(mod);
    expect(await b).toBe(mod);
    expect(plain).toHaveBeenCalledTimes(1);
    expect(fetchModule).not.toHaveBeenCalled();
  });

  it("does not cache a failure: the next call asks for the same file under ?r=<n>, next to this module, and n counts the tries", async () => {
    const plain = vi.fn(async () => { throw new Error("503"); });
    const asked: string[] = [];
    const fetchModule = vi.fn(async (url: string) => { asked.push(url); if (asked.length < 2) throw new Error("503 again"); return mod; });
    const l = lazy(plain, BUILT, "overview", fetchModule);
    await expect(l.load()).rejects.toThrow("503");
    expect(l.get()).toBeNull();
    await expect(l.load()).rejects.toThrow("503 again");
    expect(await l.load()).toBe(mod);
    expect(plain).toHaveBeenCalledTimes(1); // only the first try is the plain import
    expect(asked).toHaveLength(2);
    expect(asked[0]).toMatch(new RegExp(`/src/card/${BUILT.replace(".", "\\.")}\\?r=1$`));
    expect(asked[1]).toMatch(/\?r=2$/);
    expect(asked[0]).not.toContain("floorplan-studio-overview-AbC123.js?r=1?"); // one query, however the module was asked for
  });

  it("unbuilt (the placeholder is still in `file`), a retry is the plain import again: there is no hashed file to ask for", async () => {
    const plain = vi.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValueOnce(mod), fetchModule = vi.fn();
    const l = lazy(plain, "__FPOVERVIEW_CHUNK__", "overview", fetchModule);
    await expect(l.load()).rejects.toThrow("x");
    expect(await l.load()).toBe(mod);
    expect(plain).toHaveBeenCalledTimes(2);
    expect(fetchModule).not.toHaveBeenCalled();
  });
});
