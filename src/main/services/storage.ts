import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import type {
  Workspace,
  PriorWorkspacePreviewEntry,
  PriorWorkspacePreviewSource,
  AppSettings,
  Agent,
  AgentProvider,
  AgentTerminalEntry,
  AgentTerminalState,
  AgentTerminalViewState,
  AnyFolder,
  BrowserPanel,
  TerminalPanel,
  Hero,
  TutorialState,
} from '../../shared/types';
import { isSupportedAgentProvider } from '../../shared/providers';
import {
  DEFAULT_TUTORIAL_STATE,
  TUTORIAL_STEPS,
  TUTORIAL_STATUSES,
  TUTORIAL_WORLD_ID,
  TUTORIAL_WORLD_NAME,
} from '../../shared/tutorial';
import { normalizeAudioSettings } from '../../shared/audio';
import { DEFAULT_HERO } from '../../shared/heroDefaults';
import { DEFAULT_TERMINAL_SIZE } from '../../shared/terminalDefaults';
import { getWorkspaceStorageDirName } from './storageNamespace';
import { validateUnitMcpSkills } from './mcpSkills';
import { logger } from '../logger';
const SETTINGS_FILE = 'settings.json';
const WORKSPACES_FILE = 'workspaces.json';
const AGENTS_FILE = 'agents.json';
const FOLDERS_FILE = 'folders.json';
const BROWSERS_FILE = 'browsers.json';
const TERMINALS_FILE = 'terminals.json';
const TUTORIAL_WORLD_DIR = 'worlds';
const IMPORT_BACKUP_DIR = 'import-backups';

// Get user data path for app-level settings
function getAppDataPath(): string {
  return app.getPath('userData');
}

export const getWorkspaceStoragePath = (workspacePath: string): string => {
  return path.join(workspacePath, getWorkspaceStorageDirName());
};

export const getTutorialWorldPath = (): string =>
  path.join(getAppDataPath(), TUTORIAL_WORLD_DIR, TUTORIAL_WORLD_NAME);

export const ensureTutorialWorld = (): Workspace => {
  const worldPath = getTutorialWorldPath();
  ensureDir(worldPath);
  return {
    id: TUTORIAL_WORLD_ID,
    name: TUTORIAL_WORLD_NAME,
    path: worldPath,
    lastAccessed: Date.now(),
  };
};

export const ensureTutorialWorldInRecents = (): Workspace => {
  const world = ensureTutorialWorld();
  addRecentWorkspace(world);
  return world;
};

const resetTutorialWorld = (options?: { force?: boolean }): void => {
  if (!options?.force && tutorialWorldReset) return;
  tutorialWorldReset = true;
  const worldPath = getTutorialWorldPath();
  if (!fs.existsSync(worldPath)) return;
  try {
    fs.rmSync(worldPath, { recursive: true });
  } catch (error) {
    log.warn('Failed to reset tutorial world', { error });
  }
};

export const resetTutorialWorldState = (): Workspace => {
  resetTutorialWorld({ force: true });
  return ensureTutorialWorldInRecents();
};

// Get workspace storage directory
function getWorkspaceMeta(workspacePath: string): string {
  return getWorkspaceStoragePath(workspacePath);
}

// Ensure directory exists
function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// Read JSON file safely
function readJson<T>(filePath: string, defaultValue: T): T {
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error(`Error reading ${filePath}:`, e);
  }
  return defaultValue;
}

// Write JSON file safely
function writeJson(filePath: string, data: unknown): boolean {
  try {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error(`Error writing ${filePath}:`, e);
    return false;
  }
}

const AGENT_TERMINAL_HISTORY_DIR = 'agent-terminal-history';
const TERMINAL_HISTORY_DIR = 'terminal-history';
const CUSTOM_SOUNDS_DIR = path.join('audio', 'custom-sounds');
const SUPPORTED_CUSTOM_SOUND_EXTENSIONS = new Set(['.wav', '.mp3', '.ogg', '.m4a', '.aac', '.flac', '.webm']);

const log = logger.scope('storage');
let tutorialWorldReset = false;

const normalizeProviderId = (value: unknown): AgentProvider | null => {
  if (typeof value !== 'string') return null;
  if (!isSupportedAgentProvider(value)) return null;
  return value;
};

const coerceProviderId = (value: unknown): AgentProvider | undefined => {
  if (typeof value !== 'string') return undefined;
  if (isSupportedAgentProvider(value)) return value;
  return undefined;
};

const normalizeReasoningDefaults = (value: unknown): Partial<Record<AgentProvider, string>> | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return undefined;
  const result: Partial<Record<AgentProvider, string>> = {};
  for (const [key, raw] of entries) {
    if (!isSupportedAgentProvider(key)) continue;
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    result[key as AgentProvider] = trimmed;
  }
  return Object.keys(result).length > 0 ? result : undefined;
};

const normalizeAgentModelDefaults = (value: unknown): Partial<Record<AgentProvider, string>> | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return undefined;
  const result: Partial<Record<AgentProvider, string>> = {};
  for (const [key, raw] of entries) {
    if (!isSupportedAgentProvider(key)) continue;
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    result[key as AgentProvider] = trimmed;
  }
  return Object.keys(result).length > 0 ? result : undefined;
};

const normalizeAgentNameSequencesByWorkspace = (
  value: unknown
): Record<string, Partial<Record<AgentProvider, number>>> | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return undefined;
  const normalized: Record<string, Partial<Record<AgentProvider, number>>> = {};
  for (const [workspacePath, raw] of entries) {
    if (!raw || typeof raw !== 'object') continue;
    const providerEntries = Object.entries(raw as Record<string, unknown>);
    if (providerEntries.length === 0) continue;
    const providerCounts: Partial<Record<AgentProvider, number>> = {};
    for (const [provider, count] of providerEntries) {
      if (!isSupportedAgentProvider(provider)) continue;
      if (typeof count !== 'number' || !Number.isFinite(count)) continue;
      const normalizedCount = Math.max(0, Math.floor(count));
      providerCounts[provider as AgentProvider] = normalizedCount;
    }
    if (Object.keys(providerCounts).length > 0) {
      normalized[workspacePath] = providerCounts;
    }
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
};

const shouldResetTutorial = (): boolean => {
  const raw = process.env.VIBECRAFT_TUTORIAL_RESET;
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
};
const normalizeSessionId = (value: unknown): string | null | undefined => {
  if (typeof value === 'string') return value;
  if (value === null) return null;
  return undefined;
};

