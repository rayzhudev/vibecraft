import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import { createPublicKey, verify } from 'node:crypto';
import type {
  Workspace,
  Agent,
  Folder,
  AvailableFolder,
  BrowserPanel,
  TerminalPanel,
  Hero,
  AppSettings,
  AgentTerminalState,
  AgentTerminalViewState,
  SpawnAgentPayload,
  AttachAgentPayload,
  MovementIntent,
  IpcSuccess,
  IpcResult,
  ProviderRegistrySnapshot,
  ProviderStatus,
  AgentProvider,
  AgentModelInfo,
  AgentConnectEventPayload,
  AgentNotificationClickPayload,
  TutorialScenario,
  UpdateStatus,
  LicenseCheckoutPlan,
  LicenseStatusResponse,
  LicenseCheckoutStart,
  LicensePairingStart,
  LicenseTokenPayload,
  ImportedCustomSound,
  McpSkillDescriptor,
  McpSkillId,
  PriorWorkspacePreviewEntry,
  PriorWorkspacePreviewSource,
} from './shared/types';
import type { CommandRunRequest, CommandRunResponse } from './shared/commands';
import type { LayoutRequest, LayoutResponse } from './shared/layout';
import { DEFAULT_HERO } from './shared/heroDefaults';
import { loadRuntimeEnv } from './shared/runtimeEnv';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

loadRuntimeEnv();
ipcRenderer.setMaxListeners(50);

const isIpcSuccess = <T>(value: unknown): value is IpcSuccess<T> =>
  isRecord(value) && value.success === true && 'data' in value;

const unwrap = <T>(result: IpcResult<T>, fallback: T): T =>
  isIpcSuccess<T>(result) ? result.data : fallback;

const normalizePem = (value: string): string => {
  if (value.includes('\\n')) {
    return value.replace(/\\n/g, '\n');
  }
  return value;
};

const resolveLicensePublicKey = (): string => process.env.VIBECRAFT_LICENSE_PUBLIC_KEY?.trim() ?? '';

const decodeSegment = (segment: string): unknown => {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
};

const isLicenseTokenPayload = (value: unknown): value is LicenseTokenPayload => {
  if (!isRecord(value)) return false;
  return (
    typeof value.iss === 'string' &&
    typeof value.sub === 'string' &&
    typeof value.iat === 'number' &&
    typeof value.exp === 'number' &&
    typeof value.active === 'boolean' &&
    typeof value.subscriptionStatus === 'string' &&
    typeof value.trialEndsAt === 'string'
  );
};

const verifyLicenseToken = (
  token: string
): { valid: boolean; expired: boolean; payload?: LicenseTokenPayload } => {
  const parts = token.split('.');
  if (parts.length !== 3) return { valid: false, expired: true };
  const [headerSegment, payloadSegment, signatureSegment] = parts;
  let header: unknown;
  let payload: unknown;
  try {
    header = decodeSegment(headerSegment);
    payload = decodeSegment(payloadSegment);
  } catch {
    return { valid: false, expired: true };
  }
  if (!isRecord(header) || header.alg !== 'EdDSA') return { valid: false, expired: true };
  if (!isLicenseTokenPayload(payload)) return { valid: false, expired: true };
  if (payload.iss !== 'vibecraft-license') return { valid: false, expired: true };
  const publicKeyValue = resolveLicensePublicKey();
  if (!publicKeyValue) return { valid: false, expired: true };

  const signingInput = `${headerSegment}.${payloadSegment}`;
  let publicKey: ReturnType<typeof createPublicKey>;
  try {
    publicKey = createPublicKey(normalizePem(publicKeyValue));
  } catch {
    return { valid: false, expired: true };
  }

  let valid = false;
  try {
    const signature = Buffer.from(signatureSegment, 'base64url');
    valid = verify(null, Buffer.from(signingInput), publicKey, signature);
  } catch {
    return { valid: false, expired: true };
  }

  if (!valid) return { valid: false, expired: true };
  const expired = Math.floor(Date.now() / 1000) >= payload.exp;

  return { valid: true, expired, payload };
};

const toResult = <T extends Record<string, unknown>>(
  result: IpcResult<T>,
  options?: { includeError?: boolean }
): { success: boolean } & Partial<T> & { error?: string } => {
  if (isIpcSuccess<T>(result)) {
    return { success: true, ...result.data };
  }
  const payload = { success: false } as { success: boolean } & Partial<T> & { error?: string };
  if (options?.includeError) {
    payload.error = result.error;
  }
  return payload;
};

const toSuccess = <T extends Record<string, unknown>>(
  result: IpcResult<T>
): { success: boolean } & Partial<T> => toResult(result);

const toSuccessWithError = <T extends Record<string, unknown>>(
  result: IpcResult<T>
): { success: boolean; error?: string } & Partial<T> => toResult(result, { includeError: true });

const isDev =
  process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test' || process.defaultApp === true;
const isLicenseCheckEnabled = !isDev || process.env.VIBECRAFT_LICENSE_CHECK === '1';

const resolveLicenseDebugState = (): 'trial' | 'expired' | 'subscribed' | undefined => {
  const value = process.env.VIBECRAFT_LICENSE_DEBUG?.trim();
  if (value === 'trial' || value === 'expired' || value === 'subscribed') {
    return value;
  }
  return undefined;
};

const licenseDebugState = resolveLicenseDebugState();

