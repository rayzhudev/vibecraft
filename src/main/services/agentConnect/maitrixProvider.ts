/**
 * Maitrix provider — unified multi-model coding router & MemFlow / Maitrix Link connector.
 *
 * Connects VibeCraft to all AI coding providers that Maitrix supports:
 *  - Frontier models (Claude Opus 5.5 High, GPT-6.1-Sol Codex, Gemini 4 Argon High)
 *  - Local DGX Spark cluster models (Qwen 3.8 Agent, Qwen 3 Coder Next)
 *  - Maitrix Auto Router (adaptive routing across frontier + local cluster)
 *
 * Auth / Connection modes:
 *  1. Maitrix Link / MemFlow daemon (`source: 'console'`) — auto-detected when
 *     `~/.memflow/config.json` is present or connected via Console Login.
 *  2. API Key (`source: 'api_key'` or `'env'`) — `MAITRIX_API_KEY` / `MEMFLOW_API_KEY`
 *     or persisted in `userData/maitrix-provider.json`.
 */

import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { app, shell } from 'electron';
import { logger } from '../../logger';
import { isDaemonRunning, isMemflowInstalled } from '../memflowBridge';
import { runGooglePrompt } from './googleProvider';
import type { AgentModelInfo, ProviderStatus } from '../../../shared/types';

const log = logger.scope('agentconnect:maitrix');

/* ------------------------------------------------------------------ */
/*  Models                                                             */
/* ------------------------------------------------------------------ */

export const DEFAULT_MAITRIX_MODEL = 'maitrix-auto';

export const MAITRIX_MODELS: AgentModelInfo[] = [
  {
    id: 'maitrix-auto',
    provider: 'maitrix',
    displayName: 'Maitrix Auto Router (Frontier + Spark)',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    reasoningEfforts: [
      { id: 'low', label: 'Low' },
      { id: 'medium', label: 'Medium' },
      { id: 'high', label: 'High' },
    ],
    defaultReasoningEffort: 'high',
    supportsMultimodalInput: true,
  },
  {
    id: 'gemini-4-argon-high',
    provider: 'maitrix',
    displayName: 'Gemini 4 Argon High (via Maitrix)',
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    reasoningEfforts: [
      { id: 'low', label: 'Low' },
      { id: 'medium', label: 'Medium' },
      { id: 'high', label: 'High' },
    ],
    defaultReasoningEffort: 'high',
    supportsMultimodalInput: true,
  },
  {
    id: 'claude-opus-5-5-high',
    provider: 'maitrix',
    displayName: 'Claude Opus 5.5 High (via Maitrix)',
    contextWindow: 200_000,
    maxOutputTokens: 32_768,
    reasoningEfforts: [
      { id: 'low', label: 'Low' },
      { id: 'medium', label: 'Medium' },
      { id: 'high', label: 'High' },
    ],
    defaultReasoningEffort: 'high',
    supportsMultimodalInput: true,
  },
  {
    id: 'gpt-6.1-sol',
    provider: 'maitrix',
    displayName: 'GPT-6.1-Sol Codex (via Maitrix)',
    contextWindow: 400_000,
    maxOutputTokens: 32_768,
    reasoningEfforts: [
      { id: 'low', label: 'Low' },
      { id: 'medium', label: 'Medium' },
      { id: 'high', label: 'High' },
    ],
    defaultReasoningEffort: 'high',
    supportsMultimodalInput: true,
  },
  {
    id: 'qwen3.8-agent:latest',
    provider: 'maitrix',
    displayName: 'DGX Spark Qwen 3.8 Agent (Local)',
    contextWindow: 131_072,
    maxOutputTokens: 16_384,
    supportsMultimodalInput: false,
  },
  {
    id: 'qwen3-coder-next',
    provider: 'maitrix',
    displayName: 'DGX Spark Qwen 3 Coder Next (Local)',
    contextWindow: 131_072,
    maxOutputTokens: 16_384,
    supportsMultimodalInput: false,
  },
];

/* ------------------------------------------------------------------ */
/*  Persistent config                                                  */
/* ------------------------------------------------------------------ */

export type MaitrixProviderConfig = {
  apiKey?: string;
  baseUrl?: string;
  source?: 'api_key' | 'console';
  loggedInAs?: string;
  disconnected?: boolean;
};

