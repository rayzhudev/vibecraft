import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Agent,
  AgentProvider,
  BrowserPanel,
  Folder,
  Hero,
  Position,
  SelectedEntityRef,
  TutorialScenario,
  TutorialStep,
  TutorialState,
  Workspace,
} from '../../shared/types';
import { workspaceClient } from '../services/workspaceClient';
import type { CommandRunResult } from '../commands/registry';
import type { DialogMessage } from '../screens/workspace/types';
import { DEFAULT_BROWSER_SIZE, DEFAULT_BROWSER_URL } from '../../shared/browserDefaults';
import * as WORKSPACE_CONSTANTS from '../screens/workspace/constants';
import {
  DEFAULT_TUTORIAL_STATE,
  TUTORIAL_PROMPT_1,
  TUTORIAL_PROMPT_2,
  TUTORIAL_BROWSER_URL_1,
  TUTORIAL_BROWSER_URL_2,
  TUTORIAL_STEPS,
  isTutorialActive,
} from './constants';
import { updateTutorialState, setAbilityVariantSelection } from '../state/appSettingsStore';
import type { TutorialMoveZone } from './types';
import {
  trackTutorialStarted,
  trackTutorialStepCompleted,
  trackTutorialCompleted,
  trackTutorialAbandoned,
} from '../utils/tutorialAnalytics';
import { startTutorialSessionReplay, stopTutorialSessionReplay } from '../utils/posthogScreenRecorder';

type DragEndData = { pos: Position; dragDistance: number };

type UseWorkspaceTutorialCoreOptions = {
  workspace: Workspace;
  settings: { tutorial?: TutorialState; heroProvider?: AgentProvider };
  hero: Hero;
  agents: Agent[];
  folders: Folder[];
  browsers: BrowserPanel[];
  selectedEntityRef: SelectedEntityRef | null;
  selectedAgentIds: string[];
  activeAgentTerminalId: string | null;
  setSelectedEntityRef: React.Dispatch<React.SetStateAction<SelectedEntityRef | null>>;
  setSelectedAgentIds: React.Dispatch<React.SetStateAction<string[]>>;
  setActiveAgentTerminalId: (id: string | null) => void;
  setBrowsers: React.Dispatch<React.SetStateAction<BrowserPanel[]>>;
  setMessageDialog: (message: DialogMessage | null) => void;
  bringBrowserToFront: (id: string) => void;
  beginRename: (folder?: Folder, options?: { openDropdown?: boolean }) => void;
  submitRename: (value: string) => Promise<CommandRunResult>;
  handleRenameCancel: () => void;
  handleRenamePickOption: (relativePath: string) => Promise<void>;
  createFolder: (name: string, x: number, y: number) => Promise<CommandRunResult>;
  handleBrowserUrlChange: (id: string, url: string) => Promise<CommandRunResult>;
  handleBrowserClose: (id: string) => Promise<CommandRunResult>;
  handleBrowserMove: (id: string, x: number, y: number) => Promise<CommandRunResult>;
  handleBrowserMoveEnd: (id: string, x: number, y: number) => Promise<CommandRunResult>;
  handleBrowserResize: (id: string, width: number, height: number) => Promise<CommandRunResult>;
  handleBrowserResizeEnd: (id: string, width: number, height: number) => Promise<CommandRunResult>;
  handleTerminalMove: (terminalId: string, x: number, y: number) => Promise<CommandRunResult>;
  handleTerminalMoveEnd: (terminalId: string, x: number, y: number) => Promise<CommandRunResult>;
  handleTerminalResize: (terminalId: string, width: number, height: number) => Promise<CommandRunResult>;
  handleTerminalResizeEnd: (terminalId: string, width: number, height: number) => Promise<CommandRunResult>;
  handleCanvasRightClick: (position: { x: number; y: number }, target: SelectedEntityRef | null) => void;
  handleHeroMove: (x: number, y: number) => Promise<CommandRunResult>;
  handleAgentMove: (id: string, x: number, y: number) => CommandRunResult;
  handleAgentDragStart: (id: string) => void;
  handleAgentDragEnd: (id: string, data?: DragEndData) => void;
};

export type WorkspaceTutorialCore = {
  tutorialState: TutorialState;
  tutorialEnabled: boolean;
  tutorialMoveZone: TutorialMoveZone | null;
  tutorialMoveBounds: TutorialMoveZone | null;
  tutorialCompletionVisible: boolean;
  dismissedTutorialOverlayStepId: string | null;
  dismissTutorialCompletion: () => void;
  advanceHeroIntro: () => void;
  advanceFocusDemoStep: () => void;
  completeFocusDemo: () => void;
  updateTutorial: (updates: Partial<TutorialState>) => void;
  ensureTutorialServer: (scenario: TutorialScenario) => Promise<boolean>;
  tutorialPromptRunId: string | null;
  tutorialPromptRunId2: string | null;
  setTutorialPromptRunId: (runId: string) => void;
  setTutorialPromptRunId2: (runId: string) => void;
  tutorialPromptComplete: boolean;
  tutorialPromptComplete2: boolean;
  tutorialAgentId?: string;
  tutorialAgentId2?: string;
  tutorialFolderId?: string;
  tutorialFolderId2?: string;
  tutorialBrowserId?: string;
  tutorialBrowserId2?: string;
  canMoveUnits: boolean;
  isSelectionAllowed: (id: string, type: SelectedEntityRef['type']) => boolean;
  beginRename: (folder?: Folder) => void;
  submitRename: (value: string) => Promise<void>;
  handleRenameCancel: () => void;
  handleRenamePickOption: (relativePath: string) => Promise<void>;
  createFolder: (name: string, x: number, y: number) => Promise<CommandRunResult>;
  createBrowser: (x: number, y: number, originFolderId?: string) => Promise<CommandRunResult>;
  handleBrowserUrlChange: (id: string, url: string) => Promise<CommandRunResult>;
  handleBrowserClose: (id: string) => Promise<CommandRunResult>;
  handleBrowserMove: (id: string, x: number, y: number) => Promise<CommandRunResult>;
  handleBrowserMoveEnd: (id: string, x: number, y: number) => Promise<CommandRunResult>;
  handleBrowserResize: (id: string, width: number, height: number) => Promise<CommandRunResult>;
  handleBrowserResizeEnd: (id: string, width: number, height: number) => Promise<CommandRunResult>;
  handleTerminalMove: (terminalId: string, x: number, y: number) => Promise<CommandRunResult>;
  handleTerminalMoveEnd: (terminalId: string, x: number, y: number) => Promise<CommandRunResult>;
  handleTerminalResize: (terminalId: string, width: number, height: number) => Promise<CommandRunResult>;
  handleTerminalResizeEnd: (terminalId: string, width: number, height: number) => Promise<CommandRunResult>;
  handleCanvasRightClick: (position: { x: number; y: number }, target: SelectedEntityRef | null) => void;
  handleHeroMove: (x: number, y: number) => Promise<CommandRunResult>;
  handleAgentMove: (id: string, x: number, y: number) => CommandRunResult;
  handleAgentDragStart: (id: string) => void;
  handleAgentDragEnd: (id: string, data?: DragEndData) => void;
  handleTutorialBrowserMessage: (payload: { panelId: string; url: string; message: string }) => void;
};

const okResult = (): CommandRunResult => ({ ok: true });
const errorResult = (error: string): CommandRunResult => ({ ok: false, error });
const OPEN_TERMINAL_STEP_INDEX = TUTORIAL_STEPS.indexOf('open-terminal');
const OPEN_BROWSER_1_STEP_INDEX = TUTORIAL_STEPS.indexOf('open-browser-1');
const OPEN_BROWSER_2_STEP_INDEX = TUTORIAL_STEPS.indexOf('open-browser-2');

const getStepIndex = (stepId: TutorialStep): number => TUTORIAL_STEPS.indexOf(stepId);

const shouldResumePrompt = (stepId: TutorialStep, isSecondPrompt: boolean, completed: boolean): boolean => {
  const minIndex = isSecondPrompt ? OPEN_BROWSER_1_STEP_INDEX : OPEN_TERMINAL_STEP_INDEX;
  const stepIndex = getStepIndex(stepId);
  return stepIndex !== -1 && stepIndex >= minIndex && !completed;
};

const shouldEnsureServer = (stepId: TutorialStep, isSecondPrompt: boolean, completed: boolean): boolean => {
  const minIndex = isSecondPrompt ? OPEN_BROWSER_1_STEP_INDEX : OPEN_TERMINAL_STEP_INDEX;
  const stepIndex = getStepIndex(stepId);
  return (stepIndex !== -1 && stepIndex >= minIndex) || completed;
};

