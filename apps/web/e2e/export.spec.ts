import { expect, test } from '@playwright/test';

// A 1×1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('imports art, exports the project as a zip, and plays it in the play client', async ({ page }) => {
  await page.goto('/#/create');
  await page.getByLabel('Game name').fill('Zip Game');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByText('No problems found.')).toBeVisible();

  // Import an image and use it as Strike's art.
  await page.getByLabel('Import asset files').setInputFiles({ name: 'Strike Art.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('heading', { name: 'strike-art.png' })).toBeVisible();
  await expect(page.getByText('Nothing uses this file.')).toBeVisible();
  await page.getByRole('navigation', { name: 'Content' }).getByRole('button', { name: /^Strike strike/ }).click();
  await page.getByRole('button', { name: '+ Art' }).click();
  await page.getByLabel('Art', { exact: true }).selectOption('assets/images/strike-art.png');
  await expect(page.getByText('No problems found.')).toBeVisible();
  await page.keyboard.press('Control+s');

  const download = page.waitForEvent('download');
  await page.getByText('Export', { exact: true }).click();
  await page.getByRole('button', { name: 'Export zip' }).click();
  const zip = await (await download).path();
  expect((await download).suggestedFilename()).toBe('zip-game-0.1.0.zip');

  // Load the zip in the play client and play the encounter.
  await page.goto('/#/');
  await page.getByLabel('Load a game from a zip…').setInputFiles(zip);
  await page.getByRole('button', { name: /Zip Game/ }).click();
  await expect(page.getByRole('status')).toHaveText('Your decision');
  await expect(page.getByRole('group', { name: 'lane board' })).toBeVisible();
  await expect(page.locator('[data-unit][aria-label^="Foe, enemy, 20 of 20 HP, intends Advance"]')).toBeVisible();
  const strike = page.getByRole('list', { name: 'Hand' }).getByRole('button', { name: /^Strike/ }).first();
  await expect(strike.locator('img')).toHaveAttribute('src', /^blob:/);
  await page.getByRole('button', { name: 'End turn' }).click();
  await expect(page.locator('header').getByText('Round 2')).toBeVisible();
});
