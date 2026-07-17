import { useEffect, useMemo, useState } from 'react';
import { SUPPORTED_AGENT_PROVIDERS } from '../../../shared/providers';
import type { AgentProvider, VoicePackId } from '../../../shared/types';
import { saveSettings } from '../../state/appSettingsStore';
import { useSoundPlayer } from '../../hooks/useSoundPlayer';
import { workspaceClient } from '../../services/workspaceClient';
import {
  getCustomSoundLabel,
  isCustomSoundSource,
  isSoundEventId,
  SOUND_EVENT_OVERRIDE_SILENT,
  toCommandSoundEventId,
  toCustomSoundSource,
  type SoundEventId,
} from '../../services/sfx';

const SOUND_EVENT_SOURCE_PACK_DEFAULT = '__pack_default__';
const VOICE_PACK_OFF = '__voice_pack_off__';

const PREVIEW_SOUND_IDS: SoundEventId[] = [
  'folder.create',
  'folder.import',
  'world.ability',
  'subscription.success',
];

const PREVIEW_VOICE_IDS: SoundEventId[] = [
  'agent.create',
  toCommandSoundEventId('agent-send-prompt'),
  'agent.completion',
  'agent.error',
];

const VOICE_PACK_PROVIDER_LABELS: Partial<Record<AgentProvider, string>> = {
  claude: 'Claude',
  codex: 'Codex',
  cursor: 'Cursor',
  google: 'Gemini',
};

