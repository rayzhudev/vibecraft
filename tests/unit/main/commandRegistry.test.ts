import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';

let userDataDir = '';
const tempRoots: string[] = [];

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataDir,
  },
  shell: {
    trashItem: async (target: string) => {
      await fs.promises.rm(target, { recursive: true, force: true });
    },
  },
}));

import { getWorkspaceStoragePath, storage } from '../../../src/main/services/storage';
import * as workspaceService from '../../../src/main/services/workspace';
import * as browserService from '../../../src/main/services/browser';
import { DEFAULT_BROWSER_SIZE, DEFAULT_BROWSER_URL } from '../../../src/shared/browserDefaults';
import { DEFAULT_HERO } from '../../../src/shared/heroDefaults';
import * as terminalPanels from '../../../src/main/services/terminalPanels';
import { processManager } from '../../../src/main/services/agents/processManager';
import { createCommandRegistry } from '../../../src/renderer/commands/registry';
import type {
  CommandBatchResult,
  CommandContext,
  CommandHandlers,
  CommandId,
  CommandInvocation,
} from '../../../src/renderer/commands/registry';
import type {
  Agent,
  AgentProvider,
  AnyFolder,
  BrowserPanel,
  Hero,
  TerminalPanel,
} from '../../../src/shared/types';

type WorkspaceState = {
  hero: CommandContext['hero'];
  agents: CommandContext['agents'];
  folders: AnyFolder[];
  browsers: CommandContext['browsers'];
  terminals: CommandContext['terminals'];
};

type Harness = {
  workspacePath: string;
  runCommand: (invocation: {
    id: CommandId;
    args?: Record<string, unknown>;
    source?: 'mcp';
    confirm?: boolean;
  }) => Promise<{ ok: boolean; error?: string }>;
  runBatch: (
    commands: Array<{
      id: CommandId;
      args?: Record<string, unknown>;
      source?: 'mcp';
      confirm?: boolean;
    }>
  ) => Promise<CommandBatchResult[]>;
  readState: () => WorkspaceState;
};

const AGENTS_FILE = 'agents.json';
const FOLDERS_FILE = 'folders.json';
const BROWSERS_FILE = 'browsers.json';
const TERMINALS_FILE = 'terminals.json';
const HERO_FILE = 'hero.json';
const AGENT_TERMINAL_HISTORY_DIR = 'agent-terminal-history';
const TERMINAL_HISTORY_DIR = 'terminal-history';

const workspaceMetaPath = (workspacePath: string, ...parts: string[]) =>
  path.join(getWorkspaceStoragePath(workspacePath), ...parts);

const readWorkspaceJson = <T>(workspacePath: string, fileName: string, fallback: T): T => {
  const filePath = workspaceMetaPath(workspacePath, fileName);
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
};

const readAgentsOnDisk = (workspacePath: string) =>
  readWorkspaceJson<Agent[]>(workspacePath, AGENTS_FILE, []);

const readFoldersOnDisk = (workspacePath: string) =>
  readWorkspaceJson<AnyFolder[]>(workspacePath, FOLDERS_FILE, []);

const readBrowsersOnDisk = (workspacePath: string) =>
  readWorkspaceJson<BrowserPanel[]>(workspacePath, BROWSERS_FILE, []);

const readTerminalsOnDisk = (workspacePath: string) =>
  readWorkspaceJson<TerminalPanel[]>(workspacePath, TERMINALS_FILE, []);

const readHeroOnDisk = (workspacePath: string) =>
  readWorkspaceJson<Hero>(workspacePath, HERO_FILE, DEFAULT_HERO);

const agentHistoryPath = (workspacePath: string, agentId: string) =>
  workspaceMetaPath(workspacePath, AGENT_TERMINAL_HISTORY_DIR, `${agentId}.json`);

const terminalHistoryPath = (workspacePath: string, terminalId: string) =>
  workspaceMetaPath(workspacePath, TERMINAL_HISTORY_DIR, `${terminalId}.txt`);

const okResult = () => ({ ok: true });
const errorResult = (error: string) => ({ ok: false, error });

const readState = (workspacePath: string): WorkspaceState => ({
  hero: storage.loadHero(workspacePath),
  agents: storage.loadAgents(workspacePath),
  folders: storage.loadFolders(workspacePath),
  browsers: storage.loadBrowserPanels(workspacePath),
  terminals: storage.loadTerminals(workspacePath),
});

const buildContext = (workspacePath: string): CommandContext => ({
  selectedEntity: null,
  hero: storage.loadHero(workspacePath),
  agents: storage.loadAgents(workspacePath),
  folders: storage.loadFolders(workspacePath) as CommandContext['folders'],
  browsers: storage.loadBrowserPanels(workspacePath),
  terminals: storage.loadTerminals(workspacePath),
});

const createAgentRecord = async (
  workspacePath: string,
  provider: AgentProvider,
  x: number,
  y: number
): Promise<Agent> => {
  const agents = storage.loadAgents(workspacePath);
  const baseName =
    provider === 'claude'
      ? 'Claude'
      : provider === 'codex'
        ? 'Codex'
        : provider === 'cursor'
          ? 'Cursor'
          : 'Agent';
  const displayName = `${baseName}-${agents.length + 1}`;
  const agent: Agent = {
    id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    provider,
    model: '',
    color: '#ff00ff',
    name: baseName,
    displayName,
    workspacePath,
    x,
    y,
    status: 'offline',
    contextLeft: 100,
    agentConnectSessionId: null,
    providerSessionId: null,
  };
  await processManager.spawnAgent(agent);
  agents.push(agent);
  storage.saveAgents(workspacePath, agents);
  return agent;
};

