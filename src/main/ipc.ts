import { app, ipcMain, dialog, BrowserWindow, shell } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { storage } from './services/storage';
import { detachAgentsForFolder } from './services/workspace';
import { processManager } from './services/agents/processManager';
import * as workspace from './services/workspace';
import * as browser from './services/browser';
import type {
  Agent,
  AgentModelInfo,
  AgentProvider,
  AgentStatus,
  AgentTerminalState,
  AppSettings,
  McpSkillId,
  McpSkillDescriptor,
  ProviderStatus,
  Hero,
  TutorialScenario,
  LicenseStatusResponse,
  LicenseCheckoutStart,
  LicensePairingStart,
  ImportedCustomSound,
  SelectedAgentFile,
  UpdateStatus,
} from '../shared/types';
import { logger } from './logger';
import { safeWebContentsSend } from './ipc/safeSend';
import { resolveWorkspaceSubpath } from './services/workspacePaths';
import * as terminalPanels from './services/terminalPanels';
import { registerCommandBridge } from './commandBridge';
import { registerLayoutBridge } from './layoutBridge';
import { startWorkspaceMcpServer, stopWorkspaceMcpServer } from './mcp/server';
import { getTerminalService } from './services/terminalService';
import { resolveMovementIntent } from '../shared/movement';
import { emitToRenderer, getMainWindow } from './index';
import { getProviderRegistry, PROVIDER_REGISTRY_CACHE_TTL_MS } from './services/agentConnect/registryService';
import type { ProviderRegistrySnapshot } from './services/agentConnect/providerRegistry';
import { createAgentConnectService } from './services/agentConnect/service';
import { createAgentConnectRunner } from './services/agentConnect/runner';
import { ensureProviderInstalled, loginProvider } from './services/agentConnect/embeddedHost';
import { listMcpSkills, validateUnitMcpSkills } from './services/mcpSkills';
import { createAgentCompletionNotifications } from './services/notifications/agentCompletionNotifications';
import { isNotificationsEnabled, setNotificationsEnabled } from './services/notifications/notificationGate';
import { ensureTutorialDevServer } from './services/tutorialDevServer';
import { getTutorialStubEvents } from './services/tutorialAgentStub';
import { isTestMode } from '../testing/testMode';
import { buildCheckoutUrl } from './services/licenseClient';
import { getLicenseClient } from './services/licenseRuntime';
import { checkNetworkReachable } from './services/networkCheck';
import { checkForUpdates, getUpdateStatus, installUpdate } from './services/updates';
import {
  validate,
  handleIpc,
  type IpcResult,
  McpStartSchema,
  McpStopSchema,
  AddRecentWorkspaceSchema,
  RemoveRecentWorkspaceSchema,
  SelectFolderOptionsSchema,
  WorkspaceNotificationsEnabledSchema,
  WorkspacePath,
  EntityId,
  CreateFolderSchema,
  ImportExistingFolderSchema,
  ProbeFolderGitSchema,
  CreateGitWorktreeSchema,
  WorktreeOperationSchema,
  RenameFolderSchema,
  RemoveFolderSchema,
  UpdateFolderPositionSchema,
  LoadAgentsSchema,
  SpawnAgentSchema,
  DestroyAgentSchema,
  UpdateAgentPositionSchema,
  UpdateAgentNameSchema,
  UpdateAgentUnreadCompletionSchema,
  UpdateAgentMovementIntentSchema,
  AttachAgentToFolderSchema,
  DetachAgentSchema,
  CreateBrowserPanelSchema,
  DeleteBrowserPanelSchema,
  UpdateBrowserPanelSchema,
  CreateTerminalSchema,
  UpdateTerminalSchema,
  DeleteTerminalSchema,
  TerminalInputSchema,
  TerminalResizeSchema,
  StartTerminalSessionSchema,
  UpdateHeroPositionSchema,
  UpdateHeroNameSchema,
  UpdateHeroMovementIntentSchema,
  UpdateAgentModelSchema,
  UpdateAgentReasoningEffortSchema,
  AgentConnectProviderStatusSchema,
  AgentConnectProviderInstallSchema,
  AgentConnectProviderLoginSchema,
  AgentConnectProvidersRefreshSchema,
  AgentConnectModelsRecentSchema,
  AgentTerminalStateSchema,
  AgentTerminalStateUpdateSchema,
  AgentConnectRunAgentSchema,
  AgentConnectCancelAgentSchema,
  AgentConnectCancelHeroSchema,
  AccelerateTutorialRunSchema,
  EnsureTutorialDevServerSchema,
  HeroSetProviderSchema,
  HeroSetModelSchema,
  HeroGetMcpSkillsSchema,
  HeroSetMcpSkillsSchema,
  AgentGetMcpSkillsSchema,
  AgentSetMcpSkillsSchema,
  HeroRunSchema,
  LicenseCheckoutConfirmSchema,
  LicenseCheckoutStartSchema,
  LicensePairingClaimSchema,
} from './ipc/validation';

const log = logger.scope('ipc');
let isAgentRunning = (agentId: string): boolean => {
  void agentId;
  return false;
};

const resolveDefaultReasoningEffort = (settings: AppSettings, provider: AgentProvider): string | null => {
  const stored = settings.defaultReasoningEffortByProvider?.[provider]?.trim();
  if (stored) return stored;
  const modelInfo = settings.providerRegistryCache?.recentModelInfo?.[provider];
  const modelDefault = modelInfo
    ?.map((model) => model.defaultReasoningEffort?.trim())
    .find((effort) => effort && effort.length > 0);
  if (modelDefault) return modelDefault;
  if (provider === 'codex') return 'medium';
  return null;
};

const rememberLastAgentModel = (provider: AgentProvider, model: string | null | undefined): void => {
  const trimmed = typeof model === 'string' ? model.trim() : '';
  if (!trimmed) return;
  const settings = storage.loadSettings();
  const next = { ...(settings.lastAgentModelByProvider ?? {}) };
  next[provider] = trimmed;
  storage.saveSettings({ lastAgentModelByProvider: next });
};

const applyHeroSettings = (hero: Hero): Hero => {
  const settings = storage.loadSettings();
  const provider = settings.heroProvider ?? hero.provider;
  let model = settings.heroModel ?? hero.model;
  if (!model) {
    const recent = getProviderRegistry().getSnapshot().recentModels[provider] ?? [];
    model = recent[0] ?? model;
  }
  const providerSessionId = hero.providerSessionIds?.[provider] ?? null;
  return {
    ...hero,
    provider,
    model,
    providerSessionId,
  };
};

const resolveDefaultModelId = async (provider: AgentProvider): Promise<string | null> => {
  const settings = storage.loadSettings();
  const remembered = settings.lastAgentModelByProvider?.[provider]?.trim();
  if (remembered) return remembered;
  const registry = getProviderRegistry();
  const snapshot = registry.getSnapshot();
  const cached = snapshot.recentModels[provider]?.find((entry) => entry && entry.trim()) ?? null;
  if (cached) return cached;
  const refreshed = await registry.refreshRecentModels(provider);
  return refreshed.find((entry) => entry && entry.trim()) ?? null;
};

const resolveExistingWorkspaceDirectory = (
  workspacePath: string,
  relativePath: string,
  operation: 'agentconnect-run-agent' | 'hero-send-prompt'
): string => {
  const folderPath = resolveWorkspaceSubpath(workspacePath, relativePath);
  if (!folderPath) {
    log.warn('agentconnect.path.invalid', {
      operation,
      workspacePath,
      relativePath,
    });
    throw new Error('Invalid folder path');
  }

  let stat: fs.Stats | null = null;
  try {
    stat = fs.statSync(folderPath);
  } catch {
    stat = null;
  }

  if (!stat || !stat.isDirectory()) {
    const knownFolders = storage
      .loadFolders(workspacePath)
      .map((folder) => folder.relativePath)
      .slice(0, 25);
    log.warn('agentconnect.path.missing', {
      operation,
      workspacePath,
      relativePath,
      resolvedPath: folderPath,
      exists: !!stat,
      isDirectory: stat?.isDirectory() ?? false,
      knownFolderCount: knownFolders.length,
      knownFolders,
    });
    throw new Error(`Folder path does not exist: ${relativePath}`);
  }

  return folderPath;
};

