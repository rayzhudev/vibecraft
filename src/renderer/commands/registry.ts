import type {
  Agent,
  AgentProvider,
  BrowserPanel,
  Folder,
  Hero,
  EntityType,
  TerminalPanel,
  WorldEntity,
} from '../../shared/types';
import type {
  CommandArgs,
  CommandBatchItem,
  CommandBatchResult,
  CommandId,
  CommandInvocation,
  CommandRunResult,
} from '../../shared/commands';
import type { FolderContext } from '../components/hud/abilityBuilder';
import { resolveMovePosition, resolveResize } from './placement';
import { normalizeWorkspaceRelativePath } from '../../shared/pathUtils';
import { isSupportedAgentProvider } from '../../shared/providers';
import { entityIcons, providerIcons } from '../assets/icons';

export type CommandContext = {
  selectedEntity: WorldEntity | null;
  hero: Hero;
  agents: Agent[];
  folders: Folder[];
  browsers: BrowserPanel[];
  terminals: TerminalPanel[];
  folderContext?: FolderContext;
};

type CommandHandlerResult = Promise<CommandRunResult | void> | CommandRunResult | void;

export type CommandHandlers = {
  createAgent: (
    provider: AgentProvider,
    x: number,
    y: number,
    attachedFolderId?: string
  ) => CommandHandlerResult;
  createFolder: (name: string, x: number, y: number) => CommandHandlerResult;
  createBrowser: (x: number, y: number, originFolderId?: string) => CommandHandlerResult;
  createTerminal: (
    relativePath: string,
    x: number,
    y: number,
    originFolderId?: string
  ) => CommandHandlerResult;
  openAgentTerminal: (agentId: string) => CommandHandlerResult;
  refreshBrowser: (id: string) => CommandHandlerResult;
  clearAgentTerminalState: (agentId: string) => CommandHandlerResult;
  attachAgentToFolder: (agentId: string, folderId: string) => CommandHandlerResult;
  detachAgent: (agentId: string) => CommandHandlerResult;
  closeBrowser: (id: string) => CommandHandlerResult;
  closeTerminal: (terminalId: string) => CommandHandlerResult;
  removeFolder: (folderId: string) => CommandHandlerResult;
  deleteFolder: (folderId: string, options?: { skipConfirm?: boolean }) => CommandHandlerResult;
  renameFolder: (folderId: string, name: string) => CommandHandlerResult;
  createWorktree: (folderId: string, x: number, y: number) => CommandHandlerResult;
  worktreeSync: (folderId: string) => CommandHandlerResult;
  worktreeMerge: (folderId: string) => CommandHandlerResult;
  undoMerge: (folderId: string) => CommandHandlerResult;
  retryRestore: (folderId: string) => CommandHandlerResult;
  destroyAgent: (agentId: string) => CommandHandlerResult;
  moveAgent: (id: string, x: number, y: number) => CommandHandlerResult;
  moveFolder: (id: string, x: number, y: number) => CommandHandlerResult;
  moveBrowser: (id: string, x: number, y: number) => CommandHandlerResult;
  moveTerminal: (id: string, x: number, y: number) => CommandHandlerResult;
  resizeBrowser: (id: string, width: number, height: number) => CommandHandlerResult;
  resizeTerminal: (id: string, width: number, height: number) => CommandHandlerResult;
  moveHero: (x: number, y: number) => CommandHandlerResult;
  setAgentModel: (agentId: string, model: string) => CommandHandlerResult;
  setAgentReasoningEffort: (agentId: string, reasoningEffort: string | null) => CommandHandlerResult;
  providerStatus: (provider: AgentProvider, options?: { force?: boolean }) => CommandHandlerResult;
  providerInstall: (provider: AgentProvider) => CommandHandlerResult;
  providersBootstrap: () => CommandHandlerResult;
  providersRefresh: (options?: { force?: boolean }) => CommandHandlerResult;
  setHeroProvider: (provider: AgentProvider) => CommandHandlerResult;
  setHeroModel: (model: string) => CommandHandlerResult;
  agentSendPrompt: (
    agentId: string,
    prompt: string,
    relativePath: string,
    runId?: string,
    resumeSessionId?: string | null
  ) => CommandHandlerResult;
  heroSendPrompt: (prompt: string, relativePath: string, runId?: string) => CommandHandlerResult;
  cancelAgentRun: (agentId: string) => CommandHandlerResult;
  cancelHeroRun: () => CommandHandlerResult;
};

export type CommandDefinition = {
  id: CommandId;
  title: string;
  icon?: string;
  isAvailable?: (context: CommandContext, args?: CommandArgs) => boolean;
  handler: (
    context: CommandContext,
    handlers: CommandHandlers,
    args?: CommandArgs,
    invocation?: CommandInvocation
  ) => Promise<CommandRunResult | void> | CommandRunResult | void;
};

