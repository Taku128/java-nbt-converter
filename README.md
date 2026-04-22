# java-nbt-converter

Monorepo for Minecraft **Java Edition** schematic → Java Structure NBT converters.

Companion to [`mc-nbt-converter`](https://github.com/Taku128/mc-nbt-converter), which handles Bedrock `.mcstructure` / `.mcworld` inputs. Together the two projects let a browser client normalize *any* Minecraft structure file into a single NBT format readable by [deepslate](https://github.com/misode/deepslate) and other Java-NBT tooling.

## Packages

| Package | Size (ESM) | Environment | Purpose |
|---|---|---|---|
| [`@taku128/java-schematic`](./packages/js/java-schematic) | ~22 KB | Browser + Node | Convert `.litematic` / `.schem` / `.nbt` to Java Structure NBT |

## Structure

```
java-nbt-converter/
├── packages/js/java-schematic/
│   ├── src/
│   │   ├── index.ts           # browser entry (buffer API)
│   │   ├── node.ts            # Node entry (file-path API)
│   │   ├── sniffer.ts         # content-based format detection
│   │   ├── encoder.ts         # Java Structure NBT writer
│   │   ├── litematica/        # .litematic parser
│   │   ├── worldedit/         # .schem (Sponge v2/v3) parser
│   │   └── structure/         # Java .nbt passthrough
│   └── bin/cli.js
└── test/fixtures/             # real schematic files for smoke tests
```

## Development

```bash
pnpm install
pnpm -r build
node packages/js/java-schematic/test/smoke.test.mjs
```

## License

MIT
