import * as fs from 'fs';

const TEST_MODE_ENV = 'VIBECRAFT_TEST_MODE';
const TEST_USER_DATA_ENV = 'VIBECRAFT_TEST_USER_DATA';
const TEST_WORKSPACE_ENV = 'VIBECRAFT_TEST_WORKSPACE_PATH';
const TEST_DISABLE_GIT_ENV = 'VIBECRAFT_TEST_DISABLE_GIT';
const TEST_SHOW_WINDOW_ENV = 'VIBECRAFT_TEST_SHOW_WINDOW';
const TEST_INTEGRATION_ENV = 'VIBECRAFT_TEST_INTEGRATION';

export type TestModeConfig = {
  enabled: boolean;
  userDataPath: string | null;
  workspacePath: string | null;
  disableGit: boolean;
  showWindow: boolean;
  integration: boolean;
};

export function isTestMode(): boolean {
  return process.env[TEST_MODE_ENV] === '1';
}

export function getTestModeConfig(): TestModeConfig {
  const enabled = isTestMode();
  const userDataPath = enabled ? (process.env[TEST_USER_DATA_ENV] ?? null) : null;
  const workspacePath = enabled ? (process.env[TEST_WORKSPACE_ENV] ?? null) : null;
  const disableGit = enabled && process.env[TEST_DISABLE_GIT_ENV] === '1';
  const showWindow = enabled && process.env[TEST_SHOW_WINDOW_ENV] === '1';
  const integration = enabled && process.env[TEST_INTEGRATION_ENV] === '1';
  return { enabled, userDataPath, workspacePath, disableGit, showWindow, integration };
}

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}
