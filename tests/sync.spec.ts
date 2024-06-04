import { signal } from "@signe/reactive";
import { sync, syncClass } from "@signe/sync";
import { describe, expect, test, vi } from "vitest";

describe("Sync Class", () => {
  test("onSync", () => {
    const fn = vi.fn();

    class Test {
      @sync() value = signal(0);
    }

    const test = new Test();

    syncClass(test, {
      onSync: fn,
    });

    expect(fn).toHaveBeenCalled();
  });
});
