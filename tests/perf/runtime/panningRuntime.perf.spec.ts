import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Agent, BrowserPanel, Folder, TerminalPanel } from '../../../src/shared/types';
import { launchTestApp } from '../../e2e/utils';

type RuntimePerfOptions = {
  outPath: string;
  panSteps: number;
  warmupMs: number;
  settleMs: number;
  showWindow: boolean;
  disableBackgroundThrottling: boolean;
  agents: number;
  folders: number;
  browsers: number;
  terminals: number;
};

type RuntimeSnapshot = {
  workspacePath: string;
  performanceTier: string;
  frame: {
    fps: number;
    avgFrameMs: number;
    p95FrameMs: number;
    longFramePct: number;
    stutterFrameCount: number;
    sampleCount: number;
  };
  render: {
    commitCount: number;
    commitsPerSec: number;
    avgCommitMs: number;
    maxCommitMs: number;
    sampleCount: number;
  };
  entityCounts: {
    agents: number;
    folders: number;
    browsers: number;
    terminals: number;
  };
  capturedAt: number;
};

type RuntimeCaptureResult = {
  durationMs: number;
  samples: RuntimeSnapshot[];
};

const toTimestampSlug = (): string => new Date().toISOString().replace(/[.:]/g, '-');

const parseNumber = (raw: string | undefined, fallback: number): number => {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const parseBoolean = (raw: string | undefined, fallback: boolean): boolean => {
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const resolveOptions = (): RuntimePerfOptions => {
  const outPath = process.env.VIBECRAFT_RUNTIME_PERF_OUT
    ? path.resolve(process.cwd(), process.env.VIBECRAFT_RUNTIME_PERF_OUT)
    : path.resolve(process.cwd(), 'history', 'perf', `runtime-panning-${toTimestampSlug()}.json`);

  return {
    outPath,
    panSteps: parseNumber(process.env.VIBECRAFT_RUNTIME_PERF_PAN_STEPS, 260),
    warmupMs: parseNumber(process.env.VIBECRAFT_RUNTIME_PERF_WARMUP_MS, 800),
    settleMs: parseNumber(process.env.VIBECRAFT_RUNTIME_PERF_SETTLE_MS, 400),
    showWindow: process.env.VIBECRAFT_RUNTIME_PERF_SHOW_WINDOW === '1',
    disableBackgroundThrottling: parseBoolean(
      process.env.VIBECRAFT_RUNTIME_PERF_DISABLE_BACKGROUND_THROTTLING,
      true
    ),
    agents: parseNumber(process.env.VIBECRAFT_RUNTIME_PERF_AGENTS, 280),
    folders: parseNumber(process.env.VIBECRAFT_RUNTIME_PERF_FOLDERS, 140),
    browsers: parseNumber(process.env.VIBECRAFT_RUNTIME_PERF_BROWSERS, 90),
    terminals: parseNumber(process.env.VIBECRAFT_RUNTIME_PERF_TERMINALS, 90),
  };
};

const generateFolders = (count: number): Folder[] =>
  Array.from({ length: count }, (_, index) => ({
    kind: 'folder',
    id: `folder-${index}`,
    name: `Project ${index}`,
    relativePath: `project-${index}`,
    x: 280 + (index % 22) * 210,
    y: 180 + Math.floor(index / 22) * 190,
    createdAt: 1700000000000 + index,
  }));

const generateAgents = (count: number, workspacePath: string, folderIds: string[]): Agent[] =>
  Array.from({ length: count }, (_, index) => {
    const lane = index % 28;
    const row = Math.floor(index / 28);
    const status = index % 8 === 0 ? 'working' : index % 6 === 0 ? 'offline' : 'online';
    const attachedFolderId =
      status === 'offline'
        ? undefined
        : folderIds.length > 0
          ? folderIds[index % folderIds.length]
          : undefined;

    return {
      id: `agent-${index}`,
      provider: index % 2 === 0 ? 'claude' : 'codex',
      model: index % 2 === 0 ? 'claude-sonnet-4' : 'gpt-5',
      color: index % 2 === 0 ? '#7be0ff' : '#ffd77b',
      name: `Agent ${index}`,
      displayName: `Agent ${index}`,
      workspacePath,
      x: 260 + lane * 120,
      y: 280 + row * 130,
      status,
      attachedFolderId,
    };
  });

const generateBrowsers = (count: number): BrowserPanel[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `browser-${index}`,
    url: 'about:blank',
    x: 260 + (index % 15) * 250,
    y: 300 + Math.floor(index / 15) * 240,
    width: 520,
    height: 320,
    createdAt: 1700000100000 + index,
  }));