const createHandlers = (workspacePath: string): CommandHandlers => ({
  createAgent: async (provider, x, y) => {
    await createAgentRecord(workspacePath, provider, x, y);
    return okResult();
  },
  createFolder: (name, x, y) => {
    try {
      workspaceService.createFolder(workspacePath, name, x, y);
      return okResult();
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : 'Failed to create folder');
    }
  },
  createBrowser: (x, y) => {
    browserService.createBrowserPanel(
      workspacePath,
      DEFAULT_BROWSER_URL,
      x,
      y,
      DEFAULT_BROWSER_SIZE.width,
      DEFAULT_BROWSER_SIZE.height
    );
    return okResult();
  },
  createTerminal: (relativePath, x, y) => {
    const result = terminalPanels.createTerminalRecord(workspacePath, relativePath, x, y);
    return result.success ? okResult() : errorResult(result.error || 'Failed to create terminal');
  },
  openAgentTerminal: (agentId) => {
    const agents = storage.loadAgents(workspacePath);
    const agent = agents.find((entry) => entry.id === agentId);
    if (!agent) return errorResult('Agent not found');
    if (!agent.attachedFolderId) return errorResult('Agent not attached');
    return okResult();
  },
  refreshBrowser: (id) => {
    const browser = storage.loadBrowserPanels(workspacePath).find((entry) => entry.id === id);
    return browser ? okResult() : errorResult('Browser not found');
  },
  clearAgentTerminalState: (agentId) => {
    processManager.clearAgentTerminalState(agentId);
    return okResult();
  },
  attachAgentToFolder: (agentId, folderId) => {
    const agents = storage.loadAgents(workspacePath);
    const agent = agents.find((entry) => entry.id === agentId);
    if (!agent) return errorResult('Agent not found');
    agent.attachedFolderId = folderId;
    agent.status = 'online';
    storage.saveAgents(workspacePath, agents);
    processManager.updateAgent(agentId, { attachedFolderId: folderId, status: 'online' });
    return okResult();
  },
  detachAgent: (agentId) => {
    const agents = storage.loadAgents(workspacePath);
    const agent = agents.find((entry) => entry.id === agentId);
    if (!agent) return errorResult('Agent not found');
    agent.attachedFolderId = undefined;
    agent.status = 'offline';
    storage.saveAgents(workspacePath, agents);
    processManager.updateAgent(agentId, { attachedFolderId: undefined, status: 'offline' });
    return okResult();
  },
  closeBrowser: (id) => {
    const success = browserService.deleteBrowserPanel(workspacePath, id);
    return success ? okResult() : errorResult('Failed to delete browser');
  },
  closeTerminal: (terminalId) => {
    const success = terminalPanels.deleteTerminalRecord(workspacePath, terminalId);
    return success ? okResult() : errorResult('Failed to delete terminal');
  },
  removeFolder: (folderId) => {
    const success = workspaceService.removeFolder(workspacePath, folderId);
    return success ? okResult() : errorResult('Failed to remove folder');
  },
  deleteFolder: async (folderId) => {
    const result = await workspaceService.deleteFolder(workspacePath, folderId);
    return result.success ? okResult() : errorResult(result.error || 'Failed to delete folder');
  },
  renameFolder: (folderId, name) => {
    const result = workspaceService.renameFolder(workspacePath, folderId, name);
    return result.success ? okResult() : errorResult(result.error || 'Failed to rename folder');
  },
  createWorktree: (folderId, x, y) => {
    const result = workspaceService.createGitWorktree(workspacePath, folderId, x, y);
    return result.success ? okResult() : errorResult(result.error || 'Failed to create worktree');
  },
  worktreeSync: (folderId) => {
    const result = workspaceService.worktreeSyncFromSource(workspacePath, folderId);
    return result.success ? okResult() : errorResult(result.error || 'Failed to sync worktree');
  },
  worktreeMerge: (folderId) => {
    const result = workspaceService.worktreeMergeToSource(workspacePath, folderId);
    return result.success ? okResult() : errorResult(result.error || 'Failed to merge worktree');
  },
  undoMerge: (folderId) => {
    const result = workspaceService.worktreeUndoMerge(workspacePath, folderId);
    return result.success ? okResult() : errorResult(result.error || 'Failed to undo merge');
  },
  retryRestore: (folderId) => {
    const result = workspaceService.worktreeRetryRestore(workspacePath, folderId);
    return result.success ? okResult() : errorResult(result.error || 'Failed to retry restore');
  },
  destroyAgent: (agentId) => {
    const agents = storage.loadAgents(workspacePath);
    storage.saveAgents(
      workspacePath,
      agents.filter((entry) => entry.id !== agentId)
    );
    processManager.clearAgentTerminalState(agentId);
    return okResult();
  },
  moveAgent: (id, x, y) => {
    const agents = storage.loadAgents(workspacePath);
    const agent = agents.find((entry) => entry.id === id);
    if (!agent) return errorResult('Agent not found');
    agent.x = x;
    agent.y = y;
    storage.saveAgents(workspacePath, agents);
    processManager.updateAgentPosition(id, x, y);
    return okResult();
  },
  moveFolder: (id, x, y) => {
    workspaceService.updateFolderPosition(workspacePath, id, x, y);
    return okResult();
  },
  moveBrowser: (id, x, y) => {
    browserService.updateBrowserPanelPosition(workspacePath, id, x, y);
    return okResult();
  },
  moveTerminal: (id, x, y) => {
    const result = terminalPanels.updateTerminalRecord(workspacePath, id, { x, y });
    return result.success ? okResult() : errorResult(result.error || 'Failed to move terminal');
  },
  resizeBrowser: (id, width, height) => {
    const result = browserService.updateBrowserPanel(workspacePath, id, { width, height });
    return result ? okResult() : errorResult('Failed to resize browser');
  },
  resizeTerminal: (id, width, height) => {
    const result = terminalPanels.updateTerminalRecord(workspacePath, id, { width, height });
    return result.success ? okResult() : errorResult(result.error || 'Failed to resize terminal');
  },
  moveHero: (x, y) => {
    const hero = storage.loadHero(workspacePath);
    hero.x = x;
    hero.y = y;
    storage.saveHero(workspacePath, hero);
    return okResult();
  },
  setAgentModel: (agentId, model) => {
    const agents = storage.loadAgents(workspacePath);
    const agent = agents.find((entry) => entry.id === agentId);
    if (!agent) return errorResult('Agent not found');
    agent.model = model;
    agent.providerSessionId = null;
    storage.saveAgents(workspacePath, agents);
    processManager.updateAgent(agentId, { model, providerSessionId: null });
    return okResult();
  },
  setAgentReasoningEffort: (agentId, reasoningEffort) => {
    const agents = storage.loadAgents(workspacePath);
    const agent = agents.find((entry) => entry.id === agentId);
    if (!agent) return errorResult('Agent not found');
    agent.reasoningEffort = reasoningEffort;
    storage.saveAgents(workspacePath, agents);
    processManager.updateAgent(agentId, { reasoningEffort });
    return okResult();
  },
  providerStatus: () => okResult(),
  providerInstall: () => okResult(),
  providersBootstrap: () => okResult(),
  providersRefresh: () => okResult(),
  setHeroProvider: (provider) => {
    const hero = storage.loadHero(workspacePath);
    hero.provider = provider;
    hero.providerSessionId = null;
    storage.saveHero(workspacePath, hero);
    return okResult();
  },
  setHeroModel: (model) => {
    const hero = storage.loadHero(workspacePath);
    hero.model = model;
    hero.providerSessionId = null;
    storage.saveHero(workspacePath, hero);
    return okResult();
  },
  agentSendPrompt: (_agentId, _prompt, relativePath) => {
    if (relativePath === '.') return okResult();
    const folder = storage
      .loadFolders(workspacePath)
      .find((entry) => entry.relativePath === relativePath || entry.name === relativePath);
    return folder ? okResult() : errorResult(`Unknown prompt path: ${relativePath}`);
  },
  heroSendPrompt: () => okResult(),
  cancelAgentRun: () => okResult(),
  cancelHeroRun: () => okResult(),
});