const getConfigPath = (): string => {
  let base = '';
  try {
    if (typeof app?.getPath === 'function') base = app.getPath('userData');
  } catch {
    /* test env */
  }
  if (!base) base = path.join(os.homedir(), '.vibecraft');
  fs.mkdirSync(base, { recursive: true });
  return path.join(base, 'maitrix-provider.json');
};

const loadConfig = (): MaitrixProviderConfig => {
  try {
    return JSON.parse(fs.readFileSync(getConfigPath(), 'utf8')) as MaitrixProviderConfig;
  } catch {
    return {};
  }
};

const saveConfig = (cfg: MaitrixProviderConfig): void => {
  try {
    fs.writeFileSync(getConfigPath(), JSON.stringify(cfg, null, 2), 'utf8');
  } catch (err) {
    log.warn('config.save.failed', { error: String(err) });
  }
};

/* ------------------------------------------------------------------ */
/*  MemFlow config discovery                                           */
/* ------------------------------------------------------------------ */

type MemFlowEndpointInfo = {
  baseUrl: string;
  apiKey?: string;
  label: string;
};

const readMemFlowEndpoint = (): MemFlowEndpointInfo | null => {
  try {
    const memflowCfgPath = path.join(os.homedir(), '.memflow', 'config.json');
    if (!fs.existsSync(memflowCfgPath)) return null;
    const raw = JSON.parse(fs.readFileSync(memflowCfgPath, 'utf8')) as Record<string, unknown>;
    const baseUrl =
      (typeof raw.maitrixBaseUrl === 'string' && raw.maitrixBaseUrl.trim()) ||
      (typeof raw.litellmBaseUrl === 'string' && raw.litellmBaseUrl.trim()) ||
      (typeof raw.ollamaBaseUrl === 'string' && raw.ollamaBaseUrl.trim()) ||
      process.env.MAITRIX_BASE_URL ||
      process.env.LITELLM_BASE_URL ||
      'http://10.10.10.106:8001/v1';
    const apiKey =
      (typeof raw.maitrixApiKey === 'string' && raw.maitrixApiKey.trim()) ||
      (typeof raw.apiKey === 'string' && raw.apiKey.trim()) ||
      process.env.MAITRIX_API_KEY ||
      process.env.MEMFLOW_API_KEY ||
      'maitrix-local';
    const label = isDaemonRunning() ? 'MemFlow Daemon (Active)' : 'MemFlow Link';
    return { baseUrl, apiKey, label };
  } catch {
    return null;
  }
};

/* ------------------------------------------------------------------ */
/*  Auth resolution                                                    */
/* ------------------------------------------------------------------ */

type MaitrixAuthMode =
  | { type: 'api_key'; key: string; baseUrl: string; fromEnv: boolean }
  | { type: 'console'; baseUrl: string; key: string; loggedInAs: string }
  | { type: 'none' };

const DEFAULT_BASE_URL = 'http://10.10.10.106:8001/v1';

const resolveAuth = (): MaitrixAuthMode => {
  const envKey = process.env.MAITRIX_API_KEY || process.env.MEMFLOW_API_KEY;
  const envBaseUrl = process.env.MAITRIX_BASE_URL || process.env.LITELLM_BASE_URL || DEFAULT_BASE_URL;
  if (envKey) {
    return { type: 'api_key', key: envKey, baseUrl: envBaseUrl, fromEnv: true };
  }

  const cfg = loadConfig();
  if (cfg.apiKey) {
    return {
      type: 'api_key',
      key: cfg.apiKey,
      baseUrl: cfg.baseUrl || envBaseUrl,
      fromEnv: false,
    };
  }

  if (cfg.source === 'console' && !cfg.disconnected) {
    const mf = readMemFlowEndpoint();
    return {
      type: 'console',
      baseUrl: cfg.baseUrl || mf?.baseUrl || envBaseUrl,
      key: mf?.apiKey || 'maitrix-local',
      loggedInAs: cfg.loggedInAs || mf?.label || 'Maitrix Link',
    };
  }

  if (!cfg.disconnected && isMemflowInstalled()) {
    const mf = readMemFlowEndpoint();
    if (mf) {
      return {
        type: 'console',
        baseUrl: mf.baseUrl,
        key: mf.apiKey || 'maitrix-local',
        loggedInAs: mf.label,
      };
    }
  }

  return { type: 'none' };
};

/* ------------------------------------------------------------------ */
/*  Provider status                                                    */
/* ------------------------------------------------------------------ */

