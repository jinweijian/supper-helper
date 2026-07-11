import { resolve } from 'node:path';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  plugins: [vue()],
  build: {
    outDir: '../dist/public',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        dashboard: resolve(import.meta.dirname, 'web/index.html'),
        setup: resolve(import.meta.dirname, 'web/setup/index.html'),
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
  },
});
