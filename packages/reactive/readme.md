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
3. **effect**: Creates an effect that runs a function whenever the signals it depends on change.
4. **isSignal**: Checks if a value is a signal.

### 1. `signal`

Creates a reactive signal which can hold any type of value (primitive, array, object, etc.).

#### Syntax

```typescript
function signal<T>(defaultValue: T): WritableSignal<T>;
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

### 3. `effect`

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

### 4. `isSignal`

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