import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

function spawnCapture(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, options);
    let stdout = '';
    let stderr = '';
    if (child.stdout)
      child.stdout.on('data', (d) => {
        stdout += String(d);
      });
    if (child.stderr)
      child.stderr.on('data', (d) => {
        stderr += String(d);
      });
    child.on('error', (err) => resolve({ code: 1, stdout, stderr: `${stderr}${String(err)}` }));
    child.on('exit', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function hasElectronManifest(rootDir) {
  const pkg = readJson(path.join(rootDir, 'package.json'));
  if (pkg?.devDependencies?.electron || pkg?.dependencies?.electron) return true;

  const lockPath = path.join(rootDir, 'bun.lock');
  if (!fs.existsSync(lockPath)) return false;
  try {
    const text = fs.readFileSync(lockPath, 'utf8');
    return /"electron"\s*:\s*\["electron@([^"]+)"/.test(text);
  } catch {
    return false;
  }
}

function resolveRepoRoot() {
  const fromCwd = process.cwd();
  if (hasElectronManifest(fromCwd)) return fromCwd;

  const fromScript = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  if (hasElectronManifest(fromScript)) return fromScript;

  return fromCwd;
}

const REPO_ROOT = resolveRepoRoot();
const STAMP_PATH = path.join(REPO_ROOT, '.electron-rebuild.stamp.json');
const ELECTRON_HOME = path.join(REPO_ROOT, '.electron-home');

function normalizeElectronVersion(version) {
  if (!version) return null;
  const trimmed = String(version).trim();
  if (!trimmed) return null;
  return trimmed.replace(/^[^0-9]*/, '') || null;
}

function resolveElectronVersionFromNodeModules() {
  try {
    const electronPkg = path.join(REPO_ROOT, 'node_modules', 'electron', 'package.json');
    const parsed = readJson(electronPkg);
    if (parsed?.version) return String(parsed.version);
  } catch {
    // ignore
  }
  return null;
}

function resolveElectronVersionFromLockfile() {
  const lockPath = path.join(REPO_ROOT, 'bun.lock');
  if (!fs.existsSync(lockPath)) return null;
  try {
    const text = fs.readFileSync(lockPath, 'utf8');
    const match = text.match(/"electron"\s*:\s*\["electron@([^"]+)"/);
    if (match?.[1]) return match[1];
  } catch {
    // ignore
  }
  return null;
}

function resolveElectronVersionFromPackageJson() {
  const pkgPath = path.join(REPO_ROOT, 'package.json');
  const pkg = readJson(pkgPath);
  const declared = pkg?.devDependencies?.electron ?? pkg?.dependencies?.electron;
  return normalizeElectronVersion(declared);
}

function resolveElectronVersion() {
  const fromModules = resolveElectronVersionFromNodeModules();
  if (fromModules) return { version: fromModules, source: 'node_modules' };

  const fromLock = resolveElectronVersionFromLockfile();
  if (fromLock) return { version: fromLock, source: 'bun.lock' };

  const fromPackage = resolveElectronVersionFromPackageJson();
  if (fromPackage) return { version: fromPackage, source: 'package.json' };

  return null;
}

function getElectronRebuildBin() {
  const bin = process.platform === 'win32' ? 'electron-rebuild.cmd' : 'electron-rebuild';
  return path.join(REPO_ROOT, 'node_modules', '.bin', bin);
}

async function findPythonWithDistutils() {
  const candidates = [
    process.env.PYTHON,
    process.env.npm_config_python,
    'python3.11',
    'python3',
    'python',
  ].filter(Boolean);

  for (const candidate of candidates) {
    const check = await spawnCapture(
      candidate,
      ['-c', 'import sys; import distutils; print(sys.version.split()[0])'],
      { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    if (check.code === 0) {
      const version = (check.stdout || '').trim();
      return { command: candidate, version: version || undefined };
    }
  }

  return null;
}

function shouldSkip(stamp, desired) {
  if (process.env.FORCE_REBUILD_NATIVES === '1') return false;
  if (!stamp) return false;
  return (
    stamp.electronVersion === desired.electronVersion &&
    stamp.platform === desired.platform &&
    stamp.arch === desired.arch
  );
}

async function run() {
  if (process.env.SKIP_REBUILD_NATIVES === '1') {
    return;
  }

  const resolved = resolveElectronVersion();
  if (!resolved?.version) {
    console.warn(
      '[rebuild-natives] Unable to resolve Electron version (node_modules missing and no lockfile entry); skipping native rebuild.'
    );
    return;
  }
  const { version: electronVersion, source } = resolved;
  if (source !== 'node_modules') {
    console.warn(`[rebuild-natives] Using Electron ${electronVersion} from ${source}.`);
  }

  const desired = {
    electronVersion,
    platform: process.platform,
    arch: process.arch,
  };
  const stamp = readJson(STAMP_PATH);
  if (shouldSkip(stamp, desired)) {
    return;
  }

  if (!fs.existsSync(ELECTRON_HOME)) {
    fs.mkdirSync(ELECTRON_HOME, { recursive: true });
  }

  const rebuildBin = getElectronRebuildBin();
  if (!fs.existsSync(rebuildBin)) {
    console.warn('[rebuild-natives] electron-rebuild not installed; skipping native rebuild.');
    return;
  }

  const python = await findPythonWithDistutils();
  if (!python && process.platform !== 'win32') {
    const msg =
      '[rebuild-natives] Cannot rebuild PTY native modules because Python distutils is unavailable.\n' +
      'Fix options:\n' +
      '- Use Python 3.11 (recommended) and rerun: `PYTHON=python3.11 bun run --cwd vibecraft rebuild:natives`\n' +
      '- Or install setuptools for your active python: `python3 -m ensurepip --upgrade` (then retry)\n' +
      'Note: without PTY, Claude Code terminal cannot work.';
    if (process.env.FAIL_ON_REBUILD_ERROR === '1') {
      throw new Error(msg);
    }
    console.warn(msg);
    return;
  }

  const args = ['-f', '-v', electronVersion, '-w', 'node-pty', '-m', '.'];

  const env = {
    ...process.env,
    HOME: ELECTRON_HOME,
    ...(python ? { PYTHON: python.command, npm_config_python: python.command } : {}),
  };

  const child = spawn(rebuildBin, args, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env,
  });

  const exitCode = await new Promise((resolve) => {
    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });

  if (exitCode !== 0) {
    const msg =
      '[rebuild-natives] Native rebuild failed. PTY-based providers (Claude) will not work until node-pty is rebuilt for Electron.\n' +
      'Try: `bun run --cwd vibecraft rebuild:natives` (may require network access to fetch Electron headers).';
    if (process.env.FAIL_ON_REBUILD_ERROR === '1') {
      throw new Error(msg);
    }
    console.warn(msg);
    return;
  }

  writeJson(STAMP_PATH, {
    ...desired,
    rebuiltAt: new Date().toISOString(),
  });
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
