/**
 * MemflowBridge — VibeCraft ↔ memflow-cpu integration
 *
 * Detects whether the memflow-cpu daemon is installed and, when it is,
 * maintains a presence file at ~/.memflow/vibecraft.presence.json so the
 * daemon's 30-second ACI diagnostics cycle can discover VibeCraft's running
 * workspaces and expose them in the Maitrix Link UI.
 *
 * This module has NO import dependency on memflow-cpu's TypeScript source.
 * All integration is done via file-based conventions only.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { logger } from '../logger';

const log = logger.scope('memflow-bridge');

/** Maximum age before the daemon considers a presence file stale (90 seconds). */
const PRESENCE_TTL_MS = 90_000;
/** How often we refresh the presence file (30s, matching daemon ACI cadence). */
const HEARTBEAT_INTERVAL_MS = 30_000;

export interface WorkspacePresenceEntry {
  path: string;
  name: string;
  mcpPort: number | null;
  mcpHost: string;
}

export interface VibecraftPresence {
  pid: number;
  version: string;
  startedAt: string;
  updatedAt: string;
  activeWorkspaces: WorkspacePresenceEntry[];
}

export interface MemflowStatus {
  installed: boolean;
  daemonRunning: boolean;
  trackedProjectCount: number;
  lastSyncedAt: string | null;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

const activeWorkspaces = new Map<string, WorkspacePresenceEntry>();
let heartbeatTimer: NodeJS.Timeout | null = null;
let startedAt: string | null = null;
let lastSyncedAt: string | null = null;

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function getMemFlowHome(): string {
  return path.join(os.homedir(), '.memflow');
}

function getPresencePath(): string {
  return path.join(getMemFlowHome(), 'vibecraft.presence.json');
}

function getConfigPath(): string {
  return path.join(getMemFlowHome(), 'config.json');
}

function getDaemonStatusPath(profile = 'default'): string {
  return path.join(getMemFlowHome(), `daemon.${profile}.status.json`);
}

// ---------------------------------------------------------------------------
// Memflow detection
// ---------------------------------------------------------------------------

export function isMemflowInstalled(): boolean {
  try {
    return fs.existsSync(getConfigPath());
  } catch {
    return false;
  }
}

export function isDaemonRunning(): boolean {
  try {
    const statusPath = getDaemonStatusPath();
    if (!fs.existsSync(statusPath)) return false;
    const raw = fs.readFileSync(statusPath, 'utf8');
    const status = JSON.parse(raw) as { pid?: number; updatedAt?: string };
    if (!status?.pid) return false;
    // Consider the daemon stale if its status file hasn't been updated in ~90s
    if (status.updatedAt) {
      const ageMs = Date.now() - new Date(status.updatedAt).getTime();
      if (ageMs > PRESENCE_TTL_MS) return false;
    }
    // Verify the PID is actually running
    try {
      process.kill(status.pid, 0);
      return true;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Config merging — merge a workspace into memflow's trackedProjects
// ---------------------------------------------------------------------------

interface MemFlowTrackedProject {
  enabled: boolean;
  name: string;
  path: string;
  project: string;
  repo: string;
  addedAt: string;
  updatedAt: string;
  manager?: string;
}

interface MemFlowConfigPartial {
  trackedProjects?: MemFlowTrackedProject[];
  [key: string]: unknown;
}

function mergeTrackedProject(workspacePath: string, workspaceName: string): void {
  const configPath = getConfigPath();
  try {
    if (!fs.existsSync(configPath)) return;
    const raw = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(raw) as MemFlowConfigPartial;
    const projects: MemFlowTrackedProject[] = config.trackedProjects ?? [];

    const now = new Date().toISOString();
    const existing = projects.find((p) => p.path === workspacePath);
    if (existing) {
      // Only update updatedAt — don't overwrite other fields
      existing.updatedAt = now;
    } else {
      const projectName = workspaceName || path.basename(workspacePath);
      projects.push({
        enabled: true,
        name: projectName,
        path: workspacePath,
        project: projectName,
        repo: projectName,
        addedAt: now,
        updatedAt: now,
        manager: 'vibecraft',
      });
    }

    config.trackedProjects = projects;
    const tmp = `${configPath}.vibecraft.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, configPath);
    log.info('Merged workspace into memflow trackedProjects', { workspacePath });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn('Failed to merge tracked project into memflow config', { workspacePath, error: message });
  }
}

// ---------------------------------------------------------------------------
// Presence file
// ---------------------------------------------------------------------------

function writePresence(): void {
  const presencePath = getPresencePath();
  const now = new Date().toISOString();
  const presence: VibecraftPresence = {
    pid: process.pid,
    version: process.env.VIBECRAFT_APP_VERSION ?? 'unknown',
    startedAt: startedAt ?? now,
    updatedAt: now,
    activeWorkspaces: Array.from(activeWorkspaces.values()),
  };
  try {
    const dir = getMemFlowHome();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    const tmp = `${presencePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(presence, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, presencePath);
    lastSyncedAt = now;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn('Failed to write memflow presence file', { error: message });
  }
}

function clearPresence(): void {
  const presencePath = getPresencePath();
  try {
    if (fs.existsSync(presencePath)) {
      fs.unlinkSync(presencePath);
      log.info('Cleared memflow presence file');
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn('Failed to clear memflow presence file', { error: message });
  }
}

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

function startHeartbeat(): void {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    if (!isMemflowInstalled()) return;
    writePresence();
  }, HEARTBEAT_INTERVAL_MS);
  // Don't block app quit
  heartbeatTimer.unref?.();
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function startMemflowBridge(): void {
  startedAt = new Date().toISOString();
  if (!isMemflowInstalled()) {
    log.info('memflow not installed — bridge inactive');
    return;
  }
  log.info('memflow detected — bridge active');
  writePresence();
  startHeartbeat();
}

export function stopMemflowBridge(): void {
  stopHeartbeat();
  clearPresence();
}

export function notifyWorkspaceActive(
  workspacePath: string,
  mcpInfo: { host: string; port: number } | null,
  workspaceName?: string
): void {
  const name = workspaceName ?? path.basename(workspacePath);
  activeWorkspaces.set(workspacePath, {
    path: workspacePath,
    name,
    mcpPort: mcpInfo?.port ?? null,
    mcpHost: mcpInfo?.host ?? '127.0.0.1',
  });

  if (!isMemflowInstalled()) return;

  mergeTrackedProject(workspacePath, name);
  writePresence();
}

export function notifyWorkspaceClosed(workspacePath: string): void {
  activeWorkspaces.delete(workspacePath);
  if (!isMemflowInstalled()) return;
  writePresence();
}

export function getMemflowStatus(): MemflowStatus {
  const installed = isMemflowInstalled();
  if (!installed) {
    return { installed: false, daemonRunning: false, trackedProjectCount: 0, lastSyncedAt: null };
  }

  let trackedProjectCount = 0;
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf8');
    const config = JSON.parse(raw) as MemFlowConfigPartial;
    trackedProjectCount = (config.trackedProjects ?? []).filter((p) => p.enabled).length;
  } catch {
    // ignore
  }

  return {
    installed: true,
    daemonRunning: isDaemonRunning(),
    trackedProjectCount,
    lastSyncedAt,
  };
}
