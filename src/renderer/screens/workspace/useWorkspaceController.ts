import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Workspace,
  Agent,
  AgentProvider,
  Folder,
  AnyFolder,
  TerminalPanel as TerminalPanelRecord,
  Hero,
  TutorialState,
  BrowserPanel,
  AvailableFolder,
  SelectedEntityRef,
  WorldEntity,
  Position,
} from '../../../shared/types';
import { useProjectMode, type ProjectModeReturn } from './useProjectMode';
import { workspaceClient } from '../../services/workspaceClient';
import useWorkspaceEntities from '../../hooks/useWorkspaceEntities';
import useWorktreeConflicts from '../../hooks/useWorktreeConflicts';
import useAgentTerminalManager from '../../hooks/useAgentTerminalManager';
import type { DialogMessage, FolderSelectDialogState, InputConfig } from './types';
import type { FolderContext } from '../../components/hud/abilityBuilder';
import type { CommandContext, CommandInvocation, CommandRunResult } from '../../commands/registry';
import { useDialogs } from './useDialogs';
import { useBrowserManager } from './useBrowserManager';
import { useAgentManager } from './useAgentManager';
import * as WORKSPACE_CONSTANTS from './constants';
import { useAgentMagnetism } from './useAgentMagnetism';
import { useMovementController } from './useMovementController';
import { resolveAgentDragEndSelection } from './selection';
import { useWorkspaceFolders } from './useWorkspaceFolders';
import { useWorkspaceTerminals } from './useWorkspaceTerminals';
import { useWorkspaceSelectionState } from './useWorkspaceSelectionState';
import { useWorkspaceCommandBridge } from './useWorkspaceCommandBridge';
import { useWorkspaceAbilities } from './useWorkspaceAbilities';
import { useZIndexManager } from './useZIndexManager';
import { useGlobalChat, type GlobalChatProps } from './useGlobalChat';
import { useHotkeyRouter, type HotkeyRouterReturn } from './hotkeys/useHotkeyRouter';
import { useSelectionHotkeys } from './hotkeys/useSelectionHotkeys';
import { useGlobalChatHotkeys } from './hotkeys/useGlobalChatHotkeys';
import { useAgentCompletionBadges } from './useAgentCompletionBadges';
import { isInputCaptured } from './inputCapture';
import {
  getTutorialPromptStep,
  getTutorialRunOptionsForAgent,
  getTutorialRunOptionsForHero,
} from '../../tutorial/policy';
import {
  buildTutorialChatProps,
  canOpenTutorialGlobalChat,
  useTutorialChatEffects,
} from '../../tutorial/useTutorialChat';
import { useWorkspaceTutorialCore } from '../../tutorial/useWorkspaceTutorial';
import type { TutorialMoveZone } from '../../tutorial/types';
import { refreshAppSettings, setAbilityVariantSelection, useAppSettings } from '../../state/appSettingsStore';

interface UseWorkspaceControllerParams {
  workspace: Workspace;
  onBack: () => void;
}

type DragEndData = { pos: Position; dragDistance: number };

