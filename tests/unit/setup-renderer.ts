import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';
import type { ElectronAPI } from '../../src/shared/types';
import { JSDOM } from 'jsdom';

const noop = () => {};
const asyncValue = <T>(value: T) =>
  vi.fn(async (...args: unknown[]) => {
    void args;
    return value;
  });
const syncValue = <T>(value: T) =>
  vi.fn((...args: unknown[]) => {
    void args;
    return value;
  });

// Ensure a DOM exists even if jsdom environment is not applied for some reason.
if (typeof (globalThis as any).window === 'undefined') {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const { window } = dom;
  (globalThis as any).window = window;
  (globalThis as any).document = window.document;
  (globalThis as any).navigator = window.navigator;
  (globalThis as any).HTMLElement = window.HTMLElement;
  (globalThis as any).localStorage = window.localStorage;
  (globalThis as any).getComputedStyle = window.getComputedStyle;
  (globalThis as any).matchMedia =
    window.matchMedia ?? (() => ({ matches: false, addListener() {}, removeListener() {} }));
  (globalThis as any).requestAnimationFrame =
    window.requestAnimationFrame ?? ((cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16));
  (globalThis as any).cancelAnimationFrame = window.cancelAnimationFrame ?? clearTimeout;
}

const electronAPI: ElectronAPI = {
  isTestMode: true,
  isProfileMode: false,
  isLicenseCheckEnabled: true,
  getPosthogConfig: asyncValue(null),
  getRecentWorkspaces: asyncValue([]),
  getTutorialWorld: asyncValue({
    id: 'tutorial-world',
    name: 'Vibecraft',
    path: '/tmp/Vibecraft',
    lastAccessed: Date.now(),
  }),
  resetTutorialWorld: asyncValue({
    id: 'tutorial-world',
    name: 'Vibecraft',
    path: '/tmp/Vibecraft',
    lastAccessed: Date.now(),
  }),
  addRecentWorkspace: asyncValue(true),
  removeRecentWorkspace: asyncValue(true),
  selectFolder: asyncValue(null),
  selectAgentFiles: asyncValue([]),
  importCustomSound: asyncValue(null),
  startMcpServer: asyncValue({ success: false, error: 'Not mocked' }),
  stopMcpServer: asyncValue({ success: true }),
  loadFolders: asyncValue([]),
  createFolder: asyncValue({ success: false, error: 'Not mocked' }),
  importExistingFolder: asyncValue({ success: false, error: 'Not mocked' }),
  listAvailableFolders: asyncValue([]),
  probeFolderGit: asyncValue({ success: true, isRepo: false, isWorktree: false }),
  createGitWorktree: asyncValue({ success: false, error: 'Not mocked' }),
  worktreeSyncFromSource: asyncValue({ success: false, error: 'Not mocked' }),
  worktreeMergeToSource: asyncValue({ success: false, error: 'Not mocked' }),
  worktreeUndoMerge: asyncValue({ success: false, error: 'Not mocked' }),
  worktreeRetryRestore: asyncValue({ success: false, error: 'Not mocked' }),
  refreshFolderConflictState: asyncValue(null),
  renameFolder: asyncValue({ success: false }),
  removeFolder: asyncValue({ success: false }),
  deleteFolder: asyncValue({ success: false, error: 'Not mocked' }),
  updateFolderPosition: asyncValue(true),
  loadAgents: asyncValue([]),
  spawnAgent: asyncValue({ success: false, error: 'Not mocked' }),
  destroyAgent: asyncValue(true),
  updateAgentPosition: asyncValue(true),
  updateAgentName: asyncValue(true),
  updateAgentUnreadCompletion: asyncValue(true),
  setAgentMovementIntent: asyncValue(true),
  getAgentMcpSkills: asyncValue({ skillIds: [] }),
  setAgentMcpSkills: asyncValue({ success: true }),
  updateAgentModel: asyncValue({ success: false, error: 'Not mocked' }),
  agentAttachToFolder: asyncValue({ success: false, error: 'Not mocked' }),
  agentDetach: asyncValue({ success: false, error: 'Not mocked' }),
  loadBrowserPanels: asyncValue([]),
  createBrowserPanel: asyncValue({ success: false }),
  deleteBrowserPanel: asyncValue(true),
  updateBrowserPanel: asyncValue(true),
  loadTerminals: asyncValue([]),
  createTerminal: asyncValue({ success: false, error: 'Not mocked' }),
  updateTerminal: asyncValue({ success: false, error: 'Not mocked' }),
  deleteTerminal: asyncValue(true),
  startTerminalSession: asyncValue({ success: false, error: 'Not mocked' }),
  sendTerminalInput: asyncValue(true),
  resizeTerminal: asyncValue(true),
  stopTerminalSession: asyncValue(true),
  getTerminalHistory: asyncValue({ success: true, history: '' }),
  getAgentTerminalState: vi.fn(async () => ({
    success: true,
    state: { entries: [], viewState: null },
  })),
  setAgentTerminalState: asyncValue({ success: true }),
  clearAgentTerminalState: asyncValue({ success: true }),
  getAgentTerminalDraft: asyncValue({ success: true, draft: null }),
  setAgentTerminalDraft: asyncValue({ success: true }),
  agentConnectRunAgent: asyncValue({ success: false, runId: 'test', error: 'Not mocked' }),
  loadHero: asyncValue({ id: 'hero', name: 'Hero', provider: 'claude', model: '', x: 0, y: 0 }),
  updateHeroPosition: asyncValue(true),
  updateHeroName: asyncValue(true),
  setHeroMovementIntent: asyncValue(true),
  setHeroProvider: asyncValue({ success: false, error: 'Not mocked' }),
  setHeroModel: asyncValue({ success: false, error: 'Not mocked' }),
  listMcpSkills: asyncValue([]),
  getHeroMcpSkills: asyncValue({ skillIds: [] }),
  setHeroMcpSkills: asyncValue({ success: true }),
  heroSendPrompt: asyncValue({ success: false, runId: 'test', error: 'Not mocked' }),
  agentConnectBootstrap: asyncValue({
    providers: [],
    providerStatus: {},
    recentModels: {},
    recentModelInfo: {},
    loading: true,
    updatedAt: null,
  }),
  agentConnectProviderStatus: asyncValue(null),
  agentConnectProviderInstall: asyncValue(null),
  agentConnectProviderLogin: asyncValue({ loggedIn: false }),
  agentConnectProvidersRefresh: asyncValue({
    providers: [],
    providerStatus: {},
    recentModels: {},
    recentModelInfo: {},
    loading: true,
    updatedAt: null,
  }),
  agentConnectModelsRecent: asyncValue([]),
  updateAgentReasoningEffort: asyncValue({ success: false, error: 'Not mocked' }),
  agentConnectCancelAgentRun: asyncValue({ success: false, error: 'Not mocked' }),
  agentConnectCancelHeroRun: asyncValue({ success: false, error: 'Not mocked' }),
  loadSettings: asyncValue({}),
  saveSettings: asyncValue(true),
  ensureTutorialDevServer: asyncValue(true),
  accelerateTutorialRun: asyncValue(true),
  licenseRegisterDevice: asyncValue({
    success: true,
    active: true,
    reason: 'subscription',
    trialEndsAt: '2026-02-01T00:00:00Z',
    subscriptionStatus: 'active',
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    deviceCount: 1,
    deviceLimit: 3,
    plan: 'unknown',
    licenseToken: 'license-token',
  }),
  licenseStatus: asyncValue({
    success: true,
    active: true,
    reason: 'subscription',
    trialEndsAt: '2026-02-01T00:00:00Z',
    subscriptionStatus: 'active',
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    deviceCount: 1,
    deviceLimit: 3,
    plan: 'unknown',
    licenseToken: 'license-token',
  }),
  licenseStartCheckout: asyncValue({ success: true, checkoutUrl: 'https://checkout.test', expiresAt: '' }),
  licenseConfirmCheckout: asyncValue({
    success: true,
    active: true,
    reason: 'subscription',
    trialEndsAt: '2026-02-01T00:00:00Z',
    subscriptionStatus: 'active',
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    deviceCount: 1,
    deviceLimit: 3,
    plan: 'unknown',
    licenseToken: 'license-token',
  }),
  licensePairingStart: asyncValue({ success: true, code: 'ABCD-1234', expiresAt: '2026-02-01T00:00:00Z' }),
  licensePairingClaim: asyncValue({
    success: true,
    active: true,
    reason: 'subscription',
    trialEndsAt: '2026-02-01T00:00:00Z',
    subscriptionStatus: 'active',
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    deviceCount: 1,
    deviceLimit: 3,
    plan: 'unknown',
    licenseToken: 'license-token',
  }),
  licenseManageBilling: asyncValue({ success: true, url: 'https://billing.example.com/session' }),
  verifyLicenseToken: asyncValue({
    success: true,
    valid: true,
    expired: false,
    payload: {
      iss: 'vibecraft-license',
      sub: 'device-public',
      iat: 0,
      exp: 999999,
      active: true,
      subscriptionStatus: 'active',
      trialEndsAt: '2026-02-01T00:00:00Z',
    },
  }),
  checkNetworkStatus: asyncValue({ success: true, online: true }),
  getUpdateStatus: asyncValue({
    available: false,
    version: null,
    downloaded: false,
    downloading: false,
    error: null,
  }),
  checkForUpdates: asyncValue({
    available: false,
    version: null,
    downloaded: false,
    downloading: false,
    error: null,
  }),
  installUpdate: asyncValue({
    available: false,
    version: null,
    downloaded: false,
    downloading: false,
    error: null,
  }),
  onAgentConnectEvent: syncValue(noop),
  onAgentNotificationClick: syncValue(noop),
  onTerminalOutput: syncValue(noop),
  onTerminalExit: syncValue(noop),
  onTerminalCwdChange: syncValue(noop),
  onTerminalProcessChange: syncValue(noop),
  onTerminalCommand: syncValue(noop),
  onCommandRunRequest: syncValue(noop),
  sendCommandRunResponse: vi.fn(),
  onLayoutRequest: syncValue(noop),
  sendLayoutResponse: vi.fn(),
  onAgentsUpdated: syncValue(noop),
  onAgentConnectProvidersUpdated: syncValue(noop),
  onLicenseUpdated: syncValue(noop),
  onLicenseError: syncValue(noop),
  onUpdateStatus: syncValue(noop),
  setWorkspaceNotificationsEnabled: vi.fn(),
  bringWindowToFront: asyncValue(true),
  captureTelemetryEvent: asyncValue({ success: true }),
  getTelemetryContext: asyncValue({ distinctId: 'test-id', version: '1.0.0', platform: 'darwin' }),
  getSystemIdleTime: asyncValue(0),
  getWindowId: asyncValue(1),
  onPowerSuspend: syncValue(noop),
  onPowerResume: syncValue(noop),
};

Object.defineProperty(window, 'electronAPI', {
  value: electronAPI,
  writable: true,
});
