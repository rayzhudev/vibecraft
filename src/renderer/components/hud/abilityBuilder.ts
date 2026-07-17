import type { Agent, AnyFolder, WorldEntity } from '../../../shared/types';
import type { CommandInvocation } from '../../commands/registry';
import type { HotkeyMode } from './hotkeys';
import { entityIcons, providerIcons } from '../../assets/icons';

export type AbilityVariant = {
  id: string;
  label: string;
  icon?: string;
  action: CommandInvocation;
};

export type AbilityDescriptor = {
  id: string;
  label: string;
  icon?: string;
  kind?: 'primary' | 'warning' | 'default';
  selected?: boolean;
  disabled?: boolean;
  tooltip?: string;
  action: CommandInvocation;
  variants?: AbilityVariant[];
};

export type FolderContext = {
  gitInfo?: { isRepo: boolean; isWorktree: boolean } | null;
};

type BuildParams = { entity: WorldEntity | null; ctx?: FolderContext; agentTerminalOpen?: boolean };

export type AbilityResolutionInput = {
  selectedEntity: WorldEntity | null;
  selectedAgents: Agent[];
  ctx?: FolderContext;
  activeAgentTerminalId: string | null;
};

export type AbilityResolution = {
  abilities: AbilityDescriptor[];
  hotkeyMode: HotkeyMode;
  isMultiSelect: boolean;
  isGlobal: boolean;
};

