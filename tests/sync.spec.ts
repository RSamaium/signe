import { signal } from "@signe/reactive";
import { describe, expect, test, vi } from "vitest";
import { sync, syncClass } from "../packages/sync/src";

describe("Sync Class", () => {
  test("onSync", () => {
    const fn = vi.fn();

    class Test {
      @sync() value = signal(0);
    }

    const instance = new Test();

    syncClass(instance, {
      onSync: fn,
    });

    expect(fn).toHaveBeenCalled();
  });
});
