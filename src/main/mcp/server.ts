import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { CommandBatchItem, CommandInvocation, CommandRunResponse } from '../../shared/commands';
import { logger } from '../logger';
import { getWorkspaceStoragePath } from '../services/storage';
import { APP_VERSION } from '../services/appVersion';
import { notifyWorkspaceActive, notifyWorkspaceClosed } from '../services/memflowBridge';
import { runCommandTool, runCommandsTool } from './commandTools';
import { requestWorkspaceLayout } from '../layoutBridge';
import { COMMAND_METADATA, COMMAND_IDS, COMMANDS_BY_CATEGORY } from './commandMetadata';

type JsonRpcId = string | number | null;
type JsonRpcRequest = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
};

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

type McpServerInfo = {
  host: string;
  port: number;
  workspacePath: string;
};

const log = logger.scope('mcp-server');
const JSONRPC_VERSION = '2.0';
const DEFAULT_PORT = 3333;
const DEFAULT_PORT_RANGE = 10;
const MAX_BODY_BYTES = 256 * 1024;
const MCP_INFO_FILE = 'mcp.json';
const PROTOCOL_VERSION = '2025-06-18';

let activeServer: http.Server | null = null;
let activeServerInfo: McpServerInfo | null = null;

export async function startWorkspaceMcpServer(workspacePath: string): Promise<McpServerInfo> {
  if (activeServerInfo?.workspacePath === workspacePath && activeServer) {
    return activeServerInfo;
  }

  await stopWorkspaceMcpServer();

  const host = getHost();
  const basePort = getBasePort();
  const maxAttempts = getPortAttempts();
  const { server, port } = await listenWithFallback({
    host,
    workspacePath,
    port: basePort,
    attempts: maxAttempts,
  });

  activeServer = server;
  activeServerInfo = { host, port, workspacePath };
  writeMcpInfo(activeServerInfo);
  notifyWorkspaceActive(workspacePath, { host, port });

  log.info('MCP server started', { host, port, workspacePath });
  return activeServerInfo;
}

export async function stopWorkspaceMcpServer(workspacePath?: string): Promise<void> {
  if (!activeServerInfo || !activeServer) return;
  if (workspacePath && activeServerInfo.workspacePath !== workspacePath) return;

  const { host, port, workspacePath: activePath } = activeServerInfo;
  await closeServer(activeServer);
  activeServer = null;
  activeServerInfo = null;
  clearMcpInfo(activePath);
  notifyWorkspaceClosed(activePath);
  log.info('MCP server stopped', { host, port, workspacePath: activePath });
}

export function getActiveMcpServerInfo(): McpServerInfo | null {
  return activeServerInfo;
}

const listenWithFallback = async ({
  host,
  workspacePath,
  port,
  attempts,
}: {
  host: string;
  workspacePath: string;
  port: number;
  attempts: number;
}): Promise<{ server: http.Server; port: number }> => {
  let lastError: Error | null = null;
  for (let offset = 0; offset < attempts; offset += 1) {
    const candidate = port + offset;
    const server = createServer(workspacePath);
    try {
      await listenOnPort(server, host, candidate);
      return { server, port: candidate };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      lastError = err;
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EADDRINUSE' && code !== 'EACCES') {
        await closeServer(server);
        throw err;
      }
      await closeServer(server);
    }
  }
  throw lastError ?? new Error('No available MCP port');
};

const createServer = (workspacePath: string): http.Server => {
  return http.createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Use POST with JSON-RPC payload' }));
      return;
    }

    let body = '';
    let responseSent = false;

    req.on('data', (chunk) => {
      if (responseSent) return;
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        responseSent = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(toErrorResponse(null, -32600, 'Invalid Request', 'Payload too large')));
        req.destroy();
      }
    });

    req.on('end', () => {
      if (responseSent) return;
      void handleJsonRpc(body, workspacePath)
        .then((response) => {
          if (!response) {
            res.writeHead(204);
            res.end();
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(toErrorResponse(null, -32603, 'Internal error', message)));
        });
    });
  });
};

