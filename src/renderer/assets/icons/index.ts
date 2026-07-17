import heroSvg from './hero.svg';
import claudeSvg from './claude.svg';
import codexSvg from './codex.svg';
import cursorSvg from './cursor.svg';
import maitrixSvg from './maitrix.svg';

import googleSvg from './google.svg';
import folderSvg from './folder.svg';
import folderWorktreeSvg from './folder-worktree.svg';
import terminalSvg from './terminal.svg';
import browserSvg from './browser.svg';
import updateDownloadSvg from './update-download.svg';

export const entityIcons = {
  hero: heroSvg,
  folder: folderSvg,
  folderWorktree: folderWorktreeSvg,
  terminal: terminalSvg,
  browser: browserSvg,
} as const;

export const providerIcons = {
  claude: claudeSvg,
  codex: codexSvg,
  cursor: cursorSvg,
  google: googleSvg,
  maitrix: maitrixSvg,
} as const;

export const uiIcons = {
  updateDownload: updateDownloadSvg,
} as const;

export type EntityIconType = keyof typeof entityIcons;
export type ProviderIconType = keyof typeof providerIcons;
