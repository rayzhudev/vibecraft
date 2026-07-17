import { useEffect, useState } from 'react';
import type { MemflowStatus } from '../../../shared/types';

const POLL_INTERVAL_MS = 10_000;

const StatusDot = ({ state }: { state: 'active' | 'partial' | 'inactive' }) => {
  const colors: Record<string, string> = {
    active: 'var(--color-success, #22c55e)',
    partial: 'var(--color-warning, #f59e0b)',
    inactive: 'var(--color-muted, #6b7280)',
  };
  return (
    <span
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: colors[state],
        flexShrink: 0,
        marginRight: 8,
      }}
    />
  );
};

export default function MaitrixLinkSection() {
  const [status, setStatus] = useState<MemflowStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);

  const fetchStatus = async () => {
    try {
      const result = await window.electronAPI.memflowStatus?.();
      if (result) setStatus(result);
    } catch {
      // noop — bridge may not be available in older builds
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchStatus();
    const interval = setInterval(() => void fetchStatus(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  const handleOpenLink = async () => {
    if (opening) return;
    setOpening(true);
    try {
      await window.electronAPI.memflowOpenLink?.();
    } finally {
      setOpening(false);
    }
  };

  const dotState = !status?.installed
    ? 'inactive'
    : status.daemonRunning
      ? 'active'
      : 'partial';

  const statusLabel = !status?.installed
    ? 'Not installed'
    : status.daemonRunning
      ? `Connected · ${status.trackedProjectCount} project${status.trackedProjectCount !== 1 ? 's' : ''} tracked`
      : 'Installed · daemon not running';

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h2 className="settings-section-title">Maitrix Link</h2>
        <p className="settings-section-description">
          When the MemFlow daemon is installed and running, VibeCraft projects appear in the
          Maitrix Link mobile UI so you can monitor and send prompts from anywhere.
        </p>
      </div>

      <div className="settings-card">
        <div className="maitrix-link-status-row">
          <div className="maitrix-link-status-indicator">
            {loading ? (
              <span className="maitrix-link-status-loading">Checking…</span>
            ) : (
              <>
                <StatusDot state={dotState} />
                <span className="maitrix-link-status-label">{statusLabel}</span>
              </>
            )}
          </div>

          <button
            id="maitrix-link-open-btn"
            type="button"
            className="settings-action-btn"
            onClick={() => void handleOpenLink()}
            disabled={opening}
          >
            {opening ? 'Opening…' : 'Open Maitrix Link'}
          </button>
        </div>

        {status?.installed && !status.daemonRunning && (
          <p className="maitrix-link-hint">
            Start the MemFlow daemon to sync VibeCraft projects with Maitrix.{' '}
            <code className="maitrix-link-code">npx memflow-cpu daemon start</code>
          </p>
        )}

        {!status?.installed && (
          <p className="maitrix-link-hint">
            Install MemFlow to enable mobile project access via Maitrix Link.{' '}
            <a
              href="https://memflow.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="maitrix-link-learn"
            >
              Learn more →
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
