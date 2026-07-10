/**
 * 合成 fixture ビルダ群。各フォーマットの仕様 (litematica の負サイズ =
 * bbox min アンカー、Sponge v2/v3 の構造差) から決定的にバイト列を組み立てる。
 * ground truth (期待されるブロック配置) はテスト側でフォーマット仕様から
 * 独立に導出する — パーサのロジックを写して自己言及にしないこと。
 */
import { gzipSync } from "fflate";

import { T, serializeRoot } from "./nbt-writer.mjs";

// ---------------------------------------------------------------------------
// litematic
// ---------------------------------------------------------------------------

function bitLength(n) {
  return n <= 0 ? 0 : 32 - Math.clz32(n);
}

/** litematica と同じ詰め方 (エントリが long 境界を跨ぐ) で bit-pack する */
export function packBlockStates(indices, paletteCount) {
  const bits = Math.max(2, bitLength(paletteCount - 1));
  const longs = new Array(Math.ceil((indices.length * bits) / 64) || 1).fill(0n);
  indices.forEach((v, i) => {
    const off = i * bits;
    const li = Math.floor(off / 64);
    const sb = BigInt(off % 64);
    longs[li] = BigInt.asUintN(64, longs[li] | (BigInt(v) << sb));
    if (sb + BigInt(bits) > 64n && li + 1 < longs.length) {
      longs[li + 1] = BigInt.asUintN(64, longs[li + 1] | (BigInt(v) >> (64n - sb)));
    }
  });
  return longs.map((l) => BigInt.asIntN(64, l));
}

const xyzTag = ([x, y, z]) => T.compound({ x: T.int(x), y: T.int(y), z: T.int(z) });

const paletteEntryTag = ({ Name, Properties }) => {
  const entry = { Name: T.string(Name) };
  if (Properties && Object.keys(Properties).length) {
    entry.Properties = T.compound(
      Object.fromEntries(Object.entries(Properties).map(([k, v]) => [k, T.string(v)])),
    );
  }
  return T.compound(entry);
};

/**
 * regions: {
 *   name, position: [x,y,z], size: [sx,sy,sz] (負可),
 *   palette: [{Name, Properties?}],   // index 0 は air を推奨 (litematica 慣行)
 *   indexAt(x,y,z): local 座標 (0..|size|) → local palette index,
 *   blockStatesOverride?: bigint[],   // DoS テスト用に生 long 配列を差し替える
 *   tileEntities?: [{x,y,z, extra: Record<string,Tag>}],
 * }
 */
export function buildLitematic(regions, { dataVersion = 3953 } = {}) {
  const regionsObj = {};
  for (const r of regions) {
    const [ax, ay, az] = r.size.map(Math.abs);
    let longs = r.blockStatesOverride;
    if (!longs) {
      // override 指定時 (DoS テストの巨大 Size) は index 展開自体をスキップする
      const indices = [];
      for (let y = 0; y < ay; y++)
        for (let z = 0; z < az; z++)
          for (let x = 0; x < ax; x++) indices.push(r.indexAt ? r.indexAt(x, y, z) : 0);
      longs = packBlockStates(indices, r.palette.length);
    }
    regionsObj[r.name] = T.compound({
      Position: xyzTag(r.position),
      Size: xyzTag(r.size),
      BlockStatePalette: T.list(r.palette.map(paletteEntryTag)),
      BlockStates: T.longArray(longs),
      TileEntities: T.list(
        (r.tileEntities ?? []).map((te) =>
          T.compound({ x: T.int(te.x), y: T.int(te.y), z: T.int(te.z), ...(te.extra ?? {}) }),
        ),
      ),
      Entities: T.list([]),
      PendingBlockTicks: T.list([]),
      PendingFluidTicks: T.list([]),
    });
  }
  const root = T.compound({
    MinecraftDataVersion: T.int(dataVersion),
    Version: T.int(6),
    Metadata: T.compound({
      Name: T.string("fixture"),
      Author: T.string("test"),
      TotalBlocks: T.int(0),
      EnclosingSize: xyzTag([1, 1, 1]),
    }),
    Regions: T.compound(regionsObj),
  });
  return gzipSync(serializeRoot("", root));
}

