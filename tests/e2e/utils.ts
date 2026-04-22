import * as fs from 'fs/promises';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { _electron as electron } from 'playwright';
import type { ElectronApplication, Page } from 'playwright';

type TestPaths = {
  root: string;
  workspace: string;
  userData: string;
};

export type TestAppContext = {
  app: ElectronApplication;
  page: Page;
  paths: TestPaths;
  cleanup: () => Promise<void>;
};

type LaunchOptions = {
  seedHeroProvider?: boolean;
  seedHero?: boolean;
  showWindow?: boolean;
  profileMode?: boolean;
  disableBackgroundThrottling?: boolean;
  integrationMode?: boolean;
  tutorialMode?: boolean;
  startInWorkspace?: boolean;
  /** Debug license state for subscription flow testing: 'trial' | 'expired' | 'subscribed' */
  licenseDebugState?: 'trial' | 'expired' | 'subscribed';
  /** Custom license API URL (e.g., for mock server) */
  licenseApiUrl?: string;
  /** Enable license checking (required for integration tests with real/mock API) */
  enableLicenseCheck?: boolean;
};

type MockServerContext = {
  process: ChildProcess;
  port: number;
  url: string;
  stop: () => Promise<void>;
  setScenario: (scenario: 'trial' | 'expired' | 'subscribed' | 'device_limit') => Promise<void>;
  reset: () => Promise<void>;
};

const resolveElectronPath = (): string => {
  const binName = process.platform === 'win32' ? 'electron.cmd' : 'electron';
  return path.join(process.cwd(), 'node_modules', '.bin', binName);
};

const resolveMainEntry = (): string => {
  const distRoot = process.env.VIBECRAFT_DIST_DIR ?? path.join(process.cwd(), 'dist');
  return path.join(distRoot, 'main', 'index.js');
};

const seedRecentWorkspaces = async (paths: TestPaths): Promise<void> => {
  const now = Date.now();
  const workspaceName = path.basename(paths.workspace) || 'Test Workspace';
  const entry = {
    id: `ws-${now}`,
    name: workspaceName,
    path: paths.workspace,
    lastAccessed: now,
  };
  const filePath = path.join(paths.userData, 'workspaces.json');
  await fs.writeFile(filePath, JSON.stringify([entry], null, 2), 'utf8');
};

const seedHero = async (paths: TestPaths): Promise<void> => {
  const metaDir = path.join(paths.workspace, '.vibecraft');
  await fs.mkdir(metaDir, { recursive: true });
  const hero = {
    id: 'hero',
    name: 'Hero',
    provider: 'claude',
    model: 'sonnet-3.5',
    x: 400,
    y: 300,
  };
  await fs.writeFile(path.join(metaDir, 'hero.json'), JSON.stringify(hero, null, 2), 'utf8');
};

const seedSettings = async (
  paths: TestPaths,
  options: { tutorialMode: boolean; seedHeroProvider: boolean }
): Promise<void> => {
  const settings = {
    ...(options.seedHeroProvider ? { heroProvider: 'claude', heroModel: 'sonnet-3.5' } : {}),
    tutorial: options.tutorialMode
      ? { status: 'not_started', stepId: 'world-select', version: 1 }
      : { status: 'completed', stepId: 'done', version: 1 },
  };
  await fs.writeFile(path.join(paths.userData, 'settings.json'), JSON.stringify(settings, null, 2), 'utf8');
};

async function createTestPaths(): Promise<TestPaths> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vibecraft-e2e-'));
  const workspace = path.join(root, 'workspace');
  const userData = path.join(root, 'user-data');
  await fs.mkdir(workspace, { recursive: true });
  await fs.mkdir(userData, { recursive: true });
  return { root, workspace, userData };
}

const resolveAvailablePort = async (): Promise<number> => {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to resolve available port')));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
};

