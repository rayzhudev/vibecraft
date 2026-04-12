// Entity types for canvas
import type { CommandRunRequest, CommandRunResponse } from './commands';
import type { LayoutRequest, LayoutResponse } from './layout';
import type { SupportedAgentProvider } from './providers';

export type UnitType = 'hero' | 'agent';
export type BuildingType = 'folder' | 'browser' | 'terminal';
export type WindowedBuildingType = 'browser' | 'terminal';
export type EntityType = UnitType | BuildingType;
export type EntityKind = 'unit' | 'building';

export interface Position {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

// Agent types
export type AgentProvider = SupportedAgentProvider;
// Agent status reflects presence plus active runs.
// - `online`: attached to a folder and ready to run prompts
// - `offline`: not attached
// - `working`: actively running a prompt
// - `error`: misconfigured/unavailable (optional; presence still comes from attachment)
export type AgentStatus = 'online' | 'offline' | 'working' | 'error';

export type MovementIntentType = 'move' | 'move+attach';

export type TokenUsage = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  cached_input_tokens?: number;
  reasoning_tokens?: number;
};

export type ContextUsage = {
  context_window?: number;
  context_tokens?: number;
  context_cached_tokens?: number;
  context_remaining_tokens?: number;
  context_truncated?: boolean;
};

export type ProviderDetail = {
  eventType: string;
  data?: Record<string, unknown>;
  raw?: unknown;
};

export type ProviderStatusState = 'ready' | 'installing' | 'error' | 'missing' | 'unknown';

export type ProviderDescriptor = {
  id: string;
  name: string;
};

export type ReasoningEffortOption = {
  id: string;
  label?: string;
};

export type AgentModelInfo = {
  id: string;
  provider: AgentProvider;
  displayName?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  reasoningEfforts?: ReasoningEffortOption[];
  defaultReasoningEffort?: string;
  supportsMultimodalInput?: boolean;
};

export type ProviderStatus = {
  providerId: string;
  state: ProviderStatusState;
  installed?: boolean;
  message?: string;
};

export type McpSkillId = string;
export const VIBECRAFT_CORE_MCP_SKILL_ID = 'vibecraft-core';
export const VIBECRAFT_DOCS_MCP_SKILL_ID = 'vibecraft-docs';

export type McpServerConfig = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  enabled?: boolean;
};

export type McpSkillDescriptor = {
  id: McpSkillId;
  name: string;
  description?: string;
  unitTypes: Array<'agent' | 'hero'>;
  providerAllowList?: AgentProvider[];
  requiredForHero?: boolean;
};

export type ProviderRegistrySnapshot = {
  providers: ProviderDescriptor[];
  providerStatus: Record<string, ProviderStatus | null>;
  recentModels: Record<string, string[]>;
  recentModelInfo: Record<string, AgentModelInfo[]>;
  loading: boolean;
  updatedAt: number | null;
};

export type AgentTerminalEntry =
  | {
      id: string;
      type: 'message';
      role: 'assistant' | 'user' | 'system';
      content: string;
      messageId?: string;
      usage?: TokenUsage;
      variant?: 'thinking';
    }
  | {
      id: string;
      type: 'tool';
      title: string;
      status?: string;
      name?: string;
      input?: string;
      meta?: string;
      output?: string;
      expanded?: boolean;
    };

export type AgentTerminalViewState = {
  expandedEntryIds?: string[];
  searchOpen?: boolean;
  searchQuery?: string;
  activeMatchIndex?: number;
  renderWindow?: { start: number; end: number };
  autoScrollPinned?: boolean;
  scrollTop?: number;
  contextUsage?: ContextUsage | null;
  lastRunDuration?: number | null;
  statusStartedAt?: number | null;
  agentStatus?: 'idle' | 'thinking' | 'error';
  toolStatus?: { state: 'running' | 'error'; command: string } | null;
  queuedPrompts?: string[];
};

