import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { usePanelResize } from './usePanelResize';
import { useCanvasTransform } from '../components/canvas/CanvasContext';

export interface PanelPosition {
  x: number;
  y: number;
}

export interface PanelSize {
  width: number;
  height: number;
}

export interface UsePanelOptions {
  // Initial position
  x: number;
  y: number;

  // Initial size
  width: number;
  height: number;
  minWidth?: number;
  minHeight?: number;

  // Storage configuration
  storageKey?: string; // localStorage key for saving position/size
  saveToStorage?: boolean; // Whether to save to localStorage

  // Callbacks
  onMove?: (x: number, y: number) => void;
  onMoveEnd?: (x: number, y: number) => void;
  onResize?: (width: number, height: number) => void;
  onResizeEnd?: (width: number, height: number) => void;
  onBringToFront?: () => void;
}

export interface UsePanelReturn {
  // Position
  position: PanelPosition;
  isDragging: boolean;
  startDrag: (event: ReactMouseEvent) => void;

  // Size
  size: PanelSize;
  startResize: (event: ReactMouseEvent) => void;
  isResizing: boolean;

  // Abilities
  bringToFront: () => void;
}

// Helper to read from localStorage
function readFromStorage<T>(key: string, defaultValue: T): T {
  if (typeof window === 'undefined') {
    return defaultValue;
  }

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return defaultValue;

    const parsed = JSON.parse(raw);
    return parsed ?? defaultValue;
  } catch {
    return defaultValue;
  }
}

// Helper to write to localStorage
function writeToStorage<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage errors
  }
}

export function usePanel({
  x: initialX,
  y: initialY,
  width: initialWidth,
  height: initialHeight,
  minWidth = 400,
  minHeight = 300,
  storageKey,
  saveToStorage = false,
  onMove,
  onResize,
  onResizeEnd,
  onBringToFront,
  onMoveEnd,
}: UsePanelOptions): UsePanelReturn {
  const { zoom } = useCanvasTransform();
  // Load saved position/size from storage if available
  const savedState =
    storageKey && saveToStorage
      ? readFromStorage<{ position?: PanelPosition; size?: PanelSize }>(storageKey, {})
      : null;

  const [position, setPosition] = useState<PanelPosition>(
    () => savedState?.position ?? { x: initialX, y: initialY }
  );

  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const panelStart = useRef({ x: 0, y: 0 });
  const latestPositionRef = useRef<PanelPosition>(position);

  useEffect(() => {
    latestPositionRef.current = position;
  }, [position]);

  useEffect(() => {
    if (isDragging) {
      return;
    }
    const nextPosition = { x: initialX, y: initialY };
    if (position.x === nextPosition.x && position.y === nextPosition.y) {
      return;
    }
    latestPositionRef.current = nextPosition;
    setPosition(nextPosition);
  }, [initialX, initialY, isDragging, position.x, position.y]);

  // Use the resize hook
  const { size, startResize, isResizing } = usePanelResize({
    width: savedState?.size?.width ?? initialWidth,
    height: savedState?.size?.height ?? initialHeight,
    minWidth,
    minHeight,
    onResize: (newSize) => {
      onResize?.(newSize.width, newSize.height);
      if (storageKey && saveToStorage) {
        const current = readFromStorage<{ position?: PanelPosition; size?: PanelSize }>(storageKey, {});
        writeToStorage(storageKey, { ...current, size: newSize });
      }
    },
    onResizeEnd: (newSize) => {
      onResizeEnd?.(newSize.width, newSize.height);
      if (storageKey && saveToStorage) {
        const current = readFromStorage<{ position?: PanelPosition; size?: PanelSize }>(storageKey, {});
        writeToStorage(storageKey, { ...current, size: newSize });
      }
    },
  });

  // Save position to storage when it changes
  useEffect(() => {
    if (storageKey && saveToStorage && !isDragging) {
      const current = readFromStorage<{ position?: PanelPosition; size?: PanelSize }>(storageKey, {});
      writeToStorage(storageKey, { ...current, position });
    }
  }, [position, storageKey, saveToStorage, isDragging]);

  // Drag handling
  const startDrag = useCallback(
    (event: ReactMouseEvent) => {
      if (event.button !== 0) return;

      event.preventDefault();
      event.stopPropagation();

      setIsDragging(true);
      dragStart.current = { x: event.clientX, y: event.clientY };
      panelStart.current = { x: position.x, y: position.y };
      const currentZoom = zoom;

      const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
        const dx = (moveEvent.clientX - dragStart.current.x) / currentZoom;
        const dy = (moveEvent.clientY - dragStart.current.y) / currentZoom;

        const newX = panelStart.current.x + dx;
        const newY = panelStart.current.y + dy;

        setPosition({ x: newX, y: newY });
        latestPositionRef.current = { x: newX, y: newY };
        onMove?.(newX, newY);
      };

      const handleMouseUp = () => {
        setIsDragging(false);
        const latest = latestPositionRef.current;
        onMoveEnd?.(latest.x, latest.y);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [position, onMove, onMoveEnd, zoom]
  );

  // Bring to front
  const bringToFront = useCallback(() => {
    onBringToFront?.();
  }, [onBringToFront]);

  return {
    position,
    isDragging,
    startDrag,
    size,
    startResize,
    isResizing,
    bringToFront,
  };
}
