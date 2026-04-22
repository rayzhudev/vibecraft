import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  PriorWorkspacePreviewEntry,
  PriorWorkspacePreviewSource,
  TutorialState,
  Workspace,
} from '../../shared/types';
import { entityIcons } from '../assets/icons';
import { TUTORIAL_WORLD_ID, isTutorialActive } from '../tutorial/constants';
import TutorialSpotlight from '../components/TutorialSpotlight';
import { refreshAppSettings } from '../state/appSettingsStore';

interface WorldSelectionProps {
  onSelect: (workspace: Workspace) => void;
  onBack: () => void;
  tutorialState?: TutorialState;
}

export default function WorldSelection({ onSelect, onBack, tutorialState }: WorldSelectionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [tutorialWorld, setTutorialWorld] = useState<Workspace | null>(null);
  const [priorSources, setPriorSources] = useState<PriorWorkspacePreviewSource[]>([]);
  const [priorImportPending, setPriorImportPending] = useState(false);
  const [priorImportError, setPriorImportError] = useState<string | null>(null);
  const [priorImportSummary, setPriorImportSummary] = useState<string | null>(null);
  const tutorialEnabled = isTutorialActive(tutorialState);

  const loadWorkspaces = useCallback(async () => {
    setIsLoading(true);
    try {
      const recent = await window.electronAPI.getRecentWorkspaces();
      const sorted = (recent ?? []).slice().sort((a, b) => b.lastAccessed - a.lastAccessed);
      setWorkspaces(sorted);
    } catch (error) {
      console.error('Failed to load workspaces:', error);
      setWorkspaces([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWorkspaces();
  }, [loadWorkspaces]);

  useEffect(() => {
    if (!tutorialEnabled) return;
    let active = true;
    void (async () => {
      const world = await window.electronAPI.getTutorialWorld();
      if (active) {
        setTutorialWorld(world);
      }
    })();
    return () => {
      active = false;
    };
  }, [tutorialEnabled]);

  useEffect(() => {
    if (tutorialEnabled) {
      setPriorSources([]);
      setPriorImportError(null);
      setPriorImportSummary(null);
      return;
    }
    const request = window.electronAPI.getPriorWorkspacePreview?.();
    if (!request) {
      setPriorSources([]);
      return;
    }
    let active = true;
    void request
      .then((result) => {
        if (!active) return;
        const workspaces = result?.workspaces ?? [];
        const sources = result?.sources ?? [];
        setPriorSources(
          sources.length > 0
            ? sources
            : workspaces.length > 0
              ? [
                  {
                    sourceDir: result?.sourceDir,
                    sourceName: workspaces[0]?.sourceName,
                    workspaces,
                  },
                ]
              : []
        );
        setPriorImportSummary(null);
      })
      .catch(() => {
        if (!active) return;
        setPriorSources([]);
        setPriorImportSummary(null);
      });
    return () => {
      active = false;
    };
  }, [tutorialEnabled]);

  const formatLastAccessed = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    return `${days} days ago`;
  };

  const handleSelectFolder = async () => {
    if (tutorialEnabled) {
      return;
    }
    const selectedPath = await window.electronAPI.selectFolder({ title: 'Select Workspace Folder' });
    if (!selectedPath) {
      return;
    }

    const existing = workspaces.find((workspace) => workspace.path === selectedPath);
    const now = Date.now();
    const folderName = selectedPath.split(/[\\/]/).pop() || 'New Workspace';
    const updatedWorkspace: Workspace = existing
      ? { ...existing, lastAccessed: now }
      : {
          id: `ws-${now}`,
          name: folderName,
          path: selectedPath,
          lastAccessed: now,
        };

    try {
      await window.electronAPI.addRecentWorkspace(updatedWorkspace);
    } catch (error) {
      console.error('Failed to save workspace:', error);
    } finally {
      loadWorkspaces();
    }
  };

  const isTutorialWorld = useCallback(
    (workspace: Workspace) => {
      if (workspace.id === TUTORIAL_WORLD_ID) return true;
      if (tutorialWorld?.id && workspace.id === tutorialWorld.id) return true;
      if (tutorialWorld?.path && workspace.path === tutorialWorld.path) return true;
      return false;
    },
    [tutorialWorld?.id, tutorialWorld?.path]
  );

  const isInteractive = useCallback(
    (workspace: Workspace) => !tutorialEnabled || isTutorialWorld(workspace),
    [isTutorialWorld, tutorialEnabled]
  );

  const handlePlayWorld = async (workspace: Workspace) => {
    if (tutorialEnabled && !isTutorialWorld(workspace)) {
      return;
    }
    setSelectedWorkspaceId(workspace.id);
    const updated = { ...workspace, lastAccessed: Date.now() };
    try {
      await window.electronAPI.addRecentWorkspace(updated);
    } catch (error) {
      console.error('Failed to update workspace timestamp:', error);
    }
    onSelect(updated);
  };

  const handleDeleteWorld = async (event: React.MouseEvent, workspaceId: string) => {
    event.stopPropagation();
    if (tutorialEnabled) {
      return;
    }
    try {
      await window.electronAPI.removeRecentWorkspace(workspaceId);
      await loadWorkspaces();
    } catch (error) {
      console.error('Failed to delete workspace:', error);
    }
  };

  const mergedWorkspaces = useMemo(() => {
    const next = [...workspaces];
    if (
      tutorialWorld &&
      !next.some((workspace) => workspace.id === tutorialWorld.id || workspace.path === tutorialWorld.path)
    ) {
      next.push(tutorialWorld);
    }
    return next.slice().sort((a, b) => b.lastAccessed - a.lastAccessed);
  }, [tutorialWorld, workspaces]);

  const priorSourceGroups = useMemo(() => {
    const currentPaths = new Set(mergedWorkspaces.map((workspace) => workspace.path));
    return priorSources
      .map((source) => ({
        ...source,
        workspaces: source.workspaces
          .filter((workspace) => workspace.id !== TUTORIAL_WORLD_ID)
          .map((workspace) => ({
            workspace,
            alreadyImported: currentPaths.has(workspace.path),
          })),
      }))
      .filter((source) => source.workspaces.length > 0);
  }, [mergedWorkspaces, priorSources]);

  const tutorialBubbleAnchor = useMemo(
    () => mergedWorkspaces.find((workspace) => isTutorialWorld(workspace)) ?? null,
    [isTutorialWorld, mergedWorkspaces]
  );

  const tutorialBubbleText = 'To get you started, we created a Tutorial world for you.';

  const spotlightSelector = tutorialEnabled
    ? ['[data-tutorial-target="tutorial-world"]', '[data-tutorial-target="tutorial-world-tooltip"]']
    : null;

  const handleBackClick = useCallback(() => {
    if (tutorialEnabled) {
      return;
    }
    onBack();
  }, [onBack, tutorialEnabled]);

  const handleImportPriorProjects = useCallback(
    async (workspaceToOpen?: PriorWorkspacePreviewEntry) => {
      setPriorImportPending(true);
      setPriorImportError(null);
      setPriorImportSummary(null);
      try {
        const result = await window.electronAPI.backupAndImportSettings?.();
        if (!result?.success) {
          setPriorImportError(result?.error ?? 'Failed to import prior projects.');
          return;
        }
        const importedCount = result.importedCount ?? 0;
        const duplicateCount = result.duplicateCount ?? 0;
        setPriorImportSummary(
          importedCount > 0
            ? `Imported ${importedCount} project${importedCount === 1 ? '' : 's'}${duplicateCount > 0 ? `; skipped ${duplicateCount} duplicate entr${duplicateCount === 1 ? 'y' : 'ies'}` : ''}.`
            : duplicateCount > 0
              ? `No new projects imported; ${duplicateCount} duplicate entr${duplicateCount === 1 ? 'y was' : 'ies were'} skipped.`
              : 'No new projects were imported.'
        );
        await refreshAppSettings();
        await loadWorkspaces();
        const recent = await window.electronAPI.getRecentWorkspaces();
        setPriorSources([]);
        if (workspaceToOpen) {
          const matched = recent.find((workspace) => workspace.path === workspaceToOpen.path);
          if (matched) {
            onSelect(matched);
          }
        }
      } catch (error) {
        setPriorImportError(error instanceof Error ? error.message : 'Failed to import prior projects.');
      } finally {
        setPriorImportPending(false);
      }
    },
    [loadWorkspaces, onSelect]
  );

  if (isLoading) {
    return (
      <div className={`world-selection ${tutorialEnabled ? 'tutorial-active' : ''}`} ref={containerRef}>
        <div className="world-header">
          <button className="back-button" onClick={handleBackClick} disabled={tutorialEnabled}>
            ← Back
          </button>
          <h1>Loading Worlds...</h1>
        </div>
      </div>
    );
  }

  const formatSourceUpdatedAt = (timestamp?: number) => {
    if (!timestamp) return null;
    try {
      return new Date(timestamp).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    } catch {
      return null;
    }
  };

  return (
    <div className={`world-selection ${tutorialEnabled ? 'tutorial-active' : ''}`} ref={containerRef}>
      <TutorialSpotlight
        active={tutorialEnabled}
        targetSelector={spotlightSelector}
        outlineSelector='[data-tutorial-target="tutorial-world"]'
      />
      <div className="world-header">
        <button className="back-button" onClick={handleBackClick} disabled={tutorialEnabled}>
          ← Back
        </button>
        <h1>Select World</h1>
        <p className="subtitle">Choose a workspace to work on</p>
      </div>

      <div className="world-content">
        {tutorialEnabled && !tutorialBubbleAnchor && (
          <div
            className="tutorial-world-tooltip tutorial-world-bubble-floating"
            role="note"
            data-tutorial-target="tutorial-world-tooltip"
          >
            <div className="tutorial-world-bubble-title">Select your world</div>
            <p>{tutorialBubbleText}</p>
          </div>
        )}
        <div className="world-list">
          {!tutorialEnabled && priorSourceGroups.length > 0 && (
            <div className="worlds-section worlds-section--prior-import">
              <div className="worlds-section-header">
                <div>
                  <h2>Detected Prior Projects</h2>
                  <p className="worlds-section-note">
                    These were found from earlier installs and backups. Already-imported projects are shown
                    for reference.
                  </p>
                </div>
                <button
                  type="button"
                  className="world-import-all-btn"
                  onClick={() => {
                    void handleImportPriorProjects();
                  }}
                  disabled={priorImportPending}
                >
                  {priorImportPending ? 'Importing…' : 'Import All'}
                </button>
              </div>
              {priorSourceGroups.map((source) => (
                <div key={source.sourceDir ?? source.sourceName} className="prior-source-group">
                  <div className="prior-source-group-header">
                    <div>
                      <h3>{source.sourceName ?? 'Detected Source'}</h3>
                      {formatSourceUpdatedAt(source.sourceUpdatedAt) && (
                        <p className="prior-source-group-meta">
                          Snapshot {formatSourceUpdatedAt(source.sourceUpdatedAt)}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="worlds-grid">
                    {source.workspaces.map(({ workspace, alreadyImported }) => (
                      <div
                        key={`prior-${source.sourceDir}-${workspace.path}`}
                        className={`world-item world-item--prior ${alreadyImported ? 'world-item--duplicate' : ''}`}
                      >
                        <div className="world-icon">⤴️</div>
                        <div className="world-info">
                          <h3>{workspace.name}</h3>
                          <p className="world-path">{workspace.path}</p>
                          {workspace.sourceName && (
                            <p className="world-source">From {workspace.sourceName}</p>
                          )}
                          <p className="world-meta">{formatLastAccessed(workspace.lastAccessed)}</p>
                        </div>
                        <div className="world-abilities world-abilities--prior-import">
                          {alreadyImported ? (
                            <span className="world-import-badge">Already Imported</span>
                          ) : null}
                          <button
                            className="world-import-open-btn"
                            type="button"
                            onClick={() => {
                              void handleImportPriorProjects(workspace);
                            }}
                            disabled={priorImportPending || alreadyImported}
                          >
                            {alreadyImported
                              ? 'Imported'
                              : priorImportPending
                                ? 'Importing…'
                                : 'Import & Open'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {priorImportSummary && <p className="world-import-summary">{priorImportSummary}</p>}
              {priorImportError && <p className="world-import-error">{priorImportError}</p>}
            </div>
          )}

          {mergedWorkspaces.length > 0 && (
            <div className="worlds-section">
              <h2>Recent Worlds</h2>
              <div className="worlds-grid">
                {mergedWorkspaces.map((workspace) => (
                  <div
                    key={workspace.id}
                    className={`world-item ${selectedWorkspaceId === workspace.id ? 'selected' : ''} ${
                      tutorialEnabled && !isTutorialWorld(workspace) ? 'is-disabled' : ''
                    }`}
                    onClick={isInteractive(workspace) ? () => handlePlayWorld(workspace) : undefined}
                    data-testid="world-item"
                    data-workspace-id={workspace.id}
                    data-workspace-path={workspace.path}
                    data-tutorial-target={
                      tutorialEnabled && tutorialBubbleAnchor?.id === workspace.id
                        ? 'tutorial-world'
                        : undefined
                    }
                  >
                    <div className="world-icon">🏗️</div>
                    <div className="world-info">
                      <h3>{workspace.name}</h3>
                      <p className="world-path">{workspace.path}</p>
                      <p className="world-meta">{formatLastAccessed(workspace.lastAccessed)}</p>
                    </div>
                    <div className="world-abilities">
                      <button
                        className="delete-button"
                        onClick={
                          !tutorialEnabled ? (event) => handleDeleteWorld(event, workspace.id) : undefined
                        }
                        aria-label="Remove workspace"
                        data-testid="world-delete"
                        disabled={tutorialEnabled}
                      >
                        🗑️
                      </button>
                    </div>
                    {tutorialEnabled && tutorialBubbleAnchor?.id === workspace.id && (
                      <div
                        className="tutorial-world-tooltip"
                        role="note"
                        data-tutorial-target="tutorial-world-tooltip"
                      >
                        <div className="tutorial-world-bubble-title">Select your world</div>
                        <p>{tutorialBubbleText}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="world-abilities-section">
            <h2>Add Workspace</h2>
            <div className="ability-buttons">
              <button
                className="ability-button select-folder"
                onClick={tutorialEnabled ? undefined : handleSelectFolder}
                data-testid="world-ability-select-parent"
                disabled={tutorialEnabled}
              >
                <img className="button-icon" src={entityIcons.folder} alt="" aria-hidden="true" />
                <div className="button-content">
                  <h3>Select Parent Directory</h3>
                  <p className="button-subtext">
                    Choose the parent folder that contains your project folders
                  </p>
                  <p className="button-hint">e.g. /Projects, /Work</p>
                </div>
              </button>
            </div>
          </div>

          {workspaces.length === 0 && (
            <div className="empty-state">
              <h2>No Worlds Found</h2>
              <p>
                VibeCraft workspaces contain multiple project folders. Select a parent directory to get
                started.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
