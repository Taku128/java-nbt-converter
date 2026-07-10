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
  if (sniff.format === 'schematic') {
    throw new Error(
      'Classic MCEdit .schematic files (numeric block IDs) are not supported. ' +
        'Re-save the build as a Sponge .schem (WorldEdit //schem save) or .litematic and convert that instead.',
    );
  }
  if (sniff.format === 'unknown') {
    throw new Error(
      `Could not identify NBT format. Root keys: [${describeRootKeys(sniff.rootKeys)}]`,
    );
  }

  let sf: StandardFormat;
  switch (sniff.format) {
    case 'litematic':
      sf = await parseLitematica(sniff.raw);
      break;
    case 'schem':
      sf = await parseWorldEditSchem(sniff.raw);
      break;
    case 'structure':
      sf = await parseJavaStructure(sniff.raw);
      break;
  }

  const nbt = encodeStructureNbt(sf);
  return {
    nbt,
    size: sf.size,
    blockCount: sf.blocks.length,
    paletteCount: sf.palette.length,
    format: sniff.format,
  };
}

/**
 * Root keys can be misread garbage when the input is not big-endian NBT at
 * all (e.g. a corrupt file), so keep error messages printable and bounded.
 */
function describeRootKeys(keys: Set<string>): string {
  const shown = Array.from(keys)
    .slice(0, 8)
    .map((k) => {
      const printable = k.length <= 32 && [...k].every((ch) => ch >= ' ' && ch <= '~');
      return printable ? k : `<unprintable key: ${k.length} chars>`;
    });
  const extra = keys.size - shown.length;
  return shown.join(', ') + (extra > 0 ? `, +${extra} more` : '');
}
