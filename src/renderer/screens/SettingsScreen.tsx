import { useState } from 'react';
import type { LicenseCheckoutPlan, LicenseStatus } from '../../shared/types';
import SettingsSidebar from './settings/SettingsSidebar';
import SoundPackSection from './settings/SoundPackSection';
import BillingSection from './settings/BillingSection';
import ThemeSection from './settings/ThemeSection';
import ProjectsSection from './settings/ProjectsSection';
import type { SettingsSection } from './settings/settingsNav';

interface SettingsScreenProps {
  license: LicenseStatus | null;
  priorImportAvailable: boolean;
  priorSettingsDetected: boolean;
  priorImportPending: boolean;
  priorImportError: string | null;
  onImportPriorProjects: () => void | Promise<boolean>;
  onStartCheckout: (plan: LicenseCheckoutPlan) => Promise<{ success: boolean; error?: string }>;
  onManageBilling: () => Promise<{ success: boolean; error?: string; url?: string }>;
  onStartPairing: () => Promise<{ success: boolean; code?: string; expiresAt?: string; error?: string }>;
  onClaimPairing: (code: string) => Promise<{ success: boolean; error?: string }>;
  onRefreshLicense: () => Promise<void>;
}

export default function SettingsScreen({
  license,
  priorImportAvailable,
  priorSettingsDetected,
  priorImportPending,
  priorImportError,
  onImportPriorProjects,
  onStartCheckout,
  onManageBilling,
  onStartPairing,
  onClaimPairing,
  onRefreshLicense,
}: SettingsScreenProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>('sound-pack');

  return (
    <div className="settings-screen">
      <div className="settings-layout">
        <SettingsSidebar activeSection={activeSection} onSelectSection={setActiveSection} />

        <div className="settings-content-panel">
          <div className="settings-content-scroll">
            {activeSection === 'projects' && (
              <ProjectsSection
                priorImportAvailable={priorImportAvailable}
                priorSettingsDetected={priorSettingsDetected}
                priorImportPending={priorImportPending}
                priorImportError={priorImportError}
                onImportPriorProjects={onImportPriorProjects}
              />
            )}
            {activeSection === 'sound-pack' && <SoundPackSection />}
            {activeSection === 'theme' && <ThemeSection />}
            {activeSection === 'billing' && (
              <BillingSection
                license={license}
                onStartCheckout={onStartCheckout}
                onManageBilling={onManageBilling}
                onStartPairing={onStartPairing}
                onClaimPairing={onClaimPairing}
                onRefreshLicense={onRefreshLicense}
              />
            )}
          </div>

          <div className="settings-footer">
            <span className="settings-version">VibeCraft {import.meta.env.VITE_APP_VERSION}</span>
            <a href="mailto:ray@vibecraft.build" className="settings-support-link">
              Contact Support ray@vibecraft.build
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
