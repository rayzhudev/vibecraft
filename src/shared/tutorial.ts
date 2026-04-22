import type { TutorialState, TutorialStep, TutorialStatus } from './types';

export const TUTORIAL_WORLD_NAME = 'Tutorial';
export const TUTORIAL_WORLD_ID = 'tutorial-world';
export const TUTORIAL_PROMPT_1 = 'Create a cookie clicker website and run it on port 3000';
export const TUTORIAL_PROMPT_2 = 'Run this website on port 3001';
export const TUTORIAL_BROWSER_URL_1 = 'http://localhost:3000';
export const TUTORIAL_BROWSER_URL_2 = 'http://localhost:3001';

export const DEFAULT_TUTORIAL_STATE: TutorialState = {
  status: 'not_started',
  stepId: 'world-select',
  version: 1,
};

export const TUTORIAL_STATUSES: TutorialStatus[] = ['not_started', 'in_progress', 'completed'];

export const TUTORIAL_STEPS: TutorialStep[] = [
  'world-select',
  'hero-provider',
  'hero-intro',
  'create-project',
  'rename-project',
  'create-agent',
  'attach-agent',
  'open-global-chat',
  'send-prompt',
  'open-terminal',
  'close-terminal',
  'move-project',
  'create-project-2',
  'rename-project-2',
  'create-agent-2',
  'attach-agent-2',
  'open-global-chat-2',
  'send-prompt-2',
  'open-browser-1',
  'open-browser-2',
  'focus-demo-1',
  'focus-demo-2',
  'focus-explain',
  'import-prompt',
  'done',
];

export const TUTORIAL_STEP_LABELS: Record<TutorialStep, string> = {
  'world-select': 'Choose Tutorial World',
  'hero-provider': 'Select Provider',
  'hero-intro': 'Meet Davion',
  'create-project': 'Create Your First Project',
  'rename-project': 'Rename the Project',
  'create-agent': 'Create an Agent',
  'attach-agent': 'Attach the Agent',
  'open-global-chat': 'Open Global Chat',
  'send-prompt': 'Send the First Prompt',
  'open-terminal': 'Open the Agent Terminal',
  'close-terminal': 'Close the Agent Terminal',
  'move-project': 'Move the Project',
  'create-project-2': 'Create Another Project',
  'rename-project-2': 'Import the Existing Project',
  'create-agent-2': 'Create a Second Agent',
  'attach-agent-2': 'Attach the Second Agent',
  'open-global-chat-2': 'Open Global Chat Again',
  'send-prompt-2': 'Send the Second Prompt',
  'open-browser-1': 'Open Cookie Clicker',
  'open-browser-2': 'Open Doodle Jump',
  'focus-demo-1': 'See Focus Mode',
  'focus-demo-2': 'Add Another Project to Focus',
  'focus-explain': 'Wrap Up Focus Mode',
  'import-prompt': 'Import Prior Projects',
  done: 'Tutorial Complete',
};

const TRACKED_TUTORIAL_STEPS = TUTORIAL_STEPS.filter((step) => step !== 'world-select' && step !== 'done');

export const isTutorialActive = (state?: TutorialState | null): boolean =>
  Boolean(state && state.status === 'in_progress');

export const isTutorialStep = (state: TutorialState, step: TutorialStep): boolean =>
  state.status === 'in_progress' && state.stepId === step;

export const getTutorialStepLabel = (step: TutorialStep): string => TUTORIAL_STEP_LABELS[step];

export const getTutorialProgress = (
  state?: TutorialState | null
): { current: number; total: number; label: string } | null => {
  if (!state || state.status !== 'in_progress') return null;
  if (state.stepId === 'world-select') return null;
  if (state.stepId === 'done') {
    return {
      current: TRACKED_TUTORIAL_STEPS.length,
      total: TRACKED_TUTORIAL_STEPS.length,
      label: getTutorialStepLabel('done'),
    };
  }
  const index = TRACKED_TUTORIAL_STEPS.indexOf(state.stepId);
  if (index === -1) return null;
  return {
    current: index + 1,
    total: TRACKED_TUTORIAL_STEPS.length,
    label: getTutorialStepLabel(state.stepId),
  };
};
