import * as fs from 'fs';
import * as path from 'path';
import * as pty from 'node-pty';
import { storage } from './storage';
import { resolveWorkspaceSubpath } from './workspacePaths';
import { logger } from '../logger';
import { ensureTerminalPath, resolveShellCommand, sanitizeShellEnv } from './terminalShell';
import { buildBashHookArgs } from './terminalHooks';
import * as os from 'os';
import { APP_VERSION } from './appVersion';

const log = logger.scope('terminals');
const terminalTraceEnabled = process.env.VIBECRAFT_TERMINAL_TRACE === '1';

const traceTerminal = (message: string, payload?: Record<string, unknown>) => {
  if (!terminalTraceEnabled) return;
  log.info(`[terminal-trace] ${message}`, payload ?? {});
};

type TerminalSession = {
  id: string;
  pty: pty.IPty;
  workspacePath: string;
  cwd: string;
  processName?: string;
  sessionToken: string;
  cleanup?: () => void;
};

const sessions = new Map<string, TerminalSession>();
type HistoryState = {
  buffer: string;
  workspacePath: string;
  flushTimer?: NodeJS.Timeout;
};

const historyCache = new Map<string, HistoryState>();

export type CreateTerminalOptions = {
  terminalId: string;
  workspacePath: string;
  relativePath?: string;
  cols?: number;
  rows?: number;
  shell?: string;
  sessionToken?: string;
  reuseIfRunning?: boolean;
};

export type TerminalHandlers = {
  onData: (terminalId: string, data: string, sessionToken: string) => void;
  onExit: (terminalId: string, payload: { exitCode: number; signal?: number }, sessionToken: string) => void;
  onCwdChange?: (
    terminalId: string,
    payload: { path: string; relativePath?: string },
    sessionToken: string
  ) => void;
  onProcessChange?: (terminalId: string, processName: string, sessionToken: string) => void;
  onCommand?: (terminalId: string, command: string, sessionToken: string) => void;
};

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const MAX_HISTORY_BYTES = 200_000;
const HISTORY_FLUSH_INTERVAL_MS = 1000;
const TEMP_PREFIX = 'vbc-shell-';

