/**
 * WorldEdit / Sponge Schematic (.schem) parser.
 *
 * Supports Sponge v2 (top-level fields) and v3 (wrapped in "Schematic" child).
 *
 * Shared fields (v2 & v3 after unwrap):
 *   Width, Height, Length     : int16 (unsigned)
 *   Offset                    : int32 array [x, y, z]
 *   Palette                   : compound { "minecraft:stone[prop=val]": int }
 *   BlockData                 : TAG_Byte_Array of VarInt-encoded palette indices
 *   BlockEntities             : list of compound
 *   Entities (v2+) / Entities : list of compound
 *
 * Index → coord convention (all Sponge versions):
 *   x = i % Width
 *   z = (i / Width) % Length
 *   y = i / (Width * Length)
 */

import { parseNbt } from '../nbt-parse.js';
import type { StandardFormat, StandardPalette, StandardBlock, StandardEntity } from '../types.js';

type NbtNode = { type: string; value: unknown };

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
    return Number((BigInt(raw[0]! | 0) << 32n) | BigInt(raw[1]! >>> 0));
  }
  return 0;
}
function asString(v: NbtNode | undefined): string {
  return v && typeof v.value === 'string' ? v.value : '';
}

function readByteArray(v: NbtNode | undefined): Uint8Array {
  if (!v) return new Uint8Array(0);
  const raw = v.value;
  if (raw instanceof Uint8Array) return raw;
  if (raw instanceof Int8Array) return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  if (Array.isArray(raw)) {
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw[i] & 0xff;
    return out;
  }
  return new Uint8Array(0);
}

function readIntArray(v: NbtNode | undefined): number[] {
  if (!v) return [];
  const raw = v.value;
  if (Array.isArray(raw)) return raw as number[];
  if (raw instanceof Int32Array) return Array.from(raw);
  return [];
}

export async function parseWorldEditSchem(raw: Uint8Array): Promise<StandardFormat> {
  const parsed = await parseNbt(raw);
  let root = asCompound(parsed);
  if (!root) throw new Error('.schem: root is not a compound');

  // v3: content wrapped in "Schematic" child
  const wrapped = asCompound(root.Schematic);
  if (wrapped) root = wrapped;

  const width = asNumber(root.Width);
  const height = asNumber(root.Height);
  const length = asNumber(root.Length);
  const dataVersion = asNumber(root.DataVersion) || 3953;

  const offsetArr = readIntArray(root.Offset);
  const offsetX = offsetArr[0] ?? 0;
  const offsetY = offsetArr[1] ?? 0;
  const offsetZ = offsetArr[2] ?? 0;

  // --- palette: "name[p=v]" -> int index ---
  // v3 may nest palette under Blocks.Palette — normalize.
  let paletteSource: NbtNode | undefined = root.Palette;
  let blockDataSource: NbtNode | undefined = root.BlockData;
  const blocksChild = asCompound(root.Blocks);
  if (blocksChild) {
    paletteSource ??= blocksChild.Palette;
    blockDataSource ??= blocksChild.Data;
  }

  const paletteCompound = asCompound(paletteSource);
  const paletteEntries: Array<{ index: number; name: string; properties: Record<string, string> }> = [];
  if (paletteCompound) {
    for (const [blockStateStr, v] of Object.entries(paletteCompound)) {
      const { name, properties } = parseBlockStateString(blockStateStr);
      paletteEntries.push({ index: asNumber(v), name, properties });
    }
  }

  const maxIndex = paletteEntries.reduce((m, p) => Math.max(m, p.index), -1);
  const outPalette: StandardPalette[] = new Array(maxIndex + 1)
    .fill(0)
    .map(() => ({ Name: 'minecraft:air', Properties: {} }));
  for (const p of paletteEntries) {
    outPalette[p.index] = { Name: p.name, Properties: p.properties };
  }

  // --- unpack VarInt-encoded BlockData ---
  const blockData = readByteArray(blockDataSource);
  const outBlocks: StandardBlock[] = [];
  const airIndex = outPalette.findIndex((p) => p.Name === 'minecraft:air');

  const totalBlocks = width * height * length;
  let cursor = 0;
  for (let i = 0; i < totalBlocks; i++) {
    if (cursor >= blockData.length) break;
    const paletteIdx = readVarInt(blockData, cursor);
    cursor = paletteIdx.next;
    if (paletteIdx.value < 0) continue;

    if (airIndex !== -1 && paletteIdx.value === airIndex) continue;

    const x = i % width;
    const z = Math.floor(i / width) % length;
    const y = Math.floor(i / (width * length));

    outBlocks.push({
      pos: [x, y, z],
      state: paletteIdx.value,
    });
  }

  // --- block entities: attach NBT to matching block ---
  // v3 has BlockEntities under Blocks.BlockEntities
  let blockEntitiesSource: NbtNode | undefined = root.BlockEntities;
  if (blocksChild) blockEntitiesSource ??= blocksChild.BlockEntities;
  const blockEntitiesList = asList(blockEntitiesSource);
  const blockEntityItems =
    (blockEntitiesList?.value as Record<string, NbtNode>[] | undefined) ?? [];
  for (const be of blockEntityItems) {
    const posArr = readIntArray(be.Pos);
    if (posArr.length < 3) continue;
    const [bx, by, bz] = [posArr[0]!, posArr[1]!, posArr[2]!];
    const match = outBlocks.find((b) => b.pos[0] === bx && b.pos[1] === by && b.pos[2] === bz);
    if (match) {
      match.nbt = { type: 'compound', value: be };
    }
  }

  // --- entities: preserve as-is ---
  let entitiesSource: NbtNode | undefined = root.Entities;
  const entitiesList = asList(entitiesSource);
  const entityItems = (entitiesList?.value as Record<string, NbtNode>[] | undefined) ?? [];
  const outEntities: StandardEntity[] = [];
  for (const ent of entityItems) {
    const posList = asList(ent.Pos);
    const posArr = (posList?.value as number[] | undefined) ?? [];
    if (posArr.length < 3) continue;
    const [ex, ey, ez] = [posArr[0]!, posArr[1]!, posArr[2]!];
    outEntities.push({
      pos: [ex, ey, ez],
      blockPos: [Math.floor(ex), Math.floor(ey), Math.floor(ez)],
      nbt: { type: 'compound', value: ent },
    });
  }

  return {
    size: [width, height, length],
    palette: outPalette,
    blocks: outBlocks,
    entities: outEntities,
    dataVersion,
    sourceFormat: 'schem',
  };
  // offset is intentionally ignored for the output: we emit blocks in structure-local
  // (0,0,0)-based coordinates. Callers that need the original offset can read it from
  // the source file themselves.
  void offsetX; void offsetY; void offsetZ;
}

// ---------------------------------------------------------------------------

function parseBlockStateString(s: string): { name: string; properties: Record<string, string> } {
  const bracket = s.indexOf('[');
  if (bracket === -1) return { name: s, properties: {} };
  const name = s.substring(0, bracket);
  const propsStr = s.substring(bracket + 1, s.length - 1);
  const properties: Record<string, string> = {};
  for (const pair of propsStr.split(',')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    properties[pair.substring(0, eq)] = pair.substring(eq + 1);
  }
  return { name, properties };
}

function readVarInt(data: Uint8Array, offset: number): { value: number; next: number } {
  let result = 0;
  let shift = 0;
  let cursor = offset;
  while (cursor < data.length) {
    const b = data[cursor]!;
    cursor++;
    result |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) return { value: result, next: cursor };
    shift += 7;
    if (shift >= 32) break;
  }
  return { value: -1, next: cursor };
}
