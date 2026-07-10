/**
 * litematic 変換のエッジケース群。ground truth は litematica 仕様
 * (負サイズ = bbox min アンカー、BlockStates は min corner から y,z,x 順)
 * から導出しており、パーサの実装には依存しない。
 */
import { test } from "node:test";
import { strict as assert } from "node:assert";

import { convertBuffer } from "../dist/index.js";
import { buildLitematic } from "./tools/fixtures.mjs";
import { readStructure } from "./tools/read-structure.mjs";

const AIR = { Name: "minecraft:air" };
const STONE = { Name: "minecraft:stone" };
const REDSTONE = { Name: "minecraft:redstone_block" };
const LEVER = { Name: "minecraft:lever", Properties: { face: "wall", facing: "north", powered: "false" } };

test("負サイズ region: bbox min アンカーで上下反転しない (2026-06-12 修正の回帰テスト)", async () => {
  // Position=[2,5,2], Size=[3,-4,3] → bbox min = [2, 5+(-4+1), 2] = [2,2,2]。
  // BlockStates の local (0,0,0) は bbox min = world (2,2,2) に、
  // local (2,3,2) は world (4,5,4) に対応する (Position から逆方向に数えない)。
  const bytes = buildLitematic([
    {
      name: "main",
      position: [2, 5, 2],
      size: [3, -4, 3],
      palette: [AIR, STONE, REDSTONE],
      indexAt: (x, y, z) => {
        if (x === 0 && y === 0 && z === 0) return 2; // redstone = bbox min
        if (x === 2 && y === 3 && z === 2) return 1; // stone = bbox max
        return 0;
      },
    },
  ]);
  const out = await convertBuffer(bytes);
  assert.equal(out.format, "litematic");
  assert.deepEqual(out.size, [3, 4, 3]);

  const st = readStructure(out.nbt);
  // 単一 region は bbox min が (0,0,0) にリベースされる
  assert.equal(st.blocks.get("0,0,0"), "minecraft:redstone_block");
  assert.equal(st.blocks.get("2,3,2"), "minecraft:stone");
  assert.equal(st.blocks.size, 2);
});

test("負サイズ region: TileEntity も bbox min アンカー", async () => {
  const { T } = await import("./tools/nbt-writer.mjs");
  const bytes = buildLitematic([
    {
      name: "main",
      position: [0, 3, 0],
      size: [1, -4, 1], // bbox min y = 3 + (-4+1) = 0
      palette: [AIR, { Name: "minecraft:chest", Properties: { facing: "north", type: "single", waterlogged: "false" } }],
      indexAt: (x, y) => (y === 1 ? 1 : 0),
      tileEntities: [{ x: 0, y: 1, z: 0, extra: { Items: T.list([]) } }],
    },
  ]);
  const st = readStructure((await convertBuffer(bytes)).nbt);
  assert.ok(st.blocks.get("0,1,0")?.startsWith("minecraft:chest"));
  const nbt = st.nbtByPos.get("0,1,0");
  assert.ok(nbt, "TileEntity が bbox min 基準の座標に付いていない");
  assert.ok(Array.isArray(nbt.Items), "TE の実データが保持されていない");
  // vanilla structure の block nbt は座標を持たない (Go 版と同挙動)
  assert.equal(nbt.x, undefined);
  assert.equal(nbt.y, undefined);
  assert.equal(nbt.z, undefined);
});

test("multi-region: palette 統合と座標リベース", async () => {
  const bytes = buildLitematic([
    {
      name: "A",
      position: [0, 0, 0],
      size: [2, 1, 1],
      palette: [AIR, STONE],
      indexAt: (x) => (x === 0 ? 1 : 0),
    },
    {
      name: "B",
      position: [3, 0, 0],
      size: [2, 1, 1],
      palette: [AIR, STONE, LEVER], // stone は region A と重複 → 統合される
      indexAt: (x) => (x === 0 ? 1 : 2),
    },
  ]);
  const out = await convertBuffer(bytes);
  assert.deepEqual(out.size, [5, 1, 1]); // enclosing bbox [0..5)
  // palette は air + stone + lever の 3 件に dedup される (重複 stone が統合)
  assert.equal(out.paletteCount, 3);

  const st = readStructure(out.nbt);
  assert.equal(st.blocks.get("0,0,0"), "minecraft:stone");
  assert.equal(st.blocks.get("3,0,0"), "minecraft:stone");
  assert.equal(st.blocks.get("4,0,0"), "minecraft:lever[face=wall,facing=north,powered=false]");
  assert.equal(st.blocks.size, 3);
});

test("サイズ 0 の region はスキップされ、他の region は変換される", async () => {
  const bytes = buildLitematic([
    {
      name: "empty",
      position: [10, 10, 10],
      size: [0, 2, 2],
      palette: [AIR, STONE],
    },
    {
      name: "main",
      position: [0, 0, 0],
      size: [1, 1, 1],
      palette: [AIR, STONE],
      indexAt: () => 1,
    },
  ]);
  const out = await convertBuffer(bytes);
  assert.deepEqual(out.size, [1, 1, 1]); // empty region は bbox に寄与しない
  assert.equal(out.blockCount, 1);
});

test("region 内の palette 重複エントリは 1 つに統合される", async () => {
  const bytes = buildLitematic([
    {
      name: "main",
      position: [0, 0, 0],
      size: [2, 1, 1],
      palette: [AIR, STONE, STONE], // 同一 state が 2 エントリ
      indexAt: (x) => (x === 0 ? 1 : 2),
    },
  ]);
  const out = await convertBuffer(bytes);
  assert.equal(out.paletteCount, 2); // air + stone
  const st = readStructure(out.nbt);
  assert.equal(st.blocks.get("0,0,0"), "minecraft:stone");
  assert.equal(st.blocks.get("1,0,0"), "minecraft:stone");
});

