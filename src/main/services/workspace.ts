import * as fs from 'fs';
import * as path from 'path';
import type {
  Agent,
  AvailableFolder,
  Folder,
  WorktreeFolder,
  FolderConflictState,
  AnyFolder,
} from '../../shared/types';
import { storage } from './storage';
import { logger } from '../logger';
import { resolveWorkspaceSubpath } from './workspacePaths';
import { execSync } from 'child_process';
import { shell } from 'electron';
import { getTestModeConfig } from '../../testing/testMode';
import { sanitizeFolderRelativeName } from '../../shared/pathUtils';

const log = logger.scope('workspace');
const DISABLE_GIT_ENV = 'VIBECRAFT_DISABLE_GIT';
const GIT_DISABLED_ERROR = 'Git features are disabled.';

const isGitDisabled = (): boolean => {
  const testMode = getTestModeConfig();
  if (testMode.enabled) {
    return testMode.disableGit;
  }
  const envFlag = process.env[DISABLE_GIT_ENV];
  if (envFlag === '1') return true;
  if (envFlag === '0') return false;
  const settings = storage.loadSettings();
  return settings.disableGit === true;
};

const isWorktreeFolder = (folder: AnyFolder | undefined | null): folder is WorktreeFolder =>
  !!folder && (folder as WorktreeFolder).isWorktree === true;

const worktreeBranchName = (folderName: string): string => folderName.replace(/[^A-Za-z0-9._/-]+/g, '-');

const normalizeTerminalPath = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/g, '');

const updateTerminalRecordsForRename = (
  workspacePath: string,
  folderId: string,
  oldRelativePath: string,
  newRelativePath: string,
  newFolderName: string
): void => {
  const normalizedOld = normalizeTerminalPath(oldRelativePath);
  const normalizedNew = normalizeTerminalPath(newRelativePath);
  if (!normalizedOld || normalizedOld === normalizedNew) return;

  const terminals = storage.loadTerminals(workspacePath);
  let changed = false;

  const remapPath = (value?: string): { next?: string; updated: boolean } => {
    if (!value) return { updated: false };
    const normalizedValue = normalizeTerminalPath(value);
    if (normalizedValue === normalizedOld) {
      return { next: normalizedNew, updated: true };
    }
    const prefix = `${normalizedOld}/`;
    if (normalizedValue.startsWith(prefix)) {
      const rest = normalizedValue.slice(prefix.length);
      return { next: `${normalizedNew}/${rest}`, updated: true };
    }
    return { updated: false };
  };

  terminals.forEach((terminal) => {
    let updated = false;
    if (terminal.originFolderId === folderId) {
      if (terminal.originFolderName !== newFolderName) {
        terminal.originFolderName = newFolderName;
        updated = true;
      }
      if (terminal.originRelativePath !== newRelativePath) {
        terminal.originRelativePath = newRelativePath;
        updated = true;
      }
    }

    const originRemap = remapPath(terminal.originRelativePath);
    if (originRemap.updated && originRemap.next) {
      terminal.originRelativePath = originRemap.next;
      updated = true;
    }

    const cwdRemap = remapPath(terminal.lastKnownCwd);
    if (cwdRemap.updated && cwdRemap.next) {
      terminal.lastKnownCwd = cwdRemap.next;
      updated = true;
    }

    if (updated) {
      changed = true;
    }
  });

  if (changed) {
    storage.saveTerminals(workspacePath, terminals);
  }
};

// List subdirectories in a workspace
export function listSubfolders(workspacePath: string): string[] {
  try {
    const entries = fs.readdirSync(workspacePath, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);
  } catch (err) {
    log.error('Failed to list subfolders:', err);
    return [];
  }
}

function normalizeRelativePath(workspacePath: string, relativePath: string): string | null {
  try {
    const base = path.resolve(workspacePath);
    const target = path.resolve(base, relativePath);
    const rel = path.relative(base, target).replace(/\\/g, '/');
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return null;
    }
    if (!rel || rel === '.') {
      return null;
    }
    return rel;
  } catch {
    return null;
  }
}

