import { expect, test, type Page } from '@playwright/test';

/** Seed 7 deals Lunge, Jab, Shove, Lunge: the duelist starts at 0 and the brute at 6. */
async function start(page: Page) {
  await page.goto('/?seed=7');
  await expect(page.getByRole('heading', { name: 'Choose a game' })).toBeVisible();
  await page.getByRole('button', { name: /Sandbox Duel/ }).click();
  await expect(page.getByRole('heading', { name: 'Sandbox Duel' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Your decision');
}

const log = (page: Page) => page.getByRole('region', { name: 'Log' });

test('draws the board and telegraphs the enemy intent', async ({ page }) => {
  await start(page);
  await expect(page.getByRole('group', { name: 'lane board' })).toBeVisible();
  await expect(page.locator('[data-unit]')).toHaveCount(2);
  await expect(page.locator('[data-unit][aria-label^="Brute, enemy, 18 of 18 HP, intends Stalk"]')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Hand' }).getByRole('button')).toHaveCount(4);
  await page.locator('[data-unit][aria-label^="Brute"]').hover();
  await expect(page.getByRole('region', { name: 'Unit details' })).toContainText('Intent: Stalk');

  await page.getByRole('button', { name: 'End turn' }).click();
  await expect(page.locator('header').getByText('Round 2')).toBeVisible();
  await expect(log(page)).toContainText('Brute moves to 4');
});

test('plays a card with the mouse: pick the card, then its target on the board', async ({ page }) => {
  await start(page);
  await page.getByRole('list', { name: 'Hand' }).getByRole('button', { name: /^Lunge/ }).first().click();
  // Lunge picks a direction: forward is drawn on the next tile.
  await page.locator('.ccg-board').getByRole('button', { name: 'Play Lunge → forward' }).click();
  await expect(log(page)).toContainText('You played Lunge');
  await expect(log(page)).toContainText('Duelist moves to 2');
  await expect(page.getByLabel('Resources')).toContainText('2 energy');
  await expect(page.getByRole('list', { name: 'Hand' }).getByRole('button')).toHaveCount(3);
});

test('plays a card and ends the turn with the keyboard only', async ({ page }) => {
  await start(page);
  await page.keyboard.press('1');
  await expect(page.getByRole('group', { name: 'Choose a target' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('group', { name: 'Choose a target' })).toBeHidden();

  await page.keyboard.press('1');
  await page.keyboard.press('Enter');
  await expect(log(page)).toContainText('Duelist moves to 2');
  // The brute is out of Jab's reach, so 1 is now Jab and does nothing; the second Lunge is 3.
  await page.keyboard.press('3');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  await expect(log(page)).toContainText('Duelist moves to 4');
  await page.keyboard.press('e');
  await expect(page.locator('header').getByText('Round 2')).toBeVisible();
  // Now adjacent, the brute telegraphs a 5-damage Smash.
  await expect(page.locator('[data-unit][aria-label*="intends Smash"]')).toBeVisible();
  await expect(page.locator('.ccg-intent').getByText('⚔ 5')).toBeVisible();
  // Round 2 deals Jab first; the brute is in reach now.
  await page.keyboard.press('1');
  await expect(page.getByRole('group', { name: 'Choose a target' }).getByRole('button', { name: 'Play Jab → Brute' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(log(page)).toContainText('Brute takes 4 damage');
  await expect(page.locator('[data-unit][aria-label^="Brute, enemy, 14 of 18 HP"]')).toBeVisible();
});

test('the debug view still lists every legal action', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'Debug view' }).click();
  await expect(page.getByRole('cell', { name: 'Brute', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Board view' }).click();
  await expect(page.getByRole('group', { name: 'lane board' })).toBeVisible();
});
