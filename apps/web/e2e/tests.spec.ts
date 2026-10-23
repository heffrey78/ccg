import { expect, test } from '@playwright/test';

test('scenario expectations run as tests in the editor', async ({ page }) => {
  await page.goto('/#/create');
  await page.getByLabel('Game name').fill('Tested');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'New scenario' }).click();
  await page.getByRole('form', { name: 'New scenario' }).getByLabel('Name').fill('Opening');
  await page.getByRole('button', { name: 'Add' }).click();
  await page.getByRole('button', { name: '+ Expect' }).click();
  await page.getByRole('button', { name: '+ Add expect' }).click();
  await page.getByLabel('Winner', { exact: true }).selectOption('player');

  const results = page.getByRole('list', { name: 'Test results' });
  await page.getByRole('button', { name: 'Run tests' }).click();
  await expect(results.getByRole('listitem')).toHaveText(['✗ Openingexpected the player to win, but it goes on']);

  await page.getByLabel('Winner', { exact: true }).selectOption('none');
  await page.getByRole('button', { name: 'Run tests' }).click();
  await expect(results.getByRole('listitem')).toHaveText(['✓ Opening']);
});
