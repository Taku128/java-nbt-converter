/**
 * Java Edition Structure (.nbt) passthrough.
 *
 * The file is already in the target format. We parse it only to normalize
 * (fill in defaults, re-emit via the encoder so the output has a consistent
 * shape regardless of the input version).
 */

import { parseNbt } from '../nbt-parse.js';
import type { StandardFormat } from '../types.js';

interface NbtNode {
  type: string;
  value: unknown;
}

function asCompound(v: NbtNode | undefined): Record<string, NbtNode> | null {
  if (!v || v.type !== 'compound') return null;
  return v.value as Record<string, NbtNode>;
}

function asList(v: NbtNode | undefined): { type: string; value: unknown } | null {
  if (!v || v.type !== 'list') return null;
  return v.value as { type: string; value: unknown };
}

function asNumber(v: NbtNode | undefined): number {
  if (!v) return 0;
  const raw = v.value;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'bigint') return Number(raw);
  if (Array.isArray(raw) && raw.length === 2) {
    // int64 stored as [high, low]
    return Number((BigInt(raw[0]!) << 32n) | BigInt(raw[1]! >>> 0));
  }
  return 0;
}

function asString(v: NbtNode | undefined): string {
  if (!v || typeof v.value !== 'string') return '';
  return v.value;
}

function readIntTriple(v: NbtNode | undefined): [number, number, number] {
  const l = asList(v);
  if (!l || !Array.isArray(l.value)) return [0, 0, 0];
  const arr = l.value as number[];
  return [arr[0] ?? 0, arr[1] ?? 0, arr[2] ?? 0];
}

function readDoubleTriple(v: NbtNode | undefined): [number, number, number] {
  const l = asList(v);
  if (!l || !Array.isArray(l.value)) return [0, 0, 0];
  const arr = l.value as number[];
  return [arr[0] ?? 0, arr[1] ?? 0, arr[2] ?? 0];
}

export async function parseJavaStructure(raw: Uint8Array): Promise<StandardFormat> {
  const parsed = await parseNbt(raw);
  const rootCompound = asCompound(parsed);
  if (!rootCompound) throw new Error('.nbt: root is not a compound tag');

  const size = readIntTriple(rootCompound.size);

  const paletteList = asList(rootCompound.palette);
  const paletteItems = (paletteList?.value as Record<string, NbtNode>[] | undefined) ?? [];
  const palette = paletteItems.map((entry) => {
    const name = asString(entry.Name);
    const propsCompound = asCompound(entry.Properties);
    const properties: Record<string, string> = {};
    if (propsCompound) {
      for (const [k, v] of Object.entries(propsCompound)) {
        properties[k] = asString(v);
      }
    }
    return { Name: name, Properties: properties };
  });

  const blocksList = asList(rootCompound.blocks);
  const blockItems = (blocksList?.value as Record<string, NbtNode>[] | undefined) ?? [];
  const blocks = blockItems.map((b) => {
    const pos = readIntTriple(b.pos);
    const state = asNumber(b.state);
    const result: { pos: [number, number, number]; state: number; nbt?: unknown } = {
      pos,
      state,
    };
    if (b.nbt) result.nbt = b.nbt;
    return result;
  });

  const entitiesList = asList(rootCompound.entities);
  const entityItems = (entitiesList?.value as Record<string, NbtNode>[] | undefined) ?? [];
  const entities = entityItems
    .filter((e) => e.nbt !== undefined)
    .map((e) => ({
      pos: readDoubleTriple(e.pos),
      blockPos: readIntTriple(e.blockPos),
      nbt: e.nbt!,
    }));

  const dataVersion = asNumber(rootCompound.DataVersion) || 3953;

  return {
    size,
    palette,
    blocks,
    entities,
    dataVersion,
    sourceFormat: 'structure',
  };
}
