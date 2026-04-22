/**
 * Java Structure NBT encoder.
 *
 * Produces a gzipped, big-endian NBT compound matching the vanilla
 * Structure Block format:
 *
 *   {
 *     DataVersion: Int,
 *     size: [Int, Int, Int] (TAG_List of TAG_Int),
 *     palette: [{Name, Properties?}, ...],
 *     blocks: [{pos: [Int×3], state: Int, nbt?: Compound}, ...],
 *     entities: [{pos: [Double×3], blockPos: [Int×3], nbt: Compound}, ...]
 *   }
 *
 * Block tile-entity NBT and entity NBT are preserved verbatim by passing
 * the prismarine-nbt parsed tree through unchanged.
 */

import nbt from 'prismarine-nbt';
import { gzipSync } from 'fflate';
import type { StandardFormat } from './types.js';

type NbtTag = { type: string; value: unknown };

export function encodeStructureNbt(sf: StandardFormat): Uint8Array {
  const size = sf.size.map((n) => Math.max(1, n | 0)) as [number, number, number];

  const palette = sf.palette.map((p) => {
    const entry: Record<string, NbtTag> = {
      Name: { type: 'string', value: p.Name },
    };
    if (p.Properties && Object.keys(p.Properties).length > 0) {
      const props: Record<string, NbtTag> = {};
      for (const [k, v] of Object.entries(p.Properties)) {
        props[k] = { type: 'string', value: String(v) };
      }
      entry.Properties = { type: 'compound', value: props };
    }
    return entry;
  });

  const blocks = sf.blocks.map((b) => {
    const entry: Record<string, NbtTag> = {
      pos: { type: 'list', value: { type: 'int', value: [b.pos[0] | 0, b.pos[1] | 0, b.pos[2] | 0] } },
      state: { type: 'int', value: b.state | 0 },
    };
    if (b.nbt !== undefined && b.nbt !== null) {
      entry.nbt = b.nbt as NbtTag;
    }
    return entry;
  });

  const entities = sf.entities.map((e) => ({
    pos: { type: 'list', value: { type: 'double', value: e.pos } },
    blockPos: {
      type: 'list',
      value: { type: 'int', value: [e.blockPos[0] | 0, e.blockPos[1] | 0, e.blockPos[2] | 0] },
    },
    nbt: e.nbt as NbtTag,
  }));

  const root = {
    type: 'compound' as const,
    name: '',
    value: {
      DataVersion: { type: 'int', value: sf.dataVersion | 0 },
      size: { type: 'list', value: { type: 'int', value: size } },
      palette: { type: 'list', value: { type: 'compound', value: palette } },
      blocks: { type: 'list', value: { type: 'compound', value: blocks } },
      entities: { type: 'list', value: { type: 'compound', value: entities } },
    },
  };

  const raw = nbt.writeUncompressed(root as never, 'big');
  return gzipSync(new Uint8Array(raw));
}
