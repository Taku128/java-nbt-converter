# Changelog

## [0.1.0] - 2026-04-23

Initial release.

- `@taku128/java-schematic@0.1.0`
  - Convert `.litematic` (Litematica) to Java Structure NBT
  - Convert `.schem` (Sponge/WorldEdit v2 & v3) to Java Structure NBT
  - Normalize Java `.nbt` (Structure Block output) passthrough
  - Content-based format detection via NBT root-key scanning
  - Rejects Bedrock `.mcstructure` with a descriptive error
  - Tile-entity NBT and entities preserved verbatim
  - Browser + Node via `/node` subpath
  - CLI: `java-schematic <input> [-o output.nbt]`
