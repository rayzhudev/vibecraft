import type {
  Agent,
  AgentProvider,
  BrowserPanel,
  TerminalPanel,
  Folder,
  Hero,
  AvailableFolder,
  Workspace,
  AttachAgentPayload,
  SpawnAgentPayload,
  MovementIntent,
  ProviderRegistrySnapshot,
  ProviderStatus,
  AgentModelInfo,
  AppSettings,
  TutorialScenario,
  ImportedCustomSound,
  McpSkillDescriptor,
  McpSkillId,
} from '../../shared/types';

const createMockElectronApi = () =>
  new Proxy(
    {},
    {
      get: () => () => Promise.resolve(undefined),
    }
  ) as typeof window.electronAPI;

type ElectronApiType = typeof window.electronAPI;
const api: ElectronApiType =
  (typeof window !== 'undefined' && (window as Window & { electronAPI?: ElectronApiType }).electronAPI) ||
  (globalThis as unknown as { electronAPI?: ElectronApiType }).electronAPI ||
  createMockElectronApi();

export const workspaceClient = {
  // Loaders
  loadHero: (workspacePath: string): Promise<Hero> => api.loadHero(workspacePath),
  loadAgents: (workspacePath: string): Promise<Agent[]> => api.loadAgents(workspacePath),
  loadFolders: (workspacePath: string): Promise<Folder[]> => api.loadFolders(workspacePath),
  loadBrowserPanels: (workspacePath: string): Promise<BrowserPanel[]> => api.loadBrowserPanels(workspacePath),
  listAvailableFolders: (workspacePath: string): Promise<AvailableFolder[]> =>
    api.listAvailableFolders(workspacePath),

  // Workspace metadata
  updateHeroPosition: (workspacePath: string, x: number, y: number) =>
    api.updateHeroPosition(workspacePath, x, y),
  updateHeroName: (workspacePath: string, name: string) => api.updateHeroName(workspacePath, name),
  setHeroMovementIntent: (workspacePath: string, movementIntent: MovementIntent) =>
    api.setHeroMovementIntent(workspacePath, movementIntent),
  setHeroProvider: (workspacePath: string, provider: AgentProvider) =>
    api.setHeroProvider(workspacePath, provider),
  setHeroModel: (workspacePath: string, model: string) => api.setHeroModel(workspacePath, model),
  listMcpSkills: (): Promise<McpSkillDescriptor[]> => api.listMcpSkills(),
  getHeroMcpSkills: (workspacePath: string): Promise<{ skillIds: McpSkillId[] }> =>
    api.getHeroMcpSkills(workspacePath),
  setHeroMcpSkills: (workspacePath: string, skillIds: McpSkillId[]) =>
    api.setHeroMcpSkills(workspacePath, skillIds),
  heroSendPrompt: (payload: {
    workspacePath: string;
    relativePath: string;
    prompt: string;
    runId?: string;
    tutorialMode?: boolean;
    tutorialScenario?: TutorialScenario;
  }): Promise<{ success: boolean; runId?: string; error?: string }> => api.heroSendPrompt(payload),
  agentConnectRunAgent: (payload: {
    agentId: string;
    workspacePath: string;
    relativePath: string;
    prompt: string;
    runId?: string;
    resumeSessionId?: string | null;
    tutorialMode?: boolean;
    tutorialScenario?: TutorialScenario;
  }): Promise<{ success: boolean; runId?: string; error?: string }> => api.agentConnectRunAgent(payload),
  updateAgentPosition: (workspacePath: string, agentId: string, x: number, y: number) =>
    api.updateAgentPosition(workspacePath, agentId, x, y),
  updateAgentModel: (agentId: string, model: string): Promise<{ success: boolean; error?: string }> =>
    api.updateAgentModel(agentId, model),
  updateAgentUnreadCompletion: (workspacePath: string, agentId: string, hasUnreadCompletion: boolean) =>
    api.updateAgentUnreadCompletion(workspacePath, agentId, hasUnreadCompletion),
  getAgentMcpSkills: (workspacePath: string, agentId: string): Promise<{ skillIds: McpSkillId[] }> =>
    api.getAgentMcpSkills(workspacePath, agentId),
  setAgentMcpSkills: (workspacePath: string, agentId: string, skillIds: McpSkillId[]) =>
    api.setAgentMcpSkills(workspacePath, agentId, skillIds),
  setAgentMovementIntent: (workspacePath: string, agentId: string, movementIntent: MovementIntent) =>
    api.setAgentMovementIntent(workspacePath, agentId, movementIntent),
  updateFolderPosition: (workspacePath: string, folderId: string, x: number, y: number) =>
    api.updateFolderPosition(workspacePath, folderId, x, y),
  updateBrowserPanel: (workspacePath: string, id: string, updates: Partial<BrowserPanel>): Promise<boolean> =>
    api.updateBrowserPanel(workspacePath, id, updates),

  // Folder lifecycle
  createFolder: (workspacePath: string, name: string, x: number, y: number) =>
    api.createFolder(workspacePath, name, x, y),
  importExistingFolder: (workspacePath: string, relativePath: string, x: number, y: number) =>
    api.importExistingFolder(workspacePath, relativePath, x, y),
  renameFolder: (
    workspacePath: string,
    folderId: string,
    newName: string
  ): Promise<{ success: boolean; error?: string }> => api.renameFolder(workspacePath, folderId, newName),
  removeFolder: (
    workspacePath: string,
    folderId: string
  ): Promise<{ success: boolean; detachedAgentIds?: string[] }> => api.removeFolder(workspacePath, folderId),
  deleteFolder: (
    workspacePath: string,
    folderId: string
  ): Promise<{ success: boolean; error?: string; detachedAgentIds?: string[] }> =>
    api.deleteFolder(workspacePath, folderId),
  probeFolderGit: (workspacePath: string, relativePath: string) =>
    api.probeFolderGit(workspacePath, relativePath),

  // Worktrees
  createGitWorktree: (workspacePath: string, folderId: string, x: number, y: number) =>
    api.createGitWorktree(workspacePath, folderId, x, y),
  worktreeSyncFromSource: (workspacePath: string, folderId: string) =>
    api.worktreeSyncFromSource(workspacePath, folderId),
  worktreeMergeToSource: (
    workspacePath: string,
    folderId: string
  ): Promise<{ success: boolean; error?: string; message?: string; detachedAgentIds?: string[] }> =>
    api.worktreeMergeToSource(workspacePath, folderId),
  worktreeUndoMerge: (workspacePath: string, folderId: string) =>
    api.worktreeUndoMerge(workspacePath, folderId),
  worktreeRetryRestore: (workspacePath: string, folderId: string) =>
    api.worktreeRetryRestore(workspacePath, folderId),
  refreshFolderConflictState: (workspacePath: string, folderId: string) =>
    api.refreshFolderConflictState(workspacePath, folderId),

  // Agent lifecycle
  spawnAgent: (payload: SpawnAgentPayload) => api.spawnAgent(payload),
  destroyAgent: (workspacePath: string, agentId: string) => api.destroyAgent(workspacePath, agentId),
  agentAttachToFolder: (payload: AttachAgentPayload) => api.agentAttachToFolder(payload),
  agentDetach: (agentId: string, workspacePath: string) => api.agentDetach(agentId, workspacePath),
  clearAgentTerminalState: (agentId: string) => api.clearAgentTerminalState(agentId),
  updateAgentName: (workspacePath: string, agentId: string, displayName: string) =>
    api.updateAgentName(workspacePath, agentId, displayName),

  // Browsers
  createBrowserPanel: (
    workspacePath: string,
    url: string,
    x: number,
    y: number,
    width: number,
    height: number,
    originFolderId?: string
  ) => api.createBrowserPanel(workspacePath, url, x, y, width, height, originFolderId),
  deleteBrowserPanel: (workspacePath: string, id: string) => api.deleteBrowserPanel(workspacePath, id),

  // Terminals
  loadTerminals: (workspacePath: string): Promise<TerminalPanel[]> => api.loadTerminals(workspacePath),
  createTerminal: (
    workspacePath: string,
    relativePath: string,
    x: number,
    y: number,
    originFolderId?: string,
    width?: number,
    height?: number
  ) => api.createTerminal(workspacePath, relativePath, x, y, originFolderId, width, height),
  updateTerminal: (workspacePath: string, terminalId: string, updates: Partial<TerminalPanel>) =>
    api.updateTerminal(workspacePath, terminalId, updates),
  deleteTerminal: (workspacePath: string, terminalId: string) =>
    api.deleteTerminal(workspacePath, terminalId),
  startTerminalSession: (payload: {
    terminalId: string;
    workspacePath: string;
    relativePath?: string;
    cols?: number;
    rows?: number;
    sessionToken?: string;
  }) => api.startTerminalSession(payload),
  sendTerminalInput: (terminalId: string, data: string) => api.sendTerminalInput(terminalId, data),
  resizeTerminal: (terminalId: string, cols: number, rows: number) =>
    api.resizeTerminal(terminalId, cols, rows),
  stopTerminalSession: (terminalId: string) => api.stopTerminalSession(terminalId),

  // AgentConnect
  agentConnectBootstrap: (): Promise<ProviderRegistrySnapshot> => api.agentConnectBootstrap(),
  agentConnectProviderStatus: (
    provider: AgentProvider,
    options?: { force?: boolean }
  ): Promise<ProviderStatus | null> => api.agentConnectProviderStatus(provider, options),
  agentConnectProviderInstall: (provider: AgentProvider): Promise<ProviderStatus | null> =>
    api.agentConnectProviderInstall(provider),
  agentConnectProviderLogin: (provider: AgentProvider): Promise<{ loggedIn: boolean }> =>
    api.agentConnectProviderLogin(provider),
  agentConnectProvidersRefresh: (options?: { force?: boolean }): Promise<ProviderRegistrySnapshot> =>
    api.agentConnectProvidersRefresh(options),
  agentConnectModelsRecent: (
    provider: AgentProvider,
    options?: { force?: boolean }
  ): Promise<AgentModelInfo[]> => api.agentConnectModelsRecent(provider, options),
  agentConnectCancelAgentRun: (agentId: string): Promise<{ success: boolean; error?: string }> =>
    api.agentConnectCancelAgentRun(agentId),
  agentConnectCancelHeroRun: (workspacePath: string): Promise<{ success: boolean; error?: string }> =>
    api.agentConnectCancelHeroRun(workspacePath),

  updateAgentReasoningEffort: (agentId: string, reasoningEffort: string | null) =>
    api.updateAgentReasoningEffort(agentId, reasoningEffort),

  // Settings
  loadSettings: (): Promise<AppSettings> => api.loadSettings(),
  saveSettings: (settings: Partial<AppSettings>): Promise<boolean> => api.saveSettings(settings),
  importCustomSound: (): Promise<ImportedCustomSound | null> => api.importCustomSound(),
  ensureTutorialDevServer: (workspacePath: string, scenario: TutorialScenario) =>
    api.ensureTutorialDevServer(workspacePath, scenario),
  accelerateTutorialRun: (runId: string): Promise<boolean> => api.accelerateTutorialRun(runId),

  // Workspaces (misc)
  addRecentWorkspace: (workspace: Workspace) => api.addRecentWorkspace(workspace),
};
