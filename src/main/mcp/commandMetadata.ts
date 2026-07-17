import type { CommandId } from '../../shared/commands';

export interface CommandMetadata {
  id: CommandId;
  title: string;
  description: string;
  category: 'agent' | 'folder' | 'browser' | 'terminal' | 'hero' | 'worktree' | 'generic';
  args: {
    [key: string]: {
      type: 'string' | 'number' | 'boolean' | 'object';
      required: boolean;
      description: string;
      default?: unknown;
    };
  };
  example: {
    id: CommandId;
    args?: Record<string, unknown>;
  };
}

export const COMMAND_METADATA: CommandMetadata[] = [
  // Agent Commands
  {
    id: 'create-agent-claude',
    title: 'Create Claude Agent',
    description: 'Spawn a new Claude AI agent in the workspace at a specific position',
    category: 'agent',
    args: {
      x: { type: 'number', required: true, description: 'X coordinate' },
      y: { type: 'number', required: true, description: 'Y coordinate' },
    },
    example: { id: 'create-agent-claude', args: { x: 400, y: 300 } },
  },
  {
    id: 'create-agent-codex',
    title: 'Create Codex Agent',
    description: 'Spawn a new ChatGPT Codex agent in the workspace at a specific position',
    category: 'agent',
    args: {
      x: { type: 'number', required: true, description: 'X coordinate' },
      y: { type: 'number', required: true, description: 'Y coordinate' },
    },
    example: { id: 'create-agent-codex', args: { x: 400, y: 300 } },
  },
  {
    id: 'create-agent-google',
    title: 'Create Gemini Agent',
    description: 'Spawn a new Google Gemini AI agent in the workspace at a specific position',
    category: 'agent',
    args: {
      x: { type: 'number', required: true, description: 'X coordinate' },
      y: { type: 'number', required: true, description: 'Y coordinate' },
    },
    example: { id: 'create-agent-google', args: { x: 400, y: 300 } },
  },
  {
    id: 'move-agent',
    title: 'Move Agent',
    description: 'Move an agent to a new position in the workspace',
    category: 'agent',
    args: {
      agentId: { type: 'string', required: true, description: 'Agent ID' },
      x: { type: 'number', required: true, description: 'Target X coordinate' },
      y: { type: 'number', required: true, description: 'Target Y coordinate' },
    },
    example: { id: 'move-agent', args: { agentId: 'agent-123', x: 500, y: 400 } },
  },
  {
    id: 'attach-folder',
    title: 'Attach Agent to Folder',
    description: 'Attach an agent to a project folder, enabling it to work within that context',
    category: 'agent',
    args: {
      agentId: { type: 'string', required: true, description: 'Agent ID to attach' },
      folderId: { type: 'string', required: true, description: 'Folder ID to attach to' },
    },
    example: { id: 'attach-folder', args: { agentId: 'agent-123', folderId: 'folder-456' } },
  },
  {
    id: 'detach-agent',
    title: 'Detach Agent from Folder',
    description: 'Detach an agent from its current project folder',
    category: 'agent',
    args: {
      agentId: { type: 'string', required: true, description: 'Agent ID' },
    },
    example: { id: 'detach-agent', args: { agentId: 'agent-123' } },
  },
  {
    id: 'open-agent-terminal',
    title: 'Open Agent Terminal',
    description: 'Open the terminal panel for an agent (agent must be attached to a folder)',
    category: 'agent',
    args: {
      agentId: { type: 'string', required: true, description: 'Agent ID' },
    },
    example: { id: 'open-agent-terminal', args: { agentId: 'agent-123' } },
  },
  {
    id: 'clear-history',
    title: 'Clear Agent Terminal History',
    description: 'Clear the terminal history for an agent',
    category: 'agent',
    args: {
      agentId: { type: 'string', required: true, description: 'Agent ID' },
    },
    example: { id: 'clear-history', args: { agentId: 'agent-123' } },
  },
  {
    id: 'destroy-agent',
    title: 'Destroy Agent',
    description: 'Permanently remove an agent from the workspace',
    category: 'agent',
    args: {
      agentId: { type: 'string', required: true, description: 'Agent ID' },
    },
    example: { id: 'destroy-agent', args: { agentId: 'agent-123' } },
  },
  {
    id: 'set-agent-model',
    title: 'Set Agent Model',
    description: 'Set the model used by an agent',
    category: 'agent',
    args: {
      agentId: { type: 'string', required: true, description: 'Agent ID' },
      model: { type: 'string', required: true, description: 'Model identifier' },
    },
    example: { id: 'set-agent-model', args: { agentId: 'agent-123', model: 'claude-sonnet-4-5' } },
  },
  {
    id: 'set-agent-reasoning-effort',
    title: 'Set Agent Reasoning Effort',
    description: 'Set or clear the reasoning effort level for an agent',
    category: 'agent',
    args: {
      agentId: { type: 'string', required: true, description: 'Agent ID' },
      reasoningEffort: {
        type: 'string',
        required: true,
        description: 'Reasoning effort value (or null to clear)',
      },
    },
    example: {
      id: 'set-agent-reasoning-effort',
      args: { agentId: 'agent-123', reasoningEffort: 'high' },
    },
  },
  {
    id: 'agent-send-prompt',
    title: 'Send Prompt to Agent',
    description:
      'Send a prompt to a specific agent. The execution folder is resolved from the agent attachment.',
    category: 'agent',
    args: {
      agentId: { type: 'string', required: true, description: 'Agent ID' },
      prompt: { type: 'string', required: true, description: 'Prompt text to send to the agent' },
      runId: { type: 'string', required: false, description: 'Optional run identifier' },
      resumeSessionId: { type: 'string', required: false, description: 'Optional session ID to resume' },
    },
    example: {
      id: 'agent-send-prompt',
      args: {
        agentId: 'agent-123',
        prompt: 'Implement a login form with validation',
      },
    },
  },
  {
    id: 'cancel-agent-run',
    title: 'Cancel Agent Run',
    description: 'Cancel the currently running task for a specific agent',
    category: 'agent',
    args: {
      agentId: { type: 'string', required: true, description: 'Agent ID' },
    },
    example: { id: 'cancel-agent-run', args: { agentId: 'agent-123' } },
  },

  // Folder Commands
  {
    id: 'create-folder',
    title: 'Create Folder',
    description: 'Create a new project folder in the workspace',
    category: 'folder',
    args: {
      name: { type: 'string', required: true, description: 'Folder name' },
      x: { type: 'number', required: true, description: 'X coordinate' },
      y: { type: 'number', required: true, description: 'Y coordinate' },
    },
    example: { id: 'create-folder', args: { name: 'my-project', x: 300, y: 200 } },
  },
  {
    id: 'move-folder',
    title: 'Move Folder',
    description: 'Move a folder to a new position in the workspace',
    category: 'folder',
    args: {
      folderId: { type: 'string', required: true, description: 'Folder ID' },
      x: { type: 'number', required: true, description: 'Target X coordinate' },
      y: { type: 'number', required: true, description: 'Target Y coordinate' },
    },
    example: { id: 'move-folder', args: { folderId: 'folder-456', x: 600, y: 300 } },
  },
  {
    id: 'rename-folder',
    title: 'Rename Folder',
    description: 'Rename a project folder',
    category: 'folder',
    args: {
      folderId: { type: 'string', required: true, description: 'Folder ID' },
      name: { type: 'string', required: true, description: 'New folder name' },
    },
    example: { id: 'rename-folder', args: { folderId: 'folder-456', name: 'new-name' } },
  },
  {
    id: 'remove-folder',
    title: 'Remove Folder from Workspace',
    description: 'Unlink a folder from the workspace without deleting files',
    category: 'folder',
    args: {
      folderId: { type: 'string', required: true, description: 'Folder ID' },
    },
    example: { id: 'remove-folder', args: { folderId: 'folder-456' } },
  },
  {
    id: 'delete-folder',
    title: 'Delete Folder',
    description: 'Permanently delete a folder and move to system trash',
    category: 'folder',
    args: {
      folderId: { type: 'string', required: true, description: 'Folder ID' },
    },
    example: { id: 'delete-folder', args: { folderId: 'folder-456' } },
  },

  // Worktree Commands
  {
    id: 'create-worktree',
    title: 'Create Git Worktree',
    description: 'Create a git worktree for a folder at a specific position',
    category: 'worktree',
    args: {
      folderId: { type: 'string', required: true, description: 'Folder ID' },
      x: { type: 'number', required: true, description: 'X coordinate for worktree folder' },
      y: { type: 'number', required: true, description: 'Y coordinate for worktree folder' },
    },
    example: { id: 'create-worktree', args: { folderId: 'folder-456', x: 700, y: 200 } },
  },
  {
    id: 'worktree-sync',
    title: 'Sync Worktree',
    description: 'Sync changes from worktree to main folder',
    category: 'worktree',
    args: {
      folderId: { type: 'string', required: true, description: 'Folder ID' },
    },
    example: { id: 'worktree-sync', args: { folderId: 'folder-456' } },
  },
  {
    id: 'worktree-merge',
    title: 'Merge Worktree',
    description: 'Merge worktree changes into source folder',
    category: 'worktree',
    args: {
      folderId: { type: 'string', required: true, description: 'Folder ID' },
    },
    example: { id: 'worktree-merge', args: { folderId: 'folder-456' } },
  },
  {
    id: 'undo-merge',
    title: 'Undo Worktree Merge',
    description: 'Undo the last worktree merge operation',
    category: 'worktree',
    args: {
      folderId: { type: 'string', required: true, description: 'Folder ID' },
    },
    example: { id: 'undo-merge', args: { folderId: 'folder-456' } },
  },
  {
    id: 'retry-restore',
    title: 'Retry Folder Restore',
    description: 'Retry restoring a folder after a failed operation',
    category: 'worktree',
    args: {
      folderId: { type: 'string', required: true, description: 'Folder ID' },
    },
    example: { id: 'retry-restore', args: { folderId: 'folder-456' } },
  },

  // Browser Commands
  {
    id: 'create-browser',
    title: 'Create Browser Panel',
    description: 'Create a new browser panel in the workspace',
    category: 'browser',
    args: {
      x: { type: 'number', required: true, description: 'X coordinate' },
      y: { type: 'number', required: true, description: 'Y coordinate' },
    },
    example: { id: 'create-browser', args: { x: 500, y: 200 } },
  },
  {
    id: 'move-browser',
    title: 'Move Browser Panel',
    description: 'Move a browser panel to a new position',
    category: 'browser',
    args: {
      browserId: { type: 'string', required: true, description: 'Browser ID' },
      x: { type: 'number', required: true, description: 'Target X coordinate' },
      y: { type: 'number', required: true, description: 'Target Y coordinate' },
    },
    example: { id: 'move-browser', args: { browserId: 'browser-789', x: 700, y: 400 } },
  },
  {
    id: 'resize-browser',
    title: 'Resize Browser Panel',
    description: 'Resize a browser panel',
    category: 'browser',
    args: {
      browserId: { type: 'string', required: true, description: 'Browser ID' },
      width: { type: 'number', required: true, description: 'New width in pixels' },
      height: { type: 'number', required: true, description: 'New height in pixels' },
    },
    example: { id: 'resize-browser', args: { browserId: 'browser-789', width: 1024, height: 768 } },
  },
  {
    id: 'refresh-browser',
    title: 'Refresh Browser',
    description: 'Refresh the page in a browser panel',
    category: 'browser',
    args: {
      browserId: { type: 'string', required: true, description: 'Browser ID' },
    },
    example: { id: 'refresh-browser', args: { browserId: 'browser-789' } },
  },
  {
    id: 'delete-browser',
    title: 'Close Browser Panel',
    description: 'Close and remove a browser panel',
    category: 'browser',
    args: {
      browserId: { type: 'string', required: true, description: 'Browser ID' },
    },
    example: { id: 'delete-browser', args: { browserId: 'browser-789' } },
  },

  // Terminal Commands
  {
    id: 'create-terminal',
    title: 'Create Terminal Panel',
    description: 'Create a new terminal panel at a specific path',
    category: 'terminal',
    args: {
      path: {
        type: 'string',
        required: true,
        description: 'Relative path within workspace for terminal working directory',
      },
      x: { type: 'number', required: true, description: 'X coordinate' },
      y: { type: 'number', required: true, description: 'Y coordinate' },
    },
    example: { id: 'create-terminal', args: { path: './src', x: 600, y: 500 } },
  },
  {
    id: 'move-terminal',
    title: 'Move Terminal Panel',
    description: 'Move a terminal panel to a new position',
    category: 'terminal',
    args: {
      terminalId: { type: 'string', required: true, description: 'Terminal ID' },
      x: { type: 'number', required: true, description: 'Target X coordinate' },
      y: { type: 'number', required: true, description: 'Target Y coordinate' },
    },
    example: { id: 'move-terminal', args: { terminalId: 'terminal-101', x: 800, y: 600 } },
  },
  {
    id: 'resize-terminal',
    title: 'Resize Terminal Panel',
    description: 'Resize a terminal panel',
    category: 'terminal',
    args: {
      terminalId: { type: 'string', required: true, description: 'Terminal ID' },
      width: { type: 'number', required: true, description: 'New width in pixels' },
      height: { type: 'number', required: true, description: 'New height in pixels' },
    },
    example: { id: 'resize-terminal', args: { terminalId: 'terminal-101', width: 800, height: 600 } },
  },
  {
    id: 'delete-terminal',
    title: 'Close Terminal Panel',
    description: 'Close and remove a terminal panel',
    category: 'terminal',
    args: {
      terminalId: { type: 'string', required: true, description: 'Terminal ID' },
    },
    example: { id: 'delete-terminal', args: { terminalId: 'terminal-101' } },
  },

  // Hero Commands
  {
    id: 'move-hero',
    title: 'Move Hero',
    description: 'Move the hero (player character) to a new position',
    category: 'hero',
    args: {
      x: { type: 'number', required: true, description: 'Target X coordinate' },
      y: { type: 'number', required: true, description: 'Target Y coordinate' },
    },
    example: { id: 'move-hero', args: { x: 400, y: 300 } },
  },
  {
    id: 'set-hero-provider',
    title: 'Set Hero Provider',
    description: 'Set the model provider used by the hero',
    category: 'hero',
    args: {
      provider: {
        type: 'string',
        required: true,
        description: 'Provider identifier (claude, codex, cursor)',
      },
    },
    example: { id: 'set-hero-provider', args: { provider: 'claude' } },
  },
  {
    id: 'set-hero-model',
    title: 'Set Hero Model',
    description: 'Set the model used by the hero',
    category: 'hero',
    args: {
      model: { type: 'string', required: true, description: 'Model identifier' },
    },
    example: { id: 'set-hero-model', args: { model: 'claude-sonnet-4-5' } },
  },
  {
    id: 'hero-send-prompt',
    title: 'Send Prompt to Hero',
    description: 'Send a prompt to the hero agent',
    category: 'hero',
    args: {
      prompt: { type: 'string', required: true, description: 'Prompt text for the hero' },
      relativePath: {
        type: 'string',
        required: true,
        description: 'Workspace-relative folder path for command execution context',
      },
      runId: { type: 'string', required: false, description: 'Optional run identifier' },
    },
    example: {
      id: 'hero-send-prompt',
      args: {
        prompt: 'Coordinate agents to implement authentication and tests',
        relativePath: '.',
      },
    },
  },
  {
    id: 'cancel-hero-run',
    title: 'Cancel Hero Run',
    description: 'Cancel the currently running hero task',
    category: 'hero',
    args: {},
    example: { id: 'cancel-hero-run', args: {} },
  },

  // Provider Commands
  {
    id: 'provider-status',
    title: 'Provider Status',
    description: 'Fetch provider status and optionally force a refresh',
    category: 'generic',
    args: {
      provider: {
        type: 'string',
        required: true,
        description: 'Provider identifier (claude, codex, cursor)',
      },
      force: { type: 'boolean', required: false, description: 'Force status refresh' },
    },
    example: { id: 'provider-status', args: { provider: 'claude', force: true } },
  },
  {
    id: 'provider-install',
    title: 'Provider Install',
    description: 'Install or initialize a provider',
    category: 'generic',
    args: {
      provider: {
        type: 'string',
        required: true,
        description: 'Provider identifier (claude, codex, cursor)',
      },
    },
    example: { id: 'provider-install', args: { provider: 'claude' } },
  },
  {
    id: 'providers-bootstrap',
    title: 'Providers Bootstrap',
    description: 'Bootstrap provider discovery and state',
    category: 'generic',
    args: {},
    example: { id: 'providers-bootstrap', args: {} },
  },
  {
    id: 'providers-refresh',
    title: 'Providers Refresh',
    description: 'Refresh provider availability and metadata',
    category: 'generic',
    args: {
      force: { type: 'boolean', required: false, description: 'Force provider refresh' },
    },
    example: { id: 'providers-refresh', args: { force: true } },
  },

  // Legacy/Composite Commands
  {
    id: 'move-entity',
    title: 'Move Entity (Generic)',
    description: 'Move any entity (agent, folder, browser, terminal, or hero) to a new position',
    category: 'generic',
    args: {
      entityType: {
        type: 'string',
        required: true,
        description: 'Type of entity (agent, folder, browser, terminal, hero)',
      },
      id: { type: 'string', required: false, description: 'Entity ID (required for non-hero entity types)' },
      x: { type: 'number', required: true, description: 'Target X coordinate' },
      y: { type: 'number', required: true, description: 'Target Y coordinate' },
    },
    example: { id: 'move-entity', args: { entityType: 'agent', id: 'agent-123', x: 500, y: 400 } },
  },
];

export const COMMAND_IDS = COMMAND_METADATA.map((cmd) => cmd.id);

export const COMMANDS_BY_CATEGORY = COMMAND_METADATA.reduce(
  (acc, cmd) => {
    if (!acc[cmd.category]) acc[cmd.category] = [];
    acc[cmd.category].push(cmd);
    return acc;
  },
  {} as Record<string, CommandMetadata[]>
);