export type AgentTerminalState = {
  entries: AgentTerminalEntry[];
  viewState?: AgentTerminalViewState | null;
};

export type AgentConnectEvent =
  | {
      type: 'status';
      status: 'thinking' | 'idle' | 'error';
      message?: string;
    }
  | {
      type: 'delta';
      text: string;
    }
  | {
      type: 'final';
      sessionId?: string | null;
      usage?: TokenUsage;
      cancelled?: boolean;
    }
  | {
      type: 'summary';
      summary: string;
      source?: string;
      model?: string | null;
      createdAt?: string;
    }
  | {
      type: 'context_usage';
      contextUsage: ContextUsage;
      provider?: string;
      providerDetail?: ProviderDetail;
    }
  | {
      type: 'message';
      role: 'assistant' | 'user' | 'system';
      content: string;
      messageId?: string;
      usage?: TokenUsage;
    }
  | {
      type: 'detail';
      provider?: string;
      providerDetail?: ProviderDetail;
    }
  | {
      type: 'tool_call';
      phase: 'start' | 'complete';
      callId: string;
      name?: string;
      input?: string;
      output?: string;
      status?: string;
    }
  | {
      type: 'thinking';
      text?: string;
    }
  | {
      type: 'raw_line';
      line: string;
    }
  | {
      type: 'usage';
      usage: TokenUsage;
      messageId?: string;
    }
  | {
      type: 'error';
      message: string;
    };

export type AgentConnectEventPayload = {
  runId: string;
  unit: { type: 'agent' | 'hero'; id: string };
  event: AgentConnectEvent;
};

export type AgentNotificationClickPayload = {
  workspacePath: string;
  agentId: string;
};

export interface MovementIntent {
  startPos: Position;
  targetPos: Position;
  startTime: number;
  duration: number;
  intentType: MovementIntentType;
  targetId?: string;
}

export interface Agent {
  id: string;
  provider: AgentProvider;
  model: string;
  color: string;
  reasoningEffort?: string | null;
  agentConnectSessionId?: string | null;
  providerSessionId?: string | null;
  contextWindow?: number;
  name: string;
  displayName: string;
  workspacePath: string;
  x: number;
  y: number;
  status: AgentStatus;
  attachedFolderId?: string;
  terminalId?: string;
  movementIntent?: MovementIntent;
  // Percent (0-100) of context window remaining for the agent.
  contextLeft?: number;
  totalTokensUsed?: number;
  summary?: string | null;
  summarySource?: string | null;
  summaryModel?: string | null;
  summaryCreatedAt?: string | null;
  hasUnreadCompletion?: boolean;
  mcpSkillIds?: McpSkillId[];
}

// Hero agent
export interface Hero {
  id: 'hero';
  name: string;
  provider: AgentProvider;
  model: string;
  reasoningEffort?: string | null;
  agentConnectSessionId?: string | null;
  providerSessionId?: string | null;
  providerSessionIds?: Partial<Record<AgentProvider, string | null>>;
  contextWindow?: number;
  contextLeft?: number;
  totalTokensUsed?: number;
  x: number;
  y: number;
  movementIntent?: MovementIntent;
  mcpSkillIds?: McpSkillId[];
}

// Folder entity
export interface FolderConflictState {
  kind: 'merge' | 'restore';
  stashRef?: string;
  sourceHead?: string;
  worktreeHead?: string;
  worktreeId?: string;
  message?: string;
}

interface BaseFolder {
  kind: 'folder' | 'worktree';
  id: string;
  name: string;
  relativePath: string;
  x: number;
  y: number;
  createdAt: number;
  conflictState?: FolderConflictState;
  sourceBranch?: string;
  worktreeBranch?: string;
  sourceRelativePath?: string;
  isWorktree?: boolean;
}

