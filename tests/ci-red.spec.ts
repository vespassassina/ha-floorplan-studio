// S41.c: throwaway. Proves one failing test turns sharded CI red. Reverted before merge.
import { expect, test } from "@playwright/test";
test("CI turns red on a failing test", () => { expect(1).toBe(2); });
