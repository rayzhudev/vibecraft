import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Agent,
  AgentModelInfo,
  BrowserPanel,
  Folder,
  Hero,
  TerminalPanel,
  WorldEntity,
} from '../../../shared/types';
import { entityIcons } from '../../assets/icons';
import { getProviderIconUrl } from '../../utils/providerIcons';
import { workspaceClient } from '../../services/workspaceClient';

type ModelCommitResult = { ok: boolean; error?: string };

interface CompactDetailsPanelProps {
  entity: WorldEntity;
  terminalProcess: string | null;
  onHeroNameCommit?: (name: string) => void;
  onAgentNameCommit?: (agentId: string, name: string) => void;
  onHeroModelCommit?: (model: string) => Promise<ModelCommitResult>;
}

export default function CompactDetailsPanel({
  entity,
  terminalProcess,
  onHeroNameCommit,
  onAgentNameCommit,
  onHeroModelCommit,
}: CompactDetailsPanelProps) {
  const [heroNameDraft, setHeroNameDraft] = useState('');
  const [agentNameDraft, setAgentNameDraft] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [heroModelDraft, setHeroModelDraft] = useState('');
  const [heroModelError, setHeroModelError] = useState<string | null>(null);
  const [recentModels, setRecentModels] = useState<AgentModelInfo[] | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const modelsRequestRef = useRef<Promise<AgentModelInfo[]> | null>(null);
  const modelsRefreshRef = useRef<Promise<AgentModelInfo[]> | null>(null);
  const modelsFetchIdRef = useRef(0);
  const modelsLoadingCountRef = useRef(0);
  const defaultModelAttemptedRef = useRef<string | null>(null);
  const isHero = entity.type === 'hero';
  const heroProvider = isHero ? entity.provider : null;
  const heroModel = isHero ? entity.model : '';

  useEffect(() => {
    if (entity.type === 'hero') {
      setHeroNameDraft(entity.name);
    } else {
      setHeroNameDraft('');
    }
    setIsEditing(false);
  }, [entity]);

  useEffect(() => {
    if (entity.type === 'agent') {
      setAgentNameDraft(entity.displayName);
    } else {
      setAgentNameDraft('');
    }
    setIsEditing(false);
  }, [entity]);

  useEffect(() => {
    if (isHero) {
      setHeroModelDraft(heroModel);
      setHeroModelError(null);
      return;
    }
    setHeroModelDraft('');
    setHeroModelError(null);
  }, [isHero, heroModel]);

  useEffect(() => {
    modelsRequestRef.current = null;
    modelsRefreshRef.current = null;
    modelsFetchIdRef.current += 1;
    modelsLoadingCountRef.current = 0;
    setModelsLoading(false);
    setRecentModels(null);
    defaultModelAttemptedRef.current = null;
  }, [isHero, heroProvider]);

  const formatModelLabel = useCallback((model: string) => {
    const cleanModel = model.trim();
    return cleanModel || 'default';
  }, []);

  const updateModelsLoading = useCallback((delta: number) => {
    modelsLoadingCountRef.current = Math.max(0, modelsLoadingCountRef.current + delta);
    const next = modelsLoadingCountRef.current > 0;
    setModelsLoading((prev) => (prev === next ? prev : next));
  }, []);

  const refreshRecentModels = useCallback(
    async (options?: { force?: boolean; showLoading?: boolean }): Promise<AgentModelInfo[]> => {
      if (!isHero || !heroProvider) return [];
      const force = options?.force ?? false;
      if (!force && recentModels !== null) return recentModels;
      const requestRef = force ? modelsRefreshRef : modelsRequestRef;
      if (requestRef.current) return requestRef.current;

      const fetchId = ++modelsFetchIdRef.current;
      const showLoading = options?.showLoading ?? true;
      if (showLoading) updateModelsLoading(1);

      const request = (async () => {
        try {
          const models = await workspaceClient.agentConnectModelsRecent(
            heroProvider,
            force ? { force: true } : {}
          );
          if (modelsFetchIdRef.current === fetchId) {
            setRecentModels(models);
          }
          return models;
        } catch {
          const fallbackModels: AgentModelInfo[] = recentModels ?? [];
          if (modelsFetchIdRef.current === fetchId) {
            setRecentModels(fallbackModels);
          }
          return fallbackModels;
        } finally {
          requestRef.current = null;
          if (showLoading) updateModelsLoading(-1);
        }
      })();

      requestRef.current = request;
      return request;
    },
    [heroProvider, isHero, recentModels, updateModelsLoading]
  );

  useEffect(() => {
    if (!isHero) return;
    if (recentModels !== null) return;
    void refreshRecentModels();
  }, [isHero, recentModels, refreshRecentModels]);

  const commitHeroModel = useCallback(
    async (model: string): Promise<ModelCommitResult> => {
      if (!onHeroModelCommit) return { ok: true };
      try {
        return await onHeroModelCommit(model);
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Failed to update hero model' };
      }
    },
    [onHeroModelCommit]
  );

  const modelOptions = useMemo(() => {
    const options: Array<{ id: string; label: string }> = [];
    const seen = new Set<string>();
    options.push({ id: '', label: 'default' });
    seen.add('');
    const currentId = heroModelDraft.trim();

    if (currentId) {
      const currentMatch = (recentModels ?? []).find((model) => model.id.trim() === currentId);
      if (!currentMatch) {
        options.push({ id: currentId, label: currentId });
        seen.add(currentId);
      }
    }

    (recentModels ?? []).forEach((model) => {
      const id = model.id.trim();
      if (!id || seen.has(id)) return;
      const label = model.displayName?.trim() || id;
      options.push({ id, label });
      seen.add(id);
    });

    return options;
  }, [heroModelDraft, recentModels]);

  const handleHeroModelChange = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed || trimmed === heroModel.trim()) return;
      const previousModel = heroModel;
      setHeroModelDraft(trimmed);
      setHeroModelError(null);
      const result = await commitHeroModel(trimmed);
      if (!result.ok) {
        setHeroModelDraft(previousModel);
        setHeroModelError(result.error ?? 'Failed to update hero model');
      }
    },
    [commitHeroModel, heroModel]
  );

  useEffect(() => {
    if (!isHero) return;
    if (heroModelDraft.trim()) return;
    if (!recentModels || recentModels.length === 0) return;
    const next = recentModels[0]?.id?.trim();
    if (!next) return;
    if (defaultModelAttemptedRef.current === next) return;
    defaultModelAttemptedRef.current = next;

    void (async () => {
      setHeroModelError(null);
      const result = await commitHeroModel(next);
      if (result.ok) {
        setHeroModelDraft(next);
      } else {
        setHeroModelDraft(heroModel);
        setHeroModelError(result.error ?? 'Failed to set default hero model');
      }
    })();
  }, [commitHeroModel, heroModel, heroModelDraft, isHero, recentModels]);

  const getIconUrl = (): string => {
    switch (entity.type) {
      case 'hero':
        return entityIcons.hero;
      case 'agent':
        return getProviderIconUrl((entity as Agent).provider);
      case 'folder':
        return entityIcons.folder;
      case 'browser':
        return entityIcons.browser;
      case 'terminal':
        return entityIcons.terminal;
      default:
        return entityIcons.hero;
    }
  };

  const getName = () => {
    switch (entity.type) {
      case 'hero':
        return entity.name;
      case 'agent':
        return entity.displayName;
      case 'folder':
        return entity.name;
      case 'browser':
        return 'Browser';
      case 'terminal':
        return 'Terminal';
      default:
        return 'Unknown';
    }
  };

  const getStatus = () => {
    if (entity.type === 'agent') {
      return entity.status;
    }
    if (entity.type === 'terminal') {
      return terminalProcess && terminalProcess.trim() ? terminalProcess : 'Idle';
    }
    return null;
  };

  const getDetailRows = (): Array<{ label: string; value: string; isPath?: boolean }> => {
    switch (entity.type) {
      case 'hero': {
        return [];
      }
      case 'agent': {
        const agent = entity as Agent;
        return [
          { label: 'Provider', value: agent.provider },
          { label: 'Model', value: agent.model || 'default' },
        ];
      }
      case 'folder': {
        const folder = entity as Folder;
        return [
          { label: 'Path', value: folder.relativePath || folder.name, isPath: true },
          ...(folder.worktreeBranch ? [{ label: 'Branch', value: folder.worktreeBranch }] : []),
        ];
      }
      case 'browser': {
        const browser = entity as BrowserPanel;
        return [{ label: 'URL', value: browser.url, isPath: true }];
      }
      case 'terminal': {
        const terminal = entity as TerminalPanel;
        return [
          { label: 'CWD', value: terminal.lastKnownCwd || '.', isPath: true },
          ...(terminalProcess ? [{ label: 'Process', value: terminalProcess }] : []),
        ];
      }
      default:
        return [];
    }
  };

  const handleNameClick = () => {
    if (entity.type === 'hero' || entity.type === 'agent') {
      setIsEditing(true);
    }
  };

  const handleNameBlur = () => {
    setIsEditing(false);
    if (entity.type === 'hero') {
      const trimmed = heroNameDraft.trim();
      if (trimmed && trimmed !== (entity as Hero).name) {
        onHeroNameCommit?.(trimmed);
      } else {
        setHeroNameDraft((entity as Hero).name);
      }
    } else if (entity.type === 'agent') {
      const trimmed = agentNameDraft.trim();
      if (trimmed && trimmed !== (entity as Agent).displayName) {
        onAgentNameCommit?.(entity.id, trimmed);
      } else {
        setAgentNameDraft((entity as Agent).displayName);
      }
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
    }
    if (event.key === 'Escape') {
      if (entity.type === 'hero') {
        setHeroNameDraft((entity as Hero).name);
      } else if (entity.type === 'agent') {
        setAgentNameDraft((entity as Agent).displayName);
      }
      setIsEditing(false);
    }
  };

  const status = getStatus();
  const statusClass = entity.type === 'agent' ? `status-${status}` : '';
  const detailRows = getDetailRows();
  const showDetails = isHero || detailRows.length > 0;

  return (
    <div className="compact-details-panel">
      <div className="compact-details-header-row">
        <img className="compact-details-icon" src={getIconUrl()} alt={entity.type} />
        <div className="compact-details-header">
          {isEditing ? (
            <input
              className="compact-details-name-input"
              value={entity.type === 'hero' ? heroNameDraft : agentNameDraft}
              onChange={(e) =>
                entity.type === 'hero' ? setHeroNameDraft(e.target.value) : setAgentNameDraft(e.target.value)
              }
              onBlur={handleNameBlur}
              onKeyDown={handleKeyDown}
              autoFocus
            />
          ) : (
            <span
              className={`compact-details-name ${entity.type === 'hero' || entity.type === 'agent' ? 'editable' : ''}`}
              onClick={handleNameClick}
            >
              {getName()}
            </span>
          )}
          {status && <span className={`compact-details-status ${statusClass}`}>{status}</span>}
        </div>
      </div>

      {showDetails && (
        <>
          <div className="compact-details-divider" />
          <div className="compact-details-content">
            {isHero ? (
              <div className="compact-details-info-row">
                <span className="compact-details-label">Model</span>
                <div className="compact-details-model-control">
                  <select
                    className="compact-details-model-select"
                    value={heroModelDraft.trim() ? heroModelDraft : ''}
                    onChange={(event) => void handleHeroModelChange(event.target.value)}
                    onFocus={() => void refreshRecentModels({ force: true })}
                    aria-label="Hero model"
                  >
                    {modelOptions.map((model) => (
                      <option key={model.id || 'default'} value={model.id}>
                        {formatModelLabel(model.label)}
                      </option>
                    ))}
                  </select>
                  {modelsLoading ? <span className="compact-details-model-loading">Updating…</span> : null}
                </div>
              </div>
            ) : null}
            {detailRows.map((row, i) => (
              <div key={i} className="compact-details-info-row">
                <span className="compact-details-label">{row.label}</span>
                <span className={`compact-details-value ${row.isPath ? 'path' : ''}`}>{row.value}</span>
              </div>
            ))}
            {isHero && heroModelError ? (
              <div className="compact-details-model-error" role="status" aria-live="polite">
                {heroModelError}
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
