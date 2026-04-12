import './fsTrace';
import { app, BrowserWindow, dialog, screen, systemPreferences } from 'electron';
// DIAGNOSTIC: raw fs write bypassing electron-log to find startup failure point
import * as _diagFs from 'fs';
const _diagLog = (msg: string) => {
  try {
    _diagFs.appendFileSync('/tmp/vc-startup.log', `${new Date().toISOString()} ${msg}\n`);
  } catch {
    /* noop */
  }
};
_diagLog('MODULE_LOAD_START');
import * as fs from 'fs';
import { join, resolve } from 'path';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { logger } from './logger';
import { registerIpcHandlers } from './ipc';
import { processManager } from './services/agents/processManager';
import { stopWorkspaceMcpServer } from './mcp/server';
import { getStorageNamespace } from './services/storageNamespace';
import { scheduleStartupBackgroundTasks } from './startupTasks';
import { ensureDir, getTestModeConfig, isTestMode } from '../testing/testMode';
import { safeWebContentsSend } from './ipc/safeSend';
import { parseCheckoutSessionId } from './services/licenseClient';
import { getLicenseClient } from './services/licenseRuntime';
import { initializeAutoUpdates, onUpdateStatus } from './services/updates';
import {
  isRendererReady,
  onRendererReady,
  registerRendererLifecycle,
  waitForRendererReady,
} from './rendererLifecycle';
import { loadRuntimeEnv } from '../shared/runtimeEnv';
import { APP_VERSION } from './services/appVersion';

const log = logger.scope('main');

// Catch unhandled exceptions before Electron can show a native NSAlert dialog.
// On macOS 26 + Electron 41 any NSAlert triggers a V8 crash via Accessibility,
// so we must prevent the default Electron crash dialog entirely.
// These handlers run before testMode is resolved; test-mode re-registers below.
process.on('uncaughtException', (error) => {
  try {
    log.error('Uncaught exception — exiting', error);
  } catch {
    console.error('Uncaught exception — exiting', error);
  }
  if (!isTestMode()) {
    // Exit without showing a native dialog. On macOS 26 + Electron 41 any
    // NSAlert triggers an Accessibility → V8 crash, so we must avoid it.
    process.nextTick(() => app.exit(1));
  }
});
process.on('unhandledRejection', (reason) => {
  try {
    log.error('Unhandled rejection', reason);
  } catch {
    console.error('Unhandled rejection', reason);
  }
});

// On macOS 26 + Electron 41 any NSAlert (including showErrorBox) triggers a
// V8 Accessibility crash. Override showErrorBox so renderer crashes are logged
// and the app exits cleanly instead of showing a crashing native dialog.
dialog.showErrorBox = (title: string, content: string) => {
  try {
    log.error('Suppressed error dialog (macOS 26 compat)', { title, content });
  } catch {
    console.error('Suppressed error dialog', title, content);
  }
  if (!isTestMode()) {
    process.nextTick(() => app.exit(1));
  }
};

_diagLog('BEFORE_LOAD_RUNTIME_ENV');
loadRuntimeEnv();
_diagLog('AFTER_LOAD_RUNTIME_ENV');

let mainWindow: BrowserWindow | null = null;
let readyListenerCleanup: (() => void) | null = null;
const queuedRendererEvents = new Map<string, unknown>();
const queueableChannels = new Set<string>([
  'agents-updated',
  'agentconnect-providers-updated',
  'agent-notification-click',
  'license-updated',
  'license-error',
  'update-status',
]);
const QUEUE_FLUSH_TIMEOUT_MS = 10000;
let queueFlushPending = false;

const isDev = !app.isPackaged || process.env.NODE_ENV === 'development';
const DEV_LOAD_RETRY_MS = 500;
const DEV_LOAD_MAX_ATTEMPTS = 30;
const storageNamespace = getStorageNamespace();
const testMode = getTestModeConfig();
const tutorialSandboxEnabled = ['1', 'true', 'yes'].includes(
  (process.env.VIBECRAFT_TUTORIAL_RESET ?? '').trim().toLowerCase()
);
let tutorialSandboxPath: string | null = null;
const cleanupTutorialSandbox = (): void => {
  if (!tutorialSandboxPath) return;
  try {
    fs.rmSync(tutorialSandboxPath, { recursive: true, force: true });
  } catch (error) {
    console.warn('Failed to remove tutorial sandbox storage', error);
  } finally {
    tutorialSandboxPath = null;
  }
};

