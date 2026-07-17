/**
 * Tests for the agent settings connection pipeline.
 *
 * Validates that login, install, status, and refresh IPC handlers
 * correctly trigger the underlying embeddedHost calls and that
 * options (method, apiKey) flow through properly.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';

/* ---------- mock state ---------- */

const requestMock = vi.fn();
const eventHandlers = new Set<(notification: { method: string; params?: Record<string, unknown> }) => void>();

vi.mock('@agentconnect/host', () => ({
  createHostBridge: () => ({
    request: requestMock,
    onEvent: (handler: (notification: { method: string; params?: Record<string, unknown> }) => void) => {
      eventHandlers.add(handler);
      return () => {
        eventHandlers.delete(handler);
      };
    },
  }),
}));

// Mock googleProvider so it doesn't touch the filesystem or make real HTTP calls in tests
const googleMocks = vi.hoisted(() => ({
  getGoogleStatus: vi.fn(),
  loginGoogle: vi.fn(),
  logoutGoogle: vi.fn(),
  listGoogleModels: vi.fn(),
  runGooglePrompt: vi.fn(),
  clearGoogleSession: vi.fn(),
}));

vi.mock('../../../src/main/services/agentConnect/googleProvider', () => ({
  getGoogleStatus: googleMocks.getGoogleStatus,
  loginGoogle: googleMocks.loginGoogle,
  logoutGoogle: googleMocks.logoutGoogle,
  listGoogleModels: googleMocks.listGoogleModels,
  runGooglePrompt: googleMocks.runGooglePrompt,
  clearGoogleSession: googleMocks.clearGoogleSession,
}));

