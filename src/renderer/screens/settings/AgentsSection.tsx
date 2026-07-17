import { useCallback, useEffect, useState } from 'react';
import type { AgentProvider, ProviderRegistrySnapshot, ProviderStatus } from '../../../shared/types';
import { SUPPORTED_AGENT_PROVIDERS } from '../../../shared/providers';
import { workspaceClient } from '../../services/workspaceClient';
import { getProviderIconUrl } from '../../utils/providerIcons';
import '../../styles/components/agents-section.css';

const emptySnapshot: ProviderRegistrySnapshot = {
  providers: [],
  providerStatus: {},
  recentModels: {},
  recentModelInfo: {},
  loading: true,
  updatedAt: null,
};

const PROVIDER_LABELS: Record<string, string> = {
  claude: 'Anthropic Claude',
  codex: 'OpenAI',
  cursor: 'Cursor',
  google: 'Google Gemini',
};

/** Providers that support API key authentication */
const API_KEY_PROVIDERS = new Set<string>(['claude', 'codex', 'google']);

/** Providers that ONLY support API key auth (no console/browser login) */
const API_KEY_ONLY_PROVIDERS = new Set<string>(['google']);

/** Providers that are aggregators (use their own auth over upstream models) */
const AGGREGATOR_PROVIDERS = new Set<string>(['cursor']);

const API_KEY_HELP: Record<string, { url: string; label: string }> = {
  claude: { url: 'https://console.anthropic.com/settings/keys', label: 'Anthropic Console' },
  codex: { url: 'https://platform.openai.com/api-keys', label: 'OpenAI Dashboard' },
  google: { url: 'https://aistudio.google.com/app/apikey', label: 'Google AI Studio' },
};

const API_KEY_PLACEHOLDERS: Record<string, string> = {
  claude: 'sk-ant-api03-...',
  codex: 'sk-...',
  google: 'AIzaSy...',
};

const getStatusTone = (status: ProviderStatus | null | undefined, actionPending: boolean): string => {
  if (actionPending) return 'status-warning';
  if (!status) return 'status-neutral';
  if (status.state === 'ready') return 'status-ready';
  if (status.state === 'error' && status.message?.toLowerCase().includes('login')) return 'status-warning';
  if (status.state === 'error') return 'status-error';
  if (status.state === 'missing') return 'status-warning';
  if (status.state === 'installing') return 'status-warning';
  return 'status-neutral';
};

const getStatusLabel = (status: ProviderStatus | null | undefined, actionPending: boolean): string => {
  if (actionPending) return 'Processing...';
  if (!status) return 'Checking...';
  if (status.state === 'ready') return 'Connected';
  if (status.state === 'error' && status.message?.toLowerCase().includes('login')) return 'Login Required';
  if (status.state === 'installing') return 'Installing...';
  if (status.state === 'missing') return 'Not Installed';
  if (status.state === 'error') return 'Error';
  return 'Unknown';
};

/**
 * Determine the displayed connection method from the provider status.
 * Returns 'api_key' | 'console' | null.
 */
const getConnectionMethod = (status: ProviderStatus | null | undefined): 'api_key' | 'console' | null => {
  if (!status || status.state !== 'ready') return null;
  const src = status.source?.toLowerCase();
  if (src === 'api_key' || src === 'apikey' || src === 'api-key') return 'api_key';
  if (src === 'console' || src === 'oauth' || src === 'login') return 'console';
  // If ready but no explicit source, assume console (the default CLI login flow)
  return 'console';
};

type Toast = {
  message: string;
  tone: 'success' | 'error';
  key: number;
};

