import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  workers: 2,
  retries: 1,
  use: {
    baseURL: process.env.BASE_URL || 'https://showdown-b5cc7.web.app',
    headless: true,
  },
});