const withTimeout = async <T>(promise: Promise<T>, ms: number, message: string): Promise<T> => {
  let timer: NodeJS.Timeout | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const dismissTutorialOverlayIfPresent = async (page: Page): Promise<void> => {
  const tutorialOverlay = page.locator('.tutorial-complete-overlay');
  const overlayVisible = await tutorialOverlay
    .waitFor({ state: 'visible', timeout: 1_200 })
    .then(() => true)
    .catch(() => false);
  if (!overlayVisible) return;

  const skipButton = tutorialOverlay.getByRole('button', { name: /skip for now/i });
  if (await skipButton.isVisible({ timeout: 500 }).catch(() => false)) {
    await skipButton.click();
  }
  const startButton = tutorialOverlay.getByRole('button', { name: /start using vibecraft/i });
  if (await startButton.isVisible({ timeout: 500 }).catch(() => false)) {
    await startButton.click();
  }
  await tutorialOverlay.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
};

const enterWorkspaceFromHome = async (page: Page): Promise<void> => {
  const worldItem = page.getByTestId('world-item').first();

  // If we're already on world-selection (e.g., re-entry after a previous navigation)
  if (await worldItem.isVisible({ timeout: 500 }).catch(() => false)) {
    await worldItem.click();
    await page.getByTestId('workspace-canvas').waitFor({ state: 'visible', timeout: 10_000 });
    return;
  }

  // Wait for settings to finish loading before checking for the overlay.
  // The tour-opt-in overlay only appears once appSettings.status === 'loaded', so checking
  // before that point gives a false negative and the overlay later intercepts the click.
  await page
    .locator('[data-settings-status="loaded"]')
    .waitFor({ state: 'attached', timeout: 10_000 })
    .catch(() => {});

  // Dismiss tour-opt-in overlay if present (shown when tutorial is completed)
  const startupOverlay = page.locator('.tour-opt-in-overlay');
  if (await startupOverlay.isVisible({ timeout: 500 }).catch(() => false)) {
    await startupOverlay.getByRole('button', { name: 'Continue?' }).click();
    // "Continue?" navigates to world-selection
    await worldItem.waitFor({ state: 'visible', timeout: 5_000 });
    await worldItem.click();
    await page.getByTestId('workspace-canvas').waitFor({ state: 'visible', timeout: 10_000 });
    return;
  }

  // Normal home screen: open world selector then pick workspace
  await page.getByTestId('home-select-world').click();
  await worldItem.waitFor({ state: 'visible', timeout: 10_000 });
  await worldItem.click();
  await page.getByTestId('workspace-canvas').waitFor({ state: 'visible', timeout: 10_000 });
};

export async function launchTestApp(options: LaunchOptions = {}): Promise<TestAppContext> {
  const paths = await createTestPaths();
  await seedRecentWorkspaces(paths);
  if (options.seedHero !== false) {
    await seedHero(paths);
  }
  const tutorialMode = options.tutorialMode ?? false;
  const startInWorkspace = options.startInWorkspace ?? false;
  await seedSettings(paths, {
    tutorialMode,
    seedHeroProvider: options.seedHeroProvider !== false,
  });
  const executablePath = resolveElectronPath();
  const debug = process.env.VIBECRAFT_E2E_DEBUG === '1';
  const showWindow = options.showWindow ?? process.env.VIBECRAFT_E2E_SHOW === '1';
  const profileMode = options.profileMode ?? false;
  const disableBackgroundThrottling =
    options.disableBackgroundThrottling ?? process.env.VIBECRAFT_TEST_DISABLE_BACKGROUND_THROTTLING === '1';
  const integrationMode = options.integrationMode ?? process.env.VIBECRAFT_E2E_INTEGRATION === '1';
  const disableGit = process.env.VIBECRAFT_TEST_DISABLE_GIT ?? '0';
  const backgroundThrottlingArgs = disableBackgroundThrottling
    ? [
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ]
    : [];
  const launchArgs =
    process.platform === 'linux'
      ? ['--no-sandbox', '--disable-setuid-sandbox', ...backgroundThrottlingArgs, resolveMainEntry()]
      : [...backgroundThrottlingArgs, resolveMainEntry()];
  if (debug) {
    console.log('[e2e] launching electron');
  }
  const licenseDebugState = options.licenseDebugState;
  const licenseApiUrl = options.licenseApiUrl;
  const enableLicenseCheck = options.enableLicenseCheck ?? false;
  const app: ElectronApplication = await electron.launch({
    executablePath,
    args: launchArgs,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      VIBECRAFT_TEST_MODE: '1',
      VIBECRAFT_TEST_INTEGRATION: integrationMode ? '1' : '0',
      VIBECRAFT_TEST_USER_DATA: paths.userData,
      VIBECRAFT_TEST_WORKSPACE_PATH: paths.workspace,
      VIBECRAFT_TEST_DISABLE_GIT: disableGit,
      VIBECRAFT_TEST_SHOW_WINDOW: showWindow ? '1' : '0',
      ...(profileMode ? { VIBECRAFT_PROFILE: '1' } : {}),
      ...(licenseDebugState ? { VIBECRAFT_LICENSE_DEBUG: licenseDebugState } : {}),
      ...(licenseApiUrl ? { VIBECRAFT_LICENSE_API_URL: licenseApiUrl } : {}),
      ...(enableLicenseCheck ? { VIBECRAFT_LICENSE_CHECK: '1' } : {}),
      ...(debug
        ? {
            ELECTRON_ENABLE_LOGGING: '1',
            ELECTRON_ENABLE_STACK_DUMPING: '1',
          }
        : {}),
      NODE_PATH: path.join(process.cwd(), 'node_modules'),
    },
    timeout: 30_000,
  });
  if (debug) {
    console.log('[e2e] electron launched');
  }

  const proc = app.process();
  if (proc && debug) {
    proc.on('exit', (code, signal) => {
      console.error(`[e2e:electron] process exited`, { code, signal });
    });
  }
  if (proc?.stdout) {
    proc.stdout.on('data', (chunk) => {
      if (debug) {
        process.stdout.write(`[e2e:electron] ${chunk}`);
      }
    });
  }
  if (proc?.stderr) {
    proc.stderr.on('data', (chunk) => {
      if (debug) {
        process.stderr.write(`[e2e:electron] ${chunk}`);
      }
    });
  }

  const page = await withTimeout(app.firstWindow(), 30_000, 'Electron window did not open in time');
  await page.waitForLoadState('domcontentloaded');
  if (!tutorialMode) {
    await dismissTutorialOverlayIfPresent(page);
  }
  if (startInWorkspace) {
    await enterWorkspaceFromHome(page);
  }

  const cleanup = async () => {
    const waitForExit = async (timeoutMs: number): Promise<boolean> => {
      if (!proc) return true;
      if (proc.exitCode !== null) return true;
      return await withTimeout(
        new Promise<boolean>((resolve) => {
          proc.once('exit', () => resolve(true));
        }),
        timeoutMs,
        'Timed out waiting for Electron exit'
      ).catch(() => false);
    };
    try {
      await withTimeout(
        page.close({ runBeforeUnload: true }),
        5_000,
        'Timed out closing Electron page'
      ).catch(() => {});
      await withTimeout(app.context().close(), 5_000, 'Timed out closing Electron context').catch(() => {});
      await app
        .evaluate(({ app }) => {
          app.quit();
        })
        .catch(() => {});
      await withTimeout(app.close(), 10_000, 'Timed out closing Electron app');
      if (proc) {
        const exited = await waitForExit(2_000);
        if (!exited) {
          proc.kill('SIGTERM');
          const terminated = await waitForExit(2_000);
          if (!terminated) {
            proc.kill('SIGKILL');
            await waitForExit(2_000).catch(() => {});
          }
        }
        proc.stdout?.removeAllListeners();
        proc.stderr?.removeAllListeners();
        proc.removeAllListeners();
        proc.stdout?.destroy();
        proc.stderr?.destroy();
      }
    } catch (error) {
      if (debug) {
        console.error('[e2e:electron] close failed', error);
      }
      if (proc) {
        proc.kill('SIGKILL');
      }
    } finally {
      await fs.rm(paths.root, { recursive: true, force: true });
      const outputDir = process.env.VIBECRAFT_PLAYWRIGHT_OUTPUT_DIR;
      if (outputDir && outputDir.includes('vibecraft-playwright')) {
        await fs.rm(outputDir, { recursive: true, force: true });
      }
    }
  };

  return { app, page, paths, cleanup };
}

