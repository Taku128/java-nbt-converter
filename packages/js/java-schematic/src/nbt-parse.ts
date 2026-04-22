/**
 * Thin wrapper around prismarine-nbt's `parse` that:
 *   1. Accepts Uint8Array (what callers have) and
 *   2. Upgrades to a Node Buffer when running in Node, because
 *      prismarine-nbt's Node build rejects raw Uint8Array.
 */

import nbt from 'prismarine-nbt';

type NbtNode = { type: string; value: unknown };

export async function parseNbt(data: Uint8Array): Promise<NbtNode> {
  const input: Uint8Array =
    typeof Buffer !== 'undefined'
      ? (Buffer.from(data.buffer, data.byteOffset, data.byteLength) as unknown as Uint8Array)
      : data;
  const result = await (nbt as unknown as {
    parse: (b: Uint8Array) => Promise<{ parsed: NbtNode }>;
  }).parse(input);
  return result.parsed;
}