export const useWorkspaceTutorialCore = ({
  workspace,
  settings,
  hero,
  agents,
  folders,
  browsers,
  selectedEntityRef,
  selectedAgentIds,
  activeAgentTerminalId,
  setSelectedEntityRef,
  setSelectedAgentIds,
  setActiveAgentTerminalId,
  setBrowsers,
  setMessageDialog,
  bringBrowserToFront,
  beginRename,
  submitRename,
  handleRenameCancel,
  handleRenamePickOption,
  createFolder,
  handleBrowserUrlChange: baseHandleBrowserUrlChange,
  handleBrowserClose: baseHandleBrowserClose,
  handleBrowserMove: baseHandleBrowserMove,
  handleBrowserMoveEnd: baseHandleBrowserMoveEnd,
  handleBrowserResize: baseHandleBrowserResize,
  handleBrowserResizeEnd: baseHandleBrowserResizeEnd,
  handleTerminalMove: baseHandleTerminalMove,
  handleTerminalMoveEnd: baseHandleTerminalMoveEnd,
  handleTerminalResize: baseHandleTerminalResize,
  handleTerminalResizeEnd: baseHandleTerminalResizeEnd,
  handleCanvasRightClick: baseHandleCanvasRightClick,
  handleHeroMove: baseHandleHeroMove,
  handleAgentMove: baseHandleAgentMove,
  handleAgentDragStart: baseHandleAgentDragStart,
  handleAgentDragEnd: baseHandleAgentDragEnd,
}: UseWorkspaceTutorialCoreOptions): WorkspaceTutorialCore => {
  const tutorialState = settings.tutorial ?? DEFAULT_TUTORIAL_STATE;
  const tutorialEnabled = isTutorialActive(tutorialState);
  const [tutorialPromptRunId, setTutorialPromptRunIdLocal] = useState<string | null>(
    tutorialState.promptRunId ?? null
  );
  const [tutorialPromptRunId2, setTutorialPromptRunId2Local] = useState<string | null>(
    tutorialState.promptRunId2 ?? null
  );
  const [tutorialPromptComplete, setTutorialPromptComplete] = useState(
    Boolean(tutorialState.promptCompletedAt)
  );
  const [tutorialPromptComplete2, setTutorialPromptComplete2] = useState(
    Boolean(tutorialState.promptCompletedAt2)
  );
  const [pendingBrowserStep, setPendingBrowserStep] = useState<'open-browser-1' | 'open-browser-2' | null>(
    null
  );
  const tutorialStepRef = useRef(tutorialState.stepId);
  const browserAdvanceTimeoutRef = useRef<number | null>(null);
  const tutorialBrowser1SpawnRef = useRef<Position | null>(null);
  const doodleJumpCompletionTimeoutRef = useRef<number | null>(null);
  const doodleJumpCompletionDeadlineRef = useRef<number | null>(null);
  const doodleJumpBrowserIdRef = useRef<string | null>(null);
  const browserSpawnInFlightRef = useRef({ first: false, second: false });
  const tutorialServerPromisesRef = useRef<Partial<Record<TutorialScenario, Promise<boolean>>>>({});
  const tutorialCompletionShownRef = useRef(false);
  const promptRunInFlightRef = useRef({ first: false, second: false });
  const promptResetStepRef = useRef<TutorialStep | null>(null);
  const [tutorialCompletionVisible, setTutorialCompletionVisible] = useState(false);
  const [dismissedTutorialOverlayStepId, setDismissedTutorialOverlayStepId] = useState<string | null>(null);

  const updateTutorial = useCallback(
    (updates: Partial<TutorialState>) => {
      if (!tutorialEnabled) return;
      updateTutorialState((current) => {
        const createdIds = updates.createdIds
          ? { ...(current.createdIds ?? {}), ...updates.createdIds }
          : current.createdIds;
        return {
          ...current,
          ...updates,
          createdIds,
          status: 'in_progress',
          version: 1,
          updatedAt: Date.now(),
        };
      });
    },
    [tutorialEnabled]
  );

  const setTutorialPromptRunId = useCallback(
    (runId: string) => {
      setTutorialPromptRunIdLocal(runId);
      setTutorialPromptComplete(false);
      promptRunInFlightRef.current.first = true;
      updateTutorial({ promptRunId: runId, promptCompletedAt: undefined });
    },
    [updateTutorial]
  );

  const setTutorialPromptRunId2 = useCallback(
    (runId: string) => {
      setTutorialPromptRunId2Local(runId);
      setTutorialPromptComplete2(false);
      promptRunInFlightRef.current.second = true;
      updateTutorial({ promptRunId2: runId, promptCompletedAt2: undefined });
    },
    [updateTutorial]
  );

  const ensureTutorialServer = useCallback(
    (scenario: TutorialScenario): Promise<boolean> => {
      const existing = tutorialServerPromisesRef.current[scenario];
      if (existing) return existing;
      const promise = workspaceClient
        .ensureTutorialDevServer(workspace.path, scenario)
        .then((success: boolean) => {
          const ok = success !== false;
          if (!ok) {
            const port = scenario === 'cookie-clicker' ? 3000 : 3001;
            setMessageDialog({
              title: 'Error',
              message: `Unable to start the tutorial server on port ${port}.`,
              type: 'error',
            });
          }
          return ok;
        })
        .catch((error: unknown) => {
          const port = scenario === 'cookie-clicker' ? 3000 : 3001;
          const detail = error instanceof Error ? error.message : String(error);
          setMessageDialog({
            title: 'Error',
            message: detail
              ? `Unable to start the tutorial server on port ${port}. ${detail}`
              : `Unable to start the tutorial server on port ${port}.`,
            type: 'error',
          });
          return false;
        })
        .finally(() => {
          if (tutorialServerPromisesRef.current[scenario] === promise) {
            delete tutorialServerPromisesRef.current[scenario];
          }
        });
      tutorialServerPromisesRef.current[scenario] = promise;
      return promise;
    },
    [setMessageDialog, workspace.path]
  );

  useEffect(() => {
    tutorialStepRef.current = tutorialState.stepId;
  }, [tutorialState.stepId]);

  useEffect(() => {
    if (tutorialState.promptRunId && tutorialState.promptRunId !== tutorialPromptRunId) {
      setTutorialPromptRunIdLocal(tutorialState.promptRunId);
    }
    if (!tutorialState.promptRunId && tutorialPromptRunId) {
      setTutorialPromptRunIdLocal(null);
    }
  }, [tutorialPromptRunId, tutorialState.promptRunId]);

  useEffect(() => {
    if (tutorialState.promptRunId2 && tutorialState.promptRunId2 !== tutorialPromptRunId2) {
      setTutorialPromptRunId2Local(tutorialState.promptRunId2);
    }
    if (!tutorialState.promptRunId2 && tutorialPromptRunId2) {
      setTutorialPromptRunId2Local(null);
    }
  }, [tutorialPromptRunId2, tutorialState.promptRunId2]);

  useEffect(() => {
    const completed = Boolean(tutorialState.promptCompletedAt);
    if (tutorialPromptComplete !== completed) {
      setTutorialPromptComplete(completed);
    }
  }, [tutorialPromptComplete, tutorialState.promptCompletedAt]);

  useEffect(() => {
    const completed = Boolean(tutorialState.promptCompletedAt2);
    if (tutorialPromptComplete2 !== completed) {
      setTutorialPromptComplete2(completed);
    }
  }, [tutorialPromptComplete2, tutorialState.promptCompletedAt2]);

  // Track tutorial step transitions for analytics
  const prevStepRef = useRef<string | null>(null);
  const prevStatusRef = useRef<string | null>(null);
  useEffect(() => {
    const prevStep = prevStepRef.current;
    const prevStatus = prevStatusRef.current;
    prevStepRef.current = tutorialState.stepId;
    prevStatusRef.current = tutorialState.status;

    // Tutorial just started (status changed to in_progress from not_started)
    if (prevStatus === 'not_started' && tutorialState.status === 'in_progress') {
      trackTutorialStarted(tutorialState.stepId);
      return;
    }

    // Step changed while in progress - previous step was completed
    if (
      tutorialEnabled &&
      prevStep &&
      prevStep !== tutorialState.stepId &&
      tutorialState.status === 'in_progress'
    ) {
      trackTutorialStepCompleted(prevStep as TutorialStep);
    }
  }, [tutorialEnabled, tutorialState.stepId, tutorialState.status]);

  // Track tutorial abandonment on unmount
  useEffect(() => {
    return () => {
      if (tutorialEnabled && tutorialState.status === 'in_progress') {
        trackTutorialAbandoned();
      }
    };
  }, [tutorialEnabled, tutorialState.status]);

  useEffect(() => {
    if (!tutorialEnabled) {
      stopTutorialSessionReplay();
      return;
    }

    if (tutorialState.status === 'in_progress') {
      startTutorialSessionReplay();
      return () => {
        stopTutorialSessionReplay();
      };
    }

    stopTutorialSessionReplay();
  }, [tutorialEnabled, tutorialState.status]);

  useEffect(() => {
    if (!tutorialEnabled) return;
    const previousStep = promptResetStepRef.current;
    const currentStep = tutorialState.stepId;
    promptResetStepRef.current = currentStep;

    if (currentStep === 'send-prompt' && previousStep !== 'send-prompt') {
      if (tutorialState.promptRunId || tutorialState.promptCompletedAt) {
        updateTutorial({ promptRunId: undefined, promptCompletedAt: undefined });
      }
      promptRunInFlightRef.current.first = false;
      setTutorialPromptComplete(false);
    }
    if (currentStep === 'send-prompt-2' && previousStep !== 'send-prompt-2') {
      if (tutorialState.promptRunId2 || tutorialState.promptCompletedAt2) {
        updateTutorial({ promptRunId2: undefined, promptCompletedAt2: undefined });
      }
      promptRunInFlightRef.current.second = false;
      setTutorialPromptComplete2(false);
    }
  }, [
    tutorialEnabled,
    tutorialState.stepId,
    tutorialState.promptRunId,
    tutorialState.promptCompletedAt,
    tutorialState.promptRunId2,
    tutorialState.promptCompletedAt2,
    updateTutorial,
  ]);

  useEffect(() => {
    if (!tutorialEnabled || (!tutorialPromptRunId && !tutorialPromptRunId2)) return;
    const cleanup = window.electronAPI.onAgentConnectEvent((payload) => {
      if (payload.event.type !== 'final') return;
      if (tutorialPromptRunId && payload.runId === tutorialPromptRunId) {
        setTutorialPromptComplete(true);
        promptRunInFlightRef.current.first = false;
        if (!tutorialState.promptCompletedAt) {
          updateTutorial({ promptCompletedAt: Date.now() });
        }
      }
      if (tutorialPromptRunId2 && payload.runId === tutorialPromptRunId2) {
        setTutorialPromptComplete2(true);
        promptRunInFlightRef.current.second = false;
        if (!tutorialState.promptCompletedAt2) {
          updateTutorial({ promptCompletedAt2: Date.now() });
        }
      }
    });
    return () => cleanup();
  }, [
    tutorialEnabled,
    tutorialPromptRunId,
    tutorialPromptRunId2,
    tutorialState.promptCompletedAt,
    tutorialState.promptCompletedAt2,
    updateTutorial,
  ]);

  const normalizeUrl = useCallback((url: string) => url.trim().replace(/\/+$/, '').toLowerCase(), []);

  const completeTutorial = useCallback(() => {
    if (!tutorialEnabled) return;
    // Track the last step completion before marking tutorial done
    trackTutorialStepCompleted(tutorialStepRef.current);
    trackTutorialCompleted();
    updateTutorialState((current) => ({
      ...current,
      status: 'completed',
      stepId: 'done',
      version: 1,
      updatedAt: Date.now(),
    }));
  }, [tutorialEnabled]);

  const showTutorialCompletion = useCallback(() => {
    if (!tutorialEnabled || tutorialCompletionShownRef.current) return;
    tutorialCompletionShownRef.current = true;
    if (doodleJumpCompletionTimeoutRef.current) {
      window.clearTimeout(doodleJumpCompletionTimeoutRef.current);
      doodleJumpCompletionTimeoutRef.current = null;
    }
    doodleJumpCompletionDeadlineRef.current = null;
    // Advance to focus demo instead of immediately completing
    updateTutorial({ stepId: 'focus-demo-1' });
  }, [tutorialEnabled, updateTutorial]);

  const advanceFocusDemoStep = useCallback(() => {
    if (!tutorialEnabled) return;
    if (tutorialStepRef.current === 'focus-demo-1') {
      updateTutorial({ stepId: 'focus-demo-2' });
    } else if (tutorialStepRef.current === 'focus-demo-2') {
      updateTutorial({ stepId: 'focus-explain' });
    } else if (tutorialStepRef.current === 'focus-explain') {
      updateTutorial({ stepId: 'import-prompt' });
    }
  }, [tutorialEnabled, updateTutorial]);

  const completeFocusDemo = useCallback(() => {
    if (!tutorialEnabled) return;
    setTutorialCompletionVisible(true);
    completeTutorial();
  }, [completeTutorial, tutorialEnabled]);

  const dismissTutorialCompletion = useCallback(() => {
    setTutorialCompletionVisible(false);
  }, []);

  const resetDoodleJumpCompletionTimer = useCallback(() => {
    if (tutorialCompletionShownRef.current) return;
    const now = Date.now();
    if (!doodleJumpCompletionDeadlineRef.current) {
      doodleJumpCompletionDeadlineRef.current = now + 30_000;
    }
    if (doodleJumpCompletionTimeoutRef.current) {
      window.clearTimeout(doodleJumpCompletionTimeoutRef.current);
    }
    const remaining = Math.max(0, (doodleJumpCompletionDeadlineRef.current ?? now) - now);
    if (remaining === 0) {
      showTutorialCompletion();
      return;
    }
    const delay = Math.min(10_000, remaining);
    doodleJumpCompletionTimeoutRef.current = window.setTimeout(() => {
      doodleJumpCompletionTimeoutRef.current = null;
      showTutorialCompletion();
    }, delay);
  }, [showTutorialCompletion]);

  const advanceAfterFirstBrowser = useCallback(() => {
    if (!tutorialEnabled) return;
    if (browserAdvanceTimeoutRef.current) return;
    browserAdvanceTimeoutRef.current = window.setTimeout(() => {
      browserAdvanceTimeoutRef.current = null;
      if (tutorialStepRef.current !== 'open-browser-1') return;
      if (tutorialPromptComplete2) {
        updateTutorial({ stepId: 'open-browser-2' });
      } else {
        setPendingBrowserStep('open-browser-2');
      }
    }, 10_000);
  }, [tutorialEnabled, tutorialPromptComplete2, updateTutorial]);

  useEffect(() => {
    return () => {
      if (browserAdvanceTimeoutRef.current) {
        window.clearTimeout(browserAdvanceTimeoutRef.current);
        browserAdvanceTimeoutRef.current = null;
      }
      if (doodleJumpCompletionTimeoutRef.current) {
        window.clearTimeout(doodleJumpCompletionTimeoutRef.current);
        doodleJumpCompletionTimeoutRef.current = null;
      }
      doodleJumpCompletionDeadlineRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!tutorialEnabled || !pendingBrowserStep) return;
    if (pendingBrowserStep === 'open-browser-1' && tutorialPromptComplete) {
      updateTutorial({ stepId: 'open-browser-1' });
      setPendingBrowserStep(null);
    }
    if (pendingBrowserStep === 'open-browser-2' && tutorialPromptComplete2) {
      updateTutorial({ stepId: 'open-browser-2' });
      setPendingBrowserStep(null);
    }
  }, [pendingBrowserStep, tutorialEnabled, tutorialPromptComplete, tutorialPromptComplete2, updateTutorial]);

  useEffect(() => {
    if (!tutorialEnabled || tutorialState.stepId === 'open-browser-2') return;
    if (doodleJumpCompletionTimeoutRef.current) {
      window.clearTimeout(doodleJumpCompletionTimeoutRef.current);
      doodleJumpCompletionTimeoutRef.current = null;
    }
    doodleJumpCompletionDeadlineRef.current = null;
  }, [tutorialEnabled, tutorialState.stepId]);

  const submitRenameWithTutorial = useCallback(
    async (value: string) => {
      if (tutorialEnabled && tutorialState.stepId === 'rename-project') {
        const result = await submitRename('cookie-clicker');
        if (result.ok) {
          updateTutorial({ stepId: 'create-agent' });
        }
        return;
      }
      if (tutorialEnabled && tutorialState.stepId === 'rename-project-2') {
        const result = await submitRename(value);
        if (result.ok && /doodle\s*-?\s*jump/i.test(value)) {
          updateTutorial({ stepId: 'create-agent-2' });
        }
        return;
      }
      await submitRename(value);
    },
    [submitRename, tutorialEnabled, tutorialState.stepId, updateTutorial]
  );

  const handleRenameCancelWithTutorial = useCallback(() => {
    if (tutorialEnabled && ['rename-project', 'rename-project-2'].includes(tutorialState.stepId)) {
      return;
    }
    handleRenameCancel();
  }, [handleRenameCancel, tutorialEnabled, tutorialState.stepId]);

  const handleRenamePickOptionWithTutorial = useCallback(
    async (relativePath: string) => {
      if (tutorialEnabled && ['rename-project', 'rename-project-2'].includes(tutorialState.stepId)) {
        await submitRenameWithTutorial(relativePath);
        return;
      }
      await handleRenamePickOption(relativePath);
    },
    [handleRenamePickOption, submitRenameWithTutorial, tutorialEnabled, tutorialState.stepId]
  );

  const createFolderWithTutorial = useCallback(
    async (name: string, x: number, y: number) => {
      const result = await createFolder(name, x, y);
      if (tutorialEnabled && tutorialState.stepId === 'create-project' && result.ok) {
        updateTutorial({ stepId: 'rename-project' });
      }
      if (tutorialEnabled && tutorialState.stepId === 'create-project-2' && result.ok) {
        await ensureTutorialServer('doodle-jump');
        updateTutorial({ stepId: 'rename-project-2' });
      }
      return result;
    },
    [createFolder, ensureTutorialServer, tutorialEnabled, tutorialState.stepId, updateTutorial]
  );

  const tutorialBrowserId = tutorialState.createdIds?.browserId;
  const tutorialBrowserId2 = tutorialState.createdIds?.browserId2;

  const handleBrowserUrlChangeWithTutorial = useCallback(
    async (id: string, url: string) => {
      const result = await baseHandleBrowserUrlChange(id, url);
      if (tutorialEnabled && tutorialState.stepId === 'open-browser-1') {
        if (normalizeUrl(url) === TUTORIAL_BROWSER_URL_1 && !browserAdvanceTimeoutRef.current) {
          advanceAfterFirstBrowser();
        }
      }
      if (tutorialEnabled && tutorialState.stepId === 'open-browser-2') {
        if (normalizeUrl(url) === TUTORIAL_BROWSER_URL_2) {
          doodleJumpBrowserIdRef.current ??= id;
          resetDoodleJumpCompletionTimer();
        }
      }
      return result;
    },
    [
      advanceAfterFirstBrowser,
      baseHandleBrowserUrlChange,
      resetDoodleJumpCompletionTimer,
      normalizeUrl,
      tutorialEnabled,
      tutorialState.stepId,
    ]
  );

  const handleBrowserCloseWithTutorial = useCallback(
    async (id: string) => {
      if (tutorialEnabled && tutorialState.stepId === 'open-browser-1' && tutorialBrowserId === id) {
        return okResult();
      }
      if (tutorialEnabled && tutorialState.stepId === 'open-browser-2' && tutorialBrowserId2 === id) {
        return okResult();
      }
      return baseHandleBrowserClose(id);
    },
    [baseHandleBrowserClose, tutorialBrowserId, tutorialBrowserId2, tutorialEnabled, tutorialState.stepId]
  );

  const handleTutorialBrowserMessage = useCallback(
    (payload: { panelId: string; url: string; message: string }) => {
      if (!tutorialEnabled) return;
      if (payload.message.includes('tutorial:doodle-jump:activity')) {
        resetDoodleJumpCompletionTimer();
        return;
      }
      if (!payload.message.includes('tutorial:doodle-jump:game-over')) return;
      const normalized = normalizeUrl(payload.url);
      if (normalized !== TUTORIAL_BROWSER_URL_2 && payload.panelId !== doodleJumpBrowserIdRef.current) {
        return;
      }
      showTutorialCompletion();
    },
    [normalizeUrl, resetDoodleJumpCompletionTimer, showTutorialCompletion, tutorialEnabled]
  );

  const tutorialFolderId = tutorialState.createdIds?.folderId;
  const tutorialFolderId2 = tutorialState.createdIds?.folderId2;
  const tutorialAgentId = tutorialState.createdIds?.agentId;
  const tutorialAgentId2 = tutorialState.createdIds?.agentId2;

  const resolveTutorialPromptContext = useCallback(
    (isSecondPrompt: boolean): { agentId: string; relativePath: string } | null => {
      const targetAgentId = isSecondPrompt ? tutorialAgentId2 : tutorialAgentId;
      const preferredFolderId = isSecondPrompt ? tutorialFolderId2 : tutorialFolderId;
      const targetAgent = targetAgentId ? agents.find((agent) => agent.id === targetAgentId) : undefined;
      const fallbackAgent =
        targetAgent ??
        (preferredFolderId
          ? agents.find((agent) => agent.attachedFolderId === preferredFolderId)
          : undefined) ??
        (selectedEntityRef?.type === 'agent'
          ? agents.find((agent) => agent.id === selectedEntityRef.id)
          : undefined) ??
        (isSecondPrompt ? agents.find((agent) => agent.id !== tutorialAgentId) : undefined) ??
        agents[agents.length - 1];
      const effectiveAgent = targetAgent ?? fallbackAgent;
      if (!effectiveAgent) return null;

      const latestFolder = (candidates: Folder[]): Folder | undefined =>
        candidates.reduce<Folder | undefined>(
          (latest, folder) => (!latest || folder.createdAt > latest.createdAt ? folder : latest),
          undefined
        );
      const fallbackFolder = isSecondPrompt
        ? latestFolder(folders.filter((folder) => folder.id !== tutorialFolderId))
        : latestFolder(folders);
      const effectiveFolder =
        (effectiveAgent.attachedFolderId
          ? folders.find((folder) => folder.id === effectiveAgent.attachedFolderId)
          : undefined) ??
        (preferredFolderId ? folders.find((folder) => folder.id === preferredFolderId) : undefined) ??
        fallbackFolder;
      if (!effectiveFolder) return null;
      return { agentId: effectiveAgent.id, relativePath: effectiveFolder.relativePath };
    },
    [
      agents,
      folders,
      selectedEntityRef?.id,
      selectedEntityRef?.type,
      tutorialAgentId,
      tutorialAgentId2,
      tutorialFolderId,
      tutorialFolderId2,
    ]
  );

  const resolveTutorialBrowserAnchor = useCallback((): Position => {
    if (tutorialBrowser1SpawnRef.current) {
      return tutorialBrowser1SpawnRef.current;
    }
    const existingBrowser =
      (tutorialBrowserId ? browsers.find((browser) => browser.id === tutorialBrowserId) : undefined) ??
      browsers.find((browser) => normalizeUrl(browser.url) === TUTORIAL_BROWSER_URL_1);
    if (existingBrowser) {
      const anchor = { x: existingBrowser.x, y: existingBrowser.y };
      tutorialBrowser1SpawnRef.current = anchor;
      return anchor;
    }
    const anchor = { x: hero.x + 200, y: hero.y };
    tutorialBrowser1SpawnRef.current = anchor;
    return anchor;
  }, [browsers, hero.x, hero.y, normalizeUrl, tutorialBrowserId]);

  const restoreTutorialBrowserPanel = useCallback(
    async (options: { isSecond: boolean }) => {
      if (!tutorialEnabled) return;
      const normalizedUrl = options.isSecond ? TUTORIAL_BROWSER_URL_2 : TUTORIAL_BROWSER_URL_1;
      if (options.isSecond ? browserSpawnInFlightRef.current.second : browserSpawnInFlightRef.current.first) {
        return;
      }
      const existingByUrl = browsers.find((browser) => normalizeUrl(browser.url) === normalizedUrl);
      if (existingByUrl) {
        const createdIds = options.isSecond
          ? { browserId2: existingByUrl.id }
          : { browserId: existingByUrl.id };
        updateTutorial({ createdIds });
        if (options.isSecond) {
          doodleJumpBrowserIdRef.current = existingByUrl.id;
        }
        return;
      }
      if (options.isSecond) {
        browserSpawnInFlightRef.current.second = true;
      } else {
        browserSpawnInFlightRef.current.first = true;
      }
      const scenario = options.isSecond ? 'doodle-jump' : 'cookie-clicker';
      let created = false;
      try {
        if (!(await ensureTutorialServer(scenario))) {
          return;
        }
        const anchor = resolveTutorialBrowserAnchor();
        const spawnX = options.isSecond
          ? anchor.x - DEFAULT_BROWSER_SIZE.width - WORKSPACE_CONSTANTS.TUTORIAL_BROWSER_SPAWN_GAP
          : anchor.x;
        const spawnY = anchor.y;
        const result = await workspaceClient.createBrowserPanel(
          workspace.path,
          normalizedUrl,
          spawnX,
          spawnY,
          DEFAULT_BROWSER_SIZE.width,
          DEFAULT_BROWSER_SIZE.height
        );
        if (!result.success || !result.panel) {
          setMessageDialog({ title: 'Error', message: 'Failed to restore browser panel', type: 'error' });
          return;
        }
        const panel = result.panel;
        created = true;
        setBrowsers((prev) => [...prev, panel]);
        bringBrowserToFront(panel.id);
        const createdIds = options.isSecond ? { browserId2: panel.id } : { browserId: panel.id };
        updateTutorial({ createdIds });
        if (options.isSecond) {
          doodleJumpBrowserIdRef.current = panel.id;
          resetDoodleJumpCompletionTimer();
        } else {
          advanceAfterFirstBrowser();
        }
      } finally {
        if (!created) {
          if (options.isSecond) {
            browserSpawnInFlightRef.current.second = false;
          } else {
            browserSpawnInFlightRef.current.first = false;
          }
        }
      }
    },
    [
      advanceAfterFirstBrowser,
      bringBrowserToFront,
      browsers,
      ensureTutorialServer,
      normalizeUrl,
      resetDoodleJumpCompletionTimer,
      resolveTutorialBrowserAnchor,
      setBrowsers,
      setMessageDialog,
      tutorialEnabled,
      updateTutorial,
      workspace.path,
    ]
  );

  const startTutorialPromptRun = useCallback(
    async (options: { isSecondPrompt: boolean; runId?: string }): Promise<boolean> => {
      const context = resolveTutorialPromptContext(options.isSecondPrompt);
      if (!context) return false;
      const scenario = options.isSecondPrompt ? 'doodle-jump' : 'cookie-clicker';
      const prompt = options.isSecondPrompt ? TUTORIAL_PROMPT_2 : TUTORIAL_PROMPT_1;
      if (!(await ensureTutorialServer(scenario))) {
        return false;
      }
      const result = await workspaceClient.agentConnectRunAgent({
        agentId: context.agentId,
        workspacePath: workspace.path,
        relativePath: context.relativePath,
        prompt,
        runId: options.runId,
        tutorialMode: true,
        tutorialScenario: scenario,
      });
      if (result?.success && result.runId) {
        if (options.isSecondPrompt) {
          setTutorialPromptRunId2(result.runId);
        } else {
          setTutorialPromptRunId(result.runId);
        }
        return true;
      }
      return false;
    },
    [
      ensureTutorialServer,
      resolveTutorialPromptContext,
      setTutorialPromptRunId,
      setTutorialPromptRunId2,
      workspace.path,
    ]
  );

  useEffect(() => {
    if (!tutorialEnabled) return;
    if (shouldResumePrompt(tutorialState.stepId, false, tutorialPromptComplete)) {
      if (!promptRunInFlightRef.current.first) {
        promptRunInFlightRef.current.first = true;
        void startTutorialPromptRun({
          isSecondPrompt: false,
          runId: tutorialState.promptRunId ?? tutorialPromptRunId ?? undefined,
        }).then((started) => {
          if (!started) {
            promptRunInFlightRef.current.first = false;
          }
        });
      }
    }
    if (shouldResumePrompt(tutorialState.stepId, true, tutorialPromptComplete2)) {
      if (!promptRunInFlightRef.current.second) {
        promptRunInFlightRef.current.second = true;
        void startTutorialPromptRun({
          isSecondPrompt: true,
          runId: tutorialState.promptRunId2 ?? tutorialPromptRunId2 ?? undefined,
        }).then((started) => {
          if (!started) {
            promptRunInFlightRef.current.second = false;
          }
        });
      }
    }
  }, [
    startTutorialPromptRun,
    tutorialEnabled,
    tutorialPromptComplete,
    tutorialPromptComplete2,
    tutorialPromptRunId,
    tutorialPromptRunId2,
    tutorialState.promptRunId,
    tutorialState.promptRunId2,
    tutorialState.stepId,
  ]);

  useEffect(() => {
    if (!tutorialEnabled) return;
    if (shouldEnsureServer(tutorialState.stepId, false, tutorialPromptComplete)) {
      void ensureTutorialServer('cookie-clicker');
    }
    if (shouldEnsureServer(tutorialState.stepId, true, tutorialPromptComplete2)) {
      void ensureTutorialServer('doodle-jump');
    }
  }, [
    ensureTutorialServer,
    tutorialEnabled,
    tutorialPromptComplete,
    tutorialPromptComplete2,
    tutorialState.stepId,
  ]);

  useEffect(() => {
    if (!tutorialEnabled) return;
    const stepIndex = getStepIndex(tutorialState.stepId);
    if (
      tutorialBrowserId &&
      stepIndex >= OPEN_BROWSER_1_STEP_INDEX &&
      !browsers.some((browser) => browser.id === tutorialBrowserId)
    ) {
      void restoreTutorialBrowserPanel({ isSecond: false });
    }
    if (
      tutorialBrowserId2 &&
      stepIndex >= OPEN_BROWSER_2_STEP_INDEX &&
      !browsers.some((browser) => browser.id === tutorialBrowserId2)
    ) {
      void restoreTutorialBrowserPanel({ isSecond: true });
    }
  }, [
    browsers,
    restoreTutorialBrowserPanel,
    tutorialBrowserId,
    tutorialBrowserId2,
    tutorialEnabled,
    tutorialState.stepId,
  ]);

  useEffect(() => {
    if (browserSpawnInFlightRef.current.first) {
      const matched = browsers.find((browser) => normalizeUrl(browser.url) === TUTORIAL_BROWSER_URL_1);
      if (matched) {
        browserSpawnInFlightRef.current.first = false;
      }
    }
    if (browserSpawnInFlightRef.current.second) {
      const matched = browsers.find((browser) => normalizeUrl(browser.url) === TUTORIAL_BROWSER_URL_2);
      if (matched) {
        browserSpawnInFlightRef.current.second = false;
      }
    }
  }, [browsers, normalizeUrl]);

  const [isTutorialAgentDragging, setIsTutorialAgentDragging] = useState(false);
  const [isTutorialAgent2Dragging, setIsTutorialAgent2Dragging] = useState(false);

  const canMoveUnits = !tutorialEnabled || ['attach-agent', 'attach-agent-2'].includes(tutorialState.stepId);

  const handleCanvasRightClickWithTutorial = useCallback(
    (position: { x: number; y: number }, target: SelectedEntityRef | null) => {
      if (!canMoveUnits) return;
      baseHandleCanvasRightClick(position, target);
    },
    [baseHandleCanvasRightClick, canMoveUnits]
  );

  const handleHeroMoveWithTutorial = useCallback(
    async (x: number, y: number) => {
      if (!canMoveUnits) return okResult();
      return baseHandleHeroMove(x, y);
    },
    [baseHandleHeroMove, canMoveUnits]
  );

  const handleAgentMoveWithTutorial = useCallback(
    (id: string, x: number, y: number) => {
      if (!canMoveUnits) return okResult();
      return baseHandleAgentMove(id, x, y);
    },
    [baseHandleAgentMove, canMoveUnits]
  );

  const handleAgentDragStartWithTutorial = useCallback(
    (id: string) => {
      if (!canMoveUnits) return;
      if (id === tutorialAgentId) {
        setIsTutorialAgentDragging(true);
      }
      if (id === tutorialAgentId2) {
        setIsTutorialAgent2Dragging(true);
      }
      baseHandleAgentDragStart(id);
    },
    [baseHandleAgentDragStart, canMoveUnits, tutorialAgentId, tutorialAgentId2]
  );

  const handleAgentDragEndWithTutorial = useCallback(
    (id: string, data?: DragEndData) => {
      if (!canMoveUnits) return;
      baseHandleAgentDragEnd(id, data);
      if (id === tutorialAgentId) {
        setIsTutorialAgentDragging(false);
      }
      if (id === tutorialAgentId2) {
        setIsTutorialAgent2Dragging(false);
      }
    },
    [baseHandleAgentDragEnd, canMoveUnits, tutorialAgentId, tutorialAgentId2]
  );

  const [tutorialMoveZone, setTutorialMoveZone] = useState<TutorialMoveZone | null>(null);
  const [tutorialMoveBounds, setTutorialMoveBounds] = useState<TutorialMoveZone | null>(null);

  const isSelectionAllowed = useCallback(
    (id: string, type: SelectedEntityRef['type']) => {
      if (!tutorialEnabled) return true;
      switch (tutorialState.stepId) {
        case 'rename-project':
          return type === 'folder' && (!tutorialFolderId || id === tutorialFolderId);
        case 'rename-project-2':
          return type === 'folder' && (!tutorialFolderId2 || id === tutorialFolderId2);
        case 'attach-agent':
          return (
            (type === 'agent' && (!tutorialAgentId || id === tutorialAgentId)) ||
            (type === 'folder' && (!tutorialFolderId || id === tutorialFolderId))
          );
        case 'attach-agent-2':
          return (
            (type === 'agent' && (!tutorialAgentId2 || id === tutorialAgentId2)) ||
            (type === 'folder' && (!tutorialFolderId2 || id === tutorialFolderId2))
          );
        case 'open-global-chat':
        case 'send-prompt':
        case 'open-terminal':
        case 'close-terminal':
          return type === 'agent' && (!tutorialAgentId || id === tutorialAgentId);
        case 'open-global-chat-2':
        case 'send-prompt-2':
          return type === 'agent' && (!tutorialAgentId2 || id === tutorialAgentId2);
        case 'move-project':
          return type === 'folder' && (!tutorialFolderId || id === tutorialFolderId);
        case 'open-browser-1':
          return type === 'browser' && (!tutorialBrowserId || id === tutorialBrowserId);
        case 'open-browser-2':
          return type === 'browser' && (!tutorialBrowserId2 || id === tutorialBrowserId2);
        case 'create-project':
        case 'create-project-2':
        case 'create-agent':
        case 'create-agent-2':
        case 'hero-provider':
        case 'hero-intro':
          return false;
        default:
          return true;
      }
    },
    [
      tutorialAgentId,
      tutorialAgentId2,
      tutorialBrowserId,
      tutorialBrowserId2,
      tutorialEnabled,
      tutorialFolderId,
      tutorialFolderId2,
      tutorialState.stepId,
    ]
  );

  const handleBrowserMoveWithTutorial = useCallback(
    async (id: string, x: number, y: number) => {
      if (tutorialEnabled) return okResult();
      return baseHandleBrowserMove(id, x, y);
    },
    [baseHandleBrowserMove, tutorialEnabled]
  );

  const handleBrowserMoveEndWithTutorial = useCallback(
    async (id: string, x: number, y: number) => {
      if (tutorialEnabled) return okResult();
      return baseHandleBrowserMoveEnd(id, x, y);
    },
    [baseHandleBrowserMoveEnd, tutorialEnabled]
  );

  const handleBrowserResizeWithTutorial = useCallback(
    async (id: string, width: number, height: number) => {
      if (tutorialEnabled) return okResult();
      return baseHandleBrowserResize(id, width, height);
    },
    [baseHandleBrowserResize, tutorialEnabled]
  );

  const handleBrowserResizeEndWithTutorial = useCallback(
    async (id: string, width: number, height: number) => {
      if (tutorialEnabled) return okResult();
      return baseHandleBrowserResizeEnd(id, width, height);
    },
    [baseHandleBrowserResizeEnd, tutorialEnabled]
  );

  const handleTerminalMoveWithTutorial = useCallback(
    async (terminalId: string, x: number, y: number) => {
      if (tutorialEnabled) return okResult();
      return baseHandleTerminalMove(terminalId, x, y);
    },
    [baseHandleTerminalMove, tutorialEnabled]
  );

  const handleTerminalMoveEndWithTutorial = useCallback(
    async (terminalId: string, x: number, y: number) => {
      if (tutorialEnabled) return okResult();
      return baseHandleTerminalMoveEnd(terminalId, x, y);
    },
    [baseHandleTerminalMoveEnd, tutorialEnabled]
  );

  const handleTerminalResizeWithTutorial = useCallback(
    async (terminalId: string, width: number, height: number) => {
      if (tutorialEnabled) return okResult();
      return baseHandleTerminalResize(terminalId, width, height);
    },
    [baseHandleTerminalResize, tutorialEnabled]
  );

  const handleTerminalResizeEndWithTutorial = useCallback(
    async (terminalId: string, width: number, height: number) => {
      if (tutorialEnabled) return okResult();
      return baseHandleTerminalResizeEnd(terminalId, width, height);
    },
    [baseHandleTerminalResizeEnd, tutorialEnabled]
  );

  const createBrowser = async (x: number, y: number, originFolderId?: string) => {
    if (tutorialEnabled && tutorialBrowserId2) {
      return okResult();
    }
    if (tutorialEnabled && ['open-browser-1', 'open-browser-2'].includes(tutorialState.stepId)) {
      setDismissedTutorialOverlayStepId(tutorialState.stepId);
    }
    if (
      tutorialEnabled &&
      tutorialState.stepId === 'open-browser-1' &&
      tutorialBrowserId &&
      !tutorialBrowserId2
    ) {
      browserSpawnInFlightRef.current.second = true;
      let created = false;
      try {
        if (!(await ensureTutorialServer('doodle-jump'))) {
          return errorResult('Tutorial server unavailable.');
        }
        const anchor = tutorialBrowser1SpawnRef.current ?? { x, y };
        tutorialBrowser1SpawnRef.current = anchor;
        const spawnX = anchor.x - DEFAULT_BROWSER_SIZE.width - WORKSPACE_CONSTANTS.TUTORIAL_BROWSER_SPAWN_GAP;
        const spawnY = anchor.y;
        if (browserAdvanceTimeoutRef.current) {
          window.clearTimeout(browserAdvanceTimeoutRef.current);
          browserAdvanceTimeoutRef.current = null;
        }
        updateTutorial({ stepId: 'open-browser-2' });
        const result = await workspaceClient.createBrowserPanel(
          workspace.path,
          TUTORIAL_BROWSER_URL_2,
          spawnX,
          spawnY,
          DEFAULT_BROWSER_SIZE.width,
          DEFAULT_BROWSER_SIZE.height,
          tutorialState.createdIds?.folderId2
        );
        if (result.success && result.panel) {
          const panel = result.panel;
          created = true;
          setBrowsers((prev) => [...prev, panel]);
          bringBrowserToFront(panel.id);
          updateTutorial({ createdIds: { browserId2: panel.id } });
          doodleJumpBrowserIdRef.current = panel.id;
          resetDoodleJumpCompletionTimer();
          return okResult();
        }
        const errorMessage = 'Failed to create browser panel';
        setMessageDialog({ title: 'Error', message: errorMessage, type: 'error' });
        return errorResult(errorMessage);
      } finally {
        if (!created) {
          browserSpawnInFlightRef.current.second = false;
        }
      }
    }

    let url = DEFAULT_BROWSER_URL;
    let spawnX = x;
    let spawnY = y;
    if (tutorialEnabled && tutorialState.stepId === 'open-browser-1') {
      url = TUTORIAL_BROWSER_URL_1;
      browserSpawnInFlightRef.current.first = true;
      if (!(await ensureTutorialServer('cookie-clicker'))) {
        browserSpawnInFlightRef.current.first = false;
        return errorResult('Tutorial server unavailable.');
      }
      if (!tutorialBrowser1SpawnRef.current) {
        tutorialBrowser1SpawnRef.current = { x: spawnX, y: spawnY };
      }
    } else if (tutorialEnabled && tutorialState.stepId === 'open-browser-2') {
      url = TUTORIAL_BROWSER_URL_2;
      browserSpawnInFlightRef.current.second = true;
      if (!(await ensureTutorialServer('doodle-jump'))) {
        browserSpawnInFlightRef.current.second = false;
        return errorResult('Tutorial server unavailable.');
      }
      const anchor = tutorialBrowser1SpawnRef.current ?? { x: spawnX, y: spawnY };
      spawnX = anchor.x - DEFAULT_BROWSER_SIZE.width - WORKSPACE_CONSTANTS.TUTORIAL_BROWSER_SPAWN_GAP;
      spawnY = anchor.y;
    }
    const result = await workspaceClient.createBrowserPanel(
      workspace.path,
      url,
      spawnX,
      spawnY,
      DEFAULT_BROWSER_SIZE.width,
      DEFAULT_BROWSER_SIZE.height,
      tutorialEnabled
        ? tutorialState.stepId === 'open-browser-2'
          ? tutorialState.createdIds?.folderId2
          : tutorialState.createdIds?.folderId
        : originFolderId
    );
    if (result.success && result.panel) {
      const panel = result.panel;
      setBrowsers((prev) => [...prev, panel]);
      bringBrowserToFront(panel.id);
      if (tutorialEnabled && tutorialState.stepId === 'open-browser-1') {
        updateTutorial({ createdIds: { browserId: panel.id } });
        advanceAfterFirstBrowser();
      }
      if (tutorialEnabled && tutorialState.stepId === 'open-browser-2') {
        updateTutorial({ createdIds: { browserId2: panel.id } });
        doodleJumpBrowserIdRef.current = panel.id;
        resetDoodleJumpCompletionTimer();
      }
      return okResult();
    }
    browserSpawnInFlightRef.current.first = false;
    browserSpawnInFlightRef.current.second = false;
    const errorMessage = 'Failed to create browser panel';
    setMessageDialog({ title: 'Error', message: errorMessage, type: 'error' });
    return errorResult(errorMessage);
  };

  const beginRenameWithTutorial = useCallback(
    (folder?: Folder) => {
      if (tutorialEnabled && tutorialState.stepId === 'rename-project-2') {
        beginRename(folder, { openDropdown: false });
        return;
      }
      beginRename(folder);
    },
    [beginRename, tutorialEnabled, tutorialState.stepId]
  );

  useEffect(() => {
    if (!tutorialEnabled) return;
    if (tutorialState.stepId === 'rename-project') {
      const targetFolder =
        (tutorialFolderId ? folders.find((folder) => folder.id === tutorialFolderId) : null) ??
        folders.reduce<Folder | null>(
          (latest, folder) => (!latest || folder.createdAt > latest.createdAt ? folder : latest),
          null
        );
      if (!targetFolder) return;
      if (!tutorialFolderId || tutorialFolderId !== targetFolder.id) {
        updateTutorial({ createdIds: { folderId: targetFolder.id } });
      }
      return;
    }
    if (tutorialState.stepId === 'rename-project-2') {
      const targetFolder =
        (tutorialFolderId2 ? folders.find((folder) => folder.id === tutorialFolderId2) : null) ??
        folders
          .filter((folder) => folder.id !== tutorialFolderId)
          .reduce<Folder | null>(
            (latest, folder) => (!latest || folder.createdAt > latest.createdAt ? folder : latest),
            null
          );
      if (!targetFolder) return;
      if (!tutorialFolderId2 || tutorialFolderId2 !== targetFolder.id) {
        updateTutorial({ createdIds: { folderId2: targetFolder.id } });
      }
    }
  }, [folders, tutorialEnabled, tutorialFolderId, tutorialFolderId2, tutorialState.stepId, updateTutorial]);

  const advanceHeroIntro = useCallback(() => {
    if (!tutorialEnabled || tutorialState.stepId !== 'hero-intro') return;
    updateTutorial({ stepId: 'create-project' });
  }, [tutorialEnabled, tutorialState.stepId, updateTutorial]);

  useEffect(() => {
    if (!tutorialEnabled || !['create-agent', 'create-agent-2'].includes(tutorialState.stepId)) return;
    const effectiveProvider = settings.heroProvider ?? hero.provider;
    const provider = effectiveProvider === 'codex' ? 'create-agent-codex' : 'create-agent-claude';
    setAbilityVariantSelection('create-agent-claude', provider);
  }, [hero.provider, settings.heroProvider, tutorialEnabled, tutorialState.stepId]);

  useEffect(() => {
    if (!tutorialEnabled || tutorialState.stepId !== 'create-agent') return;
    if (tutorialAgentId || agents.length === 0) return;
    const newest = agents[agents.length - 1];
    updateTutorial({ stepId: 'attach-agent', createdIds: { agentId: newest.id } });
    setSelectedEntityRef({ id: newest.id, type: 'agent' });
  }, [agents, tutorialAgentId, tutorialEnabled, tutorialState.stepId, updateTutorial, setSelectedEntityRef]);

  useEffect(() => {
    if (!tutorialEnabled || tutorialState.stepId !== 'create-agent-2') return;
    if (tutorialAgentId2) return;
    const candidates = agents.filter((agent) => agent.id !== tutorialAgentId);
    if (candidates.length === 0) return;
    const newest = candidates[candidates.length - 1];
    updateTutorial({ stepId: 'attach-agent-2', createdIds: { agentId2: newest.id } });
    setSelectedEntityRef({ id: newest.id, type: 'agent' });
  }, [
    agents,
    tutorialAgentId,
    tutorialAgentId2,
    tutorialEnabled,
    tutorialState.stepId,
    updateTutorial,
    setSelectedEntityRef,
  ]);

  useEffect(() => {
    if (
      !tutorialEnabled ||
      !['create-project', 'create-project-2', 'create-agent', 'create-agent-2'].includes(tutorialState.stepId)
    )
      return;
    if (selectedEntityRef !== null || selectedAgentIds.length > 0) {
      setSelectedEntityRef(null);
      setSelectedAgentIds([]);
    }
  }, [
    selectedAgentIds.length,
    selectedEntityRef,
    tutorialEnabled,
    tutorialState.stepId,
    setSelectedEntityRef,
    setSelectedAgentIds,
  ]);

  useEffect(() => {
    if (!tutorialEnabled || tutorialState.stepId !== 'attach-agent') return;
    if (!tutorialAgentId || !tutorialFolderId) return;
    if (selectedEntityRef?.id !== tutorialAgentId) {
      setSelectedEntityRef({ id: tutorialAgentId, type: 'agent' });
    }
    const agent = agents.find((entry) => entry.id === tutorialAgentId);
    if (agent?.attachedFolderId === tutorialFolderId && !isTutorialAgentDragging) {
      updateTutorial({ stepId: 'open-global-chat' });
    }
  }, [
    agents,
    isTutorialAgentDragging,
    selectedEntityRef?.id,
    tutorialAgentId,
    tutorialEnabled,
    tutorialFolderId,
    tutorialState.stepId,
    updateTutorial,
    setSelectedEntityRef,
  ]);

  useEffect(() => {
    if (!tutorialEnabled || tutorialState.stepId !== 'attach-agent-2') return;
    if (!tutorialAgentId2 || !tutorialFolderId2) return;
    if (selectedEntityRef?.id !== tutorialAgentId2) {
      setSelectedEntityRef({ id: tutorialAgentId2, type: 'agent' });
    }
    const agent = agents.find((entry) => entry.id === tutorialAgentId2);
    if (agent?.attachedFolderId === tutorialFolderId2 && !isTutorialAgent2Dragging) {
      updateTutorial({ stepId: 'open-global-chat-2' });
    }
  }, [
    agents,
    isTutorialAgent2Dragging,
    selectedEntityRef?.id,
    tutorialAgentId2,
    tutorialEnabled,
    tutorialFolderId2,
    tutorialState.stepId,
    updateTutorial,
    setSelectedEntityRef,
  ]);

  const closeTerminalAutoOpenRef = useRef(false);

  useEffect(() => {
    if (!tutorialEnabled || tutorialState.stepId !== 'open-terminal') {
      return;
    }
    if (tutorialAgentId && selectedEntityRef?.id !== tutorialAgentId) {
      setSelectedEntityRef({ id: tutorialAgentId, type: 'agent' });
    }
    if (tutorialAgentId && activeAgentTerminalId === tutorialAgentId) {
      updateTutorial({ stepId: 'close-terminal' });
    }
  }, [
    activeAgentTerminalId,
    selectedEntityRef?.id,
    tutorialAgentId,
    tutorialEnabled,
    tutorialState.stepId,
    updateTutorial,
    setSelectedEntityRef,
  ]);

  useEffect(() => {
    if (!tutorialEnabled || tutorialState.stepId !== 'close-terminal') {
      closeTerminalAutoOpenRef.current = false;
      return;
    }
    if (tutorialAgentId && activeAgentTerminalId !== tutorialAgentId) {
      if (!closeTerminalAutoOpenRef.current) {
        if (selectedEntityRef?.id !== tutorialAgentId) {
          setSelectedEntityRef({ id: tutorialAgentId, type: 'agent' });
        }
        setActiveAgentTerminalId(tutorialAgentId);
        closeTerminalAutoOpenRef.current = true;
        return;
      }
      if (activeAgentTerminalId) return;
    }
    if (tutorialAgentId && activeAgentTerminalId === tutorialAgentId) {
      closeTerminalAutoOpenRef.current = true;
      return;
    }
    updateTutorial({ stepId: 'move-project' });
  }, [
    activeAgentTerminalId,
    selectedEntityRef?.id,
    tutorialAgentId,
    tutorialEnabled,
    tutorialState.stepId,
    updateTutorial,
    setActiveAgentTerminalId,
    setSelectedEntityRef,
  ]);

  useEffect(() => {
    if (!tutorialEnabled || tutorialState.stepId !== 'move-project') {
      if (tutorialMoveZone) {
        setTutorialMoveZone(null);
      }
      if (tutorialMoveBounds) {
        setTutorialMoveBounds(null);
      }
      return;
    }
    if (tutorialMoveZone) return;
    const folder = tutorialFolderId ? folders.find((entry) => entry.id === tutorialFolderId) : undefined;
    if (!folder) return;
    const width = Math.round(WORKSPACE_CONSTANTS.FOLDER_ICON_SIZE_PX * 2.5);
    const height = Math.round(WORKSPACE_CONSTANTS.FOLDER_ICON_SIZE_PX * 1.8);
    const zone = {
      x: Math.round(folder.x + WORKSPACE_CONSTANTS.FOLDER_ICON_SIZE_PX * 2.5),
      y: Math.round(folder.y - WORKSPACE_CONSTANTS.FOLDER_ICON_SIZE_PX * 0.5),
      width,
      height,
      folderId: folder.id,
      originX: folder.x,
      originY: folder.y,
    };
    setTutorialMoveZone(zone);
    const padding = 40;
    const folderSize = WORKSPACE_CONSTANTS.FOLDER_ICON_SIZE_PX;
    const minX = Math.min(zone.x, folder.x);
    const minY = Math.min(zone.y, folder.y);
    const maxX = Math.max(zone.x + zone.width, folder.x + folderSize);
    const maxY = Math.max(zone.y + zone.height, folder.y + folderSize);
    setTutorialMoveBounds({
      x: minX - padding,
      y: minY - padding,
      width: maxX - minX + padding * 2,
      height: maxY - minY + padding * 2,
      folderId: folder.id,
    });
  }, [
    folders,
    tutorialEnabled,
    tutorialFolderId,
    tutorialMoveBounds,
    tutorialMoveZone,
    tutorialState.stepId,
  ]);

  useEffect(() => {
    if (!tutorialEnabled || tutorialState.stepId !== 'move-project') {
      if (tutorialMoveBounds) {
        setTutorialMoveBounds(null);
      }
      return;
    }
    if (tutorialMoveBounds) return;
    if (!tutorialMoveZone) return;
    const padding = 40;
    const folderSize = WORKSPACE_CONSTANTS.FOLDER_ICON_SIZE_PX;
    const originX = tutorialMoveZone.originX ?? tutorialMoveZone.x;
    const originY = tutorialMoveZone.originY ?? tutorialMoveZone.y;
    const minX = Math.min(tutorialMoveZone.x, originX);
    const minY = Math.min(tutorialMoveZone.y, originY);
    const maxX = Math.max(tutorialMoveZone.x + tutorialMoveZone.width, originX + folderSize);
    const maxY = Math.max(tutorialMoveZone.y + tutorialMoveZone.height, originY + folderSize);
    setTutorialMoveBounds({
      x: minX - padding,
      y: minY - padding,
      width: maxX - minX + padding * 2,
      height: maxY - minY + padding * 2,
      folderId: tutorialMoveZone.folderId,
    });
  }, [tutorialEnabled, tutorialMoveBounds, tutorialMoveZone, tutorialState.stepId]);

  useEffect(() => {
    if (!tutorialEnabled || tutorialState.stepId !== 'move-project' || !tutorialMoveZone) return;
    const folder = folders.find((entry) => entry.id === tutorialMoveZone.folderId);
    if (!folder) return;
    const size = WORKSPACE_CONSTANTS.FOLDER_ICON_SIZE_PX;
    const withinZone =
      folder.x >= tutorialMoveZone.x &&
      folder.x + size <= tutorialMoveZone.x + tutorialMoveZone.width &&
      folder.y >= tutorialMoveZone.y &&
      folder.y + size <= tutorialMoveZone.y + tutorialMoveZone.height;
    if (withinZone) {
      updateTutorial({ stepId: 'create-project-2' });
    }
  }, [folders, tutorialEnabled, tutorialMoveZone, tutorialState.stepId, updateTutorial]);

  useEffect(() => {
    if (!tutorialEnabled || !['open-browser-1', 'open-browser-2'].includes(tutorialState.stepId)) return;
    if (selectedEntityRef !== null || selectedAgentIds.length > 0) {
      setSelectedEntityRef(null);
      setSelectedAgentIds([]);
    }
  }, [
    selectedAgentIds.length,
    selectedEntityRef,
    tutorialEnabled,
    tutorialState.stepId,
    setSelectedEntityRef,
    setSelectedAgentIds,
  ]);

  useEffect(() => {
    if (!tutorialEnabled) return;
    if (tutorialState.stepId === 'open-browser-1' && tutorialPromptRunId && !tutorialPromptComplete) {
      void workspaceClient.accelerateTutorialRun(tutorialPromptRunId);
    }
    if (tutorialState.stepId === 'open-browser-2' && tutorialPromptRunId2 && !tutorialPromptComplete2) {
      void workspaceClient.accelerateTutorialRun(tutorialPromptRunId2);
    }
  }, [
    tutorialEnabled,
    tutorialPromptRunId,
    tutorialPromptRunId2,
    tutorialPromptComplete,
    tutorialPromptComplete2,
    tutorialState.stepId,
  ]);

  useEffect(() => {
    if (!tutorialEnabled || tutorialState.stepId !== 'open-browser-1') return;
    const matched = browsers.find((browser) => normalizeUrl(browser.url) === TUTORIAL_BROWSER_URL_1);
    if (matched) {
      if (!tutorialBrowserId || tutorialBrowserId !== matched.id) {
        updateTutorial({ createdIds: { browserId: matched.id } });
      }
      advanceAfterFirstBrowser();
    }
  }, [
    advanceAfterFirstBrowser,
    browsers,
    normalizeUrl,
    tutorialBrowserId,
    tutorialEnabled,
    tutorialState.stepId,
    updateTutorial,
  ]);

  useEffect(() => {
    if (!tutorialEnabled || tutorialState.stepId !== 'open-browser-2') return;
    const matched = browsers.find((browser) => normalizeUrl(browser.url) === TUTORIAL_BROWSER_URL_2);
    if (matched) {
      if (!tutorialBrowserId2 || tutorialBrowserId2 !== matched.id) {
        updateTutorial({ createdIds: { browserId2: matched.id } });
      }
      doodleJumpBrowserIdRef.current ??= matched.id;
      resetDoodleJumpCompletionTimer();
    }
  }, [
    browsers,
    normalizeUrl,
    resetDoodleJumpCompletionTimer,
    tutorialBrowserId2,
    tutorialEnabled,
    tutorialState.stepId,
    updateTutorial,
  ]);

  useEffect(() => {
    if (!dismissedTutorialOverlayStepId) return;
    if (dismissedTutorialOverlayStepId === tutorialState.stepId) return;
    setDismissedTutorialOverlayStepId(null);
  }, [dismissedTutorialOverlayStepId, tutorialState.stepId]);

  return {
    tutorialState,
    tutorialEnabled,
    tutorialMoveZone,
    tutorialMoveBounds,
    tutorialCompletionVisible,
    dismissedTutorialOverlayStepId,
    dismissTutorialCompletion,
    advanceHeroIntro,
    advanceFocusDemoStep,
    completeFocusDemo,
    updateTutorial,
    ensureTutorialServer,
    tutorialPromptRunId,
    tutorialPromptRunId2,
    setTutorialPromptRunId,
    setTutorialPromptRunId2,
    tutorialPromptComplete,
    tutorialPromptComplete2,
    tutorialAgentId,
    tutorialAgentId2,
    tutorialFolderId,
    tutorialFolderId2,
    tutorialBrowserId,
    tutorialBrowserId2,
    canMoveUnits,
    isSelectionAllowed,
    beginRename: beginRenameWithTutorial,
    submitRename: submitRenameWithTutorial,
    handleRenameCancel: handleRenameCancelWithTutorial,
    handleRenamePickOption: handleRenamePickOptionWithTutorial,
    createFolder: createFolderWithTutorial,
    createBrowser,
    handleBrowserUrlChange: handleBrowserUrlChangeWithTutorial,
    handleBrowserClose: handleBrowserCloseWithTutorial,
    handleBrowserMove: handleBrowserMoveWithTutorial,
    handleBrowserMoveEnd: handleBrowserMoveEndWithTutorial,
    handleBrowserResize: handleBrowserResizeWithTutorial,
    handleBrowserResizeEnd: handleBrowserResizeEndWithTutorial,
    handleTerminalMove: handleTerminalMoveWithTutorial,
    handleTerminalMoveEnd: handleTerminalMoveEndWithTutorial,
    handleTerminalResize: handleTerminalResizeWithTutorial,
    handleTerminalResizeEnd: handleTerminalResizeEndWithTutorial,
    handleCanvasRightClick: handleCanvasRightClickWithTutorial,
    handleHeroMove: handleHeroMoveWithTutorial,
    handleAgentMove: handleAgentMoveWithTutorial,
    handleAgentDragStart: handleAgentDragStartWithTutorial,
    handleAgentDragEnd: handleAgentDragEndWithTutorial,
    handleTutorialBrowserMessage,
  };
};