export default function AgentsSection() {
  const [snapshot, setSnapshot] = useState<ProviderRegistrySnapshot>(emptySnapshot);
  const [actionPendingProvider, setActionPendingProvider] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  // Per-provider API key input state
  const [apiKeyInputFor, setApiKeyInputFor] = useState<string | null>(null);
  const [apiKeyValue, setApiKeyValue] = useState('');

  const showToast = useCallback((message: string, tone: 'success' | 'error') => {
    setToast({ message, tone, key: Date.now() });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const result = await workspaceClient.agentConnectBootstrap();
      setSnapshot(result);
    } catch (err) {
      console.error('Failed to load agent providers:', err);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    const unsubscribe = window.electronAPI.onAgentConnectProvidersUpdated((newSnapshot) => {
      setSnapshot(newSnapshot);
    });
    return () => { unsubscribe(); };
  }, [loadStatus]);

  const handleLogin = async (provider: AgentProvider, options?: Record<string, unknown>) => {
    if (actionPendingProvider) return;
    setError(null);
    setActionPendingProvider(provider);
    try {
      await workspaceClient.agentConnectProviderLogin(provider, options);
      // Force-refresh all providers so status updates immediately after login
      await workspaceClient.agentConnectProvidersRefresh({ force: true });
      setApiKeyInputFor(null);
      setApiKeyValue('');
      const methodLabel = options?.method === 'api_key' ? 'API key' : 'console login';
      showToast(`${PROVIDER_LABELS[provider] ?? provider} connected via ${methodLabel}`, 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed';
      setError(message);
      showToast(`${PROVIDER_LABELS[provider] ?? provider}: ${message}`, 'error');
    } finally {
      setActionPendingProvider(null);
    }
  };

  const handleInstall = async (provider: AgentProvider) => {
    if (actionPendingProvider) return;
    setError(null);
    setActionPendingProvider(provider);
    try {
      await workspaceClient.agentConnectProviderInstall(provider);
      showToast(`${PROVIDER_LABELS[provider] ?? provider} installed`, 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Install failed';
      setError(message);
      showToast(`Install failed: ${message}`, 'error');
    } finally {
      setActionPendingProvider(null);
    }
  };

  const handleLogout = async (provider: AgentProvider) => {
    if (actionPendingProvider) return;
    setError(null);
    setActionPendingProvider(provider);
    try {
      await workspaceClient.agentConnectProviderLogout(provider);
      await workspaceClient.agentConnectProvidersRefresh({ force: true });
      showToast(`${PROVIDER_LABELS[provider] ?? provider} disconnected`, 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Disconnect failed';
      setError(message);
      showToast(`${PROVIDER_LABELS[provider] ?? provider}: ${message}`, 'error');
    } finally {
      setActionPendingProvider(null);
    }
  };

  const toggleApiKeyInput = (providerId: string) => {
    if (apiKeyInputFor === providerId) {
      setApiKeyInputFor(null);
      setApiKeyValue('');
    } else {
      setApiKeyInputFor(providerId);
      setApiKeyValue('');
    }
  };

  return (
    <div className="agents-section">
      <header className="settings-section-header">
        <h2>AI Agents &amp; Suppliers</h2>
        <p>Configure your AI providers and authentication methods.</p>
      </header>

      {error && <div className="agents-section-error">{error}</div>}

      {toast && (
        <div className={`agents-toast agents-toast--${toast.tone}`} key={toast.key}>
          <span className="agents-toast-icon">{toast.tone === 'success' ? '✓' : '✗'}</span>
          {toast.message}
        </div>
      )}

      <div className="agents-provider-list">
        {SUPPORTED_AGENT_PROVIDERS.map((providerId) => {
          const status = snapshot.providerStatus[providerId];
          const label = PROVIDER_LABELS[providerId] || providerId;
          const isPending = actionPendingProvider === providerId;
          const installed = status?.installed ?? false;
          const loginRequired = status?.state === 'error' && status.message?.toLowerCase().includes('login');
          const isAggregator = AGGREGATOR_PROVIDERS.has(providerId);
          const supportsApiKey = API_KEY_PROVIDERS.has(providerId);
          const apiKeyOnly = API_KEY_ONLY_PROVIDERS.has(providerId);
          const showApiKeyInput = apiKeyInputFor === providerId;
          const connMethod = getConnectionMethod(status);
          const isReady = status?.state === 'ready';
          // Auto-expand the API key input for API-key-only providers that aren't yet connected
          const autoExpandApiKey = apiKeyOnly && !isReady && installed && status?.state !== 'missing';

          return (
            <div key={providerId} className="agent-provider-item">
              {/* ── Provider header row ──────────────────────────── */}
              <div className="agent-provider-container">
                <div className="agent-provider-main">
                  <img
                    src={getProviderIconUrl(providerId as AgentProvider)}
                    alt=""
                    className="agent-provider-icon"
                  />
                  <div className="agent-provider-details">
                    <div className="agent-provider-name">
                      {label}
                      {isAggregator && (
                        <span className="agent-provider-type-badge" title="Connects to multiple model providers">
                          Aggregator
                        </span>
                      )}
                    </div>
                    <div className="agent-provider-status">
                      <span className={`status-pill ${getStatusTone(status, isPending)}`}>
                        {getStatusLabel(status, isPending)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Install button for missing providers */}
                {(!installed || status?.state === 'missing') && (
                  <div className="agent-provider-actions">
                    <button
                      className="agent-action-button install"
                      onClick={() => void handleInstall(providerId as AgentProvider)}
                      disabled={!!actionPendingProvider}
                    >
                      Install
                    </button>
                  </div>
                )}
              </div>


              {/* ── Connection method display (when connected) ───── */}
              {isReady && connMethod && (
                <div className="agent-connection-method">
                  <div className={`connection-method-indicator connection-method--${connMethod}`}>
                    <span className="connection-method-icon">
                      {connMethod === 'api_key' ? '🔑' : '🌐'}
                    </span>
                    <div className="connection-method-info">
                      <span className="connection-method-label">
                        {connMethod === 'api_key' ? 'API Key' : 'Console Subscription'}
                      </span>
                      {status?.loggedInAs && (
                        <span className="connection-method-account">{status.loggedInAs}</span>
                      )}
                    </div>
                    <button
                      className="agent-action-button disconnect"
                      onClick={() => void handleLogout(providerId as AgentProvider)}
                      disabled={!!actionPendingProvider}
                      title={`Disconnect ${label}`}
                    >
                      Disconnect
                    </button>
                  </div>
                </div>
              )}

              {/* ── Auth method chooser (when installed but needs config) ── */}
              {installed && status?.state !== 'missing' && (
                <div className="agent-auth-methods">
                  {!isAggregator && (
                    <div className="auth-method-header">
                      {isReady ? 'Switch connection method' : 'Choose connection method'}
                    </div>
                  )}

                  <div className="auth-method-options">
                    {/* Console / OAuth login option */}
                    {!apiKeyOnly && (
                      <button
                        className={`auth-method-card ${connMethod === 'console' ? 'active' : ''} ${loginRequired ? 'highlight' : ''}`}
                        onClick={() => void handleLogin(providerId as AgentProvider, { method: 'console' })}
                        disabled={!!actionPendingProvider}
                      >
                        <span className="auth-method-card-icon">
                          {providerId === 'google' ? '🔵' : '🌐'}
                        </span>
                        <div className="auth-method-card-body">
                          <span className="auth-method-card-title">
                            {isAggregator
                              ? `Login to ${label}`
                              : providerId === 'google'
                              ? 'Sign in with Google'
                              : 'Console Login'}
                          </span>
                          <span className="auth-method-card-desc">
                            {isAggregator
                              ? `Use your ${label} subscription`
                              : providerId === 'google'
                              ? 'OAuth via your Google account — opens browser'
                              : 'Sign in via browser — uses your subscription plan'}
                          </span>
                        </div>
                        {connMethod === 'console' && <span className="auth-method-active-mark">●</span>}
                      </button>
                    )}

                    {/* API Key option (only for direct providers) */}
                    {supportsApiKey && (
                      <button
                        className={`auth-method-card ${connMethod === 'api_key' ? 'active' : ''} ${showApiKeyInput || autoExpandApiKey ? 'expanded' : ''}`}
                        onClick={() => toggleApiKeyInput(providerId)}
                        disabled={!!actionPendingProvider}
                      >
                        <span className="auth-method-card-icon">🔑</span>
                        <div className="auth-method-card-body">
                          <span className="auth-method-card-title">API Key</span>
                          <span className="auth-method-card-desc">
                            Enter a key directly — pay-per-use billing
                          </span>
                        </div>
                        {connMethod === 'api_key' && <span className="auth-method-active-mark">●</span>}
                      </button>
                    )}
                  </div>

                  {/* API Key input (expanded inline) */}
                  {(showApiKeyInput || autoExpandApiKey) && (
                    <div className="provider-extra-config api-key-config">
                      <div className="config-field">
                        <label htmlFor={`${providerId}-api-key`}>
                          {PROVIDER_LABELS[providerId]} API Key
                        </label>
                        <div className="config-input-group">
                          <input
                            id={`${providerId}-api-key`}
                            type="password"
                            placeholder={API_KEY_PLACEHOLDERS[providerId] ?? 'Enter API Key'}
                            value={apiKeyValue}
                            onChange={(e) => setApiKeyValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && apiKeyValue.trim()) {
                                void handleLogin(providerId as AgentProvider, {
                                  method: 'api_key',
                                  apiKey: apiKeyValue.trim(),
                                });
                              }
                            }}
                            autoFocus
                          />
                          <button
                            className="agent-action-button primary"
                            disabled={!apiKeyValue.trim() || !!actionPendingProvider}
                            onClick={() =>
                              void handleLogin(providerId as AgentProvider, {
                                method: 'api_key',
                                apiKey: apiKeyValue.trim(),
                              })
                            }
                          >
                            Connect
                          </button>
                        </div>
                        {API_KEY_HELP[providerId] && (
                          <p className="config-help-text">
                            Get a key from{' '}
                            <a href={API_KEY_HELP[providerId].url} target="_blank" rel="noreferrer">
                              {API_KEY_HELP[providerId].label}
                            </a>
                            .
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