export interface Folder extends BaseFolder {
  kind: 'folder';
  isWorktree?: false;
  sourceRelativePath?: undefined;
  sourceBranch?: undefined;
  worktreeBranch?: undefined;
}

export interface WorktreeFolder extends BaseFolder {
  kind: 'worktree';
  isWorktree: true;
  sourceRelativePath: string;
}

export type AnyFolder = Folder | WorktreeFolder;

export interface AvailableFolder {
  name: string;
  relativePath: string;
  children?: AvailableFolder[];
  isImported?: boolean;
  depth?: number;
}

// Browser panel
export interface BrowserPanel {
  id: string;
  url: string;
  faviconUrl?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  createdAt: number;
  refreshToken?: number;
  originFolderId?: string;
}

// Terminal panel
export interface TerminalPanel {
  id: string;
  originFolderId?: string;
  originFolderName?: string;
  originRelativePath?: string;
  lastKnownCwd?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  createdAt: number;
  lastUsedAt?: number;
}

export type EntityByType = {
  hero: Hero;
  agent: Agent;
  folder: AnyFolder;
  browser: BrowserPanel;
  terminal: TerminalPanel;
};

export type WorldEntity =
  | (Hero & { type: 'hero'; entityKind: 'unit' })
  | (Agent & { type: 'agent'; entityKind: 'unit' })
  | (AnyFolder & { type: 'folder'; entityKind: 'building' })
  | (BrowserPanel & { type: 'browser'; entityKind: 'building' })
  | (TerminalPanel & { type: 'terminal'; entityKind: 'building' });

export type UnitEntity = Extract<WorldEntity, { entityKind: 'unit' }>;
export type BuildingEntity = Extract<WorldEntity, { entityKind: 'building' }>;
export type WindowedBuildingEntity = Extract<WorldEntity, { type: WindowedBuildingType }>;

// Workspace
export interface Workspace {
  id: string;
  name: string;
  path: string;
  lastAccessed: number;
}

export interface PriorWorkspacePreviewEntry extends Workspace {
  sourceDir?: string;
  sourceName?: string;
}

export interface PriorWorkspacePreviewSource {
  sourceDir?: string;
  sourceName?: string;
  sourceUpdatedAt?: number;
  workspaces: PriorWorkspacePreviewEntry[];
}

// App settings
export interface AgentTerminalPanelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type AgentNameSequenceByProvider = Partial<Record<AgentProvider, number>>;

export type TutorialStatus = 'not_started' | 'in_progress' | 'completed';
export type TutorialScenario = 'cookie-clicker' | 'doodle-jump';

export type TutorialStep =
  | 'world-select'
  | 'hero-provider'
  | 'hero-intro'
  | 'create-project'
  | 'rename-project'
  | 'create-agent'
  | 'attach-agent'
  | 'open-global-chat'
  | 'send-prompt'
  | 'open-terminal'
  | 'close-terminal'
  | 'move-project'
  | 'create-project-2'
  | 'rename-project-2'
  | 'create-agent-2'
  | 'attach-agent-2'
  | 'open-global-chat-2'
  | 'send-prompt-2'
  | 'open-browser-1'
  | 'open-browser-2'
  | 'focus-demo-1'
  | 'focus-demo-2'
  | 'focus-explain'
  | 'import-prompt'
  | 'done';

export interface TutorialState {
  status: TutorialStatus;
  stepId: TutorialStep;
  workspaceId?: string;
  workspacePath?: string;
  createdIds?: {
    folderId?: string;
    folderId2?: string;
    agentId?: string;
    agentId2?: string;
    terminalId?: string;
    browserId?: string;
    browserId2?: string;
  };
  promptRunId?: string;
  promptRunId2?: string;
  promptCompletedAt?: number;
  promptCompletedAt2?: number;
  completionPromptSeenAt?: number;
  updatedAt?: number;
  version: 1;
}

