import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, './src/shared'),
      '@admin': path.resolve(__dirname, './src/admin'),
      '@spectator': path.resolve(__dirname, './src/spectator'),
      '@referee': path.resolve(__dirname, './src/referee'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'functions', 'e2e'],
  },
});