const gitBranchName = (dir: string): string | null => {
  try {
    const out = execSync(`git -C ${JSON.stringify(dir)} rev-parse --abbrev-ref HEAD`, {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    return out || null;
  } catch {
    return null;
  }
};

const parseGitDirFromFile = (gitFilePath: string): string | null => {
  try {
    const content = fs.readFileSync(gitFilePath, 'utf8').trim();
    const match = content.match(/^gitdir:\s*(.+)\s*$/i);
    if (!match) return null;
    const raw = match[1]?.trim();
    if (!raw) return null;
    return path.isAbsolute(raw) ? raw : path.resolve(path.dirname(gitFilePath), raw);
  } catch {
    return null;
  }
};

const getGitCommonDir = (repoPath: string): string | null => {
  try {
    const out = execSync(`git -C ${JSON.stringify(repoPath)} rev-parse --git-common-dir`, {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    if (!out) return null;
    return path.isAbsolute(out) ? out : path.resolve(repoPath, out);
  } catch {
    return null;
  }
};

const getWorktreeSourceRelativePath = (workspacePath: string, worktreePath: string): string | null => {
  const gitCommonDirFromGit = getGitCommonDir(worktreePath);
  let sourceRoot: string | null = null;
  if (gitCommonDirFromGit) {
    sourceRoot = path.dirname(gitCommonDirFromGit);
  } else {
    const gitFilePath = path.join(worktreePath, '.git');
    if (!fs.existsSync(gitFilePath)) return null;
    const stat = fs.lstatSync(gitFilePath);
    if (!stat.isFile()) return null;
    const gitDir = parseGitDirFromFile(gitFilePath);
    if (!gitDir) return null;
    const worktreesDir = path.dirname(gitDir);
    if (path.basename(worktreesDir) !== 'worktrees') return null;
    const gitCommonDir = path.dirname(worktreesDir);
    sourceRoot = path.dirname(gitCommonDir);
  }
  if (!sourceRoot) return null;
  if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) return null;
  let basePath = workspacePath;
  let resolvedSource = sourceRoot;
  try {
    basePath = fs.realpathSync(workspacePath);
    resolvedSource = fs.realpathSync(sourceRoot);
  } catch {
    /* noop */
  }
  const rel = path.relative(basePath, resolvedSource).replace(/\\/g, '/');
  if (!rel || rel === '.' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel;
};

export function listAvailableFolders(
  workspacePath: string,
  options?: { includeSubfolders?: boolean; maxDepth?: number; showHidden?: boolean }
): AvailableFolder[] {
  // Import list is intentionally shallow: only direct children of the workspace root
  const includeSubfolders = false;
  const maxDepth = 0;
  const showHidden = options?.showHidden === true;
  const base = path.resolve(workspacePath);

  if (!fs.existsSync(base)) {
    return [];
  }

  const imported = new Set(storage.loadFolders(workspacePath).map((f) => f.relativePath));
  const shouldSkipName = (name: string) => {
    if (!name) return true;
    if (!showHidden && name.startsWith('.')) return true;
    if (name === 'node_modules' || name === '.git') return true;
    return false;
  };

  const walk = (absDir: string, relDir: string, depth: number): AvailableFolder[] => {
    const nodes: AvailableFolder[] = [];
    try {
      const entries = fs.readdirSync(absDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const name = entry.name;
        if (shouldSkipName(name)) continue;
        if (name === 'worktrees' && path.basename(absDir) === '.git') continue;

        const childRel = relDir ? path.posix.join(relDir, name) : name;
        const childAbs = path.join(absDir, name);
        const child: AvailableFolder = {
          name,
          relativePath: childRel,
          children: [],
          isImported: imported.has(childRel),
          depth: depth + 1,
        };

        if (includeSubfolders && depth + 1 < maxDepth) {
          child.children = walk(childAbs, childRel, depth + 1);
        }

        nodes.push(child);
      }
    } catch (err) {
      log.warn('Failed to list available folders:', err);
    }

    nodes.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    return nodes;
  };

  return walk(base, '', 0);
}

function initGitRepoIfMissing(dir: string): void {
  const gitMetaPath = path.join(dir, '.git');
  if (fs.existsSync(gitMetaPath)) return;
  if (isGitDisabled()) return;
  try {
    execSync(`git -C ${JSON.stringify(dir)} init`, { stdio: 'ignore' });
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error?.code === 'ENOENT') {
      log.warn('Git not found; skipping repository initialization for new folder.');
      return;
    }
    log.error('Failed to initialize git repository for new folder:', err);
    throw new Error('Failed to initialize git repository for new folder');
  }
}

// Create a new folder entity
export function createFolder(workspacePath: string, name: string, x: number, y: number): Folder {
  const relativePath = sanitizeFolderRelativeName(name);
  if (!relativePath) {
    throw new Error('Folder name cannot be empty');
  }

  const existing = storage.loadFolders(workspacePath).find((f) => f.relativePath === relativePath);
  if (existing) {
    throw new Error(`Folder already exists: ${relativePath}`);
  }

  const folderPath = resolveWorkspaceSubpath(workspacePath, relativePath);
  if (!folderPath) {
    throw new Error('Invalid folder path');
  }

  // Create physical directory if it doesn't exist
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }
  initGitRepoIfMissing(folderPath);

  const folder: Folder = {
    kind: 'folder',
    id: `folder-${Date.now()}`,
    name: relativePath,
    relativePath,
    x,
    y,
    createdAt: Date.now(),
    isWorktree: false,
  };

  // Save to storage
  const folders = storage.loadFolders(workspacePath);
  folders.push(folder);
  storage.saveFolders(workspacePath, folders);

  return folder;
}

export function importExistingFolder(
  workspacePath: string,
  relativePath: string,
  x: number,
  y: number
): { success: boolean; folder?: AnyFolder; error?: string; alreadyImported?: boolean } {
  const normalized = normalizeRelativePath(workspacePath, relativePath);
  if (!normalized) {
    return { success: false, error: 'Invalid folder path' };
  }

  const targetPath = resolveWorkspaceSubpath(workspacePath, normalized);
  if (!targetPath || !fs.existsSync(targetPath) || !fs.statSync(targetPath).isDirectory()) {
    return { success: false, error: 'Target folder does not exist' };
  }

  const folders = storage.loadFolders(workspacePath);
  const existing = folders.find((f) => f.relativePath === normalized);
  if (existing) {
    return { success: true, folder: existing, alreadyImported: true };
  }

  const gitProbe = probeFolderGit(workspacePath, normalized);
  const targetIsWorktree = gitProbe.success && gitProbe.isWorktree;
  const worktreeSourceRelative = targetIsWorktree
    ? getWorktreeSourceRelativePath(workspacePath, targetPath)
    : null;
  const worktreeBranch = targetIsWorktree ? (gitBranchName(targetPath) ?? undefined) : undefined;
  const sourcePath =
    targetIsWorktree && worktreeSourceRelative
      ? resolveWorkspaceSubpath(workspacePath, worktreeSourceRelative)
      : null;
  const sourceBranch =
    targetIsWorktree && sourcePath && fs.existsSync(sourcePath)
      ? (gitBranchName(sourcePath) ?? undefined)
      : undefined;

  const now = Date.now();
  const folder: AnyFolder = targetIsWorktree
    ? {
        kind: 'worktree',
        id: `folder-${now}`,
        name: path.posix.basename(normalized),
        relativePath: normalized,
        x,
        y,
        createdAt: now,
        isWorktree: true,
        sourceRelativePath: worktreeSourceRelative ?? '',
        sourceBranch,
        worktreeBranch,
      }
    : {
        kind: 'folder',
        id: `folder-${now}`,
        name: path.posix.basename(normalized),
        relativePath: normalized,
        x,
        y,
        createdAt: now,
        isWorktree: false,
      };

  folders.push(folder);
  storage.saveFolders(workspacePath, folders);

  return { success: true, folder };
}

export function probeFolderGit(
  workspacePath: string,
  relativePath: string
): { success: boolean; isRepo: boolean; isWorktree: boolean } {
  try {
    if (isGitDisabled()) {
      return { success: true, isRepo: false, isWorktree: false };
    }
    const normalized = normalizeRelativePath(workspacePath, relativePath);
    if (!normalized) {
      return { success: false, isRepo: false, isWorktree: false };
    }
    const targetPath = resolveWorkspaceSubpath(workspacePath, normalized);
    if (!targetPath || !fs.existsSync(targetPath)) {
      return { success: false, isRepo: false, isWorktree: false };
    }

    // Detect worktree by inspecting .git file content
    const gitPath = path.join(targetPath, '.git');
    let isWorktree = false;
    if (fs.existsSync(gitPath)) {
      const stat = fs.lstatSync(gitPath);
      if (stat.isFile()) {
        try {
          const content = fs.readFileSync(gitPath, 'utf8');
          if (/worktrees\//.test(content)) {
            isWorktree = true;
          }
        } catch {
          /* noop */
        }
      }
    }

    try {
      const out = execSync(`git -C ${JSON.stringify(targetPath)} rev-parse --is-inside-work-tree`, {
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .toString()
        .trim();
      const isRepo = out === 'true';
      return { success: true, isRepo, isWorktree };
    } catch {
      return { success: true, isRepo: false, isWorktree };
    }
  } catch {
    return { success: false, isRepo: false, isWorktree: false };
  }
}

const listStashHashes = (dir: string): string[] => {
  try {
    const out = execSync(`git -C ${JSON.stringify(dir)} stash list --format=%H`, {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    return out;
  } catch {
    return [];
  }
};

const createNamedStash = (dir: string, label: string): string | null => {
  try {
    const before = listStashHashes(dir);
    execSync(`git -C ${JSON.stringify(dir)} stash push --include-untracked -m ${JSON.stringify(label)}`, {
      stdio: 'ignore',
    });
    const after = listStashHashes(dir);
    if (after.length <= before.length) return null;
    const next = after[0];
    if (!next || next === before[0]) return null;
    return next;
  } catch {
    return null;
  }
};

const resolveStashRef = (dir: string, stashRef?: string): string | null => {
  if (!stashRef) return null;
  if (/^stash@\{\d+\}$/.test(stashRef)) return stashRef;
  try {
    const out = execSync(`git -C ${JSON.stringify(dir)} stash list --format=%H%gd`, {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    for (const line of out) {
      const hash = line.slice(0, 40);
      const ref = line.slice(40);
      if (hash === stashRef) return ref;
    }
  } catch {
    return null;
  }
  return null;
};

const stashExists = (dir: string, stashRef?: string): boolean => {
  if (!stashRef) return false;
  if (/^stash@\{\d+\}$/.test(stashRef)) {
    try {
      execSync(`git -C ${JSON.stringify(dir)} rev-parse ${JSON.stringify(stashRef)}`, {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return true;
    } catch {
      return false;
    }
  }
  try {
    const out = execSync(`git -C ${JSON.stringify(dir)} stash list --format=%H`, {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .split('\n')
      .map((s) => s.trim());
    return out.includes(stashRef);
  } catch {
    return false;
  }
};

const applyStash = (dir: string, stashRef?: string): boolean => {
  if (!stashRef) return true;
  const ref = resolveStashRef(dir, stashRef);
  if (!ref) return false;
  try {
    execSync(`git -C ${JSON.stringify(dir)} stash apply ${JSON.stringify(ref)}`, { stdio: 'ignore' });
    execSync(`git -C ${JSON.stringify(dir)} stash drop ${JSON.stringify(ref)}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

const hasUnmergedPaths = (dir: string): boolean => {
  try {
    const out = execSync(`git -C ${JSON.stringify(dir)} status --porcelain`, {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    return out.split('\n').some((line) => /^UU|^AA|^DD|^AU|^UA|^UD|^DU/.test(line));
  } catch {
    return false;
  }
};

const mergeHeadExists = (dir: string): boolean => {
  const mergeHead = path.join(dir, '.git', 'MERGE_HEAD');
  try {
    return fs.existsSync(mergeHead);
  } catch {
    return false;
  }
};

export function createGitWorktree(
  workspacePath: string,
  folderId: string,
  x: number,
  y: number
): { success: boolean; folder?: WorktreeFolder; error?: string } {
  if (isGitDisabled()) {
    return { success: false, error: GIT_DISABLED_ERROR };
  }
  const folders = storage.loadFolders(workspacePath);
  const source = folders.find((f) => f.id === folderId);
  if (!source) {
    return { success: false, error: 'Folder not found' };
  }
  if (isWorktreeFolder(source)) {
    return { success: false, error: 'Cannot create worktree from a worktree' };
  }

  const sourcePath = resolveWorkspaceSubpath(workspacePath, source.relativePath);
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return { success: false, error: 'Source folder missing' };
  }

  const probe = probeFolderGit(workspacePath, source.relativePath);
  if (!probe.isRepo) {
    return { success: false, error: 'Folder is not a Git repository' };
  }
  if (probe.isWorktree) {
    return { success: false, error: 'Cannot create worktree from a worktree' };
  }

  // Ensure HEAD exists
  try {
    execSync(`git -C ${JSON.stringify(sourcePath)} rev-parse --verify HEAD`, { stdio: 'ignore' });
  } catch {
    return { success: false, error: 'Repository has no commits' };
  }

  const sourceBranch = gitBranchName(sourcePath) || undefined;
  const randSuffix = Math.random().toString(36).slice(2, 6);
  const baseName = sanitizeFolderRelativeName(`${source.relativePath}-wt-${randSuffix}`);

  // Choose a unique folder/branch name
  const pickNames = (): { folderName: string; branchName: string } => {
    let suffix = 1;
    while (true) {
      const candidate = suffix === 1 ? baseName : `${baseName}-${suffix}`;
      const folderName = candidate;
      const branchName = worktreeBranchName(candidate);
      const targetPath = resolveWorkspaceSubpath(workspacePath, folderName);
      const folderExists = !!(targetPath && fs.existsSync(targetPath));
      let branchExists = false;
      try {
        execSync(
          `git -C ${JSON.stringify(sourcePath)} show-ref --verify --quiet ${JSON.stringify(`refs/heads/${branchName}`)}`,
          { stdio: 'ignore' }
        );
        branchExists = true;
      } catch {
        branchExists = false;
      }
      if (!folderExists && !branchExists) {
        return { folderName, branchName };
      }
      suffix++;
      if (suffix > 20) {
        throw new Error('Could not find unique worktree name');
      }
    }
  };

  let targetFolderName: string;
  let branchName: string;
  try {
    const names = pickNames();
    targetFolderName = names.folderName;
    branchName = names.branchName;
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to choose worktree name' };
  }

  const targetPath = resolveWorkspaceSubpath(workspacePath, targetFolderName);
  if (!targetPath) {
    return { success: false, error: 'Invalid worktree path' };
  }

  try {
    execSync(
      `git -C ${JSON.stringify(sourcePath)} worktree add ${JSON.stringify(targetPath)} -b ${JSON.stringify(branchName)}`,
      { stdio: 'ignore' }
    );
  } catch {
    return { success: false, error: 'Failed to create worktree' };
  }

  const now = Date.now();
  const newFolder: WorktreeFolder = {
    kind: 'worktree',
    id: `folder-${now}`,
    name: targetFolderName,
    relativePath: targetFolderName,
    x,
    y,
    createdAt: now,
    isWorktree: true,
    sourceRelativePath: source.relativePath,
    sourceBranch,
    worktreeBranch: branchName,
  };

  const next = folders.filter((f) => f.id !== newFolder.id);
  next.push(newFolder);
  storage.saveFolders(workspacePath, next);

  return { success: true, folder: newFolder };
}

export function worktreeSyncFromSource(
  workspacePath: string,
  folderId: string
): { success: boolean; message?: string; error?: string } {
  if (isGitDisabled()) {
    return { success: false, error: GIT_DISABLED_ERROR };
  }
  const folders = storage.loadFolders(workspacePath);
  const wt = folders.find((f) => f.id === folderId);
  if (!isWorktreeFolder(wt) || !wt.sourceRelativePath) {
    return { success: false, error: 'Not a recognized worktree' };
  }

  const worktreePath = resolveWorkspaceSubpath(workspacePath, wt.relativePath);
  const sourcePath = resolveWorkspaceSubpath(workspacePath, wt.sourceRelativePath);
  if (!worktreePath || !sourcePath) {
    return { success: false, error: 'Worktree or source path missing' };
  }

  const sourceBranch = wt.sourceBranch || gitBranchName(sourcePath);
  if (!sourceBranch) {
    return { success: false, error: 'Could not determine source branch' };
  }

  if (hasUnmergedPaths(worktreePath)) {
    return { success: false, error: 'Worktree has unresolved conflicts. Resolve them before syncing.' };
  }

  let stashRef: string | null = null;
  if (gitStatusDirty(worktreePath)) {
    stashRef = createNamedStash(worktreePath, `agentcraft-sync-${Date.now()}`);
    if (!stashRef) {
      return { success: false, error: 'Failed to stash worktree changes before sync' };
    }
  }

  try {
    execSync(`git -C ${JSON.stringify(worktreePath)} fetch --all`, { stdio: 'ignore' });
  } catch {
    /* ignore fetch failures */
  }

  try {
    execSync(`git -C ${JSON.stringify(worktreePath)} merge --no-edit ${JSON.stringify(sourceBranch)}`, {
      stdio: 'ignore',
    });
  } catch {
    const stashNote =
      stashRef && stashExists(worktreePath, stashRef)
        ? ` Your local changes were stashed (${resolveStashRef(worktreePath, stashRef) || stashRef}).`
        : '';
    return {
      success: false,
      error: `Merge from source failed (resolve conflicts in worktree).${stashNote}`,
    };
  }

  if (stashRef && stashExists(worktreePath, stashRef)) {
    const restored = applyStash(worktreePath, stashRef);
    if (!restored) {
      return {
        success: false,
        error:
          'Synced from source, but restoring your local changes failed. Clean the worktree and apply the stash manually.',
      };
    }
  }

  return {
    success: true,
    message: `Merged ${sourceBranch} into worktree`,
  };
}

const markConflictState = (workspacePath: string, sourceId: string, conflict: FolderConflictState): void => {
  const folders = storage.loadFolders(workspacePath);
  const idx = folders.findIndex((f) => f.id === sourceId);
  if (idx === -1) return;
  folders[idx] = { ...folders[idx], conflictState: conflict };
  storage.saveFolders(workspacePath, folders);
};

const clearConflictState = (workspacePath: string, sourceId: string): AnyFolder | null => {
  const folders = storage.loadFolders(workspacePath);
  const idx = folders.findIndex((f) => f.id === sourceId);
  if (idx === -1) return null;
  const updated = { ...folders[idx] };
  delete updated.conflictState;
  folders[idx] = updated;
  storage.saveFolders(workspacePath, folders);
  return updated;
};

export function worktreeMergeToSource(
  workspacePath: string,
  folderId: string
): { success: boolean; message?: string; error?: string } {
  if (isGitDisabled()) {
    return { success: false, error: GIT_DISABLED_ERROR };
  }
  const folders = storage.loadFolders(workspacePath);
  const wt = folders.find((f) => f.id === folderId);
  if (!isWorktreeFolder(wt) || !wt.sourceRelativePath) {
    return { success: false, error: 'Not a recognized worktree' };
  }
  const sourceFolder = folders.find((f) => f.relativePath === wt.sourceRelativePath);
  if (!sourceFolder) {
    return { success: false, error: 'Source folder not found for this worktree' };
  }

  const worktreePath = resolveWorkspaceSubpath(workspacePath, wt.relativePath);
  const sourcePath = resolveWorkspaceSubpath(workspacePath, wt.sourceRelativePath);
  if (!worktreePath || !sourcePath) {
    return { success: false, error: 'Worktree or source path missing' };
  }

  const worktreeHead = (() => {
    try {
      return execSync(`git -C ${JSON.stringify(worktreePath)} rev-parse HEAD`, {
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .toString()
        .trim();
    } catch {
      return '';
    }
  })();
  const sourceHead = (() => {
    try {
      return execSync(`git -C ${JSON.stringify(sourcePath)} rev-parse HEAD`, {
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .toString()
        .trim();
    } catch {
      return '';
    }
  })();

  let worktreeCommitted = false;
  if (gitStatusDirty(worktreePath)) {
    worktreeCommitted = gitCommitAll(worktreePath, 'Auto-commit worktree changes before merge');
    if (!worktreeCommitted) {
      return { success: false, error: 'Failed to commit worktree changes before merge' };
    }
  }

  let stashRef: string | null = null;
  if (gitStatusDirty(sourcePath)) {
    stashRef = createNamedStash(sourcePath, `agentcraft-merge-${Date.now()}`);
    if (!stashRef) {
      return { success: false, error: 'Failed to stash source changes' };
    }
  }

  try {
    execSync(
      `git -C ${JSON.stringify(sourcePath)} merge ${JSON.stringify(wt.worktreeBranch || gitBranchName(worktreePath) || 'HEAD')}`,
      { stdio: 'ignore' }
    );
  } catch {
    markConflictState(workspacePath, sourceFolder.id, {
      kind: 'merge',
      stashRef: stashRef || undefined,
      sourceHead,
      worktreeHead,
      worktreeId: wt.id,
      message: 'Merge produced conflicts. Resolve in source or undo.',
    });
    return { success: false, error: 'Merge produced conflicts. Resolve or undo the merge.' };
  }

  // Merge succeeded; restore stash if present
  if (stashRef && stashExists(sourcePath, stashRef)) {
    const restored = applyStash(sourcePath, stashRef);
    if (!restored) {
      markConflictState(workspacePath, sourceFolder.id, {
        kind: 'restore',
        stashRef,
        sourceHead,
        worktreeHead,
        worktreeId: wt.id,
        message:
          'Merge succeeded but restoring your source changes failed. Clean up and retry restore or undo.',
      });
      return { success: false, error: 'Merge succeeded but restoring your source changes failed.' };
    }
  }

  let cleanupNote: string | undefined;
  const cleanup = cleanupGitWorktree(sourcePath, worktreePath);
  if (!cleanup.ok) {
    cleanupNote =
      'Merged worktree into source, but failed to remove the git worktree. Run git worktree prune to clean it up.';
    log.warn('Failed to remove git worktree after merge:', cleanup.error);
  }

  // Success: remove worktree metadata entry
  const remaining = folders.filter((f) => f.id !== wt.id);
  storage.saveFolders(workspacePath, remaining);

  return { success: true, message: cleanupNote || 'Merged worktree into source.' };
}

export function worktreeUndoMerge(
  workspacePath: string,
  folderId: string
): { success: boolean; message?: string; error?: string } {
  if (isGitDisabled()) {
    return { success: false, error: GIT_DISABLED_ERROR };
  }
  const folders = storage.loadFolders(workspacePath);
  const source = folders.find((f) => f.id === folderId);
  if (!source?.conflictState) return { success: false, error: 'No conflict to undo' };

  const sourcePath = resolveWorkspaceSubpath(workspacePath, source.relativePath);
  if (!sourcePath) return { success: false, error: 'Source path missing' };

  const worktreeId = source.conflictState.worktreeId;
  const wt = folders.find((f) => f.id === worktreeId);
  const worktreePath = wt ? resolveWorkspaceSubpath(workspacePath, wt.relativePath) : null;

  try {
    execSync(`git -C ${JSON.stringify(sourcePath)} merge --abort`, { stdio: 'ignore' });
  } catch {
    /* noop */
  }
  if (source.conflictState.sourceHead) {
    try {
      execSync(
        `git -C ${JSON.stringify(sourcePath)} reset --hard ${JSON.stringify(source.conflictState.sourceHead)}`,
        { stdio: 'ignore' }
      );
    } catch {
      /* noop */
    }
  }
  if (source.conflictState.stashRef) {
    const restored = applyStash(sourcePath, source.conflictState.stashRef);
    if (!restored) {
      return { success: false, error: 'Could not restore stashed changes. Resolve manually.' };
    }
  }
  if (worktreePath && source.conflictState.worktreeHead) {
    try {
      execSync(
        `git -C ${JSON.stringify(worktreePath)} reset --hard ${JSON.stringify(source.conflictState.worktreeHead)}`,
        { stdio: 'ignore' }
      );
    } catch {
      /* noop */
    }
  }

  clearConflictState(workspacePath, folderId);
  return { success: true, message: 'Merge undone.' };
}

export function worktreeRetryRestore(
  workspacePath: string,
  folderId: string
): { success: boolean; message?: string; error?: string } {
  if (isGitDisabled()) {
    return { success: false, error: GIT_DISABLED_ERROR };
  }
  const folders = storage.loadFolders(workspacePath);
  const source = folders.find((f) => f.id === folderId);
  if (!source?.conflictState || source.conflictState.kind !== 'restore') {
    return { success: false, error: 'No restore conflict to retry' };
  }
  const sourcePath = resolveWorkspaceSubpath(workspacePath, source.relativePath);
  if (!sourcePath) return { success: false, error: 'Source path missing' };

  const stashRef = source.conflictState.stashRef;
  if (!stashRef || !stashExists(sourcePath, stashRef)) {
    clearConflictState(workspacePath, folderId);
    return { success: true, message: 'Nothing to restore; cleared conflict flag.' };
  }

  const restored = applyStash(sourcePath, stashRef);
  if (!restored) {
    return { success: false, error: 'Restore still failing. Clean working tree and retry.' };
  }
  clearConflictState(workspacePath, folderId);
  return { success: true, message: 'Restored stashed changes.' };
}

export function refreshFolderConflictState(workspacePath: string, folderId: string): AnyFolder | null {
  const folders = storage.loadFolders(workspacePath);
  const idx = folders.findIndex((f) => f.id === folderId);
  if (idx === -1) return null;
  const folder = folders[idx];
  if (!folder.conflictState) return folder;
  if (isGitDisabled()) return folder;

  const sourcePath = resolveWorkspaceSubpath(workspacePath, folder.relativePath);
  if (!sourcePath) return folder;

  // Merge conflict: clear when no MERGE_HEAD and no unmerged paths
  if (folder.conflictState.kind === 'merge') {
    if (!mergeHeadExists(sourcePath) && !hasUnmergedPaths(sourcePath)) {
      return clearConflictState(workspacePath, folderId);
    }
    return folder;
  }

  // Restore conflict: if stash is gone and clean, clear; if stash present and clean, try apply once
  if (folder.conflictState.kind === 'restore') {
    const clean = !gitStatusDirty(sourcePath) && !hasUnmergedPaths(sourcePath);
    const ref = folder.conflictState.stashRef;
    if (clean && ref && stashExists(sourcePath, ref)) {
      const ok = applyStash(sourcePath, ref);
      if (ok && !gitStatusDirty(sourcePath) && !hasUnmergedPaths(sourcePath)) {
        return clearConflictState(workspacePath, folderId);
      }
      return folder;
    }
    if (clean && (!ref || !stashExists(sourcePath, ref))) {
      return clearConflictState(workspacePath, folderId);
    }
  }

  return folder;
}

const gitBranchExists = (dir: string, branchName: string): boolean => {
  try {
    execSync(
      `git -C ${JSON.stringify(dir)} show-ref --verify --quiet ${JSON.stringify(`refs/heads/${branchName}`)}`,
      {
        stdio: 'ignore',
      }
    );
    return true;
  } catch {
    return false;
  }
};

const renameGitBranch = (dir: string, oldBranch: string, newBranch: string): boolean => {
  try {
    execSync(
      `git -C ${JSON.stringify(dir)} branch -m ${JSON.stringify(oldBranch)} ${JSON.stringify(newBranch)}`,
      {
        stdio: 'ignore',
      }
    );
    return true;
  } catch {
    return false;
  }
};

const moveGitWorktree = (repoPath: string, oldPath: string, newPath: string): boolean => {
  try {
    execSync(
      `git -C ${JSON.stringify(repoPath)} worktree move ${JSON.stringify(oldPath)} ${JSON.stringify(newPath)}`,
      {
        stdio: 'ignore',
      }
    );
    return true;
  } catch {
    return false;
  }
};

const gitStatusDirty = (dir: string): boolean => {
  try {
    const out = execSync(`git -C ${JSON.stringify(dir)} status --porcelain`, {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    return out.length > 0;
  } catch {
    return false;
  }
};

const gitCommitAll = (dir: string, message: string): boolean => {
  try {
    execSync(`git -C ${JSON.stringify(dir)} add -A`, { stdio: 'ignore' });
    execSync(`git -C ${JSON.stringify(dir)} commit -am ${JSON.stringify(message)}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

const cleanupGitWorktree = (
  sourcePath: string,
  worktreePath: string,
  options?: { keepWorkingTree?: boolean }
): { ok: boolean; error?: string } => {
  const keepFlag = options?.keepWorkingTree ? ' --keep' : '';
  if (!fs.existsSync(worktreePath)) {
    try {
      execSync(`git -C ${JSON.stringify(sourcePath)} worktree prune`, { stdio: 'ignore' });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Failed to prune git worktrees' };
    }
  }
  try {
    execSync(
      `git -C ${JSON.stringify(sourcePath)} worktree remove --force${keepFlag} ${JSON.stringify(worktreePath)}`,
      { stdio: 'ignore' }
    );
    return { ok: true };
  } catch (err) {
    try {
      execSync(`git -C ${JSON.stringify(sourcePath)} worktree prune`, { stdio: 'ignore' });
    } catch {
      /* noop */
    }
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to remove git worktree' };
  }
};

// Rename a folder
export function renameFolder(
  workspacePath: string,
  folderId: string,
  newName: string
): { success: boolean; folder?: AnyFolder; error?: string } {
  const folders = storage.loadFolders(workspacePath);
  const folder = folders.find((f) => f.id === folderId);

  if (!folder) {
    log.warn(`Folder ${folderId} not found`);
    return { success: false, error: 'Folder not found' };
  }

  const cleanedNewName = sanitizeFolderRelativeName(newName);
  if (!cleanedNewName) {
    return { success: false, error: 'Folder name cannot be empty' };
  }

  if (folders.some((f) => f.id !== folderId && f.relativePath === cleanedNewName)) {
    return { success: false, error: 'A folder with that name already exists' };
  }

  const oldRelativePath = folder.relativePath;
  const oldPath = resolveWorkspaceSubpath(workspacePath, folder.relativePath);
  const newPath = resolveWorkspaceSubpath(workspacePath, cleanedNewName);
  if (!oldPath || !newPath) {
    return { success: false, error: 'Invalid folder path' };
  }
  const newExists = fs.existsSync(newPath) && fs.statSync(newPath).isDirectory();
  const isWorktree = isWorktreeFolder(folder);
  const sourcePath =
    isWorktree && folder.sourceRelativePath
      ? resolveWorkspaceSubpath(workspacePath, folder.sourceRelativePath)
      : null;
  let oldBranch = isWorktree ? folder.worktreeBranch || gitBranchName(oldPath) : null;
  if (oldBranch === 'HEAD') {
    oldBranch = null;
  }
  const newBranch = isWorktree && oldBranch ? worktreeBranchName(cleanedNewName) : null;

  if (isWorktree) {
    if (isGitDisabled()) {
      log.warn('Git disabled; cannot rename worktree branch.');
      return { success: false, error: GIT_DISABLED_ERROR };
    }
    if (!sourcePath) {
      log.warn('Source path missing for worktree rename.');
      return { success: false, error: 'Worktree source path missing' };
    }
    if (!oldBranch || !newBranch) {
      log.info('Worktree is detached; skipping branch rename.');
    }
    if (newExists && oldPath !== newPath) {
      log.warn('Worktree rename target already exists; aborting to avoid relink.');
      return { success: false, error: 'Target folder already exists' };
    }
    if (newBranch && oldBranch && newBranch !== oldBranch && gitBranchExists(sourcePath, newBranch)) {
      log.warn('Worktree branch rename conflict; target branch already exists.');
      return { success: false, error: 'Target branch already exists' };
    }
  }

  // If the target already exists elsewhere, treat this as relinking metadata to that folder.
  if (newExists && oldPath !== newPath) {
    folder.name = cleanedNewName;
    folder.relativePath = cleanedNewName;
    storage.saveFolders(workspacePath, folders);
    updateTerminalRecordsForRename(workspacePath, folderId, oldRelativePath, cleanedNewName, folder.name);
    // Best-effort cleanup: remove the old physical folder if it was empty.
    try {
      if (fs.existsSync(oldPath) && fs.statSync(oldPath).isDirectory()) {
        const entries = fs.readdirSync(oldPath);
        const remaining = entries.filter((entry) => entry !== '.git' && entry !== '.DS_Store');
        if (remaining.length === 0) {
          fs.rmSync(oldPath, { recursive: true, force: false });
        }
      }
    } catch {
      /* noop */
    }
    return { success: true, folder };
  }

  // Otherwise perform a physical rename if the source exists and target does not
  let didRenamePath = false;
  if (!newExists && fs.existsSync(oldPath)) {
    if (isWorktree && sourcePath && oldPath !== newPath) {
      if (!moveGitWorktree(sourcePath, oldPath, newPath)) {
        return { success: false, error: 'Failed to rename worktree folder' };
      }
      didRenamePath = true;
    } else {
      fs.renameSync(oldPath, newPath);
      didRenamePath = true;
    }
  }

  if (isWorktree && oldBranch && newBranch && newBranch !== oldBranch) {
    const branchPath = didRenamePath ? newPath : oldPath;
    if (!renameGitBranch(branchPath, oldBranch, newBranch)) {
      if (didRenamePath) {
        if (isWorktree && sourcePath && oldPath !== newPath) {
          if (!moveGitWorktree(sourcePath, newPath, oldPath)) {
            log.warn('Failed to roll back worktree move after branch rename failure.');
          }
        } else {
          try {
            fs.renameSync(newPath, oldPath);
          } catch {
            /* noop */
          }
        }
      }
      return { success: false, error: 'Failed to rename worktree branch' };
    }
    folder.worktreeBranch = newBranch;
  }

  folder.name = cleanedNewName;
  folder.relativePath = cleanedNewName;
  storage.saveFolders(workspacePath, folders);
  updateTerminalRecordsForRename(workspacePath, folderId, oldRelativePath, cleanedNewName, folder.name);

  return { success: true, folder };
}

// Remove a folder entity (doesn't delete physical directory)
export function removeFolder(workspacePath: string, folderId: string): boolean {
  const folders = storage.loadFolders(workspacePath);
  const idx = folders.findIndex((f) => f.id === folderId);

  if (idx === -1) {
    return false;
  }

  folders.splice(idx, 1);
  storage.saveFolders(workspacePath, folders);
  return true;
}

// Delete folder physically (move to OS trash)
export async function deleteFolder(
  workspacePath: string,
  folderId: string
): Promise<{ success: boolean; error?: string }> {
  const folders = storage.loadFolders(workspacePath);
  const folder = folders.find((f) => f.id === folderId);
  if (!folder) return { success: false, error: 'Folder not found' };
  const folderPath = resolveWorkspaceSubpath(workspacePath, folder.relativePath);
  if (!folderPath || !fs.existsSync(folderPath)) {
    return { success: false, error: 'Folder path missing' };
  }
  const isWorktree = isWorktreeFolder(folder);
  const sourcePath = isWorktree ? resolveWorkspaceSubpath(workspacePath, folder.sourceRelativePath) : null;
  const canCleanupWorktree = !!(sourcePath && fs.existsSync(sourcePath));
  if (isWorktree && !canCleanupWorktree) {
    log.warn('Source path missing for worktree delete; skipping git cleanup.');
  }
  try {
    if (fs.existsSync(folderPath)) {
      await shell.trashItem(folderPath);
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to delete folder' };
  }
  if (isWorktree && canCleanupWorktree && sourcePath) {
    if (isGitDisabled()) {
      log.warn('Git disabled; skipping worktree cleanup after trash.');
    } else {
      const cleanup = cleanupGitWorktree(sourcePath, folderPath);
      if (!cleanup.ok) {
        log.warn('Failed to prune git worktree after trash:', cleanup.error);
      }
    }
  }
  // Remove metadata entry
  const idx = folders.findIndex((f) => f.id === folderId);
  if (idx !== -1) {
    folders.splice(idx, 1);
    storage.saveFolders(workspacePath, folders);
  }
  return { success: true };
}

// Detach agents currently attached to a folder.
export function detachAgentsForFolder(workspacePath: string, folderId: string): string[] {
  const agents = storage.loadAgents(workspacePath);
  const detachedAgentIds: string[] = [];
  const updated = agents.map((agent) => {
    if (agent.attachedFolderId !== folderId) return agent;
    detachedAgentIds.push(agent.id);
    return { ...agent, attachedFolderId: undefined, status: 'offline' as const };
  });
  if (detachedAgentIds.length > 0) {
    storage.saveAgents(workspacePath, updated);
  }
  return detachedAgentIds;
}

export function reconcileAgentAttachments(workspacePath: string): Agent[] {
  const folders = storage.loadFolders(workspacePath);
  const folderIds = new Set(folders.map((f) => f.id));
  const agents = storage.loadAgents(workspacePath);
  let changed = false;
  const updated = agents.map((a) => {
    if (a.attachedFolderId && !folderIds.has(a.attachedFolderId)) {
      changed = true;
      return { ...a, attachedFolderId: undefined, status: 'offline' as const };
    }
    return a;
  });
  if (changed) {
    storage.saveAgents(workspacePath, updated);
  }
  return updated;
}

// Update folder position
export function updateFolderPosition(workspacePath: string, folderId: string, x: number, y: number): void {
  const folders = storage.loadFolders(workspacePath);
  const folder = folders.find((f) => f.id === folderId);

  if (folder) {
    const dx = x - folder.x;
    const dy = y - folder.y;
    folder.x = x;
    folder.y = y;
    storage.saveFolders(workspacePath, folders);

    // Synchronise attached agent positions so they move with the folder
    const agents = storage.loadAgents(workspacePath);
    let agentsChanged = false;
    const updatedAgents = agents.map((a) => {
      if (a.attachedFolderId !== folderId) return a;
      agentsChanged = true;
      return { ...a, x: a.x + dx, y: a.y + dy };
    });
    if (agentsChanged) {
      storage.saveAgents(workspacePath, updatedAgents);
    }
  }
}

// Check if path is valid workspace
export function isValidWorkspace(workspacePath: string): boolean {
  try {
    return fs.existsSync(workspacePath) && fs.statSync(workspacePath).isDirectory();
  } catch {
    return false;
  }
}

// Get workspace name from path
export function getWorkspaceName(workspacePath: string): string {
  return path.basename(workspacePath);
}
