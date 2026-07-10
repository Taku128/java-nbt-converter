/**
 * vanilla structure NBT の passthrough 変換テスト (fixture ゼロだった経路)。
 */
import { test } from "node:test";
import { strict as assert } from "node:assert";

import { convertBuffer } from "../dist/index.js";
import { T } from "./tools/nbt-writer.mjs";
import { buildStructureNbt } from "./tools/fixtures.mjs";
import { readStructure } from "./tools/read-structure.mjs";

test("structure NBT: ブロック・state・TE nbt・DataVersion が保持される", async () => {
  const bytes = buildStructureNbt({
    size: [2, 1, 1],
    palette: [
      { Name: "minecraft:stone" },
      { Name: "minecraft:chest", Properties: { facing: "south", type: "single", waterlogged: "false" } },
    ],
    blocks: [
      { pos: [0, 0, 0], state: 0 },
      { pos: [1, 0, 0], state: 1, nbt: { id: T.string("minecraft:chest"), Items: T.list([]) } },
    ],
    dataVersion: 3700,
  });
  const out = await convertBuffer(bytes);
  assert.equal(out.format, "structure");
  assert.deepEqual(out.size, [2, 1, 1]);

  const st = readStructure(out.nbt);
  assert.equal(st.dataVersion, 3700);
  assert.equal(st.blocks.get("0,0,0"), "minecraft:stone");
  assert.equal(
    st.blocks.get("1,0,0"),
    "minecraft:chest[facing=south,type=single,waterlogged=false]",
  );
  const nbt = st.nbtByPos.get("1,0,0");
  assert.equal(nbt?.id, "minecraft:chest");
});