const normalizeProviderSessionIds = (
  value: unknown
): Partial<Record<AgentProvider, string | null>> | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return undefined;
  const result: Partial<Record<AgentProvider, string | null>> = {};
  let hasEntries = false;
  for (const [key, raw] of entries) {
    if (!isSupportedAgentProvider(key)) continue;
    const normalized = normalizeSessionId(raw);
    if (normalized === undefined) continue;
    result[key as AgentProvider] = normalized;
    hasEntries = true;
  }
  return hasEntries ? result : undefined;
};

const normalizeReasoningEffort = (value: unknown): string | null | undefined => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (value === null) return null;
  return undefined;
};

const areStringArraysEqual = (left: string[] | undefined, right: string[] | undefined): boolean => {
  if (!left || !right) return left === right;
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
};

const normalizeAgentRecord = (
  record: Agent & { sessionId?: string | null }
): { agent: Agent | null; changed: boolean; valid: boolean; reason?: string } => {
  if (typeof record.id !== 'string' || record.id.length === 0) {
    return { agent: null, changed: false, valid: false, reason: 'missing id' };
  }
  const provider = normalizeProviderId(record.provider);
  if (!provider) {
    return { agent: null, changed: false, valid: false, reason: 'invalid provider' };
  }
  const color = typeof record.color === 'string' && record.color.trim().length > 0 ? record.color : null;
  if (!color) {
    return { agent: null, changed: false, valid: false, reason: 'invalid color' };
  }
  let changed = false;
  const model = typeof record.model === 'string' ? record.model : '';
  if (model !== record.model) changed = true;
  if (color !== record.color) changed = true;
  const agentConnectSessionId = normalizeSessionId(record.agentConnectSessionId);
  if (agentConnectSessionId !== record.agentConnectSessionId) changed = true;
  const providerSessionId =
    normalizeSessionId(record.providerSessionId) ?? normalizeSessionId(record.sessionId);
  if (providerSessionId !== record.providerSessionId || record.sessionId !== undefined) {
    changed = true;
  }
  const reasoningEffort = normalizeReasoningEffort(record.reasoningEffort);
  if (reasoningEffort !== record.reasoningEffort) changed = true;
  const normalizedMcpSkills = validateUnitMcpSkills({
    unitType: 'agent',
    skillIds: record.mcpSkillIds,
    provider,
  }).skillIds;
  if (!areStringArraysEqual(normalizedMcpSkills, record.mcpSkillIds)) changed = true;
  const hasUnreadCompletion =
    typeof record.hasUnreadCompletion === 'boolean' ? record.hasUnreadCompletion : false;
  if (hasUnreadCompletion !== record.hasUnreadCompletion) changed = true;
  const rest = { ...record };
  if ('sessionId' in rest) {
    delete (rest as { sessionId?: string | null }).sessionId;
  }
  return {
    agent: {
      ...rest,
      provider,
      model,
      color,
      reasoningEffort,
      agentConnectSessionId,
      providerSessionId,
      hasUnreadCompletion,
      mcpSkillIds: normalizedMcpSkills,
    },
    changed,
    valid: true,
  };
};

const normalizeHeroRecord = (
  record: Hero & { sessionId?: string | null }
): { hero: Hero; changed: boolean; valid: boolean; reason?: string } => {
  if (record.id !== 'hero') {
    return { hero: DEFAULT_HERO, changed: false, valid: false, reason: 'invalid id' };
  }
  const provider = normalizeProviderId(record.provider);
  if (!provider) {
    return { hero: DEFAULT_HERO, changed: false, valid: false, reason: 'invalid provider' };
  }
  let changed = false;
  const model = typeof record.model === 'string' ? record.model : '';
  if (model !== record.model) changed = true;
  const agentConnectSessionId = normalizeSessionId(record.agentConnectSessionId);
  if (agentConnectSessionId !== record.agentConnectSessionId) changed = true;
  const providerSessionIds = normalizeProviderSessionIds(record.providerSessionIds);
  if (record.providerSessionIds !== undefined) {
    const normalized = JSON.stringify(providerSessionIds);
    const raw = JSON.stringify(record.providerSessionIds);
    if (normalized !== raw) changed = true;
  }
  const resolvedProviderSessionId = providerSessionIds?.[provider];
  if (resolvedProviderSessionId !== record.providerSessionId || record.sessionId !== undefined) {
    changed = true;
  }
  const reasoningEffort = normalizeReasoningEffort(record.reasoningEffort);
  if (reasoningEffort !== record.reasoningEffort) changed = true;
  const normalizedMcpSkills = validateUnitMcpSkills({
    unitType: 'hero',
    skillIds: record.mcpSkillIds,
    provider,
  }).skillIds;
  if (!areStringArraysEqual(normalizedMcpSkills, record.mcpSkillIds)) changed = true;
  const rest = { ...record };
  if ('sessionId' in rest) {
    delete (rest as { sessionId?: string | null }).sessionId;
  }
  return {
    hero: {
      ...rest,
      provider,
      model,
      reasoningEffort,
      agentConnectSessionId,
      providerSessionId: resolvedProviderSessionId,
      providerSessionIds,
      mcpSkillIds: normalizedMcpSkills,
    },
    changed,
    valid: true,
  };
};

const normalizeTutorialState = (value: unknown): TutorialState => {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_TUTORIAL_STATE };
  }
  const record = value as TutorialState;
  const status = TUTORIAL_STATUSES.includes(record.status) ? record.status : DEFAULT_TUTORIAL_STATE.status;
  const stepId = TUTORIAL_STEPS.includes(record.stepId) ? record.stepId : DEFAULT_TUTORIAL_STATE.stepId;
  const version = record.version === 1 ? 1 : DEFAULT_TUTORIAL_STATE.version;
  const updatedAt = typeof record.updatedAt === 'number' ? record.updatedAt : undefined;
  const workspaceId = typeof record.workspaceId === 'string' ? record.workspaceId : undefined;
  const workspacePath = typeof record.workspacePath === 'string' ? record.workspacePath : undefined;
  const createdIds =
    record.createdIds && typeof record.createdIds === 'object' ? record.createdIds : undefined;
  const promptRunId = typeof record.promptRunId === 'string' ? record.promptRunId : undefined;
  const promptRunId2 = typeof record.promptRunId2 === 'string' ? record.promptRunId2 : undefined;
  const promptCompletedAt =
    typeof record.promptCompletedAt === 'number' ? record.promptCompletedAt : undefined;
  const promptCompletedAt2 =
    typeof record.promptCompletedAt2 === 'number' ? record.promptCompletedAt2 : undefined;
  const completionPromptSeenAt =
    typeof record.completionPromptSeenAt === 'number' ? record.completionPromptSeenAt : undefined;
  return {
    status,
    stepId,
    version,
    updatedAt,
    workspaceId,
    workspacePath,
    createdIds,
    promptRunId,
    promptRunId2,
    promptCompletedAt,
    promptCompletedAt2,
    completionPromptSeenAt,
  };
};