const generateTerminals = (count: number, folderNames: string[]): TerminalPanel[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `terminal-${index}`,
    originFolderName: folderNames[index % Math.max(1, folderNames.length)] ?? 'Terminal',
    originRelativePath: `project-${index % Math.max(1, folderNames.length)}`,
    lastKnownCwd: `project-${index % Math.max(1, folderNames.length)}`,
    x: 300 + (index % 14) * 250,
    y: 340 + Math.floor(index / 14) * 240,
    width: 520,
    height: 320,
    createdAt: 1700000200000 + index,
    lastUsedAt: 1700000300000 + index,
  }));

const seedWorkspaceEntities = async (workspacePath: string, options: RuntimePerfOptions): Promise<void> => {
  const metaDir = path.join(workspacePath, '.vibecraft');
  await mkdir(metaDir, { recursive: true });

  const folders = generateFolders(options.folders);
  const agents = generateAgents(
    options.agents,
    workspacePath,
    folders.map((folder) => folder.id)
  );
  const browsers = generateBrowsers(options.browsers);
  const terminals = generateTerminals(
    options.terminals,
    folders.map((folder) => folder.name)
  );

  await Promise.all([
    writeFile(path.join(metaDir, 'folders.json'), JSON.stringify(folders, null, 2), 'utf8'),
    writeFile(path.join(metaDir, 'agents.json'), JSON.stringify(agents, null, 2), 'utf8'),
    writeFile(path.join(metaDir, 'browsers.json'), JSON.stringify(browsers, null, 2), 'utf8'),
    writeFile(path.join(metaDir, 'terminals.json'), JSON.stringify(terminals, null, 2), 'utf8'),
  ]);
};