export interface WorkspaceController {
  registerHotkeyHandler: HotkeyRouterReturn['registerHotkeyHandler'];
  workspace: Workspace;
  hero: Hero;
  tutorialState: TutorialState;
  renderHero: Hero;
  agents: Agent[];
  renderAgents: Agent[];
  folders: Folder[];
  browsers: BrowserPanel[];
  availableFolders: AvailableFolder[];
  selectedEntity: WorldEntity | null;
  selectedAgentIds: string[];
  selectedAgents: Agent[];
  completedAgentIds: ReadonlySet<string>;
  selectedTerminalProcess: string | null;
  folderContext?: FolderContext;
  folderNameById: Record<string, string>;
  browserZIndices: Record<string, number>;
  renameState: { folderId: string | null; value: string; dropdownOpen: boolean };
  magnetizedFolderIds: string[];
  tutorialMoveZone: TutorialMoveZone | null;
  tutorialMoveBounds: TutorialMoveZone | null;
  destinationMarker: { x: number; y: number } | null;
  tutorialCompletionVisible: boolean;
  dismissedTutorialOverlayStepId: string | null;
  inputDialog: InputConfig | null;
  messageDialog: DialogMessage | null;
  folderSelectDialog: FolderSelectDialogState | null;
  activeAgentTerminalId: string | null;
  terminals: Record<string, TerminalPanelRecord>;
  terminalZIndices: Record<string, number>;
  handleBack: () => void;
  handleAbility: (ability: CommandInvocation) => Promise<void>;
  handleSelect: (id: string, type: SelectedEntityRef['type'], options?: { additive?: boolean }) => void;
  handleSelectAgents: (ids: string[], options?: { additive?: boolean }) => void;
  handleDeselect: () => void;
  handleHeroMove: (x: number, y: number) => Promise<CommandRunResult>;
  handleAgentMove: (id: string, x: number, y: number) => CommandRunResult;
  handleAgentDragStart: (id: string) => void;
  handleAgentDragEnd: (id: string, data?: DragEndData) => void;
  handleFolderMove: (id: string, x: number, y: number) => Promise<CommandRunResult>;
  handleFolderDragEnd: (id: string) => void;
  handleBrowserMove: (id: string, x: number, y: number) => Promise<CommandRunResult>;
  handleBrowserMoveEnd: (id: string, x: number, y: number) => Promise<CommandRunResult>;
  handleBrowserResize: (id: string, width: number, height: number) => Promise<CommandRunResult>;
  handleBrowserResizeEnd: (id: string, width: number, height: number) => Promise<CommandRunResult>;
  handleBrowserUrlChange: (id: string, url: string) => Promise<CommandRunResult>;
  handleBrowserFaviconChange: (id: string, faviconUrl?: string | null) => Promise<CommandRunResult>;
  handleBrowserClose: (id: string) => Promise<CommandRunResult>;
  clearBrowserRefreshToken: (id: string) => void;
  bringBrowserToFront: (id: string) => void;
  handleTutorialBrowserMessage: (payload: { panelId: string; url: string; message: string }) => void;
  dismissTutorialCompletion: () => void;
  beginRename: (folder?: Folder) => void;
  handleRenameChange: (folderId: string, value: string) => void;
  submitRename: (value: string) => Promise<void>;
  handleRenameCancel: () => void;
  toggleRenameDropdown: () => void;
  handleRenamePickOption: (relativePath: string) => Promise<void>;
  closeActiveAgentTerminal: () => void;
  closeTerminalById: (terminalId: string) => Promise<CommandRunResult>;
  updateTerminalRecord: (
    terminalId: string,
    updates: Partial<TerminalPanelRecord>,
    persist?: boolean
  ) => Promise<CommandRunResult>;
  handleTerminalMove: (terminalId: string, x: number, y: number) => Promise<CommandRunResult>;
  handleTerminalMoveEnd: (terminalId: string, x: number, y: number) => Promise<CommandRunResult>;
  handleTerminalResize: (terminalId: string, width: number, height: number) => Promise<CommandRunResult>;
  handleTerminalResizeEnd: (terminalId: string, width: number, height: number) => Promise<CommandRunResult>;
  bringTerminalToFront: (terminalId: string) => void;
  handleTerminalProcessChange: (terminalId: string, processLabel: string | null) => void;
  closeInputDialog: () => void;
  closeMessageDialog: () => void;
  closeFolderSelectDialog: () => void;
  handleCanvasRightClick: (position: { x: number; y: number }, target: SelectedEntityRef | null) => void;
  handleHeroNameCommit: (name: string) => Promise<void>;
  handleAgentNameCommit: (agentId: string, name: string) => Promise<void>;
  handleSetHeroProvider: (provider: AgentProvider) => Promise<CommandRunResult>;
  handleSetHeroModel: (model: string) => Promise<CommandRunResult>;
  advanceHeroIntro: () => void;
  advanceFocusDemoStep: () => void;
  completeFocusDemo: () => void;
  skipTutorial: () => void;
  runCommand: (command: CommandInvocation) => Promise<CommandRunResult>;
  globalChatProps: GlobalChatProps;
  projectMode: ProjectModeReturn;
}

const okResult = (): CommandRunResult => ({ ok: true });
const errorResult = (error: string): CommandRunResult => ({ ok: false, error });