function cleanupHistoryDir(dirPath: string, keepIds: Set<string>, allowedExtensions: string[]): void {
  try {
    if (!fs.existsSync(dirPath)) return;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    entries.forEach((entry) => {
      if (!entry.isFile()) return;
      const matched = allowedExtensions
        .filter((ext) => entry.name.endsWith(ext))
        .sort((a, b) => b.length - a.length)[0];
      if (!matched) return;
      const id = entry.name.slice(0, -matched.length);
      if (!keepIds.has(id)) {
        fs.unlinkSync(path.join(dirPath, entry.name));
      }
    });
  } catch {
    // noop
  }
}

const normalizeWorkspacePath = (value: string): string => {
  const normalized = path.normalize(path.resolve(value));
  const root = path.parse(normalized).root;
  if (normalized.length <= root.length) return normalized;
  return normalized.replace(/[\\/]+$/, '');
};

const deriveWorkspaceName = (value: string): string => path.basename(value) || value;

const sanitizeCustomSoundName = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return 'sound';
  const normalized = trimmed
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized.slice(0, 80) || 'sound';
};

export function importCustomSoundFromPath(filePath: string): { sourceUrl: string; displayName: string } {
  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error('Selected sound file does not exist');
  }
  const stats = fs.statSync(resolvedPath);
  if (!stats.isFile()) {
    throw new Error('Selected sound path is not a file');
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  if (!SUPPORTED_CUSTOM_SOUND_EXTENSIONS.has(ext)) {
    throw new Error('Unsupported sound file type');
  }

  const originalBaseName = path.basename(resolvedPath, ext);
  const sanitizedBaseName = sanitizeCustomSoundName(originalBaseName);
  const targetDir = path.join(getAppDataPath(), CUSTOM_SOUNDS_DIR);
  ensureDir(targetDir);

  const targetFileName = `${randomUUID()}-${sanitizedBaseName}${ext}`;
  const targetPath = path.join(targetDir, targetFileName);
  fs.copyFileSync(resolvedPath, targetPath);

  return {
    sourceUrl: pathToFileURL(targetPath).toString(),
    displayName: originalBaseName || path.basename(resolvedPath),
  };
}

// App-level settings
export function loadSettings(): AppSettings {
  const settingsPath = path.join(getAppDataPath(), SETTINGS_FILE);
  const stored = readJson<AppSettings>(settingsPath, {});
  const legacyAudioKeys = stored as AppSettings & { muteAudio?: unknown; muteSfx?: unknown };
  const resetTutorial = shouldResetTutorial();
  if (resetTutorial) {
    resetTutorialWorld();
  }
  const heroProvider = resetTutorial ? undefined : coerceProviderId(stored.heroProvider);
  const heroModel = resetTutorial || typeof stored.heroModel !== 'string' ? undefined : stored.heroModel;
  const reasoningDefaults = normalizeReasoningDefaults(stored.defaultReasoningEffortByProvider);
  const agentModelDefaults = normalizeAgentModelDefaults(stored.lastAgentModelByProvider);
  const agentNameSequencesByWorkspace = normalizeAgentNameSequencesByWorkspace(
    stored.agentNameSequencesByWorkspace
  );
  const audio = normalizeAudioSettings(stored.audio, {
    muteAudio: legacyAudioKeys.muteAudio,
    muteSfx: legacyAudioKeys.muteSfx,
  });
  const tutorial = resetTutorial ? { ...DEFAULT_TUTORIAL_STATE } : normalizeTutorialState(stored.tutorial);
  if (!resetTutorial && stored.heroProvider !== undefined && !heroProvider) {
    log.warn('Invalid hero provider in settings', { value: stored.heroProvider });
  }
  const next: AppSettings = {
    ...stored,
    audio,
    ...(heroProvider ? { heroProvider } : {}),
    ...(heroModel ? { heroModel } : {}),
    ...(reasoningDefaults ? { defaultReasoningEffortByProvider: reasoningDefaults } : {}),
    ...(agentModelDefaults ? { lastAgentModelByProvider: agentModelDefaults } : {}),
    ...(agentNameSequencesByWorkspace ? { agentNameSequencesByWorkspace } : {}),
    tutorial,
  };
  if (resetTutorial) {
    delete next.heroProvider;
    delete next.heroModel;
  }
  delete (next as AppSettings & { muteAudio?: unknown; muteSfx?: unknown }).muteAudio;
  delete (next as AppSettings & { muteAudio?: unknown; muteSfx?: unknown }).muteSfx;
  return next;
}

export const mergeSettingsPatch = (base: AppSettings, patch: Partial<AppSettings>): AppSettings => {
  const next: AppSettings = {
    ...base,
    ...patch,
  };
  if (patch.audio) {
    next.audio = {
      ...(base.audio ?? {}),
      ...patch.audio,
    };
  }
  if (patch.uiState) {
    next.uiState = {
      ...(base.uiState ?? {}),
      ...patch.uiState,
    };
  }
  if (patch.defaultReasoningEffortByProvider) {
    next.defaultReasoningEffortByProvider = {
      ...(base.defaultReasoningEffortByProvider ?? {}),
      ...patch.defaultReasoningEffortByProvider,
    };
  }
  if (patch.lastAgentModelByProvider) {
    next.lastAgentModelByProvider = {
      ...(base.lastAgentModelByProvider ?? {}),
      ...patch.lastAgentModelByProvider,
    };
  }
  return next;
};

export function saveSettings(settings: AppSettings): boolean {
  const current = loadSettings();
  const next = mergeSettingsPatch(current, settings);
  const settingsPath = path.join(getAppDataPath(), SETTINGS_FILE);
  return writeJson(settingsPath, next);
}

type PriorSettingsInfo = {
  found: boolean;
  sourceDir?: string;
  settingsPath?: string;
  workspacesPath?: string;
};

type PriorWorkspacePreview = {
  found: boolean;
  sourceDir?: string;
  workspaces: PriorWorkspacePreviewEntry[];
  sources: PriorWorkspacePreviewSource[];
};