export const BUILTIN_SOUND_PACK_IDS = ['default', 'arcade'] as const;
export type BuiltinSoundPackId = (typeof BUILTIN_SOUND_PACK_IDS)[number];
export type SoundPackId = BuiltinSoundPackId;
export type VoicePackId = string;
export const DEFAULT_SOUND_PACK_ID: BuiltinSoundPackId = BUILTIN_SOUND_PACK_IDS[0];

export const isSoundPackId = (value: unknown): value is SoundPackId =>
  typeof value === 'string' && BUILTIN_SOUND_PACK_IDS.includes(value as BuiltinSoundPackId);

export const isVoicePackId = (value: unknown): value is VoicePackId =>
  typeof value === 'string' && value.trim().length > 0;

export interface AudioSettings {
  muted?: boolean;
  voiceMuted?: boolean;
  masterVolume?: number;
  soundPackOverrideId?: SoundPackId;
  voicePackOverrideId?: VoicePackId;
  voicePackOverrideIdByProvider?: Partial<Record<AgentProvider, VoicePackId>>;
  soundEventOverrides?: Record<string, string>;
}

export interface ImportedCustomSound {
  sourceUrl: string;
  displayName: string;
}

export interface AppSettings {
  workspacePath?: string;
  edgePanEnabled?: boolean;
  disableGit?: boolean;
  audio?: AudioSettings;
  heroProvider?: AgentProvider;
  heroModel?: string;
  defaultReasoningEffortByProvider?: Partial<Record<AgentProvider, string>>;
  lastAgentModelByProvider?: Partial<Record<AgentProvider, string>>;
  providerRegistryCache?: ProviderRegistrySnapshot;
  agentTerminalPanelBounds?: AgentTerminalPanelBounds;
  agentNameSequencesByWorkspace?: Record<string, AgentNameSequenceByProvider>;
  priorImportCompletedAt?: number;
  startupChoiceHandledAt?: number;
  tutorial?: TutorialState;
  uiState?: {
    abilityVariantSelections?: Record<string, string>;
  };
}

// Licensing
export type LicenseSubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'none';
export type LicenseAccessReason = 'subscription' | 'trial' | 'inactive' | 'device_limit';
export type LicensePlanTier = 'monthly' | 'annual' | 'unknown';
export type LicenseCheckoutPlan = 'monthly' | 'annual';

export type LicenseStatus = {
  active: boolean;
  reason: LicenseAccessReason;
  trialEndsAt: string;
  subscriptionStatus: LicenseSubscriptionStatus;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  deviceCount: number | null;
  deviceLimit: number | null;
  plan: LicensePlanTier;
};

export type LicenseTokenPayload = {
  iss: string;
  sub: string;
  iat: number;
  exp: number;
  active: boolean;
  subscriptionStatus: LicenseSubscriptionStatus;
  trialEndsAt: string;
  reason?: LicenseAccessReason;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
};

export type LicenseStatusResponse = LicenseStatus & {
  licenseToken?: string;
};

export type LicensePairingStart = {
  code: string;
  expiresAt: string;
};

export type LicenseCheckoutStart = {
  checkoutUrl: string;
  expiresAt: string;
  plan?: LicenseCheckoutPlan;
};

export type LicenseCheckoutConfirm = {
  active: boolean;
  subscriptionStatus: LicenseSubscriptionStatus;
  trialEndsAt: string;
  currentPeriodEnd: string | null;
};

// Selection state
export interface SelectedEntityRef {
  id: string;
  type: EntityType;
}

// IPC result types
export type IpcSuccess<T = void> = { success: true; data: T };
export type IpcError = { success: false; error: string };
export type IpcResult<T = void> = IpcSuccess<T> | IpcError;

// IPC message types
export interface SpawnAgentPayload {
  provider: AgentProvider;
  model?: string;
  name: string;
  displayName: string;
  color: string;
  workspacePath: string;
  x: number;
  y: number;
  attachedFolderId?: string;
}

