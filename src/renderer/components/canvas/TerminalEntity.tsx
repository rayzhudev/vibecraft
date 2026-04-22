import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as XtermTerminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { usePanel } from '../../hooks/usePanel';
import { useXtermMouseScaleFix } from '../../hooks/useXtermMouseScaleFix';
import { useTheme } from '../../theme/themeContext';
import WindowedBuildingEntity from './WindowedBuildingEntity';
import { useViewportActivation } from './hooks/useViewportActivation';
import { DEFAULT_TERMINAL_SIZE } from '../../../shared/terminalDefaults';

const PROCESS_TITLE_THRESHOLD_MS = 150;
const IGNORED_PROCESSES = new Set([
  'bash',
  'zsh',
  'fish',
  'sh',
  'pwsh',
  'pwsh.exe',
  'powershell',
  'powershell.exe',
  'cmd',
  'cmd.exe',
]);

interface TerminalEntityProps {
  terminalId: string;
  workspacePath: string;
  originName: string;
  startPath: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  zIndex?: number;
  selected?: boolean;
  previewed?: boolean;
  dragSelecting?: boolean;
  onClose: () => void;
  onSelect?: () => void;
  onMove?: (x: number, y: number) => void;
  onMoveEnd?: (x: number, y: number) => void;
  onResize?: (width: number, height: number) => void;
  onResizeEnd?: (width: number, height: number) => void;
  onBringToFront?: () => void;
  onProcessChange?: (processLabel: string | null) => void;
  forcedBounds?: { x: number; y: number; width: number; height: number };
  lockedToLayout?: boolean;
}

