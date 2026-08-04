import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  unbundle: false,
  format: ['esm'],
  dts: false,
  platform: 'node',
  target: 'node22',
  clean: true,
  sourcemap: false,
  minify: true,
  exports: true,
  deps: {
    alwaysBundle: ['@actions/core', '@actions/glob', '@bunny.net/storage-sdk', 'p-queue'],
    onlyBundle: false,
  },
});
