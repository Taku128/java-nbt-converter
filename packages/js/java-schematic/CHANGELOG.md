# @taku128/java-schematic

## 0.2.3

### Patch Changes

- ee3fb9e: Fix Sponge v3 `.schem` block entities and entities: data nested in the `Data` compound is now expanded into the vanilla structure format (fields at the top level with a lowercase `id`), so chest contents, sign text, etc. survive conversion. v2 behavior is unchanged. Strip litematic-derived `x`/`y`/`z` from tile-entity NBT (vanilla structures keep coordinates only in `blocks[].pos`; matches the Go converter). Add DoS guards for crafted files: a decompressed-size cap (128 MiB, with a gzip ISIZE pre-check) against gzip bombs, a total-region-volume cap (512³) for `.litematic` checked from the `Size` headers before any block loop, a `BlockStates` length consistency check, and a palette index cap for `.schem`. Fix the `bin` field so `npm publish` stops stripping the CLI entry.

## 0.2.2

### Patch Changes

- 2bbdf05: Fix classic MCEdit `.schematic` inputs crashing with `TypeError` — they are now rejected with a descriptive unsupported-format error (the `as StandardFormat` cast that hid the non-exhaustive switch is gone). Detect little-endian Bedrock NBT so real `.mcstructure` files get the intended "Use @taku128/mcstructure" error instead of a binary-garbage message, and keep unknown-format errors printable and bounded. Drop the unused `@taku128/core` dependency (this also fixes the lockfile mismatch that failed every CI run) and centralize the DataVersion fallback (3953 = Java 1.21) in one constant.
