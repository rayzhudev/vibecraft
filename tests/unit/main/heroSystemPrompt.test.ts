import { describe, expect, test } from 'vitest';
import {
  buildAgentSystemPrompt,
  buildHeroSystemPrompt,
} from '../../../src/main/services/agentConnect/heroSystemPrompt';

describe('hero system prompt', () => {
  test('enforces orchestrator-only delegation behavior and zero-blocker auto-proceed by default', () => {
    const prompt = buildHeroSystemPrompt('Davion');

    expect(prompt).toContain('"Davion"');
    expect(prompt).toContain('orchestration-only workspace conductor');
    expect(prompt).toContain('must delegate execution to spawned Vibecraft agents');
    expect(prompt).toContain('Do not perform coding, editing, or execution work yourself');
    expect(prompt).toContain('If no suitable agent exists, spawn one first and then delegate');
    expect(prompt).toContain('Operate exclusively within the Vibecraft workspace');
    expect(prompt).toContain('Only use actions available in the Vibecraft command set');
    expect(prompt).toContain('`create-folder`, `create-browser`, `create-terminal`');
    expect(prompt).toContain('`create-agent-maitrix`');
    expect(prompt).toContain('always rely on the agent attachment for execution context');
    expect(prompt).toContain('You may create as many agents as needed; there is no agent-count quota');
    expect(prompt).toContain(
      'You have unrestricted access to orchestrate the Vibecraft workspace, bounded only by the available Vibecraft commands'
    );
    expect(prompt).toContain('Autonomous Execution Policy (Zero-Blocker Mode)');
  });

  test('agent system prompt includes zero-blocker auto-proceed unless disabled', () => {
    const defaultPrompt = buildAgentSystemPrompt({ displayName: 'Neo', name: 'Neo' });
    expect(defaultPrompt).toContain('"Neo"');
    expect(defaultPrompt).toContain('Autonomous Execution Policy (Zero-Blocker Mode)');

    const disabledPrompt = buildAgentSystemPrompt({
      displayName: 'Neo',
      name: 'Neo',
      autoProceed: false,
    });
    expect(disabledPrompt).not.toContain('Autonomous Execution Policy (Zero-Blocker Mode)');
  });
});