test("DoS: 細工の巨大 Size は合計体積上限で拒否される (ブロックループ前)", async () => {
  const bytes = buildLitematic([
    {
      name: "evil",
      position: [0, 0, 0],
      size: [2000, 2000, 2000],
      palette: [AIR, STONE],
      blockStatesOverride: [0n], // データはほぼ空のまま Size だけ巨大
    },
  ]);
  await assert.rejects(convertBuffer(bytes), /total region volume .* exceeds/);
});

test("DoS: 小さな region の大量並びも合計体積で拒否される (multi-region 迂回の防止)", async () => {
  // 1 region あたりは上限内でも、合計で 512^3 を超えれば Size ヘッダの事前検査で
  // 即座に弾かれる (どの region のブロックループにも入らない = テストも即時)。
  const regions = Array.from({ length: 9 }, (_, i) => ({
    name: `r${i}`,
    position: [i * 600, 0, 0],
    size: [512, 512, 64], // 各 1677 万 × 9 = 1.5 億 > 上限
    palette: [AIR, STONE],
    blockStatesOverride: [0n],
  }));
  await assert.rejects(convertBuffer(buildLitematic(regions)), /total region volume .* exceeds/);
});

test("DoS: gzip 爆弾は ISIZE の事前検査で展開前に拒否される", async () => {
  const bytes = buildLitematic([
    {
      name: "main",
      position: [0, 0, 0],
      size: [1, 1, 1],
      palette: [AIR, STONE],
      indexAt: () => 1,
    },
  ]);
  // gzip footer の ISIZE (展開後サイズ) を偽装して巨大宣言にする
  const forged = new Uint8Array(bytes);
  const dv = new DataView(forged.buffer, forged.byteOffset + forged.length - 4, 4);
  dv.setUint32(0, 0xf0000000, true);
  await assert.rejects(convertBuffer(forged), /decompressed size .* exceeds/);
});

test("受理側境界: 100 万ブロック級の正規 litematic は上限に引っかからない", async () => {
  // false positive ガード: 128×64×128 (= 104 万) の全 stone region が変換できること
  const [w, h, l] = [128, 64, 128];
  const bytes = buildLitematic([
    {
      name: "big",
      position: [0, 0, 0],
      size: [w, h, l],
      palette: [AIR, STONE],
      indexAt: () => 1,
    },
  ]);
  const out = await convertBuffer(bytes);
  assert.equal(out.blockCount, w * h * l);
  assert.deepEqual(out.size, [w, h, l]);
});

test("bit-pack が long 境界を跨ぐ palette (3 bits/block) を正しく unpack する", async () => {
  // palette 5 エントリ → 3 bits/block。3x3x3 = 27 エントリで index 21 が
  // bit 63..65 に載り、litematica 固有の「エントリが long を跨ぐ」詰め方を踏む。
  const P = [
    AIR,
    STONE,
    REDSTONE,
    { Name: "minecraft:glass" },
    { Name: "minecraft:oak_planks" },
  ];
  // linear index = y*9 + z*3 + x → palette index = (linear % 4) + 1 (air を使わない)
  const bytes = buildLitematic([
    {
      name: "main",
      position: [0, 0, 0],
      size: [3, 3, 3],
      palette: P,
      indexAt: (x, y, z) => ((y * 9 + z * 3 + x) % 4) + 1,
    },
  ]);
  const out = await convertBuffer(bytes);
  assert.equal(out.blockCount, 27);
  const st = readStructure(out.nbt);
  // 全 27 ブロックを仕様導出の期待値と突き合わせ (跨ぎ index 21 = (0,2,1) を含む)
  for (let y = 0; y < 3; y++)
    for (let z = 0; z < 3; z++)
      for (let x = 0; x < 3; x++) {
        const expected = P[((y * 9 + z * 3 + x) % 4) + 1].Name;
        assert.equal(st.blocks.get(`${x},${y},${z}`), expected, `mismatch at ${x},${y},${z}`);
      }
});

test("litematic の Entities が位置リベース込みで保持される", async () => {
  const { T } = await import("./tools/nbt-writer.mjs");
  const bytes = buildLitematic([
    {
      name: "main",
      position: [2, 5, 2],
      size: [3, -4, 3], // bbox min = [2,2,2] — エンティティも min アンカー
      palette: [AIR, STONE],
      indexAt: () => 1,
      entities: [{ pos: [0.5, 1.0, 2.5], id: "minecraft:pig", extra: { CustomName: T.string("ぶた") } }],
    },
  ]);
  const st = readStructure((await convertBuffer(bytes)).nbt);
  assert.equal(st.entities.length, 1);
  const ent = st.entities[0];
  assert.deepEqual(ent.pos, [0.5, 1.0, 2.5]); // 単一 region はリベース後も local 座標のまま
  assert.equal(ent.nbt.id, "minecraft:pig");
  assert.equal(ent.nbt.CustomName, "ぶた");
});

test("DoS: Size に対して BlockStates が短すぎるファイルは拒否される", async () => {
  const bytes = buildLitematic([
    {
      name: "corrupt",
      position: [0, 0, 0],
      size: [64, 64, 64], // 体積 262144 は上限内
      palette: [AIR, STONE],
      blockStatesOverride: [0n], // 2bit × 32 エントリ分しかない
    },
  ]);
  await assert.rejects(convertBuffer(bytes), /BlockStates holds/);
});
