import { useCallback, useEffect, useMemo, useState } from 'react';
import HeroSelectionModal from '../../components/HeroSelectionModal';
import type { AgentProvider, ProviderRegistrySnapshot, ProviderStatus } from '../../../shared/types';
import { workspaceClient } from '../../services/workspaceClient';
import { refreshAppSettings, updateTutorialState, useAppSettings } from '../../state/appSettingsStore';
import { DEFAULT_TUTORIAL_STATE, isTutorialActive } from '../../tutorial/constants';

type ProviderActionResult = { ok: boolean; status?: ProviderStatus | null; error?: string };

interface HeroSelectionOverlayProps {
  workspacePath: string;
  onConfirmProvider: (provider: AgentProvider) => Promise<ProviderActionResult>;
}

const emptySnapshot: ProviderRegistrySnapshot = {
  providers: [],
  providerStatus: {},
  recentModels: {},
  recentModelInfo: {},
  loading: true,
  updatedAt: null,
};

export default function HeroSelectionOverlay({
  workspacePath,
  onConfirmProvider,
}: HeroSelectionOverlayProps) {
  const [providerSnapshot, setProviderSnapshot] = useState<ProviderRegistrySnapshot>(emptySnapshot);
  const appSettings = useAppSettings();
  const tutorialState = appSettings.settings.tutorial ?? DEFAULT_TUTORIAL_STATE;
  const tutorialEnabled = isTutorialActive(tutorialState);
  const forceTutorialSelection = tutorialEnabled && tutorialState.stepId === 'hero-provider';
  const heroProviderConfigured = useMemo(() => {
    if (forceTutorialSelection) return false;
    return Boolean(appSettings.settings.heroProvider);
  }, [appSettings.settings.heroProvider, forceTutorialSelection]);

  const updateProviderStatusInSnapshot = useCallback(
    (providerId: AgentProvider, status: ProviderStatus | null) => {
      if (!status) return;
      setProviderSnapshot((prev) => ({
        ...prev,
        providerStatus: {
          ...prev.providerStatus,
          [providerId]: status,
        },
        updatedAt: Date.now(),
      }));
    },
    []
  );

  useEffect(() => {
    let isActive = true;

    const loadSnapshot = async () => {
      const snapshot = await workspaceClient.agentConnectBootstrap();
      if (isActive) {
        setProviderSnapshot(snapshot);
      }
    };

    void loadSnapshot();

    const unsubscribe = window.electronAPI.onAgentConnectProvidersUpdated((snapshot) => {
      setProviderSnapshot(snapshot);
    });

    return () => {
      isActive = false;
      unsubscribe();
    };
  }, [workspacePath]);

  const handleProviderStatus = useCallback(
    async (provider: AgentProvider, options?: { force?: boolean }): Promise<ProviderActionResult> => {
      try {
        const status = await workspaceClient.agentConnectProviderStatus(provider, options);
        updateProviderStatusInSnapshot(provider, status);
        return { ok: true, status };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load provider status';
        return { ok: false, error: message };
      }
    },
    [updateProviderStatusInSnapshot]
  );

  const handleProviderInstall = useCallback(
    async (provider: AgentProvider): Promise<ProviderActionResult> => {
      try {
        setProviderSnapshot((prev) => ({
          ...prev,
          providerStatus: {
            ...prev.providerStatus,
            [provider]: {
              providerId: provider,
              state: 'installing',
              installed: prev.providerStatus[provider]?.installed ?? false,
              message: prev.providerStatus[provider]?.message,
            },
          },
          updatedAt: Date.now(),
        }));
        const status = await workspaceClient.agentConnectProviderInstall(provider);
        updateProviderStatusInSnapshot(provider, status);
        return { ok: true, status };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to install provider';
        setProviderSnapshot((prev) => ({
          ...prev,
          providerStatus: {
            ...prev.providerStatus,
            [provider]: {
              providerId: provider,
              state: 'error',
              installed: false,
              message,
            },
          },
          updatedAt: Date.now(),
        }));
        return { ok: false, error: message };
      }
    },
    [updateProviderStatusInSnapshot]
  );

  const handleProviderLogin = useCallback(
    async (provider: AgentProvider): Promise<ProviderActionResult> => {
      try {
        await workspaceClient.agentConnectProviderLogin(provider);
        const status = await workspaceClient.agentConnectProviderStatus(provider, { force: true });
        updateProviderStatusInSnapshot(provider, status);
        return { ok: true, status };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to login';
        return { ok: false, error: message };
      }
    },
    [updateProviderStatusInSnapshot]
  );

  const handleConfirmProvider = useCallback(
    async (provider: AgentProvider): Promise<ProviderActionResult> => {
      const result = await onConfirmProvider(provider);
      if (result.ok) {
        await refreshAppSettings({ applyDevOverrides: false });
        if (tutorialEnabled && tutorialState.stepId === 'hero-provider') {
          updateTutorialState((current) => ({
            ...current,
            stepId: 'hero-intro',
            status: 'in_progress',
            version: 1,
            updatedAt: Date.now(),
          }));
        }
      }
      return result;
    },
    [onConfirmProvider, tutorialEnabled, tutorialState.stepId]
  );

  const shouldShowModal =
    appSettings.status === 'loaded' &&
    !heroProviderConfigured &&
    (!tutorialEnabled || tutorialState.stepId === 'hero-provider');

  return (
    <HeroSelectionModal
      open={shouldShowModal}
      providerSnapshot={providerSnapshot}
      onConfirmProvider={handleConfirmProvider}
      onInstallProvider={handleProviderInstall}
      onLoginProvider={handleProviderLogin}
      onRefreshProviderStatus={handleProviderStatus}
    />
  );
}