const resolveRecentModelsWithTimeout = async (
  provider: AgentProvider,
  timeoutMs = 3000
): Promise<string[]> => {
  const registry = getProviderRegistry();
  const cached = registry.getSnapshot().recentModels[provider] ?? [];
  if (isTestMode()) return cached;
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      registry.refreshRecentModels(provider),
      new Promise<string[]>((resolve) => {
        timer = setTimeout(() => resolve(cached), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const resolveAgentStatus = (agent: Agent): AgentStatus => {
  if (isAgentRunning(agent.id)) return 'working';
  if (agent.status === 'error') return 'error';
  return agent.attachedFolderId ? 'online' : 'offline';
};

const loadAgentsForRender = (workspacePath: string): Agent[] => {
  const agents = workspace.reconcileAgentAttachments(workspacePath);
  return agents.map((agent) => ({
    ...agent,
    status: resolveAgentStatus(agent),
  }));
};

const emitAgentsUpdated = (workspacePath: string): void => {
  emitToRenderer('agents-updated', { workspacePath, agents: loadAgentsForRender(workspacePath) });
};

const agentCompletionNotifications = createAgentCompletionNotifications({
  getMainWindow,
  emitToRenderer,
  isNotificationsEnabled,
  resolveAgentName: (workspacePath, agentId) => {
    const cached = processManager.getAgent(agentId);
    if (cached?.displayName) return cached.displayName;
    const stored = storage.loadAgents(workspacePath).find((agent) => agent.id === agentId);
    return stored?.displayName ?? stored?.name ?? 'Agent';
  },
});

const agentConnectService = createAgentConnectService({
  processManager,
  storage,
  emit: emitToRenderer,
  runner: createAgentConnectRunner({
    getAgent: (id) => processManager.getAgent(id),
    loadHero: (workspacePath) => storage.loadHero(workspacePath),
  }),
  emitAgentsUpdated,
  notifyAgentCompletion: agentCompletionNotifications.handleEvent,
});
isAgentRunning = agentConnectService.isAgentRunning;

const shouldStubTutorialRun = (
  workspacePath: string | undefined,
  tutorialMode: boolean | undefined,
  scenario?: TutorialScenario
): scenario is TutorialScenario => {
  if (!scenario) return false;
  if (tutorialMode) return true;
  const settings = storage.loadSettings();
  const tutorial = settings.tutorial;
  if (!tutorial || tutorial.status !== 'in_progress') return false;
  if (workspacePath && tutorial.workspacePath && tutorial.workspacePath !== workspacePath) return false;
  return true;
};

const resolveTutorialProvider = (workspacePath: string, agentId?: string): AgentProvider => {
  const agents = storage.loadAgents(workspacePath);
  const agent = agentId ? agents.find((entry) => entry.id === agentId) : undefined;
  if (agent?.provider) return agent.provider;
  const hero = storage.loadHero(workspacePath);
  return hero.provider;
};

type TutorialStubRun = {
  runId: string;
  context: {
    runId: string;
    workspacePath: string;
    unit: { type: 'agent' | 'hero'; id: string };
    provider: AgentProvider;
  };
  events: ReturnType<typeof getTutorialStubEvents>;
  index: number;
  stepMs: number;
  timer: NodeJS.Timeout | null;
  scenario: TutorialScenario;
  workspacePath: string;
  completed: boolean;
};

const tutorialStubRuns = new Map<string, TutorialStubRun>();

const completeTutorialStubRun = (run: TutorialStubRun) => {
  if (run.completed) return;
  run.completed = true;
  if (run.timer) {
    clearTimeout(run.timer);
    run.timer = null;
  }
  agentConnectService.handleSessionEvent(run.context, { type: 'final', sessionId: null });
  void ensureTutorialDevServer({ workspacePath: run.workspacePath, scenario: run.scenario });
  tutorialStubRuns.delete(run.runId);
};

const scheduleTutorialStubStep = (run: TutorialStubRun) => {
  if (run.completed) return;
  if (run.index >= run.events.length) {
    completeTutorialStubRun(run);
    return;
  }
  const event = run.events[run.index];
  run.index += 1;
  agentConnectService.handleSessionEvent(run.context, event);
  run.timer = setTimeout(() => {
    run.timer = null;
    scheduleTutorialStubStep(run);
  }, run.stepMs);
};

const startTutorialStubRun = (run: TutorialStubRun) => {
  tutorialStubRuns.set(run.runId, run);
  scheduleTutorialStubStep(run);
};

const accelerateTutorialStubRun = (runId: string): boolean => {
  const run = tutorialStubRuns.get(runId);
  if (!run || run.completed) return false;
  if (run.timer) {
    clearTimeout(run.timer);
    run.timer = null;
  }
  for (let i = run.index; i < run.events.length; i += 1) {
    agentConnectService.handleSessionEvent(run.context, run.events[i]);
  }
  run.index = run.events.length;
  completeTutorialStubRun(run);
  return true;
};

const runTutorialAgentPrompt = async (options: {
  agentId: string;
  workspacePath: string;
  prompt: string;
  runId?: string;
  scenario: TutorialScenario;
}): Promise<{ runId: string }> => {
  const runId = options.runId ?? `tutorial-${Date.now()}`;
  const provider = resolveTutorialProvider(options.workspacePath, options.agentId);
  const scenario = options.scenario;
  const timing =
    scenario === 'cookie-clicker'
      ? { totalDurationMs: 30_000, minStepMs: 150 }
      : { totalDurationMs: 4_000, minStepMs: 10 };
  const context = {
    runId,
    workspacePath: options.workspacePath,
    unit: { type: 'agent' as const, id: options.agentId },
    provider,
  };
  processManager.startAgentTerminalRun(options.agentId);
  processManager.addAgentTerminalUserMessage(options.agentId, options.prompt);
  agentConnectService.handleSessionEvent(context, { type: 'status', status: 'thinking' });
  const events = getTutorialStubEvents(provider, scenario, options.workspacePath);
  const stepMs = Math.max(timing.minStepMs, Math.round(timing.totalDurationMs / Math.max(events.length, 1)));
  startTutorialStubRun({
    runId,
    context,
    events,
    index: 0,
    stepMs,
    timer: null,
    scenario,
    workspacePath: options.workspacePath,
    completed: false,
  });
  return { runId };
};

const runTutorialHeroPrompt = async (options: {
  workspacePath: string;
  prompt: string;
  runId?: string;
  scenario: TutorialScenario;
}): Promise<{ runId: string }> => {
  const runId = options.runId ?? `tutorial-hero-${Date.now()}`;
  const provider = resolveTutorialProvider(options.workspacePath);
  const scenario = options.scenario;
  const timing =
    scenario === 'cookie-clicker'
      ? { totalDurationMs: 30_000, minStepMs: 150 }
      : { totalDurationMs: 4_000, minStepMs: 10 };
  const context = {
    runId,
    workspacePath: options.workspacePath,
    unit: { type: 'hero' as const, id: 'hero' },
    provider,
  };
  agentConnectService.handleSessionEvent(context, { type: 'status', status: 'thinking' });
  const events = getTutorialStubEvents(provider, scenario, options.workspacePath);
  const stepMs = Math.max(timing.minStepMs, Math.round(timing.totalDurationMs / Math.max(events.length, 1)));
  startTutorialStubRun({
    runId,
    context,
    events,
    index: 0,
    stepMs,
    timer: null,
    scenario,
    workspacePath: options.workspacePath,
    completed: false,
  });
  return { runId };
};

const resolveAgentForWorkspace = (workspacePath: string, agentId: string): Agent | null =>
  processManager.ensureAgentLoaded(workspacePath, agentId);

const normalizeRequestedSkillIds = (skillIds: McpSkillId[]): McpSkillId[] => {
  const seen = new Set<string>();
  const normalized: McpSkillId[] = [];
  for (const raw of skillIds) {
    if (typeof raw !== 'string') continue;
    const skillId = raw.trim();
    if (!skillId || seen.has(skillId)) continue;
    seen.add(skillId);
    normalized.push(skillId);
  }
  return normalized;
};

const validateSkillUpdate = (input: {
  unitType: 'hero' | 'agent';
  provider: AgentProvider;
  skillIds: McpSkillId[];
}): McpSkillId[] => {
  const requested = normalizeRequestedSkillIds(input.skillIds);
  const { skillIds, invalidSkillIds } = validateUnitMcpSkills({
    unitType: input.unitType,
    skillIds: requested,
    provider: input.provider,
  });
  if (invalidSkillIds.length > 0) {
    throw new Error(`Unknown or unsupported MCP skill IDs: ${invalidSkillIds.join(', ')}`);
  }
  return skillIds;
};

const sameSkillLoadout = (left: McpSkillId[] | undefined, right: McpSkillId[]): boolean => {
  const current = left ?? [];
  if (current.length !== right.length) return false;
  for (let i = 0; i < current.length; i += 1) {
    if (current[i] !== right[i]) return false;
  }
  return true;
};

export async function registerIpcHandlers(): Promise<void> {
  log.info('Registering IPC handlers');
  registerCommandBridge();
  registerLayoutBridge();
  const terminalsPromise = getTerminalService();
  void terminalsPromise.catch((error) => {
    log.error('Failed to initialize terminal service', error);
    app.exit(1);
  });

  ipcMain.on('workspace-notifications-enabled', (_event, rawPayload: unknown) => {
    const validated = validate(WorkspaceNotificationsEnabledSchema, rawPayload);
    if (!validated.success) return;
    setNotificationsEnabled(validated.data.enabled);
  });

  ipcMain.handle(
    'mcp-start',
    async (_event, rawPayload: unknown): Promise<IpcResult<{ host: string; port: number }>> => {
      const validated = validate(McpStartSchema, { workspacePath: rawPayload });
      if (!validated.success) return validated;

      return handleIpc(async () => {
        const info = await startWorkspaceMcpServer(validated.data.workspacePath);
        return { host: info.host, port: info.port };
      });
    }
  );

  ipcMain.handle('mcp-stop', async (_event, rawPayload: unknown): Promise<IpcResult<void>> => {
    const validated = validate(McpStopSchema, { workspacePath: rawPayload });
    if (!validated.success) return validated;

    return handleIpc(async () => {
      await stopWorkspaceMcpServer(validated.data.workspacePath);
    });
  });

  ipcMain.handle('mcp-skills-list', async (): Promise<IpcResult<McpSkillDescriptor[]>> => {
    return handleIpc(() => listMcpSkills());
  });

  // Workspaces
  ipcMain.handle(
    'get-recent-workspaces',
    async (): Promise<IpcResult<ReturnType<typeof storage.getRecentWorkspaces>>> => {
      return handleIpc(() => storage.getRecentWorkspaces());
    }
  );

  ipcMain.handle(
    'get-tutorial-world',
    async (): Promise<IpcResult<ReturnType<typeof storage.ensureTutorialWorldInRecents>>> => {
      return handleIpc(() => storage.ensureTutorialWorldInRecents());
    }
  );

  ipcMain.handle(
    'reset-tutorial-world',
    async (): Promise<IpcResult<ReturnType<typeof storage.resetTutorialWorldState>>> => {
      return handleIpc(() => storage.resetTutorialWorldState());
    }
  );

  ipcMain.handle(
    'check-for-prior-settings',
    async (): Promise<IpcResult<ReturnType<typeof storage.checkForPriorSettings>>> => {
      return handleIpc(() => storage.checkForPriorSettings());
    }
  );

  ipcMain.handle(
    'get-prior-workspace-preview',
    async (): Promise<IpcResult<ReturnType<typeof storage.getPriorWorkspacePreview>>> => {
      return handleIpc(() => storage.getPriorWorkspacePreview());
    }
  );

  ipcMain.handle(
    'backup-and-import-settings',
    async (): Promise<IpcResult<ReturnType<typeof storage.backupAndImportSettings>>> => {
      return handleIpc(() => storage.backupAndImportSettings());
    }
  );

  ipcMain.handle('agentconnect-bootstrap', async (): Promise<IpcResult<ProviderRegistrySnapshot>> => {
    return handleIpc(() => getProviderRegistry().getSnapshot());
  });

  ipcMain.handle(
    'agentconnect-provider-status',
    async (_event, provider: unknown, options?: unknown): Promise<IpcResult<ProviderStatus | null>> => {
      const validated = validate(AgentConnectProviderStatusSchema, { provider, options });
      if (!validated.success) return validated;

      return handleIpc(() =>
        getProviderRegistry().refreshProviderStatus(validated.data.provider, validated.data.options)
      );
    }
  );

  ipcMain.handle(
    'agentconnect-provider-install',
    async (_event, provider: unknown): Promise<IpcResult<ProviderStatus | null>> => {
      const validated = validate(AgentConnectProviderInstallSchema, { provider });
      if (!validated.success) return validated;

      return handleIpc(async () => {
        await ensureProviderInstalled(validated.data.provider);
        const status = await getProviderRegistry().refreshProviderStatus(validated.data.provider, {
          force: true,
        });
        return status ?? null;
      });
    }
  );

  ipcMain.handle(
    'agentconnect-provider-login',
    async (_event, provider: unknown): Promise<IpcResult<{ loggedIn: boolean }>> => {
      const validated = validate(AgentConnectProviderLoginSchema, { provider });
      if (!validated.success) return validated;

      return handleIpc(() => loginProvider(validated.data.provider));
    }
  );

  ipcMain.handle(
    'agentconnect-providers-refresh',
    async (_event, options?: unknown): Promise<IpcResult<ProviderRegistrySnapshot>> => {
      const validated = validate(AgentConnectProvidersRefreshSchema, { options });
      if (!validated.success) return validated;

      return handleIpc(() => getProviderRegistry().refreshAll(validated.data.options));
    }
  );

  ipcMain.handle(
    'agentconnect-models-recent',
    async (_event, provider: unknown, options?: unknown): Promise<IpcResult<AgentModelInfo[]>> => {
      const validated = validate(AgentConnectModelsRecentSchema, { provider, options });
      if (!validated.success) return validated;

      return handleIpc(async () => {
        const registry = getProviderRegistry();
        if (validated.data.options?.force) {
          await registry.refreshRecentModels(validated.data.provider);
          return registry.getSnapshot().recentModelInfo[validated.data.provider] ?? [];
        }
        const snapshot = registry.getSnapshot();
        const cached = snapshot.recentModelInfo[validated.data.provider] ?? [];
        const updatedAt = snapshot.updatedAt ?? 0;
        const isStale =
          PROVIDER_REGISTRY_CACHE_TTL_MS > 0 &&
          (updatedAt === 0 || Date.now() - updatedAt > PROVIDER_REGISTRY_CACHE_TTL_MS);
        if (cached.length > 0) {
          if (isStale) {
            void registry.refreshRecentModels(validated.data.provider);
          }
          return cached;
        }
        await registry.refreshRecentModels(validated.data.provider);
        return registry.getSnapshot().recentModelInfo[validated.data.provider] ?? [];
      });
    }
  );

  ipcMain.handle(
    'agentconnect-run-agent',
    async (_event, rawPayload: unknown): Promise<IpcResult<{ runId: string }>> => {
      const validated = validate(AgentConnectRunAgentSchema, rawPayload);
      if (!validated.success) return validated;

      return handleIpc(async () => {
        const tutorialScenario = validated.data.tutorialScenario;
        if (
          shouldStubTutorialRun(validated.data.workspacePath, validated.data.tutorialMode, tutorialScenario)
        ) {
          return runTutorialAgentPrompt({
            agentId: validated.data.agentId,
            workspacePath: validated.data.workspacePath,
            prompt: validated.data.prompt,
            runId: validated.data.runId,
            scenario: tutorialScenario,
          });
        }
        const { agentId, workspacePath, relativePath, prompt, runId, resumeSessionId } = validated.data;
        log.info('agentconnect.run-agent.request', {
          agentId,
          workspacePath,
          relativePath,
          runId,
          resumeSessionId,
          promptPreview: prompt.replace(/\s+/g, ' ').trim().slice(0, 120),
        });
        const agent = resolveAgentForWorkspace(workspacePath, agentId);
        if (!agent) {
          log.warn('agentconnect.run-agent.agent-missing', { agentId, workspacePath });
          throw new Error('Agent not found');
        }
        const folderPath = resolveExistingWorkspaceDirectory(
          workspacePath,
          relativePath,
          'agentconnect-run-agent'
        );

        if (!agent.model?.trim()) {
          const defaultModel = await resolveDefaultModelId(agent.provider);
          if (defaultModel) {
            rememberLastAgentModel(agent.provider, defaultModel);
            const updates: Partial<Agent> = {
              model: defaultModel,
              reasoningEffort: null,
            };
            processManager.updateAgent(agent.id, updates);
            const agents = storage.loadAgents(agent.workspacePath);
            storage.saveAgents(
              agent.workspacePath,
              agents.map((entry) => (entry.id === agent.id ? { ...entry, ...updates } : entry))
            );
            emitAgentsUpdated(agent.workspacePath);
          }
        }

        return agentConnectService.runAgentPrompt(agentId, {
          workspacePath,
          prompt,
          cwd: folderPath,
          repoRoot: folderPath,
          runId,
          resumeSessionId,
        });
      });
    }
  );

  ipcMain.handle(
    'agentconnect-cancel-agent',
    async (_event, agentId: unknown): Promise<IpcResult<boolean>> => {
      const validated = validate(AgentConnectCancelAgentSchema, { agentId });
      if (!validated.success) return validated;

      return handleIpc(() => agentConnectService.cancelAgentRun(validated.data.agentId, 'ipc:cancel-agent'));
    }
  );

  ipcMain.handle(
    'agentconnect-cancel-hero',
    async (_event, workspacePath: unknown): Promise<IpcResult<boolean>> => {
      const validated = validate(AgentConnectCancelHeroSchema, { workspacePath });
      if (!validated.success) return validated;

      return handleIpc(() =>
        agentConnectService.cancelHeroRun(validated.data.workspacePath, 'ipc:cancel-hero')
      );
    }
  );

  ipcMain.handle(
    'update-agent-model',
    async (_event, agentId: unknown, model: unknown): Promise<IpcResult<void>> => {
      const validated = validate(UpdateAgentModelSchema, { agentId, model });
      if (!validated.success) return validated;

      return handleIpc(() => {
        const agent = processManager.getAgent(validated.data.agentId);
        if (!agent) {
          throw new Error('Agent not found');
        }
        rememberLastAgentModel(agent.provider, validated.data.model);
        const updates: Partial<Agent> = {
          model: validated.data.model,
          reasoningEffort: null,
        };
        processManager.updateAgent(validated.data.agentId, updates);
        const agents = storage.loadAgents(agent.workspacePath);
        storage.saveAgents(
          agent.workspacePath,
          agents.map((entry) => (entry.id === agent.id ? { ...entry, ...updates } : entry))
        );
        emitAgentsUpdated(agent.workspacePath);
      });
    }
  );

  ipcMain.handle(
    'update-agent-reasoning-effort',
    async (_event, agentId: unknown, reasoningEffort: unknown): Promise<IpcResult<void>> => {
      const validated = validate(UpdateAgentReasoningEffortSchema, { agentId, reasoningEffort });
      if (!validated.success) return validated;

      return handleIpc(() => {
        const agent = processManager.getAgent(validated.data.agentId);
        if (!agent) {
          throw new Error('Agent not found');
        }
        const effort =
          typeof validated.data.reasoningEffort === 'string' && validated.data.reasoningEffort.trim()
            ? validated.data.reasoningEffort.trim()
            : null;
        const settings = storage.loadSettings();
        const nextDefaults = { ...(settings.defaultReasoningEffortByProvider ?? {}) };
        if (effort) {
          nextDefaults[agent.provider] = effort;
        } else {
          delete nextDefaults[agent.provider];
        }
        storage.saveSettings({
          defaultReasoningEffortByProvider: Object.keys(nextDefaults).length > 0 ? nextDefaults : undefined,
        });
        const updates: Partial<Agent> = {
          reasoningEffort: effort,
        };
        processManager.updateAgent(validated.data.agentId, updates);
        const agents = storage.loadAgents(agent.workspacePath);
        storage.saveAgents(
          agent.workspacePath,
          agents.map((entry) => (entry.id === agent.id ? { ...entry, ...updates } : entry))
        );
        emitAgentsUpdated(agent.workspacePath);
      });
    }
  );

  ipcMain.handle(
    'agent-get-mcp-skills',
    async (_event, rawPayload: unknown): Promise<IpcResult<{ skillIds: McpSkillId[] }>> => {
      const validated = validate(AgentGetMcpSkillsSchema, rawPayload);
      if (!validated.success) return validated;

      return handleIpc(() => {
        const { workspacePath, agentId } = validated.data;
        const agent = resolveAgentForWorkspace(workspacePath, agentId);
        if (!agent) {
          throw new Error('Agent not found');
        }
        return { skillIds: agent.mcpSkillIds ?? [] };
      });
    }
  );

  ipcMain.handle(
    'agent-set-mcp-skills',
    async (_event, rawPayload: unknown): Promise<IpcResult<{ skillIds: McpSkillId[] }>> => {
      const validated = validate(AgentSetMcpSkillsSchema, rawPayload);
      if (!validated.success) return validated;

      return handleIpc(() => {
        const { workspacePath, agentId, skillIds } = validated.data;
        const agent = resolveAgentForWorkspace(workspacePath, agentId);
        if (!agent) {
          throw new Error('Agent not found');
        }

        const resolvedSkillIds = validateSkillUpdate({
          unitType: 'agent',
          provider: agent.provider,
          skillIds,
        });

        if (sameSkillLoadout(agent.mcpSkillIds, resolvedSkillIds)) {
          return { skillIds: resolvedSkillIds };
        }

        const updates: Partial<Agent> = {
          mcpSkillIds: resolvedSkillIds,
          providerSessionId: null,
          agentConnectSessionId: null,
        };
        processManager.updateAgent(agentId, updates);
        const agents = storage.loadAgents(workspacePath);
        storage.saveAgents(
          workspacePath,
          agents.map((entry) => (entry.id === agentId ? { ...entry, ...updates } : entry))
        );
        emitAgentsUpdated(workspacePath);
        return { skillIds: resolvedSkillIds };
      });
    }
  );

  ipcMain.handle('add-recent-workspace', async (_event, rawPayload: unknown): Promise<IpcResult<boolean>> => {
    const validated = validate(AddRecentWorkspaceSchema, rawPayload);
    if (!validated.success) return validated;

    return handleIpc(() => storage.addRecentWorkspace(validated.data));
  });

  ipcMain.handle(
    'remove-recent-workspace',
    async (_event, rawPayload: unknown): Promise<IpcResult<boolean>> => {
      const validated = validate(RemoveRecentWorkspaceSchema, { id: rawPayload });
      if (!validated.success) return validated;

      return handleIpc(() => storage.removeRecentWorkspace(validated.data.id));
    }
  );

  ipcMain.handle('select-folder', async (_event, options): Promise<IpcResult<string | null>> => {
    const validated = validate(SelectFolderOptionsSchema, options);
    if (!validated.success) return validated;

    return handleIpc(async () => {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: validated.data?.title || 'Select Folder',
      });
      return result.canceled ? null : result.filePaths[0];
    });
  });

  ipcMain.handle(
    'select-agent-files',
    async (_event, workspacePath: unknown, options: unknown): Promise<IpcResult<SelectedAgentFile[]>> => {
      const pathValidated = validate(WorkspacePath, workspacePath);
      if (!pathValidated.success) return pathValidated;
      const optionsValidated = validate(SelectFolderOptionsSchema, options);
      if (!optionsValidated.success) return optionsValidated;

      return handleIpc(async () => {
        const result = await dialog.showOpenDialog({
          properties: ['openFile', 'multiSelections'],
          title: optionsValidated.data?.title || 'Select Files',
        });
        if (result.canceled || result.filePaths.length === 0) {
          return [];
        }
        const root = path.resolve(pathValidated.data);
        return result.filePaths.map((filePath) => {
          const absolutePath = path.resolve(filePath);
          const relativePath = path.relative(root, absolutePath);
          const inWorkspace =
            Boolean(relativePath) && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
          return {
            path: absolutePath,
            name: path.basename(absolutePath),
            relativePath: inWorkspace ? relativePath : undefined,
            inWorkspace,
          };
        });
      });
    }
  );

  ipcMain.handle('audio-import-custom-sound', async (): Promise<IpcResult<ImportedCustomSound | null>> => {
    return handleIpc(async () => {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        title: 'Select Sound File',
        filters: [
          { name: 'Audio Files', extensions: ['wav', 'mp3', 'ogg', 'm4a', 'aac', 'flac', 'webm'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }
      return storage.importCustomSoundFromPath(result.filePaths[0]);
    });
  });

  // Folders
  ipcMain.handle(
    'load-folders',
    async (_event, workspacePath: unknown): Promise<IpcResult<ReturnType<typeof storage.loadFolders>>> => {
      const validated = validate(WorkspacePath, workspacePath);
      if (!validated.success) return validated;

      return handleIpc(() => storage.loadFolders(validated.data));
    }
  );

  ipcMain.handle(
    'list-available-folders',
    async (
      _event,
      workspacePath: unknown
    ): Promise<IpcResult<ReturnType<typeof workspace.listAvailableFolders>>> => {
      const validated = validate(WorkspacePath, workspacePath);
      if (!validated.success) return validated;

      return handleIpc(() => workspace.listAvailableFolders(validated.data));
    }
  );

  ipcMain.handle(
    'create-folder',
    async (
      _event,
      workspacePath: unknown,
      name: unknown,
      x: unknown,
      y: unknown
    ): Promise<IpcResult<{ folder: ReturnType<typeof workspace.createFolder> }>> => {
      const validated = validate(CreateFolderSchema, { workspacePath, name, x, y });
      if (!validated.success) return validated;

      return handleIpc(() => {
        const folder = workspace.createFolder(
          validated.data.workspacePath,
          validated.data.name,
          validated.data.x,
          validated.data.y
        );
        return { folder };
      });
    }
  );

  ipcMain.handle(
    'import-existing-folder',
    async (
      _event,
      workspacePath: unknown,
      relativePath: unknown,
      x: unknown,
      y: unknown
    ): Promise<
      IpcResult<{
        folder?: ReturnType<typeof workspace.importExistingFolder>['folder'];
        alreadyImported?: boolean;
      }>
    > => {
      const validated = validate(ImportExistingFolderSchema, { workspacePath, relativePath, x, y });
      if (!validated.success) return validated;

      return handleIpc(() => {
        const result = workspace.importExistingFolder(
          validated.data.workspacePath,
          validated.data.relativePath,
          validated.data.x,
          validated.data.y
        );
        if (!result.success) {
          throw new Error(result.error || 'Failed to import folder');
        }
        return { folder: result.folder, alreadyImported: result.alreadyImported };
      });
    }
  );

  ipcMain.handle(
    'probe-folder-git',
    async (
      _event,
      workspacePath: unknown,
      relativePath: unknown
    ): Promise<IpcResult<{ isRepo: boolean; isWorktree: boolean }>> => {
      const validated = validate(ProbeFolderGitSchema, { workspacePath, relativePath });
      if (!validated.success) return validated;

      return handleIpc(() => {
        const result = workspace.probeFolderGit(validated.data.workspacePath, validated.data.relativePath);
        if (!result.success) {
          throw new Error('Failed to probe folder git state');
        }
        return { isRepo: result.isRepo, isWorktree: result.isWorktree };
      });
    }
  );

  ipcMain.handle(
    'create-git-worktree',
    async (
      _event,
      workspacePath: unknown,
      folderId: unknown,
      x: unknown,
      y: unknown
    ): Promise<IpcResult<{ folder?: ReturnType<typeof workspace.createGitWorktree>['folder'] }>> => {
      const validated = validate(CreateGitWorktreeSchema, { workspacePath, folderId, x, y });
      if (!validated.success) return validated;

      return handleIpc(() => {
        const result = workspace.createGitWorktree(
          validated.data.workspacePath,
          validated.data.folderId,
          validated.data.x,
          validated.data.y
        );
        if (!result.success) {
          throw new Error(result.error || 'Failed to create git worktree');
        }
        return { folder: result.folder };
      });
    }
  );

  ipcMain.handle(
    'worktree-sync-from-source',
    async (_event, workspacePath: unknown, folderId: unknown): Promise<IpcResult<{ message?: string }>> => {
      const validated = validate(WorktreeOperationSchema, { workspacePath, folderId });
      if (!validated.success) return validated;

      return handleIpc(() => {
        const result = workspace.worktreeSyncFromSource(
          validated.data.workspacePath,
          validated.data.folderId
        );
        if (!result.success) {
          throw new Error(result.error || 'Failed to sync worktree from source');
        }
        return { message: result.message };
      });
    }
  );

  ipcMain.handle(
    'worktree-merge-to-source',
    async (
      _event,
      workspacePath: unknown,
      folderId: unknown
    ): Promise<IpcResult<{ message?: string; detachedAgentIds?: string[] }>> => {
      const validated = validate(WorktreeOperationSchema, { workspacePath, folderId });
      if (!validated.success) return validated;

      return handleIpc(() => {
        const result = workspace.worktreeMergeToSource(validated.data.workspacePath, validated.data.folderId);
        if (!result.success) {
          throw new Error(result.error || 'Failed to merge worktree to source');
        }
        const detachedAgentIds = detachAgentsForFolder(validated.data.workspacePath, validated.data.folderId);
        emitAgentsUpdated(validated.data.workspacePath);
        return {
          message: result.message,
          detachedAgentIds: detachedAgentIds.length ? detachedAgentIds : undefined,
        };
      });
    }
  );

  ipcMain.handle(
    'worktree-undo-merge',
    async (_event, workspacePath: unknown, folderId: unknown): Promise<IpcResult<{ message?: string }>> => {
      const validated = validate(WorktreeOperationSchema, { workspacePath, folderId });
      if (!validated.success) return validated;

      return handleIpc(() => {
        const result = workspace.worktreeUndoMerge(validated.data.workspacePath, validated.data.folderId);
        if (!result.success) {
          throw new Error(result.error || 'Failed to undo worktree merge');
        }
        return { message: result.message };
      });
    }
  );

  ipcMain.handle(
    'worktree-retry-restore',
    async (_event, workspacePath: unknown, folderId: unknown): Promise<IpcResult<{ message?: string }>> => {
      const validated = validate(WorktreeOperationSchema, { workspacePath, folderId });
      if (!validated.success) return validated;

      return handleIpc(() => {
        const result = workspace.worktreeRetryRestore(validated.data.workspacePath, validated.data.folderId);
        if (!result.success) {
          throw new Error(result.error || 'Failed to retry stash restore');
        }
        return { message: result.message };
      });
    }
  );

  ipcMain.handle(
    'refresh-folder-conflict-state',
    async (
      _event,
      workspacePath: unknown,
      folderId: unknown
    ): Promise<IpcResult<ReturnType<typeof workspace.refreshFolderConflictState>>> => {
      const validated = validate(WorktreeOperationSchema, { workspacePath, folderId });
      if (!validated.success) return validated;

      return handleIpc(() =>
        workspace.refreshFolderConflictState(validated.data.workspacePath, validated.data.folderId)
      );
    }
  );

  ipcMain.handle(
    'rename-folder',
    async (
      _event,
      workspacePath: unknown,
      folderId: unknown,
      newName: unknown
    ): Promise<IpcResult<Record<string, never>>> => {
      const validated = validate(RenameFolderSchema, { workspacePath, folderId, newName });
      if (!validated.success) return validated;

      return handleIpc(() => {
        const result = workspace.renameFolder(
          validated.data.workspacePath,
          validated.data.folderId,
          validated.data.newName
        );
        if (!result.success) {
          throw new Error(result.error || 'Failed to rename folder');
        }
        return {};
      });
    }
  );

  ipcMain.handle(
    'remove-folder',
    async (
      _event,
      workspacePath: unknown,
      folderId: unknown
    ): Promise<IpcResult<{ detachedAgentIds?: string[] }>> => {
      const validated = validate(RemoveFolderSchema, { workspacePath, folderId });
      if (!validated.success) return validated;

      return handleIpc(() => {
        const didRemove = workspace.removeFolder(validated.data.workspacePath, validated.data.folderId);
        if (!didRemove) {
          throw new Error('Failed to remove folder');
        }
        const detachedAgentIds = detachAgentsForFolder(validated.data.workspacePath, validated.data.folderId);
        emitAgentsUpdated(validated.data.workspacePath);
        return { detachedAgentIds: detachedAgentIds.length ? detachedAgentIds : undefined };
      });
    }
  );

  ipcMain.handle(
    'delete-folder',
    async (
      _event,
      workspacePath: unknown,
      folderId: unknown
    ): Promise<IpcResult<{ detachedAgentIds?: string[] }>> => {
      const validated = validate(RemoveFolderSchema, { workspacePath, folderId });
      if (!validated.success) return validated;

      return handleIpc(async () => {
        const res = await workspace.deleteFolder(validated.data.workspacePath, validated.data.folderId);
        if (!res.success) {
          throw new Error(res.error || 'Failed to delete folder');
        }
        const detachedAgentIds = detachAgentsForFolder(validated.data.workspacePath, validated.data.folderId);
        emitAgentsUpdated(validated.data.workspacePath);
        return { detachedAgentIds: detachedAgentIds.length ? detachedAgentIds : undefined };
      });
    }
  );

  ipcMain.handle(
    'update-folder-position',
    async (
      _event,
      workspacePath: unknown,
      folderId: unknown,
      x: unknown,
      y: unknown
    ): Promise<IpcResult<boolean>> => {
      const validated = validate(UpdateFolderPositionSchema, { workspacePath, folderId, x, y });
      if (!validated.success) return validated;

      return handleIpc(() => {
        workspace.updateFolderPosition(
          validated.data.workspacePath,
          validated.data.folderId,
          validated.data.x,
          validated.data.y
        );
        return true;
      });
    }
  );

  // Agents
  ipcMain.handle('load-agents', async (_event, workspacePath: unknown): Promise<IpcResult<Agent[]>> => {
    const validated = validate(LoadAgentsSchema, { workspacePath });
    if (!validated.success) return validated;

    return handleIpc(() => {
      const agents = workspace.reconcileAgentAttachments(validated.data.workspacePath);
      let resolvedAny = false;
      const resolvedAgents = agents.map((agent) => {
        const { entity, resolved } = resolveMovementIntent(agent);
        if (resolved) resolvedAny = true;
        return entity;
      });
      if (resolvedAny) {
        storage.saveAgents(validated.data.workspacePath, resolvedAgents);
      }
      resolvedAgents.forEach((agent) => {
        agent.status = resolveAgentStatus(agent);
      });
      // Load agents into ProcessManager so they're available for operations
      processManager.loadAgents(resolvedAgents);
      return resolvedAgents;
    });
  });

  ipcMain.handle('spawn-agent', async (_event, rawPayload: unknown): Promise<IpcResult<{ agent: Agent }>> => {
    const validated = validate(SpawnAgentSchema, rawPayload);
    if (!validated.success) return validated;

    return handleIpc(async () => {
      const { workspacePath, provider, model, name, displayName, color, x, y, attachedFolderId } =
        validated.data;
      const settings = storage.loadSettings();
      const defaultReasoning = resolveDefaultReasoningEffort(settings, provider);
      const rememberedModel = settings.lastAgentModelByProvider?.[provider]?.trim() ?? '';
      const resolvedModel = model?.trim() || rememberedModel;

      const agent: Agent = {
        id: `agent-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        provider,
        model: resolvedModel,
        reasoningEffort: defaultReasoning,
        name,
        displayName,
        color,
        workspacePath,
        x,
        y,
        status: attachedFolderId ? 'online' : 'offline',
        attachedFolderId,
        contextLeft: 100,
        agentConnectSessionId: null,
        providerSessionId: null,
        hasUnreadCompletion: false,
        mcpSkillIds: [],
      };

      await processManager.spawnAgent(agent);

      // Save to storage
      const agents = storage.loadAgents(workspacePath);
      agents.push(agent);
      storage.saveAgents(workspacePath, agents);
      emitAgentsUpdated(workspacePath);

      return { agent };
    });
  });

  ipcMain.handle(
    'destroy-agent',
    async (_event, workspacePath: unknown, agentId: unknown): Promise<IpcResult<boolean>> => {
      const validated = validate(DestroyAgentSchema, { workspacePath, agentId });
      if (!validated.success) return validated;

      return handleIpc(() => {
        const agents = storage.loadAgents(validated.data.workspacePath);
        const filtered = agents.filter((a) => a.id !== validated.data.agentId);
        storage.saveAgents(validated.data.workspacePath, filtered);
        processManager.clearAgentTerminalState(validated.data.agentId);
        emitAgentsUpdated(validated.data.workspacePath);
        return true;
      });
    }
  );

  ipcMain.handle(
    'update-agent-position',
    async (
      _event,
      workspacePath: unknown,
      agentId: unknown,
      x: unknown,
      y: unknown
    ): Promise<IpcResult<boolean>> => {
      const validated = validate(UpdateAgentPositionSchema, { workspacePath, agentId, x, y });
      if (!validated.success) return validated;

      return handleIpc(() => {
        processManager.updateAgentPosition(validated.data.agentId, validated.data.x, validated.data.y);
        processManager.updateAgent(validated.data.agentId, { movementIntent: undefined });

        const agents = storage.loadAgents(validated.data.workspacePath);
        const agent = agents.find((a) => a.id === validated.data.agentId);
        if (agent) {
          agent.x = validated.data.x;
          agent.y = validated.data.y;
          agent.movementIntent = undefined;
          storage.saveAgents(validated.data.workspacePath, agents);
          // Don't emit agents-updated here - position updates are "fire and forget"
          // The renderer is the source of truth for positions during active sessions
        }
        return true;
      });
    }
  );

  ipcMain.handle(
    'update-agent-name',
    async (
      _event,
      workspacePath: unknown,
      agentId: unknown,
      displayName: unknown
    ): Promise<IpcResult<boolean>> => {
      const validated = validate(UpdateAgentNameSchema, { workspacePath, agentId, displayName });
      if (!validated.success) return validated;

      return handleIpc(() => {
        const agents = storage.loadAgents(validated.data.workspacePath);
        const nextAgents = agents.map((agent) =>
          agent.id === validated.data.agentId ? { ...agent, displayName: validated.data.displayName } : agent
        );
        storage.saveAgents(validated.data.workspacePath, nextAgents);
        processManager.updateAgent(validated.data.agentId, { displayName: validated.data.displayName });
        emitAgentsUpdated(validated.data.workspacePath);
        return true;
      });
    }
  );

  ipcMain.handle(
    'update-agent-unread-completion',
    async (
      _event,
      workspacePath: unknown,
      agentId: unknown,
      hasUnreadCompletion: unknown
    ): Promise<IpcResult<boolean>> => {
      const validated = validate(UpdateAgentUnreadCompletionSchema, {
        workspacePath,
        agentId,
        hasUnreadCompletion,
      });
      if (!validated.success) return validated;

      return handleIpc(() => {
        const agents = storage.loadAgents(validated.data.workspacePath);
        const agent = agents.find((entry) => entry.id === validated.data.agentId);
        if (!agent) {
          throw new Error('Agent not found');
        }
        agent.hasUnreadCompletion = validated.data.hasUnreadCompletion;
        storage.saveAgents(validated.data.workspacePath, agents);
        if (processManager.getAgent(validated.data.agentId)) {
          processManager.updateAgent(validated.data.agentId, {
            hasUnreadCompletion: validated.data.hasUnreadCompletion,
          });
        }
        emitAgentsUpdated(validated.data.workspacePath);
        return true;
      });
    }
  );

  ipcMain.handle(
    'set-agent-movement-intent',
    async (_event, rawPayload: unknown): Promise<IpcResult<boolean>> => {
      const validated = validate(UpdateAgentMovementIntentSchema, rawPayload);
      if (!validated.success) return validated;

      return handleIpc(() => {
        processManager.updateAgent(validated.data.agentId, { movementIntent: validated.data.movementIntent });

        const agents = storage.loadAgents(validated.data.workspacePath);
        const agent = agents.find((a) => a.id === validated.data.agentId);
        if (agent) {
          agent.movementIntent = validated.data.movementIntent;
          storage.saveAgents(validated.data.workspacePath, agents);
          emitAgentsUpdated(validated.data.workspacePath);
        }
        return true;
      });
    }
  );

  ipcMain.handle('agent-attach-to-folder', async (_event, rawPayload: unknown): Promise<IpcResult<void>> => {
    const validated = validate(AttachAgentToFolderSchema, rawPayload);
    if (!validated.success) return validated;

    return handleIpc(() => {
      const { workspacePath, agentId, folderId, relativePath } = validated.data;

      const agent = processManager.getAgent(agentId);
      if (!agent) {
        throw new Error('Agent not found');
      }

      const folderPath = resolveWorkspaceSubpath(workspacePath, relativePath);
      if (!folderPath) {
        throw new Error('Invalid folder path');
      }

      // Update agent state
      processManager.updateAgent(agentId, {
        attachedFolderId: folderId,
        status: 'online',
      });

      // Attaching does not start a background process; runs are per prompt.

      // Save to storage with updated status
      const agents = storage.loadAgents(workspacePath);
      const agentData = agents.find((a) => a.id === agentId);
      if (agentData) {
        agentData.attachedFolderId = folderId;
        agentData.status = 'online';
      } else {
        agents.push({
          ...agent,
          attachedFolderId: folderId,
          status: 'online',
        });
      }
      storage.saveAgents(workspacePath, agents);
      emitAgentsUpdated(workspacePath);
    });
  });

  ipcMain.handle(
    'agent-detach',
    async (_event, agentId: unknown, workspacePath: unknown): Promise<IpcResult<void>> => {
      const validated = validate(DetachAgentSchema, { agentId, workspacePath });
      if (!validated.success) return validated;

      return handleIpc(() => {
        processManager.updateAgent(validated.data.agentId, {
          attachedFolderId: undefined,
          status: 'offline',
        });

        // Update storage
        const agents = storage.loadAgents(validated.data.workspacePath);
        const agentData = agents.find((a) => a.id === validated.data.agentId);
        if (agentData) {
          agentData.attachedFolderId = undefined;
          agentData.status = 'offline';
        } else {
          const agent = processManager.getAgent(validated.data.agentId);
          if (agent) {
            agents.push({ ...agent, attachedFolderId: undefined, status: 'offline' });
          }
        }
        storage.saveAgents(validated.data.workspacePath, agents);
        emitAgentsUpdated(validated.data.workspacePath);
      });
    }
  );

  // Browser panels
  ipcMain.handle(
    'load-browser-panels',
    async (
      _event,
      workspacePath: unknown
    ): Promise<IpcResult<ReturnType<typeof storage.loadBrowserPanels>>> => {
      const validated = validate(WorkspacePath, workspacePath);
      if (!validated.success) return validated;

      return handleIpc(() => storage.loadBrowserPanels(validated.data));
    }
  );

  ipcMain.handle(
    'create-browser-panel',
    async (
      _event,
      workspacePath: unknown,
      url: unknown,
      x: unknown,
      y: unknown,
      width: unknown,
      height: unknown,
      originFolderId: unknown
    ): Promise<IpcResult<{ panel: ReturnType<typeof browser.createBrowserPanel> }>> => {
      const validated = validate(CreateBrowserPanelSchema, {
        workspacePath,
        url,
        x,
        y,
        width,
        height,
        originFolderId,
      });
      if (!validated.success) return validated;

      return handleIpc(() => {
        const panel = browser.createBrowserPanel(
          validated.data.workspacePath,
          validated.data.url,
          validated.data.x,
          validated.data.y,
          validated.data.width,
          validated.data.height,
          validated.data.originFolderId
        );
        return { panel };
      });
    }
  );

  ipcMain.handle(
    'delete-browser-panel',
    async (_event, workspacePath: unknown, id: unknown): Promise<IpcResult<boolean>> => {
      const validated = validate(DeleteBrowserPanelSchema, { workspacePath, id });
      if (!validated.success) return validated;

      return handleIpc(() => browser.deleteBrowserPanel(validated.data.workspacePath, validated.data.id));
    }
  );

  ipcMain.handle(
    'update-browser-panel',
    async (_event, workspacePath: unknown, id: unknown, updates: unknown): Promise<IpcResult<boolean>> => {
      const validated = validate(UpdateBrowserPanelSchema, { workspacePath, id, updates });
      if (!validated.success) return validated;

      return handleIpc(() => {
        const result = browser.updateBrowserPanel(
          validated.data.workspacePath,
          validated.data.id,
          validated.data.updates
        );
        return result !== null;
      });
    }
  );

  // Terminals (records)
  ipcMain.handle(
    'load-terminals',
    async (_event, workspacePath: unknown): Promise<IpcResult<ReturnType<typeof storage.loadTerminals>>> => {
      const validated = validate(WorkspacePath, workspacePath);
      if (!validated.success) return validated;

      return handleIpc(() => storage.loadTerminals(validated.data));
    }
  );

  ipcMain.handle(
    'create-terminal',
    async (
      _event,
      workspacePath: unknown,
      relativePath: unknown,
      x: unknown,
      y: unknown,
      originFolderId: unknown,
      width: unknown,
      height: unknown
    ): Promise<
      IpcResult<{ terminal: ReturnType<typeof terminalPanels.createTerminalRecord>['terminal'] }>
    > => {
      const validated = validate(CreateTerminalSchema, {
        workspacePath,
        relativePath,
        x,
        y,
        originFolderId,
        width,
        height,
      });
      if (!validated.success) return validated;

      return handleIpc(() => {
        const result = terminalPanels.createTerminalRecord(
          validated.data.workspacePath,
          validated.data.relativePath,
          validated.data.x,
          validated.data.y,
          validated.data.originFolderId,
          validated.data.width,
          validated.data.height
        );
        if (!result.success || !result.terminal) {
          throw new Error(result.error || 'Failed to create terminal');
        }
        return { terminal: result.terminal };
      });
    }
  );

  ipcMain.handle(
    'update-terminal',
    async (
      _event,
      workspacePath: unknown,
      terminalId: unknown,
      updates: unknown
    ): Promise<
      IpcResult<{ terminal: ReturnType<typeof terminalPanels.updateTerminalRecord>['terminal'] }>
    > => {
      const validated = validate(UpdateTerminalSchema, { workspacePath, terminalId, updates });
      if (!validated.success) return validated;

      return handleIpc(() => {
        const result = terminalPanels.updateTerminalRecord(
          validated.data.workspacePath,
          validated.data.terminalId,
          validated.data.updates
        );
        if (!result.success || !result.terminal) {
          throw new Error(result.error || 'Failed to update terminal');
        }
        return { terminal: result.terminal };
      });
    }
  );

  ipcMain.handle(
    'delete-terminal',
    async (_event, workspacePath: unknown, terminalId: unknown): Promise<IpcResult<boolean>> => {
      const validated = validate(DeleteTerminalSchema, { workspacePath, terminalId });
      if (!validated.success) return validated;

      return handleIpc(() =>
        terminalPanels.deleteTerminalRecord(validated.data.workspacePath, validated.data.terminalId)
      );
    }
  );

  // Terminal sessions
  ipcMain.handle(
    'start-terminal-session',
    async (event, payload: unknown): Promise<IpcResult<{ sessionToken?: string }>> => {
      const validated = validate(StartTerminalSessionSchema, payload);
      if (!validated.success) return validated;

      const sender = event.sender;
      return handleIpc(async () => {
        const terminals = await terminalsPromise;
        const result = terminals.startTerminalSession(validated.data, {
          onData: (terminalId, data, sessionToken) => {
            if (!sender.isDestroyed()) {
              safeWebContentsSend(sender, 'terminal-output', { terminalId, data, sessionToken });
            }
          },
          onProcessChange: (terminalId, processName, sessionToken) => {
            if (!sender.isDestroyed()) {
              safeWebContentsSend(sender, 'terminal-process', { terminalId, processName, sessionToken });
            }
          },
          onCommand: (terminalId, command, sessionToken) => {
            if (!sender.isDestroyed()) {
              safeWebContentsSend(sender, 'terminal-command', { terminalId, command, sessionToken });
            }
          },
          onCwdChange: (terminalId, payload, sessionToken) => {
            if (!sender.isDestroyed()) {
              safeWebContentsSend(sender, 'terminal-cwd', { terminalId, ...payload, sessionToken });
            }
          },
          onExit: (terminalId, payload, sessionToken) => {
            if (!sender.isDestroyed()) {
              safeWebContentsSend(sender, 'terminal-exit', { terminalId, ...payload, sessionToken });
            }
          },
        });
        if (!result.success) {
          throw new Error(result.error || 'Failed to start terminal session');
        }
        return { sessionToken: result.sessionToken };
      });
    }
  );

  ipcMain.handle(
    'terminal-input',
    async (_event, terminalId: unknown, data: unknown): Promise<IpcResult<boolean>> => {
      const validated = validate(TerminalInputSchema, { terminalId, data });
      if (!validated.success) return validated;

      return handleIpc(async () => {
        const terminals = await terminalsPromise;
        return terminals.sendTerminalInput(validated.data.terminalId, validated.data.data);
      });
    }
  );

  ipcMain.handle(
    'terminal-resize',
    async (_event, terminalId: unknown, cols: unknown, rows: unknown): Promise<IpcResult<boolean>> => {
      const validated = validate(TerminalResizeSchema, { terminalId, cols, rows });
      if (!validated.success) return validated;

      return handleIpc(async () => {
        const terminals = await terminalsPromise;
        return terminals.resizeTerminal(validated.data.terminalId, validated.data.cols, validated.data.rows);
      });
    }
  );

  ipcMain.handle(
    'stop-terminal-session',
    async (_event, terminalId: unknown): Promise<IpcResult<boolean>> => {
      const validated = validate(EntityId, terminalId);
      if (!validated.success) return validated;

      return handleIpc(async () => {
        const terminals = await terminalsPromise;
        return terminals.stopTerminalSession(validated.data);
      });
    }
  );

  ipcMain.handle(
    'get-terminal-history',
    async (_event, workspacePath: unknown, terminalId: unknown): Promise<IpcResult<{ history: string }>> => {
      const validatedPath = validate(WorkspacePath, workspacePath);
      if (!validatedPath.success) return validatedPath;
      const validatedTerminal = validate(EntityId, terminalId);
      if (!validatedTerminal.success) return validatedTerminal;

      return handleIpc(async () => {
        const terminals = await terminalsPromise;
        const history = terminals.getTerminalHistory(validatedTerminal.data, validatedPath.data);
        return { history };
      });
    }
  );

  ipcMain.handle(
    'get-agent-terminal-state',
    async (
      _event,
      workspacePath: unknown,
      agentId: unknown
    ): Promise<IpcResult<{ state: AgentTerminalState | null }>> => {
      const validated = validate(AgentTerminalStateSchema, { workspacePath, agentId });
      if (!validated.success) return validated;

      return handleIpc(() => {
        const { workspacePath: resolvedPath, agentId: resolvedAgentId } = validated.data;
        const storedState = storage.getAgentTerminalState(resolvedPath, resolvedAgentId);
        const agent =
          processManager.getAgent(resolvedAgentId) ??
          processManager.ensureAgentLoaded(resolvedPath, resolvedAgentId);
        if (!agent) {
          return { state: storedState };
        }
        const entries = processManager.getAgentTerminalEntries(resolvedAgentId) ?? storedState?.entries ?? [];
        return { state: { entries, viewState: storedState?.viewState ?? null } };
      });
    }
  );

  ipcMain.handle(
    'set-agent-terminal-state',
    async (_event, workspacePath: unknown, agentId: unknown, state: unknown): Promise<IpcResult<void>> => {
      const validated = validate(AgentTerminalStateUpdateSchema, { workspacePath, agentId, state });
      if (!validated.success) return validated;

      return handleIpc(() => {
        const { workspacePath: resolvedPath, agentId: resolvedAgentId } = validated.data;
        const existing = storage.getAgentTerminalState(resolvedPath, resolvedAgentId);
        const entries = processManager.getAgentTerminalEntries(resolvedAgentId) ?? existing?.entries ?? [];
        const viewState = validated.data.state.viewState ?? existing?.viewState ?? null;
        processManager.setAgentTerminalViewState(resolvedAgentId, viewState);
        storage.setAgentTerminalState(resolvedPath, resolvedAgentId, entries, viewState);
      });
    }
  );

  ipcMain.handle('clear-agent-terminal-state', async (_event, agentId: unknown): Promise<IpcResult<void>> => {
    const validated = validate(EntityId, agentId);
    if (!validated.success) return validated;

    return handleIpc(() => {
      processManager.clearAgentTerminalState(validated.data);
    });
  });

  ipcMain.handle(
    'get-agent-terminal-draft',
    async (
      _event,
      workspacePath: unknown,
      agentId: unknown
    ): Promise<IpcResult<{ draft: string | null }>> => {
      const validated = validate(AgentTerminalStateSchema, { workspacePath, agentId });
      if (!validated.success) return validated;

      return handleIpc(() => {
        const { workspacePath: resolvedPath, agentId: resolvedAgentId } = validated.data;
        const draft = storage.getAgentTerminalDraft(resolvedPath, resolvedAgentId);
        return { draft };
      });
    }
  );

  ipcMain.handle(
    'set-agent-terminal-draft',
    async (_event, workspacePath: unknown, agentId: unknown, draft: unknown): Promise<IpcResult<void>> => {
      const validated = validate(AgentTerminalStateSchema, { workspacePath, agentId });
      if (!validated.success) return validated;
      if (typeof draft !== 'string') {
        return { success: false, error: 'Invalid draft: expected string' };
      }

      return handleIpc(() => {
        const { workspacePath: resolvedPath, agentId: resolvedAgentId } = validated.data;
        storage.setAgentTerminalDraft(resolvedPath, resolvedAgentId, draft);
      });
    }
  );

  // Hero
  ipcMain.handle(
    'load-hero',
    async (_event, workspacePath: unknown): Promise<IpcResult<ReturnType<typeof storage.loadHero>>> => {
      const validated = validate(WorkspacePath, workspacePath);
      if (!validated.success) return validated;

      return handleIpc(() => {
        const hero = storage.loadHero(validated.data);
        const { entity, resolved } = resolveMovementIntent(hero);
        if (resolved) {
          storage.saveHero(validated.data, entity);
        }
        return applyHeroSettings(entity);
      });
    }
  );

  ipcMain.handle(
    'update-hero-position',
    async (_event, workspacePath: unknown, x: unknown, y: unknown): Promise<IpcResult<boolean>> => {
      const validated = validate(UpdateHeroPositionSchema, { workspacePath, x, y });
      if (!validated.success) return validated;

      return handleIpc(() => {
        const hero = storage.loadHero(validated.data.workspacePath);
        hero.x = validated.data.x;
        hero.y = validated.data.y;
        hero.movementIntent = undefined;
        return storage.saveHero(validated.data.workspacePath, hero);
      });
    }
  );

  ipcMain.handle(
    'update-hero-name',
    async (_event, workspacePath: unknown, name: unknown): Promise<IpcResult<boolean>> => {
      const validated = validate(UpdateHeroNameSchema, { workspacePath, name });
      if (!validated.success) return validated;

      return handleIpc(() => {
        const hero = storage.loadHero(validated.data.workspacePath);
        hero.name = validated.data.name;
        return storage.saveHero(validated.data.workspacePath, hero);
      });
    }
  );

  ipcMain.handle(
    'hero-set-provider',
    async (_event, workspacePath: unknown, provider: unknown): Promise<IpcResult<void>> => {
      const validated = validate(HeroSetProviderSchema, { workspacePath, provider });
      if (!validated.success) return validated;

      return handleIpc(async () => {
        const settings = storage.loadSettings();
        const sameProvider = settings.heroProvider === validated.data.provider;
        const cachedModels = getProviderRegistry().getSnapshot().recentModels[validated.data.provider] ?? [];
        const defaultModel = cachedModels[0] ?? (sameProvider ? (settings.heroModel ?? '') : '');
        const nextSettings = {
          heroProvider: validated.data.provider,
          heroModel: defaultModel,
        };
        storage.saveSettings(nextSettings);
        if (validated.data.workspacePath) {
          const hero = storage.loadHero(validated.data.workspacePath);
          const providerSessions = hero.providerSessionIds ?? {};
          const nextProviderSessionId = providerSessions[validated.data.provider] ?? null;
          const updated: Hero = {
            ...hero,
            provider: validated.data.provider,
            model: nextSettings.heroModel ?? hero.model,
            providerSessionId: nextProviderSessionId,
            providerSessionIds: providerSessions,
          };
          storage.saveHero(validated.data.workspacePath, updated);
        }
        void (async () => {
          const refreshed = await resolveRecentModelsWithTimeout(validated.data.provider);
          const refreshedDefault = refreshed[0] ?? '';
          if (!refreshedDefault || refreshedDefault === defaultModel) return;
          const latestSettings = storage.loadSettings();
          if (latestSettings.heroProvider !== validated.data.provider) return;
          if (latestSettings.heroModel && latestSettings.heroModel !== defaultModel) return;
          const updatedSettings = {
            ...latestSettings,
            heroModel: refreshedDefault,
          };
          storage.saveSettings(updatedSettings);
          if (validated.data.workspacePath) {
            const hero = storage.loadHero(validated.data.workspacePath);
            if (hero.provider !== validated.data.provider) return;
            storage.saveHero(validated.data.workspacePath, { ...hero, model: refreshedDefault });
          }
        })();
      });
    }
  );

  ipcMain.handle(
    'hero-set-model',
    async (_event, workspacePath: unknown, model: unknown): Promise<IpcResult<void>> => {
      const validated = validate(HeroSetModelSchema, { workspacePath, model });
      if (!validated.success) return validated;

      return handleIpc(() => {
        storage.saveSettings({ heroModel: validated.data.model });
        if (validated.data.workspacePath) {
          const hero = storage.loadHero(validated.data.workspacePath);
          const updated: Hero = {
            ...hero,
            model: validated.data.model,
          };
          storage.saveHero(validated.data.workspacePath, updated);
        }
      });
    }
  );

  ipcMain.handle(
    'hero-get-mcp-skills',
    async (_event, rawPayload: unknown): Promise<IpcResult<{ skillIds: McpSkillId[] }>> => {
      const validated = validate(HeroGetMcpSkillsSchema, rawPayload);
      if (!validated.success) return validated;

      return handleIpc(() => {
        const hero = storage.loadHero(validated.data.workspacePath);
        return { skillIds: hero.mcpSkillIds ?? [] };
      });
    }
  );

  ipcMain.handle(
    'hero-set-mcp-skills',
    async (_event, rawPayload: unknown): Promise<IpcResult<{ skillIds: McpSkillId[] }>> => {
      const validated = validate(HeroSetMcpSkillsSchema, rawPayload);
      if (!validated.success) return validated;

      return handleIpc(() => {
        const hero = storage.loadHero(validated.data.workspacePath);
        const resolvedSkillIds = validateSkillUpdate({
          unitType: 'hero',
          provider: hero.provider,
          skillIds: validated.data.skillIds,
        });
        if (sameSkillLoadout(hero.mcpSkillIds, resolvedSkillIds)) {
          return { skillIds: resolvedSkillIds };
        }
        const updated: Hero = {
          ...hero,
          mcpSkillIds: resolvedSkillIds,
          providerSessionId: null,
          providerSessionIds: undefined,
          agentConnectSessionId: null,
        };
        storage.saveHero(validated.data.workspacePath, updated);
        return { skillIds: resolvedSkillIds };
      });
    }
  );

  ipcMain.handle(
    'hero-send-prompt',
    async (_event, rawPayload: unknown): Promise<IpcResult<{ runId: string }>> => {
      const validated = validate(HeroRunSchema, rawPayload);
      if (!validated.success) return validated;

      return handleIpc(async () => {
        const tutorialScenario = validated.data.tutorialScenario;
        if (
          shouldStubTutorialRun(validated.data.workspacePath, validated.data.tutorialMode, tutorialScenario)
        ) {
          return runTutorialHeroPrompt({
            workspacePath: validated.data.workspacePath,
            prompt: validated.data.prompt,
            runId: validated.data.runId,
            scenario: tutorialScenario,
          });
        }
        const folderPath = resolveExistingWorkspaceDirectory(
          validated.data.workspacePath,
          validated.data.relativePath,
          'hero-send-prompt'
        );
        const result = await agentConnectService.runHeroPrompt({
          workspacePath: validated.data.workspacePath,
          prompt: validated.data.prompt,
          cwd: folderPath,
          repoRoot: folderPath,
          runId: validated.data.runId,
        });
        return result;
      });
    }
  );

  ipcMain.handle(
    'ensure-tutorial-dev-server',
    async (_event, rawPayload: unknown): Promise<IpcResult<boolean>> => {
      const validated = validate(EnsureTutorialDevServerSchema, rawPayload);
      if (!validated.success) return validated;

      return handleIpc(() => ensureTutorialDevServer(validated.data));
    }
  );

  ipcMain.handle(
    'accelerate-tutorial-run',
    async (_event, rawPayload: unknown): Promise<IpcResult<boolean>> => {
      const validated = validate(AccelerateTutorialRunSchema, rawPayload);
      if (!validated.success) return validated;

      return handleIpc(() => accelerateTutorialStubRun(validated.data.runId));
    }
  );

  ipcMain.handle(
    'set-hero-movement-intent',
    async (_event, rawPayload: unknown): Promise<IpcResult<boolean>> => {
      const validated = validate(UpdateHeroMovementIntentSchema, rawPayload);
      if (!validated.success) return validated;

      return handleIpc(() => {
        const hero = storage.loadHero(validated.data.workspacePath);
        hero.movementIntent = validated.data.movementIntent;
        return storage.saveHero(validated.data.workspacePath, hero);
      });
    }
  );

  // Licensing
  ipcMain.handle('license-register', async (): Promise<IpcResult<LicenseStatusResponse>> => {
    return handleIpc(async () => {
      const client = getLicenseClient();
      await client.registerDevice();
      const status = await client.getStatus();
      emitToRenderer('license-updated', status);
      return status;
    });
  });

  ipcMain.handle('license-status', async (): Promise<IpcResult<LicenseStatusResponse>> => {
    return handleIpc(async () => {
      const status = await getLicenseClient().getStatus();
      emitToRenderer('license-updated', status);
      return status;
    });
  });

  ipcMain.handle(
    'license-start-checkout',
    async (_event, rawPayload: unknown): Promise<IpcResult<LicenseCheckoutStart>> => {
      const validated = validate(LicenseCheckoutStartSchema, rawPayload ?? {});
      if (!validated.success) return validated;

      return handleIpc(async () => {
        const client = getLicenseClient();
        const token = await client.createCheckoutToken();
        const pricingUrl = client.getPricingUrl();
        if (!pricingUrl) {
          throw new Error('pricing_url_missing');
        }
        const checkoutUrl = buildCheckoutUrl(pricingUrl, token.token, validated.data.plan);
        await shell.openExternal(checkoutUrl);
        return { checkoutUrl, expiresAt: token.expiresAt, plan: validated.data.plan };
      });
    }
  );

  ipcMain.handle('license-manage-billing', async (): Promise<IpcResult<{ url: string }>> => {
    return handleIpc(async () => {
      const client = getLicenseClient();
      const portal = await client.createBillingPortal();
      await shell.openExternal(portal.url);
      return { url: portal.url };
    });
  });

  ipcMain.handle(
    'license-confirm-checkout',
    async (_event, rawPayload: unknown): Promise<IpcResult<LicenseStatusResponse>> => {
      const validated = validate(LicenseCheckoutConfirmSchema, rawPayload ?? {});
      if (!validated.success) return validated;

      return handleIpc(async () => {
        const client = getLicenseClient();
        await client.confirmCheckout(validated.data.sessionId);
        const status = await client.getStatus();
        emitToRenderer('license-updated', status);
        return status;
      });
    }
  );

  ipcMain.handle('license-pairing-start', async (): Promise<IpcResult<LicensePairingStart>> => {
    return handleIpc(async () => {
      return getLicenseClient().startPairing();
    });
  });

  ipcMain.handle('network-check', async (): Promise<IpcResult<boolean>> => {
    return handleIpc(() => checkNetworkReachable());
  });

  ipcMain.handle(
    'license-pairing-claim',
    async (_event, code: unknown): Promise<IpcResult<LicenseStatusResponse>> => {
      const validated = validate(LicensePairingClaimSchema, { code });
      if (!validated.success) return validated;

      return handleIpc(async () => {
        const client = getLicenseClient();
        await client.claimPairing(validated.data.code);
        const status = await client.getStatus();
        emitToRenderer('license-updated', status);
        return status;
      });
    }
  );

  // Settings
  ipcMain.handle('load-settings', (): Promise<IpcResult<ReturnType<typeof storage.loadSettings>>> => {
    return handleIpc(() => storage.loadSettings());
  });

  ipcMain.handle('save-settings', (_event, settings): Promise<IpcResult<boolean>> => {
    return handleIpc(() => storage.saveSettings(settings ?? {}));
  });

  // Updates
  ipcMain.handle('update-get-status', (): Promise<IpcResult<UpdateStatus>> => {
    return handleIpc(() => getUpdateStatus());
  });

  ipcMain.handle('update-check', async (): Promise<IpcResult<UpdateStatus>> => {
    return handleIpc(async () => checkForUpdates());
  });

  ipcMain.handle('update-install', (): Promise<IpcResult<UpdateStatus>> => {
    return handleIpc(() => installUpdate());
  });

  // Window management
  ipcMain.handle('bring-window-to-front', (): Promise<IpcResult<boolean>> => {
    return handleIpc(() => {
      const mainWindow = BrowserWindow.getAllWindows().find((win) => !win.isDestroyed());
      if (mainWindow) {
        if (mainWindow.isMinimized()) {
          mainWindow.restore();
        }
        mainWindow.show();
        mainWindow.focus();
      }
      return true;
    });
  });

  // Telemetry
  ipcMain.handle(
    'capture-telemetry-event',
    async (
      _event,
      payload: { event: string; properties?: Record<string, unknown> }
    ): Promise<IpcResult<void>> => {
      return handleIpc(async () => {
        const { captureTelemetryEvent } = await import('./services/telemetry');
        const result = captureTelemetryEvent(payload);
        if (!result.success && result.error !== 'telemetry_disabled') {
          throw new Error(result.error ?? 'capture_failed');
        }
      });
    }
  );

  ipcMain.handle(
    'get-telemetry-context',
    async (): Promise<IpcResult<{ distinctId: string; version: string; platform: string } | null>> => {
      return handleIpc(async () => {
        const { getTelemetryContext } = await import('./services/telemetry');
        return getTelemetryContext();
      });
    }
  );

  ipcMain.handle('get-system-idle-time', async (): Promise<IpcResult<number>> => {
    return handleIpc(async () => {
      const { getSystemIdleTime } = await import('./services/telemetry');
      return getSystemIdleTime();
    });
  });

  ipcMain.handle('get-window-id', (): Promise<IpcResult<number | null>> => {
    return handleIpc(() => {
      const mainWindow = BrowserWindow.getAllWindows().find((win) => !win.isDestroyed());
      return mainWindow?.id ?? null;
    });
  });
}
