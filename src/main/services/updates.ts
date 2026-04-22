import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../logger';
import type { UpdateStatus } from '../../shared/types';

const log = logger.scope('updates');

const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

const resolveUpdateConfigPath = (): string | null => {
  const resourcesPath = typeof process.resourcesPath === 'string' ? process.resourcesPath : '';
  if (!resourcesPath) return null;
  return join(resourcesPath, 'app-update.yml');
};

const hasUpdateConfig = (): boolean => {
  const configPath = resolveUpdateConfigPath();
  return Boolean(configPath && existsSync(configPath));
};

const parseInterval = (value: string | undefined): number | null => {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};

const shouldEnableUpdates = (updateUrl: string | null): boolean => {
  if ((process.env.VIBECRAFT_DISABLE_UPDATES ?? '').trim() === '1') return false;
  if (updateUrl) return true;
  return hasUpdateConfig();
};

const emptyStatus: UpdateStatus = {
  available: false,
  version: null,
  downloaded: false,
  downloading: false,
  error: null,
};

let currentStatus: UpdateStatus = { ...emptyStatus };
let updatesEnabled = false;
const listeners = new Set<(status: UpdateStatus) => void>();

const emitStatus = (next: UpdateStatus): void => {
  currentStatus = next;
  listeners.forEach((listener) => listener(next));
};

const updateStatus = (partial: Partial<UpdateStatus>): void => {
  emitStatus({ ...currentStatus, ...partial });
};

export const getUpdateStatus = (): UpdateStatus => currentStatus;

export const onUpdateStatus = (listener: (status: UpdateStatus) => void): (() => void) => {
  listeners.add(listener);
  listener(currentStatus);
  return () => {
    listeners.delete(listener);
  };
};

type UpdateOptions = {
  isTestMode: boolean;
};

export const initializeAutoUpdates = ({ isTestMode }: UpdateOptions): void => {
  if (isTestMode || !app.isPackaged) {
    log.info('Auto updates disabled', { isTestMode, isPackaged: app.isPackaged });
    return;
  }

  const updateUrl = process.env.VIBECRAFT_UPDATE_URL?.trim() || null;
  if (!shouldEnableUpdates(updateUrl)) {
    log.warn('Auto updates skipped (no update URL or config).');
    return;
  }

  updatesEnabled = true;
  autoUpdater.logger = logger;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  const updateChannel = process.env.VIBECRAFT_UPDATE_CHANNEL?.trim();
  if (updateChannel) {
    autoUpdater.channel = updateChannel;
  }

  if (updateUrl) {
    autoUpdater.setFeedURL({ provider: 'generic', url: updateUrl });
  }

  autoUpdater.on('error', (error) => {
    const message = error instanceof Error ? error.message : String(error);
    updateStatus({ error: message, downloading: false });
    log.error('Auto update error', error);
  });

  autoUpdater.on('checking-for-update', () => {
    updateStatus({ error: null, downloading: true });
    log.info('Checking for updates');
  });

  autoUpdater.on('update-available', (info) => {
    updateStatus({ available: true, version: info.version, downloading: true, downloaded: false });
    log.info('Update available', { version: info.version });
  });

  autoUpdater.on('update-not-available', (info) => {
    updateStatus({ ...emptyStatus, version: info.version || null, downloading: false });
    log.info('Update not available', { version: info.version });
  });

  autoUpdater.on('update-downloaded', (info) => {
    updateStatus({ available: true, version: info.version, downloaded: true, downloading: false });
    log.info('Update downloaded', { version: info.version });
  });

  autoUpdater.on('download-progress', () => {
    updateStatus({ downloading: true });
  });

  const intervalMs =
    parseInterval(process.env.VIBECRAFT_UPDATE_CHECK_INTERVAL_MS) ?? DEFAULT_CHECK_INTERVAL_MS;

  const checkForUpdates = () => {
    autoUpdater.checkForUpdates().catch((error) => {
      log.warn('Update check failed', error);
    });
  };

  checkForUpdates();
  setInterval(checkForUpdates, intervalMs).unref();
  log.info('Auto updates enabled', { intervalMs, updateUrl, updateChannel });
};

export const checkForUpdates = async (): Promise<UpdateStatus> => {
  if (!updatesEnabled) return currentStatus;
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateStatus({ error: message, downloading: false });
    log.warn('Manual update check failed', error);
  }
  return currentStatus;
};

export const installUpdate = (): UpdateStatus => {
  if (!updatesEnabled) return currentStatus;
  if (currentStatus.downloaded) {
    autoUpdater.quitAndInstall();
    return currentStatus;
  }
  void checkForUpdates();
  return currentStatus;
};