type PriorSettingsCandidate = PriorSettingsInfo & {
  workspaces: Workspace[];
  nonTutorialWorkspaces: Workspace[];
  settings: AppSettings;
  meaningfulSettingsScore: number;
  sourceName?: string;
  sourceUpdatedAt?: number;
  sourceKind: 'live' | 'backup';
};

const isTutorialWorkspace = (workspace: Pick<Workspace, 'id' | 'name'>): boolean =>
  workspace.id === TUTORIAL_WORLD_ID || workspace.name === TUTORIAL_WORLD_NAME;

function formatSourceName(sourceDir?: string): string | undefined {
  if (!sourceDir) return undefined;
  const baseName = path.basename(sourceDir);
  if (!baseName) return undefined;
  if (/^vibecraft-dev$/i.test(baseName)) return 'VibeCraft Dev';
  if (/^vibecraft$/i.test(baseName)) return 'VibeCraft';
  if (/^electron$/i.test(baseName)) return 'Electron Legacy';
  return baseName.replace(/[-_]+/g, ' ');
}

function formatBackupSourceName(appDir: string, snapshotDir: string): string {
  const parentName = formatSourceName(appDir) ?? path.basename(appDir);
  const snapshotName = path.basename(snapshotDir);
  const match = snapshotName.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d{3}))?Z$/);
  const isoLike = match
    ? `${match[1]}T${match[2]}:${match[3]}:${match[4]}${match[5] ? `.${match[5]}` : ''}Z`
    : null;
  const parsed = isoLike && !Number.isNaN(Date.parse(isoLike)) ? new Date(isoLike) : null;
  if (!parsed) {
    return `${parentName} Backup`;
  }
  return `${parentName} Backup ${parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`;
}

function getPlatformAppDataRoot(): string {
  const homedir = process.env.HOME ?? process.env.USERPROFILE ?? '';
  if (process.platform === 'darwin') {
    return path.join(homedir, 'Library', 'Application Support');
  }
  if (process.platform === 'win32') {
    return process.env.APPDATA ?? path.join(homedir, 'AppData', 'Roaming');
  }
  return path.join(homedir, '.config');
}

function collectSiblingAppDataPaths(): string[] {
  const root = getPlatformAppDataRoot();
  const candidates: string[] = [];
  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (/^VibeCraft(?:\b|[-_ ].*)?$/i.test(entry.name) || /^Electron(?:\b|[-_ ].*)?$/i.test(entry.name)) {
        candidates.push(path.join(root, entry.name));
      }
    }
  } catch {
    // best effort
  }
  return candidates;
}

function normalizeStoredWorkspaces(stored: Workspace[]): Workspace[] {
  const normalized: Workspace[] = [];
  const seenPaths = new Set<string>();
  const seenIds = new Set<string>();

  stored.forEach((workspace) => {
    if (
      !workspace ||
      typeof workspace.path !== 'string' ||
      typeof workspace.id !== 'string' ||
      workspace.id.length === 0
    ) {
      return;
    }
    const normalizedPath = normalizeWorkspacePath(workspace.path);
    if (!fs.existsSync(normalizedPath)) return;
    const name = deriveWorkspaceName(normalizedPath);
    if (seenPaths.has(normalizedPath) || seenIds.has(workspace.id)) return;
    seenPaths.add(normalizedPath);
    seenIds.add(workspace.id);
    normalized.push({
      ...workspace,
      path: normalizedPath,
      name,
    });
  });

  normalized.sort((a, b) => b.lastAccessed - a.lastAccessed);
  return normalized;
}

function loadNormalizedWorkspacesFromFile(filePath?: string): Workspace[] {
  if (!filePath || !fs.existsSync(filePath)) return [];
  return normalizeStoredWorkspaces(readJson<Workspace[]>(filePath, []));
}

function loadNormalizedSettingsFromFile(filePath?: string): AppSettings {
  if (!filePath || !fs.existsSync(filePath)) return {};
  const stored = readJson<AppSettings>(filePath, {});
  return {
    ...stored,
    tutorial: normalizeTutorialState(stored.tutorial),
  };
}

function scoreMeaningfulSettings(settings: AppSettings): number {
  let score = 0;

  if (typeof settings.heroProvider === 'string' && settings.heroProvider.trim().length > 0) score += 3;
  if (typeof settings.heroModel === 'string' && settings.heroModel.trim().length > 0) score += 3;
  if (typeof settings.workspacePath === 'string' && settings.workspacePath.trim().length > 0) score += 2;
  if (settings.disableGit === true) score += 1;
  if (settings.edgePanEnabled === false) score += 1;
  if (typeof settings.priorImportCompletedAt === 'number') score += 1;
  if (settings.audio && Object.keys(settings.audio).length > 0) score += 2;
  if (
    settings.defaultReasoningEffortByProvider &&
    Object.keys(settings.defaultReasoningEffortByProvider).length > 0
  ) {
    score += 2;
  }
  if (settings.lastAgentModelByProvider && Object.keys(settings.lastAgentModelByProvider).length > 0) {
    score += 2;
  }
  if (
    settings.agentNameSequencesByWorkspace &&
    Object.keys(settings.agentNameSequencesByWorkspace).length > 0
  ) {
    score += 2;
  }
  if (settings.providerRegistryCache && Object.keys(settings.providerRegistryCache).length > 0) {
    score += 2;
  }
  if (
    settings.uiState?.abilityVariantSelections &&
    Object.keys(settings.uiState.abilityVariantSelections).length > 0
  ) {
    score += 1;
  }

  const tutorial = normalizeTutorialState(settings.tutorial);
  if (
    tutorial.status === 'in_progress' ||
    tutorial.status === 'completed' ||
    tutorial.stepId !== DEFAULT_TUTORIAL_STATE.stepId ||
    tutorial.workspaceId ||
    tutorial.workspacePath
  ) {
    score += 1;
  }

  return score;
}

function getSourceUpdatedAt(dir: string, fallbackWorkspaces: Workspace[]): number {
  try {
    return fs.statSync(dir).mtimeMs;
  } catch {
    return fallbackWorkspaces[0]?.lastAccessed ?? 0;
  }
}

