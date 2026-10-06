import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testIgnore: '**/production.spec.ts',
  fullyParallel: true,
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:3000/TexturePacker/', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'npm run dev -- --strictPort', url: 'http://127.0.0.1:3000/TexturePacker/', reuseExistingServer: !process.env.CI },
});
