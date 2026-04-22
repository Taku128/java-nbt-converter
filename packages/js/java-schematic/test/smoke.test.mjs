/**
 * Smoke test: convert a real .litematic file via the built dist and
 * verify basic output shape.
 *
 * Run: node packages/js/java-schematic/test/smoke.test.mjs
 */
import { convertFile } from '../dist/node.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { strict as assert } from 'node:assert';
import { gunzipSync } from 'fflate';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, '..', '..', '..', '..', 'test', 'fixtures');

const input = resolve(fixturesDir, 'DoubleSidedGlassElevatorMultipleFloors.litematic');
if (!existsSync(input)) {
  console.error(`Fixture not found: ${input}`);
  process.exit(1);
}

const out = await convertFile(input);

console.log(`format       : ${out.format}`);
console.log(`size         : ${out.size.join(' × ')}`);
console.log(`blocks       : ${out.blockCount}`);
console.log(`palette      : ${out.paletteCount}`);
console.log(`nbt bytes    : ${out.nbt.length}`);

assert.equal(out.format, 'litematic');
assert.ok(out.size[0] > 0 && out.size[1] > 0 && out.size[2] > 0, 'size should be positive');
assert.ok(out.blockCount > 0, 'should have at least one block');
assert.ok(out.paletteCount > 0, 'should have a palette');
assert.ok(out.nbt.length > 0);

// Check that output is valid gzip
const raw = gunzipSync(out.nbt);
assert.ok(raw[0] === 0x0a, 'decompressed output should start with TAG_Compound (0x0a)');

// Compare shape (not byte-for-byte) with the expected Go output
const expectedPath = resolve(fixturesDir, 'expected_litematic.nbt');
if (existsSync(expectedPath)) {
  const expectedGz = readFileSync(expectedPath);
  const expectedRaw = gunzipSync(new Uint8Array(expectedGz));
  console.log(`expected raw bytes: ${expectedRaw.length}`);
  console.log(`actual   raw bytes: ${raw.length}`);
}

console.log('✅ Smoke test passed');
