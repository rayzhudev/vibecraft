import { execFileSync } from 'child_process';

const MACOS_TAHOE_MAJOR_VERSION = 26;
const ELECTRON_TAHOE_WORKAROUND_MAJOR_VERSION = 41;

export function parseLeadingMajorVersion(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d+)/);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function shouldEnableMacOSTahoeElectron41Workaround(options?: {
  platform?: NodeJS.Platform;
  electronVersion?: string | null;
  macosVersion?: string | null;
}): boolean {
  const platform = options?.platform ?? process.platform;
  if (platform !== 'darwin') return false;
  const electronMajor = parseLeadingMajorVersion(options?.electronVersion ?? process.versions.electron);
  const macosMajor = parseLeadingMajorVersion(options?.macosVersion);
  return (
    electronMajor !== null &&
    electronMajor >= ELECTRON_TAHOE_WORKAROUND_MAJOR_VERSION &&
    macosMajor !== null &&
    macosMajor >= MACOS_TAHOE_MAJOR_VERSION
  );
}

function detectMacOSVersion(): string | null {
  if (process.platform !== 'darwin') return null;
  try {
    const value = execFileSync('/usr/bin/sw_vers', ['-productVersion'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return value || null;
  } catch {
    return null;
  }
}

export function getMacOSTahoeElectron41WorkaroundEnabled(): boolean {
  return shouldEnableMacOSTahoeElectron41Workaround({
    macosVersion: detectMacOSVersion(),
  });
}
