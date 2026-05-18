import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['lib/**/*.test.ts', 'entrypoints/**/*.test.ts'],
  },
});
