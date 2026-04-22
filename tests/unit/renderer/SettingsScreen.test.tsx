import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import SettingsScreen from '../../../src/renderer/screens/SettingsScreen';
import { useSoundPlayer } from '../../../src/renderer/hooks/useSoundPlayer';
import { saveSettings, useAppSettings } from '../../../src/renderer/state/appSettingsStore';
import { workspaceClient } from '../../../src/renderer/services/workspaceClient';
import { toCustomSoundSource } from '../../../src/renderer/services/sfx';
import type { AgentProvider } from '../../../src/shared/types';
import type { SoundEventId, SoundEventOverrideMap } from '../../../src/renderer/services/sfx';

vi.mock('../../../src/renderer/hooks/useSoundPlayer', () => ({
  useSoundPlayer: vi.fn(),
}));

vi.mock('../../../src/renderer/state/appSettingsStore', () => ({
  saveSettings: vi.fn(),
  useAppSettings: vi.fn(() => ({ status: 'loaded', settings: {} })),
}));

vi.mock('../../../src/renderer/services/workspaceClient', () => ({
  workspaceClient: {
    importCustomSound: vi.fn(),
  },
}));

const mockedUseSoundPlayer = vi.mocked(useSoundPlayer);
const mockedSaveSettings = vi.mocked(saveSettings);
const mockedUseAppSettings = vi.mocked(useAppSettings);
const mockedImportCustomSound = vi.mocked(workspaceClient.importCustomSound);

const renderSettingsScreen = () =>
  render(
    <SettingsScreen
      license={null}
      priorImportAvailable={false}
      priorSettingsDetected={false}
      priorImportPending={false}
      priorImportError={null}
      onImportPriorProjects={vi.fn(async () => true)}
      onStartCheckout={vi.fn(async () => ({ success: true }))}
      onManageBilling={vi.fn(async () => ({ success: true }))}
      onStartPairing={vi.fn(async () => ({ success: true }))}
      onClaimPairing={vi.fn(async () => ({ success: true }))}
      onRefreshLicense={vi.fn(async () => {})}
    />
  );

const buildSoundPlayerState = (
  overrides: SoundEventOverrideMap,
  options?: {
    unplayableEvents?: SoundEventId[];
    unplayableEventsByProvider?: Partial<Record<AgentProvider, SoundEventId[]>>;
    soundPackId?: 'default' | 'arcade';
    soundPacks?: Array<{ id: 'default' | 'arcade'; label: string }>;
    usingThemeDefaultSoundPack?: boolean;
    voicePackId?: string;
    voicePackIdByProvider?: Partial<Record<AgentProvider, string>>;
    voicePacks?: Array<{ id: string; label: string }>;
  }
): ReturnType<typeof useSoundPlayer> => {
  const unplayableEvents = new Set(options?.unplayableEvents ?? []);
  const unplayableEventsByProvider = options?.unplayableEventsByProvider ?? {};
  const labels: Partial<Record<SoundEventId, string>> = {
    'agent.completion': 'Agent Completion',
    'agent.error': 'Agent Error',
    'agent.create': 'Agent Created',
    'folder.create': 'Folder Created',
    'folder.import': 'Folder Imported',
    'world.ability': 'World Ability',
    'command.create-agent-claude': 'Command: Create Agent Claude',
    'command.agent-send-prompt': 'Command: Agent Send Prompt',
    'command.destroy-agent': 'Command: Destroy Agent',
    'command.create-folder': 'Command: Create Folder',
    'subscription.success': 'Subscription Success',
  };

  return {
    muted: false,
    voiceMuted: false,
    masterVolume: 1,
    soundPackId: options?.soundPackId ?? 'default',
    voicePackId: options?.voicePackId,
    voicePackIdByProvider: options?.voicePackIdByProvider ?? {},
    themeDefaultSoundPackId: 'default',
    usingThemeDefaultSoundPack: options?.usingThemeDefaultSoundPack ?? true,
    soundPacks: options?.soundPacks ?? [{ id: 'default', label: 'Default' }],
    voicePacks: options?.voicePacks ?? [],
    soundEventOptions: [
      { id: 'agent.completion', label: 'Agent Completion', group: 'Core' as const },
      { id: 'agent.error', label: 'Agent Error', group: 'Core' as const },
      { id: 'agent.create', label: 'Agent Created', group: 'Core' as const },
      { id: 'folder.create', label: 'Folder Created', group: 'Core' as const },
      { id: 'folder.import', label: 'Folder Imported', group: 'Core' as const },
      { id: 'world.ability', label: 'World Ability', group: 'Core' as const },
      { id: 'subscription.success', label: 'Subscription Success', group: 'Core' as const },
      { id: 'command.create-folder', label: 'Command: Create Folder', group: 'Command' as const },
    ],
    soundEventOverrides: overrides,
    getSoundEventLabel: (eventId: SoundEventId) => labels[eventId] ?? eventId,
    playSound: vi.fn(),
    canPlaySoundEvent: (eventId: SoundEventId, playbackOptions?: { provider?: AgentProvider }) => {
      if (unplayableEvents.has(eventId)) return false;
      const provider = playbackOptions?.provider;
      if (!provider) return true;
      const unplayableForProvider = new Set(unplayableEventsByProvider[provider] ?? []);
      return !unplayableForProvider.has(eventId);
    },
  };
};

