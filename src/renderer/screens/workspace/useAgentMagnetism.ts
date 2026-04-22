import { useCallback, useEffect, useRef, useState } from 'react';
import type { Agent, Folder, Position } from '../../../shared/types';
import type { CommandRunResult } from '../../../shared/commands';
import {
  findNearestFolderInGravity,
  resolveAttachSlot,
  getSnapPosition,
  isOutsideGravity,
} from './attachLayout';

// Keep in sync with workspace layout constants
const FOLDER_SIZE = 80;
const AGENT_SIZE = 48;

type LayoutOverride = { x: number; y: number; width?: number; height?: number };

type DragEndData = { pos: Position; dragDistance: number };
type AgentMove = { id: string; x: number; y: number };

type UseAgentMagnetismParams = {
  agents: Agent[];
  folders: Folder[];
  positionOverrides?: Map<string, LayoutOverride>;
  projectZones?: import('./useProjectMode').ProjectZone[];
  layoutActive?: boolean;
  focusModeActive?: boolean;
  setAgents: React.Dispatch<React.SetStateAction<Agent[]>>;
  persistAgentPosition: (id: string, x: number, y: number) => Promise<CommandRunResult>;
  attachAgentToFolder: (
    agentId: string,
    folderId: string,
    targetPos?: { x: number; y: number }
  ) => Promise<CommandRunResult>;
  detachAgent: (agentId: string) => Promise<CommandRunResult>;
  clearMovementGroupIfComplete: (unitId: string) => void;
  clearPendingArrival: (unitId: string) => void;
};

type UseAgentMagnetismReturn = {
  handleAgentMove: (id: string, x: number, y: number) => CommandRunResult;
  handleAgentMoveBatch: (moves: AgentMove[]) => CommandRunResult;
  handleAgentDragStart: (id: string) => void;
  handleAgentDragEnd: (id: string, data?: DragEndData) => void;
  magnetizedFolderIds: string[];
};

const okResult = (): CommandRunResult => ({ ok: true });
const errorResult = (error: string): CommandRunResult => ({ ok: false, error });

