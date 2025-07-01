import { describe, it, expect } from "vitest";
import { signal, computed, untracked } from "../../packages/reactive/src";

describe("untracked", () => {
  it("should return the function result", () => {
    const num = signal(1);
    const result = untracked(() => num() + 1);
    expect(result).toBe(2);
  });

  it("should not track dependencies", () => {
    const num = signal(1);
    const comp = computed(() => {
      untracked(() => num());
      return 5;
    });

    expect(comp()).toBe(5);
    expect(comp.dependencies).toHaveLength(0);
  });
});