const expandLoadout = () => {
  fireEvent.click(screen.getByText('Customize individual sounds'));
};

describe('SettingsScreen', () => {
  beforeEach(() => {
    mockedSaveSettings.mockReset();
    mockedUseAppSettings.mockReturnValue({ status: 'loaded', settings: {} });
    mockedImportCustomSound.mockReset();
    mockedImportCustomSound.mockResolvedValue(null);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe('sidebar navigation', () => {
    test('shows sidebar with Sound Pack section active by default', () => {
      mockedUseSoundPlayer.mockReturnValue(buildSoundPlayerState({}));
      renderSettingsScreen();

      expect(screen.getByText('Sound Pack', { selector: 'h2' })).toBeInTheDocument();
      expect(
        screen.getByText('Sound Pack', { selector: '.settings-sidebar-item-label' })
      ).toBeInTheDocument();
    });

    test('navigates to billing section', () => {
      mockedUseSoundPlayer.mockReturnValue(buildSoundPlayerState({}));
      renderSettingsScreen();

      fireEvent.click(screen.getByText('Subscription', { selector: '.settings-sidebar-item-label' }));
      expect(screen.getByText('Subscription & Billing', { selector: 'h2' })).toBeInTheDocument();
    });

    test('shows Theme as coming soon', () => {
      mockedUseSoundPlayer.mockReturnValue(buildSoundPlayerState({}));
      renderSettingsScreen();

      expect(screen.getByText('Soon')).toBeInTheDocument();
    });
  });

  describe('sound preview', () => {
    test('shows preview chips for all non-agent sounds on the pack card', async () => {
      mockedUseSoundPlayer.mockReturnValue(buildSoundPlayerState({}));
      renderSettingsScreen();

      await screen.findByRole('button', { name: /Folder Created/i });
      await screen.findByRole('button', { name: /Folder Imported/i });
      await screen.findByRole('button', { name: /World Ability/i });
      await screen.findByRole('button', { name: /Subscription Success/i });
    }, 10000);

    test('loadout grid is collapsed by default when no overrides exist', () => {
      mockedUseSoundPlayer.mockReturnValue(buildSoundPlayerState({}));
      renderSettingsScreen();

      expect(screen.getByText('Customize individual sounds')).toBeInTheDocument();
      expect(screen.queryByText('Command: Create Folder')).not.toBeInTheDocument();
    });

    test('disables voice preview chips when the selected voice pack has no sound for that event', () => {
      mockedUseSoundPlayer.mockReturnValue(
        buildSoundPlayerState(
          {},
          {
            unplayableEventsByProvider: {
              claude: ['command.agent-send-prompt'],
            },
          }
        )
      );
      renderSettingsScreen();

      const claudePreviewRow = screen
        .getByText('Preview Claude voice events')
        .closest('.sound-pack-preview-row') as HTMLElement | null;
      if (!claudePreviewRow) throw new Error('Expected Claude preview row');
      const codexPreviewRow = screen
        .getByText('Preview Codex voice events')
        .closest('.sound-pack-preview-row') as HTMLElement | null;
      if (!codexPreviewRow) throw new Error('Expected Codex preview row');

      expect(
        within(claudePreviewRow).getByRole('button', { name: /Command: Agent Send Prompt/i })
      ).toBeDisabled();
      expect(within(claudePreviewRow).getByRole('button', { name: /Agent Created/i })).not.toBeDisabled();
      expect(
        within(codexPreviewRow).getByRole('button', { name: /Command: Agent Send Prompt/i })
      ).not.toBeDisabled();
    });

    test('keeps the voice pack card title static while selector shows selected pack', () => {
      mockedUseSoundPlayer.mockReturnValue(
        buildSoundPlayerState(
          {},
          {
            voicePackIdByProvider: { claude: 'peonping:peon' },
            voicePacks: [{ id: 'peonping:peon', label: 'Orc Peon' }],
          }
        )
      );
      renderSettingsScreen();

      expect(screen.getByRole('heading', { name: 'Voice Pack' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Orc Peon' })).not.toBeInTheDocument();

      const selector = screen.getByLabelText('Claude voice pack') as HTMLSelectElement;
      expect(selector.value).toBe('peonping:peon');
      expect(within(selector).getByRole('option', { name: 'Orc Peon' })).toBeInTheDocument();
    });

    test('saves provider-specific voice pack overrides from provider selectors', () => {
      mockedUseSoundPlayer.mockReturnValue(
        buildSoundPlayerState(
          {},
          {
            voicePackIdByProvider: { claude: 'peonping:peon' },
            voicePacks: [
              { id: 'peonping:peon', label: 'Orc Peon' },
              { id: 'peonping:murloc', label: 'Murloc' },
            ],
          }
        )
      );
      renderSettingsScreen();

      fireEvent.change(screen.getByLabelText('Codex voice pack'), { target: { value: 'peonping:murloc' } });

      expect(mockedSaveSettings).toHaveBeenCalledWith({
        audio: {
          voicePackOverrideId: undefined,
          voicePackOverrideIdByProvider: {
            claude: 'peonping:peon',
            codex: 'peonping:murloc',
          },
        },
      });
    });

    test('toggles voice mute independently from sfx mute', () => {
      mockedUseSoundPlayer.mockReturnValue(buildSoundPlayerState({}));
      renderSettingsScreen();

      fireEvent.click(screen.getByLabelText('Mute Voice Lines'));

      expect(mockedSaveSettings).toHaveBeenCalledWith({
        audio: {
          voiceMuted: true,
        },
      });
    });

    test('keeps the sfx pack card title static while selector shows selected pack', () => {
      mockedUseSoundPlayer.mockReturnValue(
        buildSoundPlayerState(
          {},
          {
            soundPackId: 'arcade',
            usingThemeDefaultSoundPack: false,
            soundPacks: [
              { id: 'default', label: 'Default' },
              { id: 'arcade', label: 'Arcade' },
            ],
          }
        )
      );
      renderSettingsScreen();

      expect(screen.getByRole('heading', { name: 'SFX Pack' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Arcade' })).not.toBeInTheDocument();

      const selector = screen.getByLabelText('Active pack') as HTMLSelectElement;
      expect(selector.value).toBe('arcade');
      expect(screen.getByRole('option', { name: 'Arcade' })).toBeInTheDocument();
    });
  });

  describe('sound loadout', () => {
    test('expanding shows all configurable events as slots except subscription.success', () => {
      mockedUseSoundPlayer.mockReturnValue(buildSoundPlayerState({}));
      renderSettingsScreen();
      expandLoadout();

      expect(screen.getByText('Command: Create Folder')).toBeInTheDocument();
      expect(
        screen.queryByText('Subscription Success', { selector: '.sound-loadout-slot-action' })
      ).not.toBeInTheDocument();
    });

    test('slots show "Pack Default" when no overrides exist', () => {
      mockedUseSoundPlayer.mockReturnValue(buildSoundPlayerState({}));
      renderSettingsScreen();
      expandLoadout();

      const defaultLabels = screen.getAllByText('Pack Default');
      expect(defaultLabels.length).toBeGreaterThanOrEqual(3);
    });

    test('auto-expands when overrides exist', () => {
      mockedUseSoundPlayer.mockReturnValue(buildSoundPlayerState({ 'agent.error': 'agent.completion' }));
      renderSettingsScreen();

      const customizedSlot = screen.getByText('Agent Error', { selector: '.sound-loadout-slot-action' });
      expect(customizedSlot.closest('.sound-loadout-slot')).toHaveClass('customized');
    });

    test('clicking a slot opens the editor and changing source saves override', () => {
      mockedUseSoundPlayer.mockReturnValue(buildSoundPlayerState({}));
      renderSettingsScreen();
      expandLoadout();

      fireEvent.click(screen.getByText('Agent Completion', { selector: '.sound-loadout-slot-action' }));
      const sourceSelect = screen.getByLabelText('Sound source') as HTMLSelectElement;
      fireEvent.change(sourceSelect, { target: { value: 'agent.error' } });

      expect(mockedSaveSettings).toHaveBeenCalledWith({
        audio: {
          soundEventOverrides: {
            'agent.completion': 'agent.error',
          },
        },
      });
    });

    test('uploads and saves a custom sound via the slot editor', async () => {
      mockedUseSoundPlayer.mockReturnValue(buildSoundPlayerState({}));
      mockedImportCustomSound.mockResolvedValue({
        sourceUrl: 'file:///tmp/custom/bell.wav',
        displayName: 'bell',
      });
      const expectedSource = toCustomSoundSource('file:///tmp/custom/bell.wav');
      if (!expectedSource) throw new Error('Expected custom source');

      renderSettingsScreen();
      expandLoadout();

      fireEvent.click(screen.getByText('Agent Completion', { selector: '.sound-loadout-slot-action' }));
      fireEvent.click(screen.getByRole('button', { name: 'Upload sound file' }));

      await waitFor(() =>
        expect(mockedSaveSettings).toHaveBeenCalledWith({
          audio: {
            soundEventOverrides: {
              'agent.completion': expectedSource,
            },
          },
        })
      );
    });

    test('shows an error when custom sound import fails', async () => {
      mockedUseSoundPlayer.mockReturnValue(buildSoundPlayerState({}));
      mockedImportCustomSound.mockRejectedValue(new Error('Unsupported sound file type'));

      renderSettingsScreen();
      expandLoadout();

      fireEvent.click(screen.getByText('Agent Completion', { selector: '.sound-loadout-slot-action' }));
      fireEvent.click(screen.getByRole('button', { name: 'Upload sound file' }));

      await waitFor(() =>
        expect(screen.getByText('Could not import the selected sound file.')).toBeInTheDocument()
      );
    });

    test('resetting all overrides clears them', () => {
      mockedUseSoundPlayer.mockReturnValue(buildSoundPlayerState({ 'agent.error': 'agent.completion' }));
      renderSettingsScreen();

      fireEvent.click(screen.getByText('Reset all'));

      expect(mockedSaveSettings).toHaveBeenCalledWith({
        audio: {
          soundEventOverrides: undefined,
        },
      });
    });
  });
});
