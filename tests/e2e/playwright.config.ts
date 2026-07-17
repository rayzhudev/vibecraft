import * as os from 'os';
import * as path from 'path';
import { defineConfig } from '@playwright/test';

const outputDir = path.join(os.tmpdir(), 'vibecraft-playwright', String(process.pid));
process.env.VIBECRAFT_PLAYWRIGHT_OUTPUT_DIR = outputDir;

const integrationMode = process.env.VIBECRAFT_E2E_INTEGRATION === '1';

export default defineConfig({
  testDir: __dirname,
  timeout: 60_000,
  retries: 1,
  workers: 1,
  reporter: 'list',
  outputDir,
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  testMatch: integrationMode ? ['**/*.integration.spec.ts'] : ['**/*.spec.ts'],
  testIgnore: integrationMode ? [] : ['**/*.integration.spec.ts'],
});
