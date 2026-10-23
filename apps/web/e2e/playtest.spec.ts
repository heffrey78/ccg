import { expect, test, type Page } from '@playwright/test';

const pane = (page: Page) => page.getByRole('region', { name: 'Playtest' });
const hand = (page: Page) => pane(page).getByRole('list', { name: 'Hand' });

test('playtests the project, applies an edit mid-game, and saves a scenario', async ({ page }) => {
  await page.goto('/#/create');
  await page.getByLabel('Game name').fill('Live');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByText('No problems found.')).toBeVisible();

  await page.getByRole('button', { name: 'Playtest' }).click();
  await pane(page).getByLabel('Encounter or scenario').selectOption({ label: 'Encounter: First Fight' });
  await pane(page).getByLabel('Seed').fill('2');
  await pane(page).getByRole('button', { name: 'Start' }).click();
  await expect(pane(page).getByRole('status').filter({ hasText: 'Your decision' })).toBeVisible();
  await expect(pane(page).getByRole('group', { name: 'lane board' })).toBeVisible();
  const opening = await hand(page).locator('.ccg-card-name').allTextContents();

  // Guard targets yourself, so it plays straight from the hand.
  await hand(page).getByRole('button', { name: /^Guard/ }).first().click();
  await expect(pane(page).locator('[data-unit][aria-label*="Hero, yours"][aria-label*="5 block"]')).toBeVisible();

  // Edit Guard while the game runs: the next Guard uses the new value.
  await page.getByRole('navigation', { name: 'Content' }).getByRole('button', { name: /^Guard guard/ }).click();
  const amount = page.locator('.ccg-effect[aria-label="Gain block"]').getByLabel('Amount', { exact: true });
  await amount.fill('8');
  await amount.press('Enter');
  await expect(page.getByLabel('Playtest status')).toHaveText('Changes applied: the game continues with them.');
  await hand(page).getByRole('button', { name: /^Guard/ }).first().click();
  await expect(pane(page).locator('[data-unit][aria-label*="Hero, yours"][aria-label*="13 block"]')).toBeVisible();

  // Save the setup as a scenario and rerun it: the same opening hand (now with the edited Guard).
  await pane(page).getByRole('button', { name: 'Save as scenario' }).click();
  await expect(page.getByRole('heading', { name: 'First Fight (seed 2)', level: 2 })).toBeVisible();
  await expect(pane(page).getByLabel('Encounter or scenario')).toHaveValue('scenario:first-fight-seed-2');
  await pane(page).getByRole('button', { name: 'Restart' }).click();
  await expect(pane(page).getByRole('status').filter({ hasText: 'Your decision' })).toBeVisible();
  await expect(hand(page).locator('.ccg-card-name')).toHaveText(opening);
  await expect(hand(page).getByRole('button', { name: /^Guard/ }).first()).toContainText('Gain 8 block.');
});
