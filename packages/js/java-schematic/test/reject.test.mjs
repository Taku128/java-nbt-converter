/**
 * Rejection-path tests: formats we detect but do not convert must fail with
 * descriptive errors, never a TypeError crash.
 *
 * Run: node --test packages/js/java-schematic/test/reject.test.mjs
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { convertBuffer, sniffFormat } from '../dist/index.js';

/** Minimal big-endian NBT writer (enough for test fixtures). */
class NbtWriter {
  constructor(littleEndian = false) {
    this.bytes = [];
    this.le = littleEndian;
  }
  u8(v) {
    this.bytes.push(v & 0xff);
  }
  u16(v) {
    const b = [(v >> 8) & 0xff, v & 0xff];
    this.bytes.push(...(this.le ? b.reverse() : b));
  }
  i32(v) {
    const b = [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
    this.bytes.push(...(this.le ? b.reverse() : b));
  }
  name(s) {
    this.u16(s.length);
    for (const ch of s) this.u8(ch.charCodeAt(0));
  }
  tag(id, s) {
    this.u8(id);
    this.name(s);
  }
  out() {
    return new Uint8Array(this.bytes);
  }
}

/** Classic MCEdit .schematic: root "Schematic" with Blocks + Data byte arrays. */
function classicSchematic() {
  const w = new NbtWriter();
  w.tag(10, 'Schematic');
  w.tag(2, 'Width');
  w.u16(1);
  w.tag(2, 'Height');
  w.u16(1);
  w.tag(2, 'Length');
  w.u16(1);
  w.tag(7, 'Blocks');
  w.i32(1);
  w.u8(1);
  w.tag(7, 'Data');
  w.i32(1);
  w.u8(0);
  w.u8(0); // TAG_End
  return w.out();
}

/** Minimal little-endian Bedrock .mcstructure: format_version + structure. */
function bedrockMcstructure() {
  const w = new NbtWriter(true);
  w.tag(10, '');
  w.tag(3, 'format_version');
  w.i32(1);
  w.tag(10, 'structure');
  w.u8(0); // empty structure compound
  w.u8(0); // TAG_End (root)
  return w.out();
}

test('classic .schematic is rejected with a descriptive error, not a crash', async () => {
  const bytes = classicSchematic();
  assert.equal(sniffFormat(bytes).format, 'schematic');
  await assert.rejects(convertBuffer(bytes), (err) => {
    assert.ok(!(err instanceof TypeError), `crashed with TypeError: ${err.message}`);
    assert.match(err.message, /MCEdit .schematic/);
    assert.match(err.message, /\.schem/);
    return true;
  });
});

test('little-endian Bedrock .mcstructure is detected and routed to @taku128/mcstructure', async () => {
  const bytes = bedrockMcstructure();
  assert.equal(sniffFormat(bytes).format, 'bedrock-mcstructure');
  await assert.rejects(convertBuffer(bytes), /@taku128\/mcstructure/);
});

test('unknown input fails with a printable, bounded error message', async () => {
  // Big-endian garbage: a compound whose child name length points at binary junk.
  const junk = new Uint8Array(300);
  junk[0] = 10; // TAG_Compound, root name len 0
  junk[3] = 8; // TAG_String child
  junk[4] = 0xff; // name length 0xff20 -> way past the buffer in BE
  junk[5] = 0x20;
  for (let i = 6; i < junk.length; i++) junk[i] = i % 7 === 0 ? 0x01 : 0xe0;
  await assert.rejects(convertBuffer(junk), (err) => {
    assert.match(err.message, /Could not identify NBT format/);
    assert.ok(err.message.length < 500, `message too long: ${err.message.length} chars`);
    // eslint-disable-next-line no-control-regex
    assert.ok(!/[\x00-\x08\x0e-\x1f]/.test(err.message), 'control characters leaked into message');
    return true;
  });
});