export function useWorkspaceController({
  workspace,
  onBack,
}: UseWorkspaceControllerParams): WorkspaceController {
  const nextZIndexRef = useRef<number>(WORKSPACE_CONSTANTS.INITIAL_Z_INDEX);
  const zIndex = useZIndexManager({ nextZIndexRef });
  const browserZIndexDomain = useMemo(
    () => ({
      browserZIndices: zIndex.browserZIndices,
      bringBrowserToFront: zIndex.bringBrowserToFront,
      syncBrowserIds: zIndex.syncBrowserIds,
    }),
    [zIndex.browserZIndices, zIndex.bringBrowserToFront, zIndex.syncBrowserIds]
  );
  const terminalZIndexDomain = useMemo(
    () => ({
      terminalZIndices: zIndex.terminalZIndices,
      bringTerminalToFront: zIndex.bringTerminalToFront,
      syncTerminalIds: zIndex.syncTerminalIds,
    }),
    [zIndex.terminalZIndices, zIndex.bringTerminalToFront, zIndex.syncTerminalIds]
  );
  const {
    hero,
    setHero,
    agents,
    setAgents,
    folders,
    setFolders,
    browsers,
    setBrowsers,
    availableFolders,
    refreshAvailableFolders,
    reloadAgents,
    reloadFolders,
  } = useWorkspaceEntities(workspace.path);
  const { settings } = useAppSettings();

  const [selectedEntityRef, setSelectedEntityRef] = useState<SelectedEntityRef | null>(null);
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const lastTabAgentRef = useRef<string | null>(null);
  const tutorialStateRef = useRef<TutorialState | undefined>(undefined);
  const { registerHotkeyHandler } = useHotkeyRouter();
  const selectedAgentIdSet = useMemo(() => new Set(selectedAgentIds), [selectedAgentIds]);
  const selectedAgents = useMemo(
    () => agents.filter((agent) => selectedAgentIdSet.has(agent.id)),
    [agents, selectedAgentIdSet]
  );
  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);

  const {
    dialogs,
    setMessageDialog,
    closeInputDialog: baseCloseInputDialog,
    closeMessageDialog: baseCloseMessageDialog,
    closeFolderSelectDialog: baseCloseFolderSelectDialog,
  } = useDialogs();

  const { activeAgentTerminalId, setActiveAgentTerminalId, closeAgentTerminals } = useAgentTerminalManager();

  const {
    applyDetachedAgentIds,
    persistAgentPosition,
    handleAgentMove: handleAgentMovePersisted,
    resetAgentNameSequenceIndex,
    createAgent,
    destroyAgent,
    openAgentTerminal,
    clearAgentTerminalState,
    attachAgentToFolder,
    detachAgent,
  } = useAgentManager({
    workspacePath: workspace.path,
    agents,
    setAgents,
    folders,
    selectedEntity: selectedEntityRef,
    setSelectedAgentIds,
    setSelectedEntity: setSelectedEntityRef,
    setMessageDialog,
    activeAgentTerminalId,
    setActiveAgentTerminalId,
    closeAgentTerminals,
  });

  const {
    terminals,
    terminalList,
    terminalZIndices,
    reloadTerminals,
    bringTerminalToFront,
    addTerminal,
    closeTerminalById,
    updateTerminalRecord,
    handleTerminalMove,
    handleTerminalMoveEnd,
    handleTerminalResize,
    handleTerminalResizeEnd,
    terminalProcessById,
    handleTerminalProcessChange,
  } = useWorkspaceTerminals({
    workspacePath: workspace.path,
    selectedEntityRef,
    setSelectedEntityRef,
    setMessageDialog,
    zIndex: terminalZIndexDomain,
  });

  const {
    renameState,
    beginRename,
    handleRenameChange,
    handleRenameCancel,
    submitRename,
    handleRenamePickOption,
    toggleRenameDropdown,
    renameFolder,
    handleFolderMove,
    handleFolderDragEnd,
    createFolder,
    removeFolder,
    deleteFolder,
    createWorktree,
    worktreeSync,
    worktreeMerge,
    undoMerge,
    retryRestore,
    setRenamingFolderId,
    setRenameDropdownOpen,
  } = useWorkspaceFolders({
    workspacePath: workspace.path,
    folders,
    setFolders,
    setAgents,
    selectedEntityRef,
    setSelectedEntityRef,
    setSelectedAgentIds,
    setMessageDialog,
    refreshAvailableFolders,
    reloadFolders,
    reloadAgents,
    applyDetachedAgentIds,
    persistAgentPosition,
    onFolderRenamed: reloadTerminals,
  });

  const {
    browserZIndices,
    bringBrowserToFront,
    handleBrowserMove,
    handleBrowserMoveEnd,
    handleBrowserResize,
    handleBrowserResizeEnd,
    handleBrowserUrlChange: baseHandleBrowserUrlChange,
    handleBrowserFaviconChange,
    handleBrowserRefresh,
    handleBrowserClose,
    clearBrowserRefreshToken,
  } = useBrowserManager({
    workspacePath: workspace.path,
    browsers,
    setBrowsers,
    setMessageDialog,
    selectedEntityId: selectedEntityRef?.type === 'browser' ? selectedEntityRef.id : null,
    setSelectedEntity: setSelectedEntityRef,
    zIndex: browserZIndexDomain,
  });

  useWorktreeConflicts(workspace.path, folders, setFolders);

  const folderNameById = useMemo(
    () => Object.fromEntries(folders.map((folder) => [folder.id, folder.name])),
    [folders]
  );

  const {
    renderAgents,
    renderHero,
    destinationMarker,
    handleCanvasRightClick,
    handleHeroMove,
    clearMovementGroupIfComplete,
    clearPendingArrival,
  } = useMovementController({
    agents,
    hero,
    folders,
    selectedEntityRef,
    selectedAgentIds,
    setAgents,
    setHero,
    workspacePath: workspace.path,
    attachAgentToFolder,
    detachAgent,
  });

  const [tutorialStateSnapshot, setTutorialStateSnapshot] = useState<TutorialState | undefined>(undefined);

  const projectMode = useProjectMode({
    workspacePath: workspace.path,
    folders: folders as AnyFolder[],
    agents,
    terminals,
    browsers,
    activeAgentTerminalId,
    tutorialState: tutorialStateSnapshot,
  });

  const layoutFoldersForMagnetism = useMemo(() => {
    if (!projectMode.layoutActive && !projectMode.focusModeActive) return folders;
    return folders.map((f) => {
      const p = projectMode.positionOverrides.get(f.id);
      return p ? { ...f, x: p.x, y: p.y } : f;
    });
  }, [folders, projectMode.focusModeActive, projectMode.layoutActive, projectMode.positionOverrides]);

  const rosterAgentIds = useMemo(() => agents.map((agent) => agent.id), [agents]);

  const {
    handleAgentMove,
    handleAgentMoveBatch,
    handleAgentDragStart,
    handleAgentDragEnd,
    magnetizedFolderIds,
  } = useAgentMagnetism({
    agents,
    folders: layoutFoldersForMagnetism,
    positionOverrides:
      projectMode.layoutActive || projectMode.focusModeActive ? projectMode.positionOverrides : undefined,
    projectZones: projectMode.projectZones,
    layoutActive: projectMode.layoutActive,
    focusModeActive: projectMode.focusModeActive,
    setAgents,
    persistAgentPosition,
    attachAgentToFolder,
    detachAgent,
    clearMovementGroupIfComplete,
    clearPendingArrival,
  });

  const tutorialCore = useWorkspaceTutorialCore({
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
    handleBrowserClose,
    handleBrowserMove,
    handleBrowserMoveEnd,
    handleBrowserResize,
    handleBrowserResizeEnd,
    handleTerminalMove,
    handleTerminalMoveEnd,
    handleTerminalResize,
    handleTerminalResizeEnd,
    handleCanvasRightClick,
    handleHeroMove,
    handleAgentMove,
    handleAgentDragStart,
    handleAgentDragEnd,
  });

  const {
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
    skipTutorial,
    updateTutorial,
    ensureTutorialServer,
    tutorialPromptRunId,
    tutorialPromptRunId2,
    setTutorialPromptRunId,
    setTutorialPromptRunId2,
    tutorialAgentId,
    tutorialAgentId2,
    tutorialFolderId,
    tutorialFolderId2,
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
  } = tutorialCore;

  useEffect(() => {
    setTutorialStateSnapshot(tutorialState);
  }, [tutorialState]);

  const {
    selectedEntity,
    selectedTerminalProcess,
    folderContext,
    handleSelect,
    handleSelectAgents,
    handleDeselect,
  } = useWorkspaceSelectionState({
    workspacePath: workspace.path,
    hero,
    agents,
    folders,
    browsers,
    terminals,
    terminalProcessById,
    renameState,
    setRenamingFolderId,
    setRenameDropdownOpen,
    selectedEntityRef,
    setSelectedEntityRef,
    selectedAgentIds,
    setSelectedAgentIds,
    bringBrowserToFront,
    bringTerminalToFront,
  });

  const { completedAgentIds, clearAgentCompletionBadges } = useAgentCompletionBadges({
    workspacePath: workspace.path,
    agents,
    setAgents,
    selectedEntityRef,
    selectedAgentIds,
  });

  useEffect(() => {
    if (!activeAgentTerminalId) return;
    if (selectedEntityRef?.type !== 'agent') return;
    if (selectedEntityRef.id === activeAgentTerminalId) return;
    setActiveAgentTerminalId(selectedEntityRef.id);
  }, [activeAgentTerminalId, selectedEntityRef, setActiveAgentTerminalId]);

  const handleSelectWithAgentTerminal = useCallback(
    (id: string, type: SelectedEntityRef['type'], options?: { additive?: boolean }) => {
      if (!isSelectionAllowed(id, type)) {
        return;
      }
      handleSelect(id, type, options);
      if (type === 'agent') {
        lastTabAgentRef.current = id;
        clearAgentCompletionBadges([id]);
        if (activeAgentTerminalId && !options?.additive) {
          setActiveAgentTerminalId(id);
        }
      }
    },
    [
      activeAgentTerminalId,
      clearAgentCompletionBadges,
      handleSelect,
      isSelectionAllowed,
      setActiveAgentTerminalId,
    ]
  );

  const handleSelectAgentsWithTerminal = useCallback(
    (ids: string[], options?: { additive?: boolean }) => {
      if (tutorialEnabled) {
        if (ids.length !== 1 || !isSelectionAllowed(ids[0], 'agent')) {
          return;
        }
      }
      handleSelectAgents(ids, options);
      clearAgentCompletionBadges(ids);
      if (ids.length === 1) {
        lastTabAgentRef.current = ids[0];
        if (activeAgentTerminalId && !options?.additive) {
          setActiveAgentTerminalId(ids[0]);
        }
      }
    },
    [
      activeAgentTerminalId,
      clearAgentCompletionBadges,
      handleSelectAgents,
      isSelectionAllowed,
      setActiveAgentTerminalId,
      tutorialEnabled,
    ]
  );

  const handleDeselectWithTutorial = useCallback(() => {
    if (
      tutorialEnabled &&
      [
        'open-global-chat',
        'send-prompt',
        'open-terminal',
        'close-terminal',
        'attach-agent',
        'rename-project',
        'open-global-chat-2',
        'send-prompt-2',
        'attach-agent-2',
        'rename-project-2',
      ].includes(tutorialState.stepId)
    ) {
      return;
    }
    handleDeselect();
  }, [handleDeselect, tutorialEnabled, tutorialState.stepId]);

  const handleAgentMoveWithSelection = useCallback(
    (id: string, x: number, y: number): CommandRunResult => {
      if (!canMoveUnits) {
        return okResult();
      }
      const selectionIds =
        selectedAgentIds.length > 0
          ? selectedAgentIds
          : selectedEntityRef?.type === 'agent'
            ? [selectedEntityRef.id]
            : [];
      if (selectionIds.length > 1 && selectionIds.includes(id)) {
        const anchor = agentById.get(id);
        if (!anchor) {
          return handleAgentMoveWithTutorial(id, x, y);
        }
        const dx = x - anchor.x;
        const dy = y - anchor.y;
        const moves = selectionIds
          .map((agentId) => {
            const agent = agentById.get(agentId);
            if (!agent) return null;
            return { id: agentId, x: agent.x + dx, y: agent.y + dy };
          })
          .filter((move): move is { id: string; x: number; y: number } => move !== null);
        return handleAgentMoveBatch(moves);
      }
      return handleAgentMoveWithTutorial(id, x, y);
    },
    [
      agentById,
      canMoveUnits,
      handleAgentMoveBatch,
      handleAgentMoveWithTutorial,
      selectedAgentIds,
      selectedEntityRef,
    ]
  );

  const handleAgentDragEndWithSelection = useCallback(
    (id: string, data?: DragEndData) => {
      const selectionIds = resolveAgentDragEndSelection(selectedAgentIds, selectedEntityRef, id);
      selectionIds.forEach((agentId) => {
        if (agentId === id) {
          handleAgentDragEndWithTutorial(agentId, data);
        } else {
          handleAgentDragEndWithTutorial(agentId);
        }
      });
    },
    [handleAgentDragEndWithTutorial, selectedAgentIds, selectedEntityRef]
  );

  const handleAgentCommandMove = useCallback(
    async (id: string, x: number, y: number): Promise<CommandRunResult> => {
      if (!canMoveUnits) return okResult();
      const result = await handleAgentMovePersisted(id, x, y);
      if (result.ok && (projectMode.layoutActive || projectMode.focusModeActive)) {
        projectMode.applyLayoutOverride(id, { x, y });
      }
      return result;
    },
    [canMoveUnits, handleAgentMovePersisted, projectMode]
  );

  const handleFolderMoveWithTutorial = useCallback(
    async (id: string, x: number, y: number) => {
      const result = await handleFolderMove(id, x, y);
      if (result.ok && (projectMode.layoutActive || projectMode.focusModeActive)) {
        projectMode.applyLayoutOverride(id, { x, y });
      }
      return result;
    },
    [handleFolderMove, projectMode]
  );

  const handleFolderDragEndWithTutorial = useCallback(
    (id: string) => {
      handleFolderDragEnd(id);
    },
    [handleFolderDragEnd]
  );

  const createTerminal = async (
    originRelativePath: string,
    x: number,
    y: number,
    originFolderId?: string
  ) => {
    const result = await workspaceClient.createTerminal(
      workspace.path,
      originRelativePath,
      x,
      y,
      originFolderId
    );
    if (!result.success || !result.terminal) {
      const errorMessage = result.error || 'Failed to create terminal';
      setMessageDialog({
        title: 'Error',
        message: errorMessage,
        type: 'error',
      });
      return errorResult(errorMessage);
    }

    const terminal = result.terminal;
    addTerminal(terminal);
    return okResult();
  };

  const handleBack = useCallback(() => {
    onBack();
  }, [onBack]);

  const closeActiveAgentTerminal = useCallback(() => {
    if (!activeAgentTerminalId) return;
    void openAgentTerminal(activeAgentTerminalId);
  }, [activeAgentTerminalId, openAgentTerminal]);

  const handleHeroNameCommit = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed || trimmed === hero.name) return;
      const success = await workspaceClient.updateHeroName(workspace.path, trimmed);
      if (!success) {
        setMessageDialog({
          title: 'Error',
          message: 'Failed to update hero name',
          type: 'error',
        });
        return;
      }
      setHero((prev) => ({ ...prev, name: trimmed }));
    },
    [hero.name, setHero, setMessageDialog, workspace.path]
  );

  const handleSetAgentModel = useCallback(
    async (agentId: string, model: string): Promise<CommandRunResult> => {
      const result = await workspaceClient.updateAgentModel(agentId, model);
      if (!result.success) {
        return errorResult(result.error ?? 'Failed to update agent model');
      }
      setAgents((prev) =>
        prev.map((agent) => (agent.id === agentId ? { ...agent, model, reasoningEffort: null } : agent))
      );
      return okResult();
    },
    [setAgents]
  );

  const handleSetAgentReasoningEffort = useCallback(
    async (agentId: string, reasoningEffort: string | null): Promise<CommandRunResult> => {
      const result = await workspaceClient.updateAgentReasoningEffort(agentId, reasoningEffort);
      if (!result.success) {
        return errorResult(result.error ?? 'Failed to update agent reasoning effort');
      }
      setAgents((prev) =>
        prev.map((agent) => (agent.id === agentId ? { ...agent, reasoningEffort } : agent))
      );
      return okResult();
    },
    [setAgents]
  );

  const handleProviderStatus = useCallback(
    async (provider: AgentProvider, options?: { force?: boolean }): Promise<CommandRunResult> => {
      try {
        await workspaceClient.agentConnectProviderStatus(provider, options);
        return okResult();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load provider status';
        return errorResult(message);
      }
    },
    []
  );

  const handleProviderInstall = useCallback(async (provider: AgentProvider): Promise<CommandRunResult> => {
    try {
      await workspaceClient.agentConnectProviderInstall(provider);
      return okResult();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to install provider';
      return errorResult(message);
    }
  }, []);

  const handleProvidersBootstrap = useCallback(async (): Promise<CommandRunResult> => {
    try {
      await workspaceClient.agentConnectBootstrap();
      return okResult();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load providers';
      return errorResult(message);
    }
  }, []);

  const handleProvidersRefresh = useCallback(
    async (options?: { force?: boolean }): Promise<CommandRunResult> => {
      try {
        await workspaceClient.agentConnectProvidersRefresh(options);
        return okResult();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to refresh providers';
        return errorResult(message);
      }
    },
    []
  );

  const handleSetHeroProvider = useCallback(
    async (provider: AgentProvider): Promise<CommandRunResult> => {
      const result = await workspaceClient.setHeroProvider(workspace.path, provider);
      if (!result.success) {
        return errorResult(result.error ?? 'Failed to update hero provider');
      }
      const updated = await workspaceClient.loadHero(workspace.path);
      setHero(updated);
      setAbilityVariantSelection(
        'create-agent-claude',
        provider === 'codex' ? 'create-agent-codex' : 'create-agent-claude'
      );
      await refreshAppSettings();
      if (tutorialEnabled && tutorialState.stepId === 'hero-provider') {
        updateTutorial({ stepId: 'hero-intro' });
      }
      return okResult();
    },
    [setHero, tutorialEnabled, tutorialState.stepId, updateTutorial, workspace.path]
  );

  const handleSetHeroModel = useCallback(
    async (model: string): Promise<CommandRunResult> => {
      const result = await workspaceClient.setHeroModel(workspace.path, model);
      if (!result.success) {
        return errorResult(result.error ?? 'Failed to update hero model');
      }
      const updated = await workspaceClient.loadHero(workspace.path);
      setHero(updated);
      return okResult();
    },
    [setHero, workspace.path]
  );

  const handleAgentSendPrompt = useCallback(
    async (
      agentId: string,
      prompt: string,
      relativePath: string,
      runId?: string,
      resumeSessionId?: string | null
    ): Promise<CommandRunResult> => {
      const { tutorialMode, tutorialScenario } = tutorialEnabled
        ? getTutorialRunOptionsForAgent(tutorialState, agentId)
        : { tutorialMode: false };
      const result = await workspaceClient.agentConnectRunAgent({
        agentId,
        workspacePath: workspace.path,
        relativePath,
        prompt,
        runId,
        resumeSessionId,
        tutorialMode,
        tutorialScenario,
      });
      if (!result.success) {
        return errorResult(result.error ?? 'Failed to send agent prompt');
      }
      return okResult();
    },
    [tutorialEnabled, tutorialState, workspace.path]
  );

  const handleHeroSendPrompt = useCallback(
    async (prompt: string, relativePath: string, runId?: string): Promise<CommandRunResult> => {
      const { tutorialMode } = tutorialEnabled
        ? getTutorialRunOptionsForHero(tutorialState)
        : { tutorialMode: false };
      const result = await workspaceClient.heroSendPrompt({
        workspacePath: workspace.path,
        relativePath,
        prompt,
        runId,
        tutorialMode,
      });
      if (!result.success) {
        return errorResult(result.error ?? 'Failed to send hero prompt');
      }
      return okResult();
    },
    [tutorialEnabled, tutorialState, workspace.path]
  );

  const handleCancelAgentRun = useCallback(async (agentId: string): Promise<CommandRunResult> => {
    const result = await workspaceClient.agentConnectCancelAgentRun(agentId);
    if (!result.success) {
      return errorResult(result.error ?? 'Failed to cancel agent run');
    }
    return okResult();
  }, []);

  const handleCancelHeroRun = useCallback(async (): Promise<CommandRunResult> => {
    const result = await workspaceClient.agentConnectCancelHeroRun(workspace.path);
    if (!result.success) {
      return errorResult(result.error ?? 'Failed to cancel hero run');
    }
    return okResult();
  }, [workspace.path]);

  const handleAgentNameCommit = useCallback(
    async (agentId: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const agent = agents.find((entry) => entry.id === agentId);
      if (!agent || trimmed === agent.displayName) return;
      const success = await workspaceClient.updateAgentName(workspace.path, agentId, trimmed);
      if (!success) {
        setMessageDialog({
          title: 'Error',
          message: 'Failed to update agent name',
          type: 'error',
        });
        return;
      }
      setAgents((prev) =>
        prev.map((entry) => (entry.id === agentId ? { ...entry, displayName: trimmed } : entry))
      );
    },
    [agents, setAgents, setMessageDialog, workspace.path]
  );

  const commandContext: CommandContext = {
    selectedEntity,
    hero,
    agents,
    folders,
    browsers,
    terminals: terminalList,
    folderContext,
  };

  const applyLayoutOverride = useCallback(
    (id: string, override: { x?: number; y?: number; width?: number; height?: number }) => {
      if (projectMode.layoutActive || projectMode.focusModeActive) {
        projectMode.applyLayoutOverride(id, override);
      }
    },
    [projectMode]
  );

  const applySizeOnly = useCallback(
    (id: string, width: number, height: number) => {
      if (projectMode.layoutActive || projectMode.focusModeActive) {
        projectMode.applyLayoutOverride(id, { width, height });
      }
    },
    [projectMode]
  );

  const handleBrowserMoveWithLayout = useCallback(
    async (id: string, x: number, y: number) => {
      const result = await handleBrowserMoveWithTutorial(id, x, y);
      if (result.ok) applyLayoutOverride(id, { x, y });
      return result;
    },
    [applyLayoutOverride, handleBrowserMoveWithTutorial]
  );

  const handleBrowserResizeWithLayout = useCallback(
    async (id: string, width: number, height: number) => {
      const result = await handleBrowserResizeWithTutorial(id, width, height);
      if (result.ok) applySizeOnly(id, width, height);
      return result;
    },
    [applySizeOnly, handleBrowserResizeWithTutorial]
  );

  const handleBrowserMoveEndWithLayout = useCallback(
    async (id: string, x: number, y: number) => {
      const result = await handleBrowserMoveEndWithTutorial(id, x, y);
      if (result.ok) applyLayoutOverride(id, { x, y });
      return result;
    },
    [applyLayoutOverride, handleBrowserMoveEndWithTutorial]
  );

  const handleBrowserResizeEndWithLayout = useCallback(
    async (id: string, width: number, height: number) => {
      const result = await handleBrowserResizeEndWithTutorial(id, width, height);
      if (result.ok) applySizeOnly(id, width, height);
      return result;
    },
    [applySizeOnly, handleBrowserResizeEndWithTutorial]
  );

  const handleTerminalMoveWithLayout = useCallback(
    async (id: string, x: number, y: number) => {
      const result = await handleTerminalMoveWithTutorial(id, x, y);
      if (result.ok) applyLayoutOverride(id, { x, y });
      return result;
    },
    [applyLayoutOverride, handleTerminalMoveWithTutorial]
  );

  const handleTerminalResizeWithLayout = useCallback(
    async (id: string, width: number, height: number) => {
      const result = await handleTerminalResizeWithTutorial(id, width, height);
      if (result.ok) applySizeOnly(id, width, height);
      return result;
    },
    [applySizeOnly, handleTerminalResizeWithTutorial]
  );

  const handleTerminalMoveEndWithLayout = useCallback(
    async (id: string, x: number, y: number) => {
      const result = await handleTerminalMoveEndWithTutorial(id, x, y);
      if (result.ok) applyLayoutOverride(id, { x, y });
      return result;
    },
    [applyLayoutOverride, handleTerminalMoveEndWithTutorial]
  );

  const handleTerminalResizeEndWithLayout = useCallback(
    async (id: string, width: number, height: number) => {
      const result = await handleTerminalResizeEndWithTutorial(id, width, height);
      if (result.ok) applySizeOnly(id, width, height);
      return result;
    },
    [applySizeOnly, handleTerminalResizeEndWithTutorial]
  );

  const { runCommandWithContext } = useWorkspaceCommandBridge({
    workspacePath: workspace.path,
    context: commandContext,
    handlers: {
      createAgent,
      createFolder: createFolderWithTutorial,
      createBrowser,
      createTerminal,
      openAgentTerminal,
      refreshBrowser: handleBrowserRefresh,
      clearAgentTerminalState,
      attachAgentToFolder,
      detachAgent,
      closeBrowser: handleBrowserClose,
      closeTerminal: closeTerminalById,
      removeFolder,
      deleteFolder,
      renameFolder,
      createWorktree,
      worktreeSync,
      worktreeMerge,
      undoMerge,
      retryRestore,
      destroyAgent,
      moveAgent: handleAgentCommandMove,
      moveFolder: handleFolderMoveWithTutorial,
      moveBrowser: handleBrowserMoveWithLayout,
      moveTerminal: handleTerminalMoveWithLayout,
      resizeBrowser: handleBrowserResizeWithLayout,
      resizeTerminal: handleTerminalResizeWithLayout,
      moveHero: handleHeroMoveWithTutorial,
      setAgentModel: handleSetAgentModel,
      setAgentReasoningEffort: handleSetAgentReasoningEffort,
      providerStatus: handleProviderStatus,
      providerInstall: handleProviderInstall,
      providersBootstrap: handleProvidersBootstrap,
      providersRefresh: handleProvidersRefresh,
      setHeroProvider: handleSetHeroProvider,
      setHeroModel: handleSetHeroModel,
      agentSendPrompt: handleAgentSendPrompt,
      heroSendPrompt: handleHeroSendPrompt,
      cancelAgentRun: handleCancelAgentRun,
      cancelHeroRun: handleCancelHeroRun,
    },
  });

  const { handleAbility } = useWorkspaceAbilities({
    workspacePath: workspace.path,
    selectedEntity,
    selectedAgentIds,
    hero,
    agents,
    folders,
    focusedProjectIds: projectMode.focusedProjectIds,
    runCommandWithContext,
    beginRename: () => beginRenameWithTutorial(),
    tutorialState,
  });

  useEffect(() => {
    tutorialStateRef.current = tutorialState;
  }, [tutorialState]);

  const heroNameForChat = (renderHero ?? hero).name;
  const tutorialPromptStep = getTutorialPromptStep(tutorialState);
  const prefillText = tutorialPromptStep?.promptText;
  const { globalChatProps, openFromHotkey, closeFromHotkey, isGlobalChatVisible } = useGlobalChat({
    agents,
    folders,
    heroName: heroNameForChat,
    heroId: 'hero',
    selectedEntity,
    selectedAgentIds,
    runCommand: runCommandWithContext,
    prefillText,
  });

  useTutorialChatEffects({
    tutorialEnabled,
    tutorialState,
    tutorialAgentId,
    tutorialAgentId2,
    selectedEntityRef,
    setSelectedEntityRef,
    isGlobalChatVisible,
    updateTutorial,
    activeAgentTerminalId,
    closeAgentTerminals,
  });

  const tutorialChatProps = useMemo(
    () =>
      buildTutorialChatProps({
        tutorialEnabled,
        tutorialPromptStep,
        tutorialAgentId,
        tutorialAgentId2,
        tutorialFolderId,
        tutorialFolderId2,
        agents,
        folders,
        selectedEntityRef,
        globalChatProps,
        workspacePath: workspace.path,
        ensureTutorialServer,
        setTutorialPromptRunId,
        setTutorialPromptRunId2,
        updateTutorial,
      }),
    [
      tutorialEnabled,
      tutorialPromptStep,
      tutorialAgentId,
      tutorialAgentId2,
      tutorialFolderId,
      tutorialFolderId2,
      agents,
      folders,
      selectedEntityRef,
      globalChatProps,
      workspace.path,
      ensureTutorialServer,
      setTutorialPromptRunId,
      setTutorialPromptRunId2,
      updateTutorial,
    ]
  );

  const openGlobalChatWithTutorial = useCallback(() => {
    if (
      !canOpenTutorialGlobalChat(tutorialEnabled, tutorialState, tutorialPromptRunId, tutorialPromptRunId2)
    ) {
      return;
    }
    openFromHotkey();
  }, [openFromHotkey, tutorialEnabled, tutorialPromptRunId, tutorialPromptRunId2, tutorialState]);

  const closeGlobalChatWithTutorial = useCallback(() => {
    closeFromHotkey();
  }, [closeFromHotkey]);

  useGlobalChatHotkeys({
    registerHotkeyHandler,
    openGlobalChat: openGlobalChatWithTutorial,
    closeGlobalChat: closeGlobalChatWithTutorial,
    isGlobalChatVisible,
  });

  useSelectionHotkeys({
    registerHotkeyHandler,
    rosterAgentIds,
    selectedAgentIds,
    selectedAgentIdSet,
    selectedEntityRef,
    setSelectedEntityRef,
    setSelectedAgentIds,
    activeAgentTerminalId,
    setActiveAgentTerminalId,
    lastTabAgentRef,
  });

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    return registerHotkeyHandler({
      priority: 110,
      handler: (event) => {
        const key = event.key.toLowerCase();
        if (key !== 'y') return false;
        if (!event.shiftKey || event.altKey || (!event.metaKey && !event.ctrlKey)) return false;
        if (isInputCaptured()) return false;

        event.preventDefault();
        void (async () => {
          const result = await resetAgentNameSequenceIndex();
          if (!result.ok) {
            setMessageDialog({
              title: 'Error',
              message: result.error ?? 'Failed to reset workspace agent name index',
              type: 'error',
            });
            return;
          }
          setMessageDialog({
            title: 'Dev Shortcut',
            message: 'Workspace agent name index reset.',
            type: 'info',
          });
        })();
        return true;
      },
    });
  }, [registerHotkeyHandler, resetAgentNameSequenceIndex, setMessageDialog]);

  return {
    registerHotkeyHandler,
    workspace,
    hero,
    tutorialState,
    renderHero,
    agents,
    renderAgents,
    folders,
    browsers,
    availableFolders,
    selectedEntity,
    selectedAgentIds,
    selectedAgents,
    completedAgentIds,
    selectedTerminalProcess,
    folderContext,
    folderNameById,
    browserZIndices,
    renameState,
    magnetizedFolderIds,
    tutorialMoveZone,
    tutorialMoveBounds,
    destinationMarker,
    tutorialCompletionVisible,
    dismissedTutorialOverlayStepId,
    inputDialog: dialogs.input,
    messageDialog: dialogs.message,
    folderSelectDialog: dialogs.folderSelect,
    activeAgentTerminalId,
    terminals,
    terminalZIndices,
    handleBack,
    handleAbility,
    handleSelect: handleSelectWithAgentTerminal,
    handleSelectAgents: handleSelectAgentsWithTerminal,
    handleDeselect: handleDeselectWithTutorial,
    handleHeroMove: handleHeroMoveWithTutorial,
    handleAgentMove: handleAgentMoveWithSelection,
    handleAgentDragStart: handleAgentDragStartWithTutorial,
    handleAgentDragEnd: handleAgentDragEndWithSelection,
    handleFolderMove: handleFolderMoveWithTutorial,
    handleFolderDragEnd: handleFolderDragEndWithTutorial,
    handleBrowserMove: handleBrowserMoveWithLayout,
    handleBrowserMoveEnd: handleBrowserMoveEndWithLayout,
    handleBrowserResize: handleBrowserResizeWithLayout,
    handleBrowserResizeEnd: handleBrowserResizeEndWithLayout,
    handleBrowserUrlChange: handleBrowserUrlChangeWithTutorial,
    handleBrowserFaviconChange,
    handleBrowserClose: handleBrowserCloseWithTutorial,
    clearBrowserRefreshToken,
    bringBrowserToFront,
    handleTutorialBrowserMessage,
    dismissTutorialCompletion,
    beginRename: beginRenameWithTutorial,
    handleRenameChange,
    submitRename: submitRenameWithTutorial,
    handleRenameCancel: handleRenameCancelWithTutorial,
    toggleRenameDropdown,
    handleRenamePickOption: handleRenamePickOptionWithTutorial,
    closeTerminalById,
    updateTerminalRecord,
    handleTerminalMove: handleTerminalMoveWithLayout,
    handleTerminalMoveEnd: handleTerminalMoveEndWithLayout,
    handleTerminalResize: handleTerminalResizeWithLayout,
    handleTerminalResizeEnd: handleTerminalResizeEndWithLayout,
    bringTerminalToFront,
    handleTerminalProcessChange,
    closeActiveAgentTerminal,
    closeInputDialog: baseCloseInputDialog,
    closeMessageDialog: baseCloseMessageDialog,
    closeFolderSelectDialog: baseCloseFolderSelectDialog,
    handleCanvasRightClick: handleCanvasRightClickWithTutorial,
    handleHeroNameCommit,
    handleAgentNameCommit,
    handleSetHeroProvider,
    handleSetHeroModel,
    advanceHeroIntro,
    advanceFocusDemoStep,
    completeFocusDemo,
    skipTutorial,
    runCommand: runCommandWithContext,
    globalChatProps: tutorialChatProps,
    projectMode,
  };
}