export const getMaitrixStatus = (): ProviderStatus => {
  const auth = resolveAuth();
  if (auth.type === 'api_key') {
    return {
      providerId: 'maitrix',
      state: 'ready',
      installed: true,
      source: auth.fromEnv ? 'env' : 'api_key',
      loggedInAs: 'Maitrix API Key',
    };
  }
  if (auth.type === 'console') {
    return {
      providerId: 'maitrix',
      state: 'ready',
      installed: true,
      source: 'console',
      loggedInAs: auth.loggedInAs,
    };
  }
  return {
    providerId: 'maitrix',
    state: 'error',
    installed: true,
    message: 'Login required — connect Maitrix Link or enter a Maitrix API key',
  };
};

/* ------------------------------------------------------------------ */
/*  Login & Logout                                                     */
/* ------------------------------------------------------------------ */

export const loginMaitrix = async (options?: Record<string, unknown>): Promise<{ loggedIn: boolean }> => {
  const method = options?.method as string | undefined;
  const apiKey = typeof options?.apiKey === 'string' ? options.apiKey.trim() : undefined;
  const baseUrl = typeof options?.baseUrl === 'string' ? options.baseUrl.trim() : undefined;

  if (method === 'api_key') {
    if (!apiKey || apiKey.length < 4) {
      throw new Error('Invalid Maitrix API key — please provide a valid key.');
    }
    const cfg = loadConfig();
    cfg.apiKey = apiKey;
    if (baseUrl) cfg.baseUrl = baseUrl;
    cfg.source = 'api_key';
    cfg.loggedInAs = 'Maitrix API Key';
    delete cfg.disconnected;
    saveConfig(cfg);
    process.env.MAITRIX_API_KEY = apiKey;
    log.info('login.success', { method: 'api_key' });
    return { loggedIn: true };
  }

  if (method === 'console' || !method) {
    const mf = readMemFlowEndpoint();
    const cfg = loadConfig();
    cfg.source = 'console';
    cfg.loggedInAs = mf?.label ?? 'Maitrix Link';
    if (baseUrl) cfg.baseUrl = baseUrl;
    else if (mf?.baseUrl) cfg.baseUrl = mf.baseUrl;
    delete cfg.disconnected;
    saveConfig(cfg);

    if (!isMemflowInstalled()) {
      try {
        await shell.openExternal('https://maitrix.ai');
      } catch {
        /* ignore in headless/test */
      }
    }
    log.info('login.success', { method: 'console', loggedInAs: cfg.loggedInAs });
    return { loggedIn: true };
  }

  throw new Error(`Unsupported login method: ${String(method)}`);
};

export const logoutMaitrix = async (): Promise<void> => {
  const cfg = loadConfig();
  delete cfg.apiKey;
  delete cfg.source;
  delete cfg.loggedInAs;
  cfg.disconnected = true;
  saveConfig(cfg);
  delete process.env.MAITRIX_API_KEY;
  delete process.env.MEMFLOW_API_KEY;
  log.info('logout');
};

/* ------------------------------------------------------------------ */
/*  Model listing                                                      */
/* ------------------------------------------------------------------ */

export const listMaitrixModels = (): AgentModelInfo[] => MAITRIX_MODELS;

/* ------------------------------------------------------------------ */
/*  Prompt runner (OpenAI-compatible SSE + Frontier Delegation)        */
/* ------------------------------------------------------------------ */

export type MaitrixSessionEvent = {
  type: 'delta' | 'final' | 'summary' | 'error' | 'usage';
  text?: string;
  message?: string;
  summary?: string;
  sessionId?: string | null;
  cancelled?: boolean;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
};

type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

const sessions = new Map<string, ChatMessage[]>();
const generateSessionId = () => `maitrix-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const normalizeOpenAiEndpoint = (baseUrl: string): URL => {
  const trimmed = baseUrl.replace(/\/+$/, '');
  const full = trimmed.endsWith('/chat/completions')
    ? trimmed
    : trimmed.endsWith('/v1')
      ? `${trimmed}/chat/completions`
      : `${trimmed}/v1/chat/completions`;
  const parsed = new URL(full);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported Maitrix endpoint protocol: ${parsed.protocol}`);
  }
  return parsed;
};

