import { useEffect, useState } from 'react';
import { useAppSettings, saveSettings } from '../../state/appSettingsStore';

interface ProjectsSectionProps {
  priorImportAvailable: boolean;
  priorSettingsDetected: boolean;
  priorImportPending: boolean;
  priorImportError: string | null;
  onImportPriorProjects: () => void | Promise<boolean>;
}

export default function ProjectsSection({
  priorImportAvailable,
  priorSettingsDetected,
  priorImportPending,
  priorImportError,
  onImportPriorProjects,
}: ProjectsSectionProps) {
  const { settings } = useAppSettings();
  const projectsPath = settings.workspacePath ?? '';
  const [selecting, setSelecting] = useState(false);
  const [checkingPriorSettings, setCheckingPriorSettings] = useState(false);
  const [detectedPriorSettings, setDetectedPriorSettings] = useState(priorSettingsDetected);

  useEffect(() => {
    if (!priorImportAvailable) {
      setDetectedPriorSettings(false);
      return;
    }
    const request = window.electronAPI.checkForPriorSettings?.();
    if (!request) {
      setDetectedPriorSettings(false);
      setCheckingPriorSettings(false);
      return;
    }
    let active = true;
    setCheckingPriorSettings(true);
    void request
      .then((result) => {
        if (!active) return;
        setDetectedPriorSettings(Boolean(result?.found));
      })
      .catch(() => {
        if (!active) return;
        setDetectedPriorSettings(false);
      })
      .finally(() => {
        if (!active) return;
        setCheckingPriorSettings(false);
      });
    return () => {
      active = false;
    };
  }, [priorImportAvailable, priorSettingsDetected]);

  const handleBrowse = async () => {
    if (selecting) return;
    setSelecting(true);
    try {
      const selected = await window.electronAPI.selectFolder({ title: 'Select Projects Directory' });
      if (selected) {
        saveSettings({ workspacePath: selected });
      }
    } finally {
      setSelecting(false);
    }
  };

  const handleClear = () => {
    saveSettings({ workspacePath: undefined });
  };

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Projects Directory</h2>
      <p className="settings-section-description">
        The parent folder that contains your project folders. VibeCraft will use this as the default location
        when opening or creating workspaces.
      </p>

      <div className="settings-projects-path-row">
        <div className="settings-projects-path-display" title={projectsPath || 'No directory set'}>
          {projectsPath || <span className="settings-projects-path-placeholder">No directory set</span>}
        </div>
        <div className="settings-projects-path-actions">
          <button type="button" className="settings-projects-btn" onClick={handleBrowse} disabled={selecting}>
            {selecting ? 'Selecting…' : 'Browse…'}
          </button>
          {projectsPath && (
            <button type="button" className="settings-projects-btn secondary" onClick={handleClear}>
              Clear
            </button>
          )}
        </div>
      </div>

      {priorImportAvailable && detectedPriorSettings && (
        <div className="settings-projects-import-card">
          <div className="settings-projects-import-copy">
            <h3>I detected prior settings</h3>
            <p>
              You can import prior projects from an earlier VibeCraft install without replacing the projects
              root you have set in this app.
            </p>
          </div>
          <div className="settings-projects-import-actions">
            <button
              type="button"
              className="settings-projects-btn"
              onClick={() => {
                void onImportPriorProjects();
              }}
              disabled={priorImportPending || checkingPriorSettings}
            >
              {priorImportPending ? 'Importing…' : 'Import Prior Settings'}
            </button>
          </div>
          {priorImportError && <p className="settings-projects-import-error">{priorImportError}</p>}
        </div>
      )}
    </div>
  );
}
