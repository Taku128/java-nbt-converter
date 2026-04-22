import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    node: 'src/node.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  splitting: false,
  external: ['@taku128/core', 'prismarine-nbt', 'fflate', 'fs', 'node:fs', 'node:fs/promises', 'node:path'],
});