export interface SelectedAgentFile {
  path: string;
  name: string;
  relativePath?: string;
  inWorkspace: boolean;
}

export interface AttachAgentPayload {
  agentId: string;
  workspacePath: string;
  relativePath: string;
  folderId: string;
}

export type UpdateStatus = {
  available: boolean;
  version: string | null;
  downloaded: boolean;
  downloading: boolean;
  error: string | null;
};

// IPC API exposed to renderer
export interface ElectronAPI {
  isTestMode: boolean;
  isProfileMode: boolean;
  isLicenseCheckEnabled: boolean;
  licenseDebugState?: 'trial' | 'expired' | 'subscribed';
  // Workspaces
  getRecentWorkspaces: () => Promise<Workspace[]>;
  getTutorialWorld: () => Promise<Workspace>;
  resetTutorialWorld: () => Promise<Workspace>;
  addRecentWorkspace: (workspace: Workspace) => Promise<boolean>;
  removeRecentWorkspace: (id: string) => Promise<boolean>;
  selectFolder: (options?: { title?: string }) => Promise<string | null>;
  selectAgentFiles: (workspacePath: string, options?: { title?: string }) => Promise<SelectedAgentFile[]>;
  importCustomSound: () => Promise<ImportedCustomSound | null>;
  startMcpServer: (
    workspacePath: string
  ) => Promise<{ success: boolean; host?: string; port?: number; error?: string }>;
  stopMcpServer: (workspacePath?: string) => Promise<{ success: boolean; error?: string }>;

  // Folders
  loadFolders: (workspacePath: string) => Promise<Folder[]>;
  createFolder: (
    workspacePath: string,
    name: string,
    x: number,
    y: number
  ) => Promise<{ success: boolean; folder?: Folder; error?: string }>;
  importExistingFolder: (
    workspacePath: string,
    relativePath: string,
    x: number,
    y: number
  ) => Promise<{ success: boolean; folder?: Folder; error?: string; alreadyImported?: boolean }>;
  listAvailableFolders: (workspacePath: string) => Promise<AvailableFolder[]>;
  probeFolderGit: (
    workspacePath: string,
    relativePath: string
  ) => Promise<{ success: boolean; isRepo: boolean; isWorktree: boolean }>;
  createGitWorktree: (
    workspacePath: string,
    folderId: string,
    x: number,
    y: number
  ) => Promise<{ success: boolean; folder?: Folder; error?: string }>;
  worktreeSyncFromSource: (
    workspacePath: string,
    folderId: string
  ) => Promise<{ success: boolean; message?: string; error?: string }>;
  worktreeMergeToSource: (
    workspacePath: string,
    folderId: string
  ) => Promise<{ success: boolean; message?: string; error?: string; detachedAgentIds?: string[] }>;
  worktreeUndoMerge: (
    workspacePath: string,
    folderId: string
  ) => Promise<{ success: boolean; message?: string; error?: string }>;
  worktreeRetryRestore: (
    workspacePath: string,
    folderId: string
  ) => Promise<{ success: boolean; message?: string; error?: string }>;
  refreshFolderConflictState: (workspacePath: string, folderId: string) => Promise<Folder | null>;
  renameFolder: (
    workspacePath: string,
    oldName: string,
    newName: string
  ) => Promise<{ success: boolean; error?: string }>;
  removeFolder: (
    workspacePath: string,
    folderId: string
  ) => Promise<{ success: boolean; detachedAgentIds?: string[] }>;
  deleteFolder: (
    workspacePath: string,
    folderId: string
  ) => Promise<{ success: boolean; error?: string; detachedAgentIds?: string[] }>;
  updateFolderPosition: (workspacePath: string, name: string, x: number, y: number) => Promise<boolean>;

