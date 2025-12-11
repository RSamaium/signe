# Reactive Library

## What is `@signe/reactive`?

The `@signe/reactive` library is a lightweight and flexible library for creating reactive data structures in JavaScript. It provides utilities for creating reactive signals, computed properties, and effects, allowing you to build reactive applications with ease.

---

## Installation

To install the `@signe/reactive` package, use the following command:

```bash
npm install @signe/reactive
```

---

## Usage

### Overview

The `@signe/reactive` library provides utilities for creating reactive signals, computed properties, and effects. It includes the following main functions:

1. **signal**: Creates a reactive signal.
2. **computed**: Creates a computed property that depends on other signals.
3. **linkedSignal**: Creates a linked signal that can optionally support writing back to its dependencies.
4. **effect**: Creates an effect that runs a function whenever the signals it depends on change.
5. **isSignal**: Checks if a value is a signal.

### 1. `signal`

Creates a reactive signal which can hold any type of value (primitive, array, object, etc.).

#### Syntax

```typescript
function signal<T>(defaultValue: T, options?: SignalOptions<T>): WritableSignal<T>;

interface SignalOptions<T> {
  equal?: (a: T, b: T) => boolean;
}
```

#### Example

```typescript
import { signal } from '@signe/reactive';

// Primitive signal
const count = signal(0);
console.log(count()); // Output: 0
count.set(1);
console.log(count()); // Output: 1

// Array signal
const numbers = signal([1, 2, 3]);
numbers.mutate(arr => arr.push(4));
console.log(numbers()); // Output: [1, 2, 3, 4]

// Object signal
const person = signal({ name: 'John', age: 30 });
person.mutate(obj => obj.age = 31);
console.log(person()); // Output: { name: 'John', age: 31 }
```

#### Signal Equality Functions

When creating a signal, you can optionally provide an equality function, which will be used to check whether the new value is actually different than the previous one. This prevents unnecessary emissions when setting the same value.

By default, signals use strict equality (`===`) for primitives and reference comparison for arrays and objects. With a custom equality function, you can define your own comparison logic.

##### Example 1: Deep equality for arrays

```typescript
import { signal } from '@signe/reactive';
import _ from 'lodash';

const data = signal(['test'], { equal: _.isEqual });

const observedValues: any[] = [];
data.observable.subscribe(value => {
  observedValues.push(value);
});

// Initial value is emitted
console.log(observedValues.length); // 1

// Set array with same content but different reference
data.set(['test']);

// Should not emit because content is equal (deep comparison)
console.log(observedValues.length); // Still 1

// Set array with different content
data.set(['different']);
console.log(observedValues.length); // 2
```

##### Example 2: Deep equality for objects

```typescript
import { signal } from '@signe/reactive';

// Deep equality function
const deepEqual = (a: any, b: any): boolean => {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  
  if (keysA.length !== keysB.length) return false;
  
  for (const key of keysA) {
    if (!keysB.includes(key)) return false;
    if (typeof a[key] === 'object' && a[key] !== null) {
      if (!deepEqual(a[key], b[key])) return false;
    } else if (a[key] !== b[key]) {
      return false;
    }
  }
  
  return true;
};

const objectSignal = signal({ a: 1, b: { c: 2 } }, { equal: deepEqual });

const observedValues: any[] = [];
objectSignal.observable.subscribe(value => {
  observedValues.push(value);
});

// Initial value is emitted
const initialCount = observedValues.length;

// Set object with same content but different reference
objectSignal.set({ a: 1, b: { c: 2 } });

// Should not emit because content is equal (deep comparison)
console.log(observedValues.length === initialCount); // true

// Set object with different content
objectSignal.set({ a: 1, b: { c: 3 } });
console.log(observedValues.length === initialCount + 1); // true
```

##### Example 3: Approximate equality for numbers

```typescript
import { signal } from '@signe/reactive';

// Custom equality that treats numbers within 0.1 as equal
const approximateEqual = (a: number, b: number): boolean => {
  return Math.abs(a - b) < 0.1;
};

const numSignal = signal(5.0, { equal: approximateEqual });

const observedValues: number[] = [];
numSignal.observable.subscribe(value => {
  observedValues.push(value);
});

// Initial value is emitted
const initialCount = observedValues.length;

// Set value within tolerance
numSignal.set(5.05);

// Should not emit because values are approximately equal
console.log(observedValues.length === initialCount); // true

// Set value outside tolerance
numSignal.set(5.2);
console.log(observedValues.length === initialCount + 1); // true
```

**Note**: When a custom equality function is provided, it completely replaces the default comparison logic. The signal will only emit when the equality function returns `false` (indicating the values are different).

### 2. `computed`

Creates a computed property that re-evaluates whenever the signals it depends on change.

#### Syntax

