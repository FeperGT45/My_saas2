import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({
  ...base,
  outputDir: './test-results-cloudflare',
  use: { ...base.use, baseURL: 'http://127.0.0.1:3002' },
  webServer: {
    command: 'npm run preview:cloudflare',
    url: 'http://127.0.0.1:3002/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 90000,
  },
});
