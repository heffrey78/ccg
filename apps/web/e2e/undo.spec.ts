import { expect, test } from '@playwright/test';

test('plays a card, undoes it, and the card is back in hand', async ({ page }) => {
  await page.goto('/?seed=4&encounter=duel:close-quarters');
  await page.getByRole('button', { name: /^Duel/ }).click();
  await expect(page.getByRole('status')).toHaveText('Your decision');
  const hand = page.getByRole('list', { name: 'Hand' });
  await expect(page.getByRole('button', { name: 'Undo' })).toBeHidden();

  await hand.getByRole('button', { name: /^Iron Skin/ }).click();
  await expect(page.locator('[data-unit][aria-label^="Hero, yours, 30 of 35 HP"]')).toBeVisible();
  await expect(hand.getByRole('button', { name: /^Iron Skin/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(hand.getByRole('button', { name: /^Iron Skin/ })).toHaveCount(1);
  await expect(page.locator('[data-unit][aria-label^="Hero, yours, 30 of 30 HP"]')).toBeVisible();
  await expect(page.getByLabel('Resources')).toContainText('3 energy');
  await expect(page.getByRole('button', { name: 'Undo' })).toBeHidden();

  // Z undoes too; ending the turn can't be undone.
  await hand.getByRole('button', { name: /^Iron Skin/ }).click();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
  await page.keyboard.press('z');
  await expect(hand.getByRole('button', { name: /^Iron Skin/ })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeHidden();
  await page.getByRole('button', { name: 'End turn' }).click();
  await expect(page.getByRole('status')).toHaveText('Your response');
  await expect(page.getByRole('button', { name: 'Undo' })).toBeHidden();
});
