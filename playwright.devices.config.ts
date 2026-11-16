import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({
  ...base,
  testMatch: ['**/mobile.spec.ts', '**/experience.spec.ts'],
  timeout: 90000,
  workers: 2,
  outputDir: 'test-results-devices',
  projects: [
    {
      name: 'android-chromium',
      use: { ...devices['Pixel 7'], browserName: 'chromium' },
    },
    {
      name: 'iphone-webkit',
      use: { ...devices['iPhone 13'], browserName: 'webkit' },
    },
    {
      name: 'desktop-firefox',
      use: { ...devices['Desktop Firefox'], browserName: 'firefox' },
    },
    {
      name: 'android-landscape',
      use: { ...devices['Pixel 7 landscape'], browserName: 'chromium' },
    },
  ],
});
