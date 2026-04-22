# @taku128/java-schematic

Convert Minecraft **Java Edition** schematic files to the standard Java Structure NBT format.
Works in the **browser** and **Node.js** — ready to render with [deepslate](https://github.com/misode/deepslate).

## Supported inputs

| Format | Extension | Status |
|---|---|---|
| Litematica | `.litematic` | ✅ |
| Sponge / WorldEdit (v2 & v3) | `.schem` | ✅ |
| Java Structure (passthrough) | `.nbt` | ✅ |

**Content-based format detection** — the file extension is a hint; the actual format is decided by scanning the NBT root keys, so uploads with missing/wrong extensions still work. Bedrock `.mcstructure` files are rejected with a message pointing to `@taku128/mcstructure`.

## Install

```bash
npm install @taku128/java-schematic
```

## Browser usage

```ts
import { convertBuffer } from '@taku128/java-schematic';

// From <input type="file">
const buf = new Uint8Array(await file.arrayBuffer());
const result = await convertBuffer(buf);

// result.nbt          — Uint8Array (gzipped Java Structure NBT)
// result.size         — [x, y, z]
// result.blockCount   — placed blocks
// result.paletteCount — unique states
// result.format       — "litematic" | "schem" | "structure"
```

## Node usage (file path)

```ts
import { convertFile } from '@taku128/java-schematic/node';
import { writeFileSync } from 'node:fs';

const result = await convertFile('./build.litematic');
writeFileSync('build.nbt', result.nbt);
```

## CLI

```bash
npx java-schematic build.litematic -o build.nbt
npx java-schematic region.schem
```

## Inspect format without converting

```ts
import { sniffFormat } from '@taku128/java-schematic';

const sniff = sniffFormat(buf);
// sniff.format   — "litematic" | "schem" | "structure" | "bedrock-mcstructure" | "unknown"
// sniff.rootName — root NBT compound name
// sniff.rootKeys — top-level child keys
```

## Pairing with the Bedrock converter

```
Bedrock .mcstructure ─── @taku128/mcstructure ────┐
Bedrock .mcworld     ─── @taku128/mcworld ────────┼──→ Java Structure .nbt
Java .litematic/.schem/.nbt ─── @taku128/java-schematic ─┘
```

All outputs are the same Java Structure NBT format, so a single viewer pipeline (e.g. deepslate) can display them uniformly.

## Notes

- Tile-entity NBT (chest contents, sign text, command blocks, …) is preserved verbatim.
- Entities are preserved.
- The classic MCEdit-era `.schematic` format (pre-1.13 numeric block IDs) is **not** supported in this release — opening a request or PR is welcome.

## License

MIT
