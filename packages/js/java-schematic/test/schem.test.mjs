/**
 * Sponge .schem v2/v3 の変換テスト。v3 は BlockEntities/Entities の実データが
 * Data compound にネストされる仕様 (SpongePowered/Schematic-Specification v3) で、
 * vanilla structure 形式 (実データ直下 + 小文字 id) への展開を検証する。
 */
import { test } from "node:test";
import { strict as assert } from "node:assert";

import { convertBuffer } from "../dist/index.js";
import { T } from "./tools/nbt-writer.mjs";
import { buildSchemV2, buildSchemV3 } from "./tools/fixtures.mjs";
import { readStructure } from "./tools/read-structure.mjs";

// 2x1x2: index i → (x = i%2, z = (i/2)%2, y = 0)
const LAYOUT = {
  width: 2,
  height: 1,
  length: 2,
  palette: { "minecraft:air": 0, "minecraft:chest[facing=north]": 1 },
  indices: [1, 0, 0, 1], // chest @ (0,0,0) と (1,0,1)
};

const CHEST_ITEMS = T.list([
  T.compound({ id: T.string("minecraft:redstone"), Count: T.byte(3), Slot: T.byte(0) }),
]);

test("v2: ブロック配置と state property のパース", async () => {
  const out = await convertBuffer(buildSchemV2({ ...LAYOUT }));
  assert.equal(out.format, "schem");
  assert.deepEqual(out.size, [2, 1, 2]);
  const st = readStructure(out.nbt);
  assert.equal(st.blocks.get("0,0,0"), "minecraft:chest[facing=north]");
  assert.equal(st.blocks.get("1,0,1"), "minecraft:chest[facing=north]");
  assert.equal(st.blocks.size, 2);
});

test("v2: BlockEntities は実データがインライン (従来挙動を維持)", async () => {
  const out = await convertBuffer(
    buildSchemV2({
      ...LAYOUT,
      blockEntities: [{ pos: [0, 0, 0], id: "minecraft:chest", extra: { Items: CHEST_ITEMS } }],
    }),
  );
  const st = readStructure(out.nbt);
  const nbt = st.nbtByPos.get("0,0,0");
  assert.ok(nbt, "TE が付いていない");
  assert.ok(Array.isArray(nbt.Items), "インラインの Items が保持されていない");
  assert.equal(nbt.Id, "minecraft:chest"); // v2 はエントリ素通し (Id 大文字のまま)
});

test("v3: BlockEntities の Data ネストを展開し小文字 id を付与する", async () => {
  const out = await convertBuffer(
    buildSchemV3({
      ...LAYOUT,
      blockEntities: [{ pos: [0, 0, 0], id: "minecraft:chest", data: { Items: CHEST_ITEMS } }],
    }),
  );
  const st = readStructure(out.nbt);
  const nbt = st.nbtByPos.get("0,0,0");
  assert.ok(nbt, "TE が付いていない");
  assert.equal(nbt.id, "minecraft:chest", "小文字 id が無い");
  assert.ok(Array.isArray(nbt.Items), "Data の中身 (Items) が直下に展開されていない");
  assert.equal(nbt.Data, undefined, "Data ラッパーが残っている");
  assert.equal(nbt.Pos, undefined, "Pos が混入している");
  assert.equal(nbt.Id, undefined, "大文字 Id が残っている");
});

test("v3: Entities も Data 展開 + 小文字 id", async () => {
  const out = await convertBuffer(
    buildSchemV3({
      ...LAYOUT,
      entities: [
        { pos: [0.5, 0.0, 1.5], id: "minecraft:pig", data: { CustomName: T.string("ぶた") } },
      ],
    }),
  );
  const st = readStructure(out.nbt);
  assert.equal(st.entities.length, 1);
  const ent = st.entities[0];
  assert.deepEqual(ent.pos, [0.5, 0.0, 1.5]);
  assert.equal(ent.nbt.id, "minecraft:pig");
  assert.equal(ent.nbt.CustomName, "ぶた");
  assert.equal(ent.nbt.Data, undefined);
});

test("v3: ブロック配置は v2 と同じ座標規約", async () => {
  const out = await convertBuffer(buildSchemV3({ ...LAYOUT }));
  const st = readStructure(out.nbt);
  assert.equal(st.blocks.get("0,0,0"), "minecraft:chest[facing=north]");
  assert.equal(st.blocks.get("1,0,1"), "minecraft:chest[facing=north]");
});

test("DoS: 細工の巨大 palette index は拒否される", async () => {
  const bytes = buildSchemV2({
    width: 1,
    height: 1,
    length: 1,
    palette: { "minecraft:air": 0, "minecraft:stone": 1_048_576 },
    indices: [0],
  });
  await assert.rejects(convertBuffer(bytes), /palette index/);
});

test("varint の複数バイト経路: palette index 200 (2 バイト) を正しく decode する", async () => {
  // index ≥ 128 で varint が 2 バイトになる。中〜大型の WorldEdit コピーで普通に発生。
  const out = await convertBuffer(
    buildSchemV2({
      width: 1,
      height: 1,
      length: 1,
      palette: { "minecraft:air": 0, "minecraft:diamond_block": 200 },
      indices: [200],
    }),
  );
  const st = readStructure(out.nbt);
  assert.equal(st.blocks.get("0,0,0"), "minecraft:diamond_block");
  assert.equal(st.blocks.size, 1);
});

test("DataVersion がソースから引き継がれる", async () => {
  const out = await convertBuffer(buildSchemV2({ ...LAYOUT, dataVersion: 3700 }));
  const st = readStructure(out.nbt);
  assert.equal(st.dataVersion, 3700);
});
