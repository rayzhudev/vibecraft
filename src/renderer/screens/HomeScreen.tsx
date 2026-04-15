import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '../theme/themeContext';
import { uiIcons } from '../assets/icons';
import type { SubtitleOption } from '../theme/screens';
import type { UpdateStatus } from '../../shared/types';

interface HomeScreenProps {
  onOpenWorldSelector: () => void;
  onOpenTutorial: () => void;
  onResumeTutorial?: () => void;
  onRestartTutorial: () => void;
  tutorialProgress?: { current: number; total: number; label: string } | null;
  onOpenSettings: () => void;
  showTourOptIn?: boolean;
  onTourOptInContinue?: () => void;
  onTourOptInRestart?: () => void;
}

const HomeScreen: React.FC<HomeScreenProps> = ({
  onOpenWorldSelector,
  onOpenTutorial,
  onResumeTutorial,
  onRestartTutorial,
  tutorialProgress,
  onOpenSettings,
  showTourOptIn = false,
  onTourOptInContinue,
  onTourOptInRestart,
}) => {
  const { activeTheme } = useTheme();
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [updateActionStarting, setUpdateActionStarting] = useState(false);
  const [updateRestarting, setUpdateRestarting] = useState(false);
  const [restartOverlayDismissed, setRestartOverlayDismissed] = useState(false);
  const wasUpdateDownloadedRef = useRef(false);
  const updateRestartTimeoutRef = useRef<number | null>(null);
  const updatePreviewTimeoutRef = useRef<number | null>(null);
  const updateActionTimeoutRef = useRef<number | null>(null);
  const subtitle = useMemo(() => {
    const options = activeTheme.copy?.home?.subtitleOptions ?? [];
    return pickRandomSubtitle(options);
  }, [activeTheme.copy?.home?.subtitleOptions]);
  const gitBranch = import.meta.env.VITE_GIT_BRANCH;
  const showDevBranch = import.meta.env.DEV && gitBranch;
  const previewVersion =
    import.meta.env.DEV && import.meta.env.VITE_UPDATE_PREVIEW_VERSION
      ? String(import.meta.env.VITE_UPDATE_PREVIEW_VERSION).trim()
      : '';
  const previewDownloadDurationMs = useMemo(() => {
    if (!import.meta.env.DEV) return 0;
    const raw = String(import.meta.env.VITE_UPDATE_PREVIEW_DOWNLOAD_MS ?? '').trim();
    if (!raw) return 6000;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return 6000;
    return Math.max(800, parsed);
  }, []);
  const formattedUpdateVersion =
    updateStatus?.version && updateStatus.version.startsWith('v')
      ? updateStatus.version
      : updateStatus?.version
        ? `v${updateStatus.version}`
        : '';
  const hasUpdate = Boolean(updateStatus?.available && updateStatus?.version);
  const updateErrorMessage = (updateStatus?.error ?? '').trim();
  const hasUpdateError = Boolean(updateErrorMessage);
  const isUpdateDownloaded = Boolean(updateStatus?.downloaded);
  const isUpdateDownloading = Boolean(updateStatus?.downloading || updateActionStarting);
  const showRestartOverlay = Boolean(isUpdateDownloaded && !hasUpdateError && !restartOverlayDismissed);
  const updateDescription = isUpdateDownloaded
    ? 'Update ready'
    : isUpdateDownloading
      ? 'Downloading'
      : hasUpdateError
        ? 'Update failed'
        : 'Update available';
  const hasTutorialResume = Boolean(onResumeTutorial && tutorialProgress);

  useEffect(() => {
    if (previewVersion) {
      setUpdateStatus({
        available: true,
        version: previewVersion,
        downloaded: false,
        downloading: false,
        error: null,
      });
      return;
    }
    let active = true;
    window.electronAPI
      .getUpdateStatus()
      .then((status) => {
        if (active) setUpdateStatus(status);
      })
      .catch(() => {
        if (active) setUpdateStatus(null);
      });
    const unsubscribe = window.electronAPI.onUpdateStatus((status) => setUpdateStatus(status));
    return () => {
      active = false;
      unsubscribe();
    };
  }, [previewVersion]);

  useEffect(() => {
    return () => {
      if (updatePreviewTimeoutRef.current) {
        window.clearTimeout(updatePreviewTimeoutRef.current);
      }
      if (updateActionTimeoutRef.current) {
        window.clearTimeout(updateActionTimeoutRef.current);
      }
      if (updateRestartTimeoutRef.current) {
        window.clearTimeout(updateRestartTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!updateStatus) return;
    if (updateStatus.downloading || updateStatus.downloaded || updateStatus.error) {
      setUpdateActionStarting(false);
    }
    if (updateStatus.error) {
      setUpdateRestarting(false);
    }
  }, [updateStatus]);

  useEffect(() => {
    if (!updateStatus) return;
    const wasDownloaded = wasUpdateDownloadedRef.current;
    if (!wasDownloaded && updateStatus.downloaded) {
      setRestartOverlayDismissed(false);
    }
    wasUpdateDownloadedRef.current = updateStatus.downloaded;
  }, [updateStatus]);

  const handleRestartInstall = async (): Promise<void> => {
    if (updateRestarting || hasUpdateError || !isUpdateDownloaded) return;

    if (updatePreviewTimeoutRef.current) {
      window.clearTimeout(updatePreviewTimeoutRef.current);
      updatePreviewTimeoutRef.current = null;
    }
    if (updateRestartTimeoutRef.current) {
      window.clearTimeout(updateRestartTimeoutRef.current);
      updateRestartTimeoutRef.current = null;
    }

    setUpdateRestarting(true);
    updateRestartTimeoutRef.current = window.setTimeout(() => {
      updateRestartTimeoutRef.current = null;
      setUpdateRestarting(false);
    }, 3000);

    if (previewVersion) {
      if (updateRestartTimeoutRef.current) {
        window.clearTimeout(updateRestartTimeoutRef.current);
        updateRestartTimeoutRef.current = null;
      }
      updatePreviewTimeoutRef.current = window.setTimeout(() => {
        setUpdateRestarting(false);
        setUpdateStatus({
          available: false,
          version: null,
          downloaded: false,
          downloading: false,
          error: null,
        });
      }, 900);
      return;
    }

    try {
      await window.electronAPI.installUpdate();
    } catch {
      setUpdateRestarting(false);
    }
  };

  const handleUpdateClick = async (): Promise<void> => {
    if (isUpdateDownloading) return;

    if (updatePreviewTimeoutRef.current) {
      window.clearTimeout(updatePreviewTimeoutRef.current);
      updatePreviewTimeoutRef.current = null;
    }
    if (updateActionTimeoutRef.current) {
      window.clearTimeout(updateActionTimeoutRef.current);
      updateActionTimeoutRef.current = null;
    }

    if (isUpdateDownloaded) {
      setRestartOverlayDismissed(false);
      return;
    }

    if (previewVersion) {
      if (hasUpdateError) {
        setUpdateStatus((current) => (current ? { ...current, error: null } : current));
      }
      setUpdateStatus((current) =>
        current ? { ...current, downloading: true, downloaded: false, error: null } : current
      );
      updatePreviewTimeoutRef.current = window.setTimeout(() => {
        setUpdateStatus((current) =>
          current ? { ...current, downloading: false, downloaded: true } : current
        );
      }, previewDownloadDurationMs);
      return;
    }

    const startTime = Date.now();
    setUpdateActionStarting(true);
    try {
      if (hasUpdateError) {
        setUpdateStatus((current) => (current ? { ...current, error: null } : current));
      }
      const status = await window.electronAPI.installUpdate();
      setUpdateStatus(status);
      const shouldClearAction =
        !status.downloading && !status.downloaded && !status.error && updateActionTimeoutRef.current === null;
      if (shouldClearAction) {
        const elapsedMs = Date.now() - startTime;
        const minVisibleMs = 700;
        const delayMs = Math.max(0, minVisibleMs - elapsedMs);
        updateActionTimeoutRef.current = window.setTimeout(() => {
          updateActionTimeoutRef.current = null;
          setUpdateActionStarting(false);
        }, delayMs);
      }
    } catch {
      setUpdateActionStarting(false);
    }
  };

  return (
    <div className="home-screen">
      <div className="update-restart-overlay" data-open={showRestartOverlay ? 'true' : 'false'}>
        <div className="update-restart-card" role="status" aria-live="polite">
          <div className="update-restart-copy">
            <div className="update-restart-title">
              {formattedUpdateVersion ? `Update ${formattedUpdateVersion} ready` : 'Update ready'}
            </div>
            <div className="update-restart-subtitle">Restart VibeCraft to finish installing.</div>
          </div>
          <div className="update-restart-actions">
            <button
              className="update-restart-btn secondary"
              type="button"
              onClick={() => setRestartOverlayDismissed(true)}
              disabled={updateRestarting}
            >
              Later
            </button>
            <button
              className="update-restart-btn primary"
              type="button"
              onClick={handleRestartInstall}
              disabled={updateRestarting}
            >
              {updateRestarting ? 'Restarting…' : 'Restart & Install'}
            </button>
          </div>
        </div>
      </div>

      <div className="background-shift" />
      <div className="background-image" />
      <div className="background-overlay"></div>

      {/* Main Title */}
      <div className="title-container">
        <h1 className="game-title">
          <span className="title-agent">VIBE</span>
          <span className="title-craft">CRAFT</span>
        </h1>
        <p className="subtitle">{subtitle ? renderSubtitle(subtitle) : null}</p>
      </div>

      {/* Floating Menu Panel */}
      <div className="menu-panel">
        <div className="menu-panel-header">
          <div className="panel-crest">⚔️</div>
          <div className="panel-title">Main Menu</div>
          <div className="panel-border"></div>
        </div>

        <div className="menu-buttons">
          {hasTutorialResume && tutorialProgress ? (
            <div className="tutorial-status-card" data-testid="home-tutorial-status">
              <div className="tutorial-status-kicker">Tutorial In Progress</div>
              <div className="tutorial-status-title">{tutorialProgress.label}</div>
              <div className="tutorial-status-meta">
                {`Step ${tutorialProgress.current} of ${tutorialProgress.total}`}
              </div>
              <div className="tutorial-status-actions">
                <button
                  className="menu-button secondary tutorial-action-button"
                  onClick={onResumeTutorial}
                  data-testid="home-resume-tutorial"
                >
                  <div className="button-icon">↩</div>
                  <div className="button-text">
                    <span className="button-label">Resume Tutorial</span>
                    <span className="button-description">Continue from this step</span>
                  </div>
                </button>
                <button
                  className="menu-button secondary tutorial-action-button"
                  onClick={onRestartTutorial}
                  data-testid="home-restart-tutorial"
                >
                  <div className="button-icon">↻</div>
                  <div className="button-text">
                    <span className="button-label">Restart Tutorial</span>
                    <span className="button-description">Begin again from the start</span>
                  </div>
                </button>
              </div>
            </div>
          ) : null}
          <button
            className="menu-button primary"
            onClick={onOpenWorldSelector}
            data-testid="home-select-world"
          >
            <div className="button-icon">🌍</div>
            <div className="button-text">
              <span className="button-label">Select World</span>
              <span className="button-description">Choose your realm</span>
            </div>
          </button>
          <button className="menu-button secondary" onClick={onOpenTutorial} data-testid="home-open-tutorial">
            <div className="button-icon">🎓</div>
            <div className="button-text">
              <span className="button-label">{hasTutorialResume ? 'Resume Tutorial' : 'See Tutorial'}</span>
              <span className="button-description">
                {hasTutorialResume ? 'Continue where you left off' : 'Start the guided walkthrough'}
              </span>
            </div>
          </button>
          <button className="menu-button secondary" onClick={onOpenSettings} data-testid="home-settings">
            <div className="button-icon">⚙️</div>
            <div className="button-text">
              <span className="button-label">Settings</span>
              <span className="button-description">Configure VibeCraft</span>
            </div>
          </button>
        </div>

        <div className="menu-panel-footer">
          <div className="version-info">
            <span>{`Version ${import.meta.env.VITE_APP_VERSION}`}</span>
            {hasUpdate ? (
              <span
                className="update-indicator"
                data-state={
                  hasUpdateError
                    ? 'error'
                    : isUpdateDownloaded
                      ? 'ready'
                      : isUpdateDownloading
                        ? 'downloading'
                        : 'pending'
                }
              >
                <span className="update-label">{updateDescription}</span>
                <span className="update-version">{`[${updateStatus?.version}]`}</span>
                {hasUpdateError ? (
                  <span className="update-error" title={updateErrorMessage}>
                    {updateErrorMessage}
                  </span>
                ) : null}
                <button
                  className="update-button"
                  onClick={handleUpdateClick}
                  type="button"
                  disabled={isUpdateDownloading}
                  data-state={
                    hasUpdateError
                      ? 'error'
                      : isUpdateDownloading
                        ? 'loading'
                        : isUpdateDownloaded
                          ? 'ready'
                          : 'idle'
                  }
                  aria-busy={isUpdateDownloading}
                  aria-label={
                    hasUpdateError
                      ? 'Retry update download'
                      : isUpdateDownloaded
                        ? 'Update ready to install'
                        : formattedUpdateVersion
                          ? `Download ${formattedUpdateVersion}`
                          : 'Download update'
                  }
                >
                  <img className="update-icon" src={uiIcons.updateDownload} alt="" />
                </button>
              </span>
            ) : null}
          </div>
          {showDevBranch ? <div className="dev-branch">{gitBranch}</div> : null}
        </div>
      </div>

      {showTourOptIn && (
        <div className="tour-opt-in-overlay">
          <div className="tour-opt-in-card">
            <h2 className="tour-opt-in-title">Welcome to VibeCraft</h2>
            <p className="tour-opt-in-body">
              You&apos;ve completed the tutorial. Ready to start building with AI agents?
            </p>
            <div className="tour-opt-in-actions">
              <button
                type="button"
                className="tour-opt-in-btn tour-opt-in-btn--accept"
                onClick={onTourOptInRestart}
              >
                Restart Tutorial
              </button>
              <button
                type="button"
                className="tour-opt-in-btn tour-opt-in-btn--skip"
                onClick={onTourOptInContinue}
              >
                Continue?
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HomeScreen;

function pickRandomSubtitle(options: SubtitleOption[]): SubtitleOption | null {
  if (!options.length) {
    return null;
  }
  const randomIndex = Math.floor(Math.random() * options.length);
  return options[randomIndex];
}

function renderSubtitle(subtitle: SubtitleOption): React.ReactNode {
  return subtitle.segments.map((segment, index) => {
    if (segment.className) {
      return (
        <span key={`${segment.className}-${index}`} className={segment.className}>
          {segment.text}
        </span>
      );
    }
    return <React.Fragment key={index}>{segment.text}</React.Fragment>;
  });
}
