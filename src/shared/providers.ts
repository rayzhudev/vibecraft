import type { ProviderId as AgentConnectProviderId } from '@agentconnect/host';

/**
 * VibeCraft extends AgentConnect's provider list with additional aggregators
 * and platform-level providers that are not (yet) part of the upstream library.
 */
type VibeCraftExtendedProviderId = AgentConnectProviderId | 'google' | 'maitrix';

/**
 * Providers shown in production UI. Internal-only providers like 'maitrix'
 * are excluded here until confirmed working via MemFlow plugin integration.
 * To re-enable maitrix for internal testing, add it back to this array.
 */
export const SUPPORTED_AGENT_PROVIDERS = [
  'claude',
  'codex',
  'google',
  'cursor',
] as const satisfies readonly VibeCraftExtendedProviderId[];

export const TUTORIAL_HERO_PROVIDERS = [
  'claude',
  'codex',
] as const satisfies readonly AgentConnectProviderId[];

export type SupportedAgentProvider = (typeof SUPPORTED_AGENT_PROVIDERS)[number];

/**
 * Full extended provider type including internal-only providers.
 * Use this for code that needs to reference maitrix even when it's
 * not in the active SUPPORTED_AGENT_PROVIDERS list.
 */
export type ExtendedProviderId = VibeCraftExtendedProviderId;

export const isSupportedAgentProvider = (value: string): value is SupportedAgentProvider =>
  SUPPORTED_AGENT_PROVIDERS.includes(value as SupportedAgentProvider);
