import { expect, test } from '@playwright/test';

test('a theme is made in the editor, previews live, warns on low contrast, and themes the playtest (#136)', async ({ page }) => {
  await page.goto('/#/create');
  await page.getByLabel('Game name').fill('Themed');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'New theme' }).click();
  await page.getByRole('navigation', { name: 'Content' }).getByLabel('Name').fill('Night');
  await page.getByRole('button', { name: 'Add' }).click();

  const field = (pointer: string) => page.locator(`[data-pointer="${pointer}"] input:not([type=color])`).first();
  const commit = async (pointer: string, value: string) => {
    await field(pointer).fill(value);
    await field(pointer).press('Enter');
  };
  const colors = page.locator('[data-pointer="/colors"]');
  const preview = page.getByRole('complementary', { name: 'Theme preview' });
  const panel = preview.locator('.ccg-theme-panel');

  // The preview follows each colour as it's set.
  await colors.getByRole('button', { name: '+ Panel', exact: true }).click();
  await commit('/colors/panel', '#1f2a1f');
  await expect(panel).toHaveCSS('background-color', 'rgb(31, 42, 31)');
  await colors.getByRole('button', { name: '+ Ink', exact: true }).click();
  await commit('/colors/ink', '#e6f0dc');
  await expect(panel).toHaveCSS('color', 'rgb(230, 240, 220)');
  // Warnings (the default light page under light text) are listed but aren't errors.
  const problems = page.getByRole('region', { name: /Problems/ });
  await expect(problems.locator('.ccg-badge').first()).toHaveText('0');
  await expect(page.locator('[data-pointer="/colors/ink"] .ccg-warning')).toHaveCount(0);

  // Dark text on the dark panel is flagged as a warning, which doesn't count as a problem.
  await commit('/colors/ink', '#333333');
  await expect(page.locator('[data-pointer="/colors/ink"] .ccg-warning')).toContainText('below 4.5:1');
  await expect(problems.locator('.ccg-badge.is-warn')).toBeVisible();
  await expect(problems.locator('.ccg-badge').first()).toHaveText('0');
  await commit('/colors/ink', '#e6f0dc');
  await expect(page.locator('[data-pointer="/colors/ink"] .ccg-warning')).toHaveCount(0);

  // The playtest plays in the theme.
  await page.getByRole('button', { name: 'Playtest' }).click();
  const pane = page.getByRole('region', { name: 'Playtest' });
  await pane.getByRole('button', { name: 'Start' }).click();
  await expect(pane.locator('.ccg-encounter.ccg-themed')).toBeVisible();
  await expect(pane.locator('.ccg-tray')).toHaveCSS('background-color', 'rgb(31, 42, 31)');
});
