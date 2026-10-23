import { expect, test } from '@playwright/test';

test('loads, lists the sandbox game, and starts an encounter', async ({ page }) => {
  await page.goto('/?seed=7');
  await expect(page.getByRole('heading', { name: 'Choose a game' })).toBeVisible();
  await page.getByRole('button', { name: /Sandbox Duel/ }).click();
  await expect(page.getByRole('heading', { name: 'Sandbox Duel' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Your decision');
  await expect(page.getByRole('cell', { name: 'Brute', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Stalk' })).toBeVisible();

  // Play the turn: end it, and the AI's intents resolve in the worker.
  await page.getByRole('button', { name: 'End turn' }).click();
  await expect(page.getByText('Round 2')).toBeVisible();
});