if (!testMode.enabled && tutorialSandboxEnabled) {
  tutorialSandboxPath = fs.mkdtempSync(join(tmpdir(), 'vibecraft-tutorial-'));
  app.setPath('userData', tutorialSandboxPath);
}

if (testMode.enabled) {
  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception in test mode', error);
  });
  process.on('unhandledRejection', (error) => {
    console.error('Unhandled rejection in test mode', error);
  });
  if (!testMode.userDataPath || !testMode.workspacePath) {
    console.error('VIBECRAFT_TEST_MODE requires VIBECRAFT_TEST_USER_DATA and VIBECRAFT_TEST_WORKSPACE_PATH.');
    app.exit(1);
  } else {
    console.log('[vibecraft:test-mode] enabled', {
      userDataPath: testMode.userDataPath,
      workspacePath: testMode.workspacePath,
    });
    ensureDir(testMode.userDataPath);
    app.setPath('userData', testMode.userDataPath);
  }
} else if (storageNamespace === 'dev' && !tutorialSandboxEnabled) {
  const prodUserDataPath = app.getPath('userData');
  app.setPath('userData', `${prodUserDataPath}-dev`);
}

const isTestModeEnabled = testMode.enabled;

const pendingDeepLinks: string[] = [];

const extractDeepLink = (argv: string[]): string | null => {
  return argv.find((arg) => arg.startsWith('vibecraft://')) ?? null;
};

const handleCheckoutDeepLink = async (url: string): Promise<void> => {
  const sessionId = parseCheckoutSessionId(url);
  if (!sessionId) return;
  try {
    const client = getLicenseClient();
    await client.confirmCheckout(sessionId);
    const status = await client.getStatus();
    emitToRenderer('license-updated', status);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'checkout_confirm_failed';
    emitToRenderer('license-error', { error: message });
  }
};

const queueDeepLink = (url: string): void => {
  if (app.isReady()) {
    void handleCheckoutDeepLink(url);
  } else {
    pendingDeepLinks.push(url);
  }
};

const flushDeepLinks = (): void => {
  if (pendingDeepLinks.length === 0) return;
  const queued = pendingDeepLinks.splice(0, pendingDeepLinks.length);
  queued.forEach((url) => {
    void handleCheckoutDeepLink(url);
  });
};

const resolveProtocolAppPath = (): string | null => {
  const devExplicit = process.env.VIBECRAFT_PROTOCOL_APP_PATH_DEV?.trim();
  const baseExplicit = process.env.VIBECRAFT_PROTOCOL_APP_PATH?.trim();
  const explicit = (isDev ? devExplicit : baseExplicit) || baseExplicit;
  const argvCandidate = process.argv
    .slice(1)
    .find((arg) => !arg.startsWith('-') && !arg.startsWith('vibecraft://'));
  const appPath = app.getAppPath();
  const distMainCandidate = appPath ? resolve(appPath, 'dist', 'main', 'index.js') : null;
  const cwd = process.cwd();
  const cwdDistCandidate = cwd ? resolve(cwd, 'dist', 'main', 'index.js') : null;
  const candidates = [explicit, argvCandidate, distMainCandidate, appPath, cwdDistCandidate, cwd].filter(
    (value): value is string => Boolean(value)
  );
  for (const candidate of candidates) {
    const resolved = resolve(candidate);
    if (resolved.includes('default_app.asar')) {
      continue;
    }
    if (!fs.existsSync(resolved)) {
      continue;
    }
    try {
      const stats = fs.statSync(resolved);
      if (stats.isDirectory()) {
        const nestedDist = resolve(resolved, 'dist', 'main', 'index.js');
        if (fs.existsSync(nestedDist)) {
          return nestedDist;
        }
      }
    } catch {
      // ignore stat failures
    }
    return resolved;
  }
  return null;
};

