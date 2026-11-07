import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig(({ mode }) => ({
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: mode !== 'baseline',
    lib: {
      entry: fileURLToPath(
        new URL(
          mode === 'baseline' ? './legacy-main.tsx' : './main.tsx',
          import.meta.url,
        ),
      ),
      name: 'EffectReport',
      formats: ['iife'],
      fileName: () =>
        mode === 'baseline' ? 'viewer-baseline.js' : 'viewer.js',
      cssFileName: mode === 'baseline' ? 'viewer-baseline' : 'viewer',
    },
  },
}))
