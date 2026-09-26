---
"@signe/room": patch
---

Improve connection typings so rooms can be used through typed contracts:

- `NodeConnection.state` and `setState()` are typed as `Party.ConnectionState<TState>`, like a party connection, instead of `TState | ConnectionState<TState> | null` (which collapsed to `unknown`).
- `Party.Connection` is now an interface extending `WebSocket` instead of an intersection type. TypeScript can then infer the state type when `room.getConnection<TState>()` is checked against a contract that also declares `send()` or `close()`.
