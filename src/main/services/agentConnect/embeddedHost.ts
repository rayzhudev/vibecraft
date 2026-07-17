import type {
  AgentConnectBridge,
  ProviderId,
  ProviderInfo,
  SessionEvent,
  ModelInfo,
} from '@agentconnect/host';
import { createHostBridge } from '@agentconnect/host';
import { app } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { logger } from '../../logger';
import type {
  AgentModelInfo,
  AgentProvider,
  McpServerConfig,
  ProviderDescriptor,
  ProviderStatus,
} from '../../../shared/types';
import { isSupportedAgentProvider, SUPPORTED_AGENT_PROVIDERS } from '../../../shared/providers';
import {
  getGoogleStatus,
  loginGoogle,
  logoutGoogle,
  listGoogleModels,
  runGooglePrompt,
  clearGoogleSession,
} from './googleProvider';

type RunPromptOptions = {
  prompt: string;
  resumeSessionId?: string | null;
  model?: string;
  reasoningEffort?: string;
  system?: string;
  mcpServers?: Record<string, McpServerConfig>;
  repoRoot?: string;
  cwd?: string;
  signal?: AbortSignal;
};
type RunPromptResult = { sessionId: string | null };

const log = logger.scope('agentconnect:embedded');

let bridge: AgentConnectBridge | null = null;
let bridgeUnsubscribe: (() => void) | null = null;
const sessionListeners = new Map<string, Set<(event: SessionEvent) => void>>();

/**
 * Provider-relevant environment variables that may be set via direnv, .envrc, or shell profiles.
 * When found, these are merged into process.env so @agentconnect/host provider CLIs can use them.
 */
const PROVIDER_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'CURSOR_API_KEY',
] as const;

/**
 * Attempt to load the user's login-shell environment.
 * Electron apps launched from macOS Dock/Spotlight don't inherit shell environments,
 * so direnv-managed API keys and custom PATH entries would be missing without this.
 */
const loadShellEnv = (): Record<string, string> => {
  try {
    const shell = process.env.SHELL || '/bin/zsh';
    const { execFileSync } = require('child_process');
    const output = execFileSync(shell, ['-ilc', 'env'], {
      encoding: 'utf8',
      timeout: 5_000,
      env: { ...process.env, TERM: 'dumb' },
    });
    const env: Record<string, string> = {};
    for (const line of output.split('\n')) {
      const eqIdx = line.indexOf('=');
      if (eqIdx > 0) {
        env[line.slice(0, eqIdx)] = line.slice(eqIdx + 1);
      }
    }
    return env;
  } catch {
    return {};
  }
};

