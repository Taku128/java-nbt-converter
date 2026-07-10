# @taku128/java-schematic

## 0.2.2

### Patch Changes

- 2bbdf05: Fix classic MCEdit `.schematic` inputs crashing with `TypeError` — they are now rejected with a descriptive unsupported-format error (the `as StandardFormat` cast that hid the non-exhaustive switch is gone). Detect little-endian Bedrock NBT so real `.mcstructure` files get the intended "Use @taku128/mcstructure" error instead of a binary-garbage message, and keep unknown-format errors printable and bounded. Drop the unused `@taku128/core` dependency (this also fixes the lockfile mismatch that failed every CI run) and centralize the DataVersion fallback (3953 = Java 1.21) in one constant.
