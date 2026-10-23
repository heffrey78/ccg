import { expect, test, type Page } from '@playwright/test';

async function newProject(page: Page) {
  await page.goto('/#/create');
  await page.getByLabel('Game name').fill('Enemies');
  await page.getByLabel('Blank grid game').check();
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByText('No problems found.')).toBeVisible();
}

const preview = (page: Page) => page.getByRole('complementary', { name: 'Intent preview' });
const rounds = (page: Page) => preview(page).getByRole('list', { name: 'Intents by round' }).locator('strong');

test('previews a conditional behaviour at two positions', async ({ page }) => {
  await newProject(page);
  await page.getByRole('navigation', { name: 'Content' }).getByRole('button', { name: /^Foe foe/ }).click();
  await expect(page.locator('.ccg-behavior-summary').first()).toHaveText('If an enemy is within 1: Hit; otherwise: Advance');
  // The target starts two tiles away: the foe advances, then hits.
  await expect(rounds(page)).toHaveText(['Advance', 'Hit', 'Hit']);
  // Put the target next to it: it hits at once, and telegraphs that tile.
  await preview(page).locator('[data-pos="3,4"]').click();
  await expect(rounds(page)).toHaveText(['Hit', 'Hit', 'Hit']);
  await expect(preview(page).locator('[data-pos="3,4"]')).toHaveClass(/is-on/);
});

test('authors a three-step pattern whose intents fire in order', async ({ page }) => {
  await newProject(page);
  await page.getByRole('button', { name: 'New unit' }).click();
  await page.getByRole('form', { name: 'New unit' }).getByLabel('Name').fill('Drummer');
  await page.getByRole('button', { name: 'Add' }).click();
  await page.getByRole('button', { name: '+ Behavior' }).click();
  await page.getByLabel('Node kind').selectOption('sequence');
  await page.getByRole('button', { name: '+ Add step' }).click();
  await page.getByRole('button', { name: '+ Add step' }).click();
  const steps = page.locator('.ccg-behavior-children > .ccg-behavior-child');
  await expect(steps).toHaveCount(3);
  for (const [i, name] of ['Jab', 'Slam', 'Rest'].entries()) {
    const field = steps.nth(i).getByLabel('Name', { exact: true });
    await field.fill(name);
    await field.press('Enter');
  }
  await expect(page.locator('.ccg-behavior-summary').first()).toHaveText('In turn: Jab → Slam → Rest, then repeat');
  await expect(rounds(page)).toHaveText(['Jab', 'Slam', 'Rest']);
  await expect(page.getByText('No problems found.')).toBeVisible();
});