const ensureUserPath = (): void => {
  // Load the login shell environment to pick up direnv / .envrc API keys
  const shellEnv = loadShellEnv();

  // Merge provider-relevant environment variables from the login shell
  for (const key of PROVIDER_ENV_KEYS) {
    if (!process.env[key] && shellEnv[key]) {
      process.env[key] = shellEnv[key];
    }
  }

  const delimiter = path.delimiter;
  // Use shell PATH as additional source if the current PATH is sparse (typical for Dock launches)
  const shellPath = shellEnv.PATH ?? '';
  const rawPath = process.env.PATH ?? '';
  const existing = rawPath.split(delimiter).filter(Boolean);
  const shellEntries = shellPath.split(delimiter).filter(Boolean);
  const seen = new Set<string>();
  const home = os.homedir();
  const preferred = [
    path.join(home, '.bun', 'bin'),
    path.join(home, '.local', 'bin'),
    path.join(home, '.cargo', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ];
  const next: string[] = [];
  const appendEntries = (entries: string[]) => {
    for (const entry of entries) {
      if (!entry || seen.has(entry)) continue;
      next.push(entry);
      seen.add(entry);
    }
  };
  const appendPreferredMissing = () => {
    for (const candidate of preferred) {
      if (seen.has(candidate)) continue;
      if (fs.existsSync(candidate)) {
        next.push(candidate);
        seen.add(candidate);
      }
    }
  };
  // Start with existing PATH entries, then add shell-sourced entries, then preferred
  appendEntries(existing);
  appendEntries(shellEntries);
  appendPreferredMissing();
  process.env.PATH = next.join(delimiter);
};

const resolveAgentConnectBasePath = (): string => {
  let basePath = '';
  if (typeof app?.getPath === 'function') {
    basePath = app.getPath('userData');
  }
  if (!basePath) {
    basePath = path.join(os.tmpdir(), 'vibecraft-agentconnect');
  }
  fs.mkdirSync(basePath, { recursive: true });
  return basePath;
};

const getBridge = (): AgentConnectBridge => {
  if (!bridge) {
    ensureUserPath();
    bridge = createHostBridge({
      mode: 'embedded',
      logSpawn: false,
      basePath: resolveAgentConnectBasePath(),
    });
  }
  if (!bridgeUnsubscribe && bridge.onEvent) {
    bridgeUnsubscribe = bridge.onEvent((notification) => {
      if (notification.method !== 'acp.session.event') return;
      const params = notification.params as
        | { sessionId?: string; type?: string; data?: Record<string, unknown> }
        | undefined;
      const sessionId = params?.sessionId;
      const type = params?.type;
      if (!sessionId || !type) return;
      const handlers = sessionListeners.get(sessionId);
      if (!handlers || handlers.size === 0) return;
      const event = { type, ...(params?.data ?? {}) } as SessionEvent;
      handlers.forEach((handler) => handler(event));
    });
  }
  return bridge;
};

const mapStatus = (info: ProviderInfo): ProviderStatus => {
  const base = {
    providerId: info.id,
    installed: info.installed,
    message: info.updateMessage,
    source: (info as any).source,
    loggedInAs: (info as any).loggedInAs,
  };

  if (!info.installed) {
    return {
      ...base,
      state: 'missing',
      installed: false,
    };
  }
  if (info.updateInProgress) {
    return {
      ...base,
      state: 'installing',
      installed: true,
      message: info.updateMessage ?? 'Updating',
    };
  }
  if (!info.loggedIn) {
    return {
      ...base,
      state: 'error',
      installed: true,
      message: 'Login required',
    };
  }
  return {
    ...base,
    state: 'ready',
    installed: true,
  };
};

const request = async <T>(method: string, params?: Record<string, unknown>): Promise<T> => {
  const host = getBridge();
  return host.request(method, params) as Promise<T>;
};

const isUnknownSessionError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes('ac_err_invalid_args') && message.includes('unknown session');
};

const resolveSessionMcpServers = (
  mcpServers?: Record<string, McpServerConfig>
): Record<string, McpServerConfig> | null => {
  if (!mcpServers || Object.keys(mcpServers).length === 0) return null;
  return mcpServers;
};

/** Friendly fallback names for providers the bridge may not return */
const PROVIDER_FALLBACK_NAMES: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  cursor: 'Cursor',
  google: 'Gemini',
};

export const listProviders = async (): Promise<ProviderDescriptor[]> => {
  const response = await request<{ providers?: ProviderInfo[] }>('acp.providers.list');
  const hostProviders = (response.providers ?? []).filter((provider) => isSupportedAgentProvider(provider.id));
  const hostMap = new Map<string, ProviderInfo>(hostProviders.map((p) => [p.id, p]));

  // Ensure every SUPPORTED_AGENT_PROVIDERS entry appears, even if the host bridge didn't return it
  return SUPPORTED_AGENT_PROVIDERS.map((id) => {
    const host = hostMap.get(id);
    return { id, name: host?.name ?? PROVIDER_FALLBACK_NAMES[id] ?? id };
  });
};

export const getProviderStatus = async (
  providerId: ProviderId | string,
  options?: { fast?: boolean; force?: boolean }
): Promise<ProviderStatus> => {
  // Google/Gemini is not a native @agentconnect/host provider — delegate to our standalone module
  if (providerId === 'google') {
    return getGoogleStatus();
  }
  try {
    const response = await request<{ provider: ProviderInfo }>('acp.providers.status', {
      provider: providerId,
      options,
    });
    return mapStatus(response.provider);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load provider status';
    log.warn('provider.status.error', { providerId, message });
    // Return 'missing' rather than 'unknown' so the UI shows a clear "Not Installed"
    // with an actionable Install button instead of an eternal "Checking..." spinner
    return {
      providerId,
      state: 'missing',
      installed: false,
      message,
    };
  }
};

export const ensureProviderInstalled = async (providerId: ProviderId | string): Promise<ProviderStatus> => {
  // Google is always "installed" — it uses the REST API, no binary needed
  if (providerId === 'google') {
    return getGoogleStatus();
  }
  await request('acp.providers.ensureInstalled', { provider: providerId });
  const response = await request<{ provider: ProviderInfo }>('acp.providers.status', {
    provider: providerId,
  });
  return mapStatus(response.provider);
};

