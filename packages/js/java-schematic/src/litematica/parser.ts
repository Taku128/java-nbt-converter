/**
 * Litematica (.litematic) parser.
 *
 * A Litematica file is a gzipped big-endian NBT compound with this shape:
 *
 *   {
 *     Metadata: { Name, Author, EnclosingSize: {x, y, z}, TotalBlocks, ... },
 *     MinecraftDataVersion: Int,
 *     Version: Int,
 *     Regions: {
 *       <regionName>: {
 *         Position: {x, y, z},
 *         Size: {x, y, z},          // signed — negative size means the player
 *                                   // anchored the selection at the +max corner
 *                                   // and dragged toward -min on that axis.
 *         BlockStatePalette: [{Name, Properties}, ...],
 *         BlockStates: Long_Array,  // bit-packed palette indices in linear order:
 *                                   //   linearIdx = y*|sx|*|sz| + z*|sx| + x
 *                                   // where (x, y, z) ∈ [0, |size|) and index 0
 *                                   // is at the bbox MIN corner (effective origin)
 *                                   //   bboxMin = Position + (sign<0 ? size+1 : 0)
 *         TileEntities: [{ x, y, z, ... }]
 *                                   // (x, y, z) ∈ [0, |size|), local to bboxMin
 *         Entities: [{ Pos: [x, y, z] (doubles), ... }]
 *                                   // Pos is in [0, |size|) coordinates, local to bboxMin
 *       }
 *     }
 *   }
 *
 * IMPORTANT: A negative size component does NOT mean "iterate backwards from
 * Position" — it just records the player's selection direction. The on-disk
 * data is always stored from the bbox min corner outward in +x, +y, +z.
 */

import { parseNbt } from '../nbt-parse.js';
import type { StandardFormat, StandardPalette, StandardBlock, StandardEntity } from '../types.js';

type NbtNode = { type: string; value: unknown };

// ---------------------------------------------------------------------------
// generic NBT helpers (shared conventions across formats)
// ---------------------------------------------------------------------------

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
function xyz(v: NbtNode | undefined): [number, number, number] {
  const c = asCompound(v);
  if (!c) return [0, 0, 0];
  return [asNumber(c.x), asNumber(c.y), asNumber(c.z)];
}

// ---------------------------------------------------------------------------
// int64 → unsigned BigInt conversion (handles prismarine-nbt's [high,low] form)
// ---------------------------------------------------------------------------

function toU64(value: unknown): bigint {
  if (typeof value === 'bigint') return BigInt.asUintN(64, value);
  if (Array.isArray(value) && value.length === 2) {
    const high = BigInt((value[0] as number) >>> 0);
    const low = BigInt((value[1] as number) >>> 0);
    return (high << 32n) | low;
  }
  if (typeof value === 'number') return BigInt.asUintN(64, BigInt(value));
  return 0n;
}

function readLongArray(v: NbtNode | undefined): bigint[] {
  if (!v) return [];
  // Long_Array: value is an array of longs
  // List-of-long is less common but handle it too
  const raw = v.value;
  if (Array.isArray(raw)) {
    return raw.map(toU64);
  }
  if (raw && typeof raw === 'object' && 'value' in (raw as object)) {
    const inner = (raw as { value: unknown }).value;
    if (Array.isArray(inner)) return inner.map(toU64);
  }
  return [];
}

// ---------------------------------------------------------------------------
// parser entry
// ---------------------------------------------------------------------------

