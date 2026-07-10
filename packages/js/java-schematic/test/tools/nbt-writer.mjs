/**
 * テスト fixture 生成用の最小 big-endian NBT ライタ。
 * タグをプレーンオブジェクトのツリーで表現し、serializeRoot でバイト列化する。
 * 依存ゼロ (gzip は呼び出し側で fflate を使う)。
 */

class Buf {
  constructor() {
    this.bytes = [];
  }
  u8(v) {
    this.bytes.push(v & 0xff);
  }
  i16(v) {
    this.u8(v >> 8);
    this.u8(v);
  }
  i32(v) {
    this.u8(v >> 24);
    this.u8(v >> 16);
    this.u8(v >> 8);
    this.u8(v);
  }
  i64(v) {
    const b = BigInt.asUintN(64, BigInt(v));
    for (let i = 7n; i >= 0n; i--) this.u8(Number((b >> (i * 8n)) & 0xffn));
  }
  f64(v) {
    const dv = new DataView(new ArrayBuffer(8));
    dv.setFloat64(0, v, false);
    for (let i = 0; i < 8; i++) this.u8(dv.getUint8(i));
  }
  str(s) {
    const enc = new TextEncoder().encode(s);
    this.i16(enc.length);
    for (const b of enc) this.u8(b);
  }
  out() {
    return new Uint8Array(this.bytes);
  }
}

export const T = {
  byte: (v) => ({ id: 1, write: (b) => b.u8(v) }),
  short: (v) => ({ id: 2, write: (b) => b.i16(v) }),
  int: (v) => ({ id: 3, write: (b) => b.i32(v) }),
  long: (v) => ({ id: 4, write: (b) => b.i64(v) }),
  double: (v) => ({ id: 6, write: (b) => b.f64(v) }),
  byteArray: (arr) => ({
    id: 7,
    write: (b) => {
      b.i32(arr.length);
      for (const v of arr) b.u8(v);
    },
  }),
  string: (s) => ({ id: 8, write: (b) => b.str(s) }),
  /** items は同一タグ種の配列。空リストは elemId=0 で書く */
  list: (items) => ({
    id: 9,
    write: (b) => {
      b.u8(items.length ? items[0].id : 0);
      b.i32(items.length);
      for (const it of items) it.write(b);
    },
  }),
  compound: (obj) => ({
    id: 10,
    write: (b) => {
      for (const [k, tag] of Object.entries(obj)) {
        b.u8(tag.id);
        b.str(k);
        tag.write(b);
      }
      b.u8(0);
    },
  }),
  intArray: (arr) => ({
    id: 11,
    write: (b) => {
      b.i32(arr.length);
      for (const v of arr) b.i32(v);
    },
  }),
  longArray: (arr) => ({
    id: 12,
    write: (b) => {
      b.i32(arr.length);
      for (const v of arr) b.i64(v);
    },
  }),
};

/** ルート compound を (無名 or 指定名で) シリアライズする */
export function serializeRoot(rootName, compoundTag) {
  const b = new Buf();
  b.u8(10);
  b.str(rootName);
  compoundTag.write(b);
  return b.out();
}