export const loginProvider = async (
  providerId: ProviderId | string,
  options?: Record<string, unknown>
): Promise<{ loggedIn: boolean }> => {
  // Delegate Google login to our standalone module
  if (providerId === 'google') {
    return loginGoogle(options);
  }
  const response = await request<{ loggedIn: boolean }>('acp.providers.login', {
    provider: providerId,
    options,
  });
  return response;
};

/**
 * Log out from a provider. Currently only implemented for Google/Gemini
 * (clears the stored API key). Other providers handle logout through the bridge.
 */
export const logoutProvider = async (providerId: ProviderId | string): Promise<void> => {
  if (providerId === 'google') {
    logoutGoogle();
  }
};

export const listRecentModelInfo = async (providerId: ProviderId | string): Promise<AgentModelInfo[]> => {
  // Google models come from our static list, not the bridge
  if (providerId === 'google') {
    return listGoogleModels();
  }
  const recentResponse = await request<{ models?: ModelInfo[] }>('acp.models.recent', {
    provider: providerId,
  });
  const recent = recentResponse.models ?? [];
  const normalize = (models: ModelInfo[]): AgentModelInfo[] =>
    models
      .filter((model) => isSupportedAgentProvider(model.provider))
      .map((model) => ({ ...model, provider: model.provider as AgentProvider }));

  let listed: ModelInfo[] = [];
  try {
    const listResponse = await request<{ models?: ModelInfo[] }>('acp.models.list', {
      provider: providerId,
    });
    listed = listResponse.models ?? [];
  } catch {
    if (recent.length > 0) {
      return normalize(recent);
    }
  }
  if (recent.length === 0) {
    return normalize(listed);
  }
  if (listed.length === 0) {
    return normalize(recent);
  }
  const recentIds = new Set(recent.map((model) => model.id));
  const merged = [...recent];
  for (const model of listed) {
    if (!recentIds.has(model.id)) {
      merged.push(model);
    }
  }
  return normalize(merged);
};

export const resolveProviderForModel = async (model: string | undefined): Promise<ProviderId> => {
  if (!model) {
    throw new Error('Model is required to resolve provider');
  }
  const response = await request<{ model: ModelInfo }>('acp.models.info', { model });
  return response.model.provider;
};

