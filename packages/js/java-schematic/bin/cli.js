#!/usr/bin/env node

/**
 * @taku128/java-schematic CLI
 *
 * Usage:
 *   java-schematic <input> [-o output.nbt]
 *
 * Auto-detects the format from NBT content, not the extension.
 */

import fs from 'node:fs';
import path from 'node:path';
import { convertFile } from '../dist/node.js';

function usage() {
  console.log(`
java-schematic - Convert Java Edition schematic files to Java Structure NBT

Usage:
  java-schematic <input> [options]

Options:
  -o, --output <path>   Output .nbt file (default: <input>.converted.nbt)
  -h, --help            Show this help

Supported inputs:
  .litematic            Litematica
  .schem                Sponge / WorldEdit (v2 & v3)
  .nbt                  Java Structure (normalized passthrough)

Examples:
  java-schematic build.litematic -o build.nbt
  java-schematic region.schem
`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { input: null, output: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-h' || a === '--help') {
      usage();
      process.exit(0);
    } else if (a === '-o' || a === '--output') {
      opts.output = args[++i];
    } else if (!a.startsWith('-')) {
      opts.input = a;
    }
  }
  if (!opts.input) {
    usage();
    process.exit(1);
  }
  if (!opts.output) {
    const ext = path.extname(opts.input);
    opts.output = opts.input.slice(0, -ext.length || undefined) + '.converted.nbt';
  }
  return opts;
}

async function main() {
  const { input, output } = parseArgs();
  if (!fs.existsSync(input)) {
    console.error(`File not found: ${input}`);
    process.exit(1);
  }

  console.log(`📦 Converting ${path.basename(input)}...`);
  const result = await convertFile(input);
  fs.writeFileSync(path.resolve(output), result.nbt);

  const sizeKb = (result.nbt.length / 1024).toFixed(1);
  console.log(`✅ Format : ${result.format}`);
  console.log(`   Size  : ${result.size.join(' × ')}`);
  console.log(`   Blocks: ${result.blockCount}, Palette: ${result.paletteCount}`);
  console.log(`💾 Wrote ${output} (${sizeKb} KB gzipped)`);
}

main().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
