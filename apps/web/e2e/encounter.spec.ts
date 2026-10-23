import { expect, test, type Page } from '@playwright/test';

async function newProject(page: Page) {
  await page.goto('/#/create');
  await page.getByLabel('Game name').fill('Arena');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByText('No problems found.')).toBeVisible();
}

const content = (page: Page) => page.getByRole('navigation', { name: 'Content' });
const paint = (page: Page) => page.getByRole('group', { name: /^Encounter board/ });

test('a painted encounter plays in the playtest with the same layout', async ({ page }) => {
  await newProject(page);
  // A blocking wall tile to paint with.
  await page.getByRole('button', { name: 'New tile' }).click();
  await page.getByRole('form', { name: 'New tile' }).getByLabel('Name').fill('Wall');
  await page.getByRole('button', { name: 'Add' }).click();
  await page.getByRole('button', { name: '+ Blocking' }).click();
  await page.getByLabel('Blocking', { exact: true }).check();

  await content(page).getByRole('button', { name: /^First Fight/ }).click();
  await page.getByRole('radio', { name: 'Tiles' }).click();
  await page.getByLabel('Tile brush').selectOption({ label: 'Wall' });
  await paint(page).locator('[data-pos="3"]').click();
  await page.getByRole('radio', { name: 'Units' }).click();
  await page.getByLabel('Unit to place').selectOption({ label: 'Foe' });
  await page.getByLabel('Side to place').selectOption('enemy');
  await paint(page).locator('[data-pos="4"]').click();
  await expect(paint(page).getByRole('button', { name: 'Tile 4, Foe (enemy)' })).toBeVisible();
  await expect(paint(page).getByRole('button', { name: 'Tile 3, Wall' })).toBeVisible();
  await expect(page.getByText('No problems found.')).toBeVisible();

  await page.getByRole('button', { name: 'Playtest' }).click();
  const pane = page.getByRole('region', { name: 'Playtest' });
  await pane.getByLabel('Encounter or scenario').selectOption({ label: 'Encounter: First Fight' });
  await pane.getByRole('button', { name: 'Start' }).click();
  const board = pane.getByRole('group', { name: 'lane board' });
  await expect(board).toBeVisible();
  await expect(board.locator('[data-unit]')).toHaveCount(3);
  for (const [pos, label] of [['0', 'Hero'], ['4', 'Foe'], ['6', 'Foe']]) await expect(board.locator(`[data-unit][data-pos="${pos}"]`)).toHaveAttribute('aria-label', new RegExp(`^${label}`));
  await expect(board.locator('title', { hasText: '3 · Wall' })).toHaveCount(1);
});

test('switching the board from lane to square flags encounters, then moves them onto it', async ({ page }) => {
  await newProject(page);
  await content(page).getByRole('button', { name: /^Rules main/ }).click();
  await page.getByLabel('Board kind').selectOption({ label: 'square' });
  for (const field of ['Width', 'Height']) {
    await page.getByLabel(field, { exact: true }).fill('7');
    await page.getByLabel(field, { exact: true }).press('Enter');
  }
  const banner = page.getByRole('region', { name: 'Encounters off the board' });
  await expect(banner).toContainText('2 encounter positions are off a 7×7 grid.');
  await expect(page.getByRole('region', { name: /Problems/ })).toContainText("'6' is not on the board (a 7×7 grid)");
  await banner.getByRole('button', { name: 'Move encounters onto this board' }).click();
  await expect(banner).toBeHidden();
  await expect(page.getByText('No problems found.')).toBeVisible();
  await content(page).getByRole('button', { name: /^First Fight/ }).click();
  await expect(paint(page).getByRole('button', { name: 'Tile 0,3, Hero (player)' })).toBeVisible();
  await expect(paint(page).getByRole('button', { name: 'Tile 6,3, Foe (enemy)' })).toBeVisible();
});
