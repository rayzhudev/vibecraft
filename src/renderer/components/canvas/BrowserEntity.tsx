import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { BrowserPanel } from '../../../shared/types';
import { BROWSER_SESSION_PARTITION } from '../../../shared/browserDefaults';
import { usePanel } from '../../hooks/usePanel';
import { useViewportActivation } from './hooks/useViewportActivation';
import WindowedBuildingEntity from './WindowedBuildingEntity';
import { entityIcons } from '../../assets/icons';

interface BrowserEntityProps {
  panel: BrowserPanel;
  selected: boolean;
  previewed?: boolean;
  zIndex?: number;
  dragSelecting?: boolean;
  onSelect: () => void;
  onMove: (x: number, y: number) => void;
  onMoveEnd?: (x: number, y: number) => void;
  onUrlChange?: (url: string) => void;
  onFaviconChange?: (faviconUrl?: string | null) => void;
  onClose?: () => void;
  onResize?: (width: number, height: number) => void;
  onResizeEnd?: (width: number, height: number) => void;
  onBringToFront?: () => void;
  onRefreshHandled?: (id: string) => void;
  onTutorialMessage?: (payload: { panelId: string; url: string; message: string }) => void;
  forcedBounds?: { x: number; y: number; width: number; height: number };
  lockedToLayout?: boolean;
}

type WebviewElement = Electron.WebviewTag;

