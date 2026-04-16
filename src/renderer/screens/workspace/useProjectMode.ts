import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AnyFolder,
  Agent,
  TerminalPanel as TerminalPanelRecord,
  BrowserPanel,
  TutorialState,
} from '../../../shared/types';
import { DEFAULT_BROWSER_SIZE } from '../../../shared/browserDefaults';
import { DEFAULT_TERMINAL_SIZE } from '../../../shared/terminalDefaults';

// Distinct project colors — visually distinguishable on a dark canvas
const PROJECT_COLOR_PALETTE = [
  '#63b3ed', // blue
  '#68d391', // green
  '#f6ad55', // orange
  '#fc8181', // red
  '#b794f4', // purple
  '#76e4f7', // cyan
  '#f6e05e', // yellow
  '#f687b3', // pink
  '#9ae6b4', // mint
  '#fbb6ce', // rose
];

// Layout constants — all in world-space px
// Entity x,y are TOP-LEFT corners (confirmed from attachLayout.ts: center = x + size/2)
const FOLDER_SIZE = 80; // px — matches FOLDER_ICON_SIZE_PX
const AGENT_SIZE = 48; // px — matches AGENT_TOKEN_SIZE_PX
const AGENT_GAP = 16;
const ZONE_PADDING = 64;
const ZONE_GAP = 100;
const AGENTS_PER_ROW = 3;
const BROWSER_GAP = 16;
const MIN_BROWSER_WIDTH = 400;
const MIN_BROWSER_HEIGHT = 300;
const MIN_TERMINAL_WIDTH = 420;
const MIN_TERMINAL_HEIGHT = 300;
const MIN_AGENT_PANEL_WIDTH = 420;
const MIN_AGENT_PANEL_HEIGHT = 320;
const MAX_PANEL_WIDTH = 760;
const MAX_PANEL_HEIGHT = 520;
const VIEWPORT_SIDE_MARGIN = 200;
const VIEWPORT_TOP_MARGIN = 220;

export const getAgentTerminalLayoutId = (agentId: string): string => `agent-terminal:${agentId}`;

interface LayoutOverride {
  x: number;
  y: number;
  width?: number;
  height?: number;
}

interface UseProjectModeOptions {
  workspacePath: string;
  folders: AnyFolder[];
  agents: Agent[];
  terminals: Record<string, TerminalPanelRecord>;
  browsers: BrowserPanel[];
  activeAgentTerminalId?: string | null;
  tutorialState?: TutorialState;
}

export interface ProjectZone {
  folderId: string;
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ProjectLayoutMode = 'manual' | 'organized' | 'tiled';

export interface ProjectModeReturn {
  enabled: boolean;
  panelOpen: boolean;
  toggleMode: () => void;
  togglePanel: () => void;
  toggleProject: (folderId: string) => void;
  setAllProjectsVisible: () => void;
  isProjectVisible: (folderId: string) => boolean;
  filteredFolders: AnyFolder[];
  filteredAgents: Agent[];
  filteredTerminals: Record<string, TerminalPanelRecord>;
  filteredBrowsers: BrowserPanel[];
  projectStats: Map<string, { agents: number; terminals: number; browsers: number; worktrees: number }>;
  projectColors: Map<string, string>;
  setProjectColor: (folderId: string, color: string) => void;
  getProjectFocusBounds: (folderId: string) => { cx: number; cy: number } | null;
  positionOverrides: Map<string, LayoutOverride>;
  projectZones: ProjectZone[];
  layoutActive: boolean;
  layoutMode: ProjectLayoutMode;
  setLayoutMode: (mode: ProjectLayoutMode) => void;
  applyLayoutOverride: (id: string, override: Partial<LayoutOverride>) => void;
  exitLayout: () => void;
  refreshLayout: () => void;
  // Focus mode
  focusModeActive: boolean;
  focusedProjectIds: ReadonlySet<string>;
  focusProject: (folderId: string) => void;
  toggleFocusProject: (folderId: string) => void;
  exitFocusMode: () => void;
  hideHero: boolean;
}

interface StoredState {
  enabled: boolean;
  visibleIds: string[];
  colors: Record<string, string>;
  layoutMode?: ProjectLayoutMode;
}

function getStorageKey(workspacePath: string): string {
  return `vibecraft:project-mode:${workspacePath}`;
}

function loadFromStorage(workspacePath: string): StoredState | null {
  try {
    const raw = window.localStorage.getItem(getStorageKey(workspacePath));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.enabled !== 'boolean') return null;
    if (!Array.isArray(obj.visibleIds)) return null;
    const visibleIds = (obj.visibleIds as unknown[]).filter((id): id is string => typeof id === 'string');
    const colors: Record<string, string> = {};
    if (typeof obj.colors === 'object' && obj.colors !== null) {
      for (const [k, v] of Object.entries(obj.colors as Record<string, unknown>)) {
        if (typeof v === 'string') colors[k] = v;
      }
    }
    const layoutMode =
      obj.layoutMode === 'manual' || obj.layoutMode === 'organized' || obj.layoutMode === 'tiled'
        ? obj.layoutMode
        : 'organized';
    return { enabled: obj.enabled, visibleIds, colors, layoutMode };
  } catch {
    return null;
  }
}