export function useAgentMagnetism({
  agents,
  folders,
  positionOverrides,
  projectZones,
  layoutActive,
  focusModeActive,
  setAgents,
  persistAgentPosition,
  attachAgentToFolder,
  detachAgent,
  clearMovementGroupIfComplete,
  clearPendingArrival,
}: UseAgentMagnetismParams): UseAgentMagnetismReturn {
  const agentsRef = useRef<Agent[]>(agents);
  const foldersRef = useRef<Folder[]>(folders);
  const [magnetizedFolderIds, setMagnetizedFolderIds] = useState<string[]>([]);

  const pendingAttachRef = useRef<Map<string, string | null>>(new Map());
  const dragLastPosByAgentRef = useRef<Map<string, Position>>(new Map());
  const dragStartAttachmentRef = useRef<Map<string, string | undefined>>(new Map());
  const lockedAngleByAgentRef = useRef<Map<string, number>>(new Map());
  const lockedFolderByAgentRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    agentsRef.current = agents;
  }, [agents]);

  useEffect(() => {
    if (positionOverrides && positionOverrides.size > 0) {
      foldersRef.current = folders.map((f) => {
        const p = positionOverrides.get(f.id);
        return p ? { ...f, x: p.x, y: p.y } : f;
      });
    } else {
      foldersRef.current = folders;
    }
  }, [folders, positionOverrides]);

  const updateMagnetizedFolders = useCallback(() => {
    const active = new Set(lockedFolderByAgentRef.current.values());
    setMagnetizedFolderIds(Array.from(active));
  }, []);

  const clearSnapLockForAgent = useCallback(
    (agentId: string) => {
      lockedAngleByAgentRef.current.delete(agentId);
      lockedFolderByAgentRef.current.delete(agentId);
      updateMagnetizedFolders();
    },
    [updateMagnetizedFolders]
  );

  const resolveDragAttachment = useCallback((agentId: string, fallback?: string) => {
    const pending = pendingAttachRef.current;
    if (!pending.has(agentId)) return fallback;
    return pending.get(agentId) ?? undefined;
  }, []);

  const applyAgentPatches = useCallback(
    (patches: Map<string, Partial<Agent>>) => {
      if (patches.size === 0) return;
      setAgents((prev) =>
        prev.map((agent) => {
          const patch = patches.get(agent.id);
          if (!patch) return agent;
          return { ...agent, ...patch, movementIntent: undefined };
        })
      );
    },
    [setAgents]
  );

  const handleAgentDragStart = useCallback(
    (agentId: string) => {
      clearPendingArrival(agentId);
      lockedAngleByAgentRef.current.delete(agentId);
      lockedFolderByAgentRef.current.delete(agentId);
      const agent = agentsRef.current.find((entry) => entry.id === agentId);
      if (agent) {
        dragLastPosByAgentRef.current.set(agentId, { x: agent.x, y: agent.y });
        dragStartAttachmentRef.current.set(agentId, agent.attachedFolderId);
        pendingAttachRef.current.set(agentId, agent.attachedFolderId ?? null);
      } else {
        pendingAttachRef.current.delete(agentId);
      }
      clearMovementGroupIfComplete(agentId);
    },
    [clearMovementGroupIfComplete, clearPendingArrival]
  );

  const handleAgentDragEnd = useCallback(
    (agentId: string, data?: DragEndData) => {
      const lockedAngle = lockedAngleByAgentRef.current.get(agentId);
      const agent = agentsRef.current.find((entry) => entry.id === agentId);
      if (!agent) return;

      const startAttachment = dragStartAttachmentRef.current.get(agentId);
      let currentAttachment = resolveDragAttachment(agentId, agent.attachedFolderId);
      const lastPos = dragLastPosByAgentRef.current.get(agentId);
      let finalPos = data?.pos ?? lastPos ?? { x: agent.x, y: agent.y };

      dragLastPosByAgentRef.current.delete(agentId);
      dragStartAttachmentRef.current.delete(agentId);
      clearSnapLockForAgent(agentId);
      pendingAttachRef.current.delete(agentId);

      if (currentAttachment && lockedAngle !== undefined) {
        const folder = foldersRef.current.find((entry) => entry.id === currentAttachment);
        if (folder) {
          finalPos = getSnapPosition(folder, lockedAngle);
        }
      }

      // If no folder is magnetized yet but we dropped inside an organized/tiled project pane,
      // attach to that pane's folder to avoid disconnects.
      if (!currentAttachment && projectZones && (layoutActive || focusModeActive)) {
        const zoneHit = projectZones.find(
          (zone) =>
            finalPos.x >= zone.x &&
            finalPos.x <= zone.x + zone.w &&
            finalPos.y >= zone.y &&
            finalPos.y <= zone.y + zone.h
        );
        if (zoneHit) {
          currentAttachment = zoneHit.folderId;
          const folder = foldersRef.current.find((f) => f.id === zoneHit.folderId);
          finalPos = folder
            ? {
                x: folder.x + FOLDER_SIZE / 2 - AGENT_SIZE / 2,
                y: folder.y + FOLDER_SIZE / 2 - AGENT_SIZE / 2,
              }
            : {
                x: zoneHit.x + zoneHit.w / 2 - AGENT_SIZE / 2,
                y: zoneHit.y + zoneHit.h / 2 - AGENT_SIZE / 2,
              };
        }
      }

      if (currentAttachment) {
        void attachAgentToFolder(agentId, currentAttachment, finalPos);
      } else {
        void persistAgentPosition(agentId, finalPos.x, finalPos.y);
        if (startAttachment) {
          void detachAgent(agentId);
        }
      }
    },
    [
      attachAgentToFolder,
      clearSnapLockForAgent,
      detachAgent,
      focusModeActive,
      layoutActive,
      persistAgentPosition,
      projectZones,
      resolveDragAttachment,
    ]
  );

  const computeAgentMovePatch = useCallback(
    (
      id: string,
      x: number,
      y: number,
      patches: Map<string, Partial<Agent>>,
      reservedAnglesByFolder?: Map<string, number[]>,
      batchExcludeIds?: Set<string>
    ): CommandRunResult => {
      const agent = agentsRef.current.find((entry) => entry.id === id);
      if (!agent) return errorResult('Agent not found');
      dragLastPosByAgentRef.current.set(id, { x, y });

      const setPatch = (patch: Partial<Agent>) => {
        const existing = patches.get(id);
        patches.set(id, existing ? { ...existing, ...patch } : patch);
      };

      const cursorPos = { x, y };
      const getSlotAngleRad = (folder: Folder, sourcePos: Position): number => {
        const reservedAngles = reservedAnglesByFolder?.get(folder.id) ?? [];
        const resolved = resolveAttachSlot(folder, sourcePos, agentsRef.current, {
          excludeIds: batchExcludeIds ?? new Set([id]),
          includePendingAttach: true,
          extraOccupiedAngles: reservedAngles,
        });
        if (reservedAnglesByFolder) {
          const nextReserved = [...reservedAngles, resolved.angleDeg];
          reservedAnglesByFolder.set(folder.id, nextReserved);
        }
        return (resolved.angleDeg * Math.PI) / 180;
      };
      let attachedFolderId = resolveDragAttachment(id, agent.attachedFolderId);
      let attachedFolder = attachedFolderId
        ? foldersRef.current.find((folder) => folder.id === attachedFolderId)
        : undefined;

      // If we are organized into panes, treat a pane hit as the active target even before snap.
      if (!attachedFolder && projectZones && (layoutActive || focusModeActive)) {
        const zoneHit = projectZones.find(
          (zone) =>
            cursorPos.x >= zone.x &&
            cursorPos.x <= zone.x + zone.w &&
            cursorPos.y >= zone.y &&
            cursorPos.y <= zone.y + zone.h
        );
        if (zoneHit) {
          attachedFolderId = zoneHit.folderId;
          attachedFolder = foldersRef.current.find((folder) => folder.id === attachedFolderId);
          pendingAttachRef.current.set(id, attachedFolderId);
        }
      }

      if (attachedFolder) {
        if (isOutsideGravity(cursorPos, attachedFolder)) {
          pendingAttachRef.current.set(id, null);
          clearSnapLockForAgent(id);
          setPatch({ x, y, attachedFolderId: undefined, status: 'offline' });
          return okResult();
        }
        pendingAttachRef.current.set(id, attachedFolder.id);
        let lockedAngle = lockedAngleByAgentRef.current.get(id);
        if (lockedAngle === undefined) {
          lockedAngle = getSlotAngleRad(attachedFolder, cursorPos);
          lockedAngleByAgentRef.current.set(id, lockedAngle);
          lockedFolderByAgentRef.current.set(id, attachedFolder.id);
          updateMagnetizedFolders();
        }
        const snapPos = getSnapPosition(attachedFolder, lockedAngle);
        if (!agent.attachedFolderId) {
          setPatch({
            x: snapPos.x,
            y: snapPos.y,
            attachedFolderId: attachedFolder.id,
            status: 'online',
          });
        } else {
          setPatch({ x: snapPos.x, y: snapPos.y });
        }
        return okResult();
      }

      const nearestFolder = findNearestFolderInGravity(cursorPos, foldersRef.current);

      if (!nearestFolder) {
        pendingAttachRef.current.set(id, null);
        clearSnapLockForAgent(id);
        setPatch({ x, y });
        return okResult();
      }

      const currentLockedFolder = lockedFolderByAgentRef.current.get(id);

      if (currentLockedFolder !== nearestFolder.id) {
        const slotAngleRad = getSlotAngleRad(nearestFolder, cursorPos);
        lockedAngleByAgentRef.current.set(id, slotAngleRad);
        lockedFolderByAgentRef.current.set(id, nearestFolder.id);
        updateMagnetizedFolders();
      }

      const lockedAngle = lockedAngleByAgentRef.current.get(id)!;
      const snapPos = getSnapPosition(nearestFolder, lockedAngle);

      pendingAttachRef.current.set(id, nearestFolder.id);
      setPatch({ x: snapPos.x, y: snapPos.y, attachedFolderId: nearestFolder.id, status: 'online' });

      return okResult();
    },
    [
      clearSnapLockForAgent,
      focusModeActive,
      layoutActive,
      projectZones,
      resolveDragAttachment,
      updateMagnetizedFolders,
    ]
  );

  const handleAgentMoveBatch = useCallback(
    (moves: AgentMove[]): CommandRunResult => {
      if (moves.length === 0) return okResult();
      const patches = new Map<string, Partial<Agent>>();
      const reservedAnglesByFolder = new Map<string, number[]>();
      const batchExcludeIds = new Set(moves.map((move) => move.id));
      for (const move of moves) {
        const result = computeAgentMovePatch(
          move.id,
          move.x,
          move.y,
          patches,
          reservedAnglesByFolder,
          batchExcludeIds
        );
        if (!result.ok) {
          return result;
        }
      }
      applyAgentPatches(patches);
      return okResult();
    },
    [applyAgentPatches, computeAgentMovePatch]
  );

  const handleAgentMove = useCallback(
    (id: string, x: number, y: number): CommandRunResult => {
      const patches = new Map<string, Partial<Agent>>();
      const result = computeAgentMovePatch(id, x, y, patches, undefined, new Set([id]));
      if (!result.ok) return result;
      applyAgentPatches(patches);
      return okResult();
    },
    [applyAgentPatches, computeAgentMovePatch]
  );

  useEffect(() => {
    const detachIds: string[] = [];
    agents.forEach((agent) => {
      if (!agent.attachedFolderId) return;
      const folder = folders.find((entry) => entry.id === agent.attachedFolderId);
      if (!folder) return;
      if (isOutsideGravity(agent, folder)) {
        detachIds.push(agent.id);
      }
    });
    if (detachIds.length === 0) return;
    setAgents((prev) =>
      prev.map((agent) => (detachIds.includes(agent.id) ? { ...agent, attachedFolderId: undefined } : agent))
    );
    detachIds.forEach((agentId) => {
      void detachAgent(agentId);
    });
  }, [agents, detachAgent, folders, setAgents]);

  return {
    handleAgentMove,
    handleAgentMoveBatch,
    handleAgentDragStart,
    handleAgentDragEnd,
    magnetizedFolderIds,
  };
}
