export const SETTINGS_SECTIONS = ['projects', 'agents', 'sound-pack', 'theme', 'billing', 'maitrix-link'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export interface SettingsSectionConfig {
  id: SettingsSection;
  label: string;
  category: 'customization' | 'account' | 'workspace';
  icon: 'sound' | 'theme' | 'billing' | 'folder' | 'hero' | 'link';
  comingSoon?: boolean;
}

export const SETTINGS_NAV: SettingsSectionConfig[] = [
  { id: 'projects', label: 'Projects', category: 'workspace', icon: 'folder' },
  { id: 'agents', label: 'Agents', category: 'workspace', icon: 'hero' },
  { id: 'maitrix-link', label: 'Maitrix Link', category: 'workspace', icon: 'link' },
  { id: 'sound-pack', label: 'Sound Pack', category: 'customization', icon: 'sound' },
  { id: 'theme', label: 'Theme', category: 'customization', icon: 'theme', comingSoon: true },
  { id: 'billing', label: 'Subscription', category: 'account', icon: 'billing' },
];