const createSessionToken = (): string => `terminal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const buildTerminalEnv = (
  shellPath: string,
  extraEnv?: Record<string, string | undefined>
): Record<string, string> => {
  const rawEnv: Record<string, string | undefined> = { ...process.env };
  rawEnv.PATH = ensureTerminalPath(rawEnv.PATH);

  rawEnv.TERM = rawEnv.TERM || 'xterm-256color';
  rawEnv.COLORTERM = 'truecolor';
  rawEnv.VBC_TERM_PROGRAM = 'vibecraft';
  rawEnv.VBC_TERM_PROGRAM_VERSION = APP_VERSION;

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawEnv)) {
    if (typeof value === 'string') {
      env[key] = value;
    }
  }

  if (extraEnv) {
    for (const [key, value] of Object.entries(extraEnv)) {
      if (typeof value === 'string') {
        env[key] = value;
      }
    }
  }

  return sanitizeShellEnv(env, shellPath);
};

const trimHistory = (value: string): string => {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length <= MAX_HISTORY_BYTES) return value;
  return bytes.slice(-MAX_HISTORY_BYTES).toString('utf8');
};

const getHistoryState = (terminalId: string, workspacePath: string): HistoryState => {
  const existing = historyCache.get(terminalId);
  if (existing) return existing;
  const raw = storage.getTerminalHistory(workspacePath, terminalId);
  const buffer = trimHistory(raw);
  if (buffer !== raw) {
    storage.setTerminalHistory(workspacePath, terminalId, buffer);
  }
  const state: HistoryState = { buffer, workspacePath };
  historyCache.set(terminalId, state);
  return state;
};

const flushHistory = (terminalId: string) => {
  const state = historyCache.get(terminalId);
  if (!state) return;
  if (state.flushTimer) {
    clearTimeout(state.flushTimer);
    state.flushTimer = undefined;
  }
  storage.setTerminalHistory(state.workspacePath, terminalId, state.buffer);
};

const appendHistory = (terminalId: string, workspacePath: string, chunk: string) => {
  const state = getHistoryState(terminalId, workspacePath);
  state.buffer = trimHistory(state.buffer + chunk);
  if (!state.flushTimer) {
    state.flushTimer = setTimeout(() => flushHistory(terminalId), HISTORY_FLUSH_INTERVAL_MS);
  }
};

const parseCwdFromOsc = (data: string): string | null => {
  // Look for OSC 7 sequences: ESC ] 7;file://... BEL or ST
  const regex = /\u001b\]7;([^\u001b\u0007]*)(?:\u0007|\u001b\\)/g;
  let match: RegExpExecArray | null = null;
  let last: string | null = null;
  while ((match = regex.exec(data)) !== null) {
    last = match[1];
  }
  if (!last) return null;
  const cleaned = last.replace(/^file:\/\//, '');
  const slashIndex = cleaned.indexOf('/');
  const withoutHost = slashIndex >= 0 ? cleaned.slice(slashIndex) : cleaned;
  const pathPart = withoutHost.startsWith('/') ? withoutHost : `/${withoutHost}`;
  try {
    return decodeURIComponent(pathPart);
  } catch {
    return pathPart;
  }
};

const parseCommandFromOsc = (data: string): string | null => {
  // OSC 9;command BEL/ST
  const regex = /\u001b\]9;([^\u001b\u0007]*)(?:\u0007|\u001b\\)/g;
  let match: RegExpExecArray | null = null;
  let last: string | null = null;
  while ((match = regex.exec(data)) !== null) {
    last = match[1];
  }
  if (last === null) return null;
  return last.trim();
};

export function getTerminalHistory(terminalId: string, workspacePath: string): string {
  const state = historyCache.get(terminalId);
  if (state && state.workspacePath === workspacePath) {
    return state.buffer;
  }
  return storage.getTerminalHistory(workspacePath, terminalId);
}

const normalizeSize = (value: number | undefined, fallback: number) => {
  if (!Number.isFinite(value)) return fallback;
  const rounded = Math.floor(value as number);
  return Math.max(1, rounded);
};

const makeTempDir = (prefix: string): string | null => {
  try {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  } catch (err) {
    log.warn('Failed to create temp dir for shell hooks', err);
    return null;
  }
};

type HookConfig = {
  args?: string[];
  env?: Record<string, string | undefined>;
  cleanup?: () => void;
};

const createHookConfig = (shellPath: string): HookConfig => {
  const name = path.basename(shellPath).toLowerCase();

  if (name.includes('bash')) {
    const tempDir = makeTempDir(TEMP_PREFIX);
    if (!tempDir) return {};
    const rcPath = path.join(tempDir, 'bashrc');
    const userRc = path.join(os.homedir(), '.bashrc');
    const userProfile = path.join(os.homedir(), '.bash_profile');
    const userProfileAlt = path.join(os.homedir(), '.profile');
    const userEnv = process.env.BASH_ENV;
    const rcLines = [
      'for candidate in /etc/profile /etc/bash.bashrc /etc/bashrc; do',
      '  [ -f "$candidate" ] && source "$candidate"',
      'done',
      `[ -f "${userProfile}" ] && source "${userProfile}"`,
      `[ -f "${userProfileAlt}" ] && source "${userProfileAlt}"`,
      `[ -f "${userRc}" ] && source "${userRc}"`,
      ...(userEnv && userEnv !== userRc ? [`[ -f "${userEnv}" ] && source "${userEnv}"`] : []),
      'if command -v bind >/dev/null 2>&1; then',
      '  if bind -v 2>/dev/null | command grep -q "enable-bracketed-paste"; then',
      '    if ! bind "set enable-bracketed-paste on" 2>/dev/null; then',
      '      printf "\\033[?2004l"',
      '    fi',
      '  else',
      '    printf "\\033[?2004l"',
      '  fi',
      'fi',
      '__vbc_cmd=""',
      '__vbc_token=0',
      '__vbc_debounce_sec=0.3',
      '__vbc_schedule() {',
      '  local cmd="$1"',
      '  __vbc_cmd="$cmd"',
      '  __vbc_token=$((__vbc_token + 1))',
      '  local token="$__vbc_token"',
      '  ( sleep "$__vbc_debounce_sec"; if [ "$__vbc_cmd" = "$cmd" ] && [ "$__vbc_token" -eq "$token" ] && [ -n "$cmd" ]; then printf "\\033]9;%s\\007" "$cmd"; fi ) &',
      '  disown $! 2>/dev/null || true',
      '}',
      '__vbc_preexec() { __vbc_schedule "$BASH_COMMAND"; }',
      '__vbc_clear() {',
      '  __vbc_cmd=""',
      '  __vbc_token=$((__vbc_token + 1))',
      '  printf "\\033]9;\\007"',
      '}',
      '__vbc_prev_debug=$(trap -p DEBUG | sed -n "s/^trap -- \'\\(.*\\)\' DEBUG$/\\1/p")',
      'if [ -n "$__vbc_prev_debug" ]; then',
      '  trap \'__vbc_preexec; eval "$__vbc_prev_debug"\' DEBUG',
      'else',
      "  trap '__vbc_preexec' DEBUG",
      'fi',
      '__vbc_prompt_is_array=0',
      "if declare -p PROMPT_COMMAND 2>/dev/null | grep -q 'declare -a'; then",
      '  __vbc_prompt_is_array=1',
      'fi',
      'if [ "$__vbc_prompt_is_array" = "1" ]; then',
      '  PROMPT_COMMAND=( "__vbc_clear" "${PROMPT_COMMAND[@]}" )',
      'else',
      '  if [ -n "$PROMPT_COMMAND" ]; then',
      '    PROMPT_COMMAND="__vbc_clear;$PROMPT_COMMAND"',
      '  else',
      '    PROMPT_COMMAND="__vbc_clear"',
      '  fi',
      'fi',
      'unset __vbc_prompt_is_array',
    ];
    try {
      fs.writeFileSync(rcPath, rcLines.join('\n'), { encoding: 'utf8' });
    } catch (err) {
      log.warn('Failed to write bash rc hook', err);
      return {};
    }
    return {
      args: buildBashHookArgs(rcPath),
      cleanup: () => {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
          /* noop */
        }
      },
    };
  }

  if (name.includes('zsh')) {
    const tempDir = makeTempDir(TEMP_PREFIX);
    if (!tempDir) return {};
    const userZdot = process.env.ZDOTDIR || os.homedir();
    const userZshenv = path.join(userZdot, '.zshenv');
    const userZprofile = path.join(userZdot, '.zprofile');
    const userZshrc = path.join(userZdot, '.zshrc');
    const zshenvPath = path.join(tempDir, '.zshenv');
    const zshrcPath = path.join(tempDir, '.zshrc');
    const zshenvLines = [`[ -f "${userZshenv}" ] && source "${userZshenv}"`];
    const zshrcLines = [
      `export ZDOTDIR="${userZdot}"`,
      `export VBC_ORIG_ZDOTDIR="${userZdot}"`,
      `export HISTFILE="${path.join(userZdot, '.zsh_history')}"`,
      `[ -f "${userZprofile}" ] && source "${userZprofile}"`,
      `[ -f "${userZshrc}" ] && source "${userZshrc}"`,
      'if ! typeset -p _comps >/dev/null 2>&1; then',
      '  autoload -Uz compinit',
      '  compinit',
      'fi',
      'if [[ -o zle ]]; then',
      '  autoload -Uz bracketed-paste-magic 2>/dev/null || true',
      '  zle -N bracketed-paste bracketed-paste-magic 2>/dev/null || true',
      '  if ! setopt bracketedpaste 2>/dev/null; then',
      '    printf "\\033[?2004l"',
      '  fi',
      'fi',
      'typeset -g __vbc_cmd=""',
      'typeset -g __vbc_token=0',
      'typeset -g __vbc_debounce_sec=0.3',
      'vbc_preexec() {',
      '  local cmd="$1"',
      '  __vbc_cmd="$cmd"',
      '  __vbc_token=$((__vbc_token + 1))',
      '  local token=$__vbc_token',
      '  ( sleep "$__vbc_debounce_sec"; if [[ "$__vbc_cmd" == "$cmd" && "$__vbc_token" -eq "$token" && -n "$cmd" ]]; then printf "\\033]9;%s\\007" "$cmd"; fi ) &!',
      '}',
      'vbc_precmd() {',
      '  __vbc_cmd=""',
      '  __vbc_token=$((__vbc_token + 1))',
      '  printf "\\033]9;\\007"',
      '}',
      'autoload -Uz add-zsh-hook 2>/dev/null || true',
      'if command -v add-zsh-hook >/dev/null 2>&1; then',
      '  add-zsh-hook preexec vbc_preexec',
      '  add-zsh-hook precmd vbc_precmd',
      'fi',
    ];
    try {
      fs.writeFileSync(zshenvPath, zshenvLines.join('\n'), { encoding: 'utf8' });
      fs.writeFileSync(zshrcPath, zshrcLines.join('\n'), { encoding: 'utf8' });
    } catch (err) {
      log.warn('Failed to write zsh hook config', err);
      return {};
    }
    return {
      args: ['-i'],
      env: { ZDOTDIR: tempDir, SHELL_SESSIONS_DISABLE: '1' },
      cleanup: () => {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
          /* noop */
        }
      },
    };
  }

  if (name.includes('fish')) {
    const command =
      'if not set -q VBC_PREEXEC_INSTALLED; ' +
      'set -g __vbc_cmd ""; set -g __vbc_token 0; set -g __vbc_debounce_sec 0.3; ' +
      'function __vbc_schedule --argument-names cmd; ' +
      'set -g __vbc_cmd $cmd; ' +
      'set -g __vbc_token (math $__vbc_token + 1); ' +
      'set -l token $__vbc_token; ' +
      'begin; command sleep $__vbc_debounce_sec; ' +
      'if test "$__vbc_cmd" = "$cmd"; and test "$__vbc_token" -eq "$token"; and test -n "$cmd"; printf "\\033]9;%s\\007" "$cmd"; end; end &; ' +
      'if command -q disown; disown $last_pid 2>/dev/null; end; ' +
      'end; ' +
      'function __vbc_preexec --on-event fish_preexec; __vbc_schedule (string join " " $argv); end; ' +
      'function __vbc_postexec --on-event fish_postexec; ' +
      'set -g __vbc_cmd ""; set -g __vbc_token (math $__vbc_token + 1); printf "\\033]9;\\007"; end; ' +
      'set -gx VBC_PREEXEC_INSTALLED 1; end';
    return { args: ['-i', '--init-command', command] };
  }

  if (name.includes('pwsh') || name.includes('powershell')) {
    const tempDir = makeTempDir(TEMP_PREFIX);
    if (!tempDir) return {};
    const scriptPath = path.join(tempDir, 'vbc-profile.ps1');
    const profilePath = process.platform === 'win32' ? '$PROFILE' : '$PROFILE.CurrentUserAllHosts';
    const psLines = [
      `if (Test-Path ${profilePath}) { . ${profilePath} }`,
      '$global:__vbc_cmd = $null',
      '$global:__vbc_timer = $null',
      'function global:__vbc_schedule {',
      '  param($line)',
      '  if (-not $line) { return }',
      '  $global:__vbc_cmd = $line',
      '  if ($global:__vbc_timer) { $global:__vbc_timer.Dispose(); $global:__vbc_timer = $null }',
      '  $callback = {',
      '    param($state)',
      '    if ($global:__vbc_cmd -eq $state) {',
      '      Write-Host ([char]27 + "]9;" + $state + [char]7) -NoNewline',
      '    }',
      '  }',
      '  $global:__vbc_timer = [System.Threading.Timer]::new($callback, $line, 300, [System.Threading.Timeout]::Infinite)',
      '}',
      'function global:__vbc_clear {',
      '  if ($global:__vbc_timer) { $global:__vbc_timer.Dispose(); $global:__vbc_timer = $null }',
      '  $global:__vbc_cmd = $null',
      '  Write-Host ([char]27 + "]9;" + [char]7) -NoNewline',
      '}',
      'if (Get-Command Set-PSReadLineOption -ErrorAction SilentlyContinue) {',
      '  Set-PSReadLineOption -AddToHistoryHandler { param($line) if ($line) { __vbc_schedule $line } ; $true }',
      '}',
      'if (-not (Get-Variable __vbc_original_prompt -Scope Global -ErrorAction SilentlyContinue)) {',
      '  $global:__vbc_original_prompt = (Get-Command prompt -ErrorAction SilentlyContinue)',
      '}',
      'function global:prompt {',
      '  __vbc_clear',
      '  if ($global:__vbc_original_prompt) {',
      '    & $global:__vbc_original_prompt',
      '  } else {',
      '    "PS> "',
      '  }',
      '}',
    ];
    try {
      fs.writeFileSync(scriptPath, psLines.join('\n'), { encoding: 'utf8' });
    } catch (err) {
      log.warn('Failed to write pwsh hook script', err);
      return {};
    }
    return {
      args: ['-NoLogo', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      cleanup: () => {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
          /* noop */
        }
      },
    };
  }

  return {};
};

export function startTerminalSession(
  options: CreateTerminalOptions,
  handlers: TerminalHandlers
): { success: boolean; error?: string; sessionToken?: string } {
  const terminalId = String(options.terminalId || '').trim();
  if (!terminalId) {
    return { success: false, error: 'Terminal id is required' };
  }

  const existing = sessions.get(terminalId);
  if (existing && options.reuseIfRunning && existing.workspacePath === options.workspacePath) {
    const workspaceRoot = path.resolve(options.workspacePath);
    const absolutePath = path.resolve(existing.cwd);
    const isInside = absolutePath === workspaceRoot || absolutePath.startsWith(workspaceRoot + path.sep);
    const relativePath = isInside ? path.relative(workspaceRoot, absolutePath) || '.' : undefined;
    if (existing.processName) {
      handlers.onProcessChange?.(terminalId, existing.processName, existing.sessionToken);
    }
    handlers.onCwdChange?.(
      terminalId,
      { path: isInside ? (relativePath ?? '.') : absolutePath, relativePath },
      existing.sessionToken
    );
    traceTerminal('reuse', { terminalId });
    return { success: true, sessionToken: existing.sessionToken };
  }

  const relativePath = String(options.relativePath || '').trim();
  const cwd = relativePath
    ? resolveWorkspaceSubpath(options.workspacePath, relativePath)
    : resolveWorkspaceSubpath(options.workspacePath, '.');
  if (!cwd) {
    return { success: false, error: 'Invalid folder path' };
  }
  if (!fs.existsSync(cwd)) {
    return { success: false, error: 'Folder path missing' };
  }

  const cols = normalizeSize(options.cols, DEFAULT_COLS);
  const rows = normalizeSize(options.rows, DEFAULT_ROWS);

  if (existing) {
    try {
      existing.pty.kill();
    } catch (err) {
      log.warn('Failed to stop existing terminal session:', err);
    }
    try {
      existing.cleanup?.();
    } catch {
      /* noop */
    }
    flushHistory(terminalId);
    historyCache.delete(terminalId);
    sessions.delete(terminalId);
  }

  getHistoryState(terminalId, options.workspacePath);

  const sessionToken = (options.sessionToken || '').trim() || createSessionToken();
  let hookConfig: HookConfig = {};
  try {
    const resolvedShell = resolveShellCommand(options.shell);
    hookConfig = createHookConfig(resolvedShell.shell);
    const args = [...resolvedShell.args, ...(hookConfig.args ?? [])];
    traceTerminal('spawn', {
      terminalId,
      shell: resolvedShell.shell,
      args,
      cwd,
    });
    const ptyProcess = pty.spawn(resolvedShell.shell, args, {
      cols,
      rows,
      cwd,
      env: buildTerminalEnv(resolvedShell.shell, hookConfig.env),
      name: 'xterm-256color',
    });

    const session: TerminalSession = {
      id: terminalId,
      pty: ptyProcess,
      workspacePath: options.workspacePath,
      cwd,
      processName: ptyProcess.process,
      sessionToken,
      cleanup: hookConfig.cleanup,
    };
    sessions.set(terminalId, session);

    ptyProcess.onData((data) => {
      if (ptyProcess.process && ptyProcess.process !== session.processName) {
        session.processName = ptyProcess.process;
        handlers.onProcessChange?.(terminalId, ptyProcess.process, sessionToken);
      }
      const cmd = parseCommandFromOsc(data);
      if (cmd !== null) {
        handlers.onCommand?.(terminalId, cmd, sessionToken);
      }
      const cwd = parseCwdFromOsc(data);
      if (cwd) {
        try {
          const absolutePath = path.resolve(cwd);
          session.cwd = absolutePath;
          const workspaceRoot = path.resolve(options.workspacePath);
          const isInside =
            absolutePath === workspaceRoot || absolutePath.startsWith(workspaceRoot + path.sep);
          const relativePath = isInside ? path.relative(workspaceRoot, absolutePath) || '.' : undefined;
          handlers.onCwdChange?.(
            terminalId,
            { path: isInside ? (relativePath ?? '.') : absolutePath, relativePath },
            sessionToken
          );
        } catch {
          /* noop */
        }
      }
      appendHistory(terminalId, options.workspacePath, data);
      handlers.onData(terminalId, data, sessionToken);
    });

    ptyProcess.onExit((event) => {
      sessions.delete(terminalId);
      traceTerminal('exit', {
        terminalId,
        exitCode: event.exitCode ?? 0,
        signal: event.signal ?? undefined,
      });
      try {
        hookConfig.cleanup?.();
      } catch {
        /* noop */
      }
      flushHistory(terminalId);
      historyCache.delete(terminalId);
      handlers.onExit(
        terminalId,
        { exitCode: event.exitCode ?? 0, signal: event.signal ?? undefined },
        sessionToken
      );
    });

    return { success: true, sessionToken };
  } catch (err) {
    log.error('Failed to spawn terminal:', err);
    traceTerminal('spawn-error', {
      terminalId,
      error: err instanceof Error ? err.message : String(err),
    });
    try {
      hookConfig.cleanup?.();
    } catch {
      /* noop */
    }
    return { success: false, error: err instanceof Error ? err.message : 'Failed to spawn terminal' };
  }
}

export function sendTerminalInput(terminalId: string, data: string): boolean {
  const session = sessions.get(terminalId);
  if (!session) {
    traceTerminal('input-missing-session', { terminalId });
    return false;
  }
  try {
    session.pty.write(data);
    return true;
  } catch (err) {
    log.error('Failed to write to terminal:', err);
    traceTerminal('input-error', {
      terminalId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export function resizeTerminal(terminalId: string, cols: number, rows: number): boolean {
  const session = sessions.get(terminalId);
  if (!session) {
    return false;
  }
  try {
    session.pty.resize(normalizeSize(cols, DEFAULT_COLS), normalizeSize(rows, DEFAULT_ROWS));
    return true;
  } catch (err) {
    log.error('Failed to resize terminal:', err);
    return false;
  }
}

export function stopTerminalSession(terminalId: string): boolean {
  const session = sessions.get(terminalId);
  if (!session) {
    traceTerminal('stop-missing-session', { terminalId });
    return true;
  }
  sessions.delete(terminalId);
  try {
    session.pty.kill();
    try {
      session.cleanup?.();
    } catch {
      /* noop */
    }
    flushHistory(terminalId);
    historyCache.delete(terminalId);
    return true;
  } catch (err) {
    log.error('Failed to close terminal:', err);
    return false;
  }
}