export function buildAbilities(params: BuildParams): AbilityDescriptor[] {
  const { entity, ctx } = params;

  if (!entity) {
    return [
      {
        id: 'create-agent-claude',
        label: 'Agent',
        icon: providerIcons.claude,
        action: { id: 'create-agent-claude' },
        variants: [
          {
            id: 'create-agent-claude',
            label: 'Claude',
            icon: providerIcons.claude,
            action: { id: 'create-agent-claude' },
          },
          {
            id: 'create-agent-google',
            label: 'Gemini',
            icon: providerIcons.google,
            action: { id: 'create-agent-google' },
          },
          {
            id: 'create-agent-codex',
            label: 'Codex',
            icon: providerIcons.codex,
            action: { id: 'create-agent-codex' },
          },
        ],
      },
      { id: 'create-folder', label: 'Project', icon: entityIcons.folder, action: { id: 'create-folder' } },
      {
        id: 'create-terminal',
        label: 'Terminal',
        icon: entityIcons.terminal,
        action: { id: 'create-terminal' },
      },
      { id: 'create-browser', label: 'Browser', icon: entityIcons.browser, action: { id: 'create-browser' } },
    ];
  }

  switch (entity.type) {
    case 'hero': {
      const activeProvider =
        entity.provider === 'codex' ? 'codex' : entity.provider === 'google' ? 'google' : 'claude';
      return [
        {
          id: 'hero-provider-claude',
          label: 'Claude',
          icon: providerIcons.claude,
          selected: activeProvider === 'claude',
          tooltip: 'Use Claude',
          action: { id: 'set-hero-provider', args: { provider: 'claude' } },
        },
        {
          id: 'hero-provider-google',
          label: 'Gemini',
          icon: providerIcons.google,
          selected: activeProvider === 'google',
          tooltip: 'Use Gemini',
          action: { id: 'set-hero-provider', args: { provider: 'google' } },
        },
        {
          id: 'hero-provider-codex',
          label: 'Codex',
          icon: providerIcons.codex,
          selected: activeProvider === 'codex',
          tooltip: 'Use Codex',
          action: { id: 'set-hero-provider', args: { provider: 'codex' } },
        },
      ];
    }
    case 'agent': {
      const attached = !!entity.attachedFolderId;
      const terminalOpen = !!params.agentTerminalOpen;
      const abilities: AbilityDescriptor[] = [
        {
          id: 'open-agent-terminal',
          label: terminalOpen ? 'Close Terminal' : 'Agent Terminal',
          icon: terminalOpen ? '✕' : '⌨️',
          disabled: false,
          tooltip: attached || terminalOpen ? undefined : 'Terminal will open in read-only mode',
          action: { id: 'open-agent-terminal' },
        },
        { id: 'clear-history', label: 'Clear History', icon: '♻️', action: { id: 'clear-history' } },
      ];
      abilities.push({
        id: 'destroy-agent',
        label: 'Destroy',
        icon: '🗑️',
        kind: 'warning',
        action: { id: 'destroy-agent' },
      });
      return abilities;
    }
    case 'folder': {
      const folder = entity as AnyFolder;
      if (!folder) return [];
      if (folder.conflictState) {
        const isRestore = folder.conflictState.kind === 'restore';
        const conflictAbilities: AbilityDescriptor[] = [
          {
            id: 'create-terminal',
            label: 'New Terminal',
            icon: entityIcons.terminal,
            action: { id: 'create-terminal' },
          },
          { id: 'undo-merge', label: 'Undo Merge', icon: '↩️', action: { id: 'undo-merge' } },
        ];
        if (isRestore) {
          conflictAbilities.push({
            id: 'retry-restore',
            label: 'Retry Restore',
            icon: '🔁',
            action: { id: 'retry-restore' },
          });
        }
        return conflictAbilities;
      }
      const isRepo = !!ctx?.gitInfo?.isRepo;
      const isWorktree = !!ctx?.gitInfo?.isWorktree || !!folder.isWorktree;
      const worktreeSourceMissing = !!folder.isWorktree && !folder.sourceRelativePath;
      const worktreeDisabled = !isRepo || isWorktree;
      const abilities: AbilityDescriptor[] = [
        {
          id: 'create-terminal',
          label: 'New Terminal',
          icon: entityIcons.terminal,
          action: { id: 'create-terminal' },
        },
      ];
      if (!isWorktree) {
        abilities.push({
          id: 'create-worktree',
          label: 'New Worktree',
          icon: '🌱',
          disabled: worktreeDisabled,
          tooltip: worktreeDisabled
            ? !isRepo
              ? 'Folder is not a Git repository'
              : 'Cannot create a worktree from another worktree'
            : undefined,
          action: { id: 'create-worktree' },
        });
      } else {
        const worktreeOpsDisabled = worktreeSourceMissing;
        const worktreeOpsTooltip = worktreeOpsDisabled ? 'Worktree source not found in workspace' : undefined;
        abilities.push({
          id: 'worktree-sync',
          label: 'Sync From Source',
          icon: '⤵️',
          disabled: worktreeOpsDisabled,
          tooltip: worktreeOpsTooltip,
          action: { id: 'worktree-sync' },
        });
        abilities.push({
          id: 'worktree-merge',
          label: 'Merge To Source',
          icon: '⤴️',
          disabled: worktreeOpsDisabled,
          tooltip: worktreeOpsTooltip,
          action: { id: 'worktree-merge' },
        });
      }
      abilities.push({
        id: 'remove-folder',
        label: 'Remove from UI',
        icon: '🚫',
        action: { id: 'remove-folder' },
      });
      abilities.push({
        id: 'delete-folder',
        label: 'Delete',
        icon: '🗑️',
        kind: 'warning',
        action: { id: 'delete-folder' },
      });
      return abilities;
    }
    case 'browser':
      return [
        { id: 'refresh-browser', label: 'Refresh', icon: '🔄', action: { id: 'refresh-browser' } },
        {
          id: 'delete-browser',
          label: 'Close',
          icon: '🗑️',
          kind: 'warning',
          action: { id: 'delete-browser' },
        },
      ];
    case 'terminal':
      return [
        {
          id: 'delete-terminal',
          label: 'Close',
          icon: '🗑️',
          kind: 'warning',
          action: { id: 'delete-terminal' },
        },
      ];
    default:
      return [];
  }
}

export function resolveAbilitiesForSelection({
  selectedEntity,
  selectedAgents,
  ctx,
  activeAgentTerminalId,
}: AbilityResolutionInput): AbilityResolution {
  const isMultiSelect = selectedAgents.length > 1;
  const isEntitySelected = isMultiSelect || Boolean(selectedEntity);
  const isGlobal = !isEntitySelected;
  const hotkeyMode: HotkeyMode = isEntitySelected ? 'qwerty' : 'numbers';

  const abilities: AbilityDescriptor[] = isMultiSelect
    ? [
        {
          id: 'destroy-agent',
          label: 'Delete',
          icon: '🗑️',
          kind: 'warning',
          action: { id: 'destroy-agent' },
        },
      ]
    : selectedEntity
      ? buildAbilities({
          entity: selectedEntity,
          ctx,
          agentTerminalOpen: selectedEntity.type === 'agent' && selectedEntity.id === activeAgentTerminalId,
        })
      : buildAbilities({ entity: null, ctx });

  return {
    abilities,
    hotkeyMode,
    isMultiSelect,
    isGlobal,
  };
}
