import { useCallback, useRef, useState } from 'react';
import type {
  AnyFolder,
  Agent,
  TerminalPanel as TerminalPanelRecord,
  BrowserPanel,
} from '../../../shared/types';
import type { ProjectLayoutMode } from '../../screens/workspace/useProjectMode';

interface ProjectPanelProps {
  folders: AnyFolder[];
  projectStats: Map<string, { agents: number; terminals: number; browsers: number; worktrees: number }>;
  projectColors: Map<string, string>;
  isProjectVisible: (folderId: string) => boolean;
  onToggleProject: (folderId: string) => void;
  onSetAllVisible: () => void;
  onSetProjectColor: (folderId: string, color: string) => void;
  onJumpToEntity: (x: number, y: number) => void;
  onFocusProject: (folderId: string) => void;
  onToggleFocusProject: (folderId: string) => void;
  onExitFocusMode: () => void;
  onClose: () => void;
  agents: Agent[];
  terminals: Record<string, TerminalPanelRecord>;
  browsers: BrowserPanel[];
  layoutActive: boolean;
  layoutMode: ProjectLayoutMode;
  onSetLayoutMode: (mode: ProjectLayoutMode) => void;
  onRefreshLayout: () => void;
  focusedProjectIds: ReadonlySet<string>;
  focusModeActive: boolean;
}

interface ProjectRowProps {
  folder: AnyFolder;
  stats: { agents: number; terminals: number; browsers: number; worktrees: number };
  visible: boolean;
  focused: boolean;
  focusModeActive: boolean;
  color: string;
  agents: Agent[];
  terminals: TerminalPanelRecord[];
  browsers: BrowserPanel[];
  onToggle: () => void;
  onJump: (x: number, y: number) => void;
  onFocus: () => void;
  onToggleFocus: () => void;
  onColorChange: (color: string) => void;
}