export const runProviderPrompt = async (
  providerId: ProviderId | string,
  options: Omit<RunPromptOptions, 'onEvent'>,
  onEvent: (event: SessionEvent) => void,
  onSessionId?: (sessionId: string) => void
): Promise<RunPromptResult> => {
  // Route Google prompts through our standalone Gemini REST implementation
  if (providerId === 'google') {
    const result = await runGooglePrompt(
      {
        prompt: options.prompt,
        system: options.system,
        model: options.model,
        resumeSessionId: options.resumeSessionId,
        signal: options.signal,
      },
      (googleEvent) => {
        // Map GoogleSessionEvent → SessionEvent shape expected by runner
        if (googleEvent.type === 'delta') {
          onEvent({ type: 'delta', text: googleEvent.text ?? '' } as SessionEvent);
        } else if (googleEvent.type === 'final') {
          onSessionId?.(googleEvent.sessionId ?? '');
          onEvent({
            type: 'final',
            cancelled: googleEvent.cancelled ?? false,
          } as SessionEvent);
        } else if (googleEvent.type === 'summary') {
          onEvent({
            type: 'summary',
            summary: googleEvent.summary ?? '',
            source: 'prompt',
          } as SessionEvent);
        } else if (googleEvent.type === 'usage') {
          onEvent({
            type: 'usage',
            usage: {
              input_tokens: googleEvent.usage?.input_tokens,
              output_tokens: googleEvent.usage?.output_tokens,
              total_tokens: googleEvent.usage?.total_tokens,
            },
          } as unknown as SessionEvent);
        } else if (googleEvent.type === 'error') {
          onEvent({ type: 'error', message: googleEvent.message ?? 'Gemini error' } as SessionEvent);
        }
      }
    );
    return result;
  }
  const summaryWaitMs = 10000;
  const sessionId = options.resumeSessionId ?? null;
  const signal = options.signal;
  const abortHandler = signal ? () => void handleAbort() : null;
  let activeSessionId: string | null = null;
  let cancelRequested = false;
  let finished = false;
  let sawFinal = false;
  let sawSummary = false;
  let finalTimer: NodeJS.Timeout | null = null;
  let resolveDone: (() => void) | null = null;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const markDone = () => {
    if (finished) return;
    finished = true;
    if (finalTimer) {
      clearTimeout(finalTimer);
      finalTimer = null;
    }
    resolveDone?.();
  };

  const handleAbort = async () => {
    cancelRequested = true;
    log.info('run.abort', {
      sessionId: activeSessionId ?? null,
      hasSessionId: Boolean(activeSessionId),
      signalAborted: Boolean(signal?.aborted),
    });
    if (!activeSessionId) return;
    try {
      await cancelSession(activeSessionId);
    } catch {
      // ignore
    }
    if (!finished) {
      onEvent({ type: 'final', cancelled: true } as SessionEvent);
      markDone();
    }
  };

  if (signal) {
    if (signal.aborted) {
      await handleAbort();
    } else if (abortHandler) {
      signal.addEventListener('abort', abortHandler);
    }
  }
  const createSession = async (): Promise<string> =>
    (
      await request<{ sessionId: string }>('acp.sessions.create', {
        provider: providerId,
        model: options.model,
        reasoningEffort: options.reasoningEffort,
        system: options.system,
        mcpServers: resolveSessionMcpServers(options.mcpServers),
        cwd: options.cwd,
        repoRoot: options.repoRoot,
      })
    ).sessionId;

  if (sessionId) {
    try {
      activeSessionId = (
        await request<{ sessionId: string }>('acp.sessions.resume', {
          sessionId,
          model: options.model,
          reasoningEffort: options.reasoningEffort,
          system: options.system,
          mcpServers: resolveSessionMcpServers(options.mcpServers),
          cwd: options.cwd,
          repoRoot: options.repoRoot,
        })
      ).sessionId;
    } catch (error) {
      if (!isUnknownSessionError(error)) throw error;
      activeSessionId = await createSession();
    }
  } else {
    activeSessionId = await createSession();
  }

  onSessionId?.(activeSessionId);

  if (cancelRequested) {
    log.info('run.cancel.requested', {
      sessionId: activeSessionId,
      reason: 'abort-before-run',
    });
    try {
      await cancelSession(activeSessionId);
    } catch {
      // ignore
    }
    if (!finished) {
      onEvent({ type: 'final', cancelled: true } as SessionEvent);
      markDone();
    }
    if (signal && abortHandler) {
      signal.removeEventListener('abort', abortHandler);
    }
    return { sessionId: activeSessionId };
  }

  const handlers = sessionListeners.get(activeSessionId) ?? new Set<(event: SessionEvent) => void>();
  sessionListeners.set(activeSessionId, handlers);

  const handleEvent = (event: SessionEvent) => {
    if (finished) return;
    onEvent(event);
    if (event.type === 'summary') {
      sawSummary = true;
      if (sawFinal) {
        markDone();
      }
      return;
    }
    if (event.type === 'final') {
      sawFinal = true;
      if (sawSummary) {
        markDone();
      } else {
        finalTimer = setTimeout(() => {
          if (finished) return;
          markDone();
        }, summaryWaitMs);
      }
    }
    if (event.type === 'error') {
      markDone();
    }
  };
  handlers.add(handleEvent);

  try {
    await request('acp.sessions.send', {
      sessionId: activeSessionId,
      message: { role: 'user', content: options.prompt },
      mcpServers: resolveSessionMcpServers(options.mcpServers),
      cwd: options.cwd,
      repoRoot: options.repoRoot,
    });
    await done;
  } finally {
    handlers.delete(handleEvent);
    if (handlers.size === 0) {
      sessionListeners.delete(activeSessionId);
    }
    if (signal && abortHandler) {
      signal.removeEventListener('abort', abortHandler);
    }
    if (finalTimer) {
      clearTimeout(finalTimer);
    }
  }

  return { sessionId: activeSessionId };
};

export const cancelSession = async (sessionId: string): Promise<void> => {
  // Google sessions are managed locally — just clear the context
  if (sessionId.startsWith('google-')) {
    clearGoogleSession(sessionId);
    return;
  }
  await request('acp.sessions.cancel', { sessionId });
};
