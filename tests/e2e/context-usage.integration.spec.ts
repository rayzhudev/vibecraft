import { test, expect } from '@playwright/test';
import type { AgentModelInfo, AgentProvider, ContextUsage, TokenUsage } from '../../src/shared/types';
import { launchTestApp } from './utils';

const pickSmallModel = (provider: AgentProvider, models: AgentModelInfo[]): string => {
  const normalized = models.map((model) => ({ ...model, id: model.id.trim() })).filter((model) => model.id);
  if (normalized.length === 0) return '';
  if (provider === 'claude') {
    const haiku = normalized.find((model) => model.id.toLowerCase().includes('haiku'));
    if (haiku) return haiku.id;
  }
  const mini = normalized.find((model) => model.id.toLowerCase().includes('mini'));
  if (mini) return mini.id;
  const small = normalized.find((model) => model.id.toLowerCase().includes('small'));
  if (small) return small.id;
  return normalized[0].id;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const computeExpectedCodexPercent = (usage: TokenUsage, contextWindow: number): number | null => {
  const input = typeof usage.input_tokens === 'number' ? usage.input_tokens : null;
  const output = typeof usage.output_tokens === 'number' ? usage.output_tokens : null;
  const reasoning = typeof usage.reasoning_tokens === 'number' ? usage.reasoning_tokens : 0;
  const total = typeof usage.total_tokens === 'number' ? usage.total_tokens : null;
  let used: number | null = null;
  if (input !== null || output !== null) {
    used = (input ?? 0) + (output ?? 0) + reasoning;
  } else if (total !== null) {
    used = total + reasoning;
  }
  if (used === null || !contextWindow) return null;
  const percent = Math.round(100 - (used / contextWindow) * 100);
  return clamp(percent, 0, 100);
};

const resolveClaudeReservedOutput = (model: string): number => {
  const envValue = process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS;
  if (envValue) {
    const parsed = Number.parseInt(envValue, 10);
    if (Number.isFinite(parsed)) {
      return clamp(parsed, 1, 32_000);
    }
  }
  const normalized = model.toLowerCase();
  const isHaiku = normalized.includes('haiku');
  const isFourFive = normalized.includes('4-5') || normalized.includes('4_5') || normalized.includes('4.5');
  if (isHaiku && !isFourFive) {
    return 8_192;
  }
  return 32_000;
};

const computeExpectedClaudePercent = (
  usage: TokenUsage,
  contextWindow: number,
  model: string
): number | null => {
  if (!contextWindow) return null;
  const input = typeof usage.input_tokens === 'number' ? usage.input_tokens : 0;
  const output = typeof usage.output_tokens === 'number' ? usage.output_tokens : 0;
  const cached = typeof usage.cached_input_tokens === 'number' ? usage.cached_input_tokens : 0;
  const total = typeof usage.total_tokens === 'number' ? usage.total_tokens : null;
  const used = total !== null ? total : input + output + cached;
  const effective = Math.max(1, contextWindow - resolveClaudeReservedOutput(model));
  const percent = Math.round(((effective - used) / effective) * 100);
  return clamp(percent, 0, 100);
};

const computeExpectedFromContextUsage = (contextUsage: ContextUsage): number | null => {
  const windowSize = typeof contextUsage.context_window === 'number' ? contextUsage.context_window : null;
  if (!windowSize || windowSize <= 0) return null;
  if (typeof contextUsage.context_remaining_tokens === 'number') {
    const percent = Math.round((contextUsage.context_remaining_tokens / windowSize) * 100);
    return clamp(percent, 0, 100);
  }
  if (typeof contextUsage.context_tokens === 'number') {
    const cached =
      typeof contextUsage.context_cached_tokens === 'number' ? contextUsage.context_cached_tokens : 0;
    const used =
      cached > 0 && contextUsage.context_tokens + cached <= windowSize
        ? contextUsage.context_tokens + cached
        : contextUsage.context_tokens;
    const percent = Math.round(100 - (used / windowSize) * 100);
    return clamp(percent, 0, 100);
  }
  return null;
};

type RunResult = {
  provider: AgentProvider;
  model: string;
  agentId: string;
  contextLeft: number | null;
  contextWindow: number | null;
  usage: TokenUsage | null;
  contextUsage: ContextUsage | null;
  uiContextPercent: number | null;
  usedPercent: number | null;
};

class ProviderUnavailableError extends Error {
  provider: AgentProvider;
  state: string;

  constructor(provider: AgentProvider, state: string) {
    super(`Provider ${provider} not ready (state: ${state})`);
    this.name = 'ProviderUnavailableError';
    this.provider = provider;
    this.state = state;
  }
}

const runProviderAgent = async (
  provider: AgentProvider,
  prompts: string[],
  targetLower: number,
  targetUpper: number,
  relativePath = '.'
): Promise<RunResult> => {
  const { page, cleanup, paths } = await launchTestApp({ integrationMode: true, startInWorkspace: true });
  try {
    await page.getByTestId('workspace-canvas').waitFor({ state: 'visible', timeout: 10_000 });

    const status = await page.evaluate(async (providerId: AgentProvider) => {
      const api = window.electronAPI;
      let current = await api.agentConnectProviderStatus(providerId, { force: true });
      if (!current || current.state === 'missing') {
        await api.agentConnectProviderInstall(providerId);
        current = await api.agentConnectProviderStatus(providerId, { force: true });
      }
      return current;
    }, provider);
    if (status?.state !== 'ready') {
      throw new ProviderUnavailableError(provider, status?.state ?? 'unknown');
    }

    const models = await page.evaluate(
      async (providerId: AgentProvider) => window.electronAPI.agentConnectModelsRecent(providerId),
      provider
    );
    const model = pickSmallModel(provider, models);
    expect(model).not.toEqual('');

    const runResult = await page.evaluate(
      async ({ workspacePath, provider, model, prompts, relativePath, targetLower, targetUpper }) => {
        const api = window.electronAPI;
        const spawn = await api.spawnAgent({
          provider,
          model,
          name: `${provider}-agent`,
          displayName: `${provider}-agent`,
          color: provider === 'claude' ? '#e67100' : '#3b82f6',
          workspacePath,
          x: 220,
          y: 220,
        });
        if (!spawn.success || !spawn.agent) {
          return { error: spawn.error ?? 'Failed to spawn agent' };
        }
        const agentId = spawn.agent.id;
        const runPrompt = async (promptText: string) => {
          const run = await api.agentConnectRunAgent({
            agentId,
            workspacePath,
            relativePath,
            prompt: promptText,
          });
          if (!run.success || !run.runId) {
            throw new Error(run.error ?? 'Failed to run agent prompt');
          }
          const runId = run.runId;
          let lastUsage: TokenUsage | null = null;
          let lastContextUsage: ContextUsage | null = null;
          let resolveDone: (() => void) | null = null;
          let rejectDone: ((error: Error) => void) | null = null;
          const done = new Promise<void>((resolve, reject) => {
            resolveDone = resolve;
            rejectDone = reject;
          });
          const timeout = setTimeout(() => {
            rejectDone?.(new Error('Timed out waiting for agent run to finish'));
          }, 180_000);
          const unsubscribe = api.onAgentConnectEvent((payload) => {
            if (payload.runId !== runId || payload.unit.type !== 'agent' || payload.unit.id !== agentId) {
              return;
            }
            if (payload.event.type === 'context_usage') {
              lastContextUsage = payload.event.contextUsage;
            }
            if (payload.event.type === 'usage') {
              lastUsage = payload.event.usage;
            }
            if (payload.event.type === 'final') {
              if (payload.event.usage) {
                lastUsage = payload.event.usage;
              }
              clearTimeout(timeout);
              resolveDone?.();
            }
          });
          await done.finally(() => {
            clearTimeout(timeout);
            unsubscribe();
          });
          const agents = await api.loadAgents(workspacePath);
          const agent = agents.find((entry) => entry.id === agentId) ?? null;
          return {
            contextLeft: typeof agent?.contextLeft === 'number' ? agent.contextLeft : null,
            contextWindow: typeof agent?.contextWindow === 'number' ? agent.contextWindow : null,
            usage: lastUsage,
            contextUsage: lastContextUsage,
          };
        };

        let lastResult: {
          contextLeft: number | null;
          contextWindow: number | null;
          usage: TokenUsage | null;
          contextUsage: ContextUsage | null;
        } | null = null;
        let usedPercent: number | null = null;
        for (const promptText of prompts) {
          lastResult = await runPrompt(promptText);
          usedPercent = typeof lastResult.contextLeft === 'number' ? 100 - lastResult.contextLeft : null;
          if (usedPercent !== null && usedPercent >= targetLower && usedPercent <= targetUpper) {
            break;
          }
          if (usedPercent !== null && usedPercent > targetUpper) {
            break;
          }
        }
        if (!lastResult) {
          throw new Error('No agent runs completed');
        }
        return {
          agentId,
          model,
          ...lastResult,
          usedPercent,
        };
      },
      { workspacePath: paths.workspace, provider, model, prompts, relativePath, targetLower, targetUpper }
    );
    if (!('agentId' in runResult)) {
      throw new Error(runResult.error || 'Agent run failed');
    }
    const agentId = runResult.agentId as string;
    const agentLocator = page.locator(`[data-testid="entity-agent"][data-entity-id="${agentId}"]`);
    await agentLocator.waitFor({ state: 'visible', timeout: 10_000 });
    const rosterRow = page
      .locator('.agent-roster-overlay')
      .getByRole('button', { name: new RegExp(`${provider}-agent`, 'i') });
    if (await rosterRow.count()) {
      await rosterRow.first().click({ force: true });
    } else {
      const minimapAgent = page.getByTestId(`minimap-agent-${agentId}`);
      if (await minimapAgent.count()) {
        await minimapAgent.first().click({ force: true });
      } else {
        await agentLocator.click({ force: true });
      }
    }
    let uiContextPercent: number | null = null;
    const actionButton = page.locator('[data-testid="action-open-agent-terminal"]');
    const actionVisible = await actionButton
      .waitFor({ state: 'visible', timeout: 2_000 })
      .then(() => true)
      .catch(() => false);
    if (actionVisible) {
      await actionButton.click();
      const terminalPanel = page.locator('[data-testid="agent-terminal"]');
      await terminalPanel.waitFor({ state: 'visible', timeout: 5_000 });
      const contextText = await terminalPanel.locator('.agent-chat-context-text').innerText();
      const match = contextText.match(/(\d+)\s*%/);
      uiContextPercent = match ? Number.parseInt(match[1], 10) : null;
    }
    if (uiContextPercent === null) {
      const healthFill = rosterRow.locator('.agent-roster-health-fill');
      if (await healthFill.count()) {
        const widthStyle = await healthFill.first().evaluate((node) => node.getAttribute('style') || '');
        const widthMatch = widthStyle.match(/width:\s*([\d.]+)%/);
        if (widthMatch) {
          uiContextPercent = Math.round(Number.parseFloat(widthMatch[1]));
        }
      }
    }
    const { model: resolvedModel, ...runResultRest } = runResult;
    return { provider, model: resolvedModel, uiContextPercent, ...runResultRest } as RunResult;
  } finally {
    await cleanup();
  }
};

test('context usage stays within expected bounds for claude + codex', async () => {
  test.setTimeout(360_000);
  const resolvePercentEnv = (value: string | undefined): number | null => {
    if (!value) return null;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const resolveTargetPercent = (provider: AgentProvider): number => {
    const providerKey =
      provider === 'claude'
        ? 'VIBECRAFT_CONTEXT_USED_TARGET_PERCENT_CLAUDE'
        : 'VIBECRAFT_CONTEXT_USED_TARGET_PERCENT_CODEX';
    const providerValue = resolvePercentEnv(process.env[providerKey]);
    if (providerValue !== null) return providerValue;
    const globalValue = resolvePercentEnv(process.env.VIBECRAFT_CONTEXT_USED_TARGET_PERCENT);
    if (globalValue !== null) return globalValue;
    return provider === 'claude' ? 40 : 10;
  };
  const resolveTolerancePercent = (provider: AgentProvider): number => {
    const providerKey =
      provider === 'claude'
        ? 'VIBECRAFT_CONTEXT_USED_TOLERANCE_PERCENT_CLAUDE'
        : 'VIBECRAFT_CONTEXT_USED_TOLERANCE_PERCENT_CODEX';
    const providerValue = resolvePercentEnv(process.env[providerKey]);
    if (providerValue !== null) return providerValue;
    const globalValue = resolvePercentEnv(process.env.VIBECRAFT_CONTEXT_USED_TOLERANCE_PERCENT);
    if (globalValue !== null) return globalValue;
    return 10;
  };
  const buildTargetRange = (provider: AgentProvider) => {
    const targetUsedPercent = resolveTargetPercent(provider);
    const tolerancePercent = resolveTolerancePercent(provider);
    return {
      targetLower: clamp(targetUsedPercent - tolerancePercent, 0, 100),
      targetUpper: clamp(targetUsedPercent + tolerancePercent, 0, 100),
    };
  };

  const prompts = [
    [
      'Create a snake game using TypeScript and the HTML canvas.',
      'Include: game loop, grid system, input handling, score tracking, pause/resume, and collision rules.',
      'Keep it concise: provide a short plan and a minimal code skeleton (no more than ~80 lines).',
    ].join(' '),
    [
      'Expand the snake game with: adjustable speed, mobile-friendly controls, and a start screen.',
      'Add a short architecture overview and a list of follow-up improvements.',
      'Keep the response under ~200 words and avoid a full code listing.',
    ].join(' '),
    [
      'Add tests and edge cases for the snake game.',
      'Provide a concise test plan and 3 example unit tests.',
      'Keep the response under ~200 words.',
    ].join(' '),
  ];

  const claudeTarget = buildTargetRange('claude');
  const codexTarget = buildTargetRange('codex');
  const results: RunResult[] = [];
  for (const provider of ['claude', 'codex'] as const) {
    const range = provider === 'claude' ? claudeTarget : codexTarget;
    try {
      results.push(await runProviderAgent(provider, prompts, range.targetLower, range.targetUpper));
    } catch (error) {
      if (error instanceof ProviderUnavailableError) {
        test
          .info()
          .annotations.push({ type: 'warning', description: `Skipped ${provider}: ${error.message}` });
        continue;
      }
      throw error;
    }
  }

  expect(results.length, 'No live providers were ready for context usage integration').toBeGreaterThan(0);

  for (const result of results) {
    const range = result.provider === 'claude' ? claudeTarget : codexTarget;
    if (process.env.VIBECRAFT_CONTEXT_USAGE_DEBUG === '1') {
      console.log('context-usage-debug', {
        provider: result.provider,
        model: result.model,
        contextWindow: result.contextWindow,
        contextLeft: result.contextLeft,
        usedPercent: result.usedPercent,
        uiContextPercent: result.uiContextPercent,
        usage: result.usage,
        contextUsage: result.contextUsage,
      });
    }
    expect(result.contextLeft).not.toBeNull();
    if (result.contextLeft === null) continue;
    expect(result.contextLeft).toBeGreaterThanOrEqual(0);
    expect(result.contextLeft).toBeLessThanOrEqual(100);
    if (result.usedPercent !== null) {
      expect(result.usedPercent).toBeGreaterThanOrEqual(0);
      expect(result.usedPercent).toBeLessThanOrEqual(100);
      if (result.usedPercent < range.targetLower || result.usedPercent > range.targetUpper) {
        test.info().annotations.push({
          type: 'warning',
          description: `${result.provider} used ${result.usedPercent}% context outside target range ${range.targetLower}-${range.targetUpper}`,
        });
      }
    }
    if (result.uiContextPercent !== null) {
      expect(result.uiContextPercent).toBeGreaterThanOrEqual(0);
      expect(result.uiContextPercent).toBeLessThanOrEqual(100);
    }
  }

  const claude = results.find((result) => result.provider === 'claude');
  const codex = results.find((result) => result.provider === 'codex');

  if (claude && claude.contextLeft !== null) {
    const expectedFromUsage =
      claude.contextWindow && claude.usage
        ? computeExpectedClaudePercent(claude.usage, claude.contextWindow, claude.model)
        : null;
    const expectedFromContext = claude.contextUsage
      ? computeExpectedFromContextUsage(claude.contextUsage)
      : null;
    const candidates = [expectedFromUsage, expectedFromContext].filter(
      (value): value is number => typeof value === 'number'
    );
    if (candidates.length > 0) {
      const lower = clamp(Math.min(...candidates) - 5, 0, 100);
      const upper = clamp(Math.max(...candidates) + 5, 0, 100);
      expect(claude.contextLeft).toBeGreaterThanOrEqual(lower);
      expect(claude.contextLeft).toBeLessThanOrEqual(upper);
      if (claude.uiContextPercent !== null) {
        expect(claude.uiContextPercent).toBeGreaterThanOrEqual(lower);
        expect(claude.uiContextPercent).toBeLessThanOrEqual(upper);
      }
    }
  }

  if (codex && codex.contextLeft !== null) {
    const expectedFromUsage =
      codex.contextWindow && codex.usage
        ? computeExpectedCodexPercent(codex.usage, codex.contextWindow)
        : null;
    const expectedFromContext = codex.contextUsage
      ? computeExpectedFromContextUsage(codex.contextUsage)
      : null;
    const candidates = [expectedFromUsage, expectedFromContext].filter(
      (value): value is number => typeof value === 'number'
    );
    if (candidates.length > 0) {
      const lower = clamp(Math.min(...candidates) - 5, 0, 100);
      const upper = clamp(Math.max(...candidates) + 5, 0, 100);
      expect(codex.contextLeft).toBeGreaterThanOrEqual(lower);
      expect(codex.contextLeft).toBeLessThanOrEqual(upper);
      if (codex.uiContextPercent !== null) {
        expect(codex.uiContextPercent).toBeGreaterThanOrEqual(lower);
        expect(codex.uiContextPercent).toBeLessThanOrEqual(upper);
      }
    }
  }
});
