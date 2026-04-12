interface CustomTitlebarProps {
  showBackButton?: boolean;
  onBack?: () => void;
  backButtonTitle?: string;
}

export default function CustomTitlebar({ showBackButton, onBack, backButtonTitle }: CustomTitlebarProps) {
  return (
    <div className="custom-titlebar">
      <div className="titlebar-traffic-light-spacer" />
      <div className="titlebar-content">
        {showBackButton && onBack && (
          <button
            className="titlebar-home-btn"
            onClick={onBack}
            title={backButtonTitle ?? 'Back to World Selection'}
            aria-label={backButtonTitle ?? 'Back to World Selection'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </button>
        )}
        <span className="titlebar-brand">VibeCraft</span>
      </div>
      <div className="titlebar-drag-region" />
    </div>
  );
}
