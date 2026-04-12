interface WorkspaceHeaderProps {
  name: string;
  onBack: () => void;
  projectModeEnabled?: boolean;
  onToggleProjectMode?: () => void;
}

export default function WorkspaceHeader({
  name,
  onBack,
  projectModeEnabled,
  onToggleProjectMode,
}: WorkspaceHeaderProps) {
  return (
    <div className="workspace-header">
      <button className="back-btn" onClick={onBack}>
        ← Back
      </button>
      <h2>{name}</h2>
      {onToggleProjectMode !== undefined && (
        <button
          className={`workspace-header-project-btn${projectModeEnabled ? ' active' : ''}`}
          onClick={onToggleProjectMode}
          title={projectModeEnabled ? 'Disable Project Mode' : 'Enable Project Mode'}
        >
          {projectModeEnabled ? '◈ Projects (on)' : '◈ Projects'}
        </button>
      )}
    </div>
  );
}
