---
"@signe/sync": minor
---

Add `@sync({ precision })` to round the numbers sent to clients.

- Numbers are rounded to `precision` decimals after `transform` (negative values round to tens, hundreds...), including numbers inside plain objects and arrays.
- Only what is sent is rounded: the server value and the persisted value stay exact.
- For a numeric signal, a change that keeps the same rounded value is not sent.
- New `roundToPrecision(value, precision)` helper.

With 100 moving players, rounding positions to integers reduced packets by 24 to 39% and server time per tick by 8 to 17%.
