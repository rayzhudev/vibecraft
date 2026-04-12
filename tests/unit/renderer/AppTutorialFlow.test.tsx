import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings, Hero, ProviderRegistrySnapshot } from '../../../src/shared/types';

vi.mock('../../../src/renderer/utils/analytics', () => ({
  initRendererAnalytics: vi.fn(),
  updateRendererAnalyticsContext: vi.fn(),
  shutdownRendererAnalytics: vi.fn(),
}));

vi.mock('../../../src/renderer/screens/WorkspaceView', () => ({
  default: ({ onBack }: { onBack: () => void }) => (
    <div>
      <div>Mock Workspace</div>
      <button type="button" onClick={onBack}>
        Leave Workspace
      </button>
    </div>
  ),
}));

describe('App tutorial startup flow', () => {
  beforeEach(() => {
    cleanup();
    vi.resetModules();

    window.electronAPI.isLicenseCheckEnabled = false;
    window.electronAPI.loadSettings = vi.fn(
      async (): Promise<AppSettings> => ({
        tutorial: { status: 'completed', stepId: 'done', version: 1 },
      })
    );
    window.electronAPI.saveSettings = vi.fn(async () => true);
    window.electronAPI.checkForPriorSettings = vi.fn(async () => ({ found: false }));
    window.electronAPI.getPriorWorkspacePreview = vi.fn(async () => ({
      found: false,
      workspaces: [],
      sources: [],
    }));
    window.electronAPI.resetTutorialWorld = vi.fn(async () => ({
      id: 'tutorial-world',
      name: 'Tutorial',
      path: '/tmp/Tutorial',
      lastAccessed: Date.now(),
    }));
    window.electronAPI.getRecentWorkspaces = vi.fn(async () => [
      {
        id: 'tutorial-world',
        name: 'Tutorial',
        path: '/tmp/Tutorial',
        lastAccessed: Date.now(),
      },
    ]);
    window.electronAPI.getTutorialWorld = vi.fn(async () => ({
      id: 'tutorial-world',
      name: 'Tutorial',
      path: '/tmp/Tutorial',
      lastAccessed: Date.now(),
    }));
    window.electronAPI.addRecentWorkspace = vi.fn(async () => true);
    window.electronAPI.agentConnectBootstrap = vi.fn(
      async (): Promise<ProviderRegistrySnapshot> => ({
        providers: [
          { id: 'claude', name: 'Claude' },
          { id: 'codex', name: 'Codex' },
        ],
        providerStatus: {
          claude: { providerId: 'claude', state: 'ready', installed: true },
          codex: { providerId: 'codex', state: 'ready', installed: true },
        },
        recentModels: { claude: ['sonnet-3.5'], codex: ['gpt-5-codex'] },
        recentModelInfo: {},
        loading: false,
        updatedAt: Date.now(),
      })
    );
    window.electronAPI.loadHero = vi.fn(
      async (): Promise<Hero> => ({
        id: 'hero',
        name: 'Hero',
        provider: 'claude',
        model: 'sonnet-3.5',
        x: 0,
        y: 0,
      })
    );
    window.electronAPI.setHeroProvider = vi.fn(async () => ({ success: true }));
    window.electronAPI.loadFolders = vi.fn(async () => []);
    window.electronAPI.loadAgents = vi.fn(async () => []);
    window.electronAPI.loadBrowserPanels = vi.fn(async () => []);
    window.electronAPI.loadTerminals = vi.fn(async () => []);
  });

  afterEach(() => {
    cleanup();
  });

  it('shows a clean home screen without a startup tutorial gate', async () => {
    const { default: App } = await import('../../../src/renderer/App');

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('home-select-world')).toBeInTheDocument();
    });

    expect(screen.queryByText('Welcome to VibeCraft')).not.toBeInTheDocument();
    expect(screen.getByTestId('home-open-tutorial')).toBeInTheDocument();
  });

  it('shows detected prior projects in world selection when tutorial has not started', async () => {
    window.electronAPI.loadSettings = vi.fn(
      async (): Promise<AppSettings> => ({
        tutorial: { status: 'not_started', stepId: 'world-select', version: 1 },
      })
    );
    window.electronAPI.getPriorWorkspacePreview = vi.fn(async () => ({
      found: true,
      sourceDir: '/Users/test/Library/Application Support/VibeCraft',
      workspaces: [
        {
          id: 'ws-projects',
          name: 'projects',
          path: '/Users/test/Documents/projects',
          lastAccessed: Date.now(),
          sourceDir: '/Users/test/Library/Application Support/VibeCraft',
          sourceName: 'VibeCraft',
        },
      ],
      sources: [
        {
          sourceDir: '/Users/test/Library/Application Support/VibeCraft',
          sourceName: 'VibeCraft',
          sourceUpdatedAt: Date.now(),
          workspaces: [
            {
              id: 'ws-projects',
              name: 'projects',
              path: '/Users/test/Documents/projects',
              lastAccessed: Date.now(),
              sourceDir: '/Users/test/Library/Application Support/VibeCraft',
              sourceName: 'VibeCraft',
            },
          ],
        },
      ],
    }));

    const { default: App } = await import('../../../src/renderer/App');

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('home-select-world')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('home-select-world'));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Detected Prior Projects' })).toBeInTheDocument();
      expect(screen.getByText('/Users/test/Documents/projects')).toBeInTheDocument();
      expect(screen.getByText('From VibeCraft')).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 3, name: 'VibeCraft' })).toBeInTheDocument();
    });
  });

  it('lets the user abort the tutorial back to home', async () => {
    window.electronAPI.loadSettings = vi.fn(
      async (): Promise<AppSettings> => ({
        tutorial: { status: 'not_started', stepId: 'world-select', version: 1 },
      })
    );

    const { default: App } = await import('../../../src/renderer/App');

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('home-open-tutorial')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('home-open-tutorial'));

    await waitFor(() => {
      expect(screen.getByText('Mock Workspace')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Exit Tutorial' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Exit Tutorial' }));

    await waitFor(() => {
      expect(screen.getByTestId('home-select-world')).toBeInTheDocument();
    });
  });
});
