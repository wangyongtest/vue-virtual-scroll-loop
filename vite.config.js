/// <reference types="vitest/config" />
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'VueVirtualScrollLoop',
      formats: ['es', 'cjs'],
      fileName: (format) => (format === 'es' ? 'index.js' : 'index.cjs'),
    },
    rollupOptions: {
      external: ['vue', 'vue-demi'],
      output: {
        exports: 'named',
        globals: {
          vue: 'Vue',
          'vue-demi': 'VueDemi',
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    cache: false,
    setupFiles: ['./tests/setup.ts'],
  },
})
