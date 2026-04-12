import { useLayoutEffect, useRef, useState } from 'react';
import type { TutorialState } from '../../shared/types';
import { isTutorialActive } from '../tutorial/constants';

type StepCopy = { title: string; body: string };

const STEP_COPY: Record<string, StepCopy> = {
  'hero-intro': {
    title: "Hi, I'm Davion.",
    body: "I'll be your guide to VibeCraft. Click anywhere or press (Enter) to proceed.",
  },
  'create-project': {
    title: 'Create a Project',
    body: 'Activate the project ability to create a folder in this workspace. This represents a folder in your local file system.',
  },
  'rename-project': {
    title: 'Rename the Project',
    body: 'New folders are created with automatically generated names. Rename the folder to "cookie-clicker" by clicking on the folder name.',
  },
  'create-agent': {
    title: 'Create an Agent',
    body: "Now it's time to create an agent. Spawn your coding agent by clicking or activating the hotkey (1). This is the equivalent of running the coding agent in your terminal.",
  },
  'attach-agent': {
    title: 'Attach the Agent',
    body: 'Use your mouse to drag the agent to the folder to attach it. Attaching an agent gives it access to work in that project.',
  },
  'open-global-chat': {
    title: 'Open Global Chat',
    body: 'Press Enter to open the global chat. You can use the global chat to send prompts to agents.',
  },
  'send-prompt': {
    title: 'Send the Prompt',
    body: 'Press Enter to instruct your agent to build a cookie clicker website.',
  },
  'open-terminal': {
    title: 'Open the Agent Terminal',
    body: 'You can view the detailed activity of an agent by opening the agent terminal.',
  },
  'close-terminal': {
    title: 'Close the Agent Terminal',
    body: 'Close the Agent Terminal so we can get started on another project.',
  },
  'move-project': {
    title: 'Move the Cookie Clicker Folder',
    body: 'Drag the cookie-clicker folder into the highlighted zone on the map.',
  },
  'create-project-2': {
    title: 'Import An Existing Project',
    body: "Now we're going to import an existing project that I've prepared earlier. To import a project, first we have to create a project like we did before.",
  },
  'rename-project-2': {
    title: 'Import the Project',
    body: 'Click the dropdown to see the list of other folders in this workspace. Then choose the existing "doodle-jump" folder.',
  },
  'create-agent-2': {
    title: 'Create Another Agent',
    body: 'Spawn a second coding agent for the imported doodle jump project.',
  },
  'attach-agent-2': {
    title: 'Attach the Agent',
    body: 'Drag the agent onto the imported doodle-jump folder.',
  },
  'open-global-chat-2': {
    title: 'Open Global Chat',
    body: 'Press Enter to open the global chat again.',
  },
  'send-prompt-2': {
    title: 'Send the Prompt',
    body: 'Press Enter to instruct your agent to run the website on port 3001.',
  },
  'open-browser-1': {
    title: 'Open the Cookie Clicker App',
    body: 'Create a browser so we can see the cookie clicker website that we made with our first agent.',
  },
  'open-browser-2': {
    title: 'Open the Doodle Jump App',
    body: 'Create another browser to play the doodle jump game we imported.',
  },
  'focus-demo-1': {
    title: 'Project Focus Mode',
    body: 'Notice how all your cookie-clicker windows are now organized in one focused view. Click anywhere or press (Enter) to continue.',
  },
  'focus-demo-2': {
    title: 'Add Another Project',
    body: 'Now click the doodle-jump project in the Projects panel on the left to add it to your focused view.',
  },
  'focus-explain': {
    title: 'Focus Made Simple',
    body: 'When you have many projects, Focus Mode lets you zero in on one or more at a time — all their windows, neatly organized. Click anywhere to wrap up.',
  },
};

type Position = {
  top?: string;
  bottom?: string;
  left?: string;
  right?: string;
};

const HERO_TOOLTIP_GAP_PX = 24;
const HERO_TOOLTIP_OFFSET_X_PX = -32;
const HERO_TOOLTIP_OFFSET_Y_PX = -48;

export default function TutorialOverlay({
  tutorialState,
  dismissedStepId,
}: {
  tutorialState: TutorialState;
  dismissedStepId?: string | null;
}) {
  const stepId = tutorialState.stepId;
  const fallbackCopy = STEP_COPY[stepId];
  const shouldRender =
    isTutorialActive(tutorialState) &&
    tutorialState.status === 'in_progress' &&
    stepId !== 'world-select' &&
    stepId !== 'hero-provider' &&
    stepId !== 'import-prompt' &&
    stepId !== 'done' &&
    (!dismissedStepId || dismissedStepId !== stepId) &&
    Boolean(fallbackCopy);
  const copy = fallbackCopy ?? { title: '', body: '' };

  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [pinnedPosition, setPinnedPosition] = useState<Position | null>(null);
  const pinnedPositionRef = useRef<Position | null>(null);

  useLayoutEffect(() => {
    if (!shouldRender) return;
    let frame: number | null = null;

    const updatePosition = () => {
      const heroEl = document.querySelector('[data-testid="entity-hero"]') as HTMLElement | null;
      const overlayEl = overlayRef.current;
      if (heroEl && overlayEl) {
        const heroRect = heroEl.getBoundingClientRect();
        const overlayRect = overlayEl.getBoundingClientRect();
        const heroCenterX = heroRect.left + heroRect.width / 2;
        const heroCenterY = heroRect.top + heroRect.height / 2;
        let left = heroCenterX - overlayRect.width - HERO_TOOLTIP_GAP_PX + HERO_TOOLTIP_OFFSET_X_PX;
        let top = heroCenterY - overlayRect.height / 2 + HERO_TOOLTIP_OFFSET_Y_PX;
        if (left < 16) {
          left = heroCenterX + HERO_TOOLTIP_GAP_PX + HERO_TOOLTIP_OFFSET_X_PX;
        }
        if (top < 16) {
          top = 16;
        }
        const next = { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` };
        const prev = pinnedPositionRef.current;
        if (!prev || prev.left !== next.left || prev.top !== next.top) {
          pinnedPositionRef.current = next;
          setPinnedPosition(next);
        }
      }
    };

    const scheduleUpdate = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        updatePosition();
      });
    };

    scheduleUpdate();

    window.addEventListener('resize', scheduleUpdate);
    window.addEventListener('scroll', scheduleUpdate, true);

    return () => {
      window.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('scroll', scheduleUpdate, true);
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [shouldRender]);

  const position = pinnedPosition ?? ({ right: '24px', bottom: '120px' } satisfies Position);

  if (!shouldRender) return null;

  return (
    <div className="tutorial-overlay" style={position} ref={overlayRef}>
      <div className="tutorial-overlay-header">
        <h3>{copy.title}</h3>
      </div>
      <p>{copy.body}</p>
    </div>
  );
}