const createHarness = (): Harness => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibecraft-cmd-'));
  tempRoots.push(rootDir);
  const workspacePath = path.join(rootDir, 'workspace');
  userDataDir = path.join(rootDir, 'user-data');
  fs.mkdirSync(workspacePath, { recursive: true });
  fs.mkdirSync(userDataDir, { recursive: true });

  const registry = createCommandRegistry(createHandlers(workspacePath));
  const normalizeInvocation = (invocation: {
    id: CommandId;
    args?: Record<string, unknown>;
    source?: 'mcp';
    confirm?: boolean;
  }): CommandInvocation => ({ ...invocation, source: invocation.source ?? 'mcp' });

  const runCommand = async (invocation: {
    id: CommandId;
    args?: Record<string, unknown>;
    source?: 'mcp';
    confirm?: boolean;
  }) => {
    return registry.run(normalizeInvocation(invocation), buildContext(workspacePath));
  };

  const runBatch = async (
    commands: Array<{
      id: CommandId;
      args?: Record<string, unknown>;
      source?: 'mcp';
      confirm?: boolean;
    }>
  ) => {
    const batch = commands.map(normalizeInvocation);
    return registry.runBatch(batch, buildContext(workspacePath));
  };

  return {
    workspacePath,
    runCommand,
    runBatch,
    readState: () => readState(workspacePath),
  };
};

const findFolderByName = (folders: WorkspaceState['folders'], name: string) =>
  folders.find((entry) => entry.name === name || entry.relativePath === name);

const setGitDisabled = (disabled: boolean) => {
  process.env.VIBECRAFT_TEST_DISABLE_GIT = disabled ? '1' : '0';
};

const initGitRepo = (repoPath: string) => {
  execSync('git init', { cwd: repoPath, stdio: 'ignore' });
  execSync('git config user.email "tests@vibecraft.local"', { cwd: repoPath, stdio: 'ignore' });
  execSync('git config user.name "Vibecraft Tests"', { cwd: repoPath, stdio: 'ignore' });
  fs.writeFileSync(path.join(repoPath, 'README.md'), 'test');
  execSync('git add -A', { cwd: repoPath, stdio: 'ignore' });
  execSync('git commit -m "init"', { cwd: repoPath, stdio: 'ignore' });
};

const createFolder = async (harness: Harness, name = 'alpha') => {
  await harness.runCommand({ id: 'create-folder', args: { name, x: 120, y: 140 } });
  const folder = findFolderByName(harness.readState().folders, name);
  if (!folder) {
    throw new Error('Folder not created');
  }
  return folder;
};

const createAgent = async (
  harness: Harness,
  id: 'create-agent-claude' | 'create-agent-codex',
  x = 160,
  y = 180
) => {
  await harness.runCommand({ id, args: { x, y } });
  const agent = harness.readState().agents.at(-1);
  if (!agent) {
    throw new Error('Agent not created');
  }
  return agent;
};

const createBrowser = async (harness: Harness, x = 200, y = 220) => {
  await harness.runCommand({ id: 'create-browser', args: { x, y } });
  const browser = harness.readState().browsers.at(-1);
  if (!browser) {
    throw new Error('Browser not created');
  }
  return browser;
};

const createTerminal = async (harness: Harness, relativePath = '.', x = 240, y = 260) => {
  await harness.runCommand({ id: 'create-terminal', args: { path: relativePath, x, y } });
  const terminal = harness.readState().terminals.at(-1);
  if (!terminal) {
    throw new Error('Terminal not created');
  }
  return terminal;
};

const writeWorkspaceFile = (dir: string, relativePath: string, content: string) => {
  fs.writeFileSync(path.join(dir, relativePath), content);
};

const commitAll = (dir: string, message: string) => {
  execSync('git add -A', { cwd: dir, stdio: 'ignore' });
  execSync(`git commit -m ${JSON.stringify(message)}`, { cwd: dir, stdio: 'ignore' });
};

