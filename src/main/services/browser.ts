import type { BrowserPanel } from '../../shared/types';
import { DEFAULT_BROWSER_SIZE } from '../../shared/browserDefaults';
import { storage } from './storage';
import { logger } from '../logger';

const log = logger.scope('browser');

// Create a new browser panel
export function createBrowserPanel(
  workspacePath: string,
  url: string,
  x: number,
  y: number,
  width = DEFAULT_BROWSER_SIZE.width,
  height = DEFAULT_BROWSER_SIZE.height,
  originFolderId?: string
): BrowserPanel {
  const panel: BrowserPanel = {
    id: `browser-${Date.now()}`,
    url,
    x,
    y,
    width,
    height,
    createdAt: Date.now(),
    originFolderId,
  };

  const panels = storage.loadBrowserPanels(workspacePath);
  panels.push(panel);
  storage.saveBrowserPanels(workspacePath, panels);

  log.info(`Created browser panel: ${panel.id}`);
  return panel;
}

// Update browser panel
export function updateBrowserPanel(
  workspacePath: string,
  panelId: string,
  updates: Partial<BrowserPanel>
): BrowserPanel | null {
  const panels = storage.loadBrowserPanels(workspacePath);
  const panel = panels.find((p) => p.id === panelId);

  if (!panel) {
    return null;
  }

  Object.assign(panel, updates);
  storage.saveBrowserPanels(workspacePath, panels);
  return panel;
}

// Delete browser panel
export function deleteBrowserPanel(workspacePath: string, panelId: string): boolean {
  const panels = storage.loadBrowserPanels(workspacePath);
  const idx = panels.findIndex((p) => p.id === panelId);

  if (idx === -1) {
    return false;
  }

  panels.splice(idx, 1);
  storage.saveBrowserPanels(workspacePath, panels);
  return true;
}

// Update panel position
export function updateBrowserPanelPosition(
  workspacePath: string,
  panelId: string,
  x: number,
  y: number
): void {
  const panels = storage.loadBrowserPanels(workspacePath);
  const panel = panels.find((p) => p.id === panelId);

  if (panel) {
    panel.x = x;
    panel.y = y;
    storage.saveBrowserPanels(workspacePath, panels);
  }
}
