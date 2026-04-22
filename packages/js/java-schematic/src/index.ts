/**
 * @taku128/java-schematic
 *
 * Browser- and Node-compatible conversion of Java Edition schematic formats
 * (.litematic / .schem / .nbt) into standard Java Structure NBT.
 *
 * For file-path (Node-only) APIs, import from `@taku128/java-schematic/node`.
 */

import { sniffFormat } from './sniffer.js';
import { parseLitematica } from './litematica/parser.js';
import { parseWorldEditSchem } from './worldedit/parser.js';
import { parseJavaStructure } from './structure/parser.js';
import { encodeStructureNbt } from './encoder.js';
import type { ConvertResult, StandardFormat } from './types.js';

export { sniffFormat } from './sniffer.js';
export { encodeStructureNbt } from './encoder.js';
export type {
  ConvertResult,
  StandardFormat,
  StandardPalette,
  StandardBlock,
  StandardEntity,
  JavaSchematicFormat,
} from './types.js';
export type { SniffResult, DetectedFormat } from './sniffer.js';

/**
 * Convert any supported Java schematic buffer to Java Structure NBT.
 *
 * The format is auto-detected from the NBT root keys, not from the file
 * extension, so it works on uploads with wrong or missing extensions.
 *
 * Rejects Bedrock `.mcstructure` files with a descriptive error — those
 * should be routed through `@taku128/mcstructure` instead.
 */
export async function convertBuffer(buffer: Uint8Array | ArrayBuffer): Promise<ConvertResult> {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const sniff = sniffFormat(u8);

  if (sniff.format === 'bedrock-mcstructure') {
    throw new Error(
      'Input is a Bedrock .mcstructure file. Use @taku128/mcstructure to convert Bedrock structures.',
    );
  }
  if (sniff.format === 'unknown') {
    throw new Error(
      `Could not identify NBT format. Root keys: [${Array.from(sniff.rootKeys).join(', ')}]`,
    );
  }

  const sf: StandardFormat = await (async () => {
    switch (sniff.format) {
      case 'litematic':
        return parseLitematica(sniff.raw);
      case 'schem':
        return parseWorldEditSchem(sniff.raw);
      case 'structure':
        return parseJavaStructure(sniff.raw);
    }
  })() as StandardFormat;

  const nbt = encodeStructureNbt(sf);
  return {
    nbt,
    size: sf.size,
    blockCount: sf.blocks.length,
    paletteCount: sf.palette.length,
    format: sniff.format,
  };
}