export type CommandRegistry = {
  list: () => CommandDefinition[];
  getCommand: (id: CommandId) => CommandDefinition | undefined;
  isAvailable: (id: CommandId, context: CommandContext, args?: CommandArgs) => boolean;
  run: (command: CommandInvocation, context: CommandContext) => Promise<CommandRunResult>;
  runBatch: (batch: CommandBatchItem[], context: CommandContext) => Promise<CommandBatchResult[]>;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const hasMovePoint = (args: CommandArgs | undefined): args is { x: number; y: number } => {
  if (!args || typeof args !== 'object') return false;
  const candidate = args as { x?: unknown; y?: unknown };
  return isFiniteNumber(candidate.x) && isFiniteNumber(candidate.y);
};

const hasResizeSize = (args: CommandArgs | undefined): boolean => {
  if (!args || typeof args !== 'object') return false;
  const candidate = args as { width?: unknown; height?: unknown };
  return isFiniteNumber(candidate.width) && isFiniteNumber(candidate.height);
};

const getIdFromArgs = (args: CommandArgs | undefined, key: string): string | undefined => {
  if (!args || typeof args !== 'object') return undefined;
  const value = (args as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

const getStringFromArgs = (args: CommandArgs | undefined, key: string): string | undefined => {
  if (!args || typeof args !== 'object') return undefined;
  const value = (args as Record<string, unknown>)[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const getNullableStringFromArgs = (args: CommandArgs | undefined, key: string): string | null | undefined => {
  if (!args || typeof args !== 'object') return undefined;
  const value = (args as Record<string, unknown>)[key];
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const getProviderFromArgs = (args: CommandArgs | undefined): AgentProvider | undefined => {
  const value = getStringFromArgs(args, 'provider');
  if (!value) return undefined;
  if (isSupportedAgentProvider(value)) return value;
  return undefined;
};

const getOptionalNumberFromArgs = (args: CommandArgs | undefined, key: string): number | undefined => {
  if (!args || typeof args !== 'object') return undefined;
  const value = (args as Record<string, unknown>)[key];
  return isFiniteNumber(value) ? value : undefined;
};

const getOptionalBooleanFromArgs = (args: CommandArgs | undefined, key: string): boolean | undefined => {
  if (!args || typeof args !== 'object') return undefined;
  const value = (args as Record<string, unknown>)[key];
  return typeof value === 'boolean' ? value : undefined;
};

const getPlacementFromArgs = (
  args: CommandArgs | undefined
): { x: number; y: number } | { error: string } => {
  const x = getOptionalNumberFromArgs(args, 'x');
  const y = getOptionalNumberFromArgs(args, 'y');
  if (x === undefined || y === undefined) {
    return { error: 'Both x and y are required' };
  }
  return { x, y };
};

const getSizeFromArgs = (
  args: CommandArgs | undefined
): { width: number; height: number } | { error: string } => {
  const width = getOptionalNumberFromArgs(args, 'width');
  const height = getOptionalNumberFromArgs(args, 'height');
  if (width === undefined || height === undefined) {
    return { error: 'width and height required' };
  }
  return { width, height };
};

const getEntityTypeFromArgs = (args: CommandArgs | undefined): EntityType | undefined => {
  if (!args || typeof args !== 'object') return undefined;
  const value = (args as Record<string, unknown>).entityType;
  return value === 'agent' ||
    value === 'folder' ||
    value === 'browser' ||
    value === 'terminal' ||
    value === 'hero'
    ? value
    : undefined;
};

const getOptionalStringFromArgs = (args: CommandArgs | undefined, key: string): string | undefined => {
  if (!args || typeof args !== 'object') return undefined;
  const value = (args as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
};

const commandDefinitions: CommandDefinition[] = [
  {
    id: 'create-agent-claude',
    title: 'Create Claude Agent',
    icon: providerIcons.claude,
    handler: (context, handlers, args) => {
      void context;
      const placement = getPlacementFromArgs(args);
      if ('error' in placement) {
        return { ok: false, error: placement.error };
      }
      return handlers.createAgent(
        'claude',
        placement.x,
        placement.y,
        getOptionalStringFromArgs(args, 'attachedFolderId')
      );
    },
  },
  {
    id: 'create-agent-codex',
    title: 'Create Codex Agent',
    icon: providerIcons.codex,
    handler: (context, handlers, args) => {
      void context;
      const placement = getPlacementFromArgs(args);
      if ('error' in placement) {
        return { ok: false, error: placement.error };
      }
      return handlers.createAgent(
        'codex',
        placement.x,
        placement.y,
        getOptionalStringFromArgs(args, 'attachedFolderId')
      );
    },
  },
  {
    id: 'create-folder',
    title: 'Create Folder',
    icon: entityIcons.folder,
    handler: (context, handlers, args, invocation) => {
      void context;
      void invocation;
      const name = getStringFromArgs(args, 'name');
      if (!name) {
        return { ok: false, error: 'Folder name required' };
      }
      const placement = getPlacementFromArgs(args);
      if ('error' in placement) {
        return { ok: false, error: placement.error };
      }
      return handlers.createFolder(name, placement.x, placement.y);
    },
  },
  {
    id: 'create-terminal',
    title: 'Create Terminal',
    icon: entityIcons.terminal,
    handler: (context, handlers, args) => {
      const rawPath = getStringFromArgs(args, 'path');
      if (!rawPath) {
        return { ok: false, error: 'path required' };
      }
      const placement = getPlacementFromArgs(args);
      if ('error' in placement) {
        return { ok: false, error: placement.error };
      }
      const resolvedPath = normalizeWorkspaceRelativePath(rawPath);
      const originFolder =
        resolvedPath === '.'
          ? undefined
          : context.folders.find((folder) => folder.relativePath === resolvedPath);
      const originFolderId = getIdFromArgs(args, 'originFolderId') ?? originFolder?.id;
      return handlers.createTerminal(
        originFolder?.relativePath ?? resolvedPath,
        placement.x,
        placement.y,
        originFolderId
      );
    },
  },
  {
    id: 'create-browser',
    title: 'Create Browser',
    icon: entityIcons.browser,
    handler: (context, handlers, args) => {
      void context;
      const placement = getPlacementFromArgs(args);
      if ('error' in placement) {
        return { ok: false, error: placement.error };
      }
      const originFolderId = getIdFromArgs(args, 'originFolderId');
      return handlers.createBrowser(placement.x, placement.y, originFolderId);
    },
  },
  {
    id: 'move-entity',
    title: 'Move Entity',
    handler: (context, handlers, args) => {
      const placement = getPlacementFromArgs(args);
      if ('error' in placement) {
        return { ok: false, error: placement.error };
      }
      const entityType = getEntityTypeFromArgs(args);
      if (!entityType) return { ok: false, error: 'entityType is required' };
      if (entityType === 'hero') {
        const point = resolveMovePosition(placement, 'hero');
        return handlers.moveHero(point.x, point.y);
      }
      const entityId = getIdFromArgs(args, 'id');
      if (!entityId) return { ok: false, error: 'Entity id required' };
      const exists =
        entityType === 'agent'
          ? context.agents.some((agent) => agent.id === entityId)
          : entityType === 'folder'
            ? context.folders.some((folder) => folder.id === entityId)
            : entityType === 'browser'
              ? context.browsers.some((browser) => browser.id === entityId)
              : context.terminals.some((terminal) => terminal.id === entityId);
      if (!exists) return { ok: false, error: 'Entity not found' };
      const point = resolveMovePosition(placement, entityType);
      if (entityType === 'agent') return handlers.moveAgent(entityId, point.x, point.y);
      if (entityType === 'folder') return handlers.moveFolder(entityId, point.x, point.y);
      if (entityType === 'browser') return handlers.moveBrowser(entityId, point.x, point.y);
      return handlers.moveTerminal(entityId, point.x, point.y);
    },
  },
  {
    id: 'move-agent',
    title: 'Move Agent',
    isAvailable: (_context, args) => !!getIdFromArgs(args, 'agentId') && hasMovePoint(args),
    handler: (context, handlers, args) => {
      const placement = getPlacementFromArgs(args);
      if ('error' in placement) {
        return { ok: false, error: placement.error };
      }
      const agentId = getIdFromArgs(args, 'agentId');
      if (!agentId) {
        return { ok: false, error: 'agentId required' };
      }
      if (!context.agents.some((agent) => agent.id === agentId)) {
        return { ok: false, error: 'Agent not found' };
      }
      const point = resolveMovePosition(placement, 'agent');
      return handlers.moveAgent(agentId, point.x, point.y);
    },
  },
  {
    id: 'move-folder',
    title: 'Move Folder',
    isAvailable: (_context, args) => !!getIdFromArgs(args, 'folderId') && hasMovePoint(args),
    handler: (context, handlers, args) => {
      const placement = getPlacementFromArgs(args);
      if ('error' in placement) {
        return { ok: false, error: placement.error };
      }
      const folderId = getIdFromArgs(args, 'folderId');
      if (!folderId) {
        return { ok: false, error: 'folderId required' };
      }
      if (!context.folders.some((folder) => folder.id === folderId)) {
        return { ok: false, error: 'Folder not found' };
      }
      const point = resolveMovePosition(placement, 'folder');
      return handlers.moveFolder(folderId, point.x, point.y);
    },
  },
  {
    id: 'move-browser',
    title: 'Move Browser',
    isAvailable: (_context, args) => !!getIdFromArgs(args, 'browserId') && hasMovePoint(args),
    handler: (context, handlers, args) => {
      const placement = getPlacementFromArgs(args);
      if ('error' in placement) {
        return { ok: false, error: placement.error };
      }
      const browserId = getIdFromArgs(args, 'browserId');
      if (!browserId) {
        return { ok: false, error: 'browserId required' };
      }
      if (!context.browsers.some((browser) => browser.id === browserId)) {
        return { ok: false, error: 'Browser not found' };
      }
      const point = resolveMovePosition(placement, 'browser');
      return handlers.moveBrowser(browserId, point.x, point.y);
    },
  },
  {
    id: 'resize-browser',
    title: 'Resize Browser',
    isAvailable: (_context, args) => !!getIdFromArgs(args, 'browserId') && hasResizeSize(args),
    handler: (context, handlers, args) => {
      const sizeArgs = getSizeFromArgs(args);
      if ('error' in sizeArgs) {
        return { ok: false, error: sizeArgs.error };
      }
      const browserId = getIdFromArgs(args, 'browserId');
      if (!browserId) {
        return { ok: false, error: 'browserId required' };
      }
      if (!context.browsers.some((browser) => browser.id === browserId)) {
        return { ok: false, error: 'Browser not found' };
      }
      const size = resolveResize(sizeArgs, 'browser');
      return handlers.resizeBrowser(browserId, size.width, size.height);
    },
  },
  {
    id: 'move-terminal',
    title: 'Move Terminal',
    isAvailable: (_context, args) => {
      const terminalId = getIdFromArgs(args, 'terminalId');
      return !!terminalId && hasMovePoint(args);
    },
    handler: (context, handlers, args) => {
      const placement = getPlacementFromArgs(args);
      if ('error' in placement) {
        return { ok: false, error: placement.error };
      }
      const terminalId = getIdFromArgs(args, 'terminalId');
      if (!terminalId) return { ok: false, error: 'terminalId required' };
      if (!context.terminals.some((terminal) => terminal.id === terminalId)) {
        return { ok: false, error: 'Terminal not found' };
      }
      const point = resolveMovePosition(placement, 'terminal');
      return handlers.moveTerminal(terminalId, point.x, point.y);
    },
  },
  {
    id: 'resize-terminal',
    title: 'Resize Terminal',
    isAvailable: (_context, args) => {
      const terminalId = getIdFromArgs(args, 'terminalId');
      return !!terminalId && hasResizeSize(args);
    },
    handler: (context, handlers, args) => {
      const sizeArgs = getSizeFromArgs(args);
      if ('error' in sizeArgs) {
        return { ok: false, error: sizeArgs.error };
      }
      const terminalId = getIdFromArgs(args, 'terminalId');
      if (!terminalId) return { ok: false, error: 'terminalId required' };
      if (!context.terminals.some((terminal) => terminal.id === terminalId)) {
        return { ok: false, error: 'Terminal not found' };
      }
      const size = resolveResize(sizeArgs, 'terminal');
      return handlers.resizeTerminal(terminalId, size.width, size.height);
    },
  },
  {
    id: 'move-hero',
    title: 'Move Hero',
    isAvailable: (_context, args) => hasMovePoint(args),
    handler: (_context, handlers, args) => {
      if (!hasMovePoint(args)) return;
      const point = resolveMovePosition({ x: args.x, y: args.y }, 'hero');
      return handlers.moveHero(point.x, point.y);
    },
  },
  {
    id: 'open-agent-terminal',
    title: 'Open Agent Terminal',
    icon: '⌨️',
    isAvailable: (_context, args) => !!getIdFromArgs(args, 'agentId'),
    handler: (context, handlers, args) => {
      const agentId = getIdFromArgs(args, 'agentId');
      if (!agentId) {
        return { ok: false, error: 'agentId required' };
      }
      if (!context.agents.some((agent) => agent.id === agentId)) {
        return { ok: false, error: 'Agent not found' };
      }
      return handlers.openAgentTerminal(agentId);
    },
  },
  {
    id: 'refresh-browser',
    title: 'Refresh Browser',
    icon: '🔄',
    isAvailable: (_context, args) => !!getIdFromArgs(args, 'browserId'),
    handler: (context, handlers, args) => {
      const browserId = getIdFromArgs(args, 'browserId');
      if (!browserId) {
        return { ok: false, error: 'browserId required' };
      }
      if (!context.browsers.some((browser) => browser.id === browserId)) {
        return { ok: false, error: 'Browser not found' };
      }
      return handlers.refreshBrowser(browserId);
    },
  },
  {
    id: 'clear-history',
    title: 'Clear History',
    icon: '♻️',
    isAvailable: (_context, args) => !!getIdFromArgs(args, 'agentId'),
    handler: (context, handlers, args) => {
      const agentId = getIdFromArgs(args, 'agentId');
      if (!agentId) {
        return { ok: false, error: 'agentId required' };
      }
      if (!context.agents.some((agent) => agent.id === agentId)) {
        return { ok: false, error: 'Agent not found' };
      }
      return handlers.clearAgentTerminalState(agentId);
    },
  },
  {
    id: 'attach-folder',
    title: 'Attach To Project',
    icon: '🔗',
    isAvailable: (_context, args) => {
      const agentId = getIdFromArgs(args, 'agentId');
      const folderId = getIdFromArgs(args, 'folderId');
      return !!agentId && !!folderId;
    },
    handler: (context, handlers, args) => {
      const agentId = getIdFromArgs(args, 'agentId');
      const folderId = getIdFromArgs(args, 'folderId');
      if (!agentId || !folderId) {
        return { ok: false, error: 'agentId and folderId required' };
      }
      if (!context.agents.some((agent) => agent.id === agentId)) {
        return { ok: false, error: 'Agent not found' };
      }
      if (!context.folders.some((folder) => folder.id === folderId)) {
        return { ok: false, error: 'Folder not found' };
      }
      return handlers.attachAgentToFolder(agentId, folderId);
    },
  },
  {
    id: 'detach-agent',
    title: 'Detach',
    icon: '⛓️‍💥',
    isAvailable: (_context, args) => !!getIdFromArgs(args, 'agentId'),
    handler: (context, handlers, args) => {
      const agentId = getIdFromArgs(args, 'agentId');
      if (!agentId) {
        return { ok: false, error: 'agentId required' };
      }
      if (!context.agents.some((agent) => agent.id === agentId)) {
        return { ok: false, error: 'Agent not found' };
      }
      return handlers.detachAgent(agentId);
    },
  },
  {
    id: 'delete-browser',
    title: 'Close Browser',
    icon: '🗑️',
    isAvailable: (_context, args) => !!getIdFromArgs(args, 'browserId'),
    handler: (context, handlers, args) => {
      const browserId = getIdFromArgs(args, 'browserId');
      if (!browserId) {
        return { ok: false, error: 'browserId required' };
      }
      if (!context.browsers.some((browser) => browser.id === browserId)) {
        return { ok: false, error: 'Browser not found' };
      }
      return handlers.closeBrowser(browserId);
    },
  },
  {
    id: 'delete-terminal',
    title: 'Close Terminal',
    icon: '🗑️',
    isAvailable: (_context, args) => !!getIdFromArgs(args, 'terminalId'),
    handler: (context, handlers, args) => {
      const terminalId = getIdFromArgs(args, 'terminalId');
      if (!terminalId) return { ok: false, error: 'terminalId required' };
      if (!context.terminals.some((terminal) => terminal.id === terminalId)) {
        return { ok: false, error: 'Terminal not found' };
      }
      return handlers.closeTerminal(terminalId);
    },
  },
  {
    id: 'rename-folder',
    title: 'Rename Folder',
    icon: '✏️',
    isAvailable: (_context, args) => !!getIdFromArgs(args, 'folderId') && !!getStringFromArgs(args, 'name'),
    handler: (context, handlers, args) => {
      const folderId = getIdFromArgs(args, 'folderId');
      const name = getStringFromArgs(args, 'name');
      if (!folderId || !name) {
        return { ok: false, error: 'folderId and name required' };
      }
      const folder = context.folders.find((entry) => entry.id === folderId);
      if (!folder) return { ok: false, error: 'Folder not found' };
      return handlers.renameFolder(folderId, name);
    },
  },
  {
    id: 'remove-folder',
    title: 'Remove Folder',
    icon: '🚫',
    isAvailable: (_context, args) => !!getIdFromArgs(args, 'folderId'),
    handler: (context, handlers, args) => {
      const folderId = getIdFromArgs(args, 'folderId');
      if (!folderId) return { ok: false, error: 'folderId required' };
      const folder = context.folders.find((entry) => entry.id === folderId);
      if (!folder) return { ok: false, error: 'Folder not found' };
      return handlers.removeFolder(folderId);
    },
  },
  {
    id: 'delete-folder',
    title: 'Delete Folder',
    icon: '🗑️',
    isAvailable: (_context, args) => !!getIdFromArgs(args, 'folderId'),
    handler: (context, handlers, args, invocation) => {
      const folderId = getIdFromArgs(args, 'folderId');
      if (!folderId) return { ok: false, error: 'folderId required' };
      const folder = context.folders.find((entry) => entry.id === folderId);
      if (!folder) return { ok: false, error: 'Folder not found' };
      if (invocation?.source === 'mcp') {
        if (requiresConfirm(invocation)) return { ok: false, error: 'Confirmation required' };
        return handlers.deleteFolder(folderId, { skipConfirm: true });
      }
      return handlers.deleteFolder(folderId);
    },
  },
  {
    id: 'create-worktree',
    title: 'Create Worktree',
    icon: '🌱',
    isAvailable: (_context, args) => !!getIdFromArgs(args, 'folderId') && hasMovePoint(args),
    handler: (context, handlers, args) => {
      const placement = getPlacementFromArgs(args);
      if ('error' in placement) {
        return { ok: false, error: placement.error };
      }
      const folderId = getIdFromArgs(args, 'folderId');
      if (!folderId) return { ok: false, error: 'folderId required' };
      const folder = context.folders.find((entry) => entry.id === folderId);
      if (!folder) return { ok: false, error: 'Folder not found' };
      if (folder.isWorktree) return { ok: false, error: 'Folder is already a worktree' };
      return handlers.createWorktree(folderId, placement.x, placement.y);
    },
  },
  {
    id: 'worktree-sync',
    title: 'Sync Worktree',
    icon: '⤵️',
    isAvailable: (_context, args) => !!getIdFromArgs(args, 'folderId'),
    handler: (context, handlers, args) => {
      const folderId = getIdFromArgs(args, 'folderId');
      if (!folderId) return { ok: false, error: 'folderId required' };
      const folder = context.folders.find((entry) => entry.id === folderId);
      if (!folder) return { ok: false, error: 'Folder not found' };
      if (!folder.isWorktree) return { ok: false, error: 'Folder is not a worktree' };
      return handlers.worktreeSync(folderId);
    },
  },
  {
    id: 'worktree-merge',
    title: 'Merge Worktree',
    icon: '⤴️',
    isAvailable: (_context, args) => !!getIdFromArgs(args, 'folderId'),
    handler: (context, handlers, args, invocation) => {
      const folderId = getIdFromArgs(args, 'folderId');
      if (!folderId) return { ok: false, error: 'folderId required' };
      const folder = context.folders.find((entry) => entry.id === folderId);
      if (!folder) return { ok: false, error: 'Folder not found' };
      if (!folder.isWorktree) return { ok: false, error: 'Folder is not a worktree' };
      if (invocation?.source === 'mcp' && requiresConfirm(invocation)) {
        return { ok: false, error: 'Confirmation required' };
      }
      return handlers.worktreeMerge(folderId);
    },
  },
  {
    id: 'undo-merge',
    title: 'Undo Merge',
    icon: '↩️',
    isAvailable: (_context, args) => !!getIdFromArgs(args, 'folderId'),
    handler: (context, handlers, args) => {
      const folderId = getIdFromArgs(args, 'folderId');
      if (!folderId) return { ok: false, error: 'folderId required' };
      const folder = context.folders.find((entry) => entry.id === folderId);
      if (!folder) return { ok: false, error: 'Folder not found' };
      if (folder.conflictState?.kind !== 'merge') {
        return { ok: false, error: 'No merge conflict to undo' };
      }
      return handlers.undoMerge(folderId);
    },
  },
  {
    id: 'retry-restore',
    title: 'Retry Restore',
    icon: '🔁',
    isAvailable: (_context, args) => !!getIdFromArgs(args, 'folderId'),
    handler: (context, handlers, args) => {
      const folderId = getIdFromArgs(args, 'folderId');
      if (!folderId) return { ok: false, error: 'folderId required' };
      const folder = context.folders.find((entry) => entry.id === folderId);
      if (!folder) return { ok: false, error: 'Folder not found' };
      if (folder.conflictState?.kind !== 'restore') {
        return { ok: false, error: 'No restore to retry' };
      }
      return handlers.retryRestore(folderId);
    },
  },
  {
    id: 'destroy-agent',
    title: 'Destroy Agent',
    icon: '🗑️',
    isAvailable: (_context, args) => !!getIdFromArgs(args, 'agentId'),
    handler: (context, handlers, args, invocation) => {
      const agentId = getIdFromArgs(args, 'agentId');
      if (!agentId) {
        return { ok: false, error: 'agentId required' };
      }
      const agent = context.agents.find((entry) => entry.id === agentId);
      if (!agent) return { ok: false, error: 'Agent not found' };
      if (invocation?.source === 'mcp' && requiresConfirm(invocation)) {
        return { ok: false, error: 'Confirmation required' };
      }
      return handlers.destroyAgent(agentId);
    },
  },
  {
    id: 'set-agent-model',
    title: 'Set Agent Model',
    isAvailable: (_context, args) => !!getIdFromArgs(args, 'agentId') && !!getStringFromArgs(args, 'model'),
    handler: (context, handlers, args) => {
      const agentId = getIdFromArgs(args, 'agentId');
      const model = getStringFromArgs(args, 'model');
      if (!agentId || !model) {
        return { ok: false, error: 'agentId and model required' };
      }
      if (!context.agents.some((agent) => agent.id === agentId)) {
        return { ok: false, error: 'Agent not found' };
      }
      return handlers.setAgentModel(agentId, model);
    },
  },
  {
    id: 'set-agent-reasoning-effort',
    title: 'Set Agent Reasoning Effort',
    isAvailable: (_context, args) => {
      const agentId = getIdFromArgs(args, 'agentId');
      const reasoningEffort = getNullableStringFromArgs(args, 'reasoningEffort');
      return !!agentId && reasoningEffort !== undefined;
    },
    handler: (context, handlers, args) => {
      const agentId = getIdFromArgs(args, 'agentId');
      const reasoningEffort = getNullableStringFromArgs(args, 'reasoningEffort');
      if (!agentId || reasoningEffort === undefined) {
        return { ok: false, error: 'agentId and reasoningEffort required' };
      }
      if (!context.agents.some((agent) => agent.id === agentId)) {
        return { ok: false, error: 'Agent not found' };
      }
      return handlers.setAgentReasoningEffort(agentId, reasoningEffort);
    },
  },
  {
    id: 'provider-status',
    title: 'Provider Status',
    isAvailable: (_context, args) => !!getProviderFromArgs(args),
    handler: (_context, handlers, args) => {
      const provider = getProviderFromArgs(args);
      if (!provider) return { ok: false, error: 'provider required' };
      const force =
        typeof (args as Record<string, unknown> | undefined)?.force === 'boolean'
          ? ((args as Record<string, unknown>).force as boolean)
          : undefined;
      return handlers.providerStatus(provider, force === undefined ? undefined : { force });
    },
  },
  {
    id: 'provider-install',
    title: 'Provider Install',
    isAvailable: (_context, args) => !!getProviderFromArgs(args),
    handler: (_context, handlers, args) => {
      const provider = getProviderFromArgs(args);
      if (!provider) return { ok: false, error: 'provider required' };
      return handlers.providerInstall(provider);
    },
  },
  {
    id: 'providers-bootstrap',
    title: 'Providers Bootstrap',
    handler: (_context, handlers) => handlers.providersBootstrap(),
  },
  {
    id: 'providers-refresh',
    title: 'Providers Refresh',
    handler: (_context, handlers, args) => {
      const force = getOptionalBooleanFromArgs(args, 'force');
      return handlers.providersRefresh(force === undefined ? undefined : { force });
    },
  },
  {
    id: 'set-hero-provider',
    title: 'Set Hero Provider',
    isAvailable: (_context, args) => !!getProviderFromArgs(args),
    handler: (_context, handlers, args) => {
      const provider = getProviderFromArgs(args);
      if (!provider) return { ok: false, error: 'provider required' };
      return handlers.setHeroProvider(provider);
    },
  },
  {
    id: 'set-hero-model',
    title: 'Set Hero Model',
    isAvailable: (_context, args) => !!getStringFromArgs(args, 'model'),
    handler: (_context, handlers, args) => {
      const model = getStringFromArgs(args, 'model');
      if (!model) return { ok: false, error: 'model required' };
      return handlers.setHeroModel(model);
    },
  },
  {
    id: 'agent-send-prompt',
    title: 'Agent Send Prompt',
    isAvailable: (context, args) => {
      const agentId = getIdFromArgs(args, 'agentId');
      const prompt = getStringFromArgs(args, 'prompt');
      if (!agentId || !prompt) return false;
      return context.agents.some((agent) => agent.id === agentId);
    },
    handler: (context, handlers, args, invocation) => {
      const agentId = getIdFromArgs(args, 'agentId');
      const prompt = getStringFromArgs(args, 'prompt');
      const relativePath = getStringFromArgs(args, 'relativePath');
      if (!agentId || !prompt) {
        return { ok: false, error: 'agentId and prompt required' };
      }
      const agent = context.agents.find((entry) => entry.id === agentId);
      if (!agent) {
        return { ok: false, error: 'Agent not found' };
      }
      let effectivePath: string | undefined;
      if (invocation?.source === 'mcp') {
        if (!agent.attachedFolderId) {
          return {
            ok: false,
            error: 'Agent must be attached to a folder before using agent-send-prompt via MCP',
          };
        }
        const attachedFolder = context.folders.find((folder) => folder.id === agent.attachedFolderId);
        if (!attachedFolder) {
          return { ok: false, error: 'Attached folder not found for agent' };
        }
        effectivePath = attachedFolder.relativePath;
      } else if (relativePath) {
        effectivePath = relativePath;
      } else if (agent.attachedFolderId) {
        const attachedFolder = context.folders.find((folder) => folder.id === agent.attachedFolderId);
        if (attachedFolder) {
          effectivePath = attachedFolder.relativePath;
        }
      }
      if (!effectivePath) {
        return { ok: false, error: 'relativePath required when agent is not attached to a folder' };
      }
      const runId = getStringFromArgs(args, 'runId');
      const resumeSessionId = getStringFromArgs(args, 'resumeSessionId');
      const normalizedPath = normalizeWorkspaceRelativePath(effectivePath);
      return handlers.agentSendPrompt(agentId, prompt, normalizedPath, runId, resumeSessionId);
    },
  },
  {
    id: 'hero-send-prompt',
    title: 'Hero Send Prompt',
    isAvailable: (_context, args) =>
      !!getStringFromArgs(args, 'prompt') && !!getStringFromArgs(args, 'relativePath'),
    handler: (_context, handlers, args) => {
      const prompt = getStringFromArgs(args, 'prompt');
      const relativePath = getStringFromArgs(args, 'relativePath');
      if (!prompt || !relativePath) {
        return { ok: false, error: 'prompt and relativePath required' };
      }
      const runId = getStringFromArgs(args, 'runId');
      const normalizedPath = normalizeWorkspaceRelativePath(relativePath);
      return handlers.heroSendPrompt(prompt, normalizedPath, runId);
    },
  },
  {
    id: 'cancel-agent-run',
    title: 'Cancel Agent Run',
    isAvailable: (_context, args) => !!getIdFromArgs(args, 'agentId'),
    handler: (_context, handlers, args) => {
      const agentId = getIdFromArgs(args, 'agentId');
      if (!agentId) return { ok: false, error: 'agentId required' };
      return handlers.cancelAgentRun(agentId);
    },
  },
  {
    id: 'cancel-hero-run',
    title: 'Cancel Hero Run',
    handler: (_context, handlers) => handlers.cancelHeroRun(),
  },
];

const commandMap = new Map<CommandId, CommandDefinition>(
  commandDefinitions.map((definition) => [definition.id, definition])
);

export function getCommand(id: CommandId): CommandDefinition | undefined {
  return commandMap.get(id);
}

export function isCommandAvailable(id: CommandId, context: CommandContext, args?: CommandArgs): boolean {
  const command = commandMap.get(id);
  if (!command) return false;
  return command.isAvailable ? command.isAvailable(context, args) : true;
}

const requiresConfirm = (invocation?: CommandInvocation): boolean =>
  invocation?.source === 'mcp' && invocation.confirm !== true;

const cloneContextForBatch = (context: CommandContext): CommandContext => ({
  ...context,
  agents: context.agents.map((agent) => ({ ...agent })),
  folders: [...context.folders],
  browsers: [...context.browsers],
  terminals: [...context.terminals],
});

const applyBatchProjection = (
  context: CommandContext,
  invocation: CommandInvocation,
  result: CommandRunResult
): void => {
  if (!result.ok) return;
  if (invocation.id === 'attach-folder') {
    const agentId = getIdFromArgs(invocation.args, 'agentId');
    const folderId = getIdFromArgs(invocation.args, 'folderId');
    if (!agentId || !folderId) return;
    const agent = context.agents.find((entry) => entry.id === agentId);
    const folderExists = context.folders.some((folder) => folder.id === folderId);
    if (!agent || !folderExists) return;
    agent.attachedFolderId = folderId;
    agent.status = 'online';
    return;
  }
  if (invocation.id === 'detach-agent') {
    const agentId = getIdFromArgs(invocation.args, 'agentId');
    if (!agentId) return;
    const agent = context.agents.find((entry) => entry.id === agentId);
    if (!agent) return;
    agent.attachedFolderId = undefined;
    agent.status = 'offline';
    return;
  }
  if (invocation.id === 'destroy-agent') {
    const agentId = getIdFromArgs(invocation.args, 'agentId');
    if (!agentId) return;
    context.agents = context.agents.filter((entry) => entry.id !== agentId);
  }
};

export async function runCommand(
  invocation: CommandInvocation,
  context: CommandContext,
  handlers: CommandHandlers
): Promise<CommandRunResult> {
  const command = commandMap.get(invocation.id);
  if (!command) {
    return { ok: false, error: 'Unknown command' };
  }
  if (command.isAvailable && invocation.source !== 'mcp' && !command.isAvailable(context, invocation.args)) {
    return { ok: false, error: 'Command not available' };
  }
  try {
    const result = await command.handler(context, handlers, invocation.args, invocation);
    if (result && typeof result === 'object' && 'ok' in result) {
      return result as CommandRunResult;
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

export async function runCommandBatch(
  batch: CommandBatchItem[],
  context: CommandContext,
  handlers: CommandHandlers
): Promise<CommandBatchResult[]> {
  const results: CommandBatchResult[] = [];
  const projectedContext = cloneContextForBatch(context);
  for (const item of batch) {
    const result = await runCommand(item, projectedContext, handlers);
    results.push({ id: item.id, ok: result.ok, error: result.error });
    applyBatchProjection(projectedContext, item, result);
  }
  return results;
}

export function createCommandRegistry(handlers: CommandHandlers): CommandRegistry {
  return {
    list: () => commandDefinitions,
    getCommand,
    isAvailable: (id, context, args) => isCommandAvailable(id, context, args),
    run: (command, context) => runCommand(command, context, handlers),
    runBatch: (batch, context) => runCommandBatch(batch, context, handlers),
  };
}

export { commandDefinitions };
export type {
  CommandArgs,
  CommandBatchItem,
  CommandBatchResult,
  CommandId,
  CommandInvocation,
  CommandRunResult,
  CommandRunRequest,
  CommandRunResponse,
} from '../../shared/commands';
