/**
 * Content-based format detection for Java schematic files.
 *
 * Rather than trusting the file extension, we read the top-level NBT keys
 * and dispatch on their presence. Same approach as go-bedrock-nbt-api's
 * sniffer.go.
 */

import { inflateSync, gunzipSync } from 'fflate';
import type { JavaSchematicFormat } from './types.js';

export type DetectedFormat =
  | JavaSchematicFormat
  | 'bedrock-mcstructure'
  | 'unknown';

export interface SniffResult {
  format: DetectedFormat;
  /** Gzip/zlib-decompressed raw NBT bytes. */
  raw: Uint8Array;
  /** Root compound name (usually "" or "Schematic"). */
  rootName: string;
  /** Top-level child tag names. */
  rootKeys: Set<string>;
}

export function sniffFormat(buffer: Uint8Array): SniffResult {
  const raw = decompress(buffer);
  const info = scanRootKeys(raw);
  const rootName = info?.rootName ?? '';
  const rootKeys = info?.keys ?? new Set<string>();

  const format = classify(rootName, rootKeys);
  return { format, raw, rootName, rootKeys };
}

function classify(rootName: string, keys: Set<string>): DetectedFormat {
  if (keys.has('Metadata') && keys.has('Regions')) return 'litematic';

  if (rootName === 'Schematic') {
    // Sponge v2 has BlockData + Palette; classic MCEdit has Blocks + Data.
    if (keys.has('BlockData') || keys.has('Palette')) return 'schem';
    if (keys.has('Blocks') && keys.has('Data')) return 'schematic';
  }

  // Sponge v3 wraps content inside a "Schematic" compound child.
  if (keys.has('Schematic')) return 'schem';

  if (keys.has('size') && keys.has('blocks') && keys.has('palette')) {
    return 'structure';
  }

  if (keys.has('structure') && keys.has('format_version')) {
    return 'bedrock-mcstructure';
  }

  return 'unknown';
}

function decompress(buf: Uint8Array): Uint8Array {
  if (buf.length < 2) return buf;
  const b0 = buf[0]!;
  const b1 = buf[1]!;
  if (b0 === 0x1f && b1 === 0x8b) return gunzipSync(buf);
  if (b0 === 0x78 && (b1 === 0x01 || b1 === 0x9c || b1 === 0xda)) {
    return inflateSync(buf);
  }
  return buf;
}

/** Lightweight cursor-based NBT scanner. Reads only root-level names. */
class Cursor {
  pos = 0;
  view: DataView;
  decoder = new TextDecoder('utf-8');
  constructor(public data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }
  byte(): number | null {
    if (this.pos + 1 > this.data.length) return null;
    return this.view.getUint8(this.pos++);
  }
  int32(): number | null {
    if (this.pos + 4 > this.data.length) return null;
    const v = this.view.getInt32(this.pos, false);
    this.pos += 4;
    return v;
  }
  ushort(): number | null {
    if (this.pos + 2 > this.data.length) return null;
    const v = this.view.getUint16(this.pos, false);
    this.pos += 2;
    return v;
  }
  str(): string | null {
    const len = this.ushort();
    if (len === null) return null;
    if (this.pos + len > this.data.length) return null;
    const s = this.decoder.decode(
      new Uint8Array(this.data.buffer, this.data.byteOffset + this.pos, len),
    );
    this.pos += len;
    return s;
  }
  skip(n: number): boolean {
    if (n < 0 || this.pos + n > this.data.length) return false;
    this.pos += n;
    return true;
  }
}

function scanRootKeys(data: Uint8Array): { rootName: string; keys: Set<string> } | null {
  const c = new Cursor(data);
  const tagId = c.byte();
  if (tagId !== 10) return null;
  const rootName = c.str();
  if (rootName === null) return null;

  const keys = new Set<string>();
  while (c.pos < data.length) {
    const childId = c.byte();
    if (childId === null || childId === 0) break;
    const name = c.str();
    if (name === null) break;
    keys.add(name);
    if (!skipPayload(c, childId)) break;
  }
  return { rootName, keys };
}

function skipPayload(c: Cursor, tagId: number): boolean {
  switch (tagId) {
    case 1: return c.skip(1);
    case 2: return c.skip(2);
    case 3: return c.skip(4);
    case 4: return c.skip(8);
    case 5: return c.skip(4);
    case 6: return c.skip(8);
    case 7: {
      const len = c.int32();
      return len !== null && c.skip(len);
    }
    case 8: {
      const len = c.ushort();
      return len !== null && c.skip(len);
    }
    case 9: {
      const sub = c.byte();
      const len = c.int32();
      if (sub === null || len === null) return false;
      for (let i = 0; i < len; i++) {
        if (!skipPayload(c, sub)) return false;
      }
      return true;
    }
    case 10: {
      while (c.pos < c.data.length) {
        const sub = c.byte();
        if (sub === null) return false;
        if (sub === 0) return true;
        const nameLen = c.ushort();
        if (nameLen === null) return false;
        if (!c.skip(nameLen)) return false;
        if (!skipPayload(c, sub)) return false;
      }
      return false;
    }
    case 11: {
      const len = c.int32();
      return len !== null && c.skip(len * 4);
    }
    case 12: {
      const len = c.int32();
      return len !== null && c.skip(len * 8);
    }
    default:
      return false;
  }
}
