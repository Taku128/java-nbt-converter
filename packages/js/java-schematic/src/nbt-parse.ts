/**
 * NBT parser — backed by deepslate, exposes a prismarine-nbt-compatible
 * `{ type, value }` tree so the format-specific parsers don't need to know
 * which backend is in use.
 *
 * The shape matches prismarine-nbt's NBTFull output:
 *   - Compound  : { type: 'compound', value: Record<string, NbtNode> }
 *   - List      : { type: 'list', value: { type: <childType>, value: items[] } }
 *                 • primitive child: items is the primitive array
 *                 • compound child : items is Record<string, NbtNode>[] (unwrapped)
 *   - Primitives: { type: '<t>', value: <v> } where <t> is 'int', 'string', etc.
 *   - Long      : { type: 'long', value: bigint }
 *   - *Array    : { type: 'byteArray' | 'intArray' | 'longArray', value: native array }
 */

import { NbtFile, NbtTag, NbtType } from 'deepslate/nbt';
import type {
  NbtByteArray,
  NbtCompound,
  NbtIntArray,
  NbtList,
  NbtLongArray,
} from 'deepslate/nbt';

export type NbtNode = { type: string; value: unknown };

const TYPE_NAME: Record<number, string> = {
  [NbtType.End]: 'end',
  [NbtType.Byte]: 'byte',
  [NbtType.Short]: 'short',
  [NbtType.Int]: 'int',
  [NbtType.Long]: 'long',
  [NbtType.Float]: 'float',
  [NbtType.Double]: 'double',
  [NbtType.ByteArray]: 'byteArray',
  [NbtType.String]: 'string',
  [NbtType.List]: 'list',
  [NbtType.Compound]: 'compound',
  [NbtType.IntArray]: 'intArray',
  [NbtType.LongArray]: 'longArray',
};

function compoundChildren(c: NbtCompound): Record<string, NbtNode> {
  const out: Record<string, NbtNode> = {};
  c.forEach((key, tag) => {
    out[key] = toNode(tag);
  });
  return out;
}

function listItems(list: NbtList): unknown {
  const childType = list.getType();
  const typeName = TYPE_NAME[childType] ?? 'end';

  if (typeName === 'compound') {
    return list
      .getItems()
      .map((t) => (t.isCompound() ? compoundChildren(t) : {}));
  }
  if (typeName === 'list') {
    return list.getItems().map((t) => (t.isList() ? listNode(t) : { type: 'end', value: [] }));
  }
  // Primitive / array / string children: inline the raw values.
  const items: unknown[] = [];
  for (const t of list.getItems()) {
    items.push(primitiveValue(t));
  }
  return items;
}

function listNode(list: NbtList): { type: string; value: unknown } {
  const childType = list.getType();
  const typeName = TYPE_NAME[childType] ?? 'end';
  return { type: typeName, value: listItems(list) };
}

function byteArrayValue(a: NbtByteArray): Int8Array {
  const out = new Int8Array(a.length);
  const items = a.getItems();
  for (let i = 0; i < items.length; i++) out[i] = items[i]!.getAsNumber() | 0;
  return out;
}

function intArrayValue(a: NbtIntArray): number[] {
  return a.getItems().map((n) => n.getAsNumber() | 0);
}

function longArrayValue(a: NbtLongArray): bigint[] {
  return a.getItems().map((n) => n.toBigInt());
}

function primitiveValue(tag: NbtTag): unknown {
  if (tag.isByte() || tag.isShort() || tag.isInt() || tag.isFloat() || tag.isDouble()) {
    return tag.getAsNumber();
  }
  if (tag.isLong()) return tag.toBigInt();
  if (tag.isString()) return tag.getAsString();
  if (tag.isByteArray()) return byteArrayValue(tag);
  if (tag.isIntArray()) return intArrayValue(tag);
  if (tag.isLongArray()) return longArrayValue(tag);
  if (tag.isCompound()) return compoundChildren(tag);
  if (tag.isList()) return { type: TYPE_NAME[tag.getType()] ?? 'end', value: listItems(tag) };
  return undefined;
}

function toNode(tag: NbtTag): NbtNode {
  const id = tag.getId();
  const typeName = TYPE_NAME[id] ?? 'end';
  if (tag.isCompound()) {
    return { type: 'compound', value: compoundChildren(tag) };
  }
  if (tag.isList()) {
    return { type: 'list', value: listNode(tag) };
  }
  return { type: typeName, value: primitiveValue(tag) };
}

/**
 * Parse a (possibly gzip/zlib-compressed) NBT buffer into a prismarine-nbt-compatible tree.
 * Unlike the previous `prismarine-nbt` implementation, this works in the browser without any
 * `Buffer` / `zlib` polyfill — deepslate uses pako for inflation.
 */
export async function parseNbt(data: Uint8Array): Promise<NbtNode> {
  const file = NbtFile.read(data);
  return { type: 'compound', value: compoundChildren(file.root) };
}
