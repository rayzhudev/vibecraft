import type { AbilityDescriptor } from '../components/hud/abilityBuilder';
import type { AgentProvider, TutorialState, TutorialStep } from '../../shared/types';

export const getAllowedAbilitiesForStep = (
  step: TutorialStep,
  heroProvider?: AgentProvider
): string[] | null => {
  switch (step) {
    case 'create-project':
    case 'create-project-2':
      return ['create-folder'];
    case 'rename-project':
    case 'rename-project-2':
    case 'attach-agent':
    case 'attach-agent-2':
    case 'open-global-chat':
    case 'open-global-chat-2':
    case 'send-prompt':
    case 'send-prompt-2':
      return [];
    case 'close-terminal':
      return ['open-agent-terminal'];
    case 'open-terminal':
      return ['open-agent-terminal'];
    case 'move-project':
      return [];
    case 'create-agent':
    case 'create-agent-2':
      if (heroProvider === 'codex') return ['create-agent-codex'];
      if (heroProvider === 'claude') return ['create-agent-claude'];
      if (heroProvider === 'cursor') return ['create-agent-claude'];
      return ['create-agent-claude'];
    case 'open-browser-1':
    case 'open-browser-2':
      return ['create-browser'];
    case 'focus-demo-1':
    case 'focus-demo-2':
    case 'focus-explain':
    case 'import-prompt':
      return null; // all abilities allowed during focus demo
    case 'hero-provider':
    case 'world-select':
    case 'hero-intro':
      return [];
    default:
      return null;
  }
};

export const filterAbilitiesForTutorial = (
  abilities: AbilityDescriptor[],
  allowed: string[] | null
): AbilityDescriptor[] => {
  if (!allowed) return abilities;
  if (allowed.length === 0) return [];
  return abilities.filter((ability) => allowed.includes(ability.id));
};

export const getVisibleGlobalAbilitiesForStep = (step: TutorialStep): string[] | null => {
  switch (step) {
    case 'create-project':
    case 'rename-project':
      return ['create-folder'];
    case 'create-agent':
    case 'attach-agent':
    case 'open-global-chat':
    case 'send-prompt':
      return ['create-agent-claude', 'create-folder'];
    case 'close-terminal':
    case 'open-terminal':
    case 'create-project-2':
    case 'rename-project-2':
    case 'create-agent-2':
    case 'attach-agent-2':
    case 'open-global-chat-2':
    case 'send-prompt-2':
      return ['create-agent-claude', 'create-folder', 'create-terminal'];
    case 'move-project':
      return [];
    case 'open-browser-1':
    case 'open-browser-2':
      return ['create-agent-claude', 'create-folder', 'create-terminal', 'create-browser'];
    case 'focus-demo-1':
    case 'focus-demo-2':
    case 'focus-explain':
    case 'import-prompt':
      return null; // all abilities visible
    case 'hero-provider':
    case 'world-select':
    case 'hero-intro':
      return [];
    default:
      return null;
  }
};

export const getTutorialSpotlightSelector = (
  state: TutorialState,
  options?: { heroProvider?: AgentProvider; renameState?: { folderId: string | null; dropdownOpen: boolean } }
): string | string[] | null => {
  if (state.status !== 'in_progress') return null;
  switch (state.stepId) {
    case 'create-project':
    case 'create-project-2':
      return '[data-tutorial-target="ability-create-folder"]';
    case 'create-agent':
    case 'create-agent-2':
      return '[data-tutorial-target="ability-create-agent-claude"]';
    case 'open-global-chat':
      return '[data-tutorial-target="global-chat"]';
    case 'send-prompt':
      return '[data-tutorial-target="global-chat"]';
    case 'open-global-chat-2':
      return '[data-tutorial-target="global-chat"]';
    case 'send-prompt-2':
      return '[data-tutorial-target="global-chat"]';
    case 'attach-agent': {
      const selectors: string[] = [];
      if (state.createdIds?.agentId) {
        selectors.push(`[data-entity-id="${state.createdIds.agentId}"]`);
      }
      if (state.createdIds?.folderId) {
        selectors.push(`[data-entity-id="${state.createdIds.folderId}"]`);
      }
      return selectors.length > 0 ? selectors : null;
    }
    case 'close-terminal':
      return ['[data-tutorial-target="ability-open-agent-terminal"]', '[data-testid="agent-terminal"]'];
    case 'open-terminal':
      return '[data-tutorial-target="ability-open-agent-terminal"]';
    case 'move-project':
      return '[data-tutorial-target="tutorial-move-bounds"]';
    case 'open-browser-1':
      if (state.createdIds?.browserId) {
        return null;
      }
      return '[data-tutorial-target="ability-create-browser"]';
    case 'open-browser-2':
      if (state.createdIds?.browserId2) {
        return null;
      }
      return '[data-tutorial-target="ability-create-browser"]';
    case 'rename-project':
      if (state.createdIds?.folderId) {
        return `[data-entity-id="${state.createdIds.folderId}"] .folder-label`;
      }
      return null;
    case 'rename-project-2':
      if (state.createdIds?.folderId2) {
        if (options?.renameState?.folderId !== state.createdIds.folderId2) {
          return `[data-entity-id="${state.createdIds.folderId2}"] .folder-label`;
        }
        if (
          options?.renameState?.dropdownOpen &&
          options.renameState.folderId === state.createdIds.folderId2
        ) {
          return '[data-tutorial-target="folder-rename-option-doodle-jump"]';
        }
        return `[data-entity-id="${state.createdIds.folderId2}"] .folder-rename-dropdown-btn`;
      }
      return null;
    case 'attach-agent-2': {
      const selectors: string[] = [];
      if (state.createdIds?.agentId2) {
        selectors.push(`[data-entity-id="${state.createdIds.agentId2}"]`);
      }
      if (state.createdIds?.folderId2) {
        selectors.push(`[data-entity-id="${state.createdIds.folderId2}"]`);
      }
      return selectors.length > 0 ? selectors : null;
    }
    case 'focus-demo-1':
    case 'focus-explain':
      return '.tutorial-overlay';
    case 'focus-demo-2':
      return '.hud-tab-btn'; // spotlight the Projects panel button
    case 'import-prompt':
      return null;
    case 'hero-provider':
      return null;
    case 'hero-intro':
      return ['[data-testid="entity-hero"]', '.hero-entity .unit-overhead', '.tutorial-overlay'];
    default:
      return null;
  }
};

export const getTutorialOutlineSelector = (state: TutorialState): string | string[] | null => {
  if (state.status !== 'in_progress') return null;
  switch (state.stepId) {
    case 'close-terminal':
      return '[data-tutorial-target="ability-open-agent-terminal"]';
    default:
      return null;
  }
};