export default function SoundPackSection() {
  const {
    muted,
    voiceMuted,
    masterVolume,
    soundPackId,
    voicePackIdByProvider,
    themeDefaultSoundPackId,
    usingThemeDefaultSoundPack,
    soundPacks,
    voicePacks,
    soundEventOptions,
    soundEventOverrides,
    getSoundEventLabel,
    playSound,
    canPlaySoundEvent,
  } = useSoundPlayer();

  const [selectedSlot, setSelectedSlot] = useState<SoundEventId | null>(null);
  const [loadoutExpanded, setLoadoutExpanded] = useState(false);
  const [sessionCustomSoundSources, setSessionCustomSoundSources] = useState<string[]>([]);
  const [customSoundUploadPending, setCustomSoundUploadPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const themeDefaultPackLabel =
    soundPacks.find((pack) => pack.id === themeDefaultSoundPackId)?.label ?? themeDefaultSoundPackId;

  const configurableSoundEventOptions = useMemo(
    () => soundEventOptions.filter((option) => option.id !== 'subscription.success'),
    [soundEventOptions]
  );

  const activeSoundEventOverrides = useMemo(
    () =>
      Object.entries(soundEventOverrides)
        .filter(
          ([eventId, source]) =>
            source && configurableSoundEventOptions.some((option) => option.id === eventId)
        )
        .map(([eventId, source]) => ({
          eventId: eventId as SoundEventId,
          source,
        })),
    [soundEventOverrides, configurableSoundEventOptions]
  );

  const knownCustomSoundSources = useMemo(() => {
    const unique = new Set<string>(sessionCustomSoundSources);
    Object.values(soundEventOverrides).forEach((source) => {
      if (isCustomSoundSource(source)) {
        unique.add(source);
      }
    });
    return Array.from(unique).sort((a, b) => getCustomSoundLabel(a).localeCompare(getCustomSoundLabel(b)));
  }, [sessionCustomSoundSources, soundEventOverrides]);

  useEffect(() => {
    if (activeSoundEventOverrides.length > 0 && !loadoutExpanded) {
      setLoadoutExpanded(true);
    }
    // Only auto-expand on mount, not on every override change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (configurableSoundEventOptions.length === 0) return;
    if (selectedSlot && configurableSoundEventOptions.some((option) => option.id === selectedSlot)) return;
    setSelectedSlot(null);
  }, [configurableSoundEventOptions, selectedSlot]);

  const handleMutedToggle = (nextMuted: boolean) => {
    saveSettings({ audio: { muted: nextMuted } });
  };

  const handleVoiceMutedToggle = (nextMuted: boolean) => {
    saveSettings({ audio: { voiceMuted: nextMuted } });
  };

  const handleMasterVolumeChange = (nextValue: number) => {
    saveSettings({ audio: { masterVolume: nextValue } });
  };

  const handleSoundPackChange = (nextValue: string) => {
    if (nextValue === '__theme_default__') {
      saveSettings({ audio: { soundPackOverrideId: undefined } });
      return;
    }
    const selectedPack = soundPacks.find((pack) => pack.id === nextValue);
    if (!selectedPack) return;
    saveSettings({ audio: { soundPackOverrideId: selectedPack.id } });
  };

  const handleVoicePackChange = (provider: AgentProvider, nextValue: string) => {
    const nextByProvider: Partial<Record<AgentProvider, VoicePackId>> = {
      ...(voicePackIdByProvider ?? {}),
    };
    if (nextValue === VOICE_PACK_OFF) {
      delete nextByProvider[provider];
    } else {
      const selectedPack = voicePacks.find((pack) => pack.id === nextValue);
      if (!selectedPack) return;
      nextByProvider[provider] = selectedPack.id;
    }
    saveSettings({
      audio: {
        voicePackOverrideId: undefined,
        voicePackOverrideIdByProvider: Object.keys(nextByProvider).length > 0 ? nextByProvider : undefined,
      },
    });
  };

  const saveSoundEventOverrides = (nextOverrides: Record<string, string>) => {
    saveSettings({
      audio: {
        soundEventOverrides: Object.keys(nextOverrides).length > 0 ? nextOverrides : undefined,
      },
    });
  };

  const handleSoundEventSourceChange = (targetEventId: SoundEventId, sourceValue: string) => {
    if (sourceValue !== SOUND_EVENT_SOURCE_PACK_DEFAULT && sourceValue !== SOUND_EVENT_OVERRIDE_SILENT) {
      if (!isSoundEventId(sourceValue) && !isCustomSoundSource(sourceValue)) {
        return;
      }
    }
    const nextOverrides = { ...soundEventOverrides };
    if (sourceValue === SOUND_EVENT_SOURCE_PACK_DEFAULT) {
      delete nextOverrides[targetEventId];
    } else {
      nextOverrides[targetEventId] = sourceValue;
    }
    saveSoundEventOverrides(nextOverrides);
  };

  const handleRemoveOverride = (targetEventId: SoundEventId) => {
    const nextOverrides = { ...soundEventOverrides };
    delete nextOverrides[targetEventId];
    saveSoundEventOverrides(nextOverrides);
  };

  const handleResetAll = () => {
    saveSoundEventOverrides({});
    setSelectedSlot(null);
  };

  const rememberCustomSoundSource = (source: string) => {
    setSessionCustomSoundSources((prev) => (prev.includes(source) ? prev : [...prev, source]));
  };

  const handleUploadCustomSound = async (targetEventId: SoundEventId) => {
    setError(null);
    setCustomSoundUploadPending(true);
    try {
      const imported = await workspaceClient.importCustomSound();
      if (!imported) return;
      const source = toCustomSoundSource(imported.sourceUrl);
      if (!source) {
        setError('Could not read the selected sound file.');
        return;
      }
      rememberCustomSoundSource(source);
      handleSoundEventSourceChange(targetEventId, source);
    } catch {
      setError('Could not import the selected sound file.');
    } finally {
      setCustomSoundUploadPending(false);
    }
  };

  const getSlotSourceLabel = (eventId: SoundEventId): string => {
    const source = soundEventOverrides[eventId];
    if (!source) return 'Pack Default';
    if (source === SOUND_EVENT_OVERRIDE_SILENT) return 'Muted';
    if (isCustomSoundSource(source)) return getCustomSoundLabel(source);
    if (isSoundEventId(source)) return getSoundEventLabel(source);
    return source;
  };

  const selectedSlotSourceValue = selectedSlot
    ? (soundEventOverrides[selectedSlot] ?? SOUND_EVENT_SOURCE_PACK_DEFAULT)
    : SOUND_EVENT_SOURCE_PACK_DEFAULT;

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h2>Sound Pack</h2>
        <p className="settings-section-subtitle">Customize the sounds of your world</p>
      </div>

      <div className="settings-section-content">
        {error && <div className="settings-error">{error}</div>}

        {/* Active Pack Card */}
        <div className="sound-pack-featured">
          <div className="sound-pack-featured-header">
            <div className="sound-pack-featured-icon">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
            </div>
            <div className="sound-pack-featured-info">
              <h3 className="sound-pack-featured-name">SFX Pack</h3>
              <p className="sound-pack-featured-desc">
                {usingThemeDefaultSoundPack ? 'Using theme default' : 'Custom pack selected'}
              </p>
            </div>
            <label className="sound-pack-mute-toggle">
              <input
                type="checkbox"
                checked={muted}
                aria-label="Mute SFX"
                onChange={(event) => handleMutedToggle(event.target.checked)}
              />
              <span className="sound-pack-mute-label">{muted ? 'Muted' : 'On'}</span>
            </label>
          </div>

          <div className="sound-pack-featured-controls">
            <label className="settings-field">
              <span className="settings-field-label">Active pack</span>
              <select
                className="settings-select"
                value={usingThemeDefaultSoundPack ? '__theme_default__' : soundPackId}
                onChange={(event) => handleSoundPackChange(event.target.value)}
              >
                <option value="__theme_default__">Use theme default ({themeDefaultPackLabel})</option>
                {soundPacks.map((pack) => (
                  <option key={pack.id} value={pack.id}>
                    {pack.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="settings-field">
              <span className="settings-field-label">Master volume ({Math.round(masterVolume * 100)}%)</span>
              <input
                className="settings-range"
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(masterVolume * 100)}
                onChange={(event) => handleMasterVolumeChange(Number(event.target.value) / 100)}
              />
            </label>

            <div className="sound-pack-preview-row">
              <span className="sound-pack-preview-label">Preview sounds</span>
              <div className="sound-pack-preview-chips">
                {PREVIEW_SOUND_IDS.map((eventId) => (
                  <button
                    key={eventId}
                    type="button"
                    className="sound-pack-preview-chip"
                    onClick={() => playSound(eventId)}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                    {getSoundEventLabel(eventId)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="sound-pack-featured">
          <div className="sound-pack-featured-header">
            <div className="sound-pack-featured-icon">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 1 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </div>
            <div className="sound-pack-featured-info">
              <h3 className="sound-pack-featured-name">Voice Pack</h3>
              <p className="sound-pack-featured-desc">Applies only to agent voice line events</p>
            </div>
            <label className="sound-pack-mute-toggle">
              <input
                type="checkbox"
                checked={voiceMuted}
                aria-label="Mute Voice Lines"
                onChange={(event) => handleVoiceMutedToggle(event.target.checked)}
              />
              <span className="sound-pack-mute-label">{voiceMuted ? 'Muted' : 'On'}</span>
            </label>
          </div>

          <div className="sound-pack-featured-controls">
            {SUPPORTED_AGENT_PROVIDERS.map((provider) => {
              const providerLabel = VOICE_PACK_PROVIDER_LABELS[provider];
              const selectedVoicePackId = voicePackIdByProvider?.[provider] ?? VOICE_PACK_OFF;
              return (
                <div key={provider} className="voice-pack-provider-block">
                  <label className="settings-field">
                    <span className="settings-field-label">{providerLabel} voice pack</span>
                    <select
                      className="settings-select"
                      value={selectedVoicePackId}
                      onChange={(event) => handleVoicePackChange(provider, event.target.value)}
                    >
                      <option value={VOICE_PACK_OFF}>Off (Use sound pack defaults)</option>
                      {voicePacks.map((pack) => (
                        <option key={pack.id} value={pack.id}>
                          {pack.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="sound-pack-preview-row">
                    <span className="sound-pack-preview-label">Preview {providerLabel} voice events</span>
                    <div className="sound-pack-preview-chips">
                      {PREVIEW_VOICE_IDS.map((eventId) => {
                        const canPlay = canPlaySoundEvent(eventId, { provider });
                        return (
                          <button
                            key={`${provider}-${eventId}`}
                            type="button"
                            className="sound-pack-preview-chip"
                            onClick={() => playSound(eventId, { provider })}
                            disabled={!canPlay}
                            title={
                              canPlay
                                ? undefined
                                : `No sound available for this event in the selected ${providerLabel} voice pack`
                            }
                          >
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                              <polygon points="5 3 19 12 5 21 5 3" />
                            </svg>
                            {getSoundEventLabel(eventId)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Sound Loadout (collapsible) */}
        <div className="sound-loadout">
          <button
            type="button"
            className="sound-loadout-toggle"
            onClick={() => setLoadoutExpanded(!loadoutExpanded)}
          >
            <svg
              className={`sound-loadout-toggle-chevron${loadoutExpanded ? ' expanded' : ''}`}
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            <span className="sound-loadout-toggle-label">Customize individual sounds</span>
            {activeSoundEventOverrides.length > 0 && (
              <span className="sound-loadout-meta">{activeSoundEventOverrides.length} customized</span>
            )}
            {loadoutExpanded && activeSoundEventOverrides.length > 0 && (
              <span
                className="settings-link-btn sound-loadout-reset-btn"
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  handleResetAll();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation();
                    handleResetAll();
                  }
                }}
              >
                Reset all
              </span>
            )}
          </button>

          {loadoutExpanded && (
            <>
              <div className="sound-loadout-grid">
                {configurableSoundEventOptions.map((option) => {
                  const isCustomized = Boolean(soundEventOverrides[option.id]);
                  const isSelected = selectedSlot === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      className={`sound-loadout-slot${isSelected ? ' selected' : ''}${isCustomized ? ' customized' : ''}`}
                      onClick={() => setSelectedSlot(isSelected ? null : option.id)}
                    >
                      <span className="sound-loadout-slot-action">{option.label}</span>
                      <span className="sound-loadout-slot-source">{getSlotSourceLabel(option.id)}</span>
                      <div className="sound-loadout-slot-controls">
                        <span
                          className="sound-loadout-slot-play"
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            playSound(option.id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.stopPropagation();
                              e.preventDefault();
                              playSound(option.id);
                            }
                          }}
                          aria-label={`Preview ${option.label}`}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <polygon points="5 3 19 12 5 21 5 3" />
                          </svg>
                        </span>
                        {isCustomized && (
                          <span
                            className="sound-loadout-slot-remove"
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveOverride(option.id);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.stopPropagation();
                                e.preventDefault();
                                handleRemoveOverride(option.id);
                              }
                            }}
                            aria-label={`Reset ${option.label} to pack default`}
                          >
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                            >
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              {selectedSlot && (
                <div className="sound-loadout-editor">
                  <div className="sound-loadout-editor-header">
                    <span className="sound-loadout-editor-title">{getSoundEventLabel(selectedSlot)}</span>
                    <span className="sound-loadout-editor-current">{getSlotSourceLabel(selectedSlot)}</span>
                  </div>

                  <label className="settings-field">
                    <span className="settings-field-label">Sound source</span>
                    <select
                      className="settings-select"
                      value={selectedSlotSourceValue}
                      onChange={(event) => handleSoundEventSourceChange(selectedSlot, event.target.value)}
                    >
                      <option value={SOUND_EVENT_SOURCE_PACK_DEFAULT}>Use pack sound</option>
                      <option value={SOUND_EVENT_OVERRIDE_SILENT}>Muted</option>
                      <optgroup label="Core sounds">
                        {configurableSoundEventOptions
                          .filter((option) => option.group === 'Core')
                          .map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.label}
                            </option>
                          ))}
                      </optgroup>
                      <optgroup label="Command actions">
                        {configurableSoundEventOptions
                          .filter((option) => option.group === 'Command')
                          .map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.label}
                            </option>
                          ))}
                      </optgroup>
                      {knownCustomSoundSources.length > 0 && (
                        <optgroup label="Uploaded sounds">
                          {knownCustomSoundSources.map((source) => (
                            <option key={source} value={source}>
                              {getCustomSoundLabel(source)}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </label>

                  <div className="settings-preview-grid">
                    <button
                      className="settings-secondary-btn"
                      type="button"
                      disabled={customSoundUploadPending}
                      onClick={() => void handleUploadCustomSound(selectedSlot)}
                    >
                      {customSoundUploadPending ? 'Uploading...' : 'Upload sound file'}
                    </button>
                    <button
                      className="settings-secondary-btn"
                      type="button"
                      onClick={() => playSound(selectedSlot)}
                    >
                      Preview
                    </button>
                    {selectedSlotSourceValue !== SOUND_EVENT_SOURCE_PACK_DEFAULT &&
                      selectedSlotSourceValue !== SOUND_EVENT_OVERRIDE_SILENT &&
                      isSoundEventId(selectedSlotSourceValue) && (
                        <button
                          className="settings-secondary-btn"
                          type="button"
                          onClick={() => playSound(selectedSlotSourceValue)}
                        >
                          Preview source
                        </button>
                      )}
                    {soundEventOverrides[selectedSlot] && (
                      <button
                        className="settings-secondary-btn"
                        type="button"
                        onClick={() => handleRemoveOverride(selectedSlot)}
                      >
                        Revert to pack default
                      </button>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