function rankPriorSettingsCandidate(left: PriorSettingsCandidate, right: PriorSettingsCandidate): number {
  const nonTutorialDiff = right.nonTutorialWorkspaces.length - left.nonTutorialWorkspaces.length;
  if (nonTutorialDiff !== 0) return nonTutorialDiff;

  const meaningfulSettingsDiff = right.meaningfulSettingsScore - left.meaningfulSettingsScore;
  if (meaningfulSettingsDiff !== 0) return meaningfulSettingsDiff;

  const leftLatest = left.nonTutorialWorkspaces[0]?.lastAccessed ?? 0;
  const rightLatest = right.nonTutorialWorkspaces[0]?.lastAccessed ?? 0;
  if (rightLatest !== leftLatest) return rightLatest - leftLatest;

  const leftVibeCraft = left.sourceDir?.toLowerCase().includes('vibecraft') ? 1 : 0;
  const rightVibeCraft = right.sourceDir?.toLowerCase().includes('vibecraft') ? 1 : 0;
  if (rightVibeCraft !== leftVibeCraft) return rightVibeCraft - leftVibeCraft;

  // Prefer the canonical "VibeCraft" app data dir over other casing variants when otherwise tied.
  const leftExactVibeCraft = path.basename(left.sourceDir ?? '') === 'VibeCraft' ? 1 : 0;
  const rightExactVibeCraft = path.basename(right.sourceDir ?? '') === 'VibeCraft' ? 1 : 0;
  if (rightExactVibeCraft !== leftExactVibeCraft) return rightExactVibeCraft - leftExactVibeCraft;

  if (left.sourceKind !== right.sourceKind) {
    return left.sourceKind === 'live' ? -1 : 1;
  }

  const totalWorkspacesDiff = right.workspaces.length - left.workspaces.length;
  if (totalWorkspacesDiff !== 0) return totalWorkspacesDiff;

  const leftUpdatedAt = left.sourceUpdatedAt ?? 0;
  const rightUpdatedAt = right.sourceUpdatedAt ?? 0;
  if (rightUpdatedAt !== leftUpdatedAt) return rightUpdatedAt - leftUpdatedAt;

  return (left.sourceDir ?? '').localeCompare(right.sourceDir ?? '');
}

function rankPriorSettingsImportCandidate(
  left: PriorSettingsCandidate,
  right: PriorSettingsCandidate
): number {
  if (left.sourceKind !== right.sourceKind) {
    return left.sourceKind === 'live' ? -1 : 1;
  }
  return rankPriorSettingsCandidate(left, right);
}

function getPriorSettingsCandidates(): PriorSettingsCandidate[] {
  const currentPath = path.resolve(getAppDataPath());
  const explicitCandidates = [
    path.join(getPlatformAppDataRoot(), 'VibeCraft'),
    path.join(getPlatformAppDataRoot(), 'Electron'),
  ];
  const candidates = new Set<string>([...collectSiblingAppDataPaths(), ...explicitCandidates]);
  const resolved: PriorSettingsCandidate[] = [];

  for (const dir of candidates) {
    const resolvedDir = path.resolve(dir);
    if (resolvedDir === currentPath) continue;
    const settingsPath = path.join(resolvedDir, SETTINGS_FILE);
    const workspacesPath = path.join(resolvedDir, WORKSPACES_FILE);
    if (fs.existsSync(settingsPath) || fs.existsSync(workspacesPath)) {
      const workspaces = loadNormalizedWorkspacesFromFile(workspacesPath);
      const settings = loadNormalizedSettingsFromFile(settingsPath);
      resolved.push({
        found: true,
        sourceDir: resolvedDir,
        settingsPath: fs.existsSync(settingsPath) ? settingsPath : undefined,
        workspacesPath: fs.existsSync(workspacesPath) ? workspacesPath : undefined,
        workspaces,
        nonTutorialWorkspaces: workspaces.filter((workspace) => !isTutorialWorkspace(workspace)),
        settings,
        meaningfulSettingsScore: scoreMeaningfulSettings(settings),
        sourceName: formatSourceName(resolvedDir),
        sourceUpdatedAt: getSourceUpdatedAt(resolvedDir, workspaces),
        sourceKind: 'live',
      });
    }

    const backupsDir = path.join(resolvedDir, IMPORT_BACKUP_DIR);
    if (!fs.existsSync(backupsDir)) continue;
    const backupEntries = fs.readdirSync(backupsDir, { withFileTypes: true });
    for (const entry of backupEntries) {
      if (!entry.isDirectory()) continue;
      const snapshotDir = path.join(backupsDir, entry.name);
      const snapshotSettingsPath = path.join(snapshotDir, SETTINGS_FILE);
      const snapshotWorkspacesPath = path.join(snapshotDir, WORKSPACES_FILE);
      if (!fs.existsSync(snapshotSettingsPath) && !fs.existsSync(snapshotWorkspacesPath)) continue;
      const workspaces = loadNormalizedWorkspacesFromFile(snapshotWorkspacesPath);
      const settings = loadNormalizedSettingsFromFile(snapshotSettingsPath);
      resolved.push({
        found: true,
        sourceDir: snapshotDir,
        settingsPath: fs.existsSync(snapshotSettingsPath) ? snapshotSettingsPath : undefined,
        workspacesPath: fs.existsSync(snapshotWorkspacesPath) ? snapshotWorkspacesPath : undefined,
        workspaces,
        nonTutorialWorkspaces: workspaces.filter((workspace) => !isTutorialWorkspace(workspace)),
        settings,
        meaningfulSettingsScore: scoreMeaningfulSettings(settings),
        sourceName: formatBackupSourceName(resolvedDir, snapshotDir),
        sourceUpdatedAt: getSourceUpdatedAt(snapshotDir, workspaces),
        sourceKind: 'backup',
      });
    }
  }

  resolved.sort(rankPriorSettingsCandidate);
  return resolved;
}

function getPriorSettingsSource(): PriorSettingsInfo {
  const candidates = getPriorSettingsCandidates();
  const best = [...candidates].sort(rankPriorSettingsImportCandidate)[0];
  if (!best) return { found: false };
  return {
    found: true,
    sourceDir: best.sourceDir,
    settingsPath: best.settingsPath,
    workspacesPath: best.workspacesPath,
  };
}

// Check if a prior VibeCraft installation's settings exist.
export function checkForPriorSettings(): PriorSettingsInfo {
  return getPriorSettingsSource();
}

