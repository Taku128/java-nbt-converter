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
  assert.ok(st.nbtByPos.has("0,1,0"), "TileEntity が bbox min 基準の座標に付いていない");
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

test("DoS: 細工の巨大 Size は体積上限で拒否される", async () => {
  const bytes = buildLitematic([
    {
      name: "evil",
      position: [0, 0, 0],
      size: [2000, 2000, 2000],
      palette: [AIR, STONE],
      blockStatesOverride: [0n], // データはほぼ空のまま Size だけ巨大
    },
  ]);
  await assert.rejects(convertBuffer(bytes), /exceeds the supported maximum/);
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
