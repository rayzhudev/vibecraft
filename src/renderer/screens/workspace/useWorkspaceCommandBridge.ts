import { useCallback, useEffect, useRef } from 'react';
import type { LayoutRequest, LayoutResponse } from '../../../shared/layout';
import type { AgentProvider } from '../../../shared/types';
import type {
  CommandContext,
  CommandHandlers,
  CommandInvocation,
  CommandRunRequest,
  CommandRunResponse,
  CommandRunResult,
} from '../../commands/registry';
import { runCommand, runCommandBatch } from '../../commands/registry';
import { useSoundPlayer } from '../../hooks/useSoundPlayer';
import { toCommandSoundEventId } from '../../services/sfx';

interface UseWorkspaceCommandBridgeParams {
  workspacePath: string;
  context: CommandContext;
  handlers: CommandHandlers;
}

const getAgentIdFromInvocation = (invocation: CommandInvocation): string | undefined => {
  if (!invocation.args || typeof invocation.args !== 'object') return undefined;
  const value = (invocation.args as { agentId?: unknown }).agentId;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

const resolveCommandProvider = (
  invocation: CommandInvocation,
  context: CommandContext
): AgentProvider | undefined => {
  if (invocation.id === 'create-agent-claude') return 'claude';
  if (invocation.id === 'create-agent-codex') return 'codex';
  if (invocation.id === 'create-agent-google') return 'google';
  if (invocation.id !== 'agent-send-prompt' && invocation.id !== 'destroy-agent') return undefined;
  const agentId = getAgentIdFromInvocation(invocation);
  if (!agentId) return undefined;
  return context.agents.find((agent) => agent.id === agentId)?.provider;
};

export function useWorkspaceCommandBridge({
  workspacePath,
  context,
  handlers,
}: UseWorkspaceCommandBridgeParams) {
  const { playSound } = useSoundPlayer();
  const commandContextRef = useRef<CommandContext | null>(null);
  const commandHandlersRef = useRef<CommandHandlers | null>(null);
  const workspacePathRef = useRef<string>(workspacePath);
  const playCommandSoundRef = useRef<
    (invocation: CommandInvocation, result: CommandRunResult, provider?: AgentProvider) => void
  >(() => {});

  useEffect(() => {
    workspacePathRef.current = workspacePath;
  }, [workspacePath]);

  useEffect(() => {
    commandContextRef.current = context;
    commandHandlersRef.current = handlers;
  }, [context, handlers]);

  useEffect(() => {
    playCommandSoundRef.current = (
      invocation: CommandInvocation,
      result: CommandRunResult,
      provider?: AgentProvider
    ) => {
      if (!result.ok) return;
      playSound(toCommandSoundEventId(invocation.id), { provider });
    };
  }, [playSound]);

  const runCommandWithContext = useCallback(async (command: CommandInvocation): Promise<CommandRunResult> => {
    const currentContext = commandContextRef.current;
    const currentHandlers = commandHandlersRef.current;
    if (!currentContext || !currentHandlers) {
      return { ok: false, error: 'Command bridge not ready' };
    }
    const provider = resolveCommandProvider(command, currentContext);
    const result = await runCommand(command, currentContext, currentHandlers);
    playCommandSoundRef.current(command, result, provider);
    return result;
  }, []);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onCommandRunRequest(async (request: CommandRunRequest) => {
      const currentContext = commandContextRef.current;
      const currentHandlers = commandHandlersRef.current;
      const waitForRendererUpdates = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

      if (!currentContext || !currentHandlers) {
        const errorResponse: CommandRunResponse =
          request.kind === 'batch'
            ? {
                kind: 'batch',
                requestId: request.requestId,
                ok: false,
                error: 'Command bridge not ready',
                results: [],
              }
            : {
                kind: 'single',
                requestId: request.requestId,
                ok: false,
                error: 'Command bridge not ready',
              };
        window.electronAPI.sendCommandRunResponse(errorResponse);
        return;
      }

      if (request.workspacePath !== workspacePathRef.current) {
        const errorResponse: CommandRunResponse =
          request.kind === 'batch'
            ? {
                kind: 'batch',
                requestId: request.requestId,
                ok: false,
                error: 'Workspace path mismatch',
                results: [],
              }
            : {
                kind: 'single',
                requestId: request.requestId,
                ok: false,
                error: 'Workspace path mismatch',
              };
        window.electronAPI.sendCommandRunResponse(errorResponse);
        return;
      }

      try {
        if (request.kind === 'batch') {
          const providers = request.commands.map((invocation) =>
            resolveCommandProvider(invocation, currentContext)
          );
          const results = await runCommandBatch(request.commands, currentContext, currentHandlers);
          results.forEach((result, index) => {
            const invocation = request.commands[index];
            if (!invocation) return;
            playCommandSoundRef.current(invocation, { ok: result.ok, error: result.error }, providers[index]);
          });
          await waitForRendererUpdates();
          window.electronAPI.sendCommandRunResponse({
            kind: 'batch',
            requestId: request.requestId,
            ok: results.every((result) => result.ok),
            results,
          });
          return;
        }

        const provider = resolveCommandProvider(request.command, currentContext);
        const result = await runCommand(request.command, currentContext, currentHandlers);
        playCommandSoundRef.current(request.command, result, provider);
        await waitForRendererUpdates();
        window.electronAPI.sendCommandRunResponse({
          kind: 'single',
          requestId: request.requestId,
          ok: result.ok,
          error: result.error,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const errorResponse: CommandRunResponse =
          request.kind === 'batch'
            ? {
                kind: 'batch',
                requestId: request.requestId,
                ok: false,
                error: message,
                results: [],
              }
            : {
                kind: 'single',
                requestId: request.requestId,
                ok: false,
                error: message,
              };
        window.electronAPI.sendCommandRunResponse(errorResponse);
      }
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onLayoutRequest((request: LayoutRequest) => {
      const currentContext = commandContextRef.current;
      const response: LayoutResponse =
        request.workspacePath !== workspacePathRef.current
          ? { requestId: request.requestId, ok: false, error: 'Workspace path mismatch' }
          : currentContext
            ? {
                requestId: request.requestId,
                ok: true,
                layout: {
                  hero: currentContext.hero,
                  agents: currentContext.agents,
                  folders: currentContext.folders,
                  browsers: currentContext.browsers,
                  terminals: currentContext.terminals,
                },
              }
            : { requestId: request.requestId, ok: false, error: 'Layout not ready' };

      window.electronAPI.sendLayoutResponse(response);
    });

    return unsubscribe;
  }, []);

  return { runCommandWithContext };
}