const handleJsonRpc = async (
  payload: string,
  workspacePath: string
): Promise<JsonRpcResponse | JsonRpcResponse[] | null> => {
  let message: unknown;
  try {
    message = JSON.parse(payload);
  } catch (error) {
    return toErrorResponse(null, -32700, 'Parse error', error instanceof Error ? error.message : undefined);
  }

  if (Array.isArray(message)) {
    const responses = await Promise.all(message.map((item) => handleJsonRpcMessage(item, workspacePath)));
    const filtered = responses.filter((response): response is JsonRpcResponse => response !== null);
    return filtered.length > 0 ? filtered : null;
  }

  return handleJsonRpcMessage(message, workspacePath);
};

const handleJsonRpcMessage = async (
  message: unknown,
  workspacePath: string
): Promise<JsonRpcResponse | null> => {
  if (!message || typeof message !== 'object') {
    return toErrorResponse(null, -32600, 'Invalid Request');
  }

  const req = message as JsonRpcRequest;
  const method = req.method;
  const id = req.id ?? null;

  if (req.jsonrpc && req.jsonrpc !== JSONRPC_VERSION) {
    return toErrorResponse(id, -32600, 'Invalid Request', 'Invalid jsonrpc version');
  }

  if (!method || typeof method !== 'string') {
    return toErrorResponse(id, -32600, 'Invalid Request', 'Missing method');
  }

  if (method.startsWith('notifications/')) {
    return null;
  }

  switch (method) {
    case 'initialize':
      return toResultResponse(id, buildInitializeResult());
    case 'tools/list':
      return toResultResponse(id, buildToolsList());
    case 'tools/call':
      return handleToolCall(id, req.params, workspacePath);
    case 'resources/list':
      return toResultResponse(id, buildResourcesList());
    case 'resources/read':
      return handleResourceRead(id, req.params);
    default:
      return toErrorResponse(id, -32601, 'Method not found');
  }
};