export function getPriorWorkspacePreview(): PriorWorkspacePreview {
  const candidates = getPriorSettingsCandidates();
  const source = [...candidates].sort(rankPriorSettingsImportCandidate)[0] ?? candidates[0];
  if (!source) {
    return { found: false, workspaces: [], sources: [] };
  }

  const normalized: PriorWorkspacePreviewEntry[] = [];
  const seenPaths = new Set<string>();
  const sources: PriorWorkspacePreviewSource[] = [];
  for (const candidate of candidates) {
    const sourceEntries: PriorWorkspacePreviewEntry[] = [];
    const sourceName = candidate.sourceName ?? formatSourceName(candidate.sourceDir);
    for (const workspace of candidate.nonTutorialWorkspaces) {
      const nextEntry: PriorWorkspacePreviewEntry = {
        ...workspace,
        sourceDir: candidate.sourceDir,
        sourceName,
      };
      sourceEntries.push(nextEntry);
      if (seenPaths.has(workspace.path)) continue;
      seenPaths.add(workspace.path);
      normalized.push(nextEntry);
    }
    if (sourceEntries.length > 0) {
      sources.push({
        sourceDir: candidate.sourceDir,
        sourceName,
        sourceUpdatedAt: candidate.sourceUpdatedAt,
        workspaces: sourceEntries,
      });
    }
  }

  normalized.sort((a, b) => b.lastAccessed - a.lastAccessed);
  return {
    found: normalized.length > 0 || candidates.length > 0,
    sourceDir: source.sourceDir,
    workspaces: normalized,
    sources,
  };
}

function restoreFileFromBackup(backupDir: string, fileName: string, targetPath: string): void {
  const backupFile = path.join(backupDir, fileName);
  if (!fs.existsSync(backupFile)) {
    if (fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { force: true });
    }
    return;
  }
  fs.copyFileSync(backupFile, targetPath);
}

function mergeImportedSettingsForCurrentInstall(current: AppSettings, imported: AppSettings): AppSettings {
  const merged = mergeSettingsPatch(imported, current);
  if (current.workspacePath !== undefined) {
    merged.workspacePath = current.workspacePath;
  }
  if (current.tutorial) {
    merged.tutorial = current.tutorial;
  }
  merged.priorImportCompletedAt = Date.now();
  return merged;
}

// Backup current settings and import from a prior installation
export function backupAndImportSettings(): {
  success: boolean;
  backupPath?: string;
  error?: string;
  importedCount?: number;
  duplicateCount?: number;
  sourceCount?: number;
} {
  const candidates = getPriorSettingsCandidates();
  const source = [...candidates].sort(rankPriorSettingsImportCandidate)[0];
  if (!source || candidates.every((candidate) => !candidate.settingsPath && !candidate.workspacesPath)) {
    return { success: false, error: 'No prior settings were found to import.' };
  }

  const appDataPath = getAppDataPath();
  const settingsPath = path.join(appDataPath, SETTINGS_FILE);
  const workspacesPath = path.join(appDataPath, WORKSPACES_FILE);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(appDataPath, IMPORT_BACKUP_DIR, timestamp);
  try {
    ensureDir(backupPath);
    if (fs.existsSync(settingsPath)) fs.copyFileSync(settingsPath, path.join(backupPath, SETTINGS_FILE));
    if (fs.existsSync(workspacesPath))
      fs.copyFileSync(workspacesPath, path.join(backupPath, WORKSPACES_FILE));
  } catch (err) {
    logger.warn('[storage] Could not backup settings before import:', err);
    return { success: false, error: 'Failed to backup current settings' };
  }

  try {
    const currentSettings = readJson<AppSettings>(settingsPath, {});
    const importedSettings =
      source.settingsPath && fs.existsSync(source.settingsPath)
        ? readJson<AppSettings>(source.settingsPath, {})
        : {};
    writeJson(settingsPath, mergeImportedSettingsForCurrentInstall(currentSettings, importedSettings));

    const currentWorkspaces = readJson<Workspace[]>(workspacesPath, []);
    const importedWorkspaces = candidates.flatMap((candidate) => candidate.nonTutorialWorkspaces);
    const merged: Workspace[] = [];
    const seenPaths = new Set<string>();
    const currentPaths = new Set(
      currentWorkspaces
        .filter((ws) => ws && typeof ws.path === 'string' && ws.path)
        .map((ws) => normalizeWorkspacePath(ws.path))
    );
    let importedCount = 0;
    let duplicateCount = 0;

    for (const ws of importedWorkspaces) {
      if (!ws || typeof ws.path !== 'string' || !ws.path) {
        duplicateCount++;
        continue;
      }
      const normalizedPath = normalizeWorkspacePath(ws.path);
      if (!fs.existsSync(normalizedPath)) {
        duplicateCount++;
        continue;
      }
      if (seenPaths.has(normalizedPath) || currentPaths.has(normalizedPath)) {
        duplicateCount++;
        continue;
      }
      merged.push({ ...ws, path: normalizedPath, name: deriveWorkspaceName(normalizedPath) });
      seenPaths.add(normalizedPath);
      importedCount++;
    }

    for (const ws of currentWorkspaces) {
      if (!ws || typeof ws.path !== 'string' || !ws.path) continue;
      const normalizedPath = normalizeWorkspacePath(ws.path);
      if (!fs.existsSync(normalizedPath) || seenPaths.has(normalizedPath)) continue;
      merged.push({ ...ws, path: normalizedPath, name: deriveWorkspaceName(normalizedPath) });
      seenPaths.add(normalizedPath);
    }
    writeJson(workspacesPath, merged);
    return {
      success: true,
      backupPath,
      importedCount,
      duplicateCount,
      sourceCount: importedWorkspaces.length,
    };
  } catch (err) {
    logger.warn('[storage] Import failed, restoring backup:', err);
    try {
      restoreFileFromBackup(backupPath, SETTINGS_FILE, settingsPath);
      restoreFileFromBackup(backupPath, WORKSPACES_FILE, workspacesPath);
    } catch {
      // best effort restore
    }
    return { success: false, error: 'Import failed; prior state was restored from backup' };
  }
}

// Recent workspaces
export function getRecentWorkspaces(): Workspace[] {
  const workspacesPath = path.join(getAppDataPath(), WORKSPACES_FILE);
  const stored = readJson<Workspace[]>(workspacesPath, []);
  const normalized: Workspace[] = [];
  const seenPaths = new Set<string>();
  const seenIds = new Set<string>();
  let changed = false;

  stored.forEach((workspace) => {
    if (
      !workspace ||
      typeof workspace.path !== 'string' ||
      typeof workspace.id !== 'string' ||
      workspace.id.length === 0
    ) {
      changed = true;
      return;
    }
    const normalizedPath = normalizeWorkspacePath(workspace.path);
    const name = deriveWorkspaceName(normalizedPath);
    if (normalizedPath !== workspace.path || name !== workspace.name) {
      changed = true;
    }
    if (seenPaths.has(normalizedPath) || seenIds.has(workspace.id)) {
      changed = true;
      return;
    }
    seenPaths.add(normalizedPath);
    seenIds.add(workspace.id);
    normalized.push({ ...workspace, path: normalizedPath, name });
  });

  if (changed) {
    writeJson(workspacesPath, normalized);
  }
  return normalized;
}

