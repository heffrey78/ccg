import { expect, test } from '@playwright/test';

test('walks the example game’s fungal-network map: fight, choose a path, a spring, the boss', async ({ page }) => {
  await page.goto('/?seed=2');
  await page.getByRole('button', { name: /^Duel/ }).click();
  await expect(page.getByText('Encounter 1 of 3')).toBeVisible();

  // The practice dummy (6 HP) falls to one strike.
  await page.getByRole('list', { name: 'Hand' }).getByRole('button', { name: /^Strike/ }).first().click();
  await page.getByRole('group', { name: 'Choose a target' }).getByRole('button', { name: /Play Strike → Training Dummy/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Choose a card to add to your deck.');
  await dialog.getByRole('button', { name: 'Skip' }).click();

  await expect(dialog.getByRole('heading', { name: 'Choose your path' })).toBeVisible();
  const map = dialog.getByRole('group', { name: 'Run map' });
  await expect(map.getByRole('button')).toHaveCount(2);
  await map.getByRole('button', { name: 'Go to Spring (spring)' }).click();
  await expect(dialog).toContainText('The spring restores 30% of your HP.');
  await map.getByRole('button', { name: 'Go to First Fight (boss)' }).click();
  await expect(page.getByText('Encounter 3 of 3')).toBeVisible();
  await expect(page.getByRole('status')).toHaveText(/Your (decision|response)/);
});
