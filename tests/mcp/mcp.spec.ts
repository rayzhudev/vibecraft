import { test, expect } from '@playwright/test';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getWorkspaceStoragePath } from '../../src/main/services/storage';
import type { Folder } from '../../src/shared/types';
import { resolveIncrementalAttachSlot } from '../../src/renderer/screens/workspace/attachLayout';
import { launchTestApp } from '../e2e/utils';

type JsonRpcResponse = {
  jsonrpc: string;
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

type ToolCallResult = {
  content?: Array<{ type?: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
};

type CommandRun = {
  ok: boolean;
  error?: string;
  kind?: string;
  requestId?: string;
  results?: unknown[];
};

type LayoutToolResponse = {
  ok: boolean;
  error?: string;
  layout?: {
    agents?: Array<{ id: string; provider?: string; attachedFolderId?: string; x?: number; y?: number }>;
    folders?: Array<{ id: string; name?: string; relativePath?: string; x?: number; y?: number }>;
    browsers?: Array<{ id: string; x?: number; y?: number; url?: string }>;
    terminals?: Array<{ id: string; x?: number; y?: number; originRelativePath?: string }>;
  };
};

const postJsonRpc = async (url: string, payload: unknown): Promise<JsonRpcResponse> => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`MCP request failed: ${res.status} ${text}`);
  }
  return JSON.parse(text) as JsonRpcResponse;
};

const callTool = async (url: string, name: string, args: unknown): Promise<ToolCallResult> => {
  const res = await postJsonRpc(url, {
    jsonrpc: '2.0',
    id: `${name}-${Date.now()}`,
    method: 'tools/call',
    params: { name, arguments: args },
  });
  if (res.error) {
    throw new Error(res.error.message);
  }
  return res.result as ToolCallResult;
};

const parseStructured = <T>(result: ToolCallResult): T => {
  if (result.structuredContent && typeof result.structuredContent === 'object') {
    return result.structuredContent as T;
  }
  const text = result.content?.[0]?.text;
  if (typeof text === 'string') {
    return JSON.parse(text) as T;
  }
  throw new Error('Missing structured content');
};

