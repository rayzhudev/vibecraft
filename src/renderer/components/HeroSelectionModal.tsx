import { useEffect, useMemo, useState } from 'react';
import type {
  AgentProvider,
  ProviderDescriptor,
  ProviderRegistrySnapshot,
  ProviderStatus,
} from '../../shared/types';
import { getProviderIconUrl } from '../utils/providerIcons';
import { isSupportedAgentProvider, TUTORIAL_HERO_PROVIDERS } from '../../shared/providers';

interface HeroSelectionModalProps {
  open: boolean;
  providerSnapshot: ProviderRegistrySnapshot;
  onConfirmProvider: (provider: AgentProvider) => Promise<{ ok: boolean; error?: string }>;
  onInstallProvider: (
    provider: AgentProvider
  ) => Promise<{ ok: boolean; status?: ProviderStatus | null; error?: string }>;
  onLoginProvider: (
    provider: AgentProvider
  ) => Promise<{ ok: boolean; status?: ProviderStatus | null; error?: string }>;
  onRefreshProviderStatus: (
    provider: AgentProvider,
    options?: { force?: boolean }
  ) => Promise<{ ok: boolean; status?: ProviderStatus | null; error?: string }>;
}

const ALLOWED_PROVIDERS: AgentProvider[] = [...TUTORIAL_HERO_PROVIDERS, 'cursor', 'google'];
const PROVIDER_LABELS: Partial<Record<AgentProvider, string>> = {
  claude: 'Claude',
  codex: 'Codex',
  cursor: 'Cursor',
  google: 'Google',
};

const isAgentProvider = (value: string): value is AgentProvider =>
  isSupportedAgentProvider(value) && ALLOWED_PROVIDERS.includes(value as AgentProvider);

const normalizeProviders = (providers: ProviderDescriptor[]): ProviderDescriptor[] => {
  const filtered = providers.filter((provider) => isAgentProvider(provider.id));
  if (filtered.length === 0) {
    return ALLOWED_PROVIDERS.map((id) => ({ id, name: PROVIDER_LABELS[id] ?? id }));
  }
  const ordered = ALLOWED_PROVIDERS.map((id) => filtered.find((provider) => provider.id === id)).filter(
    (provider): provider is ProviderDescriptor => Boolean(provider)
  );
  return ordered;
};

const getStatusLabel = (status: ProviderStatus | null | undefined, installing: boolean): string => {
  if (installing) return 'Installing';
  if (!status) return 'Checking';
  if (status.state === 'ready') return 'Ready';
  if (status.state === 'error' && status.message?.toLowerCase().includes('login')) return 'Login required';
  if (status.state === 'installing') return 'Installing';
  if (status.state === 'missing') return 'Not installed';
  if (status.state === 'error') return 'Needs attention';
  return 'Unknown';
};

const getStatusTone = (status: ProviderStatus | null | undefined, installing: boolean): string => {
  if (installing) return 'status-warning';
  if (!status) return 'status-neutral';
  if (status.state === 'ready') return 'status-ready';
  if (status.state === 'error' && status.message?.toLowerCase().includes('login')) return 'status-warning';
  if (status.state === 'error') return 'status-error';
  if (status.state === 'missing') return 'status-warning';
  if (status.state === 'installing') return 'status-warning';
  return 'status-neutral';
};

const isInstalled = (status: ProviderStatus | null | undefined): boolean => {
  if (!status) return false;
  if (typeof status.installed === 'boolean') return status.installed;
  return status.state === 'ready';
};

const isLoginRequired = (status: ProviderStatus | null | undefined): boolean => {
  if (!status || status.state !== 'error') return false;
  if (!status.message) return false;
  return status.message.toLowerCase().includes('login');
};

const isReadyStatus = (status: ProviderStatus | null | undefined): boolean =>
  Boolean(status && status.state === 'ready' && isInstalled(status));

type RefreshProviderStatusFn = (
  provider: AgentProvider,
  options?: { force?: boolean }
) => Promise<{ ok: boolean; status?: ProviderStatus | null; error?: string }>;

const pollProviderStatus = async (
  provider: AgentProvider,
  onRefreshProviderStatus: RefreshProviderStatusFn,
  options: { timeoutMs: number; intervalMs: number; stopOnLoginRequired?: boolean }
): Promise<ProviderStatus | null> => {
  const startedAt = Date.now();
  let lastStatus: ProviderStatus | null = null;
  while (Date.now() - startedAt < options.timeoutMs) {
    const result = await onRefreshProviderStatus(provider, { force: true });
    if (!result.ok) {
      break;
    }
    lastStatus = result.status ?? null;
    if (isReadyStatus(lastStatus)) return lastStatus;
    if (options.stopOnLoginRequired && isLoginRequired(lastStatus)) return lastStatus;
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }
  return lastStatus;
};

const shouldShowStatusMessage = (message?: string | null): boolean => {
  if (!message) return false;
  const lowered = message.toLowerCase();
  if (lowered.includes('up to date') || lowered.includes('up-to-date')) return false;
  return true;
};

