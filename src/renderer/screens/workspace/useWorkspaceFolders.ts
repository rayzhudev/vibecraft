import { useCallback, useEffect, useRef } from 'react';
import type { Agent, Folder, SelectedEntityRef } from '../../../shared/types';
import type { CommandRunResult } from '../../../shared/commands';
import { workspaceClient } from '../../services/workspaceClient';
import { useSoundPlayer } from '../../hooks/useSoundPlayer';
import { useFolderManager } from './useFolderManager';

interface UseWorkspaceFoldersParams {
  workspacePath: string;
  folders: Folder[];
  setFolders: React.Dispatch<React.SetStateAction<Folder[]>>;
  setAgents: React.Dispatch<React.SetStateAction<Agent[]>>;
  selectedEntityRef: SelectedEntityRef | null;
  setSelectedEntityRef: React.Dispatch<React.SetStateAction<SelectedEntityRef | null>>;
  setSelectedAgentIds: React.Dispatch<React.SetStateAction<string[]>>;
  setMessageDialog: (message: { title: string; message: string; type: 'info' | 'warning' | 'error' }) => void;
  refreshAvailableFolders: () => Promise<void>;
  reloadFolders: () => Promise<Folder[]>;
  reloadAgents: () => Promise<Agent[]>;
  applyDetachedAgentIds: (detachedAgentIds: string[]) => void;
  persistAgentPosition: (id: string, x: number, y: number) => Promise<CommandRunResult>;
  onFolderRenamed?: () => void | Promise<void>;
}

interface UseWorkspaceFoldersReturn {
  renameState: { folderId: string | null; value: string; dropdownOpen: boolean };
  beginRename: (folder?: Folder, options?: { openDropdown?: boolean }) => void;
  handleRenameChange: (folderId: string, value: string) => void;
  handleRenameCancel: () => void;
  submitRename: (value: string) => Promise<CommandRunResult>;
  handleRenamePickOption: (relativePath: string) => Promise<void>;
  toggleRenameDropdown: () => void;
  renameFolder: (folderId: string, value: string) => Promise<CommandRunResult>;
  handleFolderMove: (id: string, x: number, y: number) => Promise<CommandRunResult>;
  handleFolderDragEnd: (folderId: string) => void;
  createFolder: (name: string, x: number, y: number) => Promise<CommandRunResult>;
  removeFolder: (folderId: string) => Promise<CommandRunResult>;
  deleteFolder: (folderId: string, options?: { skipConfirm?: boolean }) => Promise<CommandRunResult>;
  createWorktree: (folderId: string, x: number, y: number) => Promise<CommandRunResult>;
  worktreeSync: (folderId: string) => Promise<CommandRunResult>;
  worktreeMerge: (folderId: string) => Promise<CommandRunResult>;
  undoMerge: (folderId: string) => Promise<CommandRunResult>;
  retryRestore: (folderId: string) => Promise<CommandRunResult>;
  setRenamingFolderId: (id: string | null) => void;
  setRenameDropdownOpen: (open: boolean) => void;
}

const okResult = (): CommandRunResult => ({ ok: true });
const errorResult = (error: string): CommandRunResult => ({ ok: false, error });

