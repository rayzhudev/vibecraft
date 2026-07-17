import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

let tempDir = '';

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return {
    ...actual,
    homedir: () => tempDir,
  };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    ...actual,
    homedir: () => tempDir,
  };
});

import {
  isMemflowInstalled,
  isDaemonRunning,
  getMemflowStatus,
  startMemflowBridge,
  stopMemflowBridge,
  notifyWorkspaceActive,
  notifyWorkspaceClosed,
} from '../../../src/main/services/memflowBridge';

describe('MemflowBridge', () => {
  beforeEach(() => {
    const osActual = require('os');
    tempDir = fs.mkdtempSync(path.join(osActual.tmpdir(), 'vibecraft-memflow-'));
    fs.mkdirSync(path.join(tempDir, '.memflow'), { recursive: true });
  });

  afterEach(() => {
    stopMemflowBridge();
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  test('isMemflowInstalled returns true if config.json exists', () => {
    expect(isMemflowInstalled()).toBe(false);
    fs.writeFileSync(path.join(tempDir, '.memflow', 'config.json'), '{}', 'utf8');
    expect(isMemflowInstalled()).toBe(true);
  });

  test('isDaemonRunning returns true if daemon status file exists and process is running', () => {
    const statusPath = path.join(tempDir, '.memflow', 'daemon.default.status.json');
    expect(isDaemonRunning()).toBe(false);

    // Mock process.kill to return true for process.kill(12345, 0)
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid === 12345 && signal === 0) return true;
      throw new Error('Not running');
    });

    fs.writeFileSync(
      statusPath,
      JSON.stringify({ pid: 12345, updatedAt: new Date().toISOString() }),
      'utf8'
    );
    expect(isDaemonRunning()).toBe(true);

    // If updatedAt is old, it should return false
    const oldDate = new Date(Date.now() - 100_000).toISOString();
    fs.writeFileSync(statusPath, JSON.stringify({ pid: 12345, updatedAt: oldDate }), 'utf8');
    expect(isDaemonRunning()).toBe(false);
  });

  test('getMemflowStatus returns correct status', () => {
    expect(getMemflowStatus()).toEqual({
      installed: false,
      daemonRunning: false,
      trackedProjectCount: 0,
      lastSyncedAt: null,
    });

    fs.writeFileSync(
      path.join(tempDir, '.memflow', 'config.json'),
      JSON.stringify({
        trackedProjects: [
          { name: 'Proj1', path: '/p1', enabled: true },
          { name: 'Proj2', path: '/p2', enabled: false },
        ],
      }),
      'utf8'
    );
    expect(getMemflowStatus().installed).toBe(true);
    expect(getMemflowStatus().trackedProjectCount).toBe(1);
  });

  test('startMemflowBridge writes presence file if installed', () => {
    fs.writeFileSync(path.join(tempDir, '.memflow', 'config.json'), '{}', 'utf8');
    startMemflowBridge();
    const presencePath = path.join(tempDir, '.memflow', 'vibecraft.presence.json');
    expect(fs.existsSync(presencePath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(presencePath, 'utf8'));
    expect(content.pid).toBe(process.pid);
  });

  test('notifyWorkspaceActive merges workspace into config.json trackedProjects', () => {
    const configPath = path.join(tempDir, '.memflow', 'config.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        trackedProjects: [],
      }),
      'utf8'
    );

    notifyWorkspaceActive('/my/workspace/path', { host: '127.0.0.1', port: 5005 }, 'MyWorkspace');

    const content = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(content.trackedProjects).toHaveLength(1);
    expect(content.trackedProjects[0].path).toBe('/my/workspace/path');
    expect(content.trackedProjects[0].name).toBe('MyWorkspace');
    expect(content.trackedProjects[0].enabled).toBe(true);
  });
});
