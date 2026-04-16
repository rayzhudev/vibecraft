import { useEffect } from 'react';
import type { Workspace } from '../../shared/types';
import WorkspaceCanvas from './workspace/WorkspaceCanvas';
import WorkspaceDialogs from './workspace/WorkspaceDialogs';
import { useWorkspaceController } from './workspace/useWorkspaceController';
import HeroSelectionOverlay from './workspace/HeroSelectionOverlay';
import { useAgentCompletionSignals } from '../hooks/useAgentCompletionSignals';
import TutorialOverlay from '../components/TutorialOverlay';
import TutorialSpotlight from '../components/TutorialSpotlight';
import { getTutorialSpotlightPolicy } from '../tutorial/policy';

interface WorkspaceViewProps {
  workspace: Workspace;
  onBack: () => void;
}

export default function WorkspaceView({ workspace, onBack }: WorkspaceViewProps) {
  const controller = useWorkspaceController({ workspace, onBack });
  const { tutorialState, advanceHeroIntro, advanceFocusDemoStep } = controller;
  const spotlightPolicy = getTutorialSpotlightPolicy(tutorialState, {
    heroProvider: controller.hero.provider,
    renameState: controller.renameState,
  });
  useAgentCompletionSignals(controller.agents);
  useEffect(() => {
    window.electronAPI.setWorkspaceNotificationsEnabled(true);
    return () => {
      window.electronAPI.setWorkspaceNotificationsEnabled(false);
    };
  }, []);

  useEffect(() => {
    if (tutorialState.stepId !== 'hero-intro') return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      advanceHeroIntro();
    };
    const handlePointer = () => {
      advanceHeroIntro();
    };
    window.addEventListener('keydown', handleKey);
    window.addEventListener('pointerdown', handlePointer);
    return () => {
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('pointerdown', handlePointer);
    };
  }, [advanceHeroIntro, tutorialState.stepId]);

  useEffect(() => {
    if (tutorialState.stepId !== 'focus-demo-1' && tutorialState.stepId !== 'focus-explain') return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      advanceFocusDemoStep();
    };
    const handlePointer = () => {
      advanceFocusDemoStep();
    };
    window.addEventListener('keydown', handleKey);
    window.addEventListener('pointerdown', handlePointer);
    return () => {
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('pointerdown', handlePointer);
    };
  }, [advanceFocusDemoStep, tutorialState.stepId]);

  useEffect(() => {
    if (window.electronAPI.isTestMode) {
      return;
    }
    const profileEnabled = window.electronAPI.isProfileMode;
    const now = () => (typeof performance === 'undefined' ? Date.now() : performance.now());
    const logProfile = (label: string, elapsedMs: number, extra?: Record<string, unknown>) => {
      if (!profileEnabled) return;
      console.info('[profile:mcp]', label, {
        workspacePath: workspace.path,
        elapsedMs: Math.round(elapsedMs),
        ...extra,
      });
    };
    let active = true;

    const startServer = async () => {
      const startedAt = now();
      try {
        const result = await window.electronAPI.startMcpServer(workspace.path);
        if (!active) return;
        if (!result.success) {
          console.error('Failed to start MCP server', result.error);
          logProfile('start', now() - startedAt, { success: false, error: result.error });
          return;
        }
        logProfile('start', now() - startedAt, { success: true });
      } catch (error) {
        if (!active) return;
        console.error('Error starting MCP server', error);
        logProfile('start', now() - startedAt, { success: false });
      }
    };

    void startServer();

    return () => {
      active = false;
      void (async () => {
        const startedAt = now();
        try {
          await window.electronAPI.stopMcpServer(workspace.path);
          logProfile('stop', now() - startedAt, { success: true });
        } catch (error) {
          console.error('Error stopping MCP server', error);
          logProfile('stop', now() - startedAt, { success: false });
        }
      })();
    };
  }, [workspace.path]);

  return (
    <div className="workspace-view">
      <TutorialSpotlight
        active={spotlightPolicy.active}
        targetSelector={spotlightPolicy.targetSelector}
        outlineSelector={spotlightPolicy.outlineSelector}
        outlineEnabled={spotlightPolicy.outlineEnabled}
        maskEnabled={spotlightPolicy.maskEnabled}
        combineTargets={spotlightPolicy.combineTargets}
      />
      <WorkspaceCanvas controller={controller} />
      <WorkspaceDialogs
        inputDialog={controller.inputDialog}
        messageDialog={controller.messageDialog}
        folderSelectDialog={controller.folderSelectDialog}
        folders={controller.folders}
        onInputClose={controller.closeInputDialog}
        onMessageClose={controller.closeMessageDialog}
      />
      <TutorialOverlay
        tutorialState={controller.tutorialState}
        dismissedStepId={controller.dismissedTutorialOverlayStepId}
        onSkip={controller.skipTutorial}
      />
      <HeroSelectionOverlay
        workspacePath={workspace.path}
        onConfirmProvider={controller.handleSetHeroProvider}
      />
    </div>
  );
}
