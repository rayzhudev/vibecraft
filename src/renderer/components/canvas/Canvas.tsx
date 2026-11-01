import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
  type MouseEvent,
} from 'react';
import type { SelectedEntityRef } from '../../../shared/types';
import { CanvasTransformContext } from './CanvasContext';
import type { CanvasCameraControls, CanvasCameraState } from './types';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
const PINCH_ZOOM_IN_FACTOR = 1.05;
const PINCH_ZOOM_OUT_FACTOR = 0.95;
const MOUSE_ZOOM_IN_FACTOR = 1.15;
const MOUSE_ZOOM_OUT_FACTOR = 0.85;
const CLICK_ZOOM_IN_FACTOR = 1.2;
const CLICK_ZOOM_OUT_FACTOR = 0.8;
const TRACKPAD_PAN_THRESHOLD = 50;
const PAN_SPEED_MULTIPLIER = 1.5;
const WHEEL_PAN_IDLE_MS = 120;

type SelectionRect = { left: number; right: number; top: number; bottom: number };
type SelectionPoint = { x: number; y: number };

interface CanvasProps {
  children: ReactNode;
  onClickEmpty: () => void;
  onRightClick?: (position: { x: number; y: number }, target: SelectedEntityRef | null) => void;
  onCameraChange?: (camera: CanvasCameraState) => void;
  onCameraControlsReady?: (controls: CanvasCameraControls) => void;
  onPanStart?: () => void;
  onPanEnd?: () => void;
  initialCenter?:
    | { x: number; y: number }
    | ((viewport: { width: number; height: number }) => { x: number; y: number });
  onWheelPanActivity?: () => void;
  onSelectionStart?: () => void;
  onSelectionUpdate?: (payload: {
    rect: SelectionRect;
    dragStart: SelectionPoint;
    dragEnd: SelectionPoint;
  }) => void;
  onSelectionCancel?: () => void;
  onSelectionEnd?: (payload: {
    rect: SelectionRect;
    dragStart: SelectionPoint;
    dragEnd: SelectionPoint;
    additive: boolean;
  }) => void;
  selectionDragThresholdPx?: number;
}

const buildRect = (start: SelectionPoint, end: SelectionPoint): SelectionRect => ({
  left: Math.min(start.x, end.x),
  right: Math.max(start.x, end.x),
  top: Math.min(start.y, end.y),
  bottom: Math.max(start.y, end.y),
});

const exceedsThreshold = (start: SelectionPoint, end: SelectionPoint, threshold: number): boolean => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return Math.hypot(dx, dy) > threshold;
};

const isCanvasSurfaceTarget = (target: EventTarget | null): boolean => {
  if (!target || !(target instanceof HTMLElement)) return false;
  return target.classList.contains('canvas-content') || target.classList.contains('canvas');
};

