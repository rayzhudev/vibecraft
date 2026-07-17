import type { ProviderRegistryClient } from './providerRegistry';
import { listProviders, getProviderStatus, listRecentModelInfo } from './embeddedHost';
import { getTestModeConfig } from '../../../testing/testMode';
import { TUTORIAL_HERO_PROVIDERS } from '../../../shared/providers';
import type { AgentProvider, ProviderStatus } from '../../../shared/types';

const TEST_PROVIDER_LABELS: Partial<Record<AgentProvider, string>> = {
  claude: 'Claude',
  codex: 'Codex',
  cursor: 'Cursor',
  google: 'Gemini',
};

export function createAgentConnectClient(): ProviderRegistryClient {
  const testMode = getTestModeConfig();
  if (testMode.enabled && !testMode.integration) {
    const providers = TUTORIAL_HERO_PROVIDERS.map((id) => ({
      id,
      name: TEST_PROVIDER_LABELS[id] ?? id,
    }));
    return {
      providers: {
        list: async () => providers,
        status: async (providerId: string): Promise<ProviderStatus> => ({
          providerId,
          state: 'ready',
          installed: true,
        }),
      },
      models: {
        recent: async () => [],
      },
    };
  }
  return {
    providers: {
      list: async () => listProviders(),
      status: async (providerId: string, options) => getProviderStatus(providerId, options),
    },
    models: {
      recent: async (providerId: string) => listRecentModelInfo(providerId),
    },
  };
}