```typescript
function computed<T>(computeFunction: () => T, disposableFn?: () => void): ComputedSignal<T>;
```

#### Example

```typescript
import { signal, computed } from '@signe/reactive';

const a = signal(1);
const b = signal(2);

const sum = computed(() => a() + b());
console.log(sum()); // Output: 3

a.set(2);
console.log(sum()); // Output: 4
```

### 3. `linkedSignal`

Creates a linked signal that depends on other signals. A linked signal automatically updates when its source changes, and can be overridden using `set()`.

It supports two usage patterns:

1. **Simple computation**: `linkedSignal(() => source() * 2)` - can be overridden with `set()`
2. **Source + Computation**: `linkedSignal({ source: () => count(), computation: (value) => value * 2 })` - allows access to previous values

#### Syntax

```typescript
// Simple computation
function linkedSignal<T>(computation: () => T, options?: { equal?: (a: T, b: T) => boolean }): LinkedSignal<T>;

// Source + Computation
function linkedSignal<TSource, TValue>(options: {
  source: Signal<TSource> | (() => TSource);
  computation: (value: TSource, previous?: LinkedSignalPrevious<TSource, TValue>) => TValue;
  equal?: (a: TValue, b: TValue) => boolean;
}): LinkedSignal<TValue>;
```

#### Example 1: Simple computation

```typescript
import { signal, linkedSignal } from '@signe/reactive';

const source = signal(0);

// linkedSignal depends on source and updates automatically
const linked = linkedSignal(() => source() * 2);

console.log(linked()); // 0

source.set(3);
console.log(linked()); // 6

linked.set(100);       // Override the computed value
console.log(linked()); // 100
```

#### Example 2: Source + Computation

```typescript
import { signal, linkedSignal } from '@signe/reactive';

const count = signal(0);

const double = linkedSignal({
  source: () => count(),
  computation: (value) => value * 2
});

console.log(double()); // 0

count.set(5);
console.log(double()); // 10

double.set(50);        // Override the computed value
console.log(double()); // 50
```

#### Example 3: Source + Computation with previous values

```typescript
import { signal, linkedSignal } from '@signe/reactive';

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
```

#### Example 4: Custom equality comparison

```typescript
import { signal, linkedSignal } from '@signe/reactive';

const activeUser = signal({id: 123, name: 'Morgan', isAdmin: true});
const activeUserEditCopy = linkedSignal(() => activeUser(), {
  // Consider the user as the same if it's the same `id`.
  equal: (a, b) => a.id === b.id,
});

// Or, if separating `source` and `computation`
const activeUserEditCopy2 = linkedSignal({
  source: activeUser,
  computation: user => user,
  equal: (a, b) => a.id === b.id,
});
```

### 4. `effect`

Creates an effect that runs a function whenever the signals it depends on change. It can also return a cleanup function to run when the effect is disposed or re-run.

#### Syntax

```typescript
function effect(fn: () => void): Effect;
```

#### Example

```typescript
import { signal, effect } from '@signe/reactive';

const count = signal(0);

const dispose = effect(() => {
  console.log('Count changed:', count());
  return () => console.log('Cleanup on count change');
});

count.set(1); // Output: "Count changed: 1"
dispose(); // Output: "Cleanup on count change"
```

### 5. `isSignal`

Checks if a given value is a signal created by the `signal` function.

#### Syntax

```typescript
function isSignal(value: any): boolean;
```

#### Example

```typescript
import { signal, isSignal } from '@signe/reactive';

const count = signal(0);
console.log(isSignal(count)); // Output: true

const notASignal = { value: 0 };
console.log(isSignal(notASignal)); // Output: false
```

---

## Advanced Examples

### Working with ArraySubject

The `ArraySubject` class allows you to create signals specifically for arrays, tracking changes like additions, removals, and updates.

```typescript
import { signal } from '@signe/reactive';

const arraySignal = signal([1, 2, 3]);
arraySignal.observable.subscribe((change) => {
  console.log(change); // Outputs changes like { type: 'add', index: 3, items: [4] }
});

arraySignal.mutate(arr => arr.push(4));
```

### Working with ObjectSubject

The `ObjectSubject` class allows you to create signals specifically for objects, tracking changes like property additions, removals, and updates.

```typescript
import { signal } from '@signe/reactive';

const objectSignal = signal({ a: 1, b: 2 });
objectSignal.observable.subscribe((change) => {
  console.log(change); // Outputs changes like { type: 'update', key: 'a', value: 2 }
});

objectSignal.mutate(obj => obj.a = 2);
```

---

## Running Tests

To run the tests for `@signe/reactive`, use the following command:

```bash
npx vitest
```

Ensure you have Vitest installed as a dev dependency:

```bash
npm install --save-dev vitest
```