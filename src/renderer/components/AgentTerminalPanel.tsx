import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
} from 'react';
import type {
  AgentConnectEvent,
  AgentConnectEventPayload,
  AgentModelInfo,
  AgentProvider,
  AgentStatus,
  SelectedAgentFile,
  AgentTerminalEntry,
  AgentTerminalPanelBounds,
  AgentTerminalViewState,
  ContextUsage,
  TokenUsage,
} from '../../shared/types';
import type { CommandInvocation, CommandRunResult } from '../commands/registry';
import { refreshAppSettings, saveSettings, useAppSettings } from '../state/appSettingsStore';
import { clampContextPercent, getContextPercent } from '../utils/contextUsage';
import { formatTokens as formatTokensCore } from '../utils/formatTokens';
import { getUsageTotal } from '../utils/tokenUsage';

type ChatEntry = AgentTerminalEntry;

const MIN_PANEL_WIDTH = 300;
const MIN_PANEL_HEIGHT = 300;
const PANEL_MARGIN = 12;
const TITLEBAR_HEIGHT = 38;
const DEFAULT_RENDER_WINDOW = 100;
const PREPEND_BATCH_SIZE = 50;
const TOP_LOAD_THRESHOLD_PX = 80;
const BOTTOM_LOAD_THRESHOLD_PX = 120;
const INPUT_AUTO_MAX_HEIGHT = 180;

const clampPanelBounds = (bounds: AgentTerminalPanelBounds): AgentTerminalPanelBounds => {
  const topOffset = TITLEBAR_HEIGHT + PANEL_MARGIN;
  const maxWidth = Math.max(MIN_PANEL_WIDTH, window.innerWidth - PANEL_MARGIN * 2);
  const maxHeight = Math.max(MIN_PANEL_HEIGHT, window.innerHeight - topOffset - PANEL_MARGIN);
  const width = Math.max(MIN_PANEL_WIDTH, Math.min(maxWidth, bounds.width));
  const height = Math.max(MIN_PANEL_HEIGHT, Math.min(maxHeight, bounds.height));
  const maxX = Math.max(PANEL_MARGIN, window.innerWidth - width - PANEL_MARGIN);
  const maxY = Math.max(topOffset, window.innerHeight - height - PANEL_MARGIN);
  const x = Math.max(PANEL_MARGIN, Math.min(maxX, bounds.x));
  const y = Math.max(topOffset, Math.min(maxY, bounds.y));
  return { x, y, width, height };
};

const getDefaultBounds = (): { x: number; y: number; width: number; height: number } => {
  const topOffset = TITLEBAR_HEIGHT + PANEL_MARGIN;
  const width = Math.round(window.innerWidth * 0.3);
  const height = window.innerHeight - topOffset - PANEL_MARGIN;
  const x = window.innerWidth - width - PANEL_MARGIN;
  const y = topOffset;
  return { x, y, width, height };
};

type ResizeEdge =
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

const getCursorForEdge = (edge: ResizeEdge): string => {
  switch (edge) {
    case 'left':
    case 'right':
      return 'ew-resize';
    case 'top':
    case 'bottom':
      return 'ns-resize';
    case 'top-left':
    case 'bottom-right':
      return 'nwse-resize';
    case 'top-right':
    case 'bottom-left':
      return 'nesw-resize';
    default:
      return 'default';
  }
};

interface AgentTerminalPanelProps {
  agentId: string;
  agentName: string;
  agentProvider: AgentProvider;
  agentModel: string;
  agentReasoningEffort?: string | null;
  agentSummary?: string | null;
  agentPresenceStatus: AgentStatus;
  agentContextLeft?: number;
  agentContextWindow?: number;
  agentTotalTokensUsed?: number;
  workspacePath: string;
  attachedRelativePath?: string;
  runCommand: (command: CommandInvocation) => Promise<CommandRunResult>;
  onClose: () => void;
  forcedBounds?: { x: number; y: number; width: number; height: number };
  embedded?: boolean;
}

const createId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const normalizeText = (text: string) => text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const formatTokens = (value?: number | null): string => {
  if (value === undefined || value === null) return '—';
  return formatTokensCore(value);
};
const inferMultimodalSupport = (
  provider: AgentProvider,
  model: string,
  recentModels: AgentModelInfo[] | null
): boolean => {
  const modelInfo = recentModels?.find((entry) => entry.id === model);
  if (typeof modelInfo?.supportsMultimodalInput === 'boolean') {
    return modelInfo.supportsMultimodalInput;
  }
  return provider === 'claude' || provider === 'codex' || provider === 'cursor';
};

const buildPromptWithFiles = (prompt: string, files: SelectedAgentFile[]): string => {
  const trimmed = prompt.trim();
  if (files.length === 0) return trimmed;
  const intro = trimmed || 'Review the selected files and respond based on them.';
  const fileLines = files.map((file) => `- ${file.relativePath ?? file.path}`);
  return `${intro}\n\nSelected files:\n${fileLines.join('\n')}`;
};

