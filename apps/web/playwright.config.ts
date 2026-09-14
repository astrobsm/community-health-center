import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end configuration.
 *
 * The offline suite runs against a REAL API and a REAL database: the whole
 * point is to prove the pipeline holds when the network disappears, which a
 * mocked backend cannot demonstrate.
 *
 * Prerequisites (see apps/api/scripts/setup-local-demo.sh):
 *   - PostgreSQL and Redis running
 *   - the API on :3100
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    /* A mid-range Android is the target device, not a desktop browser. */
    ...devices['Pixel 7'],
  },
  projects: [{ name: 'android-chrome', use: { ...devices['Pixel 7'] } }],
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { VITE_API_TARGET: process.env.API_TARGET ?? 'http://127.0.0.1:3100' },
  },
});
