import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 180_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: { baseURL: `http://localhost:${PORT}/`, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: `npx vite preview --port ${PORT} --strictPort`, port: PORT, reuseExistingServer: !process.env.CI, timeout: 60_000 },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 860 } } },
    { name: 'phone', use: { ...devices['Pixel 7'] }, grep: /@phone/ },
    // the URL matrix also runs in Firefox and Safari's engine
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1366, height: 860 } }, grep: /URL matrix/ },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1366, height: 860 } }, grep: /URL matrix/ },
  ],
});
