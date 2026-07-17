import * as fs from 'fs/promises';
import * as path from 'path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { launchTestApp } from './utils';

test.setTimeout(180_000);

const getCenter = async (locator: Locator) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Missing entity bounds');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

const getFolderIconCenter = async (folder: Locator) => {
  const box = await folder.locator('.folder-icon').boundingBox();
  if (!box) throw new Error('Missing folder icon bounds');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

const rightClickCanvasAt = async (page: Page, target: { x: number; y: number }) => {
  const canvas = page.getByTestId('workspace-canvas');
  const canvasBox = await canvas.boundingBox();
  if (!canvasBox) throw new Error('Missing canvas bounds');
  await canvas.click({
    button: 'right',
    position: {
      x: target.x - canvasBox.x,
      y: target.y - canvasBox.y,
    },
  });
};

const dragEntityTo = async (page: Page, locator: Locator, target: { x: number; y: number }) => {
  const start = await getCenter(locator);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await page.mouse.up();
};

const dragSelectRect = async (page: Page, start: { x: number; y: number }, end: { x: number; y: number }) => {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
};

const getMaxAgentSeparation = async (agents: Locator): Promise<number> => {
  const count = await agents.count();
  const centers: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count; i += 1) {
    const box = await agents.nth(i).boundingBox();
    if (!box) throw new Error('Missing agent bounds');
    centers.push({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  }
  let max = 0;
  for (let i = 0; i < centers.length; i += 1) {
    for (let j = i + 1; j < centers.length; j += 1) {
      max = Math.max(max, Math.hypot(centers[i].x - centers[j].x, centers[i].y - centers[j].y));
    }
  }
  return max;
};

const expectAgentsClustered = async (agents: Locator, maxDistance = 6) => {
  // Poll until agents converge — drag/settle is async and React may not have
  // flushed all position updates by the time we first read bounding boxes.
  await expect.poll(() => getMaxAgentSeparation(agents), { timeout: 5_000 }).toBeLessThan(maxDistance);
};

const expectAllAgentsSeparated = async (agents: Locator, minDistance = 16, timeout = 5_000) => {
  await expect
    .poll(
      async () => {
        const count = await agents.count();
        if (count === 0) return true;
        const centers: Array<{ x: number; y: number }> = [];
        for (let i = 0; i < count; i += 1) {
          const box = await agents.nth(i).boundingBox();
          if (!box) return false;
          centers.push({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
        }
        for (let i = 0; i < centers.length; i += 1) {
          for (let j = i + 1; j < centers.length; j += 1) {
            const separation = Math.hypot(centers[i].x - centers[j].x, centers[i].y - centers[j].y);
            if (separation <= minDistance) return false;
          }
        }
        return true;
      },
      { timeout }
    )
    .toBe(true);
};

test('workspace core flow persists settings and attachments', async () => {
  const { page, cleanup, paths } = await launchTestApp({ startInWorkspace: true });
  page.setDefaultTimeout(10_000);
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  const settingsPath = path.join(paths.userData, 'settings.json');
  const folder = page.getByTestId('entity-folder').first();

  try {
    await expect(page.getByTestId('workspace-canvas')).toBeVisible();

    await test.step('select hero provider and persist settings', async () => {
      const dialog = page.getByRole('dialog');
      const dialogVisible = await dialog.isVisible().catch(() => false);
      if (dialogVisible) {
        await dialog.getByRole('button', { name: 'Select Claude' }).click();
        await dialog.getByRole('button', { name: 'Done' }).click();
      }

      await expect
        .poll(async () => {
          try {
            const raw = await fs.readFile(settingsPath, 'utf8');
            return JSON.parse(raw);
          } catch {
            return null;
          }
        })
        .toMatchObject({ heroProvider: 'claude' });

      if (dialogVisible) {
        await expect(dialog).toBeHidden();
      }
    });

    await test.step('create folder', async () => {
      await page.getByTestId('action-create-folder').click();
      await expect(folder).toBeVisible();
    });

    await test.step('create five agents', async () => {
      await page.getByTestId('workspace-canvas').click({ position: { x: 900, y: 200 } });
      const createAgentButton = page.getByTestId('action-create-agent-claude');
      await createAgentButton.click();
      await createAgentButton.click();
      await createAgentButton.click();
      await createAgentButton.click();
      await createAgentButton.click();
      const agents = page.getByTestId('entity-agent');
      await expect(agents).toHaveCount(5);
      await expect(agents.nth(0)).toBeVisible();
      await expect(agents.nth(4)).toBeVisible();
    });

    await test.step('group right-click attach all five from same angle without overlap', async () => {
      const agents = page.getByTestId('entity-agent');
      const folderCenter = await getFolderIconCenter(folder);
      const stagedPositions = Array.from({ length: 5 }, (_, index) => ({
        x: folderCenter.x + 260 + index * 28,
        y: folderCenter.y + 200 + index * 28,
      }));

      for (let i = 0; i < stagedPositions.length; i += 1) {
        await dragEntityTo(page, agents.nth(i), stagedPositions[i]);
      }

      await agents.nth(0).click();
      // Drag select all 5 agents (bounding box roughly from +250,+190 to +450,+350 relative to folder)
      await page.mouse.move(folderCenter.x + 200, folderCenter.y + 150);
      await page.mouse.down();
      await page.mouse.move(folderCenter.x + 600, folderCenter.y + 500);
      await page.mouse.up();
      await expect(page.locator('.agent-entity.selected')).toHaveCount(5, { timeout: 5_000 });
      const folderEntityCenter = await getCenter(folder);
      
      const folderIcon = folder.locator('.folder-icon');
      const box = await folderIcon.boundingBox();
      if (box) {
        const folderId = await folder.getAttribute('data-entity-id');
        await page.evaluate(({ id, cx, cy }) => {
          window.dispatchEvent(new CustomEvent('_test_rightClick', {
            detail: { position: { x: cx, y: cy }, target: { type: 'folder', id } }
          }));
        }, { id: folderId, cx: box.x + box.width / 2, cy: box.y + box.height / 2 });
      }
      try {
        await expect(page.locator('[data-testid="attach-beam"]')).toHaveCount(5, { timeout: 15_000 });
      } catch (err) {
        const logs = await page.evaluate(() => (window as any).TEST_LOGS || []);
        console.error('TEST_LOGS DUMP:', logs.join('\n'));
        throw err;
      }
      await expectAllAgentsSeparated(agents, 40);
    });

    await test.step('drag-select stacked agents onto folder and keep all agents separated after release', async () => {
      const agents = page.getByTestId('entity-agent');
      await expect(agents).toHaveCount(5);
      const folderCenter = await getFolderIconCenter(folder);
      const stackPoint = { x: folderCenter.x + 300, y: folderCenter.y + 220 };

      await page.getByTestId('workspace-canvas').click({ position: { x: 40, y: 40 } });
      await expect(page.locator('.agent-entity.selected')).toHaveCount(0, { timeout: 5_000 });

      for (let i = 0; i < 5; i += 1) {
        await dragEntityTo(page, agents.nth(i), stackPoint);
      }
      await expectAgentsClustered(agents, 8);

      await dragSelectRect(
        page,
        { x: stackPoint.x - 48, y: stackPoint.y - 48 },
        { x: stackPoint.x + 48, y: stackPoint.y + 48 }
      );
      await expect(page.locator('.agent-entity.selected')).toHaveCount(5, { timeout: 5_000 });

      await dragEntityTo(page, agents.nth(0), folderCenter);

      await expect(page.locator('[data-testid="attach-beam"]')).toHaveCount(5, { timeout: 15_000 });
      await expectAllAgentsSeparated(agents, 16, 10_000);
    });
  } finally {
    await cleanup();
  }
});
