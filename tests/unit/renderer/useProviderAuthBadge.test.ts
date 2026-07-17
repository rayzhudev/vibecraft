import { renderHook } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { useProviderAuthBadge } from '../../../src/renderer/utils/useProviderAuthBadge';
import { useAppSettings } from '../../../src/renderer/state/appSettingsStore';
import type { ProviderRegistrySnapshot, ProviderStatusState } from '../../../src/shared/types';

vi.mock('../../../src/renderer/state/appSettingsStore', () => ({
  useAppSettings: vi.fn(() => ({ status: 'loaded', settings: {} })),
}));

const mockedUseAppSettings = vi.mocked(useAppSettings);

const buildCache = (
  provider: string,
  state: ProviderStatusState,
  source?: string
): ProviderRegistrySnapshot => ({
  providers: [],
  providerStatus: {
    [provider]: {
      providerId: provider,
      state,
      installed: true,
      source,
    },
  },
  recentModels: {},
  recentModelInfo: {},
  loading: false,
  updatedAt: Date.now(),
});

describe('useProviderAuthBadge', () => {
  test('returns null when provider has no cached status', () => {
    mockedUseAppSettings.mockReturnValue({ status: 'loaded', settings: {} });
    const { result } = renderHook(() => useProviderAuthBadge('claude'));
    expect(result.current).toBeNull();
  });

  test('returns null when provider state is not ready', () => {
    mockedUseAppSettings.mockReturnValue({
      status: 'loaded',
      settings: {
        providerRegistryCache: buildCache('claude', 'error', 'api_key'),
      },
    });
    const { result } = renderHook(() => useProviderAuthBadge('claude'));
    expect(result.current).toBeNull();
  });

  test('returns "key" when source is api_key', () => {
    mockedUseAppSettings.mockReturnValue({
      status: 'loaded',
      settings: {
        providerRegistryCache: buildCache('claude', 'ready', 'api_key'),
      },
    });
    const { result } = renderHook(() => useProviderAuthBadge('claude'));
    expect(result.current).toBe('key');
  });

  test('returns "key" when source is apiKey (camelCase variant)', () => {
    mockedUseAppSettings.mockReturnValue({
      status: 'loaded',
      settings: {
        providerRegistryCache: buildCache('codex', 'ready', 'apiKey'),
      },
    });
    const { result } = renderHook(() => useProviderAuthBadge('codex'));
    expect(result.current).toBe('key');
  });

  test('returns "sub" when source is console', () => {
    mockedUseAppSettings.mockReturnValue({
      status: 'loaded',
      settings: {
        providerRegistryCache: buildCache('google', 'ready', 'console'),
      },
    });
    const { result } = renderHook(() => useProviderAuthBadge('google'));
    expect(result.current).toBe('sub');
  });

  test('returns "sub" when source is oauth', () => {
    mockedUseAppSettings.mockReturnValue({
      status: 'loaded',
      settings: {
        providerRegistryCache: buildCache('claude', 'ready', 'oauth'),
      },
    });
    const { result } = renderHook(() => useProviderAuthBadge('claude'));
    expect(result.current).toBe('sub');
  });

  test('defaults to "sub" when source is undefined and provider is ready', () => {
    mockedUseAppSettings.mockReturnValue({
      status: 'loaded',
      settings: {
        providerRegistryCache: buildCache('cursor', 'ready', undefined),
      },
    });
    const { result } = renderHook(() => useProviderAuthBadge('cursor'));
    expect(result.current).toBe('sub');
  });
});
