/**
 * Node-only entry point: file-path helpers.
 *
 * Browser code should import from `@taku128/java-schematic` directly and
 * pass buffers obtained via `File.arrayBuffer()`.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { convertBuffer } from './index.js';
import type { ConvertResult } from './types.js';

export * from './index.js';

/** Read a Java schematic file and convert it to Java Structure NBT. */
export async function convertFile(inputPath: string): Promise<ConvertResult> {
  const buf = await readFile(resolve(inputPath));
  return convertBuffer(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
}
