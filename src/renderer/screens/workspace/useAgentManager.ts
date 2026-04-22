import { useCallback, useEffect, useRef } from 'react';
import { SUPPORTED_AGENT_PROVIDERS } from '../../../shared/providers';
import type { Agent, AgentProvider, Folder, SelectedEntityRef } from '../../../shared/types';
import type { CommandRunResult } from '../../../shared/commands';
import { workspaceClient } from '../../services/workspaceClient';
import { useTheme } from '../../theme/themeContext';
import { getAgentColorForSeed, resolveAgentPalette } from '../../utils/agentColors';
import { getNextAgentName } from '../../utils/agentNames';
import { distance, getAgentCenter, layoutAttachedAgents, resolveIncrementalAttachSlot } from './attachLayout';
import * as WORKSPACE_CONSTANTS from './constants';
import type { DialogMessage } from './types';

export interface UseAgentManagerParams {
  workspacePath: string;
  agents: Agent[];
  setAgents: React.Dispatch<React.SetStateAction<Agent[]>>;
  folders: Folder[];
  selectedEntity: SelectedEntityRef | null;
  setSelectedAgentIds: React.Dispatch<React.SetStateAction<string[]>>;
  setSelectedEntity: (entity: SelectedEntityRef | null) => void;
  setMessageDialog: (msg: DialogMessage | null) => void;
  activeAgentTerminalId: string | null;
  setActiveAgentTerminalId: React.Dispatch<React.SetStateAction<string | null>>;
  closeAgentTerminals: (agentIds: Iterable<string>) => void;
}

export interface UseAgentManagerReturn {
  applyDetachedAgentIds: (detachedAgentIds: string[]) => void;
  moveAgentVisual: (id: string, x: number, y: number) => void;
  persistAgentPosition: (id: string, x: number, y: number) => Promise<CommandRunResult>;
  handleAgentMove: (id: string, x: number, y: number) => Promise<CommandRunResult>;
  resetAgentNameSequenceIndex: () => Promise<CommandRunResult>;
  createAgent: (
    provider: AgentProvider,
    x: number,
    y: number,
    attachedFolderId?: string
  ) => Promise<CommandRunResult>;
  destroyAgent: (agentId: string) => Promise<CommandRunResult>;
  openAgentTerminal: (agentId: string) => Promise<CommandRunResult>;
  clearAgentTerminalState: (agentId: string) => Promise<CommandRunResult>;
  attachAgentToFolder: (
    agentId: string,
    folderId: string,
    targetPos?: { x: number; y: number }
  ) => Promise<CommandRunResult>;
  detachAgent: (agentId: string) => Promise<CommandRunResult>;
}

const okResult = (): CommandRunResult => ({ ok: true });
const errorResult = (error: string): CommandRunResult => ({ ok: false, error });
const buildProviderCounts = (agents: Agent[]): Record<AgentProvider, number> => {
  const counts = Object.fromEntries(SUPPORTED_AGENT_PROVIDERS.map((provider) => [provider, 0])) as Record<
    AgentProvider,
    number
  >;
  agents.forEach((agent) => {
    counts[agent.provider] = (counts[agent.provider] ?? 0) + 1;
  });
  return counts;
};
const normalizeAgentName = (name: string): string => name.trim().toLowerCase();
const buildExistingNameSet = (agents: Agent[]): Set<string> => {
  const names = new Set<string>();
  agents.forEach((agent) => {
    const displayName = normalizeAgentName(agent.displayName || agent.name);
    if (displayName) {
      names.add(displayName);
    }
  });
  return names;
};
const dedupeAgents = (agents: Agent[]): Agent[] => {
  const map = new Map<string, Agent>();
  agents.forEach((agent) => {
    map.set(agent.id, agent);
  });
  return Array.from(map.values());
};
type AgentPositionUpdate = { id: string; x: number; y: number };
type AttachSettlement = {
  settledAgents: Agent[];
  updatesToPersist: AgentPositionUpdate[];
  layout: ReturnType<typeof layoutAttachedAgents>;
};

const hasOverlappingAgents = (
  agents: Pick<Agent, 'x' | 'y'>[],
  minSeparationPx: number = WORKSPACE_CONSTANTS.AGENT_TOKEN_SIZE_PX - 1
): boolean => {
  for (let i = 0; i < agents.length; i += 1) {
    for (let j = i + 1; j < agents.length; j += 1) {
      const separation = distance(getAgentCenter(agents[i]), getAgentCenter(agents[j]));
      if (separation < minSeparationPx) {
        return true;
      }
    }
  }
  return false;
};