function saveToStorage(workspacePath: string, state: StoredState): void {
  try {
    window.localStorage.setItem(getStorageKey(workspacePath), JSON.stringify(state));
  } catch {
    // ignore storage errors
  }
}

function assignColors(folders: AnyFolder[], existing: Record<string, string>): Record<string, string> {
  const result = { ...existing };
  let paletteIdx = Object.keys(result).length % PROJECT_COLOR_PALETTE.length;
  for (const folder of folders) {
    if (!result[folder.id]) {
      result[folder.id] = PROJECT_COLOR_PALETTE[paletteIdx % PROJECT_COLOR_PALETTE.length];
      paletteIdx++;
    }
  }
  return result;
}

export function useProjectMode(options: UseProjectModeOptions): ProjectModeReturn {
  const {
    workspacePath,
    folders,
    agents,
    terminals,
    browsers,
    activeAgentTerminalId = null,
    tutorialState,
  } = options;

  const [enabled, setEnabled] = useState<boolean>(() => {
    return loadFromStorage(workspacePath)?.enabled ?? false;
  });

  const [panelOpen, setPanelOpen] = useState<boolean>(false);

  const [visibleProjectIds, setVisibleProjectIds] = useState<Set<string>>(() => {
    const stored = loadFromStorage(workspacePath);
    if (stored) return new Set(stored.visibleIds);
    return new Set(folders.map((f) => f.id));
  });

  const [colors, setColors] = useState<Record<string, string>>(() => {
    const stored = loadFromStorage(workspacePath);
    return assignColors(folders, stored?.colors ?? {});
  });
  const [layoutMode, setLayoutMode] = useState<ProjectLayoutMode>(() => {
    return loadFromStorage(workspacePath)?.layoutMode ?? 'organized';
  });
  const [manualLayoutActive, setManualLayoutActive] = useState(false);

  // Focus mode — ephemeral, not persisted
  const [focusedProjectIds, setFocusedProjectIds] = useState<Set<string>>(new Set());

  // Ephemeral layout state — not persisted
  const [positionOverrides, setPositionOverrides] = useState<Map<string, LayoutOverride>>(new Map());
  const [projectZones, setProjectZones] = useState<ProjectZone[]>([]);
  const [layoutActive, setLayoutActive] = useState(false);
  const allowUnattachedForTutorial =
    tutorialState?.stepId === 'attach-agent' || tutorialState?.stepId === 'attach-agent-2';
  const effectiveLayoutActive = allowUnattachedForTutorial ? false : layoutActive;

  // Refs so layout computation always reads latest data without creating new callbacks
  const foldersRef = useRef(folders);
  const agentsRef = useRef(agents);
  const terminalsRef = useRef(terminals);
  const browsersRef = useRef(browsers);
  const colorsRef = useRef(colors);
  const activeAgentTerminalIdRef = useRef<string | null>(activeAgentTerminalId);

  useEffect(() => {
    foldersRef.current = folders;
    agentsRef.current = agents;
    terminalsRef.current = terminals;
    browsersRef.current = browsers;
    colorsRef.current = colors;
    activeAgentTerminalIdRef.current = activeAgentTerminalId;
  }, [folders, agents, terminals, browsers, colors, activeAgentTerminalId]);
  useEffect(() => {
    // Changing layout mode or which projects are visible should re-enable auto layout
    setManualLayoutActive(false);
  }, [layoutMode, focusedProjectIds, visibleProjectIds]);

  // Persist whenever key state changes
  useEffect(() => {
    saveToStorage(workspacePath, {
      enabled,
      visibleIds: Array.from(visibleProjectIds),
      colors,
      layoutMode,
    });
  }, [workspacePath, enabled, visibleProjectIds, colors, layoutMode]);

  // Add new folders to visible set + assign colors
  useEffect(() => {
    setVisibleProjectIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const folder of folders) {
        if (!next.has(folder.id)) {
          next.add(folder.id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setColors((prev) => {
      const next = assignColors(folders, prev);
      return Object.keys(next).length !== Object.keys(prev).length ? next : prev;
    });
  }, [folders]);

  // Core layout computation.
  // IMPORTANT: all entity x,y values are TOP-LEFT corners, not centers.
  //   getAgentCenter = (pos) => { x: pos.x + AGENT_SIZE/2, y: pos.y + AGENT_SIZE/2 }
  //   getFolderCenter = (folder) => { x: folder.x + FOLDER_SIZE/2, y: folder.y + FOLDER_SIZE/2 }
  // Stacking order per zone: Folder → Agents → Terminals → Browsers
  const computeLayoutForIds = useCallback(
    (visibleIds: Set<string>) => {
      setManualLayoutActive(false);
      const allFolders = foldersRef.current;
      const allAgents = agentsRef.current;
      const allTerminals = terminalsRef.current;
      const allBrowsers = browsersRef.current;
      const allColors = colorsRef.current;
      const currentActiveAgentTerminalId = activeAgentTerminalIdRef.current;
      const activeAgent = currentActiveAgentTerminalId
        ? allAgents.find((agent) => agent.id === currentActiveAgentTerminalId)
        : null;

      const visibleFolders = allFolders.filter((f) => visibleIds.has(f.id));
      if (visibleFolders.length === 0) {
        setPositionOverrides(new Map());
        setProjectZones([]);
        setLayoutActive(false);
        return;
      }

      const overrides = new Map<string, LayoutOverride>();
      const zones: ProjectZone[] = [];
      const viewportWidth = typeof window === 'undefined' ? 1600 : window.innerWidth;
      const viewportHeight = typeof window === 'undefined' ? 1000 : window.innerHeight;
      const availableViewportWidth = Math.max(
        MIN_BROWSER_WIDTH + ZONE_PADDING * 2,
        viewportWidth - VIEWPORT_SIDE_MARGIN
      );
      const columns =
        layoutMode === 'tiled'
          ? Math.max(1, Math.ceil(Math.sqrt(visibleFolders.length)))
          : visibleFolders.length;
      const targetZoneWidth = Math.min(
        MAX_PANEL_WIDTH + ZONE_PADDING * 2,
        Math.max(
          MIN_TERMINAL_WIDTH + ZONE_PADDING * 2,
          Math.floor((availableViewportWidth - ZONE_GAP * Math.max(0, columns - 1)) / columns)
        )
      );
      let zoneOffsetX = 0;
      let zoneOffsetY = 0;
      let columnIndex = 0;
      let currentRowHeight = 0;

      for (const folder of visibleFolders) {
        const baseX = zoneOffsetX;
        const baseY = zoneOffsetY;
        const folderAgents = allAgents.filter((a) => a.attachedFolderId === folder.id);
        const folderTerminals = Object.values(allTerminals).filter((t) => t.originFolderId === folder.id);
        const folderBrowsers = allBrowsers.filter((b) => b.originFolderId === folder.id);
        const hasActiveAgentPanel = activeAgent?.attachedFolderId === folder.id;

        // Compute zone width from the widest row of content
        const agentCols = Math.min(folderAgents.length, AGENTS_PER_ROW);
        const agentAreaW = agentCols > 0 ? agentCols * AGENT_SIZE + (agentCols - 1) * AGENT_GAP : 0;
        const innerW = Math.max(
          FOLDER_SIZE,
          agentAreaW,
          targetZoneWidth - ZONE_PADDING * 2,
          MIN_TERMINAL_WIDTH,
          MIN_BROWSER_WIDTH
        );
        const zoneW = innerW + ZONE_PADDING * 2;

        let localY = ZONE_PADDING;

        // Folder: top-left x centered in zone, top-left y at padding
        overrides.set(folder.id, {
          x: baseX + (zoneW - FOLDER_SIZE) / 2,
          y: baseY + localY,
        });
        localY += FOLDER_SIZE + 40;

        // Agents: arranged in rows, centered as a group within the zone
        if (folderAgents.length > 0) {
          const agentGroupW = agentCols * AGENT_SIZE + (agentCols - 1) * AGENT_GAP;
          const agentStartX = baseX + ZONE_PADDING + Math.max(0, (innerW - agentGroupW) / 2);

          for (let i = 0; i < folderAgents.length; i++) {
            const col = i % AGENTS_PER_ROW;
            const row = Math.floor(i / AGENTS_PER_ROW);
            overrides.set(folderAgents[i].id, {
              x: agentStartX + col * (AGENT_SIZE + AGENT_GAP),
              y: baseY + localY + row * (AGENT_SIZE + AGENT_GAP),
            });
          }
          const agentRows = Math.ceil(folderAgents.length / AGENTS_PER_ROW);
          localY += agentRows * (AGENT_SIZE + AGENT_GAP) + 20;
        }

        const attachedWindowCount =
          folderTerminals.length + folderBrowsers.length + (hasActiveAgentPanel ? 1 : 0);
        const remainingHeightBudget = Math.max(
          MAX_PANEL_HEIGHT,
          viewportHeight - VIEWPORT_TOP_MARGIN - localY
        );
        const perWindowHeight =
          attachedWindowCount > 0
            ? Math.min(
                MAX_PANEL_HEIGHT,
                Math.max(
                  MIN_BROWSER_HEIGHT,
                  Math.floor(
                    (remainingHeightBudget - BROWSER_GAP * Math.max(0, attachedWindowCount - 1)) /
                      attachedWindowCount
                  )
                )
              )
            : 0;

        if (hasActiveAgentPanel && activeAgent) {
          const agentPanelW = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_AGENT_PANEL_WIDTH, innerW));
          const agentPanelH = Math.min(
            Math.max(MIN_AGENT_PANEL_HEIGHT, perWindowHeight || MIN_AGENT_PANEL_HEIGHT),
            perWindowHeight || MAX_PANEL_HEIGHT
          );
          overrides.set(getAgentTerminalLayoutId(activeAgent.id), {
            x: baseX + ZONE_PADDING,
            y: baseY + localY,
            width: agentPanelW,
            height: agentPanelH,
          });
          localY += agentPanelH + BROWSER_GAP;
        }

        // Terminals: top-left corner, padded from zone edge, stacked vertically
        for (const terminal of folderTerminals) {
          const termW = Math.min(
            Math.max(terminal.width ?? DEFAULT_TERMINAL_SIZE.width, MIN_TERMINAL_WIDTH),
            innerW
          );
          const termH = Math.min(
            Math.max(terminal.height ?? DEFAULT_TERMINAL_SIZE.height, MIN_TERMINAL_HEIGHT),
            perWindowHeight || MAX_PANEL_HEIGHT
          );
          overrides.set(terminal.id, {
            x: baseX + ZONE_PADDING,
            y: baseY + localY,
            width: termW,
            height: termH,
          });
          localY += termH + 16;
        }

        // Browsers: stacked below terminals
        for (const browser of folderBrowsers) {
          const browserW = Math.min(
            Math.max(browser.width ?? DEFAULT_BROWSER_SIZE.width, MIN_BROWSER_WIDTH),
            innerW
          );
          const browserH = Math.min(
            Math.max(browser.height ?? DEFAULT_BROWSER_SIZE.height, MIN_BROWSER_HEIGHT),
            perWindowHeight || MAX_PANEL_HEIGHT
          );
          overrides.set(browser.id, {
            x: baseX + ZONE_PADDING,
            y: baseY + localY,
            width: browserW,
            height: browserH,
          });
          localY += browserH + BROWSER_GAP;
        }

        const zoneH = localY + ZONE_PADDING;

        zones.push({
          folderId: folder.id,
          color: allColors[folder.id] ?? '#63b3ed',
          x: baseX,
          y: baseY,
          w: zoneW,
          h: zoneH,
        });

        if (layoutMode === 'tiled') {
          currentRowHeight = Math.max(currentRowHeight, zoneH);
          columnIndex += 1;
          if (columnIndex >= columns) {
            columnIndex = 0;
            zoneOffsetX = 0;
            zoneOffsetY += currentRowHeight + ZONE_GAP;
            currentRowHeight = 0;
          } else {
            zoneOffsetX += zoneW + ZONE_GAP;
          }
        } else {
          zoneOffsetX += zoneW + ZONE_GAP;
        }
      }

      // Center entire layout at world origin
      const minX = Math.min(...zones.map((z) => z.x));
      const maxX = Math.max(...zones.map((z) => z.x + z.w));
      const minY = Math.min(...zones.map((z) => z.y));
      const maxY = Math.max(...zones.map((z) => z.y + z.h));
      const totalWidth = layoutMode === 'tiled' ? maxX - minX : zoneOffsetX - ZONE_GAP;
      const offsetX = -(minX + totalWidth / 2);
      const totalHeight = maxY - minY;
      const offsetY = -(minY + totalHeight / 2);

      const centeredOverrides = new Map<string, LayoutOverride>();
      for (const [id, pos] of overrides) {
        centeredOverrides.set(id, { ...pos, x: pos.x + offsetX, y: pos.y + offsetY });
      }

      setPositionOverrides(centeredOverrides);
      setProjectZones(zones.map((z) => ({ ...z, x: z.x + offsetX, y: z.y + offsetY })));
      setLayoutActive(true);
    },
    [layoutMode]
  );

  const exitLayout = useCallback(() => {
    setPositionOverrides(new Map());
    setProjectZones([]);
    setLayoutActive(false);
    setManualLayoutActive(false);
  }, []);

  const focusModeActive = focusedProjectIds.size > 0;

  const shouldApplyLayout = enabled && (layoutMode !== 'manual' || focusModeActive);

  const refreshLayout = useCallback(() => {
    if (!shouldApplyLayout) return;
    setManualLayoutActive(false);
    const activeIds = focusedProjectIds.size > 0 ? focusedProjectIds : visibleProjectIds;
    computeLayoutForIds(activeIds);
  }, [shouldApplyLayout, focusedProjectIds, visibleProjectIds, computeLayoutForIds]);

  const applyLayoutOverride = useCallback((id: string, override: Partial<LayoutOverride>) => {
    setPositionOverrides((prev) => {
      const next = new Map(prev);
      const current = next.get(id);
      next.set(id, {
        x: override.x ?? current?.x ?? 0,
        y: override.y ?? current?.y ?? 0,
        width: override.width ?? current?.width,
        height: override.height ?? current?.height,
      });
      return next;
    });
    setLayoutActive(true);
    setManualLayoutActive(true);
  }, []);

  // Auto-compute layout when enabled/visibility/focus changes or attached window state changes.
  useEffect(() => {
    if (!shouldApplyLayout) {
      exitLayout();
      return;
    }
    if (manualLayoutActive) return;
    const activeIds = focusedProjectIds.size > 0 ? focusedProjectIds : visibleProjectIds;
    computeLayoutForIds(activeIds);
  }, [
    shouldApplyLayout,
    manualLayoutActive,
    visibleProjectIds,
    focusedProjectIds,
    folders,
    agents,
    terminals,
    browsers,
    colors,
    activeAgentTerminalId,
    computeLayoutForIds,
    exitLayout,
  ]);

  useEffect(() => {
    if (!shouldApplyLayout) return;
    const handleResize = () => {
      const activeIds = focusedProjectIds.size > 0 ? focusedProjectIds : visibleProjectIds;
      computeLayoutForIds(activeIds);
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [shouldApplyLayout, focusedProjectIds, visibleProjectIds, computeLayoutForIds]);

  const toggleMode = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      if (next) {
        setPanelOpen(true);
        setVisibleProjectIds((ids) => {
          if (ids.size === 0) {
            return new Set(folders.map((f) => f.id));
          }
          return ids;
        });
      }
      return next;
    });
  }, [folders]);

  const togglePanel = useCallback(() => setPanelOpen((prev) => !prev), []);

  const toggleProject = useCallback((folderId: string) => {
    setVisibleProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }, []);

  const setAllProjectsVisible = useCallback(() => {
    setVisibleProjectIds(new Set(folders.map((f) => f.id)));
  }, [folders]);

  const isProjectVisible = useCallback(
    (folderId: string) => visibleProjectIds.has(folderId),
    [visibleProjectIds]
  );

  const setProjectColor = useCallback((folderId: string, color: string) => {
    setColors((prev) => ({ ...prev, [folderId]: color }));
  }, []);

  // Focus mode handlers
  const focusProject = useCallback((folderId: string) => {
    setEnabled(true);
    setPanelOpen(true);
    setFocusedProjectIds(new Set([folderId]));
  }, []);

  const toggleFocusProject = useCallback((folderId: string) => {
    setFocusedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }, []);

  const exitFocusMode = useCallback(() => {
    setFocusedProjectIds(new Set());
  }, []);

  const filteredAgents = useMemo((): Agent[] => {
    if (!enabled) return agents;
    const activeIds = focusedProjectIds.size > 0 ? focusedProjectIds : visibleProjectIds;
    return agents.filter((a) => {
      if (a.attachedFolderId && activeIds.has(a.attachedFolderId)) return true;
      // Keep unattached agents visible so disconnecting doesn't hide them.
      if (!a.attachedFolderId) return true;
      if (allowUnattachedForTutorial && !a.attachedFolderId) return true;
      return false;
    });
  }, [enabled, agents, focusedProjectIds, visibleProjectIds, allowUnattachedForTutorial]);

  const filteredFolders = useMemo((): AnyFolder[] => {
    if (!enabled) return folders;
    const activeIds = focusedProjectIds.size > 0 ? focusedProjectIds : visibleProjectIds;
    return folders.filter((folder) => activeIds.has(folder.id));
  }, [enabled, folders, focusedProjectIds, visibleProjectIds]);

  const filteredTerminals = useMemo((): Record<string, TerminalPanelRecord> => {
    if (!enabled) return terminals;
    const activeIds = focusedProjectIds.size > 0 ? focusedProjectIds : visibleProjectIds;
    const result: Record<string, TerminalPanelRecord> = {};
    for (const [id, t] of Object.entries(terminals)) {
      if (t.originFolderId && activeIds.has(t.originFolderId)) result[id] = t;
    }
    return result;
  }, [enabled, terminals, focusedProjectIds, visibleProjectIds]);

  const filteredBrowsers = useMemo((): BrowserPanel[] => {
    if (!enabled) return browsers;
    const activeIds = focusedProjectIds.size > 0 ? focusedProjectIds : visibleProjectIds;
    return browsers.filter((b) => Boolean(b.originFolderId && activeIds.has(b.originFolderId)));
  }, [enabled, browsers, focusedProjectIds, visibleProjectIds]);

  const projectStats = useMemo(() => {
    const stats = new Map<
      string,
      { agents: number; terminals: number; browsers: number; worktrees: number }
    >();
    for (const f of folders) stats.set(f.id, { agents: 0, terminals: 0, browsers: 0, worktrees: 0 });
    for (const a of agents) {
      if (a.attachedFolderId && stats.has(a.attachedFolderId)) {
        stats.get(a.attachedFolderId)!.agents++;
      }
    }
    for (const t of Object.values(terminals)) {
      if (t.originFolderId && stats.has(t.originFolderId)) {
        stats.get(t.originFolderId)!.terminals++;
      }
    }
    for (const b of browsers) {
      if (b.originFolderId && stats.has(b.originFolderId)) {
        stats.get(b.originFolderId)!.browsers++;
      }
    }
    for (const f of folders) {
      if (f.kind === 'worktree' && f.sourceRelativePath) {
        const parent = folders.find((p) => p.kind === 'folder' && p.relativePath === f.sourceRelativePath);
        if (parent && stats.has(parent.id)) stats.get(parent.id)!.worktrees++;
      }
    }
    return stats;
  }, [folders, agents, terminals, browsers]);

  const projectColors = useMemo(() => new Map(Object.entries(colors)), [colors]);

  const getProjectFocusBounds = useCallback(
    (folderId: string): { cx: number; cy: number } | null => {
      // When layout is active, use the zone center for focus
      if (effectiveLayoutActive && positionOverrides.size > 0) {
        const zone = projectZones.find((z) => z.folderId === folderId);
        if (zone) return { cx: zone.x + zone.w / 2, cy: zone.y + zone.h / 2 };
      }
      const folder = folders.find((f) => f.id === folderId);
      if (!folder) return null;
      const xs: number[] = [folder.x + FOLDER_SIZE / 2];
      const ys: number[] = [folder.y + FOLDER_SIZE / 2];
      for (const a of agents) {
        if (a.attachedFolderId === folderId) {
          xs.push(a.x + AGENT_SIZE / 2);
          ys.push(a.y + AGENT_SIZE / 2);
        }
      }
      for (const t of Object.values(terminals)) {
        if (t.originFolderId === folderId) {
          xs.push(t.x);
          ys.push(t.y);
        }
      }
      for (const b of browsers) {
        if (b.originFolderId === folderId) {
          xs.push(b.x + b.width / 2);
          ys.push(b.y + b.height / 2);
        }
      }
      const cx = xs.reduce((s, v) => s + v, 0) / xs.length;
      const cy = ys.reduce((s, v) => s + v, 0) / ys.length;
      return { cx, cy };
    },
    [folders, agents, terminals, browsers, effectiveLayoutActive, positionOverrides, projectZones]
  );

  const hideHero = enabled && focusModeActive;

  return {
    enabled,
    panelOpen,
    toggleMode,
    togglePanel,
    toggleProject,
    setAllProjectsVisible,
    isProjectVisible,
    filteredFolders,
    filteredAgents,
    filteredTerminals,
    filteredBrowsers,
    projectStats,
    projectColors,
    setProjectColor,
    getProjectFocusBounds,
    positionOverrides,
    projectZones,
    layoutActive: effectiveLayoutActive,
    layoutMode,
    setLayoutMode,
    applyLayoutOverride,
    exitLayout,
    refreshLayout,
    focusModeActive,
    focusedProjectIds,
    focusProject,
    toggleFocusProject,
    exitFocusMode,
    hideHero,
  };
}