function BrowserEntity({
  panel,
  selected,
  previewed = false,
  zIndex = 1000,
  dragSelecting = false,
  onSelect,
  onMove,
  onMoveEnd,
  onUrlChange,
  onFaviconChange,
  onClose,
  onResize,
  onResizeEnd,
  onBringToFront,
  onRefreshHandled,
  onTutorialMessage,
  forcedBounds,
  lockedToLayout = false,
}: BrowserEntityProps) {
  const [minimized, setMinimized] = useState(false);
  const [urlInput, setUrlInput] = useState(panel.url);
  const [currentUrl, setCurrentUrl] = useState(panel.url);
  const [faviconFailed, setFaviconFailed] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const webviewRef = useRef<WebviewElement | null>(null);
  const currentUrlRef = useRef(panel.url);
  const activateWebview = useViewportActivation(panelRef, {
    rootMargin: '120px',
    onceVisible: true,
  });

  const {
    position,
    isDragging,
    startDrag: baseStartDrag,
    size: currentSize,
    startResize,
    isResizing,
    bringToFront,
  } = usePanel({
    x: panel.x,
    y: panel.y,
    width: panel.width,
    height: panel.height,
    minWidth: 400,
    minHeight: 300,
    onMove,
    onMoveEnd,
    onResize,
    onResizeEnd,
    onBringToFront,
  });

  // Custom drag handler that also calls onSelect
  const startDrag = (e: React.MouseEvent) => {
    if (lockedToLayout) {
      e.preventDefault();
      e.stopPropagation();
      onSelect();
      bringToFront();
      return;
    }
    if (e.button !== 0) return;

    const target = e.target as HTMLElement;
    if (
      target.closest('.browser-controls') ||
      target.closest('.browser-url-bar') ||
      target.closest('.browser-close-btn')
    ) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    onSelect();
    baseStartDrag(e);
  };

  useEffect(() => {
    currentUrlRef.current = panel.url;
    setUrlInput(panel.url);
    setCurrentUrl(panel.url);
  }, [panel.url]);

  useEffect(() => {
    setFaviconFailed(false);
  }, [panel.faviconUrl]);

  useEffect(() => {
    if (!activateWebview || minimized || !panel.refreshToken) return;
    const webview = webviewRef.current;
    if (webview?.reload) {
      webview.reload();
    }
    onRefreshHandled?.(panel.id);
  }, [activateWebview, minimized, onRefreshHandled, panel.id, panel.refreshToken]);

  useEffect(() => {
    if (!activateWebview || minimized) return;
    const webview = webviewRef.current;
    if (!webview || !onTutorialMessage) return;

    const handleConsoleMessage = (event: Electron.ConsoleMessageEvent) => {
      if (typeof event.message !== 'string') return;
      if (!event.message.includes('tutorial:doodle-jump:')) return;
      onTutorialMessage({ panelId: panel.id, url: panel.url, message: event.message });
    };

    webview.addEventListener('console-message', handleConsoleMessage);
    return () => {
      webview.removeEventListener('console-message', handleConsoleMessage);
    };
  }, [activateWebview, minimized, onTutorialMessage, panel.id, panel.url]);

  // Handle webview ready state
  useEffect(() => {
    if (!activateWebview || minimized) return;
    const webview = webviewRef.current;
    if (!webview) return;

    // Ensure allowpopups attribute is set as a string to avoid React boolean warning
    try {
      webview.setAttribute('allowpopups', 'true');
    } catch {
      /* noop */
    }

    const handleDidFailLoad = (event: Event) => {
      const errorCode = (event as { errorCode?: number }).errorCode;
      if (errorCode !== -3) {
        console.error('Webview load error:', event);
      }
    };

    webview.addEventListener('did-fail-load', handleDidFailLoad);

    return () => {
      webview.removeEventListener('did-fail-load', handleDidFailLoad);
    };
  }, [activateWebview, minimized]);

  useEffect(() => {
    if (!activateWebview || minimized) return;
    const webview = webviewRef.current;
    if (!webview) return;

    const handleFaviconUpdated = (event: Event) => {
      const favicons = (event as { favicons?: string[] }).favicons ?? [];
      const nextFavicon = favicons[0];
      onFaviconChange?.(nextFavicon);
    };

    webview.addEventListener('page-favicon-updated', handleFaviconUpdated);

    return () => {
      webview.removeEventListener('page-favicon-updated', handleFaviconUpdated);
    };
  }, [activateWebview, minimized, onFaviconChange]);

  const getHostname = (url: string) => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  };

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let finalUrl = urlInput.trim();

    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
      finalUrl = 'https://' + finalUrl;
    }

    setUrlInput(finalUrl);
    setCurrentUrl(finalUrl);
    currentUrlRef.current = finalUrl;
    onUrlChange?.(finalUrl);
  };

  const handleRefresh = () => {
    const webview = webviewRef.current;
    if (webview?.reload) {
      webview.reload();
    }
  };

  const handleGoBack = () => {
    const webview = webviewRef.current;
    if (webview?.goBack) {
      webview.goBack();
    }
  };

  const handleGoForward = () => {
    const webview = webviewRef.current;
    if (webview?.goForward) {
      webview.goForward();
    }
  };

  const handleClose = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onClose?.();
  };

  // Minimized: just show header (40px)
  // Expanded: show full panel at stored size
  const panelHeight = minimized ? 40 : currentSize.height;

  const handleSelect = useCallback(() => {
    onSelect();
    bringToFront();
  }, [onSelect, bringToFront]);

  useEffect(() => {
    if (!activateWebview || minimized) return;
    const webview = webviewRef.current;
    if (!webview) return;

    const handleFocus = () => {
      handleSelect();
    };

    webview.addEventListener('focus', handleFocus);

    return () => {
      webview.removeEventListener('focus', handleFocus);
    };
  }, [activateWebview, handleSelect, minimized]);

  const showPreview = previewed && !selected;
  const showSelectionShield = dragSelecting;
  const faviconSrc = !faviconFailed && panel.faviconUrl ? panel.faviconUrl : entityIcons.browser;
  const webviewSessionProps = { partition: BROWSER_SESSION_PARTITION };
  const effectiveBounds = forcedBounds
    ? forcedBounds
    : {
        x: position.x,
        y: position.y,
        width: currentSize.width,
        height: panelHeight,
      };

  return (
    <WindowedBuildingEntity
      entityType="browser"
      entityId={panel.id}
      entityName={panel.url}
      selected={selected}
      onSelect={handleSelect}
      entityZIndex={zIndex}
      className={`browser-entity-wrapper ${showPreview ? 'previewed' : ''} ${isResizing ? 'resizing' : ''} ${isDragging ? 'dragging' : ''}`}
      style={{
        position: 'absolute',
        left: effectiveBounds.x,
        top: effectiveBounds.y,
        width: effectiveBounds.width,
        height: effectiveBounds.height,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: 'rgba(0,0,0,0.85)',
        borderRadius: 6,
        boxShadow: selected
          ? '0 0 20px rgba(124, 92, 255, 0.45)'
          : showPreview
            ? '0 0 18px rgba(50, 205, 50, 0.35)'
            : '0 2px 8px rgba(0,0,0,0.5)',
        outline: selected
          ? '2px solid rgba(124, 92, 255, 0.8)'
          : showPreview
            ? '2px solid rgba(50,205,50,0.85)'
            : '2px solid rgba(50,205,50,0.6)',
        zIndex: zIndex,
        cursor: isDragging ? 'grabbing' : 'default',
      }}
      testId="entity-browser"
      elementRef={panelRef}
    >
      {/* Header - fixed 40px */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 8px',
          height: 40,
          minHeight: 40,
          maxHeight: 40,
          background: 'rgba(30,30,30,0.95)',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          cursor: isDragging ? 'grabbing' : 'move',
        }}
        onMouseDown={startDrag}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
          <img
            src={faviconSrc}
            alt=""
            aria-hidden="true"
            referrerPolicy="no-referrer"
            onError={() => setFaviconFailed(true)}
            style={{ width: 16, height: 16, borderRadius: 3, flexShrink: 0 }}
          />
          <span
            style={{
              fontSize: 13,
              color: '#e0e0e0',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {getHostname(panel.url)}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMinimized(!minimized);
            }}
            style={{
              width: 24,
              height: 24,
              background: 'transparent',
              border: 'none',
              color: '#888',
              cursor: 'pointer',
              fontSize: 14,
            }}
            title={minimized ? 'Expand' : 'Minimize'}
          >
            {minimized ? '▼' : '—'}
          </button>
          <button
            onClick={handleClose}
            style={{
              width: 24,
              height: 24,
              background: 'transparent',
              border: 'none',
              color: '#888',
              cursor: 'pointer',
              fontSize: 14,
            }}
            title="Close"
          >
            ✕
          </button>
        </div>
      </div>

      {!minimized && (
        <>
          {/* Toolbar - fixed 36px */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 8px',
              height: 36,
              minHeight: 36,
              maxHeight: 36,
              background: 'rgba(25,25,25,0.95)',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <button
              onClick={handleGoBack}
              style={{
                width: 28,
                height: 24,
                background: 'rgba(255,255,255,0.1)',
                border: 'none',
                color: '#ccc',
                cursor: 'pointer',
                borderRadius: 3,
              }}
              title="Back"
            >
              ←
            </button>
            <button
              onClick={handleGoForward}
              style={{
                width: 28,
                height: 24,
                background: 'rgba(255,255,255,0.1)',
                border: 'none',
                color: '#ccc',
                cursor: 'pointer',
                borderRadius: 3,
              }}
              title="Forward"
            >
              →
            </button>
            <button
              onClick={handleRefresh}
              style={{
                width: 28,
                height: 24,
                background: 'rgba(255,255,255,0.1)',
                border: 'none',
                color: '#ccc',
                cursor: 'pointer',
                borderRadius: 3,
              }}
              title="Refresh"
            >
              ↻
            </button>
            <form onSubmit={handleUrlSubmit} style={{ flex: 1, display: 'flex', gap: 4 }}>
              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                placeholder="Enter URL..."
                style={{
                  flex: 1,
                  padding: '4px 8px',
                  background: 'rgba(0,0,0,0.5)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: 3,
                  color: '#fff',
                  fontSize: 12,
                }}
              />
              <button
                type="submit"
                style={{
                  width: 28,
                  height: 24,
                  background: 'rgba(100,100,255,0.3)',
                  border: 'none',
                  color: '#fff',
                  cursor: 'pointer',
                  borderRadius: 3,
                }}
                title="Go"
              >
                →
              </button>
            </form>
          </div>

          {/* Webview - flex: 1 fills remaining space */}
          {activateWebview ? (
            <webview
              {...webviewSessionProps}
              ref={webviewRef as React.RefObject<WebviewElement>}
              src={currentUrl}
              style={{
                flex: 1,
                border: 'none',
                width: '100%',
                height: '100%',
              }}
            />
          ) : (
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#0c0f16',
                color: '#cfd8ea',
                fontSize: 12,
                letterSpacing: '0.01em',
              }}
            >
              Activates when nearby
            </div>
          )}

          {/* Resize handle */}
          {!lockedToLayout && (
            <div
              onMouseDown={startResize}
              title="Resize"
              style={{
                position: 'absolute',
                bottom: 0,
                right: 0,
                width: 16,
                height: 16,
                cursor: 'se-resize',
                background: 'linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.3) 50%)',
              }}
            />
          )}
        </>
      )}
      {showSelectionShield && (
        <div className="windowed-selection-shield" data-testid="windowed-selection-shield" aria-hidden />
      )}
    </WindowedBuildingEntity>
  );
}

const areBrowserEntityPropsEqual = (previous: BrowserEntityProps, next: BrowserEntityProps): boolean =>
  previous.panel === next.panel &&
  previous.selected === next.selected &&
  previous.previewed === next.previewed &&
  previous.zIndex === next.zIndex &&
  previous.dragSelecting === next.dragSelecting &&
  previous.onTutorialMessage === next.onTutorialMessage &&
  previous.forcedBounds?.x === next.forcedBounds?.x &&
  previous.forcedBounds?.y === next.forcedBounds?.y &&
  previous.forcedBounds?.width === next.forcedBounds?.width &&
  previous.forcedBounds?.height === next.forcedBounds?.height &&
  previous.lockedToLayout === next.lockedToLayout;

export default React.memo(BrowserEntity, areBrowserEntityPropsEqual);