export default function AgentTerminalPanel({
  agentId,
  agentName,
  agentProvider,
  agentModel,
  agentReasoningEffort,
  agentSummary,
  agentPresenceStatus,
  agentContextLeft,
  agentTotalTokensUsed,
  workspacePath,
  attachedRelativePath,
  runCommand,
  onClose,
  forcedBounds,
  embedded = false,
}: AgentTerminalPanelProps) {
  const appSettings = useAppSettings();
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);
  const runActive = isStreaming || agentPresenceStatus === 'working';
  const [copyState, setCopyState] = useState<{ id: string | null; status: 'idle' | 'success' | 'error' }>({
    id: null,
    status: 'idle',
  });
  const [agentStatus, setAgentStatus] = useState<'idle' | 'thinking' | 'error'>('idle');
  const [toolStatus, setToolStatus] = useState<{ state: 'running' | 'error'; command: string } | null>(null);
  const [statusStartedAt, setStatusStartedAt] = useState<number | null>(null);
  const [statusElapsed, setStatusElapsed] = useState(0);
  const [lastRunDuration, setLastRunDuration] = useState<number | null>(null);
  const [currentModel, setCurrentModel] = useState(agentModel);
  const [currentReasoningEffort, setCurrentReasoningEffort] = useState<string | null>(
    agentReasoningEffort ?? null
  );
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<SelectedAgentFile[]>([]);
  const summaryText = agentSummary?.trim();
  const [recentModels, setRecentModels] = useState<AgentModelInfo[] | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const currentAssistantIdRef = useRef<string | null>(null);
  const toolEntryMapRef = useRef<Map<string, string>>(new Map());
  const toolStatusRef = useRef(toolStatus);
  const defaultModelAttemptedRef = useRef<string | null>(null);
  const modelsRequestRef = useRef<Promise<AgentModelInfo[]> | null>(null);
  const modelsRefreshRef = useRef<Promise<AgentModelInfo[]> | null>(null);
  const modelsLoadingCountRef = useRef(0);
  const modelsFetchIdRef = useRef(0);
  const streamedAssistantIdRef = useRef<string | null>(null);
  const queuedPromptsRef = useRef<string[]>([]);
  const lastAssistantMessageRef = useRef<{
    id: string;
    content: string;
    runId: string | null;
    timestamp: number;
    pending: boolean;
  } | null>(null);
  const eventHandlerRef = useRef<(payload: AgentConnectEventPayload) => void>(() => {});
  const entriesRef = useRef<ChatEntry[]>([]);
  const manualResizeRef = useRef(false);
  const autoResizeRef = useRef(false);
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftLoadedRef = useRef(false);
  const draftDirtyRef = useRef(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [renderWindow, setRenderWindow] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  const renderWindowRef = useRef(renderWindow);
  const pendingPrependScrollRef = useRef<{ prevScrollTop: number; prevScrollHeight: number } | null>(null);
  const loadingOlderRef = useRef(false);
  const prevEntryCountRef = useRef(0);
  const [autoScrollPinned, setAutoScrollPinned] = useState(true);
  const autoScrollPinnedRef = useRef(true);
  const scrollTopRef = useRef(0);
  const pendingScrollRestoreRef = useRef<number | null>(null);
  const restoreRenderWindowRef = useRef<{ start: number; end: number } | null>(null);
  const restoredRenderWindowRef = useRef(false);
  const viewStateLoadedRef = useRef(false);
  const viewStateHydratingRef = useRef(false);
  const viewStateSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingViewStateRef = useRef<AgentTerminalViewState | null>(null);

  const savedPanelBounds = appSettings.settings.agentTerminalPanelBounds;
  const [panelBounds, setPanelBounds] = useState(() => {
    if (savedPanelBounds) {
      return clampPanelBounds(savedPanelBounds);
    }
    return getDefaultBounds();
  });
  const panelBoundsRef = useRef(panelBounds);
  const resizingRef = useRef<{
    edge: ResizeEdge;
    startX: number;
    startY: number;
    startBounds: { x: number; y: number; width: number; height: number };
  } | null>(null);
  const draggingRef = useRef<{
    startX: number;
    startY: number;
    startPanelX: number;
    startPanelY: number;
  } | null>(null);
  const panelBoundsSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const providerLabel = useMemo(() => {
    if (agentProvider === 'claude') return 'Claude';
    if (agentProvider === 'codex') return 'Codex';
    if (agentProvider === 'cursor') return 'Cursor';
    return 'Agent';
  }, [agentProvider]);

  const canStream = agentProvider === 'claude' || agentProvider === 'codex' || agentProvider === 'cursor';
  const inputEnabled = Boolean(attachedRelativePath && canStream);
  const effectiveBounds = forcedBounds ?? panelBounds;
  const supportsFileSelection = inferMultimodalSupport(agentProvider, currentModel, recentModels);

  useEffect(() => {
    setCurrentModel(agentModel);
  }, [agentModel]);

  useEffect(() => {
    panelBoundsRef.current = panelBounds;
  }, [panelBounds]);

  useEffect(() => {
    setCurrentReasoningEffort(agentReasoningEffort ?? null);
  }, [agentReasoningEffort]);

  useEffect(() => {
    setRecentModels(null);
    modelsRequestRef.current = null;
    modelsRefreshRef.current = null;
    modelsLoadingCountRef.current = 0;
    modelsFetchIdRef.current += 1;
    setModelsLoading(false);
  }, [agentProvider]);

  useEffect(() => {
    defaultModelAttemptedRef.current = null;
  }, [agentId, agentProvider]);

  useEffect(() => {
    currentAssistantIdRef.current = null;
    toolEntryMapRef.current.clear();
    streamedAssistantIdRef.current = null;
    lastAssistantMessageRef.current = null;
    queuedPromptsRef.current = [];
    setQueuedCount(0);
    manualResizeRef.current = false;
    setContextUsage(null);
    setLastRunDuration(null);
    setSearchOpen(false);
    setSearchQuery('');
    setActiveMatchIndex(0);
    setRenderWindow({ start: 0, end: 0 });
    setAutoScrollPinned(true);
    autoScrollPinnedRef.current = true;
    scrollTopRef.current = 0;
    pendingScrollRestoreRef.current = null;
    restoreRenderWindowRef.current = null;
    restoredRenderWindowRef.current = false;
    pendingViewStateRef.current = null;
    viewStateHydratingRef.current = false;
    viewStateLoadedRef.current = false;
    if (viewStateSaveTimerRef.current) {
      clearTimeout(viewStateSaveTimerRef.current);
      viewStateSaveTimerRef.current = null;
    }
    setSelectedFiles([]);
  }, [agentId]);

  useEffect(() => {
    toolStatusRef.current = toolStatus;
  }, [toolStatus]);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  useEffect(() => {
    const total = entries.length;
    const prevTotal = prevEntryCountRef.current;

    setRenderWindow((prev) => {
      if (total === 0) {
        return { start: 0, end: 0 };
      }
      const restore = restoreRenderWindowRef.current;
      if (restore && !restoredRenderWindowRef.current) {
        restoredRenderWindowRef.current = true;
        restoreRenderWindowRef.current = null;
        const safeEnd = Math.max(0, Math.min(total, restore.end));
        const safeStart = Math.max(0, Math.min(safeEnd, restore.start));
        if (safeEnd === 0) {
          const span = Math.min(DEFAULT_RENDER_WINDOW, total);
          const end = total;
          const start = Math.max(0, end - span);
          return { start, end };
        }
        const span = Math.min(DEFAULT_RENDER_WINDOW, total);
        const end = safeEnd;
        let start = safeStart;
        if (end - start > span) {
          start = Math.max(0, end - span);
        }
        return { start, end };
      }
      const span = Math.min(DEFAULT_RENDER_WINDOW, total);
      let start = prev.start;
      let end = prev.end;

      if (start === 0 && end === 0) {
        end = total;
        start = Math.max(0, end - span);
        return { start, end };
      }

      if (autoScrollPinnedRef.current || prev.end === prevTotal) {
        end = total;
        start = Math.max(0, end - span);
        return { start, end };
      }

      if (end > total) {
        end = total;
        start = Math.max(0, end - span);
      }

      if (end - start > span) {
        start = Math.max(0, end - span);
      }

      if (start === prev.start && end === prev.end) {
        return prev;
      }

      return { start, end };
    });

    prevEntryCountRef.current = total;
  }, [entries]);

  useEffect(() => {
    if (agentPresenceStatus === 'working') {
      if (agentStatus !== 'thinking') {
        setAgentStatus('thinking');
      }
      if (!statusStartedAt) {
        setStatusStartedAt(Date.now());
        setStatusElapsed(0);
      }
      return;
    }
    if (agentStatus === 'thinking' && !isStreaming) {
      setAgentStatus('idle');
    }
  }, [agentPresenceStatus, agentStatus, isStreaming, statusStartedAt]);

  const enqueuePrompt = useCallback((prompt: string) => {
    queuedPromptsRef.current = [...queuedPromptsRef.current, prompt];
    setQueuedCount(queuedPromptsRef.current.length);
  }, []);

  const dequeuePrompt = useCallback(() => {
    const next = queuedPromptsRef.current.shift();
    setQueuedCount(queuedPromptsRef.current.length);
    return next;
  }, []);

  useEffect(() => {
    let active = true;
    draftLoadedRef.current = false;
    draftDirtyRef.current = false;
    const loadHistory = async () => {
      try {
        viewStateHydratingRef.current = true;
        const [stateResult, draftResult] = await Promise.all([
          window.electronAPI.getAgentTerminalState(workspacePath, agentId),
          window.electronAPI.getAgentTerminalDraft(workspacePath, agentId),
        ]);
        if (!active) return;
        const storedState = stateResult.success ? stateResult.state : null;
        const viewState = storedState?.viewState ?? null;
        const expandedIds = new Set(viewState?.expandedEntryIds ?? []);
        const loadedEntries = (storedState?.entries ?? []).map((entry) => {
          if (entry.type !== 'tool') return entry;
          if (expandedIds.has(entry.id)) {
            return { ...entry, expanded: true };
          }
          return entry;
        });
        setEntries(loadedEntries);
        if (viewState) {
          if (typeof viewState.searchOpen === 'boolean') {
            setSearchOpen(viewState.searchOpen);
          }
          if (typeof viewState.searchQuery === 'string') {
            setSearchQuery(viewState.searchQuery);
          }
          if (typeof viewState.activeMatchIndex === 'number') {
            setActiveMatchIndex(viewState.activeMatchIndex);
          }
          if (viewState.renderWindow) {
            restoreRenderWindowRef.current = viewState.renderWindow;
            restoredRenderWindowRef.current = false;
            setRenderWindow(viewState.renderWindow);
          }
          if (typeof viewState.autoScrollPinned === 'boolean') {
            setAutoScrollPinned(viewState.autoScrollPinned);
            autoScrollPinnedRef.current = viewState.autoScrollPinned;
          }
          if (typeof viewState.scrollTop === 'number') {
            pendingScrollRestoreRef.current = viewState.scrollTop;
          }
          if (viewState.contextUsage !== undefined) {
            setContextUsage(viewState.contextUsage);
          }
          if (viewState.lastRunDuration !== undefined) {
            setLastRunDuration(viewState.lastRunDuration ?? null);
          }
          if (viewState.agentStatus) {
            setAgentStatus(viewState.agentStatus);
          }
          if (viewState.toolStatus !== undefined) {
            setToolStatus(viewState.toolStatus);
          }
          if (viewState.statusStartedAt !== undefined) {
            setStatusStartedAt(viewState.statusStartedAt ?? null);
          }
          if (Array.isArray(viewState.queuedPrompts)) {
            queuedPromptsRef.current = [...viewState.queuedPrompts];
            setQueuedCount(queuedPromptsRef.current.length);
          }
        }
        if (draftResult.success && draftResult.draft && !draftDirtyRef.current) {
          setInputValue(draftResult.draft);
        }
        draftLoadedRef.current = true;
        viewStateLoadedRef.current = true;
        viewStateHydratingRef.current = false;
      } catch {
        setEntries([]);
        draftLoadedRef.current = true;
        viewStateLoadedRef.current = true;
        viewStateHydratingRef.current = false;
      }
    };

    void loadHistory();
    return () => {
      active = false;
    };
  }, [agentId, workspacePath]);

  useEffect(() => {
    if (!draftLoadedRef.current) return;
    if (draftSaveTimerRef.current) {
      clearTimeout(draftSaveTimerRef.current);
    }
    draftSaveTimerRef.current = setTimeout(() => {
      void window.electronAPI.setAgentTerminalDraft(workspacePath, agentId, inputValue);
    }, 300);
    return () => {
      if (draftSaveTimerRef.current) {
        clearTimeout(draftSaveTimerRef.current);
      }
    };
  }, [inputValue, workspacePath, agentId]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    if (manualResizeRef.current) return;
    autoResizeRef.current = true;
    el.style.height = 'auto';
    const nextHeight = Math.min(el.scrollHeight, INPUT_AUTO_MAX_HEIGHT);
    el.style.height = `${nextHeight}px`;
  }, [inputValue]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (autoResizeRef.current) {
        autoResizeRef.current = false;
        return;
      }
      manualResizeRef.current = true;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (savedPanelBounds) {
      setPanelBounds(clampPanelBounds(savedPanelBounds));
    }
  }, [savedPanelBounds]);

  const savePanelBounds = useCallback((bounds: { x: number; y: number; width: number; height: number }) => {
    if (panelBoundsSaveTimerRef.current) {
      clearTimeout(panelBoundsSaveTimerRef.current);
    }
    panelBoundsSaveTimerRef.current = setTimeout(() => {
      const newBounds: AgentTerminalPanelBounds = bounds;
      saveSettings({ agentTerminalPanelBounds: newBounds });
      void refreshAppSettings();
    }, 300);
  }, []);

  useEffect(() => {
    return () => {
      if (panelBoundsSaveTimerRef.current) {
        clearTimeout(panelBoundsSaveTimerRef.current);
        panelBoundsSaveTimerRef.current = null;
      }
    };
  }, []);

  const collectViewState = useCallback((): AgentTerminalViewState => {
    const expandedEntryIds = entries
      .filter((entry) => entry.type === 'tool' && entry.expanded)
      .map((entry) => entry.id);
    return {
      expandedEntryIds,
      searchOpen,
      searchQuery,
      activeMatchIndex,
      renderWindow: renderWindowRef.current,
      autoScrollPinned: autoScrollPinnedRef.current,
      scrollTop: scrollTopRef.current,
      contextUsage,
      lastRunDuration,
      statusStartedAt,
      agentStatus,
      toolStatus,
      queuedPrompts: queuedPromptsRef.current,
    };
  }, [
    entries,
    searchOpen,
    searchQuery,
    activeMatchIndex,
    contextUsage,
    lastRunDuration,
    statusStartedAt,
    agentStatus,
    toolStatus,
  ]);

  const scheduleViewStateSave = useCallback(
    (nextState: AgentTerminalViewState) => {
      if (!viewStateLoadedRef.current || viewStateHydratingRef.current) return;
      pendingViewStateRef.current = nextState;
      if (viewStateSaveTimerRef.current) {
        clearTimeout(viewStateSaveTimerRef.current);
      }
      viewStateSaveTimerRef.current = setTimeout(() => {
        viewStateSaveTimerRef.current = null;
        const state = pendingViewStateRef.current;
        if (!state) return;
        void window.electronAPI.setAgentTerminalState(workspacePath, agentId, { viewState: state });
      }, 300);
    },
    [workspacePath, agentId]
  );

  useEffect(() => {
    return () => {
      if (viewStateSaveTimerRef.current) {
        clearTimeout(viewStateSaveTimerRef.current);
        viewStateSaveTimerRef.current = null;
      }
      if (!viewStateLoadedRef.current || viewStateHydratingRef.current) return;
      const state = pendingViewStateRef.current ?? collectViewState();
      void window.electronAPI.setAgentTerminalState(workspacePath, agentId, { viewState: state });
    };
  }, [collectViewState, workspacePath, agentId]);

  const handleResizeStart = useCallback(
    (edge: ResizeEdge) => (e: MouseEvent) => {
      if (embedded) return;
      e.preventDefault();
      e.stopPropagation();
      resizingRef.current = {
        edge,
        startX: e.clientX,
        startY: e.clientY,
        startBounds: { ...panelBounds },
      };
      document.body.style.cursor = getCursorForEdge(edge);
      document.body.style.userSelect = 'none';
    },
    [embedded, panelBounds]
  );

  const handleDragStart = useCallback(
    (e: MouseEvent) => {
      if (embedded) return;
      e.preventDefault();
      e.stopPropagation();
      draggingRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startPanelX: panelBounds.x,
        startPanelY: panelBounds.y,
      };
      document.body.style.cursor = 'move';
      document.body.style.userSelect = 'none';
    },
    [embedded, panelBounds]
  );

  useEffect(() => {
    const handleMouseMove = (e: globalThis.MouseEvent) => {
      const topOffset = TITLEBAR_HEIGHT + PANEL_MARGIN;
      if (draggingRef.current) {
        const { startX, startY, startPanelX, startPanelY } = draggingRef.current;
        const currentBounds = panelBoundsRef.current;
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;
        const maxX = window.innerWidth - currentBounds.width - PANEL_MARGIN;
        const maxY = window.innerHeight - currentBounds.height - PANEL_MARGIN;
        const newX = Math.max(PANEL_MARGIN, Math.min(maxX, startPanelX + deltaX));
        const newY = Math.max(topOffset, Math.min(maxY, startPanelY + deltaY));
        setPanelBounds((prev) => ({ ...prev, x: newX, y: newY }));
        return;
      }

      if (!resizingRef.current) return;
      const { edge, startX, startY, startBounds } = resizingRef.current;
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      let newX = startBounds.x;
      let newY = startBounds.y;
      let newWidth = startBounds.width;
      let newHeight = startBounds.height;

      if (edge.includes('left')) {
        const maxWidth = startBounds.x + startBounds.width - PANEL_MARGIN;
        const potentialWidth = Math.min(maxWidth, startBounds.width - deltaX);
        if (potentialWidth >= MIN_PANEL_WIDTH) {
          newWidth = potentialWidth;
          newX = startBounds.x + startBounds.width - newWidth;
        } else {
          newWidth = MIN_PANEL_WIDTH;
          newX = startBounds.x + startBounds.width - MIN_PANEL_WIDTH;
        }
      }
      if (edge.includes('right')) {
        const maxWidth = window.innerWidth - newX - PANEL_MARGIN;
        newWidth = Math.max(MIN_PANEL_WIDTH, Math.min(maxWidth, startBounds.width + deltaX));
      }
      if (edge.includes('top')) {
        const maxHeight = startBounds.y + startBounds.height - topOffset;
        const potentialHeight = Math.min(maxHeight, startBounds.height - deltaY);
        if (potentialHeight >= MIN_PANEL_HEIGHT) {
          newHeight = potentialHeight;
          newY = startBounds.y + startBounds.height - newHeight;
        } else {
          newHeight = MIN_PANEL_HEIGHT;
          newY = startBounds.y + startBounds.height - MIN_PANEL_HEIGHT;
        }
      }
      if (edge.includes('bottom')) {
        const maxHeight = window.innerHeight - newY - PANEL_MARGIN;
        newHeight = Math.max(MIN_PANEL_HEIGHT, Math.min(maxHeight, startBounds.height + deltaY));
      }

      newX = Math.max(PANEL_MARGIN, newX);
      newY = Math.max(topOffset, newY);
      const maxX = window.innerWidth - newWidth - PANEL_MARGIN;
      newX = Math.min(maxX, newX);

      setPanelBounds({ x: newX, y: newY, width: newWidth, height: newHeight });
    };

    const handleMouseUp = () => {
      if (resizingRef.current || draggingRef.current) {
        savePanelBounds(panelBoundsRef.current);
        resizingRef.current = null;
        draggingRef.current = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [panelBoundsRef, savePanelBounds]);

  const updateEntry = useCallback((id: string, updater: (entry: ChatEntry) => ChatEntry) => {
    setEntries((prev) => prev.map((entry) => (entry.id === id ? updater(entry) : entry)));
  }, []);

  const appendAssistantText = useCallback(
    (text: string) => {
      if (!text) return;
      const normalized = normalizeText(text);
      const shouldMerge = (incoming: string, existing: string) =>
        incoming === existing || incoming.startsWith(existing) || existing.startsWith(incoming);
      const lastMessage = lastAssistantMessageRef.current;
      const activeRunId = activeRunIdRef.current;
      if (lastMessage && lastMessage.runId === activeRunId && shouldMerge(normalized, lastMessage.content)) {
        const nextContent = normalized.length > lastMessage.content.length ? normalized : lastMessage.content;
        lastAssistantMessageRef.current = { ...lastMessage, content: nextContent };
        if (!lastMessage.pending && nextContent !== lastMessage.content) {
          updateEntry(lastMessage.id, (entry) =>
            entry.type === 'message' ? { ...entry, content: nextContent } : entry
          );
        }
        return;
      }
      if (!currentAssistantIdRef.current) {
        for (let i = entriesRef.current.length - 1; i >= 0; i -= 1) {
          const entry = entriesRef.current[i];
          if (entry.type !== 'message') continue;
          if (entry.role !== 'assistant') break;
          if (!shouldMerge(normalized, entry.content)) break;
          currentAssistantIdRef.current = entry.id;
          streamedAssistantIdRef.current = entry.id;
          if (normalized.length > entry.content.length) {
            updateEntry(entry.id, (prev) =>
              prev.type === 'message' ? { ...prev, content: normalized } : prev
            );
          }
          return;
        }
        const id = createId();
        currentAssistantIdRef.current = id;
        streamedAssistantIdRef.current = id;
        setEntries((prev) => [...prev, { id, type: 'message', role: 'assistant', content: normalized }]);
        return;
      }
      updateEntry(currentAssistantIdRef.current, (entry) => {
        if (entry.type !== 'message') return entry;
        return { ...entry, content: entry.content + normalized };
      });
    },
    [updateEntry]
  );

  const handleAssistantMessage = useCallback((content: string, usage?: TokenUsage, messageId?: string) => {
    if (!content) return;
    const normalized = normalizeText(content);
    const fallbackId = messageId ?? createId();
    lastAssistantMessageRef.current = {
      id: fallbackId,
      content: normalized,
      runId: activeRunIdRef.current,
      timestamp: Date.now(),
      pending: true,
    };
    setEntries((prev) => {
      const next = [...prev];
      const streamedId = streamedAssistantIdRef.current;
      if (streamedId) {
        const index = next.findIndex((entry) => entry.id === streamedId);
        if (index >= 0) {
          const entry = next[index];
          if (entry.type === 'message') {
            const existing = entry.content;
            const shouldMerge =
              normalized === existing || normalized.startsWith(existing) || existing.startsWith(normalized);
            if (shouldMerge) {
              next[index] = {
                ...entry,
                role: 'assistant',
                content: normalized,
                usage: usage ?? entry.usage,
                messageId: messageId ?? entry.messageId,
              };
              lastAssistantMessageRef.current = {
                id: streamedId,
                content: normalized,
                runId: activeRunIdRef.current,
                timestamp: Date.now(),
                pending: false,
              };
              currentAssistantIdRef.current = null;
              streamedAssistantIdRef.current = null;
              return next;
            }
          }
        }
      }
      for (let i = next.length - 1; i >= 0; i -= 1) {
        const entry = next[i];
        if (entry.type !== 'message') continue;
        if (entry.role !== 'assistant') break;
        const existing = entry.content;
        const shouldMerge =
          normalized === existing || normalized.startsWith(existing) || existing.startsWith(normalized);
        if (shouldMerge) {
          next[i] = {
            ...entry,
            content: normalized,
            usage: usage ?? entry.usage,
            messageId: messageId ?? entry.messageId,
          };
          lastAssistantMessageRef.current = {
            id: entry.id,
            content: normalized,
            runId: activeRunIdRef.current,
            timestamp: Date.now(),
            pending: false,
          };
          currentAssistantIdRef.current = null;
          streamedAssistantIdRef.current = null;
          return next;
        }
        break;
      }
      const latest = lastAssistantMessageRef.current;
      const contentToStore = latest && latest.runId === activeRunIdRef.current ? latest.content : normalized;
      const id = messageId ?? fallbackId;
      lastAssistantMessageRef.current = {
        id,
        content: contentToStore,
        runId: activeRunIdRef.current,
        timestamp: Date.now(),
        pending: false,
      };
      next.push({ id, type: 'message', role: 'assistant', content: contentToStore, usage, messageId });
      currentAssistantIdRef.current = null;
      streamedAssistantIdRef.current = null;
      return next;
    });
  }, []);

  const addToolEntry = useCallback((entry: Omit<Extract<ChatEntry, { type: 'tool' }>, 'id' | 'type'>) => {
    const id = createId();
    setEntries((prev) => [...prev, { type: 'tool', expanded: false, ...entry, id }]);
    return id;
  }, []);

  const addSystemMessage = useCallback((message: string) => {
    setEntries((prev) => [...prev, { id: createId(), type: 'message', role: 'system', content: message }]);
  }, []);

  const resetRunState = useCallback(() => {
    activeRunIdRef.current = null;
    currentAssistantIdRef.current = null;
    toolEntryMapRef.current.clear();
    streamedAssistantIdRef.current = null;
    lastAssistantMessageRef.current = null;
    setIsStreaming(false);
    setAgentStatus('idle');
    setToolStatus(null);
    if (statusStartedAt) {
      setLastRunDuration(Date.now() - statusStartedAt);
    } else if (statusElapsed > 0) {
      setLastRunDuration(statusElapsed);
    }
    setStatusStartedAt(null);
    setStatusElapsed(0);
  }, [statusElapsed, statusStartedAt]);

  const getUsageTotalForProvider = useCallback(
    (usage?: TokenUsage | null): number | null => {
      const base = getUsageTotal(usage);
      if (base === null) return null;
      if (agentProvider !== 'codex') return base;
      const cached = typeof usage?.cached_input_tokens === 'number' ? usage.cached_input_tokens : 0;
      if (!cached) return base;
      return Math.max(0, base - cached);
    },
    [agentProvider]
  );

  const formatModelLabel = useCallback(
    (model: string) => {
      const cleanModel = model.trim();
      if (!cleanModel) return `${providerLabel} · default`;
      return `${providerLabel} · ${cleanModel}`;
    },
    [providerLabel]
  );

  const updateModelsLoading = useCallback((delta: number) => {
    modelsLoadingCountRef.current = Math.max(0, modelsLoadingCountRef.current + delta);
    const next = modelsLoadingCountRef.current > 0;
    setModelsLoading((prev) => (prev === next ? prev : next));
  }, []);

  const refreshRecentModels = useCallback(
    async (options?: {
      force?: boolean;
      showLoading?: boolean;
      loadingDelayMs?: number;
    }): Promise<AgentModelInfo[]> => {
      const force = options?.force ?? false;
      if (!force && recentModels !== null) return recentModels;
      const requestRef = force ? modelsRefreshRef : modelsRequestRef;
      if (requestRef.current) return await requestRef.current;
      const fetchId = ++modelsFetchIdRef.current;
      const showLoading = options?.showLoading ?? true;
      const loadingDelayMs = Math.max(0, options?.loadingDelayMs ?? 0);
      let loadingTimer: ReturnType<typeof setTimeout> | null = null;
      let loadingShown = false;
      const startLoading = () => {
        if (loadingShown || !showLoading) return;
        loadingShown = true;
        updateModelsLoading(1);
      };
      const request = (async () => {
        if (showLoading) {
          if (loadingDelayMs > 0) {
            loadingTimer = setTimeout(startLoading, loadingDelayMs);
          } else {
            startLoading();
          }
        }
        try {
          const models = await window.electronAPI.agentConnectModelsRecent(
            agentProvider,
            force ? { force: true } : undefined
          );
          if (modelsFetchIdRef.current === fetchId) {
            setRecentModels(models);
          }
          return models;
        } catch (error) {
          console.error('[agent-terminal] Failed to refresh recent models', error);
          return recentModels ?? [];
        } finally {
          if (loadingTimer) {
            clearTimeout(loadingTimer);
            loadingTimer = null;
          }
          if (loadingShown) {
            updateModelsLoading(-1);
          }
        }
      })();
      requestRef.current = request;
      try {
        return await request;
      } finally {
        if (requestRef.current === request) {
          requestRef.current = null;
        }
      }
    },
    [agentProvider, recentModels, updateModelsLoading]
  );

  useEffect(() => {
    if (recentModels !== null) return;
    void refreshRecentModels();
  }, [recentModels, refreshRecentModels]);

  const modelOptions = useMemo(() => {
    const options: Array<{ id: string; label: string }> = [];
    const seen = new Set<string>();
    const currentId = currentModel.trim();
    if (currentId) {
      const currentMatch = (recentModels ?? []).find((model) => model.id.trim() === currentId);
      const currentLabel = currentMatch?.displayName?.trim() || currentId;
      options.push({ id: currentId, label: currentLabel });
      seen.add(currentId);
    }
    (recentModels ?? []).forEach((model) => {
      const id = model.id.trim();
      if (!id || seen.has(id)) return;
      const label = model.displayName?.trim() || id;
      options.push({ id, label });
      seen.add(id);
    });
    if (options.length === 0) {
      options.push({ id: '', label: 'default' });
    }
    return options;
  }, [currentModel, recentModels]);

  const currentModelInfo = useMemo(() => {
    const id = currentModel.trim();
    if (!id) return null;
    return (recentModels ?? []).find((model) => model.id === id) ?? null;
  }, [currentModel, recentModels]);

  const reasoningOptions = useMemo(() => {
    if (agentProvider !== 'codex') return [];
    if (currentModelInfo?.reasoningEfforts?.length) {
      return currentModelInfo.reasoningEfforts;
    }
    const deduped = new Map<string, string>();
    (recentModels ?? []).forEach((model) => {
      (model.reasoningEfforts ?? []).forEach((effort) => {
        const id = effort.id?.trim();
        if (!id || deduped.has(id)) return;
        deduped.set(id, effort.label?.trim() || id);
      });
    });
    return Array.from(deduped, ([id, label]) => ({ id, label }));
  }, [agentProvider, currentModelInfo, recentModels]);

  const providerDefaultReasoning = useMemo(() => {
    if (agentProvider !== 'codex') return null;
    const explicit = currentModelInfo?.defaultReasoningEffort?.trim();
    if (explicit) return explicit;
    const fromModels =
      (recentModels ?? [])
        .map((model) => model.defaultReasoningEffort?.trim())
        .find((effort) => effort && effort.length > 0) ?? null;
    if (fromModels) return fromModels;
    return 'medium';
  }, [agentProvider, currentModelInfo, recentModels]);

  const resolveDefaultReasoningForModel = useCallback(
    (modelId: string): string | null => {
      if (agentProvider !== 'codex') return null;
      const storedDefault =
        appSettings.settings.defaultReasoningEffortByProvider?.[agentProvider]?.trim() ?? '';
      if (storedDefault) return storedDefault;
      const match = (recentModels ?? []).find((model) => model.id === modelId);
      const modelDefault = match?.defaultReasoningEffort?.trim();
      if (modelDefault) return modelDefault;
      return providerDefaultReasoning ?? null;
    },
    [
      agentProvider,
      appSettings.settings.defaultReasoningEffortByProvider,
      recentModels,
      providerDefaultReasoning,
    ]
  );

  const runSetAgentModel = useCallback(
    async (model: string) =>
      runCommand({
        id: 'set-agent-model',
        source: 'ui',
        args: { agentId, model },
      }),
    [agentId, runCommand]
  );

  const runSetAgentReasoningEffort = useCallback(
    async (reasoningEffort: string | null) =>
      runCommand({
        id: 'set-agent-reasoning-effort',
        source: 'ui',
        args: { agentId, reasoningEffort },
      }),
    [agentId, runCommand]
  );

  const applyDefaultReasoning = useCallback(
    async (modelId: string) => {
      const next = resolveDefaultReasoningForModel(modelId);
      if (!next) return;
      const result = await runSetAgentReasoningEffort(next);
      if (!result.ok) {
        addSystemMessage(result.error || 'Failed to set default reasoning level');
        return;
      }
      setCurrentReasoningEffort(next);
    },
    [resolveDefaultReasoningForModel, addSystemMessage, runSetAgentReasoningEffort]
  );

  useEffect(() => {
    const current = currentModel.trim();
    if (current) return;
    if (!recentModels || recentModels.length === 0) return;
    const next = recentModels[0]?.id?.trim();
    if (!next) return;
    if (defaultModelAttemptedRef.current === next) return;
    defaultModelAttemptedRef.current = next;

    void (async () => {
      const result = await runSetAgentModel(next);
      if (!result.ok) {
        addSystemMessage(result.error || 'Failed to set default model');
        return;
      }
      setCurrentModel(next);
      setCurrentReasoningEffort(null);
      await applyDefaultReasoning(next);
    })();
  }, [currentModel, recentModels, addSystemMessage, applyDefaultReasoning, runSetAgentModel]);

  const reasoningChoices = useMemo(() => {
    const options: Array<{ id: string; label: string; isDefault: boolean }> = [];
    const defaultEffort = providerDefaultReasoning ?? null;
    const seen = new Set<string>();
    reasoningOptions.forEach((option) => {
      const id = option.id?.trim();
      if (!id || seen.has(id)) return;
      const isDefault = defaultEffort ? id === defaultEffort : false;
      options.push({ id, label: option.label?.trim() || id, isDefault });
      seen.add(id);
    });
    const current = currentReasoningEffort?.trim();
    if (current && !seen.has(current)) {
      options.push({ id: current, label: current, isDefault: current === defaultEffort });
    }
    return options;
  }, [providerDefaultReasoning, reasoningOptions, currentReasoningEffort]);

  const showReasoningSelect = agentProvider === 'codex' && reasoningOptions.length > 0;

  const renderedEntries = useMemo(() => {
    const total = entries.length;
    if (total === 0) return [] as ChatEntry[];
    if (renderWindow.start === 0 && renderWindow.end === 0) {
      const end = total;
      const start = Math.max(0, end - Math.min(DEFAULT_RENDER_WINDOW, end));
      return entries.slice(start, end);
    }
    return entries.slice(renderWindow.start, renderWindow.end);
  }, [entries, renderWindow]);

  const searchMatches = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [] as string[];
    const matches: string[] = [];
    renderedEntries.forEach((entry) => {
      if (entry.type === 'message') {
        if (entry.content.toLowerCase().includes(query)) matches.push(entry.id);
        return;
      }
      const haystack = `${entry.title} ${entry.input ?? ''} ${entry.output ?? ''}`.toLowerCase();
      if (haystack.includes(query)) matches.push(entry.id);
    });
    return matches;
  }, [renderedEntries, searchQuery]);

  useEffect(() => {
    if (!searchOpen) return;
    if (searchMatches.length === 0) {
      setActiveMatchIndex(0);
      return;
    }
    setActiveMatchIndex((prev) => {
      if (prev < searchMatches.length) return prev;
      return searchMatches.length - 1;
    });
  }, [searchMatches, searchOpen]);

  const handleModelChange = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed || trimmed === currentModel.trim()) return;
      setCurrentModel(trimmed);
      setCurrentReasoningEffort(null);
      const result = await runSetAgentModel(trimmed);
      if (!result.ok) {
        setCurrentModel(agentModel);
        setCurrentReasoningEffort(agentReasoningEffort ?? null);
        addSystemMessage(result.error || 'Failed to update agent model');
        return;
      }
      await applyDefaultReasoning(trimmed);
    },
    [
      agentModel,
      agentReasoningEffort,
      currentModel,
      addSystemMessage,
      applyDefaultReasoning,
      runSetAgentModel,
    ]
  );

  const handleReasoningChange = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      const next = trimmed.length > 0 ? trimmed : null;
      if ((currentReasoningEffort ?? null) === next) return;
      setCurrentReasoningEffort(next);
      const result = await runSetAgentReasoningEffort(next);
      if (!result.ok) {
        setCurrentReasoningEffort(agentReasoningEffort ?? null);
        addSystemMessage(result.error || 'Failed to update reasoning level');
        return;
      }
      void refreshAppSettings();
    },
    [agentReasoningEffort, currentReasoningEffort, addSystemMessage, runSetAgentReasoningEffort]
  );

  useEffect(() => {
    renderWindowRef.current = renderWindow;
  }, [renderWindow]);

  useEffect(() => {
    autoScrollPinnedRef.current = autoScrollPinned;
  }, [autoScrollPinned]);

  useEffect(() => {
    if (!viewStateLoadedRef.current) return;
    scheduleViewStateSave(collectViewState());
  }, [collectViewState, scheduleViewStateSave, queuedCount]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const pending = pendingPrependScrollRef.current;
    if (pending) {
      const delta = el.scrollHeight - pending.prevScrollHeight;
      el.scrollTop = pending.prevScrollTop + delta;
      pendingPrependScrollRef.current = null;
      loadingOlderRef.current = false;
    }
  }, [renderWindow]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (pendingScrollRestoreRef.current === null) return;
    el.scrollTop = pendingScrollRestoreRef.current;
    scrollTopRef.current = el.scrollTop;
    pendingScrollRestoreRef.current = null;
  }, [renderWindow, entries]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (!autoScrollPinnedRef.current) return;
    el.scrollTop = el.scrollHeight;
    scrollTopRef.current = el.scrollTop;
  }, [entries, renderWindow]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const pinned = distanceFromBottom < 60;
    setAutoScrollPinned(pinned);
    scrollTopRef.current = el.scrollTop;

    const total = entriesRef.current.length;
    if (
      !loadingOlderRef.current &&
      el.scrollTop <= TOP_LOAD_THRESHOLD_PX &&
      renderWindowRef.current.start > 0
    ) {
      loadingOlderRef.current = true;
      const snapshotTop = el.scrollTop;
      const snapshotHeight = el.scrollHeight;
      setRenderWindow((prev) => {
        const span = Math.min(DEFAULT_RENDER_WINDOW, total);
        let nextStart = Math.max(0, prev.start - PREPEND_BATCH_SIZE);
        const nextEnd = Math.min(total, nextStart + span);
        if (nextEnd - nextStart < span) {
          nextStart = Math.max(0, nextEnd - span);
        }
        if (nextStart === prev.start && nextEnd === prev.end) {
          loadingOlderRef.current = false;
          return prev;
        }
        pendingPrependScrollRef.current = { prevScrollTop: snapshotTop, prevScrollHeight: snapshotHeight };
        return { start: nextStart, end: nextEnd };
      });
    } else if (distanceFromBottom <= BOTTOM_LOAD_THRESHOLD_PX && renderWindowRef.current.end < total) {
      setRenderWindow((prev) => {
        const span = Math.min(DEFAULT_RENDER_WINDOW, total);
        const nextEnd = Math.min(total, prev.end + PREPEND_BATCH_SIZE);
        const nextStart = Math.max(0, nextEnd - span);
        if (nextStart === prev.start && nextEnd === prev.end) return prev;
        return { start: nextStart, end: nextEnd };
      });
    }
    scheduleViewStateSave(collectViewState());
  };

  useEffect(() => {
    eventHandlerRef.current = (payload) => {
      if (!payload || payload.unit.type !== 'agent' || payload.unit.id !== agentId) return;
      if (activeRunIdRef.current && payload.runId !== activeRunIdRef.current) return;
      const ev = payload.event as AgentConnectEvent;
      if (!ev || typeof ev !== 'object') return;

      if (ev.type === 'delta') {
        if (typeof ev.text === 'string' && ev.text) {
          if (toolStatusRef.current?.state === 'running') return;
          appendAssistantText(ev.text);
        }
        return;
      }

      if (ev.type === 'message') {
        const role = ev.role === 'user' || ev.role === 'system' ? ev.role : 'assistant';
        const content = typeof ev.content === 'string' ? ev.content : '';
        if (!content) return;
        if (role === 'user') return;
        if (role === 'assistant') {
          handleAssistantMessage(content, ev.usage, ev.messageId);
          return;
        }
        setEntries((prev) => [
          ...prev,
          {
            id: ev.messageId ?? createId(),
            type: 'message',
            role: 'system',
            content,
            usage: ev.usage,
            messageId: ev.messageId,
          },
        ]);
        return;
      }

      if (ev.type === 'tool_call') {
        const input = typeof ev.input === 'string' ? ev.input.trim() : '';
        const title = input || ev.name?.trim() || 'Tool call';
        if (ev.phase === 'start') {
          const toolId = addToolEntry({
            title,
            status: 'running',
            name: ev.name,
            input: ev.input,
          });
          if (ev.callId) toolEntryMapRef.current.set(ev.callId, toolId);
          if (title) {
            setToolStatus({ state: 'running', command: title });
          }
        } else {
          const toolId = ev.callId ? toolEntryMapRef.current.get(ev.callId) : undefined;
          setToolStatus((prev) => {
            if (ev.status === 'error' && title) {
              return { state: 'error', command: title };
            }
            if (prev?.state === 'running' && prev.command === title) {
              return null;
            }
            return prev;
          });
          if (toolId) {
            updateEntry(toolId, (entry) => {
              if (entry.type !== 'tool') return entry;
              return {
                ...entry,
                status: ev.status ?? 'completed',
                name: entry.name ?? ev.name,
                input: entry.input ?? ev.input,
                output: typeof ev.output === 'string' ? ev.output : entry.output,
              };
            });
          } else {
            addToolEntry({
              title,
              status: ev.status ?? 'completed',
              name: ev.name,
              input: ev.input,
              output: typeof ev.output === 'string' ? ev.output : undefined,
            });
          }
        }
        return;
      }

      if (ev.type === 'raw_line') {
        return;
      }

      if (ev.type === 'usage') {
        return;
      }

      if (ev.type === 'context_usage') {
        setContextUsage(ev.contextUsage);
        return;
      }

      if (ev.type === 'thinking') {
        const detail = typeof ev.text === 'string' ? ev.text.trim() : '';
        setAgentStatus('thinking');
        if (!statusStartedAt) {
          setStatusStartedAt(Date.now());
          setStatusElapsed(0);
        }
        if (detail) {
          const last = entriesRef.current[entriesRef.current.length - 1];
          if (!(last && last.type === 'message' && last.variant === 'thinking' && last.content === detail)) {
            setEntries((prev) => [
              ...prev,
              {
                id: createId(),
                type: 'message',
                role: 'assistant',
                content: detail,
                variant: 'thinking',
              },
            ]);
          }
        }
        return;
      }

      if (ev.type === 'status') {
        if (ev.status === 'thinking') {
          setAgentStatus('thinking');
          if (!statusStartedAt) {
            setStatusStartedAt(Date.now());
            setStatusElapsed(0);
          }
          return;
        }
        if (ev.status === 'idle') {
          setAgentStatus('idle');
          if (statusStartedAt) {
            setLastRunDuration(Date.now() - statusStartedAt);
          } else if (statusElapsed > 0) {
            setLastRunDuration(statusElapsed);
          }
          setStatusStartedAt(null);
          setStatusElapsed(0);
          setToolStatus((prev) => (prev?.state === 'running' ? null : prev));
          return;
        }
        if (ev.status === 'error') {
          setAgentStatus('error');
          addSystemMessage(ev.message || 'Run failed');
          resetRunState();
          return;
        }
      }

      if (ev.type === 'final') {
        resetRunState();
        return;
      }

      if (ev.type === 'error') {
        addSystemMessage(ev.message || 'Run failed');
        resetRunState();
      }
    };
  }, [
    agentId,
    appendAssistantText,
    handleAssistantMessage,
    addToolEntry,
    addSystemMessage,
    resetRunState,
    updateEntry,
    statusStartedAt,
    statusElapsed,
  ]);

  useEffect(() => {
    if (!canStream) return;
    const cleanup = window.electronAPI.onAgentConnectEvent((payload) => {
      eventHandlerRef.current(payload);
    });
    return () => {
      cleanup();
    };
  }, [agentId, canStream]);

  useEffect(() => {
    if (agentStatus !== 'thinking' || !statusStartedAt) return;
    const tick = () => {
      setStatusElapsed(Date.now() - statusStartedAt);
    };
    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, [agentStatus, statusStartedAt]);

  const cancelRun = useCallback(async () => {
    const result = await runCommand({
      id: 'cancel-agent-run',
      source: 'ui',
      args: { agentId },
    });
    if (!result.ok) {
      addSystemMessage(result.error || 'Failed to cancel run');
    }
  }, [agentId, runCommand, addSystemMessage]);

  useEffect(() => {
    if (!searchOpen) return;
    const focus = () => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    const frame = requestAnimationFrame(focus);
    return () => cancelAnimationFrame(frame);
  }, [searchOpen]);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const isCmdOrCtrl = event.metaKey || event.ctrlKey;
      if (key === 'escape' && searchOpen) {
        event.preventDefault();
        setSearchOpen(false);
        return;
      }
      if (isCmdOrCtrl && key === 'f') {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [runActive, cancelRun, searchOpen]);

  const runPrompt = useCallback(
    async (prompt: string) => {
      if (!attachedRelativePath || !canStream) {
        return;
      }

      if (!currentModel.trim()) {
        const models = recentModels ?? (await refreshRecentModels());
        const candidate = models.find((model) => model.id && model.id.trim())?.id?.trim();
        if (!candidate) {
          addSystemMessage('No models available for this provider.');
          resetRunState();
          return;
        }
        const update = await runSetAgentModel(candidate);
        if (!update.ok) {
          addSystemMessage(update.error || 'Failed to set default model');
          resetRunState();
          return;
        }
        setCurrentModel(candidate);
        setCurrentReasoningEffort(null);
        await applyDefaultReasoning(candidate);
      }

      const runId = `${agentProvider}-${Date.now()}`;
      setContextUsage(null);
      activeRunIdRef.current = runId;
      currentAssistantIdRef.current = null;
      streamedAssistantIdRef.current = null;
      toolEntryMapRef.current.clear();
      setIsStreaming(true);
      setAgentStatus('thinking');
      setToolStatus(null);
      setStatusStartedAt(Date.now());
      setStatusElapsed(0);

      setEntries((prev) => [...prev, { id: createId(), type: 'message', role: 'user', content: prompt }]);

      try {
        const relativePath = attachedRelativePath;
        const result = await runCommand({
          id: 'agent-send-prompt',
          source: 'ui',
          args: {
            agentId,
            prompt,
            relativePath,
            runId,
          },
        });
        if (!result.ok) {
          throw new Error(result.error || 'Run failed');
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        addSystemMessage(msg);
        resetRunState();
      }
    },
    [
      agentProvider,
      agentId,
      attachedRelativePath,
      canStream,
      currentModel,
      recentModels,
      refreshRecentModels,
      addSystemMessage,
      resetRunState,
      runCommand,
      applyDefaultReasoning,
      runSetAgentModel,
      setContextUsage,
    ]
  );

  const submitPrompt = useCallback(async () => {
    const prompt = buildPromptWithFiles(inputValue, selectedFiles);
    if (!prompt.trim()) return;
    if (!attachedRelativePath || !canStream) {
      return;
    }
    if (runActive) {
      enqueuePrompt(prompt);
      setInputValue('');
      setSelectedFiles([]);
      return;
    }
    setInputValue('');
    setSelectedFiles([]);
    await runPrompt(prompt);
  }, [inputValue, selectedFiles, attachedRelativePath, canStream, runActive, enqueuePrompt, runPrompt]);

  const handlePickFiles = useCallback(async () => {
    const files = await window.electronAPI.selectAgentFiles(workspacePath, {
      title: 'Select Files for Agent',
    });
    if (!files.length) return;
    setSelectedFiles((prev) => {
      const next = new Map(prev.map((file) => [file.path, file]));
      files.forEach((file) => next.set(file.path, file));
      return Array.from(next.values());
    });
    if (files.some((file) => !file.inWorkspace)) {
      addSystemMessage('External files will be referenced by absolute path.');
    }
  }, [workspacePath, addSystemMessage]);

  const handleRemoveSelectedFile = useCallback((filePath: string) => {
    setSelectedFiles((prev) => prev.filter((file) => file.path !== filePath));
  }, []);

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submitPrompt();
    }
  };

  const copyText = useCallback(async (id: string, text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopyState({ id, status: 'success' });
      setTimeout(() => setCopyState({ id: null, status: 'idle' }), 1500);
    } catch {
      setCopyState({ id, status: 'error' });
      setTimeout(() => setCopyState({ id: null, status: 'idle' }), 1500);
    }
  }, []);

  const scrollToEntry = useCallback((entryId: string) => {
    const container = scrollRef.current;
    if (!container) return;
    const target = container.querySelector<HTMLElement>(`[data-entry-id="${entryId}"]`);
    if (!target) return;
    if (typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ block: 'center' });
    }
  }, []);

  const getCopyLabel = (id: string) => {
    if (copyState.id !== id) return 'Copy';
    return copyState.status === 'success' ? 'Copied' : copyState.status === 'error' ? 'Error' : 'Copy';
  };

  const renderHighlightedText = useCallback(
    (text: string) => {
      if (!searchOpen) return text;
      const query = searchQuery.trim();
      if (!query) return text;
      const lower = text.toLowerCase();
      const needle = query.toLowerCase();
      if (!lower.includes(needle)) return text;
      const parts: Array<string | JSX.Element> = [];
      let cursor = 0;
      while (cursor < text.length) {
        const nextIndex = lower.indexOf(needle, cursor);
        if (nextIndex === -1) {
          parts.push(text.slice(cursor));
          break;
        }
        if (nextIndex > cursor) {
          parts.push(text.slice(cursor, nextIndex));
        }
        const matchText = text.slice(nextIndex, nextIndex + needle.length);
        parts.push(
          <mark key={`${nextIndex}-${matchText}`} className="agent-chat-highlight">
            {matchText}
          </mark>
        );
        cursor = nextIndex + needle.length;
      }
      return parts;
    },
    [searchOpen, searchQuery]
  );

  const goToMatch = useCallback(
    (direction: 1 | -1) => {
      if (searchMatches.length === 0) return;
      setActiveMatchIndex((prev) => {
        const next = (prev + direction + searchMatches.length) % searchMatches.length;
        return next;
      });
    },
    [searchMatches]
  );

  useEffect(() => {
    if (!searchOpen) return;
    if (searchMatches.length === 0) return;
    const targetId = searchMatches[activeMatchIndex];
    if (targetId) {
      scrollToEntry(targetId);
    }
  }, [searchOpen, searchMatches, activeMatchIndex, scrollToEntry]);

  const formatUsageSummary = useCallback(
    (usage: TokenUsage) => {
      const parts: string[] = [];
      if (typeof usage.input_tokens === 'number') parts.push(`In ${formatTokens(usage.input_tokens)}`);
      if (typeof usage.output_tokens === 'number') parts.push(`Out ${formatTokens(usage.output_tokens)}`);
      const total = getUsageTotalForProvider(usage);
      if (typeof total === 'number') parts.push(`Total ${formatTokens(total)}`);
      if (typeof usage.cached_input_tokens === 'number' && usage.cached_input_tokens > 0) {
        parts.push(`Cached ${formatTokens(usage.cached_input_tokens)}`);
      }
      if (typeof usage.reasoning_tokens === 'number' && usage.reasoning_tokens > 0) {
        parts.push(`Reasoning ${formatTokens(usage.reasoning_tokens)}`);
      }
      return parts;
    },
    [getUsageTotalForProvider]
  );

  const formatElapsed = (elapsedMs: number) => {
    const totalSeconds = Math.floor(elapsedMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  };

  const statusLine = useMemo(() => {
    const queuedSuffix = queuedCount > 0 ? ` · ${queuedCount} queued` : '';
    if (toolStatus?.state === 'error') {
      return { text: `Tool failed${queuedSuffix}`, tone: 'error', showTimer: false };
    }
    if (toolStatus?.state === 'running') {
      return { text: `Running…${queuedSuffix}`, tone: 'info', showTimer: false };
    }
    if (agentStatus === 'thinking') {
      return { text: `Running…${queuedSuffix}`, tone: 'info', showTimer: true };
    }
    if (queuedCount > 0) {
      return {
        text: `Queued: ${queuedCount} prompt${queuedCount === 1 ? '' : 's'}`,
        tone: 'info',
        showTimer: false,
      };
    }
    if (lastRunDuration !== null) {
      return { text: `Last run · ${formatElapsed(lastRunDuration)}`, tone: 'info', showTimer: false };
    }
    return null;
  }, [agentStatus, toolStatus, queuedCount, lastRunDuration]);

  const contextPercent = useMemo(
    () => getContextPercent(agentContextLeft, contextUsage),
    [agentContextLeft, contextUsage]
  );

  const contextPercentClamped = useMemo(() => clampContextPercent(contextPercent), [contextPercent]);

  useEffect(() => {
    if (runActive) return;
    if (!attachedRelativePath || !canStream) return;
    if (queuedPromptsRef.current.length === 0) return;
    const nextPrompt = dequeuePrompt();
    if (!nextPrompt) return;
    void runPrompt(nextPrompt);
  }, [runActive, attachedRelativePath, canStream, dequeuePrompt, runPrompt]);

  const stopHeaderDrag = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
  }, []);

  const handleModelSelectMouseDown = useCallback(
    (event: React.MouseEvent<HTMLSelectElement>) => {
      stopHeaderDrag(event);
      void refreshRecentModels({ force: true, loadingDelayMs: 300 });
    },
    [refreshRecentModels, stopHeaderDrag]
  );

  const handleModelSelectFocus = useCallback(() => {
    void refreshRecentModels({ force: true, loadingDelayMs: 300 });
  }, [refreshRecentModels]);

  return (
    <div
      className="agent-terminal-panel agent-terminal-overlay"
      style={{
        position: 'fixed',
        left: effectiveBounds.x,
        top: effectiveBounds.y,
        width: effectiveBounds.width,
        height: effectiveBounds.height,
        zIndex: 4000,
      }}
      onMouseDown={(e) => {
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.stopPropagation();
      }}
      data-testid="agent-terminal"
      data-agent-id={agentId}
      data-tutorial-target="agent-terminal"
    >
      {!embedded && (
        <>
          {/* Resize handles */}
          <div
            className="agent-terminal-resize-handle agent-terminal-resize-left"
            onMouseDown={handleResizeStart('left')}
          />
          <div
            className="agent-terminal-resize-handle agent-terminal-resize-right"
            onMouseDown={handleResizeStart('right')}
          />
          <div
            className="agent-terminal-resize-handle agent-terminal-resize-top"
            onMouseDown={handleResizeStart('top')}
          />
          <div
            className="agent-terminal-resize-handle agent-terminal-resize-bottom"
            onMouseDown={handleResizeStart('bottom')}
          />
          <div
            className="agent-terminal-resize-handle agent-terminal-resize-top-left"
            onMouseDown={handleResizeStart('top-left')}
          />
          <div
            className="agent-terminal-resize-handle agent-terminal-resize-top-right"
            onMouseDown={handleResizeStart('top-right')}
          />
          <div
            className="agent-terminal-resize-handle agent-terminal-resize-bottom-left"
            onMouseDown={handleResizeStart('bottom-left')}
          />
          <div
            className="agent-terminal-resize-handle agent-terminal-resize-bottom-right"
            onMouseDown={handleResizeStart('bottom-right')}
          />
        </>
      )}

      <div
        className="agent-terminal-header"
        onMouseDown={handleDragStart}
        style={{ cursor: embedded ? 'default' : 'move' }}
      >
        <button
          className="agent-terminal-close"
          onClick={onClose}
          aria-label="Close agent terminal"
          data-tutorial-target="agent-terminal-close"
        >
          ×
        </button>
        <div className="agent-terminal-title">
          <span className="agent-terminal-name">{agentName}</span>
          {attachedRelativePath ? <span className="agent-terminal-divider">·</span> : null}
          {attachedRelativePath ? (
            <span className="agent-terminal-folder">{attachedRelativePath}</span>
          ) : null}
        </div>
        {summaryText ? (
          <div className="agent-terminal-summary" title={summaryText}>
            <span className="agent-terminal-summary-label">Summary</span>
            <span className="agent-terminal-summary-text">{summaryText}</span>
          </div>
        ) : null}
        <div className="agent-terminal-status" onMouseDown={stopHeaderDrag}>
          <label className="agent-terminal-model">
            <select
              className="agent-terminal-model-select"
              value={currentModel.trim() ? currentModel : ''}
              onChange={(event) => void handleModelChange(event.target.value)}
              onMouseDown={handleModelSelectMouseDown}
              onFocus={handleModelSelectFocus}
              aria-label="Agent model"
            >
              {modelOptions.map((model) => (
                <option key={model.id || 'default'} value={model.id}>
                  {formatModelLabel(model.label)}
                </option>
              ))}
            </select>
            {modelsLoading ? <span className="agent-terminal-model-loading">Updating…</span> : null}
          </label>
          {showReasoningSelect ? (
            <label className="agent-terminal-model">
              <select
                className="agent-terminal-model-select"
                value={currentReasoningEffort ?? ''}
                onChange={(event) => void handleReasoningChange(event.target.value)}
                onMouseDown={stopHeaderDrag}
                aria-label="Reasoning level"
              >
                {reasoningChoices.map((option) => (
                  <option key={option.id || 'default'} value={option.id}>
                    {option.isDefault ? `${option.label} (Default)` : option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </div>
      <div className="agent-terminal-container">
        {searchOpen && (
          <div className="agent-chat-search" onMouseDown={(event) => event.stopPropagation()}>
            <input
              ref={searchInputRef}
              className="agent-chat-search-input"
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setActiveMatchIndex(0);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  goToMatch(event.shiftKey ? -1 : 1);
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setSearchOpen(false);
                }
              }}
              placeholder="Search this session (scroll up for older matches)"
              aria-label="Search agent session"
            />
            <div className="agent-chat-search-actions">
              <span className="agent-chat-search-count">
                {searchMatches.length > 0 ? `${activeMatchIndex + 1}/${searchMatches.length}` : '0'}
              </span>
              <button
                type="button"
                className="agent-chat-search-btn"
                onClick={() => goToMatch(-1)}
                disabled={searchMatches.length === 0}
                aria-label="Previous match"
              >
                ↑
              </button>
              <button
                type="button"
                className="agent-chat-search-btn"
                onClick={() => goToMatch(1)}
                disabled={searchMatches.length === 0}
                aria-label="Next match"
              >
                ↓
              </button>
              <button
                type="button"
                className="agent-chat-search-close"
                onClick={() => setSearchOpen(false)}
                aria-label="Close search"
              >
                ×
              </button>
            </div>
          </div>
        )}
        <div className="agent-chat-scroll" ref={scrollRef} onScroll={handleScroll}>
          <div className="agent-chat-log">
            {entries.length === 0 ? (
              <div className="agent-chat-empty">
                <div className="agent-chat-empty-title">Start a new run</div>
                <div className="agent-chat-empty-copy">
                  Send a prompt to {agentName}. Tool outputs will stay tucked away unless you open them.
                </div>
              </div>
            ) : (
              renderedEntries.map((entry) => {
                const isActiveMatch = searchOpen && searchMatches[activeMatchIndex] === entry.id;
                if (entry.type === 'message') {
                  const isThinking = entry.variant === 'thinking';
                  const label =
                    entry.role === 'user' ? 'You' : entry.role === 'assistant' ? agentName : 'System';
                  const usageParts = entry.usage ? formatUsageSummary(entry.usage) : [];
                  return (
                    <div
                      key={entry.id}
                      data-entry-id={entry.id}
                      className={`agent-chat-message agent-chat-message--${entry.role}${
                        isThinking ? ' agent-chat-message--thinking' : ''
                      }${isActiveMatch ? ' is-search-active' : ''}`}
                    >
                      <div className="agent-chat-message-label">
                        <span className="agent-chat-message-label-text">
                          {isThinking ? 'Thinking' : label}
                          {usageParts.length > 0 && (
                            <span className="agent-chat-usage">
                              {usageParts.map((part) => (
                                <span key={part} className="agent-chat-usage-chip">
                                  {part}
                                </span>
                              ))}
                            </span>
                          )}
                        </span>
                        <button
                          className="agent-chat-copy"
                          onClick={() => void copyText(entry.id, entry.content)}
                          aria-label="Copy message"
                        >
                          {getCopyLabel(entry.id)}
                        </button>
                      </div>
                      <div className="agent-chat-text">{renderHighlightedText(entry.content)}</div>
                    </div>
                  );
                }

                return (
                  <details
                    key={entry.id}
                    data-entry-id={entry.id}
                    className={`agent-chat-tool${entry.status === 'error' ? ' agent-chat-tool--error' : ''}${
                      isActiveMatch ? ' is-search-active' : ''
                    }`}
                    open={entry.expanded === true}
                    onToggle={(event) => {
                      const target = event.currentTarget;
                      updateEntry(entry.id, (current) => {
                        if (current.type !== 'tool') return current;
                        return { ...current, expanded: target.open };
                      });
                    }}
                  >
                    <summary>
                      <span className="agent-chat-tool-title">
                        {renderHighlightedText(entry.input?.trim() || entry.title)}
                      </span>
                    </summary>
                    {entry.output ? (
                      <div className="agent-chat-tool-body">
                        <div className="agent-chat-tool-actions">
                          <button
                            className="agent-chat-copy"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              void copyText(entry.id, entry.output ?? '');
                            }}
                          >
                            {getCopyLabel(entry.id)}
                          </button>
                        </div>
                        <pre className="agent-chat-tool-output">{renderHighlightedText(entry.output)}</pre>
                      </div>
                    ) : null}
                  </details>
                );
              })
            )}
          </div>
        </div>
        <div className="agent-chat-status-band">
          <div
            className={`agent-chat-status${statusLine?.tone === 'error' ? ' agent-chat-status--error' : ''}${
              statusLine?.showTimer ? '' : ' agent-chat-status--static'
            }`}
          >
            <span className="agent-chat-status-dot" />
            <span className="agent-chat-status-text">{statusLine?.text ?? 'Idle'}</span>
            {statusLine?.showTimer ? (
              <span className="agent-chat-status-time">{formatElapsed(statusElapsed)}</span>
            ) : null}
          </div>
          <div className="agent-chat-context">
            <div className="agent-chat-context-meter">
              <div
                className={`agent-chat-context-fill ${
                  contextPercentClamped === null
                    ? 'unknown'
                    : contextPercentClamped < 30
                      ? 'red'
                      : contextPercentClamped < 60
                        ? 'yellow'
                        : 'green'
                }`}
                style={{
                  width:
                    contextPercentClamped === null
                      ? '12%'
                      : `${Math.max(6, Math.min(100, contextPercentClamped))}%`,
                }}
              />
            </div>
            <div className="agent-chat-context-text">
              {contextPercentClamped === null ? (
                'Context unknown'
              ) : (
                <span>{contextPercentClamped}% left</span>
              )}
            </div>
          </div>
          <div className="agent-chat-usage-summary">
            <span className="agent-chat-usage-label">Usage</span>
            <div className="agent-chat-usage-values">
              {typeof agentTotalTokensUsed === 'number' ? (
                <span className="agent-chat-usage-chip">Total {formatTokens(agentTotalTokensUsed)}</span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="agent-chat-input">
          {supportsFileSelection && inputEnabled && (
            <div className="agent-chat-file-strip">
              <button className="agent-chat-file-btn" type="button" onClick={() => void handlePickFiles()}>
                Add Files
              </button>
              {selectedFiles.length > 0 && (
                <div className="agent-chat-file-list">
                  {selectedFiles.map((file) => (
                    <span key={file.path} className="agent-chat-file-pill">
                      <span className="agent-chat-file-pill-label">{file.relativePath ?? file.name}</span>
                      {!file.inWorkspace && <span className="agent-chat-file-pill-badge">External</span>}
                      <button
                        type="button"
                        className="agent-chat-file-pill-remove"
                        aria-label={`Remove ${file.name}`}
                        onClick={() => handleRemoveSelectedFile(file.path)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="agent-chat-input-main">
            <textarea
              ref={inputRef}
              className="agent-chat-input-field"
              placeholder={
                inputEnabled
                  ? runActive
                    ? 'Queue a follow-up…'
                    : 'Ask the agent to do something…'
                  : 'Attach the agent to a folder to chat'
              }
              value={inputValue}
              onChange={(event) => {
                draftDirtyRef.current = true;
                setInputValue(event.target.value);
              }}
              onKeyDown={handleInputKeyDown}
              disabled={!inputEnabled}
              rows={1}
            />
            <div className="agent-chat-input-actions">
              {runActive && (
                <button
                  className="agent-chat-cancel"
                  onClick={() => void cancelRun()}
                  aria-label="Cancel run"
                  type="button"
                >
                  Cancel
                </button>
              )}
              <button
                className="agent-chat-send"
                onClick={() => void submitPrompt()}
                disabled={!inputEnabled || (!inputValue.trim() && selectedFiles.length === 0)}
              >
                {runActive ? 'Queue' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
