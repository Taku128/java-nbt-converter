---
"@taku128/java-schematic": patch
---

Fix Sponge v3 `.schem` block entities and entities: the actual data nested in the `Data` compound is now expanded into the vanilla structure format (data fields at the top level with a lowercase `id`), so chest contents, sign text, etc. survive conversion. v2 behavior is unchanged. Add DoS guards for crafted files: a per-region volume cap for `.litematic` (prevents a forged huge `Size` from looping 10^10 times) plus a `BlockStates` length consistency check, and a palette index cap for `.schem` (prevents a forged index from allocating a huge array). Fix the `bin` field so `npm publish` stops stripping the CLI entry.
