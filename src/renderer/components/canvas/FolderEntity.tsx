import { useEffect, useRef, type MouseEvent } from 'react';
import type { AvailableFolder, Folder } from '../../../shared/types';
import BuildingEntity from './BuildingEntity';
import SelectionIndicator from './SelectionIndicator';
import { useEntityDrag } from './hooks/useEntityDrag';
import { entityIcons } from '../../assets/icons';

interface FolderEntityProps {
  folder: Folder;
  selected: boolean;
  previewed?: boolean;
  magnetized?: boolean;
  onSelect: (event?: MouseEvent) => void;
  onMove: (x: number, y: number) => void;
  onDragEnd?: () => void;
  onNameClick?: () => void;
  renaming?: boolean;
  renameValue?: string;
  renameOptions?: AvailableFolder[];
  renameDropdownOpen?: boolean;
  onRenameChange?: (value: string) => void;
  onRenameSubmit?: () => void;
  onRenameCancel?: () => void;
  onToggleDropdown?: () => void;
  onPickOption?: (relativePath: string) => void;
}

export default function FolderEntity({
  folder,
  selected,
  previewed = false,
  magnetized = false,
  onSelect,
  onMove,
  onDragEnd,
  onNameClick,
  renaming,
  renameValue,
  renameOptions = [],
  renameDropdownOpen,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  onToggleDropdown,
  onPickOption,
}: FolderEntityProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { handleMouseDown } = useEntityDrag({
    x: folder.x,
    y: folder.y,
    onMove,
    onDragEnd: onDragEnd ? () => onDragEnd() : undefined,
  });

  useEffect(() => {
    if (renaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [renaming]);

  const renderLabel = () => {
    if (renaming) {
      const available = renameOptions.filter((opt) => !opt.isImported);
      const query = (renameValue || '').trim().toLowerCase();
      const filtered = available.filter((opt) => {
        if (!query) return false;
        const name = opt.name.toLowerCase();
        return name.startsWith(query);
      });
      const displayedOptions = renameDropdownOpen ? available : filtered;
      const showDropdown = (renameDropdownOpen && available.length > 0) || (!!query && filtered.length > 0);

      return (
        <div
          className="folder-rename-inline"
          onMouseDown={(e) => {
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          <input
            ref={inputRef}
            className="folder-rename-input"
            value={renameValue ?? ''}
            onChange={(e) => onRenameChange?.(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onRenameSubmit?.();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onRenameCancel?.();
              }
            }}
            aria-label="Rename folder"
          />
          <button
            type="button"
            className="folder-rename-dropdown-btn"
            data-tutorial-target="folder-rename-dropdown"
            onClick={(e) => {
              e.stopPropagation();
              onToggleDropdown?.();
            }}
            aria-label="Show available folders"
          >
            ▾
          </button>
          {showDropdown && (
            <div
              className="folder-rename-dropdown"
              onWheelCapture={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (e.nativeEvent?.stopImmediatePropagation) {
                  e.nativeEvent.stopImmediatePropagation();
                }
              }}
              onWheel={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (e.nativeEvent?.stopImmediatePropagation) {
                  e.nativeEvent.stopImmediatePropagation();
                }
              }}
            >
              {displayedOptions.length === 0 ? (
                <div className="folder-rename-option disabled">No importable folders</div>
              ) : (
                displayedOptions.map((opt) => (
                  <div
                    key={opt.relativePath}
                    className="folder-rename-option"
                    data-tutorial-target={
                      /doodle\s*-?\s*jump/i.test(opt.name) ? 'folder-rename-option-doodle-jump' : undefined
                    }
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onPickOption?.(opt.relativePath);
                    }}
                  >
                    <span className="option-name">{opt.name}</span>
                    <span className="option-path">{opt.relativePath}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      );
    }

    return (
      <div
        className="folder-label"
        onMouseDown={(e) => {
          e.stopPropagation();
        }}
        onClick={(e) => {
          e.stopPropagation();
          onNameClick?.();
        }}
      >
        {folder.name}
      </div>
    );
  };

  return (
    <BuildingEntity
      entityType="folder"
      selected={selected}
      onSelect={onSelect}
      onMouseDown={handleMouseDown}
      className={`entity folder-entity ${magnetized ? 'magnetized' : ''} ${renaming ? 'renaming' : ''} ${folder.isWorktree ? 'worktree' : ''} ${folder.conflictState ? 'conflict' : ''}`}
      testId="entity-folder"
      entityId={folder.id}
      entityName={folder.name}
      style={{ transform: `translate(${folder.x}px, ${folder.y}px)` }}
    >
      {/* Hitbox centered on the folder icon */}
      <div className="building-hitbox folder-hitbox" />
      <img
        className="folder-icon"
        draggable={false}
        src={folder.isWorktree ? entityIcons.folderWorktree : entityIcons.folder}
        alt="Folder"
      />
      {renderLabel()}
      <SelectionIndicator active={selected || previewed} variant="ring" />
    </BuildingEntity>
  );
}
