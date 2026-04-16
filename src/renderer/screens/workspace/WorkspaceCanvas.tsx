import {
  lazy,
  Profiler,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import Canvas from '../../components/canvas/Canvas';
import HeroEntity from '../../components/canvas/HeroEntity';
import AgentEntity from '../../components/canvas/AgentEntity';
import FolderEntity from '../../components/canvas/FolderEntity';
import AttachmentBeams from '../../components/canvas/AttachmentBeams';
import DestinationMarker from '../../components/canvas/DestinationMarker';
import BottomBar from '../../components/hud/BottomBar';
import AgentRosterOverlay from '../../components/AgentRosterOverlay';
import MinimapOverlay from '../../components/minimap/MinimapOverlay';
import { createCameraStore, type CameraStore } from '../../components/minimap/cameraStore';
import type { CanvasCameraControls, CanvasCameraState } from '../../components/canvas/types';
import type { EntityType } from '../../../shared/types';
import type { WorkspaceController } from './useWorkspaceController';
import { getAgentTerminalLayoutId } from './useProjectMode';
import { resolveDragSelection, type SelectionCandidate } from './selection';
import { useAbilityHotkeys } from './hotkeys/useAbilityHotkeys';
import { useAbilityResolution } from './useAbilityResolution';
import * as WORKSPACE_CONSTANTS from './constants';
import { DEFAULT_HERO } from '../../../shared/heroDefaults';
import { setAbilityVariantSelection, useAppSettings } from '../../state/appSettingsStore';
import { DEFAULT_TUTORIAL_STATE } from '../../tutorial/constants';
import { getTutorialAbilityPolicy } from '../../tutorial/policy';
import PerformanceOverlay from './PerformanceOverlay';
import { useHeroThinking } from '../../hooks/useHeroThinking';
import {
  useAdaptivePerformanceTier,
  useFrameDiagnostics,
  useRenderDiagnostics,
} from './usePerformanceDiagnostics';

interface WorkspaceCanvasProps {
  controller: WorkspaceController;
}

const PERF_OVERLAY_STORAGE_KEY = `vibecraft:workspace-perf-overlay:${import.meta.env.DEV ? 'dev' : 'prod'}`;
const CANVAS_BG_KEY = `vibecraft:canvas-bg:${import.meta.env.DEV ? 'dev' : 'prod'}`;
const MINIMAP_COLLAPSED_KEY = `vibecraft:minimap-collapsed:${import.meta.env.DEV ? 'dev' : 'prod'}`;
const DEFAULT_CANVAS_BG = '#0b0d14';

const areCamerasEqual = (left: CanvasCameraState, right: CanvasCameraState): boolean =>
  left.zoom === right.zoom &&
  left.pan.x === right.pan.x &&
  left.pan.y === right.pan.y &&
  left.viewport.width === right.viewport.width &&
  left.viewport.height === right.viewport.height;

const nowMs = (): number => (typeof performance === 'undefined' ? Date.now() : performance.now());
const INITIAL_CAMERA: CanvasCameraState = {
  pan: { x: 0, y: 0 },
  zoom: 1,
  viewport: { width: 0, height: 0 },
};

const BrowserEntity = lazy(() => import('../../components/canvas/BrowserEntity'));
const TerminalEntity = lazy(() => import('../../components/canvas/TerminalEntity'));
const AgentTerminalPanel = lazy(() => import('../../components/AgentTerminalPanel'));
const GlobalChat = lazy(() => import('../../components/GlobalChat'));
const ProjectPanel = lazy(() => import('../../components/canvas/ProjectPanel'));

export default function WorkspaceCanvas({ controller }: WorkspaceCanvasProps) {
  const {
    registerHotkeyHandler,
    workspace,
    hero,
    renderHero,
    agents,
    renderAgents,
    folders,
    browsers,
    availableFolders,
    selectedEntity,
    selectedAgentIds,
    selectedAgents,
    selectedTerminalProcess,
    folderContext,
    activeAgentTerminalId,
    terminals,
    terminalZIndices,
    folderNameById,
    browserZIndices,
    renameState,
    magnetizedFolderIds,
    tutorialMoveZone,
    tutorialMoveBounds,
    destinationMarker,
    handleSelect,
    handleSelectAgents,
    handleDeselect,
    handleAbility,
    handleHeroMove,
    handleAgentMove,
    handleAgentDragStart,
    handleAgentDragEnd,
    handleFolderMove,
    handleFolderDragEnd,
    handleBrowserMove,
    handleBrowserMoveEnd,
    handleBrowserResize,
    handleBrowserResizeEnd,
    handleBrowserUrlChange,
    handleBrowserFaviconChange,
    handleBrowserClose,
    clearBrowserRefreshToken,
    bringBrowserToFront,
    handleTutorialBrowserMessage,
    beginRename,
    handleRenameChange,
    submitRename,
    handleRenameCancel,
    toggleRenameDropdown,
    handleRenamePickOption,
    closeActiveAgentTerminal,
    closeTerminalById,
    updateTerminalRecord,
    handleTerminalMove,
    handleTerminalMoveEnd,
    handleTerminalResize,
    handleTerminalResizeEnd,
    bringTerminalToFront,
    handleTerminalProcessChange,
    handleCanvasRightClick,
    handleHeroNameCommit,
    handleSetHeroModel,
    handleAgentNameCommit,
    runCommand,
    globalChatProps,
    completedAgentIds,
    projectMode,
    advanceFocusDemoStep,
    completeFocusDemo,
  } = controller;

  const heroToRender = renderHero ?? hero ?? DEFAULT_HERO;
  const isHeroThinking = useHeroThinking();
  const foldersToRender = useMemo(
    () =>
      (projectMode.enabled ? projectMode.filteredFolders : folders).filter(
        (folder): folder is import('../../../shared/types').Folder => folder.kind === 'folder'
      ),
    [projectMode.enabled, projectMode.filteredFolders, folders]
  );
  const agentsToRender = projectMode.enabled ? projectMode.filteredAgents : renderAgents;
  const browsersToRender = useMemo(
    () => (projectMode.enabled ? projectMode.filteredBrowsers : browsers),
    [projectMode.enabled, projectMode.filteredBrowsers, browsers]
  );
  const canvasRef = useRef<HTMLDivElement>(null);
  const cameraStore = useMemo<CameraStore>(() => createCameraStore(INITIAL_CAMERA), []);
  const cameraSnapshot = useSyncExternalStore(
    cameraStore.subscribe,
    cameraStore.getSnapshot,
    cameraStore.getSnapshot
  );

  // HUD panel open/close state
  const [agentsOpen, setAgentsOpen] = useState(true);

  // Dynamic per-project glow styles injected into the document
  const projectGlowStyle = useMemo(() => {
    if (!projectMode.enabled || projectMode.projectColors.size === 0) return '';
    const rules: string[] = [];
    for (const folder of foldersToRender) {
      const color = projectMode.projectColors.get(folder.id);
      if (!color || !projectMode.isProjectVisible(folder.id)) continue;
      const agentIds = agents
        .filter((a) => a.attachedFolderId === folder.id)
        .map((a) => `[data-entity-id="${a.id}"]`)
        .join(', ');
      const folderSel = `[data-entity-id="${folder.id}"]`;
      const selectors = agentIds ? `${folderSel}, ${agentIds}` : folderSel;
      rules.push(`${selectors} { filter: drop-shadow(0 0 8px ${color}99); }`);
    }
    return rules.join('\n');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectMode.enabled, projectMode.projectColors, projectMode.isProjectVisible, foldersToRender, agents]);

  // Helper: get entity layout, using layout override when active
  const getLayout = useCallback(
    (
      id: string,
      defaults: { x: number; y: number; width?: number; height?: number }
    ): { x: number; y: number; width?: number; height?: number } => ({
      ...defaults,
      ...projectMode.positionOverrides.get(id),
    }),
    [projectMode.positionOverrides]
  );
  const shouldPreserveProjectLayout = projectMode.layoutActive || projectMode.focusModeActive;
  const activeAgent = activeAgentTerminalId
    ? agents.find((agent) => agent.id === activeAgentTerminalId)
    : undefined;
  const activeTerminals = projectMode.enabled ? projectMode.filteredTerminals : terminals;
  const terminalList = useMemo(() => Object.values(activeTerminals), [activeTerminals]);
  const folderById = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders]);
  const activeAgentFolder = activeAgent?.attachedFolderId
    ? folderById.get(activeAgent.attachedFolderId)
    : undefined;
  const foldersForMinimap = useMemo(() => {
    if (!projectMode.layoutActive) return foldersToRender;
    return foldersToRender.map((f) => {
      const p = projectMode.positionOverrides.get(f.id);
      return p ? { ...f, x: p.x, y: p.y } : f;
    });
  }, [projectMode.layoutActive, projectMode.positionOverrides, foldersToRender]);
  const agentsForMinimap = useMemo(() => {
    if (!projectMode.layoutActive) return agentsToRender;
    return agentsToRender.map((a) => {
      const p = projectMode.positionOverrides.get(a.id);
      return p ? { ...a, x: p.x, y: p.y } : a;
    });
  }, [projectMode.layoutActive, projectMode.positionOverrides, agentsToRender]);
  const browsersForMinimap = useMemo(() => {
    if (!projectMode.layoutActive) return browsersToRender;
    return browsersToRender.map((b) => {
      const p = projectMode.positionOverrides.get(b.id);
      return p ? { ...b, x: p.x, y: p.y, width: p.width ?? b.width, height: p.height ?? b.height } : b;
    });
  }, [projectMode.layoutActive, projectMode.positionOverrides, browsersToRender]);
  const terminalsForMinimap = useMemo(() => {
    if (!projectMode.layoutActive) return terminalList;
    return terminalList.map((t) => {
      const p = projectMode.positionOverrides.get(t.id);
      return p ? { ...t, x: p.x, y: p.y, width: p.width ?? t.width, height: p.height ?? t.height } : t;
    });
  }, [projectMode.layoutActive, projectMode.positionOverrides, terminalList]);
  const activeAgentPanelBounds = useMemo(() => {
    if (!activeAgentTerminalId || !projectMode.focusModeActive) return null;
    const layout = projectMode.positionOverrides.get(getAgentTerminalLayoutId(activeAgentTerminalId));
    if (!layout?.width || !layout?.height) return null;
    return {
      x: cameraSnapshot.pan.x + layout.x * cameraSnapshot.zoom,
      y: cameraSnapshot.pan.y + layout.y * cameraSnapshot.zoom,
      width: layout.width * cameraSnapshot.zoom,
      height: layout.height * cameraSnapshot.zoom,
    };
  }, [activeAgentTerminalId, cameraSnapshot, projectMode.focusModeActive, projectMode.positionOverrides]);
  const terminalRenderData = useMemo(
    () =>
      terminalList.map((terminal) => {
        const originFolder = terminal.originFolderId ? folderById.get(terminal.originFolderId) : undefined;
        const originName = terminal.originFolderId
          ? (originFolder?.name ?? terminal.originFolderName ?? 'Terminal')
          : (workspace.name ?? terminal.originFolderName ?? 'Terminal');
        const startPath =
          terminal.lastKnownCwd ?? originFolder?.relativePath ?? terminal.originRelativePath ?? '.';
        return {
          terminal,
          originName,
          startPath,
        };
      }),
    [folderById, terminalList, workspace.name]
  );
  const totalEntityCount =
    agentsToRender.length + foldersToRender.length + browsersToRender.length + terminalList.length;
  const { settings } = useAppSettings();
  const effectiveHeroProvider = settings.heroProvider ?? hero.provider;
  const tutorialState = settings.tutorial ?? DEFAULT_TUTORIAL_STATE;
  const priorImportCompleted = Boolean(settings.priorImportCompletedAt);
  const tutorialPolicy = getTutorialAbilityPolicy(tutorialState, effectiveHeroProvider);
  const tutorialEnabled = tutorialPolicy.enabled;
  const [selectionPreview, setSelectionPreview] = useState<{
    agentIds: string[];
    nonAgent: SelectionCandidate | null;
  }>({
    agentIds: [],
    nonAgent: null,
  });
  const [selectionDragging, setSelectionDragging] = useState(false);
  const selectionDraggingRef = useRef(false);
  const selectionCandidatesRef = useRef<SelectionCandidate[] | null>(null);
  const pendingCameraRef = useRef<CanvasCameraState>(cameraStore.getSnapshot());
  const cameraSyncTimeoutRef = useRef<number | null>(null);
  const lastCameraSyncAtRef = useRef(0);
  const [cameraControls, setCameraControls] = useState<CanvasCameraControls | null>(null);
  const passThroughTimeoutRef = useRef<number | null>(null);
  const panningRef = useRef(false);
  const wheelPassThroughRef = useRef(false);
  const overlayPassThroughEnabledRef = useRef(false);
  const [overlayPassThroughEnabled, setOverlayPassThroughEnabled] = useState(false);
  const TRACKPAD_PASS_THROUGH_RELEASE_MS = 500;
  const [panOptimizing, setPanOptimizing] = useState(false);
  const [abilityTriggerPress, setAbilityTriggerPress] = useState<{ index: number; key: number } | null>(null);
  const triggerKeyRef = useRef(0);
  const [performanceOverlayVisible, setPerformanceOverlayVisible] = useState(() => {
    if (typeof window === 'undefined') return false;
    if (window.electronAPI?.isProfileMode) return true;
    try {
      const persisted = window.localStorage.getItem(PERF_OVERLAY_STORAGE_KEY);
      if (persisted === '1') return true;
      if (persisted === '0') return false;
      return false;
    } catch {
      return false;
    }
  });

  const [canvasBgColor, setCanvasBgColor] = useState<string>(() => {
    if (typeof window === 'undefined') return DEFAULT_CANVAS_BG;
    try {
      return window.localStorage.getItem(CANVAS_BG_KEY) ?? DEFAULT_CANVAS_BG;
    } catch {
      return DEFAULT_CANVAS_BG;
    }
  });

  const [minimapCollapsed, setMinimapCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(MINIMAP_COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [priorSettingsDetected, setPriorSettingsDetected] = useState<boolean | null>(null);
  const [importPending, setImportPending] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const bgColorInputRef = useRef<HTMLInputElement>(null);

  const handleBgColorChange = useCallback((color: string) => {
    setCanvasBgColor(color);
  }, []);
  const handlePerformanceOverlayToggle = useCallback(() => {
    setPerformanceOverlayVisible((current: boolean) => !current);
  }, []);

  const handleMinimapToggle = useCallback(() => {
    setMinimapCollapsed((prev) => !prev);
  }, []);

  const diagnosticsEnabled =
    window.electronAPI.isProfileMode ||
    (!window.electronAPI.isTestMode &&
      (performanceOverlayVisible ||
        totalEntityCount >= WORKSPACE_CONSTANTS.PERF_DIAGNOSTICS_ENTITY_THRESHOLD));
  const frameDiagnostics = useFrameDiagnostics({ enabled: diagnosticsEnabled });
  const performanceTier = useAdaptivePerformanceTier({
    enabled: diagnosticsEnabled,
    frame: frameDiagnostics,
  });
  const reducedEffects = performanceTier === 'reduced';
  const { snapshot: renderDiagnostics, onRender: handleSceneRender } = useRenderDiagnostics({
    enabled: performanceOverlayVisible,
  });
  const cameraSyncMinIntervalMs =
    totalEntityCount >= WORKSPACE_CONSTANTS.CAMERA_HIGH_ENTITY_THRESHOLD
      ? WORKSPACE_CONSTANTS.CAMERA_SYNC_INTERVAL_HIGH_ENTITY_MS
      : WORKSPACE_CONSTANTS.CAMERA_SYNC_INTERVAL_DEFAULT_MS;
  const commitPendingCamera = useCallback(() => {
    const nextCamera = pendingCameraRef.current;
    const previous = cameraStore.getSnapshot();
    if (areCamerasEqual(previous, nextCamera)) return;
    cameraStore.setSnapshot(nextCamera);
  }, [cameraStore]);

  const handleCameraChange = useCallback(
    (nextCamera: CanvasCameraState) => {
      pendingCameraRef.current = nextCamera;
      const now = nowMs();
      const elapsed = now - lastCameraSyncAtRef.current;
      if (elapsed >= cameraSyncMinIntervalMs && cameraSyncTimeoutRef.current === null) {
        lastCameraSyncAtRef.current = now;
        commitPendingCamera();
        return;
      }

      if (typeof window === 'undefined') {
        lastCameraSyncAtRef.current = now;
        commitPendingCamera();
        return;
      }

      if (cameraSyncTimeoutRef.current !== null) return;
      const delay = Math.max(0, cameraSyncMinIntervalMs - elapsed);
      cameraSyncTimeoutRef.current = window.setTimeout(() => {
        cameraSyncTimeoutRef.current = null;
        lastCameraSyncAtRef.current = nowMs();
        commitPendingCamera();
      }, delay);
    },
    [cameraSyncMinIntervalMs, commitPendingCamera]
  );

  const handleAbilityPress = useCallback((index: number) => {
    triggerKeyRef.current += 1;
    setAbilityTriggerPress({ index, key: triggerKeyRef.current });
  }, []);
  const handleAbilityTrigger = useCallback(
    (ability: Parameters<typeof handleAbility>[0]) => {
      void handleAbility(ability);
    },
    [handleAbility]
  );

  const abilityResolution = useAbilityResolution({
    selectedEntity,
    selectedAgents,
    ctx: folderContext,
    activeAgentTerminalId,
  });

  const allowedAbilities = tutorialPolicy.allowedAbilities;
  const browserCreationBlocked = tutorialPolicy.browserCreationBlocked;
  useEffect(() => {
    if (!tutorialEnabled) return;
    if (
      ![
        'create-agent',
        'attach-agent',
        'open-global-chat',
        'send-prompt',
        'close-terminal',
        'create-project-2',
        'rename-project-2',
        'create-agent-2',
        'attach-agent-2',
        'open-global-chat-2',
        'send-prompt-2',
        'open-browser-1',
        'open-browser-2',
      ].includes(tutorialState.stepId)
    ) {
      return;
    }
    const provider =
      effectiveHeroProvider === 'codex'
        ? 'create-agent-codex'
        : effectiveHeroProvider === 'claude'
          ? 'create-agent-claude'
          : null;
    if (!provider) return;
    setAbilityVariantSelection('create-agent-claude', provider);
  }, [effectiveHeroProvider, tutorialEnabled, tutorialState.stepId]);

  // Focus demo: auto-enable project mode and focus cookie-clicker on focus-demo-1
  useEffect(() => {
    if (!tutorialEnabled || tutorialState.stepId !== 'focus-demo-1') return;
    const cookieClickerId = tutorialState.createdIds?.folderId;
    if (!cookieClickerId) return;
    if (!projectMode.enabled) projectMode.toggleMode();
    if (!projectMode.panelOpen) projectMode.togglePanel();
    projectMode.focusProject(cookieClickerId);
    projectMode.setLayoutMode('organized');
    projectMode.refreshLayout();
    projectMode.setAllProjectsVisible();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tutorialEnabled, tutorialState.stepId, tutorialState.createdIds?.folderId]);

  // Focus demo: detect when doodle-jump is added to focus and advance
  useEffect(() => {
    if (!tutorialEnabled || tutorialState.stepId !== 'focus-demo-2') return;
    if (!projectMode.enabled) projectMode.toggleMode();
    if (!projectMode.panelOpen) projectMode.togglePanel();
    projectMode.setLayoutMode('organized');
    projectMode.refreshLayout();
    if (projectMode.focusedProjectIds.size >= 2) {
      advanceFocusDemoStep();
    }
  }, [
    tutorialEnabled,
    tutorialState.stepId,
    projectMode.enabled,
    projectMode.panelOpen,
    projectMode.focusedProjectIds.size,
    projectMode.toggleMode,
    projectMode.togglePanel,
    projectMode.setLayoutMode,
    projectMode.refreshLayout,
    advanceFocusDemoStep,
  ]);

  const visibleGlobalAbilities =
    tutorialEnabled && abilityResolution.isGlobal ? tutorialPolicy.visibleGlobalAbilities : null;
  const abilities = (() => {
    const isAllowed = (ability: (typeof abilityResolution.abilities)[number]) => {
      if (!allowedAbilities) return true;
      if (browserCreationBlocked && ability.id === 'create-browser') return false;
      if (allowedAbilities.includes(ability.id)) return true;
      if (!ability.variants) return false;
      return ability.variants.some((variant) => allowedAbilities.includes(variant.id));
    };
    let next = abilityResolution.abilities;
    if (visibleGlobalAbilities) {
      next = next.filter((ability) => visibleGlobalAbilities.includes(ability.id));
    }
    if (tutorialEnabled && allowedAbilities) {
      if (allowedAbilities.length === 0) {
        return [];
      }
      next = next.map((ability) => ({
        ...ability,
        disabled: ability.disabled || !isAllowed(ability),
      }));
    }
    return next;
  })();
  const hotkeyMode = abilityResolution.hotkeyMode;
  const tutorialAbilityResolution = useMemo(
    () => ({ ...abilityResolution, abilities }),
    [abilityResolution, abilities]
  );

  useAbilityHotkeys({
    registerHotkeyHandler,
    abilities,
    hotkeyMode,
    onAbility: handleAbilityTrigger,
    onAbilityPress: handleAbilityPress,
  });

  const setOverlayPassThrough = useCallback(
    (enabled: boolean) => {
      if (overlayPassThroughEnabledRef.current === enabled) return;
      overlayPassThroughEnabledRef.current = enabled;
      setOverlayPassThroughEnabled(enabled);
    },
    [setOverlayPassThroughEnabled]
  );

  const schedulePassThroughRelease = useCallback(() => {
    if (passThroughTimeoutRef.current) {
      window.clearTimeout(passThroughTimeoutRef.current);
    }
    passThroughTimeoutRef.current = window.setTimeout(() => {
      wheelPassThroughRef.current = false;
      if (!selectionDraggingRef.current && !panningRef.current) {
        setOverlayPassThrough(false);
        setPanOptimizing(false);
      }
      passThroughTimeoutRef.current = null;
    }, TRACKPAD_PASS_THROUGH_RELEASE_MS);
  }, [setOverlayPassThrough, setPanOptimizing]);

  const handleWheelPanActivity = useCallback(() => {
    wheelPassThroughRef.current = true;
    setOverlayPassThrough(true);
    setPanOptimizing(true);
    schedulePassThroughRelease();
  }, [schedulePassThroughRelease, setOverlayPassThrough, setPanOptimizing]);

  const handlePanStart = useCallback(() => {
    panningRef.current = true;
    if (passThroughTimeoutRef.current) {
      window.clearTimeout(passThroughTimeoutRef.current);
      passThroughTimeoutRef.current = null;
    }
    wheelPassThroughRef.current = false;
    setOverlayPassThrough(true);
    setPanOptimizing(true);
  }, [setOverlayPassThrough, setPanOptimizing]);

  const handlePanEnd = useCallback(() => {
    panningRef.current = false;
    if (!selectionDraggingRef.current && !wheelPassThroughRef.current) {
      setOverlayPassThrough(false);
      setPanOptimizing(false);
    }
  }, [setOverlayPassThrough, setPanOptimizing]);

  useEffect(() => {
    selectionDraggingRef.current = selectionDragging;
  }, [selectionDragging]);

  useEffect(() => {
    return () => {
      if (passThroughTimeoutRef.current) {
        window.clearTimeout(passThroughTimeoutRef.current);
        passThroughTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (cameraSyncTimeoutRef.current !== null) {
        window.clearTimeout(cameraSyncTimeoutRef.current);
        cameraSyncTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (cameraSyncTimeoutRef.current !== null) {
      window.clearTimeout(cameraSyncTimeoutRef.current);
      cameraSyncTimeoutRef.current = null;
      commitPendingCamera();
    }
    lastCameraSyncAtRef.current = 0;
  }, [cameraSyncMinIntervalMs, commitPendingCamera]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(PERF_OVERLAY_STORAGE_KEY, performanceOverlayVisible ? '1' : '0');
    } catch {
      return;
    }
  }, [performanceOverlayVisible]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(CANVAS_BG_KEY, canvasBgColor);
    } catch {
      return;
    }
  }, [canvasBgColor]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(MINIMAP_COLLAPSED_KEY, minimapCollapsed ? '1' : '0');
    } catch {
      return;
    }
  }, [minimapCollapsed]);

  useEffect(() => {
    if (!tutorialEnabled || tutorialState.stepId !== 'import-prompt') return;
    if (priorImportCompleted) {
      completeFocusDemo();
      return;
    }
    const request = window.electronAPI.checkForPriorSettings?.();
    if (!request) {
      completeFocusDemo();
      return;
    }
    let active = true;
    setImportError(null);
    setPriorSettingsDetected(null);
    void request
      .then((result) => {
        if (!active) return;
        const found = Boolean(result?.found);
        setPriorSettingsDetected(found);
        if (!found) {
          completeFocusDemo();
        }
      })
      .catch(() => {
        if (!active) return;
        setPriorSettingsDetected(false);
        completeFocusDemo();
      });
    return () => {
      active = false;
    };
  }, [tutorialEnabled, tutorialState.stepId, priorImportCompleted, completeFocusDemo]);

  useEffect(() => {
    if (window.electronAPI.isTestMode) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key !== 'f3') return;
      event.preventDefault();
      setPerformanceOverlayVisible((current: boolean) => !current);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const selectedAgentIdSet = useMemo(() => new Set(selectedAgentIds), [selectedAgentIds]);
  const previewAgentIdSet = useMemo(() => new Set(selectionPreview.agentIds), [selectionPreview.agentIds]);

  const collectSelectionCandidates = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return [];
    const elements = Array.from(canvas.querySelectorAll<HTMLElement>('[data-entity-type]'));
    return elements
      .map((element, index) => {
        const type = element.dataset.entityType as EntityType | undefined;
        const id = element.dataset.entityId;
        if (!type || !id) return null;
        const rect = element.getBoundingClientRect();
        const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        const zIndexValue = Number.parseInt(element.dataset.entityZ ?? '', 10);
        const zIndex = Number.isNaN(zIndexValue) ? 0 : zIndexValue;
        return { id, type, center, zIndex, order: index };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  }, []);

  const handleSelectionUpdate = useCallback(
    (payload: {
      rect: { left: number; right: number; top: number; bottom: number };
      dragStart: { x: number; y: number };
    }) => {
      const candidates = selectionCandidatesRef.current ?? collectSelectionCandidates();
      const result = resolveDragSelection(candidates, payload.rect, payload.dragStart);
      setSelectionPreview({
        agentIds: result.agentIds,
        nonAgent: result.nonAgent,
      });
    },
    [collectSelectionCandidates, setSelectionPreview]
  );

  const handleSelectionEnd = useCallback(
    (payload: {
      rect: { left: number; right: number; top: number; bottom: number };
      dragStart: { x: number; y: number };
      additive: boolean;
    }) => {
      setSelectionDragging(false);
      selectionDraggingRef.current = false;
      if (!panningRef.current && !wheelPassThroughRef.current) {
        setOverlayPassThrough(false);
        setPanOptimizing(false);
      }
      const candidates = selectionCandidatesRef.current ?? collectSelectionCandidates();
      selectionCandidatesRef.current = null;
      const result = resolveDragSelection(candidates, payload.rect, payload.dragStart);
      setSelectionPreview({ agentIds: [], nonAgent: null });
      if (result.agentIds.length > 0) {
        handleSelectAgents(result.agentIds, { additive: payload.additive });
        return;
      }
      if (result.nonAgent) {
        handleSelect(result.nonAgent.id, result.nonAgent.type);
        return;
      }
      handleDeselect();
    },
    [
      collectSelectionCandidates,
      handleDeselect,
      handleSelect,
      handleSelectAgents,
      setOverlayPassThrough,
      setPanOptimizing,
      setSelectionDragging,
      setSelectionPreview,
    ]
  );

  const handleMinimapRecenter = useCallback(
    (point: { x: number; y: number }) => {
      cameraControls?.setCameraCenter(point);
    },
    [cameraControls]
  );
  useEffect(() => {
    const cleanup = window.electronAPI.onAgentNotificationClick((payload) => {
      if (payload.workspacePath !== workspace.path) return;
      const agent = agents.find((entry) => entry.id === payload.agentId);
      if (!agent || !cameraControls) return;
      handleSelect(agent.id, 'agent');
      cameraControls.setCameraCenter({ x: agent.x, y: agent.y });
    });
    return () => {
      cleanup();
    };
  }, [agents, cameraControls, handleSelect, workspace.path]);

  // When layout activates, pan camera to the center of the arranged layout
  useEffect(() => {
    if (!projectMode.layoutActive || !cameraControls || projectMode.projectZones.length === 0) return;
    const xs = projectMode.projectZones.map((z) => z.x + z.w / 2);
    const ys = projectMode.projectZones.map((z) => z.y + z.h / 2);
    const cx = xs.reduce((s, v) => s + v, 0) / xs.length;
    const cy = ys.reduce((s, v) => s + v, 0) / ys.length;
    // Small delay lets React commit the new positions first
    const tid = window.setTimeout(() => cameraControls.setCameraCenter({ x: cx, y: cy }), 50);
    return () => window.clearTimeout(tid);
  }, [projectMode.layoutActive, projectMode.projectZones, cameraControls]);

  const entityCounts = useMemo(
    () => ({
      agents: agentsToRender.length,
      folders: folders.length,
      browsers: browsersToRender.length,
      terminals: terminalList.length,
    }),
    [agentsToRender.length, browsersToRender.length, folders.length, terminalList.length]
  );

  const sceneContent = useMemo(
    () => (
      <>
        {/* Project zone backgrounds — rendered behind all entities */}
        {projectMode.layoutActive &&
          projectMode.projectZones.map((zone) => (
            <div
              key={zone.folderId}
              className="project-zone-bg"
              style={{
                left: zone.x - 30,
                top: zone.y - 30,
                width: zone.w + 60,
                height: zone.h + 60,
                background: `radial-gradient(ellipse at 50% 30%, ${zone.color}22 0%, ${zone.color}0a 60%, transparent 100%)`,
                border: `1px solid ${zone.color}30`,
              }}
            />
          ))}

        {tutorialMoveZone && (
          <div
            className="tutorial-move-zone"
            style={{
              left: tutorialMoveZone.x,
              top: tutorialMoveZone.y,
              width: tutorialMoveZone.width,
              height: tutorialMoveZone.height,
            }}
            data-tutorial-target="tutorial-move-zone"
            aria-hidden="true"
          />
        )}
        {tutorialMoveBounds && (
          <div
            className="tutorial-move-bounds"
            style={{
              left: tutorialMoveBounds.x,
              top: tutorialMoveBounds.y,
              width: tutorialMoveBounds.width,
              height: tutorialMoveBounds.height,
            }}
            data-tutorial-target="tutorial-move-bounds"
            aria-hidden="true"
          />
        )}
        <AttachmentBeams
          agents={
            !projectMode.layoutActive
              ? agentsToRender
              : agentsToRender.map((a) => {
                  const p = projectMode.positionOverrides.get(a.id);
                  return p ? { ...a, x: p.x, y: p.y } : a;
                })
          }
          folders={
            (!projectMode.layoutActive
              ? foldersToRender
              : foldersToRender.map((f) => {
                  const p = projectMode.positionOverrides.get(f.id);
                  return p ? { ...f, x: p.x, y: p.y } : f;
                })) as import('../../../shared/types').Folder[]
          }
        />
        {destinationMarker && <DestinationMarker x={destinationMarker.x} y={destinationMarker.y} />}
        {!projectMode.hideHero && (
          <HeroEntity
            hero={heroToRender}
            selected={selectedEntity?.type === 'hero'}
            previewed={selectionPreview.nonAgent?.type === 'hero'}
            thinking={isHeroThinking}
            onSelect={() => handleSelect('hero', 'hero')}
            onMove={handleHeroMove}
          />
        )}

        {foldersToRender.map((folder) => {
          const fLayout = getLayout(folder.id, { x: folder.x, y: folder.y });
          return (
            <FolderEntity
              key={folder.id}
              folder={
                fLayout.x !== folder.x || fLayout.y !== folder.y
                  ? { ...folder, x: fLayout.x, y: fLayout.y }
                  : folder
              }
              selected={selectedEntity?.type === 'folder' && selectedEntity.id === folder.id}
              previewed={
                selectionPreview.nonAgent?.type === 'folder' && selectionPreview.nonAgent.id === folder.id
              }
              onSelect={() => handleSelect(folder.id, 'folder')}
              onMove={(x, y) => {
                if (!shouldPreserveProjectLayout) {
                  projectMode.exitLayout();
                }
                handleFolderMove(folder.id, x, y);
              }}
              onDragEnd={() => handleFolderDragEnd(folder.id)}
              magnetized={magnetizedFolderIds.includes(folder.id)}
              onNameClick={() => {
                beginRename(folder);
              }}
              renaming={renameState.folderId === folder.id}
              renameValue={renameState.folderId === folder.id ? renameState.value : undefined}
              renameOptions={availableFolders}
              renameDropdownOpen={renameState.folderId === folder.id ? renameState.dropdownOpen : false}
              onRenameChange={(value) => {
                handleRenameChange(folder.id, value);
              }}
              onRenameSubmit={() => submitRename(renameState.value)}
              onRenameCancel={handleRenameCancel}
              onToggleDropdown={toggleRenameDropdown}
              onPickOption={handleRenamePickOption}
            />
          );
        })}

        {agentsToRender.map((agent) => {
          const aLayout = getLayout(agent.id, { x: agent.x, y: agent.y });
          return (
            <AgentEntity
              key={agent.id}
              agent={
                aLayout.x !== agent.x || aLayout.y !== agent.y
                  ? { ...agent, x: aLayout.x, y: aLayout.y }
                  : agent
              }
              selected={
                selectedEntity?.type === 'agent'
                  ? selectedEntity.id === agent.id
                  : selectedAgentIdSet.has(agent.id)
              }
              previewed={previewAgentIdSet.has(agent.id)}
              reduceEffects={reducedEffects}
              onSelect={(event) =>
                handleSelect(agent.id, 'agent', { additive: event?.metaKey || event?.ctrlKey })
              }
              onMove={(x, y) => {
                if (!shouldPreserveProjectLayout) {
                  projectMode.exitLayout();
                }
                handleAgentMove(agent.id, x, y);
              }}
              onDragStart={() => handleAgentDragStart(agent.id)}
              onDragEnd={(data) => handleAgentDragEnd(agent.id, data)}
              isTerminalOpen={activeAgentTerminalId === agent.id}
              showCompletionBadge={completedAgentIds.has(agent.id)}
            />
          );
        })}

        {browsersToRender.length > 0 && (
          <Suspense fallback={null}>
            {browsersToRender.map((browser) => {
              const bLayout = getLayout(browser.id, {
                x: browser.x,
                y: browser.y,
                width: browser.width,
                height: browser.height,
              });
              const browserPanel =
                bLayout.x !== browser.x ||
                bLayout.y !== browser.y ||
                bLayout.width !== browser.width ||
                bLayout.height !== browser.height
                  ? {
                      ...browser,
                      x: bLayout.x,
                      y: bLayout.y,
                      width: bLayout.width ?? browser.width,
                      height: bLayout.height ?? browser.height,
                    }
                  : browser;
              return (
                <BrowserEntity
                  key={browser.id}
                  panel={browserPanel}
                  forcedBounds={
                    projectMode.focusModeActive
                      ? {
                          x: bLayout.x,
                          y: bLayout.y,
                          width: bLayout.width ?? browser.width,
                          height: bLayout.height ?? browser.height,
                        }
                      : undefined
                  }
                  lockedToLayout={projectMode.focusModeActive}
                  selected={selectedEntity?.type === 'browser' && selectedEntity.id === browser.id}
                  previewed={
                    selectionPreview.nonAgent?.type === 'browser' &&
                    selectionPreview.nonAgent.id === browser.id
                  }
                  dragSelecting={selectionDragging}
                  zIndex={browserZIndices[browser.id] || 2000}
                  onSelect={() => handleSelect(browser.id, 'browser')}
                  onMove={(x, y) => {
                    if (!shouldPreserveProjectLayout) {
                      projectMode.exitLayout();
                    }
                    handleBrowserMove(browser.id, x, y);
                  }}
                  onMoveEnd={(x, y) => handleBrowserMoveEnd(browser.id, x, y)}
                  onUrlChange={(url) => handleBrowserUrlChange(browser.id, url)}
                  onFaviconChange={(faviconUrl) => handleBrowserFaviconChange(browser.id, faviconUrl)}
                  onClose={() => handleBrowserClose(browser.id)}
                  onResize={(width, height) => handleBrowserResize(browser.id, width, height)}
                  onResizeEnd={(width, height) => handleBrowserResizeEnd(browser.id, width, height)}
                  onBringToFront={() => bringBrowserToFront(browser.id)}
                  onRefreshHandled={clearBrowserRefreshToken}
                  onTutorialMessage={handleTutorialBrowserMessage}
                />
              );
            })}
          </Suspense>
        )}

        {terminalRenderData.length > 0 && (
          <Suspense fallback={null}>
            {terminalRenderData.map(({ terminal, originName, startPath }) => {
              const tLayout = getLayout(terminal.id, {
                x: terminal.x,
                y: terminal.y,
                width: terminal.width,
                height: terminal.height,
              });
              return (
                <TerminalEntity
                  key={terminal.id}
                  terminalId={terminal.id}
                  workspacePath={workspace.path}
                  originName={originName}
                  startPath={startPath}
                  x={tLayout.x}
                  y={tLayout.y}
                  width={tLayout.width ?? terminal.width}
                  height={tLayout.height ?? terminal.height}
                  forcedBounds={
                    projectMode.focusModeActive
                      ? {
                          x: tLayout.x,
                          y: tLayout.y,
                          width: tLayout.width ?? terminal.width,
                          height: tLayout.height ?? terminal.height,
                        }
                      : undefined
                  }
                  lockedToLayout={projectMode.focusModeActive}
                  zIndex={terminalZIndices[terminal.id] || 2000}
                  onClose={() => void closeTerminalById(terminal.id)}
                  onMove={(x, y) => {
                    if (!shouldPreserveProjectLayout) {
                      projectMode.exitLayout();
                    }
                    handleTerminalMove(terminal.id, x, y);
                  }}
                  onMoveEnd={(x, y) => handleTerminalMoveEnd(terminal.id, x, y)}
                  onResize={(width, height) => handleTerminalResize(terminal.id, width, height)}
                  onResizeEnd={(width, height) => handleTerminalResizeEnd(terminal.id, width, height)}
                  onBringToFront={() => {
                    bringTerminalToFront(terminal.id);
                    updateTerminalRecord(terminal.id, { lastUsedAt: Date.now() });
                  }}
                  onSelect={() => handleSelect(terminal.id, 'terminal')}
                  selected={selectedEntity?.type === 'terminal' && selectedEntity.id === terminal.id}
                  previewed={
                    selectionPreview.nonAgent?.type === 'terminal' &&
                    selectionPreview.nonAgent.id === terminal.id
                  }
                  dragSelecting={selectionDragging}
                  onProcessChange={(processLabel) => handleTerminalProcessChange(terminal.id, processLabel)}
                />
              );
            })}
          </Suspense>
        )}
      </>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      tutorialMoveZone,
      tutorialMoveBounds,
      agentsToRender,
      foldersToRender,
      destinationMarker,
      heroToRender,
      isHeroThinking,
      selectedEntity,
      selectionPreview,
      handleSelect,
      handleHeroMove,
      handleFolderMove,
      handleFolderDragEnd,
      magnetizedFolderIds,
      beginRename,
      renameState,
      availableFolders,
      handleRenameChange,
      submitRename,
      handleRenameCancel,
      toggleRenameDropdown,
      handleRenamePickOption,
      selectedAgentIdSet,
      previewAgentIdSet,
      reducedEffects,
      handleAgentMove,
      handleAgentDragStart,
      handleAgentDragEnd,
      activeAgentTerminalId,
      completedAgentIds,
      browsersToRender,
      selectionDragging,
      browserZIndices,
      handleBrowserMove,
      handleBrowserMoveEnd,
      handleBrowserUrlChange,
      handleBrowserFaviconChange,
      handleBrowserClose,
      handleBrowserResize,
      handleBrowserResizeEnd,
      bringBrowserToFront,
      clearBrowserRefreshToken,
      handleTutorialBrowserMessage,
      terminalRenderData,
      workspace.path,
      terminalZIndices,
      closeTerminalById,
      handleTerminalMove,
      handleTerminalMoveEnd,
      handleTerminalResize,
      handleTerminalResizeEnd,
      bringTerminalToFront,
      updateTerminalRecord,
      handleTerminalProcessChange,
      getLayout,
      projectMode.layoutActive,
      projectMode.projectZones,
      projectMode.positionOverrides,
      projectMode.exitLayout,
      projectMode.hideHero,
    ]
  );

  const canvasChildren = performanceOverlayVisible ? (
    <Profiler id="workspace-scene" onRender={handleSceneRender}>
      {sceneContent}
    </Profiler>
  ) : (
    sceneContent
  );

  useEffect(() => {
    const target = window as Window & {
      __vibecraftPerformance?: {
        getSnapshot: () => {
          workspacePath: string;
          performanceTier: string;
          frame: ReturnType<typeof useFrameDiagnostics>;
          render: ReturnType<typeof useRenderDiagnostics>['snapshot'];
          entityCounts: typeof entityCounts;
          capturedAt: number;
        };
      };
    };

    const diagnosticsHandle = {
      getSnapshot: () => ({
        workspacePath: workspace.path,
        performanceTier,
        frame: frameDiagnostics,
        render: renderDiagnostics,
        entityCounts,
        capturedAt: Date.now(),
      }),
    };

    target.__vibecraftPerformance = diagnosticsHandle;
    return () => {
      if (target.__vibecraftPerformance === diagnosticsHandle) {
        delete target.__vibecraftPerformance;
      }
    };
  }, [entityCounts, frameDiagnostics, performanceTier, renderDiagnostics, workspace.path]);

  return (
    <div className="workspace-main">
      {projectGlowStyle && <style>{projectGlowStyle}</style>}
      <div className="workspace-canvas-container">
        <div
          className={`workspace-canvas-stage${reducedEffects ? ' perf-reduced' : ''}${panOptimizing ? ' pan-optimizing' : ''}${overlayPassThroughEnabled ? ' pass-through-active' : ''}${projectMode.focusModeActive ? ' focus-mode-active' : ''}`}
          style={
            { '--canvas-bg-center': canvasBgColor, '--canvas-bg-edge': canvasBgColor } as React.CSSProperties
          }
        >
          {/* ── HUD Top-Left: Projects + Agents ──────────────────────────── */}
          <div className="hud-top-left">
            <div className="hud-button-bar">
              {/* Projects button */}
              <button
                className={`hud-tab-btn${projectMode.enabled ? ' hud-tab-btn--active' : ''}`}
                onClick={() => {
                  if (!projectMode.enabled) projectMode.toggleMode();
                  else projectMode.togglePanel();
                }}
                title={
                  projectMode.enabled
                    ? projectMode.panelOpen
                      ? 'Close projects'
                      : 'Open projects'
                    : 'Enable Project Mode'
                }
              >
                <svg
                  className="hud-tab-icon"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                >
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                Projects
              </button>
              {/* Agents button */}
              {agents.length > 0 && (
                <button
                  className={`hud-tab-btn${agentsOpen ? ' hud-tab-btn--active' : ''}`}
                  onClick={() => setAgentsOpen((p) => !p)}
                  title={agentsOpen ? 'Close agents' : 'Open agents'}
                >
                  <svg
                    className="hud-tab-icon"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="12" cy="8" r="4" />
                    <path d="M6 20v-2a6 6 0 0 1 12 0v2" />
                  </svg>
                  Agents
                </button>
              )}
            </div>

            <div className="hud-panels">
              {/* Projects panel */}
              {projectMode.enabled && projectMode.panelOpen && (
                <Suspense fallback={null}>
                  <ProjectPanel
                    folders={folders as import('../../../shared/types').AnyFolder[]}
                    projectStats={projectMode.projectStats}
                    projectColors={projectMode.projectColors}
                    isProjectVisible={projectMode.isProjectVisible}
                    onToggleProject={projectMode.toggleProject}
                    onSetAllVisible={projectMode.setAllProjectsVisible}
                    onSetProjectColor={projectMode.setProjectColor}
                    onJumpToEntity={(x, y) => cameraControls?.setCameraCenter({ x, y })}
                    onFocusProject={(folderId) => {
                      projectMode.focusProject(folderId);
                      const bounds = projectMode.getProjectFocusBounds(folderId);
                      if (bounds)
                        setTimeout(() => cameraControls?.setCameraCenter({ x: bounds.cx, y: bounds.cy }), 60);
                    }}
                    onToggleFocusProject={projectMode.toggleFocusProject}
                    onExitFocusMode={projectMode.exitFocusMode}
                    focusedProjectIds={projectMode.focusedProjectIds}
                    focusModeActive={projectMode.focusModeActive}
                    onClose={projectMode.togglePanel}
                    agents={agents}
                    terminals={terminals}
                    browsers={browsers}
                    layoutActive={projectMode.layoutActive}
                    layoutMode={projectMode.layoutMode}
                    onSetLayoutMode={projectMode.setLayoutMode}
                    onRefreshLayout={projectMode.refreshLayout}
                  />
                </Suspense>
              )}

              {/* Agents panel */}
              {agentsOpen && agents.length > 0 && (
                <div className="hud-agent-panel">
                  <AgentRosterOverlay
                    agents={projectMode.enabled ? projectMode.filteredAgents : agents}
                    selectedId={selectedEntity?.type === 'agent' ? selectedEntity.id : null}
                    onSelect={(id) => handleSelect(id, 'agent')}
                    folderNameById={folderNameById}
                    completedAgentIds={completedAgentIds}
                  />
                </div>
              )}
            </div>
          </div>

          <Canvas
            ref={canvasRef}
            onClickEmpty={handleDeselect}
            onRightClick={handleCanvasRightClick}
            onCameraChange={handleCameraChange}
            onCameraControlsReady={setCameraControls}
            onPanStart={handlePanStart}
            onPanEnd={handlePanEnd}
            onSelectionStart={() => {
              setSelectionPreview({ agentIds: [], nonAgent: null });
              setSelectionDragging(true);
              selectionDraggingRef.current = true;
              selectionCandidatesRef.current = collectSelectionCandidates();
              if (passThroughTimeoutRef.current) {
                window.clearTimeout(passThroughTimeoutRef.current);
                passThroughTimeoutRef.current = null;
              }
              wheelPassThroughRef.current = false;
              setOverlayPassThrough(true);
            }}
            onSelectionUpdate={handleSelectionUpdate}
            onSelectionEnd={handleSelectionEnd}
            onSelectionCancel={() => {
              setSelectionDragging(false);
              selectionDraggingRef.current = false;
              selectionCandidatesRef.current = null;
              if (!panningRef.current && !wheelPassThroughRef.current) {
                setOverlayPassThrough(false);
                setPanOptimizing(false);
              }
            }}
            onWheelPanActivity={handleWheelPanActivity}
            selectionDragThresholdPx={WORKSPACE_CONSTANTS.SELECTION_DRAG_THRESHOLD_PX}
          >
            {canvasChildren}
          </Canvas>
          {/* ── Background color picker (top-right) ─────────────────────── */}
          <div className="canvas-top-right-controls">
            <input
              ref={bgColorInputRef}
              type="color"
              value={canvasBgColor}
              className="canvas-bg-input"
              onChange={(e) => handleBgColorChange(e.target.value)}
            />
            {(import.meta.env.DEV || window.electronAPI.isProfileMode) && (
              <button
                type="button"
                className={`canvas-perf-btn${performanceOverlayVisible ? ' canvas-perf-btn--active' : ''}`}
                onClick={handlePerformanceOverlayToggle}
                title={performanceOverlayVisible ? 'Hide performance overlay' : 'Show performance overlay'}
              >
                Perf
              </button>
            )}
            <button
              className="canvas-bg-btn"
              onClick={() => bgColorInputRef.current?.click()}
              style={{ backgroundColor: canvasBgColor, borderColor: `${canvasBgColor}88` }}
              title="Change canvas background color"
            />
          </div>

          {/* ── Minimap (bottom-right, collapsible) ──────────────────────── */}
          <div className={`minimap-wrapper${minimapCollapsed ? ' minimap-wrapper--collapsed' : ''}`}>
            <button
              className="minimap-collapse-btn"
              onClick={handleMinimapToggle}
              title={minimapCollapsed ? 'Expand minimap' : 'Collapse minimap'}
            >
              {minimapCollapsed ? '⊞' : '⊟'}
            </button>
            {!minimapCollapsed && (
              <MinimapOverlay
                hero={heroToRender}
                agents={agentsForMinimap}
                folders={foldersForMinimap}
                browsers={browsersForMinimap}
                terminals={terminalsForMinimap}
                cameraStore={cameraStore}
                onRecenter={handleMinimapRecenter}
              />
            )}
          </div>
          <PerformanceOverlay
            visible={performanceOverlayVisible}
            onToggle={handlePerformanceOverlayToggle}
            frame={frameDiagnostics}
            render={renderDiagnostics}
            tier={performanceTier}
            entityCounts={entityCounts}
          />
          {activeAgentTerminalId && (!projectMode.focusModeActive || activeAgentPanelBounds) && (
            <Suspense fallback={null}>
              <AgentTerminalPanel
                key={activeAgentTerminalId}
                agentId={activeAgentTerminalId}
                agentName={activeAgent?.displayName ?? activeAgentTerminalId}
                agentProvider={activeAgent?.provider ?? 'claude'}
                agentModel={activeAgent?.model ?? ''}
                agentReasoningEffort={activeAgent?.reasoningEffort ?? null}
                agentSummary={activeAgent?.summary ?? null}
                agentPresenceStatus={activeAgent?.status ?? 'offline'}
                agentContextLeft={activeAgent?.contextLeft}
                agentContextWindow={activeAgent?.contextWindow}
                agentTotalTokensUsed={activeAgent?.totalTokensUsed}
                workspacePath={workspace.path}
                attachedRelativePath={activeAgentFolder?.relativePath}
                runCommand={runCommand}
                onClose={closeActiveAgentTerminal}
                forcedBounds={activeAgentPanelBounds ?? undefined}
                embedded={Boolean(activeAgentPanelBounds)}
              />
            </Suspense>
          )}
          <BottomBar
            selectedEntity={selectedEntity}
            selectedAgents={selectedAgents}
            onSelectAgent={(agentId) => handleSelect(agentId, 'agent')}
            terminalProcess={selectedTerminalProcess}
            onHeroNameCommit={handleHeroNameCommit}
            onHeroModelCommit={handleSetHeroModel}
            onAgentNameCommit={handleAgentNameCommit}
            onAbility={handleAbilityTrigger}
            abilityResolution={tutorialAbilityResolution}
            triggerPress={abilityTriggerPress}
          />
        </div>

        <Suspense fallback={null}>
          <GlobalChat {...globalChatProps} />
        </Suspense>
      </div>

      {/* Import prompt shown at the end of focus demo */}
      {tutorialEnabled && tutorialState.stepId === 'import-prompt' && priorSettingsDetected && (
        <div className="tutorial-import-overlay">
          <div className="tutorial-import-card">
            <h3 className="tutorial-import-title">Import Prior Settings?</h3>
            <p className="tutorial-import-body">
              Would you like to import your projects and settings from a previous VibeCraft installation? Your
              current settings will be backed up first.
            </p>
            {importError && (
              <p className="tutorial-import-body" role="alert">
                {importError}
              </p>
            )}
            <div className="tutorial-import-actions">
              <button
                className="tutorial-import-btn tutorial-import-btn--secondary"
                disabled={importPending}
                onClick={completeFocusDemo}
              >
                No thanks
              </button>
              <button
                className="tutorial-import-btn tutorial-import-btn--primary"
                disabled={importPending}
                onClick={() => {
                  setImportPending(true);
                  setImportError(null);
                  void window.electronAPI
                    .backupAndImportSettings?.()
                    .then((result) => {
                      if (!result?.success) {
                        setImportError(result?.error ?? 'Failed to import prior settings.');
                        return;
                      }
                      completeFocusDemo();
                    })
                    .catch((error) => {
                      setImportError(
                        error instanceof Error ? error.message : 'Failed to import prior settings.'
                      );
                    })
                    .finally(() => {
                      setImportPending(false);
                    });
                }}
              >
                {importPending ? 'Importing...' : 'Import Settings'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
