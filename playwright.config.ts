import { defineConfig } from '@playwright/test'

/**
 * End-to-end tests of the REAL built app (`out/main/index.js`) through Playwright `_electron`.
 * `globalSetup` runs `npm run build` once (skip with E2E_SKIP_BUILD=1). One worker: every spec
 * launches its own Electron instance with an isolated `--user-data-dir`.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.spec\.ts$/,
  globalSetup: './tests/e2e/globalSetup.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  outputDir: 'test-results',
  use: { screenshot: 'only-on-failure', trace: 'off' }
})
