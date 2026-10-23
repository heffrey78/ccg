import { expect, test, type Page } from '@playwright/test';

async function newProject(page: Page, name: string) {
  await page.goto('/#/create');
  await expect(page.getByRole('heading', { name: 'Create a game' })).toBeVisible();
  await page.getByLabel('Game name').fill(name);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
  await expect(page.getByText('No problems found.')).toBeVisible();
}

const browser = (page: Page) => page.getByRole('navigation', { name: 'Content' });
const problems = (page: Page) => page.getByRole('region', { name: /Problems/ });

test('creates a project, adds a card, saves to IndexedDB, and reopens it after a reload', async ({ page }) => {
  await newProject(page, 'Test Game');
  await expect(page.getByText('Saved in this browser')).toBeVisible();

  await page.getByRole('button', { name: 'New card' }).click();
  await page.getByRole('form', { name: 'New card' }).getByLabel('Name').fill('Zap');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByRole('heading', { name: 'Zap', level: 2 })).toBeVisible();
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  await page.keyboard.press('Control+s');
  await expect(page.getByText('Saved in this browser')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Create a game' })).toBeVisible();
  await page.getByRole('button', { name: 'Test Game' }).click();
  await expect(browser(page).getByRole('button', { name: /^Zap zap/ })).toBeVisible();
  await expect(browser(page).getByRole('button', { name: /^Strike strike/ })).toBeVisible();
});

test('renames with references, undoes, and jumps from a problem to the field', async ({ page }) => {
  await newProject(page, 'Refs');
  await browser(page).getByRole('button', { name: /^Foe foe/ }).click();
  await expect(page.getByRole('region', { name: 'Foe' }).getByRole('button', { name: 'First Fight' })).toBeVisible();

  // Change the id: the encounter that places the foe follows.
  await page.getByLabel('Id').fill('brute');
  await page.getByLabel('Id').press('Enter');
  await expect(browser(page).getByRole('button', { name: /^Foe brute/ })).toBeVisible();
  await browser(page).getByRole('button', { name: /^First Fight/ }).click();
  await expect(page.getByLabel('Item data')).toContainText('"unit": "brute"');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByLabel('Item data')).toContainText('"unit": "foe"');

  // Delete the foe: the encounter now points at nothing.
  await browser(page).getByRole('button', { name: /^Foe foe/ }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog', { name: 'Confirm delete' }).getByRole('button', { name: 'Delete' }).click();
  await expect(problems(page).getByText("unknown unit 'foe'")).toBeVisible();
  await problems(page).getByRole('button', { name: 'First Fight (encounter)' }).click();
  await expect(page.locator('.ccg-json [data-pointer="/units/1/unit"]')).toHaveClass(/is-highlighted/);

  await page.keyboard.press('Control+z');
  await expect(page.getByText('No problems found.')).toBeVisible();
});
