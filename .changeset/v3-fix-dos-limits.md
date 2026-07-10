---
"@taku128/java-schematic": patch
---

Fix Sponge v3 `.schem` block entities and entities: data nested in the `Data` compound is now expanded into the vanilla structure format (fields at the top level with a lowercase `id`), so chest contents, sign text, etc. survive conversion. v2 behavior is unchanged. Strip litematic-derived `x`/`y`/`z` from tile-entity NBT (vanilla structures keep coordinates only in `blocks[].pos`; matches the Go converter). Add DoS guards for crafted files: a decompressed-size cap (128 MiB, with a gzip ISIZE pre-check) against gzip bombs, a total-region-volume cap (512³) for `.litematic` checked from the `Size` headers before any block loop, a `BlockStates` length consistency check, and a palette index cap for `.schem`. Fix the `bin` field so `npm publish` stops stripping the CLI entry.
