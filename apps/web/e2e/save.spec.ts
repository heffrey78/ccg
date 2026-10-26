import { expect, test } from '@playwright/test';

test('a game in progress survives a reload: Continue picks it up exactly where it was (#144)', async ({ page }) => {
  await page.goto('/?seed=3');
  await expect(page.getByRole('group', { name: 'Saved game' })).toHaveCount(0);
  await page.getByRole('button', { name: /^Sporeline/ }).click();
  await expect(page.getByRole('status')).toHaveText('Your decision');
  // Instant, so the board shows each round's result rather than an animation of it.
  await page.getByLabel('Animation').selectOption('0');
  for (let round = 2; round <= 3; round++) {
    await page.getByRole('button', { name: 'End turn' }).click();
    await expect(page.locator('header').getByText(`Round ${round}`)).toBeVisible();
  }
  await expect(page.getByRole('status')).toHaveText('Your decision');
  const units = () => page.locator('[data-unit]').evaluateAll((els) => els.map((e) => `${e.getAttribute('aria-label')}@${e.getAttribute('data-pos')}`).sort());
  const hand = () => page.getByRole('list', { name: 'Hand' }).getByRole('button').allTextContents();
  const before = { units: await units(), hand: await hand() };

  await page.reload();
  const saved = page.getByRole('group', { name: 'Saved game' });
  await expect(saved).toContainText('Encounter 1 of 7, round 3');
  await saved.getByRole('button', { name: 'Continue Sporeline' }).click();
  await expect(page.locator('header').getByText('Round 3')).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Your decision');
  expect({ units: await units(), hand: await hand() }).toEqual(before);
});
