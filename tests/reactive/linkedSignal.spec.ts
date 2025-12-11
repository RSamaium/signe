import { describe, expect, it, vi } from "vitest";
import { linkedSignal, signal } from "../../packages/reactive/src";

describe("linkedSignal", () => {
  describe("simple computation", () => {
    it("should create a linked signal with a simple computation", () => {
      const count = signal(0);
      const doubled = linkedSignal(() => count() * 2);

      expect(doubled()).toBe(0);
      expect(doubled.dependencies).toHaveLength(1);
    });

    it("should update when the source signal changes", () => {
      const source = signal(0);
      const linked = linkedSignal(() => source() * 2);

      expect(linked()).toBe(0);

      source.set(3);
      expect(linked()).toBe(6);
    });

    it("should track dependencies correctly", () => {
      const a = signal(1);
      const b = signal(2);
      const sum = linkedSignal(() => a() + b());

      expect(sum.dependencies).toHaveLength(2);
      expect(sum.dependencies.has(a)).toBe(true);
      expect(sum.dependencies.has(b)).toBe(true);
    });

    it("should have a setter to override the computed value", () => {
      const source = signal(0);
      const linked = linkedSignal(() => source() * 2);

      expect(typeof linked.set).toBe("function");
      
      linked.set(100);
      expect(linked()).toBe(100);
      
      // Override persists until source changes
      source.set(5);
      expect(linked()).toBe(10); // Override is reset when source changes
    });

    it("should work with multiple dependencies", () => {
      const a = signal(2);
      const b = signal(3);
      const c = signal(4);
      const sum = linkedSignal(() => a() + b() + c());

      expect(sum()).toBe(9);
      expect(sum.dependencies).toHaveLength(3);

      a.set(10);
      expect(sum()).toBe(17);
    });

    it("should support custom equality function", () => {
      const activeUser = signal({ id: 123, name: "Morgan", isAdmin: true });
      const activeUserEditCopy = linkedSignal(() => activeUser(), {
        equal: (a, b) => a.id === b.id,
      });

      expect(activeUserEditCopy()).toEqual({ id: 123, name: "Morgan", isAdmin: true });
      expect(activeUserEditCopy.dependencies).toHaveLength(1);
    });
  });

  describe("source + computation", () => {
    it("should create a linked signal with source and computation", () => {
      const count = signal(0);
      const double = linkedSignal({
        source: () => count(),
        computation: (value) => value * 2,
      });

      expect(double()).toBe(0);
      expect(typeof double.set).toBe("function");
    });

    it("should read the linked signal correctly", () => {
      const count = signal(0);
      const double = linkedSignal({
        source: () => count(),
        computation: (value) => value * 2,
      });

      expect(double()).toBe(0);

      count.set(5);
      expect(double()).toBe(10);
    });

    it("should allow overriding the computed value with set()", () => {
      const count = signal(0);
      const double = linkedSignal({
        source: () => count(),
        computation: (value) => value * 2,
      });

      expect(double()).toBe(0);

      double.set(50);
      expect(double()).toBe(50);

      // Override is reset when source changes
      count.set(10);
      expect(double()).toBe(20);
    });

    it("should update when source changes after override", () => {
      const count = signal(0);
      const double = linkedSignal({
        source: () => count(),
        computation: (value) => value * 2,
      });

      double.set(50);
      expect(double()).toBe(50);

      count.set(15);
      expect(double()).toBe(30);
    });

    it("should work with source as a signal directly", () => {
      const count = signal(0);
      const double = linkedSignal({
        source: count,
        computation: (value) => value * 2,
      });

      expect(double()).toBe(0);

      count.set(5);
      expect(double()).toBe(10);
    });

    it("should support custom equality function", () => {
      const activeUser = signal({ id: 123, name: "Morgan" });
      const activeUserEditCopy = linkedSignal({
        source: activeUser,
        computation: (user) => user,
        equal: (a, b) => a.id === b.id,
      });

      expect(activeUserEditCopy()).toEqual({ id: 123, name: "Morgan" });
    });
  });

  describe("source + computation with previous", () => {
    it("should pass previous values to computation function", () => {
      const shippingOptions = signal([
        { id: "1", name: "Standard" },
        { id: "2", name: "Express" },
      ]);

      const selectedOption = linkedSignal<typeof shippingOptions extends signal<infer T> ? T : never, { id: string; name: string }>({
        source: shippingOptions,
        computation: (newOptions, previous) => {
          // If the newOptions contain the previously selected option, preserve that selection.
          // Otherwise, default to the first option.
          return (
            newOptions.find((opt) => opt.id === previous?.value.id) ?? newOptions[0]
          );
        },
      });

      expect(selectedOption()).toEqual({ id: "1", name: "Standard" });

      // Update shipping options, should preserve selection if it exists
      shippingOptions.set([
        { id: "1", name: "Standard" },
        { id: "2", name: "Express" },
        { id: "3", name: "Overnight" },
      ]);

      expect(selectedOption()).toEqual({ id: "1", name: "Standard" });

      // Manually override selection
      selectedOption.set({ id: "2", name: "Express" });
      expect(selectedOption()).toEqual({ id: "2", name: "Express" });

      // Update options again, should preserve the override until source changes
      shippingOptions.set([
        { id: "1", name: "Standard" },
        { id: "2", name: "Express Updated" },
      ]);
      expect(selectedOption()).toEqual({ id: "2", name: "Express Updated" });
    });

    it("should handle previous being undefined on first computation", () => {
      const source = signal(10);
      const result = linkedSignal<number, number>({
        source: source,
        computation: (value, previous) => {
          if (previous === undefined) {
            return value * 2;
          }
          return value + previous.value;
        },
      });

      expect(result()).toBe(20); // 10 * 2

      source.set(5);
      expect(result()).toBe(25); // 5 + 20
    });
  });

  describe("edge cases", () => {
    it("should handle linked signal without dependencies", () => {
      const constant = linkedSignal(() => 42);
      expect(constant()).toBe(42);
      expect(constant.dependencies).toHaveLength(0);
    });

    it("should handle linked signal with source + computation and no dependencies in computation", () => {
      let externalValue = 10;
      const linked = linkedSignal({
        source: () => externalValue,
        computation: (value) => value * 2,
      });

      expect(linked()).toBe(20);
      expect(linked.dependencies).toHaveLength(0);

      linked.set(30);
      expect(linked()).toBe(30);

      externalValue = 15;
      // Since there are no dependencies, value is recomputed on read
      expect(linked()).toBe(30); // Still overridden
    });

    it("should have observable property", () => {
      const count = signal(0);
      const doubled = linkedSignal(() => count() * 2);

      expect(doubled.observable).toBeDefined();
      expect(doubled.subscription).toBeDefined();
    });

    it("should track dependency when reading linked signal", () => {
      const count = signal(0);
      const doubled = linkedSignal(() => count() * 2);
      const quadrupled = linkedSignal(() => doubled() * 2);

      expect(quadrupled()).toBe(0);
      expect(quadrupled.dependencies.has(doubled)).toBe(true);

      count.set(5);
      expect(quadrupled()).toBe(20);
    });

    it("should reset override when source changes", () => {
      const source = signal(0);
      const linked = linkedSignal(() => source() * 2);

      linked.set(100);
      expect(linked()).toBe(100);

      source.set(5);
      expect(linked()).toBe(10); // Override is reset
    });
  });
});