const registerElectronBundle = (): void => {
  if (process.platform !== 'darwin' || app.isPackaged) return;
  const bundlePath = resolve(process.execPath, '..', '..', '..');
  if (!bundlePath.endsWith('.app') || !fs.existsSync(bundlePath)) {
    return;
  }
  const lsregisterPath =
    '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
  if (!fs.existsSync(lsregisterPath)) {
    return;
  }
  try {
    execFileSync(lsregisterPath, ['-f', bundlePath]);
    log.info('Registered Electron bundle with LaunchServices', { bundlePath });
  } catch (error) {
    log.warn('Failed to register Electron bundle with LaunchServices', { error, bundlePath });
  }
};

const registerProtocolClient = (): void => {
  if (isTestModeEnabled) return;
  registerElectronBundle();
  const appPath = resolveProtocolAppPath();
  if (!app.isPackaged && appPath) {
    app.removeAsDefaultProtocolClient('vibecraft', process.execPath, [appPath]);
    const registered = app.setAsDefaultProtocolClient('vibecraft', process.execPath, [appPath]);
    if (registered) {
      const isDefault = app.isDefaultProtocolClient('vibecraft', process.execPath, [appPath]);
      log.info('Protocol registered', { execPath: process.execPath, appPath, isDefault });
    } else {
      log.warn('Protocol registration failed', { execPath: process.execPath, appPath });
    }
    return;
  }
  const registered = app.setAsDefaultProtocolClient('vibecraft');
  if (registered) {
    const isDefault = app.isDefaultProtocolClient('vibecraft');
    log.info('Protocol registered', { packaged: app.isPackaged, isDefault });
  } else {
    log.warn('Protocol registration failed', { packaged: app.isPackaged, appPath });
  }
};

if (!isDev) {
  const gotSingleInstanceLock = app.requestSingleInstanceLock();
  if (!gotSingleInstanceLock) {
    app.quit();
  } else {
    app.on('second-instance', (_event, argv) => {
      const url = extractDeepLink(argv);
      if (url) {
        queueDeepLink(url);
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) {
          mainWindow.restore();
        }
        mainWindow.show();
        mainWindow.focus();
      }
    });
  }
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  queueDeepLink(url);
});

async function createWindow(): Promise<void> {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workAreaSize;

  mainWindow = new BrowserWindow({
    width: Math.min(1600, width),
    height: Math.min(1000, height),
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 10 },
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Needed for webview
      webviewTag: true,
    },
    show: false,
  });
  registerRendererLifecycle(mainWindow);
  readyListenerCleanup?.();
  readyListenerCleanup = onRendererReady(mainWindow.webContents, () => {
    flushQueuedRendererEvents();
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    log.error('Renderer process crashed', details);
    // Don't let Electron show a native crash dialog — it crashes on macOS 26.
  });

  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    log.error('Preload script error', { preloadPath, error: error?.message });
  });

  mainWindow.once('ready-to-show', () => {
    _diagLog(`READY_TO_SHOW isDev=${String(isDev)}`);
    log.info('ready-to-show fired', { isDev, isTestModeEnabled });
    if (!mainWindow) return;
    if (isTestModeEnabled) {
      if (testMode.showWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
      return;
    }
    const shouldDeferShow = isDev && !isTestModeEnabled && process.platform === 'darwin';
    if (shouldDeferShow) {
      return;
    }
    if (isDev) {
      // In dev, hot restarts can relaunch Electron; don't steal focus by auto-showing.
      // The user can bring the app forward via dock/taskbar activation.
      // On Windows/Linux, `activate` won't fire on startup, so we still need to show the window.
      mainWindow.maximize();
      mainWindow.show();
      return;
    }
    mainWindow.show();
  });

  if (isDev) {
    mainWindow.webContents.on('render-process-gone', (_event, details) => {
      log.warn('Renderer process exited', details);
      if (!mainWindow || mainWindow.isDestroyed()) return;
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.reload();
        }
      }, 1000);
    });
  }

  const loadDevURL = (targetUrl: string) => {
    let attempts = 0;
    const attempt = () => {
      attempts += 1;
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.loadURL(targetUrl).catch((error) => {
        if (attempts >= DEV_LOAD_MAX_ATTEMPTS) {
          log.error('Failed to load dev server URL', error);
          return;
        }
        setTimeout(attempt, DEV_LOAD_RETRY_MS);
      });
    };
    attempt();
  };

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    loadDevURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    readyListenerCleanup?.();
    readyListenerCleanup = null;
    mainWindow = null;
  });

  _diagLog(`VIBECRAFT_STARTED isDev=${String(isDev)}`);
  log.info('VibeCraft started', { isDev, version: APP_VERSION });
}