  // Agents
  loadAgents: (workspacePath: string) => Promise<Agent[]>;
  spawnAgent: (payload: SpawnAgentPayload) => Promise<{ success: boolean; agent?: Agent; error?: string }>;
  destroyAgent: (workspacePath: string, agentId: string) => Promise<boolean>;
  updateAgentPosition: (workspacePath: string, agentId: string, x: number, y: number) => Promise<boolean>;
  updateAgentName: (workspacePath: string, agentId: string, displayName: string) => Promise<boolean>;
  updateAgentUnreadCompletion: (
    workspacePath: string,
    agentId: string,
    hasUnreadCompletion: boolean
  ) => Promise<boolean>;
  setAgentMovementIntent: (
    workspacePath: string,
    agentId: string,
    movementIntent: MovementIntent
  ) => Promise<boolean>;
  agentAttachToFolder: (payload: AttachAgentPayload) => Promise<{ success: boolean; error?: string }>;
  agentDetach: (agentId: string, workspacePath: string) => Promise<{ success: boolean; error?: string }>;

  // Browser panels
  loadBrowserPanels: (workspacePath: string) => Promise<BrowserPanel[]>;
  createBrowserPanel: (
    workspacePath: string,
    url: string,
    x: number,
    y: number,
    width: number,
    height: number,
    originFolderId?: string
  ) => Promise<{ success: boolean; panel?: BrowserPanel }>;
  deleteBrowserPanel: (workspacePath: string, id: string) => Promise<boolean>;
  updateBrowserPanel: (workspacePath: string, id: string, updates: Partial<BrowserPanel>) => Promise<boolean>;

  // Terminals
  loadTerminals: (workspacePath: string) => Promise<TerminalPanel[]>;
  createTerminal: (
    workspacePath: string,
    relativePath: string,
    x: number,
    y: number,
    originFolderId?: string,
    width?: number,
    height?: number
  ) => Promise<{ success: boolean; terminal?: TerminalPanel; error?: string }>;
  updateTerminal: (
    workspacePath: string,
    terminalId: string,
    updates: Partial<TerminalPanel>
  ) => Promise<{ success: boolean; terminal?: TerminalPanel; error?: string }>;
  deleteTerminal: (workspacePath: string, terminalId: string) => Promise<boolean>;
  startTerminalSession: (payload: {
    terminalId: string;
    workspacePath: string;
    relativePath?: string;
    cols?: number;
    rows?: number;
    sessionToken?: string;
    reuseIfRunning?: boolean;
  }) => Promise<{ success: boolean; error?: string; sessionToken?: string }>;
  sendTerminalInput: (terminalId: string, data: string) => Promise<boolean>;
  resizeTerminal: (terminalId: string, cols: number, rows: number) => Promise<boolean>;
  stopTerminalSession: (terminalId: string) => Promise<boolean>;
  getTerminalHistory: (
    workspacePath: string,
    terminalId: string
  ) => Promise<{ success: boolean; history: string }>;

  // Agent terminal state
  getAgentTerminalState: (
    workspacePath: string,
    agentId: string
  ) => Promise<{ success: boolean; state: AgentTerminalState | null }>;
  setAgentTerminalState: (
    workspacePath: string,
    agentId: string,
    state: { viewState?: AgentTerminalViewState | null }
  ) => Promise<{ success: boolean }>;
  clearAgentTerminalState: (agentId: string) => Promise<{ success: boolean }>;
  getAgentTerminalDraft: (
    workspacePath: string,
    agentId: string
  ) => Promise<{ success: boolean; draft: string | null }>;
  setAgentTerminalDraft: (
    workspacePath: string,
    agentId: string,
    draft: string
  ) => Promise<{ success: boolean }>;

  agentConnectRunAgent: (payload: {
    agentId: string;
    workspacePath: string;
    relativePath: string;
    prompt: string;
    resumeSessionId?: string | null;
    runId?: string;
    tutorialMode?: boolean;
    tutorialScenario?: TutorialScenario;
  }) => Promise<{ success: boolean; runId: string; error?: string }>;

