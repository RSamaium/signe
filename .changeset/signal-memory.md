---
"@signe/reactive": minor
---

Signals and computed signals use much less memory and propagate faster.

- A signal is now a function bound to its store, whose prototype is shared by all signals. `set`, `update`, `mutate`, `freeze`, `unfreeze`, `observable`, `_subject` and `_isFrozen` are accessors on that prototype: methods are created on first access, bound to their signal, then reused (`signal.set === signal.set`). Detached use (`const { set } = signal`, `other.freeze = signal.freeze`) keeps working, and assigning a method (`signal.set = fn`) still defines an own property on that signal.
- `signal.observable` and `computed.subscription` are created on first access. `isSignal()` recognizes signals of this version without creating their observable.
- Computed signals keep their state in a store object instead of closures; the dependency tracker is a class; dependencies are released through their listener entry instead of a closure.
- Visible change: these are no longer own properties (`Object.keys(signal)` is `[]`), but they are enumerable on the prototype, so `for (const key in signal)` still lists them (CanvasEngine copies signals that way).

Memory per signal: 754 → 217 bytes (1,026 bytes before the rxjs-free engine). Signal + computed: 2,558 → 1,358 bytes. Propagation through computed signals and effects is about 2× faster; creating signals costs about the same.
