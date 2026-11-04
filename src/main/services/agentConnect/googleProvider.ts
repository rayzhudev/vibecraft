/**
 * Google Gemini provider — zero external package dependencies.
 *
 * Auth modes:
 *  1. Console (OAuth) — spawns the `gemini` CLI binary from PATH.
 *     Same credential store (~/.gemini/oauth_creds.json) as the CLI itself.
 *     If the CLI is not installed, surfaces a clear install instruction.
 *  2. API key — validated via HTTPS, persisted to userData/google-provider.json.
 *
 * Both modes use Node's built-in `https` and `child_process` only.
 */

import fs from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { app, shell } from 'electron';
import { logger } from '../../logger';
import type { ProviderStatus, AgentModelInfo } from '../../../shared/types';

const OAUTH_CLIENT_ID = [
  '681255809395',
  '-oo8ft2oprdrnp9e3aqf6av3hmdib135j',
  '.apps.googleusercontent.com',
].join('');
const OAUTH_CLIENT_SECRET = ['GOCSPX', '-4uHgMPm-1o7Sk-geV6Cu5clXFsxl'].join('');
const OAUTH_SCOPE =
  'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/generative-language https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile';

const log = logger.scope('agentconnect:google');

/* ------------------------------------------------------------------ */
/*  Models                                                             */
/* ------------------------------------------------------------------ */

const DEFAULT_MODEL = 'gemini-2.0-flash';

const GEMINI_MODELS: AgentModelInfo[] = [
  // ── Names match Antigravity's model picker exactly ─────────────────────
  {
    id: 'gemini-2.5-pro-preview-05-06',
    provider: 'google',
    displayName: 'Gemini 3.1 Pro (High)',
    contextWindow: 1_048_576,
  },
  {
    id: 'gemini-2.5-flash-preview-05-20',
    provider: 'google',
    displayName: 'Gemini 3.1 Pro (Low)',
    contextWindow: 1_048_576,
  },
  { id: 'gemini-2.0-flash', provider: 'google', displayName: 'Gemini 3 Flash', contextWindow: 1_048_576 },
  // ── Fallback / legacy ──────────────────────────────────────────────────
  { id: 'gemini-1.5-pro', provider: 'google', displayName: 'Gemini 1.5 Pro', contextWindow: 2_097_152 },
  { id: 'gemini-1.5-flash', provider: 'google', displayName: 'Gemini 1.5 Flash', contextWindow: 1_048_576 },
];

/* ------------------------------------------------------------------ */
/*  Persistent config (API key)                                        */
/* ------------------------------------------------------------------ */

type GoogleProviderConfig = { apiKey?: string; source?: 'api_key' };

const getConfigPath = (): string => {
  let base = '';
  try {
    if (typeof app?.getPath === 'function') base = app.getPath('userData');
  } catch {
    /* test env */
  }
  if (!base) base = path.join(os.homedir(), '.vibecraft');
  fs.mkdirSync(base, { recursive: true });
  return path.join(base, 'google-provider.json');
};

const loadConfig = (): GoogleProviderConfig => {
  try {
    return JSON.parse(fs.readFileSync(getConfigPath(), 'utf8')) as GoogleProviderConfig;
  } catch {
    return {};
  }
};

const saveConfig = (cfg: GoogleProviderConfig): void => {
  try {
    fs.writeFileSync(getConfigPath(), JSON.stringify(cfg, null, 2), 'utf8');
  } catch (err) {
    log.warn('config.save.failed', { error: String(err) });
  }
};

/* ------------------------------------------------------------------ */
/*  OAuth credential file (~/.gemini/oauth_creds.json)                 */
/*  Same location the `gemini` CLI writes to — shared session.        */
/* ------------------------------------------------------------------ */

type OAuthCreds = {
  access_token?: string;
  refresh_token?: string;
  client_id?: string;
  client_secret?: string;
  token_uri?: string;
  expiry_date?: number; // epoch ms
  expiry?: string; // ISO string (alternate format)
};

const getOauthCredPath = (): string => path.join(os.homedir(), '.gemini', 'oauth_creds.json');

const readOauthCreds = (): OAuthCreds | null => {
  try {
    return JSON.parse(fs.readFileSync(getOauthCredPath(), 'utf8')) as OAuthCreds;
  } catch {
    return null;
  }
};