  // Hero
  loadHero: (workspacePath: string) => Promise<Hero>;
  updateHeroPosition: (workspacePath: string, x: number, y: number) => Promise<boolean>;
  updateHeroName: (workspacePath: string, name: string) => Promise<boolean>;
  setHeroMovementIntent: (workspacePath: string, movementIntent: MovementIntent) => Promise<boolean>;
  setHeroProvider: (
    workspacePath: string,
    provider: AgentProvider
  ) => Promise<{ success: boolean; error?: string }>;
  setHeroModel: (workspacePath: string, model: string) => Promise<{ success: boolean; error?: string }>;
  listMcpSkills: () => Promise<McpSkillDescriptor[]>;
  getHeroMcpSkills: (workspacePath: string) => Promise<{ skillIds: McpSkillId[] }>;
  setHeroMcpSkills: (
    workspacePath: string,
    skillIds: McpSkillId[]
  ) => Promise<{ success: boolean; error?: string }>;
  getAgentMcpSkills: (workspacePath: string, agentId: string) => Promise<{ skillIds: McpSkillId[] }>;
  setAgentMcpSkills: (
    workspacePath: string,
    agentId: string,
    skillIds: McpSkillId[]
  ) => Promise<{ success: boolean; error?: string }>;
  heroSendPrompt: (payload: {
    workspacePath: string;
    relativePath: string;
    prompt: string;
    runId?: string;
    tutorialMode?: boolean;
    tutorialScenario?: TutorialScenario;
  }) => Promise<{ success: boolean; runId?: string; error?: string }>;

  // AgentConnect
  agentConnectBootstrap: () => Promise<ProviderRegistrySnapshot>;
  agentConnectProviderStatus: (
    provider: AgentProvider,
    options?: { force?: boolean }
  ) => Promise<ProviderStatus | null>;
  agentConnectProviderInstall: (provider: AgentProvider) => Promise<ProviderStatus | null>;
  agentConnectProviderLogin: (provider: AgentProvider) => Promise<{ loggedIn: boolean }>;
  agentConnectProvidersRefresh: (options?: { force?: boolean }) => Promise<ProviderRegistrySnapshot>;
  agentConnectModelsRecent: (
    provider: AgentProvider,
    options?: { force?: boolean }
  ) => Promise<AgentModelInfo[]>;
  updateAgentModel: (agentId: string, model: string) => Promise<{ success: boolean; error?: string }>;
  updateAgentReasoningEffort: (
    agentId: string,
    reasoningEffort: string | null
  ) => Promise<{ success: boolean; error?: string }>;
  agentConnectCancelAgentRun: (agentId: string) => Promise<{ success: boolean; error?: string }>;
  agentConnectCancelHeroRun: (workspacePath: string) => Promise<{ success: boolean; error?: string }>;

  // Licensing
  licenseRegisterDevice: () => Promise<{ success: boolean; error?: string } & Partial<LicenseStatusResponse>>;
  licenseStatus: () => Promise<{ success: boolean; error?: string } & Partial<LicenseStatusResponse>>;
  licenseStartCheckout: (
    plan?: LicenseCheckoutPlan
  ) => Promise<{ success: boolean; error?: string } & Partial<LicenseCheckoutStart>>;
  licenseConfirmCheckout: (
    sessionId: string
  ) => Promise<{ success: boolean; error?: string } & Partial<LicenseStatusResponse>>;
  licensePairingStart: () => Promise<{ success: boolean; error?: string } & Partial<LicensePairingStart>>;
  licensePairingClaim: (
    code: string
  ) => Promise<{ success: boolean; error?: string } & Partial<LicenseStatusResponse>>;
  licenseManageBilling: () => Promise<{ success: boolean; error?: string } & { url?: string }>;
  verifyLicenseToken: (token: string) => Promise<{
    success: boolean;
    valid?: boolean;
    expired?: boolean;
    payload?: LicenseTokenPayload;
    error?: string;
  }>;
  checkNetworkStatus: () => Promise<{ success: boolean; online?: boolean; error?: string }>;

