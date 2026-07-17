import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Agent, AgentTerminalEntry } from '../../../src/shared/types';
import { VIBECRAFT_CORE_MCP_SKILL_ID, VIBECRAFT_DOCS_MCP_SKILL_ID } from '../../../src/shared/types';

let userDataDir = '';
type IpcHandler = (...args: unknown[]) => unknown;
const handlers = new Map<string, IpcHandler>();

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataDir,
    exit: vi.fn(),
    isPackaged: false,
    on: vi.fn(),
    setPath: vi.fn(),
  },
  ipcMain: {
    handle: (channel: string, handler: IpcHandler) => {
      handlers.set(channel, handler);
    },
    on: vi.fn(),
  },
  dialog: {
    showMessageBox: vi.fn(),
    showOpenDialog: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
  shell: {
    openExternal: vi.fn(),
  },
}));

vi.mock('../../../src/main/index', () => ({
  emitToRenderer: vi.fn(),
  getMainWindow: () => null,
}));

vi.mock('../../../src/main/services/memflowBridge', () => ({
  getMemflowStatus: () => ({
    installed: true,
    daemonRunning: true,
    trackedProjectCount: 3,
    lastSyncedAt: '2026-07-16T12:00:00Z',
  }),
}));

vi.mock('../../../src/main/services/terminalService', () => ({
  getTerminalService: async () => ({
    getTerminalHistory: () => '',
  }),
}));

