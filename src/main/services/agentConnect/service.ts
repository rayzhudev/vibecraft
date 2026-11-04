import type {
  Agent,
  AgentTerminalEntry,
  ContextUsage,
  Hero,
  AgentProvider,
  McpServerConfig,
  ProviderDetail,
  TokenUsage,
} from '../../../shared/types';
import { logger } from '../../logger';
import { cancelSession } from './embeddedHost';
import { getStorageNamespace } from '../storageNamespace';
import { isMcpSkillsForwardingEnabled, resolveUnitMcpServers } from '../mcpSkills';
import { buildAgentSystemPrompt, buildHeroSystemPrompt } from './heroSystemPrompt';
import {
  asNumber,
  computeClaudeContextLeft,
  computeCodexContextLeft,
  computeContextLeft,
  computeContextLeftFromUsage,
  DEFAULT_CLAUDE_CONTEXT_WINDOW,
  DEFAULT_CODEX_CONTEXT_WINDOW,
  getBillableTotal,
} from './usage';

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

export type AgentConnectRunContext = {
  runId: string;
  workspacePath: string;
  unit: { type: 'agent' | 'hero'; id: string };
  provider: AgentProvider;
};

export type AgentConnectRunnerRequest = {
  runId: string;
  model: string;
  reasoningEffort?: string | null;
  systemPrompt?: string;
  prompt: string;
  workspacePath: string;
  cwd: string;
  repoRoot: string;
  resumeSessionId: string | null;
  mcpServers?: Record<string, McpServerConfig>;
  unit: AgentConnectRunContext['unit'];
  onSessionId?: (sessionId: string) => void;
  signal?: AbortSignal;
};

export type AgentConnectRunner = (request: AgentConnectRunnerRequest) => AsyncIterable<AgentConnectEvent>;

export type AgentConnectRunRequest = {
  workspacePath: string;
  prompt: string;
  cwd: string;
  repoRoot: string;
  runId?: string;
  resumeSessionId?: string | null;
};

type ProcessManagerLike = {
  getAgent: (id: string) => Agent | undefined;
  ensureAgentLoaded: (workspacePath: string, agentId: string) => Agent | null;
  updateAgent: (id: string, updates: Partial<Agent>) => void;
  startAgentTerminalRun: (agentId: string) => void;
  addAgentTerminalUserMessage: (agentId: string, content: string) => void;
  addAgentTerminalSystemMessage: (agentId: string, content: string) => void;
  appendAgentTerminalAssistantDelta: (agentId: string, text: string) => void;
  finalizeAgentTerminalAssistantMessage: (
    agentId: string,
    content: string,
    messageId?: string,
    usage?: TokenUsage
  ) => void;
  addAgentTerminalEntry: (agentId: string, entry: AgentTerminalEntry) => void;
  startAgentTerminalToolEntry: (
    agentId: string,
    entry: Omit<Extract<AgentTerminalEntry, { type: 'tool' }>, 'id' | 'type'>,
    itemId?: string
  ) => string;
  completeAgentTerminalToolEntry: (
    agentId: string,
    itemId: string,
    updater: (entry: Extract<AgentTerminalEntry, { type: 'tool' }>) => AgentTerminalEntry
  ) => boolean;
  finalizeAgentTerminalRun: (agentId: string) => void;
  updateAgentTerminalEntry: (
    agentId: string,
    entryId: string,
    updater: (entry: AgentTerminalEntry) => AgentTerminalEntry
  ) => boolean;
  updateAgentTerminalEntryByMessageId: (
    agentId: string,
    messageId: string,
    updater: (entry: AgentTerminalEntry) => AgentTerminalEntry
  ) => boolean;
};

type StorageLike = {
  loadAgents: (workspacePath: string) => Agent[];
  saveAgents: (workspacePath: string, agents: Agent[]) => boolean;
  loadHero: (workspacePath: string) => Hero;
  saveHero: (workspacePath: string, hero: Hero) => boolean;
  loadSettings?: () => { autoProceed?: boolean };
};