const Canvas = React.forwardRef<HTMLDivElement, CanvasProps>(function Canvas(
  {
    children,
    onClickEmpty,
    onRightClick,
    onCameraChange,
    onCameraControlsReady,
    onPanStart,
    onPanEnd,
    initialCenter,
    onWheelPanActivity,
    onSelectionStart,
    onSelectionUpdate,
    onSelectionCancel,
    onSelectionEnd,
    selectionDragThresholdPx = 4,
  }: CanvasProps,
  forwardedRef
) {
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [isZooming, setIsZooming] = useState(false);
  const [isWheelPanning, setIsWheelPanning] = useState(false);
  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(null);
  const [canvasBounds, setCanvasBounds] = useState<{ left: number; top: number } | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const lastPos = useRef({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const initialCenterAppliedRef = useRef(false);
  const initialCenterRef = useRef<CanvasProps['initialCenter']>(initialCenter);
  const selectionStart = useRef<SelectionPoint | null>(null);
  const selectionActive = useRef(false);
  const ignoreClick = useRef(false);
  const dragListenersRef = useRef<{
    move: (event: globalThis.MouseEvent) => void;
    up: (event: globalThis.MouseEvent) => void;
  } | null>(null);
  const panListenersRef = useRef<{
    move: (event: globalThis.MouseEvent) => void;
    up: (event: globalThis.MouseEvent) => void;
    blur: () => void;
  } | null>(null);
  const panActiveRef = useRef(false);
  const zoomRef = useRef(zoom);
  const viewportRef = useRef(viewport);
  const onCameraChangeRef = useRef<CanvasProps['onCameraChange']>(onCameraChange);
  const pendingCameraRef = useRef<CanvasCameraState>({ pan, zoom, viewport });
  const cameraNotifyFrameRef = useRef<number | null>(null);
  const onWheelPanActivityRef = useRef<CanvasProps['onWheelPanActivity']>(onWheelPanActivity);
  const zoomTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelPanIdleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingWheelPanDeltaRef = useRef({ x: 0, y: 0 });
  const wheelPanFrameRef = useRef<number | null>(null);
  useEffect(() => {
    initialCenterRef.current = initialCenter;
  }, [initialCenter]);
  const setCanvasRef = useCallback(
    (node: HTMLDivElement | null) => {
      canvasRef.current = node;
      if (node) {
        const rect = node.getBoundingClientRect();
        const nextViewport = { width: rect.width, height: rect.height };
        setViewport(nextViewport);
        if (!initialCenterAppliedRef.current && nextViewport.width && nextViewport.height) {
          const nextInitial = initialCenterRef.current;
          if (nextInitial) {
            const resolved = typeof nextInitial === 'function' ? nextInitial(nextViewport) : nextInitial;
            setPan({
              x: nextViewport.width / 2 - resolved.x * zoomRef.current,
              y: nextViewport.height / 2 - resolved.y * zoomRef.current,
            });
            initialCenterAppliedRef.current = true;
          }
        }
      }
      if (!forwardedRef) return;
      if (typeof forwardedRef === 'function') {
        forwardedRef(node);
      } else {
        (forwardedRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }
    },
    [forwardedRef]
  );

  const setCameraCenter = useCallback((point: { x: number; y: number }) => {
    const currentZoom = zoomRef.current;
    const currentViewport = viewportRef.current;
    setPan({
      x: currentViewport.width / 2 - point.x * currentZoom,
      y: currentViewport.height / 2 - point.y * currentZoom,
    });
  }, []);

  const handlePanMove = useCallback((event: globalThis.MouseEvent) => {
    if (!panActiveRef.current) return;
    const dx = event.clientX - lastPos.current.x;
    const dy = event.clientY - lastPos.current.y;
    lastPos.current = { x: event.clientX, y: event.clientY };

    setPan((prev) => ({
      x: prev.x + dx * PAN_SPEED_MULTIPLIER,
      y: prev.y + dy * PAN_SPEED_MULTIPLIER,
    }));
  }, []);

  const stopPanning = useCallback(() => {
    if (!panActiveRef.current) return;
    panActiveRef.current = false;
    setIsPanning(false);
    onPanEnd?.();

    const listeners = panListenersRef.current;
    if (!listeners) return;
    document.removeEventListener('mousemove', listeners.move);
    document.removeEventListener('mouseup', listeners.up);
    window.removeEventListener('blur', listeners.blur);
    panListenersRef.current = null;
  }, [onPanEnd]);

  const startPanning = useCallback(
    (event: MouseEvent) => {
      if (panActiveRef.current) return;
      event.preventDefault();
      panActiveRef.current = true;
      setIsPanning(true);
      onPanStart?.();
      lastPos.current = { x: event.clientX, y: event.clientY };

      const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
        handlePanMove(moveEvent);
      };
      const handleMouseUp = () => {
        stopPanning();
      };
      const handleBlur = () => {
        stopPanning();
      };

      panListenersRef.current = { move: handleMouseMove, up: handleMouseUp, blur: handleBlur };
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('blur', handleBlur);
    },
    [handlePanMove, onPanStart, stopPanning]
  );

  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      // Pan with middle mouse or shift + right click
      if (e.button === 1 || (e.shiftKey && e.button === 2)) {
        startPanning(e);
        return;
      }

      if (e.button !== 0 || !isCanvasSurfaceTarget(e.target)) return;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
        setCanvasBounds({ left: rect.left, top: rect.top });
      }
      onSelectionStart?.();
      selectionStart.current = { x: e.clientX, y: e.clientY };
      selectionActive.current = false;

      const handleDragMove = (event: globalThis.MouseEvent) => {
        if (!selectionStart.current) return;
        const end = { x: event.clientX, y: event.clientY };
        if (!selectionActive.current) {
          if (!exceedsThreshold(selectionStart.current, end, selectionDragThresholdPx)) {
            return;
          }
          selectionActive.current = true;
        }

        const rect = buildRect(selectionStart.current, end);
        setSelectionRect(rect);
        onSelectionUpdate?.({ rect, dragStart: selectionStart.current, dragEnd: end });
      };

      const handleDragEnd = (event: globalThis.MouseEvent) => {
        document.removeEventListener('mousemove', handleDragMove);
        document.removeEventListener('mouseup', handleDragEnd);
        dragListenersRef.current = null;

        const start = selectionStart.current;
        selectionStart.current = null;

        if (!start) return;
        const end = { x: event.clientX, y: event.clientY };
        if (!selectionActive.current) {
          setSelectionRect(null);
          setCanvasBounds(null);
          onSelectionCancel?.();
          return;
        }

        selectionActive.current = false;
        setSelectionRect(null);
        setCanvasBounds(null);
        ignoreClick.current = true;
        setTimeout(() => {
          ignoreClick.current = false;
        }, 0);
        const rect = buildRect(start, end);
        onSelectionEnd?.({
          rect,
          dragStart: start,
          dragEnd: end,
          additive: event.metaKey || event.ctrlKey,
        });
      };

      dragListenersRef.current = { move: handleDragMove, up: handleDragEnd };
      document.addEventListener('mousemove', handleDragMove);
      document.addEventListener('mouseup', handleDragEnd);
    },
    [
      onSelectionCancel,
      onSelectionEnd,
      onSelectionStart,
      onSelectionUpdate,
      selectionDragThresholdPx,
      startPanning,
    ]
  );

  const handleMouseUp = useCallback(() => {
    stopPanning();
  }, [stopPanning]);

  const getWorldPosition = useCallback(
    (e: MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (e.clientX - rect.left - pan.x) / zoom,
        y: (e.clientY - rect.top - pan.y) / zoom,
      };
    },
    [pan.x, pan.y, zoom]
  );

  const getTargetFromEvent = useCallback((e: MouseEvent): SelectedEntityRef | null => {
    const target = (e.target as HTMLElement | null)?.closest('[data-entity-type]');
    if (!target) return null;
    const type = target.getAttribute('data-entity-type') as SelectedEntityRef['type'] | null;
    const id = target.getAttribute('data-entity-id');
    if (!type || !id) return null;
    return { id, type };
  }, []);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const applyZoom = (
      e: globalThis.WheelEvent,
      deltaAxis: number,
      zoomInFactor: number,
      zoomOutFactor: number
    ) => {
      setIsZooming(true);
      if (zoomTimeoutRef.current) {
        clearTimeout(zoomTimeoutRef.current);
      }
      zoomTimeoutRef.current = setTimeout(() => {
        setIsZooming(false);
      }, 150);

      const delta = deltaAxis > 0 ? zoomOutFactor : zoomInFactor;
      setZoom((prevZoom) => {
        const newZoom = Math.min(Math.max(prevZoom * delta, MIN_ZOOM), MAX_ZOOM);

        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const zoomRatio = newZoom / prevZoom;
        setPan((prevPan) => ({
          x: mouseX - (mouseX - prevPan.x) * zoomRatio,
          y: mouseY - (mouseY - prevPan.y) * zoomRatio,
        }));

        return newZoom;
      });
    };

    const handleWheel = (e: globalThis.WheelEvent) => {
      const deltaX = e.deltaX;
      const deltaY = e.deltaY;
      const deltaAxis = deltaY !== 0 ? deltaY : deltaX;
      if (deltaAxis === 0) return;

      const target = e.target as HTMLElement | null;
      const windowedRoot = target?.closest('.windowed-building');
      const windowedActive = windowedRoot && !windowedRoot.classList.contains('pass-through');

      if (windowedActive) {
        return;
      }

      e.preventDefault();
      e.stopImmediatePropagation();
      const absDeltaX = Math.abs(deltaX);
      const absDeltaY = Math.abs(deltaY);
      const isPinchZoom = e.ctrlKey;

      if (isPinchZoom) {
        applyZoom(e, deltaAxis, PINCH_ZOOM_IN_FACTOR, PINCH_ZOOM_OUT_FACTOR);
        return;
      }

      const isMouseWheel = absDeltaY > TRACKPAD_PAN_THRESHOLD && absDeltaX === 0;
      const isTrackpadPan = absDeltaX > 0 && absDeltaY < TRACKPAD_PAN_THRESHOLD;

      if (isTrackpadPan) {
        setIsWheelPanning(true);
        if (wheelPanIdleTimeoutRef.current) {
          clearTimeout(wheelPanIdleTimeoutRef.current);
        }
        wheelPanIdleTimeoutRef.current = setTimeout(() => {
          setIsWheelPanning(false);
          wheelPanIdleTimeoutRef.current = null;
        }, WHEEL_PAN_IDLE_MS);

        pendingWheelPanDeltaRef.current = {
          x: pendingWheelPanDeltaRef.current.x - deltaX * PAN_SPEED_MULTIPLIER,
          y: pendingWheelPanDeltaRef.current.y - deltaY * PAN_SPEED_MULTIPLIER,
        };

        if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
          const pending = pendingWheelPanDeltaRef.current;
          pendingWheelPanDeltaRef.current = { x: 0, y: 0 };
          setPan((prev) => ({
            x: prev.x + pending.x,
            y: prev.y + pending.y,
          }));
          onWheelPanActivityRef.current?.();
          return;
        }

        if (wheelPanFrameRef.current === null) {
          onWheelPanActivityRef.current?.();
          wheelPanFrameRef.current = window.requestAnimationFrame(() => {
            wheelPanFrameRef.current = null;
            const pending = pendingWheelPanDeltaRef.current;
            pendingWheelPanDeltaRef.current = { x: 0, y: 0 };
            if (pending.x === 0 && pending.y === 0) return;
            setPan((prev) => ({
              x: prev.x + pending.x,
              y: prev.y + pending.y,
            }));
          });
        }
        return;
      }

      if (!isMouseWheel) return;

      applyZoom(e, deltaAxis, MOUSE_ZOOM_IN_FACTOR, MOUSE_ZOOM_OUT_FACTOR);
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false, capture: true });

    return () => {
      canvas.removeEventListener('wheel', handleWheel, { capture: true });
    };
  }, []);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const updateViewport = () => {
      const rect = canvas.getBoundingClientRect();
      setViewport((prev) =>
        prev.width === rect.width && prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height }
      );
    };

    updateViewport();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => updateViewport());
      observer.observe(canvas);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, []);

  React.useEffect(() => {
    onCameraChangeRef.current = onCameraChange;
  }, [onCameraChange]);

  React.useEffect(() => {
    pendingCameraRef.current = { pan, zoom, viewport };
    if (!onCameraChangeRef.current) return;
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      onCameraChangeRef.current(pendingCameraRef.current);
      return;
    }
    if (cameraNotifyFrameRef.current !== null) return;
    cameraNotifyFrameRef.current = window.requestAnimationFrame(() => {
      cameraNotifyFrameRef.current = null;
      onCameraChangeRef.current?.(pendingCameraRef.current);
    });
  }, [pan, zoom, viewport]);

  React.useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  React.useEffect(() => {
    onWheelPanActivityRef.current = onWheelPanActivity;
  }, [onWheelPanActivity]);

  React.useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  React.useEffect(() => {
    onCameraControlsReady?.({ setCameraCenter });
  }, [onCameraControlsReady, setCameraCenter]);

  React.useEffect(() => {
    return () => {
      const handlers = dragListenersRef.current;
      if (!handlers) return;
      document.removeEventListener('mousemove', handlers.move);
      document.removeEventListener('mouseup', handlers.up);
      dragListenersRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    return () => {
      if (panActiveRef.current) {
        onPanEnd?.();
      }
      const handlers = panListenersRef.current;
      if (!handlers) return;
      document.removeEventListener('mousemove', handlers.move);
      document.removeEventListener('mouseup', handlers.up);
      window.removeEventListener('blur', handlers.blur);
      panListenersRef.current = null;
      panActiveRef.current = false;
    };
  }, [onPanEnd]);

  React.useEffect(() => {
    return () => {
      if (zoomTimeoutRef.current) {
        clearTimeout(zoomTimeoutRef.current);
      }
      if (wheelPanIdleTimeoutRef.current) {
        clearTimeout(wheelPanIdleTimeoutRef.current);
        wheelPanIdleTimeoutRef.current = null;
      }
      setIsWheelPanning(false);
      if (cameraNotifyFrameRef.current !== null) {
        window.cancelAnimationFrame(cameraNotifyFrameRef.current);
      }
      if (wheelPanFrameRef.current !== null) {
        window.cancelAnimationFrame(wheelPanFrameRef.current);
        wheelPanFrameRef.current = null;
      }
      pendingWheelPanDeltaRef.current = { x: 0, y: 0 };
    };
  }, []);

  const handleCanvasClick = useCallback(
    (e: MouseEvent) => {
      if (ignoreClick.current) {
        ignoreClick.current = false;
        return;
      }
      if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('canvas-content')) {
        onClickEmpty();
      }
    },
    [onClickEmpty]
  );
  const canvasTransform = useMemo(() => ({ zoom }), [zoom]);

  return (
    <div
      ref={setCanvasRef}
      className={`canvas ${isPanning ? 'panning' : ''}`}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onContextMenu={(e) => {
        if (isPanning || e.shiftKey) {
          e.preventDefault();
          return;
        }
        if (onRightClick) {
          e.preventDefault();
          onRightClick(getWorldPosition(e), getTargetFromEvent(e));
        }
      }}
      onClick={handleCanvasClick}
      data-testid="workspace-canvas"
    >
      <div
        className={`canvas-content${isZooming || isPanning || isWheelPanning ? ' zooming' : ''}`}
        style={{
          transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
          transformOrigin: '0 0',
        }}
      >
        <CanvasTransformContext.Provider value={canvasTransform}>{children}</CanvasTransformContext.Provider>
      </div>

      {selectionRect && canvasBounds && (
        <div
          className="selection-rect"
          style={{
            left: selectionRect.left - canvasBounds.left,
            top: selectionRect.top - canvasBounds.top,
            width: selectionRect.right - selectionRect.left,
            height: selectionRect.bottom - selectionRect.top,
          }}
        />
      )}

      <div className="canvas-controls">
        <button onClick={() => setZoom((z) => Math.min(z * CLICK_ZOOM_IN_FACTOR, MAX_ZOOM))}>+</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom((z) => Math.max(z * CLICK_ZOOM_OUT_FACTOR, MIN_ZOOM))}>−</button>
        <button
          onClick={() => {
            setPan({ x: 0, y: 0 });
            setZoom(1);
          }}
        >
          ⟲
        </button>
      </div>
    </div>
  );
});

export default Canvas;