const electronAPI = {
  isTestMode: process.env.VIBECRAFT_TEST_MODE === '1',
  isProfileMode: process.env.VIBECRAFT_PROFILE === '1',
  isLicenseCheckEnabled,
  licenseDebugState,
  // Workspaces
  getRecentWorkspaces: async (): Promise<Workspace[]> => {
    const result: IpcResult<Workspace[]> = await ipcRenderer.invoke('get-recent-workspaces');
    return unwrap(result, []);
  },

  getTutorialWorld: async (): Promise<Workspace> => {
    const result: IpcResult<Workspace> = await ipcRenderer.invoke('get-tutorial-world');
    return unwrap(result, { id: 'tutorial-world', name: 'Tutorial', path: '', lastAccessed: Date.now() });
  },

  resetTutorialWorld: async (): Promise<Workspace> => {
    const result: IpcResult<Workspace> = await ipcRenderer.invoke('reset-tutorial-world');
    return unwrap(result, { id: 'tutorial-world', name: 'Tutorial', path: '', lastAccessed: Date.now() });
  },

  checkForPriorSettings: async (): Promise<{
    found: boolean;
    sourceDir?: string;
    settingsPath?: string;
    workspacesPath?: string;
  } | null> => {
    const result: IpcResult<{
      found: boolean;
      sourceDir?: string;
      settingsPath?: string;
      workspacesPath?: string;
    }> = await ipcRenderer.invoke('check-for-prior-settings');
    return unwrap(result, null);
  },

  getPriorWorkspacePreview: async (): Promise<{
    found: boolean;
    sourceDir?: string;
    workspaces: PriorWorkspacePreviewEntry[];
    sources?: PriorWorkspacePreviewSource[];
  } | null> => {
    const result: IpcResult<{
      found: boolean;
      sourceDir?: string;
      workspaces: PriorWorkspacePreviewEntry[];
      sources?: PriorWorkspacePreviewSource[];
    }> = await ipcRenderer.invoke('get-prior-workspace-preview');
    return unwrap(result, null);
  },

  backupAndImportSettings: async (): Promise<{
    success: boolean;
    backupPath?: string;
    error?: string;
    importedCount?: number;
    duplicateCount?: number;
    sourceCount?: number;
  }> => {
    const result: IpcResult<{
      success: boolean;
      backupPath?: string;
      error?: string;
      importedCount?: number;
      duplicateCount?: number;
      sourceCount?: number;
    }> = await ipcRenderer.invoke('backup-and-import-settings');
    return unwrap(result, { success: false, error: 'IPC failed' });
  },

  addRecentWorkspace: async (workspace: Workspace): Promise<boolean> => {
    const result: IpcResult<boolean> = await ipcRenderer.invoke('add-recent-workspace', workspace);
    return unwrap(result, false);
  },

  removeRecentWorkspace: async (id: string): Promise<boolean> => {
    const result: IpcResult<boolean> = await ipcRenderer.invoke('remove-recent-workspace', id);
    return unwrap(result, false);
  },

  selectFolder: async (options?: { title?: string }): Promise<string | null> => {
    const result: IpcResult<string | null> = await ipcRenderer.invoke('select-folder', options);
    return unwrap(result, null);
  },

  selectAgentFiles: async (
    workspacePath: string,
    options?: { title?: string }
  ): Promise<import('./shared/types').SelectedAgentFile[]> => {
    const result: IpcResult<import('./shared/types').SelectedAgentFile[]> = await ipcRenderer.invoke(
      'select-agent-files',
      workspacePath,
      options
    );
    return unwrap(result, []);
  },

  importCustomSound: async (): Promise<ImportedCustomSound | null> => {
    const result: IpcResult<ImportedCustomSound | null> =
      await ipcRenderer.invoke('audio-import-custom-sound');
    if (isIpcSuccess(result)) return result.data;
    throw new Error(result.error || 'Could not import custom sound');
  },

  startMcpServer: async (
    workspacePath: string
  ): Promise<{ success: boolean; host?: string; port?: number; error?: string }> => {
    const result: IpcResult<{ host: string; port: number }> = await ipcRenderer.invoke(
      'mcp-start',
      workspacePath
    );
    return toSuccessWithError(result);
  },

  stopMcpServer: async (workspacePath?: string): Promise<{ success: boolean; error?: string }> => {
    const result: IpcResult<void> = await ipcRenderer.invoke('mcp-stop', workspacePath);
    return isIpcSuccess(result) ? { success: true } : { success: false, error: result.error };
  },

  // Folders
  loadFolders: async (workspacePath: string): Promise<Folder[]> => {
    const result: IpcResult<Folder[]> = await ipcRenderer.invoke('load-folders', workspacePath);
    return unwrap(result, []);
  },

  createFolder: async (
    workspacePath: string,
    name: string,
    x: number,
    y: number
  ): Promise<{ success: boolean; folder?: Folder; error?: string }> => {
    const result: IpcResult<{ folder: Folder }> = await ipcRenderer.invoke(
      'create-folder',
      workspacePath,
      name,
      x,
      y
    );
    return toSuccessWithError(result);
  },

  importExistingFolder: async (
    workspacePath: string,
    relativePath: string,
    x: number,
    y: number
  ): Promise<{ success: boolean; folder?: Folder; error?: string; alreadyImported?: boolean }> => {
    const result: IpcResult<{ folder?: Folder; alreadyImported?: boolean }> = await ipcRenderer.invoke(
      'import-existing-folder',
      workspacePath,
      relativePath,
      x,
      y
    );
    return toSuccessWithError(result);
  },

  listAvailableFolders: async (workspacePath: string) => {
    const result: IpcResult<AvailableFolder[]> = await ipcRenderer.invoke(
      'list-available-folders',
      workspacePath
    );
    return unwrap(result, []);
  },

  probeFolderGit: async (workspacePath: string, relativePath: string) => {
    const result: IpcResult<{ isRepo: boolean; isWorktree: boolean }> = await ipcRenderer.invoke(
      'probe-folder-git',
      workspacePath,
      relativePath
    );
    if (isIpcSuccess(result)) {
      return { success: true, ...result.data };
    }
    return { success: false, isRepo: false, isWorktree: false };
  },

  createGitWorktree: async (workspacePath: string, folderId: string, x: number, y: number) => {
    const result: IpcResult<{ folder?: Folder }> = await ipcRenderer.invoke(
      'create-git-worktree',
      workspacePath,
      folderId,
      x,
      y
    );
    return toSuccessWithError(result);
  },

  worktreeSyncFromSource: async (workspacePath: string, folderId: string) => {
    const result: IpcResult<{ message?: string }> = await ipcRenderer.invoke(
      'worktree-sync-from-source',
      workspacePath,
      folderId
    );
    return toSuccessWithError(result);
  },

  worktreeMergeToSource: async (workspacePath: string, folderId: string) => {
    const result: IpcResult<{ message?: string; detachedAgentIds?: string[] }> = await ipcRenderer.invoke(
      'worktree-merge-to-source',
      workspacePath,
      folderId
    );
    return toSuccessWithError(result);
  },

  worktreeUndoMerge: async (workspacePath: string, folderId: string) => {
    const result: IpcResult<{ message?: string }> = await ipcRenderer.invoke(
      'worktree-undo-merge',
      workspacePath,
      folderId
    );
    return toSuccessWithError(result);
  },

  worktreeRetryRestore: async (workspacePath: string, folderId: string) => {
    const result: IpcResult<{ message?: string }> = await ipcRenderer.invoke(
      'worktree-retry-restore',
      workspacePath,
      folderId
    );
    return toSuccessWithError(result);
  },

  refreshFolderConflictState: async (workspacePath: string, folderId: string) => {
    const result: IpcResult<Folder | null> = await ipcRenderer.invoke(
      'refresh-folder-conflict-state',
      workspacePath,
      folderId
    );
    return unwrap(result, null);
  },

  renameFolder: async (
    workspacePath: string,
    folderId: string,
    newName: string
  ): Promise<{ success: boolean; error?: string }> => {
    const result: IpcResult<Record<string, never>> = await ipcRenderer.invoke(
      'rename-folder',
      workspacePath,
      folderId,
      newName
    );
    return toSuccessWithError(result);
  },

  removeFolder: async (
    workspacePath: string,
    folderId: string
  ): Promise<{ success: boolean; detachedAgentIds?: string[] }> => {
    const result: IpcResult<{ detachedAgentIds?: string[] }> = await ipcRenderer.invoke(
      'remove-folder',
      workspacePath,
      folderId
    );
    return toSuccess(result);
  },
  deleteFolder: async (
    workspacePath: string,
    folderId: string
  ): Promise<{ success: boolean; error?: string; detachedAgentIds?: string[] }> => {
    const result: IpcResult<{ detachedAgentIds?: string[] }> = await ipcRenderer.invoke(
      'delete-folder',
      workspacePath,
      folderId
    );
    return toSuccessWithError(result);
  },

  updateFolderPosition: async (
    workspacePath: string,
    folderId: string,
    x: number,
    y: number
  ): Promise<boolean> => {
    const result: IpcResult<boolean> = await ipcRenderer.invoke(
      'update-folder-position',
      workspacePath,
      folderId,
      x,
      y
    );
    return unwrap(result, false);
  },

  // Agents
  loadAgents: async (workspacePath: string): Promise<Agent[]> => {
    const result: IpcResult<Agent[]> = await ipcRenderer.invoke('load-agents', workspacePath);
    return unwrap(result, []);
  },

  spawnAgent: async (
    payload: SpawnAgentPayload
  ): Promise<{ success: boolean; agent?: Agent; error?: string }> => {
    const result: IpcResult<{ agent: Agent }> = await ipcRenderer.invoke('spawn-agent', payload);
    return toSuccessWithError(result);
  },

  destroyAgent: async (workspacePath: string, agentId: string): Promise<boolean> => {
    const result: IpcResult<boolean> = await ipcRenderer.invoke('destroy-agent', workspacePath, agentId);
    return unwrap(result, false);
  },

  updateAgentPosition: async (
    workspacePath: string,
    agentId: string,
    x: number,
    y: number
  ): Promise<boolean> => {
    const result: IpcResult<boolean> = await ipcRenderer.invoke(
      'update-agent-position',
      workspacePath,
      agentId,
      x,
      y
    );
    return unwrap(result, false);
  },

  updateAgentName: async (workspacePath: string, agentId: string, displayName: string): Promise<boolean> => {
    const result: IpcResult<boolean> = await ipcRenderer.invoke(
      'update-agent-name',
      workspacePath,
      agentId,
      displayName
    );
    return unwrap(result, false);
  },

  updateAgentUnreadCompletion: async (
    workspacePath: string,
    agentId: string,
    hasUnreadCompletion: boolean
  ): Promise<boolean> => {
    const result: IpcResult<boolean> = await ipcRenderer.invoke(
      'update-agent-unread-completion',
      workspacePath,
      agentId,
      hasUnreadCompletion
    );
    return unwrap(result, false);
  },

  setAgentMovementIntent: async (
    workspacePath: string,
    agentId: string,
    movementIntent: MovementIntent
  ): Promise<boolean> => {
    const result: IpcResult<boolean> = await ipcRenderer.invoke('set-agent-movement-intent', {
      workspacePath,
      agentId,
      movementIntent,
    });
    return unwrap(result, false);
  },

  getAgentMcpSkills: async (workspacePath: string, agentId: string): Promise<{ skillIds: McpSkillId[] }> => {
    const result: IpcResult<{ skillIds: McpSkillId[] }> = await ipcRenderer.invoke('agent-get-mcp-skills', {
      workspacePath,
      agentId,
    });
    return unwrap(result, { skillIds: [] });
  },

  setAgentMcpSkills: async (
    workspacePath: string,
    agentId: string,
    skillIds: McpSkillId[]
  ): Promise<{ success: boolean; error?: string }> => {
    const result: IpcResult<{ skillIds: McpSkillId[] }> = await ipcRenderer.invoke('agent-set-mcp-skills', {
      workspacePath,
      agentId,
      skillIds,
    });
    return toSuccessWithError(result);
  },

  agentAttachToFolder: async (payload: AttachAgentPayload): Promise<{ success: boolean; error?: string }> => {
    const result: IpcResult<void> = await ipcRenderer.invoke('agent-attach-to-folder', payload);
    return isIpcSuccess(result) ? { success: true } : { success: false, error: result.error };
  },

  agentDetach: async (
    agentId: string,
    workspacePath: string
  ): Promise<{ success: boolean; error?: string }> => {
    const result: IpcResult<void> = await ipcRenderer.invoke('agent-detach', agentId, workspacePath);
    return isIpcSuccess(result) ? { success: true } : { success: false, error: result.error };
  },

  // Browser panels
  loadBrowserPanels: async (workspacePath: string): Promise<BrowserPanel[]> => {
    const result: IpcResult<BrowserPanel[]> = await ipcRenderer.invoke('load-browser-panels', workspacePath);
    return unwrap(result, []);
  },

  createBrowserPanel: async (
    workspacePath: string,
    url: string,
    x: number,
    y: number,
    width: number,
    height: number,
    originFolderId?: string
  ): Promise<{ success: boolean; panel?: BrowserPanel }> => {
    const result: IpcResult<{ panel: BrowserPanel }> = await ipcRenderer.invoke(
      'create-browser-panel',
      workspacePath,
      url,
      x,
      y,
      width,
      height,
      originFolderId
    );
    return toSuccess(result);
  },

  deleteBrowserPanel: async (workspacePath: string, id: string): Promise<boolean> => {
    const result: IpcResult<boolean> = await ipcRenderer.invoke('delete-browser-panel', workspacePath, id);
    return unwrap(result, false);
  },

  updateBrowserPanel: async (
    workspacePath: string,
    id: string,
    updates: Partial<BrowserPanel>
  ): Promise<boolean> => {
    const result: IpcResult<boolean> = await ipcRenderer.invoke(
      'update-browser-panel',
      workspacePath,
      id,
      updates
    );
    return unwrap(result, false);
  },

  // Terminals
  loadTerminals: async (workspacePath: string): Promise<TerminalPanel[]> => {
    const result: IpcResult<TerminalPanel[]> = await ipcRenderer.invoke('load-terminals', workspacePath);
    return unwrap(result, []);
  },

  createTerminal: async (
    workspacePath: string,
    relativePath: string,
    x: number,
    y: number,
    originFolderId?: string,
    width?: number,
    height?: number
  ): Promise<{ success: boolean; terminal?: TerminalPanel; error?: string }> => {
    const result: IpcResult<{ terminal: TerminalPanel }> = await ipcRenderer.invoke(
      'create-terminal',
      workspacePath,
      relativePath,
      x,
      y,
      originFolderId,
      width,
      height
    );
    return toSuccessWithError(result);
  },

  updateTerminal: async (
    workspacePath: string,
    terminalId: string,
    updates: Partial<TerminalPanel>
  ): Promise<{ success: boolean; terminal?: TerminalPanel; error?: string }> => {
    const result: IpcResult<{ terminal: TerminalPanel }> = await ipcRenderer.invoke(
      'update-terminal',
      workspacePath,
      terminalId,
      updates
    );
    return toSuccessWithError(result);
  },

  deleteTerminal: async (workspacePath: string, terminalId: string): Promise<boolean> => {
    const result: IpcResult<boolean> = await ipcRenderer.invoke('delete-terminal', workspacePath, terminalId);
    return unwrap(result, false);
  },

  startTerminalSession: async (payload: {
    terminalId: string;
    workspacePath: string;
    relativePath?: string;
    cols?: number;
    rows?: number;
    sessionToken?: string;
    reuseIfRunning?: boolean;
  }): Promise<{ success: boolean; error?: string; sessionToken?: string }> => {
    const result: IpcResult<{ sessionToken?: string }> = await ipcRenderer.invoke(
      'start-terminal-session',
      payload
    );
    return toSuccessWithError(result);
  },

  sendTerminalInput: async (terminalId: string, data: string): Promise<boolean> => {
    const result: IpcResult<boolean> = await ipcRenderer.invoke('terminal-input', terminalId, data);
    return unwrap(result, false);
  },

  resizeTerminal: async (terminalId: string, cols: number, rows: number): Promise<boolean> => {
    const result: IpcResult<boolean> = await ipcRenderer.invoke('terminal-resize', terminalId, cols, rows);
    return unwrap(result, false);
  },

  stopTerminalSession: async (terminalId: string): Promise<boolean> => {
    const result: IpcResult<boolean> = await ipcRenderer.invoke('stop-terminal-session', terminalId);
    return unwrap(result, false);
  },

  getTerminalHistory: async (
    workspacePath: string,
    terminalId: string
  ): Promise<{ success: boolean; history: string }> => {
    const result: IpcResult<{ history: string }> = await ipcRenderer.invoke(
      'get-terminal-history',
      workspacePath,
      terminalId
    );
    if (isIpcSuccess(result)) {
      return { success: true, history: result.data.history };
    }
    return { success: false, history: '' };
  },

  // Agent terminal state
  getAgentTerminalState: async (
    workspacePath: string,
    agentId: string
  ): Promise<{ success: boolean; state: AgentTerminalState | null }> => {
    const result: IpcResult<{ state: AgentTerminalState | null }> = await ipcRenderer.invoke(
      'get-agent-terminal-state',
      workspacePath,
      agentId
    );
    if (isIpcSuccess(result)) {
      return { success: true, state: result.data.state };
    }
    return { success: false, state: null };
  },

  setAgentTerminalState: async (
    workspacePath: string,
    agentId: string,
    state: { viewState?: AgentTerminalViewState | null }
  ): Promise<{ success: boolean }> => {
    const result: IpcResult<void> = await ipcRenderer.invoke(
      'set-agent-terminal-state',
      workspacePath,
      agentId,
      state
    );
    return isIpcSuccess(result) ? { success: true } : { success: false };
  },

  clearAgentTerminalState: async (agentId: string): Promise<{ success: boolean }> => {
    const result: IpcResult<void> = await ipcRenderer.invoke('clear-agent-terminal-state', agentId);
    return isIpcSuccess(result) ? { success: true } : { success: false };
  },

  getAgentTerminalDraft: async (
    workspacePath: string,
    agentId: string
  ): Promise<{ success: boolean; draft: string | null }> => {
    const result: IpcResult<{ draft: string | null }> = await ipcRenderer.invoke(
      'get-agent-terminal-draft',
      workspacePath,
      agentId
    );
    if (isIpcSuccess(result)) {
      return { success: true, draft: result.data.draft };
    }
    return { success: false, draft: null };
  },

  setAgentTerminalDraft: async (
    workspacePath: string,
    agentId: string,
    draft: string
  ): Promise<{ success: boolean }> => {
    const result: IpcResult<void> = await ipcRenderer.invoke(
      'set-agent-terminal-draft',
      workspacePath,
      agentId,
      draft
    );
    return isIpcSuccess(result) ? { success: true } : { success: false };
  },

  agentConnectRunAgent: async (payload: {
    agentId: string;
    workspacePath: string;
    relativePath: string;
    prompt: string;
    resumeSessionId?: string | null;
    runId?: string;
    tutorialMode?: boolean;
  }): Promise<{ success: boolean; runId: string; error?: string }> => {
    const result: IpcResult<{ runId: string }> = await ipcRenderer.invoke('agentconnect-run-agent', payload);
    if (isIpcSuccess(result)) {
      return { success: true, ...result.data };
    }
    return { success: false, runId: payload.runId ?? '', error: result.error };
  },

  // Hero
  loadHero: async (workspacePath: string): Promise<Hero> => {
    const result: IpcResult<Hero> = await ipcRenderer.invoke('load-hero', workspacePath);
    return unwrap(result, DEFAULT_HERO);
  },

  updateHeroPosition: async (workspacePath: string, x: number, y: number): Promise<boolean> => {
    const result: IpcResult<boolean> = await ipcRenderer.invoke('update-hero-position', workspacePath, x, y);
    return unwrap(result, false);
  },

  updateHeroName: async (workspacePath: string, name: string): Promise<boolean> => {
    const result: IpcResult<boolean> = await ipcRenderer.invoke('update-hero-name', workspacePath, name);
    return unwrap(result, false);
  },

  setHeroMovementIntent: async (workspacePath: string, movementIntent: MovementIntent): Promise<boolean> => {
    const result: IpcResult<boolean> = await ipcRenderer.invoke('set-hero-movement-intent', {
      workspacePath,
      movementIntent,
    });
    return unwrap(result, false);
  },

  setHeroProvider: async (
    workspacePath: string,
    provider: AgentProvider
  ): Promise<{ success: boolean; error?: string }> => {
    const result: IpcResult<void> = await ipcRenderer.invoke('hero-set-provider', workspacePath, provider);
    return isIpcSuccess(result) ? { success: true } : { success: false, error: result.error };
  },

  setHeroModel: async (
    workspacePath: string,
    model: string
  ): Promise<{ success: boolean; error?: string }> => {
    const result: IpcResult<void> = await ipcRenderer.invoke('hero-set-model', workspacePath, model);
    return isIpcSuccess(result) ? { success: true } : { success: false, error: result.error };
  },

  listMcpSkills: async (): Promise<McpSkillDescriptor[]> => {
    const result: IpcResult<McpSkillDescriptor[]> = await ipcRenderer.invoke('mcp-skills-list');
    return unwrap(result, []);
  },

  getHeroMcpSkills: async (workspacePath: string): Promise<{ skillIds: McpSkillId[] }> => {
    const result: IpcResult<{ skillIds: McpSkillId[] }> = await ipcRenderer.invoke('hero-get-mcp-skills', {
      workspacePath,
    });
    return unwrap(result, { skillIds: [] });
  },

  setHeroMcpSkills: async (
    workspacePath: string,
    skillIds: McpSkillId[]
  ): Promise<{ success: boolean; error?: string }> => {
    const result: IpcResult<{ skillIds: McpSkillId[] }> = await ipcRenderer.invoke('hero-set-mcp-skills', {
      workspacePath,
      skillIds,
    });
    return toSuccessWithError(result);
  },

  heroSendPrompt: async (payload: {
    workspacePath: string;
    relativePath: string;
    prompt: string;
    runId?: string;
    tutorialMode?: boolean;
  }): Promise<{ success: boolean; runId?: string; error?: string }> => {
    const result: IpcResult<{ runId: string }> = await ipcRenderer.invoke('hero-send-prompt', payload);
    return toSuccessWithError(result);
  },

  // AgentConnect
  agentConnectBootstrap: async (): Promise<ProviderRegistrySnapshot> => {
    const result: IpcResult<ProviderRegistrySnapshot> = await ipcRenderer.invoke('agentconnect-bootstrap');
    return unwrap(result, {
      providers: [],
      providerStatus: {},
      recentModels: {},
      recentModelInfo: {},
      loading: true,
      updatedAt: null,
    });
  },

  agentConnectProviderStatus: async (
    provider: AgentProvider,
    options?: { force?: boolean }
  ): Promise<ProviderStatus | null> => {
    const result: IpcResult<ProviderStatus | null> = await ipcRenderer.invoke(
      'agentconnect-provider-status',
      provider,
      options
    );
    return unwrap(result, null);
  },

  agentConnectProviderInstall: async (provider: AgentProvider): Promise<ProviderStatus | null> => {
    const result: IpcResult<ProviderStatus | null> = await ipcRenderer.invoke(
      'agentconnect-provider-install',
      provider
    );
    return unwrap(result, null);
  },

  agentConnectProviderLogin: async (provider: AgentProvider): Promise<{ loggedIn: boolean }> => {
    const result: IpcResult<{ loggedIn: boolean }> = await ipcRenderer.invoke(
      'agentconnect-provider-login',
      provider
    );
    return unwrap(result, { loggedIn: false });
  },

  agentConnectProvidersRefresh: async (options?: { force?: boolean }): Promise<ProviderRegistrySnapshot> => {
    const result: IpcResult<ProviderRegistrySnapshot> = await ipcRenderer.invoke(
      'agentconnect-providers-refresh',
      options
    );
    return unwrap(result, {
      providers: [],
      providerStatus: {},
      recentModels: {},
      recentModelInfo: {},
      loading: true,
      updatedAt: null,
    });
  },

  agentConnectModelsRecent: async (
    provider: AgentProvider,
    options?: { force?: boolean }
  ): Promise<AgentModelInfo[]> => {
    const result: IpcResult<AgentModelInfo[]> = await ipcRenderer.invoke(
      'agentconnect-models-recent',
      provider,
      options
    );
    return unwrap(result, []);
  },

  agentConnectCancelAgentRun: async (agentId: string): Promise<{ success: boolean; error?: string }> => {
    const result: IpcResult<boolean> = await ipcRenderer.invoke('agentconnect-cancel-agent', agentId);
    return isIpcSuccess(result) ? { success: true } : { success: false, error: result.error };
  },

  agentConnectCancelHeroRun: async (workspacePath: string): Promise<{ success: boolean; error?: string }> => {
    const result: IpcResult<boolean> = await ipcRenderer.invoke('agentconnect-cancel-hero', workspacePath);
    return isIpcSuccess(result) ? { success: true } : { success: false, error: result.error };
  },

  updateAgentModel: async (agentId: string, model: string): Promise<{ success: boolean; error?: string }> => {
    const result: IpcResult<void> = await ipcRenderer.invoke('update-agent-model', agentId, model);
    return isIpcSuccess(result) ? { success: true } : { success: false, error: result.error };
  },

  updateAgentReasoningEffort: async (
    agentId: string,
    reasoningEffort: string | null
  ): Promise<{ success: boolean; error?: string }> => {
    const result: IpcResult<void> = await ipcRenderer.invoke(
      'update-agent-reasoning-effort',
      agentId,
      reasoningEffort
    );
    return isIpcSuccess(result) ? { success: true } : { success: false, error: result.error };
  },

  // Licensing
  licenseRegisterDevice: async (): Promise<
    { success: boolean; error?: string } & Partial<LicenseStatusResponse>
  > => {
    const result: IpcResult<LicenseStatusResponse> = await ipcRenderer.invoke('license-register');
    return toSuccessWithError(result);
  },

  licenseStatus: async (): Promise<{ success: boolean; error?: string } & Partial<LicenseStatusResponse>> => {
    const result: IpcResult<LicenseStatusResponse> = await ipcRenderer.invoke('license-status');
    return toSuccessWithError(result);
  },

  licenseStartCheckout: async (
    plan?: LicenseCheckoutPlan
  ): Promise<{ success: boolean; error?: string } & Partial<LicenseCheckoutStart>> => {
    const result: IpcResult<LicenseCheckoutStart> = await ipcRenderer.invoke('license-start-checkout', {
      plan,
    });
    return toSuccessWithError(result);
  },

  licenseConfirmCheckout: async (
    sessionId: string
  ): Promise<{ success: boolean; error?: string } & Partial<LicenseStatusResponse>> => {
    const result: IpcResult<LicenseStatusResponse> = await ipcRenderer.invoke('license-confirm-checkout', {
      sessionId,
    });
    return toSuccessWithError(result);
  },

  licensePairingStart: async (): Promise<
    { success: boolean; error?: string } & Partial<LicensePairingStart>
  > => {
    const result: IpcResult<LicensePairingStart> = await ipcRenderer.invoke('license-pairing-start');
    return toSuccessWithError(result);
  },

  licensePairingClaim: async (
    code: string
  ): Promise<{ success: boolean; error?: string } & Partial<LicenseStatusResponse>> => {
    const result: IpcResult<LicenseStatusResponse> = await ipcRenderer.invoke('license-pairing-claim', code);
    return toSuccessWithError(result);
  },
  licenseManageBilling: async (): Promise<{ success: boolean; error?: string } & { url?: string }> => {
    const result: IpcResult<{ url: string }> = await ipcRenderer.invoke('license-manage-billing');
    return toSuccessWithError(result);
  },

  verifyLicenseToken: async (
    token: string
  ): Promise<{
    success: boolean;
    valid?: boolean;
    expired?: boolean;
    payload?: LicenseTokenPayload;
    error?: string;
  }> => {
    try {
      const result = verifyLicenseToken(token);
      return { success: true, ...result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  },

  checkNetworkStatus: async (): Promise<{ success: boolean; online?: boolean; error?: string }> => {
    const result: IpcResult<boolean> = await ipcRenderer.invoke('network-check');
    return isIpcSuccess(result)
      ? { success: true, online: result.data }
      : { success: false, error: result.error };
  },

  // Updates
  getUpdateStatus: async (): Promise<UpdateStatus> => {
    const result: IpcResult<UpdateStatus> = await ipcRenderer.invoke('update-get-status');
    return unwrap(result, {
      available: false,
      version: null,
      downloaded: false,
      downloading: false,
      error: null,
    });
  },

  checkForUpdates: async (): Promise<UpdateStatus> => {
    const result: IpcResult<UpdateStatus> = await ipcRenderer.invoke('update-check');
    return unwrap(result, {
      available: false,
      version: null,
      downloaded: false,
      downloading: false,
      error: null,
    });
  },

  installUpdate: async (): Promise<UpdateStatus> => {
    const result: IpcResult<UpdateStatus> = await ipcRenderer.invoke('update-install');
    return unwrap(result, {
      available: false,
      version: null,
      downloaded: false,
      downloading: false,
      error: null,
    });
  },

  // Settings
  loadSettings: async (): Promise<AppSettings> => {
    const result: IpcResult<AppSettings> = await ipcRenderer.invoke('load-settings');
    return unwrap(result, {});
  },

  saveSettings: async (settings: Partial<AppSettings>): Promise<boolean> => {
    const result: IpcResult<boolean> = await ipcRenderer.invoke('save-settings', settings);
    return unwrap(result, false);
  },
  ensureTutorialDevServer: async (workspacePath: string, scenario: TutorialScenario): Promise<boolean> => {
    const result: IpcResult<boolean> = await ipcRenderer.invoke('ensure-tutorial-dev-server', {
      workspacePath,
      scenario,
    });
    return unwrap(result, false);
  },
  accelerateTutorialRun: async (runId: string): Promise<boolean> => {
    const result: IpcResult<boolean> = await ipcRenderer.invoke('accelerate-tutorial-run', { runId });
    return unwrap(result, false);
  },

  // Events
  onAgentConnectEvent: (handler: (data: AgentConnectEventPayload) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, data: AgentConnectEventPayload) => handler(data);
    ipcRenderer.on('agentconnect-event', listener);
    return () => {
      ipcRenderer.removeListener('agentconnect-event', listener);
    };
  },

  onAgentNotificationClick: (handler: (data: AgentNotificationClickPayload) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, data: AgentNotificationClickPayload) => handler(data);
    ipcRenderer.on('agent-notification-click', listener);
    return () => {
      ipcRenderer.removeListener('agent-notification-click', listener);
    };
  },

  onLicenseUpdated: (handler: (status: LicenseStatusResponse) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, status: LicenseStatusResponse) => handler(status);
    ipcRenderer.on('license-updated', listener);
    return () => {
      ipcRenderer.removeListener('license-updated', listener);
    };
  },

  onLicenseError: (handler: (data: { error: string }) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, data: { error: string }) => handler(data);
    ipcRenderer.on('license-error', listener);
    return () => {
      ipcRenderer.removeListener('license-error', listener);
    };
  },

  onUpdateStatus: (handler: (status: UpdateStatus) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, status: UpdateStatus) => handler(status);
    ipcRenderer.on('update-status', listener);
    return () => {
      ipcRenderer.removeListener('update-status', listener);
    };
  },

  setWorkspaceNotificationsEnabled: (enabled: boolean): void => {
    ipcRenderer.send('workspace-notifications-enabled', { enabled });
  },

  onTerminalOutput: (
    handler: (data: { terminalId: string; data: string; sessionToken?: string }) => void
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      data: { terminalId: string; data: string; sessionToken?: string }
    ) => handler(data);
    ipcRenderer.on('terminal-output', listener);
    return () => {
      ipcRenderer.removeListener('terminal-output', listener);
    };
  },

  onTerminalExit: (
    handler: (data: { terminalId: string; exitCode: number; signal?: number; sessionToken?: string }) => void
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      data: { terminalId: string; exitCode: number; signal?: number; sessionToken?: string }
    ) => handler(data);
    ipcRenderer.on('terminal-exit', listener);
    return () => {
      ipcRenderer.removeListener('terminal-exit', listener);
    };
  },

  onTerminalCwdChange: (
    handler: (data: {
      terminalId: string;
      path: string;
      relativePath?: string;
      sessionToken?: string;
    }) => void
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      data: { terminalId: string; path: string; relativePath?: string; sessionToken?: string }
    ) => handler(data);
    ipcRenderer.on('terminal-cwd', listener);
    return () => {
      ipcRenderer.removeListener('terminal-cwd', listener);
    };
  },

  onTerminalProcessChange: (
    handler: (data: { terminalId: string; processName: string; sessionToken?: string }) => void
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      data: { terminalId: string; processName: string; sessionToken?: string }
    ) => handler(data);
    ipcRenderer.on('terminal-process', listener);
    return () => {
      ipcRenderer.removeListener('terminal-process', listener);
    };
  },

  onTerminalCommand: (
    handler: (data: { terminalId: string; command: string; sessionToken?: string }) => void
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      data: { terminalId: string; command: string; sessionToken?: string }
    ) => handler(data);
    ipcRenderer.on('terminal-command', listener);
    return () => {
      ipcRenderer.removeListener('terminal-command', listener);
    };
  },

  onAgentsUpdated: (handler: (data: { workspacePath: string; agents: Agent[] }) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, data: { workspacePath: string; agents: Agent[] }) =>
      handler(data);
    ipcRenderer.on('agents-updated', listener);
    return () => {
      ipcRenderer.removeListener('agents-updated', listener);
    };
  },

  onAgentConnectProvidersUpdated: (handler: (snapshot: ProviderRegistrySnapshot) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, snapshot: ProviderRegistrySnapshot) => handler(snapshot);
    ipcRenderer.on('agentconnect-providers-updated', listener);
    return () => {
      ipcRenderer.removeListener('agentconnect-providers-updated', listener);
    };
  },

  // Command bridge
  onCommandRunRequest: (handler: (request: CommandRunRequest) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, request: CommandRunRequest) => handler(request);
    ipcRenderer.on('command-run-request', listener);
    return () => {
      ipcRenderer.removeListener('command-run-request', listener);
    };
  },

  sendCommandRunResponse: (response: CommandRunResponse): void => {
    ipcRenderer.send('command-run-response', response);
  },

  onLayoutRequest: (handler: (request: LayoutRequest) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, request: LayoutRequest) => handler(request);
    ipcRenderer.on('layout-request', listener);
    return () => {
      ipcRenderer.removeListener('layout-request', listener);
    };
  },

  sendLayoutResponse: (response: LayoutResponse): void => {
    ipcRenderer.send('layout-response', response);
  },

  // Window management
  bringWindowToFront: async (): Promise<boolean> => {
    const result: IpcResult<boolean> = await ipcRenderer.invoke('bring-window-to-front');
    return unwrap(result, false);
  },

  // Telemetry
  getPosthogConfig: async (): Promise<{ apiKey: string; host: string } | null> => {
    const apiKey = (process.env.POSTHOG_API_KEY ?? process.env.VITE_POSTHOG_API_KEY ?? '').trim();
    if (!apiKey) return null;

    const host = (
      process.env.POSTHOG_HOST ??
      process.env.VITE_POSTHOG_HOST ??
      'https://app.posthog.com'
    ).trim();
    return { apiKey, host };
  },

  captureTelemetryEvent: async (payload: {
    event: string;
    properties?: Record<string, unknown>;
  }): Promise<{ success: boolean; error?: string }> => {
    const result: IpcResult<void> = await ipcRenderer.invoke('capture-telemetry-event', payload);
    return isIpcSuccess(result) ? { success: true } : { success: false, error: result.error };
  },

  getTelemetryContext: async (): Promise<{
    distinctId: string;
    version: string;
    platform: string;
  } | null> => {
    const result: IpcResult<{ distinctId: string; version: string; platform: string } | null> =
      await ipcRenderer.invoke('get-telemetry-context');
    return unwrap(result, null);
  },

  getSystemIdleTime: async (): Promise<number> => {
    const result: IpcResult<number> = await ipcRenderer.invoke('get-system-idle-time');
    return unwrap(result, 0);
  },

  getWindowId: async (): Promise<number | null> => {
    const result: IpcResult<number | null> = await ipcRenderer.invoke('get-window-id');
    return unwrap(result, null);
  },

  onPowerSuspend: (handler: () => void): (() => void) => {
    const listener = () => handler();
    ipcRenderer.on('power-suspend', listener);
    return () => {
      ipcRenderer.removeListener('power-suspend', listener);
    };
  },

  onPowerResume: (handler: () => void): (() => void) => {
    const listener = () => handler();
    ipcRenderer.on('power-resume', listener);
    return () => {
      ipcRenderer.removeListener('power-resume', listener);
    };
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