export type AgentConnectServiceDependencies = {
  processManager: ProcessManagerLike;
  storage: StorageLike;
  emit: (channel: string, payload: unknown) => void;
  runner?: AgentConnectRunner;
  emitAgentsUpdated?: (workspacePath: string) => void;
  notifyAgentCompletion?: (context: AgentConnectRunContext, event: AgentConnectEvent) => void;
};

type UsageMode = 'event' | 'message';

type ActiveRunState = {
  runId: string;
  unitKey: string;
  sessionId?: string;
  cancelRequested?: boolean;
  abortController?: AbortController;
};

const log = logger.scope('agentconnect:agent');

const buildToolEntryTitle = (name?: string, input?: string): string =>
  input?.trim() || name?.trim() || 'Tool call';

const buildToolEntryMeta = (input?: string): string | undefined => {
  if (!input) return undefined;
  return input.length > 120 ? `${input.slice(0, 117)}...` : input;
};

const normalizeLogText = (value: string, limit = 200): string => {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  return compact.length > limit ? `${compact.slice(0, limit)}...` : compact;
};

const updateAgentRecord = (agents: Agent[], agentId: string, updates: Partial<Agent>): Agent[] => {
  const next = agents.map((agent) => (agent.id === agentId ? { ...agent, ...updates } : agent));
  return next;
};

