import type { AgentProvider, TutorialState, TutorialStep } from '../../shared/types';
import { isTutorialActive, TUTORIAL_PROMPT_1, TUTORIAL_PROMPT_2 } from './constants';
import {
  getAllowedAbilitiesForStep,
  getVisibleGlobalAbilitiesForStep,
  getTutorialSpotlightSelector,
  getTutorialOutlineSelector,
} from './logic';

export type TutorialAbilityPolicy = {
  enabled: boolean;
  allowedAbilities: string[] | null;
  visibleGlobalAbilities: string[] | null;
  browserCreationBlocked: boolean;
};

export type TutorialSpotlightPolicy = {
  active: boolean;
  targetSelector: string | string[] | null;
  outlineSelector: string | string[] | null;
  maskEnabled: boolean;
  outlineEnabled: boolean;
  combineTargets: boolean;
};

export type TutorialPromptStep = { promptText: string; isSecondPrompt: boolean } | null;

const OUTLINE_DISABLED_STEPS: TutorialStep[] = [
  'hero-provider',
  'hero-intro',
  'attach-agent',
  'attach-agent-2',
  'move-project',
  'open-global-chat',
  'send-prompt',
  'open-global-chat-2',
  'send-prompt-2',
  'focus-demo-1',
  'focus-demo-2',
  'focus-explain',
  'import-prompt',
];

export const getTutorialAbilityPolicy = (
  state: TutorialState,
  heroProvider?: AgentProvider
): TutorialAbilityPolicy => {
  const enabled = isTutorialActive(state);
  return {
    enabled,
    allowedAbilities: enabled ? getAllowedAbilitiesForStep(state.stepId, heroProvider) : null,
    visibleGlobalAbilities: enabled ? getVisibleGlobalAbilitiesForStep(state.stepId) : null,
    browserCreationBlocked: enabled && Boolean(state.createdIds?.browserId2),
  };
};

export const getTutorialSpotlightPolicy = (
  state: TutorialState,
  options?: { heroProvider?: AgentProvider; renameState?: { folderId: string | null; dropdownOpen: boolean } }
): TutorialSpotlightPolicy => {
  const targetSelector = getTutorialSpotlightSelector(state, options);
  const outlineSelector = getTutorialOutlineSelector(state);
  const active = isTutorialActive(state) && Boolean(targetSelector);
  const isRenameStep = state.stepId === 'rename-project' || state.stepId === 'rename-project-2';
  const maskDisabledForRename =
    state.stepId === 'rename-project' && isRenameStep && options?.renameState?.folderId;
  const maskEnabled = state.stepId !== 'open-browser-2' && !maskDisabledForRename;
  const outlineEnabled = !OUTLINE_DISABLED_STEPS.includes(state.stepId);
  const combineTargets = state.stepId === 'hero-intro';
  return {
    active,
    targetSelector,
    outlineSelector,
    maskEnabled,
    outlineEnabled,
    combineTargets,
  };
};

export const getTutorialPromptStep = (state: TutorialState): TutorialPromptStep => {
  if (state.stepId === 'open-global-chat' || state.stepId === 'send-prompt') {
    return { promptText: TUTORIAL_PROMPT_1, isSecondPrompt: false };
  }
  if (state.stepId === 'open-global-chat-2' || state.stepId === 'send-prompt-2') {
    return { promptText: TUTORIAL_PROMPT_2, isSecondPrompt: true };
  }
  return null;
};

export const getTutorialRunOptionsForAgent = (
  state: TutorialState,
  agentId: string
): { tutorialMode: boolean; tutorialScenario?: 'cookie-clicker' | 'doodle-jump' } => {
  const tutorialMode = state.status === 'in_progress';
  if (!tutorialMode) return { tutorialMode: false };
  if (agentId === state.createdIds?.agentId) {
    return { tutorialMode: true, tutorialScenario: 'cookie-clicker' };
  }
  if (agentId === state.createdIds?.agentId2) {
    return { tutorialMode: true, tutorialScenario: 'doodle-jump' };
  }
  return { tutorialMode: true };
};

export const getTutorialRunOptionsForHero = (state: TutorialState): { tutorialMode: boolean } => ({
  tutorialMode: state.status === 'in_progress',
});
