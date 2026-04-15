import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import HomeScreen from './screens/HomeScreen';
import CustomTitlebar from './components/CustomTitlebar';
import TrialBanner from './components/TrialBanner';
import type { LicenseCheckoutPlan, Workspace } from '../shared/types';
import { ThemeProvider } from './theme/ThemeProvider';
import {
  loadAppSettings,
  refreshAppSettings,
  updateTutorialState,
  useAppSettings,
} from './state/appSettingsStore';
import {
  DEFAULT_TUTORIAL_STATE,
  TUTORIAL_WORLD_ID,
  getTutorialProgress,
  isTutorialActive,
} from './tutorial/constants';
import {
  applyLicenseUpdate,
  initializeLicense,
  pollLicenseStatus,
  refreshLicenseStatus,
  setLicenseError,
  setPendingActivationVia,
  useLicenseState,
} from './state/licenseStore';
import {
  initRendererAnalytics,
  updateRendererAnalyticsContext,
  shutdownRendererAnalytics,
} from './utils/analytics';

type Screen = 'home' | 'world-selection' | 'workspace' | 'settings';

const createFreshTutorialState = () => ({
  ...DEFAULT_TUTORIAL_STATE,
  status: 'in_progress' as const,
  stepId: 'world-select' as const,
  workspaceId: undefined,
  workspacePath: undefined,
  createdIds: undefined,
  promptRunId: undefined,
  promptRunId2: undefined,
  promptCompletedAt: undefined,
  promptCompletedAt2: undefined,
  updatedAt: Date.now(),
  version: 1 as const,
});

const createInactiveTutorialState = () => ({
  ...DEFAULT_TUTORIAL_STATE,
  status: 'not_started' as const,
  stepId: 'world-select' as const,
  workspaceId: undefined,
  workspacePath: undefined,
  createdIds: undefined,
  promptRunId: undefined,
  promptRunId2: undefined,
  promptCompletedAt: undefined,
  promptCompletedAt2: undefined,
  updatedAt: Date.now(),
  version: 1 as const,
});