const average = (values: number[]): number => {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

test.setTimeout(180_000);

test('runtime panning stress capture (heavy entities)', async () => {
  const options = resolveOptions();
  const context = await launchTestApp({
    profileMode: true,
    showWindow: options.showWindow,
    disableBackgroundThrottling: options.disableBackgroundThrottling,
  });

  try {
    const { page, paths } = context;
    page.setDefaultTimeout(15_000);

    await seedWorkspaceEntities(paths.workspace, options);

    // Wait for settings to load, then dismiss tour-opt-in overlay if present
    await page
      .locator('[data-settings-status="loaded"]')
      .waitFor({ state: 'attached', timeout: 10_000 })
      .catch(() => {});
    const tourOverlay = page.locator('.tour-opt-in-overlay');
    const tourVisible = await tourOverlay.isVisible({ timeout: 500 }).catch(() => false);
    if (tourVisible) {
      await tourOverlay.getByRole('button', { name: 'Continue?' }).click();
    }

    // After dismissing overlay, "Continue?" navigates to world-selection; otherwise click from home
    const worldItemDirect = page.getByTestId('world-item').first();
    const alreadyOnWorldSelection = await worldItemDirect.isVisible({ timeout: 2_000 }).catch(() => false);
    if (!alreadyOnWorldSelection) {
      await page.getByTestId('home-select-world').click();
    }
    const worldItem = page.getByTestId('world-item').first();
    await worldItem.waitFor({ state: 'visible', timeout: 12_000 });
    await worldItem.click();
    await page.getByTestId('workspace-canvas').waitFor({ state: 'visible', timeout: 15_000 });

    await page.waitForFunction(
      () =>
        Boolean(
          (
            window as Window & {
              __vibecraftPerformance?: {
                getSnapshot: () => unknown;
              };
            }
          ).__vibecraftPerformance?.getSnapshot
        ),
      null,
      { timeout: 15_000 }
    );

    const runtime = (await page.evaluate(
      async ({ panSteps, warmupMs, settleMs }: { panSteps: number; warmupMs: number; settleMs: number }) => {
        const wait = async (ms: number) => {
          await new Promise((resolve) => window.setTimeout(resolve, ms));
        };

        const canvas = document.querySelector<HTMLElement>('[data-testid="workspace-canvas"]');
        if (!canvas) {
          throw new Error('workspace canvas not found');
        }

        if (warmupMs > 0) {
          await wait(warmupMs);
        }

        const getSnapshot = (): RuntimeSnapshot | null => {
          const handle = (
            window as Window & {
              __vibecraftPerformance?: {
                getSnapshot: () => RuntimeSnapshot;
              };
            }
          ).__vibecraftPerformance;
          if (!handle?.getSnapshot) return null;
          return handle.getSnapshot();
        };

        const samples: RuntimeSnapshot[] = [];
        const start = performance.now();

        for (let frame = 0; frame < panSteps; frame += 1) {
          const deltaX = 12 + (frame % 7) * 2;
          const deltaY = 8 + (frame % 5) * 2;
          const event = new WheelEvent('wheel', {
            deltaMode: 0,
            deltaX,
            deltaY,
            bubbles: true,
            cancelable: true,
            clientX: 760,
            clientY: 420,
          });
          canvas.dispatchEvent(event);

          if (frame % 3 === 0) {
            await wait(16);
            const snapshot = getSnapshot();
            if (snapshot) {
              samples.push(snapshot);
            }
          }
        }

        if (settleMs > 0) {
          await wait(settleMs);
        }

        const finalSnapshot = getSnapshot();
        if (finalSnapshot) {
          samples.push(finalSnapshot);
        }

        return {
          durationMs: performance.now() - start,
          samples,
        };
      },
      { panSteps: options.panSteps, warmupMs: options.warmupMs, settleMs: options.settleMs }
    )) as RuntimeCaptureResult;

    const frameSnapshots = runtime.samples
      .map((sample) => sample.frame)
      .filter((frame) => frame && Number.isFinite(frame.fps));
    const renderSnapshots = runtime.samples
      .map((sample) => sample.render)
      .filter((render) => render && Number.isFinite(render.commitsPerSec));

    const result = {
      scenario: 'workspace-panning-heavy-entities',
      createdAt: new Date().toISOString(),
      options: {
        panSteps: options.panSteps,
        warmupMs: options.warmupMs,
        settleMs: options.settleMs,
        showWindow: options.showWindow,
        disableBackgroundThrottling: options.disableBackgroundThrottling,
      },
      entityCounts: {
        agents: options.agents,
        folders: options.folders,
        browsers: options.browsers,
        terminals: options.terminals,
      },
      capture: {
        durationMs: runtime.durationMs,
        sampleCount: runtime.samples.length,
      },
      frame: {
        avgFps: average(frameSnapshots.map((frame) => frame.fps)),
        minFps: frameSnapshots.length > 0 ? Math.min(...frameSnapshots.map((frame) => frame.fps)) : 0,
        avgFrameMs: average(frameSnapshots.map((frame) => frame.avgFrameMs)),
        avgP95FrameMs: average(frameSnapshots.map((frame) => frame.p95FrameMs)),
        avgLongFramePct: average(frameSnapshots.map((frame) => frame.longFramePct)),
        maxStutterFrames:
          frameSnapshots.length > 0 ? Math.max(...frameSnapshots.map((frame) => frame.stutterFrameCount)) : 0,
        latestSampleCount: frameSnapshots.length > 0 ? (frameSnapshots.at(-1)?.sampleCount ?? 0) : 0,
      },
      render: {
        avgCommitsPerSec: average(renderSnapshots.map((render) => render.commitsPerSec)),
        avgCommitMs: average(renderSnapshots.map((render) => render.avgCommitMs)),
        maxCommitMs:
          renderSnapshots.length > 0 ? Math.max(...renderSnapshots.map((render) => render.maxCommitMs)) : 0,
        latestCommitCount: renderSnapshots.length > 0 ? (renderSnapshots.at(-1)?.commitCount ?? 0) : 0,
      },
      samples: runtime.samples,
    };

    await mkdir(path.dirname(options.outPath), { recursive: true });
    await writeFile(options.outPath, JSON.stringify(result, null, 2), 'utf8');

    console.log('[runtime-perf] scenario workspace-panning-heavy-entities');
    console.log(
      `[runtime-perf] entities: agents=${options.agents} folders=${options.folders} browsers=${options.browsers} terminals=${options.terminals}`
    );
    console.log(
      `[runtime-perf] samples=${result.capture.sampleCount} avgFps=${result.frame.avgFps.toFixed(2)} minFps=${result.frame.minFps.toFixed(2)} avgP95FrameMs=${result.frame.avgP95FrameMs.toFixed(2)}`
    );
    console.log(`[runtime-perf] wrote ${options.outPath}`);

    expect(result.capture.sampleCount).toBeGreaterThan(0);
  } finally {
    await context.cleanup();
  }
});
