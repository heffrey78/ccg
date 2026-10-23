import { expect, test } from '@playwright/test';

test('steps through a playtest, rewinds, branches, and saves a regression test', async ({ page }) => {
  await page.goto('/#/create');
  await page.getByLabel('Game name').fill('Debugged');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByText('No problems found.')).toBeVisible();
  await page.getByRole('button', { name: 'Playtest' }).click();
  const pane = page.getByRole('region', { name: 'Playtest' });
  await pane.getByLabel('Encounter or scenario').selectOption({ label: 'Encounter: First Fight' });
  await pane.getByRole('button', { name: 'Start' }).click();
  for (const round of [2, 3, 4]) {
    await pane.getByRole('button', { name: 'End turn' }).click();
    await expect(pane.locator('header').getByText(`Round ${round}`)).toBeVisible();
  }

  await pane.getByRole('button', { name: 'Debugger' }).click();
  const debug = pane.getByRole('region', { name: 'Debugger' });
  await expect(debug.getByText('Step 3 of 3')).toBeVisible();
  await expect(debug.getByRole('list', { name: 'Timeline' }).getByRole('listitem')).toHaveCount(4);
  await expect(debug.getByRole('list', { name: 'Events' }).getByRole('listitem').first()).toBeVisible();

  // Step back to the first action: the state shows what it changed.
  await debug.getByRole('button', { name: 'Step back' }).click();
  await debug.getByRole('button', { name: 'Step back' }).click();
  await expect(debug.getByText('Step 1 of 3')).toBeVisible();
  await expect(debug.locator('.ccg-tree-leaf.is-changed').first()).toBeVisible();
  await debug.getByLabel('Filter events').fill('RoundStarted');
  await expect(debug.getByRole('list', { name: 'Events' }).getByRole('listitem')).toHaveText(['RoundStarted round=2']);
  await debug.getByRole('radio', { name: "player's view" }).click();
  await expect(debug.getByLabel('State')).toContainText('world');

  // Branch: the later actions are dropped and the game goes on from step 1.
  await debug.getByRole('button', { name: 'Branch from here' }).click();
  await expect(page.getByLabel('Playtest status')).toHaveText('Rewound to step 1; play on from here.');
  await expect(pane.locator('header').getByText('Round 2')).toBeVisible();
  await expect(debug.getByText('Step 1 of 1')).toBeVisible();

  // Save what happened as a test, and run it.
  await debug.getByRole('button', { name: 'Save as test' }).click();
  await expect(page.getByRole('heading', { name: 'First Fight: 1 actions', level: 2 })).toBeVisible();
  await page.getByRole('button', { name: 'Run tests' }).click();
  await expect(page.getByRole('list', { name: 'Test results' }).getByRole('listitem')).toHaveText(['✓ First Fight: 1 actions']);
});