const LicenseGateOverlay = lazy(() => import('./components/LicenseGateOverlay'));
const WorldSelection = lazy(() => import('./screens/WorldSelection'));
const WorkspaceView = lazy(() => import('./screens/WorkspaceView'));
const SettingsScreen = lazy(() => import('./screens/SettingsScreen'));
const TutorialCompletionOverlay = lazy(() => import('./components/TutorialCompletionOverlay'));
const SubscribeOverlay = lazy(() => import('./components/SubscribeOverlay'));
const SubscriptionSuccessOverlay = lazy(() => import('./components/SubscriptionSuccessOverlay'));

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [currentWorkspace, setCurrentWorkspace] = useState<Workspace | null>(null);
  const [subscribeOverlayVisible, setSubscribeOverlayVisible] = useState(false);
  const [tutorialCompleteVisible, setTutorialCompleteVisible] = useState(false);
  const [tourOptInDismissed, setTourOptInDismissed] = useState(false);
  const [priorSettingsPath, setPriorSettingsPath] = useState<string | null>(null);
  const [priorImportPending, setPriorImportPending] = useState(false);
  const [priorImportError, setPriorImportError] = useState<string | null>(null);
  const [subscriptionSuccessVisible, setSubscriptionSuccessVisible] = useState(false);
  const [showTutorialCompleteKicker, setShowTutorialCompleteKicker] = useState(true);
  const tutorialCompleteDismissedRef = useRef(false);
  const previousLicenseReasonRef = useRef<string | undefined>(undefined);
  const initialScreenRef = useRef<Screen>(screen);

  const licenseState = useLicenseState();
  const licenseCheckEnabled = window.electronAPI.isLicenseCheckEnabled;
  const appSettings = useAppSettings();
  const tutorialState = appSettings.settings.tutorial ?? DEFAULT_TUTORIAL_STATE;
  const tutorialEnabled = isTutorialActive(tutorialState);
  const tutorialProgress = getTutorialProgress(tutorialState);
  const priorImportCompleted = Boolean(appSettings.settings.priorImportCompletedAt);
  const shouldOfferPriorImport = Boolean(priorSettingsPath) && !priorImportCompleted;

  // Derive license state early so it can be used in effects
  const license = licenseState.license;
  const licenseReady = licenseState.status === 'ready';
  const licenseActive = license?.active ?? false;
  const isSubscription = license?.reason === 'subscription';
  const isTrial = license?.reason === 'trial';

  useEffect(() => {
    void loadAppSettings();
  }, []);

  // Detect prior production settings (packaged app vs dev have different userData paths)
  useEffect(() => {
    const request = window.electronAPI.checkForPriorSettings?.();
    if (!request) return;
    void request.then((result) => {
      if (result?.found) {
        setPriorSettingsPath(result.settingsPath ?? result.sourceDir ?? null);
      }
    });
  }, []);

  // Initialize renderer analytics
  useEffect(() => {
    initRendererAnalytics({ screen: initialScreenRef.current });
    return () => {
      shutdownRendererAnalytics('unmount');
    };
  }, []);

  // Update analytics context when screen or workspace changes
  useEffect(() => {
    updateRendererAnalyticsContext({
      screen,
      workspaceId: currentWorkspace?.id ?? null,
      workspaceName: currentWorkspace?.name ?? null,
    });
  }, [screen, currentWorkspace?.id, currentWorkspace?.name]);

  useEffect(() => {
    void initializeLicense();
    const unsubscribe = window.electronAPI.onLicenseUpdated((status) => {
      applyLicenseUpdate(status);
    });
    const unsubscribeError = window.electronAPI.onLicenseError(({ error }) => {
      setLicenseError(error);
    });
    return () => {
      unsubscribe();
      unsubscribeError();
    };
  }, []);

  // Show tutorial completion overlay when tutorial is completed (only once per session).
  // Wait for license to be ready so we only prompt trial users.
  useEffect(() => {
    if (tutorialCompleteVisible) return;
    if (
      tutorialState.status === 'completed' &&
      !tutorialCompleteDismissedRef.current &&
      licenseReady &&
      licenseActive &&
      !isSubscription
    ) {
      const firstSeen = !tutorialState.completionPromptSeenAt;
      setShowTutorialCompleteKicker(firstSeen);
      if (firstSeen) {
        updateTutorialState((current) => ({
          ...current,
          completionPromptSeenAt: Date.now(),
          updatedAt: Date.now(),
          version: 1,
        }));
      }
      setTutorialCompleteVisible(true);
    }
  }, [
    tutorialCompleteVisible,
    tutorialState.status,
    tutorialState.completionPromptSeenAt,
    licenseReady,
    licenseActive,
    isSubscription,
  ]);

  // Show subscription success celebration when license changes from non-subscription to subscription
  useEffect(() => {
    const previousReason = previousLicenseReasonRef.current;
    previousLicenseReasonRef.current = license?.reason;

    // Only show celebration if:
    // - License is ready
    // - Current reason is 'subscription'
    // - Previous reason was something else (trial, inactive, etc.) or undefined but we had a license loading
    if (licenseReady && isSubscription && previousReason !== undefined && previousReason !== 'subscription') {
      // Dismiss other overlays (subscription success takes priority)
      setTutorialCompleteVisible(false);
      tutorialCompleteDismissedRef.current = true;
      setSubscribeOverlayVisible(false);
      setSubscriptionSuccessVisible(true);
    }
  }, [licenseReady, isSubscription, license?.reason]);

  const launchTutorial = useCallback(async () => {
    const workspace = await window.electronAPI.resetTutorialWorld();
    setPriorImportError(null);
    setCurrentWorkspace(workspace);
    void window.electronAPI.addRecentWorkspace(workspace);
    updateTutorialState(() => ({
      ...createFreshTutorialState(),
      stepId: 'hero-provider',
      workspaceId: workspace.id,
      workspacePath: workspace.path,
    }));
    setScreen('workspace');
  }, []);

  const resumeTutorial = useCallback(async () => {
    const recent = await window.electronAPI.getRecentWorkspaces();
    const matched =
      recent.find((workspace) => workspace.id === tutorialState.workspaceId) ??
      recent.find((workspace) => workspace.path === tutorialState.workspacePath);
    const fallback = matched ?? (await window.electronAPI.getTutorialWorld());
    setPriorImportError(null);
    setCurrentWorkspace(fallback);
    void window.electronAPI.addRecentWorkspace(fallback);
    setScreen('workspace');
  }, [tutorialState.workspaceId, tutorialState.workspacePath]);

  const handleSelectWorkspace = useCallback(
    (workspace: Workspace) => {
      if (workspace.id === TUTORIAL_WORLD_ID) {
        if (tutorialState.status === 'in_progress' && tutorialState.stepId !== 'world-select') {
          void resumeTutorial();
        } else {
          void launchTutorial();
        }
        return;
      }
      setCurrentWorkspace(workspace);
      void window.electronAPI.addRecentWorkspace(workspace);
      if (tutorialEnabled) {
        updateTutorialState(() => ({
          ...createFreshTutorialState(),
          stepId: 'hero-provider',
          workspaceId: workspace.id,
          workspacePath: workspace.path,
        }));
      }
      setScreen('workspace');
    },
    [launchTutorial, resumeTutorial, tutorialEnabled, tutorialState.status, tutorialState.stepId]
  );

  const handleBack = () => {
    if (tutorialEnabled) {
      updateTutorialState(() => createInactiveTutorialState());
      setCurrentWorkspace(null);
      setScreen('home');
      return;
    }
    if (screen === 'workspace') {
      setScreen('world-selection');
      setCurrentWorkspace(null);
    } else if (screen === 'world-selection') {
      setScreen('home');
    } else if (screen === 'settings') {
      setScreen('home');
    }
  };

  const handleStartCheckout = async (plan: LicenseCheckoutPlan) => {
    setPendingActivationVia('checkout');
    const result = await window.electronAPI.licenseStartCheckout(plan);
    if (result.success) {
      const { trackPaywallCheckoutOpened } = await import('./utils/paywallAnalytics');
      trackPaywallCheckoutOpened(plan);
      void pollLicenseStatus();
    }
    return result;
  };

  const handleManageBilling = async () => {
    return window.electronAPI.licenseManageBilling();
  };

  const handleRefreshLicense = useCallback(() => {
    return refreshLicenseStatus({ setLoading: false, surfaceErrors: false });
  }, []);

  const handleClaimPairing = async (code: string) => {
    setPendingActivationVia('pairing');
    return window.electronAPI.licensePairingClaim(code);
  };

  const handleOpenSettings = () => {
    setScreen('settings');
  };

  const handleImportPriorProjects = useCallback(async (): Promise<boolean> => {
    setPriorImportPending(true);
    setPriorImportError(null);
    try {
      const result = await window.electronAPI.backupAndImportSettings?.();
      if (!result?.success) {
        setPriorImportError(result?.error ?? 'Failed to import prior projects.');
        return false;
      }
      await refreshAppSettings();
      setCurrentWorkspace(null);
      return true;
    } catch (error) {
      setPriorImportError(error instanceof Error ? error.message : 'Failed to import prior projects.');
      return false;
    } finally {
      setPriorImportPending(false);
    }
  }, []);

  const showBackButton =
    screen === 'settings' || (screen !== 'home' && (!tutorialEnabled || screen === 'workspace'));
  const backButtonTitle = tutorialEnabled ? 'Exit Tutorial' : 'Back to World Selection';

  // Show license gate in workspace only after we know the device is inactive.
  const showLicenseGate = licenseCheckEnabled && screen === 'workspace' && licenseReady && !licenseActive;
  const licenseGateFallback = (
    <div className="license-gate-overlay" role="presentation" aria-hidden="true">
      <div className="license-gate-loading">
        <p>Checking license status...</p>
      </div>
    </div>
  );

  // Show trial banner when on trial (only after tutorial is completed)
  const tutorialComplete = tutorialState.status === 'completed';
  const showTrialBanner =
    licenseCheckEnabled &&
    licenseReady &&
    licenseActive &&
    isTrial &&
    tutorialComplete &&
    !tutorialCompleteVisible;

  return (
    <ThemeProvider initialTheme="default">
      <div className="app" data-settings-status={appSettings.status}>
        <CustomTitlebar
          showBackButton={showBackButton}
          onBack={handleBack}
          backButtonTitle={backButtonTitle}
        />

        {showTrialBanner && license?.trialEndsAt && (
          <TrialBanner
            trialEndsAt={license.trialEndsAt}
            onSubscribe={() => setSubscribeOverlayVisible(true)}
          />
        )}

        {screen === 'home' && (
          <HomeScreen
            onOpenWorldSelector={() => {
              setScreen('world-selection');
            }}
            onOpenTutorial={() => {
              if (tutorialState.status === 'in_progress' && tutorialState.stepId !== 'world-select') {
                void resumeTutorial();
                return;
              }
              void launchTutorial();
            }}
            onResumeTutorial={
              tutorialState.status === 'in_progress' && tutorialState.stepId !== 'world-select'
                ? () => {
                    void resumeTutorial();
                  }
                : undefined
            }
            onRestartTutorial={() => {
              void launchTutorial();
            }}
            tutorialProgress={tutorialProgress}
            onOpenSettings={handleOpenSettings}
            showTourOptIn={tutorialComplete && !tourOptInDismissed}
            onTourOptInContinue={() => {
              setTourOptInDismissed(true);
              setScreen('world-selection');
            }}
            onTourOptInRestart={() => {
              setTourOptInDismissed(true);
              void launchTutorial();
            }}
          />
        )}

        {screen === 'world-selection' && (
          <Suspense fallback={null}>
            <WorldSelection
              onSelect={handleSelectWorkspace}
              onBack={handleBack}
              tutorialState={tutorialState}
            />
          </Suspense>
        )}

        {screen === 'workspace' && currentWorkspace && (
          <Suspense fallback={null}>
            <WorkspaceView workspace={currentWorkspace} onBack={handleBack} />
          </Suspense>
        )}

        {screen === 'settings' && (
          <Suspense fallback={null}>
            <SettingsScreen
              license={license}
              priorImportAvailable={!priorImportCompleted}
              priorSettingsDetected={shouldOfferPriorImport}
              priorImportPending={priorImportPending}
              priorImportError={priorImportError}
              onImportPriorProjects={handleImportPriorProjects}
              onStartCheckout={handleStartCheckout}
              onManageBilling={handleManageBilling}
              onStartPairing={() => window.electronAPI.licensePairingStart()}
              onClaimPairing={handleClaimPairing}
              onRefreshLicense={handleRefreshLicense}
            />
          </Suspense>
        )}
      </div>

      {/* Subscribe overlay (from trial banner) */}
      {subscribeOverlayVisible && (
        <Suspense fallback={null}>
          <SubscribeOverlay
            visible={subscribeOverlayVisible}
            onDismiss={() => setSubscribeOverlayVisible(false)}
            onStartCheckout={handleStartCheckout}
          />
        </Suspense>
      )}

      {/* Tutorial completion overlay - only show if license is active (not expired) */}
      {tutorialCompleteVisible && licenseCheckEnabled && licenseActive && !isSubscription && (
        <Suspense fallback={null}>
          <TutorialCompletionOverlay
            visible={tutorialCompleteVisible}
            showKicker={showTutorialCompleteKicker}
            onDismiss={() => {
              tutorialCompleteDismissedRef.current = true;
              setTutorialCompleteVisible(false);
            }}
            onStartCheckout={handleStartCheckout}
          />
        </Suspense>
      )}

      {/* License gate (expired trial) */}
      {showLicenseGate && (
        <Suspense fallback={licenseGateFallback}>
          <LicenseGateOverlay
            open={showLicenseGate}
            license={license}
            loadError={licenseState.error}
            tutorialCompleted={tutorialComplete}
            onStartCheckout={handleStartCheckout}
            onClaimPairing={handleClaimPairing}
            onRetry={() => void initializeLicense()}
          />
        </Suspense>
      )}

      {/* Subscription success celebration */}
      {subscriptionSuccessVisible && (
        <Suspense fallback={null}>
          <SubscriptionSuccessOverlay
            visible={subscriptionSuccessVisible}
            onDismiss={() => setSubscriptionSuccessVisible(false)}
          />
        </Suspense>
      )}
    </ThemeProvider>
  );
}