  // Updates
  getUpdateStatus: () => Promise<UpdateStatus>;
  checkForUpdates: () => Promise<UpdateStatus>;
  installUpdate: () => Promise<UpdateStatus>;

  // Settings
  loadSettings: () => Promise<AppSettings>;
  saveSettings: (settings: Partial<AppSettings>) => Promise<boolean>;
  ensureTutorialDevServer: (workspacePath: string, scenario: TutorialScenario) => Promise<boolean>;
  accelerateTutorialRun: (runId: string) => Promise<boolean>;

  // Events
  onAgentConnectEvent: (handler: (data: AgentConnectEventPayload) => void) => () => void;
  onTerminalOutput: (
    handler: (data: { terminalId: string; data: string; sessionToken?: string }) => void
  ) => () => void;
  onTerminalExit: (
    handler: (data: { terminalId: string; exitCode: number; signal?: number; sessionToken?: string }) => void
  ) => () => void;
  onTerminalCwdChange: (
    handler: (data: {
      terminalId: string;
      path: string;
      relativePath?: string;
      sessionToken?: string;
    }) => void
  ) => () => void;
  onTerminalProcessChange: (
    handler: (data: { terminalId: string; processName: string; sessionToken?: string }) => void
  ) => () => void;
  onTerminalCommand: (
    handler: (data: { terminalId: string; command: string; sessionToken?: string }) => void
  ) => () => void;
  onAgentsUpdated: (handler: (data: { workspacePath: string; agents: Agent[] }) => void) => () => void;
  onAgentConnectProvidersUpdated: (handler: (snapshot: ProviderRegistrySnapshot) => void) => () => void;
  onAgentNotificationClick: (handler: (data: AgentNotificationClickPayload) => void) => () => void;
  onLicenseUpdated: (handler: (status: LicenseStatusResponse) => void) => () => void;
  onLicenseError: (handler: (data: { error: string }) => void) => () => void;
  onUpdateStatus: (handler: (status: UpdateStatus) => void) => () => void;
  setWorkspaceNotificationsEnabled: (enabled: boolean) => void;

  // Command bridge (for MCP control)
  onCommandRunRequest: (handler: (request: CommandRunRequest) => void) => () => void;
  sendCommandRunResponse: (response: CommandRunResponse) => void;
  onLayoutRequest: (handler: (request: LayoutRequest) => void) => () => void;
  sendLayoutResponse: (response: LayoutResponse) => void;

  // Window management
  bringWindowToFront: () => Promise<boolean>;

  // Telemetry
  getPosthogConfig: () => Promise<{ apiKey: string; host: string } | null>;
  captureTelemetryEvent: (payload: {
    event: string;
    properties?: Record<string, unknown>;
  }) => Promise<{ success: boolean; error?: string }>;
  getTelemetryContext: () => Promise<{
    distinctId: string;
    version: string;
    platform: string;
  } | null>;
  getSystemIdleTime: () => Promise<number>;
  getWindowId: () => Promise<number | null>;
  onPowerSuspend: (handler: () => void) => () => void;
  onPowerResume: (handler: () => void) => () => void;
  checkForPriorSettings?: () => Promise<{
    found: boolean;
    sourceDir?: string;
    settingsPath?: string;
    workspacesPath?: string;
  } | null>;
  getPriorWorkspacePreview?: () => Promise<{
    found: boolean;
    sourceDir?: string;
    workspaces: PriorWorkspacePreviewEntry[];
    sources?: PriorWorkspacePreviewSource[];
  } | null>;
  backupAndImportSettings?: () => Promise<{
    success: boolean;
    backupPath?: string;
    error?: string;
    importedCount?: number;
    duplicateCount?: number;
    sourceCount?: number;
  }>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
