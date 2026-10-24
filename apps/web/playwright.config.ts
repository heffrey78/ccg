import { defineConfig, devices } from '@playwright/test';

// E2E_PORT runs the suite on its own dev server, e.g. while you play on the default port.
const port = Number(process.env.E2E_PORT ?? 5173);

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: { baseURL: `http://localhost:${port}` },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: `pnpm dev --port ${port}`, url: `http://localhost:${port}`, reuseExistingServer: !process.env.CI && !process.env.E2E_PORT, timeout: 60_000 },
});
