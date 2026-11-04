import * as fs from 'fs/promises';
import * as path from 'path';
import { expect, test } from '@playwright/test';
import { launchTestApp } from './utils';

test.setTimeout(90_000);

test('Maitrix connector, Zero-Blocker Auto-Proceed settings, and Maitrix Agent spawn work in live Electron UI', async () => {
  const { page, cleanup, paths } = await launchTestApp({
    seedHeroProvider: false,
    tutorialMode: false,
    startInWorkspace: false,
  });
  page.setDefaultTimeout(15_000);
  const settingsPath = path.join(paths.userData, 'settings.json');

  try {
    await test.step('dismiss startup tour prompt if shown and open Settings from Home screen', async () => {
      await page
        .locator('[data-settings-status="loaded"]')
        .waitFor({ state: 'attached', timeout: 10_000 })
        .catch(() => {});

      const startupOverlay = page.locator('.tour-opt-in-overlay');
      if (await startupOverlay.isVisible({ timeout: 1_000 }).catch(() => false)) {
        // Click outside or dismiss to stay on Home, or navigate back if Continue goes to world selection
        await startupOverlay.getByRole('button', { name: 'Continue?' }).click();
        const backBtn = page.locator('.titlebar-home-btn');
        if (await backBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
          await backBtn.click();
        }
      }

      const settingsBtn = page.getByTestId('home-settings');
      await expect(settingsBtn).toBeVisible();
      await settingsBtn.click();
      await expect(page.locator('.settings-screen')).toBeVisible();
    });

    await test.step('verify Auto-Proceed (Zero-Blocker Mode) and Maitrix provider in Settings → Agents', async () => {
      await page.locator('.settings-sidebar-item', { hasText: 'Agents' }).click();

      const autoProceedCard = page.getByTestId('auto-proceed-card');
      await expect(autoProceedCard).toBeVisible();
      await expect(autoProceedCard).toContainText('Auto-Proceed (Zero-Blocker Mode)');
      await expect(autoProceedCard).toContainText('Unstoppable');

      const checkbox = autoProceedCard.getByRole('checkbox', {
        name: 'Auto-Proceed (Zero-Blocker Mode)',
      });
      await expect(checkbox).toBeChecked();

      // Toggle off and back on, verifying persistence in settings.json
      await checkbox.click();
      await expect
        .poll(async () => {
          const raw = await fs.readFile(settingsPath, 'utf8');
          return (JSON.parse(raw) as { autoProceed?: boolean }).autoProceed;
        })
        .toBe(false);

      await checkbox.click();
      await expect
        .poll(async () => {
          const raw = await fs.readFile(settingsPath, 'utf8');
          return (JSON.parse(raw) as { autoProceed?: boolean }).autoProceed;
        })
        .toBe(true);

      // Verify Maitrix provider row is rendered in the Agents provider list
      await expect(page.locator('.agent-provider-name', { hasText: 'Maitrix' })).toBeVisible();
    });

    await test.step('verify Maitrix Link section in Settings', async () => {
      await page.locator('.settings-sidebar-item', { hasText: 'Maitrix Link' }).click();
      await expect(page.locator('.settings-section-title', { hasText: 'Maitrix Link' })).toBeVisible();
      await expect(
        page.locator('.maitrix-link-hint', {
          hasText: 'Unified Multi-Model Router:',
        })
      ).toBeVisible();
    });

    await test.step('enter workspace, select Maitrix hero provider, and spawn a Maitrix Agent on canvas', async () => {
      await page.locator('.titlebar-home-btn').click();
      await page.getByTestId('home-select-world').click();
      const worldItem = page.getByTestId('world-item').first();
      await expect(worldItem).toBeVisible();
      await worldItem.click();

      await expect(page.getByTestId('workspace-canvas')).toBeVisible();

      const dialog = page.getByRole('dialog');
      if (await dialog.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await dialog.getByRole('button', { name: 'Select Maitrix' }).click();
        await dialog.getByRole('button', { name: 'Done' }).click();
        await expect(dialog).toBeHidden();
      }

      await expect
        .poll(async () => {
          const raw = await fs.readFile(settingsPath, 'utf8');
          return (JSON.parse(raw) as { heroProvider?: string }).heroProvider;
        })
        .toBe('maitrix');

      // Select the Maitrix variant from the HUD Agent split-button dropdown and spawn a Maitrix Agent
      await page.getByRole('button', { name: 'Select variant' }).click();
      const maitrixVariantBtn = page.getByTestId('action-variant-create-agent-maitrix');
      await expect(maitrixVariantBtn).toBeVisible();
      await maitrixVariantBtn.click();

      const createAgentBtn = page.getByTestId('action-create-agent-claude');
      await expect(createAgentBtn).toBeVisible();
      await createAgentBtn.click();

      const agents = page.getByTestId('entity-agent');
      await expect(agents).toHaveCount(1);
      await expect(agents.first()).toBeVisible();
    });
  } finally {
    await cleanup();
  }
});