const gitHead = (dir: string) =>
  execSync('git rev-parse HEAD', { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim();

const gitStatus = (dir: string) =>
  execSync('git status --porcelain', { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim();

const gitStashList = (dir: string) =>
  execSync('git stash list --format=%H', { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim()
    .split('\n')
    .filter(Boolean);

const createWorktree = async (harness: Harness, folder: AnyFolder) => {
  await harness.runCommand({
    id: 'create-worktree',
    args: { folderId: folder.id, x: 200, y: 220 },
  });
  const worktree = harness.readState().folders.find((entry) => entry.isWorktree);
  if (!worktree) {
    throw new Error('Worktree not created');
  }
  return worktree;
};

const seedWorktreeFolder = (workspacePath: string, source: AnyFolder) => {
  const folders = storage.loadFolders(workspacePath);
  const worktreeFolder = {
    ...source,
    id: `folder-wt-${Date.now()}`,
    name: `${source.name}-wt`,
    relativePath: `${source.relativePath}-wt`,
    kind: 'worktree' as const,
    isWorktree: true,
    sourceRelativePath: source.relativePath,
    worktreeBranch: 'test-branch',
  } satisfies AnyFolder;
  folders.push(worktreeFolder);
  storage.saveFolders(workspacePath, folders);
  return worktreeFolder;
};

const setupMergeConflict = async (harness: Harness, folderName: string) => {
  const folder = await createFolder(harness, folderName);
  const sourcePath = path.join(harness.workspacePath, folder.relativePath);
  initGitRepo(sourcePath);
  const worktree = await createWorktree(harness, folder);
  const worktreePath = path.join(harness.workspacePath, worktree.relativePath);

  writeWorkspaceFile(worktreePath, 'README.md', 'worktree change\n');
  commitAll(worktreePath, 'worktree change');

  writeWorkspaceFile(sourcePath, 'README.md', 'source change\n');
  commitAll(sourcePath, 'source change');

  const mergeResult = await harness.runCommand({
    id: 'worktree-merge',
    args: { folderId: worktree.id },
    confirm: true,
  });

  const sourceFolder = storage.loadFolders(harness.workspacePath).find((entry) => entry.id === folder.id);

  return { folder, sourcePath, worktree, worktreePath, mergeResult, sourceFolder };
};

const setupRestoreConflict = async (harness: Harness, folderName: string) => {
  const folder = await createFolder(harness, folderName);
  const sourcePath = path.join(harness.workspacePath, folder.relativePath);
  initGitRepo(sourcePath);
  const worktree = await createWorktree(harness, folder);
  const worktreePath = path.join(harness.workspacePath, worktree.relativePath);

  writeWorkspaceFile(sourcePath, 'README.md', 'source dirty\n');

  writeWorkspaceFile(worktreePath, 'README.md', 'worktree change\n');
  commitAll(worktreePath, 'worktree change');

  const mergeResult = await harness.runCommand({
    id: 'worktree-merge',
    args: { folderId: worktree.id },
    confirm: true,
  });

  const sourceFolder = storage.loadFolders(harness.workspacePath).find((entry) => entry.id === folder.id);

  return { folder, sourcePath, worktree, worktreePath, mergeResult, sourceFolder };
};

describe('command registry', () => {
  beforeEach(() => {
    setGitDisabled(false);
  });

  afterEach(async () => {
    await processManager.shutdownAll();
    while (tempRoots.length > 0) {
      const root = tempRoots.pop();
      if (root) {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
    setGitDisabled(false);
  });

  test('create-agent-claude creates a claude agent', async () => {
    const harness = createHarness();
    await harness.runCommand({ id: 'create-agent-claude', args: { x: 120, y: 140 } });

    const state = harness.readState();
    expect(state.agents).toHaveLength(1);
    expect(state.agents[0].provider).toBe('claude');
    expect(state.agents[0].x).toBe(120);
    expect(state.agents[0].y).toBe(140);

    const agentsPath = workspaceMetaPath(harness.workspacePath, AGENTS_FILE);
    expect(fs.existsSync(agentsPath)).toBe(true);
    const agentsOnDisk = readAgentsOnDisk(harness.workspacePath);
    expect(agentsOnDisk).toHaveLength(1);
    expect(agentsOnDisk[0].provider).toBe('claude');
    expect(agentsOnDisk[0].x).toBe(120);
    expect(agentsOnDisk[0].y).toBe(140);
  });

  test('create-agent-codex creates a codex agent', async () => {
    const harness = createHarness();
    await harness.runCommand({ id: 'create-agent-codex', args: { x: 140, y: 160 } });

    const state = harness.readState();
    expect(state.agents).toHaveLength(1);
    expect(state.agents[0].provider).toBe('codex');
    expect(state.agents[0].x).toBe(140);
    expect(state.agents[0].y).toBe(160);

    const agentsPath = workspaceMetaPath(harness.workspacePath, AGENTS_FILE);
    expect(fs.existsSync(agentsPath)).toBe(true);
    const agentsOnDisk = readAgentsOnDisk(harness.workspacePath);
    expect(agentsOnDisk).toHaveLength(1);
    expect(agentsOnDisk[0].provider).toBe('codex');
    expect(agentsOnDisk[0].x).toBe(140);
    expect(agentsOnDisk[0].y).toBe(160);
  });

  test('create-agent-maitrix creates a maitrix agent', async () => {
    const harness = createHarness();
    await harness.runCommand({ id: 'create-agent-maitrix', args: { x: 180, y: 200 } });

    const state = harness.readState();
    expect(state.agents).toHaveLength(1);
    expect(state.agents[0].provider).toBe('maitrix');
    expect(state.agents[0].x).toBe(180);
    expect(state.agents[0].y).toBe(200);

    const agentsPath = workspaceMetaPath(harness.workspacePath, AGENTS_FILE);
    expect(fs.existsSync(agentsPath)).toBe(true);
    const agentsOnDisk = readAgentsOnDisk(harness.workspacePath);
    expect(agentsOnDisk).toHaveLength(1);
    expect(agentsOnDisk[0].provider).toBe('maitrix');
    expect(agentsOnDisk[0].x).toBe(180);
    expect(agentsOnDisk[0].y).toBe(200);
  });

  test('create-folder creates a workspace directory', async () => {
    const harness = createHarness();
    const folder = await createFolder(harness, 'alpha');

    expect(harness.readState().folders).toHaveLength(1);
    expect(fs.existsSync(path.join(harness.workspacePath, folder.relativePath))).toBe(true);

    const foldersPath = workspaceMetaPath(harness.workspacePath, FOLDERS_FILE);
    expect(fs.existsSync(foldersPath)).toBe(true);
    const foldersOnDisk = readFoldersOnDisk(harness.workspacePath);
    expect(foldersOnDisk).toHaveLength(1);
    expect(foldersOnDisk[0].id).toBe(folder.id);
    expect(foldersOnDisk[0].relativePath).toBe(folder.relativePath);
  });

  test('create-terminal adds a terminal panel', async () => {
    const harness = createHarness();
    const terminal = await createTerminal(harness);

    expect(harness.readState().terminals).toHaveLength(1);
    expect(terminal.originRelativePath).toBe('.');

    const terminalsPath = workspaceMetaPath(harness.workspacePath, TERMINALS_FILE);
    expect(fs.existsSync(terminalsPath)).toBe(true);
    const terminalsOnDisk = readTerminalsOnDisk(harness.workspacePath);
    expect(terminalsOnDisk).toHaveLength(1);
    expect(terminalsOnDisk[0].id).toBe(terminal.id);
  });

  test('create-browser adds a browser panel', async () => {
    const harness = createHarness();
    await createBrowser(harness);

    expect(harness.readState().browsers).toHaveLength(1);

    const browsersPath = workspaceMetaPath(harness.workspacePath, BROWSERS_FILE);
    expect(fs.existsSync(browsersPath)).toBe(true);
    const browsersOnDisk = readBrowsersOnDisk(harness.workspacePath);
    expect(browsersOnDisk).toHaveLength(1);
  });

  test('move-entity moves agents and hero', async () => {
    const harness = createHarness();
    const agent = await createAgent(harness, 'create-agent-claude');

    await harness.runCommand({
      id: 'move-entity',
      args: { entityType: 'agent', id: agent.id, x: 420, y: 440 },
    });
    await harness.runCommand({
      id: 'move-entity',
      args: { entityType: 'hero', x: 460, y: 480 },
    });

    const state = harness.readState();
    const updatedAgent = state.agents.find((entry) => entry.id === agent.id);
    expect(updatedAgent?.x).toBe(420);
    expect(updatedAgent?.y).toBe(440);
    expect(state.hero.x).toBe(460);
    expect(state.hero.y).toBe(480);

    const agentsOnDisk = readAgentsOnDisk(harness.workspacePath);
    const diskAgent = agentsOnDisk.find((entry) => entry.id === agent.id);
    expect(diskAgent?.x).toBe(420);
    expect(diskAgent?.y).toBe(440);
    const heroPath = workspaceMetaPath(harness.workspacePath, HERO_FILE);
    expect(fs.existsSync(heroPath)).toBe(true);
    const heroOnDisk = readHeroOnDisk(harness.workspacePath);
    expect(heroOnDisk.x).toBe(460);
    expect(heroOnDisk.y).toBe(480);
  });

  test('move-agent updates agent coordinates', async () => {
    const harness = createHarness();
    const agent = await createAgent(harness, 'create-agent-claude');

    await harness.runCommand({ id: 'move-agent', args: { agentId: agent.id, x: 300, y: 320 } });

    const updated = harness.readState().agents.find((entry) => entry.id === agent.id);
    expect(updated?.x).toBe(300);
    expect(updated?.y).toBe(320);

    const agentsOnDisk = readAgentsOnDisk(harness.workspacePath);
    const diskAgent = agentsOnDisk.find((entry) => entry.id === agent.id);
    expect(diskAgent?.x).toBe(300);
    expect(diskAgent?.y).toBe(320);
  });

  test('move-folder updates folder coordinates', async () => {
    const harness = createHarness();
    const folder = await createFolder(harness, 'bravo');

    await harness.runCommand({ id: 'move-folder', args: { folderId: folder.id, x: 280, y: 300 } });

    const updated = harness.readState().folders.find((entry) => entry.id === folder.id);
    expect(updated?.x).toBe(280);
    expect(updated?.y).toBe(300);

    const foldersOnDisk = readFoldersOnDisk(harness.workspacePath);
    const diskFolder = foldersOnDisk.find((entry) => entry.id === folder.id);
    expect(diskFolder?.x).toBe(280);
    expect(diskFolder?.y).toBe(300);
  });

  test('move-browser updates browser coordinates', async () => {
    const harness = createHarness();
    const browser = await createBrowser(harness);

    await harness.runCommand({ id: 'move-browser', args: { browserId: browser.id, x: 310, y: 330 } });

    const updated = harness.readState().browsers.find((entry) => entry.id === browser.id);
    expect(updated?.x).toBe(310);
    expect(updated?.y).toBe(330);

    const browsersOnDisk = readBrowsersOnDisk(harness.workspacePath);
    const diskBrowser = browsersOnDisk.find((entry) => entry.id === browser.id);
    expect(diskBrowser?.x).toBe(310);
    expect(diskBrowser?.y).toBe(330);
  });

  test('resize-browser updates browser dimensions', async () => {
    const harness = createHarness();
    const browser = await createBrowser(harness);

    await harness.runCommand({
      id: 'resize-browser',
      args: { browserId: browser.id, width: 820, height: 520 },
    });

    const updated = harness.readState().browsers.find((entry) => entry.id === browser.id);
    expect(updated?.width).toBe(820);
    expect(updated?.height).toBe(520);

    const browsersOnDisk = readBrowsersOnDisk(harness.workspacePath);
    const diskBrowser = browsersOnDisk.find((entry) => entry.id === browser.id);
    expect(diskBrowser?.width).toBe(820);
    expect(diskBrowser?.height).toBe(520);
  });

  test('move-terminal updates terminal coordinates', async () => {
    const harness = createHarness();
    const terminal = await createTerminal(harness);

    await harness.runCommand({
      id: 'move-terminal',
      args: { terminalId: terminal.id, x: 340, y: 360 },
    });

    const updated = harness.readState().terminals.find((entry) => entry.id === terminal.id);
    expect(updated?.x).toBe(340);
    expect(updated?.y).toBe(360);

    const terminalsOnDisk = readTerminalsOnDisk(harness.workspacePath);
    const diskTerminal = terminalsOnDisk.find((entry) => entry.id === terminal.id);
    expect(diskTerminal?.x).toBe(340);
    expect(diskTerminal?.y).toBe(360);
  });

  test('resize-terminal updates terminal dimensions', async () => {
    const harness = createHarness();
    const terminal = await createTerminal(harness);

    await harness.runCommand({
      id: 'resize-terminal',
      args: { terminalId: terminal.id, width: 680, height: 420 },
    });

    const updated = harness.readState().terminals.find((entry) => entry.id === terminal.id);
    expect(updated?.width).toBe(680);
    expect(updated?.height).toBe(420);

    const terminalsOnDisk = readTerminalsOnDisk(harness.workspacePath);
    const diskTerminal = terminalsOnDisk.find((entry) => entry.id === terminal.id);
    expect(diskTerminal?.width).toBe(680);
    expect(diskTerminal?.height).toBe(420);
  });

  test('move-hero updates hero coordinates', async () => {
    const harness = createHarness();
    await harness.runCommand({ id: 'move-hero', args: { x: 360, y: 380 } });

    const hero = harness.readState().hero;
    expect(hero.x).toBe(360);
    expect(hero.y).toBe(380);

    const heroPath = workspaceMetaPath(harness.workspacePath, HERO_FILE);
    expect(fs.existsSync(heroPath)).toBe(true);
    const heroOnDisk = readHeroOnDisk(harness.workspacePath);
    expect(heroOnDisk.x).toBe(360);
    expect(heroOnDisk.y).toBe(380);
  });

  test('open-agent-terminal succeeds for attached agents', async () => {
    const harness = createHarness();
    const folder = await createFolder(harness, 'charlie');
    const agent = await createAgent(harness, 'create-agent-claude');

    await harness.runCommand({
      id: 'attach-folder',
      args: { agentId: agent.id, folderId: folder.id },
    });

    const agentsOnDisk = readAgentsOnDisk(harness.workspacePath);
    const diskAgent = agentsOnDisk.find((entry) => entry.id === agent.id);
    expect(diskAgent?.attachedFolderId).toBe(folder.id);
    expect(diskAgent?.status).toBe('online');

    const result = await harness.runCommand({
      id: 'open-agent-terminal',
      args: { agentId: agent.id },
    });
    expect(result.ok).toBe(true);
  });

  test('refresh-browser succeeds for known browser panels', async () => {
    const harness = createHarness();
    const browser = await createBrowser(harness);

    const result = await harness.runCommand({
      id: 'refresh-browser',
      args: { browserId: browser.id },
    });

    expect(result.ok).toBe(true);

    const browsersOnDisk = readBrowsersOnDisk(harness.workspacePath);
    expect(browsersOnDisk).toHaveLength(1);
    expect(browsersOnDisk[0].id).toBe(browser.id);
  });

  test('clear-history clears agent terminal history', async () => {
    const harness = createHarness();
    const agent = await createAgent(harness, 'create-agent-claude');

    storage.setAgentTerminalState(harness.workspacePath, agent.id, [
      { id: 'entry-1', type: 'message', role: 'assistant', content: 'history' },
    ]);
    const historyPath = agentHistoryPath(harness.workspacePath, agent.id);
    expect(fs.existsSync(historyPath)).toBe(true);
    await harness.runCommand({ id: 'clear-history', args: { agentId: agent.id } });

    expect(storage.getAgentTerminalState(harness.workspacePath, agent.id)).toBeNull();
    expect(fs.existsSync(historyPath)).toBe(false);
  });

  test('attach-folder links agent to folder', async () => {
    const harness = createHarness();
    const folder = await createFolder(harness, 'delta');
    const agent = await createAgent(harness, 'create-agent-claude');

    await harness.runCommand({
      id: 'attach-folder',
      args: { agentId: agent.id, folderId: folder.id },
    });

    const updated = harness.readState().agents.find((entry) => entry.id === agent.id);
    expect(updated?.attachedFolderId).toBe(folder.id);
    expect(updated?.status).toBe('online');

    const agentsOnDisk = readAgentsOnDisk(harness.workspacePath);
    const diskAgent = agentsOnDisk.find((entry) => entry.id === agent.id);
    expect(diskAgent?.attachedFolderId).toBe(folder.id);
    expect(diskAgent?.status).toBe('online');
  });

  test('agent-send-prompt via MCP resolves execution path from attached folder', async () => {
    const harness = createHarness();
    const folder = await createFolder(harness, 'mcp-agent-path');
    const agent = await createAgent(harness, 'create-agent-claude');

    await harness.runCommand({
      id: 'attach-folder',
      args: { agentId: agent.id, folderId: folder.id },
    });

    const result = await harness.runCommand({
      id: 'agent-send-prompt',
      args: {
        agentId: agent.id,
        prompt: 'Run the task',
        relativePath: 'incorrect/path',
      },
    });

    expect(result.ok).toBe(true);
  });

  test('agent-send-prompt via MCP succeeds after attach-folder in the same batch', async () => {
    const harness = createHarness();
    const folder = await createFolder(harness, 'mcp-batch-path');
    const agent = await createAgent(harness, 'create-agent-claude');

    const results = await harness.runBatch([
      {
        id: 'attach-folder',
        args: { agentId: agent.id, folderId: folder.id },
      },
      {
        id: 'agent-send-prompt',
        args: { agentId: agent.id, prompt: 'Run the task' },
      },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ id: 'attach-folder', ok: true });
    expect(results[1]).toMatchObject({ id: 'agent-send-prompt', ok: true });
  });

  test('agent-send-prompt via MCP requires an attached folder', async () => {
    const harness = createHarness();
    const agent = await createAgent(harness, 'create-agent-claude');

    const result = await harness.runCommand({
      id: 'agent-send-prompt',
      args: { agentId: agent.id, prompt: 'Run the task' },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Agent must be attached to a folder before using agent-send-prompt via MCP');
  });

  test('detach-agent clears agent attachment', async () => {
    const harness = createHarness();
    const folder = await createFolder(harness, 'echo');
    const agent = await createAgent(harness, 'create-agent-claude');

    await harness.runCommand({
      id: 'attach-folder',
      args: { agentId: agent.id, folderId: folder.id },
    });

    await harness.runCommand({ id: 'detach-agent', args: { agentId: agent.id } });

    const updated = harness.readState().agents.find((entry) => entry.id === agent.id);
    expect(updated?.attachedFolderId).toBeUndefined();
    expect(updated?.status).toBe('offline');

    const agentsOnDisk = readAgentsOnDisk(harness.workspacePath);
    const diskAgent = agentsOnDisk.find((entry) => entry.id === agent.id);
    expect(diskAgent?.attachedFolderId).toBeUndefined();
    expect(diskAgent?.status).toBe('offline');
  });

  test('delete-browser removes browser panels', async () => {
    const harness = createHarness();
    const browser = await createBrowser(harness);

    await harness.runCommand({ id: 'delete-browser', args: { browserId: browser.id } });

    expect(harness.readState().browsers).toHaveLength(0);
    expect(readBrowsersOnDisk(harness.workspacePath)).toHaveLength(0);
  });

  test('delete-terminal removes terminal panels', async () => {
    const harness = createHarness();
    const terminal = await createTerminal(harness);

    storage.setTerminalHistory(harness.workspacePath, terminal.id, 'terminal history');
    const historyPath = terminalHistoryPath(harness.workspacePath, terminal.id);
    expect(fs.existsSync(historyPath)).toBe(true);
    await harness.runCommand({ id: 'delete-terminal', args: { terminalId: terminal.id } });

    expect(harness.readState().terminals).toHaveLength(0);
    expect(storage.getTerminalHistory(harness.workspacePath, terminal.id)).toBe('');
    expect(readTerminalsOnDisk(harness.workspacePath)).toHaveLength(0);
    expect(fs.existsSync(historyPath)).toBe(false);
  });

  test('rename-folder updates folder metadata and path', async () => {
    const harness = createHarness();
    const folder = await createFolder(harness, 'foxtrot');
    const oldPath = path.join(harness.workspacePath, folder.relativePath);

    await harness.runCommand({
      id: 'rename-folder',
      args: { folderId: folder.id, name: 'golf' },
    });

    const updated = findFolderByName(harness.readState().folders, 'golf');
    expect(updated).toBeTruthy();
    if (!updated) {
      throw new Error('Rename failed');
    }
    const newPath = path.join(harness.workspacePath, updated.relativePath);
    expect(fs.existsSync(newPath)).toBe(true);
    expect(fs.existsSync(oldPath)).toBe(false);

    const foldersOnDisk = readFoldersOnDisk(harness.workspacePath);
    expect(foldersOnDisk).toHaveLength(1);
    expect(foldersOnDisk[0].id).toBe(folder.id);
    expect(foldersOnDisk[0].relativePath).toBe(updated.relativePath);
  });

  test('remove-folder removes folder metadata only', async () => {
    const harness = createHarness();
    const folder = await createFolder(harness, 'hotel');
    const folderPath = path.join(harness.workspacePath, folder.relativePath);

    await harness.runCommand({ id: 'remove-folder', args: { folderId: folder.id } });

    expect(harness.readState().folders).toHaveLength(0);
    expect(fs.existsSync(folderPath)).toBe(true);
    expect(readFoldersOnDisk(harness.workspacePath)).toHaveLength(0);
  });

  test('delete-folder removes folder metadata and path', async () => {
    const harness = createHarness();
    const folder = await createFolder(harness, 'india');
    const folderPath = path.join(harness.workspacePath, folder.relativePath);

    await harness.runCommand({
      id: 'delete-folder',
      args: { folderId: folder.id },
      confirm: true,
    });

    expect(harness.readState().folders).toHaveLength(0);
    expect(fs.existsSync(folderPath)).toBe(false);
    expect(readFoldersOnDisk(harness.workspacePath)).toHaveLength(0);
  });

  test('create-worktree reports git-disabled errors', async () => {
    setGitDisabled(true);
    const harness = createHarness();
    const folder = await createFolder(harness, 'juliet');

    const result = await harness.runCommand({
      id: 'create-worktree',
      args: { folderId: folder.id, x: 200, y: 220 },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Git features are disabled.');
    const foldersOnDisk = readFoldersOnDisk(harness.workspacePath);
    expect(foldersOnDisk).toHaveLength(1);
    expect(foldersOnDisk.some((entry) => entry.isWorktree)).toBe(false);
  });

  test('create-worktree creates a worktree folder when git is enabled', async () => {
    setGitDisabled(false);
    const harness = createHarness();
    const folder = await createFolder(harness, 'kilo');
    const sourcePath = path.join(harness.workspacePath, folder.relativePath);
    initGitRepo(sourcePath);

    const result = await harness.runCommand({
      id: 'create-worktree',
      args: { folderId: folder.id, x: 200, y: 220 },
    });

    expect(result.ok).toBe(true);
    const worktree = harness.readState().folders.find((entry) => entry.isWorktree);
    expect(worktree).toBeTruthy();
    if (worktree) {
      expect(fs.existsSync(path.join(harness.workspacePath, worktree.relativePath))).toBe(true);
    }
    const foldersOnDisk = readFoldersOnDisk(harness.workspacePath);
    const diskWorktree = foldersOnDisk.find((entry) => entry.isWorktree);
    expect(diskWorktree).toBeTruthy();
    if (diskWorktree) {
      expect(diskWorktree.sourceRelativePath).toBe(folder.relativePath);
    }
  });

  test('worktree-sync reports git-disabled errors', async () => {
    setGitDisabled(true);
    const harness = createHarness();
    const folder = await createFolder(harness, 'lima');
    const worktree = seedWorktreeFolder(harness.workspacePath, folder);

    const result = await harness.runCommand({
      id: 'worktree-sync',
      args: { folderId: worktree.id },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Git features are disabled.');
    expect(readFoldersOnDisk(harness.workspacePath)).toHaveLength(2);
  });

  test('worktree-sync merges source into worktree when git is enabled', async () => {
    setGitDisabled(false);
    const harness = createHarness();
    const folder = await createFolder(harness, 'mike');
    const sourcePath = path.join(harness.workspacePath, folder.relativePath);
    initGitRepo(sourcePath);

    const worktree = await createWorktree(harness, folder);
    const worktreePath = path.join(harness.workspacePath, worktree.relativePath);

    writeWorkspaceFile(sourcePath, 'README.md', 'source update\n');
    commitAll(sourcePath, 'source update');

    const result = await harness.runCommand({
      id: 'worktree-sync',
      args: { folderId: worktree.id },
    });

    expect(result.ok).toBe(true);
    expect(fs.readFileSync(path.join(worktreePath, 'README.md'), 'utf8')).toBe('source update\n');
    expect(gitStatus(worktreePath)).toBe('');
  });

  test('worktree-merge reports git-disabled errors', async () => {
    setGitDisabled(true);
    const harness = createHarness();
    const folder = await createFolder(harness, 'november');
    const worktree = seedWorktreeFolder(harness.workspacePath, folder);

    const result = await harness.runCommand({
      id: 'worktree-merge',
      args: { folderId: worktree.id },
      confirm: true,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Git features are disabled.');
    expect(readFoldersOnDisk(harness.workspacePath)).toHaveLength(2);
  });

  test('worktree-merge merges worktree into source when git is enabled', async () => {
    setGitDisabled(false);
    const harness = createHarness();
    const folder = await createFolder(harness, 'oscar');
    const sourcePath = path.join(harness.workspacePath, folder.relativePath);
    initGitRepo(sourcePath);

    const worktree = await createWorktree(harness, folder);

    const result = await harness.runCommand({
      id: 'worktree-merge',
      args: { folderId: worktree.id },
      confirm: true,
    });

    expect(result.ok).toBe(true);
    expect(harness.readState().folders.some((entry) => entry.id === worktree.id)).toBe(false);
    expect(readFoldersOnDisk(harness.workspacePath).some((entry) => entry.id === worktree.id)).toBe(false);
  });

  test('worktree-merge records merge conflicts when git merge fails', async () => {
    setGitDisabled(false);
    const harness = createHarness();
    const { sourcePath, mergeResult, sourceFolder, worktree } = await setupMergeConflict(harness, 'papa');

    expect(mergeResult.ok).toBe(false);
    expect(mergeResult.error).toBe('Merge produced conflicts. Resolve or undo the merge.');
    expect(sourceFolder?.conflictState?.kind).toBe('merge');
    expect(sourceFolder?.conflictState?.worktreeId).toBe(worktree.id);
    expect(sourceFolder?.conflictState?.sourceHead).toBeTruthy();
    expect(sourceFolder?.conflictState?.worktreeHead).toBeTruthy();
    expect(gitStatus(sourcePath)).not.toBe('');
    const foldersOnDisk = readFoldersOnDisk(harness.workspacePath);
    const diskSource = foldersOnDisk.find((entry) => entry.id === sourceFolder?.id);
    expect(diskSource?.conflictState?.kind).toBe('merge');
  });

  test('worktree-merge records restore conflicts when stash apply fails', async () => {
    setGitDisabled(false);
    const harness = createHarness();
    const { mergeResult, sourceFolder, sourcePath } = await setupRestoreConflict(harness, 'quebec');

    expect(mergeResult.ok).toBe(false);
    expect(mergeResult.error).toBe('Merge succeeded but restoring your source changes failed.');
    expect(sourceFolder?.conflictState?.kind).toBe('restore');
    expect(sourceFolder?.conflictState?.stashRef).toBeTruthy();
    if (sourceFolder?.conflictState?.stashRef) {
      expect(gitStashList(sourcePath)).toContain(sourceFolder.conflictState.stashRef);
    }
    const foldersOnDisk = readFoldersOnDisk(harness.workspacePath);
    const diskSource = foldersOnDisk.find((entry) => entry.id === sourceFolder?.id);
    expect(diskSource?.conflictState?.kind).toBe('restore');
  }, 20000);

  test('undo-merge reports git-disabled errors', async () => {
    setGitDisabled(true);
    const harness = createHarness();
    const folder = await createFolder(harness, 'papa');

    const folders = storage.loadFolders(harness.workspacePath);
    const source = folders.find((entry) => entry.id === folder.id);
    if (!source) {
      throw new Error('Source folder missing');
    }
    source.conflictState = { kind: 'merge', worktreeId: 'worktree-test' };
    storage.saveFolders(harness.workspacePath, folders);

    const result = await harness.runCommand({
      id: 'undo-merge',
      args: { folderId: folder.id },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Git features are disabled.');
    const foldersOnDisk = readFoldersOnDisk(harness.workspacePath);
    const diskSource = foldersOnDisk.find((entry) => entry.id === folder.id);
    expect(diskSource?.conflictState?.kind).toBe('merge');
  });

  test('undo-merge clears merge conflicts when git is enabled', async () => {
    setGitDisabled(false);
    const harness = createHarness();
    const { folder, sourcePath, mergeResult, sourceFolder } = await setupMergeConflict(harness, 'romeo');

    expect(mergeResult.ok).toBe(false);
    const sourceHead = sourceFolder?.conflictState?.sourceHead;
    expect(sourceHead).toBeTruthy();

    const result = await harness.runCommand({
      id: 'undo-merge',
      args: { folderId: folder.id },
    });

    expect(result.ok).toBe(true);
    const refreshed = storage.loadFolders(harness.workspacePath).find((entry) => entry.id === folder.id);
    expect(refreshed?.conflictState).toBeUndefined();
    const diskSource = readFoldersOnDisk(harness.workspacePath).find((entry) => entry.id === folder.id);
    expect(diskSource?.conflictState).toBeUndefined();
    if (sourceHead) {
      expect(gitHead(sourcePath)).toBe(sourceHead);
    }
    expect(gitStatus(sourcePath)).toBe('');
  });

  test('retry-restore reports git-disabled errors', async () => {
    setGitDisabled(true);
    const harness = createHarness();
    const folder = await createFolder(harness, 'romeo');

    const folders = storage.loadFolders(harness.workspacePath);
    const source = folders.find((entry) => entry.id === folder.id);
    if (!source) {
      throw new Error('Source folder missing');
    }
    source.conflictState = { kind: 'restore', worktreeId: 'worktree-test' };
    storage.saveFolders(harness.workspacePath, folders);

    const result = await harness.runCommand({
      id: 'retry-restore',
      args: { folderId: folder.id },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Git features are disabled.');
    const foldersOnDisk = readFoldersOnDisk(harness.workspacePath);
    const diskSource = foldersOnDisk.find((entry) => entry.id === folder.id);
    expect(diskSource?.conflictState?.kind).toBe('restore');
  });

  test('retry-restore returns error when stash still conflicts', async () => {
    setGitDisabled(false);
    const harness = createHarness();
    const { folder, sourcePath, mergeResult } = await setupRestoreConflict(harness, 'sierra');

    expect(mergeResult.ok).toBe(false);
    expect(gitStatus(sourcePath)).not.toBe('');

    const result = await harness.runCommand({
      id: 'retry-restore',
      args: { folderId: folder.id },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Restore still failing. Clean working tree and retry.');
    const diskSource = readFoldersOnDisk(harness.workspacePath).find((entry) => entry.id === folder.id);
    expect(diskSource?.conflictState?.kind).toBe('restore');
  });

  test('retry-restore applies stash and clears conflict when git is enabled', async () => {
    setGitDisabled(false);
    const harness = createHarness();
    const folder = await createFolder(harness, 'tango');
    const sourcePath = path.join(harness.workspacePath, folder.relativePath);
    initGitRepo(sourcePath);

    writeWorkspaceFile(sourcePath, 'notes.txt', 'stash note\n');
    execSync('git add -A', { cwd: sourcePath, stdio: 'ignore' });
    execSync('git stash push -m "test stash"', { cwd: sourcePath, stdio: 'ignore' });

    const stashRefs = gitStashList(sourcePath);
    const stashRef = stashRefs[0];
    expect(stashRef).toBeTruthy();

    const folders = storage.loadFolders(harness.workspacePath);
    const source = folders.find((entry) => entry.id === folder.id);
    if (!source) {
      throw new Error('Source folder missing');
    }
    source.conflictState = { kind: 'restore', worktreeId: 'worktree-test', stashRef };
    storage.saveFolders(harness.workspacePath, folders);

    const result = await harness.runCommand({
      id: 'retry-restore',
      args: { folderId: folder.id },
    });

    expect(result.ok).toBe(true);
    const refreshed = storage.loadFolders(harness.workspacePath).find((entry) => entry.id === folder.id);
    expect(refreshed?.conflictState).toBeUndefined();
    const diskSource = readFoldersOnDisk(harness.workspacePath).find((entry) => entry.id === folder.id);
    expect(diskSource?.conflictState).toBeUndefined();
    expect(fs.existsSync(path.join(sourcePath, 'notes.txt'))).toBe(true);
    expect(gitStashList(sourcePath)).not.toContain(stashRef);
  });

  test('retry-restore clears conflict when stash is missing', async () => {
    setGitDisabled(false);
    const harness = createHarness();
    const folder = await createFolder(harness, 'uniform');
    const sourcePath = path.join(harness.workspacePath, folder.relativePath);
    initGitRepo(sourcePath);

    const folders = storage.loadFolders(harness.workspacePath);
    const source = folders.find((entry) => entry.id === folder.id);
    if (!source) {
      throw new Error('Source folder missing');
    }
    source.conflictState = { kind: 'restore', worktreeId: 'worktree-test', stashRef: 'missing' };
    storage.saveFolders(harness.workspacePath, folders);

    const result = await harness.runCommand({
      id: 'retry-restore',
      args: { folderId: folder.id },
    });

    expect(result.ok).toBe(true);
    const refreshed = storage.loadFolders(harness.workspacePath).find((entry) => entry.id === folder.id);
    expect(refreshed?.conflictState).toBeUndefined();
    const diskSource = readFoldersOnDisk(harness.workspacePath).find((entry) => entry.id === folder.id);
    expect(diskSource?.conflictState).toBeUndefined();
    expect(gitStatus(sourcePath)).toBe('');
  });

  test('set-agent-model updates agent model metadata', async () => {
    const harness = createHarness();
    const agent = await createAgent(harness, 'create-agent-claude');

    const result = await harness.runCommand({
      id: 'set-agent-model',
      args: { agentId: agent.id, model: 'sonnet-3.5' },
    });

    expect(result.ok).toBe(true);
    const updated = harness.readState().agents.find((entry) => entry.id === agent.id);
    expect(updated?.model).toBe('sonnet-3.5');
    const agentsOnDisk = readAgentsOnDisk(harness.workspacePath);
    expect(agentsOnDisk.find((entry) => entry.id === agent.id)?.model).toBe('sonnet-3.5');
  });

  test('set-agent-model returns error for unknown agent', async () => {
    const harness = createHarness();

    const result = await harness.runCommand({
      id: 'set-agent-model',
      args: { agentId: 'missing', model: 'gpt-4' },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Agent not found');
  });

  test('set-hero-provider updates hero provider', async () => {
    const harness = createHarness();

    const result = await harness.runCommand({
      id: 'set-hero-provider',
      args: { provider: 'codex' },
    });

    expect(result.ok).toBe(true);
    expect(harness.readState().hero.provider).toBe('codex');
    expect(readHeroOnDisk(harness.workspacePath).provider).toBe('codex');
  });

  test('set-hero-model updates hero model', async () => {
    const harness = createHarness();

    const result = await harness.runCommand({
      id: 'set-hero-model',
      args: { model: 'o1-mini' },
    });

    expect(result.ok).toBe(true);
    expect(harness.readState().hero.model).toBe('o1-mini');
    expect(readHeroOnDisk(harness.workspacePath).model).toBe('o1-mini');
  });

  test('destroy-agent removes agent metadata', async () => {
    const harness = createHarness();
    const agent = await createAgent(harness, 'create-agent-claude');
    storage.setAgentTerminalState(harness.workspacePath, agent.id, [
      { id: 'entry-1', type: 'message', role: 'assistant', content: 'history' },
    ]);
    const historyPath = agentHistoryPath(harness.workspacePath, agent.id);
    expect(fs.existsSync(historyPath)).toBe(true);

    const result = await harness.runCommand({
      id: 'destroy-agent',
      args: { agentId: agent.id },
      confirm: true,
    });

    expect(result.ok).toBe(true);
    expect(harness.readState().agents).toHaveLength(0);
    expect(readAgentsOnDisk(harness.workspacePath)).toHaveLength(0);
    expect(fs.existsSync(historyPath)).toBe(false);
  });
});