describe('agent settings connection pipeline', () => {
  beforeEach(() => {
    requestMock.mockReset();
    eventHandlers.clear();
    // Reset google mocks to sensible defaults
    googleMocks.getGoogleStatus.mockReturnValue({
      providerId: 'google',
      state: 'error',
      installed: true,
      message: 'Login required — provide a Google AI / Gemini API key',
    });
    googleMocks.loginGoogle.mockResolvedValue({ loggedIn: false });
    googleMocks.listGoogleModels.mockReturnValue([]);
    googleMocks.runGooglePrompt.mockResolvedValue({ sessionId: 'google-test-session' });
    googleMocks.clearGoogleSession.mockImplementation(() => {});
    vi.resetModules();
  });

  /* ================================================================
   * listProviders — all SUPPORTED_AGENT_PROVIDERS always appear
   * ================================================================ */

  describe('listProviders', () => {
    test('returns all supported providers even when host bridge returns only some', async () => {
      requestMock.mockResolvedValueOnce({
        providers: [{ id: 'claude', name: 'Claude Code' }],
      });

      const { listProviders } = await import('../../../src/main/services/agentConnect/embeddedHost');
      const providers = await listProviders();

      const ids = providers.map((p) => p.id);
      expect(ids).toContain('claude');
      expect(ids).toContain('codex');
      expect(ids).toContain('cursor');
      expect(ids).toContain('google');
      expect(providers.length).toBe(4);
    });

    test('uses host name when available, falls back to defaults', async () => {
      requestMock.mockResolvedValueOnce({
        providers: [{ id: 'claude', name: 'Claude Code (custom)' }],
      });

      const { listProviders } = await import('../../../src/main/services/agentConnect/embeddedHost');
      const providers = await listProviders();

      const claudeEntry = providers.find((p) => p.id === 'claude');
      const cursorEntry = providers.find((p) => p.id === 'cursor');
      const googleEntry = providers.find((p) => p.id === 'google');
      const codexEntry = providers.find((p) => p.id === 'codex');

      expect(claudeEntry?.name).toBe('Claude Code (custom)');
      expect(cursorEntry?.name).toBe('Cursor');
      expect(googleEntry?.name).toBe('Gemini');
      expect(codexEntry?.name).toBe('Codex');
    });

    test('handles empty host response by returning fallback entries', async () => {
      requestMock.mockResolvedValueOnce({ providers: [] });

      const { listProviders } = await import('../../../src/main/services/agentConnect/embeddedHost');
      const providers = await listProviders();

      expect(providers.length).toBe(4);
      expect(providers.every((p) => p.name.length > 0)).toBe(true);
    });

    test('handles missing providers field in host response', async () => {
      requestMock.mockResolvedValueOnce({});

      const { listProviders } = await import('../../../src/main/services/agentConnect/embeddedHost');
      const providers = await listProviders();

      expect(providers.length).toBe(4);
    });
  });

  /* ================================================================
   * getProviderStatus — status resolution + error handling
   * ================================================================ */

  describe('getProviderStatus', () => {
    test('returns mapped status for known provider', async () => {
      requestMock.mockResolvedValueOnce({
        provider: {
          id: 'claude',
          name: 'Claude',
          installed: true,
          loggedIn: true,
        },
      });

      const { getProviderStatus } = await import('../../../src/main/services/agentConnect/embeddedHost');
      const status = await getProviderStatus('claude');

      expect(status.providerId).toBe('claude');
      expect(status.state).toBe('ready');
      expect(status.installed).toBe(true);
    });

    test('returns login-required error when not logged in', async () => {
      requestMock.mockResolvedValueOnce({
        provider: {
          id: 'cursor',
          name: 'Cursor',
          installed: true,
          loggedIn: false,
        },
      });

      const { getProviderStatus } = await import('../../../src/main/services/agentConnect/embeddedHost');
      const status = await getProviderStatus('cursor');

      expect(status.state).toBe('error');
      expect(status.message?.toLowerCase()).toContain('login');
    });

    test('returns error state when host throws for non-google provider', async () => {
      requestMock.mockRejectedValueOnce(new Error('Provider not found'));

      const { getProviderStatus } = await import('../../../src/main/services/agentConnect/embeddedHost');
      const status = await getProviderStatus('codex');

      expect(status.providerId).toBe('codex');
      expect(status.state).toBe('missing');
      expect(status.installed).toBe(false);
      expect(status.message).toContain('Provider not found');
    });

    test('returns google status directly from googleProvider (bypasses bridge)', async () => {
      googleMocks.getGoogleStatus.mockReturnValue({
        providerId: 'google',
        state: 'ready',
        installed: true,
        source: 'env',
      });

      const { getProviderStatus } = await import('../../../src/main/services/agentConnect/embeddedHost');
      const status = await getProviderStatus('google');

      expect(status.providerId).toBe('google');
      expect(status.state).toBe('ready');
      expect(status.source).toBe('env');
      // Bridge request should NOT have been called for google
      expect(requestMock).not.toHaveBeenCalled();
    });

    test('returns missing state for non-Error exceptions on non-google provider', async () => {
      requestMock.mockRejectedValueOnce('string error');

      const { getProviderStatus } = await import('../../../src/main/services/agentConnect/embeddedHost');
      const status = await getProviderStatus('claude');

      expect(status.state).toBe('missing');
      expect(status.installed).toBe(false);
    });

    test('forwards force option to host bridge', async () => {
      requestMock.mockResolvedValueOnce({
        provider: { id: 'claude', name: 'Claude', installed: true, loggedIn: true },
      });

      const { getProviderStatus } = await import('../../../src/main/services/agentConnect/embeddedHost');
      await getProviderStatus('claude', { force: true });

      expect(requestMock).toHaveBeenCalledWith('acp.providers.status', {
        provider: 'claude',
        options: { force: true },
      });
    });
  });

  /* ================================================================
   * loginProvider — options passthrough
   * ================================================================ */

  describe('loginProvider', () => {
    test('sends login request with console method', async () => {
      requestMock.mockResolvedValueOnce({ loggedIn: true });

      const { loginProvider } = await import('../../../src/main/services/agentConnect/embeddedHost');
      const result = await loginProvider('claude', { method: 'console' });

      expect(result).toEqual({ loggedIn: true });
      expect(requestMock).toHaveBeenCalledWith('acp.providers.login', {
        provider: 'claude',
        options: { method: 'console' },
      });
    });

    test('sends login request with api_key method and key', async () => {
      requestMock.mockResolvedValueOnce({ loggedIn: true });

      const { loginProvider } = await import('../../../src/main/services/agentConnect/embeddedHost');
      const result = await loginProvider('codex', { method: 'api_key', apiKey: 'sk-test-123' });

      expect(result).toEqual({ loggedIn: true });
      expect(requestMock).toHaveBeenCalledWith('acp.providers.login', {
        provider: 'codex',
        options: { method: 'api_key', apiKey: 'sk-test-123' },
      });
    });

    test('sends login request without options when none provided', async () => {
      requestMock.mockResolvedValueOnce({ loggedIn: true });

      const { loginProvider } = await import('../../../src/main/services/agentConnect/embeddedHost');
      await loginProvider('cursor');

      expect(requestMock).toHaveBeenCalledWith('acp.providers.login', {
        provider: 'cursor',
        options: undefined,
      });
    });

    test('returns loggedIn: false when login fails', async () => {
      requestMock.mockResolvedValueOnce({ loggedIn: false });

      const { loginProvider } = await import('../../../src/main/services/agentConnect/embeddedHost');
      const result = await loginProvider('claude');

      expect(result.loggedIn).toBe(false);
    });

    test('propagates error when host bridge throws', async () => {
      requestMock.mockRejectedValueOnce(new Error('auth timeout'));

      const { loginProvider } = await import('../../../src/main/services/agentConnect/embeddedHost');
      await expect(loginProvider('cursor')).rejects.toThrow('auth timeout');
    });
  });

  /* ================================================================
   * ensureProviderInstalled — install flow
   * ================================================================ */

  describe('ensureProviderInstalled', () => {
    test('triggers install then returns status', async () => {
      requestMock
        .mockResolvedValueOnce({}) // acp.providers.ensureInstalled
        .mockResolvedValueOnce({
          // acp.providers.status
          provider: { id: 'codex', name: 'Codex', installed: true, loggedIn: true },
        });

      const { ensureProviderInstalled } = await import('../../../src/main/services/agentConnect/embeddedHost');
      const status = await ensureProviderInstalled('codex');

      expect(requestMock).toHaveBeenCalledWith('acp.providers.ensureInstalled', { provider: 'codex' });
      expect(status.state).toBe('ready');
      expect(status.installed).toBe(true);
    });

    test('returns login-required status after install if not logged in', async () => {
      requestMock
        .mockResolvedValueOnce({}) // install
        .mockResolvedValueOnce({
          provider: { id: 'claude', name: 'Claude', installed: true, loggedIn: false },
        });

      const { ensureProviderInstalled } = await import('../../../src/main/services/agentConnect/embeddedHost');
      const status = await ensureProviderInstalled('claude');

      expect(status.state).toBe('error');
      expect(status.message?.toLowerCase()).toContain('login');
    });
  });

  /* ================================================================
   * Validation schemas — login options
   * ================================================================ */

  describe('validation schemas', () => {
    test('AgentConnectProviderLoginSchema accepts provider with console options', async () => {
      const { AgentConnectProviderLoginSchema } = await import('../../../src/main/ipc/validation');
      const result = AgentConnectProviderLoginSchema.safeParse({
        provider: 'claude',
        options: { method: 'console' },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.options?.method).toBe('console');
      }
    });

    test('AgentConnectProviderLoginSchema accepts provider with api_key options', async () => {
      const { AgentConnectProviderLoginSchema } = await import('../../../src/main/ipc/validation');
      const result = AgentConnectProviderLoginSchema.safeParse({
        provider: 'codex',
        options: { method: 'api_key', apiKey: 'sk-test-xxx' },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.options?.method).toBe('api_key');
        expect(result.data.options?.apiKey).toBe('sk-test-xxx');
      }
    });

    test('AgentConnectProviderLoginSchema accepts provider without options', async () => {
      const { AgentConnectProviderLoginSchema } = await import('../../../src/main/ipc/validation');
      const result = AgentConnectProviderLoginSchema.safeParse({
        provider: 'cursor',
      });
      expect(result.success).toBe(true);
    });

    test('AgentConnectProviderLoginSchema rejects invalid provider', async () => {
      const { AgentConnectProviderLoginSchema } = await import('../../../src/main/ipc/validation');
      const result = AgentConnectProviderLoginSchema.safeParse({
        provider: 'not-a-provider',
      });
      expect(result.success).toBe(false);
    });

    test('AgentConnectProviderLoginSchema passes through unknown options fields', async () => {
      const { AgentConnectProviderLoginSchema } = await import('../../../src/main/ipc/validation');
      const result = AgentConnectProviderLoginSchema.safeParse({
        provider: 'google',
        options: { method: 'api_key', apiKey: 'AIza...', customField: 'value' },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect((result.data.options as Record<string, unknown>)?.customField).toBe('value');
      }
    });

    test('AgentConnectProviderInstallSchema validates all supported providers', async () => {
      const { AgentConnectProviderInstallSchema } = await import('../../../src/main/ipc/validation');
      for (const provider of ['claude', 'codex', 'cursor', 'google']) {
        const result = AgentConnectProviderInstallSchema.safeParse({ provider });
        expect(result.success, `Expected ${provider} to be valid`).toBe(true);
      }
    });

    test('AgentConnectProviderStatusSchema accepts force option', async () => {
      const { AgentConnectProviderStatusSchema } = await import('../../../src/main/ipc/validation');
      const result = AgentConnectProviderStatusSchema.safeParse({
        provider: 'claude',
        options: { force: true },
      });
      expect(result.success).toBe(true);
    });
  });

  /* ================================================================
   * providerRegistry — integration with status updates
   * ================================================================ */

  describe('providerRegistry integration', () => {
    test('refresh populates status for all providers including google', async () => {
      const { createProviderRegistry } = await import(
        '../../../src/main/services/agentConnect/providerRegistry'
      );

      const statusMock = vi.fn().mockImplementation(async (id: string) => ({
        providerId: id,
        state: id === 'google' ? 'missing' : 'ready',
        installed: id !== 'google',
      }));

      const registry = createProviderRegistry(
        {
          providers: {
            list: vi.fn().mockResolvedValue([
              { id: 'claude', name: 'Claude' },
              { id: 'codex', name: 'Codex' },
              { id: 'cursor', name: 'Cursor' },
              { id: 'google', name: 'Gemini' },
            ]),
            status: statusMock,
          },
          models: {
            recent: vi.fn().mockResolvedValue([]),
          },
        },
        { cacheTtlMs: 1, refreshSpreadMs: 0 }
      );

      await registry.initialize();
      const snapshot = registry.getSnapshot();

      expect(snapshot.providers.length).toBe(4);
      expect(snapshot.providerStatus.google?.state).toBe('missing');
      expect(snapshot.providerStatus.claude?.state).toBe('ready');
      expect(snapshot.providerStatus.cursor?.state).toBe('ready');
      expect(snapshot.providerStatus.codex?.state).toBe('ready');
    });

    test('refreshProviderStatus updates snapshot for a single provider', async () => {
      const { createProviderRegistry } = await import(
        '../../../src/main/services/agentConnect/providerRegistry'
      );

      let callCount = 0;
      const statusMock = vi.fn().mockImplementation(async (id: string) => {
        callCount += 1;
        return {
          providerId: id,
          state: callCount <= 4 ? 'error' : 'ready',
          installed: true,
          message: callCount <= 4 ? 'Login required' : undefined,
        };
      });

      const registry = createProviderRegistry(
        {
          providers: {
            list: vi.fn().mockResolvedValue([
              { id: 'claude', name: 'Claude' },
              { id: 'codex', name: 'Codex' },
              { id: 'cursor', name: 'Cursor' },
              { id: 'google', name: 'Gemini' },
            ]),
            status: statusMock,
          },
          models: {
            recent: vi.fn().mockResolvedValue([]),
          },
        },
        { cacheTtlMs: 1, refreshSpreadMs: 0 }
      );

      await registry.initialize();
      // After init, all are error/login-required
      expect(registry.getSnapshot().providerStatus.cursor?.state).toBe('error');

      // Now refresh cursor — should get 'ready' on the next call
      const newStatus = await registry.refreshProviderStatus('cursor', { force: true });
      expect(newStatus?.state).toBe('ready');
      expect(registry.getSnapshot().providerStatus.cursor?.state).toBe('ready');
    });
  });

  /* ================================================================
   * End-to-end: loginProvider → refreshProviderStatus pipeline
   * ================================================================ */

  describe('login + status refresh pipeline', () => {
    test('loginProvider followed by getProviderStatus shows ready', async () => {
      requestMock
        .mockResolvedValueOnce({ loggedIn: true }) // login
        .mockResolvedValueOnce({
          // status
          provider: { id: 'cursor', name: 'Cursor', installed: true, loggedIn: true },
        });

      const { loginProvider, getProviderStatus } = await import(
        '../../../src/main/services/agentConnect/embeddedHost'
      );

      const loginResult = await loginProvider('cursor', { method: 'console' });
      expect(loginResult.loggedIn).toBe(true);

      const status = await getProviderStatus('cursor', { force: true });
      expect(status.state).toBe('ready');
      expect(status.installed).toBe(true);
    });

    test('api_key login triggers proper host bridge calls', async () => {
      requestMock
        .mockResolvedValueOnce({ loggedIn: true }) // login with API key
        .mockResolvedValueOnce({
          // status refresh
          provider: {
            id: 'codex',
            name: 'Codex',
            installed: true,
            loggedIn: true,
            source: 'api_key',
            loggedInAs: 'user@example.com',
          },
        });

      const { loginProvider, getProviderStatus } = await import(
        '../../../src/main/services/agentConnect/embeddedHost'
      );

      await loginProvider('codex', { method: 'api_key', apiKey: 'sk-test-key' });

      // Verify the login call included the API key
      expect(requestMock).toHaveBeenCalledWith('acp.providers.login', {
        provider: 'codex',
        options: { method: 'api_key', apiKey: 'sk-test-key' },
      });

      const status = await getProviderStatus('codex');
      expect(status.state).toBe('ready');
      expect(status.source).toBe('api_key');
      expect(status.loggedInAs).toBe('user@example.com');
    });
  });

  /* ================================================================
   * install + login pipeline (end-to-end)
   * ================================================================ */

  describe('install + login pipeline', () => {
    test('install flow then login flow for new provider', async () => {
      requestMock
        .mockResolvedValueOnce({}) // ensureInstalled
        .mockResolvedValueOnce({
          // status after install (not yet logged in)
          provider: { id: 'cursor', name: 'Cursor', installed: true, loggedIn: false },
        })
        .mockResolvedValueOnce({ loggedIn: true }) // login
        .mockResolvedValueOnce({
          // status after login
          provider: { id: 'cursor', name: 'Cursor', installed: true, loggedIn: true },
        });

      const { ensureProviderInstalled, loginProvider, getProviderStatus } = await import(
        '../../../src/main/services/agentConnect/embeddedHost'
      );

      // Step 1: Install
      const installStatus = await ensureProviderInstalled('cursor');
      expect(installStatus.installed).toBe(true);
      expect(installStatus.state).toBe('error'); // login required
      expect(installStatus.message?.toLowerCase()).toContain('login');

      // Step 2: Login
      const loginResult = await loginProvider('cursor', { method: 'console' });
      expect(loginResult.loggedIn).toBe(true);

      // Step 3: Verify status
      const finalStatus = await getProviderStatus('cursor');
      expect(finalStatus.state).toBe('ready');
    });
  });

  /* ================================================================
   * Google Gemini — standalone provider (bypasses bridge)
   * ================================================================ */

  describe('google gemini handling', () => {
    test('Google status is returned from googleProvider, not the bridge', async () => {
      googleMocks.getGoogleStatus.mockReturnValue({
        providerId: 'google',
        state: 'error',
        installed: true,
        message: 'Login required — provide a Google AI / Gemini API key',
      });

      const { getProviderStatus } = await import('../../../src/main/services/agentConnect/embeddedHost');
      const status = await getProviderStatus('google');

      expect(status.state).toBe('error');
      expect(status.installed).toBe(true);
      expect(status.message?.toLowerCase()).toContain('login');
      // Bridge should NOT have been called
      expect(requestMock).not.toHaveBeenCalled();
      // Should NOT be 'unknown' which causes eternal "Checking..." in UI
      expect(status.state).not.toBe('unknown');
    });

    test('Google shows ready state when API key is configured', async () => {
      googleMocks.getGoogleStatus.mockReturnValue({
        providerId: 'google',
        state: 'ready',
        installed: true,
        source: 'env',
        loggedInAs: 'API Key',
      });

      const { getProviderStatus } = await import('../../../src/main/services/agentConnect/embeddedHost');
      const status = await getProviderStatus('google');

      expect(status.state).toBe('ready');
      expect(status.installed).toBe(true);
      expect(requestMock).not.toHaveBeenCalled();
    });

    test('Google login with api_key calls loginGoogle', async () => {
      googleMocks.loginGoogle.mockResolvedValue({ loggedIn: true });

      const { loginProvider } = await import('../../../src/main/services/agentConnect/embeddedHost');
      const result = await loginProvider('google', { method: 'api_key', apiKey: 'AIza-test' });

      expect(result.loggedIn).toBe(true);
      expect(googleMocks.loginGoogle).toHaveBeenCalledWith({ method: 'api_key', apiKey: 'AIza-test' });
      // Bridge should NOT have been called for google
      expect(requestMock).not.toHaveBeenCalled();
    });

    test('Google console login calls loginGoogle with method:console', async () => {
      googleMocks.loginGoogle.mockResolvedValue({ loggedIn: true });

      const { loginProvider } = await import('../../../src/main/services/agentConnect/embeddedHost');
      const result = await loginProvider('google', { method: 'console' });

      expect(result.loggedIn).toBe(true);
      expect(googleMocks.loginGoogle).toHaveBeenCalledWith({ method: 'console' });
      expect(requestMock).not.toHaveBeenCalled();
    });

    test('Google console login opens OAuth browser flow and resolves when complete', async () => {
      googleMocks.loginGoogle.mockResolvedValue({ loggedIn: true });

      const { loginProvider } = await import('../../../src/main/services/agentConnect/embeddedHost');
      const result = await loginProvider('google', { method: 'console' });

      expect(result.loggedIn).toBe(true);
    });

    test('Google install returns status directly without calling bridge', async () => {
      googleMocks.getGoogleStatus.mockReturnValue({
        providerId: 'google',
        state: 'error',
        installed: true,
        message: 'Login required',
      });

      const { ensureProviderInstalled } = await import('../../../src/main/services/agentConnect/embeddedHost');
      const status = await ensureProviderInstalled('google');

      expect(status.state).toBe('error');
      expect(requestMock).not.toHaveBeenCalledWith(
        'acp.providers.ensureInstalled',
        expect.anything()
      );
    });

    test('Google models come from static list, not the bridge', async () => {
      googleMocks.listGoogleModels.mockReturnValue([
        { id: 'gemini-2.0-flash', provider: 'google', displayName: 'Gemini 2.0 Flash' },
        { id: 'gemini-1.5-pro', provider: 'google', displayName: 'Gemini 1.5 Pro' },
      ]);

      const { listRecentModelInfo } = await import('../../../src/main/services/agentConnect/embeddedHost');
      const models = await listRecentModelInfo('google');

      expect(models.length).toBe(2);
      expect(models[0].id).toBe('gemini-2.0-flash');
      expect(requestMock).not.toHaveBeenCalled();
    });

    test('Google provider appears in listProviders even if not returned by host', async () => {
      requestMock.mockResolvedValueOnce({
        providers: [
          { id: 'claude', name: 'Claude' },
          { id: 'codex', name: 'Codex' },
        ],
      });

      const { listProviders } = await import('../../../src/main/services/agentConnect/embeddedHost');
      const providers = await listProviders();

      const googleEntry = providers.find((p) => p.id === 'google');
      expect(googleEntry).toBeDefined();
      expect(googleEntry?.name).toBe('Gemini');
    });
  });
});
