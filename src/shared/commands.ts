import type { EntityType } from './types';
import type { AgentProvider } from './types';

export type CommandEntityType = EntityType;
export type PointArgs = { x: number; y: number };
export type SizeArgs = { width: number; height: number };
export type AgentIdArgs = { agentId: string };
export type FolderIdArgs = { folderId: string };
export type BrowserIdArgs = { browserId: string };
export type TerminalIdArgs = { terminalId: string };

export type CreateAgentArgs = PointArgs & { attachedFolderId?: string };
export type CreateFolderArgs = PointArgs & { name: string };
export type CreateBrowserArgs = PointArgs & { originFolderId?: string };
export type CreateTerminalArgs = PointArgs & { path: string; originFolderId?: string };
export type MoveEntityArgs = PointArgs & { entityType: CommandEntityType; id?: string };
export type DeleteBrowserArgs = BrowserIdArgs;
export type MoveAgentArgs = PointArgs & AgentIdArgs;
export type MoveFolderArgs = PointArgs & FolderIdArgs;
export type MoveBrowserArgs = PointArgs & BrowserIdArgs;
export type ResizeBrowserArgs = SizeArgs & BrowserIdArgs;
export type MoveTerminalArgs = PointArgs & TerminalIdArgs;
export type ResizeTerminalArgs = SizeArgs & TerminalIdArgs;
export type MoveHeroArgs = PointArgs;
export type RefreshBrowserArgs = BrowserIdArgs;
export type OpenAgentTerminalArgs = AgentIdArgs;
export type ClearHistoryArgs = AgentIdArgs;
export type DetachAgentArgs = AgentIdArgs;
export type DestroyAgentArgs = AgentIdArgs;
export type AttachFolderArgs = { agentId: string; folderId: string };
export type RenameFolderArgs = FolderIdArgs & { name: string };
export type RemoveFolderArgs = FolderIdArgs;
export type DeleteFolderArgs = FolderIdArgs;
export type DeleteTerminalArgs = TerminalIdArgs;
export type CreateWorktreeArgs = PointArgs & FolderIdArgs;
export type WorktreeAbilityArgs = FolderIdArgs;
export type SetAgentModelArgs = { agentId: string; model: string };
export type SetAgentReasoningEffortArgs = { agentId: string; reasoningEffort: string | null };
export type ProviderStatusArgs = { provider: AgentProvider; force?: boolean };
export type ProviderInstallArgs = { provider: AgentProvider };
export type ProvidersBootstrapArgs = Record<string, never>;
export type ProvidersRefreshArgs = { force?: boolean };
export type SetHeroProviderArgs = { provider: AgentProvider };
export type SetHeroModelArgs = { model: string };
export type AgentSendPromptArgs = {
  agentId: string;
  prompt: string;
  relativePath?: string;
  runId?: string;
  resumeSessionId?: string | null;
};
export type HeroSendPromptArgs = { prompt: string; relativePath: string; runId?: string };
export type CancelAgentRunArgs = AgentIdArgs;
export type CancelHeroRunArgs = Record<string, never>;

export type CommandArgsById = {
  'create-agent-claude': CreateAgentArgs;
  'create-agent-codex': CreateAgentArgs;
  'create-folder': CreateFolderArgs;
  'create-terminal': CreateTerminalArgs;
  'create-browser': CreateBrowserArgs;
  'move-entity': MoveEntityArgs;
  'move-agent': MoveAgentArgs;
  'move-folder': MoveFolderArgs;
  'move-browser': MoveBrowserArgs;
  'resize-browser': ResizeBrowserArgs;
  'move-terminal': MoveTerminalArgs;
  'resize-terminal': ResizeTerminalArgs;
  'move-hero': MoveHeroArgs;
  'open-agent-terminal': OpenAgentTerminalArgs;
  'refresh-browser': RefreshBrowserArgs;
  'clear-history': ClearHistoryArgs;
  'attach-folder': AttachFolderArgs;
  'detach-agent': DetachAgentArgs;
  'delete-browser': DeleteBrowserArgs;
  'delete-terminal': DeleteTerminalArgs;
  'rename-folder': RenameFolderArgs;
  'remove-folder': RemoveFolderArgs;
  'delete-folder': DeleteFolderArgs;
  'create-worktree': CreateWorktreeArgs;
  'worktree-sync': WorktreeAbilityArgs;
  'worktree-merge': WorktreeAbilityArgs;
  'undo-merge': WorktreeAbilityArgs;
  'retry-restore': WorktreeAbilityArgs;
  'destroy-agent': DestroyAgentArgs;
  'set-agent-model': SetAgentModelArgs;
  'set-agent-reasoning-effort': SetAgentReasoningEffortArgs;
  'provider-status': ProviderStatusArgs;
  'provider-install': ProviderInstallArgs;
  'providers-bootstrap': ProvidersBootstrapArgs;
  'providers-refresh': ProvidersRefreshArgs;
  'set-hero-provider': SetHeroProviderArgs;
  'set-hero-model': SetHeroModelArgs;
  'agent-send-prompt': AgentSendPromptArgs;
  'hero-send-prompt': HeroSendPromptArgs;
  'cancel-agent-run': CancelAgentRunArgs;
  'cancel-hero-run': CancelHeroRunArgs;
};

export const COMMAND_IDS: ReadonlyArray<keyof CommandArgsById> = [
  'create-agent-claude',
  'create-agent-codex',
  'create-folder',
  'create-terminal',
  'create-browser',
  'move-entity',
  'move-agent',
  'move-folder',
  'move-browser',
  'resize-browser',
  'move-terminal',
  'resize-terminal',
  'move-hero',
  'open-agent-terminal',
  'refresh-browser',
  'clear-history',
  'attach-folder',
  'detach-agent',
  'delete-browser',
  'delete-terminal',
  'rename-folder',
  'remove-folder',
  'delete-folder',
  'create-worktree',
  'worktree-sync',
  'worktree-merge',
  'undo-merge',
  'retry-restore',
  'destroy-agent',
  'set-agent-model',
  'set-agent-reasoning-effort',
  'provider-status',
  'provider-install',
  'providers-bootstrap',
  'providers-refresh',
  'set-hero-provider',
  'set-hero-model',
  'agent-send-prompt',
  'hero-send-prompt',
  'cancel-agent-run',
  'cancel-hero-run',
];

export type CommandId = keyof CommandArgsById;
export type CommandArgs = CommandArgsById[CommandId];

export type CommandSource = 'ui' | 'mcp' | 'shortcut';

export type CommandInvocation<K extends CommandId = CommandId> = {
  id: K;
  args?: CommandArgsById[K];
  source?: CommandSource;
  confirm?: boolean;
};

export type CommandBatchItem = CommandInvocation;

export type CommandBatchResult = {
  id: CommandId;
  ok: boolean;
  error?: string;
};

export type CommandRunResult = {
  ok: boolean;
  error?: string;
};

export type CommandRunRequest =
  | {
      kind: 'single';
      requestId: string;
      workspacePath: string;
      command: CommandInvocation;
    }
  | {
      kind: 'batch';
      requestId: string;
      workspacePath: string;
      commands: CommandInvocation[];
    };

export type CommandRunResponse =
  | {
      kind: 'single';
      requestId: string;
      ok: boolean;
      error?: string;
    }
  | {
      kind: 'batch';
      requestId: string;
      ok: boolean;
      results: CommandBatchResult[];
      error?: string;
    };
