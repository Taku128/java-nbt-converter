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
 * Tile-entity and entity NBT come in as the prismarine-nbt-compatible tree
 * produced by `./nbt-parse.ts` and are converted to deepslate tags before
 * encoding. No prismarine-nbt / fflate dependency.
 */

import {
  NbtByte,
  NbtByteArray,
  NbtCompound,
  NbtDouble,
  NbtFile,
  NbtFloat,
  NbtInt,
  NbtIntArray,
  NbtList,
  NbtLong,
  NbtLongArray,
  NbtShort,
  NbtString,
  NbtTag,
  NbtType,
} from 'deepslate/nbt';
import type { StandardFormat } from './types.js';

interface NbtNode {
  type: string;
  value: unknown;
}

const STRING_TO_TYPE: Record<string, NbtType> = {
  end: NbtType.End,
  byte: NbtType.Byte,
  short: NbtType.Short,
  int: NbtType.Int,
  long: NbtType.Long,
  float: NbtType.Float,
  double: NbtType.Double,
  byteArray: NbtType.ByteArray,
  string: NbtType.String,
  list: NbtType.List,
  compound: NbtType.Compound,
  intArray: NbtType.IntArray,
  longArray: NbtType.LongArray,
};

function toBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  if (Array.isArray(value) && value.length === 2) {
    const high = BigInt((value[0] as number) >>> 0);
    const low = BigInt((value[1] as number) >>> 0);
    return BigInt.asIntN(64, (high << 32n) | low);
  }
  return 0n;
}

function int32List(values: readonly number[]): NbtList<NbtInt> {
  const list = new NbtList<NbtInt>([], NbtType.Int);
  for (const v of values) list.add(new NbtInt(v | 0));
  return list;
}

function doubleList(values: readonly number[]): NbtList<NbtDouble> {
  const list = new NbtList<NbtDouble>([], NbtType.Double);
  for (const v of values) list.add(new NbtDouble(v));
  return list;
}

/** Convert a prismarine-nbt-shaped node back into a deepslate NbtTag. */
function nodeToTag(node: NbtNode): NbtTag {
  switch (node.type) {
    case 'byte':
      return new NbtByte(((node.value as number) | 0) & 0xff);
    case 'short':
      return new NbtShort(((node.value as number) | 0) & 0xffff);
    case 'int':
      return new NbtInt((node.value as number) | 0);
    case 'long':
      return new NbtLong(toBigInt(node.value));
    case 'float':
      return new NbtFloat(node.value as number);
    case 'double':
      return new NbtDouble(node.value as number);
    case 'string':
      return new NbtString(String(node.value ?? ''));
    case 'byteArray': {
      const v = node.value as ArrayLike<number> | Int8Array | Uint8Array;
      const items = Array.isArray(v) ? v : Array.from(v as ArrayLike<number>);
      return new NbtByteArray(items);
    }
    case 'intArray': {
      const v = (node.value as number[] | Int32Array) ?? [];
      return new NbtIntArray(Array.isArray(v) ? v : Array.from(v));
    }
    case 'longArray': {
      const v = (node.value as Array<unknown>) ?? [];
      return new NbtLongArray(v.map(toBigInt));
    }
    case 'compound':
      return compoundFromRecord(node.value as Record<string, NbtNode>);
    case 'list':
      return listFromNode(node.value as { type: string; value: unknown });
    default:
      return new NbtCompound();
  }
}

function compoundFromRecord(record: Record<string, NbtNode>): NbtCompound {
  const c = new NbtCompound();
  if (record) {
    for (const [key, child] of Object.entries(record)) {
      c.set(key, nodeToTag(child));
    }
  }
  return c;
}

function listFromNode(inner: { type: string; value: unknown }): NbtList {
  const childTypeStr = inner?.type ?? 'end';
  const childType = STRING_TO_TYPE[childTypeStr] ?? NbtType.End;
  const list = new NbtList<NbtTag>([], childType);
  const raw = inner?.value;

  if (childTypeStr === 'compound') {
    const items = (raw as Record<string, NbtNode>[] | undefined) ?? [];
    for (const item of items) list.add(compoundFromRecord(item));
    return list;
  }
  if (childTypeStr === 'list') {
    const items = (raw as Array<{ type: string; value: unknown }> | undefined) ?? [];
    for (const item of items) list.add(listFromNode(item));
    return list;
  }
  // primitives/arrays
  const items = (raw as unknown[] | undefined) ?? [];
  for (const v of items) {
    list.add(nodeToTag({ type: childTypeStr, value: v }));
  }
  return list;
}

export function encodeStructureNbt(sf: StandardFormat): Uint8Array {
  const size = sf.size.map((n) => Math.max(1, n | 0)) as [number, number, number];

  const paletteList = new NbtList<NbtCompound>([], NbtType.Compound);
  for (const p of sf.palette) {
    const entry = new NbtCompound();
    entry.set('Name', new NbtString(p.Name));
    if (p.Properties && Object.keys(p.Properties).length > 0) {
      const props = new NbtCompound();
      for (const [k, v] of Object.entries(p.Properties)) {
        props.set(k, new NbtString(String(v)));
      }
      entry.set('Properties', props);
    }
    paletteList.add(entry);
  }

  const blocksList = new NbtList<NbtCompound>([], NbtType.Compound);
  for (const b of sf.blocks) {
    const entry = new NbtCompound();
    entry.set('pos', int32List([b.pos[0] | 0, b.pos[1] | 0, b.pos[2] | 0]));
    entry.set('state', new NbtInt(b.state | 0));
    if (b.nbt !== undefined && b.nbt !== null) {
      const tag = nodeToTag(b.nbt as NbtNode);
      if (tag.isCompound()) entry.set('nbt', tag);
    }
    blocksList.add(entry);
  }

  const entitiesList = new NbtList<NbtCompound>([], NbtType.Compound);
  for (const e of sf.entities) {
    const entry = new NbtCompound();
    entry.set('pos', doubleList(e.pos));
    entry.set(
      'blockPos',
      int32List([e.blockPos[0] | 0, e.blockPos[1] | 0, e.blockPos[2] | 0]),
    );
    const nbt = nodeToTag(e.nbt as NbtNode);
    if (nbt.isCompound()) entry.set('nbt', nbt);
    entitiesList.add(entry);
  }

  const root = new NbtCompound();
  root.set('DataVersion', new NbtInt(sf.dataVersion | 0));
  root.set('size', int32List(size));
  root.set('palette', paletteList);
  root.set('blocks', blocksList);
  root.set('entities', entitiesList);

  const file = new NbtFile('', root, 'gzip', false, undefined);
  return file.write();
}
