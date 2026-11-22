---
"@signe/room": patch
---

Fix `$applySync()` with `autoSync = false`:

- Changes made in the same task as `$applySync()` (`room.count.set(1); room.$applySync()`) are sent by this call. Since sync packets are batched per task, they were otherwise sent by the next `$applySync()` only.
- Clients waiting for their initial sync now receive the whole state. When changes were pending, they only received those changes.