export function addRecentWorkspace(workspace: Workspace): boolean {
  const normalizedPath = normalizeWorkspacePath(workspace.path);
  const name = deriveWorkspaceName(normalizedPath);
  const workspaces = getRecentWorkspaces();
  const existingByPath = workspaces.find((entry) => entry.path === normalizedPath);
  const existingById = workspaces.find((entry) => entry.id === workspace.id);
  const stableId = existingByPath?.id ?? existingById?.id ?? workspace.id;
  const nextEntry: Workspace = {
    ...workspace,
    id: stableId,
    name,
    path: normalizedPath,
    lastAccessed: Date.now(),
  };
  const filtered = workspaces.filter((entry) => entry.path !== normalizedPath && entry.id !== stableId);
  filtered.unshift(nextEntry);
  // Keep only last 10
  const trimmed = filtered.slice(0, 10);
  const workspacesPath = path.join(getAppDataPath(), WORKSPACES_FILE);
  return writeJson(workspacesPath, trimmed);
}

export function removeRecentWorkspace(id: string): boolean {
  const workspaces = getRecentWorkspaces();
  const filtered = workspaces.filter((w) => w.id !== id);
  const workspacesPath = path.join(getAppDataPath(), WORKSPACES_FILE);
  return writeJson(workspacesPath, filtered);
}

// Agents
export function loadAgents(workspacePath: string): Agent[] {
  const agentsPath = path.join(getWorkspaceMeta(workspacePath), AGENTS_FILE);
  const stored = readJson<Agent[]>(agentsPath, []);
  if (!Array.isArray(stored)) return [];
  let changed = false;
  let invalidFound = false;
  const seenIds = new Set<string>();
  const normalized = stored
    .map((agent) => {
      if (!agent || typeof agent !== 'object') {
        invalidFound = true;
        log.warn('Invalid agent record skipped', { workspacePath, reason: 'not object' });
        return null;
      }
      const {
        agent: normalizedAgent,
        changed: agentChanged,
        valid,
        reason,
      } = normalizeAgentRecord(agent as Agent & { sessionId?: string | null });
      if (!valid || !normalizedAgent) {
        invalidFound = true;
        log.warn('Invalid agent record skipped', {
          workspacePath,
          agentId: typeof agent.id === 'string' ? agent.id : undefined,
          reason,
        });
        return null;
      }
      if (seenIds.has(normalizedAgent.id)) {
        invalidFound = true;
        log.warn('Duplicate agent record skipped', {
          workspacePath,
          agentId: normalizedAgent.id,
        });
        return null;
      }
      seenIds.add(normalizedAgent.id);
      if (agentChanged) changed = true;
      return normalizedAgent;
    })
    .filter((agent): agent is Agent => Boolean(agent && agent.id));
  if (changed && !invalidFound) {
    writeJson(agentsPath, normalized);
  }
  return normalized;
}

export function saveAgents(workspacePath: string, agents: Agent[]): boolean {
  const agentsPath = path.join(getWorkspaceMeta(workspacePath), AGENTS_FILE);
  const normalized = agents
    .map((agent) => normalizeAgentRecord(agent as Agent & { sessionId?: string | null }).agent)
    .filter((agent): agent is Agent => Boolean(agent));
  return writeJson(agentsPath, normalized);
}

export function getAgentTerminalState(workspacePath: string, agentId: string): AgentTerminalState | null {
  try {
    const workspaceMeta = getWorkspaceMeta(workspacePath);
    const historyDir = path.join(workspaceMeta, AGENT_TERMINAL_HISTORY_DIR);
    const filePath = path.join(historyDir, `${agentId}.json`);
    if (!fs.existsSync(filePath)) return null;
    const data = readJson<AgentTerminalState | AgentTerminalEntry[]>(filePath, []);
    if (Array.isArray(data)) {
      return { entries: data, viewState: null };
    }
    if (!data || typeof data !== 'object' || !Array.isArray(data.entries)) return null;
    return { entries: data.entries, viewState: data.viewState ?? null };
  } catch {
    return null;
  }
}

export function setAgentTerminalState(
  workspacePath: string,
  agentId: string,
  entries: AgentTerminalEntry[],
  viewState?: AgentTerminalViewState | null
): boolean {
  try {
    const historyDir = path.join(getWorkspaceMeta(workspacePath), AGENT_TERMINAL_HISTORY_DIR);
    ensureDir(historyDir);
    const filePath = path.join(historyDir, `${agentId}.json`);
    let resolvedViewState = viewState;
    if (resolvedViewState === undefined) {
      const existing = getAgentTerminalState(workspacePath, agentId);
      resolvedViewState = existing?.viewState ?? null;
    }
    return writeJson(filePath, { entries, viewState: resolvedViewState ?? null });
  } catch {
    return false;
  }
}

export function clearAgentTerminalState(workspacePath: string, agentId: string): boolean {
  try {
    const workspaceMeta = getWorkspaceMeta(workspacePath);
    const historyDir = path.join(workspaceMeta, AGENT_TERMINAL_HISTORY_DIR);
    const statePath = path.join(historyDir, `${agentId}.json`);
    if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
    return true;
  } catch {
    return false;
  }
}

export function getAgentTerminalDraft(workspacePath: string, agentId: string): string | null {
  try {
    const workspaceMeta = getWorkspaceMeta(workspacePath);
    const historyDir = path.join(workspaceMeta, AGENT_TERMINAL_HISTORY_DIR);
    const filePath = path.join(historyDir, `${agentId}.draft.txt`);
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

export function setAgentTerminalDraft(workspacePath: string, agentId: string, draft: string): boolean {
  try {
    const historyDir = path.join(getWorkspaceMeta(workspacePath), AGENT_TERMINAL_HISTORY_DIR);
    ensureDir(historyDir);
    const filePath = path.join(historyDir, `${agentId}.draft.txt`);
    if (!draft) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return true;
    }
    fs.writeFileSync(filePath, draft, 'utf8');
    return true;
  } catch {
    return false;
  }
}

// Terminal history
export function getTerminalHistory(workspacePath: string, terminalId: string): string {
  try {
    const workspaceMeta = getWorkspaceMeta(workspacePath);
    const historyDir = path.join(workspaceMeta, TERMINAL_HISTORY_DIR);
    const filePath = path.join(historyDir, `${terminalId}.txt`);
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8');
    }
    return '';
  } catch {
    return '';
  }
}

