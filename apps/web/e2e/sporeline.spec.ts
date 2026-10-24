import { expect, test } from '@playwright/test';

test('Sporeline starts a run on its fungal network: a lane of 9 in the dark, bugs on the way', async ({ page }) => {
  await page.goto('/?seed=3');
  await page.getByRole('button', { name: /^Sporeline/ }).click();
  await expect(page.getByRole('status')).toHaveText('Your decision');
  await expect(page.getByText('Encounter 1 of 7')).toBeVisible();
  await expect(page.locator('.ccg-board .ccg-cell')).toHaveCount(9);
  await expect(page.locator('[data-unit][aria-label^="The Knot, yours, 40 of 40 HP"]')).toBeVisible();
  // Sight 3: the far end of the lane is dark, and the leafcutters there are unseen.
  await expect(page.locator('.ccg-cell.is-fogged')).toHaveCount(5);
  await expect(page.locator('[data-unit][aria-label^="Leafcutter"]')).toHaveCount(0);
  await expect(page.getByLabel('Resources')).toContainText('3 sap');
  // The art: the encounter's scene, the Knot's sprite, and every card in hand has art.
  await expect(page.locator('.ccg-board image.ccg-scene')).toHaveAttribute('href', /^blob:/);
  await expect(page.locator('[data-unit][aria-label^="The Knot"] image.ccg-unit-sprite')).toHaveCount(1);
  await expect(page.getByRole('list', { name: 'Hand' }).locator('img.ccg-card-art')).toHaveCount(5);
  await expect(page.getByRole('list', { name: 'Hand' }).getByRole('button')).toHaveCount(5);
  await page.getByRole('button', { name: 'End turn' }).click();
  await expect(page.locator('header').getByText('Round 2')).toBeVisible();
  // The leafcutters march out of the dark.
  await expect(page.locator('[data-unit][aria-label^="Leafcutter"]').first()).toBeVisible();
});