// ---------------------------------------------------------------------------
// Sponge .schem (v2 / v3)
// ---------------------------------------------------------------------------

export function varintEncode(indices) {
  const out = [];
  for (let v of indices) {
    for (;;) {
      if ((v & ~0x7f) === 0) {
        out.push(v);
        break;
      }
      out.push((v & 0x7f) | 0x80);
      v >>>= 7;
    }
  }
  return out;
}

const paletteCompoundTag = (palette) =>
  T.compound(Object.fromEntries(Object.entries(palette).map(([state, idx]) => [state, T.int(idx)])));

/**
 * Sponge v2: root 名 "Schematic"、フィールドはトップレベル。
 * blockEntities: [{pos:[x,y,z], id, extra: Record<string,Tag>}] — v2 は実データがインライン。
 */
export function buildSchemV2({ width, height, length, palette, indices, blockEntities = [], dataVersion = 3953 }) {
  const root = T.compound({
    Version: T.int(2),
    DataVersion: T.int(dataVersion),
    Width: T.short(width),
    Height: T.short(height),
    Length: T.short(length),
    Offset: T.intArray([0, 0, 0]),
    Palette: paletteCompoundTag(palette),
    PaletteMax: T.int(Object.keys(palette).length),
    BlockData: T.byteArray(varintEncode(indices)),
    BlockEntities: T.list(
      blockEntities.map((be) =>
        T.compound({ Pos: T.intArray(be.pos), Id: T.string(be.id), ...(be.extra ?? {}) }),
      ),
    ),
  });
  return gzipSync(serializeRoot("Schematic", root));
}

/**
 * Sponge v3: 無名 root の "Schematic" 子に包まれ、Palette/Data/BlockEntities は
 * Blocks 配下。BlockEntities/Entities は {Pos, Id, Data} で実データが Data にネスト。
 */
export function buildSchemV3({
  width,
  height,
  length,
  palette,
  indices,
  blockEntities = [],
  entities = [],
  dataVersion = 3953,
}) {
  const inner = T.compound({
    Version: T.int(3),
    DataVersion: T.int(dataVersion),
    Width: T.short(width),
    Height: T.short(height),
    Length: T.short(length),
    Offset: T.intArray([0, 0, 0]),
    Blocks: T.compound({
      Palette: paletteCompoundTag(palette),
      Data: T.byteArray(varintEncode(indices)),
      BlockEntities: T.list(
        blockEntities.map((be) =>
          T.compound({ Pos: T.intArray(be.pos), Id: T.string(be.id), Data: T.compound(be.data ?? {}) }),
        ),
      ),
    }),
    Entities: T.list(
      entities.map((e) =>
        T.compound({
          Pos: T.list(e.pos.map(T.double)),
          Id: T.string(e.id),
          Data: T.compound(e.data ?? {}),
        }),
      ),
    ),
  });
  return gzipSync(serializeRoot("", T.compound({ Schematic: inner })));
}

// ---------------------------------------------------------------------------
// vanilla structure NBT (passthrough)
// ---------------------------------------------------------------------------

/** blocks: [{pos:[x,y,z], state, nbt?: Record<string,Tag>}] */
export function buildStructureNbt({ size, palette, blocks, dataVersion = 3953 }) {
  const root = T.compound({
    DataVersion: T.int(dataVersion),
    size: T.list(size.map(T.int)),
    palette: T.list(palette.map(paletteEntryTag)),
    blocks: T.list(
      blocks.map((b) => {
        const entry = { pos: T.list(b.pos.map(T.int)), state: T.int(b.state) };
        if (b.nbt) entry.nbt = T.compound(b.nbt);
        return T.compound(entry);
      }),
    ),
    entities: T.list([]),
  });
  return gzipSync(serializeRoot("", root));
}