export async function parseLitematica(raw: Uint8Array): Promise<StandardFormat> {
  const parsed = await parseNbt(raw);
  const root = asCompound(parsed);
  if (!root) throw new Error('.litematic: root is not a compound');

  const dataVersion = asNumber(root.MinecraftDataVersion) || 3953;

  const regionsCompound = asCompound(root.Regions);
  if (!regionsCompound) throw new Error('.litematic: missing Regions compound');

  // Unified output palette across all regions
  const outPalette: StandardPalette[] = [];
  const paletteIndexByKey = new Map<string, number>();

  const outBlocks: StandardBlock[] = [];
  const outEntities: StandardEntity[] = [];

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let foundAny = false;

  for (const regionNode of Object.values(regionsCompound)) {
    const region = asCompound(regionNode);
    if (!region) continue;

    const size = xyz(region.Size);
    const position = xyz(region.Position);

    const absSizeX = Math.abs(size[0]);
    const absSizeY = Math.abs(size[1]);
    const absSizeZ = Math.abs(size[2]);
    if (absSizeX === 0 || absSizeY === 0 || absSizeZ === 0) continue;

    // Effective origin = the bbox MIN corner in world coords. This is where
    // BlockStates[linearIdx=0] (and TileEntity (0,0,0)) lives. When size is
    // negative, the player anchored at the +max side, so the min corner is
    // Position + (size + 1) on that axis; otherwise it equals Position.
    const effOriginX = position[0] + (size[0] < 0 ? size[0] + 1 : 0);
    const effOriginY = position[1] + (size[1] < 0 ? size[1] + 1 : 0);
    const effOriginZ = position[2] + (size[2] < 0 ? size[2] + 1 : 0);

    if (effOriginX < minX) minX = effOriginX;
    if (effOriginY < minY) minY = effOriginY;
    if (effOriginZ < minZ) minZ = effOriginZ;
    if (effOriginX + absSizeX > maxX) maxX = effOriginX + absSizeX;
    if (effOriginY + absSizeY > maxY) maxY = effOriginY + absSizeY;
    if (effOriginZ + absSizeZ > maxZ) maxZ = effOriginZ + absSizeZ;
    foundAny = true;

    // --- map local palette → global ---
    const paletteList = asList(region.BlockStatePalette);
    const paletteItems = (paletteList?.value as Record<string, NbtNode>[] | undefined) ?? [];

    const localToGlobal = new Array<number>(paletteItems.length);
    paletteItems.forEach((entry, i) => {
      const name = asString(entry.Name);
      const propsCompound = asCompound(entry.Properties);
      const properties: Record<string, string> = {};
      if (propsCompound) {
        for (const [k, v] of Object.entries(propsCompound)) {
          properties[k] = asString(v);
        }
      }
      const key = canonicalKey(name, properties);
      let gIdx = paletteIndexByKey.get(key);
      if (gIdx === undefined) {
        gIdx = outPalette.length;
        paletteIndexByKey.set(key, gIdx);
        outPalette.push({ Name: name, Properties: properties });
      }
      localToGlobal[i] = gIdx;
    });

    // --- unpack bit-packed BlockStates ---
    const longs = readLongArray(region.BlockStates);
    const paletteCount = paletteItems.length;
    if (paletteCount === 0 || longs.length === 0) continue;

    const bitsPerBlock = Math.max(2, bitLength(paletteCount - 1));
    const mask = (1n << BigInt(bitsPerBlock)) - 1n;

    const airGlobalIndex = findAirIndex(outPalette);

    // BlockStates is stored in (y, z, x) linear order starting from the bbox
    // min corner. Local (x, y, z) ∈ [0, |size|) always map to
    // (effOrigin + x, effOrigin + y, effOrigin + z) regardless of size sign.
    for (let y = 0; y < absSizeY; y++) {
      for (let z = 0; z < absSizeZ; z++) {
        for (let x = 0; x < absSizeX; x++) {
          const index = y * absSizeX * absSizeZ + z * absSizeX + x;
          const paletteIdx = unpack(longs, index, bitsPerBlock, mask);

          const realX = effOriginX + x;
          const realY = effOriginY + y;
          const realZ = effOriginZ + z;

          const gIdx = localToGlobal[paletteIdx];
          if (gIdx === undefined) continue;
          if (airGlobalIndex !== -1 && gIdx === airGlobalIndex) continue;

          outBlocks.push({
            pos: [realX, realY, realZ],
            state: gIdx,
          });
        }
      }
    }

    // --- tile entities: attach NBT to the matching block ---
    // x/y/z in TileEntities are local to the bbox min corner (same anchor as
    // the BlockStates array), not to Position.
    const tileEntitiesList = asList(region.TileEntities);
    const tileEntitiesItems =
      (tileEntitiesList?.value as Record<string, NbtNode>[] | undefined) ?? [];
    for (const te of tileEntitiesItems) {
      const teX = asNumber(te.x) + effOriginX;
      const teY = asNumber(te.y) + effOriginY;
      const teZ = asNumber(te.z) + effOriginZ;

      const match = outBlocks.find(
        (b) => b.pos[0] === teX && b.pos[1] === teY && b.pos[2] === teZ,
      );
      if (match) {
        match.nbt = { type: 'compound', value: te };
      }
    }

    // --- entities: preserve raw NBT, record absolute positions ---
    // Entity Pos is in [0, |size|) coordinates local to the bbox min corner.
    const entitiesList = asList(region.Entities);
    const entitiesItems =
      (entitiesList?.value as Record<string, NbtNode>[] | undefined) ?? [];
    for (const ent of entitiesItems) {
      const posList = asList(ent.Pos);
      const posArr = (posList?.value as number[] | undefined) ?? [];
      if (posArr.length < 3) continue;
      const ex = posArr[0]! + effOriginX;
      const ey = posArr[1]! + effOriginY;
      const ez = posArr[2]! + effOriginZ;
      outEntities.push({
        pos: [ex, ey, ez],
        blockPos: [Math.floor(ex), Math.floor(ey), Math.floor(ez)],
        nbt: { type: 'compound', value: ent },
      });
    }
  }

  const size: [number, number, number] = foundAny
    ? [maxX - minX, maxY - minY, maxZ - minZ]
    : [0, 0, 0];

  // Rebase block coordinates so they start at (0,0,0).
  if (foundAny) {
    for (const b of outBlocks) {
      b.pos = [b.pos[0] - minX, b.pos[1] - minY, b.pos[2] - minZ];
    }
    for (const e of outEntities) {
      e.pos = [e.pos[0] - minX, e.pos[1] - minY, e.pos[2] - minZ];
      e.blockPos = [e.blockPos[0] - minX, e.blockPos[1] - minY, e.blockPos[2] - minZ];
    }
  }

  return {
    size,
    palette: outPalette,
    blocks: outBlocks,
    entities: outEntities,
    dataVersion,
    sourceFormat: 'litematic',
  };
}

// ---------------------------------------------------------------------------
// bit-unpacking helpers
// ---------------------------------------------------------------------------

function bitLength(n: number): number {
  if (n <= 0) return 0;
  return 32 - Math.clz32(n);
}

function unpack(longs: bigint[], index: number, bitsPerBlock: number, mask: bigint): number {
  const bitOffset = index * bitsPerBlock;
  const startLong = Math.floor(bitOffset / 64);
  const startBit = BigInt(bitOffset % 64);
  if (startLong >= longs.length) return 0;

  let val = longs[startLong]! >> startBit;
  if (startBit + BigInt(bitsPerBlock) > 64n && startLong + 1 < longs.length) {
    val |= longs[startLong + 1]! << (64n - startBit);
  }
  return Number(val & mask);
}

function findAirIndex(palette: StandardPalette[]): number {
  for (let i = 0; i < palette.length; i++) {
    if (palette[i]!.Name === 'minecraft:air') return i;
  }
  return -1;
}

function canonicalKey(name: string, properties: Record<string, string>): string {
  const keys = Object.keys(properties);
  if (keys.length === 0) return name;
  keys.sort();
  const parts = keys.map((k) => `${k}=${properties[k]}`);
  return `${name}[${parts.join(',')}]`;
}
