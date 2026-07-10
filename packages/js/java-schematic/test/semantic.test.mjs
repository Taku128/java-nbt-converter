/**
 * 実 litematic (エレベーター) の JS 変換出力と Go 版 (go-java-nbt-converter) の
 * 期待値出力の semantic 等価テスト。バイト一致は gzip/エンコード表現差で成立
 * しないため、deepslate で両者をパースして 座標→state の全マップを突き合わせる。
 * 旧 smoke.test.mjs の console.log 比較の昇格版 (redtact-com/redtact#14 C7)。
 */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { convertFile } from "../dist/node.js";
import { readStructure } from "./tools/read-structure.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, "..", "..", "..", "..", "test", "fixtures");
const input = resolve(fixturesDir, "DoubleSidedGlassElevatorMultipleFloors.litematic");
const expectedPath = resolve(fixturesDir, "expected_litematic.nbt");

test("エレベーター litematic: JS 出力が Go 期待値と semantic 等価", { skip: !existsSync(input) || !existsSync(expectedPath) }, async () => {
  const out = await convertFile(input);
  const js = readStructure(out.nbt);
  const expected = readStructure(new Uint8Array(readFileSync(expectedPath)));

  assert.deepEqual(js.size, expected.size, "size 不一致");
  assert.equal(js.dataVersion, expected.dataVersion, "DataVersion 不一致");
  assert.equal(js.blocks.size, expected.blocks.size, "ブロック数不一致");

  let mismatches = 0;
  for (const [key, state] of expected.blocks) {
    if (js.blocks.get(key) !== state) {
      mismatches++;
      if (mismatches <= 5) {
        console.error(`mismatch at ${key}: expected ${state}, got ${js.blocks.get(key)}`);
      }
    }
  }
  assert.equal(mismatches, 0, `${mismatches} 箇所で state 不一致`);

  // TileEntity: 位置と nbt 中身 (Items/sign text 等) まで Go 期待値と深比較する
  assert.equal(js.nbtByPos.size, expected.nbtByPos.size, "TileEntity 数不一致");
  for (const [key, expNbt] of expected.nbtByPos) {
    assert.deepEqual(js.nbtByPos.get(key), expNbt, `TileEntity nbt 不一致 at ${key}`);
  }

  assert.deepEqual(js.entities, expected.entities, "entities 不一致");
});
