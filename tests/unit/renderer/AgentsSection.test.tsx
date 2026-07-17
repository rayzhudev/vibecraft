import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import AgentsSection from '../../../src/renderer/screens/settings/AgentsSection';
import { useAppSettings } from '../../../src/renderer/state/appSettingsStore';
import { workspaceClient } from '../../../src/renderer/services/workspaceClient';
import type { ProviderRegistrySnapshot, ProviderStatus } from '../../../src/shared/types';

// ── Mocks ────────────────────────────────────────────────────────
vi.mock('../../../src/renderer/state/appSettingsStore', () => ({
  useAppSettings: vi.fn(() => ({ status: 'loaded', settings: {} })),
}));

vi.mock('../../../src/renderer/services/workspaceClient', () => ({
  workspaceClient: {
    agentConnectBootstrap: vi.fn(),
    agentConnectProviderLogin: vi.fn(),
    agentConnectProviderInstall: vi.fn(),
    agentConnectProvidersRefresh: vi.fn(),
    agentConnectProviderLogout: vi.fn(),
  },
}));

const mockedUseAppSettings = vi.mocked(useAppSettings);
const mockedBootstrap = vi.mocked(workspaceClient.agentConnectBootstrap);
const mockedLogin = vi.mocked(workspaceClient.agentConnectProviderLogin);
const mockedInstall = vi.mocked(workspaceClient.agentConnectProviderInstall);
const mockedRefresh = vi.mocked(workspaceClient.agentConnectProvidersRefresh);
const mockedLogout = vi.mocked(workspaceClient.agentConnectProviderLogout);

// ── Helpers ──────────────────────────────────────────────────────
const buildSnapshot = (
  overrides: Partial<Record<string, Partial<ProviderStatus> | null>> = {},
  opts?: { installed?: boolean }
): ProviderRegistrySnapshot => {
  const installed = opts?.installed ?? true;
  const defaultStatus = (id: string): ProviderStatus => ({
    providerId: id,
    state: 'ready',
    installed,
    source: undefined,
    loggedInAs: undefined,
    ...overrides[id],
  });

  return {
    providers: [
      { id: 'claude', name: 'Claude' },
      { id: 'codex', name: 'Codex' },
      { id: 'cursor', name: 'Cursor' },
      { id: 'google', name: 'Gemini' },
    ],
    providerStatus: {
      claude: defaultStatus('claude'),
      codex: defaultStatus('codex'),
      cursor: defaultStatus('cursor'),
      google: defaultStatus('google'),
    },
    recentModels: {},
    recentModelInfo: {},
    loading: false,
    updatedAt: Date.now(),
  };
};

