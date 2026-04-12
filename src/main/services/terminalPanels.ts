import type { TerminalPanel } from '../../shared/types';
import * as fs from 'fs';
import * as path from 'path';
import { storage } from './storage';
import { logger } from '../logger';
import { resolveWorkspaceSubpath } from './workspacePaths';
import { normalizeWorkspaceRelativePath } from '../../shared/pathUtils';
import { DEFAULT_TERMINAL_SIZE } from '../../shared/terminalDefaults';

const log = logger.scope('terminal-panels');

export function createTerminalRecord(
  workspacePath: string,
  relativePath: string | undefined,
  x: number,
  y: number,
  explicitOriginFolderId?: string,
  width = DEFAULT_TERMINAL_SIZE.width,
  height = DEFAULT_TERMINAL_SIZE.height
): { success: boolean; terminal?: TerminalPanel; error?: string } {
  let originFolderId: string | undefined;
  let originFolderName: string | undefined;
  let originRelativePath: string | undefined;

  const resolvedPath = normalizeWorkspaceRelativePath(relativePath);
  const absolutePath = resolveWorkspaceSubpath(workspacePath, resolvedPath);
  if (!absolutePath) {
    return { success: false, error: 'Invalid folder path' };
  }
  let stats: fs.Stats;
  try {
    stats = fs.statSync(absolutePath);
  } catch {
    return { success: false, error: 'Folder path missing' };
  }
  if (!stats.isDirectory()) {
    return { success: false, error: 'Folder path is not a directory' };
  }
  const folders = storage.loadFolders(workspacePath);
  const folder = explicitOriginFolderId
    ? folders.find((entry) => entry.id === explicitOriginFolderId)
    : resolvedPath !== '.'
      ? folders.find((entry) => entry.relativePath === resolvedPath)
      : undefined;

  if (folder) {
    originFolderId = folder.id;
    originFolderName = folder.name;
    originRelativePath = folder.relativePath;
  } else {
    originFolderName = path.basename(workspacePath) || 'Workspace';
    originRelativePath = resolvedPath;
  }

  const terminal: TerminalPanel = {
    id: `terminal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    originFolderId,
    originFolderName,
    originRelativePath,
    x,
    y,
    width,
    height,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
  };

  const terminals = storage.loadTerminals(workspacePath);
  terminals.push(terminal);
  storage.saveTerminals(workspacePath, terminals);

  log.info(`Created terminal record: ${terminal.id}`);
  return { success: true, terminal };
}

export function updateTerminalRecord(
  workspacePath: string,
  terminalId: string,
  updates: Partial<TerminalPanel>
): { success: boolean; terminal?: TerminalPanel; error?: string } {
  const terminals = storage.loadTerminals(workspacePath);
  const terminal = terminals.find((entry) => entry.id === terminalId);
  if (!terminal) {
    return { success: false, error: 'Terminal not found' };
  }

  Object.assign(terminal, updates, { lastUsedAt: Date.now() });
  storage.saveTerminals(workspacePath, terminals);
  return { success: true, terminal };
}

export function deleteTerminalRecord(workspacePath: string, terminalId: string): boolean {
  const terminals = storage.loadTerminals(workspacePath);
  const idx = terminals.findIndex((entry) => entry.id === terminalId);
  if (idx === -1) {
    return true;
  }
  terminals.splice(idx, 1);
  storage.saveTerminals(workspacePath, terminals);
  storage.clearTerminalHistory(workspacePath, terminalId);
  return true;
}
