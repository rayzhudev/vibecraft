import * as fs from 'fs/promises';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { TUTORIAL_PROMPT_1, TUTORIAL_PROMPT_2 } from '../../src/renderer/tutorial/constants';
import { launchTestApp } from './utils';

test.setTimeout(140_000);

const rectsOverlap = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

const expectTutorialServerReady = async (page: Page, url: string, timeout = 5000) => {
  await expect
    .poll(
      async () => {
        try {
          const response = await page.request.get(url);
          return response.status();
        } catch {
          return 0;
        }
      },
      { timeout }
    )
    .toBe(200);
};

const expectTooltipClearOfEntities = async (page: Page) => {
  if (page.isClosed()) return;
  const overlay = page.locator('.tutorial-overlay');
  if (!(await overlay.isVisible())) return;
  let overlayBox: Awaited<ReturnType<typeof overlay.boundingBox>>;
  try {
    overlayBox = await overlay.boundingBox();
  } catch (error) {
    if (page.isClosed()) return;
    throw error;
  }
  if (!overlayBox) return;

  const entityLocators = [page.getByTestId('entity-folder'), page.getByTestId('entity-agent')];
  for (const locator of entityLocators) {
    const count = await locator.count();
    for (let i = 0; i < count; i += 1) {
      if (page.isClosed()) return;
      const box = await locator.nth(i).boundingBox();
      if (!box) continue;
      expect(rectsOverlap(overlayBox, box), 'Tooltip overlaps a folder or agent entity.').toBe(false);
    }
  }
};

test('startup onboarding prompt appears before entering tutorial from a legacy completed state', async () => {
  const { page, cleanup } = await launchTestApp({
    seedHeroProvider: false,
    tutorialMode: false,
    startInWorkspace: false,
  });
  page.setDefaultTimeout(15_000);

  try {
    await test.step('show startup tutorial choice on home screen', async () => {
      const overlay = page.locator('.tour-opt-in-overlay');
      await expect(overlay).toBeVisible();
      await expect(overlay).toContainText('Welcome to VibeCraft');
      await expect(page.getByTestId('home-select-world')).toBeVisible();
    });

    await test.step('continue into tutorial from startup prompt', async () => {
      await page.getByRole('button', { name: 'Continue?' }).click();
      const tutorialWorld = page.getByTestId('world-item').first();
      await expect(tutorialWorld).toBeVisible();
      await tutorialWorld.click();
      await expect(page.getByTestId('workspace-canvas')).toBeVisible();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByRole('dialog')).toContainText(/choose your hero/i);
    });
  } finally {
    await cleanup();
  }
});