/**
 * Starts the mock license server for CI testing.
 * The server runs in a child process and can be controlled via HTTP.
 *
 * @param options.port - Port to run the server on (default: auto-assigned)
 * @param options.scenario - Initial license scenario (default: 'trial')
 * @returns MockServerContext with control methods
 */
export async function startMockLicenseServer(
  options: {
    port?: number;
    scenario?: 'trial' | 'expired' | 'subscribed' | 'device_limit';
  } = {}
): Promise<MockServerContext> {
  const port = options.port ?? (await resolveAvailablePort());
  const scenario = options.scenario ?? 'trial';
  const serverPath = path.join(__dirname, 'mock-license-server.ts');

  const proc = spawn('bun', ['run', serverPath, `--port=${port}`, `--scenario=${scenario}`], {
    stdio: 'pipe',
    env: { ...process.env },
  });

  const url = `http://localhost:${port}`;

  // Wait for server to be ready
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Mock server failed to start within 10 seconds'));
    }, 10_000);

    const checkReady = async () => {
      try {
        const response = await fetch(`${url}/health`);
        if (response.ok) {
          clearTimeout(timeout);
          resolve();
        } else {
          setTimeout(checkReady, 100);
        }
      } catch {
        setTimeout(checkReady, 100);
      }
    };

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    proc.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        clearTimeout(timeout);
        reject(new Error(`Mock server exited with code ${code}`));
      }
    });

    // Start checking after a brief delay
    setTimeout(checkReady, 200);
  });

  const stop = async (): Promise<void> => {
    if (proc.exitCode !== null) return;

    const waitForExit = (timeoutMs: number) =>
      new Promise<boolean>((resolve) => {
        let settled = false;
        const onExit = () => {
          if (settled) return;
          settled = true;
          resolve(true);
        };
        proc.once('exit', onExit);
        setTimeout(() => {
          if (settled) return;
          settled = true;
          proc.removeListener('exit', onExit);
          resolve(false);
        }, timeoutMs);
      });

    proc.kill('SIGTERM');
    const exited = await waitForExit(2000);
    if (!exited) {
      proc.kill('SIGKILL');
      await waitForExit(2000);
    }
  };

  const setScenario = async (
    newScenario: 'trial' | 'expired' | 'subscribed' | 'device_limit'
  ): Promise<void> => {
    const response = await fetch(`${url}/test/set-state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario: newScenario }),
    });
    if (!response.ok) {
      throw new Error(`Failed to set scenario: ${response.statusText}`);
    }
  };

  const reset = async (): Promise<void> => {
    const response = await fetch(`${url}/test/reset`, { method: 'POST' });
    if (!response.ok) {
      throw new Error(`Failed to reset: ${response.statusText}`);
    }
  };

  return {
    process: proc,
    port,
    url,
    stop,
    setScenario,
    reset,
  };
}

/**
 * Launches test app with mock license server.
 * Combines startMockLicenseServer and launchTestApp for convenience.
 *
 * @param options - Same as launchTestApp, plus mock server options
 * @returns TestAppContext with additional mockServer field
 */
export async function launchTestAppWithMockServer(
  options: LaunchOptions & {
    mockServerPort?: number;
    mockServerScenario?: 'trial' | 'expired' | 'subscribed' | 'device_limit';
  } = {}
): Promise<TestAppContext & { mockServer: MockServerContext }> {
  const mockServer = await startMockLicenseServer({
    port: options.mockServerPort,
    scenario: options.mockServerScenario,
  });

  const appContext = await launchTestApp({
    ...options,
    licenseApiUrl: mockServer.url,
    enableLicenseCheck: options.enableLicenseCheck ?? true,
  });

  const originalCleanup = appContext.cleanup;
  const cleanup = async () => {
    await originalCleanup();
    await mockServer.stop();
  };

  return {
    ...appContext,
    cleanup,
    mockServer,
  };
}
