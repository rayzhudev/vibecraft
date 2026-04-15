import type { Agent, Folder, Hero, TutorialState, WorldEntity } from '../../../shared/types';
import type { CommandInvocation, CommandRunResult } from '../../commands/registry';
import * as WORKSPACE_CONSTANTS from './constants';
import { workspaceClient } from '../../services/workspaceClient';
import { getNextDefaultProjectName } from './projectNameDefaults';
import { DEFAULT_TUTORIAL_STATE } from '../../tutorial/constants';
import { getTutorialAbilityPolicy } from '../../tutorial/policy';

interface UseWorkspaceAbilitiesParams {
  workspacePath: string;
  selectedEntity: WorldEntity | null;
  selectedAgentIds: string[];
  hero: Hero;
  agents: Agent[];
  folders: Folder[];
  focusedProjectIds?: ReadonlySet<string>;
  runCommandWithContext: (command: CommandInvocation) => Promise<CommandRunResult>;
  beginRename: () => void;
  tutorialState?: TutorialState;
}

export function useWorkspaceAbilities({
  workspacePath,
  selectedEntity,
  selectedAgentIds,
  hero,
  agents,
  folders,
  focusedProjectIds = new Set<string>(),
  runCommandWithContext,
  beginRename,
  tutorialState = DEFAULT_TUTORIAL_STATE,
}: UseWorkspaceAbilitiesParams) {
  const tutorialPolicy = getTutorialAbilityPolicy(tutorialState, hero.provider);
  const tutorialEnabled = tutorialPolicy.enabled;
  const allowedAbilities = tutorialPolicy.allowedAbilities;
  const browserCreationBlocked = tutorialPolicy.browserCreationBlocked;
  const selectedFolder =
    selectedEntity?.type === 'folder'
      ? folders.find((entry) => entry.id === selectedEntity.id)
      : selectedEntity?.type === 'agent'
        ? (() => {
            const selectedAgent = agents.find((entry) => entry.id === selectedEntity.id);
            return selectedAgent?.attachedFolderId
              ? folders.find((entry) => entry.id === selectedAgent.attachedFolderId)
              : undefined;
          })()
        : focusedProjectIds.size === 1
          ? folders.find((entry) => entry.id === Array.from(focusedProjectIds)[0])
          : undefined;

  const handleAbility = async (command: CommandInvocation) => {
    const ability = command.id;
    if (tutorialEnabled && allowedAbilities && !allowedAbilities.includes(ability)) {
      return;
    }
    if (browserCreationBlocked && ability === 'create-browser') {
      return;
    }
    if (ability === 'destroy-agent' && selectedAgentIds.length > 1) {
      await Promise.all(
        selectedAgentIds.map((agentId) =>
          runCommandWithContext({
            id: 'destroy-agent',
            source: 'ui',
            args: { agentId },
          })
        )
      );
      return;
    }
    if (ability === 'create-agent-claude' || ability === 'create-agent-codex') {
      const isTutorialSpawn =
        tutorialEnabled &&
        (tutorialState.stepId === 'create-agent' || tutorialState.stepId === 'create-agent-2');
      const x = selectedFolder
        ? selectedFolder.x + WORKSPACE_CONSTANTS.FOLDER_SPAWN_OFFSET_X
        : hero.x +
          WORKSPACE_CONSTANTS.AGENT_SPAWN_OFFSET_X +
          agents.length * WORKSPACE_CONSTANTS.AGENT_SPAWN_SPACING;
      const y = selectedFolder
        ? selectedFolder.y +
          WORKSPACE_CONSTANTS.FOLDER_SPAWN_OFFSET_Y +
          (isTutorialSpawn ? WORKSPACE_CONSTANTS.TUTORIAL_AGENT_SPAWN_EXTRA_Y : 0)
        : hero.y +
          WORKSPACE_CONSTANTS.AGENT_SPAWN_OFFSET_Y +
          (isTutorialSpawn ? WORKSPACE_CONSTANTS.TUTORIAL_AGENT_SPAWN_EXTRA_Y : 0);
      await runCommandWithContext({
        id: ability,
        source: 'ui',
        args: { x, y, attachedFolderId: selectedFolder?.id },
      });
      return;
    }
    if (ability === 'create-folder') {
      const x = hero.x + WORKSPACE_CONSTANTS.FOLDER_SPAWN_OFFSET_X;
      const y = hero.y + WORKSPACE_CONSTANTS.FOLDER_SPAWN_OFFSET_Y;
      const availableFolders = await workspaceClient.listAvailableFolders(workspacePath).catch((error) => {
        console.warn('Failed to load available folders for default naming:', error);
        return [];
      });
      const name = getNextDefaultProjectName({ folders, availableFolders });
      await runCommandWithContext({ id: 'create-folder', source: 'ui', args: { name, x, y } });
      return;
    }
    if (ability === 'create-terminal') {
      const path = selectedFolder?.relativePath ?? '.';
      const x = selectedFolder ? selectedFolder.x + 120 : hero.x + 180;
      const y = selectedFolder ? selectedFolder.y + 120 : hero.y + 120;
      await runCommandWithContext({
        id: 'create-terminal',
        source: 'ui',
        args: { path, x, y, originFolderId: selectedFolder?.id },
      });
      return;
    }
    if (ability === 'create-browser') {
      const x = selectedFolder ? selectedFolder.x + 160 : hero.x + WORKSPACE_CONSTANTS.BROWSER_SPAWN_OFFSET_X;
      const y = selectedFolder ? selectedFolder.y + 160 : hero.y + WORKSPACE_CONSTANTS.BROWSER_SPAWN_OFFSET_Y;
      await runCommandWithContext({
        id: 'create-browser',
        source: 'ui',
        args: { x, y, originFolderId: selectedFolder?.id },
      });
      return;
    }
    if (ability === 'create-worktree') {
      if (selectedEntity?.type !== 'folder') return;
      const x = hero.x + 180;
      const y = hero.y - 120;
      await runCommandWithContext({
        id: 'create-worktree',
        source: 'ui',
        args: { folderId: selectedEntity.id, x, y },
      });
      return;
    }
    if (ability === 'rename-folder') {
      beginRename();
      return;
    }
    if (ability === 'open-agent-terminal' || ability === 'clear-history' || ability === 'destroy-agent') {
      if (selectedEntity?.type !== 'agent') return;
      await runCommandWithContext({
        id: ability,
        source: 'ui',
        args: { agentId: selectedEntity.id },
      });
      return;
    }
    if (ability === 'refresh-browser' || ability === 'delete-browser') {
      if (selectedEntity?.type !== 'browser') return;
      await runCommandWithContext({
        id: ability,
        source: 'ui',
        args: { browserId: selectedEntity.id },
      });
      return;
    }
    if (ability === 'delete-terminal') {
      if (selectedEntity?.type !== 'terminal') return;
      await runCommandWithContext({
        id: ability,
        source: 'ui',
        args: { terminalId: selectedEntity.id },
      });
      return;
    }
    if (
      ability === 'remove-folder' ||
      ability === 'delete-folder' ||
      ability === 'worktree-sync' ||
      ability === 'worktree-merge' ||
      ability === 'undo-merge' ||
      ability === 'retry-restore'
    ) {
      if (selectedEntity?.type !== 'folder') return;
      await runCommandWithContext({
        id: ability,
        source: 'ui',
        args: { folderId: selectedEntity.id },
      });
      return;
    }
    await runCommandWithContext({
      ...command,
      source: 'ui',
    });
  };

  return { handleAbility };
}
