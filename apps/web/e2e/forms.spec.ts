import { expect, test, type Page } from '@playwright/test';

async function openItem(page: Page, name: RegExp) {
  await page.goto('/#/create');
  await page.getByLabel('Game name').fill('Forms');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByText('No problems found.')).toBeVisible();
  await page.getByRole('navigation', { name: 'Content' }).getByRole('button', { name }).click();
}

const cardText = (page: Page) => page.getByLabel('Card text');

test('composes a card: palette effect, cost, targeting pattern, variables', async ({ page }) => {
  await openItem(page, /^Strike strike/);
  await expect(cardText(page)).toHaveText('Deal 6 damage.');

  // Add an effect from the palette and set its parameter.
  await page.getByRole('button', { name: '+ Add effect' }).click();
  await page.getByRole('searchbox', { name: 'Search effects' }).fill('block');
  await page.getByRole('dialog', { name: 'Add effect' }).getByRole('button', { name: 'Gain block' }).click();
  const block = page.locator('.ccg-effect[aria-label="Gain block"]');
  await block.getByLabel('Amount', { exact: true }).fill('3');
  await block.getByLabel('Amount', { exact: true }).press('Enter');
  await expect(cardText(page)).toHaveText('Deal 6 damage. Gain 3 block.');

  // Move it first, then switch Damage's amount to a variable.
  await block.getByRole('button', { name: 'Move effect up' }).click();
  await expect(cardText(page)).toHaveText('Gain 3 block. Deal 6 damage.');
  await page.locator('.ccg-effect[aria-label="Damage"]').getByRole('button', { name: 'Amount: use a variable' }).click();
  await expect(cardText(page)).toHaveText('Gain 3 block. Deal X damage.');

  // Cost across pools.
  await page.getByLabel('Cost: energy').fill('2');
  await page.getByLabel('Cost: energy').press('Enter');
  await page.getByLabel('Cost: resource').fill('focus');
  await page.getByRole('button', { name: '+ Cost' }).click();

  // Targeting: a cone of 2, previewed on the lane and then a square grid.
  await page.getByLabel('Targeting kind').selectOption({ label: 'pattern' });
  await page.getByLabel('Shape shape').selectOption('cone');
  await expect(page.getByRole('group', { name: 'Shape preview, 2 cells' })).toBeVisible();
  await page.getByRole('radio', { name: 'square' }).click();
  await expect(page.getByRole('group', { name: 'Shape preview, 4 cells' })).toBeVisible();

  await expect(page.getByText('No problems found.')).toBeVisible();
  const raw = page.getByLabel('Item data');
  await expect(raw).toContainText('"focus": 1');
  await expect(raw).toContainText('"$": "target"');

  // Every edit was its own undo step.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByLabel('Targeting kind')).toHaveValue('5');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByLabel('Targeting kind')).toHaveValue('2');
});

test('shows validation errors on the field, and picks references from the project', async ({ page }) => {
  await openItem(page, /^Hero hero/);
  await page.getByLabel('Hp', { exact: true }).fill('0');
  await page.getByLabel('Hp', { exact: true }).press('Enter');
  const row = page.locator('.ccg-form-row[data-pointer="/hp"]');
  await expect(row).toHaveClass(/has-error/);
  await expect(row.locator('.ccg-error')).toContainText(/>=\s*1|at least 1/);
  await page.getByRole('region', { name: /Problems/ }).getByRole('button', { name: 'Hero (unit)' }).click();
  await expect(row).toHaveClass(/is-flagged/);

  // Encounter units pick from the project's units.
  await page.getByRole('navigation', { name: 'Content' }).getByRole('button', { name: /^First Fight/ }).click();
  const unit = page.locator('.ccg-form-row[data-pointer="/units/1/unit"] select');
  await expect(unit.locator('option')).toHaveText(['Foe (foe)', 'Hero (hero)']);
  await unit.selectOption('hero');
  await expect(page.getByLabel('Item data')).toContainText('"unit": "hero"');
});
