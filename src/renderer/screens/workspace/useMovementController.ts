import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Agent, Folder, Hero, Position, SelectedEntityRef } from '../../../shared/types';
import type { CommandRunResult } from '../../../shared/commands';
import { workspaceClient } from '../../services/workspaceClient';
import {
  distance,
  findNearestFolderInAttachRange,
  getAgentCenter,
  getAngleDeg,
  getAttachSlotPosition,
  getFolderCenter,
  getHeroRadius,
  layoutAttachedAgents,
} from './attachLayout';
import { createMovementIntent, getFormationTargets, getMovementPosition } from './movement';
import * as WORKSPACE_CONSTANTS from './constants';

type UseMovementControllerParams = {
  agents: Agent[];
  hero: Hero;
  folders: Folder[];
  selectedEntityRef: SelectedEntityRef | null;
  selectedAgentIds: string[];
  setAgents: React.Dispatch<React.SetStateAction<Agent[]>>;
  setHero: React.Dispatch<React.SetStateAction<Hero>>;
  workspacePath: string;
  attachAgentToFolder: (
    agentId: string,
    folderId: string,
    targetPos?: { x: number; y: number }
  ) => Promise<CommandRunResult>;
  detachAgent: (agentId: string) => Promise<CommandRunResult>;
};

type UseMovementControllerReturn = {
  renderAgents: Agent[];
  renderHero: Hero;
  destinationMarker: { x: number; y: number } | null;
  handleCanvasRightClick: (position: { x: number; y: number }, target: SelectedEntityRef | null) => void;
  handleHeroMove: (x: number, y: number) => Promise<CommandRunResult>;
  clearMovementGroupIfComplete: (unitId: string) => void;
  clearPendingArrival: (unitId: string) => void;
};

const okResult = (): CommandRunResult => ({ ok: true });
const errorResult = (error: string): CommandRunResult => ({ ok: false, error });

const isWithinRightClickAttachRadius = (position: Position, folder: Folder): boolean =>
  distance(position, getFolderCenter(folder)) <= WORKSPACE_CONSTANTS.FOLDER_RIGHT_CLICK_ATTACH_RADIUS_PX;

type ResolveTargetFolderParams = {
  position: Position;
  target: SelectedEntityRef | null;
  folders: Folder[];
  selectedAgents: Agent[];
};

const resolveRightClickTargetFolder = ({
  position,
  target,
  folders,
  selectedAgents,
}: ResolveTargetFolderParams): Folder | null => {
  if (target?.type === 'folder') {
    const folder = folders.find((f) => f.id === target.id) ?? null;
    if (folder && !isWithinRightClickAttachRadius(position, folder)) return null;
    return folder;
  }

  const selectedAttachedFolderIds = Array.from(
    new Set(selectedAgents.map((agent) => agent.attachedFolderId).filter((id): id is string => Boolean(id)))
  );
  const attachedSourceFolder =
    !target && selectedAttachedFolderIds.length === 1
      ? (folders.find((folder) => folder.id === selectedAttachedFolderIds[0]) ?? null)
      : null;

  if (attachedSourceFolder) {
    return isWithinRightClickAttachRadius(position, attachedSourceFolder) ? attachedSourceFolder : null;
  }

  return findNearestFolderInAttachRange(position, folders);
};

const buildAttachTargetsForSelectedAgents = ({
  targetFolder,
  selectedAgents,
  allAgents,
  startPosById,
}: {
  targetFolder: Folder;
  selectedAgents: Agent[];
  allAgents: Agent[];
  startPosById: Map<string, Position>;
}): Position[] => {
  const selectedIdSet = new Set(selectedAgents.map((agent) => agent.id));
  const staticAttached = allAgents
    .filter((agent) => agent.attachedFolderId === targetFolder.id && !selectedIdSet.has(agent.id))
    .map((agent) => ({
      id: agent.id,
      x: agent.x,
      y: agent.y,
    }));
  const movingEntries = selectedAgents.map((agent) => {
    const startPos = startPosById.get(agent.id) ?? { x: agent.x, y: agent.y };
    return { id: agent.id, x: startPos.x, y: startPos.y };
  });
  const layout = layoutAttachedAgents(targetFolder, [...staticAttached, ...movingEntries]);
  return selectedAgents.map((agent) => {
    const slot = layout.get(agent.id);
    if (slot) return slot.position;
    const startPos = startPosById.get(agent.id) ?? { x: agent.x, y: agent.y };
    const fallbackAngle = getAngleDeg(getFolderCenter(targetFolder), getAgentCenter(startPos));
    return getAttachSlotPosition(targetFolder, fallbackAngle);
  });
};

