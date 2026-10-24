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

test('difficulty levels are set in the ruleset form and compared in the balance panel (#125)', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/#/create');
  await page.getByLabel('Game name').fill('Levels');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('navigation', { name: 'Content' }).getByRole('button', { name: /^Rules main/ }).click();
  const field = (pointer: string) => page.locator(`[data-pointer="${pointer}"] input`).first();
  const commit = async (pointer: string, value: string) => {
    await field(pointer).fill(value);
    await field(pointer).press('Enter');
  };
  await page.getByRole('button', { name: '+ Difficulty' }).click();
  await commit('/difficulty/levels/0/id', 'easy');
  await commit('/difficulty/levels/0/name', 'Easy');
  await page.getByRole('button', { name: '+ Add levels' }).click();
  await commit('/difficulty/levels/1/id', 'brutal');
  await commit('/difficulty/levels/1/name', 'Brutal');
  await page.locator('[data-pointer="/difficulty/levels/1"]').getByRole('button', { name: '+ Enemy hp' }).click();
  await expect(page.getByText("Enemy units' HP, as a percentage")).toBeVisible();
  await commit('/difficulty/levels/1/enemyHp', '500');
  await page.locator('[data-pointer="/difficulty/levels/1"]').getByRole('button', { name: '+ Enemy damage' }).click();
  await commit('/difficulty/levels/1/enemyDamage', '1000');
  await expect(page.getByText('No problems found.')).toBeVisible();

  await page.getByRole('button', { name: 'Balance' }).click();
  const panel = page.getByRole('region', { name: /Balance/ });
  await panel.getByLabel('Difficulty').selectOption({ label: 'Compare every level' });
  await panel.getByLabel('Games').fill('20');
  await panel.getByRole('button', { name: 'Simulate' }).click();
  const byLevel = panel.locator('figure', { hasText: 'Player wins at each difficulty' });
  await expect(byLevel).toBeVisible({ timeout: 60_000 });
  await expect(byLevel.getByRole('row', { name: /Easy/ })).toContainText('%');
  await expect(byLevel.getByRole('row', { name: /Brutal/ })).toContainText('%');

  // One level at a time: Brutal's five-times-tougher foe makes games last longer.
  const rounds = async (level: string) => {
    await panel.getByLabel('Difficulty').selectOption({ label: level });
    await panel.getByRole('button', { name: 'Simulate' }).click();
    const results = panel.getByLabel('Balance results');
    await expect(results).toContainText(`seeds 1–20, ${level}`, { timeout: 60_000 });
    return Number(await results.getByRole('group', { name: 'Rounds per game' }).locator('.ccg-tile-value').textContent());
  };
  expect(await rounds('Brutal')).toBeGreaterThan(await rounds('Easy'));
});