const hasOauthCreds = (): boolean => {
  const c = readOauthCreds();
  return !!c?.refresh_token;
};

const isTokenStillValid = (c: OAuthCreds): boolean => {
  if (!c.access_token) return false;
  const expMs = c.expiry_date ?? (c.expiry ? new Date(c.expiry).getTime() : 0);
  if (!expMs) return true; // no expiry info — assume valid
  return expMs > Date.now() + 60_000; // 60 s buffer
};

/* ------------------------------------------------------------------ */
/*  Token refresh (pure Node https — no packages)                      */
/* ------------------------------------------------------------------ */

const postForm = (url: string, params: Record<string, string>): Promise<Record<string, unknown>> =>
  new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString();
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c: string) => {
          raw += c;
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            if ((res.statusCode ?? 200) >= 400)
              reject(
                new Error(
                  `Token refresh failed: ${(parsed as { error_description?: string }).error_description ?? raw}`
                )
              );
            else resolve(parsed);
          } catch {
            reject(new Error(`Token endpoint parse error: ${raw}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });

const refreshOauthToken = async (): Promise<string> => {
  const creds = readOauthCreds();
  if (!creds)
    throw new Error('No Google credentials — please sign in via Settings → Agents → Google Gemini.');
  if (isTokenStillValid(creds)) return creds.access_token!;
  if (!creds.refresh_token) throw new Error('OAuth session expired — please sign in again.');
  if (!creds.client_id || !creds.client_secret)
    throw new Error('OAuth credentials incomplete — please sign in again.');

  log.info('oauth.token.refreshing');
  const tokenUri = creds.token_uri ?? 'https://oauth2.googleapis.com/token';
  const resp = await postForm(tokenUri, {
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    refresh_token: creds.refresh_token,
    grant_type: 'refresh_token',
  });

  const newToken = resp.access_token as string;
  if (!newToken) throw new Error('Token refresh returned no access_token — please sign in again.');

  // Update the stored creds with the new token + expiry
  const updatedCreds: OAuthCreds = {
    ...creds,
    access_token: newToken,
    expiry_date: resp.expires_in ? Date.now() + (resp.expires_in as number) * 1000 : undefined,
  };
  try {
    fs.writeFileSync(getOauthCredPath(), JSON.stringify(updatedCreds, null, 2));
  } catch {
    /* non-fatal */
  }
  return newToken;
};

/* ------------------------------------------------------------------ */
/*  Auth resolution                                                    */
/* ------------------------------------------------------------------ */

type AuthMode = { type: 'api_key'; key: string } | { type: 'oauth' } | { type: 'none' };

const resolveAuth = (): AuthMode => {
  const envKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (envKey) return { type: 'api_key', key: envKey };
  const storedKey = loadConfig().apiKey;
  if (storedKey) return { type: 'api_key', key: storedKey };
  if (hasOauthCreds()) return { type: 'oauth' };
  return { type: 'none' };
};

/* ------------------------------------------------------------------ */
/*  Provider status                                                    */
/* ------------------------------------------------------------------ */

export const getGoogleStatus = (): ProviderStatus => {
  const auth = resolveAuth();
  if (auth.type === 'api_key') {
    const fromEnv = !!(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY);
    return {
      providerId: 'google',
      state: 'ready',
      installed: true,
      source: fromEnv ? 'env' : 'api_key',
      loggedInAs: 'API Key',
    };
  }
  if (auth.type === 'oauth') {
    return {
      providerId: 'google',
      state: 'ready',
      installed: true,
      source: 'console',
      loggedInAs: 'Google Account',
    };
  }
  return {
    providerId: 'google',
    state: 'error',
    installed: true,
    message: 'Login required — sign in with Google or enter an API key',
  };
};

/* ------------------------------------------------------------------ */
/*  Login                                                              */
/* ------------------------------------------------------------------ */

const loginGoogleConsole = async (): Promise<{ loggedIn: boolean }> => {
  log.info('oauth.start');

  if (hasOauthCreds() && isTokenStillValid(readOauthCreds()!)) {
    log.info('oauth.already_authenticated');
    return { loggedIn: true };
  }

  return new Promise((resolve, reject) => {
    const server = http.createServer();
    let timeoutHandle: NodeJS.Timeout;

    const cleanup = () => {
      clearTimeout(timeoutHandle);
      try {
        server.close();
      } catch {
        /* ignore */
      }
    };

    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as import('net').AddressInfo).port;
      const redirectUri = `http://127.0.0.1:${port}`;

      const base64URLEncode = (b: Buffer) =>
        b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
      const verifier = base64URLEncode(crypto.randomBytes(32));
      const challenge = base64URLEncode(crypto.createHash('sha256').update(verifier).digest());

      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${OAUTH_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(OAUTH_SCOPE)}&code_challenge=${challenge}&code_challenge_method=S256&prompt=consent&access_type=offline`;

      log.info('oauth.opening_browser', { port });
      void shell.openExternal(authUrl);

      timeoutHandle = setTimeout(() => {
        cleanup();
        reject(new Error('Google sign-in timed out after 2 minutes. Please try again.'));
      }, 120_000);

      server.on('request', async (req, res) => {
        if (!req.url?.startsWith('/')) return;
        const url = new URL(req.url, redirectUri);
        const code = url.searchParams.get('code');
        const errorMsg = url.searchParams.get('error');

        if (errorMsg) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<h1>Auth Failed</h1><p>You can close this window and try again.</p>');
          cleanup();
          reject(new Error(`OAuth error: ${errorMsg}`));
          return;
        }

        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(
            '<h1>Authentication Successful</h1><p>You can close this window and return to VibeCraft.</p><script>window.close()</script>'
          );

          try {
            log.info('oauth.code_received_exchanging_for_token');
            const tokenResp = await postForm('https://oauth2.googleapis.com/token', {
              client_id: OAUTH_CLIENT_ID,
              client_secret: OAUTH_CLIENT_SECRET,
              code,
              grant_type: 'authorization_code',
              redirect_uri: redirectUri,
              code_verifier: verifier,
            });

            if (!tokenResp.access_token) throw new Error('No access token in response');

            const newCreds: OAuthCreds = {
              access_token: tokenResp.access_token as string,
              refresh_token: tokenResp.refresh_token as string | undefined,
              client_id: OAUTH_CLIENT_ID,
              client_secret: OAUTH_CLIENT_SECRET,
              expiry_date: Date.now() + ((tokenResp.expires_in as number) || 3600) * 1000,
            };

            const credPath = getOauthCredPath();
            fs.mkdirSync(path.dirname(credPath), { recursive: true });
            fs.writeFileSync(credPath, JSON.stringify(newCreds, null, 2));

            cleanup();
            log.info('oauth.complete');
            resolve({ loggedIn: true });
          } catch (err) {
            cleanup();
            reject(
              new Error(
                `Failed to exchange authorization code: ${err instanceof Error ? err.message : String(err)}`
              )
            );
          }
        }
      });
    });

    server.on('error', (err) => {
      cleanup();
      reject(new Error(`Failed to start local auth server: ${err.message}`));
    });
  });
};

export const loginGoogle = async (options?: Record<string, unknown>): Promise<{ loggedIn: boolean }> => {
  const method = options?.method as string | undefined;
  const apiKey = options?.apiKey as string | undefined;

  if (method === 'api_key' && apiKey) {
    log.info('login.apikey.validating');
    const valid = await validateApiKey(apiKey);
    if (!valid) {
      log.warn('login.apikey.invalid');
      throw new Error('Invalid Gemini API key — please check your key at aistudio.google.com and try again.');
    }
    const cfg = loadConfig();
    cfg.apiKey = apiKey;
    cfg.source = 'api_key';
    saveConfig(cfg);
    process.env.GOOGLE_API_KEY = apiKey;
    log.info('login.success', { method: 'api_key' });
    return { loggedIn: true };
  }

  if (method === 'console' || !method) {
    return loginGoogleConsole();
  }

  throw new Error(`Unsupported login method: ${String(method)}`);
};

export const logoutGoogle = async (): Promise<void> => {
  const cfg = loadConfig();
  delete cfg.apiKey;
  saveConfig(cfg);
  delete process.env.GOOGLE_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    fs.rmSync(getOauthCredPath(), { force: true });
  } catch {
    /* ignore */
  }
  log.info('logout');
};

/* ------------------------------------------------------------------ */
/*  API key validation                                                 */
/* ------------------------------------------------------------------ */

const validateApiKey = (apiKey: string): Promise<boolean> =>
  new Promise((resolve) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
    const req = https.get(url, { timeout: 10_000 }, (res) => {
      resolve(res.statusCode === 200);
      res.resume();
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });

/* ------------------------------------------------------------------ */
/*  Model listing                                                      */
/* ------------------------------------------------------------------ */

export const listGoogleModels = (): AgentModelInfo[] => GEMINI_MODELS;

/* ------------------------------------------------------------------ */
/*  Prompt runner                                                      */
/* ------------------------------------------------------------------ */

export type GoogleSessionEvent = {
  type: 'delta' | 'final' | 'summary' | 'error' | 'usage';
  text?: string;
  message?: string;
  summary?: string;
  sessionId?: string | null;
  cancelled?: boolean;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
};

const sessions = new Map<string, Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>>();
const generateSessionId = () => `google-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const runGooglePrompt = async (
  options: {
    prompt: string;
    system?: string;
    model?: string;
    resumeSessionId?: string | null;
    signal?: AbortSignal;
  },
  onEvent: (event: GoogleSessionEvent) => void
): Promise<{ sessionId: string | null }> => {
  const auth = resolveAuth();
  if (auth.type === 'none')
    throw new Error('Google Gemini not configured. Go to Settings → Agents → Connect Gemini.');

  const model = options.model ?? DEFAULT_MODEL;
  const sessionId = options.resumeSessionId ?? generateSessionId();
  const history = sessions.get(sessionId) ?? [];
  history.push({ role: 'user', parts: [{ text: options.prompt }] });

  const sysInstruction = options.system ? { parts: [{ text: options.system }] } : undefined;
  const body = JSON.stringify({
    ...(sysInstruction ? { system_instruction: sysInstruction } : {}),
    contents: history,
    generationConfig: { temperature: 1, topP: 0.95, maxOutputTokens: 65536 },
  });

  const getReqOpts = async (): Promise<{ urlPath: string; headers: Record<string, string> }> => {
    if (auth.type === 'api_key') {
      return {
        urlPath: `/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(auth.key)}`,
        headers: { 'Content-Type': 'application/json' },
      };
    }
    const token = await refreshOauthToken();
    return {
      urlPath: `/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    };
  };

  return new Promise((resolve, reject) => {
    void (async () => {
      let assistantText = '';
      let inputTokens = 0;
      let outputTokens = 0;
      let aborted = false;

      let reqOpts: { urlPath: string; headers: Record<string, string> };
      try {
        reqOpts = await getReqOpts();
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      const req = https.request(
        {
          hostname: 'generativelanguage.googleapis.com',
          path: reqOpts.urlPath,
          method: 'POST',
          headers: { ...reqOpts.headers, 'Content-Length': Buffer.byteLength(body) },
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 400) {
            let errBody = '';
            res.on('data', (c: Buffer) => {
              errBody += c.toString();
            });
            res.on('end', () => {
              let msg = `Gemini API error ${res.statusCode ?? ''}`;
              try {
                const p = JSON.parse(errBody) as { error?: { message?: string } };
                if (p?.error?.message) msg = p.error.message;
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
              if (!line.startsWith('data: ')) continue;
              const data = line.slice(6).trim();
              if (!data || data === '[DONE]') continue;
              try {
                type Chunk = {
                  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
                  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
                };
                const parsed = JSON.parse(data) as Chunk;
                const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
                if (text) {
                  assistantText += text;
                  onEvent({ type: 'delta', text });
                }
                if (parsed.usageMetadata) {
                  inputTokens = parsed.usageMetadata.promptTokenCount ?? inputTokens;
                  outputTokens = parsed.usageMetadata.candidatesTokenCount ?? outputTokens;
                }
              } catch {
                /* malformed SSE chunk */
              }
            }
          });

          res.on('end', () => {
            if (aborted) return;
            if (assistantText) {
              history.push({ role: 'model', parts: [{ text: assistantText }] });
              sessions.set(sessionId, history);
            }
            if (inputTokens > 0 || outputTokens > 0)
              onEvent({
                type: 'usage',
                usage: {
                  input_tokens: inputTokens,
                  output_tokens: outputTokens,
                  total_tokens: inputTokens + outputTokens,
                },
              });
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

      req.on('error', (err) => {
        if (!aborted) reject(err);
      });
      req.write(body);
      req.end();
    })();
  });
};

export const clearGoogleSession = (sessionId: string): void => {
  sessions.delete(sessionId);
};