export function useMovementController({
  agents,
  hero,
  folders,
  selectedEntityRef,
  selectedAgentIds,
  setAgents,
  setHero,
  workspacePath,
  attachAgentToFolder,
  detachAgent,
}: UseMovementControllerParams): UseMovementControllerReturn {
  const [destinationMarker, setDestinationMarker] = useState<{ x: number; y: number } | null>(null);
  const [movementTick, setMovementTick] = useState<number>(() => Date.now());
  const activeMoveGroupRef = useRef<string | null>(null);
  const movementGroupByUnitRef = useRef<Map<string, string>>(new Map());
  const pendingArrivalRef = useRef<Set<string>>(new Set());

  const renderHero = useMemo(() => {
    if (!hero?.movementIntent) return hero;
    const { position } = getMovementPosition(hero.movementIntent, movementTick);
    return { ...hero, x: position.x, y: position.y };
  }, [hero, movementTick]);

  const renderAgents = useMemo(
    () =>
      agents.map((agent) => {
        if (!agent.movementIntent) return agent;
        const { position } = getMovementPosition(agent.movementIntent, movementTick);
        return { ...agent, x: position.x, y: position.y };
      }),
    [agents, movementTick]
  );

  const hasActiveMovement = useMemo(
    () => agents.some((agent) => agent.movementIntent) || !!hero?.movementIntent,
    [agents, hero?.movementIntent]
  );

  useEffect(() => {
    if (!hasActiveMovement) return;
    let frameId = 0;
    let active = true;
    const tick = () => {
      if (!active) return;
      setMovementTick(Date.now());
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => {
      active = false;
      cancelAnimationFrame(frameId);
    };
  }, [hasActiveMovement]);

  const clearMovementGroupIfComplete = useCallback((unitId: string) => {
    const groupId = movementGroupByUnitRef.current.get(unitId);
    if (!groupId) return;
    movementGroupByUnitRef.current.delete(unitId);
    const stillActive = Array.from(movementGroupByUnitRef.current.values()).some((id) => id === groupId);
    if (!stillActive && activeMoveGroupRef.current === groupId) {
      activeMoveGroupRef.current = null;
      setDestinationMarker(null);
    }
  }, []);

  const clearPendingArrival = useCallback((unitId: string) => {
    pendingArrivalRef.current.delete(unitId);
  }, []);

  const handleHeroMove = useCallback(
    async (x: number, y: number): Promise<CommandRunResult> => {
      setHero((prev) => ({ ...prev, x, y, movementIntent: undefined }));
      try {
        const success = await workspaceClient.updateHeroPosition(workspacePath, x, y);
        if (!success) {
          console.warn('Failed to update hero position');
          return errorResult('Failed to update hero position');
        }
        return okResult();
      } catch (error) {
        console.error('Error updating hero position:', error);
        return errorResult(error instanceof Error ? error.message : 'Failed to update hero position');
      }
    },
    [workspacePath, setHero]
  );

  const finalizeAgentMovement = useCallback(
    async (agentId: string, intent: NonNullable<Agent['movementIntent']>) => {
      const shouldAttach = intent.intentType === 'move+attach' && intent.targetId;
      setAgents((prev) =>
        prev.map((agent) =>
          agent.id === agentId
            ? {
                ...agent,
                x: intent.targetPos.x,
                y: intent.targetPos.y,
                movementIntent: undefined,
                attachedFolderId: shouldAttach ? intent.targetId : agent.attachedFolderId,
              }
            : agent
        )
      );
      try {
        await workspaceClient.updateAgentPosition(
          workspacePath,
          agentId,
          intent.targetPos.x,
          intent.targetPos.y
        );
      } catch (error) {
        console.warn('Failed to finalize agent movement:', error);
      }
      if (shouldAttach) {
        await attachAgentToFolder(agentId, intent.targetId!, intent.targetPos);
      }
      pendingArrivalRef.current.delete(agentId);
      clearMovementGroupIfComplete(agentId);
    },
    [attachAgentToFolder, clearMovementGroupIfComplete, setAgents, workspacePath]
  );

  const finalizeHeroMovement = useCallback(
    async (intent: NonNullable<Hero['movementIntent']>) => {
      setHero((prev) => ({
        ...prev,
        x: intent.targetPos.x,
        y: intent.targetPos.y,
        movementIntent: undefined,
      }));
      try {
        await workspaceClient.updateHeroPosition(workspacePath, intent.targetPos.x, intent.targetPos.y);
      } catch (error) {
        console.warn('Failed to finalize hero movement:', error);
      }
      pendingArrivalRef.current.delete('hero');
      clearMovementGroupIfComplete('hero');
    },
    [clearMovementGroupIfComplete, setHero, workspacePath]
  );

  useEffect(() => {
    if (!hasActiveMovement) return;
    const now = movementTick;

    agents.forEach((agent) => {
      const intent = agent.movementIntent;
      if (!intent || pendingArrivalRef.current.has(agent.id)) return;
      const { done } = getMovementPosition(intent, now);
      if (!done) return;
      pendingArrivalRef.current.add(agent.id);
      void finalizeAgentMovement(agent.id, intent);
    });

    if (hero?.movementIntent && !pendingArrivalRef.current.has('hero')) {
      const { done } = getMovementPosition(hero.movementIntent, now);
      if (done) {
        pendingArrivalRef.current.add('hero');
        void finalizeHeroMovement(hero.movementIntent);
      }
    }
  }, [agents, finalizeAgentMovement, finalizeHeroMovement, hasActiveMovement, hero, movementTick]);

  const handleCanvasRightClick = useCallback(
    (position: { x: number; y: number }, target: SelectedEntityRef | null) => {
      const selectedAgents =
        selectedAgentIds.length > 0
          ? selectedAgentIds
              .map((agentId) => agents.find((agent) => agent.id === agentId))
              .filter((agent): agent is Agent => Boolean(agent))
          : selectedEntityRef?.type === 'agent'
            ? agents.filter((agent) => agent.id === selectedEntityRef.id)
            : [];
      const selectedHero = selectedAgentIds.length === 0 && selectedEntityRef?.type === 'hero' ? hero : null;

      if (!(window as any).TEST_LOGS) (window as any).TEST_LOGS = [];
      const log = (msg: string) => (window as any).TEST_LOGS.push(msg);

      log(`handleCanvasRightClick start. position=${position.x},${position.y} target=${JSON.stringify(target)} selectedAgentIds=${selectedAgentIds.length} agents=${agents.length} folders=${folders.length}`);

      if (selectedAgents.length === 0 && !selectedHero) {
        log('handleCanvasRightClick abort: no agents or hero');
        return;
      }

      const now = Date.now();
      const groupId = `move-${now}-${Math.random().toString(36).slice(2, 8)}`;
      activeMoveGroupRef.current = groupId;
      movementGroupByUnitRef.current.clear();
      pendingArrivalRef.current.clear();
      setDestinationMarker({ x: position.x, y: position.y });

      const targetFolder = resolveRightClickTargetFolder({
        position,
        target,
        folders,
        selectedAgents,
      });

      log(`handleCanvasRightClick targetFolder=${targetFolder?.id}`);

      const detachPromises = selectedAgents
        .filter((agent) => agent.attachedFolderId)
        .map((agent) => detachAgent(agent.id));

      void Promise.all(detachPromises).then(() => {
        const startPosById = new Map<string, { x: number; y: number }>();
        selectedAgents.forEach((agent) => {
          const startPos = agent.movementIntent
            ? getMovementPosition(agent.movementIntent, now).position
            : { x: agent.x, y: agent.y };
          startPosById.set(agent.id, startPos);
        });

        if (selectedAgents.length > 0) {
          const targets = targetFolder
            ? buildAttachTargetsForSelectedAgents({
                targetFolder,
                selectedAgents,
                allAgents: agents,
                startPosById,
              })
            : getFormationTargets(selectedAgents.length, position);

          log(`handleCanvasRightClick targets count=${targets.length}`);
          setAgents((prev) => {
            let updatedCount = 0;
            const next = prev.map((agent) => {
              const idx = selectedAgents.findIndex((entry) => entry.id === agent.id);
              if (idx === -1) return agent;
              updatedCount++;
              const startPos = startPosById.get(agent.id) ?? { x: agent.x, y: agent.y };
              const intent = createMovementIntent(
                startPos,
                targets[idx],
                targetFolder ? 'move+attach' : 'move',
                now,
                targetFolder?.id
              );
              log(`Agent ${agent.id} intent=${intent.intentType} targetId=${intent.targetId} dur=${intent.duration}`);
              movementGroupByUnitRef.current.set(agent.id, groupId);
              void workspaceClient.setAgentMovementIntent(workspacePath, agent.id, intent);
              return {
                ...agent,
                x: startPos.x,
                y: startPos.y,
                movementIntent: intent,
                attachedFolderId: undefined,
              };
            });
            log(`setAgents updated ${updatedCount} agents`);
            return next;
          });
        }

        if (selectedHero) {
          const startPos = selectedHero.movementIntent
            ? getMovementPosition(selectedHero.movementIntent, now).position
            : { x: selectedHero.x, y: selectedHero.y };
          const heroRadius = getHeroRadius();
          const heroTarget = { x: position.x - heroRadius, y: position.y - heroRadius };
          const intent = createMovementIntent(startPos, heroTarget, 'move', now);
          movementGroupByUnitRef.current.set('hero', groupId);
          void workspaceClient.setHeroMovementIntent(workspacePath, intent);
          setHero((prev) => ({ ...prev, x: startPos.x, y: startPos.y, movementIntent: intent }));
        }
      });
    },
    [
      agents,
      detachAgent,
      folders,
      hero,
      selectedAgentIds,
      selectedEntityRef,
      setAgents,
      setHero,
      workspacePath,
    ]
  );

  return {
    renderAgents,
    renderHero,
    destinationMarker,
    handleCanvasRightClick,
    handleHeroMove,
    clearMovementGroupIfComplete,
    clearPendingArrival,
  };
}