const handleToolCall = async (
  id: JsonRpcId,
  params: unknown,
  workspacePath: string
): Promise<JsonRpcResponse> => {
  if (!params || typeof params !== 'object') {
    return toErrorResponse(id, -32602, 'Invalid params', 'Missing params');
  }

  const { name, arguments: args } = params as { name?: unknown; arguments?: unknown };
  if (typeof name !== 'string') {
    return toErrorResponse(id, -32602, 'Invalid params', 'Tool name required');
  }

  try {
    switch (name) {
      case 'vibecraft.command': {
        const payload = parseCommandArgs(args);
        const response = await runCommandTool({ workspacePath, command: payload.command });
        return toResultResponse(id, buildToolResult(response));
      }
      case 'vibecraft.command_batch':
      case 'vibecraft.batch': {
        const payload = parseCommandBatchArgs(args);
        const response = await runCommandsTool({ workspacePath, commands: payload.commands });
        return toResultResponse(id, buildToolResult(response));
      }
      case 'vibecraft.layout': {
        const response = await requestWorkspaceLayout(workspacePath);
        return toResultResponse(id, buildLayoutToolResult(response));
      }
      case 'vibecraft.commands': {
        return toResultResponse(id, buildCommandsDiscoveryResult());
      }
      default:
        return toErrorResponse(id, -32601, 'Method not found', `Unknown tool: ${name}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (name === 'vibecraft.layout') {
      return toResultResponse(id, buildLayoutToolResult({ requestId: '', ok: false, error: message }));
    }
    return toResultResponse(
      id,
      buildToolResult({ ok: false, kind: 'single', requestId: '', error: message })
    );
  }
};

const parseCommandArgs = (args: unknown): { command: CommandInvocation } => {
  if (!args || typeof args !== 'object') {
    throw new Error('arguments must be an object');
  }
  const command = (args as { command?: unknown }).command;
  if (!command || typeof command !== 'object') {
    throw new Error('command is required');
  }
  if (typeof (command as CommandInvocation).id !== 'string') {
    throw new Error('command.id is required');
  }
  return { command: command as CommandInvocation };
};

const parseCommandBatchArgs = (args: unknown): { commands: CommandBatchItem[] } => {
  if (!args || typeof args !== 'object') {
    throw new Error('arguments must be an object');
  }
  const commands = (args as { commands?: unknown }).commands;
  if (!Array.isArray(commands)) {
    throw new Error('commands must be an array');
  }
  return { commands: commands as CommandBatchItem[] };
};

const buildInitializeResult = () => {
  return {
    protocolVersion: PROTOCOL_VERSION,
    serverInfo: {
      name: 'vibecraft',
      title: 'VibeCraft',
      version: APP_VERSION,
    },
    capabilities: {
      tools: {
        listChanged: false,
      },
      resources: {
        subscribe: false,
        listChanged: false,
      },
    },
  };
};

const buildToolsList = () => {
  return {
    tools: [
      {
        name: 'vibecraft.commands',
        title: 'Discover Available Commands',
        description:
          'Get comprehensive documentation of all available VibeCraft commands with schemas, examples, and argument details. Use this first to discover what commands you can run.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'vibecraft.command',
        title: 'Run VibeCraft Command',
        description: `Execute a single command in the VibeCraft workspace. Commands control agents, folders, browsers, terminals, and the workspace layout.

Use the 'vibecraft.commands' tool first to discover all available commands and their arguments.

Common command patterns:
- Agent operations: create-agent-claude, attach-folder, open-agent-terminal, destroy-agent
- Folder operations: create-folder, rename-folder, move-folder, delete-folder
- Browser operations: create-browser, move-browser, resize-browser, refresh-browser
- Terminal operations: create-terminal, move-terminal, delete-terminal
- Worktree operations: create-worktree, worktree-sync, worktree-merge

When IDs are omitted, the currently selected entity is used (if applicable).`,
        inputSchema: {
          type: 'object',
          properties: {
            command: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  enum: COMMAND_IDS,
                  description:
                    'Command identifier - use vibecraft.commands tool to see all available commands',
                },
                args: {
                  type: 'object',
                  description:
                    'Command-specific arguments (varies by command - see vibecraft.commands for details)',
                },
                source: {
                  type: 'string',
                  enum: ['ui', 'mcp', 'shortcut'],
                  description: 'Source of the command (use "mcp" for programmatic access)',
                },
              },
              required: ['id'],
            },
          },
          required: ['command'],
        },
      },
      {
        name: 'vibecraft.batch',
        title: 'Run VibeCraft Command Batch',
        description:
          'Execute multiple commands in sequence. All commands share the same structure as vibecraft.command. Use this to perform multiple operations atomically.',
        inputSchema: {
          type: 'object',
          properties: {
            commands: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: {
                    type: 'string',
                    enum: COMMAND_IDS,
                  },
                  args: {
                    type: 'object',
                  },
                },
                required: ['id'],
              },
              description: 'Array of commands to execute in order',
            },
          },
          required: ['commands'],
        },
      },
      {
        name: 'vibecraft.layout',
        title: 'Get Workspace Layout',
        description:
          'Retrieve the current workspace layout including all entities (agents, folders, browsers, terminals), their positions, states, and relationships. Use this to understand the current workspace state before issuing commands.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ],
  };
};

const buildToolResult = (response: CommandRunResponse) => {
  const text = JSON.stringify(response, null, 2);
  return {
    content: [{ type: 'text', text }],
    structuredContent: response,
    isError: response.ok === false ? true : undefined,
  };
};

const buildLayoutToolResult = (response: Awaited<ReturnType<typeof requestWorkspaceLayout>>) => {
  const text = JSON.stringify(response, null, 2);
  return {
    content: [{ type: 'text', text }],
    structuredContent: response,
    isError: response.ok === false ? true : undefined,
  };
};

const buildResourcesList = () => {
  return {
    resources: [
      {
        uri: 'vibecraft://commands',
        name: 'Command Reference',
        description: 'Complete documentation of all VibeCraft commands with schemas and examples',
        mimeType: 'application/json',
      },
    ],
  };
};

const handleResourceRead = (id: JsonRpcId, params: unknown): JsonRpcResponse => {
  if (!params || typeof params !== 'object') {
    return toErrorResponse(id, -32602, 'Invalid params', 'Missing params');
  }
  const uri = (params as { uri?: unknown }).uri;
  if (typeof uri !== 'string') {
    return toErrorResponse(id, -32602, 'Invalid params', 'Resource uri required');
  }
  if (uri !== 'vibecraft://commands') {
    return toErrorResponse(id, -32602, 'Invalid params', `Unknown resource: ${uri}`);
  }
  return toResultResponse(id, buildCommandsResource());
};

const buildCommandsResource = () => {
  return {
    contents: [
      {
        uri: 'vibecraft://commands',
        mimeType: 'application/json',
        text: JSON.stringify(
          {
            commands: COMMAND_METADATA,
            commandsByCategory: COMMANDS_BY_CATEGORY,
          },
          null,
          2
        ),
      },
    ],
  };
};

const buildCommandsDiscoveryResult = () => {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            commands: COMMAND_METADATA.map((cmd) => ({
              id: cmd.id,
              title: cmd.title,
              description: cmd.description,
              category: cmd.category,
              args: cmd.args,
              example: cmd.example,
            })),
            commandsByCategory: COMMANDS_BY_CATEGORY,
            totalCommands: COMMAND_METADATA.length,
            usage: {
              singleCommand: {
                tool: 'vibecraft.command',
                example: {
                  command: {
                    id: 'create-agent-claude',
                    args: { x: 400, y: 300 },
                    source: 'mcp',
                  },
                },
              },
              batchCommands: {
                tool: 'vibecraft.batch',
                example: {
                  commands: [
                    { id: 'create-folder', args: { name: 'my-project', x: 300, y: 200 } },
                    { id: 'create-agent-claude', args: { x: 500, y: 300 } },
                  ],
                },
              },
            },
          },
          null,
          2
        ),
      },
    ],
    structuredContent: {
      commands: COMMAND_METADATA,
      commandsByCategory: COMMANDS_BY_CATEGORY,
    },
  };
};

const toResultResponse = (id: JsonRpcId, result: unknown): JsonRpcResponse => ({
  jsonrpc: JSONRPC_VERSION,
  id,
  result,
});

const toErrorResponse = (id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse => ({
  jsonrpc: JSONRPC_VERSION,
  id,
  error: data !== undefined ? { code, message, data } : { code, message },
});

const getHost = (): string => {
  const host = process.env.MCP_HOST?.trim();
  return host && host.length > 0 ? host : '127.0.0.1';
};

const getBasePort = (): number => {
  const raw = process.env.MCP_PORT?.trim();
  if (!raw) return DEFAULT_PORT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_PORT;
  return Math.trunc(parsed);
};

const getPortAttempts = (): number => {
  const strict = process.env.MCP_PORT_STRICT?.trim();
  if (strict === '1' || strict === 'true') return 1;
  const raw = process.env.MCP_PORT_RANGE?.trim();
  if (!raw) return DEFAULT_PORT_RANGE;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PORT_RANGE;
  return Math.trunc(parsed);
};

const listenOnPort = (server: http.Server, host: string, port: number): Promise<void> => {
  return new Promise((resolve, reject) => {
    const handleError = (error: Error) => {
      server.off('listening', handleListening);
      reject(error);
    };
    const handleListening = () => {
      server.off('error', handleError);
      resolve();
    };
    server.once('error', handleError);
    server.once('listening', handleListening);
    server.listen(port, host);
  });
};

const closeServer = (server: http.Server): Promise<void> => {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
};

const writeMcpInfo = (info: McpServerInfo): void => {
  try {
    const dir = getWorkspaceStoragePath(info.workspacePath);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, MCP_INFO_FILE);
    fs.writeFileSync(
      filePath,
      JSON.stringify({ host: info.host, port: info.port, workspacePath: info.workspacePath }, null, 2),
      'utf8'
    );
  } catch (error) {
    log.warn('Failed to write MCP info', { error: String(error) });
  }
};

const clearMcpInfo = (workspacePath: string): void => {
  try {
    const filePath = path.join(getWorkspaceStoragePath(workspacePath), MCP_INFO_FILE);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    log.warn('Failed to remove MCP info', { error: String(error) });
  }
};