const getManualInstallCommand = (provider: AgentProvider | null): string | null => {
  if (!provider) return null;
  if (provider === 'claude') {
    return 'curl -fsSL https://claude.ai/install.sh | bash';
  }
  if (provider === 'codex') {
    return 'npm i -g @openai/codex';
  }
  return null;
};

export default function HeroSelectionModal({
  open,
  providerSnapshot,
  onConfirmProvider,
  onInstallProvider,
  onLoginProvider,
  onRefreshProviderStatus,
}: HeroSelectionModalProps) {
  const providers = useMemo(
    () => normalizeProviders(providerSnapshot.providers),
    [providerSnapshot.providers]
  );
  const [selectedProvider, setSelectedProvider] = useState<AgentProvider | null>(null);
  const [installingProvider, setInstallingProvider] = useState<AgentProvider | null>(null);
  const [loginPendingProvider, setLoginPendingProvider] = useState<AgentProvider | null>(null);
  const [installFailedProviders, setInstallFailedProviders] = useState<Set<AgentProvider>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [reportCopied, setReportCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (selectedProvider) return;
    const first = providers[0];
    if (first && isAgentProvider(first.id)) {
      setSelectedProvider(first.id);
    }
  }, [open, providers, selectedProvider]);

  if (!open) return null;

  const selectedStatus = selectedProvider
    ? (providerSnapshot.providerStatus[selectedProvider] ?? null)
    : null;
  const statusLabel = getStatusLabel(selectedStatus, installingProvider === selectedProvider);
  const statusTone = getStatusTone(selectedStatus, installingProvider === selectedProvider);
  const statusMessage = selectedStatus?.message;
  const isReady = Boolean(selectedStatus && selectedStatus.state === 'ready' && isInstalled(selectedStatus));
  const manualInstallCommand = getManualInstallCommand(selectedProvider);
  const showManualInstall =
    Boolean(selectedProvider && manualInstallCommand) &&
    (selectedProvider ? installFailedProviders.has(selectedProvider) : false);
  const reportPayload = {
    provider: selectedProvider,
    status: selectedStatus?.state ?? 'unknown',
    message: selectedStatus?.message ?? '',
    appVersion: import.meta.env.VITE_APP_VERSION,
    userAgent: navigator.userAgent,
  };
  const reportText = JSON.stringify(reportPayload, null, 2);

  const markInstallFailed = (provider: AgentProvider): void => {
    setInstallFailedProviders((prev) => {
      const next = new Set(prev);
      next.add(provider);
      return next;
    });
  };

  const clearInstallFailed = (provider: AgentProvider): void => {
    setInstallFailedProviders((prev) => {
      if (!prev.has(provider)) return prev;
      const next = new Set(prev);
      next.delete(provider);
      return next;
    });
  };

  const handleSelect = (provider: AgentProvider): void => {
    setSelectedProvider(provider);
    setActionError(null);
  };

  const handleInstall = async (provider: AgentProvider): Promise<void> => {
    if (installingProvider || loginPendingProvider) return;
    setActionError(null);
    clearInstallFailed(provider);
    setInstallingProvider(provider);
    const result = await onInstallProvider(provider);
    if (!result.ok) {
      setActionError(result.error ?? 'Failed to install provider');
      markInstallFailed(provider);
      setInstallingProvider(null);
      return;
    }
    let status = result.status ?? null;
    if (!isReadyStatus(status)) {
      status = await pollProviderStatus(provider, onRefreshProviderStatus, {
        timeoutMs: 30_000,
        intervalMs: 1500,
        stopOnLoginRequired: true,
      });
    }
    setInstallingProvider(null);
    if (isLoginRequired(status)) {
      await handleLogin(provider);
      return;
    }
    if (!isReadyStatus(status)) {
      setActionError('Install did not complete. Try again or use the manual install command.');
      markInstallFailed(provider);
    }
  };

  const handleLogin = async (provider: AgentProvider): Promise<void> => {
    if (loginPendingProvider) return;
    setActionError(null);
    setLoginPendingProvider(provider);
    const result = await onLoginProvider(provider);
    if (!result.ok) {
      setActionError(result.error ?? 'Login failed');
      setLoginPendingProvider(null);
      return;
    }
    let status = result.status ?? null;
    if (!isReadyStatus(status)) {
      status = await pollProviderStatus(provider, onRefreshProviderStatus, {
        timeoutMs: 120_000,
        intervalMs: 2000,
      });
    }
    setLoginPendingProvider(null);
    if (!isReadyStatus(status)) {
      setActionError('Login did not complete. Please try again.');
    }
  };

  const handleConfirm = async (): Promise<void> => {
    if (!selectedProvider) return;
    setIsSubmitting(true);
    setActionError(null);
    const result = await onConfirmProvider(selectedProvider);
    if (!result.ok) {
      setActionError(result.error ?? 'Failed to set hero provider');
    }
    setIsSubmitting(false);
  };

  const handleCopyReport = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(reportText);
      setReportCopied(true);
      window.setTimeout(() => setReportCopied(false), 1500);
    } catch {
      setReportCopied(false);
    }
  };

  return (
    <div className="hero-selection-modal" role="dialog" aria-modal="true">
      <div className="hero-selection-panel" data-tutorial-target="hero-provider-panel">
        <header className="hero-selection-header">
          <div>
            <h2>Choose your hero</h2>
            <p className="hero-selection-subtitle">Which AI will you use to build your empire?</p>
            <p className="hero-selection-subtitle">
              You will need at least one AI subscription to use VibeCraft.
            </p>
            <p className="hero-selection-subtitle">
              Don&apos;t worry, you can change this later on if you change your
            </p>
          </div>
          {providerSnapshot.loading && <span className="hero-selection-loading">Detecting providers…</span>}
        </header>

        <section className="hero-selection-grid" role="list">
          {providers.map((provider) => {
            if (!isAgentProvider(provider.id)) return null;
            const providerId = provider.id as AgentProvider;
            const status = providerSnapshot.providerStatus[providerId] ?? null;
            const installing = installingProvider === providerId;
            const loggingIn = loginPendingProvider === providerId;
            const label = provider.name || PROVIDER_LABELS[providerId];
            const installed = isInstalled(status);
            const loginRequired = isLoginRequired(status);
            const hasStatus = Boolean(status);
            const needsInstall =
              hasStatus &&
              (!installed || status?.state === 'missing' || (status?.state === 'error' && !loginRequired));
            const needsLogin = hasStatus && installed && loginRequired;
            const actionLabel = needsInstall
              ? installing
                ? 'Installing…'
                : status?.state === 'error' && !loginRequired
                  ? 'Retry install'
                  : 'Install + Login'
              : loggingIn
                ? 'Logging in…'
                : 'Login';
            return (
              <div
                key={providerId}
                className={`hero-provider-card ${selectedProvider === providerId ? 'selected' : ''}`}
                role="button"
                tabIndex={0}
                aria-label={`Select ${label}`}
                onClick={() => handleSelect(providerId)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleSelect(providerId);
                  }
                }}
              >
                <img
                  className="hero-provider-icon"
                  src={getProviderIconUrl(providerId)}
                  alt=""
                  aria-hidden="true"
                />
                <div className="hero-provider-info">
                  <div className="hero-provider-title">{label}</div>
                  <div className="hero-provider-status">
                    <span className={`hero-provider-pill ${getStatusTone(status, installing)}`}>
                      {getStatusLabel(status, installing)}
                    </span>
                    {status?.source && (
                      <span className="hero-provider-source-badge" title={status.loggedInAs}>
                        {status.source}
                      </span>
                    )}
                  </div>
                </div>
                {(needsInstall || needsLogin) && (
                  <button
                    type="button"
                    className="hero-provider-install"
                    aria-label={`${needsInstall ? 'Install' : 'Login'} ${label}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (needsInstall) {
                        void handleInstall(providerId);
                      } else {
                        void handleLogin(providerId);
                      }
                    }}
                    disabled={installingProvider !== null || loginPendingProvider !== null}
                  >
                    {actionLabel}
                  </button>
                )}
              </div>
            );
          })}
        </section>

        <footer className="hero-selection-footer">
          <div className="hero-selection-status">
            <span className={`hero-selection-status-label ${statusTone}`}>
              {selectedProvider ? PROVIDER_LABELS[selectedProvider] : 'No provider selected'} · {statusLabel}
            </span>
            {shouldShowStatusMessage(statusMessage) && (
              <span className="hero-selection-status-message">{statusMessage}</span>
            )}
            {actionError && <span className="hero-selection-status-message error">{actionError}</span>}
            {showManualInstall && (
              <div className="hero-selection-manual">
                <div className="hero-selection-manual-title">Manual install</div>
                <div className="hero-selection-manual-command">
                  <code>{manualInstallCommand}</code>
                </div>
                <div className="hero-selection-manual-hint">
                  If the install button fails, run this in your terminal.
                </div>
              </div>
            )}
            {!isReady && (
              <button
                type="button"
                className="hero-selection-report"
                onClick={() => setShowReport((prev) => !prev)}
              >
                Report a bug
              </button>
            )}
            {showReport && (
              <div className="hero-selection-report-panel">
                <div className="hero-selection-report-title">Bug report details</div>
                <pre className="hero-selection-report-body">{reportText}</pre>
                <button
                  type="button"
                  className="hero-selection-report-copy"
                  onClick={() => void handleCopyReport()}
                >
                  {reportCopied ? 'Copied' : 'Copy details'}
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            className="hero-selection-confirm"
            onClick={() => void handleConfirm()}
            disabled={!selectedProvider || !isReady || isSubmitting}
          >
            {isSubmitting ? 'Saving…' : 'Done'}
          </button>
        </footer>
      </div>
    </div>
  );
}
