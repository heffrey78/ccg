import { expect, test } from '@playwright/test';

test('simulates 500 games in the editor quickly, with the same results for the same seeds', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/#/create');
  await page.getByLabel('Game name').fill('Balanced');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Balance' }).click();
  const panel = page.getByRole('region', { name: /Balance/ });
  await panel.getByLabel('Games').fill('500');

  const started = Date.now();
  await panel.getByRole('button', { name: 'Simulate' }).click();
  const results = panel.getByLabel('Balance results');
  await expect(results).toBeVisible({ timeout: 120_000 });
  expect(Date.now() - started).toBeLessThan(120_000);
  await expect(results).toContainText('500 games of First Fight, greedy player, seeds 1–500');
  await expect(results.getByRole('group', { name: 'Player wins' })).toContainText('%');
  await expect(results.locator('figure', { hasText: 'Card plays per game' }).getByRole('row', { name: /Strike/ })).toBeVisible();
  const first = await results.locator('.ccg-tiles, .ccg-charts').allTextContents();

  await panel.getByRole('button', { name: 'Simulate' }).click();
  await expect(panel.getByRole('button', { name: 'Simulate' })).toBeEnabled({ timeout: 120_000 });
  expect(await results.locator('.ccg-tiles, .ccg-charts').allTextContents()).toEqual(first);
});
