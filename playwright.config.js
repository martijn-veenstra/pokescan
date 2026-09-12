// End-to-end tests: the real app served by the real server (no passcode, no coach), a phone-sized Chromium.
import fs from 'node:fs';
import { defineConfig } from '@playwright/test';
const PORT = process.env.E2E_PORT || 8787;
// Outside CI, reuse a preinstalled Chromium (PLAYWRIGHT_BROWSERS_PATH) when the exact build Playwright wants is not there.
const PWB = process.env.PLAYWRIGHT_BROWSERS_PATH;
const localChrome = !process.env.CI && PWB && fs.existsSync(PWB)
  ? fs.readdirSync(PWB).filter(d => d.startsWith('chromium-')).map(d => `${PWB}/${d}/chrome-linux/chrome`).find(f => fs.existsSync(f))
  : null;
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120000,
  expect: { timeout: 15000 },
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
    launchOptions: localChrome ? { executablePath: localChrome } : {},
  },
  webServer: {
    command: `node server/index.js`,
    env: { PORT: String(PORT), PASSCODE: '', DATABASE_URL: '', ANTHROPIC_API_KEY: '' },
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