test('tutorial flow uses stubbed agent output and gates browser step (Claude)', async () => {
  const { page, cleanup } = await launchTestApp({
    seedHeroProvider: false,
    tutorialMode: true,
    startInWorkspace: true,
  });
  page.setDefaultTimeout(15_000);

  try {
    await test.step('enter tutorial workspace', async () => {
      await expect(page.getByTestId('workspace-canvas')).toBeVisible();
    });

    await test.step('select hero provider', async () => {
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Select Claude' }).click();
      await dialog.getByRole('button', { name: 'Done' }).click();
      await expect(dialog).toBeHidden();
    });

    await test.step('advance hero intro', async () => {
      const overlay = page.locator('.tutorial-overlay');
      await expect(overlay).toContainText("Hi, I'm Davion.");
      await page.keyboard.press('Enter');
      await expect(overlay).toContainText('Create a Project');
    });

    await test.step('create project and rename', async () => {
      await page.getByTestId('action-create-folder').click();
      const folder = page.getByTestId('entity-folder').first();
      await expect(folder).toBeVisible();

      const label = folder.locator('.folder-label');
      await label.click();
      const input = page.locator('.folder-entity input.folder-rename-input');
      await expect(input).toBeVisible();
      await input.fill('cookie-clicker');
      await page.keyboard.press('Enter');
      await expect(folder).toContainText('cookie-clicker');
      await expect(page.locator('.tutorial-overlay')).not.toContainText('Step');
      await expectTooltipClearOfEntities(page);
    });

    await test.step('create agent and attach to folder', async () => {
      await page.getByTestId('action-create-agent-claude').click();
      const agent = page.getByTestId('entity-agent').first();
      await expect(agent).toBeVisible();
      const folder = page.getByTestId('entity-folder').filter({ hasText: 'cookie-clicker' }).first();

      const agentBox = await agent.boundingBox();
      const folderBox = await folder.boundingBox();
      if (!agentBox || !folderBox) throw new Error('Missing agent or folder bounds');

      const agentCenter = { x: agentBox.x + agentBox.width / 2, y: agentBox.y + agentBox.height / 2 };
      const folderCenter = { x: folderBox.x + folderBox.width / 2, y: folderBox.y + folderBox.height / 2 };

      await page.mouse.move(agentCenter.x, agentCenter.y);
      await page.mouse.down();
      await page.mouse.move(folderCenter.x, folderCenter.y, { steps: 12 });
      await page.mouse.up();

      await expect(page.locator('.attach-beam')).toHaveCount(1, { timeout: 12_000 });
      await expect(agent).toHaveClass(/status-online/, { timeout: 12_000 });
    });

    await test.step('open global chat and send tutorial prompt', async () => {
      await page.keyboard.press('Enter');
      const chat = page.locator('.global-chat-interface');
      await expect(chat).toBeVisible();

      const editor = page.locator('.global-chat-editor');
      await expect(editor).toContainText('cookie clicker', { timeout: 5_000 });
      const promptStart = Date.now();
      await page.keyboard.press('Enter');
      await expect(page.locator('.global-chat-recent')).toContainText(TUTORIAL_PROMPT_1, { timeout: 500 });
      await expect(page.locator('.tutorial-overlay')).toContainText('Open the Agent Terminal', {
        timeout: 500,
      });
      expect(Date.now() - promptStart).toBeLessThan(500);
      await page.keyboard.press('Escape');
    });

    await test.step('open agent terminal', async () => {
      await expect(page.locator('.tutorial-overlay')).toContainText('Open the Agent Terminal', {
        timeout: 10_000,
      });
      await page.getByTestId('action-open-agent-terminal').click();
      await expect(page.getByTestId('agent-terminal')).toBeVisible();
    });

    await test.step('wait for agent terminal output', async () => {
      await expect
        .poll(
          async () => {
            const messageCount = await page.locator('.agent-chat-message').count();
            const toolCount = await page.locator('.agent-chat-tool').count();
            return messageCount > 0 && toolCount > 0;
          },
          { timeout: 45_000 }
        )
        .toBe(true);
    });

    await test.step('close agent terminal', async () => {
      await expect(page.locator('.tutorial-overlay')).toContainText('Close the Agent Terminal', {
        timeout: 10_000,
      });
      await page.getByTestId('action-open-agent-terminal').click();
      await expect(page.getByTestId('agent-terminal')).toBeHidden();
      await expect(page.locator('.tutorial-overlay')).toContainText('Move the Cookie Clicker Folder');
    });

    await test.step('move cookie clicker folder into target zone', async () => {
      const zone = page.locator('[data-tutorial-target="tutorial-move-zone"]');
      await expect(zone).toBeVisible();

      const folder = page.getByTestId('entity-folder').filter({ hasText: 'cookie-clicker' }).first();
      const folderBox = await folder.boundingBox();
      const zoneBox = await zone.boundingBox();
      if (!folderBox || !zoneBox) throw new Error('Missing move zone or folder bounds');

      const folderCenter = { x: folderBox.x + folderBox.width / 2, y: folderBox.y + folderBox.height / 2 };
      const zoneCenter = { x: zoneBox.x + zoneBox.width / 2, y: zoneBox.y + zoneBox.height / 2 };

      await page.mouse.move(folderCenter.x, folderCenter.y);
      await page.mouse.down();
      await page.mouse.move(zoneCenter.x, zoneCenter.y, { steps: 12 });
      await page.mouse.up();

      await expect(page.locator('.attach-beam')).toHaveCount(1);
      await expect(page.locator('.tutorial-overlay')).toContainText('Import An Existing Project', {
        timeout: 10_000,
      });
      await expectTooltipClearOfEntities(page);
    });

    await test.step('create second project and import', async () => {
      await page.getByTestId('action-create-folder').click();
      const folders = page.getByTestId('entity-folder');
      await expect(folders).toHaveCount(2);
      const folder = folders.nth(1);

      await expect(page.locator('.tutorial-overlay')).toContainText('Import the Project');
      const spotlight = page.locator('.tutorial-spotlight');
      await expect(spotlight).toBeVisible();
      await expect(spotlight.locator('rect[fill="rgba(0, 0, 0, 0.6)"]')).toHaveCount(1);
      await expect(spotlight.locator('rect[stroke="rgba(250, 204, 21, 0.95)"]')).toHaveCount(1);

      const label = folder.locator('.folder-label');
      await label.click();
      const input = page.locator('.folder-entity input.folder-rename-input');
      await expect(input).toBeVisible();
      const dropdownButton = folder.locator('.folder-rename-dropdown-btn');
      await dropdownButton.click();
      const dropdown = page.locator('.folder-rename-dropdown');
      await expect(dropdown).toBeVisible();
      await dropdown.locator('.folder-rename-option', { hasText: 'doodle-jump' }).first().click();
      await expect(folder).toContainText('doodle-jump');
    });

    await test.step('create second agent and attach', async () => {
      await page.getByTestId('action-create-agent-claude').click();
      const agents = page.getByTestId('entity-agent');
      await expect(agents).toHaveCount(2);
      const agent = agents.nth(1);
      const folder = page.getByTestId('entity-folder').filter({ hasText: 'doodle-jump' }).first();

      const agentBox = await agent.boundingBox();
      const folderBox = await folder.boundingBox();
      if (!agentBox || !folderBox) throw new Error('Missing agent or folder bounds');

      const agentCenter = { x: agentBox.x + agentBox.width / 2, y: agentBox.y + agentBox.height / 2 };
      const folderCenter = { x: folderBox.x + folderBox.width / 2, y: folderBox.y + folderBox.height / 2 };

      await page.mouse.move(agentCenter.x, agentCenter.y);
      await page.mouse.down();
      await page.mouse.move(folderCenter.x, folderCenter.y, { steps: 12 });
      await page.mouse.up();

      await expect(page.locator('.attach-beam')).toHaveCount(2, { timeout: 12_000 });
      await expect(agent).toHaveClass(/status-online/, { timeout: 12_000 });
    });

    await test.step('open global chat and send second prompt', async () => {
      await page.keyboard.press('Enter');
      const chat = page.locator('.global-chat-interface');
      await expect(chat).toBeVisible();

      const editor = page.locator('.global-chat-editor');
      await expect(editor).toContainText('port 3001', { timeout: 5_000 });
      const promptStart = Date.now();
      await page.keyboard.press('Enter');
      await expect(page.locator('.global-chat-recent')).toContainText(TUTORIAL_PROMPT_2, {
        timeout: 1_000,
      });
      await expect(page.locator('.tutorial-overlay')).toContainText('Open the Cookie Clicker App', {
        timeout: 500,
      });
      expect(Date.now() - promptStart).toBeLessThan(500);
    });

    await test.step('open browser for first site', async () => {
      await expect(page.locator('.tutorial-overlay')).toContainText('Open the Cookie Clicker App', {
        timeout: 45_000,
      });
      await expectTutorialServerReady(page, 'http://127.0.0.1:3000', 5000);
      await page.getByTestId('action-create-browser').click();
      const browser = page.locator('[data-testid="entity-browser"][data-entity-name*="localhost:3000"]');
      await expect(browser).toBeVisible();
    });

    await test.step('open browser for second site', async () => {
      await page.getByTestId('action-create-browser').click();
      await expectTutorialServerReady(page, 'http://127.0.0.1:3001', 5000);
      await expect(page.getByTestId('entity-browser')).toHaveCount(2);
      await expect(
        page.locator('[data-testid="entity-browser"][data-entity-name*="localhost:3001"]')
      ).toHaveCount(1);
      await expect(page.getByTestId('action-create-browser')).toBeDisabled();
    });

    await test.step('hero provider modal stays dismissed after tutorial', async () => {
      await expect(page.getByRole('dialog')).toHaveCount(0);
    });
  } finally {
    await cleanup();
  }
});

test('tutorial supports codex hero-provider selection', async () => {
  const { page, cleanup, paths } = await launchTestApp({
    seedHeroProvider: false,
    tutorialMode: true,
    startInWorkspace: true,
  });
  page.setDefaultTimeout(15_000);

  try {
    await expect(page.getByTestId('workspace-canvas')).toBeVisible();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Select Codex' }).click();
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();

    const settingsPath = path.join(paths.userData, 'settings.json');
    await expect
      .poll(async () => {
        const raw = await fs.readFile(settingsPath, 'utf8');
        const parsed = JSON.parse(raw) as { heroProvider?: string };
        return parsed.heroProvider ?? null;
      })
      .toBe('codex');

    await expect(page.locator('.tutorial-overlay')).toContainText("Hi, I'm Davion.");
  } finally {
    await cleanup();
  }
});