describe('get-agent-terminal-state IPC', () => {
  let tempDir = '';

  beforeEach(() => {
    handlers.clear();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibecraft-ipc-'));
    userDataDir = tempDir;
    process.env.VIBECRAFT_TEST_USER_DATA = path.join(tempDir, 'user-data');
    process.env.VIBECRAFT_TEST_WORKSPACE_PATH = path.join(tempDir, 'workspace');
  });

  afterEach(async () => {
    const { processManager } = await import('../../../src/main/services/agents/processManager');
    await processManager.shutdownAll();
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.resetModules();
  });

  test('returns stored entries when agent is not loaded', async () => {
    const workspacePath = path.join(tempDir, 'workspace');
    const entries: AgentTerminalEntry[] = [
      { id: 'msg-1', type: 'message', role: 'assistant', content: 'Hello from disk.' },
    ];

    const { setAgentTerminalState } = await import('../../../src/main/services/storage');
    setAgentTerminalState(workspacePath, 'agent-1', entries);

    const { registerIpcHandlers } = await import('../../../src/main/ipc');
    await registerIpcHandlers();

    const handler = handlers.get('get-agent-terminal-state');
    expect(handler).toBeTypeOf('function');
    if (!handler) throw new Error('Handler not registered');

    const result = (await handler({} as unknown, workspacePath, 'agent-1')) as {
      success: boolean;
      data: { state: { entries: AgentTerminalEntry[] } | null };
    };
    expect(result.success).toBe(true);
    expect(result.data.state?.entries).toEqual(entries);
  });

  test('load-agents does not delete agent terminal history', async () => {
    const workspacePath = path.join(tempDir, 'workspace');
    const entries: AgentTerminalEntry[] = [
      { id: 'msg-1', type: 'message', role: 'assistant', content: 'Persist me.' },
    ];

    const { setAgentTerminalState, getAgentTerminalState } =
      await import('../../../src/main/services/storage');
    setAgentTerminalState(workspacePath, 'agent-1', entries);

    const { registerIpcHandlers } = await import('../../../src/main/ipc');
    await registerIpcHandlers();

    const handler = handlers.get('load-agents');
    expect(handler).toBeTypeOf('function');
    if (!handler) throw new Error('Handler not registered');

    await handler({} as unknown, workspacePath);

    expect(getAgentTerminalState(workspacePath, 'agent-1')?.entries).toEqual(entries);
  });

  test('agentconnect-run-agent returns explicit error when relative path folder is missing', async () => {
    const workspacePath = path.join(tempDir, 'workspace-missing-agent-path');
    fs.mkdirSync(workspacePath, { recursive: true });

    const { saveAgents } = await import('../../../src/main/services/storage');
    saveAgents(workspacePath, [
      {
        id: 'agent-1',
        provider: 'claude',
        model: 'claude-sonnet-4-5-20250929',
        color: '#ff0000',
        name: 'Agent One',
        displayName: 'Agent One',
        workspacePath,
        x: 100,
        y: 100,
        status: 'offline',
      },
    ]);

    const { registerIpcHandlers } = await import('../../../src/main/ipc');
    await registerIpcHandlers();

    const handler = handlers.get('agentconnect-run-agent');
    expect(handler).toBeTypeOf('function');
    if (!handler) throw new Error('Handler not registered');

    const result = (await handler({} as unknown, {
      agentId: 'agent-1',
      workspacePath,
      relativePath: 'missing-folder',
      prompt: 'debug this',
    })) as { success: boolean; error?: string };

    expect(result.success).toBe(false);
    expect(result.error).toBe('Folder path does not exist: missing-folder');
  });

  test('hero-send-prompt returns explicit error when relative path folder is missing', async () => {
    const workspacePath = path.join(tempDir, 'workspace-missing-hero-path');
    fs.mkdirSync(workspacePath, { recursive: true });

    const { registerIpcHandlers } = await import('../../../src/main/ipc');
    await registerIpcHandlers();

    const handler = handlers.get('hero-send-prompt');
    expect(handler).toBeTypeOf('function');
    if (!handler) throw new Error('Handler not registered');

    const result = (await handler({} as unknown, {
      workspacePath,
      relativePath: 'missing-folder',
      prompt: 'orchestrate this',
    })) as { success: boolean; error?: string };

    expect(result.success).toBe(false);
    expect(result.error).toBe('Folder path does not exist: missing-folder');
  });

  test('imports custom sound files into user data through IPC', async () => {
    const sourcePath = path.join(tempDir, 'battle-horn.wav');
    fs.writeFileSync(sourcePath, 'fake-audio-data', 'utf8');

    const electron = await import('electron');
    vi.mocked(electron.dialog.showOpenDialog).mockResolvedValueOnce({
      canceled: false,
      filePaths: [sourcePath],
    } as Awaited<ReturnType<typeof electron.dialog.showOpenDialog>>);

    const { registerIpcHandlers } = await import('../../../src/main/ipc');
    await registerIpcHandlers();

    const handler = handlers.get('audio-import-custom-sound');
    expect(handler).toBeTypeOf('function');
    if (!handler) throw new Error('Handler not registered');

    const result = (await handler({} as unknown)) as {
      success: boolean;
      data?: { sourceUrl: string; displayName: string } | null;
    };

    expect(result.success).toBe(true);
    expect(result.data?.displayName).toBe('battle-horn');
    expect(result.data?.sourceUrl.startsWith('file://')).toBe(true);
    if (!result.data) throw new Error('Expected imported custom sound');
    expect(fs.existsSync(new URL(result.data.sourceUrl))).toBe(true);
  });

  test('mcp-skills-list returns available skill descriptors', async () => {
    const { registerIpcHandlers } = await import('../../../src/main/ipc');
    await registerIpcHandlers();

    const handler = handlers.get('mcp-skills-list');
    expect(handler).toBeTypeOf('function');
    if (!handler) throw new Error('Handler not registered');

    const result = (await handler({} as unknown)) as {
      success: boolean;
      data?: Array<{ id: string }>;
    };

    expect(result.success).toBe(true);
    expect(result.data?.some((entry) => entry.id === VIBECRAFT_CORE_MCP_SKILL_ID)).toBe(true);
    expect(result.data?.some((entry) => entry.id === VIBECRAFT_DOCS_MCP_SKILL_ID)).toBe(true);
  });

  test('hero MCP skill set keeps core skill and clears provider sessions', async () => {
    const workspacePath = path.join(tempDir, 'workspace-hero-mcp');
    const { saveHero, loadHero } = await import('../../../src/main/services/storage');
    saveHero(workspacePath, {
      id: 'hero',
      name: 'Hero',
      provider: 'claude',
      model: 'claude-3.5',
      x: 0,
      y: 0,
      providerSessionId: 'hero-provider-session',
      providerSessionIds: {
        claude: 'hero-provider-session',
      },
      mcpSkillIds: [VIBECRAFT_CORE_MCP_SKILL_ID],
    });

    const { registerIpcHandlers } = await import('../../../src/main/ipc');
    await registerIpcHandlers();

    const setHandler = handlers.get('hero-set-mcp-skills');
    expect(setHandler).toBeTypeOf('function');
    if (!setHandler) throw new Error('Handler not registered');

    const setResult = (await setHandler({} as unknown, {
      workspacePath,
      skillIds: [],
    })) as { success: boolean; data?: { skillIds: string[] } };
    expect(setResult.success).toBe(true);
    expect(setResult.data?.skillIds).toEqual([VIBECRAFT_CORE_MCP_SKILL_ID, VIBECRAFT_DOCS_MCP_SKILL_ID]);

    const saved = loadHero(workspacePath);
    expect(saved.mcpSkillIds).toEqual([VIBECRAFT_CORE_MCP_SKILL_ID, VIBECRAFT_DOCS_MCP_SKILL_ID]);
    expect(saved.providerSessionId).toBe('hero-provider-session');
    expect(saved.providerSessionIds?.claude).toBe('hero-provider-session');

    const getHandler = handlers.get('hero-get-mcp-skills');
    expect(getHandler).toBeTypeOf('function');
    if (!getHandler) throw new Error('Handler not registered');
    const getResult = (await getHandler({} as unknown, { workspacePath })) as {
      success: boolean;
      data?: { skillIds: string[] };
    };
    expect(getResult.success).toBe(true);
    expect(getResult.data?.skillIds).toEqual([VIBECRAFT_CORE_MCP_SKILL_ID, VIBECRAFT_DOCS_MCP_SKILL_ID]);
  });

  test('agent MCP skill set persists loadout and clears provider session', async () => {
    const workspacePath = path.join(tempDir, 'workspace-agent-mcp');
    const { saveAgents, loadAgents } = await import('../../../src/main/services/storage');
    const agents: Agent[] = [
      {
        id: 'agent-1',
        provider: 'claude',
        model: 'claude-3.5',
        color: '#ff0000',
        name: 'Agent One',
        displayName: 'Agent One',
        workspacePath,
        x: 10,
        y: 10,
        status: 'online',
        providerSessionId: 'agent-provider-session',
        mcpSkillIds: [],
      },
    ];
    saveAgents(workspacePath, agents);

    const { registerIpcHandlers } = await import('../../../src/main/ipc');
    await registerIpcHandlers();

    const setHandler = handlers.get('agent-set-mcp-skills');
    expect(setHandler).toBeTypeOf('function');
    if (!setHandler) throw new Error('Handler not registered');

    const setResult = (await setHandler({} as unknown, {
      workspacePath,
      agentId: 'agent-1',
      skillIds: [VIBECRAFT_CORE_MCP_SKILL_ID],
    })) as { success: boolean; data?: { skillIds: string[] } };
    expect(setResult.success).toBe(true);
    expect(setResult.data?.skillIds).toEqual([VIBECRAFT_CORE_MCP_SKILL_ID]);

    const saved = loadAgents(workspacePath).find((entry) => entry.id === 'agent-1');
    expect(saved?.mcpSkillIds).toEqual([VIBECRAFT_CORE_MCP_SKILL_ID]);
    expect(saved?.providerSessionId).toBeUndefined();

    const getHandler = handlers.get('agent-get-mcp-skills');
    expect(getHandler).toBeTypeOf('function');
    if (!getHandler) throw new Error('Handler not registered');
    const getResult = (await getHandler({} as unknown, { workspacePath, agentId: 'agent-1' })) as {
      success: boolean;
      data?: { skillIds: string[] };
    };
    expect(getResult.success).toBe(true);
    expect(getResult.data?.skillIds).toEqual([VIBECRAFT_CORE_MCP_SKILL_ID]);
  });

  test('agent MCP skill set rejects unknown skill IDs', async () => {
    const workspacePath = path.join(tempDir, 'workspace-agent-invalid-mcp');
    const { saveAgents } = await import('../../../src/main/services/storage');
    saveAgents(workspacePath, [
      {
        id: 'agent-1',
        provider: 'claude',
        model: 'claude-3.5',
        color: '#ff0000',
        name: 'Agent One',
        displayName: 'Agent One',
        workspacePath,
        x: 10,
        y: 10,
        status: 'online',
        mcpSkillIds: [],
      },
    ]);

    const { registerIpcHandlers } = await import('../../../src/main/ipc');
    await registerIpcHandlers();

    const setHandler = handlers.get('agent-set-mcp-skills');
    expect(setHandler).toBeTypeOf('function');
    if (!setHandler) throw new Error('Handler not registered');

    const setResult = (await setHandler({} as unknown, {
      workspacePath,
      agentId: 'agent-1',
      skillIds: ['unknown-skill'],
    })) as { success: boolean; error?: string };
    expect(setResult.success).toBe(false);
    expect(setResult.error).toContain('Unknown or unsupported MCP skill IDs');
  });

  test('memflow-status returns current memflow status', async () => {
    const { registerIpcHandlers } = await import('../../../src/main/ipc');
    await registerIpcHandlers();

    const handler = handlers.get('memflow-status');
    expect(handler).toBeTypeOf('function');
    if (!handler) throw new Error('Handler not registered');

    const result = (await handler({} as unknown)) as {
      success: boolean;
      data?: unknown;
    };
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      installed: true,
      daemonRunning: true,
      trackedProjectCount: 3,
      lastSyncedAt: '2026-07-16T12:00:00Z',
    });
  });

  test('memflow-open-link opens external link and returns success', async () => {
    const electron = await import('electron');
    const { registerIpcHandlers } = await import('../../../src/main/ipc');
    await registerIpcHandlers();

    const handler = handlers.get('memflow-open-link');
    expect(handler).toBeTypeOf('function');
    if (!handler) throw new Error('Handler not registered');

    const result = (await handler({} as unknown)) as {
      success: boolean;
      data?: { success: boolean };
    };
    expect(result.success).toBe(true);
    expect(result.data?.success).toBe(true);
    expect(electron.shell.openExternal).toHaveBeenCalledWith('https://link.maitrix.app');
  });
});