function TerminalEntity({
  terminalId,
  workspacePath,
  originName,
  startPath,
  x,
  y,
  width,
  height,
  zIndex = 2000,
  selected = false,
  previewed = false,
  dragSelecting = false,
  onClose,
  onSelect,
  onMove,
  onMoveEnd,
  onResize,
  onResizeEnd,
  onBringToFront,
  onProcessChange,
  forcedBounds,
  lockedToLayout = false,
}: TerminalEntityProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XtermTerminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const sessionClosedRef = useRef(false);
  const sessionStartedRef = useRef(false);
  const sessionRestartingRef = useRef(false);
  const sessionReadyRef = useRef(false);
  const sessionTokenRef = useRef<string | null>(null);
  const pendingSessionTokenRef = useRef<string | null>(null);
  const allowedSessionTokenRef = useRef<string | null>(null);
  const startPathRef = useRef(startPath || '.');
  const currentPathRef = useRef(startPathRef.current);
  const commandHookActiveRef = useRef(false);
  const processChangeSupportedRef = useRef(false);
  const runningProcessRef = useRef<string | null>(null);
  const processTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingProcessRef = useRef<string | null>(null);
  const [currentPath, setCurrentPath] = useState(startPathRef.current);
  const [currentProcess, setCurrentProcess] = useState<string | null>(null);
  const [commandLabel, setCommandLabel] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [exitInfo, setExitInfo] = useState<{ exitCode: number; signal?: number } | null>(null);
  const [sessionStatus, setSessionStatus] = useState<
    'starting' | 'ready' | 'closed' | 'error' | 'restarting'
  >('starting');
  const { activeTheme } = useTheme();
  const monoFont = activeTheme.foundation.typography.mono;
  useXtermMouseScaleFix(termRef, isReady);
  const showSelectionShield = dragSelecting;

  const clearCommandLabel = useCallback(() => {
    setCommandLabel(null);
  }, []);

  const clearProcessState = useCallback(() => {
    if (processTimerRef.current) {
      clearTimeout(processTimerRef.current);
      processTimerRef.current = null;
    }
    pendingProcessRef.current = null;
    setCurrentProcess(null);
  }, []);

  const resetTitleState = useCallback(() => {
    clearCommandLabel();
    clearProcessState();
    runningProcessRef.current = null;
  }, [clearCommandLabel, clearProcessState]);

  const markSessionClosed = useCallback(
    (reason: string) => {
      if (sessionClosedRef.current) return;
      sessionClosedRef.current = true;
      sessionReadyRef.current = false;
      setExitInfo({ exitCode: 1 });
      setSessionStatus('closed');
      resetTitleState();
      try {
        termRef.current?.write(`\r\n[terminal disconnected - ${reason}]`);
      } catch {
        /* noop */
      }
    },
    [resetTitleState]
  );

  const createSessionToken = useCallback(
    () => `terminal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    []
  );

  const startSession = useCallback(
    async (relativePath: string, pendingInput?: string, reuseIfRunning = false): Promise<boolean> => {
      if (!termRef.current) return false;
      const sessionToken = createSessionToken();
      pendingSessionTokenRef.current = sessionToken;
      allowedSessionTokenRef.current = reuseIfRunning ? sessionTokenRef.current : null;
      const term = termRef.current;
      try {
        const response = await window.electronAPI.startTerminalSession({
          terminalId,
          workspacePath,
          relativePath,
          cols: term.cols,
          rows: term.rows,
          sessionToken,
          reuseIfRunning,
        });
        if (response && response.success === false) {
          const msg = response.error || 'Failed to start terminal';
          try {
            term.write(`\r\n${msg}\r\n`);
          } catch {
            /* noop */
          }
          pendingSessionTokenRef.current = null;
          allowedSessionTokenRef.current = null;
          return false;
        }
        sessionClosedRef.current = false;
        sessionReadyRef.current = true;
        sessionTokenRef.current = response?.sessionToken || sessionToken;
        pendingSessionTokenRef.current = null;
        allowedSessionTokenRef.current = null;
        setExitInfo(null);
        setSessionStatus('ready');
        if (pendingInput) {
          setTimeout(() => {
            void window.electronAPI.sendTerminalInput(terminalId, pendingInput);
          }, 50);
        }
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        try {
          term.write(`\r\n${msg}\r\n`);
        } catch {
          /* noop */
        }
        pendingSessionTokenRef.current = null;
        allowedSessionTokenRef.current = null;
        return false;
      }
    },
    [createSessionToken, terminalId, workspacePath]
  );

  const isCurrentSession = useCallback((token?: string) => {
    if (pendingSessionTokenRef.current) {
      return token === pendingSessionTokenRef.current || token === allowedSessionTokenRef.current;
    }
    const current = sessionTokenRef.current;
    if (!current) return false;
    return token === current;
  }, []);

  const {
    position,
    isDragging,
    startDrag,
    size: panelSize,
    startResize: handleResizeStart,
    isResizing: isPanelResizing,
    bringToFront,
  } = usePanel({
    x,
    y,
    width: width ?? DEFAULT_TERMINAL_SIZE.width,
    height: height ?? DEFAULT_TERMINAL_SIZE.height,
    minWidth: 420,
    minHeight: 300,
    onMove,
    onMoveEnd,
    onResize,
    onResizeEnd,
    onBringToFront,
  });

  const activateTerminal = useViewportActivation(panelRef, {
    rootMargin: '120px',
    onceVisible: true,
  });
  const effectiveBounds = forcedBounds
    ? forcedBounds
    : {
        x: position.x,
        y: position.y,
        width: panelSize.width,
        height: panelSize.height,
      };

  const syncTerminalGeometry = useCallback(() => {
    if (!isReady || !termRef.current || !fitAddonRef.current) {
      return;
    }
    try {
      fitAddonRef.current.fit();
      void window.electronAPI.resizeTerminal(terminalId, termRef.current.cols, termRef.current.rows);
    } catch {
      /* noop */
    }
  }, [isReady, terminalId]);

  const scheduleFit = useCallback(() => {
    if (!isReady) {
      return;
    }
    if (resizeFrameRef.current) {
      cancelAnimationFrame(resizeFrameRef.current);
    }
    resizeFrameRef.current = requestAnimationFrame(() => {
      resizeFrameRef.current = null;
      syncTerminalGeometry();
    });
  }, [syncTerminalGeometry, isReady]);

  useEffect(() => {
    const disableInput = sessionStatus !== 'ready';
    const terminal = termRef.current;
    if (!terminal) return;
    try {
      terminal.options.disableStdin = disableInput;
    } catch {
      /* noop */
    }
  }, [sessionStatus, isReady]);

  const restartSession = useCallback(
    async (pendingInput?: string) => {
      if (sessionRestartingRef.current) return;
      if (!termRef.current) return;
      sessionRestartingRef.current = true;
      sessionReadyRef.current = false;
      setSessionStatus('restarting');
      commandHookActiveRef.current = false;
      processChangeSupportedRef.current = false;
      runningProcessRef.current = null;
      try {
        const startPath = startPathRef.current || '.';
        const ok = await startSession(startPath, pendingInput, false);
        if (!ok) {
          const fallbackOk = await startSession('.', pendingInput, false);
          if (fallbackOk) {
            startPathRef.current = '.';
            setCurrentPath('.');
            void window.electronAPI.updateTerminal(workspacePath, terminalId, { lastKnownCwd: '.' });
            return;
          }
          setSessionStatus('error');
          sessionClosedRef.current = true;
          sessionTokenRef.current = null;
          pendingSessionTokenRef.current = null;
          allowedSessionTokenRef.current = null;
        }
      } finally {
        sessionRestartingRef.current = false;
      }
    },
    [startSession, terminalId, workspacePath]
  );

  useEffect(() => {
    if (isPanelResizing) {
      scheduleFit();
    }
  }, [panelSize, isPanelResizing, scheduleFit]);

  useEffect(() => {
    if (!lockedToLayout) return;
    scheduleFit();
  }, [effectiveBounds.width, effectiveBounds.height, lockedToLayout, scheduleFit]);

  useEffect(() => {
    return () => {
      if (resizeFrameRef.current) {
        cancelAnimationFrame(resizeFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (isReady) {
      scheduleFit();
    }
  }, [isReady, scheduleFit, panelSize.width, panelSize.height]);

  useEffect(() => {
    if (!activateTerminal) return;

    sessionClosedRef.current = false;
    sessionStartedRef.current = false;
    sessionReadyRef.current = false;
    sessionTokenRef.current = null;
    pendingSessionTokenRef.current = null;
    allowedSessionTokenRef.current = null;
    commandHookActiveRef.current = false;
    processChangeSupportedRef.current = false;
    runningProcessRef.current = null;
    setSessionStatus('starting');
    setExitInfo(null);
    resetTitleState();
    if (termRef.current) {
      try {
        termRef.current.dispose();
      } catch {
        /* noop */
      }
      termRef.current = null;
    }
    fitAddonRef.current = null;
    setIsReady(false);

    const initTimer = requestAnimationFrame(() => {
      if (!containerRef.current || termRef.current) return;

      const term = new XtermTerminal({
        convertEol: true,
        disableStdin: false,
        fontFamily: monoFont,
        scrollback: 2000,
        allowTransparency: true,
        cursorBlink: true,
        lineHeight: 1.1,
        theme: {
          background: '#121212',
          foreground: '#f2f2f2',
          cursor: '#f2f2f2',
          cursorAccent: '#000000',
          selectionBackground: 'rgba(242,242,242,0.18)',
          black: '#000000',
          red: '#ff5f56',
          green: '#5af78e',
          yellow: '#f3f99d',
          blue: '#57c7ff',
          magenta: '#ff6ac1',
          cyan: '#9aedfe',
          white: '#f1f1f1',
          brightBlack: '#686868',
          brightRed: '#ff5f56',
          brightGreen: '#5af78e',
          brightYellow: '#f3f99d',
          brightBlue: '#57c7ff',
          brightMagenta: '#ff6ac1',
          brightCyan: '#9aedfe',
          brightWhite: '#ffffff',
        },
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      termRef.current = term;
      fitAddonRef.current = fitAddon;

      term.open(containerRef.current);
      try {
        term.options.disableStdin = true;
      } catch {
        /* noop */
      }
      try {
        fitAddon.fit();
      } catch {
        /* noop */
      }

      setIsReady(true);
    });

    return () => {
      cancelAnimationFrame(initTimer);
    };
  }, [activateTerminal, terminalId, monoFont, resetTitleState]);

  useEffect(() => {
    if (!isReady || !termRef.current) return;
    const startPath = startPathRef.current || '.';
    const term = termRef.current;
    if (!sessionStartedRef.current) {
      sessionStartedRef.current = true;
      setSessionStatus('starting');
      sessionReadyRef.current = false;
      (async () => {
        try {
          const historyResult = await window.electronAPI.getTerminalHistory(workspacePath, terminalId);
          if (historyResult.success && historyResult.history) {
            try {
              term.write(historyResult.history);
            } catch {
              /* noop */
            }
          }
        } catch {
          /* noop */
        }

        try {
          const ok = await startSession(startPath, undefined, true);
          if (!ok) {
            const fallbackOk = await startSession('.', undefined, true);
            if (fallbackOk) {
              startPathRef.current = '.';
              setCurrentPath('.');
              void window.electronAPI.updateTerminal(workspacePath, terminalId, { lastKnownCwd: '.' });
              return;
            }
            sessionClosedRef.current = true;
            setExitInfo({ exitCode: 1 });
            setSessionStatus('error');
            sessionTokenRef.current = null;
            pendingSessionTokenRef.current = null;
            allowedSessionTokenRef.current = null;
          }
        } catch {
          sessionClosedRef.current = true;
          setExitInfo({ exitCode: 1 });
          setSessionStatus('error');
          sessionTokenRef.current = null;
          pendingSessionTokenRef.current = null;
          allowedSessionTokenRef.current = null;
        }
      })();
    }

    let inputCleanup: (() => void) | undefined;
    try {
      const disposable = term.onData((data) => {
        if (!sessionReadyRef.current) return;
        if (sessionClosedRef.current) {
          void restartSession(data);
          return;
        }
        void (async () => {
          try {
            const ok = await window.electronAPI.sendTerminalInput(terminalId, data);
            if (!ok) {
              markSessionClosed('session ended');
            }
          } catch {
            markSessionClosed('session ended');
          }
        })();
      });
      inputCleanup = () => disposable.dispose();
    } catch {
      /* noop */
    }

    const outputCleanup = window.electronAPI.onTerminalOutput((payload) => {
      if (!payload || payload.terminalId !== terminalId) return;
      if (!isCurrentSession(payload.sessionToken)) return;
      if (!sessionReadyRef.current && (sessionStatus === 'starting' || sessionStatus === 'restarting')) {
        sessionReadyRef.current = true;
        setSessionStatus('ready');
      }
      try {
        term.write(payload.data);
      } catch {
        /* noop */
      }
    });

    const exitCleanup = window.electronAPI.onTerminalExit((payload) => {
      if (!payload || payload.terminalId !== terminalId) return;
      if (!isCurrentSession(payload.sessionToken)) return;
      sessionClosedRef.current = true;
      sessionReadyRef.current = false;
      setExitInfo({ exitCode: payload.exitCode, signal: payload.signal });
      setSessionStatus('closed');
      resetTitleState();
      try {
        term.write(`\r\n[terminal closed - restart to continue]`);
      } catch {
        /* noop */
      }
    });

    const handleResize = () => {
      scheduleFit();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      outputCleanup();
      exitCleanup();
      inputCleanup?.();
      window.removeEventListener('resize', handleResize);
    };
  }, [
    isReady,
    terminalId,
    scheduleFit,
    workspacePath,
    restartSession,
    resetTitleState,
    startSession,
    isCurrentSession,
    sessionStatus,
    markSessionClosed,
  ]);

  useEffect(() => {
    return () => {
      try {
        termRef.current?.dispose();
      } catch {
        /* noop */
      }
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [terminalId]);

  useEffect(() => {
    startPathRef.current = startPath || '.';
    setCurrentPath(startPathRef.current);
  }, [startPath]);

  useEffect(() => {
    currentPathRef.current = currentPath;
  }, [currentPath]);

  useEffect(() => {
    return () => {
      resetTitleState();
    };
  }, [resetTitleState]);

  const deriveNameFromPath = useCallback((pathValue: string): string | null => {
    const sanitized = (pathValue || '').trim();
    if (!sanitized || sanitized === '.') return null;
    const segments = sanitized.split(/[/\\]+/).filter(Boolean);
    if (segments.length === 0) return sanitized;
    return segments[segments.length - 1] || sanitized;
  }, []);

  useEffect(() => {
    const cleanupCwd = window.electronAPI.onTerminalCwdChange((payload) => {
      if (!payload || payload.terminalId !== terminalId) return;
      if (!isCurrentSession(payload.sessionToken)) return;
      const nextRelative =
        payload.relativePath && payload.relativePath.trim() ? payload.relativePath.trim() : null;
      const nextDisplay =
        payload.path && payload.path.trim() ? payload.path.trim() : (nextRelative ?? currentPathRef.current);

      if (nextRelative) {
        setCurrentPath(nextRelative);
        startPathRef.current = nextRelative;
        void window.electronAPI.updateTerminal(workspacePath, terminalId, { lastKnownCwd: nextRelative });
      } else if (nextDisplay) {
        setCurrentPath(nextDisplay);
      }
    });

    const cleanupProcess = window.electronAPI.onTerminalProcessChange((payload) => {
      if (!payload || payload.terminalId !== terminalId) return;
      if (!isCurrentSession(payload.sessionToken)) return;
      processChangeSupportedRef.current = true;
      const name = (payload.processName || '').trim();
      const normalized = name.toLowerCase();
      if (!name || IGNORED_PROCESSES.has(normalized)) {
        runningProcessRef.current = null;
        clearProcessState();
        return;
      }
      runningProcessRef.current = name;
      if (commandHookActiveRef.current) return;
      if (processTimerRef.current) {
        clearTimeout(processTimerRef.current);
        processTimerRef.current = null;
      }
      pendingProcessRef.current = name;
      processTimerRef.current = setTimeout(() => {
        if (pendingProcessRef.current === name) {
          setCurrentProcess(name);
        }
      }, PROCESS_TITLE_THRESHOLD_MS);
    });

    const cleanupCommand = window.electronAPI.onTerminalCommand((payload) => {
      if (!payload || payload.terminalId !== terminalId) return;
      if (!isCurrentSession(payload.sessionToken)) return;
      commandHookActiveRef.current = true;
      const raw = payload.command;
      const cmd = (raw ?? '').trim();
      if (!cmd) {
        resetTitleState();
        return;
      }
      if (processChangeSupportedRef.current && !runningProcessRef.current) {
        return;
      }
      setCommandLabel(cmd);
      clearProcessState();
    });
    return () => {
      cleanupCwd();
      cleanupProcess();
      cleanupCommand();
    };
  }, [terminalId, workspacePath, resetTitleState, clearProcessState, isCurrentSession]);

  const baseName = deriveNameFromPath(currentPath) || originName || '.';
  const processLabel = commandLabel || currentProcess;
  const titleName = processLabel ? `${baseName} · ${processLabel}` : baseName;
  const titlePath = currentPath || startPathRef.current || '.';

  useEffect(() => {
    onProcessChange?.(processLabel ?? null);
  }, [onProcessChange, processLabel]);

  const handleTitlebarMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      onSelect?.();
      bringToFront();
      if (lockedToLayout) {
        return;
      }
      startDrag(e);
    },
    [bringToFront, lockedToLayout, onSelect, startDrag]
  );

  const handleTerminalClick = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      if (sessionStatus !== 'ready') return;
      try {
        termRef.current?.focus();
        containerRef.current?.focus();
      } catch {
        /* noop */
      }
      onSelect?.();
      bringToFront();
    },
    [bringToFront, onSelect, sessionStatus]
  );

  return (
    <WindowedBuildingEntity
      entityType="terminal"
      entityId={terminalId}
      entityName={titleName}
      selected={selected}
      onSelect={() => {
        onSelect?.();
        bringToFront();
      }}
      entityZIndex={zIndex}
      className={`terminal-panel ${previewed && !selected ? 'previewed' : ''} ${isPanelResizing ? 'resizing' : ''} ${isDragging ? 'dragging' : ''}`}
      style={{
        position: 'absolute',
        left: `${effectiveBounds.x}px`,
        top: `${effectiveBounds.y}px`,
        width: `${effectiveBounds.width}px`,
        height: `${effectiveBounds.height}px`,
        cursor: isDragging ? 'grabbing' : 'default',
        zIndex: zIndex,
      }}
      elementRef={panelRef}
      testId="entity-terminal"
    >
      <div
        className="panel-titlebar"
        onMouseDown={handleTitlebarMouseDown}
        onClick={(e) => {
          e.stopPropagation();
          bringToFront();
        }}
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
      >
        <div className="terminal-title">
          <span className="terminal-title-text">{titleName}</span>
          <span className="terminal-path">{titlePath}</span>
        </div>
        <div className="titlebar-actions">
          {exitInfo && (
            <button
              className="clear-btn"
              onClick={() => {
                void restartSession();
              }}
              title="Restart terminal"
            >
              ↻
            </button>
          )}
          <button
            className="close-btn"
            onClick={() => {
              onClose();
            }}
          >
            ×
          </button>
        </div>
      </div>
      <div
        className="terminal-container"
        style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative' }}
        onClick={handleTerminalClick}
      >
        {activateTerminal ? (
          <>
            <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
            {(sessionStatus === 'starting' || sessionStatus === 'restarting') && (
              <div className="terminal-loading">
                <div className="terminal-loading-spinner" />
                <div className="terminal-loading-text">
                  {sessionStatus === 'restarting' ? 'Restarting terminal…' : 'Starting terminal…'}
                </div>
              </div>
            )}
            {exitInfo && (
              <div className="terminal-exit">
                Terminal closed (exit {exitInfo.exitCode}
                {exitInfo.signal ? `, signal ${exitInfo.signal}` : ''})
              </div>
            )}
          </>
        ) : (
          <div className="terminal-dormant-placeholder">Terminal activates when nearby</div>
        )}
      </div>
      {!lockedToLayout && (
        <div
          className="panel-resize-handle terminal-resize-handle"
          onMouseDown={handleResizeStart}
          title="Resize terminal"
        />
      )}
      {showSelectionShield && (
        <div className="windowed-selection-shield" data-testid="windowed-selection-shield" aria-hidden />
      )}
    </WindowedBuildingEntity>
  );
}

const areTerminalEntityPropsEqual = (previous: TerminalEntityProps, next: TerminalEntityProps): boolean =>
  previous.terminalId === next.terminalId &&
  previous.workspacePath === next.workspacePath &&
  previous.originName === next.originName &&
  previous.startPath === next.startPath &&
  previous.x === next.x &&
  previous.y === next.y &&
  previous.width === next.width &&
  previous.height === next.height &&
  previous.forcedBounds?.x === next.forcedBounds?.x &&
  previous.forcedBounds?.y === next.forcedBounds?.y &&
  previous.forcedBounds?.width === next.forcedBounds?.width &&
  previous.forcedBounds?.height === next.forcedBounds?.height &&
  previous.lockedToLayout === next.lockedToLayout &&
  previous.zIndex === next.zIndex &&
  previous.selected === next.selected &&
  previous.previewed === next.previewed &&
  previous.dragSelecting === next.dragSelecting;

export default React.memo(TerminalEntity, areTerminalEntityPropsEqual);
