import { useCallback, useRef, type MouseEvent } from 'react';
import { useCanvasTransform } from '../CanvasContext';

type DragEndData = { pos: { x: number; y: number }; dragDistance: number };

const DEFAULT_DRAG_THRESHOLD_PX = 3;

interface UseEntityDragParams {
  x: number;
  y: number;
  onMove: (x: number, y: number) => void;
  onDragStart?: () => void;
  onDragEnd?: (data?: DragEndData) => void;
  draggable?: boolean;
  dragThresholdPx?: number;
}

export function useEntityDrag({
  x,
  y,
  onMove,
  onDragStart,
  onDragEnd,
  draggable = true,
  dragThresholdPx = DEFAULT_DRAG_THRESHOLD_PX,
}: UseEntityDragParams) {
  const dragging = useRef(false);
  const dragActive = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });
  const entityPos = useRef({ x, y });
  const lastDragPos = useRef<{ x: number; y: number } | null>(null);
  const { zoom } = useCanvasTransform();

  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      if (e.button !== 0) return; // Only left click
      if (!draggable) return;

      e.preventDefault();
      e.stopPropagation();
      dragging.current = true;
      dragActive.current = false;
      startPos.current = { x: e.clientX, y: e.clientY };
      entityPos.current = { x, y };
      lastDragPos.current = { x, y };

      const handleMouseMove = (event: globalThis.MouseEvent) => {
        if (!dragging.current) return;

        const dxScreen = event.clientX - startPos.current.x;
        const dyScreen = event.clientY - startPos.current.y;
        const screenDistance = Math.hypot(dxScreen, dyScreen);
        if (!dragActive.current) {
          if (screenDistance < dragThresholdPx) {
            return;
          }
          dragActive.current = true;
          onDragStart?.();
        }

        const dx = dxScreen / zoom;
        const dy = dyScreen / zoom;
        const nextPos = { x: entityPos.current.x + dx, y: entityPos.current.y + dy };
        lastDragPos.current = nextPos;
        onMove(nextPos.x, nextPos.y);
      };

      const handleMouseUp = (event: globalThis.MouseEvent) => {
        dragging.current = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        if (!dragActive.current) {
          dragActive.current = false;
          return;
        }
        const dx = (event.clientX - startPos.current.x) / zoom;
        const dy = (event.clientY - startPos.current.y) / zoom;
        const endPos = { x: entityPos.current.x + dx, y: entityPos.current.y + dy };
        const resolvedPos = lastDragPos.current ?? endPos;
        const dragDistance = Math.hypot(
          resolvedPos.x - entityPos.current.x,
          resolvedPos.y - entityPos.current.y
        );
        if (dragDistance > 0) {
          onMove(resolvedPos.x, resolvedPos.y);
        }
        onDragEnd?.({ pos: resolvedPos, dragDistance });
        dragActive.current = false;
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [x, y, onDragEnd, onDragStart, onMove, zoom, draggable, dragThresholdPx]
  );

  return { handleMouseDown };
}
