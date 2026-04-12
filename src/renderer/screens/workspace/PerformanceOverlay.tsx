import type {
  FrameDiagnosticsSnapshot,
  PerformanceTier,
  RenderDiagnosticsSnapshot,
} from './usePerformanceDiagnostics';

interface PerformanceOverlayProps {
  visible: boolean;
  onToggle?: () => void;
  frame: FrameDiagnosticsSnapshot;
  render: RenderDiagnosticsSnapshot;
  tier: PerformanceTier;
  entityCounts: {
    agents: number;
    folders: number;
    browsers: number;
    terminals: number;
  };
}

const formatNumber = (value: number, fractionDigits = 1): string => value.toFixed(fractionDigits);

export default function PerformanceOverlay({
  visible,
  onToggle,
  frame,
  render,
  tier,
  entityCounts,
}: PerformanceOverlayProps) {
  if (!visible) return null;

  return (
    <aside
      className="workspace-performance-overlay"
      aria-live="polite"
      data-testid="workspace-performance-overlay"
    >
      <header className="workspace-performance-title">
        <span>Performance</span>
        <div className="workspace-performance-header-actions">
          <span className={`workspace-performance-tier tier-${tier}`}>
            {tier === 'reduced' ? 'reduced fx' : 'normal fx'}
          </span>
          {onToggle && (
            <button
              type="button"
              className="workspace-performance-close"
              onClick={onToggle}
              title="Hide performance overlay"
            >
              Hide
            </button>
          )}
        </div>
      </header>

      <div className="workspace-performance-grid">
        <div className="workspace-performance-row">
          <span>FPS</span>
          <strong>{formatNumber(frame.fps, 0)}</strong>
        </div>
        <div className="workspace-performance-row">
          <span>Frame avg</span>
          <strong>{formatNumber(frame.avgFrameMs)} ms</strong>
        </div>
        <div className="workspace-performance-row">
          <span>Frame p95</span>
          <strong>{formatNumber(frame.p95FrameMs)} ms</strong>
        </div>
        <div className="workspace-performance-row">
          <span>Long frames</span>
          <strong>{formatNumber(frame.longFramePct, 0)}%</strong>
        </div>
        <div className="workspace-performance-row">
          <span>Stutters</span>
          <strong>{frame.stutterFrameCount}</strong>
        </div>
        <div className="workspace-performance-row">
          <span>Scene commits</span>
          <strong>{render.commitCount}</strong>
        </div>
        <div className="workspace-performance-row">
          <span>Commits/s</span>
          <strong>{formatNumber(render.commitsPerSec)}</strong>
        </div>
        <div className="workspace-performance-row">
          <span>Commit avg</span>
          <strong>{formatNumber(render.avgCommitMs)} ms</strong>
        </div>
        <div className="workspace-performance-row">
          <span>Commit max</span>
          <strong>{formatNumber(render.maxCommitMs)} ms</strong>
        </div>
        <div className="workspace-performance-row">
          <span>Entities</span>
          <strong>
            {entityCounts.agents + entityCounts.folders + entityCounts.browsers + entityCounts.terminals}
          </strong>
        </div>
      </div>

      <footer className="workspace-performance-footnote">Toggle: F3</footer>
    </aside>
  );
}