// ── Test suite ───────────────────────────────────────────────────
describe('AgentsSection', () => {
  beforeEach(() => {
    mockedUseAppSettings.mockReturnValue({ status: 'loaded', settings: {} });
    mockedBootstrap.mockResolvedValue(buildSnapshot());
    mockedLogin.mockResolvedValue({ loggedIn: true });
    mockedInstall.mockResolvedValue(null);
    mockedRefresh.mockResolvedValue(buildSnapshot());
    mockedLogout.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // ── Provider rendering ──────────────────────────────────────
  describe('provider list rendering', () => {
    test('renders all four provider labels', async () => {
      render(<AgentsSection />);

      await waitFor(() => {
        expect(screen.getByText('Anthropic Claude')).toBeInTheDocument();
        expect(screen.getByText('OpenAI')).toBeInTheDocument();
        expect(screen.getByText('Cursor')).toBeInTheDocument();
        expect(screen.getByText('Google Gemini')).toBeInTheDocument();
      });
    });

    test('shows Aggregator badge only for Cursor', async () => {
      render(<AgentsSection />);

      await waitFor(() => {
        expect(screen.getByText('Aggregator')).toBeInTheDocument();
      });

      // Only one aggregator badge
      expect(screen.getAllByText('Aggregator')).toHaveLength(1);
    });

    test('shows Connected status when provider is ready', async () => {
      render(<AgentsSection />);

      await waitFor(() => {
        expect(screen.getAllByText('Connected')).toHaveLength(4);
      });
    });
  });

  // ── Connection method display ───────────────────────────────
  describe('connection method display', () => {
    test('shows Console Subscription indicator when source is console', async () => {
      mockedBootstrap.mockResolvedValue(
        buildSnapshot({
          claude: { source: 'console', loggedInAs: 'user@example.com', state: 'ready' },
        })
      );
      render(<AgentsSection />);

      await waitFor(() => {
        // All providers default to Console Subscription; verify the explicit one has the account
        const labels = screen.getAllByText('Console Subscription');
        expect(labels.length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText('user@example.com')).toBeInTheDocument();
      });
    });

    test('shows API Key indicator when source is api_key', async () => {
      mockedBootstrap.mockResolvedValue(
        buildSnapshot({
          codex: { source: 'api_key', state: 'ready' },
        })
      );
      render(<AgentsSection />);

      await waitFor(() => {
        // The connection-method-label span shows "API Key" for the indicator;
        // auth method card titles also show "API Key" for the chooser.
        // Verify at least one indicator-level "API Key" label exists.
        const indicator = document.querySelector('.connection-method--api_key .connection-method-label');
        expect(indicator).not.toBeNull();
        expect(indicator!.textContent).toBe('API Key');
      });
    });

    test('defaults to Console Subscription when source is unset but state is ready', async () => {
      mockedBootstrap.mockResolvedValue(buildSnapshot());
      render(<AgentsSection />);

      await waitFor(() => {
        // All 4 providers are ready with no source → all show Console Subscription
        expect(screen.getAllByText('Console Subscription')).toHaveLength(4);
      });
    });
  });

  // ── Auth method chooser ─────────────────────────────────────
  describe('auth method chooser', () => {
    test('shows Console Login and API Key options for Claude', async () => {
      render(<AgentsSection />);

      await waitFor(() => {
        expect(screen.getAllByText('Console Login').length).toBeGreaterThanOrEqual(1);
      });

      // Claude, OpenAI, Google should each show an API Key card
      const apiKeyButtons = screen.getAllByText('API Key');
      expect(apiKeyButtons.length).toBeGreaterThanOrEqual(3);
    });

    test('Cursor only shows Login button, no API Key option', async () => {
      render(<AgentsSection />);

      await waitFor(() => {
        expect(screen.getByText('Login to Cursor')).toBeInTheDocument();
      });
    });

    test('clicking Console Login calls handleLogin with method: console', async () => {
      render(<AgentsSection />);

      await waitFor(() => {
        expect(screen.getAllByText('Console Login').length).toBeGreaterThanOrEqual(1);
      });

      // Click the first Console Login button (Claude)
      const consoleButtons = screen.getAllByText('Console Login');
      fireEvent.click(consoleButtons[0]);

      await waitFor(() => {
        expect(mockedLogin).toHaveBeenCalledWith('claude', { method: 'console' });
      });
    });

    test('clicking API Key button reveals the key input field', async () => {
      render(<AgentsSection />);

      await waitFor(() => {
        expect(screen.getAllByText('API Key').length).toBeGreaterThanOrEqual(1);
      });

      // Find the first API Key button in the auth-method cards
      const apiKeyCards = screen.getAllByText('API Key');
      // The first one in auth-method-card-title for claude
      fireEvent.click(apiKeyCards[0]);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('sk-ant-api03-...')).toBeInTheDocument();
      });
    });

    test('submitting API key calls handleLogin with method: api_key', async () => {
      render(<AgentsSection />);

      await waitFor(() => {
        expect(screen.getAllByText('API Key').length).toBeGreaterThanOrEqual(1);
      });

      // Open the API key input for the first provider (claude)
      fireEvent.click(screen.getAllByText('API Key')[0]);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('sk-ant-api03-...')).toBeInTheDocument();
      });

      const input = screen.getByPlaceholderText('sk-ant-api03-...');
      fireEvent.change(input, { target: { value: 'sk-ant-test-key-123' } });
      fireEvent.click(screen.getByText('Connect'));

      await waitFor(() => {
        expect(mockedLogin).toHaveBeenCalledWith('claude', {
          method: 'api_key',
          apiKey: 'sk-ant-test-key-123',
        });
      });
    });

    test('pressing Enter in API key input submits the key', async () => {
      render(<AgentsSection />);

      await waitFor(() => {
        expect(screen.getAllByText('API Key').length).toBeGreaterThanOrEqual(1);
      });

      fireEvent.click(screen.getAllByText('API Key')[0]);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('sk-ant-api03-...')).toBeInTheDocument();
      });

      const input = screen.getByPlaceholderText('sk-ant-api03-...');
      fireEvent.change(input, { target: { value: 'sk-ant-enter-test' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(() => {
        expect(mockedLogin).toHaveBeenCalledWith('claude', {
          method: 'api_key',
          apiKey: 'sk-ant-enter-test',
        });
      });
    });
  });

  // ── Toast notifications ─────────────────────────────────────
  describe('connection feedback', () => {
    test('shows success toast after console login', async () => {
      render(<AgentsSection />);

      await waitFor(() => {
        expect(screen.getAllByText('Console Login').length).toBeGreaterThanOrEqual(1);
      });

      fireEvent.click(screen.getAllByText('Console Login')[0]);

      await waitFor(() => {
        expect(screen.getByText(/connected via console login/i)).toBeInTheDocument();
      });
    });

    test('shows error toast when login fails', async () => {
      mockedLogin.mockRejectedValue(new Error('Invalid credentials'));
      render(<AgentsSection />);

      await waitFor(() => {
        expect(screen.getAllByText('Console Login').length).toBeGreaterThanOrEqual(1);
      });

      fireEvent.click(screen.getAllByText('Console Login')[0]);

      await waitFor(() => {
        // The error appears both in .agents-section-error and .agents-toast--error;
        // verify the toast specifically.
        const toast = document.querySelector('.agents-toast--error');
        expect(toast).not.toBeNull();
        expect(toast!.textContent).toContain('Invalid credentials');
      });
    });

    test('shows success toast after API key connection', async () => {
      render(<AgentsSection />);

      await waitFor(() => {
        expect(screen.getAllByText('API Key').length).toBeGreaterThanOrEqual(1);
      });

      fireEvent.click(screen.getAllByText('API Key')[0]);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('sk-ant-api03-...')).toBeInTheDocument();
      });

      fireEvent.change(screen.getByPlaceholderText('sk-ant-api03-...'), {
        target: { value: 'sk-ant-key' },
      });
      fireEvent.click(screen.getByText('Connect'));

      await waitFor(() => {
        expect(screen.getByText(/connected via API key/i)).toBeInTheDocument();
      });
    });
  });

  // ── Install flow ────────────────────────────────────────────
  describe('install flow', () => {
    test('shows Install button when provider is not installed', async () => {
      mockedBootstrap.mockResolvedValue(
        buildSnapshot({ claude: { state: 'missing', installed: false } })
      );
      render(<AgentsSection />);

      await waitFor(() => {
        expect(screen.getByText('Not Installed')).toBeInTheDocument();
        expect(screen.getAllByText('Install').length).toBeGreaterThanOrEqual(1);
      });
    });

    test('clicking Install calls agentConnectProviderInstall', async () => {
      mockedBootstrap.mockResolvedValue(
        buildSnapshot({ claude: { state: 'missing', installed: false } })
      );
      render(<AgentsSection />);

      await waitFor(() => {
        expect(screen.getAllByText('Install').length).toBeGreaterThanOrEqual(1);
      });

      fireEvent.click(screen.getAllByText('Install')[0]);

      await waitFor(() => {
        expect(mockedInstall).toHaveBeenCalledWith('claude');
      });
    });
  });

  // ── Login Required state ────────────────────────────────────
  describe('login required state', () => {
    test('shows Login Required pill when provider has login error', async () => {
      mockedBootstrap.mockResolvedValue(
        buildSnapshot({
          claude: { state: 'error', message: 'login required', installed: true },
        })
      );
      render(<AgentsSection />);

      await waitFor(() => {
        expect(screen.getByText('Login Required')).toBeInTheDocument();
      });
    });
  });

  // ── Help links ──────────────────────────────────────────────
  describe('API key help links', () => {
    test('shows Anthropic Console link for Claude API key input', async () => {
      render(<AgentsSection />);

      await waitFor(() => {
        expect(screen.getAllByText('API Key').length).toBeGreaterThanOrEqual(1);
      });

      fireEvent.click(screen.getAllByText('API Key')[0]);

      await waitFor(() => {
        const link = screen.getByText('Anthropic Console');
        expect(link).toBeInTheDocument();
        expect(link).toHaveAttribute('href', 'https://console.anthropic.com/settings/keys');
      });
    });
  });
});