function ProjectRow({
  folder,
  stats,
  visible,
  focused,
  focusModeActive,
  color,
  agents,
  terminals,
  browsers,
  onToggle,
  onJump,
  onFocus,
  onToggleFocus,
  onColorChange,
}: ProjectRowProps) {
  const [expanded, setExpanded] = useState(false);
  const colorInputRef = useRef<HTMLInputElement>(null);
  const hasEntities = agents.length > 0 || terminals.length > 0 || browsers.length > 0;

  const handleColorClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    colorInputRef.current?.click();
  }, []);

  const handleCheckboxClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (focusModeActive) {
        onToggleFocus();
      } else {
        onToggle();
        onFocus();
      }
    },
    [focusModeActive, onToggle, onFocus, onToggleFocus]
  );

  const totalCount = stats.agents + stats.terminals + stats.browsers + stats.worktrees;
  const isFocused = focused;
  const isChecked = focusModeActive ? isFocused : visible;

  return (
    <div
      className={`pp-project${isChecked ? ' pp-project--visible' : ''}${isFocused ? ' pp-project--focused' : ''}`}
      style={{ '--project-color': color } as React.CSSProperties}
    >
      <div className="pp-project-row">
        {/* Color dropper */}
        <button
          className="pp-color-btn"
          onClick={handleColorClick}
          title="Pick project color"
          style={{ color }}
        >
          ◉
          <input
            ref={colorInputRef}
            type="color"
            value={color}
            className="pp-color-input"
            onChange={(e) => onColorChange(e.target.value)}
            onClick={(e) => e.stopPropagation()}
          />
        </button>

        {/* Visibility / focus checkbox */}
        <button
          className={`pp-check${isChecked ? ' pp-check--on' : ''}`}
          onClick={handleCheckboxClick}
          title={
            focusModeActive
              ? isFocused
                ? 'Remove from focus'
                : 'Add to focus'
              : visible
                ? 'Hide project'
                : 'Show project'
          }
          aria-pressed={isChecked}
        />

        {/* Name — click to focus exclusively */}
        <button
          className="pp-name"
          onClick={(e) => {
            e.stopPropagation();
            onFocus();
          }}
          title={`Focus ${folder.name}`}
        >
          {folder.kind === 'worktree' ? '⑂ ' : ''}
          {folder.name}
        </button>

        {/* Count badge */}
        {totalCount > 0 && <span className="pp-count">{totalCount}</span>}

        {/* Expand toggle */}
        {hasEntities && (
          <button
            className="pp-expand"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((p) => !p);
            }}
            aria-expanded={expanded}
          >
            {expanded ? '▾' : '›'}
          </button>
        )}
      </div>

      {expanded && (
        <div className="pp-entity-list">
          {agents.map((agent) => (
            <button
              key={agent.id}
              className="pp-entity"
              onClick={(e) => {
                e.stopPropagation();
                onJump(agent.x, agent.y);
              }}
              title={`Jump to ${agent.displayName}`}
            >
              <span className="pp-entity-icon">🤖</span>
              <span className="pp-entity-name">{agent.displayName ?? agent.name}</span>
              <span className="pp-entity-jump">→</span>
            </button>
          ))}
          {terminals.map((t) => (
            <button
              key={t.id}
              className="pp-entity"
              onClick={(e) => {
                e.stopPropagation();
                onJump(t.x, t.y);
              }}
              title="Jump to terminal"
            >
              <span className="pp-entity-icon">⬛</span>
              <span className="pp-entity-name">{t.originFolderName ?? 'terminal'}</span>
              <span className="pp-entity-jump">→</span>
            </button>
          ))}
          {browsers.map((b) => (
            <button
              key={b.id}
              className="pp-entity"
              onClick={(e) => {
                e.stopPropagation();
                onJump(b.x, b.y);
              }}
              title={`Jump to browser: ${b.url}`}
            >
              <span className="pp-entity-icon">🌐</span>
              <span className="pp-entity-name">{b.url.replace(/^https?:\/\//, '').split('/')[0]}</span>
              <span className="pp-entity-jump">→</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ProjectPanel({
  folders,
  projectStats,
  projectColors,
  isProjectVisible,
  onToggleProject,
  onSetAllVisible,
  onSetProjectColor,
  onJumpToEntity,
  onFocusProject,
  onToggleFocusProject,
  onExitFocusMode,
  onClose,
  agents,
  terminals,
  browsers,
  layoutActive,
  layoutMode,
  onSetLayoutMode,
  onRefreshLayout,
  focusedProjectIds,
  focusModeActive,
}: ProjectPanelProps) {
  const terminalList = Object.values(terminals);

  const handleSetNone = useCallback(() => {
    for (const f of folders) {
      if (isProjectVisible(f.id)) onToggleProject(f.id);
    }
  }, [folders, isProjectVisible, onToggleProject]);

  return (
    <div className="pp-panel">
      <div className="pp-header">
        <span className="pp-header-title">{focusModeActive ? '◈ Focus' : 'Projects'}</span>
        <div className="pp-header-actions">
          {focusModeActive ? (
            <button
              className="pp-header-btn pp-header-btn--exit-focus"
              onClick={onExitFocusMode}
              title="Exit focus mode"
            >
              ✕ Exit Focus
            </button>
          ) : (
            <>
              <button
                className={`pp-header-btn${layoutMode === 'manual' ? ' pp-header-btn--active' : ''}`}
                onClick={() => onSetLayoutMode('manual')}
                title="Custom: keep windows where you place them"
              >
                Custom
              </button>
              <button
                className={`pp-header-btn${layoutMode === 'organized' ? ' pp-header-btn--active' : ''}`}
                onClick={() => onSetLayoutMode('organized')}
                title="Panes: auto-organize one project per pane"
              >
                Panes
              </button>
              <button
                className={`pp-header-btn${layoutMode === 'tiled' ? ' pp-header-btn--active' : ''}`}
                onClick={() => onSetLayoutMode('tiled')}
                title="Tiles: grid of evenly sized panes"
              >
                Tiles
              </button>
              <button className="pp-header-btn" onClick={onSetAllVisible} title="Show all">
                All
              </button>
              <button className="pp-header-btn" onClick={handleSetNone} title="Hide all">
                None
              </button>
            </>
          )}
          <button
            className={`pp-header-btn${layoutActive ? ' pp-header-btn--active' : ''}`}
            onClick={() => {
              if (layoutMode === 'manual') {
                onSetLayoutMode('organized');
              }
              onRefreshLayout();
            }}
            title="Re-arrange by project"
          >
            ⊞ Arrange
          </button>
          <button className="pp-header-btn pp-header-btn--close" onClick={onClose} title="Close panel">
            ✕
          </button>
        </div>
      </div>

      {focusModeActive && (
        <div className="pp-focus-hint">Click a project name to switch focus. ✓ to add/remove.</div>
      )}

      <div className="pp-list">
        {folders.length === 0 && <div className="pp-empty">No project folders yet</div>}
        {folders.map((folder) => {
          const stats = projectStats.get(folder.id) ?? { agents: 0, terminals: 0, browsers: 0, worktrees: 0 };
          const folderAgents = agents.filter((a) => a.attachedFolderId === folder.id);
          const folderTerminals = terminalList.filter((t) => t.originFolderId === folder.id);
          const folderBrowsers = browsers.filter((b) => b.originFolderId === folder.id);
          const color = projectColors.get(folder.id) ?? '#63b3ed';
          return (
            <ProjectRow
              key={folder.id}
              folder={folder}
              stats={stats}
              visible={isProjectVisible(folder.id)}
              focused={focusedProjectIds.has(folder.id)}
              focusModeActive={focusModeActive}
              color={color}
              agents={folderAgents}
              terminals={folderTerminals}
              browsers={folderBrowsers}
              onToggle={() => onToggleProject(folder.id)}
              onJump={onJumpToEntity}
              onFocus={() => onFocusProject(folder.id)}
              onToggleFocus={() => onToggleFocusProject(folder.id)}
              onColorChange={(c) => onSetProjectColor(folder.id, c)}
            />
          );
        })}
      </div>
    </div>
  );
}