export function setTerminalHistory(workspacePath: string, terminalId: string, value: string): boolean {
  try {
    const historyDir = path.join(getWorkspaceMeta(workspacePath), TERMINAL_HISTORY_DIR);
    ensureDir(historyDir);
    const filePath = path.join(historyDir, `${terminalId}.txt`);
    fs.writeFileSync(filePath, value, 'utf8');
    return true;
  } catch {
    return false;
  }
}

export function clearTerminalHistory(workspacePath: string, terminalId: string): boolean {
  try {
    const workspaceMeta = getWorkspaceMeta(workspacePath);
    const historyDir = path.join(workspaceMeta, TERMINAL_HISTORY_DIR);
    const filePath = path.join(historyDir, `${terminalId}.txt`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

export function cleanupAgentTerminalHistory(workspacePath: string, agentIds: Iterable<string>): void {
  const workspaceMeta = getWorkspaceMeta(workspacePath);
  const agentsPath = path.join(workspaceMeta, AGENTS_FILE);
  if (!fs.existsSync(agentsPath)) return;
  const historyDir = path.join(workspaceMeta, AGENT_TERMINAL_HISTORY_DIR);
  cleanupHistoryDir(historyDir, new Set(agentIds), ['.json']);
}

export function cleanupTerminalHistory(workspacePath: string, terminalIds: Iterable<string>): void {
  const workspaceMeta = getWorkspaceMeta(workspacePath);
  const terminalsPath = path.join(workspaceMeta, TERMINALS_FILE);
  if (!fs.existsSync(terminalsPath)) return;
  const historyDir = path.join(workspaceMeta, TERMINAL_HISTORY_DIR);
  cleanupHistoryDir(historyDir, new Set(terminalIds), ['.txt']);
}

// Folders
export function loadFolders(workspacePath: string): AnyFolder[] {
  const foldersPath = path.join(getWorkspaceMeta(workspacePath), FOLDERS_FILE);
  const data = readJson<AnyFolder[]>(foldersPath, []);
  return data.map((folder) => {
    if (!folder || typeof folder !== 'object') return folder as AnyFolder;
    const record = folder as unknown as Record<string, unknown>;
    if (!('kind' in record)) {
      if (record.isWorktree === true) {
        return { ...record, kind: 'worktree' as const, isWorktree: true } as AnyFolder;
      }
      return { ...record, kind: 'folder' as const, isWorktree: false } as AnyFolder;
    }
    return folder;
  });
}

export function saveFolders(workspacePath: string, folders: AnyFolder[]): boolean {
  const foldersPath = path.join(getWorkspaceMeta(workspacePath), FOLDERS_FILE);
  return writeJson(foldersPath, folders);
}

// Browser panels
export function loadBrowserPanels(workspacePath: string): BrowserPanel[] {
  const browsersPath = path.join(getWorkspaceMeta(workspacePath), BROWSERS_FILE);
  return readJson(browsersPath, []);
}

export function saveBrowserPanels(workspacePath: string, panels: BrowserPanel[]): boolean {
  const browsersPath = path.join(getWorkspaceMeta(workspacePath), BROWSERS_FILE);
  return writeJson(browsersPath, panels);
}

// Terminals
export function loadTerminals(workspacePath: string): TerminalPanel[] {
  const workspaceMeta = getWorkspaceMeta(workspacePath);
  const terminalsPath = path.join(workspaceMeta, TERMINALS_FILE);
  const data = readJson<TerminalPanel[]>(terminalsPath, []);
  const terminals = data.map((terminal) => ({
    ...terminal,
    x: Number.isFinite(terminal.x) ? terminal.x : 0,
    y: Number.isFinite(terminal.y) ? terminal.y : 0,
    width: Number.isFinite(terminal.width) ? terminal.width : DEFAULT_TERMINAL_SIZE.width,
    height: Number.isFinite(terminal.height) ? terminal.height : DEFAULT_TERMINAL_SIZE.height,
    createdAt: Number.isFinite(terminal.createdAt) ? terminal.createdAt : Date.now(),
  }));
  const terminalIds = terminals
    .map((terminal) => terminal.id)
    .filter((id): id is string => typeof id === 'string');
  cleanupTerminalHistory(workspacePath, terminalIds);
  return terminals;
}

export function saveTerminals(workspacePath: string, terminals: TerminalPanel[]): boolean {
  const terminalsPath = path.join(getWorkspaceMeta(workspacePath), TERMINALS_FILE);
  return writeJson(terminalsPath, terminals);
}

// Hero
export function loadHero(workspacePath: string): Hero {
  const heroPath = path.join(getWorkspaceMeta(workspacePath), 'hero.json');
  const stored = readJson<Hero>(heroPath, DEFAULT_HERO);
  const { hero, changed, valid, reason } = normalizeHeroRecord(
    stored as Hero & { sessionId?: string | null }
  );
  if (!valid) {
    log.warn('Invalid hero record ignored', { workspacePath, reason });
    return hero;
  }
  if (changed) writeJson(heroPath, hero);
  return hero;
}

export function saveHero(workspacePath: string, hero: Hero): boolean {
  const heroPath = path.join(getWorkspaceMeta(workspacePath), 'hero.json');
  const normalized = normalizeHeroRecord(hero as Hero & { sessionId?: string | null });
  if (!normalized.valid) return false;
  return writeJson(heroPath, normalized.hero);
}

// Export as object for convenient importing
export const storage = {
  loadSettings,
  saveSettings,
  mergeSettingsPatch,
  importCustomSoundFromPath,
  getRecentWorkspaces,
  addRecentWorkspace,
  removeRecentWorkspace,
  getTutorialWorldPath,
  ensureTutorialWorld,
  ensureTutorialWorldInRecents,
  resetTutorialWorldState,
  loadAgents,
  saveAgents,
  getAgentTerminalState,
  setAgentTerminalState,
  clearAgentTerminalState,
  getAgentTerminalDraft,
  setAgentTerminalDraft,
  cleanupAgentTerminalHistory,
  getTerminalHistory,
  setTerminalHistory,
  clearTerminalHistory,
  cleanupTerminalHistory,
  loadFolders,
  saveFolders,
  loadBrowserPanels,
  saveBrowserPanels,
  loadTerminals,
  saveTerminals,
  loadHero,
  saveHero,
  checkForPriorSettings,
  getPriorWorkspacePreview,
  backupAndImportSettings,
};
