import { SETTINGS_NAV, type SettingsSection } from './settingsNav';

interface SettingsSidebarProps {
  activeSection: SettingsSection;
  onSelectSection: (section: SettingsSection) => void;
}

const SidebarIcon = ({ icon }: { icon: string }) => {
  switch (icon) {
    case 'folder':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      );
    case 'sound':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        </svg>
      );
    case 'theme':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="13.5" cy="6.5" r="2.5" />
          <circle cx="19" cy="11.5" r="2.5" />
          <circle cx="6" cy="12.5" r="2.5" />
          <circle cx="17" cy="18.5" r="2.5" />
          <circle cx="9" cy="18.5" r="2.5" />
          <path d="M12 2a10 10 0 0 0-6.88 17.23A5 5 0 0 1 9 15.5H15a5 5 0 0 1 3.88 3.73A10 10 0 0 0 12 2z" />
        </svg>
      );
    case 'billing':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
          <line x1="1" y1="10" x2="23" y2="10" />
        </svg>
      );
    default:
      return null;
  }
};

export default function SettingsSidebar({ activeSection, onSelectSection }: SettingsSidebarProps) {
  const categories = [
    { key: 'workspace' as const, label: 'Workspace' },
    { key: 'customization' as const, label: 'Customization' },
    { key: 'account' as const, label: 'Account' },
  ];

  return (
    <nav className="settings-sidebar">
      {categories.map((category) => {
        const items = SETTINGS_NAV.filter((item) => item.category === category.key);
        if (items.length === 0) return null;
        return (
          <div key={category.key} className="settings-sidebar-category">
            <span className="settings-sidebar-category-label">{category.label}</span>
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`settings-sidebar-item${activeSection === item.id ? ' active' : ''}${item.comingSoon ? ' coming-soon' : ''}`}
                onClick={() => {
                  if (!item.comingSoon) {
                    onSelectSection(item.id);
                  }
                }}
                disabled={item.comingSoon}
              >
                <span className="settings-sidebar-item-icon">
                  <SidebarIcon icon={item.icon} />
                </span>
                <span className="settings-sidebar-item-label">{item.label}</span>
                {item.comingSoon && <span className="settings-sidebar-coming-soon">Soon</span>}
              </button>
            ))}
          </div>
        );
      })}
    </nav>
  );
}