const settleFolderAttachmentLayout = (
  snapshot: Agent[],
  folder: Folder,
  agentId: string,
  targetPos?: { x: number; y: number }
): AttachSettlement => {
  const next = snapshot.map((entry) =>
    entry.id === agentId
      ? {
          ...entry,
          x: targetPos?.x ?? entry.x,
          y: targetPos?.y ?? entry.y,
          attachedFolderId: folder.id,
          status: 'online' as const,
          movementIntent: undefined,
        }
      : entry
  );
  const attachedToFolder = next.filter((entry) => entry.attachedFolderId === folder.id);
  const staticAttached = attachedToFolder.filter((entry) => entry.id !== agentId);
  const attachingAgent = next.find((entry) => entry.id === agentId);

  if (attachingAgent && !hasOverlappingAgents(staticAttached)) {
    const incrementalSlot = resolveIncrementalAttachSlot(
      folder,
      { x: attachingAgent.x, y: attachingAgent.y },
      staticAttached
    );
    if (incrementalSlot) {
      const settledAgents = dedupeAgents(
        next.map((entry) =>
          entry.id === agentId
            ? {
                ...entry,
                x: incrementalSlot.position.x,
                y: incrementalSlot.position.y,
                attachedFolderId: folder.id,
                status: 'online' as const,
                movementIntent: undefined,
              }
            : entry
        )
      );
      return {
        settledAgents,
        updatesToPersist: [
          {
            id: agentId,
            x: incrementalSlot.position.x,
            y: incrementalSlot.position.y,
          },
        ],
        layout: new Map([[agentId, incrementalSlot]]),
      };
    }
  }

  const layout = layoutAttachedAgents(folder, attachedToFolder);
  const updatesToPersist = attachedToFolder.map((entry) => {
    const slot = layout.get(entry.id);
    if (!slot) return { id: entry.id, x: entry.x, y: entry.y };
    return { id: entry.id, x: slot.position.x, y: slot.position.y };
  });
  const settledAgents = dedupeAgents(
    next.map((entry) => {
      const slot = layout.get(entry.id);
      if (!slot) return entry;
      if (
        entry.x === slot.position.x &&
        entry.y === slot.position.y &&
        entry.status === 'online' &&
        entry.movementIntent === undefined &&
        entry.attachedFolderId === folder.id
      ) {
        return entry;
      }
      return {
        ...entry,
        x: slot.position.x,
        y: slot.position.y,
        status: 'online' as const,
        movementIntent: undefined,
        attachedFolderId: folder.id,
      };
    })
  );
  return {
    settledAgents,
    updatesToPersist,
    layout,
  };
};

const mergeSettledAgents = (currentAgents: Agent[], settledAgents: Agent[]): Agent[] => {
  const settledById = new Map(settledAgents.map((entry) => [entry.id, entry]));
  const currentIds = new Set(currentAgents.map((entry) => entry.id));
  const merged = currentAgents.map((entry) => settledById.get(entry.id) ?? entry);
  settledAgents.forEach((entry) => {
    if (!currentIds.has(entry.id)) {
      merged.push(entry);
    }
  });
  return dedupeAgents(merged);
};