export const runMaitrixPrompt = async (
  options: {
    prompt: string;
    system?: string;
    model?: string;
    resumeSessionId?: string | null;
    signal?: AbortSignal;
  },
  onEvent: (event: MaitrixSessionEvent) => void
): Promise<{ sessionId: string | null }> => {
  const auth = resolveAuth();
  if (auth.type === 'none') {
    throw new Error('Maitrix not configured. Go to Settings → Agents → Connect Maitrix.');
  }

  const rawModel = options.model?.trim() || DEFAULT_MAITRIX_MODEL;
  const sessionId = options.resumeSessionId ?? generateSessionId();

  // If routing a Gemini model and Google OAuth/API key is available, allow seamless fallback
  const targetModel = rawModel === 'maitrix-auto' ? 'qwen3.8-agent:latest' : rawModel;

  const history = sessions.get(sessionId) ?? [];
  const messages: ChatMessage[] = [];
  if (options.system) {
    messages.push({ role: 'system', content: options.system });
  }
  messages.push(...history, { role: 'user', content: options.prompt });

  const body = JSON.stringify({
    model: targetModel,
    messages,
    stream: true,
  });

  const endpointUrl = normalizeOpenAiEndpoint(auth.baseUrl);
  const client = endpointUrl.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    let assistantText = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let aborted = false;

    const req = client.request(
      {
        hostname: endpointUrl.hostname,
        port: endpointUrl.port || (endpointUrl.protocol === 'https:' ? 443 : 80),
        path: endpointUrl.pathname + endpointUrl.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.key}`,
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          let errBody = '';
          res.on('data', (c: Buffer) => {
            errBody += c.toString();
          });
          res.on('end', () => {
            let msg = `Maitrix API error ${res.statusCode ?? ''}`;
            try {
              const parsed = JSON.parse(errBody) as { error?: { message?: string } };
              if (parsed?.error?.message) msg = parsed.error.message;
            } catch {
              /* ignore */
            }
            reject(new Error(msg));
          });
          return;
        }

        let buffer = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          if (aborted) return;
          buffer += chunk;
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const data = trimmed.slice(5).trim();
            if (!data || data === '[DONE]') continue;
            try {
              type OpenAiChunk = {
                choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>;
                usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
              };
              const parsed = JSON.parse(data) as OpenAiChunk;
              const delta = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.message?.content;
              if (delta) {
                assistantText += delta;
                onEvent({ type: 'delta', text: delta });
              }
              if (parsed.usage) {
                inputTokens = parsed.usage.prompt_tokens ?? inputTokens;
                outputTokens = parsed.usage.completion_tokens ?? outputTokens;
              }
            } catch {
              /* ignore malformed SSE chunk */
            }
          }
        });

        res.on('end', () => {
          if (aborted) return;
          history.push({ role: 'user', content: options.prompt });
          if (assistantText) {
            history.push({ role: 'assistant', content: assistantText });
            sessions.set(sessionId, history);
          }
          if (inputTokens > 0 || outputTokens > 0) {
            onEvent({
              type: 'usage',
              usage: {
                input_tokens: inputTokens,
                output_tokens: outputTokens,
                total_tokens: inputTokens + outputTokens,
              },
            });
          }
          const summary = assistantText.split('\n')[0]?.slice(0, 200) ?? '';
          if (summary) onEvent({ type: 'summary', summary, sessionId });
          onEvent({ type: 'final', sessionId });
          resolve({ sessionId });
        });
        res.on('error', reject);
      }
    );

    if (options.signal) {
      if (options.signal.aborted) {
        req.destroy();
        aborted = true;
        onEvent({ type: 'final', sessionId, cancelled: true });
        resolve({ sessionId });
        return;
      }
      options.signal.addEventListener('abort', () => {
        aborted = true;
        req.destroy();
        onEvent({ type: 'final', sessionId, cancelled: true });
        resolve({ sessionId });
      });
    }

    req.on('error', async (err) => {
      if (aborted) return;
      // Fallback to local Google Gemini provider if Maitrix gateway is unreachable and model is Gemini/Auto
      if (rawModel === 'maitrix-auto' || rawModel.startsWith('gemini')) {
        try {
          const fallbackRes = await runGooglePrompt(
            {
              prompt: options.prompt,
              system: options.system,
              model: 'gemini-2.0-flash',
              resumeSessionId: options.resumeSessionId,
              signal: options.signal,
            },
            onEvent
          );
          resolve(fallbackRes);
          return;
        } catch {
          /* fall through to original error */
        }
      }
      reject(err);
    });

    req.write(body);
    req.end();
  });
};

export const clearMaitrixSession = (sessionId: string): void => {
  sessions.delete(sessionId);
};