// Handle creating/removing shortcuts on Windows (optional, only in packaged app)
// Note: electron-squirrel-startup is only needed for Windows installers
// We skip this check in development

app.on('ready', () => {
  _diagLog('APP_READY');
  if (process.platform === 'darwin') {
    try {
      systemPreferences.setUserDefault('ApplePressAndHoldEnabled', 'boolean', false);
    } catch {
      /* noop */
    }
    // Disable Chromium's accessibility tree on macOS 26 + Electron 41 to prevent
    // the macOS Accessibility framework from querying V8 internal pointers and
    // triggering EXC_BREAKPOINT crashes via GetAlignedPointerFromInternalField.
    try {
      app.setAccessibilitySupportEnabled(false);
      log.info('Accessibility support disabled (macOS 26 compat)');
    } catch {
      /* noop */
    }
  }
  registerProtocolClient();
  const argvUrl = extractDeepLink(process.argv);
  if (argvUrl) {
    queueDeepLink(argvUrl);
  }
  void registerIpcHandlers().catch((error) => {
    log.error('Failed to register IPC handlers', error);
    app.exit(1);
  });
  scheduleStartupBackgroundTasks({
    onProviderRegistryUpdate: (snapshot) => emitToRenderer('agentconnect-providers-updated', snapshot),
  });
  _diagLog('BEFORE_CREATE_WINDOW');
  void createWindow();
  initializeAutoUpdates({ isTestMode: isTestModeEnabled });
  onUpdateStatus((status) => emitToRenderer('update-status', status));
  flushDeepLinks();
});

app.on('window-all-closed', () => {
  // Shutdown all agent processes
  processManager.shutdownAll();
  void stopWorkspaceMcpServer();

  cleanupTutorialSandbox();

  if (process.platform !== 'darwin' || isTestModeEnabled) {
    app.quit();
  }
});

app.on('before-quit', () => {
  cleanupTutorialSandbox();
});

app.on('activate', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (!mainWindow.isVisible()) {
      mainWindow.show();
      if (isDev) mainWindow.maximize();
    }
    return;
  }
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Export mainWindow for IPC handlers
export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function emitToRenderer(channel: string, data: unknown): void {
  if (!mainWindow) return;
  const sent = safeWebContentsSend(mainWindow.webContents, channel, data);
  if (sent) return;
  if (!queueableChannels.has(channel)) return;
  queuedRendererEvents.set(channel, data);
  scheduleQueuedFlush();
}

function flushQueuedRendererEvents(): void {
  const window = mainWindow;
  if (!window) return;
  if (!isRendererReady(window.webContents)) return;
  if (queuedRendererEvents.size === 0) return;
  const entries = Array.from(queuedRendererEvents.entries());
  queuedRendererEvents.clear();
  entries.forEach(([channel, payload]) => {
    safeWebContentsSend(window.webContents, channel, payload);
  });
}

function scheduleQueuedFlush(): void {
  const window = mainWindow;
  if (!window) return;
  if (queueFlushPending) return;
  queueFlushPending = true;
  void waitForRendererReady(window.webContents, QUEUE_FLUSH_TIMEOUT_MS)
    .then(() => {
      flushQueuedRendererEvents();
    })
    .catch(() => {
      /* noop */
    })
    .finally(() => {
      queueFlushPending = false;
    });
}
