import { fileURLToPath } from 'node:url';
import { build } from 'vite';

// Standalone distribution only. SMALLTABLE's iframe keeps its existing Vite entry.
const coreRoot = fileURLToPath(new URL('../packages/dndroll-core/', import.meta.url));
await build({
  configFile: false,
  root: coreRoot,
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'es2022',
    sourcemap: true,
    lib: {
      entry: fileURLToPath(new URL('../packages/dndroll-core/src/index.ts', import.meta.url)),
      name: 'DndRoll',
      formats: ['iife'],
      fileName: () => 'dndroll.browser.js',
    },
  },
});