export function useWorkspaceFolders({
  workspacePath,
  folders,
  setFolders,
  setAgents,
  selectedEntityRef,
  setSelectedEntityRef,
  setSelectedAgentIds,
  setMessageDialog,
  refreshAvailableFolders,
  reloadFolders,
  reloadAgents,
  applyDetachedAgentIds,
  persistAgentPosition,
  onFolderRenamed,
}: UseWorkspaceFoldersParams): UseWorkspaceFoldersReturn {
  const {
    renameState,
    setRenamingFolderId,
    setRenameValue,
    setRenameDropdownOpen,
    toggleRenameDropdown,
    clearRenameState,
    renameFolderCore,
  } = useFolderManager();
  const { playSound } = useSoundPlayer();
  const foldersRef = useRef(folders);

  useEffect(() => {
    foldersRef.current = folders;
  }, [folders]);

  const handleFolderMove = useCallback(
    async (id: string, x: number, y: number): Promise<CommandRunResult> => {
      const current = foldersRef.current.find((folder) => folder.id === id);
      const dx = current ? x - current.x : 0;
      const dy = current ? y - current.y : 0;

      foldersRef.current = foldersRef.current.map((f) => (f.id === id ? { ...f, x, y } : f));

      setFolders((prev) => {
        return prev.map((f) => (f.id === id ? { ...f, x, y } : f));
      });

      if (dx !== 0 || dy !== 0) {
        setAgents((prev) =>
          prev.map((a) => (a.attachedFolderId === id ? { ...a, x: a.x + dx, y: a.y + dy } : a))
        );
      }

      try {
        const success = await workspaceClient.updateFolderPosition(workspacePath, id, x, y);
        if (!success) {
          console.warn('Failed to update folder position:', id);
          return errorResult('Failed to update folder position');
        }
        return okResult();
      } catch (error) {
        console.error('Error updating folder position:', error);
        return errorResult(error instanceof Error ? error.message : 'Failed to update folder position');
      }
    },
    [setAgents, setFolders, workspacePath]
  );

  const handleFolderDragEnd = useCallback(
    (folderId: string) => {
      setAgents((currentAgents) => {
        const attachedAgents = currentAgents.filter((a) => a.attachedFolderId === folderId);
        attachedAgents.forEach((agent) => {
          void persistAgentPosition(agent.id, agent.x, agent.y);
        });
        return currentAgents;
      });
    },
    [persistAgentPosition, setAgents]
  );

  const createFolder = async (name: string, x: number, y: number) => {
    const result = await workspaceClient.createFolder(workspacePath, name, x, y);
    if (result.success) {
      await reloadFolders();
      return okResult();
    }
    const errorDetail = result.error || 'Unknown error';
    const errorMessage = `Failed to create folder: ${errorDetail}`;
    setMessageDialog({
      title: 'Error',
      message: errorMessage,
      type: 'error',
    });
    return errorResult(errorMessage);
  };

  const beginRename = useCallback(
    (folder?: Folder, options?: { openDropdown?: boolean }) => {
      const target =
        folder ??
        (selectedEntityRef?.type === 'folder'
          ? folders.find((entry) => entry.id === selectedEntityRef.id)
          : undefined);
      if (!target) return;
      setSelectedAgentIds([]);
      setSelectedEntityRef({ id: target.id, type: 'folder' });
      setRenamingFolderId(target.id);
      setRenameValue(target.name);
      setRenameDropdownOpen(options?.openDropdown ?? false);
      void refreshAvailableFolders();
    },
    [
      folders,
      refreshAvailableFolders,
      selectedEntityRef,
      setRenamingFolderId,
      setRenameDropdownOpen,
      setRenameValue,
      setSelectedAgentIds,
      setSelectedEntityRef,
    ]
  );

  const handleRenameChange = useCallback(
    (folderId: string, value: string) => {
      setRenamingFolderId(folderId);
      setRenameValue(value);
    },
    [setRenamingFolderId, setRenameValue]
  );

  const handleRenameCancel = useCallback(() => {
    clearRenameState();
  }, [clearRenameState]);

  const renameFolder = async (folderId: string, value: string) => {
    const result = await renameFolderCore(workspacePath, folderId, value, folders);
    if (result.success) {
      await reloadFolders();
      await refreshAvailableFolders();
      await onFolderRenamed?.();
      return okResult();
    }
    const errorMessage = result.error || 'Failed to rename folder';
    setMessageDialog({
      title: 'Error',
      message: errorMessage,
      type: 'error',
    });
    return errorResult(errorMessage);
  };

  const submitRename = async (value: string): Promise<CommandRunResult> => {
    if (!renameState.folderId) return errorResult('No folder selected');
    const result = await renameFolderCore(workspacePath, renameState.folderId, value, folders);
    if (result.success) {
      await reloadFolders();
      await refreshAvailableFolders();
      await onFolderRenamed?.();
      setRenamingFolderId(null);
      setRenameDropdownOpen(false);
      return okResult();
    } else {
      setMessageDialog({
        title: 'Error',
        message: result.error || 'Failed to rename folder',
        type: 'error',
      });
      return errorResult(result.error || 'Failed to rename folder');
    }
  };

  const handleRenamePickOption = async (relativePath: string) => {
    setRenameValue(relativePath);
    const result = await submitRename(relativePath);
    if (result.ok) {
      playSound('folder.import');
    }
  };

  const removeFolder = async (folderId: string) => {
    const folder = folders.find((entry) => entry.id === folderId);
    if (!folder) {
      const errorMessage = 'Folder not found';
      setMessageDialog({ title: 'Error', message: errorMessage, type: 'error' });
      return errorResult(errorMessage);
    }
    const result = await workspaceClient.removeFolder(workspacePath, folderId);
    if (result.success) {
      setFolders((prev) => prev.filter((f) => f.id !== folderId));
      if (selectedEntityRef?.type === 'folder' && selectedEntityRef.id === folderId) {
        setSelectedEntityRef(null);
      }
      if (result.detachedAgentIds) applyDetachedAgentIds(result.detachedAgentIds);
      await refreshAvailableFolders();
      return okResult();
    }
    const errorMessage = 'Failed to remove folder';
    setMessageDialog({ title: 'Error', message: errorMessage, type: 'error' });
    return errorResult(errorMessage);
  };

  const deleteFolder = async (folderId: string, options?: { skipConfirm?: boolean }) => {
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) {
      const errorMessage = 'Folder not found';
      setMessageDialog({ title: 'Error', message: errorMessage, type: 'error' });
      return errorResult(errorMessage);
    }
    if (!options?.skipConfirm) {
      const confirmed = window.confirm(`Delete "${folder.name}" and move it to the bin?`);
      if (!confirmed) {
        return errorResult('Delete canceled');
      }
    }
    const result = await workspaceClient.deleteFolder(workspacePath, folder.id);
    if (result.success) {
      setFolders((prev) => prev.filter((f) => f.id !== folder.id));
      if (selectedEntityRef?.type === 'folder' && selectedEntityRef.id === folderId) {
        setSelectedEntityRef(null);
      }
      if (result.detachedAgentIds) applyDetachedAgentIds(result.detachedAgentIds);
      await refreshAvailableFolders();
      return okResult();
    }
    const errorMessage = result.error || 'Failed to delete folder';
    setMessageDialog({ title: 'Error', message: errorMessage, type: 'error' });
    return errorResult(errorMessage);
  };

  const createWorktree = async (folderId: string, x: number, y: number) => {
    const result = await workspaceClient.createGitWorktree(workspacePath, folderId, x, y);
    if (result.success && result.folder) {
      const nextFolder = result.folder;
      setFolders((prev) => [...prev, nextFolder]);
      await refreshAvailableFolders();
      return okResult();
    }
    if (!result.success) {
      const errorMessage = result.error || 'Failed to create worktree';
      setMessageDialog({
        title: 'Error',
        message: errorMessage,
        type: 'error',
      });
      return errorResult(errorMessage);
    }
    return errorResult('Failed to create worktree');
  };

  const worktreeSync = async (folderId: string) => {
    const result = await workspaceClient.worktreeSyncFromSource(workspacePath, folderId);
    if (!result.success) {
      const errorMessage = result.error || 'Sync from source failed';
      setMessageDialog({
        title: 'Sync failed',
        message: errorMessage,
        type: 'error',
      });
      return errorResult(errorMessage);
    }
    if (result.message) {
      setMessageDialog({ title: 'Synced', message: result.message, type: 'info' });
    }
    return okResult();
  };

  const worktreeMerge = async (folderId: string) => {
    const result = await workspaceClient.worktreeMergeToSource(workspacePath, folderId);
    if (result.success) {
      await reloadFolders();
      if (result.detachedAgentIds) {
        applyDetachedAgentIds(result.detachedAgentIds);
        await reloadAgents();
      }
      if (selectedEntityRef?.type === 'folder' && selectedEntityRef.id === folderId) {
        setSelectedEntityRef(null);
      }
      setMessageDialog({
        title: 'Merge complete',
        message: result.message || 'Merged to source.',
        type: 'info',
      });
      return okResult();
    }
    await reloadFolders();
    const errorMessage = result.error || 'Merge failed';
    setMessageDialog({ title: 'Merge failed', message: errorMessage, type: 'error' });
    return errorResult(errorMessage);
  };

  const undoMerge = async (folderId: string) => {
    const result = await workspaceClient.worktreeUndoMerge(workspacePath, folderId);
    if (result.success) {
      await reloadFolders();
      setMessageDialog({ title: 'Merge undone', message: result.message || 'Merge undone.', type: 'info' });
      return okResult();
    }
    const errorMessage = result.error || 'Failed to undo merge';
    setMessageDialog({ title: 'Error', message: errorMessage, type: 'error' });
    return errorResult(errorMessage);
  };

  const retryRestore = async (folderId: string) => {
    const result = await workspaceClient.worktreeRetryRestore(workspacePath, folderId);
    if (result.success) {
      await reloadFolders();
      setMessageDialog({
        title: 'Restore retried',
        message: result.message || 'Restore retried.',
        type: 'info',
      });
      return okResult();
    }
    const errorMessage = result.error || 'Failed to retry restore';
    setMessageDialog({ title: 'Error', message: errorMessage, type: 'error' });
    return errorResult(errorMessage);
  };

  return {
    renameState,
    beginRename,
    handleRenameChange,
    handleRenameCancel,
    submitRename,
    handleRenamePickOption,
    toggleRenameDropdown,
    renameFolder,
    handleFolderMove,
    handleFolderDragEnd,
    createFolder,
    removeFolder,
    deleteFolder,
    createWorktree,
    worktreeSync,
    worktreeMerge,
    undoMerge,
    retryRestore,
    setRenamingFolderId,
    setRenameDropdownOpen,
  };
}
