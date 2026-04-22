import { z } from 'zod';
import type { IpcError, IpcResult, IpcSuccess } from '../../shared/types';
import { SUPPORTED_AGENT_PROVIDERS } from '../../shared/providers';

export type { IpcError, IpcResult, IpcSuccess } from '../../shared/types';

/**
 * Standardized IPC response types
 */

/**
 * Helper to create success responses
 */
export function success<T>(data: T): IpcSuccess<T> {
  return { success: true, data };
}

/**
 * Helper to create error responses
 */
export function error(message: string): IpcError {
  return { success: false, error: message };
}

/**
 * Helper to wrap try-catch with standardized error handling
 */
export async function handleIpc<T>(fn: () => Promise<T> | T): Promise<IpcResult<T>> {
  try {
    const result = await fn();
    return success(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[ipc] error', message, err);
    return error(message);
  }
}

/**
 * Common validation schemas
 */

// Basic types
export const NonEmptyString = z.string().min(1, 'Cannot be empty');
export const WorkspacePath = z.string().min(1, 'Invalid workspace path');
export const EntityId = z.string().min(1, 'Invalid entity ID');
export const FiniteNumber = z.number().finite('Must be a finite number');
export const PositiveFiniteNumber = FiniteNumber.positive('Must be positive');

// Coordinates
export const CoordinatesSchema = z.object({
  x: FiniteNumber,
  y: FiniteNumber,
});

export const OptionalCoordinatesSchema = z.object({
  x: FiniteNumber.optional(),
  y: FiniteNumber.optional(),
});

// Dimensions
export const DimensionsSchema = z.object({
  width: PositiveFiniteNumber,
  height: PositiveFiniteNumber,
});

export const OptionalDimensionsSchema = z.object({
  width: PositiveFiniteNumber.optional(),
  height: PositiveFiniteNumber.optional(),
});

// Agent provider
export const AgentProvider = z.enum(SUPPORTED_AGENT_PROVIDERS);

/**
 * Workspace schemas
 */
export const AddRecentWorkspaceSchema = z.object({
  id: NonEmptyString,
  name: NonEmptyString,
  path: NonEmptyString,
  lastAccessed: z.number(),
});

export const RemoveRecentWorkspaceSchema = z.object({
  id: EntityId,
});

export const SelectFolderOptionsSchema = z
  .object({
    title: NonEmptyString.optional(),
  })
  .optional();

export const WorkspaceNotificationsEnabledSchema = z.object({
  enabled: z.boolean(),
});

// Licensing schemas
export const LicensePairingClaimSchema = z.object({
  code: NonEmptyString,
});

export const LicenseCheckoutStartSchema = z.object({
  plan: z.enum(['monthly', 'annual']).optional(),
});

export const LicenseCheckoutConfirmSchema = z.object({
  sessionId: NonEmptyString,
});

/**
 * Folder schemas
 */
export const CreateFolderSchema = z.object({
  workspacePath: WorkspacePath,
  name: NonEmptyString,
  x: FiniteNumber,
  y: FiniteNumber,
});

export const ImportExistingFolderSchema = z.object({
  workspacePath: WorkspacePath,
  relativePath: NonEmptyString,
  x: FiniteNumber,
  y: FiniteNumber,
});

export const ProbeFolderGitSchema = z.object({
  workspacePath: WorkspacePath,
  relativePath: NonEmptyString,
});

export const CreateGitWorktreeSchema = z.object({
  workspacePath: WorkspacePath,
  folderId: EntityId,
  x: FiniteNumber,
  y: FiniteNumber,
});

export const WorktreeOperationSchema = z.object({
  workspacePath: WorkspacePath,
  folderId: EntityId,
});

export const RenameFolderSchema = z.object({
  workspacePath: WorkspacePath,
  folderId: EntityId,
  newName: NonEmptyString,
});

export const RemoveFolderSchema = z.object({
  workspacePath: WorkspacePath,
  folderId: EntityId,
});

export const UpdateFolderPositionSchema = z.object({
  workspacePath: WorkspacePath,
  folderId: EntityId,
  x: FiniteNumber,
  y: FiniteNumber,
});

/**
 * Agent schemas
 */
export const LoadAgentsSchema = z.object({
  workspacePath: WorkspacePath,
});

export const SpawnAgentSchema = z.object({
  workspacePath: WorkspacePath,
  provider: AgentProvider,
  model: z.string().optional(),
  name: NonEmptyString,
  displayName: NonEmptyString,
  color: z.string(),
  x: FiniteNumber,
  y: FiniteNumber,
  attachedFolderId: EntityId.optional(),
});

export const DestroyAgentSchema = z.object({
  workspacePath: WorkspacePath,
  agentId: EntityId,
});

export const UpdateAgentPositionSchema = z.object({
  workspacePath: WorkspacePath,
  agentId: EntityId,
  x: FiniteNumber,
  y: FiniteNumber,
});

export const UpdateAgentNameSchema = z.object({
  workspacePath: WorkspacePath,
  agentId: EntityId,
  displayName: NonEmptyString,
});

export const UpdateAgentUnreadCompletionSchema = z.object({
  workspacePath: WorkspacePath,
  agentId: EntityId,
  hasUnreadCompletion: z.boolean(),
});

export const MovementIntentSchema = z.object({
  startPos: z.object({
    x: FiniteNumber,
    y: FiniteNumber,
  }),
  targetPos: z.object({
    x: FiniteNumber,
    y: FiniteNumber,
  }),
  startTime: FiniteNumber,
  duration: FiniteNumber,
  intentType: z.enum(['move', 'move+attach']),
  targetId: EntityId.optional(),
});

export const UpdateAgentMovementIntentSchema = z.object({
  workspacePath: WorkspacePath,
  agentId: EntityId,
  movementIntent: MovementIntentSchema,
});

export const AttachAgentToFolderSchema = z.object({
  workspacePath: WorkspacePath,
  agentId: EntityId,
  folderId: EntityId,
  relativePath: NonEmptyString,
});

export const DetachAgentSchema = z.object({
  agentId: EntityId,
  workspacePath: WorkspacePath,
});

export const UpdateHeroMovementIntentSchema = z.object({
  workspacePath: WorkspacePath,
  movementIntent: MovementIntentSchema,
});

/**
 * Browser schemas
 */
export const CreateBrowserPanelSchema = z.object({
  workspacePath: WorkspacePath,
  url: NonEmptyString,
  x: FiniteNumber,
  y: FiniteNumber,
  width: PositiveFiniteNumber,
  height: PositiveFiniteNumber,
  originFolderId: EntityId.optional(),
});

export const DeleteBrowserPanelSchema = z.object({
  workspacePath: WorkspacePath,
  id: EntityId,
});

export const UpdateBrowserPanelSchema = z.object({
  workspacePath: WorkspacePath,
  id: EntityId,
  updates: z.object({
    url: z.string().optional(),
    faviconUrl: z.string().optional(),
    x: FiniteNumber.optional(),
    y: FiniteNumber.optional(),
    width: PositiveFiniteNumber.optional(),
    height: PositiveFiniteNumber.optional(),
    originFolderId: EntityId.optional(),
  }),
});

/**
 * Terminal schemas
 */
export const CreateTerminalSchema = z.object({
  workspacePath: WorkspacePath,
  relativePath: z.string().optional(),
  x: FiniteNumber,
  y: FiniteNumber,
  originFolderId: EntityId.optional(),
  width: PositiveFiniteNumber.optional(),
  height: PositiveFiniteNumber.optional(),
});

export const UpdateTerminalSchema = z.object({
  workspacePath: WorkspacePath,
  terminalId: EntityId,
  updates: z.object({
    x: FiniteNumber.optional(),
    y: FiniteNumber.optional(),
    width: PositiveFiniteNumber.optional(),
    height: PositiveFiniteNumber.optional(),
    lastKnownCwd: z.string().optional(),
    lastUsedAt: FiniteNumber.optional(),
  }),
});

export const DeleteTerminalSchema = z.object({
  workspacePath: WorkspacePath,
  terminalId: EntityId,
});

export const TerminalInputSchema = z.object({
  terminalId: EntityId,
  data: z.string(),
});

export const TerminalResizeSchema = z.object({
  terminalId: EntityId,
  cols: PositiveFiniteNumber.int(),
  rows: PositiveFiniteNumber.int(),
});

export const StartTerminalSessionSchema = z.object({
  terminalId: EntityId,
  workspacePath: WorkspacePath,
  relativePath: z.string().optional(),
  cols: PositiveFiniteNumber.int().optional(),
  rows: PositiveFiniteNumber.int().optional(),
  sessionToken: z.string().optional(),
  reuseIfRunning: z.boolean().optional(),
});

export const AgentConnectRunAgentSchema = z.object({
  agentId: EntityId,
  workspacePath: WorkspacePath,
  relativePath: NonEmptyString,
  prompt: NonEmptyString,
  resumeSessionId: z.string().nullable().optional(),
  runId: z.string().optional(),
  tutorialMode: z.boolean().optional(),
  tutorialScenario: z.enum(['cookie-clicker', 'doodle-jump']).optional(),
});

export const UpdateAgentModelSchema = z.object({
  agentId: EntityId,
  model: NonEmptyString,
});

export const UpdateAgentReasoningEffortSchema = z.object({
  agentId: EntityId,
  reasoningEffort: z.string().nullable().optional(),
});

export const AgentConnectProviderStatusSchema = z.object({
  provider: AgentProvider,
  options: z
    .object({
      force: z.boolean().optional(),
    })
    .optional(),
});

export const AgentConnectProviderInstallSchema = z.object({
  provider: AgentProvider,
});

export const AgentConnectProviderLoginSchema = z.object({
  provider: AgentProvider,
});

export const AgentConnectProvidersRefreshSchema = z.object({
  options: z
    .object({
      force: z.boolean().optional(),
    })
    .optional(),
});

export const AgentConnectModelsRecentSchema = z.object({
  provider: AgentProvider,
  options: z
    .object({
      force: z.boolean().optional(),
    })
    .optional(),
});

export const AgentTerminalStateSchema = z.object({
  workspacePath: WorkspacePath,
  agentId: EntityId,
});

const ContextUsageSchema = z
  .object({
    context_window: z.number().optional(),
    context_tokens: z.number().optional(),
    context_cached_tokens: z.number().optional(),
    context_remaining_tokens: z.number().optional(),
    context_truncated: z.boolean().optional(),
  })
  .strict();

const AgentTerminalViewStateSchema = z
  .object({
    expandedEntryIds: z.array(z.string()).optional(),
    searchOpen: z.boolean().optional(),
    searchQuery: z.string().optional(),
    activeMatchIndex: z.number().int().nonnegative().optional(),
    renderWindow: z
      .object({
        start: z.number().int().nonnegative(),
        end: z.number().int().nonnegative(),
      })
      .optional(),
    autoScrollPinned: z.boolean().optional(),
    scrollTop: z.number().optional(),
    contextUsage: ContextUsageSchema.nullable().optional(),
    lastRunDuration: z.number().nullable().optional(),
    statusStartedAt: z.number().nullable().optional(),
    agentStatus: z.enum(['idle', 'thinking', 'error']).optional(),
    toolStatus: z
      .object({
        state: z.enum(['running', 'error']),
        command: z.string(),
      })
      .nullable()
      .optional(),
    queuedPrompts: z.array(z.string()).optional(),
  })
  .strict();

export const AgentTerminalStateUpdateSchema = z.object({
  workspacePath: WorkspacePath,
  agentId: EntityId,
  state: z
    .object({
      viewState: AgentTerminalViewStateSchema.nullable().optional(),
    })
    .strict(),
});

export const AgentConnectCancelAgentSchema = z.object({
  agentId: EntityId,
});

export const AgentConnectCancelHeroSchema = z.object({
  workspacePath: WorkspacePath,
});

export const EnsureTutorialDevServerSchema = z.object({
  workspacePath: WorkspacePath,
  scenario: z.enum(['cookie-clicker', 'doodle-jump']),
});

export const AccelerateTutorialRunSchema = z.object({
  runId: NonEmptyString,
});

export const HeroSetProviderSchema = z.object({
  workspacePath: WorkspacePath.optional(),
  provider: AgentProvider,
});

export const HeroSetModelSchema = z.object({
  workspacePath: WorkspacePath.optional(),
  model: NonEmptyString,
});

const McpSkillIdSchema = z.string().trim().min(1, 'Invalid MCP skill ID');
const McpSkillIdsSchema = z.array(McpSkillIdSchema);

export const HeroRunSchema = z.object({
  workspacePath: WorkspacePath,
  relativePath: NonEmptyString,
  prompt: NonEmptyString,
  runId: z.string().optional(),
  tutorialMode: z.boolean().optional(),
  tutorialScenario: z.enum(['cookie-clicker', 'doodle-jump']).optional(),
});

/**
 * Hero schemas
 */
export const UpdateHeroPositionSchema = z.object({
  workspacePath: WorkspacePath,
  x: FiniteNumber,
  y: FiniteNumber,
});

export const UpdateHeroNameSchema = z.object({
  workspacePath: WorkspacePath,
  name: NonEmptyString,
});

export const HeroGetMcpSkillsSchema = z.object({
  workspacePath: WorkspacePath,
});

export const HeroSetMcpSkillsSchema = z.object({
  workspacePath: WorkspacePath,
  skillIds: McpSkillIdsSchema,
});

export const AgentGetMcpSkillsSchema = z.object({
  workspacePath: WorkspacePath,
  agentId: EntityId,
});

export const AgentSetMcpSkillsSchema = z.object({
  workspacePath: WorkspacePath,
  agentId: EntityId,
  skillIds: McpSkillIdsSchema,
});

/**
 * MCP schemas
 */
export const McpStartSchema = z.object({
  workspacePath: WorkspacePath,
});

export const McpStopSchema = z.object({
  workspacePath: WorkspacePath.optional(),
});

/**
 * Validation helper that returns standardized error
 */
export function validate<T>(schema: z.ZodSchema<T>, data: unknown): IpcResult<T> {
  try {
    const validated = schema.parse(data);
    return success(validated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const firstError = err.issues[0];
      return error(`${firstError.path.join('.')}: ${firstError.message}`);
    }
    return error(String(err));
  }
}
