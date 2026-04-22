/**
 * Shared intermediate representation used by all parsers.
 * Each format-specific parser produces a StandardFormat, and the encoder
 * converts it to a gzipped Java Structure NBT buffer.
 */

export type JavaNbtValue = unknown;

export interface StandardPalette {
  Name: string;
  Properties?: Record<string, string>;
}

export interface StandardBlock {
  /** Integer block coordinate in structure-local space. */
  pos: [number, number, number];
  /** Palette index. */
  state: number;
  /** Optional tile-entity NBT compound, preserved verbatim. */
  nbt?: JavaNbtValue;
}

export interface StandardEntity {
  /** Absolute world position (floating-point). */
  pos: [number, number, number];
  /** Block-aligned coordinate. */
  blockPos: [number, number, number];
  /** Full entity NBT compound. */
  nbt: JavaNbtValue;
}

export interface StandardFormat {
  size: [number, number, number];
  palette: StandardPalette[];
  blocks: StandardBlock[];
  entities: StandardEntity[];
  dataVersion: number;
  /** Source format identifier, for debugging/logging. */
  sourceFormat: JavaSchematicFormat;
}

export type JavaSchematicFormat =
  | 'litematic'
  | 'schem'
  | 'schematic'
  | 'structure';

export interface ConvertResult {
  /** Gzipped Java Structure NBT buffer. */
  nbt: Uint8Array;
  /** [x, y, z] dimensions. */
  size: [number, number, number];
  /** Number of placed blocks in output. */
  blockCount: number;
  /** Unique Java block states used. */
  paletteCount: number;
  /** Detected source format. */
  format: JavaSchematicFormat;
}