export function createAgentConnectService({
  processManager,
  storage,
  emit,
  runner,
  emitAgentsUpdated,
  notifyAgentCompletion,
}: AgentConnectServiceDependencies) {
  const usageModeByRun = new Map<string, UsageMode>();
  const contextUsageByRun = new Map<string, boolean>();
  const activeRuns = new Map<string, ActiveRunState>();
  const activeRunByUnit = new Map<string, string>();
  const activeToolsByRun = new Map<string, number>();
  const storageNamespace = getStorageNamespace();

  const buildUnitKey = (context: AgentConnectRunContext): string =>
    context.unit.type === 'agent' ? `agent:${context.unit.id}` : `hero:${context.workspacePath}`;

  const registerRun = (context: AgentConnectRunContext, abortController: AbortController): void => {
    const unitKey = buildUnitKey(context);
    log.info('run.register', {
      runId: context.runId,
      unitKey,
      unit: context.unit.type,
      agentId: context.unit.type === 'agent' ? context.unit.id : null,
      workspacePath: context.unit.type === 'hero' ? context.workspacePath : null,
    });
    activeRuns.set(context.runId, { runId: context.runId, unitKey, abortController });
    activeRunByUnit.set(unitKey, context.runId);
    activeToolsByRun.set(context.runId, 0);
  };

  const ensureUnitAvailable = (context: AgentConnectRunContext): void => {
    const unitKey = buildUnitKey(context);
    if (activeRunByUnit.has(unitKey)) {
      log.warn('run.blocked', {
        runId: context.runId,
        unitKey,
        activeRunId: activeRunByUnit.get(unitKey),
        unit: context.unit.type,
        agentId: context.unit.type === 'agent' ? context.unit.id : null,
        workspacePath: context.unit.type === 'hero' ? context.workspacePath : null,
      });
      const label = context.unit.type === 'agent' ? 'Agent' : 'Hero';
      throw new Error(`${label} is already running a task.`);
    }
  };

  const setRunSessionId = async (runId: string, sessionId: string): Promise<void> => {
    const state = activeRuns.get(runId);
    if (!state) return;
    state.sessionId = sessionId;
    if (state.cancelRequested) {
      log.info('run.cancel.pending', {
        runId,
        sessionId,
        unitKey: state.unitKey,
      });
      try {
        await cancelSession(sessionId);
      } catch {
        // ignore
      }
    }
  };

  const clearRunState = (context: AgentConnectRunContext): void => {
    usageModeByRun.delete(context.runId);
    contextUsageByRun.delete(context.runId);
    activeToolsByRun.delete(context.runId);
    const state = activeRuns.get(context.runId);
    if (state) {
      if (activeRunByUnit.get(state.unitKey) === context.runId) {
        activeRunByUnit.delete(state.unitKey);
      }
      activeRuns.delete(context.runId);
    }
    if (context.unit.type === 'agent') {
      emitAgentsUpdated?.(context.workspacePath);
    }
  };
  const applyUsageToAgent = (
    agentId: string,
    workspacePath: string,
    usage?: TokenUsage,
    updateContext = true
  ): void => {
    const agent = processManager.getAgent(agentId);
    if (!agent) return;
    const total = getBillableTotal(usage, agent.provider);
    if (total === null) return;
    const nextTotal = (agent.totalTokensUsed ?? 0) + total;
    const contextWindow = agent.contextWindow ?? undefined;
    let contextLeft: number | undefined;
    if (updateContext) {
      if (agent.provider === 'codex') {
        contextLeft = computeCodexContextLeft(usage, contextWindow);
      } else if (agent.provider === 'claude') {
        contextLeft = computeClaudeContextLeft(usage, agent.model, contextWindow);
      } else {
        contextLeft = computeContextLeft(nextTotal, contextWindow);
      }
    }
    const updates: Partial<Agent> = {
      totalTokensUsed: nextTotal,
    };
    if (agent.provider === 'codex' && agent.contextWindow === undefined) {
      updates.contextWindow = DEFAULT_CODEX_CONTEXT_WINDOW;
    }
    if (agent.provider === 'claude' && agent.contextWindow === undefined) {
      updates.contextWindow = DEFAULT_CLAUDE_CONTEXT_WINDOW;
    }
    if (updateContext && contextLeft !== undefined) {
      updates.contextLeft = contextLeft;
    }

    processManager.updateAgent(agentId, updates);

    const agents = storage.loadAgents(workspacePath);
    storage.saveAgents(workspacePath, updateAgentRecord(agents, agentId, updates));
  };

  const applyUsageToHero = (workspacePath: string, usage?: TokenUsage, updateContext = true): void => {
    const hero = storage.loadHero(workspacePath);
    const total = getBillableTotal(usage, hero.provider);
    if (total === null) return;
    const nextTotal = (hero.totalTokensUsed ?? 0) + total;
    const contextWindow = hero.contextWindow ?? undefined;
    let contextLeft: number | undefined;
    if (updateContext) {
      if (hero.provider === 'codex') {
        contextLeft = computeCodexContextLeft(usage, contextWindow);
      } else if (hero.provider === 'claude') {
        contextLeft = computeClaudeContextLeft(usage, hero.model, contextWindow);
      } else {
        contextLeft = computeContextLeft(nextTotal, contextWindow);
      }
    }
    const updates: Partial<Hero> = {
      totalTokensUsed: nextTotal,
    };
    if (hero.provider === 'codex' && hero.contextWindow === undefined) {
      updates.contextWindow = DEFAULT_CODEX_CONTEXT_WINDOW;
    }
    if (hero.provider === 'claude' && hero.contextWindow === undefined) {
      updates.contextWindow = DEFAULT_CLAUDE_CONTEXT_WINDOW;
    }
    if (updateContext && contextLeft !== undefined) {
      updates.contextLeft = contextLeft;
    }
    storage.saveHero(workspacePath, { ...hero, ...updates });
  };

  const applyContextUsageToAgent = (
    agentId: string,
    workspacePath: string,
    contextUsage?: ContextUsage
  ): void => {
    if (!contextUsage) return;
    const agent = processManager.getAgent(agentId);
    if (!agent) return;
    const contextWindow = asNumber(contextUsage.context_window);
    const updates: Partial<Agent> = {};
    const contextLeft = computeContextLeftFromUsage(contextUsage);
    if (contextLeft !== undefined) {
      updates.contextLeft = contextLeft;
    }
    if (contextWindow !== undefined && agent.contextWindow !== contextWindow) {
      updates.contextWindow = contextWindow;
    }
    if (Object.keys(updates).length === 0) return;
    processManager.updateAgent(agentId, updates);
    const agents = storage.loadAgents(workspacePath);
    storage.saveAgents(workspacePath, updateAgentRecord(agents, agentId, updates));
    emitAgentsUpdated?.(workspacePath);
  };

  const applyContextUsageToHero = (workspacePath: string, contextUsage?: ContextUsage): void => {
    if (!contextUsage) return;
    const hero = storage.loadHero(workspacePath);
    const contextWindow = asNumber(contextUsage.context_window);
    const updates: Partial<Hero> = {};
    const contextLeft = computeContextLeftFromUsage(contextUsage);
    if (contextLeft !== undefined) {
      updates.contextLeft = contextLeft;
    }
    if (contextWindow !== undefined && hero.contextWindow !== contextWindow) {
      updates.contextWindow = contextWindow;
    }
    if (Object.keys(updates).length === 0) return;
    storage.saveHero(workspacePath, { ...hero, ...updates });
  };

  const updateProviderSessionId = (context: AgentConnectRunContext, sessionId?: string | null): void => {
    if (!sessionId) return;
    if (context.unit.type === 'agent') {
      const current = processManager.getAgent(context.unit.id);
      if (current?.providerSessionId === sessionId) return;
      processManager.updateAgent(context.unit.id, { providerSessionId: sessionId });
      const agents = storage.loadAgents(context.workspacePath);
      storage.saveAgents(
        context.workspacePath,
        updateAgentRecord(agents, context.unit.id, { providerSessionId: sessionId })
      );
      return;
    }
    const hero = storage.loadHero(context.workspacePath);
    const providerSessions = { ...(hero.providerSessionIds ?? {}) };
    const providerKey = context.provider;
    const matchesCurrentProvider = hero.provider === providerKey;
    if (
      providerSessions[providerKey] === sessionId &&
      (!matchesCurrentProvider || hero.providerSessionId === sessionId)
    ) {
      return;
    }
    providerSessions[providerKey] = sessionId;
    const updates: Partial<Hero> = {
      providerSessionIds: providerSessions,
    };
    if (matchesCurrentProvider) {
      updates.providerSessionId = sessionId;
    }
    storage.saveHero(context.workspacePath, { ...hero, ...updates });
  };

  const attachUsageToMessage = (
    context: AgentConnectRunContext,
    messageId: string,
    usage: TokenUsage
  ): void => {
    if (context.unit.type !== 'agent') return;
    const updated = processManager.updateAgentTerminalEntry(context.unit.id, messageId, (entry) => {
      if (entry.type !== 'message') return entry;
      return { ...entry, usage };
    });
    if (!updated) {
      processManager.updateAgentTerminalEntryByMessageId(context.unit.id, messageId, (entry) => {
        if (entry.type !== 'message') return entry;
        return { ...entry, usage };
      });
    }
  };

  const applyUsageTotals = (
    context: AgentConnectRunContext,
    usage: TokenUsage,
    updateContext = true
  ): void => {
    if (context.unit.type === 'agent') {
      applyUsageToAgent(context.unit.id, context.workspacePath, usage, updateContext);
    } else {
      applyUsageToHero(context.workspacePath, usage, updateContext);
    }
  };

  const applyUsageWithMode = (context: AgentConnectRunContext, usage: TokenUsage, mode: UsageMode): void => {
    const current = usageModeByRun.get(context.runId);
    if (current && current !== mode) return;
    usageModeByRun.set(context.runId, mode);
    const updateContext = !contextUsageByRun.get(context.runId);
    applyUsageTotals(context, usage, updateContext);
  };

  const handleSessionEvent = (context: AgentConnectRunContext, event: AgentConnectEvent): void => {
    notifyAgentCompletion?.(context, event);
    if (context.unit.type === 'agent') {
      if (event.type === 'message') {
        if (event.role === 'assistant' || event.role === 'system') {
          const preview = normalizeLogText(event.content);
          if (preview) {
            log.info('message', {
              agentId: context.unit.id,
              role: event.role,
              preview,
            });
          }
        }
      } else if (event.type === 'tool_call') {
        if (event.phase === 'start') {
          const input = event.input ? normalizeLogText(event.input, 160) : undefined;
          log.info('tool.start', {
            agentId: context.unit.id,
            name: event.name,
            callId: event.callId,
            input,
          });
        } else {
          const output = event.output ? normalizeLogText(event.output, 160) : undefined;
          log.info('tool.done', {
            agentId: context.unit.id,
            name: event.name,
            callId: event.callId,
            status: event.status,
            output,
          });
        }
      } else if (event.type === 'error') {
        log.warn('run.error', { agentId: context.unit.id, message: event.message });
      }
    }

    if (event.type === 'summary') {
      if (context.unit.type === 'agent') {
        const summary = event.summary?.trim();
        if (summary) {
          log.info('summary', {
            agentId: context.unit.id,
            source: event.source ?? null,
            model: event.model ?? null,
            preview: normalizeLogText(summary, 160),
          });
          const updates: Partial<Agent> = {
            summary,
            summarySource: event.source ?? null,
            summaryModel: event.model ?? null,
            summaryCreatedAt: event.createdAt ?? new Date().toISOString(),
          };
          processManager.updateAgent(context.unit.id, updates);
          const agents = storage.loadAgents(context.workspacePath);
          storage.saveAgents(context.workspacePath, updateAgentRecord(agents, context.unit.id, updates));
          emitAgentsUpdated?.(context.workspacePath);
        }
      }
      emit('agentconnect-event', { runId: context.runId, unit: context.unit, event });
      return;
    }

    if (event.type === 'context_usage') {
      log.info('context.usage', {
        unit: context.unit.type,
        agentId: context.unit.type === 'agent' ? context.unit.id : null,
        workspacePath: context.unit.type === 'hero' ? context.workspacePath : null,
        contextUsage: event.contextUsage,
      });
      contextUsageByRun.set(context.runId, true);
      if (context.unit.type === 'agent') {
        applyContextUsageToAgent(context.unit.id, context.workspacePath, event.contextUsage);
      } else {
        applyContextUsageToHero(context.workspacePath, event.contextUsage);
      }
      emit('agentconnect-event', { runId: context.runId, unit: context.unit, event });
      return;
    }

    if (event.type === 'usage') {
      log.info('usage', {
        unit: context.unit.type,
        agentId: context.unit.type === 'agent' ? context.unit.id : null,
        workspacePath: context.unit.type === 'hero' ? context.workspacePath : null,
        messageId: event.messageId ?? null,
        usage: event.usage,
      });
      if (event.messageId) {
        attachUsageToMessage(context, event.messageId, event.usage);
      }
      applyUsageWithMode(context, event.usage, 'event');
      emit('agentconnect-event', { runId: context.runId, unit: context.unit, event });
      return;
    }

    if (event.type === 'final') {
      if (context.unit.type === 'agent') {
        log.info('run.final', {
          agentId: context.unit.id,
          sessionId: event.sessionId ?? null,
          cancelled: event.cancelled ?? false,
        });
      }
      if (event.usage) {
        applyUsageWithMode(context, event.usage, 'event');
      }
      if (context.unit.type === 'agent') {
        if (event.cancelled) {
          processManager.addAgentTerminalSystemMessage(context.unit.id, 'Run cancelled.');
        }
        processManager.finalizeAgentTerminalRun(context.unit.id);
      }
      updateProviderSessionId(context, event.sessionId);
      clearRunState(context);
      emit('agentconnect-event', { runId: context.runId, unit: context.unit, event });
      return;
    }

    if (event.type === 'thinking') {
      if (context.unit.type === 'agent') {
        const content = event.text?.trim();
        if (content) {
          const entry: AgentTerminalEntry = {
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            type: 'message',
            role: 'assistant',
            content,
            variant: 'thinking',
          };
          processManager.addAgentTerminalEntry(context.unit.id, entry);
        }
      }
      emit('agentconnect-event', { runId: context.runId, unit: context.unit, event });
      return;
    }

    if (event.type === 'status') {
      if (event.status === 'thinking' && context.unit.type === 'agent') {
        processManager.startAgentTerminalRun(context.unit.id);
      }
      if (event.status === 'error') {
        const message = event.message || 'Run failed';
        if (context.unit.type === 'agent') {
          processManager.addAgentTerminalSystemMessage(context.unit.id, message);
          processManager.finalizeAgentTerminalRun(context.unit.id);
        }
        if (context.unit.type === 'agent') {
          log.warn('run.status.error', { agentId: context.unit.id, message });
        }
      }
      emit('agentconnect-event', { runId: context.runId, unit: context.unit, event });
      return;
    }

    if (event.type === 'error') {
      if (context.unit.type === 'agent') {
        processManager.addAgentTerminalSystemMessage(context.unit.id, event.message);
        processManager.finalizeAgentTerminalRun(context.unit.id);
      }
      clearRunState(context);
      emit('agentconnect-event', { runId: context.runId, unit: context.unit, event });
      return;
    }

    if (context.unit.type === 'agent') {
      if (event.type === 'delta') {
        const activeTools = activeToolsByRun.get(context.runId) ?? 0;
        if (activeTools === 0) {
          processManager.appendAgentTerminalAssistantDelta(context.unit.id, event.text);
        }
      } else if (event.type === 'message') {
        if (event.role === 'assistant') {
          processManager.finalizeAgentTerminalAssistantMessage(
            context.unit.id,
            event.content,
            event.messageId,
            event.usage
          );
          if (event.usage) {
            applyUsageWithMode(context, event.usage, 'message');
          }
        } else if (event.role === 'system') {
          if (!event.content.trim()) {
            return;
          }
          const entry: AgentTerminalEntry = {
            id: event.messageId ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            type: 'message',
            role: 'system',
            content: event.content,
            usage: event.usage,
            messageId: event.messageId,
          };
          processManager.addAgentTerminalEntry(context.unit.id, entry);
        }
      } else if (event.type === 'tool_call') {
        const title = buildToolEntryTitle(event.name, event.input);
        const meta = buildToolEntryMeta(event.input);
        if (event.phase === 'start') {
          const current = activeToolsByRun.get(context.runId) ?? 0;
          activeToolsByRun.set(context.runId, current + 1);
          processManager.startAgentTerminalToolEntry(
            context.unit.id,
            { title, status: 'running', meta, name: event.name, input: event.input },
            event.callId
          );
        } else {
          const current = activeToolsByRun.get(context.runId) ?? 0;
          activeToolsByRun.set(context.runId, Math.max(0, current - 1));
          const updated = processManager.completeAgentTerminalToolEntry(
            context.unit.id,
            event.callId,
            (entry) => ({
              ...entry,
              status: event.status ?? 'completed',
              output: event.output ?? entry.output,
              meta: entry.meta ?? meta,
              name: entry.name ?? event.name,
              input: entry.input ?? event.input,
            })
          );
          if (!updated) {
            processManager.startAgentTerminalToolEntry(context.unit.id, {
              title,
              status: event.status ?? 'completed',
              meta,
              output: event.output,
              name: event.name,
              input: event.input,
            });
          }
        }
      } else if (event.type === 'raw_line') {
        const trimmed = event.line.trim();
        if (trimmed) {
          processManager.startAgentTerminalToolEntry(context.unit.id, {
            title: 'Tool output',
            status: 'info',
            output: trimmed,
            name: 'raw_line',
          });
        }
      }
    } else if (event.type === 'message' && event.usage) {
      applyUsageWithMode(context, event.usage, 'message');
    }

    emit('agentconnect-event', { runId: context.runId, unit: context.unit, event });
  };

  const streamEvents = async (
    context: AgentConnectRunContext,
    request: AgentConnectRunnerRequest
  ): Promise<void> => {
    try {
      if (!runner) {
        if (context.unit.type === 'agent') {
          processManager.addAgentTerminalSystemMessage(
            context.unit.id,
            'AgentConnect host is not available.'
          );
          processManager.finalizeAgentTerminalRun(context.unit.id);
        }
        return;
      }

      for await (const event of runner(request)) {
        handleSessionEvent(context, event);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (context.unit.type === 'agent') {
        processManager.addAgentTerminalSystemMessage(context.unit.id, message || 'Run failed');
        processManager.finalizeAgentTerminalRun(context.unit.id);
      }
    } finally {
      clearRunState(context);
    }
  };

  const resolveAgentForRun = (agentId: string, workspacePath: string): Agent | null => {
    const cached = processManager.getAgent(agentId);
    if (cached) return cached;
    const stored = processManager.ensureAgentLoaded(workspacePath, agentId);
    if (stored) return stored;
    console.log('[agentconnect][service] agent missing', {
      agentId,
      workspacePath,
      knownIds: storage.loadAgents(workspacePath).map((entry) => entry.id),
    });
    return null;
  };

  const resolveRunMcpServers = (input: {
    unitType: 'agent' | 'hero';
    skillIds: string[] | undefined;
    provider: AgentProvider;
    workspacePath: string;
    attachedFolderPath?: string;
  }): Record<string, McpServerConfig> | undefined => {
    if (!isMcpSkillsForwardingEnabled()) return undefined;
    const resolved = resolveUnitMcpServers({
      unitType: input.unitType,
      skillIds: input.skillIds ?? [],
      workspacePath: input.workspacePath,
      attachedFolderPath: input.attachedFolderPath,
      storageNamespace,
      provider: input.provider,
    });
    return Object.keys(resolved).length > 0 ? resolved : undefined;
  };

  const runAgentPrompt = async (
    agentId: string,
    request: AgentConnectRunRequest
  ): Promise<{ runId: string }> => {
    const agent = resolveAgentForRun(agentId, request.workspacePath);
    if (!agent) throw new Error('Agent not found');
    const runId = request.runId ?? `agentconnect-${Date.now()}`;
    const resumeSessionId = agent.providerSessionId ?? request.resumeSessionId ?? null;
    const mcpServers = resolveRunMcpServers({
      unitType: 'agent',
      skillIds: agent.mcpSkillIds,
      provider: agent.provider,
      workspacePath: request.workspacePath,
      attachedFolderPath: request.cwd,
    });

    log.info('run.start', {
      runId,
      agentId,
      provider: agent.provider,
      model: agent.model || undefined,
      resumeSessionId,
      cwd: request.cwd,
      repoRoot: request.repoRoot,
      mcpServerCount: mcpServers ? Object.keys(mcpServers).length : 0,
      promptChars: request.prompt.length,
      prompt: normalizeLogText(request.prompt),
    });

    const context: AgentConnectRunContext = {
      runId,
      workspacePath: request.workspacePath,
      unit: { type: 'agent', id: agentId },
      provider: agent.provider,
    };

    ensureUnitAvailable(context);

    processManager.startAgentTerminalRun(agentId);
    processManager.addAgentTerminalUserMessage(agentId, request.prompt);

    const abortController = new AbortController();
    registerRun(context, abortController);
    emitAgentsUpdated?.(context.workspacePath);

    const autoProceed = storage.loadSettings?.()?.autoProceed !== false;

    void streamEvents(context, {
      runId,
      model: agent.model,
      reasoningEffort: agent.reasoningEffort ?? null,
      systemPrompt: buildAgentSystemPrompt({
        displayName: agent.displayName,
        name: agent.name,
        autoProceed,
      }),
      prompt: request.prompt,
      workspacePath: request.workspacePath,
      cwd: request.cwd,
      repoRoot: request.repoRoot,
      resumeSessionId,
      mcpServers,
      unit: context.unit,
      signal: abortController.signal,
      onSessionId: (sessionId) => {
        void setRunSessionId(runId, sessionId);
        updateProviderSessionId(context, sessionId);
      },
    });

    return { runId };
  };

  const runHeroPrompt = async (request: AgentConnectRunRequest): Promise<{ runId: string }> => {
    const hero = storage.loadHero(request.workspacePath);
    const runId = request.runId ?? `hero-${Date.now()}`;
    const resumeSessionId = hero.providerSessionIds?.[hero.provider] ?? request.resumeSessionId ?? null;
    const mcpServers = resolveRunMcpServers({
      unitType: 'hero',
      skillIds: hero.mcpSkillIds,
      provider: hero.provider,
      workspacePath: request.workspacePath,
      attachedFolderPath: request.cwd,
    });

    log.info('run.start', {
      runId,
      provider: hero.provider,
      model: hero.model || undefined,
      resumeSessionId,
      cwd: request.cwd,
      repoRoot: request.repoRoot,
      mcpServerCount: mcpServers ? Object.keys(mcpServers).length : 0,
      promptChars: request.prompt.length,
      prompt: normalizeLogText(request.prompt),
      unit: 'hero',
      workspacePath: request.workspacePath,
    });

    const context: AgentConnectRunContext = {
      runId,
      workspacePath: request.workspacePath,
      unit: { type: 'hero', id: 'hero' },
      provider: hero.provider,
    };

    ensureUnitAvailable(context);

    const abortController = new AbortController();
    registerRun(context, abortController);

    const autoProceed = storage.loadSettings?.()?.autoProceed !== false;

    void streamEvents(context, {
      runId,
      model: hero.model,
      reasoningEffort: hero.reasoningEffort ?? null,
      systemPrompt: buildHeroSystemPrompt(hero.name, { autoProceed }),
      prompt: request.prompt,
      workspacePath: request.workspacePath,
      cwd: request.cwd,
      repoRoot: request.repoRoot,
      resumeSessionId,
      mcpServers,
      unit: context.unit,
      signal: abortController.signal,
      onSessionId: (sessionId) => {
        void setRunSessionId(runId, sessionId);
        updateProviderSessionId(context, sessionId);
      },
    });

    return { runId };
  };

  const cancelRunByUnit = async (unitKey: string, reason?: string): Promise<boolean> => {
    const runId = activeRunByUnit.get(unitKey);
    if (!runId) {
      log.info('run.cancel.miss', { unitKey, reason: reason ?? 'unknown' });
      return false;
    }
    const state = activeRuns.get(runId);
    if (!state) {
      log.warn('run.cancel.orphan', { unitKey, runId, reason: reason ?? 'unknown' });
      return false;
    }
    log.info('run.cancel.requested', {
      runId,
      unitKey,
      sessionId: state.sessionId ?? null,
      reason: reason ?? 'unknown',
    });
    state.cancelRequested = true;
    state.abortController?.abort();
    if (state.sessionId) {
      try {
        await cancelSession(state.sessionId);
      } catch {
        // ignore
      }
    }
    return true;
  };

  const cancelAgentRun = async (agentId: string, reason?: string): Promise<boolean> =>
    cancelRunByUnit(`agent:${agentId}`, reason);

  const cancelHeroRun = async (workspacePath: string, reason?: string): Promise<boolean> =>
    cancelRunByUnit(`hero:${workspacePath}`, reason);

  const isAgentRunning = (agentId: string): boolean => activeRunByUnit.has(`agent:${agentId}`);

  return {
    handleSessionEvent,
    runAgentPrompt,
    runHeroPrompt,
    cancelAgentRun,
    cancelHeroRun,
    isAgentRunning,
  };
}
