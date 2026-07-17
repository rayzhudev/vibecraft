import type { AgentProvider } from '../../shared/types';
import { useAppSettings } from '../state/appSettingsStore';

export type AuthBadge = 'key' | 'sub' | null;

/**
 * Returns the auth method badge label for a provider:
 * - 'key' → API Key
 * - 'sub' → Console / Subscription
 * - null  → unknown or not connected
 *
 * Uses the cached provider registry from app settings.
 */
export function useProviderAuthBadge(provider: AgentProvider): AuthBadge {
  const { settings } = useAppSettings();
  const status = settings.providerRegistryCache?.providerStatus?.[provider];
  if (!status || status.state !== 'ready') return null;
  const src = status.source?.toLowerCase();
  if (src === 'api_key' || src === 'apikey' || src === 'api-key') return 'key';
  // Default to subscription for console/oauth/login or when source is unset
  return 'sub';
}