export function useAgentManager({
  workspacePath,
  agents,
  setAgents,
  folders,
  selectedEntity,
  setSelectedAgentIds,
  setSelectedEntity,
  setMessageDialog,
  activeAgentTerminalId,
  setActiveAgentTerminalId,
  closeAgentTerminals,
}: UseAgentManagerParams): UseAgentManagerReturn {
  const { activeTheme } = useTheme();
  const agentPalette = resolveAgentPalette(activeTheme);
  const nameSequenceRef = useRef<Record<AgentProvider, number>>(buildProviderCounts([]));
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());
  const attachQueueRef = useRef<Promise<void>>(Promise.resolve());
  const workspaceRef = useRef<string | null>(null);
  const agentsRef = useRef<Agent[]>(agents);

  const saveNameSequences = useCallback(
    async (nextCounts: Record<AgentProvider, number>, mode: 'max' | 'replace') => {
      const settings = await workspaceClient.loadSettings();
      const currentSequences = settings.agentNameSequencesByWorkspace ?? {};
      const currentWorkspace = currentSequences[workspacePath] ?? {};
      const updatedWorkspace: Partial<Record<AgentProvider, number>> =
        mode === 'replace' ? {} : { ...currentWorkspace };

      SUPPORTED_AGENT_PROVIDERS.forEach((provider) => {
        const nextValue = nextCounts[provider] ?? 0;
        if (mode === 'replace') {
          if (nextValue > 0) {
            updatedWorkspace[provider] = nextValue;
          } else {
            delete updatedWorkspace[provider];
          }
          return;
        }
        const storedValue = typeof updatedWorkspace[provider] === 'number' ? updatedWorkspace[provider]! : 0;
        if (nextValue > storedValue) {
          updatedWorkspace[provider] = nextValue;
        }
      });

      const nextByWorkspace: Record<string, Partial<Record<AgentProvider, number>>> = {
        ...currentSequences,
      };
      if (Object.keys(updatedWorkspace).length > 0) {
        nextByWorkspace[workspacePath] = updatedWorkspace;
      } else {
        delete nextByWorkspace[workspacePath];
      }

      const saved = await workspaceClient.saveSettings({
        ...settings,
        agentNameSequencesByWorkspace: Object.keys(nextByWorkspace).length > 0 ? nextByWorkspace : undefined,
      });
      if (!saved) {
        throw new Error('Failed to save settings');
      }
    },
    [workspacePath]
  );

  const persistNameSequences = useCallback(
    async (nextCounts: Record<AgentProvider, number>) => {
      const run = async () => {
        await saveNameSequences(nextCounts, 'max');
      };

      persistQueueRef.current = persistQueueRef.current.then(run).catch(() => {});
      await persistQueueRef.current;
    },
    [saveNameSequences]
  );

  useEffect(() => {
    agentsRef.current = agents;
  }, [agents]);

  useEffect(() => {
    let active = true;
    workspaceRef.current = workspacePath;
    nameSequenceRef.current = buildProviderCounts(agentsRef.current);

    const loadSequences = async () => {
      try {
        const settings = await workspaceClient.loadSettings();
        if (!active || workspaceRef.current !== workspacePath) return;
        const savedSequences = settings.agentNameSequencesByWorkspace?.[workspacePath] ?? {};
        const counts = buildProviderCounts(agentsRef.current);
        const merged = { ...counts };
        SUPPORTED_AGENT_PROVIDERS.forEach((provider) => {
          const savedValue = typeof savedSequences[provider] === 'number' ? savedSequences[provider]! : 0;
          if (savedValue > merged[provider]) {
            merged[provider] = savedValue;
          }
        });
        nameSequenceRef.current = merged;
        const needsPersist = SUPPORTED_AGENT_PROVIDERS.some((provider) => {
          const savedValue = typeof savedSequences[provider] === 'number' ? savedSequences[provider]! : 0;
          return merged[provider] > savedValue;
        });
        if (needsPersist) {
          void persistNameSequences(merged);
        }
      } catch {
        return;
      }
    };

    void loadSequences();
    return () => {
      active = false;
    };
  }, [persistNameSequences, workspacePath]);

  useEffect(() => {
    const counts = buildProviderCounts(agents);
    const current = nameSequenceRef.current;
    SUPPORTED_AGENT_PROVIDERS.forEach((provider) => {
      if (counts[provider] > (current[provider] ?? 0)) {
        current[provider] = counts[provider];
      }
    });
  }, [agents, workspacePath]);

  const applyDetachedAgentIds = useCallback(
    (detachedAgentIds: string[]) => {
      if (detachedAgentIds.length === 0) return;
      const detachedIds = new Set(detachedAgentIds);
      setAgents((prev) =>
        dedupeAgents(prev.map((a) => (detachedIds.has(a.id) ? { ...a, attachedFolderId: undefined } : a)))
      );
      closeAgentTerminals(detachedIds);
    },
    [closeAgentTerminals, setAgents]
  );

  const moveAgentVisual = useCallback(
    (id: string, x: number, y: number) => {
      setAgents((prev) =>
        dedupeAgents(prev.map((a) => (a.id === id ? { ...a, x, y, movementIntent: undefined } : a)))
      );
    },
    [setAgents]
  );

  const persistAgentPosition = useCallback(
    async (id: string, x: number, y: number): Promise<CommandRunResult> => {
      try {
        const success = await workspaceClient.updateAgentPosition(workspacePath, id, x, y);
        if (!success) {
          console.warn('Failed to update agent position:', id);
          return errorResult('Failed to update agent position');
        }
        return okResult();
      } catch (error) {
        console.error('Error updating agent position:', error);
        return errorResult(error instanceof Error ? error.message : 'Failed to update agent position');
      }
    },
    [workspacePath]
  );

  const handleAgentMove = useCallback(
    async (id: string, x: number, y: number): Promise<CommandRunResult> => {
      moveAgentVisual(id, x, y);
      return persistAgentPosition(id, x, y);
    },
    [moveAgentVisual, persistAgentPosition]
  );

  const resetAgentNameSequenceIndex = useCallback(async (): Promise<CommandRunResult> => {
    const nextCounts = buildProviderCounts(agentsRef.current);
    nameSequenceRef.current = nextCounts;
    try {
      await saveNameSequences(nextCounts, 'replace');
      return okResult();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reset agent name sequence index';
      return errorResult(message);
    }
  }, [saveNameSequences]);

  const createAgent = async (provider: AgentProvider, x: number, y: number, attachedFolderId?: string) => {
    const usedNames = buildExistingNameSet(agents);
    let spawnCount = nameSequenceRef.current[provider] ?? 0;
    let displayName = getNextAgentName(provider, spawnCount, activeTheme);
    while (usedNames.has(normalizeAgentName(displayName))) {
      spawnCount += 1;
      displayName = getNextAgentName(provider, spawnCount, activeTheme);
    }
    nameSequenceRef.current[provider] = spawnCount + 1;
    void persistNameSequences(nameSequenceRef.current);
    const color = getAgentColorForSeed(displayName, agentPalette);
    const name = displayName;
    const result = await workspaceClient.spawnAgent({
      provider,
      name,
      displayName,
      color,
      workspacePath,
      x,
      y,
      attachedFolderId,
    });
    if (result.success && result.agent) {
      setAgents((prev) => {
        const map = new Map(prev.map((agent) => [agent.id, agent]));
        map.set(result.agent!.id, result.agent!);
        return Array.from(map.values());
      });
      return okResult();
    }
    const errorMessage = result.success ? 'Failed to create agent' : result.error || 'Failed to create agent';
    setMessageDialog({ title: 'Error', message: errorMessage, type: 'error' });
    return errorResult(errorMessage);
  };

  const destroyAgent = async (agentId: string) => {
    const result = await workspaceClient.destroyAgent(workspacePath, agentId);
    if (result) {
      if (selectedEntity?.type === 'agent' && selectedEntity.id === agentId) {
        setSelectedEntity(null);
      }
      setSelectedAgentIds((prev) => prev.filter((id) => id !== agentId));
      closeAgentTerminals([agentId]);
      return okResult();
    } else {
      const errorMessage = 'Failed to destroy agent';
      setMessageDialog({ title: 'Error', message: errorMessage, type: 'error' });
      return errorResult(errorMessage);
    }
  };

  const openAgentTerminal = async (agentId: string) => {
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) {
      setMessageDialog({
        title: 'Error',
        message: 'Agent not found',
        type: 'error',
      });
      return errorResult('Agent not found');
    }

    if (activeAgentTerminalId === agent.id) {
      closeAgentTerminals([agent.id]);
      return okResult();
    }

    if (activeAgentTerminalId && activeAgentTerminalId !== agent.id) {
      closeAgentTerminals([activeAgentTerminalId]);
    }

    setActiveAgentTerminalId(agent.id);
    return okResult();
  };

  const clearAgentTerminalState = async (agentId: string) => {
    const result = await workspaceClient.clearAgentTerminalState(agentId);
    if (!result.success) {
      const errorMessage = 'Failed to clear terminal state';
      setMessageDialog({ title: 'Error', message: errorMessage, type: 'error' });
      return errorResult(errorMessage);
    }
    return okResult();
  };

  const attachAgentToFolder = useCallback(
    async (agentId: string, folderId: string, targetPos?: { x: number; y: number }) => {
      const runAttach = async (): Promise<CommandRunResult> => {
        const folder = folders.find((f) => f.id === folderId);
        if (!folder) {
          const errorMessage = 'Folder not found';
          setMessageDialog({ title: 'Error', message: errorMessage, type: 'error' });
          return errorResult(errorMessage);
        }
        const agent = agentsRef.current.find((entry) => entry.id === agentId);
        if (!agent) {
          const errorMessage = 'Agent not found';
          setMessageDialog({ title: 'Error', message: errorMessage, type: 'error' });
          return errorResult(errorMessage);
        }

        const snapshot = dedupeAgents(agentsRef.current);
        const { settledAgents, updatesToPersist, layout } = settleFolderAttachmentLayout(
          snapshot,
          folder,
          agentId,
          targetPos
        );
        agentsRef.current = settledAgents;
        setAgents((prev) => mergeSettledAgents(prev, settledAgents));

        const attachedSlot = layout.get(agentId);
        const primaryUpdate =
          updatesToPersist.find((entry) => entry.id === agentId) ??
          ({
            id: agentId,
            x: attachedSlot?.position.x ?? targetPos?.x ?? agent.x,
            y: attachedSlot?.position.y ?? targetPos?.y ?? agent.y,
          } as const);
        const secondaryUpdates = updatesToPersist.filter((entry) => entry.id !== agentId);
        const snapshotById = new Map(snapshot.map((entry) => [entry.id, entry]));
        const persistedUpdates: AgentPositionUpdate[] = [];

        const rollbackAttachmentAttempt = async (errorMessage: string, rollbackPersisted: boolean) => {
          agentsRef.current = snapshot;
          setAgents((prev) => mergeSettledAgents(prev, snapshot));

          if (rollbackPersisted && persistedUpdates.length > 0) {
            await Promise.all(
              persistedUpdates.map(async (entry) => {
                const previousState = snapshotById.get(entry.id);
                if (!previousState) return;
                const rollbackResult = await persistAgentPosition(entry.id, previousState.x, previousState.y);
                if (!rollbackResult.ok) {
                  console.warn(
                    'Failed to rollback agent position after attach failure:',
                    entry.id,
                    rollbackResult.error
                  );
                }
              })
            );
          }

          setMessageDialog({ title: 'Error', message: errorMessage, type: 'error' });
          return errorResult(errorMessage);
        };

        const positionResult = await persistAgentPosition(primaryUpdate.id, primaryUpdate.x, primaryUpdate.y);
        if (!positionResult.ok) {
          const errorMessage = positionResult.error || 'Failed to update agent position';
          return rollbackAttachmentAttempt(errorMessage, false);
        }
        persistedUpdates.push(primaryUpdate);

        if (secondaryUpdates.length > 0) {
          for (const entry of secondaryUpdates) {
            const result = await persistAgentPosition(entry.id, entry.x, entry.y);
            if (!result.ok) {
              const errorMessage = result.error || 'Failed to update attached agent positions';
              return rollbackAttachmentAttempt(errorMessage, true);
            }
            persistedUpdates.push(entry);
          }
        }

        const result = await workspaceClient.agentAttachToFolder({
          workspacePath,
          agentId,
          folderId,
          relativePath: folder.relativePath,
        });
        if (result.success) {
          return okResult();
        }
        const errorMessage = result.error || 'Failed to attach agent';
        return rollbackAttachmentAttempt(errorMessage, persistedUpdates.length > 0);
      };

      const queuedRun = attachQueueRef.current.then(runAttach, runAttach);
      attachQueueRef.current = queuedRun.then(
        () => undefined,
        () => undefined
      );
      return queuedRun;
    },
    [folders, persistAgentPosition, setAgents, setMessageDialog, workspacePath]
  );

  const detachAgent = async (agentId: string) => {
    const result = await workspaceClient.agentDetach(agentId, workspacePath);
    if (result.success) {
      setAgents((prev) => prev.map((a) => (a.id === agentId ? { ...a, attachedFolderId: undefined } : a)));
      closeAgentTerminals([agentId]);
      return okResult();
    } else {
      const errorMessage = result.error || 'Failed to detach agent';
      setMessageDialog({ title: 'Error', message: errorMessage, type: 'error' });
      return errorResult(errorMessage);
    }
  };

  return {
    applyDetachedAgentIds,
    moveAgentVisual,
    persistAgentPosition,
    handleAgentMove,
    resetAgentNameSequenceIndex,
    createAgent,
    destroyAgent,
    openAgentTerminal,
    clearAgentTerminalState,
    attachAgentToFolder,
    detachAgent,
  };
}