test('MCP server handles core calls and a happy workflow', async () => {
  const { page, paths, cleanup } = await launchTestApp({ startInWorkspace: true });
  try {
    page.setDefaultTimeout(10_000);
    await expect(page.getByTestId('workspace-canvas')).toBeVisible();

    const startResult = await page.evaluate(
      async (workspacePath) => await window.electronAPI.startMcpServer(workspacePath),
      paths.workspace
    );

    expect(startResult.success).toBe(true);
    const host = startResult.host ?? '127.0.0.1';
    const port = startResult.port ?? 0;
    expect(port).toBeGreaterThan(0);

    const infoPath = path.join(getWorkspaceStoragePath(paths.workspace), 'mcp.json');
    const infoRaw = await fs.readFile(infoPath, 'utf8');
    const info = JSON.parse(infoRaw) as { host: string; port: number };
    expect(info.port).toBe(port);

    const url = `http://${host}:${port}`;

    const init = await postJsonRpc(url, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    expect(typeof init.result).toBe('object');

    const tools = await postJsonRpc(url, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const toolsResult = tools.result as { tools?: unknown[] } | undefined;
    expect(Array.isArray(toolsResult?.tools)).toBe(true);

    const resources = await postJsonRpc(url, { jsonrpc: '2.0', id: 3, method: 'resources/list' });
    const resourcesResult = resources.result as { resources?: unknown[] } | undefined;
    expect(Array.isArray(resourcesResult?.resources)).toBe(true);

    const read = await postJsonRpc(url, {
      jsonrpc: '2.0',
      id: 4,
      method: 'resources/read',
      params: { uri: 'vibecraft://commands' },
    });
    const readResult = read.result as { contents?: Array<{ uri?: string }> } | undefined;
    expect(readResult?.contents?.[0]?.uri).toBe('vibecraft://commands');

    const createFolder = await callTool(url, 'vibecraft.command', {
      command: { id: 'create-folder', args: { name: 'mcp-project', x: 240, y: 180 } },
    });
    const createFolderResult = parseStructured<CommandRun>(createFolder);
    expect(createFolderResult.ok).toBe(true);

    const createAgent = await callTool(url, 'vibecraft.command', {
      command: { id: 'create-agent-claude', args: { x: 360, y: 200 } },
    });
    const createAgentResult = parseStructured<CommandRun>(createAgent);
    expect(createAgentResult.ok).toBe(true);

    const layoutResult = parseStructured<LayoutToolResponse>(await callTool(url, 'vibecraft.layout', {}));
    expect(layoutResult.ok).toBe(true);
    const agents = layoutResult.layout?.agents ?? [];
    const folders = layoutResult.layout?.folders ?? [];
    expect(agents.length).toBeGreaterThan(0);
    expect(folders.length).toBeGreaterThan(0);

    const folder =
      folders.find((entry) => entry.relativePath === 'mcp-project' || entry.name === 'mcp-project') ??
      folders[0];
    const agent = agents.find((entry) => entry.provider === 'claude') ?? agents[0];
    expect(folder?.id).toBeTruthy();
    expect(agent?.id).toBeTruthy();
    if (!folder || !agent) {
      throw new Error('Expected MCP layout to include created folder and agent');
    }

    const folderPath = path.join(paths.workspace, folder.relativePath ?? folder.name ?? 'mcp-project');
    const folderStats = await fs.stat(folderPath);
    expect(folderStats.isDirectory()).toBe(true);

    const moveFolder = await callTool(url, 'vibecraft.command', {
      command: { id: 'move-folder', args: { folderId: folder.id, x: 520, y: 420 } },
    });
    const moveFolderResult = parseStructured<CommandRun>(moveFolder);
    expect(moveFolderResult.ok).toBe(true);

    const moveAgent = await callTool(url, 'vibecraft.command', {
      command: { id: 'move-agent', args: { agentId: agent.id, x: 560, y: 440 } },
    });
    const moveAgentResult = parseStructured<CommandRun>(moveAgent);
    expect(moveAgentResult.ok).toBe(true);

    const createBrowser = await callTool(url, 'vibecraft.command', {
      command: { id: 'create-browser', args: { x: 640, y: 220 } },
    });
    const createBrowserResult = parseStructured<CommandRun>(createBrowser);
    expect(createBrowserResult.ok).toBe(true);

    const createTerminal = await callTool(url, 'vibecraft.command', {
      command: { id: 'create-terminal', args: { path: '.', x: 160, y: 320 } },
    });
    const createTerminalResult = parseStructured<CommandRun>(createTerminal);
    expect(createTerminalResult.ok).toBe(true);

    const attach = await callTool(url, 'vibecraft.command', {
      command: { id: 'attach-folder', args: { folderId: folder.id, agentId: agent.id } },
    });
    const attachResult = parseStructured<CommandRun>(attach);
    expect(attachResult.ok).toBe(true);

    const layoutAfter = parseStructured<LayoutToolResponse>(await callTool(url, 'vibecraft.layout', {}));
    expect(layoutAfter.ok).toBe(true);
    const updatedAgent = layoutAfter.layout?.agents?.find((entry) => entry.id === agent.id);
    const updatedFolder = layoutAfter.layout?.folders?.find((entry) => entry.id === folder.id);
    expect(updatedAgent?.attachedFolderId).toBe(folder.id);
    expect(updatedAgent).toMatchObject({ id: agent.id, provider: agent.provider });
    expect(updatedFolder).toMatchObject({ id: folder.id });
    if (
      updatedFolder &&
      updatedAgent &&
      typeof updatedFolder.x === 'number' &&
      typeof updatedFolder.y === 'number' &&
      typeof updatedAgent.x === 'number' &&
      typeof updatedAgent.y === 'number'
    ) {
      const folderForSnap: Folder = {
        kind: 'folder',
        id: updatedFolder.id,
        name: updatedFolder.name ?? 'mcp-project',
        relativePath: updatedFolder.relativePath ?? 'mcp-project',
        x: updatedFolder.x,
        y: updatedFolder.y,
        createdAt: Date.now(),
      };
      const incrementalSlot = resolveIncrementalAttachSlot(folderForSnap, { x: 560, y: 440 }, []);
      expect(incrementalSlot).not.toBeNull();
      const expectedPos = incrementalSlot!.position;
      expect(updatedAgent.x).toBeCloseTo(expectedPos.x, 3);
      expect(updatedAgent.y).toBeCloseTo(expectedPos.y, 3);
    }
    if (updatedFolder) {
      expect(updatedFolder.x).toBe(520);
      expect(updatedFolder.y).toBe(420);
    }

    const browser = layoutAfter.layout?.browsers?.find((entry) => entry.x === 640 && entry.y === 220);
    expect(browser?.id).toBeTruthy();

    const terminal = layoutAfter.layout?.terminals?.find((entry) => entry.x === 160 && entry.y === 320);
    expect(terminal?.id).toBeTruthy();

    await page.evaluate(
      async (workspacePath) => await window.electronAPI.stopMcpServer(workspacePath),
      paths.workspace
    );

    const infoExists = await fs
      .stat(infoPath)
      .then(() => true)
      .catch(() => false);
    expect(infoExists).toBe(false);
  } finally {
    await cleanup();
  }
});
